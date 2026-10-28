"use client";

import type { PublicarApi } from "../../lib/publicar/client";
import { Notice } from "../presupuesto/ui";
import PruebaCopia from "./PruebaCopia";

/**
 * "Publicar entre proyectos". Phase 0 only has the copy test; the publish
 * button, the destination's reception folders and the activity come next.
 */
export default function PublicarApp({ api, projectId, projectName }: { api: PublicarApi; projectId: string; projectName: string }) {
  return (
    <div style={{ padding: "18px 22px 40px", display: "grid", gap: 14 }}>
      <header style={{ maxWidth: 900 }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 20, color: "var(--tc-blue-800)" }}>Publicar entre proyectos</h1>
        <p style={{ margin: 0, fontSize: 14, color: "var(--tc-gray-500)" }}>
          Publica documentos y carpetas de este proyecto en otro proyecto, y cada versión nueva llega sola al destino.
        </p>
      </header>
      <Notice kind="info" style={{ maxWidth: 900, boxSizing: "border-box" }}>
        Fase de prueba. Antes de construir el botón Publicar, la configuración del proyecto destino y la actividad, esta prueba confirma con un archivo real que la extensión
        puede copiar versiones de este proyecto a otro con tu sesión. Cuando termines, copia el resumen del resultado y compártelo.
      </Notice>
      <PruebaCopia api={api} projectId={projectId} projectName={projectName} />
    </div>
  );
}
