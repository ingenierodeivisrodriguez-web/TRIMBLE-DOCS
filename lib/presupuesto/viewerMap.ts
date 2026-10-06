// Finding stored elements (IFCGUID + model file id) in the 3D viewer: their
// runtime ids in the models that are loaded now.
import type { ModelSpec, ViewerAPI } from "trimble-connect-workspace-api";
import { buildDataset, ModelDataset, RawObject } from "../graficos/modelData";
import { listModelObjects, readAllProperties, readObjectGuids } from "../graficos/viewerReader";
import { ifcGuidToUuid, normalizeGuid, resolveIfcGuid } from "../propiedades/ifcGuid";

export type Visor = ViewerAPI;

export interface Ubicados {
  /** Runtime ids per viewer model id, ready for setSelection / setObjectState. */
  porModelo: Map<string, number[]>;
  /** IFCGUID -> where it is. */
  ubicacion: Map<string, { viewerModelId: string; runtimeId: number }>;
  encontrados: number;
  /** In a loaded model but not found in it. */
  noEncontrados: number;
  /** In models that aren't loaded. */
  sinModelo: number;
}

const CHUNK = 500;

/**
 * Remembers where each IFCGUID is in each loaded model, learning it from the
 * selections read and, when needed, converting or scanning the model.
 */
export class MapaGuids {
  private guids = new Map<string, Map<string, number>>(); // file id -> guid -> runtimeId
  /** The model id the viewer answers with for each file (its id or its version id). */
  private alias = new Map<string, string>();
  private escaneados = new Set<string>(); // "ext:" / "prop:" + file id

  /** Learns where an element is (from a selection: `viewerModelId` is the id the viewer used). */
  recordar(fileId: string, viewerModelId: string, guid: string, runtimeId: number) {
    this.de(fileId).set(guid, runtimeId);
    if (!this.alias.has(fileId)) this.alias.set(fileId, viewerModelId);
  }

  private de(fileId: string): Map<string, number> {
    let m = this.guids.get(fileId);
    if (!m) this.guids.set(fileId, (m = new Map()));
    return m;
  }

  async ubicar(
    viewer: Visor,
    elementos: { ifcGuid: string; modelId: string }[],
    onProgress?: (texto: string) => void
  ): Promise<Ubicados> {
    const models: ModelSpec[] = ((await viewer.getModels("loaded").catch(() => [])) ?? []) as ModelSpec[];
    const porArchivo = new Map<string, string[]>();
    for (const e of elementos) {
      const list = porArchivo.get(e.modelId) ?? [];
      list.push(e.ifcGuid);
      porArchivo.set(e.modelId, list);
    }
    const out: Ubicados = { porModelo: new Map(), ubicacion: new Map(), encontrados: 0, noEncontrados: 0, sinModelo: 0 };

    for (const [fileId, guids] of porArchivo) {
      const spec = models.find((m) => m.id === fileId || m.versionId === fileId);
      if (!spec) {
        out.sinModelo += guids.length;
        continue;
      }
      const known = this.de(spec.id);
      let pending = guids.filter((g) => !known.has(g));

      // 1. IFC models: the external id is the GUID, uncompressed.
      if (pending.length) {
        for (const modelId of [spec.id, spec.versionId].filter((x): x is string => !!x)) {
          for (let i = 0; i < pending.length; i += CHUNK) {
            const chunk = pending.slice(i, i + CHUNK);
            const ids = await viewer.convertToObjectRuntimeIds(modelId, chunk.map((g) => ifcGuidToUuid(g) ?? g)).catch(() => [] as number[]);
            chunk.forEach((g, k) => {
              const rt = ids?.[k];
              if (typeof rt !== "number") return;
              known.set(g, rt);
              if (!this.alias.has(spec.id)) this.alias.set(spec.id, modelId);
            });
          }
          pending = pending.filter((g) => !known.has(g));
          if (!pending.length) break;
        }
      }

      // 2. Every object's external id, normalized (other GUID spellings).
      if (pending.length && !this.escaneados.has(`ext:${spec.id}`)) {
        this.escaneados.add(`ext:${spec.id}`);
        onProgress?.(`Buscando los elementos en ${spec.name ?? "el modelo"}...`);
        const list = await listModelObjects(viewer, spec);
        if (!this.alias.has(spec.id) && list.runtimeIds.length) this.alias.set(spec.id, list.queryModelId);
        const ext = await readObjectGuids(viewer, list.queryModelId, list.runtimeIds).catch(() => new Map<number, string>());
        for (const [rt, raw] of ext) {
          const g = normalizeGuid(raw);
          if (g && !known.has(g)) known.set(g, rt);
        }
        pending = pending.filter((g) => !known.has(g));
      }

      // 3. A GUID property (e.g. Revit's IfcGUID): read the model's properties once.
      if (pending.length && !this.escaneados.has(`prop:${spec.id}`)) {
        this.escaneados.add(`prop:${spec.id}`);
        const list = await listModelObjects(viewer, spec);
        const raws = await readAllProperties(
          viewer,
          list,
          (done, total) => onProgress?.(`Leyendo propiedades de ${spec.name ?? "el modelo"}: ${Math.round((done / Math.max(total, 1)) * 100)} %`),
          () => false
        );
        for (const o of (raws ?? []) as RawObject[]) {
          const g = resolveIfcGuid(null, o.properties ?? []).guid;
          if (g && !known.has(g)) known.set(g, o.id);
        }
        pending = pending.filter((g) => !known.has(g));
      }

      const viewerModelId = this.alias.get(spec.id) ?? spec.id;
      for (const g of guids) {
        const rt = known.get(g);
        if (rt === undefined) continue;
        out.ubicacion.set(g, { viewerModelId, runtimeId: rt });
        const list = out.porModelo.get(viewerModelId) ?? [];
        list.push(rt);
        out.porModelo.set(viewerModelId, list);
        out.encontrados++;
      }
      out.noEncontrados += pending.length;
    }
    return out;
  }
}

/** The properties of some objects of a model, as a dataset (to measure them). */
export async function leerDataset(viewer: Visor, viewerModelId: string, nombre: string, runtimeIds: number[]): Promise<ModelDataset> {
  const raws: RawObject[] = [];
  for (let i = 0; i < runtimeIds.length; i += 250) {
    raws.push(...(((await viewer.getObjectProperties(viewerModelId, runtimeIds.slice(i, i + 250))) ?? []) as RawObject[]));
  }
  return buildDataset(viewerModelId, nombre, raws);
}

export function selector(porModelo: Map<string, number[]>) {
  return { modelObjectIds: [...porModelo].filter(([, ids]) => ids.length).map(([modelId, objectRuntimeIds]) => ({ modelId, objectRuntimeIds })) };
}
