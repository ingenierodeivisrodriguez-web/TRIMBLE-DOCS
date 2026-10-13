// Finding stored elements (IFCGUID + model file id) in the 3D viewer: their
// runtime ids in the models that are loaded now.
import type { ModelSpec, ViewerAPI } from "trimble-connect-workspace-api";
import { buildDataset, ModelDataset, RawObject } from "../graficos/modelData";
import type { CampoModelo } from "./types";
import { MAX_CAMPOS_MODELO } from "./types";
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

const MUESTRA = 2000;
const LOTE = 250;

/**
 * n ids picked at random (always the same ones for the same list): a regular
 * stride could line up with a repeating pattern of the model and skip a whole
 * class of elements.
 */
function repartidos(ids: number[], n: number): number[] {
  if (ids.length <= n) return ids;
  let semilla = 0x2f6e2b1;
  const azar = () => {
    semilla = (semilla + 0x6d2b79f5) | 0;
    let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const copia = [...ids];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(azar() * (copia.length - i));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia.slice(0, n).sort((x, y) => x - y);
}

/**
 * The properties found in the models loaded in the viewer, with how many of
 * the elements read carry each. Quick mode reads an evenly spread sample of
 * each model; complete mode reads every element. Returns null if cancelled.
 */
export async function leerCamposModelos(
  viewer: Visor,
  opciones: { completo: boolean; onProgress?: (texto: string) => void; cancelado?: () => boolean }
): Promise<{ modelos: string[]; campos: CampoModelo[] } | null> {
  const modelos: ModelSpec[] = ((await viewer.getModels("loaded").catch(() => [])) ?? []) as ModelSpec[];
  if (modelos.length === 0) throw new Error("No hay modelos cargados en el visor.");
  const acumulado = new Map<string, CampoModelo>();
  const nombres: string[] = [];
  for (const spec of modelos) {
    const nombre = spec.name ?? spec.id;
    nombres.push(nombre);
    opciones.onProgress?.(`Buscando los elementos de ${nombre}...`);
    const lista = await listModelObjects(viewer, spec);
    const ids = opciones.completo ? lista.runtimeIds : repartidos(lista.runtimeIds, MUESTRA);
    for (let i = 0; i < ids.length; i += LOTE) {
      if (opciones.cancelado?.()) return null;
      const raws = ((await viewer.getObjectProperties(lista.queryModelId, ids.slice(i, i + LOTE))) ?? []) as RawObject[];
      const ds = buildDataset(spec.id, nombre, raws);
      for (const [key, f] of ds.fields) {
        const previo = acumulado.get(key);
        const cuenta = ds.coverage.get(key) ?? 0;
        if (!previo) acumulado.set(key, { key, label: f.label, group: f.group, kind: f.kind, count: cuenta });
        else acumulado.set(key, { ...previo, kind: previo.kind === f.kind ? previo.kind : "text", count: previo.count + cuenta });
      }
      opciones.onProgress?.(`${nombre}: ${Math.min(i + LOTE, ids.length).toLocaleString("es")} de ${ids.length.toLocaleString("es")} elementos`);
    }
  }
  const campos = [...acumulado.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"))
    .slice(0, MAX_CAMPOS_MODELO);
  return { modelos: nombres, campos };
}

const esModelo = (m: { id: string; versionId?: string }, id: string) => m.id === id || m.versionId === id;

/**
 * Makes sure the models of these files are loaded in the viewer, loading (and
 * waiting for) the ones that aren't. Returns what it loaded (to unload
 * afterwards) and the files it couldn't find in the viewer's file tree.
 */
export async function prepararModelos(
  viewer: Visor,
  fileIds: string[],
  opciones: { onProgress?: (texto: string) => void; esperaMs?: number; intentos?: number } = {}
): Promise<{ cargados: string[]; noEncontrados: string[] }> {
  const espera = opciones.esperaMs ?? 1500;
  const intentos = opciones.intentos ?? 40;
  const cargados = ((await viewer.getModels("loaded").catch(() => [])) ?? []) as ModelSpec[];
  const faltan = [...new Set(fileIds)].filter((id) => !cargados.some((m) => esModelo(m, id)));
  if (faltan.length === 0) return { cargados: [], noEncontrados: [] };
  const descargados = ((await viewer.getModels("unloaded").catch(() => [])) ?? []) as ModelSpec[];
  const nuevos: ModelSpec[] = [];
  const noEncontrados: string[] = [];
  for (const id of faltan) {
    const spec = descargados.find((m) => esModelo(m, id));
    if (spec) nuevos.push(spec);
    else noEncontrados.push(id);
  }
  if (nuevos.length) {
    opciones.onProgress?.(`Cargando ${nuevos.map((m) => m.name ?? m.id).join(", ")}...`);
    await viewer.toggleModel(nuevos.map((m) => m.id), true, false);
  }
  const listos: string[] = [];
  for (const spec of nuevos) {
    let listo = false;
    for (let i = 0; i < intentos && !listo; i++) {
      const ahora = ((await viewer.getModels("loaded").catch(() => [])) ?? []) as ModelSpec[];
      const cargado = ahora.find((m) => esModelo(m, spec.id));
      if (cargado) listo = (await listModelObjects(viewer, cargado)).runtimeIds.length > 0;
      if (!listo && espera > 0) await new Promise((r) => setTimeout(r, espera));
    }
    if (listo) listos.push(spec.id);
    else noEncontrados.push(spec.id);
    opciones.onProgress?.(`${spec.name ?? spec.id}: ${listo ? "cargado" : "no terminó de cargar"}`);
  }
  // What was loaded but never became usable is unloaded again by the caller too.
  return { cargados: nuevos.map((m) => m.id), noEncontrados };
}

/** Unloads models that were loaded only to be read. */
export async function soltarModelos(viewer: Visor, ids: string[]): Promise<void> {
  if (ids.length) await viewer.toggleModel(ids, false).catch(() => {});
}
