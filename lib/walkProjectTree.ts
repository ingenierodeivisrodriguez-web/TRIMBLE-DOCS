import { getProjectDetails, listFolderItems, resolveProjectBaseUrl } from "./trimbleApi";
import { FileRecord, ProjectData } from "./types";

const CONCURRENCY = 5;

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

interface QueueNode {
  id: string;
  path: string[];
}

/**
 * Walks every folder and sub-folder of a project recursively (no depth limit)
 * and collects one record per file, using the file item's own `size`,
 * `modifiedOn` and `modifiedBy` fields as the metadata of its latest version
 * (the /folders/{id}/items endpoint already reflects the latest version for
 * these fields; a file keeps a single id across versions).
 */
export async function walkProjectTree(
  accessToken: string,
  projectId: string
): Promise<ProjectData> {
  const baseUrl = await resolveProjectBaseUrl(accessToken, projectId);
  const project = await getProjectDetails(baseUrl, accessToken, projectId);

  const files: FileRecord[] = [];
  const queue: QueueNode[] = [{ id: project.rootId, path: [] }];

  while (queue.length > 0) {
    const batch = queue.splice(0, CONCURRENCY);
    const results = await Promise.all(
      batch.map((node) => listFolderItems(baseUrl, accessToken, node.id))
    );

    results.forEach((items, i) => {
      const node = batch[i];
      for (const item of items) {
        if (item.type === "FOLDER") {
          queue.push({ id: item.id, path: [...node.path, item.name] });
        } else if (item.type === "FILE") {
          files.push({
            id: item.id,
            name: item.name,
            ext: extensionOf(item.name),
            size: item.size ?? 0,
            modifiedOn: item.modifiedOn,
            uploadedBy: userLabel(item.modifiedBy),
            folderPath: node.path.length > 0 ? node.path.join(" / ") : "Raíz",
            versionId: item.versionId ?? item.id,
            version: item.revision ?? 1,
          });
        }
      }
    });
  }

  return {
    project: {
      id: project.id,
      name: project.name,
      createdOn: project.createdOn,
    },
    files,
    fetchedAt: Date.now(),
  };
}
