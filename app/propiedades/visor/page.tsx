import type { Metadata } from "next";
import PropiedadesPage from "../PropiedadesPage";

export const metadata: Metadata = {
  title: "Propiedades (visor 3D) - Trimble Connect",
  description: "Asigna atributos propios del proyecto a los elementos seleccionados en el visor 3D.",
};

/** For the viewer-only manifest: always opens as the 3D viewer panel. */
export default function Page() {
  return <PropiedadesPage forceHost="3dviewer" />;
}
