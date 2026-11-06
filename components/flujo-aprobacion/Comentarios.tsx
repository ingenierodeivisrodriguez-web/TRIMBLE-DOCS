"use client";

import { useEffect, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import type { Comentario } from "../../lib/flujo-aprobacion/types";
import { texto } from "../compras/estilos";
import { acceptButton, baseInput, message, Notice } from "../presupuesto/ui";

/** A flow's comments, as in Trimble: anyone in the project adds one; they are never edited or deleted. */
export default function Comentarios({ api, flujoId }: { api: FlujoApi; flujoId: string }) {
  const [lista, setLista] = useState<Comentario[] | null>(null);
  const [nuevo, setNuevo] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vigente = true;
    setLista(null);
    api
      .comentarios(flujoId)
      .then((r) => vigente && (setLista(r.comentarios), setError("")))
      .catch((err) => vigente && setError(message(err)));
    return () => {
      vigente = false;
    };
  }, [api, flujoId]);

  async function enviar() {
    if (!nuevo.trim()) return;
    setOcupado(true);
    setError("");
    try {
      setLista((await api.comentar(flujoId, nuevo)).comentarios);
      setNuevo("");
    } catch (err) {
      setError(message(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div>
      {lista && lista.length === 0 && <p style={{ ...texto, margin: "0 0 8px", fontSize: 13.5, color: "var(--tc-gray-500)" }}>No hay comentarios todavía.</p>}
      {lista && lista.length > 0 && (
        <ul style={{ margin: "0 0 8px", paddingLeft: 0, listStyle: "none", display: "grid", gap: 8 }}>
          {lista.map((c) => (
            <li key={c.id} style={{ background: "#f6f8fb", borderRadius: 6, padding: "6px 10px" }}>
              <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>
                <strong style={{ color: "var(--tc-gray-700)" }}>{c.usuario ?? "—"}</strong> · {fechaHora(c.creado)}
              </div>
              <div style={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>{c.texto}</div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <Notice kind="error" style={{ marginBottom: 6 }}>
          {error}
        </Notice>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
        <textarea
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void enviar();
            }
          }}
          maxLength={2000}
          rows={2}
          placeholder="Añadir un comentario…"
          style={{ ...baseInput, flex: 1, resize: "vertical", fontSize: 13.5 }}
          aria-label="Añadir un comentario"
        />
        <button type="button" onClick={() => void enviar()} disabled={ocupado || !nuevo.trim()} style={{ ...acceptButton, padding: "6px 12px", fontSize: 13.5, opacity: ocupado || !nuevo.trim() ? 0.5 : 1 }}>
          {ocupado ? "…" : "Enviar"}
        </button>
      </div>
      <p style={{ fontSize: 12, color: "var(--tc-gray-500)", margin: "4px 0 0" }}>Enter envía; Mayús + Enter hace un salto de línea. Los comentarios no se editan ni se borran.</p>
    </div>
  );
}
