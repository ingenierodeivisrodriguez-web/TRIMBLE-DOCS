import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Resumen Archivos - Trimble Connect",
  description: "Estadisticas de los documentos cargados en el proyecto.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
