import {
  AccessLevel,
  getFolderPermissions,
  listProjectGroups,
  listProjectUsers,
  ProjectGroup,
  ProjectUser,
} from "./trimbleApi";

const ACCESS_LEVELS: AccessLevel[] = ["READ", "FULL_ACCESS", "NO_ACCESS"];

export interface AncestorRef {
  id: string;
  name: string;
}

export interface PermissionEntry {
  principalType: "user" | "group" | "all";
  name: string;
  email?: string;
  accessLevel: AccessLevel;
  /** Set directly on this folder, vs merged in because a folder above grants it. */
  direct: boolean;
  /** Name of the ancestor folder the entry was traced back to, when it could be determined. */
  inheritedFromName?: string;
}

export interface Directory {
  usersById: Map<string, ProjectUser>;
  groupsById: Map<string, ProjectGroup>;
}

// The project's member/group list changes rarely; caching it for a few
// minutes avoids two extra REST calls on every permissions-panel open.
const DIRECTORY_TTL_MS = 5 * 60 * 1000;
const directoryCache = new Map<string, { directory: Directory; expiresAt: number }>();

/** Shared with lib/permissionAudit.ts, which also needs to resolve principal ids to names. */
export async function getDirectory(baseUrl: string, accessToken: string, projectId: string): Promise<Directory> {
  const cached = directoryCache.get(projectId);
  if (cached && cached.expiresAt > Date.now()) return cached.directory;

  const [users, groups] = await Promise.all([
    listProjectUsers(baseUrl, accessToken, projectId),
    listProjectGroups(baseUrl, accessToken, projectId),
  ]);
  const directory: Directory = {
    usersById: new Map(users.map((u) => [u.id, u])),
    groupsById: new Map(groups.map((g) => [g.id, g])),
  };
  directoryCache.set(projectId, { directory, expiresAt: Date.now() + DIRECTORY_TTL_MS });
  return directory;
}

export function resolvePrincipal(
  principal: string,
  directory: Directory
): { principalType: PermissionEntry["principalType"]; name: string; email?: string } {
  if (principal === "tc-groups:*") {
    return { principalType: "all", name: "Todos los miembros del proyecto" };
  }
  const separatorIndex = principal.indexOf(":");
  const kind = principal.slice(0, separatorIndex);
  const id = principal.slice(separatorIndex + 1);

  if (kind === "users") {
    const user = directory.usersById.get(id);
    if (!user) return { principalType: "user", name: "Usuario ya no disponible" };
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
    return { principalType: "user", name: name || user.email, email: user.email };
  }

  const group = directory.groupsById.get(id);
  return { principalType: "group", name: group?.name ?? "Grupo ya no disponible" };
}

/**
 * Resolves who has access to a folder, distinguishing permissions set
 * directly on it from ones it merely inherits, and - best-effort - which
 * ancestor folder an inherited entry traces back to.
 *
 * Trimble's `fields=inherited` permissions call already separates direct
 * entries from inherited ones (see getFolderPermissions in lib/trimbleApi.ts),
 * so a single call per folder is enough - no diffing needed. The one thing
 * it doesn't say is *which* ancestor an inherited entry came from, so we
 * walk the ancestor chain (closest first) checking each one's own direct
 * ACL for the same principal, in any access level, to find its source.
 *
 * `ancestors` must be ordered root-first, ending at the immediate parent
 * (the caller already has this from the tree it rendered - see
 * components/folderTree).
 */
export async function resolveFolderPermissions(
  baseUrl: string,
  accessToken: string,
  projectId: string,
  folderId: string,
  ancestors: AncestorRef[]
): Promise<{
  entries: PermissionEntry[];
  inheritanceEnabled: boolean;
}> {
  const closestFirst = [...ancestors].reverse();

  const [folderPermissions, directory, ancestorPermissions] = await Promise.all([
    getFolderPermissions(baseUrl, accessToken, folderId),
    getDirectory(baseUrl, accessToken, projectId),
    Promise.all(closestFirst.map((a) => getFolderPermissions(baseUrl, accessToken, a.id))),
  ]);

  const entries: PermissionEntry[] = [];

  for (const level of ACCESS_LEVELS) {
    for (const principal of folderPermissions.direct.acl[level] ?? []) {
      entries.push({ ...resolvePrincipal(principal, directory), accessLevel: level, direct: true });
    }
  }

  for (const level of ACCESS_LEVELS) {
    for (const principal of folderPermissions.inherited[level] ?? []) {
      let inheritedFromName: string | undefined;
      for (let i = 0; i < closestFirst.length; i++) {
        const ancestorAcl = ancestorPermissions[i].direct.acl;
        if (ACCESS_LEVELS.some((l) => (ancestorAcl[l] ?? []).includes(principal))) {
          inheritedFromName = closestFirst[i].name;
          break;
        }
      }

      entries.push({
        ...resolvePrincipal(principal, directory),
        accessLevel: level,
        direct: false,
        inheritedFromName,
      });
    }
  }

  entries.sort((a, b) => {
    if (a.direct !== b.direct) return a.direct ? -1 : 1;
    return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  });

  return { entries, inheritanceEnabled: folderPermissions.direct.inheritance };
}
