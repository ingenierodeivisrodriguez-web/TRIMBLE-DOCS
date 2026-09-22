import { normalizeForSearch, TreeFolderNode, TreeNode } from "./folderTree";

export interface AncestorRef {
  id: string;
  name: string;
}

export interface FlatRow {
  node: TreeNode;
  depth: number;
  /** Root-first chain of ancestor folders, including the project's own root folder. */
  ancestors: AncestorRef[];
}

/**
 * Flattens the (partially) expanded tree into the row list react-window
 * renders. Only expanded branches are walked, so this stays cheap even for
 * a project with thousands of nodes - the cost of a huge project is paid
 * once (the /api/tree fetch), not on every render.
 */
export function flattenTree(root: TreeFolderNode, expanded: ReadonlySet<string>): FlatRow[] {
  const rows: FlatRow[] = [];
  const rootAncestor: AncestorRef = { id: root.id, name: root.name };

  function walk(node: TreeFolderNode, ancestors: AncestorRef[]) {
    const childDepth = node.level + 1;
    for (const child of node.children) {
      rows.push({ node: child, depth: childDepth, ancestors });
      if (child.kind === "folder" && expanded.has(child.id)) {
        walk(child, [...ancestors, { id: child.id, name: child.name }]);
      }
    }
  }

  walk(root, [rootAncestor]);
  return rows;
}

/** Every folder id in the tree - used by "Expandir todo". */
export function allFolderIds(root: TreeFolderNode): string[] {
  const ids: string[] = [];
  function walk(node: TreeFolderNode) {
    for (const child of node.children) {
      if (child.kind === "folder") {
        ids.push(child.id);
        walk(child);
      }
    }
  }
  walk(root);
  return ids;
}

export interface SearchMatch {
  id: string;
  name: string;
  kind: "folder" | "file";
  /** Folder ids to expand (root's direct children down to the match's parent) to reveal it. */
  pathIds: string[];
}

/** Searches the whole tree regardless of what's currently expanded. */
export function searchTree(root: TreeFolderNode, query: string): SearchMatch[] {
  const q = normalizeForSearch(query.trim());
  if (!q) return [];

  const matches: SearchMatch[] = [];
  function walk(node: TreeFolderNode, pathIds: string[]) {
    for (const child of node.children) {
      if (normalizeForSearch(child.name).includes(q)) {
        matches.push({ id: child.id, name: child.name, kind: child.kind, pathIds });
      }
      if (child.kind === "folder") {
        walk(child, [...pathIds, child.id]);
      }
    }
  }
  walk(root, []);
  return matches;
}

function storageKey(projectId: string): string {
  return `resumen-archivos:estructura-carpetas:expanded:${projectId}`;
}

/** Per-project, per-browser only (see lib/folderTreeClient.ts callers) - never sent to the server. */
export function loadExpandedIds(projectId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    if (!raw) return new Set();
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? new Set(ids) : new Set();
  } catch {
    return new Set();
  }
}

export function saveExpandedIds(projectId: string, expanded: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify([...expanded]));
  } catch {
    // Storage can be unavailable (private mode, quota) - losing this preference is harmless.
  }
}
