"use client";

// The 360° photo, or the before/after comparison of two dates, in a tab of its own. This tab has
// no Trimble Connect session: the panel that opened it hands over the photos it already
// downloaded (postMessage, same origin only), downloads another date chosen here, saves an
// alignment on the tab's behalf and, when a neighbouring point is clicked in the photo, walks
// there and sends the new photo.

import { useEffect, useRef, useState } from "react";
import { normalizarGiro, type OpcionFecha, opcionesFechaDe } from "../../lib/inspeccion-360/comparar";
import Comparador360, { type FotoComparada, type Lado, type VistaCamara } from "./Comparador360";
import { BotonFecha, ListaFechas } from "./ElegirFecha";
import { maxTextura, urlParaVisor } from "./imagen";
import Visor360, { type MarcadorPunto, type VistaFoto } from "./Visor360";

type LadoRecibido = { id?: string; blob?: Blob; ancho?: number | null; fecha?: string; giro?: number; giroPor?: string | null; giroEn?: string | null; giroVisto?: number };
type Guardado = { giro: number; giroPor: string | null; giroEn: string | null };
type Mensaje = {
  tipo?: string;
  titulo?: string;
  codigo?: unknown;
  capturaId?: unknown;
  marcadores?: unknown;
  volver?: unknown;
  fechas?: unknown;
  blob?: Blob;
  ancho?: number | null;
  giro?: number;
  antes?: LadoRecibido;
  despues?: LadoRecibido;
  division?: number;
  vista?: VistaCamara;
  puedeAlinear?: boolean;
  // The panel's answer to a request (save a turn, bring a date) and its progress.
  pedido?: number;
  texto?: unknown;
  error?: unknown;
  guardado?: Guardado | null;
  lado?: LadoRecibido;
};

type Contenido =
  | { tipo: "foto"; capturaId: string | null; url: string; titulo: string; giro: number; marcadores: MarcadorPunto[]; vista?: VistaFoto; volver: { puntoId: string; etiqueta: string } | null; fechas: OpcionFecha[] }
  | { tipo: "comparar"; codigo: string; antes: FotoComparada; despues: FotoComparada; division: number; vista?: VistaCamara; puedeAlinear: boolean; girosIniciales: Record<string, number>; fechas: OpcionFecha[] };

function ladoValido(l: LadoRecibido | undefined): l is LadoRecibido & { id: string; blob: Blob; fecha: string } {
  return !!l && typeof l.id === "string" && l.blob instanceof Blob && typeof l.fecha === "string";
}

const giroDe = (v: unknown) => (typeof v === "number" ? normalizarGiro(v) : 0);
const textoDe = (v: unknown) => (typeof v === "string" ? v : null);

const esNumero = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function marcadoresDe(v: unknown): MarcadorPunto[] {
  if (!Array.isArray(v)) return [];
  return v.filter((m): m is MarcadorPunto => !!m && typeof m.puntoId === "string" && esNumero(m.yaw) && esNumero(m.pitch) && typeof m.etiqueta === "string" && typeof m.detalle === "string");
}

function volverDe(v: unknown): { puntoId: string; etiqueta: string } | null {
  const o = v as { puntoId?: unknown; etiqueta?: unknown } | null;
  return o && typeof o.puntoId === "string" && typeof o.etiqueta === "string" ? { puntoId: o.puntoId, etiqueta: o.etiqueta } : null;
}

function vistaDe(v: unknown): VistaFoto | undefined {
  const o = v as Partial<VistaFoto> | null;
  return o && esNumero(o.yaw) && esNumero(o.pitch) && esNumero(o.zoom) ? { yaw: o.yaw, pitch: o.pitch, zoom: o.zoom } : undefined;
}

const fotoDe = (l: LadoRecibido & { id: string; fecha: string }, url: string): FotoComparada => ({ id: l.id, url, fecha: l.fecha, giro: giroDe(l.giro), giroPor: textoDe(l.giroPor), giroEn: textoDe(l.giroEn) });

/** Two photos on the GPU at once: each one at most 8192 px wide. */
const maxComparar = () => Math.min(maxTextura(), 8192);

/** How long to wait for news from the panel (it calls the server, downloads up to 60 MB, reloads the dates). */
const ESPERA_PANEL_MS = 45_000;
const NO_RESPONDE = "El panel Inspección 360° no respondió: revise que siga abierto en Trimble Connect, con este mismo punto elegido, y vuelva a intentar.";

export default function PantallaCompleta() {
  const [contenido, setContenido] = useState<Contenido | null>(null);
  const [esperando, setEsperando] = useState(true);
  const pedidos = useRef(new Map<number, (m: Mensaje) => void>());
  const siguiente = useRef(0);
  const actual = useRef<Contenido | null>(null);
  actual.current = contenido;
  const camara = useRef<VistaFoto | undefined>(undefined);
  // Single photo: what the tab is waiting for from the panel (another point or date), or why it failed.
  const [espera, setEspera] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const reloj = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fechaPedida = useRef("");
  const [menuFoto, setMenuFoto] = useState(false);
  // Comparison: a date being brought from the panel (one at a time).
  const [estadoFecha, setEstadoFecha] = useState<{ texto: string; error: boolean } | null>(null);
  const trayendo = useRef(false);

  /** Shows what the tab waits for; with no news from the panel for a while, says so. */
  function esperar(texto: string | null) {
    clearTimeout(reloj.current);
    setEspera(texto);
    if (texto)
      reloj.current = setTimeout(() => {
        setEspera(null);
        setAviso(NO_RESPONDE);
      }, 60_000);
  }

  useEffect(() => {
    const alMensaje = async (ev: MessageEvent) => {
      const d = ev.data as Mensaje | null;
      if (ev.origin !== window.location.origin || ev.source !== window.opener || !d) return;
      if ((d.tipo === "i360-giro-guardado" || d.tipo === "i360-avance" || d.tipo === "i360-foto-pedida") && typeof d.pedido === "number") {
        pedidos.current.get(d.pedido)?.(d);
      } else if (d.tipo === "i360-estado" && typeof d.texto === "string") {
        // How the date chosen here goes in the panel (single photo).
        if (d.error === true) {
          esperar(null);
          setAviso(d.texto);
        } else esperar(fechaPedida.current ? `Foto del ${fechaPedida.current}: ${d.texto}` : d.texto);
      } else if (d.tipo === "i360-foto" && d.blob instanceof Blob) {
        const capturaId = typeof d.capturaId === "string" ? d.capturaId : null;
        const datos = { titulo: d.titulo ?? "", giro: giroDe(d.giro), marcadores: marcadoresDe(d.marcadores), volver: volverDe(d.volver), fechas: opcionesFechaDe(d.fechas) };
        const previo = actual.current;
        if (previo?.tipo === "foto" && capturaId && previo.capturaId === capturaId) {
          // The same photo: only its neighbours, turn, dates or «Volver» changed.
          setContenido({ ...previo, ...datos });
        } else {
          const url = await urlParaVisor(d.blob, d.ancho ?? null, maxTextura());
          if (previo?.tipo === "foto") setTimeout(() => URL.revokeObjectURL(previo.url), 5000);
          setContenido({ tipo: "foto", capturaId, url, vista: vistaDe(d.vista), ...datos });
        }
        esperar(null);
        setAviso("");
        fechaPedida.current = "";
        document.title = `${d.titulo ?? "Foto 360"} — Inspección 360°`;
      } else if (d.tipo === "i360-comparar" && ladoValido(d.antes) && ladoValido(d.despues)) {
        const [ua, ud] = await Promise.all([urlParaVisor(d.antes.blob, d.antes.ancho ?? null, maxComparar()), urlParaVisor(d.despues.blob, d.despues.ancho ?? null, maxComparar())]);
        const division = typeof d.division === "number" && d.division >= 0 && d.division <= 100 ? d.division : 50;
        const antes = fotoDe(d.antes, ua);
        const despues = fotoDe(d.despues, ud);
        // Turns the person had moved in the panel without saving yet stay "sin guardar" here.
        const girosIniciales: Record<string, number> = {};
        for (const [f, l] of [[antes, d.antes], [despues, d.despues]] as const) {
          if (typeof l.giroVisto === "number" && giroDe(l.giroVisto) !== f.giro) girosIniciales[f.id] = giroDe(l.giroVisto);
        }
        const codigo = typeof d.codigo === "string" ? d.codigo : "";
        setContenido({ tipo: "comparar", codigo, antes, despues, division, vista: d.vista, puedeAlinear: d.puedeAlinear === true, girosIniciales, fechas: opcionesFechaDe(d.fechas) });
        document.title = `${d.titulo ?? "Comparación 360"} — Inspección 360°`;
      }
    };
    window.addEventListener("message", alMensaje);
    if (window.opener) (window.opener as Window).postMessage({ tipo: "i360-listo" }, window.location.origin);
    const t = setTimeout(() => setEsperando(false), 8000);
    return () => {
      window.removeEventListener("message", alMensaje);
      clearTimeout(t);
      clearTimeout(reloj.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An error about a date clears itself after a while (it is drawn over the photos).
  useEffect(() => {
    if (!estadoFecha?.error) return;
    const t = setTimeout(() => setEstadoFecha((e) => (e?.error ? null : e)), 12_000);
    return () => clearTimeout(t);
  }, [estadoFecha]);

  /**
   * Asks the panel (which has the Trimble session) for something and waits for its answer; each
   * progress message from the panel (`alAvance`) gives it more time.
   */
  function pedirAlPanel(mensaje: Record<string, unknown>, siCerrado: string, alAvance?: (texto: string) => void): Promise<Mensaje> {
    const panel = window.opener as Window | null;
    if (!panel || panel.closed) return Promise.reject(new Error(siCerrado));
    const pedido = ++siguiente.current;
    return new Promise<Mensaje>((ok, mal) => {
      let t: ReturnType<typeof setTimeout> | undefined;
      const dar = () => {
        clearTimeout(t);
        t = setTimeout(() => {
          pedidos.current.delete(pedido);
          mal(new Error(NO_RESPONDE));
        }, ESPERA_PANEL_MS);
      };
      dar();
      pedidos.current.set(pedido, (m) => {
        if (m.tipo === "i360-avance") {
          dar();
          if (typeof m.texto === "string") alAvance?.(m.texto);
          return;
        }
        clearTimeout(t);
        pedidos.current.delete(pedido);
        ok(m);
      });
      panel.postMessage({ ...mensaje, pedido }, window.location.origin);
    });
  }

  /** Asks the panel to save a photo's turn, and shows the turn now saved. */
  async function guardarGiro(capturaId: string, giro: number, anterior: number): Promise<void> {
    const r = await pedirAlPanel(
      { tipo: "i360-guardar-giro", capturaId, giro, anterior },
      "El panel Inspección 360° que abrió esta pestaña ya no está abierto: guarde la alineación desde el panel del visor.",
    );
    const g = r.guardado;
    if (g && typeof g.giro === "number") {
      const nuevo = (f: FotoComparada) => (f.id === capturaId ? { ...f, giro: normalizarGiro(g.giro), giroPor: textoDe(g.giroPor), giroEn: textoDe(g.giroEn) } : f);
      setContenido((c) => (c?.tipo === "comparar" ? { ...c, antes: nuevo(c.antes), despues: nuevo(c.despues) } : c));
    }
    if (typeof r.error === "string" && r.error) throw Object.assign(new Error(r.error), { code: textoDe(r.codigo) ?? undefined });
  }

  /** Another date for one side of the comparison: the panel downloads it and hands it over. */
  async function elegirFecha(lado: Lado, capturaId: string) {
    const c = actual.current;
    if (c?.tipo !== "comparar" || trayendo.current) return;
    const fecha = c.fechas.find((f) => f.id === capturaId)?.fecha ?? "";
    const prefijo = `Foto ${lado === "antes" ? "«antes»" : "«después»"} del ${fecha}`;
    trayendo.current = true;
    setEstadoFecha({ error: false, texto: `${prefijo}: pidiéndola al panel…` });
    try {
      const r = await pedirAlPanel(
        { tipo: "i360-pedir-foto", capturaId, enPantalla: [c.antes.id, c.despues.id] },
        "El panel Inspección 360° que abrió esta pestaña ya no está abierto: para comparar otra fecha, abra de nuevo la comparación desde el panel.",
        (texto) => setEstadoFecha({ error: false, texto: `${prefijo}: ${texto}` }),
      );
      if (typeof r.error === "string" && r.error) throw new Error(r.error);
      if (!ladoValido(r.lado) || r.lado.id !== capturaId) throw new Error("El panel no mandó la foto pedida: vuelva a intentar.");
      setEstadoFecha({ error: false, texto: `${prefijo}: preparando la foto…` });
      const url = await urlParaVisor(r.lado.blob, r.lado.ancho ?? null, maxComparar());
      const previo = actual.current;
      if (previo?.tipo !== "comparar") return URL.revokeObjectURL(url);
      const vieja = previo[lado].url;
      const fechas = opcionesFechaDe(r.fechas);
      const nuevo = { ...previo, [lado]: fotoDe(r.lado, url), fechas: fechas.length ? fechas : previo.fechas };
      setContenido(nuevo);
      setTimeout(() => URL.revokeObjectURL(vieja), 5000);
      document.title = `${nuevo.codigo ? `${nuevo.codigo} · ` : ""}${nuevo.antes.fecha} → ${nuevo.despues.fecha} — Inspección 360°`;
      setEstadoFecha(null);
    } catch (err) {
      setEstadoFecha({ error: true, texto: err instanceof Error ? err.message : String(err) });
    } finally {
      trayendo.current = false;
    }
  }

  /** Asks the panel to walk to a point (a neighbour in the photo, or back); it sends the new photo. */
  function ir(puntoId: string, etiqueta: string) {
    const panel = window.opener as Window | null;
    if (!panel || panel.closed) return setAviso("El panel Inspección 360° que abrió esta pestaña ya no está abierto: para pasar a otro punto, ábralo de nuevo desde el panel.");
    setAviso("");
    fechaPedida.current = "";
    esperar(`Pasando a ${etiqueta}…`);
    panel.postMessage({ tipo: "i360-ir-a-punto", puntoId, vista: camara.current }, window.location.origin);
  }

  /** Asks the panel to open another date of this point (looking the same way); it sends the photo. */
  function verFecha(capturaId: string) {
    const panel = window.opener as Window | null;
    if (!panel || panel.closed) return setAviso("El panel Inspección 360° que abrió esta pestaña ya no está abierto: para ver otra fecha, ábralo de nuevo desde el panel.");
    const c = actual.current;
    const fecha = c?.tipo === "foto" ? (c.fechas.find((f) => f.id === capturaId)?.fecha ?? "") : "";
    setAviso("");
    fechaPedida.current = fecha;
    esperar(`Abriendo la foto del ${fecha || "día elegido"}…`);
    panel.postMessage({ tipo: "i360-ver-fecha", capturaId, vista: camara.current }, window.location.origin);
  }

  if (contenido?.tipo === "foto") {
    const volver = contenido.volver;
    const sobre: React.CSSProperties = { position: "absolute", zIndex: 200, fontFamily: "system-ui, sans-serif", fontSize: 13, borderRadius: 4 };
    const fechaActual = contenido.fechas.find((f) => f.id === contenido.capturaId)?.fecha;
    return (
      <div style={{ position: "fixed", inset: 0, background: "#111" }}>
        <Visor360
          url={contenido.url}
          titulo={contenido.titulo}
          giro={contenido.giro}
          vista={contenido.vista}
          marcadores={contenido.marcadores}
          alElegirMarcador={(id) => ir(id, contenido.marcadores.find((m) => m.puntoId === id)?.etiqueta ?? "el punto")}
          alMoverCamara={(v) => (camara.current = v)}
          alto="100%"
        />
        {volver && (
          <button
            onClick={() => ir(volver.puntoId, volver.etiqueta.replace(/^Volver a /, ""))}
            style={{ ...sobre, top: 12, left: 12, border: "2px solid #fff", background: "rgba(239,108,0,.92)", color: "#fff", fontWeight: 600, padding: "6px 12px", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.5)" }}
          >
            ← {volver.etiqueta}
          </button>
        )}
        {fechaActual && (
          <BotonFecha
            texto={`Fecha · ${fechaActual}`}
            abierto={menuFoto}
            alPulsar={() => setMenuFoto((m) => !m)}
            titulo="Ver otra fecha de este punto"
            estilo={{ ...sobre, top: 12, right: 12, border: "2px solid #fff", background: "rgba(69,90,100,.94)", color: "#fff", fontWeight: 600, padding: "6px 12px", boxShadow: "0 2px 8px rgba(0,0,0,.5)" }}
          />
        )}
        {menuFoto && fechaActual && (
          <ListaFechas opciones={contenido.fechas} elegida={contenido.capturaId ?? ""} titulo="Fechas de este punto" alElegir={verFecha} alCerrar={() => setMenuFoto(false)} estilo={{ top: 56, right: 12, zIndex: 210 }} />
        )}
        {(espera || aviso) && (
          <div style={{ ...sobre, top: volver ? 56 : 12, left: 12, maxWidth: "min(520px, calc(100% - 330px))", minWidth: 200, background: aviso ? "rgba(179,38,30,.92)" : "rgba(0,0,0,.75)", color: "#fff", padding: "6px 10px" }}>
            {aviso || espera}
          </div>
        )}
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
          fechas={contenido.fechas}
          alElegirFecha={elegirFecha}
          estadoFecha={estadoFecha}
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
