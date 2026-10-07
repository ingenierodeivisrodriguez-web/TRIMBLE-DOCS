import type { Metadata } from "next";
import ManualesPage from "./ManualesPage";

export const metadata: Metadata = {
  title: "Manuales - Trimble Connect",
  description: "Los manuales de la empresa, leídos desde la carpeta del proyecto de manuales con los permisos de cada usuario.",
};

export default function Page() {
  return <ManualesPage />;
}
