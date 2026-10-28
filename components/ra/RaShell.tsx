"use client";

import { useMemo } from "react";
import { raApi, RaApi } from "../../lib/ra/client";
import ExtensionShell, { Host, ShellContext, ShellTexts } from "../trimble/ExtensionShell";

export interface RaContext extends ShellContext {
  api: RaApi;
}

const TEXTS: ShellTexts = {
  menuTitle: "Realidad aumentada",
  menuIcon: "/icon-ra.svg",
  menuCommand: "ra_open",
  notEmbedded:
    "Esta página debe abrirse dentro de un proyecto de Trimble Connect: los modelos preparados desde el menú lateral \"Realidad aumentada\" y la preparación de un modelo desde el panel de extensiones del visor 3D.",
  consent:
    "Trimble Connect está pidiendo tu autorización para que Realidad aumentada pueda identificarte y leer los modelos IFC del proyecto. Acepta el mensaje para continuar.",
};

/** "Realidad aumentada" in Trimble Connect: the prepared models in the project's menu, the preparation in the 3D viewer. */
export default function RaShell({ forceHost, children }: { forceHost?: Host; children: (context: RaContext) => React.ReactNode }) {
  return (
    <ExtensionShell forceHost={forceHost} texts={TEXTS}>
      {(shell) => <WithApi shell={shell}>{children}</WithApi>}
    </ExtensionShell>
  );
}

function WithApi({ shell, children }: { shell: ShellContext; children: (context: RaContext) => React.ReactNode }) {
  const api = useMemo(() => raApi(shell.projectId, shell.tokenSource), [shell.projectId, shell.tokenSource]);
  return <>{children({ ...shell, api })}</>;
}
