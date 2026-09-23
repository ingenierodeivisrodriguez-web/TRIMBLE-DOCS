import { getDirectory } from "./permissions";
import { advanceAudit, AuditState, FolderAuditResult, startAudit } from "./permissionAudit";
import { resolveProjectBaseUrl } from "./trimbleApi";
import { ProjectData } from "./types";
import { advanceCrawl, CrawlState, startCrawl } from "./walkProjectTree";

/**
 * In-memory cache, scoped to the lifetime of a single warm serverless
 * instance. On Vercel this means repeated panel opens hitting the same warm
 * function will skip the recursive folder walk for CACHE_TTL_MS; a cold
 * start (or a different instance) will simply recompute it. This satisfies
 * the "avoid re-walking a large project every time the panel opens" goal
 * without needing an external store (Redis/Vercel KV) for a first version.
 *
 * The cache is keyed only by projectId. This assumes the common case where
 * every project member can see every file (Trimble Connect's default
 * project permission model) - see the "Project Roles" section of
 * https://developer.trimble.com/docs/connect/tools/api/core
 */
const CACHE_TTL_MS = 8 * 60 * 1000;

// Each call to advanceProjectData does at most this much crawling work before
// returning, so a single request stays comfortably under any serverless
// function time limit even for projects with thousands of files. The caller
// (an API route) reports back "still working" and the client polls again -
// see fetchWithProgress in lib/apiClient.ts.
const CRAWL_BUDGET_MS = 8000;

interface Entry {
  state: CrawlState;
  expiresAt: number | null; // null until the crawl has finished at least once
}

const entries = new Map<string, Entry>();
const starting = new Map<string, Promise<CrawlState>>();
const advancing = new Map<string, Promise<void>>();

export interface CrawlProgress {
  files: number;
  folders: number;
}

export type AdvanceResult =
  | { done: true; data: ProjectData; progress: CrawlProgress }
  | { done: false; progress: CrawlProgress };

/**
 * Forgets a finished crawl so the next advanceProjectData() call walks the
 * project again (used when the user explicitly asks for fresh data). A crawl
 * that is still running is left alone: it is already fresh.
 */
export function invalidateProjectData(projectId: string): void {
  const entry = entries.get(projectId);
  if (entry?.state.done) entries.delete(projectId);
}

function toProjectData(state: CrawlState): ProjectData {
  return { project: state.project, files: state.files, folders: state.folders, fetchedAt: Date.now() };
}

function progressOf(state: CrawlState): CrawlProgress {
  return { files: state.files.length, folders: state.foldersVisited };
}

/**
 * Does up to CRAWL_BUDGET_MS worth of crawling for a project and reports
 * whether it's done. Safe to call repeatedly (e.g. on every poll from the
 * client, or from concurrent requests) - a crawl already in progress is
 * shared rather than duplicated, and a finished crawl is served straight
 * from cache until it expires.
 */
export async function advanceProjectData(
  projectId: string,
  accessToken: string
): Promise<AdvanceResult> {
  let entry = entries.get(projectId);

  if (entry?.expiresAt) {
    if (entry.expiresAt > Date.now()) {
      return { done: true, data: toProjectData(entry.state), progress: progressOf(entry.state) };
    }
    // Expired: drop it so the project is crawled again instead of being re-served.
    entries.delete(projectId);
    entry = undefined;
  }

  if (!entry) {
    let init = starting.get(projectId);
    if (!init) {
      init = startCrawl(accessToken, projectId);
      starting.set(projectId, init);
      init.finally(() => starting.delete(projectId));
    }
    const state = await init;
    entry = entries.get(projectId) ?? { state, expiresAt: null };
    entries.set(projectId, entry);
  }

  if (!entry.state.done) {
    let advance = advancing.get(projectId);
    if (!advance) {
      advance = advanceCrawl(entry.state, accessToken, Date.now() + CRAWL_BUDGET_MS).finally(() =>
        advancing.delete(projectId)
      );
      advancing.set(projectId, advance);
    }
    await advance;
  }

  if (entry.state.done) {
    entry.expiresAt = Date.now() + CACHE_TTL_MS;
    return { done: true, data: toProjectData(entry.state), progress: progressOf(entry.state) };
  }

  return { done: false, progress: progressOf(entry.state) };
}

// Permission lookups are one Trimble API call per folder, so an audit is
// budgeted the same way as the folder crawl it builds on.
const AUDIT_BUDGET_MS = 8000;

interface AuditEntry {
  state: AuditState;
  expiresAt: number | null;
}

const auditEntries = new Map<string, AuditEntry>();
const auditStarting = new Map<string, Promise<AuditState>>();
const auditAdvancing = new Map<string, Promise<void>>();

export interface AuditProgress {
  checked: number;
  total: number;
}

export type AuditAdvanceResult =
  | { done: true; results: FolderAuditResult[]; progress: AuditProgress }
  | { done: false; progress: AuditProgress };

function auditProgressOf(state: AuditState): AuditProgress {
  return { checked: state.foldersChecked, total: state.folders.length };
}

/** Forgets a finished audit so the next call re-checks every folder from scratch. */
export function invalidatePermissionAudit(projectId: string): void {
  const entry = auditEntries.get(projectId);
  if (entry?.state.done) auditEntries.delete(projectId);
}

/**
 * Does up to AUDIT_BUDGET_MS worth of permission-checking for a project and
 * reports whether it's done - same resumable pattern as advanceProjectData.
 * Builds on the project's (already cached) folder crawl, so it only pays for
 * that walk once even if the audit and the "Estructura de Carpetas" tab are
 * both open in the same session.
 */
export async function advancePermissionAudit(
  projectId: string,
  accessToken: string
): Promise<AuditAdvanceResult> {
  const tree = await advanceProjectData(projectId, accessToken);
  if (!tree.done) {
    return { done: false, progress: { checked: 0, total: 0 } };
  }

  let entry = auditEntries.get(projectId);

  if (entry?.expiresAt) {
    if (entry.expiresAt > Date.now()) {
      return { done: true, results: entry.state.results, progress: auditProgressOf(entry.state) };
    }
    auditEntries.delete(projectId);
    entry = undefined;
  }

  if (!entry) {
    let init = auditStarting.get(projectId);
    if (!init) {
      init = resolveProjectBaseUrl(accessToken, projectId).then((baseUrl) =>
        startAudit(baseUrl, projectId, tree.data.folders)
      );
      auditStarting.set(projectId, init);
      init.finally(() => auditStarting.delete(projectId));
    }
    const state = await init;
    entry = auditEntries.get(projectId) ?? { state, expiresAt: null };
    auditEntries.set(projectId, entry);
  }

  if (!entry.state.done) {
    let advance = auditAdvancing.get(projectId);
    if (!advance) {
      advance = (async () => {
        const directory = await getDirectory(entry!.state.baseUrl, accessToken, projectId);
        await advanceAudit(entry!.state, accessToken, directory, Date.now() + AUDIT_BUDGET_MS);
      })().finally(() => auditAdvancing.delete(projectId));
      auditAdvancing.set(projectId, advance);
    }
    await advance;
  }

  if (entry.state.done) {
    entry.expiresAt = Date.now() + CACHE_TTL_MS;
    return { done: true, results: entry.state.results, progress: auditProgressOf(entry.state) };
  }

  return { done: false, progress: auditProgressOf(entry.state) };
}
