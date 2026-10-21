"use client";

import { useMemo } from "react";
import { obraApi, ObraApi } from "../../lib/control-obra/client";
import ExtensionShell, { Host, ShellContext, ShellTexts } from "../trimble/ExtensionShell";

export interface ObraContext extends ShellContext {
  api: ObraApi;
}

const TEXTS: ShellTexts = {
  menuTitle: "Control de Obra",
  menuIcon: "/icon-control-obra.svg",
  menuCommand: "control_obra_open",
  notEmbedded:
    "Esta página debe abrirse dentro de un proyecto de Trimble Connect: Control de Obra desde el menú lateral y las mediciones desde el panel de extensiones del visor 3D.",
  consent:
    "Trimble Connect está pidiendo tu autorización para que Control de Obra pueda identificarte y revisar tu acceso a este proyecto. Acepta el mensaje para continuar.",
};

/** "Control de Obra" in the project's menu, and its panel in the 3D viewer (measurements from the model). */
export default function ControlObraShell({ forceHost = "project", children }: { forceHost?: Host; children: (context: ObraContext) => React.ReactNode }) {
  return (
    <ExtensionShell forceHost={forceHost} texts={TEXTS}>
      {(shell) => <WithApi shell={shell}>{children}</WithApi>}
    </ExtensionShell>
  );
}

function WithApi({ shell, children }: { shell: ShellContext; children: (context: ObraContext) => React.ReactNode }) {
  const api = useMemo(() => obraApi(shell.projectId, shell.tokenSource), [shell.projectId, shell.tokenSource]);
  return <>{children({ ...shell, api })}</>;
}
