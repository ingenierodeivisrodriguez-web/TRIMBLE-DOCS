import type { Metadata } from "next";
import ComprasPage from "./ComprasPage";

export const metadata: Metadata = {
  title: "Compras y Contratación - Trimble Connect",
  description: "Abastecimiento de la obra a partir de los insumos del presupuesto, con accesos por rol y auditoría.",
};

export default function Page() {
  return <ComprasPage />;
}
