import type { Metadata } from "next";
import ValidacionApp from "./ValidacionApp";

export const metadata: Metadata = {
  title: "Validación - Trimble Connect",
  description: "Validación configurable de la nomenclatura de los archivos del proyecto.",
};

export default function ValidacionPage() {
  return <ValidacionApp />;
}
