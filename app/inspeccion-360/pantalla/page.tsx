import type { Metadata } from "next";
import PantallaCompleta from "../../../components/inspeccion-360/PantallaCompleta";

export const metadata: Metadata = {
  title: "Foto 360 — Inspección 360°",
  robots: { index: false, follow: false },
};

/** A 360° photo at full screen, handed over by the viewer panel that opened this tab. */
export default function Page() {
  return <PantallaCompleta />;
}
