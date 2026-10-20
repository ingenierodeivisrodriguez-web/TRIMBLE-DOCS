"use client";

import { useMemo } from "react";
import { obraApi, ObraApi } from "../../lib/control-obra/client";
import ExtensionShell, { ShellContext, ShellTexts } from "../trimble/ExtensionShell";

export interface ObraContext extends ShellContext {
  api: ObraApi;
}

const TEXTS: ShellTexts = {
  menuTitle: "Control de Obra",
  menuIcon: "/icon-control-obra.svg",
  menuCommand: "control_obra_open",
  notEmbedded: "Esta página debe abrirse dentro de un proyecto de Trimble Connect, desde el menú lateral \"Control de Obra\".",
  consent:
    "Trimble Connect está pidiendo tu autorización para que Control de Obra pueda identificarte y revisar tu acceso a este proyecto. Acepta el mensaje para continuar.",
};

/** "Control de Obra" in the project's menu (the 3D viewer panel comes in the next phase). */
export default function ControlObraShell({ children }: { children: (context: ObraContext) => React.ReactNode }) {
  return (
    <ExtensionShell forceHost="project" texts={TEXTS}>
      {(shell) => <WithApi shell={shell}>{children}</WithApi>}
    </ExtensionShell>
  );
}

function WithApi({ shell, children }: { shell: ShellContext; children: (context: ObraContext) => React.ReactNode }) {
  const api = useMemo(() => obraApi(shell.projectId, shell.tokenSource), [shell.projectId, shell.tokenSource]);
  return <>{children({ ...shell, api })}</>;
}
