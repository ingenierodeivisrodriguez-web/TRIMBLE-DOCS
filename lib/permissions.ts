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

interface Directory {
  usersById: Map<string, ProjectUser>;
  groupsById: Map<string, ProjectGroup>;
}

// The project's member/group list changes rarely; caching it for a few
// minutes avoids two extra REST calls on every permissions-panel open.
const DIRECTORY_TTL_MS = 5 * 60 * 1000;
const directoryCache = new Map<string, { directory: Directory; expiresAt: number }>();

async function getDirectory(baseUrl: string, accessToken: string, projectId: string): Promise<Directory> {
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

function resolvePrincipal(
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
 * Trimble's `fields=inherited` permissions call returns the *effective*
 * (already-merged) ACL, but not which entries are direct vs inherited, or
 * where an inherited one originally came from (see getFolderPermissions in
 * lib/trimbleApi.ts). We reconstruct that ourselves: diff the direct-only
 * ACL against the effective one to find the inherited entries, then walk the
 * ancestor chain (closest first) checking each one's own direct-only ACL
 * for the same principal, in any access level, to find its source.
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
  // TEMP: raw Trimble responses, surfaced in the UI while we diagnose why
  // some real folders come back with no ACL entries at all. Remove once
  // resolved - see the "Estructura de Carpetas" permissions section of the README.
  debug: unknown;
}> {
  const closestFirst = [...ancestors].reverse();

  const [direct, effective, directory, ancestorAcls] = await Promise.all([
    getFolderPermissions(baseUrl, accessToken, folderId, false),
    getFolderPermissions(baseUrl, accessToken, folderId, true),
    getDirectory(baseUrl, accessToken, projectId),
    Promise.all(closestFirst.map((a) => getFolderPermissions(baseUrl, accessToken, a.id, false))),
  ]);

  const directKeys = new Set<string>();
  const entries: PermissionEntry[] = [];

  for (const level of ACCESS_LEVELS) {
    for (const principal of direct.acl[level] ?? []) {
      directKeys.add(`${level}:${principal}`);
      entries.push({ ...resolvePrincipal(principal, directory), accessLevel: level, direct: true });
    }
  }

  for (const level of ACCESS_LEVELS) {
    for (const principal of effective.acl[level] ?? []) {
      const key = `${level}:${principal}`;
      if (directKeys.has(key)) continue;
      directKeys.add(key); // avoid double-counting if the same principal+level repeats

      let inheritedFromName: string | undefined;
      for (let i = 0; i < closestFirst.length; i++) {
        const ancestorAcl = ancestorAcls[i].acl;
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

  return {
    entries,
    inheritanceEnabled: direct.inheritance,
    debug: {
      folderId,
      ancestors: closestFirst,
      direct,
      effective,
      ancestorAcls: closestFirst.map((a, i) => ({ id: a.id, name: a.name, ...ancestorAcls[i] })),
    },
  };
}
