/**
 * The single screen's list of flows, as pure functions: one row per flow with
 * how many files it has, how many wait for the caller, who reviews and
 * approves, its due date, where its documents stand (por revisar, por aprobar,
 * aprobado, rechazado: owner's request of 09-11-2026), whether it is closed by
 * a first decision, and the filters (owner, user, group, state, due date,
 * "tengo por revisar").
 */
import { codigoFlujo, nombreResponsable } from "./flujos";
import { ESPERANDO } from "./registro";
import type { ArchivoInfo, Cierre, Flujo, Responsable } from "./types";

/**
 * Where a flow's documents stand: waiting for a step that isn't the last one
 * (por revisar), waiting for the last one (por aprobar), approved, rejected;
 * "sin-archivos" when none is registered yet.
 */
export type EstadoDocumento = "por-revisar" | "por-aprobar" | "aprobado" | "rechazado" | "sin-archivos";

export interface FilaFlujo {
  flujo: Flujo;
  archivos: number;
  /** Files waiting for anyone's review. */
  pendientes: number;
  /** Files waiting for the caller's step. */
  porRevisar: number;
  /** Who has a review step (persons and groups), in step order. */
  responsables: string[];
  /** Where its documents stand. */
  estado: EstadoDocumento;
  /** That state counted in words: "1 rechazado, 2 por aprobar". */
  detalleEstado: string;
  /** Past its due date with files still waiting (active flows only). */
  vencido: boolean;
  /** Its first decision: from then on it can't be edited, activated or deactivated. */
  cierre: Cierre | null;
  /** Files with a newer version in Trimble than the one the flow reviews (the flow keeps its own). */
  conVersionNueva: number;
  /** Files waiting for the caller at a step that isn't the last (review) and at the last one (approval). */
  misRevisar: number;
  misAprobar: number;
  /** The caller is responsible for one of its steps, or decided on one of its files. */
  participe: boolean;
}

/** Past its due date with files still waiting (only active flows). */
export function estaVencido(f: Pick<Flujo, "activo" | "vence">, pendientes: number, hoy: string): boolean {
  return f.activo && !!f.vence && f.vence < hoy && pendientes > 0;
}

/** "2026-11-04" plus n days. */
export function sumarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type ArchivoLista = Pick<ArchivoInfo, "flujoId" | "estado" | "meToca" | "pasos" | "pasoActual" | "versionNueva"> & Partial<Pick<ArchivoInfo, "firmas">>;

/** Where one registered file stands (null when it was retired from the flow). */
export function estadoDocumento(a: Pick<ArchivoInfo, "estado" | "pasos" | "pasoActual">): Exclude<EstadoDocumento, "sin-archivos"> | null {
  if (a.estado === "aprobado" || a.estado === "rechazado") return a.estado;
  if (!ESPERANDO.includes(a.estado)) return null;
  return a.pasoActual < a.pasos.length - 1 ? "por-revisar" : "por-aprobar";
}

/** Most urgent first: a rejection waits for a correction; "aprobado" only when every file is. */
const ORDEN = ["rechazado", "por-revisar", "por-aprobar", "aprobado"] as const;
const PALABRAS: Record<(typeof ORDEN)[number], [string, string]> = {
  rechazado: ["rechazado", "rechazados"],
  "por-revisar": ["por revisar", "por revisar"],
  "por-aprobar": ["por aprobar", "por aprobar"],
  aprobado: ["aprobado", "aprobados"],
};

/** A flow's state from its files: rejected if any is, else waiting (review before approval), approved only when all are. */
export function estadoDocumentos(archivos: Pick<ArchivoInfo, "estado" | "pasos" | "pasoActual">[]): { estado: EstadoDocumento; detalle: string } {
  const cuenta = new Map<string, number>();
  for (const a of archivos) {
    const e = estadoDocumento(a);
    if (e) cuenta.set(e, (cuenta.get(e) ?? 0) + 1);
  }
  const presentes = ORDEN.filter((e) => cuenta.has(e));
  if (!presentes.length) return { estado: "sin-archivos", detalle: "Ningún archivo registrado todavía" };
  return {
    estado: presentes[0],
    detalle: presentes.map((e) => `${cuenta.get(e)} ${PALABRAS[e][cuenta.get(e) === 1 ? 0 : 1]}`).join(", "),
  };
}

/** The responsibles of the flow's steps, without repeats, in step order. */
function responsablesDe(f: Pick<Flujo, "pasos">): Responsable[] {
  const vistos = new Map<string, Responsable>();
  for (const p of f.pasos) if (p.responsable) vistos.set(`${p.responsable.tipo}:${p.responsable.id}`, vistos.get(`${p.responsable.tipo}:${p.responsable.id}`) ?? p.responsable);
  return [...vistos.values()];
}

/** Who has the flow's review steps, without repeats, in step order. */
export function responsablesFlujo(f: Pick<Flujo, "pasos">): string[] {
  return responsablesDe(f).map(nombreResponsable);
}

/** The rows: active flows first, then by milestone. */
/** One dashboard figure: flows in that state (as the Estado column says) and their files in that state. */
export interface CifraTablero {
  flujos: number;
  archivos: number;
}

/** The dashboard cards above the list (11-11-2026). */
export interface ResumenTablero {
  flujos: number;
  activos: number;
  porRevisar: CifraTablero;
  porAprobar: CifraTablero;
  aprobados: CifraTablero;
  rechazados: CifraTablero;
  /** The caller's flows of each card (12-11-2026): what a click on it shows. */
  mios: { porRevisar: number; porAprobar: number; aprobados: number };
}

/** A card of the dashboard, which shows the caller's flows in that state (12-11-2026). */
export type Tarjeta = "por-revisar" | "por-aprobar" | "aprobado";

/** Whether a row is the caller's for that card: files waiting for them at that kind of step, or approved where they took part. */
export function esMia(f: Pick<FilaFlujo, "misRevisar" | "misAprobar" | "participe" | "estado">, t: Tarjeta): boolean {
  return t === "por-revisar" ? f.misRevisar > 0 : t === "por-aprobar" ? f.misAprobar > 0 : f.estado === "aprobado" && f.participe;
}

/**
 * The figures of the dashboard, from every flow (not only the filtered ones):
 * how many flows, how many are in each state of the Estado column, and how
 * many of their files are in that state (a file waiting at a step that isn't
 * the last is "por revisar"; at the last one, "por aprobar").
 */
export function resumenTablero(filas: FilaFlujo[], archivos: Pick<ArchivoInfo, "flujoId" | "estado" | "pasos" | "pasoActual">[]): ResumenTablero {
  const ids = new Set(filas.map((f) => f.flujo.id));
  const docs = archivos.filter((a) => ids.has(a.flujoId)).map(estadoDocumento);
  const cifra = (e: Exclude<EstadoDocumento, "sin-archivos">): CifraTablero => ({ flujos: filas.filter((f) => f.estado === e).length, archivos: docs.filter((d) => d === e).length });
  return {
    flujos: filas.length,
    activos: filas.filter((f) => f.flujo.activo).length,
    porRevisar: cifra("por-revisar"),
    porAprobar: cifra("por-aprobar"),
    aprobados: cifra("aprobado"),
    rechazados: cifra("rechazado"),
    mios: {
      porRevisar: filas.filter((f) => esMia(f, "por-revisar")).length,
      porAprobar: filas.filter((f) => esMia(f, "por-aprobar")).length,
      aprobados: filas.filter((f) => esMia(f, "aprobado")).length,
    },
  };
}

/** `yo`: the caller's Trimble id, to know the flows where they took part. */
export function filasFlujos(flujos: Flujo[], archivos: ArchivoLista[], hoy: string, cierres: Record<string, Cierre> = {}, yo = ""): FilaFlujo[] {
  const porNombre = new Intl.Collator("es", { numeric: true, sensitivity: "base" });
  return flujos
    .map((f) => {
      const suyos = archivos.filter((a) => a.flujoId === f.id);
      const pendientes = suyos.filter((a) => ESPERANDO.includes(a.estado)).length;
      const mios = suyos.filter((a) => ESPERANDO.includes(a.estado) && a.meToca);
      const porRevisar = mios.length;
      const misAprobar = mios.filter((a) => a.pasoActual >= a.pasos.length - 1).length;
      const { estado, detalle } = estadoDocumentos(suyos);
      return {
        flujo: f,
        archivos: suyos.length,
        pendientes,
        porRevisar,
        responsables: responsablesFlujo(f),
        estado,
        detalleEstado: detalle,
        vencido: estaVencido(f, pendientes, hoy),
        cierre: cierres[f.id] ?? null,
        conVersionNueva: suyos.filter((a) => a.estado !== "retirado" && !!a.versionNueva).length,
        misRevisar: porRevisar - misAprobar,
        misAprobar,
        participe: !!yo && (f.pasos.some((p) => p.responsable?.tipo === "persona" && p.responsable.id === yo) || suyos.some((a) => (a.firmas ?? []).some((x) => x.quienId === yo))),
      };
    })
    // Newest first by code (FLUJO-12, FLUJO-11…, 11-11-2026); flows still without a code go last, by name.
    .sort((a, b) => (b.flujo.codigo ?? 0) - (a.flujo.codigo ?? 0) || porNombre.compare(a.flujo.hito, b.flujo.hito));
}

export interface FiltroLista {
  propietario?: string;
  /** "persona:id": flows where that person is responsible for a step ("grupo:id" still works, but there is no Grupos filter since 11-11-2026). */
  quien?: string;
  /** A documents' state, or "desactivado" for deactivated flows. */
  estado?: EstadoDocumento | "desactivado" | "";
  vence?: "vencidos" | "7dias" | "sin-fecha" | "";
  porRevisar?: boolean;
  texto?: string;
  /** A dashboard card clicked: only the caller's flows in that state (12-11-2026). */
  tarjeta?: Tarjeta | "";
}

/** The options of the dropdowns, from what the flows have (no Grupos filter: the owner doesn't use it, 11-11-2026). */
export function opcionesFiltro(filas: FilaFlujo[]): { propietarios: string[]; personas: { id: string; nombre: string }[] } {
  const porNombre = new Intl.Collator("es", { sensitivity: "base" });
  const propietarios = [...new Set(filas.map((f) => f.flujo.creadoPor).filter((x): x is string => !!x))].sort(porNombre.compare);
  const personas = new Map<string, string>();
  for (const f of filas) for (const r of responsablesDe(f.flujo)) if (r.tipo === "persona") personas.set(r.id, r.nombre);
  return { propietarios, personas: [...personas].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => porNombre.compare(a.nombre, b.nombre)) };
}

export function filtrarFilas(filas: FilaFlujo[], filtro: FiltroLista, hoy: string): FilaFlujo[] {
  const texto = (filtro.texto ?? "").trim().toLowerCase();
  const compacto = texto.replace(/[-\s]/g, "");
  const [tipo, id] = (filtro.quien ?? "").split(":");
  return filas.filter((f) => {
    const v = f.flujo.vence ?? null;
    if (filtro.propietario && f.flujo.creadoPor !== filtro.propietario) return false;
    if (id && !f.flujo.pasos.some((p) => p.responsable?.tipo === tipo && p.responsable.id === id)) return false;
    if (filtro.estado === "desactivado" && f.flujo.activo) return false;
    if (filtro.estado && filtro.estado !== "desactivado" && f.estado !== filtro.estado) return false;
    if (filtro.vence === "vencidos" && !f.vencido) return false;
    if (filtro.vence === "7dias" && !(v && v >= hoy && v <= sumarDias(hoy, 7))) return false;
    if (filtro.vence === "sin-fecha" && v) return false;
    if (filtro.porRevisar && f.porRevisar === 0) return false;
    if (filtro.tarjeta && !esMia(f, filtro.tarjeta)) return false;
    if (texto && !f.flujo.hito.toLowerCase().includes(texto) && !(compacto && codigoFlujo(f.flujo.codigo).toLowerCase().replace(/[-\s]/g, "").includes(compacto))) return false;
    return true;
  });
}
