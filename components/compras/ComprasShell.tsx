"use client";

import { useMemo } from "react";
import { comprasApi, ComprasApi } from "../../lib/compras/client";
import ExtensionShell, { ShellContext, ShellTexts } from "../trimble/ExtensionShell";

export interface ComprasContext extends ShellContext {
  api: ComprasApi;
}

const TEXTS: ShellTexts = {
  menuTitle: "Compras y Contratación",
  menuIcon: "/icon-compras.svg",
  menuCommand: "compras_open",
  notEmbedded: "Esta página debe abrirse dentro de un proyecto de Trimble Connect, desde el menú lateral \"Compras y Contratación\".",
  consent:
    "Trimble Connect está pidiendo tu autorización para que Compras pueda identificarte y revisar tu acceso a este proyecto. Acepta el mensaje para continuar.",
};

/** "Compras y Contratación" in Trimble Connect: only in the project's menu (no 3D viewer panel yet). */
export default function ComprasShell({ children }: { children: (context: ComprasContext) => React.ReactNode }) {
  return (
    <ExtensionShell forceHost="project" texts={TEXTS}>
      {(shell) => <WithApi shell={shell}>{children}</WithApi>}
    </ExtensionShell>
  );
}

function WithApi({ shell, children }: { shell: ShellContext; children: (context: ComprasContext) => React.ReactNode }) {
  const api = useMemo(() => comprasApi(shell.projectId, shell.tokenSource), [shell.projectId, shell.tokenSource]);
  return <>{children({ ...shell, api })}</>;
}
