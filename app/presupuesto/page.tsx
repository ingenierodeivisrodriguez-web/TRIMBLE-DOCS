import type { Metadata } from "next";
import PresupuestoPage from "./PresupuestoPage";

export const metadata: Metadata = {
  title: "Presupuesto - Trimble Connect",
  description: "Presupuesto del proyecto con catálogos de insumos y partidas clasificados con OmniClass, asociado a los modelos 3D por IFCGUID.",
};

export default function Page() {
  return <PresupuestoPage />;
}
