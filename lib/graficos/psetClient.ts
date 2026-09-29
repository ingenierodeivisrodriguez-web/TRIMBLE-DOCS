import type { LibrariesPayload, PsetInstance } from "../psetApi";

type PsetRequest =
  | { projectId: string; op: "links"; links: string[] }
  | { projectId: string; op: "libraries"; libIds: string[] };

/** Calls /api/graficos/psets with the user's token, retrying once with a fresh token after a 401. */
async function postPsets<T>(body: PsetRequest, getAccessToken: (fresh?: boolean) => Promise<string>): Promise<T> {
  const send = (token: string) =>
    fetch("/api/graficos/psets", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  let res = await send(await getAccessToken());
  if (res.status === 401) res = await send(await getAccessToken(true));
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(error.error ?? `No se pudo leer el servicio de propiedades (error ${res.status}).`);
  }
  return res.json() as Promise<T>;
}

export async function psetsOnObjects(
  projectId: string,
  links: string[],
  getAccessToken: (fresh?: boolean) => Promise<string>
): Promise<PsetInstance[]> {
  const { psets } = await postPsets<{ psets: PsetInstance[] }>({ projectId, op: "links", links }, getAccessToken);
  return psets;
}

export function fetchLibraries(
  projectId: string,
  libIds: string[],
  getAccessToken: (fresh?: boolean) => Promise<string>
): Promise<LibrariesPayload> {
  return postPsets<LibrariesPayload>({ projectId, op: "libraries", libIds }, getAccessToken);
}

// Library ids found in a project are remembered in this browser, so the
// values load on their own the next time the extension opens.
const storageKey = (projectId: string) => `graficos-modelos:bibliotecas:${projectId || "sin-proyecto"}`;

export function loadKnownLibraries(projectId: string): string[] {
  try {
    const data = JSON.parse(window.localStorage.getItem(storageKey(projectId)) ?? "[]");
    return Array.isArray(data) ? data.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function storeKnownLibraries(projectId: string, libIds: string[]): void {
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(libIds));
  } catch {
    // Storage blocked: the libraries simply have to be found again next time.
  }
}
