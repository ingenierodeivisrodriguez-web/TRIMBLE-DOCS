import { getProjectDetails, listFolderItems, RawFolderItem, resolveProjectBaseUrl } from "./trimbleApi";
import { FileRecord, ProjectMeta } from "./types";

// How many folders we list in parallel. Trimble's /folders/{id}/items is a
// small, cheap call, so a project with thousands of files is bottlenecked on
// round-trip latency rather than the API's own processing time - raising
// concurrency is the single biggest lever for large projects.
const CONCURRENCY = 16;

function extensionOf(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx <= 0 || idx === fileName.length - 1) return "sin-extension";
  return fileName.slice(idx + 1).toLowerCase();
}

function userLabel(user?: { firstName?: string; lastName?: string; email?: string }): string {
  if (!user) return "Desconocido";
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || user.email || "Desconocido";
}

export interface QueueNode {
  id: string;
  path: string[];
}

function toFileRecord(item: RawFolderItem, node: QueueNode): FileRecord {
  return {
    id: item.id,
    name: item.name,
    ext: extensionOf(item.name),
    size: item.size ?? 0,
    modifiedOn: item.modifiedOn,
    uploadedBy: userLabel(item.modifiedBy),
    folderPath: node.path.length > 0 ? node.path.join(" / ") : "Raíz",
    versionId: item.versionId ?? item.id,
    version: item.revision ?? 1,
  };
}

/** The resumable state of an in-progress (or finished) recursive folder walk. */
export interface CrawlState {
  project: ProjectMeta;
  baseUrl: string;
  queue: QueueNode[];
  files: FileRecord[];
  foldersVisited: number;
  done: boolean;
}

/** Resolves the project's region/base URL and root folder, and seeds the crawl queue. */
export async function startCrawl(accessToken: string, projectId: string): Promise<CrawlState> {
  const baseUrl = await resolveProjectBaseUrl(accessToken, projectId);
  const project = await getProjectDetails(baseUrl, accessToken, projectId);

  return {
    project: { id: project.id, name: project.name, createdOn: project.createdOn },
    baseUrl,
    queue: [{ id: project.rootId, path: [] }],
    files: [],
    foldersVisited: 0,
    done: false,
  };
}

/**
 * Advances a crawl using a worker-pool of CONCURRENCY folder listings kept
 * continuously busy (unlike fixed-size batching, a worker picks up the next
 * queued folder as soon as it finishes, rather than waiting for the whole
 * batch). Stops launching new work once `deadline` passes, but lets already
 * in-flight requests finish, so a single call never runs meaningfully longer
 * than the budget the caller gave it - this lets very large projects (thousands
 * of files) be crawled across several short, resumable calls instead of one
 * long request that risks a serverless function timeout.
 */
export async function advanceCrawl(
  state: CrawlState,
  accessToken: string,
  deadline: number
): Promise<void> {
  if (state.queue.length === 0) {
    state.done = true;
    return;
  }

  await new Promise<void>((resolve) => {
    let active = 0;
    let settled = false;

    function settle() {
      if (settled || active > 0) return;
      settled = true;
      state.done = state.queue.length === 0;
      resolve();
    }

    function launchNext() {
      if (settled) return;
      if (Date.now() >= deadline) {
        settle();
        return;
      }
      const node = state.queue.shift();
      if (!node) {
        settle();
        return;
      }
      active++;
      listFolderItems(state.baseUrl, accessToken, node.id)
        .then((items) => {
          state.foldersVisited++;
          for (const item of items) {
            if (item.type === "FOLDER") {
              state.queue.push({ id: item.id, path: [...node.path, item.name] });
            } else if (item.type === "FILE") {
              state.files.push(toFileRecord(item, node));
            }
          }
        })
        .catch(() => {
          // Skip folders we fail to read (permissions, transient errors)
          // rather than failing the whole crawl for one bad folder.
        })
        .finally(() => {
          active--;
          launchNext();
          settle();
        });
    }

    const starters = Math.min(CONCURRENCY, state.queue.length);
    for (let i = 0; i < starters; i++) launchNext();
  });
}
