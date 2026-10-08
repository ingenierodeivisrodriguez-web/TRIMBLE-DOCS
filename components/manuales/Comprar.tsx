"use client";

import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { ManualesApi } from "../../lib/manuales/client";
import { fechaVisible, hoyIso, periodoComprado } from "../../lib/manuales/licencia";
import { IdPasarela, NOMBRE_PASARELA } from "../../lib/manuales/pasarelas";
import { etiquetaMeses, pesos } from "../../lib/manuales/textos";
import type { CompraIniciada, EstadoCompra, VentaPublica } from "../../lib/manuales/types";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The screen asks how the payment is going this often, for this long. */
const CADA_MS = 5_000;
const HASTA_MS = 30 * 60 * 1000;

/** How each gateway's button looks, and what it takes. */
const BOTONES: Record<IdPasarela, { fondo: string; borde: string; medios: string }> = {
  mercadopago: { fondo: "#009ee3", borde: "#0089c7", medios: "Tarjetas, PSE, Efecty" },
  wompi: { fondo: "#2c2a29", borde: "#000", medios: "Nequi, PSE, Bancolombia, tarjetas" },
};

/**
 * Buying (or renewing) the license to read the manuals: pick a plan and a
 * gateway (Mercado Pago or Wompi), pay in the gateway's tab, and this screen
 * opens the manuals by itself once the payment is approved.
 */
export default function Comprar({
  api,
  venta,
  vence,
  renovar = false,
  onListo,
}: {
  api: ManualesApi;
  venta: VentaPublica;
  /** The current license's expiry (undefined when the person has none). */
  vence?: string | null;
  renovar?: boolean;
  /** The license is active: reload the screen. */
  onListo: () => void;
}) {
  const [meses, setMeses] = useState(venta.planes[0]?.meses ?? 1);
  const [compra, setCompra] = useState<CompraIniciada | null>(null);
  const [seguimiento, setSeguimiento] = useState<EstadoCompra | null>(null);
  const [ocupado, setOcupado] = useState<IdPasarela | null>(null);
  const [error, setError] = useState("");
  const [bloqueada, setBloqueada] = useState(false);
  const [vencido, setVencido] = useState(false);
  const desde = useRef(0);

  const plan = venta.planes.find((p) => p.meses === meses) ?? venta.planes[0];
  const previsto = plan ? periodoComprado(vence, plan.meses, hoyIso())?.vence ?? null : null;

  async function pagar(pasarela: IdPasarela) {
    if (!plan) return;
    setError("");
    setBloqueada(false);
    // Opened on the click itself so the browser doesn't block it; filled once the checkout exists.
    const ventana = window.open("", "_blank");
    setOcupado(pasarela);
    try {
      const c = await api.comprar(plan.meses, pasarela);
      setCompra(c);
      setSeguimiento(null);
      setVencido(false);
      desde.current = Date.now();
      if (ventana) ventana.location.href = c.url;
      else setBloqueada(true);
    } catch (err) {
      ventana?.close();
      setError(message(err));
    } finally {
      setOcupado(null);
    }
  }

  const consultar = useCallback(async () => {
    if (!compra) return;
    try {
      const s = await api.compra(compra.orden);
      setSeguimiento(s);
    } catch {
      // A failed check is retried on the next turn.
    }
  }, [api, compra]);

  useEffect(() => {
    if (!compra || (seguimiento && seguimiento.estado !== "pendiente")) return;
    const id = window.setInterval(() => {
      if (Date.now() - desde.current > HASTA_MS) {
        setVencido(true);
        window.clearInterval(id);
        return;
      }
      consultar();
    }, CADA_MS);
    // Coming back from the gateway's tab: ask right away.
    const alVolver = () => {
      if (document.visibilityState === "visible") consultar();
    };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, [compra, seguimiento?.estado, consultar]);

  if (!venta.planes.length) return null;

  if (compra && seguimiento?.estado === "aprobada") {
    return (
      <div style={caja} role="status">
        <p style={{ ...titulo, color: "#1d6b2f" }}>¡Pago aprobado!</p>
        <p style={texto}>{seguimiento.vence ? `Tu acceso a los manuales quedó activo hasta el ${fechaVisible(seguimiento.vence)}.` : "Tu acceso a los manuales está activo."}</p>
        <button type="button" style={primario} onClick={onListo}>
          {renovar ? "Continuar" : "Abrir los manuales"}
        </button>
      </div>
    );
  }

  if (compra && (seguimiento?.estado === "revisar" || seguimiento?.estado === "reembolsada")) {
    return (
      <div style={caja} role="status">
        <p style={{ ...titulo, color: "#8a5300" }}>{seguimiento.estado === "revisar" ? "Recibimos tu pago" : "Pago reembolsado"}</p>
        <p style={texto}>
          {seguimiento.estado === "revisar"
            ? "El administrador de los manuales debe revisarlo antes de activar tu acceso."
            : "Este pago fue reembolsado y no activa el acceso."}
        </p>
      </div>
    );
  }

  if (compra) {
    const rechazado = seguimiento?.estadoPago === "rejected" || seguimiento?.estadoPago === "cancelled";
    return (
      <div style={caja}>
        <p style={titulo}>Completa el pago en {NOMBRE_PASARELA[compra.pasarela]}</p>
        <p style={texto}>
          {etiquetaMeses(compra.meses)} por <strong>{pesos(compra.monto, compra.moneda)}</strong>. Esta pantalla se actualiza sola cuando{" "}
          {NOMBRE_PASARELA[compra.pasarela]} aprueba el pago{compra.vence ? `, y tendrás acceso hasta el ${fechaVisible(compra.vence)}` : ""}.
        </p>
        {bloqueada && <p style={{ ...texto, color: "#8a5300" }}>El navegador no abrió la pestaña de pago: ábrela con el botón.</p>}
        <p style={{ ...texto, fontWeight: 600, color: rechazado ? "#8a1c14" : "var(--tc-blue-700)" }} aria-live="polite">
          {vencido
            ? "Dejamos de esperar el pago en esta pantalla. Si ya pagaste, tu acceso se activará solo: vuelve a abrir Manuales en unos minutos."
            : seguimiento?.estadoPago
              ? `${seguimiento.texto}${rechazado ? `. Puedes intentarlo de nuevo en la pestaña de ${NOMBRE_PASARELA[compra.pasarela]}, con otro medio de pago, o elegir otra forma de pago.` : "."}`
              : "Esperando el pago..."}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          <a href={compra.url} target="_blank" rel="noreferrer" style={{ ...primario, textDecoration: "none" }}>
            {bloqueada ? `Pagar con ${NOMBRE_PASARELA[compra.pasarela]}` : `Abrir ${NOMBRE_PASARELA[compra.pasarela]} de nuevo`}
          </a>
          <button type="button" style={secundario} onClick={consultar}>
            Ya pagué
          </button>
          <button
            type="button"
            style={secundario}
            onClick={() => {
              setCompra(null);
              setSeguimiento(null);
            }}
          >
            Elegir otro plan o medio de pago
          </button>
        </div>
      </div>
    );
  }

  const porMes = (precio: number, m: number) => (m > 1 ? ` · ${pesos(Math.round(precio / m), venta.moneda)} al mes` : "");
  return (
    <div style={caja}>
      <p style={titulo}>{renovar ? "Renovar mi acceso" : "Comprar acceso a los manuales"}</p>
      <div role="radiogroup" aria-label="Plan" style={{ display: "flex", flexDirection: "column", gap: 6, margin: "8px 0 10px", textAlign: "left" }}>
        {venta.planes.map((p) => (
          <label
            key={p.meses}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              border: `1px solid ${p.meses === meses ? "var(--tc-blue-600)" : "#dfe4ea"}`,
              background: p.meses === meses ? "var(--tc-blue-50)" : "#fff",
              borderRadius: 8,
              padding: "8px 12px",
              cursor: "pointer",
            }}
          >
            <input type="radio" name="plan" checked={p.meses === meses} onChange={() => setMeses(p.meses)} />
            <span style={{ flex: 1, fontSize: 14 }}>
              <strong>{etiquetaMeses(p.meses)}</strong>
              <span style={{ color: "var(--tc-gray-500)", fontSize: 12.5 }}>{porMes(p.precio, p.meses)}</span>
            </span>
            <strong style={{ fontSize: 15 }}>{pesos(p.precio, venta.moneda)}</strong>
          </label>
        ))}
      </div>
      {previsto && <p style={{ ...texto, fontSize: 13 }}>Tendrás acceso hasta el {fechaVisible(previsto)}.</p>}
      {error && <p style={{ ...texto, color: "#8a1c14" }}>{error}</p>}
      {plan && <p style={{ ...texto, fontWeight: 600, marginBottom: 6 }}>Pagar {pesos(plan.precio, venta.moneda)} con:</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        {venta.pasarelas.map((p) => {
          const b = BOTONES[p.id];
          return (
            <button
              key={p.id}
              type="button"
              style={{ ...primario, background: b.fondo, border: `1px solid ${b.borde}`, flex: "1 1 170px", maxWidth: 240, opacity: ocupado && ocupado !== p.id ? 0.6 : 1 }}
              onClick={() => pagar(p.id)}
              disabled={!!ocupado}
            >
              <span style={{ display: "block", fontSize: 15 }}>{ocupado === p.id ? "Preparando el pago..." : p.nombre}</span>
              <span style={{ display: "block", fontSize: 11.5, fontWeight: 400, opacity: 0.9 }}>{b.medios}</span>
            </button>
          );
        })}
      </div>
      <p style={{ ...texto, fontSize: 12, color: "var(--tc-gray-500)", marginTop: 8, marginBottom: 0 }}>
        El pago se hace en la página de la pasarela que elijas. Tu acceso se activa solo, con tu correo de Trimble Connect, al aprobarse el pago.
        {venta.pasarelas.some((p) => p.prueba)
          ? ` Modo de prueba (${venta.pasarelas
              .filter((p) => p.prueba)
              .map((p) => p.nombre)
              .join(", ")}): los pagos son simulados.`
          : ""}
      </p>
    </div>
  );
}

const caja: CSSProperties = { marginTop: 16, padding: "14px 16px", border: "1px solid #dfe4ea", borderRadius: 10, background: "#fbfcfe", textAlign: "center" };
const titulo: CSSProperties = { margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "var(--tc-blue-900)" };
const texto: CSSProperties = { margin: "0 0 10px", fontSize: 14, lineHeight: 1.5, color: "var(--tc-gray-700)" };
const primario: CSSProperties = {
  display: "inline-block",
  border: "1px solid var(--tc-blue-700)",
  background: "var(--tc-blue-600)",
  color: "#fff",
  borderRadius: 5,
  padding: "8px 16px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
const secundario: CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  background: "#fff",
  color: "var(--tc-blue-700)",
  borderRadius: 5,
  padding: "7px 12px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
