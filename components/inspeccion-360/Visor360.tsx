"use client";

// The 360° viewer (Photo Sphere Viewer, MIT, chosen in the plan's entregable 2). Loaded only when a
// photo is opened: it brings its own copy of three.js.

import "@photo-sphere-viewer/core/index.css";
import { useEffect, useRef, useState } from "react";

type ViewerPSV = { setPanorama(url: string, o?: { caption?: string; transition?: boolean | number }): Promise<boolean>; destroy(): void };

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

export default function Visor360({ url, titulo, alto = 240 }: { url: string; titulo?: string; alto?: number | string }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const visor = useRef<ViewerPSV | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const { Viewer } = await import("@photo-sphere-viewer/core");
        if (cancelado || !contenedor.current) return;
        if (!visor.current) {
          visor.current = new Viewer({
            container: contenedor.current,
            panorama: url,
            caption: titulo,
            loadingTxt: "Cargando foto 360…",
            navbar: ["zoom", "move", "caption", "fullscreen"],
            defaultZoomLvl: 0,
            touchmoveTwoFingers: false,
            mousewheelCtrlKey: false,
            lang: LANG,
          }) as unknown as ViewerPSV;
        } else {
          await visor.current.setPanorama(url, { caption: titulo, transition: false });
        }
      } catch (err) {
        if (!cancelado) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [url, titulo]);

  useEffect(
    () => () => {
      visor.current?.destroy();
      visor.current = null;
    },
    [],
  );

  return (
    <div style={{ position: "relative", width: "100%", height: alto, background: "#111", borderRadius: 4, overflow: "hidden" }}>
      <div ref={contenedor} style={{ width: "100%", height: "100%" }} />
      {error && <div style={{ position: "absolute", inset: 0, color: "#fff", padding: 12, fontSize: 13 }}>No se pudo mostrar la foto: {error}</div>}
    </div>
  );
}
