"use client";

import { useMemo } from "react";
import { loinApi, LoinApi } from "../../lib/loin/client";
import ExtensionShell, { ShellContext, ShellTexts } from "../trimble/ExtensionShell";

export interface LoinContext extends ShellContext {
  api: LoinApi;
}

const TEXTS: ShellTexts = {
  menuTitle: "Requisitos BIM (LOIN)",
  menuIcon: "/icon-loin.svg",
  menuCommand: "loin_open",
  notEmbedded: "Esta página debe abrirse dentro de un proyecto de Trimble Connect, desde el menú lateral \"Requisitos BIM (LOIN)\".",
  consent:
    "Trimble Connect está pidiendo tu autorización para que Requisitos BIM pueda identificarte y guardar los requisitos del proyecto. Acepta el mensaje para continuar.",
};

/** "Requisitos BIM (LOIN)" in Trimble Connect: the project's menu (the 3D viewer panel comes in a later phase). */
export default function LoinShell({ children }: { children: (context: LoinContext) => React.ReactNode }) {
  return (
    <ExtensionShell forceHost="project" texts={TEXTS}>
      {(shell) => <WithApi shell={shell}>{children}</WithApi>}
    </ExtensionShell>
  );
}

function WithApi({ shell, children }: { shell: ShellContext; children: (context: LoinContext) => React.ReactNode }) {
  const api = useMemo(() => loinApi(shell.projectId, shell.tokenSource), [shell.projectId, shell.tokenSource]);
  return <>{children({ ...shell, api })}</>;
}
