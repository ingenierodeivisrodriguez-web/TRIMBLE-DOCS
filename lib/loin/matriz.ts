// The LOIN matrix: for every element to model and every stage (milestone),
// the geometric level (LOD), the information level (NDI, cumulative), the
// purpose and who delivers it. Rows are grouped by discipline; filling many
// cells at once never overwrites a cell that already says something else
// unless the person chooses to.
import { plegar } from "../presupuesto/format";
import { exigidosHasta } from "./ndi";
import type { ConVersion } from "./store";
import { CeldaData, CeldaMatriz, Disciplina, Elemento, Etapa, Lod, LODS, Ndi, Parametro, Requerimiento } from "./types";

export const SIN_REQUERIMIENTO: Requerimiento = { lod: null, ndi: null, propositos: [], actor: "", nota: "" };

/**
 * A short summary in our own words of the BIMForum convention (its full
 * definitions are copyrighted by the AIA, G202-2013; LOD 350 is BIMForum's).
 */
export const DESCRIPCION_LOD: Record<Lod, string> = {
  100: "Conceptual: un símbolo o volumen genérico; tamaño, forma y ubicación aproximados.",
  200: "Genérico: sistema u objeto con tamaño, forma, ubicación y orientación aproximados.",
  300: "Específico: tamaño, forma, ubicación y orientación que se pueden medir en el modelo.",
  350: "Coordinación: como 300, más las interfaces con otros sistemas (apoyos, conexiones, pases).",
  400: "Fabricación: con el detalle necesario para fabricar e instalar.",
  500: "Verificado en obra: lo construido, comprobado en campo (as-built).",
};

/**
 * One blue, light to dark (an ordered scale: the darker, the more detail).
 * The lightest step still separates from the white page; text turns white on the dark steps.
 */
export const COLOR_LOD: Record<Lod, { fondo: string; texto: string }> = {
  100: { fondo: "#86b6ef", texto: "#0b0b0b" },
  200: { fondo: "#5598e7", texto: "#0b0b0b" },
  300: { fondo: "#2a78d6", texto: "#ffffff" },
  350: { fondo: "#1c5cab", texto: "#ffffff" },
  400: { fondo: "#104281", texto: "#ffffff" },
  500: { fondo: "#0d366b", texto: "#ffffff" },
};
/** A cell with an information level but no geometric one. */
export const COLOR_SOLO_NDI = { fondo: "#e3e7ec", texto: "#0b0b0b" };

export const PROPOSITOS_SUGERIDOS = [
  "Coordinación",
  "Cantidades",
  "Licencia",
  "Construcción",
  "Programación 4D",
  "Costos 5D",
  "Visualización",
  "Análisis y simulación",
  "Operación y mantenimiento",
];

export const ETAPAS_SUGERIDAS: { codigo: string; nombre: string }[] = [
  { codigo: "ANT", nombre: "Anteproyecto" },
  { codigo: "PRO", nombre: "Proyecto / diseño de detalle" },
  { codigo: "LIC", nombre: "Licencia" },
  { codigo: "CON", nombre: "Construcción" },
  { codigo: "ASB", nombre: "As-built / entrega a operación" },
];

export const esLod = (v: unknown): v is Lod => LODS.includes(v as Lod);

export const clave = (elementoId: string, etapaId: string) => `${elementoId}|${etapaId}`;

export function indiceCeldas(celdas: CeldaMatriz[]): Map<string, CeldaMatriz> {
  return new Map(celdas.map((c) => [clave(c.elementoId, c.etapaId), c]));
}

/** Whether a cell requires anything (a geometric or an information level). */
export const exigeAlgo = (r: Pick<Requerimiento, "lod" | "ndi"> | null | undefined) => !!r && (r.lod !== null || r.ndi !== null);

/** "LOD 300 · NDI-2", "LOD 300", "NDI-2" or "". */
export function textoCelda(r: Pick<Requerimiento, "lod" | "ndi"> | null | undefined): string {
  if (!r) return "";
  return [r.lod !== null ? `LOD ${r.lod}` : "", r.ndi !== null ? `NDI-${r.ndi}` : ""].filter(Boolean).join(" · ");
}

export function colorCelda(r: Pick<Requerimiento, "lod" | "ndi"> | null | undefined): { fondo: string; texto: string } | null {
  if (!exigeAlgo(r)) return null;
  return r!.lod !== null ? COLOR_LOD[r!.lod] : COLOR_SOLO_NDI;
}

function mismoRequerimiento(a: Requerimiento, b: Requerimiento): boolean {
  const lista = (x: string[]) => x.map((p) => plegar(p.trim())).sort().join("|");
  return a.lod === b.lod && a.ndi === b.ndi && lista(a.propositos) === lista(b.propositos) && a.actor.trim() === b.actor.trim() && a.nota.trim() === b.nota.trim();
}

/** Stages in their order (then by date and code); inactive ones only when asked. */
export function etapasOrdenadas(etapas: Etapa[], conInactivas = false): Etapa[] {
  return etapas
    .filter((e) => conInactivas || e.activo)
    .sort((a, b) => a.orden - b.orden || (a.fecha ?? "9999").localeCompare(b.fecha ?? "9999") || a.codigo.localeCompare(b.codigo));
}

// ---------------------------------------------------------------- filling many cells

export interface PlanAplicar {
  /** The cells to save (new ones with version 0). */
  guardar: ConVersion<CeldaData>[];
  nuevas: number;
  /** Cells that already require something else (only saved with `sobrescribir`). */
  distintas: number;
  iguales: number;
}

/**
 * What giving `valores` to several cells would do. An empty or missing cell
 * is filled; one with the same values is left alone; one that already
 * requires something different is only changed with `sobrescribir`.
 */
export function planAplicar(
  destinos: { elementoId: string; etapaId: string; valores: Requerimiento }[],
  celdas: Map<string, CeldaMatriz>,
  sobrescribir: boolean,
  nuevoId: () => string
): PlanAplicar {
  const plan: PlanAplicar = { guardar: [], nuevas: 0, distintas: 0, iguales: 0 };
  for (const d of destinos) {
    const actual = celdas.get(clave(d.elementoId, d.etapaId));
    if (actual && mismoRequerimiento(actual, d.valores)) {
      plan.iguales++;
      continue;
    }
    const fila = { elementoId: d.elementoId, etapaId: d.etapaId, ...structuredClone(d.valores) };
    if (!actual) {
      plan.nuevas++;
      plan.guardar.push({ ...fila, id: nuevoId(), version: 0 });
    } else if (!exigeAlgo(actual)) {
      plan.nuevas++;
      plan.guardar.push({ ...fila, id: actual.id, version: actual.version });
    } else {
      plan.distintas++;
      if (sobrescribir) plan.guardar.push({ ...fila, id: actual.id, version: actual.version });
    }
  }
  return plan;
}

/** The same values for every element of a discipline at one stage. */
export function planDisciplina(
  elementos: Elemento[],
  disciplinaId: string,
  etapaId: string,
  valores: Requerimiento,
  celdas: Map<string, CeldaMatriz>,
  sobrescribir: boolean,
  nuevoId: () => string
): PlanAplicar {
  const destinos = elementos.filter((e) => e.activo && e.disciplinaId === disciplinaId).map((e) => ({ elementoId: e.id, etapaId, valores }));
  return planAplicar(destinos, celdas, sobrescribir, nuevoId);
}

/** Each element takes, at `hacia`, what it requires at `desde` (cells without requirement there are skipped). */
export function planCopiarEtapa(
  elementos: Elemento[],
  desde: string,
  hacia: string,
  celdas: Map<string, CeldaMatriz>,
  sobrescribir: boolean,
  nuevoId: () => string,
  disciplinaId: string | null = null
): PlanAplicar {
  const destinos = elementos
    .filter((e) => e.activo && (!disciplinaId || e.disciplinaId === disciplinaId))
    .flatMap((e) => {
      const origen = celdas.get(clave(e.id, desde));
      if (!exigeAlgo(origen)) return [];
      const { lod, ndi, propositos, actor, nota } = origen!;
      return [{ elementoId: e.id, etapaId: hacia, valores: { lod, ndi, propositos, actor, nota } }];
    });
  return planAplicar(destinos, celdas, sobrescribir, nuevoId);
}

// ---------------------------------------------------------------- warnings and counts

/** How many parameters an element must carry at an information level. */
export function parametrosExigidos(elemento: Elemento, ndi: Ndi | null, catalogo: Map<string, Parametro>): { obligatorios: number; opcionales: number } {
  if (ndi === null) return { obligatorios: 0, opcionales: 0 };
  const exigidos = exigidosHasta(elemento.parametros, catalogo, ndi);
  const obligatorios = exigidos.filter((e) => e.obligatorio).length;
  return { obligatorios, opcionales: exigidos.length - obligatorios };
}

/**
 * Things worth a second look in an element's row, by stage: a level lower
 * than in an earlier stage, or an information level with no parameters to
 * require.
 */
export function avisosElemento(elemento: Elemento, etapas: Etapa[], celdas: Map<string, CeldaMatriz>, catalogo: Map<string, Parametro>): Map<string, string[]> {
  const avisos = new Map<string, string[]>();
  const agregar = (etapaId: string, texto: string) => avisos.set(etapaId, [...(avisos.get(etapaId) ?? []), texto]);
  let maxLod: { lod: Lod; etapa: Etapa } | null = null;
  let maxNdi: { ndi: Ndi; etapa: Etapa } | null = null;
  for (const etapa of etapas) {
    const c = celdas.get(clave(elemento.id, etapa.id));
    if (!exigeAlgo(c)) continue;
    if (c!.lod !== null) {
      if (maxLod && c!.lod < maxLod.lod) agregar(etapa.id, `El LOD baja: en ${maxLod.etapa.nombre} se pide LOD ${maxLod.lod}.`);
      if (!maxLod || c!.lod > maxLod.lod) maxLod = { lod: c!.lod, etapa };
    }
    if (c!.ndi !== null) {
      if (maxNdi && c!.ndi < maxNdi.ndi) agregar(etapa.id, `El NDI baja: en ${maxNdi.etapa.nombre} se pide NDI-${maxNdi.ndi}.`);
      if (!maxNdi || c!.ndi > maxNdi.ndi) maxNdi = { ndi: c!.ndi, etapa };
      const { obligatorios, opcionales } = parametrosExigidos(elemento, c!.ndi, catalogo);
      if (obligatorios + opcionales === 0) agregar(etapa.id, `Pide NDI-${c!.ndi}, pero el elemento no tiene parámetros exigidos de ese nivel o menor.`);
    }
  }
  return avisos;
}

// ---------------------------------------------------------------- the table

export interface GrupoMatriz {
  disciplina: Disciplina;
  elementos: Elemento[];
}

/** Active disciplines and their active elements, in order, as the matrix shows them. */
export function gruposMatriz(disciplinas: Disciplina[], elementos: Elemento[], disciplinaId: string | null = null): GrupoMatriz[] {
  return disciplinas
    .filter((d) => d.activo && (!disciplinaId || d.id === disciplinaId))
    .sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo))
    .map((disciplina) => ({
      disciplina,
      elementos: elementos.filter((e) => e.activo && e.disciplinaId === disciplina.id).sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo)),
    }))
    .filter((g) => g.elementos.length > 0);
}

/** "2026-10-21" -> "21-10-2026". */
export function fechaCorta(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}
