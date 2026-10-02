// Shared by the API, the catalog screen and the 3D viewer panel.

export type DataType = "text" | "number" | "boolean" | "date";

export const DATA_TYPES: DataType[] = ["text", "number", "boolean", "date"];

export const DATA_TYPE_LABELS: Record<DataType, string> = {
  text: "Texto",
  number: "Número",
  boolean: "Sí / No",
  date: "Fecha",
};

/** A value as it travels and is stored: dates as ISO "YYYY-MM-DD", shown as DD-MM-AAAA. */
export type AttributeValue = string | number | boolean;

export interface AttributeDefinition {
  id: string;
  projectId: string;
  title: string;
  dataType: DataType;
  group: string;
  sortOrder: number;
  active: boolean;
  /** How many element values use it: one with values can't be deleted, only deactivated. */
  valueCount: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface StoredValue {
  ifcGuid: string;
  modelId: string;
  attributeId: string;
  value: AttributeValue;
  updatedAt: string;
  updatedBy: string | null;
}

/** An element to write values to. */
export interface TargetElement {
  ifcGuid: string;
  modelId: string;
}

/** One attribute to set on every target; null clears it. */
export interface ValueChange {
  attributeId: string;
  value: AttributeValue | null;
}

export interface DefinitionInput {
  title: string;
  dataType: DataType;
  group: string;
  sortOrder: number;
}

export interface CatalogResponse {
  definitions: AttributeDefinition[];
  /** Whether the caller is a project administrator (only they can edit the catalog). */
  canEdit: boolean;
}

export const DEFAULT_GROUP = "General";
export const MAX_TEXT_LENGTH = 2000;
export const MAX_TITLE_LENGTH = 120;
export const MAX_GROUP_LENGTH = 80;
/** Elements per query or save; a larger selection is handled in batches by the panel. */
export const MAX_ELEMENTS_PER_REQUEST = 2000;
