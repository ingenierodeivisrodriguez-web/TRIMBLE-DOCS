import type { Metadata } from "next";
import LoinPage from "./LoinPage";

export const metadata: Metadata = {
  title: "Requisitos BIM (LOIN) - Trimble Connect",
  description: "Qué se modela, con qué detalle y con qué información en cada disciplina y etapa del proyecto (nivel de información necesaria, ISO 7817-1).",
};

export default function Page() {
  return <LoinPage />;
}
