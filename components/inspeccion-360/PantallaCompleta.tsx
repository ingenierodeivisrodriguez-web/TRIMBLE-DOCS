"use client";

// The 360° photo, or the before/after comparison of two dates, in a tab of its own. This tab has
// no Trimble Connect session: the panel that opened it hands over the photos it already
// downloaded (postMessage, same origin only), and saves an alignment on the tab's behalf.

import { useEffect, useRef, useState } from "react";
import { normalizarGiro } from "../../lib/inspeccion-360/comparar";
import Comparador360, { type FotoComparada, type VistaCamara } from "./Comparador360";
import { maxTextura, urlParaVisor } from "./imagen";
import Visor360 from "./Visor360";

type Lado = { id?: string; blob?: Blob; ancho?: number | null; fecha?: string; giro?: number; giroPor?: string | null; giroEn?: string | null; giroVisto?: number };
type Guardado = { giro: number; giroPor: string | null; giroEn: string | null };
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
  puedeAlinear?: boolean;
  // The panel's answer to a save.
  pedido?: number;
  error?: string;
  codigo?: string;
  guardado?: Guardado | null;
};

type Contenido =
  | { tipo: "foto"; url: string; titulo: string; giro: number }
  | { tipo: "comparar"; antes: FotoComparada; despues: FotoComparada; division: number; vista?: VistaCamara; puedeAlinear: boolean; girosIniciales: Record<string, number> };

function ladoValido(l: Lado | undefined): l is Lado & { id: string; blob: Blob; fecha: string } {
  return !!l && typeof l.id === "string" && l.blob instanceof Blob && typeof l.fecha === "string";
}

const giroDe = (v: unknown) => (typeof v === "number" ? normalizarGiro(v) : 0);
const textoDe = (v: unknown) => (typeof v === "string" ? v : null);

/** How long to wait for the panel to answer a save (it calls the server and reloads the dates). */
const ESPERA_PANEL_MS = 45_000;

export default function PantallaCompleta() {
  const [contenido, setContenido] = useState<Contenido | null>(null);
  const [esperando, setEsperando] = useState(true);
  const pedidos = useRef(new Map<number, (m: Mensaje) => void>());
  const siguiente = useRef(0);

  useEffect(() => {
    const alMensaje = async (ev: MessageEvent) => {
      const d = ev.data as Mensaje | null;
      if (ev.origin !== window.location.origin || ev.source !== window.opener || !d) return;
      if (d.tipo === "i360-giro-guardado" && typeof d.pedido === "number") {
        pedidos.current.get(d.pedido)?.(d);
      } else if (d.tipo === "i360-foto" && d.blob instanceof Blob) {
        const url = await urlParaVisor(d.blob, d.ancho ?? null, maxTextura());
        setContenido({ tipo: "foto", url, titulo: d.titulo ?? "", giro: giroDe(d.giro) });
        document.title = `${d.titulo ?? "Foto 360"} — Inspección 360°`;
      } else if (d.tipo === "i360-comparar" && ladoValido(d.antes) && ladoValido(d.despues)) {
        // Two photos on the GPU at once: each one at most 8192 px wide.
        const max = Math.min(maxTextura(), 8192);
        const [ua, ud] = await Promise.all([urlParaVisor(d.antes.blob, d.antes.ancho ?? null, max), urlParaVisor(d.despues.blob, d.despues.ancho ?? null, max)]);
        const division = typeof d.division === "number" && d.division >= 0 && d.division <= 100 ? d.division : 50;
        const foto = (l: Lado & { id: string; fecha: string }, url: string): FotoComparada => ({ id: l.id, url, fecha: l.fecha, giro: giroDe(l.giro), giroPor: textoDe(l.giroPor), giroEn: textoDe(l.giroEn) });
        const antes = foto(d.antes, ua);
        const despues = foto(d.despues, ud);
        // Turns the person had moved in the panel without saving yet stay "sin guardar" here.
        const girosIniciales: Record<string, number> = {};
        for (const [f, l] of [[antes, d.antes], [despues, d.despues]] as const) {
          if (typeof l.giroVisto === "number" && giroDe(l.giroVisto) !== f.giro) girosIniciales[f.id] = giroDe(l.giroVisto);
        }
        setContenido({ tipo: "comparar", antes, despues, division, vista: d.vista, puedeAlinear: d.puedeAlinear === true, girosIniciales });
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

  /** Asks the panel (which has the Trimble session) to save a photo's turn, and shows the turn now saved. */
  async function guardarGiro(capturaId: string, giro: number, anterior: number): Promise<void> {
    const panel = window.opener as Window | null;
    if (!panel || panel.closed) throw new Error("El panel Inspección 360° que abrió esta pestaña ya no está abierto: guarde la alineación desde el panel del visor.");
    const pedido = ++siguiente.current;
    const r = await new Promise<Mensaje>((ok, mal) => {
      const t = setTimeout(() => {
        pedidos.current.delete(pedido);
        mal(new Error("El panel Inspección 360° no respondió: revise que siga abierto en Trimble Connect y vuelva a intentar."));
      }, ESPERA_PANEL_MS);
      pedidos.current.set(pedido, (m) => {
        clearTimeout(t);
        pedidos.current.delete(pedido);
        ok(m);
      });
      panel.postMessage({ tipo: "i360-guardar-giro", pedido, capturaId, giro, anterior }, window.location.origin);
    });
    const g = r.guardado;
    if (g && typeof g.giro === "number") {
      const nuevo = (f: FotoComparada) => (f.id === capturaId ? { ...f, giro: normalizarGiro(g.giro), giroPor: textoDe(g.giroPor), giroEn: textoDe(g.giroEn) } : f);
      setContenido((c) => (c?.tipo === "comparar" ? { ...c, antes: nuevo(c.antes), despues: nuevo(c.despues) } : c));
    }
    if (r.error) throw Object.assign(new Error(r.error), { code: r.codigo });
  }

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
        <Comparador360
          antes={contenido.antes}
          despues={contenido.despues}
          division={contenido.division}
          vista={contenido.vista}
          llenar
          puedeAlinear={contenido.puedeAlinear}
          girosIniciales={contenido.girosIniciales}
          alGuardarGiro={guardarGiro}
        />
      </div>
    );
  }
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, fontSize: 14 }}>
      {esperando ? "Recibiendo la foto del panel…" : "Abra esta ventana desde el panel Inspección 360° del visor 3D de Trimble Connect (botón «Pantalla completa»)."}
    </main>
  );
}
