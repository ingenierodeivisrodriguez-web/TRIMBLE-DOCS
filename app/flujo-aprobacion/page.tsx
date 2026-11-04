import type { Metadata } from "next";
import FlujoAprobacionPage from "./FlujoAprobacionPage";

export const metadata: Metadata = {
  title: "Flujo de aprobación - Trimble Connect",
  description: "Revisión y aprobación de entregables del proyecto por flujos con título o hito, y copia de lo aprobado a la carpeta destino.",
};

export default function Page() {
  return <FlujoAprobacionPage />;
}
