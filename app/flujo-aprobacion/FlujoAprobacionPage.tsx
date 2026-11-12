"use client";

import { useMemo } from "react";
import FlujoAprobacionApp from "../../components/flujo-aprobacion/FlujoAprobacionApp";
import ExtensionShell, { ShellContext, ShellTexts } from "../../components/trimble/ExtensionShell";
import { flujoApi } from "../../lib/flujo-aprobacion/client";
import { NOMBRE_EXTENSION } from "../../lib/flujo-aprobacion/nombre";

const TEXTS: ShellTexts = {
  // The name shown in Trimble's side menu; the command stays as it was (the e-mails' links use it).
  menuTitle: NOMBRE_EXTENSION,
  menuIcon: "/icon-flujo-aprobacion.svg",
  menuCommand: "flujo_aprobacion_open",
  notEmbedded: `Esta página debe abrirse dentro de un proyecto de Trimble Connect, desde el menú lateral "${NOMBRE_EXTENSION}".`,
  consent: `Trimble Connect está pidiendo tu autorización para que ${NOMBRE_EXTENSION} pueda leer el equipo y los archivos del proyecto con tus permisos. Acepta el mensaje para continuar.`,
};

export default function FlujoAprobacionPage() {
  return <ExtensionShell texts={TEXTS}>{(shell) => <ConApi shell={shell} />}</ExtensionShell>;
}

function ConApi({ shell }: { shell: ShellContext }) {
  const api = useMemo(() => flujoApi(shell.projectId, shell.tokenSource), [shell.projectId, shell.tokenSource]);
  return <FlujoAprobacionApp api={api} projectId={shell.projectId} projectName={shell.projectName} />;
}
