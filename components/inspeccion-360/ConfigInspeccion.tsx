"use client";

// Configuration (project administrators): the project's short code and who else, besides the
// administrators, creates points and uploads photos.

import { useEffect, useState } from "react";
import type { I360Api } from "../../lib/inspeccion-360/client";
import { normalizarSegmento } from "../../lib/inspeccion-360/codigos";
import type { ConfigI360 } from "../../lib/inspeccion-360/types";
import { acceptButton, baseInput, labelStyle, linkButton, message, Notice } from "../presupuesto/ui";

export default function ConfigInspeccion({ api, config, hayPuntos, alGuardar, alCerrar }: { api: I360Api; config: ConfigI360; hayPuntos: boolean; alGuardar: (c: ConfigI360) => void; alCerrar: () => void }) {
  const [codigo, setCodigo] = useState(config.codigoProyecto ?? "");
  const [editores, setEditores] = useState<string[]>(config.editores);
  const [miembros, setMiembros] = useState<{ id: string; nombre: string }[] | null>(null);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const fijo = Boolean(config.codigoProyecto) && hayPuntos;

  useEffect(() => {
    api.miembros().then(setMiembros, (err) => setError(message(err)));
  }, [api]);

  async function guardar() {
    setGuardando(true);
    setError("");
    try {
      alGuardar(await api.guardarConfig({ codigoProyecto: normalizarSegmento(codigo) || null, editores, version: config.version }));
    } catch (err) {
      setError(message(err));
      setGuardando(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--tc-gray-300)", borderRadius: 6, padding: 10, marginTop: 8, background: "#fbfcfe" }}>
      <b style={{ fontSize: 13 }}>Configuración de Inspección 360°</b>
      <label style={{ ...labelStyle, marginTop: 8 }}>Código del proyecto (2 a 6 letras o números)</label>
      <input value={codigo} onChange={(e) => setCodigo(e.target.value)} disabled={fijo} placeholder="MAL" maxLength={12} style={{ ...baseInput, width: 120 }} />
      <p style={{ fontSize: 11.5, color: "var(--tc-gray-500)", margin: "4px 0 0" }}>
        {fijo ? "Ya está en los códigos de los puntos: no se puede cambiar." : "Es el comienzo de todos los códigos de punto: MAL-TR1-P05-APT501-C01."}
      </p>
      <label style={{ ...labelStyle, marginTop: 10 }}>Editores (crean puntos y suben fotos, además de los administradores)</label>
      {!miembros && !error && <p style={{ fontSize: 12 }}>Cargando el equipo del proyecto…</p>}
      {miembros && (
        <div style={{ maxHeight: 180, overflow: "auto", border: "1px solid var(--tc-gray-200)", borderRadius: 4, padding: 6 }}>
          {miembros.map((m) => (
            <label key={m.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, padding: "2px 0" }}>
              <input type="checkbox" checked={editores.includes(m.id)} onChange={(e) => setEditores((l) => (e.target.checked ? [...l, m.id] : l.filter((x) => x !== m.id)))} />
              {m.nombre}
            </label>
          ))}
        </div>
      )}
      {error && <Notice kind="error" style={{ marginTop: 8 }}>{error}</Notice>}
      <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
        <button style={linkButton} onClick={alCerrar} disabled={guardando}>Cerrar</button>
        <button style={{ ...acceptButton, padding: "6px 14px", fontSize: 13 }} onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
      </div>
    </div>
  );
}
