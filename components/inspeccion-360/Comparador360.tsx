"use client";

// Before/after comparison of two 360° photos of the same point: both photos stacked, the "después"
// one cut at a vertical bar the person drags sideways, and both cameras turning and zooming
// together. A photo taken with the camera facing another way is lined up by turning "antes"; the
// turn is kept per photo in this browser.

import "@photo-sphere-viewer/core/index.css";
import type { Viewer as VisorPSV } from "@photo-sphere-viewer/core";
import { useEffect, useRef, useState } from "react";
import { divisionConTecla, divisionDesdePuntero, giroEnRadianes, guardarGiro, leerGiro, normalizarGiro } from "../../lib/inspeccion-360/comparar";
import { LANG } from "./Visor360";

export interface FotoComparada {
  /** The capture's id: the turn is saved under it. */
  id: string;
  url: string;
  /** Date and time shown on the photo (DD-MM-AAAA HH:MM). */
  fecha: string;
}

export interface VistaCamara {
  yaw: number;
  pitch: number;
  zoom: number;
}

const COLOR_ANTES = "#455a64";
const COLOR_DESPUES = "#EF6C00";

const boton: React.CSSProperties = { border: "1px solid var(--tc-gray-300, #c9ced6)", background: "#fff", borderRadius: 4, fontSize: 12, padding: "3px 7px", cursor: "pointer", fontFamily: "inherit" };

function etiqueta(color: string, lado: "left" | "right"): React.CSSProperties {
  return { position: "absolute", top: 8, [lado]: 8, background: color, color: "#fff", fontSize: 11.5, fontWeight: 600, padding: "3px 8px", borderRadius: 3, whiteSpace: "nowrap", boxShadow: "0 1px 3px rgba(0,0,0,.4)" };
}

export default function Comparador360({
  antes,
  despues,
  alto = 300,
  division: divisionInicial = 50,
  vista,
  alCambiarDivision,
  alMoverCamara,
}: {
  antes: FotoComparada;
  despues: FotoComparada;
  alto?: number | string;
  /** Where the bar starts (0–100 %). */
  division?: number;
  /** Where the cameras start looking (from another comparison, for full screen). */
  vista?: VistaCamara;
  alCambiarDivision?: (division: number) => void;
  alMoverCamara?: (vista: VistaCamara) => void;
}) {
  const marco = useRef<HTMLDivElement>(null);
  const capaAntes = useRef<HTMLDivElement>(null);
  const capaDespues = useRef<HTMLDivElement>(null);
  const visorAntes = useRef<VisorPSV | null>(null);
  const visorDespues = useRef<VisorPSV | null>(null);
  const cargadas = useRef({ antes: "", despues: "" });
  const props = useRef({ antes, despues, vista, alMoverCamara });
  props.current = { antes, despues, vista, alMoverCamara };
  const [division, setDivision] = useState(divisionInicial);
  const [giro, setGiro] = useState(() => leerGiro(antes.id));
  const [arrastrando, setArrastrando] = useState(false);
  const [error, setError] = useState("");

  // Both viewers, created once; then each photo change only swaps the panorama (the camera stays).
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const { Viewer } = await import("@photo-sphere-viewer/core");
        if (cancelado || !capaAntes.current || !capaDespues.current) return;
        const { antes: a, despues: d, vista: v } = props.current;
        const crear = (contenedor: HTMLDivElement, url: string, giroGrados: number) =>
          new Viewer({
            container: contenedor,
            panorama: url,
            navbar: false,
            loadingTxt: "Cargando foto 360…",
            defaultZoomLvl: v ? v.zoom : 0,
            defaultYaw: v ? v.yaw : 0,
            defaultPitch: v ? v.pitch : 0,
            sphereCorrection: { pan: giroEnRadianes(giroGrados) },
            touchmoveTwoFingers: false,
            mousewheelCtrlKey: false,
            lang: LANG,
          });
        visorAntes.current = crear(capaAntes.current, a.url, leerGiro(a.id));
        visorDespues.current = crear(capaDespues.current, d.url, leerGiro(d.id));
        cargadas.current = { antes: a.url, despues: d.url };

        // Moving either photo moves the other. PSV fires the event synchronously inside rotate()/zoom(),
        // so a flag set around the call is enough to stop the echo.
        let siguiendo = false;
        const seguir = (de: VisorPSV, a2: VisorPSV) => {
          de.addEventListener("position-updated", ({ position }) => {
            if (siguiendo) return;
            siguiendo = true;
            try {
              a2.rotate(position);
            } finally {
              siguiendo = false;
            }
            props.current.alMoverCamara?.({ yaw: position.yaw, pitch: position.pitch, zoom: de.getZoomLevel() });
          });
          de.addEventListener("zoom-updated", ({ zoomLevel }) => {
            if (siguiendo) return;
            siguiendo = true;
            try {
              a2.zoom(zoomLevel);
            } finally {
              siguiendo = false;
            }
            const p = de.getPosition();
            props.current.alMoverCamara?.({ yaw: p.yaw, pitch: p.pitch, zoom: zoomLevel });
          });
        };
        seguir(visorAntes.current, visorDespues.current);
        seguir(visorDespues.current, visorAntes.current);
      } catch (err) {
        if (!cancelado) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelado = true;
      visorAntes.current?.destroy();
      visorDespues.current?.destroy();
      visorAntes.current = null;
      visorDespues.current = null;
    };
  }, []);

  // Another "antes" date: its own saved turn goes with it.
  useEffect(() => {
    const v = visorAntes.current;
    if (!v || cargadas.current.antes === antes.url) return;
    cargadas.current.antes = antes.url;
    const g = leerGiro(antes.id);
    setGiro(g);
    v.setPanorama(antes.url, { transition: false, sphereCorrection: { pan: giroEnRadianes(g) } }).catch((err) => setError(String(err)));
  }, [antes.url, antes.id]);

  useEffect(() => {
    const v = visorDespues.current;
    if (!v || cargadas.current.despues === despues.url) return;
    cargadas.current.despues = despues.url;
    v.setPanorama(despues.url, { transition: false, sphereCorrection: { pan: giroEnRadianes(leerGiro(despues.id)) } }).catch((err) => setError(String(err)));
  }, [despues.url, despues.id]);

  function moverBarra(valor: number) {
    setDivision(valor);
    alCambiarDivision?.(valor);
  }

  function girar(grados: number) {
    const g = normalizarGiro(grados);
    setGiro(g);
    guardarGiro(antes.id, g);
    visorAntes.current?.setOption("sphereCorrection", { pan: giroEnRadianes(g) });
  }

  function alPuntero(ev: React.PointerEvent) {
    const r = marco.current?.getBoundingClientRect();
    if (r) moverBarra(divisionDesdePuntero(ev.clientX, r.left, r.width));
  }

  const resto = 100 - division;
  return (
    <div>
      <div ref={marco} style={{ position: "relative", width: "100%", height: alto, background: "#111", borderRadius: 4, overflow: "hidden", userSelect: "none" }}>
        <div ref={capaAntes} style={{ position: "absolute", inset: 0 }} />
        <div ref={capaDespues} style={{ position: "absolute", inset: 0, clipPath: `inset(0 0 0 ${division}%)` }} />

        {/* Each date's label lives in its own side of the bar. */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", clipPath: `inset(0 ${resto}% 0 0)`, zIndex: 5 }}>
          <span style={etiqueta(COLOR_ANTES, "left")}>Antes · {antes.fecha}</span>
        </div>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", clipPath: `inset(0 0 0 ${division}%)`, zIndex: 5 }}>
          <span style={etiqueta(COLOR_DESPUES, "right")}>Después · {despues.fecha}</span>
        </div>

        <div
          role="slider"
          tabIndex={0}
          aria-label="Barra de comparación antes / después"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(division)}
          title="Arrastre para comparar antes y después"
          onPointerDown={(ev) => {
            ev.currentTarget.setPointerCapture(ev.pointerId);
            setArrastrando(true);
            alPuntero(ev);
          }}
          onPointerMove={(ev) => arrastrando && alPuntero(ev)}
          onPointerUp={() => setArrastrando(false)}
          onPointerCancel={() => setArrastrando(false)}
          onKeyDown={(ev) => {
            const v = divisionConTecla(division, ev.key, ev.shiftKey);
            if (v === null) return;
            ev.preventDefault();
            moverBarra(v);
          }}
          style={{ position: "absolute", top: 0, bottom: 0, left: `${division}%`, width: 28, marginLeft: -14, cursor: "ew-resize", zIndex: 6, touchAction: "none", outline: "none" }}
        >
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 13, width: 2, background: "#fff", boxShadow: "0 0 4px rgba(0,0,0,.6)" }} />
          <div
            style={{ position: "absolute", top: "50%", left: 14, transform: "translate(-50%, -50%)", width: 40, height: 40, borderRadius: "50%", background: "rgba(0,0,0,.35)", border: "2px solid #fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 6px rgba(0,0,0,.5)" }}
          >
            <svg width="26" height="14" viewBox="0 0 26 14" aria-hidden="true">
              <path d="M8 1 L1 7 L8 13 Z M18 1 L25 7 L18 13 Z" fill="#fff" />
            </svg>
          </div>
        </div>

        {error && <div style={{ position: "absolute", inset: 0, color: "#fff", padding: 12, fontSize: 13, zIndex: 7, background: "rgba(0,0,0,.6)" }}>No se pudo mostrar la comparación: {error}</div>}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 6, fontSize: 12 }}>
        <span style={{ color: "var(--tc-gray-600, #555)", marginRight: 2 }} title="Si las dos fotos no miran hacia el mismo lado, gire «antes» hasta que coincidan">
          Alinear «antes»:
        </span>
        <button style={boton} onClick={() => girar(giro - 5)} title="Girar la foto «antes» −5°">−5°</button>
        <button style={boton} onClick={() => girar(giro - 1)} title="Girar la foto «antes» −1°">−1°</button>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={giro}
          onChange={(e) => girar(Number(e.target.value))}
          aria-label="Giro de la foto «antes» en grados"
          style={{ flex: "1 1 90px", minWidth: 70 }}
        />
        <button style={boton} onClick={() => girar(giro + 1)} title="Girar la foto «antes» +1°">+1°</button>
        <button style={boton} onClick={() => girar(giro + 5)} title="Girar la foto «antes» +5°">+5°</button>
        <b style={{ minWidth: 42, textAlign: "right" }}>{giro.toLocaleString("es-CO")}°</b>
        {giro !== 0 && <button style={boton} onClick={() => girar(0)} title="Quitar el giro">0°</button>}
      </div>
    </div>
  );
}
