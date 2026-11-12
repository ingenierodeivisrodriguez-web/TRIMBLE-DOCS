import type { Metadata } from "next";
import FlujoAprobacionPage from "./FlujoAprobacionPage";

export const metadata: Metadata = {
  title: "Flujos documentales - Trimble Connect",
  description: "Revisión, aprobación, inspección y auditoría de entregables del proyecto por flujos con pasos y responsables.",
};

export default function Page() {
  return <FlujoAprobacionPage />;
}
