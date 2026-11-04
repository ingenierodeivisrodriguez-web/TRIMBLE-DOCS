"use client";

import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import PruebaFase0 from "./PruebaFase0";

/**
 * "Flujo de aprobación". For now only phase 0: a test against the real
 * Trimble Connect of what the flow will rely on (team, versions, copy, ToDo).
 */
export default function FlujoAprobacionApp({ api, projectId, projectName }: { api: FlujoApi; projectId: string; projectName: string }) {
  return (
    <div style={{ padding: "18px 22px 40px", display: "grid", gap: 14 }}>
      <header style={{ maxWidth: 900 }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 20, color: "var(--tc-blue-800)" }}>Flujo de aprobación</h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--tc-gray-500)" }}>
          Revisión y aprobación de entregables de {projectName || "este proyecto"} (modelos, planos, documentos) por flujos con título o hito, por ejemplo
          «Aprobar diseño arquitectónico Torre 1». Lo aprobado pasa solo a la carpeta destino y todo queda en la trazabilidad.
        </p>
      </header>
      <PruebaFase0 api={api} projectId={projectId} projectName={projectName} />
    </div>
  );
}
