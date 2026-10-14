"use client";

import { CSSProperties, KeyboardEvent, useEffect, useRef, useState } from "react";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import { ContextoChat, SISTEMA_CHAT } from "../../lib/presupuesto/ia/chat";
import { estimarCostoCop, fmtCop } from "../../lib/presupuesto/ia/cupo";
import { EstadoCupo, EstadoIAResponse, MAX_HISTORIAL_CHAT, MAX_PREGUNTA_CHAT } from "../../lib/presupuesto/ia/tipos";
import { Aviso, bloqueadoPor, botonSec, conReintento, apagado } from "./AsistenteIAFases";
import { acceptButton, baseInput, message, Notice } from "./ui";

interface Mensaje {
  rol: "usuario" | "asistente";
  texto: string;
  /** The partidas the answer is about, to open them. */
  items?: { spId: string; itemId: string; etiqueta: string }[];
  costoCop?: number;
}

const SUGERENCIAS = [
  "¿Qué capítulos y partidas pesan más en el costo directo?",
  "¿Qué partidas no tienen análisis de precios, no tienen metrado o tienen insumos sin precio?",
  "¿Cuánto pesan la mano de obra, los materiales y los equipos en el costo directo?",
  "¿Qué insumos concentran la mayor parte del costo?",
  "Revisa los costos unitarios y señala los que parecen fuera de lo normal para obra en Colombia.",
];

// ---------------------------------------------------------------- phase 5: questions about the budget

/** Questions about the open budget; the conversation stays for the session (also after going to a partida). */
export function ChatIA({
  api,
  projectId,
  estado,
  contexto,
  irAPartida,
  onCupo,
}: {
  api: PresupuestoApi;
  projectId: string;
  estado: EstadoIAResponse;
  /** The budget as text, as it is now on screen. */
  contexto: () => ContextoChat;
  /** Closes the assistant and selects the partida in the budget. */
  irAPartida: (spId: string, itemId: string) => void;
  onCupo: (c: EstadoCupo) => void;
}) {
  const clave = `presupuesto.ia.chat.${projectId}`;
  const [mensajes, setMensajes] = useState<Mensaje[]>(() => {
    try {
      const guardado = JSON.parse(sessionStorage.getItem(clave) ?? "[]");
      return Array.isArray(guardado) ? guardado : [];
    } catch {
      return [];
    }
  });
  const [pregunta, setPregunta] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [resumen] = useState(() => contexto());
  const fondo = useRef<HTMLDivElement | null>(null);
  const bloqueo = bloqueadoPor(estado);

  useEffect(() => {
    try {
      sessionStorage.setItem(clave, JSON.stringify(mensajes));
    } catch {
      // storage unavailable
    }
    fondo.current?.scrollIntoView({ block: "end" });
  }, [clave, mensajes]);

  const historialChars = mensajes.slice(-MAX_HISTORIAL_CHAT).reduce((s, m) => s + m.texto.length, 0);
  const estimado = estimarCostoCop(estado.modelo, SISTEMA_CHAT.length + resumen.texto.length + historialChars + pregunta.length, 1500, estado.cupo.trm);

  async function enviar(texto: string) {
    const q = texto.trim();
    if (!q || ocupado) return;
    setOcupado(true);
    setError("");
    const previos = mensajes;
    setMensajes([...previos, { rol: "usuario", texto: q }]);
    setPregunta("");
    try {
      const ctx = contexto();
      const r = await conReintento(() =>
        api.chatIA({ pregunta: q, contexto: ctx.texto, historial: previos.slice(-MAX_HISTORIAL_CHAT).map((m) => ({ rol: m.rol, texto: m.texto })) })
      );
      onCupo(r.cupo);
      const items = r.items.flatMap((c) => {
        const x = ctx.refs.get(c);
        return x ? [x] : [];
      });
      setMensajes([...previos, { rol: "usuario", texto: q }, { rol: "asistente", texto: r.respuesta, items, costoCop: r.costoCop }]);
    } catch (err) {
      setError(message(err));
      setMensajes(previos);
      setPregunta(q);
    } finally {
      setOcupado(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviar(pregunta);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 0 }}>
      <Aviso estado={estado} />
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--tc-gray-500)", lineHeight: 1.45 }}>
        Pregunta sobre el presupuesto abierto: costos, capítulos, partidas incompletas, insumos o qué revisar. Solo lee: no cambia nada. Con cada pregunta se
        envía al proveedor de IA{estado.proveedor ? ` (${estado.proveedor}, modelo ${estado.modelo})` : ""} un resumen del presupuesto tal como está en
        pantalla: capítulos y partidas con metrado, costo unitario y parcial, el pie, los gastos generales y los insumos con sus precios ({resumen.texto.length.toLocaleString("es-CO")} caracteres
        {resumen.omitidas ? `; se omiten ${resumen.omitidas} partidas de menor valor para que quepa` : ""}). No se envían nombres de personas ni correos.
        {estado.proveedor === "Google" && " En el nivel gratuito de Google AI Studio, Google puede usar lo enviado para mejorar sus productos: no lo uses con presupuestos confidenciales."}
      </p>

      <div style={{ flex: 1, minHeight: 160, overflow: "auto", border: "1px solid #dfe4ea", borderRadius: 4, background: "#fff", padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        {mensajes.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
            <span style={{ color: "var(--tc-gray-500)" }}>Por ejemplo:</span>
            {SUGERENCIAS.map((s) => (
              <button key={s} type="button" style={{ ...sugerencia, ...(bloqueo || ocupado ? apagado : {}) }} disabled={!!bloqueo || ocupado} onClick={() => enviar(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {mensajes.map((m, i) =>
          m.rol === "usuario" ? (
            <div key={i} style={{ ...burbuja, alignSelf: "flex-end", background: "#e8f0fe" }}>
              {m.texto}
            </div>
          ) : (
            <div key={i} style={{ ...burbuja, alignSelf: "flex-start", background: "#f6f8fb", maxWidth: "92%" }}>
              {m.texto}
              {m.items && m.items.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {m.items.map((x) => (
                    <button key={x.itemId} type="button" style={enlace} title="Cerrar el asistente e ir a esta partida" onClick={() => irAPartida(x.spId, x.itemId)}>
                      {x.etiqueta.slice(0, 70)}
                    </button>
                  ))}
                </div>
              )}
              {m.costoCop !== undefined && <div style={{ fontSize: 11.5, color: "var(--tc-gray-500)", marginTop: 6 }}>Costo de esta respuesta: {fmtCop(m.costoCop)}</div>}
            </div>
          )
        )}
        {ocupado && <div style={{ ...burbuja, alignSelf: "flex-start", color: "var(--tc-gray-500)" }}>Pensando...</div>}
        <div ref={fondo} />
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          value={pregunta}
          maxLength={MAX_PREGUNTA_CHAT}
          onChange={(e) => setPregunta(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escribe tu pregunta (Enter para enviar, Shift+Enter para otra línea)"
          aria-label="Pregunta sobre el presupuesto"
          disabled={!!bloqueo}
          style={{ ...baseInput, flex: 1, minHeight: 54, resize: "vertical" }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch" }}>
          <button type="button" style={{ ...acceptButton, ...(bloqueo || ocupado || !pregunta.trim() ? apagado : {}) }} disabled={!!bloqueo || ocupado || !pregunta.trim()} onClick={() => enviar(pregunta)}>
            Enviar
          </button>
          <button type="button" style={botonSec} disabled={ocupado || !mensajes.length} onClick={() => setMensajes([])}>
            Nueva conversación
          </button>
        </div>
      </div>
      <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>Costo aproximado de la próxima pregunta: {fmtCop(estimado)} (puede variar; las siguientes de la misma conversación suelen costar menos).</span>
    </div>
  );
}

const burbuja: CSSProperties = { borderRadius: 8, padding: "8px 12px", fontSize: 13.5, lineHeight: 1.5, whiteSpace: "pre-wrap", maxWidth: "80%" };
const sugerencia: CSSProperties = { textAlign: "left", border: "1px solid #dfe4ea", background: "#f6f8fb", borderRadius: 14, padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, alignSelf: "flex-start" };
const enlace: CSSProperties = { border: "1px solid var(--tc-blue-500)", background: "#fff", color: "var(--tc-blue-700)", borderRadius: 12, padding: "2px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 12 };
