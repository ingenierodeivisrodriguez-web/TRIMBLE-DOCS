import type { Metadata } from "next";
import PruebaRA from "../../components/ra/PruebaRA";

export const metadata: Metadata = {
  title: "Prueba de realidad aumentada",
  description: "Comprueba si el celular puede mostrar un modelo a escala real fijo en el piso (fase 0 de la extensión de realidad aumentada con QR).",
};

export default function Page() {
  return <PruebaRA />;
}
