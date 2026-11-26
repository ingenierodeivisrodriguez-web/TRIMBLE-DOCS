import type { Metadata } from "next";
import PaginaPruebas from "./PaginaPruebas";

// TEMPORARY (Inspección 360°, Fase 0). Remove when Fase 0 closes.
export const metadata: Metadata = {
  title: "Inspección 360 (pruebas) - Trimble Connect",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <PaginaPruebas />;
}
