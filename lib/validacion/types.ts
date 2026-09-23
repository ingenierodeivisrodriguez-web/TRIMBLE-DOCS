export type FieldRule =
  | { type: "fixed"; value: string }
  | { type: "list"; values: string[] }
  | { type: "text"; maxLength: number }
  | { type: "number"; length: number };

export type FieldRuleType = FieldRule["type"];

export interface TemplateField {
  id: string;
  label: string;
  rule: FieldRule;
  required: boolean;
}

/**
 * A file-name convention: an ordered list of fields (without the file
 * extension) plus the separator that goes between each pair of consecutive
 * fields (`separators[i]` sits between `fields[i]` and `fields[i + 1]`).
 */
export interface NameTemplate {
  /** Lower-case extensions without the dot, e.g. ["rvt", "dwg"]. */
  extensions: string[];
  fields: TemplateField[];
  separators: string[];
}

export type TemplateKey = "graphic" | "nonGraphic";

export const TEMPLATE_KEYS: TemplateKey[] = ["graphic", "nonGraphic"];

export const TEMPLATE_TITLES: Record<TemplateKey, string> = {
  graphic: "Información Gráfica",
  nonGraphic: "Información No Gráfica",
};

export interface ValidationConfig {
  version: 1;
  graphic: NameTemplate;
  nonGraphic: NameTemplate;
  /** ISO timestamp set by the server every time the config is saved. */
  updatedAt: string | null;
}

export type IssueKind = "separator" | "value" | "missing" | "length" | "trailing";

export interface Issue {
  kind: IssueKind;
  /** What failed: a field label, or a description of the separator. */
  fieldLabel: string;
  message: string;
}

/** A field's slice of the file name: base.slice(start, end). `ok` is false when that field had an issue. */
export interface MatchPart {
  fieldIndex: number;
  start: number;
  end: number;
  ok: boolean;
}

export interface MatchResult {
  conforming: boolean;
  issues: Issue[];
  /** Best parse of the name into fields, in order (omitted optional fields are absent). */
  parts: MatchPart[];
}

export interface FileRef {
  id: string;
  versionId: string;
  name: string;
  ext: string;
  folderPath: string;
}

export interface NonConformingRow extends FileRef {
  template: TemplateKey;
  issues: Issue[];
}

export type UnclassifiedRow = FileRef;

export interface TemplateStats {
  total: number;
  conforming: number;
  nonConforming: number;
}

export interface AnalysisSummary {
  analyzedAt: string;
  configUpdatedAt: string | null;
  totals: {
    files: number;
    /** Files whose extension belongs to one of the two templates. */
    classified: number;
    conforming: number;
    nonConforming: number;
    unclassified: number;
  };
  templates: Record<TemplateKey, TemplateStats>;
  unclassifiedByExt: { ext: string; count: number }[];
  /** How many non-conforming files have an issue in each field (most frequent first). */
  issueCounts: { fieldLabel: string; count: number }[];
}

export interface AnalysisResult {
  summary: AnalysisSummary;
  nonConforming: NonConformingRow[];
  unclassified: UnclassifiedRow[];
}

export type ResultsTab = "nonconforming" | "unclassified";

export interface ResultsPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Duplicados: files that share the exact same name (including extension) in
// different folders of the project - independent of the naming-convention
// config above, so it works even for a project with no template configured.
// ---------------------------------------------------------------------------

export interface DuplicateFileRef extends FileRef {
  size: number;
  modifiedOn: string;
  uploadedBy: string;
  /**
   * True only for the copy whose modification date is unambiguously the
   * newest in its group - a suggestion, not a guarantee, and never set when
   * two or more copies are tied for newest.
   */
  probablyCurrent: boolean;
}

export interface DuplicateGroup {
  /** Normalized (lower-case) name used to group; `name` keeps the original casing of the newest copy. */
  key: string;
  name: string;
  ext: string;
  count: number;
  /** Every copy, newest modified first. */
  files: DuplicateFileRef[];
}

export interface DuplicatesSummary {
  analyzedAt: string;
  totalFiles: number;
  /** Number of distinct duplicate-name groups. */
  groups: number;
  /** Total files that belong to some group (i.e. sum of each group's count). */
  duplicateFiles: number;
  byExt: { ext: string; count: number }[];
}

export interface DuplicatesResult {
  summary: DuplicatesSummary;
  groups: DuplicateGroup[];
}

/** What one click of "Analizar" produces: name-validation results (if configured) and duplicates (always). */
export interface AnalysisOverview {
  configured: boolean;
  validation: AnalysisSummary | null;
  duplicates: DuplicatesSummary;
}
