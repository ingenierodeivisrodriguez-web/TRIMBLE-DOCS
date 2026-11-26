"use client";

// TEMPORARY (Inspección 360°, Fase 0): test extension for the spikes. Remove when Fase 0 closes.
import MenuPruebas from "../../components/i360-pruebas/MenuPruebas";
import PanelPruebas from "../../components/i360-pruebas/PanelPruebas";
import ShellPruebas, { type Anfitrion } from "../../components/i360-pruebas/ShellPruebas";

export default function PaginaPruebas({ forceHost }: { forceHost?: Anfitrion }) {
  return (
    <ShellPruebas forceHost={forceHost}>
      {(ctx) => (ctx.host === "3dviewer" ? <PanelPruebas {...ctx} /> : <MenuPruebas {...ctx} />)}
    </ShellPruebas>
  );
}
