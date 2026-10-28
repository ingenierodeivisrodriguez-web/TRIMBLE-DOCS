"use client";

import { useMemo } from "react";
import PublicarApp from "../../components/publicar/PublicarApp";
import ExtensionShell, { ShellContext, ShellTexts } from "../../components/trimble/ExtensionShell";
import { publicarApi } from "../../lib/publicar/client";

const TEXTS: ShellTexts = {
  menuTitle: "Publicar entre proyectos",
  menuIcon: "/icon-publicar.svg",
  menuCommand: "publicar_open",
  notEmbedded: "Esta página debe abrirse dentro de un proyecto de Trimble Connect, desde el menú lateral \"Publicar entre proyectos\".",
  consent:
    "Trimble Connect está pidiendo tu autorización para que Publicar entre proyectos pueda leer y copiar documentos con tus permisos. Acepta el mensaje para continuar.",
};

export default function PublicarPage() {
  return <ExtensionShell texts={TEXTS}>{(shell) => <ConApi shell={shell} />}</ExtensionShell>;
}

function ConApi({ shell }: { shell: ShellContext }) {
  const api = useMemo(() => publicarApi(shell.projectId, shell.tokenSource), [shell.projectId, shell.tokenSource]);
  return <PublicarApp api={api} projectId={shell.projectId} projectName={shell.projectName} />;
}
