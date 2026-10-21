import type { Metadata } from "next";
import ControlObraPage from "../ControlObraPage";

export const metadata: Metadata = {
  title: "Control de Obra (visor 3D) - Trimble Connect",
  description: "Mide lo ejecutado seleccionando elementos del modelo en el visor 3D (por IFCGUID).",
};

/** For the viewer-only manifest: always opens as the 3D viewer panel. */
export default function Page() {
  return <ControlObraPage forceHost="3dviewer" />;
}
