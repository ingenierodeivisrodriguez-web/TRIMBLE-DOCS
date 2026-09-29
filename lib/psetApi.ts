// Server-side client for Trimble Connect's Property Set Service: the
// libraries of custom properties that project admins create under
// "Bibliotecas de conjuntos de propiedades" and users fill in from the 3D
// viewer's property panel. Those values are not part of the model file, so the
// viewer's own getObjectProperties doesn't return them.
// OpenAPI: https://app.swaggerhub.com/apis/Trimble-Connect/pset-prod/v1
import { TrimbleApiError } from "./trimbleApi";

export interface PsetLibrary {
  id: string;
  name: string;
}

export interface PsetDefinition {
  libId: string;
  id: string;
  name: string;
  /** OpenAPI-style property schemas, by property key. */
  props: Record<string, { type?: string; format?: string; title?: string }>;
  /** Translation table: i18n[lang] = { name, props: { key: label } }. */
  i18n: Record<string, { name?: string; props?: Record<string, string> }>;
}

export interface PsetInstance {
  link: string;
  libId: string;
  defId: string;
  props: Record<string, unknown>;
}

export interface LibrariesPayload {
  libs: PsetLibrary[];
  defs: PsetDefinition[];
  psets: PsetInstance[];
}

const LIB_ID = /^[\w-]{1,128}$/;
const MAX_PAGES = 60;
const CONCURRENCY = 6;

export function isValidLibId(id: string): boolean {
  return LIB_ID.test(id);
}

export function isValidLink(link: string): boolean {
  return link.startsWith("frn:") && link.length <= 512;
}

async function psetFetch(url: string, accessToken: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TrimbleApiError(`Servicio de propiedades (${res.status}): ${body.slice(0, 300)}`, res.status);
  }
  return res.json();
}

/** Follows `next` links, but only on the service's own host. */
async function fetchAllPages<T>(firstUrl: string, base: string, accessToken: string): Promise<T[]> {
  const origin = new URL(base).origin;
  const items: T[] = [];
  let url: string | null = firstUrl;
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const data = (await psetFetch(url, accessToken)) as { items?: T[]; next?: string } | null;
    if (!data) break;
    items.push(...(data.items ?? []));
    if (!data.next) break;
    const next = new URL(data.next, `${base}/`);
    url = next.origin === origin ? next.toString() : null;
  }
  return items;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function toInstance(raw: unknown): PsetInstance | null {
  const p = raw as Partial<PsetInstance> & { deleted?: boolean };
  if (!p || p.deleted || typeof p.link !== "string" || typeof p.libId !== "string" || typeof p.defId !== "string") {
    return null;
  }
  return { link: p.link, libId: p.libId, defId: p.defId, props: (p.props as Record<string, unknown>) ?? {} };
}

/** Property sets attached to each of the given object links (any library). */
export async function psetsForLinks(base: string, accessToken: string, links: string[]): Promise<PsetInstance[]> {
  const lists = await mapLimit(links, CONCURRENCY, (link) =>
    fetchAllPages<unknown>(`${base}/psets/${encodeURIComponent(link)}`, base, accessToken)
  );
  return lists.flat().map(toInstance).filter((p): p is PsetInstance => p !== null);
}

/** Everything needed to chart the given libraries: names, definitions and every filled-in property set. */
export async function loadLibraries(base: string, accessToken: string, libIds: string[]): Promise<LibrariesPayload> {
  const perLib = await mapLimit(libIds, 3, async (libId) => {
    const id = encodeURIComponent(libId);
    const [lib, defs, psets] = await Promise.all([
      psetFetch(`${base}/libs/${id}`, accessToken) as Promise<{ id: string; name?: string } | null>,
      fetchAllPages<Record<string, unknown>>(`${base}/libs/${id}/defs`, base, accessToken),
      fetchAllPages<unknown>(`${base}/libs/${id}/psets?top=500`, base, accessToken),
    ]);
    return { libId, lib, defs, psets };
  });

  const payload: LibrariesPayload = { libs: [], defs: [], psets: [] };
  for (const { libId, lib, defs, psets } of perLib) {
    if (!lib) continue;
    payload.libs.push({ id: libId, name: lib.name ?? libId });
    for (const d of defs) {
      if (d.deleted) continue;
      const schema = (d.schema as { props?: PsetDefinition["props"] } | undefined) ?? {};
      payload.defs.push({
        libId,
        id: String(d.id),
        name: typeof d.name === "string" ? d.name : String(d.id),
        props: schema.props ?? {},
        i18n: (d.i18n as PsetDefinition["i18n"]) ?? {},
      });
    }
    payload.psets.push(...psets.map(toInstance).filter((p): p is PsetInstance => p !== null));
  }
  return payload;
}
