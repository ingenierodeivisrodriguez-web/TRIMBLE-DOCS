import type { Metadata } from "next";
import PaginaPruebas from "../PaginaPruebas";

// TEMPORARY (Inspección 360°, Fase 0): the 3D viewer panel of the test extension.
export const metadata: Metadata = {
  title: "Inspección 360 (pruebas del visor) - Trimble Connect",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <PaginaPruebas forceHost="3dviewer" />;
}
