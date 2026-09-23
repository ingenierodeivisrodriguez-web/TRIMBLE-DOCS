import { AccessLevel, FolderPermissions, getFolderPermissions } from "./trimbleApi";
import { Directory, resolvePrincipal } from "./permissions";
import { FolderNode } from "./types";

const ACCESS_LEVELS: AccessLevel[] = ["READ", "FULL_ACCESS", "NO_ACCESS"];

// Each call to advanceAudit does at most this much work before returning -
// see CRAWL_BUDGET_MS in lib/cache.ts, which this mirrors.
const CONCURRENCY = 16;

export interface AuditEntry {
  principalType: "user" | "group" | "all";
  name: string;
  accessLevel: AccessLevel;
}

export interface FolderAuditResult {
  folderId: string;
  folderName: string;
  /** Full path from the project root, e.g. "01_GENERAL / 03_DISEÑO_Y_MODELOS". */
  path: string;
  /** True if "tc-groups:*" (todos los miembros del proyecto) has a direct grant on this folder. */
  openToEveryone: boolean;
  /** Names of users with FULL_ACCESS granted directly (not via a group). */
  directFullAccessUsers: string[];
  /** Every direct entry on this folder, for the detail view. */
  entries: AuditEntry[];
  /** False means this folder's owner turned off inheritance from its parent. */
  inheritanceEnabled: boolean;
}

/**
 * Classifies one folder's direct permissions into an audit finding.
 * Returns null for folders with no direct entries at all - those simply
 * inherit cleanly and aren't worth surfacing in an audit (the vast majority
 * of folders in a typical project). Pure function, no network calls -
 * see advanceAudit below for the crawl that calls this per folder.
 */
export function classifyFolderPermissions(
  folder: FolderNode,
  path: string,
  permissions: FolderPermissions,
  directory: Directory
): FolderAuditResult | null {
  const entries: AuditEntry[] = [];
  let openToEveryone = false;
  const directFullAccessUsers: string[] = [];

  for (const level of ACCESS_LEVELS) {
    for (const principal of permissions.direct.acl[level] ?? []) {
      const resolved = resolvePrincipal(principal, directory);
      entries.push({ principalType: resolved.principalType, name: resolved.name, accessLevel: level });
      if (resolved.principalType === "all") openToEveryone = true;
      if (resolved.principalType === "user" && level === "FULL_ACCESS") {
        directFullAccessUsers.push(resolved.name);
      }
    }
  }

  if (entries.length === 0) return null;

  entries.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));

  return {
    folderId: folder.id,
    folderName: folder.name,
    path,
    openToEveryone,
    directFullAccessUsers,
    entries,
    inheritanceEnabled: permissions.direct.inheritance,
  };
}

/** Builds "Root / Child / Grandchild" paths for every folder, from the flat parentId list. */
export function buildFolderPaths(folders: FolderNode[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const cache = new Map<string, string>();

  function pathOf(id: string): string {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    const node = byId.get(id);
    if (!node) return "";
    const path = node.parentId ? `${pathOf(node.parentId)} / ${node.name}` : node.name;
    cache.set(id, path);
    return path;
  }

  for (const folder of folders) pathOf(folder.id);
  return cache;
}

/** The resumable state of an in-progress (or finished) permission audit. */
export interface AuditState {
  projectId: string;
  baseUrl: string;
  folders: FolderNode[];
  paths: Map<string, string>;
  cursor: number;
  results: FolderAuditResult[];
  foldersChecked: number;
  done: boolean;
}

export function startAudit(baseUrl: string, projectId: string, folders: FolderNode[]): AuditState {
  return {
    projectId,
    baseUrl,
    folders,
    paths: buildFolderPaths(folders),
    cursor: 0,
    results: [],
    foldersChecked: 0,
    done: folders.length === 0,
  };
}

/**
 * Advances an audit using a worker-pool of CONCURRENCY permission lookups
 * kept continuously busy, stopping new work once `deadline` passes but
 * letting in-flight requests finish - mirrors advanceCrawl in
 * lib/walkProjectTree.ts, so a project with thousands of folders is audited
 * across several short, resumable calls instead of one long request.
 */
export async function advanceAudit(
  state: AuditState,
  accessToken: string,
  directory: Directory,
  deadline: number
): Promise<void> {
  if (state.cursor >= state.folders.length) {
    state.done = true;
    return;
  }

  await new Promise<void>((resolve) => {
    let active = 0;
    let settled = false;

    function settle() {
      if (settled || active > 0) return;
      settled = true;
      state.done = state.cursor >= state.folders.length;
      resolve();
    }

    function launchNext() {
      if (settled) return;
      if (Date.now() >= deadline) {
        settle();
        return;
      }
      if (state.cursor >= state.folders.length) {
        settle();
        return;
      }
      const folder = state.folders[state.cursor++];
      active++;
      getFolderPermissions(state.baseUrl, accessToken, folder.id)
        .then((permissions) => {
          state.foldersChecked++;
          const finding = classifyFolderPermissions(
            folder,
            state.paths.get(folder.id) ?? folder.name,
            permissions,
            directory
          );
          if (finding) state.results.push(finding);
        })
        .catch(() => {
          // Skip folders we fail to read (permissions, transient errors)
          // rather than failing the whole audit for one bad folder.
        })
        .finally(() => {
          active--;
          launchNext();
          settle();
        });
    }

    const starters = Math.min(CONCURRENCY, state.folders.length - state.cursor);
    for (let i = 0; i < starters; i++) launchNext();
  });
}
