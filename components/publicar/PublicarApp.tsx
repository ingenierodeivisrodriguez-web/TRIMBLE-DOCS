"use client";

import type { PublicarApi } from "../../lib/publicar/client";
import CopiaProyectos from "./CopiaProyectos";

/**
 * "Publicar entre proyectos". For now, copying files by hand to another
 * project; the destination's reception folders, publishing with automatic
 * updates and the activity come next.
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
      <CopiaProyectos api={api} projectId={projectId} projectName={projectName} />
    </div>
  );
}
