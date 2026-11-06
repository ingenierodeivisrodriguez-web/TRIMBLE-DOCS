"use client";

import { useEffect, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import { ACCIONES } from "../../lib/flujo-aprobacion/trazabilidad";
import type { EntradaHistorial } from "../../lib/flujo-aprobacion/types";
import { texto } from "../compras/estilos";
import { message, Notice } from "../presupuesto/ui";

/**
 * A flow's history, newest first, inside its side panel: who created and
 * changed it, assignments, uploads, decisions with their comments, notices and
 * copies to the destination. It is never edited or deleted.
 */
export default function Historial({ api, flujoId, recarga }: { api: FlujoApi; flujoId: string; recarga: number }) {
  const [entradas, setEntradas] = useState<EntradaHistorial[] | null>(null);
  const [error, setError] = useState("");
  const [todas, setTodas] = useState(false);

  useEffect(() => {
    let vigente = true;
    api
      .historial(flujoId)
      .then((r) => vigente && (setEntradas(r.entradas), setError("")))
      .catch((err) => vigente && setError(message(err)));
    return () => {
      vigente = false;
    };
  }, [api, flujoId, recarga]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!entradas) return <p style={{ ...texto, margin: 0 }}>Cargando…</p>;
  if (!entradas.length) return <p style={{ ...texto, margin: 0 }}>Todavía no hay nada en el historial.</p>;
  const visibles = todas ? entradas : entradas.slice(0, 15);
  return (
    <div>
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 6, fontSize: 13 }}>
        {visibles.map((e) => (
          <li key={e.id} style={{ borderBottom: "1px solid #eef1f5", paddingBottom: 5 }}>
            <div style={{ color: "var(--tc-gray-500)", fontSize: 12 }} title={e.ocurrido ? `Anotado el ${fechaHora(e.creado)}` : undefined}>
              {fechaHora(e.ocurrido ?? e.creado)}
              {e.usuario ? ` · ${e.usuario}` : ""} · <strong style={{ color: "var(--tc-gray-700)" }}>{ACCIONES[e.accion] ?? e.accion}</strong>
            </div>
            <div style={{ color: "var(--tc-gray-700)" }}>{e.detalle}</div>
          </li>
        ))}
      </ul>
      {entradas.length > 15 && (
        <button type="button" onClick={() => setTodas(!todas)} style={{ border: "none", background: "transparent", color: "var(--tc-blue-700)", textDecoration: "underline", cursor: "pointer", padding: "6px 0 0", font: "inherit", fontSize: 13 }}>
          {todas ? "Ver menos" : `Ver las ${entradas.length} entradas`}
        </button>
      )}
    </div>
  );
}
