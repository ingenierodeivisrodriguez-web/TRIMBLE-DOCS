import type { Metadata } from "next";
import PaginaVisor from "../PaginaVisor";

export const metadata: Metadata = {
  title: "Inspección 360° (visor 3D) - Trimble Connect",
  description: "Puntos de captura de fotos 360° ubicados en el modelo y sus fotos por fecha.",
};

export default function Page() {
  return <PaginaVisor />;
}
