import type { Metadata } from "next";
import EscanearQR from "../../../components/ra/EscanearQR";

export const metadata: Metadata = {
  title: "Escanear QR - Realidad aumentada",
  description: "Lee el QR de un punto de realidad aumentada pegado en la obra.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <EscanearQR />;
}
