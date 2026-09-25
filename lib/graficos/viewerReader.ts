import type { ModelSpec, ObjectSelector, ViewerAPI } from "trimble-connect-workspace-api";
import { Members, objectHasData, RawObject } from "./modelData";

/** The slice of the 3D Viewer API this extension uses (also lets the UI run against a fake viewer). */
export type ViewerLike = Pick<
  ViewerAPI,
  | "getModels"
  | "getObjects"
  | "getObjectProperties"
  | "toggleModel"
  | "setSelection"
  | "setObjectState"
  | "getSnapshot"
>;

/**
 * Turns the objects behind a bar / slice into a viewer selector. `viewerModelIds`
 * maps each dataset key to the model id the viewer answered with when the
 * objects were listed (see listModelObjects) - the id selections must use.
 */
export function selectorFor(members: Members, viewerModelIds: Record<string, string>): ObjectSelector {
  return {
    modelObjectIds: Object.entries(members)
      .filter(([datasetKey, ids]) => ids.length > 0 && viewerModelIds[datasetKey])
      .map(([datasetKey, ids]) => ({ modelId: viewerModelIds[datasetKey], objectRuntimeIds: ids })),
  };
}

// Objects per getObjectProperties call: large enough to keep the number of
// postMessage round-trips down, small enough to keep each reply responsive.
const CHUNK = 250;
const PROBE_SAMPLE = 40;

export interface ModelObjectList {
  /** The model id the viewer answered with - use it for getObjectProperties. */
  queryModelId: string;
  runtimeIds: number[];
}

/**
 * Lists every object of a loaded model. The viewer sometimes keys objects by
 * the model's id and sometimes by its file versionId ("modelId equals
 * File.versionId for models stored as files"), so each form is tried in turn,
 * falling back to an unfiltered query - the same order a published Trimble
 * Connect viewer extension settled on after testing on real projects.
 */
export async function listModelObjects(viewer: ViewerLike, model: ModelSpec): Promise<ModelObjectList> {
  const attempts: (ObjectSelector | undefined)[] = [
    { modelObjectIds: [{ modelId: model.id }] },
    { modelObjectIds: [{ modelId: model.id, recursive: true }] },
  ];
  if (model.versionId) {
    attempts.push(
      { modelObjectIds: [{ modelId: model.versionId }] },
      { modelObjectIds: [{ modelId: model.versionId, recursive: true }] }
    );
  }
  attempts.push(undefined);

  for (const selector of attempts) {
    let groups;
    try {
      groups = await viewer.getObjects(selector);
    } catch {
      continue;
    }
    let withObjects = (groups ?? []).filter((g) => g && (g.objects ?? []).length > 0);
    if (!selector) {
      withObjects = withObjects.filter((g) => g.modelId === model.id || g.modelId === model.versionId);
    }
    const runtimeIds = withObjects.flatMap((g) => g.objects.map((o) => o.id));
    if (runtimeIds.length > 0) {
      return { queryModelId: withObjects[0].modelId || model.id, runtimeIds };
    }
  }
  return { queryModelId: model.id, runtimeIds: [] };
}

/** Evenly spread sample, so a model's leading hierarchy nodes (file, level...) don't decide the result alone. */
function sample(ids: number[], size: number): number[] {
  if (ids.length <= size) return ids;
  const step = ids.length / size;
  return Array.from({ length: size }, (_, i) => ids[Math.floor(i * step)]);
}

/** Checks a small sample of the model's objects for property data. */
export async function modelHasData(viewer: ViewerLike, list: ModelObjectList): Promise<boolean> {
  if (list.runtimeIds.length === 0) return false;
  const props = (await viewer.getObjectProperties(
    list.queryModelId,
    sample(list.runtimeIds, PROBE_SAMPLE)
  )) as RawObject[];
  return (props ?? []).some(objectHasData);
}

/** Reads the properties of every object, in chunks, reporting progress after each one. */
export async function readAllProperties(
  viewer: ViewerLike,
  list: ModelObjectList,
  onProgress: (done: number, total: number) => void,
  isCancelled: () => boolean
): Promise<RawObject[] | null> {
  const out: RawObject[] = [];
  const total = list.runtimeIds.length;
  for (let i = 0; i < total; i += CHUNK) {
    if (isCancelled()) return null;
    const chunk = list.runtimeIds.slice(i, i + CHUNK);
    const props = (await viewer.getObjectProperties(list.queryModelId, chunk)) as RawObject[];
    out.push(...(props ?? []));
    onProgress(Math.min(i + chunk.length, total), total);
  }
  return out;
}
