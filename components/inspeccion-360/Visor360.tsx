"use client";

// The 360° viewer (Photo Sphere Viewer, MIT, chosen in the plan's entregable 2). Loaded only when a
// photo is opened: it brings its own copy of three.js. It can show the neighbouring capture points
// as markers on the floor (a click walks there), take a click on the photo (to calibrate the
// rumbo) and open a photo looking a given way (when arriving from another point).

import "@photo-sphere-viewer/core/index.css";
import "@photo-sphere-viewer/markers-plugin/index.css";
import type { Viewer as VisorPSV } from "@photo-sphere-viewer/core";
import type { MarkerConfig, MarkersPlugin } from "@photo-sphere-viewer/markers-plugin";
import { useEffect, useRef, useState } from "react";
import { giroEnRadianes } from "../../lib/inspeccion-360/comparar";

export const LANG = {
  zoom: "Zoom",
  zoomOut: "Alejar",
  zoomIn: "Acercar",
  moveUp: "Arriba",
  moveDown: "Abajo",
  moveLeft: "Izquierda",
  moveRight: "Derecha",
  fullscreen: "Pantalla completa",
  menu: "Menú",
  close: "Cerrar",
  twoFingers: "Use dos dedos para moverse",
  ctrlZoom: "Use Ctrl + rueda para acercar",
  loadError: "La foto no se pudo cargar",
  webglError: "El navegador no puede mostrar fotos 360 (WebGL)",
};

/** Where the camera looks (radians) and its zoom (0–100). */
export interface VistaFoto {
  yaw: number;
  pitch: number;
  zoom: number;
}

/** A neighbouring point drawn on the photo. */
export interface MarcadorPunto {
  puntoId: string;
  yaw: number;
  pitch: number;
  /** Short text inside the marker (C02). */
  etiqueta: string;
  /** Tooltip (code, space, distance). */
  detalle: string;
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function htmlMarcador(etiqueta: string): string {
  return (
    `<div style="width:46px;height:46px;border-radius:50%;background:rgba(239,108,0,.88);border:3px solid #fff;` +
    `box-shadow:0 2px 10px rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;` +
    `color:#fff;font:700 12px system-ui,sans-serif;cursor:pointer">${esc(etiqueta)}</div>`
  );
}

const MARCA_CALIBRACION =
  `<div style="width:30px;height:30px;border-radius:50%;border:3px solid #ff1744;box-shadow:0 0 0 2px #fff;` +
  `background:rgba(255,23,68,.18)"></div>`;

export default function Visor360({
  url,
  titulo,
  alto = 240,
  giro = 0,
  vista,
  marcadores,
  alElegirMarcador,
  alClicFoto,
  marcaCalibracion,
  alMoverCamara,
}: {
  url: string;
  titulo?: string;
  alto?: number | string;
  /** The photo's saved alignment turn in degrees (the same one the comparison uses). */
  giro?: number;
  /** Where to look when this photo opens (arriving from another point); without it the camera stays. */
  vista?: VistaFoto;
  marcadores?: MarcadorPunto[];
  alElegirMarcador?: (puntoId: string) => void;
  /** While set, a click on the photo reports where it was (to calibrate the rumbo). */
  alClicFoto?: (p: { yaw: number; pitch: number }) => void;
  /** The spot clicked while calibrating. */
  marcaCalibracion?: { yaw: number; pitch: number } | null;
  alMoverCamara?: (v: VistaFoto) => void;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const visor = useRef<VisorPSV | null>(null);
  const plugin = useRef<MarkersPlugin | null>(null);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState("");
  const ultimos = useRef({ giro, vista, alElegirMarcador, alClicFoto, alMoverCamara });
  ultimos.current = { giro, vista, alElegirMarcador, alClicFoto, alMoverCamara };

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const [{ Viewer }, { MarkersPlugin: Marcas }] = await Promise.all([import("@photo-sphere-viewer/core"), import("@photo-sphere-viewer/markers-plugin")]);
        if (cancelado || !contenedor.current) return;
        const { giro: g, vista: v } = ultimos.current;
        const correccion = { pan: giroEnRadianes(g) };
        if (!visor.current) {
          const nuevo = new Viewer({
            container: contenedor.current,
            panorama: url,
            caption: titulo,
            loadingTxt: "Cargando foto 360…",
            navbar: ["zoom", "move", "caption", "fullscreen"],
            defaultZoomLvl: v ? v.zoom : 0,
            defaultYaw: v ? v.yaw : 0,
            defaultPitch: v ? v.pitch : 0,
            touchmoveTwoFingers: false,
            mousewheelCtrlKey: false,
            lang: LANG,
            sphereCorrection: correccion,
            plugins: [[Marcas, {}]],
          });
          visor.current = nuevo;
          plugin.current = nuevo.getPlugin<MarkersPlugin>(Marcas);
          plugin.current.addEventListener("select-marker", ({ marker }) => {
            if (typeof marker.id === "string" && marker.id.startsWith("p:")) ultimos.current.alElegirMarcador?.(marker.id.slice(2));
          });
          nuevo.addEventListener("click", ({ data }) => {
            if (!data.rightclick) ultimos.current.alClicFoto?.({ yaw: data.yaw, pitch: data.pitch });
          });
          const avisar = () => {
            const p = nuevo.getPosition();
            ultimos.current.alMoverCamara?.({ yaw: p.yaw, pitch: p.pitch, zoom: nuevo.getZoomLevel() });
          };
          nuevo.addEventListener("position-updated", avisar);
          nuevo.addEventListener("zoom-updated", avisar);
          nuevo.addEventListener("ready", avisar, { once: true });
          setListo(true);
        } else {
          await visor.current.setPanorama(url, {
            caption: titulo,
            transition: false,
            sphereCorrection: correccion,
            ...(v ? { position: { yaw: v.yaw, pitch: v.pitch }, zoom: v.zoom } : {}),
          });
        }
      } catch (err) {
        if (!cancelado) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [url, titulo]);

  useEffect(() => {
    visor.current?.setOption("sphereCorrection", { pan: giroEnRadianes(giro) });
  }, [giro]);

  // Neighbours on the floor (hidden while waiting for the calibration click) and the calibration spot.
  useEffect(() => {
    if (!listo || !plugin.current) return;
    const lista: MarkerConfig[] = [];
    if (marcaCalibracion) {
      lista.push({ id: "calibracion", position: marcaCalibracion, html: MARCA_CALIBRACION, size: { width: 30, height: 30 }, anchor: "center center" });
    }
    if (!alClicFoto) {
      for (const m of marcadores ?? []) {
        lista.push({
          id: `p:${m.puntoId}`,
          position: { yaw: m.yaw, pitch: m.pitch },
          html: htmlMarcador(m.etiqueta),
          size: { width: 46, height: 46 },
          anchor: "center center",
          tooltip: { content: esc(m.detalle), position: "top center" },
        });
      }
    }
    plugin.current.setMarkers(lista);
  }, [listo, marcadores, marcaCalibracion, alClicFoto]);

  useEffect(
    () => () => {
      visor.current?.destroy();
      visor.current = null;
      plugin.current = null;
    },
    [],
  );

  return (
    <div style={{ position: "relative", width: "100%", height: alto, background: "#111", borderRadius: 4, overflow: "hidden", cursor: alClicFoto ? "crosshair" : undefined }}>
      <div ref={contenedor} style={{ width: "100%", height: "100%" }} />
      {error && <div style={{ position: "absolute", inset: 0, color: "#fff", padding: 12, fontSize: 13 }}>No se pudo mostrar la foto: {error}</div>}
    </div>
  );
}
