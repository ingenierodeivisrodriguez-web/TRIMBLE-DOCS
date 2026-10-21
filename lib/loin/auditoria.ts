// The compliance audit of a stage: for every object linked to an element to
// model (by hand or by rule), each parameter the element requires at the
// stage's NDI is checked for presence (its aliases), content (not empty nor
// a garbage value), its value rule (type, range, list, pattern) and origin
// (an automatic one that is missing is a modeling problem, not missing data).
// A failure the coordinator accepted (an exception) counts as met. Pure: it
// runs on objects already read from the viewer, so it can be tested without
// Trimble Connect.
import { buscarValor } from "./alias";
import { claveObjeto, ModeloLeido, ObjetoModelo, ResultadoClasificacion } from "./clasificacion";
import { clave } from "./matriz";
import { Exigencia, exigidosHasta } from "./ndi";
import { revisarValor } from "./reglas";
import {
  CeldaMatriz,
  Disciplina,
  Elemento,
  EstadoObjeto,
  Etapa,
  InformeAuditoria,
  LoteAuditoria,
  MAX_OBJETOS_POR_LOTE,
  MotivoFalla,
  Ndi,
  ObjetoInforme,
  Parametro,
  ResumenAuditoria,
  Totales,
} from "./types";

/** Status colors (fixed, never a discipline's), always shown with their icon and name. */
export const ESTADOS: Record<EstadoObjeto | "sin_clasificar", { color: string; icono: string; nombre: string }> = {
  cumple: { color: "#0ca30c", icono: "✓", nombre: "Cumple" },
  parcial: { color: "#fab219", icono: "◐", nombre: "Cumple parcial" },
  no_cumple: { color: "#d03b3b", icono: "✗", nombre: "No cumple" },
  sin_clasificar: { color: "#a3a8ae", icono: "?", nombre: "Sin clasificar" },
};

export const MOTIVOS_FALLA: Record<MotivoFalla | "aceptado", string> = {
  falta: "No existe en el objeto",
  modelado: "Problema de modelado",
  sin_llenar: "Sin llenar",
  valor: "Valor incorrecto",
  aceptado: "Aceptado (excepción)",
};

export interface RevisionParametro {
  parametroId: string;
  codigo: string;
  nombre: string;
  obligatorio: boolean;
  ndi: Ndi;
  estado: "ok" | "aceptado" | MotivoFalla;
  detalle: string;
  /** The value found (as text) and where. */
  valor: string;
  ruta: string;
}

/** An audited object with everything the viewer panel shows when it is clicked. */
export interface ObjetoAuditado {
  fileId: string;
  viewerModelId: string;
  runtimeId: number;
  ifcGuid: string | null;
  nombre: string;
  elementoId: string;
  exigidos: number;
  cumplidos: number;
  pct: number;
  estado: EstadoObjeto;
  revisiones: RevisionParametro[];
}

export interface EntradaAuditoria {
  proyecto: string;
  etapa: Etapa;
  modelos: ModeloLeido[];
  /** Trimble Connect version of each model file read. */
  versiones: Map<string, string | null>;
  clasificacion: ResultadoClasificacion;
  disciplinas: Disciplina[];
  elementos: Elemento[];
  catalogo: Map<string, Parametro>;
  celdas: Map<string, CeldaMatriz>;
  valoresBasura: string[];
  umbralAmarillo: number;
  /** Accepted failures: "IFCGUID|parametroId" of this stage. */
  excepciones: Set<string>;
  /** Only these disciplines (null: all). */
  disciplinaIds: Set<string> | null;
}

export interface Auditado {
  informe: InformeAuditoria;
  /** By "fileId:runtimeId". */
  detalle: Map<string, ObjetoAuditado>;
}

const cero = (): Totales => ({ objetos: 0, cumple: 0, parcial: 0, noCumple: 0, exigidos: 0, cumplidos: 0, pct: 100 });
const motivosCero = (): Record<MotivoFalla, number> => ({ falta: 0, modelado: 0, sin_llenar: 0, valor: 0 });
export const redondear1 = (x: number) => Math.round(x * 10) / 10;

export function porcentaje(cumplidos: number, exigidos: number): number {
  return exigidos === 0 ? 100 : redondear1((cumplidos / exigidos) * 100);
}

export function estadoDe(pct: number, umbral: number): EstadoObjeto {
  return pct >= 100 ? "cumple" : pct >= umbral ? "parcial" : "no_cumple";
}

function sumar(t: Totales, o: { exigidos: number; cumplidos: number; estado: EstadoObjeto }) {
  t.objetos++;
  t.exigidos += o.exigidos;
  t.cumplidos += o.cumplidos;
  if (o.estado === "cumple") t.cumple++;
  else if (o.estado === "parcial") t.parcial++;
  else t.noCumple++;
  t.pct = porcentaje(t.cumplidos, t.exigidos);
}

/** One required parameter in one object. */
export function revisarParametro(o: ObjetoModelo, x: Exigencia, basura: string[], excepciones: Set<string>): RevisionParametro {
  const p = x.parametro;
  const h = buscarValor(o.props, p.alias);
  const automatico = p.origen === "automatica";
  let estado: RevisionParametro["estado"];
  let detalle = "";
  if (!h) {
    estado = automatico ? "modelado" : "falta";
    detalle = automatico
      ? "Es un dato automático (geometría o software) y el objeto no lo tiene: revisar cómo se modeló o exportó."
      : "El objeto no tiene este parámetro en ninguna de sus equivalencias de lectura.";
  } else {
    const r = revisarValor({ tipoDato: p.tipoDato, valoresPermitidos: p.valoresPermitidos, unidad: p.unidad }, x.regla, h.valor, basura);
    if (r.ok) estado = "ok";
    else {
      estado = r.motivo === "vacio" || r.motivo === "basura" ? (automatico ? "modelado" : "sin_llenar") : "valor";
      detalle = r.detalle;
    }
  }
  if (estado !== "ok" && o.ifcGuid && excepciones.has(`${o.ifcGuid}|${p.id}`)) estado = "aceptado";
  return {
    parametroId: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    obligatorio: x.obligatorio,
    ndi: x.ndi,
    estado,
    detalle,
    valor: h && h.valor !== null && h.valor !== undefined ? String(h.valor) : "",
    ruta: h?.ruta ?? "",
  };
}

export function auditar(e: EntradaAuditoria): Auditado {
  const umbral = e.umbralAmarillo;
  const elementos = new Map(e.elementos.filter((x) => x.activo).map((x) => [x.id, x]));
  const disciplinas = e.disciplinas.filter((d) => d.activo && (!e.disciplinaIds || e.disciplinaIds.has(d.id))).sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo));
  const enAlcance = new Set(disciplinas.map((d) => d.id));
  const modelos = new Map(e.modelos.map((m) => [m.fileId, m]));
  const ndiDe = (el: Elemento) => e.celdas.get(clave(el.id, e.etapa.id))?.ndi ?? null;

  const detalle = new Map<string, ObjetoAuditado>();
  const objetos: ObjetoInforme[] = [];
  const porElemento = new Map<string, Totales>();
  const porDisciplina = new Map<string, Totales>();
  const total = cero();
  const parametros: Record<string, string> = {};
  const fallasPorCodigo = new Map<string, { codigo: string; nombre: string; fallas: number; porMotivo: Record<MotivoFalla, number> }>();
  const porMotivo = motivosCero();
  let aceptados = 0;
  let sinExigencia = 0;
  let sinGuid = 0;

  for (const m of e.modelos) {
    for (const o of m.objetos) {
      const c = e.clasificacion.porObjeto.get(claveObjeto(m.fileId, o.runtimeId));
      const el = c ? elementos.get(c.elementoId) : undefined;
      if (!el || !enAlcance.has(el.disciplinaId)) continue;
      const ndi = ndiDe(el);
      if (ndi === null) {
        sinExigencia++;
        continue;
      }
      const revisiones = exigidosHasta(el.parametros, e.catalogo, ndi).map((x) => revisarParametro(o, x, e.valoresBasura, e.excepciones));
      const obligatorias = revisiones.filter((r) => r.obligatorio);
      const exigidos = obligatorias.length;
      const cumplidos = obligatorias.filter((r) => r.estado === "ok" || r.estado === "aceptado").length;
      const pct = porcentaje(cumplidos, exigidos);
      const estado = estadoDe(pct, umbral);
      if (!o.ifcGuid) sinGuid++;
      detalle.set(claveObjeto(m.fileId, o.runtimeId), {
        fileId: m.fileId,
        viewerModelId: m.viewerModelId,
        runtimeId: o.runtimeId,
        ifcGuid: o.ifcGuid,
        nombre: o.nombre || o.tipo || o.clase,
        elementoId: el.id,
        exigidos,
        cumplidos,
        pct,
        estado,
        revisiones,
      });
      const fallas = revisiones.filter((r) => r.estado !== "ok").map((r) => ({ codigo: r.codigo, motivo: r.estado as MotivoFalla | "aceptado", obligatorio: r.obligatorio }));
      objetos.push({ elementoId: el.id, ifcGuid: o.ifcGuid ?? "", nombre: o.nombre || o.tipo || o.clase, modelo: m.nombre, exigidos, cumplidos, pct, estado, fallas });
      for (const r of revisiones) {
        parametros[r.codigo] = r.nombre;
        if (r.estado === "aceptado") aceptados++;
        if (!r.obligatorio || r.estado === "ok" || r.estado === "aceptado") continue;
        porMotivo[r.estado]++;
        const f = fallasPorCodigo.get(r.codigo) ?? { codigo: r.codigo, nombre: r.nombre, fallas: 0, porMotivo: motivosCero() };
        f.fallas++;
        f.porMotivo[r.estado]++;
        fallasPorCodigo.set(r.codigo, f);
      }
      const t = { exigidos, cumplidos, estado };
      for (const [mapa, k] of [
        [porElemento, el.id],
        [porDisciplina, el.disciplinaId],
      ] as const) {
        const acc = mapa.get(k) ?? cero();
        sumar(acc, t);
        mapa.set(k, acc);
      }
      sumar(total, t);
    }
  }

  // What the stage requires (the configuration used), even for elements without objects.
  const requeridos = [...elementos.values()]
    .filter((el) => enAlcance.has(el.disciplinaId) && ndiDe(el) !== null)
    .sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo));
  const resumenElementos = requeridos.map((el) => {
    const ndi = ndiDe(el)!;
    const exigencias = exigidosHasta(el.parametros, e.catalogo, ndi);
    for (const x of exigencias) parametros[x.parametro.codigo] = x.parametro.nombre;
    return {
      id: el.id,
      codigo: el.codigo,
      nombre: el.nombre,
      disciplinaId: el.disciplinaId,
      ndi,
      lod: e.celdas.get(clave(el.id, e.etapa.id))?.lod ?? null,
      totales: porElemento.get(el.id) ?? cero(),
      exigidos: exigencias.map((x) => ({ codigo: x.parametro.codigo, obligatorio: x.obligatorio })),
    };
  });

  const sinClasificar = e.clasificacion.sinClasificar.filter((s) => modelos.has(s.fileId));
  const informe: InformeAuditoria = {
    proyecto: e.proyecto,
    etapa: { id: e.etapa.id, codigo: e.etapa.codigo, nombre: e.etapa.nombre, fecha: e.etapa.fecha },
    modelos: e.modelos.map((m) => ({ fileId: m.fileId, nombre: m.nombre, versionId: e.versiones.get(m.fileId) ?? null })),
    umbralAmarillo: umbral,
    valoresBasura: e.valoresBasura,
    disciplinas: disciplinas
      .filter((d) => requeridos.some((el) => el.disciplinaId === d.id))
      .map((d) => ({ id: d.id, codigo: d.codigo, nombre: d.nombre, color: d.color, totales: porDisciplina.get(d.id) ?? cero() })),
    elementos: resumenElementos,
    total,
    parametros,
    masIncumplidos: [...fallasPorCodigo.values()].sort((a, b) => b.fallas - a.fallas || a.codigo.localeCompare(b.codigo)).slice(0, 20),
    porMotivo,
    aceptados,
    sinClasificar: sinClasificar.length,
    sinExigencia,
    sinGuid,
    elementosSinObjetos: resumenElementos.filter((x) => x.totales.objetos === 0).map((x) => `${x.codigo} · ${x.nombre}`),
    objetos,
    objetosSinClasificar: sinClasificar.map((s) => ({
      ifcGuid: s.objeto.ifcGuid ?? "",
      nombre: s.objeto.nombre,
      clase: s.objeto.clase,
      tipo: s.objeto.tipo,
      modelo: modelos.get(s.fileId)?.nombre ?? s.fileId,
    })),
  };
  return { informe, detalle };
}

// ---------------------------------------------------------------- saving and reading back

type FilaObjeto = [string, string, string, number, number, [string, string, number][]];
type FilaSinClasificar = [string, string, string, string, string];

/** The header and the objects in slices (each slice one element, at most `porLote` objects) to save. */
export function aGuardar(informe: InformeAuditoria, porLote = MAX_OBJETOS_POR_LOTE): { resumen: ResumenAuditoria; lotes: LoteAuditoria[] } {
  const { objetos, objetosSinClasificar, ...resumen } = informe;
  const lotes: LoteAuditoria[] = [];
  const porElemento = new Map<string, ObjetoInforme[]>();
  for (const o of objetos) porElemento.set(o.elementoId, [...(porElemento.get(o.elementoId) ?? []), o]);
  for (const [elementoId, lista] of porElemento) {
    for (let i = 0; i < lista.length; i += porLote) {
      lotes.push({
        parte: lotes.length + 1,
        elementoId,
        objetos: lista.slice(i, i + porLote).map((o): FilaObjeto => [o.ifcGuid, o.nombre, o.modelo, o.exigidos, o.cumplidos, o.fallas.map((f) => [f.codigo, f.motivo, f.obligatorio ? 1 : 0])]),
      });
    }
  }
  for (let i = 0; i < objetosSinClasificar.length; i += porLote) {
    lotes.push({ parte: lotes.length + 1, elementoId: null, objetos: objetosSinClasificar.slice(i, i + porLote).map((s): FilaSinClasificar => [s.ifcGuid, s.nombre, s.clase, s.tipo, s.modelo]) });
  }
  return { resumen, lotes };
}

/** A saved audit back as a report (the states come from the counts and the threshold saved with it). */
export function desdeGuardado(resumen: ResumenAuditoria, lotes: LoteAuditoria[]): InformeAuditoria {
  const objetos: ObjetoInforme[] = [];
  const objetosSinClasificar: InformeAuditoria["objetosSinClasificar"] = [];
  for (const l of [...lotes].sort((a, b) => a.parte - b.parte)) {
    if (l.elementoId === null) {
      for (const f of l.objetos as FilaSinClasificar[]) objetosSinClasificar.push({ ifcGuid: f[0], nombre: f[1], clase: f[2], tipo: f[3], modelo: f[4] });
      continue;
    }
    for (const f of l.objetos as FilaObjeto[]) {
      const pct = porcentaje(f[4], f[3]);
      objetos.push({
        elementoId: l.elementoId,
        ifcGuid: f[0],
        nombre: f[1],
        modelo: f[2],
        exigidos: f[3],
        cumplidos: f[4],
        pct,
        estado: estadoDe(pct, resumen.umbralAmarillo),
        fallas: f[5].map(([codigo, motivo, obligatorio]) => ({ codigo, motivo: motivo as MotivoFalla | "aceptado", obligatorio: obligatorio === 1 })),
      });
    }
  }
  return { ...resumen, objetos, objetosSinClasificar };
}

/** The % of each discipline (and the total) in two audits, and how much it moved. */
export function comparar(antes: ResumenAuditoria, despues: ResumenAuditoria): { nombre: string; antes: number | null; despues: number | null; cambio: number | null }[] {
  const nombres = new Map([...antes.disciplinas, ...despues.disciplinas].map((d) => [d.id, `${d.codigo} · ${d.nombre}`]));
  const pctDe = (r: ResumenAuditoria, id: string) => r.disciplinas.find((d) => d.id === id)?.totales.pct ?? null;
  const filas = [...nombres].map(([id, nombre]) => {
    const a = pctDe(antes, id);
    const b = pctDe(despues, id);
    return { nombre, antes: a, despues: b, cambio: a !== null && b !== null ? redondear1(b - a) : null };
  });
  return [...filas, { nombre: "Total", antes: antes.total.pct, despues: despues.total.pct, cambio: redondear1(despues.total.pct - antes.total.pct) }];
}
