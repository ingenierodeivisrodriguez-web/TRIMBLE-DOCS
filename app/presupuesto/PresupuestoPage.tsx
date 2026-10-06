"use client";

import PanelVisor from "../../components/presupuesto/PanelVisor";
import PresupuestoApp from "../../components/presupuesto/PresupuestoApp";
import PresupuestoShell from "../../components/presupuesto/PresupuestoShell";
import type { Host } from "../../components/trimble/ExtensionShell";

export default function PresupuestoPage({ forceHost }: { forceHost?: Host }) {
  return (
    <PresupuestoShell forceHost={forceHost}>
      {({ host, projectId, projectName, api, viewer, subscribe }) =>
        host === "3dviewer" && viewer ? (
          <PanelVisor api={api} viewer={viewer} subscribe={subscribe} />
        ) : (
          <PresupuestoApp api={api} projectId={projectId} projectName={projectName} />
        )
      }
    </PresupuestoShell>
  );
}
