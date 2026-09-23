import type { ResultsTab } from "./types";

const POLL_INTERVAL_MS = 1200;
const MAX_ATTEMPTS = 90;

/**
 * Fetches an export endpoint and hands the result to the browser as a
 * download. The request needs the access token header, so it can't be a
 * plain link: the file is fetched and turned into a blob URL. If the server
 * is still refreshing the project data (202) it waits and retries.
 */
async function downloadFile(url: string, accessToken: string, fallbackName: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

    if (res.status === 202) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `No se pudo exportar (error ${res.status}).`);
    }

    const blob = await res.blob();
    const filename =
      /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
    return;
  }

  throw new Error("Se agotó el tiempo de espera mientras se actualizaban los datos del proyecto.");
}

/** Downloads the non-conforming (or unclassified) list, with the same filters the table is showing. */
export async function downloadExport(
  projectId: string,
  accessToken: string,
  tab: ResultsTab,
  format: "xlsx" | "csv",
  filters: Record<string, string> = {}
): Promise<void> {
  const params = new URLSearchParams({ projectId, tab, format, ...filters });
  await downloadFile(`/api/validacion/export?${params.toString()}`, accessToken, `validacion.${format}`);
}

/** Downloads the duplicate-name groups (one row per copy), with the same filters the table is showing. */
export async function downloadDuplicatesExport(
  projectId: string,
  accessToken: string,
  format: "xlsx" | "csv",
  filters: Record<string, string> = {}
): Promise<void> {
  const params = new URLSearchParams({ projectId, format, ...filters });
  await downloadFile(
    `/api/validacion/duplicates/export?${params.toString()}`,
    accessToken,
    `validacion-duplicados.${format}`
  );
}
