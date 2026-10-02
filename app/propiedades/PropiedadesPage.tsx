"use client";

import CatalogoAtributos from "../../components/propiedades/CatalogoAtributos";
import PanelPropiedades from "../../components/propiedades/PanelPropiedades";
import PropiedadesShell, { Host } from "../../components/propiedades/PropiedadesShell";

export default function PropiedadesPage({ forceHost }: { forceHost?: Host }) {
  return (
    <PropiedadesShell forceHost={forceHost}>
      {({ host, projectId, projectName, api, viewer, subscribe, getAccessToken }) =>
        host === "3dviewer" && viewer ? (
          <PanelPropiedades
            api={api}
            viewer={viewer}
            subscribe={subscribe}
            projectId={projectId}
            getAccessToken={getAccessToken}
          />
        ) : (
          <main style={{ padding: "20px 24px 40px", maxWidth: 980, margin: "0 auto" }}>
            <header style={{ marginBottom: 16 }}>
              <h1 style={{ margin: 0, fontSize: 22, color: "var(--tc-blue-900)" }}>Propiedades · Catálogo de atributos</h1>
              <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--tc-gray-500)" }}>
                {projectName ? `${projectName} · ` : ""}Define los atributos que el equipo asigna a los elementos de los modelos
                desde el panel &quot;Propiedades&quot; del visor 3D.
              </p>
            </header>
            <CatalogoAtributos api={api} />
          </main>
        )
      }
    </PropiedadesShell>
  );
}
