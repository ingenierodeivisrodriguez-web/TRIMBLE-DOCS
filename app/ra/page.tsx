import type { Metadata } from "next";
import RaPage from "./RaPage";

export const metadata: Metadata = {
  title: "Realidad aumentada - Trimble Connect",
  description: "Modelos BIM preparados para verlos desde el celular a escala real, fijos en el punto de un QR.",
};

export default function Page() {
  return <RaPage />;
}
