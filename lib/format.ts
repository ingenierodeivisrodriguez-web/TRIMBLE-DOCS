export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("es", { year: "numeric", month: "short", day: "2-digit" });
}

export function extLabel(ext: string): string {
  if (ext === "sin-extension") return "Sin extension";
  return ext.toUpperCase();
}

// File types Trimble Connect treats as 3D models, which it opens in the 3D
// viewer instead of the 2D document viewer.
const THREE_D_EXTENSIONS = new Set([
  "rvt",
  "rfa",
  "rte",
  "ifc",
  "ifczip",
  "skp",
  "nwd",
  "nwc",
  "nwf",
  "dgn",
  "dwg",
  "dwf",
  "dwfx",
  "sat",
  "step",
  "stp",
  "iges",
  "igs",
  "obj",
  "fbx",
  "gltf",
  "glb",
  "e57",
]);

/**
 * Deep-links into the Trimble Connect web viewer for a specific file
 * version:
 * - 2D/other files: https://web.connect.trimble.com/projects/{id}/viewer/2D?id={fileId}&version={versionId}
 *   (confirmed against a real URL copied from the user's own Trimble Connect session)
 * - 3D model files: https://web.connect.trimble.com/projects/{id}/viewer/3d?modelId={fileId}&versionId={versionId}
 *   (per the "Query parameters" section of the Workspace API docs:
 *   https://components.connect.trimble.com/trimble-connect-workspace-api/index.html)
 */
export function buildFileViewerUrl(
  projectId: string,
  file: { id: string; ext: string; versionId: string }
): string {
  const encodedProjectId = encodeURIComponent(projectId);
  if (THREE_D_EXTENSIONS.has(file.ext)) {
    const params = new URLSearchParams({ modelId: file.id, versionId: file.versionId });
    return `https://web.connect.trimble.com/projects/${encodedProjectId}/viewer/3d?${params.toString()}`;
  }
  const params = new URLSearchParams({ id: file.id, version: file.versionId });
  return `https://web.connect.trimble.com/projects/${encodedProjectId}/viewer/2D?${params.toString()}`;
}
