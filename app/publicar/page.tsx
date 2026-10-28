import type { Metadata } from "next";
import PublicarPage from "./PublicarPage";

export const metadata: Metadata = {
  title: "Publicar entre proyectos - Trimble Connect",
  description: "Publicar documentos y carpetas de un proyecto en otro proyecto de Trimble Connect, con las versiones nuevas al día.",
};

export default function Page() {
  return <PublicarPage />;
}
