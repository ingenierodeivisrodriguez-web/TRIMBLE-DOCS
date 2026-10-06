"use client";

import { useMemo } from "react";
import { httpApi, PropiedadesApi } from "../../lib/propiedades/client";
import type { PropiedadesViewer } from "../../lib/propiedades/selection";
import ExtensionShell, { Host, ShellContext, ShellTexts, ViewerEventListener } from "../trimble/ExtensionShell";

export type { Host, ViewerEventListener };

export interface PropiedadesContext {
  host: Host;
  projectId: string;
  projectName: string;
  api: PropiedadesApi;
  /** Only in the 3D viewer. */
  viewer: PropiedadesViewer | null;
  subscribe: (listener: ViewerEventListener) => () => void;
  /** The user's Trimble token for this app's other endpoints; `fresh` asks Trimble Connect for it again. */
  getAccessToken: (fresh?: boolean) => Promise<string>;
}

const TEXTS: ShellTexts = {
  menuTitle: "Propiedades",
  menuIcon: "/icon-propiedades.svg",
  menuCommand: "propiedades_open",
  notEmbedded:
    "Esta página debe abrirse dentro de un proyecto de Trimble Connect: el catálogo desde el menú lateral \"Propiedades\" y la asignación desde el panel de extensiones del visor 3D.",
  consent:
    "Trimble Connect está pidiendo tu autorización para que Propiedades pueda identificarte y guardar valores. Acepta el mensaje para continuar.",
};

/**
 * "Propiedades" in Trimble Connect: the attribute catalog in the project's
 * left menu, and value assignment in the 3D viewer (see ExtensionShell).
 */
export default function PropiedadesShell({
  forceHost,
  children,
}: {
  /** For the viewer-only manifest, which always opens in the 3D viewer. */
  forceHost?: Host;
  children: (context: PropiedadesContext) => React.ReactNode;
}) {
  return (
    <ExtensionShell forceHost={forceHost} texts={TEXTS}>
      {(shell) => <WithApi shell={shell}>{children}</WithApi>}
    </ExtensionShell>
  );
}

function WithApi({ shell, children }: { shell: ShellContext; children: (context: PropiedadesContext) => React.ReactNode }) {
  const api = useMemo(() => httpApi(shell.projectId, shell.tokenSource), [shell.projectId, shell.tokenSource]);
  return (
    <>
      {children({
        host: shell.host,
        projectId: shell.projectId,
        projectName: shell.projectName,
        api,
        viewer: shell.viewer,
        subscribe: shell.subscribe,
        getAccessToken: shell.getAccessToken,
      })}
    </>
  );
}
