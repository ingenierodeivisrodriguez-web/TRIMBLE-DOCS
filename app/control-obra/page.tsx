import type { Metadata } from "next";
import ControlObraPage from "./ControlObraPage";

export const metadata: Metadata = {
  title: "Control de Obra - Trimble Connect",
  description: "Control de cantidades, costos, avance y calidad de la obra ligado a los modelos 3D, con empresas, licencias, roles y bitácora.",
};

export default function Page() {
  return <ControlObraPage />;
}
