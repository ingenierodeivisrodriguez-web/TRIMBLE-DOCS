import type { ModelSpec, ViewerAPI } from "trimble-connect-workspace-api";
import { GuidResolution, PropertySetLike, resolveIfcGuid } from "./ifcGuid";

/** The slice of the 3D Viewer API the panel uses (also lets it run against a fake viewer). */
export type PropiedadesViewer = Pick<ViewerAPI, "getSelection" | "getModels" | "getObjectProperties" | "convertToObjectIds">;

export interface SelectedElement {
  key: string;
  /** The model id as the viewer reports it in the selection. */
  viewerModelId: string;
  /** The model's file id when known: stable across versions, stored with the value. */
  fileId: string;
  modelName: string;
  runtimeId: number;
  /** Product name, or IFC class, for messages and diagnostics. */
  name: string;
  resolution: GuidResolution;
}

export interface SelectionRead {
  elements: SelectedElement[];
  /** How many selected objects were left out because the selection is too big. */
  skipped: number;
}

const CHUNK = 250;
export const MAX_SELECTION = 5000;

/**
 * External ids of objects. convertToObjectIds throws when *any* object has no
 * external id, so on failure each object is asked for separately and the ones
 * without one come back as null.
 */
async function externalIds(viewer: PropiedadesViewer, modelId: string, ids: number[]): Promise<(string | null)[]> {
  try {
    const out = await viewer.convertToObjectIds(modelId, ids);
    return ids.map((_, i) => (typeof out?.[i] === "string" && out[i] ? out[i] : null));
  } catch {
    return Promise.all(
      ids.map((id) =>
        viewer.convertToObjectIds(modelId, [id]).then(
          (r) => (typeof r?.[0] === "string" && r[0] ? r[0] : null),
          () => null
        )
      )
    );
  }
}

/** Reads the selected objects' properties and resolves each one's IFCGUID. */
export async function readSelection(
  viewer: PropiedadesViewer,
  selection: { modelId: string; objectRuntimeIds?: number[] }[],
  onProgress?: (done: number, total: number) => void
): Promise<SelectionRead> {
  const models: ModelSpec[] = (await viewer.getModels("loaded").catch(() => [])) ?? [];
  const groups = selection.filter((g) => g && g.modelId && (g.objectRuntimeIds ?? []).length > 0);
  const total = groups.reduce((sum, g) => sum + (g.objectRuntimeIds ?? []).length, 0);

  const elements: SelectedElement[] = [];
  let budget = MAX_SELECTION;
  let done = 0;
  for (const group of groups) {
    const spec = models.find((m) => m.id === group.modelId || m.versionId === group.modelId);
    const ids = (group.objectRuntimeIds ?? []).slice(0, Math.max(0, budget));
    budget -= ids.length;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const [props, extIds] = await Promise.all([
        viewer.getObjectProperties(group.modelId, chunk),
        externalIds(viewer, group.modelId, chunk),
      ]);
      const byId = new Map((props ?? []).map((p) => [p.id, p]));
      chunk.forEach((runtimeId, index) => {
        const p = byId.get(runtimeId);
        elements.push({
          key: `${group.modelId}:${runtimeId}`,
          viewerModelId: group.modelId,
          fileId: spec?.id ?? group.modelId,
          modelName: spec?.name ?? group.modelId,
          runtimeId,
          name: p?.product?.name || p?.class || `Objeto ${runtimeId}`,
          resolution: resolveIfcGuid(extIds[index], (p?.properties ?? []) as PropertySetLike[]),
        });
      });
      done += chunk.length;
      onProgress?.(done, Math.min(total, MAX_SELECTION));
    }
  }
  return { elements, skipped: Math.max(0, total - MAX_SELECTION) };
}
