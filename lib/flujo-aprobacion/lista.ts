/**
 * The single screen's list of flows, as pure functions: one row per flow with
 * how many files it has, how many wait for the caller, who reviews and
 * approves, its due date, where its documents stand (por revisar, por aprobar,
 * aprobado, rechazado: owner's request of 09-11-2026), whether it is closed by
 * a first decision, and the filters (owner, user, group, state, due date,
 * "tengo por revisar").
 */
import { nombreResponsable } from "./flujos";
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

type ArchivoLista = Pick<ArchivoInfo, "flujoId" | "estado" | "meToca" | "pasos" | "pasoActual">;

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
export function filasFlujos(flujos: Flujo[], archivos: ArchivoLista[], hoy: string, cierres: Record<string, Cierre> = {}): FilaFlujo[] {
  const porNombre = new Intl.Collator("es", { numeric: true, sensitivity: "base" });
  return flujos
    .map((f) => {
      const suyos = archivos.filter((a) => a.flujoId === f.id);
      const pendientes = suyos.filter((a) => ESPERANDO.includes(a.estado)).length;
      const porRevisar = suyos.filter((a) => ESPERANDO.includes(a.estado) && a.meToca).length;
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
      };
    })
    .sort((a, b) => Number(b.flujo.activo) - Number(a.flujo.activo) || porNombre.compare(a.flujo.hito, b.flujo.hito));
}

export interface FiltroLista {
  propietario?: string;
  /** "persona:id" or "grupo:id": flows where they are responsible for a step. */
  quien?: string;
  /** A documents' state, or "desactivado" for deactivated flows. */
  estado?: EstadoDocumento | "desactivado" | "";
  vence?: "vencidos" | "7dias" | "sin-fecha" | "";
  porRevisar?: boolean;
  texto?: string;
}

/** The options of the dropdowns, from what the flows have. */
export function opcionesFiltro(filas: FilaFlujo[]): { propietarios: string[]; personas: { id: string; nombre: string }[]; grupos: { id: string; nombre: string }[] } {
  const porNombre = new Intl.Collator("es", { sensitivity: "base" });
  const propietarios = [...new Set(filas.map((f) => f.flujo.creadoPor).filter((x): x is string => !!x))].sort(porNombre.compare);
  const personas = new Map<string, string>();
  const grupos = new Map<string, string>();
  for (const f of filas) for (const r of responsablesDe(f.flujo)) (r.tipo === "grupo" ? grupos : personas).set(r.id, r.nombre);
  const lista = (m: Map<string, string>) => [...m].map(([id, n]) => ({ id, nombre: n })).sort((a, b) => porNombre.compare(a.nombre, b.nombre));
  return { propietarios, personas: lista(personas), grupos: lista(grupos) };
}

export function filtrarFilas(filas: FilaFlujo[], filtro: FiltroLista, hoy: string): FilaFlujo[] {
  const texto = (filtro.texto ?? "").trim().toLowerCase();
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
    if (texto && !f.flujo.hito.toLowerCase().includes(texto)) return false;
    return true;
  });
}
