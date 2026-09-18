import { advanceProjectData, CrawlProgress } from "../cache";
import type { FileRecord } from "../types";
import { analyzeFiles } from "./analyze";
import type { AnalysisResult, ValidationConfig } from "./types";

/**
 * Keeps the last analysis of each project in memory (like the crawl cache in
 * lib/cache.ts, scoped to a warm serverless instance) so paging through the
 * results and exporting them don't re-run the analysis. An entry is reused
 * only while it was computed from the same crawl and the same saved config;
 * otherwise it is recomputed from the (cached) crawl in well under a second.
 */
interface Entry {
  files: FileRecord[];
  configUpdatedAt: string | null;
  result: AnalysisResult;
}

const entries = new Map<string, Entry>();

export type AnalysisOutcome =
  | { done: true; result: AnalysisResult }
  | { done: false; progress: CrawlProgress };

export async function runAnalysis(
  projectId: string,
  accessToken: string,
  config: ValidationConfig
): Promise<AnalysisOutcome> {
  const crawl = await advanceProjectData(projectId, accessToken);
  if (!crawl.done) return { done: false, progress: crawl.progress };

  const cached = entries.get(projectId);
  if (cached && cached.files === crawl.data.files && cached.configUpdatedAt === config.updatedAt) {
    return { done: true, result: cached.result };
  }

  const result = analyzeFiles(crawl.data.files, config);
  entries.set(projectId, {
    files: crawl.data.files,
    configUpdatedAt: config.updatedAt,
    result,
  });
  return { done: true, result };
}
