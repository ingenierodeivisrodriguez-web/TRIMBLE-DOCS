import type { Metadata } from "next";
import GraficosPage from "./GraficosPage";

export const metadata: Metadata = {
  title: "Gráficos de Modelos - Trimble Connect",
  description: "Gráficos con los datos de los modelos 3D cargados en el visor de Trimble Connect.",
};

export default function Page() {
  return <GraficosPage />;
}
