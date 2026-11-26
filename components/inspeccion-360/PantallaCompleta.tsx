"use client";

// The 360° photo in a tab of its own. This tab has no Trimble Connect session: the panel that
// opened it hands over the photo it already downloaded (postMessage, same origin only).

import { useEffect, useState } from "react";
import { maxTextura, urlParaVisor } from "./imagen";
import Visor360 from "./Visor360";

export default function PantallaCompleta() {
  const [foto, setFoto] = useState<{ url: string; titulo: string } | null>(null);
  const [esperando, setEsperando] = useState(true);

  useEffect(() => {
    const alMensaje = async (ev: MessageEvent) => {
      const d = ev.data as { tipo?: string; blob?: Blob; ancho?: number | null; titulo?: string } | null;
      if (ev.origin !== window.location.origin || ev.source !== window.opener || d?.tipo !== "i360-foto" || !(d.blob instanceof Blob)) return;
      const url = await urlParaVisor(d.blob, d.ancho ?? null, maxTextura());
      setFoto({ url, titulo: d.titulo ?? "" });
      document.title = `${d.titulo ?? "Foto 360"} — Inspección 360°`;
    };
    window.addEventListener("message", alMensaje);
    if (window.opener) (window.opener as Window).postMessage({ tipo: "i360-listo" }, window.location.origin);
    const t = setTimeout(() => setEsperando(false), 8000);
    return () => {
      window.removeEventListener("message", alMensaje);
      clearTimeout(t);
    };
  }, []);

  if (foto) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#111" }}>
        <Visor360 url={foto.url} titulo={foto.titulo} alto="100%" />
      </div>
    );
  }
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, fontSize: 14 }}>
      {esperando ? "Recibiendo la foto del panel…" : "Abra esta ventana desde el panel Inspección 360° del visor 3D de Trimble Connect (botón «Pantalla completa»)."}
    </main>
  );
}
