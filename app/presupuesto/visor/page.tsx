import type { Metadata } from "next";
import PresupuestoPage from "../PresupuestoPage";

export const metadata: Metadata = {
  title: "Presupuesto (visor 3D) - Trimble Connect",
  description: "Asocia las partidas del presupuesto a los elementos seleccionados en el visor 3D.",
};

/** For the viewer-only manifest: always opens as the 3D viewer panel. */
export default function Page() {
  return <PresupuestoPage forceHost="3dviewer" />;
}
