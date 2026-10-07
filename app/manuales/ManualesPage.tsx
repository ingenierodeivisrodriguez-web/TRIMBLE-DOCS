"use client";

import { useMemo } from "react";
import ManualesApp from "../../components/manuales/ManualesApp";
import ExtensionShell, { ShellContext, ShellTexts } from "../../components/trimble/ExtensionShell";
import { manualesApi } from "../../lib/manuales/client";

const TEXTS: ShellTexts = {
  menuTitle: "Manuales",
  menuIcon: "/icon-manuales.svg",
  menuCommand: "manuales_open",
  notEmbedded: "Esta página debe abrirse dentro de un proyecto de Trimble Connect, desde el menú lateral \"Manuales\".",
  consent:
    "Trimble Connect está pidiendo tu autorización para que Manuales pueda leer los documentos con tus permisos. Acepta el mensaje para continuar.",
};

export default function ManualesPage() {
  return <ExtensionShell texts={TEXTS}>{(shell) => <ConApi shell={shell} />}</ExtensionShell>;
}

function ConApi({ shell }: { shell: ShellContext }) {
  const api = useMemo(() => manualesApi(shell.projectId, shell.tokenSource), [shell.projectId, shell.tokenSource]);
  return <ManualesApp api={api} />;
}
