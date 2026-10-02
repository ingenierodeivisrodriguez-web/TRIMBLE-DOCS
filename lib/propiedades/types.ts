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

/** A project contact (person or group of Trimble Connect) who can assign an attribute's values. */
export interface Responsable {
  type: "user" | "group";
  /** Trimble Connect user or group id. */
  id: string;
  /** Name when it was assigned, shown if the contact list isn't at hand. */
  name: string;
}

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
  /** Who can assign its values besides project administrators (none: administrators only). */
  responsables: Responsable[];
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
  responsables?: Responsable[];
}

export interface CatalogResponse {
  definitions: AttributeDefinition[];
  /** Whether the caller is a project administrator (only they can edit the catalog). */
  canEdit: boolean;
  /** Attributes whose values the caller can assign: all for administrators, else those they are responsable for. */
  editableIds: string[];
}

/** The project's people and groups (Trimble Connect's team), to pick responsables from. */
export interface ProjectContacts {
  users: { id: string; name: string; email: string; pending: boolean }[];
  groups: { id: string; name: string; usersCount: number | null }[];
}

export const DEFAULT_GROUP = "General";
export const MAX_TEXT_LENGTH = 2000;
export const MAX_TITLE_LENGTH = 120;
export const MAX_GROUP_LENGTH = 80;
export const MAX_RESPONSABLES = 50;
/** Elements per query or save; a larger selection is handled in batches by the panel. */
export const MAX_ELEMENTS_PER_REQUEST = 2000;
