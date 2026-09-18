import {
  FieldRule,
  FieldRuleType,
  NameTemplate,
  TEMPLATE_KEYS,
  TEMPLATE_TITLES,
  TemplateField,
  ValidationConfig,
} from "./types";

export const MAX_FIELDS = 20;
export const MAX_TEXT_LENGTH = 255;
export const MAX_NUMBER_LENGTH = 30;
export const MAX_SEPARATOR_LENGTH = 5;
export const DEFAULT_SEPARATOR = "_";

export const TEXT_FIELD_LIMIT_EXPLANATION =
  "Solo se permite un campo de texto libre por plantilla. El analizador ubica los campos de código fijo, lista y número desde ambos extremos del nombre y le asigna al campo de texto libre lo que queda en el medio; con dos campos de longitud variable no habría forma determinista de saber dónde termina uno y empieza el otro.";

export const PDF_GRAPHIC_WARNING =
  "Por convención de la empresa, el PDF nunca se considera información gráfica. Puedes mantenerlo en esta plantilla si lo necesitas, pero revisa que sea lo que quieres.";

export function emptyTemplate(): NameTemplate {
  return { extensions: [], fields: [], separators: [] };
}

export function defaultConfig(): ValidationConfig {
  return { version: 1, graphic: emptyTemplate(), nonGraphic: emptyTemplate(), updatedAt: null };
}

export function normalizeExtension(raw: string): string {
  return raw.trim().toLowerCase().replace(/^\.+/, "");
}

export function isValidExtension(ext: string): boolean {
  return /^[a-z0-9][a-z0-9_+-]{0,15}$/.test(ext);
}

export function defaultRule(type: FieldRuleType): FieldRule {
  switch (type) {
    case "fixed":
      return { type: "fixed", value: "" };
    case "list":
      return { type: "list", values: [] };
    case "text":
      return { type: "text", maxLength: 40 };
    case "number":
      return { type: "number", length: 3 };
  }
}

export function newFieldId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `f_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function hasTextField(template: NameTemplate, exceptFieldId?: string): boolean {
  return template.fields.some((f) => f.rule.type === "text" && f.id !== exceptFieldId);
}

/** True when at least one template has extensions and fields, i.e. there is something to validate. */
export function isConfigured(config: ValidationConfig): boolean {
  return TEMPLATE_KEYS.some((key) => {
    const t = config[key];
    return t.extensions.length > 0 && t.fields.length > 0;
  });
}

// ---------------------------------------------------------------------------
// Parsing untrusted input (API bodies, values read back from the database)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function parseRule(raw: unknown, errors: string[], where: string): FieldRule {
  if (!isRecord(raw)) {
    errors.push(`${where}: falta la regla del campo.`);
    return defaultRule("list");
  }
  switch (raw.type) {
    case "fixed":
      return { type: "fixed", value: typeof raw.value === "string" ? raw.value : "" };
    case "list":
      return {
        type: "list",
        values: unique(
          toStringArray(raw.values)
            .map((v) => v.trim())
            .filter((v) => v.length > 0)
        ),
      };
    case "text":
      return { type: "text", maxLength: typeof raw.maxLength === "number" ? raw.maxLength : NaN };
    case "number":
      return { type: "number", length: typeof raw.length === "number" ? raw.length : NaN };
    default:
      errors.push(`${where}: tipo de regla desconocido.`);
      return defaultRule("list");
  }
}

function parseTemplate(raw: unknown, title: string, errors: string[]): NameTemplate {
  const r = isRecord(raw) ? raw : {};
  const fields: TemplateField[] = Array.isArray(r.fields)
    ? r.fields.map((rawField, i) => {
        const f = isRecord(rawField) ? rawField : {};
        return {
          id: typeof f.id === "string" && f.id.length > 0 ? f.id : `field-${i}`,
          label: typeof f.label === "string" ? f.label.trim() : "",
          rule: parseRule(f.rule, errors, `${title}, campo ${i + 1}`),
          required: f.required !== false,
        };
      })
    : [];
  return {
    extensions: unique(
      toStringArray(r.extensions)
        .map(normalizeExtension)
        .filter((e) => e.length > 0)
    ),
    fields,
    separators: Array.isArray(r.separators)
      ? r.separators.map((s) => (typeof s === "string" ? s : ""))
      : [],
  };
}

/** Coerces unknown data into a ValidationConfig and reports every problem found. */
export function parseConfig(raw: unknown): { config: ValidationConfig; errors: string[] } {
  const errors: string[] = [];
  const r = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) errors.push("La configuración no tiene el formato esperado.");
  const config: ValidationConfig = {
    version: 1,
    graphic: parseTemplate(r.graphic, TEMPLATE_TITLES.graphic, errors),
    nonGraphic: parseTemplate(r.nonGraphic, TEMPLATE_TITLES.nonGraphic, errors),
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : null,
  };
  errors.push(...validateConfig(config));
  return { config, errors };
}

// ---------------------------------------------------------------------------
// Validation of a configuration (shared by the form and the API)
// ---------------------------------------------------------------------------

function validateField(field: TemplateField, where: string): string[] {
  const errors: string[] = [];
  if (field.label.trim().length === 0) errors.push(`${where}: escribe un nombre para el campo.`);
  const rule = field.rule;
  const name = field.label.trim() ? `${where} («${field.label.trim()}»)` : where;
  switch (rule.type) {
    case "fixed":
      if (rule.value.length === 0) errors.push(`${name}: escribe el código fijo.`);
      break;
    case "list":
      if (rule.values.length === 0) errors.push(`${name}: agrega al menos un valor permitido.`);
      break;
    case "text":
      if (!Number.isInteger(rule.maxLength) || rule.maxLength < 1 || rule.maxLength > MAX_TEXT_LENGTH) {
        errors.push(`${name}: la longitud máxima debe ser un entero entre 1 y ${MAX_TEXT_LENGTH}.`);
      }
      break;
    case "number":
      if (!Number.isInteger(rule.length) || rule.length < 1 || rule.length > MAX_NUMBER_LENGTH) {
        errors.push(`${name}: la cantidad de dígitos debe ser un entero entre 1 y ${MAX_NUMBER_LENGTH}.`);
      }
      break;
  }
  return errors;
}

export function validateConfig(config: ValidationConfig): string[] {
  const errors: string[] = [];

  for (const key of TEMPLATE_KEYS) {
    const template = config[key];
    const title = TEMPLATE_TITLES[key];

    for (const ext of template.extensions) {
      if (!isValidExtension(ext)) errors.push(`${title}: la extensión '${ext}' no es válida.`);
    }
    if (template.extensions.length > 0 && template.fields.length === 0) {
      errors.push(`${title}: define al menos un campo o quita las extensiones asignadas.`);
    }
    if (template.fields.length > MAX_FIELDS) {
      errors.push(`${title}: máximo ${MAX_FIELDS} campos por plantilla.`);
    }
    if (template.fields.filter((f) => f.rule.type === "text").length > 1) {
      errors.push(`${title}: ${TEXT_FIELD_LIMIT_EXPLANATION}`);
    }

    const expectedSeparators = Math.max(0, template.fields.length - 1);
    if (template.separators.length !== expectedSeparators) {
      errors.push(`${title}: debe haber exactamente un separador entre cada par de campos.`);
    }
    template.separators.forEach((sep, i) => {
      if (sep.length === 0 || sep.length > MAX_SEPARATOR_LENGTH) {
        errors.push(
          `${title}: el separador entre el campo ${i + 1} y el campo ${i + 2} debe tener entre 1 y ${MAX_SEPARATOR_LENGTH} caracteres.`
        );
      }
    });

    template.fields.forEach((field, i) => {
      errors.push(...validateField(field, `${title}, campo ${i + 1}`));
    });
  }

  const graphic = new Set(config.graphic.extensions);
  for (const ext of config.nonGraphic.extensions) {
    if (graphic.has(ext)) {
      errors.push(`La extensión '${ext}' está asignada a ambas plantillas; debe estar solo en una.`);
    }
  }

  return unique(errors);
}

// ---------------------------------------------------------------------------
// Live preview
// ---------------------------------------------------------------------------

export interface SampleSegment {
  kind: "field" | "separator" | "extension";
  text: string;
  label?: string;
  optional?: boolean;
}

function sampleValue(rule: FieldRule): string {
  switch (rule.type) {
    case "fixed":
      return rule.value || "‹código›";
    case "list":
      return rule.values[0] || "‹valor›";
    case "text":
      return "DescripcionDelArchivo".slice(0, Number.isInteger(rule.maxLength) && rule.maxLength > 0 ? rule.maxLength : 40);
    case "number": {
      const length = Number.isInteger(rule.length) && rule.length > 0 ? rule.length : 3;
      return "0".repeat(length - 1) + "1";
    }
  }
}

/** An example file name built from the template, split into styled segments. */
export function buildSampleSegments(template: NameTemplate): SampleSegment[] {
  const segments: SampleSegment[] = [];
  template.fields.forEach((field, i) => {
    if (i > 0) segments.push({ kind: "separator", text: template.separators[i - 1] ?? "" });
    segments.push({
      kind: "field",
      text: sampleValue(field.rule),
      label: field.label,
      optional: !field.required,
    });
  });
  segments.push({ kind: "extension", text: `.${template.extensions[0] ?? "ext"}` });
  return segments;
}

/** The same example, without the extension - handy to feed back into the matcher. */
export function buildSampleBaseName(template: NameTemplate): string {
  return buildSampleSegments(template)
    .filter((s) => s.kind !== "extension")
    .map((s) => s.text)
    .join("");
}
