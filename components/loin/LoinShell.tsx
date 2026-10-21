"use client";

import { useMemo } from "react";
import { loinApi, LoinApi } from "../../lib/loin/client";
import ExtensionShell, { Host, ShellContext, ShellTexts } from "../trimble/ExtensionShell";

export interface LoinContext extends ShellContext {
  api: LoinApi;
}

const TEXTS: ShellTexts = {
  menuTitle: "Requisitos BIM (LOIN)",
  menuIcon: "/icon-loin.svg",
  menuCommand: "loin_open",
  notEmbedded:
    "Esta página debe abrirse dentro de un proyecto de Trimble Connect: los requisitos desde el menú lateral \"Requisitos BIM (LOIN)\" y la asociación con los modelos desde el panel de extensiones del visor 3D.",
  consent:
    "Trimble Connect está pidiendo tu autorización para que Requisitos BIM pueda identificarte y guardar los requisitos del proyecto. Acepta el mensaje para continuar.",
};

/** "Requisitos BIM (LOIN)" in Trimble Connect: the requirements in the project's menu, the link with the models in the 3D viewer. */
export default function LoinShell({ forceHost, children }: { forceHost?: Host; children: (context: LoinContext) => React.ReactNode }) {
  return (
    <ExtensionShell forceHost={forceHost} texts={TEXTS}>
      {(shell) => <WithApi shell={shell}>{children}</WithApi>}
    </ExtensionShell>
  );
}

function WithApi({ shell, children }: { shell: ShellContext; children: (context: LoinContext) => React.ReactNode }) {
  const api = useMemo(() => loinApi(shell.projectId, shell.tokenSource), [shell.projectId, shell.tokenSource]);
  return <>{children({ ...shell, api })}</>;
}
