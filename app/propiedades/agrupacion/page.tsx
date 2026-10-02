import type { Metadata } from "next";
import AgrupacionPage from "./AgrupacionPage";

export const metadata: Metadata = {
  title: "Seleccionar por agrupación - Trimble Connect",
  description: "Agrupa los elementos de los modelos por sus propiedades o atributos del proyecto y selecciónalos en el visor 3D.",
};

/** The 3D viewer extension on the right side (manifest-agrupacion.json). */
export default function Page() {
  return <AgrupacionPage />;
}
