/**
 * What the review on opening shows (20-11-2026): the flows with news keep the
 * notice; the flows where the person's session only missed files it can't see
 * in Trimble (folders without access), with nothing changed, go to one line
 * with «Ver cuáles», so a member without access to every folder doesn't get a
 * wall of «Revisión incompleta».
 */
import type { ResumenRevision } from "./types";

export function repartirRevision(rs: ResumenRevision[]): { noticias: ResumenRevision[]; sinAcceso: ResumenRevision[] } {
  const sinAcceso = rs.filter((r) => r.sinAcceso);
  const noticias = rs.filter((r) => !r.sinAcceso && (r.nuevos || r.nuevasVersiones || r.retirados || r.reaparecidos || !r.completo || r.ocupado || /no apareci/.test(r.mensaje)));
  return { noticias, sinAcceso };
}

/** "En 7 flujos hay archivos que tu cuenta no puede ver en Trimble: esos no se revisaron, y no cambia nada." */
export function textoSinAcceso(n: number): string {
  return `En ${n} ${n === 1 ? "flujo" : "flujos"} hay archivos que tu cuenta no puede ver en Trimble: esos no se revisaron, y no cambia nada.`;
}

/** One flow in «Ver cuáles»: "«Plan de suministro»: Obra / Compras / plan.xlsx; …". */
export function detalleSinAcceso(r: Pick<ResumenRevision, "hito" | "noLeidos">): string {
  const rutas = r.noLeidos ?? [];
  return `«${r.hito}»: ${rutas.length ? rutas.join("; ") : "algunos archivos"}`;
}
