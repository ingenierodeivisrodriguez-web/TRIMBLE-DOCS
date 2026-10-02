// IFC GUIDs: the 22-character "compressed" GlobalId of IFC (e.g.
// "3CqVfw$t15ihB2vPgB1wri"), which is what IFC tools show and what this tool
// stores. The Workspace API documents that, for IFC models, an object's
// external id is the *uncompressed* GUID (the usual 36-character form), so it
// has to be converted.

const IFC_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
/** 22 chars of the IFC base-64 alphabet; the first encodes 2 bits, so it is 0-3. */
const IFC_GUID_RE = /^[0-3][0-9A-Za-z_$]{21}$/;

export function isIfcGuid(value: string): boolean {
  return IFC_GUID_RE.test(value);
}

function digits(value: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out = IFC_CHARS[value % 64] + out;
    value = Math.floor(value / 64);
  }
  return out;
}

/** "e9ae8a6f-...": 128-bit GUID (with or without dashes/braces) -> 22-char IFC GUID, or null. */
export function uuidToIfcGuid(uuid: string): string | null {
  const hex = uuid.trim().replace(/^\{|\}$/g, "").replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  const bytes = Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  let out = digits(bytes[0], 2);
  for (let i = 1; i < 16; i += 3) out += digits((bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2], 4);
  return out;
}

/** 22-char IFC GUID -> "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", or null. */
export function ifcGuidToUuid(guid: string): string | null {
  if (!isIfcGuid(guid)) return null;
  const values = [...guid].map((c) => IFC_CHARS.indexOf(c));
  const number = (from: number, length: number) => values.slice(from, from + length).reduce((acc, d) => acc * 64 + d, 0);
  const bytes = [number(0, 2)];
  for (let i = 2; i < 22; i += 4) {
    const n = number(i, 4);
    bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Any GUID form (22-char IFC, 32/36-char hex) -> 22-char IFC GUID, or null if it isn't a GUID. */
export function normalizeGuid(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return isIfcGuid(value) ? value : uuidToIfcGuid(value);
}

// ---------------------------------------------------------------- resolution

export interface PropertySetLike {
  name?: string;
  properties?: { name: string; value: unknown }[];
}

export interface GuidCandidate {
  /** "Set · Property" */
  label: string;
  raw: string;
  guid: string | null;
}

export interface GuidResolution {
  /** The element's IFCGUID (22 chars), or null when it has none (not IFC geometry). */
  guid: string | null;
  source: "property" | "external" | null;
  /** Where it came from, for the diagnostics view. */
  sourceLabel: string;
  externalId: string | null;
  candidates: GuidCandidate[];
  /** Set when the explicit IFC GUID property and the external id disagree. */
  conflict: string | null;
}

// Property names that hold the element's IFC GUID, most explicit first.
// "Tipo IfcGUID" / "Type IfcGUID" (the type's GUID) don't match on purpose.
const GUID_PROPERTY_NAMES = ["ifcguid", "ifcglobalid", "globalid", "guid"];

function compact(name: string): string {
  return name.toLowerCase().replace(/[\s_.\-]/g, "");
}

/**
 * Finds an element's IFCGUID. An explicit GUID property wins (e.g. the
 * "IfcGUID" parameter Revit models carry, which is the GlobalId their IFC
 * exports get); otherwise the viewer's external id is used if it is a GUID.
 * Anything else (DWG handles, plain strings...) means the element has no
 * IFCGUID and can't take values.
 */
export function resolveIfcGuid(externalId: string | null, propertySets: PropertySetLike[]): GuidResolution {
  const candidates: (GuidCandidate & { rank: number })[] = [];
  for (const set of propertySets) {
    for (const prop of set.properties ?? []) {
      if (!prop || typeof prop.name !== "string") continue;
      const rank = GUID_PROPERTY_NAMES.indexOf(compact(prop.name));
      if (rank === -1 || prop.value === null || prop.value === undefined) continue;
      const raw = String(prop.value);
      candidates.push({ label: `${set.name ?? "Propiedades"} · ${prop.name}`, raw, guid: normalizeGuid(raw), rank });
    }
  }
  candidates.sort((a, b) => a.rank - b.rank);
  const fromProperty = candidates.find((c) => c.guid);
  const fromExternal = externalId ? normalizeGuid(externalId) : null;
  const plain = candidates.map(({ label, raw, guid }) => ({ label, raw, guid }));

  if (fromProperty) {
    return {
      guid: fromProperty.guid,
      source: "property",
      sourceLabel: `Propiedad "${fromProperty.label}"`,
      externalId,
      candidates: plain,
      conflict:
        fromExternal && fromExternal !== fromProperty.guid
          ? `El id externo del visor corresponde a ${fromExternal}, distinto del IFCGUID de la propiedad.`
          : null,
    };
  }
  if (fromExternal) {
    return {
      guid: fromExternal,
      source: "external",
      sourceLabel: "Id externo del visor (GUID convertido a IFC)",
      externalId,
      candidates: plain,
      conflict: null,
    };
  }
  return { guid: null, source: null, sourceLabel: "Sin IFCGUID", externalId, candidates: plain, conflict: null };
}
