import type { Metadata } from "next";

// TEMPORARY (Inspección 360°, Fase 0): the page the panel opens in a new window (spike T0.5).
export const metadata: Metadata = {
  title: "Inspección 360 (ventana de prueba)",
  robots: { index: false, follow: false },
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const parametros = await searchParams;
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1 style={{ fontSize: 20 }}>Ventana de Inspección 360° abierta</h1>
      <p>Si ve esta página en una pestaña nueva, el panel del visor 3D sí puede abrir el visor 360 a pantalla completa.</p>
      <p style={{ color: "#546E7A", fontSize: 13 }}>Abierta desde: {String(parametros.desde ?? "(sin dato)")}</p>
    </main>
  );
}
