/**
 * The single screen's list of flows, as pure functions: one row per flow with
 * how many files it has, how many wait for the caller, who reviews and
 * approves, its due date and state (a flow past its due date with files still
 * waiting is "vencido"), and the filters (owner, user, group, state, due date,
 * "tengo por revisar").
 */
import { PAPEL_CONSULTA, PAPEL_REALIZA } from "./flujos";
import { ESPERANDO } from "./registro";
import type { ArchivoInfo, Asignacion, Flujo } from "./types";

export type EstadoFila = "activo" | "desactivado" | "vencido";

export interface FilaFlujo {
  flujo: Flujo & { asignaciones: Asignacion[] };
  archivos: number;
  /** Files waiting for anyone's review. */
  pendientes: number;
  /** Files waiting for the caller's step. */
  porRevisar: number;
  /** Who has a review step (persons and groups), in step order. */
  responsables: string[];
  estado: EstadoFila;
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

const nombre = (a: Pick<Asignacion, "quienTipo" | "quienNombre">) => (a.quienTipo === "grupo" ? `${a.quienNombre} (grupo)` : a.quienNombre);

/** Who has the flow's review steps, without repeats, in step order. */
export function responsablesFlujo(f: Pick<Flujo, "pasos"> & { asignaciones: Asignacion[] }): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const p of f.pasos) {
    for (const a of f.asignaciones) {
      if (!a.activa || a.papel !== p.id || a.papel === PAPEL_REALIZA || a.papel === PAPEL_CONSULTA) continue;
      const clave = `${a.quienTipo}:${a.quienId}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      out.push(nombre(a));
    }
  }
  return out;
}

/** The rows: active flows first, then by milestone. */
export function filasFlujos(flujos: (Flujo & { asignaciones: Asignacion[] })[], archivos: Pick<ArchivoInfo, "flujoId" | "estado" | "meToca">[], hoy: string): FilaFlujo[] {
  const porNombre = new Intl.Collator("es", { numeric: true, sensitivity: "base" });
  return flujos
    .map((f) => {
      const suyos = archivos.filter((a) => a.flujoId === f.id);
      const pendientes = suyos.filter((a) => ESPERANDO.includes(a.estado)).length;
      const porRevisar = suyos.filter((a) => ESPERANDO.includes(a.estado) && a.meToca).length;
      const estado: EstadoFila = !f.activo ? "desactivado" : estaVencido(f, pendientes, hoy) ? "vencido" : "activo";
      return { flujo: f, archivos: suyos.length, pendientes, porRevisar, responsables: responsablesFlujo(f), estado };
    })
    .sort((a, b) => Number(b.flujo.activo) - Number(a.flujo.activo) || porNombre.compare(a.flujo.hito, b.flujo.hito));
}

export interface FiltroLista {
  propietario?: string;
  /** "persona:id" or "grupo:id": flows where they have any role. */
  quien?: string;
  estado?: EstadoFila | "";
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
  for (const f of filas) for (const a of f.flujo.asignaciones) if (a.activa) (a.quienTipo === "grupo" ? grupos : personas).set(a.quienId, a.quienNombre);
  const lista = (m: Map<string, string>) => [...m].map(([id, n]) => ({ id, nombre: n })).sort((a, b) => porNombre.compare(a.nombre, b.nombre));
  return { propietarios, personas: lista(personas), grupos: lista(grupos) };
}

export function filtrarFilas(filas: FilaFlujo[], filtro: FiltroLista, hoy: string): FilaFlujo[] {
  const texto = (filtro.texto ?? "").trim().toLowerCase();
  const [tipo, id] = (filtro.quien ?? "").split(":");
  return filas.filter((f) => {
    const v = f.flujo.vence ?? null;
    if (filtro.propietario && f.flujo.creadoPor !== filtro.propietario) return false;
    if (id && !f.flujo.asignaciones.some((a) => a.activa && a.quienTipo === tipo && a.quienId === id)) return false;
    if (filtro.estado && f.estado !== filtro.estado) return false;
    if (filtro.vence === "vencidos" && f.estado !== "vencido") return false;
    if (filtro.vence === "7dias" && !(v && v >= hoy && v <= sumarDias(hoy, 7))) return false;
    if (filtro.vence === "sin-fecha" && v) return false;
    if (filtro.porRevisar && f.porRevisar === 0) return false;
    if (texto && !f.flujo.hito.toLowerCase().includes(texto)) return false;
    return true;
  });
}
