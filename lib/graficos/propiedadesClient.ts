import type { PropiedadesData, PropiedadesPage } from "./propiedades";

/** The data of the "Propiedades" app isn't reachable here (no database, no tables): not an error of the charts. */
export class PropiedadesUnavailableError extends Error {}

/** Calls /api/graficos/propiedades with the user's token, retrying once with a fresh token after a 401. */
async function getPage(
  projectId: string,
  offset: number,
  getAccessToken: (fresh?: boolean) => Promise<string>
): Promise<PropiedadesPage> {
  const url = `/api/graficos/propiedades?projectId=${encodeURIComponent(projectId)}&offset=${offset}`;
  const send = (token: string) => fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  let res = await send(await getAccessToken());
  if (res.status === 401) res = await send(await getAccessToken(true));
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { error?: string };
    const message = error.error ?? `No se pudieron leer los atributos de Propiedades (error ${res.status}).`;
    throw res.status === 503 ? new PropiedadesUnavailableError(message) : new Error(message);
  }
  return res.json() as Promise<PropiedadesPage>;
}

/** The project's attribute catalog and every value assigned in it, page by page. */
export async function fetchPropiedades(
  projectId: string,
  getAccessToken: (fresh?: boolean) => Promise<string>
): Promise<PropiedadesData> {
  const first = await getPage(projectId, 0, getAccessToken);
  const values = [...first.values];
  for (let next = first.next; next !== null; ) {
    const page = await getPage(projectId, next, getAccessToken);
    values.push(...page.values);
    next = page.next;
  }
  return { definitions: first.definitions ?? [], values };
}
