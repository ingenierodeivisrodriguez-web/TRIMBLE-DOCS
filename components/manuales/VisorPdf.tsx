"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";

type Zoom = "ancho" | number;

/**
 * Draws a PDF with pdf.js: Trimble Connect sandboxes extension frames and
 * Chrome's own PDF viewer refuses to run inside them ("Chrome ha bloqueado
 * esta página"), so the pages are rendered onto canvases as they scroll in.
 */
export default function VisorPdf({ datos, nombre }: { datos: Blob; nombre: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [base, setBase] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState<Zoom>("ancho");
  const [ancho, setAncho] = useState(800);
  const contenedor = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let vivo = true;
    let tarea: PDFDocumentLoadingTask | null = null;
    setDoc(null);
    setError("");
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        tarea = pdfjs.getDocument({ data: new Uint8Array(await datos.arrayBuffer()) });
        const d = await tarea.promise;
        const p1 = await d.getPage(1);
        const v = p1.getViewport({ scale: 1 });
        if (!vivo) return;
        setBase({ w: v.width, h: v.height });
        setDoc(d);
      } catch (err) {
        if (vivo) setError(`No se pudo abrir el PDF: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
    return () => {
      vivo = false;
      tarea?.destroy();
    };
  }, [datos]);

  useEffect(() => {
    const el = contenedor.current;
    if (!el) return;
    const medir = () => setAncho(el.clientWidth || 800);
    medir();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const escala = !base ? 1 : zoom === "ancho" ? Math.max(0.2, (ancho - 36) / base.w) : zoom;
  const cambiar = (factor: number) => setZoom((z) => Math.min(5, Math.max(0.25, Math.round((z === "ancho" ? escala : z) * factor * 100) / 100)));

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "#3c4550", color: "#fff", fontSize: 13 }}>
        <span style={{ flex: 1 }}>{doc ? `${doc.numPages} página${doc.numPages === 1 ? "" : "s"}` : error ? "" : "Abriendo..."}</span>
        <button type="button" style={boton} onClick={() => cambiar(1 / 1.2)} aria-label="Alejar" disabled={!doc}>
          −
        </button>
        <span style={{ minWidth: 48, textAlign: "center" }}>{Math.round(escala * 100)}%</span>
        <button type="button" style={boton} onClick={() => cambiar(1.2)} aria-label="Acercar" disabled={!doc}>
          +
        </button>
        <button type="button" style={{ ...boton, width: "auto", padding: "0 10px" }} onClick={() => setZoom("ancho")} disabled={!doc}>
          Ajustar al ancho
        </button>
      </div>
      <div ref={contenedor} style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#e3e7ec", padding: "14px 0" }} aria-label={nombre}>
        {error && <p style={{ textAlign: "center", color: "#8a1c14", padding: 20 }}>{error}</p>}
        {doc &&
          base &&
          Array.from({ length: doc.numPages }, (_, i) => <Pagina key={i} doc={doc} numero={i + 1} escala={escala} base={base} raiz={contenedor} />)}
      </div>
    </div>
  );
}

/** A page: drawn when it comes near the visible area, and again when the zoom changes. */
function Pagina({
  doc,
  numero,
  escala,
  base,
  raiz,
}: {
  doc: PDFDocumentProxy;
  numero: number;
  escala: number;
  base: { w: number; h: number };
  raiz: React.RefObject<HTMLDivElement | null>;
}) {
  const caja = useRef<HTMLDivElement | null>(null);
  const lienzo = useRef<HTMLCanvasElement | null>(null);
  const [visible, setVisible] = useState(numero <= 2);
  const [tam, setTam] = useState(base);

  useEffect(() => {
    const el = caja.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), {
      root: raiz.current,
      rootMargin: "600px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [raiz]);

  useEffect(() => {
    if (!visible) return;
    let tarea: RenderTask | null = null;
    let vivo = true;
    (async () => {
      const page = await doc.getPage(numero);
      if (!vivo || !lienzo.current) return;
      const v1 = page.getViewport({ scale: 1 });
      setTam({ w: v1.width, h: v1.height });
      const viewport = page.getViewport({ scale: escala });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = lienzo.current;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      tarea = page.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      await tarea.promise.catch(() => undefined); // cancelled when the zoom changes again
    })();
    return () => {
      vivo = false;
      tarea?.cancel();
    };
  }, [visible, doc, numero, escala]);

  const w = Math.floor(tam.w * escala);
  const h = Math.floor(tam.h * escala);
  return (
    <div ref={caja} style={{ width: w, height: h, margin: "0 auto 12px", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.25)" }}>
      <canvas ref={lienzo} style={{ width: w, height: h, display: "block" }} aria-label={`Página ${numero}`} />
    </div>
  );
}

const boton: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.4)",
  background: "transparent",
  color: "#fff",
  borderRadius: 4,
  width: 28,
  height: 24,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 14,
};
