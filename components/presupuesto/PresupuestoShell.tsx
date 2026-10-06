"use client";

import { useMemo } from "react";
import { presupuestoApi, PresupuestoApi } from "../../lib/presupuesto/client";
import ExtensionShell, { Host, ShellContext, ShellTexts } from "../trimble/ExtensionShell";

export interface PresupuestoContext extends ShellContext {
  api: PresupuestoApi;
}

const TEXTS: ShellTexts = {
  menuTitle: "Presupuesto",
  menuIcon: "/icon-presupuesto.svg",
  menuCommand: "presupuesto_open",
  notEmbedded:
    "Esta página debe abrirse dentro de un proyecto de Trimble Connect: el presupuesto desde el menú lateral \"Presupuesto\" y la asociación de partidas con elementos desde el panel de extensiones del visor 3D.",
  consent:
    "Trimble Connect está pidiendo tu autorización para que Presupuesto pueda identificarte y guardar el presupuesto. Acepta el mensaje para continuar.",
};

/** "Presupuesto" in Trimble Connect: the budget in the project's menu, element linking in the 3D viewer. */
export default function PresupuestoShell({ forceHost, children }: { forceHost?: Host; children: (context: PresupuestoContext) => React.ReactNode }) {
  return (
    <ExtensionShell forceHost={forceHost} texts={TEXTS}>
      {(shell) => <WithApi shell={shell}>{children}</WithApi>}
    </ExtensionShell>
  );
}

function WithApi({ shell, children }: { shell: ShellContext; children: (context: PresupuestoContext) => React.ReactNode }) {
  const api = useMemo(() => presupuestoApi(shell.projectId, shell.tokenSource), [shell.projectId, shell.tokenSource]);
  return <>{children({ ...shell, api })}</>;
}
