"use client";

// The 360° photo, or the before/after comparison of two dates, in a tab of its own. This tab has
// no Trimble Connect session: the panel that opened it hands over the photos it already
// downloaded (postMessage, same origin only).

import { useEffect, useState } from "react";
import { normalizarGiro } from "../../lib/inspeccion-360/comparar";
import Comparador360, { type FotoComparada, type VistaCamara } from "./Comparador360";
import { maxTextura, urlParaVisor } from "./imagen";
import Visor360 from "./Visor360";

type Lado = { id?: string; blob?: Blob; ancho?: number | null; fecha?: string; giro?: number };
type Mensaje = {
  tipo?: string;
  titulo?: string;
  blob?: Blob;
  ancho?: number | null;
  giro?: number;
  antes?: Lado;
  despues?: Lado;
  division?: number;
  vista?: VistaCamara;
};

type Contenido =
  | { tipo: "foto"; url: string; titulo: string; giro: number }
  | { tipo: "comparar"; antes: FotoComparada; despues: FotoComparada; division: number; vista?: VistaCamara };

function ladoValido(l: Lado | undefined): l is Required<Omit<Lado, "giro">> & Lado {
  return !!l && typeof l.id === "string" && l.blob instanceof Blob && typeof l.fecha === "string";
}

const giroDe = (v: unknown) => (typeof v === "number" ? normalizarGiro(v) : 0);

export default function PantallaCompleta() {
  const [contenido, setContenido] = useState<Contenido | null>(null);
  const [esperando, setEsperando] = useState(true);

  useEffect(() => {
    const alMensaje = async (ev: MessageEvent) => {
      const d = ev.data as Mensaje | null;
      if (ev.origin !== window.location.origin || ev.source !== window.opener || !d) return;
      if (d.tipo === "i360-foto" && d.blob instanceof Blob) {
        const url = await urlParaVisor(d.blob, d.ancho ?? null, maxTextura());
        setContenido({ tipo: "foto", url, titulo: d.titulo ?? "", giro: giroDe(d.giro) });
        document.title = `${d.titulo ?? "Foto 360"} — Inspección 360°`;
      } else if (d.tipo === "i360-comparar" && ladoValido(d.antes) && ladoValido(d.despues)) {
        // Two photos on the GPU at once: each one at most 8192 px wide.
        const max = Math.min(maxTextura(), 8192);
        const [ua, ud] = await Promise.all([urlParaVisor(d.antes.blob, d.antes.ancho, max), urlParaVisor(d.despues.blob, d.despues.ancho, max)]);
        const division = typeof d.division === "number" && d.division >= 0 && d.division <= 100 ? d.division : 50;
        setContenido({
          tipo: "comparar",
          antes: { id: d.antes.id, url: ua, fecha: d.antes.fecha, giro: giroDe(d.antes.giro) },
          despues: { id: d.despues.id, url: ud, fecha: d.despues.fecha, giro: giroDe(d.despues.giro) },
          division,
          vista: d.vista,
        });
        document.title = `${d.titulo ?? "Comparación 360"} — Inspección 360°`;
      }
    };
    window.addEventListener("message", alMensaje);
    if (window.opener) (window.opener as Window).postMessage({ tipo: "i360-listo" }, window.location.origin);
    const t = setTimeout(() => setEsperando(false), 8000);
    return () => {
      window.removeEventListener("message", alMensaje);
      clearTimeout(t);
    };
  }, []);

  if (contenido?.tipo === "foto") {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#111" }}>
        <Visor360 url={contenido.url} titulo={contenido.titulo} giro={contenido.giro} alto="100%" />
      </div>
    );
  }
  if (contenido?.tipo === "comparar") {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#fff", fontFamily: "system-ui, sans-serif", padding: 8, boxSizing: "border-box" }}>
        <Comparador360 antes={contenido.antes} despues={contenido.despues} division={contenido.division} vista={contenido.vista} alto="calc(100vh - 56px)" />
      </div>
    );
  }
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, fontSize: 14 }}>
      {esperando ? "Recibiendo la foto del panel…" : "Abra esta ventana desde el panel Inspección 360° del visor 3D de Trimble Connect (botón «Pantalla completa»)."}
    </main>
  );
}
