import type { FileRecord } from "../types";
import { matchName } from "./matcher";
import {
  AnalysisResult,
  FileRef,
  MatchResult,
  NonConformingRow,
  TEMPLATE_KEYS,
  TemplateKey,
  TemplateStats,
  UnclassifiedRow,
  ValidationConfig,
} from "./types";

function toRef(file: FileRecord): FileRef {
  return {
    id: file.id,
    versionId: file.versionId,
    name: file.name,
    ext: file.ext,
    folderPath: file.folderPath,
  };
}

/** The file name without its extension (the extension was derived from the last dot). */
function baseNameOf(file: FileRecord): string {
  return file.name.slice(0, file.name.length - (file.ext.length + 1));
}

const byFolderThenName = (a: FileRef, b: FileRef) =>
  a.folderPath.localeCompare(b.folderPath, "es", { sensitivity: "base" }) ||
  a.name.localeCompare(b.name, "es", { sensitivity: "base" });

/**
 * Applies the saved configuration to the project's files: each file goes to the
 * template that owns its extension (or to "unclassified" if none does), and
 * files with a template have their name (without extension) validated against
 * its field structure.
 */
export function analyzeFiles(files: FileRecord[], config: ValidationConfig): AnalysisResult {
  const templateByExt = new Map<string, TemplateKey>();
  for (const key of TEMPLATE_KEYS) {
    for (const ext of config[key].extensions) {
      if (!templateByExt.has(ext)) templateByExt.set(ext, key);
    }
  }

  const stats: Record<TemplateKey, TemplateStats> = {
    graphic: { total: 0, conforming: 0, nonConforming: 0 },
    nonGraphic: { total: 0, conforming: 0, nonConforming: 0 },
  };
  const nonConforming: NonConformingRow[] = [];
  const unclassified: UnclassifiedRow[] = [];
  const unclassifiedCounts = new Map<string, number>();

  for (const file of files) {
    const key = file.ext === "sin-extension" ? undefined : templateByExt.get(file.ext);

    if (!key) {
      unclassified.push(toRef(file));
      unclassifiedCounts.set(file.ext, (unclassifiedCounts.get(file.ext) ?? 0) + 1);
      continue;
    }

    stats[key].total++;
    const result = matchName(baseNameOf(file), config[key]);
    if (result.conforming) {
      stats[key].conforming++;
    } else {
      stats[key].nonConforming++;
      nonConforming.push({ ...toRef(file), template: key, issues: result.issues });
    }
  }

  nonConforming.sort(byFolderThenName);
  unclassified.sort(byFolderThenName);

  const issueCounts = new Map<string, number>();
  for (const row of nonConforming) {
    for (const label of new Set(row.issues.map((i) => i.fieldLabel))) {
      issueCounts.set(label, (issueCounts.get(label) ?? 0) + 1);
    }
  }

  const conforming = stats.graphic.conforming + stats.nonGraphic.conforming;
  const nonConformingCount = stats.graphic.nonConforming + stats.nonGraphic.nonConforming;

  return {
    summary: {
      analyzedAt: new Date().toISOString(),
      configUpdatedAt: config.updatedAt,
      totals: {
        files: files.length,
        classified: conforming + nonConformingCount,
        conforming,
        nonConforming: nonConformingCount,
        unclassified: unclassified.length,
      },
      templates: stats,
      unclassifiedByExt: [...unclassifiedCounts.entries()]
        .map(([ext, count]) => ({ ext, count }))
        .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext)),
      issueCounts: [...issueCounts.entries()]
        .map(([fieldLabel, count]) => ({ fieldLabel, count }))
        .sort((a, b) => b.count - a.count || a.fieldLabel.localeCompare(b.fieldLabel)),
    },
    nonConforming,
    unclassified,
  };
}

export type NameEvaluation =
  | { kind: "unclassified"; ext: string }
  | {
      kind: "conforming" | "nonconforming";
      template: TemplateKey;
      /** The name without its extension. */
      base: string;
      ext: string;
      result: MatchResult;
    };

/** Splits "a.b.pdf" into its base name and lower-cased extension, like the folder crawl does. */
export function splitFileName(fileName: string): { base: string; ext: string } {
  const idx = fileName.lastIndexOf(".");
  if (idx <= 0 || idx === fileName.length - 1) return { base: fileName, ext: "sin-extension" };
  return { base: fileName.slice(0, idx), ext: fileName.slice(idx + 1).toLowerCase() };
}

/** Evaluates one full file name (with extension) against a config - used by the live name tester. */
export function evaluateName(fileName: string, config: ValidationConfig): NameEvaluation {
  const { base, ext } = splitFileName(fileName);
  const template = ext === "sin-extension" ? undefined : TEMPLATE_KEYS.find((key) => config[key].extensions.includes(ext));
  if (!template) return { kind: "unclassified", ext };
  const result = matchName(base, config[template]);
  return { kind: result.conforming ? "conforming" : "nonconforming", template, base, ext, result };
}
