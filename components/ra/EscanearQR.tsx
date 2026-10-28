"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import { codigoDeLectura } from "../../lib/ra/calibracion";
import { BASE_PUBLICA } from "../../lib/ra/codigo";

const AZUL = "#2f55b0";

// The browser's own QR reader (Chrome on Android); not in TypeScript's DOM types yet.
type Detector = { detect(fuente: CanvasImageSource): Promise<{ rawValue: string }[]> };
type ConstructorDetector = new (o: { formats: string[] }) => Detector;

/**
 * "ESCANEAR QR": opens the phone's back camera ready to read a QR sheet and
 * goes to its page. Only QR codes of this app are followed.
 */
export default function EscanearQR() {
  const video = useRef<HTMLVideoElement>(null);
  const [estado, setEstado] = useState<"iniciando" | "leyendo" | "sin-lector" | "error">("iniciando");
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    let flujo: MediaStream | null = null;
    let vivo = true;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const Clase = (window as unknown as { BarcodeDetector?: ConstructorDetector }).BarcodeDetector;
      if (!Clase) return setEstado("sin-lector");
      try {
        flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch {
        if (vivo) setEstado("error");
        return;
      }
      if (!vivo || !video.current) return flujo.getTracks().forEach((t) => t.stop());
      video.current.srcObject = flujo;
      await video.current.play().catch(() => {});
      setEstado("leyendo");
      const detector = new Clase({ formats: ["qr_code"] });
      const origenes = [window.location.origin, BASE_PUBLICA];
      const leer = async () => {
        if (!vivo || !video.current) return;
        try {
          for (const c of await detector.detect(video.current)) {
            const codigo = codigoDeLectura(c.rawValue, origenes);
            if (codigo) {
              vivo = false;
              flujo?.getTracks().forEach((t) => t.stop());
              window.location.href = `/ra/q/${codigo}`;
              return;
            }
            setAviso("Ese QR no es de un punto de realidad aumentada.");
          }
        } catch {
          // A frame that could not be read: try the next one.
        }
        temporizador = setTimeout(leer, 250);
      };
      leer();
    })();
    return () => {
      vivo = false;
      clearTimeout(temporizador);
      flujo?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif", color: "#1f2937", lineHeight: 1.45 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: AZUL }}>REALIDAD AUMENTADA</div>
      <h1 style={{ fontSize: 22, margin: "4px 0 10px" }}>Escanear QR</h1>
      {estado === "sin-lector" && (
        <div style={caja}>Este navegador no lee QR por sí mismo. Abra la cámara del celular, apunte a la hoja del QR y toque el enlace que aparece.</div>
      )}
      {estado === "error" && (
        <div style={{ ...caja, borderColor: "#b3261e", background: "#fdecea" }}>No se pudo abrir la cámara. Revise que le dio permiso a Chrome para usarla y recargue la página.</div>
      )}
      <div style={{ position: "relative", borderRadius: 10, overflow: "hidden", background: "#111", display: estado === "sin-lector" || estado === "error" ? "none" : "block" }}>
        <video ref={video} muted playsInline style={{ width: "100%", display: "block", aspectRatio: "3 / 4", objectFit: "cover" }} />
        <div style={{ position: "absolute", inset: "18%", border: "3px solid #ffd400", borderRadius: 12, boxShadow: "0 0 0 2000px rgba(0,0,0,.35)" }} />
      </div>
      {(estado === "iniciando" || estado === "leyendo") && (
        <p style={{ fontSize: 14, color: "#4b5563" }}>{estado === "iniciando" ? "Abriendo la cámara…" : "Apunte al QR de la hoja pegada en el muro; se abre solo al leerlo."}</p>
      )}
      {aviso && <div style={{ ...caja, borderColor: "#d4b106", background: "#fff8db" }}>{aviso}</div>}
    </main>
  );
}

const caja: CSSProperties = { border: "1px solid #dfe4ea", borderRadius: 8, padding: 12, margin: "10px 0", background: "#fff" };
