"use client";

import { CSSProperties, useEffect, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import { tamanoLegible } from "../../lib/ra/limites";
import type { PublicoResponse } from "../../lib/ra/types";
import VisorCelular from "./VisorCelular";

const AZUL = "#2f55b0";

const NO_ABRE: Record<string, { titulo: string; detalle: string }> = {
  "no-existe": { titulo: "Este QR no existe", detalle: "Revise que escaneó la hoja correcta o pida una nueva a quien maneja el modelo." },
  vencido: { titulo: "Este QR ya venció", detalle: "Pida a quien maneja el modelo en Trimble Connect que cree uno nuevo." },
  anulado: { titulo: "Este QR fue anulado", detalle: "Ya no abre el modelo. Si la hoja sigue pegada en obra, retírela." },
  "sin-modelo": { titulo: "El modelo de este QR ya no está", detalle: "Se eliminó por falta de uso o a mano. Hay que prepararlo de nuevo en Trimble Connect y crear otro QR." },
};

/**
 * Phone page of a scanned QR: says whether it opens and what it is, and for an
 * active wall QR shows the model in AR (phase 3).
 */
export default function QrCelular({ codigo }: { codigo: string }) {
  const [r, setR] = useState<PublicoResponse | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/ra/publico/${encodeURIComponent(codigo)}`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
        setR(body as PublicoResponse);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [codigo]);

  const malo = r && r.estado !== "activo" ? NO_ABRE[r.estado] : null;

  return (
    <main style={{ maxWidth: 520, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif", color: "#1f2937", lineHeight: 1.45 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.5, color: AZUL }}>REALIDAD AUMENTADA</div>
      {!r && !error && <p>Revisando el QR…</p>}
      {error && <div style={{ ...caja, borderColor: "#b3261e", background: "#fdecea" }}>{error}</div>}
      {malo && (
        <div style={{ ...caja, borderColor: "#b3261e", background: "#fdecea" }}>
          <h1 style={{ fontSize: 20, margin: "0 0 4px" }}>{malo.titulo}</h1>
          {r?.nombre && <p style={{ margin: "0 0 4px" }}>Punto: {r.nombre}</p>}
          <p style={{ margin: 0 }}>{malo.detalle}</p>
        </div>
      )}
      {r?.estado === "activo" && r.modelo && (
        <>
          <h1 style={{ fontSize: 22, margin: "4px 0 8px" }}>{r.nombre}</h1>
          <div style={caja}>
            <div>
              Modelo: <b>{r.modelo.nombre}</b>
            </div>
            <div style={{ color: "#4b5563", fontSize: 14 }}>
              {r.modelo.elementos.toLocaleString("en-US")} elementos · descarga de {tamanoLegible(r.modelo.bytes)}
            </div>
            {r.vence && <div style={{ color: "#4b5563", fontSize: 14 }}>Este QR abre hasta el {fechaHora(r.vence).slice(0, 10)}.</div>}
          </div>
          {r.referencia && <p style={{ fontSize: 14, color: "#4b5563", margin: "0 0 4px" }}>La hoja va pegada en: {r.referencia}.</p>}
          {r.montaje === "muro" ? (
            <VisorCelular codigo={codigo} bytes={r.modelo.bytes} />
          ) : (
            <div style={{ ...caja, background: "#fff8db", borderColor: "#d4b106" }}>Este es un QR de prueba con la hoja en el piso: pida uno nuevo pegado en un muro.</div>
          )}
        </>
      )}
      <p style={{ marginTop: 18 }}>
        <a href="/ra/escanear" style={{ color: AZUL, fontWeight: 600 }}>
          Escanear otro QR
        </a>
        {" · "}
        <a href="/ra/guia" style={{ color: AZUL, fontWeight: 600 }}>
          Guía de uso
        </a>
      </p>
    </main>
  );
}

const caja: CSSProperties = { border: "1px solid #dfe4ea", borderRadius: 8, padding: 12, margin: "10px 0", background: "#fff" };
