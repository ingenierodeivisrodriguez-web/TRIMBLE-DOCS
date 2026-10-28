/** How publications, files and activity read on screen. */
import type { AccionActividad, ArchivoSeguido, EntradaActividad, EstadoArchivo, EstadoPublicacion } from "./types";

export const ACCION: Record<AccionActividad, string> = {
  recepcion: "Carpeta de recepción",
  "recepcion-desactivada": "Recepción desactivada",
  publicar: "Publicado",
  copiar: "Primera copia",
  actualizar: "Versión nueva copiada",
  diferencia: "Distinto en el destino",
  reemplazar: "Reemplazado en el destino",
  retirado: "Retirado en el origen",
  detener: "Publicación detenida",
  reanudar: "Publicación reanudada",
  error: "Error al copiar",
};

export const ESTADO_ARCHIVO: Record<EstadoArchivo, { texto: string; color: string; fondo: string }> = {
  pendiente: { texto: "Pendiente", color: "#5b6573", fondo: "#eef1f5" },
  "al-dia": { texto: "Al día", color: "#2e6b22", fondo: "#e6f2e1" },
  diferencia: { texto: "Distinto en el destino", color: "#8a5a00", fondo: "#fdf1d6" },
  retirado: { texto: "Retirado en el origen", color: "#5b6573", fondo: "#eef1f5" },
  error: { texto: "Error", color: "#b3261e", fondo: "#fbe5e3" },
};

export const ESTADO_PUBLICACION: Record<EstadoPublicacion, { texto: string; color: string; fondo: string }> = {
  activa: { texto: "Se actualiza", color: "#2e6b22", fondo: "#e6f2e1" },
  detenida: { texto: "Detenida", color: "#5b6573", fondo: "#eef1f5" },
  retirada: { texto: "Retirada del origen", color: "#5b6573", fondo: "#eef1f5" },
};

/** How many files of a publication are in each state. */
export function conteo(archivos: ArchivoSeguido[]): Record<EstadoArchivo, number> {
  const c: Record<EstadoArchivo, number> = { pendiente: 0, "al-dia": 0, diferencia: 0, retirado: 0, error: 0 };
  for (const a of archivos) c[a.estado]++;
  return c;
}

/** "12 al día · 1 distinto en el destino"; "" when there are no files yet. */
export function textoConteo(archivos: ArchivoSeguido[]): string {
  const c = conteo(archivos);
  return (Object.keys(c) as EstadoArchivo[])
    .filter((k) => c[k] > 0)
    .map((k) => `${c[k]} ${ESTADO_ARCHIVO[k].texto.toLowerCase()}`)
    .join(" · ");
}

/** "https://web.connect.trimble.com/projects/AbC123/data" or "AbC123" -> "AbC123"; null when it isn't one. */
export function proyectoDeEnlace(texto: string): string | null {
  const t = texto.trim();
  const m = /projects\/([A-Za-z0-9_-]{4,64})/.exec(t);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{4,64}$/.test(t) ? t : null;
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The activity of one kind and/or containing a text (in the user, document, projects or note). */
export function filtrarActividad(entradas: EntradaActividad[], filtro: { accion?: AccionActividad | ""; texto?: string }): EntradaActividad[] {
  const buscado = sinTildes(filtro.texto?.trim() ?? "");
  return entradas.filter((e) => {
    if (filtro.accion && e.accion !== filtro.accion) return false;
    if (!buscado) return true;
    return sinTildes([e.usuario, e.nombre, e.nota, e.origenNombre, e.destinoNombre, ACCION[e.accion]].filter(Boolean).join(" ")).includes(buscado);
  });
}

/** "v3 → v1" from the origin and destination versions of an activity row or a file. */
export function versiones(origen: number | null, destino: number | null): string {
  if (origen === null && destino === null) return "";
  return `v${origen ?? "?"} → v${destino ?? "?"}`;
}
