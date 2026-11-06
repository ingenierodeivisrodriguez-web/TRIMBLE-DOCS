import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import { nombrePdfTrazabilidad, pdfTrazabilidad } from "../../lib/flujo-aprobacion/pdfTrazabilidad";

/** Saves a file from the browser (the presupuesto helper would bring its OmniClass table along). */
export function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Reads the traceability for that filter and saves it as a PDF named after the project or `titulo`. */
export async function descargarTrazabilidad(api: FlujoApi, filtro: Record<string, string>, proyecto: string, titulo?: string) {
  const r = await api.trazabilidad(filtro);
  const generado = new Date().toISOString();
  const blob = await pdfTrazabilidad({ trazas: r.trazas, filtro: r.filtro, hitos: new Map(Object.entries(r.hitos)), proyecto: proyecto || "Proyecto", generado, por: r.por });
  descargar(blob, nombrePdfTrazabilidad(proyecto, generado, titulo));
}
