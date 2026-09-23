import type { FileRecord } from "../types";
import { DuplicateFileRef, DuplicateGroup, DuplicatesResult, DuplicatesSummary } from "./types";

const norm = (value: string) => value.toLocaleLowerCase("es");

function toRef(file: FileRecord, probablyCurrent: boolean): DuplicateFileRef {
  return {
    id: file.id,
    versionId: file.versionId,
    name: file.name,
    ext: file.ext,
    folderPath: file.folderPath,
    size: file.size,
    modifiedOn: file.modifiedOn,
    uploadedBy: file.uploadedBy,
    probablyCurrent,
  };
}

/**
 * Groups files that share the exact same name (including extension), matched
 * case-insensitively, wherever they are in the project - the classic "which
 * copy is the real one?" confusion in construction projects. A folder can't
 * hold two files with the same name in Trimble Connect, so any group with
 * more than one entry necessarily spans different folders.
 *
 * Only the file name is used to group (same rule as the naming-convention
 * check); this never depends on the saved Validación config, so it works
 * even for a project with no template configured.
 */
export function findDuplicates(files: FileRecord[]): DuplicatesResult {
  const byName = new Map<string, FileRecord[]>();
  for (const file of files) {
    const key = norm(file.name);
    const list = byName.get(key);
    if (list) list.push(file);
    else byName.set(key, [file]);
  }

  const groups: DuplicateGroup[] = [];
  const extCounts = new Map<string, number>();

  for (const list of byName.values()) {
    if (list.length < 2) continue;

    const sorted = [...list].sort((a, b) => Date.parse(b.modifiedOn) - Date.parse(a.modifiedOn));
    const newest = Date.parse(sorted[0].modifiedOn);
    // A tie for newest means the dates alone can't tell which copy is current.
    const tiedForNewest = sorted.filter((f) => Date.parse(f.modifiedOn) === newest).length > 1;

    groups.push({
      key: norm(sorted[0].name),
      name: sorted[0].name,
      ext: sorted[0].ext,
      count: sorted.length,
      files: sorted.map((file, i) => toRef(file, i === 0 && !tiedForNewest)),
    });
    for (const file of list) extCounts.set(file.ext, (extCounts.get(file.ext) ?? 0) + 1);
  }

  groups.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "es"));

  const summary: DuplicatesSummary = {
    analyzedAt: new Date().toISOString(),
    totalFiles: files.length,
    groups: groups.length,
    duplicateFiles: groups.reduce((sum, g) => sum + g.count, 0),
    byExt: [...extCounts.entries()]
      .map(([ext, count]) => ({ ext, count }))
      .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext)),
  };

  return { summary, groups };
}

export interface DuplicateFilters {
  ext?: string;
  q?: string;
}

export function filterDuplicateGroups(groups: DuplicateGroup[], filters: DuplicateFilters): DuplicateGroup[] {
  const q = filters.q?.trim() ? norm(filters.q.trim()) : "";
  return groups.filter((group) => {
    if (filters.ext && group.ext !== filters.ext) return false;
    if (q) {
      const haystack = norm(`${group.name} ${group.files.map((f) => f.folderPath).join(" ")}`);
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}
