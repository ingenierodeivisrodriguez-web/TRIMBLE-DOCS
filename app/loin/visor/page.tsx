import type { Metadata } from "next";
import LoinPage from "../LoinPage";

export const metadata: Metadata = {
  title: "Requisitos BIM (LOIN) (visor 3D) - Trimble Connect",
  description: "Asocia los objetos de los modelos 3D a los elementos a modelar: modelos por disciplina, reglas, asociación manual y objetos sin clasificar.",
};

/** For the viewer-only manifest: always opens as the 3D viewer panel. */
export default function Page() {
  return <LoinPage forceHost="3dviewer" />;
}
