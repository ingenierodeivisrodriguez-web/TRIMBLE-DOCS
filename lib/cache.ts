import { ProjectData } from "./types";
import { walkProjectTree } from "./walkProjectTree";

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

interface CacheEntry {
  data: ProjectData;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ProjectData>>();

export async function getProjectData(
  projectId: string,
  accessToken: string
): Promise<{ data: ProjectData; cached: boolean }> {
  const entry = cache.get(projectId);
  if (entry && entry.expiresAt > Date.now()) {
    return { data: entry.data, cached: true };
  }

  const pending = inFlight.get(projectId);
  if (pending) {
    return { data: await pending, cached: false };
  }

  const task = walkProjectTree(accessToken, projectId)
    .then((data) => {
      cache.set(projectId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      return data;
    })
    .finally(() => {
      inFlight.delete(projectId);
    });

  inFlight.set(projectId, task);
  return { data: await task, cached: false };
}
