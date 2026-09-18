export interface CrawlProgress {
  files: number;
  folders: number;
}

const POLL_INTERVAL_MS = 1200;

/**
 * Fetches a JSON endpoint that may respond 202 while a large project is
 * still being crawled server-side (see lib/cache.ts). Transparently polls
 * until the endpoint returns its final 200 response, reporting progress
 * along the way. Returns null if `isCancelled` becomes true (e.g. the
 * component unmounted) while a poll was in flight.
 */
export async function fetchWithProgress<T>(
  url: string,
  accessToken: string,
  onProgress: (progress: CrawlProgress) => void,
  isCancelled: () => boolean
): Promise<T | null> {
  for (;;) {
    if (isCancelled()) return null;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

    if (isCancelled()) return null;

    if (res.status === 202) {
      const body = await res.json();
      onProgress(body.progress);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Error (${res.status})`);
    }

    return res.json();
  }
}
