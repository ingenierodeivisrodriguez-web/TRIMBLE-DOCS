import { FileRecord, FolderNode } from "./types";

export interface TreeFileNode {
  kind: "file";
  id: string;
  name: string;
  ext: string;
  size: number;
}

export interface TreeFolderNode {
  kind: "folder";
  id: string;
  name: string;
  /** 0 for the project's own root (not rendered as a row); 1 for folders directly under it, etc. */
  level: number;
  /** Recursive count: files in this folder plus every descendant folder. */
  fileCount: number;
  children: TreeNode[];
}

export type TreeNode = TreeFolderNode | TreeFileNode;

/**
 * Builds the full nested folder/file tree from the same flat folders+files
 * arrays the "Resumen" dashboard already crawled and cached - no separate
 * walk. Cheap (pure grouping over already-fetched data), so it runs on every
 * request rather than being cached separately.
 */
export function buildTree(folders: FolderNode[], files: FileRecord[]): TreeFolderNode {
  const foldersById = new Map<string, FolderNode>();
  const childFolderIds = new Map<string, string[]>();
  let rootId: string | null = null;

  for (const folder of folders) {
    foldersById.set(folder.id, folder);
    if (folder.parentId === null) {
      rootId = folder.id;
    } else {
      const siblings = childFolderIds.get(folder.parentId);
      if (siblings) siblings.push(folder.id);
      else childFolderIds.set(folder.parentId, [folder.id]);
    }
  }

  const filesByFolder = new Map<string, FileRecord[]>();
  for (const file of files) {
    const siblings = filesByFolder.get(file.folderId);
    if (siblings) siblings.push(file);
    else filesByFolder.set(file.folderId, [file]);
  }

  if (rootId === null) {
    throw new Error("La lista de carpetas no incluye la carpeta raiz del proyecto.");
  }

  function collator(a: { name: string }, b: { name: string }) {
    return a.name.localeCompare(b.name, "es", { sensitivity: "base", numeric: true });
  }

  function build(folderId: string, level: number): TreeFolderNode {
    const folder = foldersById.get(folderId)!;

    const childFolders = (childFolderIds.get(folderId) ?? [])
      .map((id) => build(id, level + 1))
      .sort(collator);

    const childFiles: TreeFileNode[] = (filesByFolder.get(folderId) ?? [])
      .map((f) => ({ kind: "file" as const, id: f.id, name: f.name, ext: f.ext, size: f.size }))
      .sort(collator);

    const fileCount =
      childFiles.length + childFolders.reduce((sum, child) => sum + child.fileCount, 0);

    return {
      kind: "folder",
      id: folder.id,
      name: folder.name,
      level,
      fileCount,
      children: [...childFolders, ...childFiles],
    };
  }

  return build(rootId, 0);
}

// A blue-anchored but hue-varied sequence so 6+ adjacent levels stay easy to
// tell apart at a glance, rather than near-identical shades of one blue.
export const LEVEL_COLORS = [
  "#0a3d62", // 1 - deep navy
  "#0b5fa5", // 2 - Trimble blue
  "#1e88d6", // 3 - sky blue
  "#0f9b8e", // 4 - teal
  "#4f6d8f", // 5 - slate blue
  "#7c5cbf", // 6 - indigo
];
export const LEVEL_OVERFLOW_COLOR = "#94a3b8"; // 7+ - neutral slate

export function colorForLevel(level: number): string {
  if (level < 1) return LEVEL_OVERFLOW_COLOR;
  return LEVEL_COLORS[level - 1] ?? LEVEL_OVERFLOW_COLOR;
}

/** Case- and accent-insensitive normalization used for the tree search box. */
export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
