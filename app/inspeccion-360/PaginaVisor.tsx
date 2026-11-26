"use client";

import PanelInspeccion from "../../components/inspeccion-360/PanelInspeccion";
import ExtensionShell, { type ShellTexts } from "../../components/trimble/ExtensionShell";

const TEXTOS: ShellTexts = {
  menuTitle: "Inspección 360°",
  menuIcon: "/icon-inspeccion-360.svg",
  menuCommand: "inspeccion360_open",
  notEmbedded: "Esta página debe abrirse dentro del visor 3D de Trimble Connect, como panel de la extensión «Inspección 360°».",
  consent: "Trimble Connect está pidiendo tu autorización para que Inspección 360° pueda identificarte, leer el proyecto y guardar las fotos en su carpeta. Acepta el mensaje para continuar.",
};

/** The 3D viewer panel: capture points as icons and their 360° photos by date. */
export default function PaginaVisor() {
  return (
    <ExtensionShell forceHost="3dviewer" texts={TEXTOS}>
      {(shell) => (shell.viewer ? <PanelInspeccion {...shell} viewer={shell.viewer} /> : <p style={{ padding: 12 }}>Abra Inspección 360° desde el visor 3D.</p>)}
    </ExtensionShell>
  );
}
