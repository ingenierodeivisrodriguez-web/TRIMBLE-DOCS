import type { Metadata } from "next";
import RaPage from "../RaPage";

export const metadata: Metadata = {
  title: "Realidad aumentada (visor 3D) - Trimble Connect",
  description: "Prepara los modelos IFC abiertos en el visor para verlos desde el celular a escala real.",
};

/** For the viewer-only manifest: always opens as the 3D viewer panel. */
export default function Page() {
  return <RaPage forceHost="3dviewer" />;
}
