import { advanceProjectData, CrawlProgress } from "../cache";
import type { FileRecord } from "../types";
import { findDuplicates } from "./duplicates";
import type { DuplicatesResult } from "./types";

/**
 * Same resumable-crawl-plus-memoize pattern as analysisCache.ts, but keyed
 * only by the crawl's identity: duplicate detection never depends on the
 * Validación config, so it is cached independently and can run (and be
 * reused across a name-validation run) whether or not a template is
 * configured for the project.
 */
interface Entry {
  files: FileRecord[];
  result: DuplicatesResult;
}

const entries = new Map<string, Entry>();

export type DuplicatesOutcome =
  | { done: true; result: DuplicatesResult }
  | { done: false; progress: CrawlProgress };

export async function runDuplicatesAnalysis(
  projectId: string,
  accessToken: string
): Promise<DuplicatesOutcome> {
  const crawl = await advanceProjectData(projectId, accessToken);
  if (!crawl.done) return { done: false, progress: crawl.progress };

  const cached = entries.get(projectId);
  if (cached && cached.files === crawl.data.files) {
    return { done: true, result: cached.result };
  }

  const result = findDuplicates(crawl.data.files);
  entries.set(projectId, { files: crawl.data.files, result });
  return { done: true, result };
}
