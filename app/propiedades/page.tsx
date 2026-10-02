import type { Metadata } from "next";
import PropiedadesPage from "./PropiedadesPage";

export const metadata: Metadata = {
  title: "Propiedades - Trimble Connect",
  description: "Atributos propios del proyecto asignados por IFCGUID a los elementos de los modelos 3D.",
};

export default function Page() {
  return <PropiedadesPage />;
}
