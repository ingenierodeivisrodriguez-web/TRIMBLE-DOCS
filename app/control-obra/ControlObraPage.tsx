"use client";

import ControlObraApp from "../../components/control-obra/ControlObraApp";
import ControlObraShell from "../../components/control-obra/ControlObraShell";
import PanelControl from "../../components/control-obra/PanelControl";
import type { Host } from "../../components/trimble/ExtensionShell";

export default function ControlObraPage({ forceHost = "project" }: { forceHost?: Host }) {
  return (
    <ControlObraShell forceHost={forceHost}>
      {({ host, projectId, projectName, api, viewer, subscribe, abrirVisor }) =>
        host === "3dviewer" && viewer ? (
          <PanelControl api={api} viewer={viewer} subscribe={subscribe} />
        ) : (
          <ControlObraApp api={api} projectId={projectId} projectName={projectName} abrirVisor={abrirVisor} />
        )
      }
    </ControlObraShell>
  );
}
