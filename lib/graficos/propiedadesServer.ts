// Server side of "Gráficos de Modelos" reading the "Propiedades" app's data:
// its attribute catalog and every value assigned in a project, straight from
// the tables in supabase/propiedades.sql (read-only, with the server-only
// service key - the same Supabase connection the Propiedades API uses).
// Only elements that were given values have rows, so listing a project's
// values is far cheaper than asking for every element of a model by GUID.
import type { DataType } from "../propiedades/types";
import type { PropiedadesDefinition, PropiedadesPage, PropiedadesValue } from "./propiedades";

const REQUEST_TIMEOUT_MS = 15_000;
/** Values per page of /api/graficos/propiedades (about 0.5 MB of JSON). */
export const PAGE_SIZE = 5000;
// Rows PostgREST returns per request on Supabase (its default max-rows).
const ROWS_PER_QUERY = 1000;

export class PropiedadesUnavailable extends Error {
  constructor(
    message: string,
    public status = 503
  ) {
    super(message);
  }
}

interface DefinitionRow {
  id: string;
  title: string;
  data_type: DataType;
  group_name: string;
  sort_order: number;
  active: boolean;
}

interface ValueRow {
  ifc_guid: string;
  attribute_id: string;
  value_text: string | null;
  value_number: number | null;
  value_boolean: boolean | null;
  value_date: string | null;
}

function connection(): { rest: string; headers: Record<string, string> } {
  const rawUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!rawUrl || !key) {
    throw new PropiedadesUnavailable("La base de datos de Propiedades no está conectada en este despliegue.");
  }
  const headers: Record<string, string> = { apikey: key };
  // Legacy service_role keys are JWTs and also go in Authorization; the newer
  // "sb_secret_…" keys are not JWTs and must only be sent as `apikey`.
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
  return { rest: `${rawUrl.replace(/\/+$/, "")}/rest/v1`, headers };
}

async function get(path: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
  const { rest, headers } = connection();
  const res = await fetch(`${rest}${path}`, {
    headers: { ...headers, ...extraHeaders },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (res.ok) return res;
  const body = await res.text().catch(() => "");
  if (/PGRST20[25]|42P01|Could not find the table|does not exist/i.test(body)) {
    throw new PropiedadesUnavailable("Propiedades aún no tiene sus tablas en Supabase (falta ejecutar supabase/propiedades.sql).");
  }
  if (res.status === 401 || res.status === 403) {
    throw new PropiedadesUnavailable("Supabase rechazó la clave del servidor (SUPABASE_SERVICE_ROLE_KEY).", 502);
  }
  throw new PropiedadesUnavailable(`Supabase respondió ${res.status} al leer Propiedades.`, 502);
}

const eq = (value: string) => `eq.${encodeURIComponent(value)}`;

async function listDefinitions(projectId: string): Promise<PropiedadesDefinition[]> {
  const res = await get(
    `/propiedades_definiciones?project_id=${eq(projectId)}` +
      "&select=id,title,data_type,group_name,sort_order,active&order=sort_order.asc,title.asc"
  );
  return ((await res.json()) as DefinitionRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    dataType: row.data_type,
    group: row.group_name,
    sortOrder: row.sort_order,
    active: row.active,
  }));
}

function toValue(row: ValueRow): PropiedadesValue {
  return {
    ifcGuid: row.ifc_guid,
    attributeId: row.attribute_id,
    value: row.value_text ?? row.value_number ?? row.value_boolean ?? (row.value_date as string),
  };
}

/**
 * One page of the project's values from `offset` (the catalog too, with the
 * first page). The page's rows are read in parallel, 1000 per request; a
 * request answering fewer rows than asked (a lower max-rows setting) ends the
 * page there, so `next` always continues right after the last row returned.
 */
export async function readPropiedadesPage(projectId: string, offset: number): Promise<PropiedadesPage> {
  const page = (from: number, rows: number, count: boolean) =>
    get(
      `/propiedades_valores?project_id=${eq(projectId)}` +
        "&select=ifc_guid,attribute_id,value_text,value_number,value_boolean,value_date" +
        `&order=id.asc&offset=${from}&limit=${rows}`,
      count ? { Prefer: "count=exact" } : {}
    );

  const [definitions, first] = await Promise.all([
    offset === 0 ? listDefinitions(projectId) : Promise.resolve(undefined),
    page(offset, Math.min(ROWS_PER_QUERY, PAGE_SIZE), true),
  ]);
  // Content-Range: "0-999/12345" (or "*/0" when empty).
  const counted = Number(first.headers.get("content-range")?.split("/")[1]);
  const rows = (await first.json()) as ValueRow[];
  const total = Number.isFinite(counted) ? counted : offset + rows.length;

  const end = Math.min(offset + PAGE_SIZE, total);
  const starts: number[] = [];
  if (rows.length === ROWS_PER_QUERY) {
    for (let from = offset + ROWS_PER_QUERY; from < end; from += ROWS_PER_QUERY) starts.push(from);
  }
  const chunks = await Promise.all(
    starts.map((from) => page(from, Math.min(ROWS_PER_QUERY, end - from), false).then((res) => res.json() as Promise<ValueRow[]>))
  );
  for (const [i, chunk] of chunks.entries()) {
    rows.push(...chunk);
    if (chunk.length < Math.min(ROWS_PER_QUERY, end - starts[i])) break;
  }

  const reached = offset + rows.length;
  return {
    ...(definitions ? { definitions } : {}),
    values: rows.map(toValue),
    total,
    next: rows.length > 0 && reached < total ? reached : null,
  };
}
