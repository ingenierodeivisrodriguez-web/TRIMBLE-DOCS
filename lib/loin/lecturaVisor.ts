// Reading the loaded models in the 3D viewer (browser): every object of a
// model with its properties and IFCGUID, in batches, with progress and the
// option to cancel. It only reads: nothing is written in the models.
import type { ModelSpec, ViewerAPI } from "trimble-connect-workspace-api";
import type { RawObject } from "../graficos/modelData";
import { listModelObjects, readAllProperties, readObjectGuids, ViewerLike } from "../graficos/viewerReader";
import { resolveIfcGuid } from "../propiedades/ifcGuid";
import { ModeloLeido, objetoDesdeRaw } from "./clasificacion";

/** The slice of the 3D Viewer API the panel uses (also lets it run against a fake viewer). */
export type VisorLoin = Pick<ViewerAPI, "getModels" | "getObjects" | "getObjectProperties" | "convertToObjectIds" | "setSelection" | "setObjectState" | "getSelection">;

/** Every object of a model; null if cancelled. */
export async function leerModelo(
  viewer: VisorLoin,
  spec: ModelSpec,
  onProgress: (hechos: number, total: number) => void,
  cancelado: () => boolean
): Promise<ModeloLeido | null> {
  const lector = viewer as unknown as ViewerLike;
  const lista = await listModelObjects(lector, spec);
  const raws = (await readAllProperties(lector, lista, onProgress, cancelado)) as RawObject[] | null;
  if (!raws) return null;
  // IFC models: the external id is the GUID; only asked for objects without a GUID property.
  const sinGuid = raws.filter((o) => !resolveIfcGuid(null, o.properties ?? []).guid).map((o) => o.id);
  const externos = sinGuid.length && !cancelado() ? await readObjectGuids(lector, lista.queryModelId, sinGuid).catch(() => new Map<number, string>()) : new Map<number, string>();
  if (cancelado()) return null;
  return {
    fileId: spec.id,
    nombre: spec.name ?? spec.id,
    viewerModelId: lista.queryModelId,
    objetos: raws.map((o) => objetoDesdeRaw(o, externos.get(o.id) ?? null)),
  };
}

/** Objects per viewer model, as setSelection / setObjectState take them. */
export function selectorDe(porModelo: Map<string, number[]>) {
  return { modelObjectIds: [...porModelo].filter(([, ids]) => ids.length).map(([modelId, objectRuntimeIds]) => ({ modelId, objectRuntimeIds })) };
}
