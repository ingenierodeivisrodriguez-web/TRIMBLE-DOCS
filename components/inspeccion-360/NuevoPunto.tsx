"use client";

// The form of a new capture point, after the person clicked the floor where the tripod goes.

import { useMemo, useState } from "react";
import type { I360Api } from "../../lib/inspeccion-360/client";
import { errorSegmento, normalizarSegmento, siguienteNumero } from "../../lib/inspeccion-360/codigos";
import { ALTURA_INICIAL_M, type PuntoVista, type Vec3 } from "../../lib/inspeccion-360/types";
import { acceptButton, baseInput, labelStyle, linkButton, message, Notice } from "../presupuesto/ui";

export interface Toque {
  piso3d: Vec3;
  modelId: string;
  versionId: string | null;
}

export default function NuevoPunto({
  api,
  codigoProyecto,
  toque,
  puntos,
  sugerencia,
  alGuardar,
  alCancelar,
}: {
  api: I360Api;
  codigoProyecto: string;
  toque: Toque;
  puntos: PuntoVista[];
  sugerencia: { torre: string; piso: string; unidad: string } | null;
  alGuardar: (p: PuntoVista) => void;
  alCancelar: () => void;
}) {
  const [torre, setTorre] = useState(sugerencia?.torre ?? "");
  const [piso, setPiso] = useState(sugerencia?.piso ?? "");
  const [unidad, setUnidad] = useState(sugerencia?.unidad ?? "");
  const [espacio, setEspacio] = useState("");
  const [zona, setZona] = useState("");
  const [referencia, setReferencia] = useState("");
  const [altura, setAltura] = useState(String(ALTURA_INICIAL_M));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const partes = { torre: normalizarSegmento(torre), piso: normalizarSegmento(piso), unidad: normalizarSegmento(unidad) };
  const errores = (["torre", "piso", "unidad"] as const).map((k) => (partes[k] ? errorSegmento(k, partes[k]) : "")).filter(Boolean);
  const completo = partes.torre && partes.piso && partes.unidad && errores.length === 0;
  const numero = useMemo(() => siguienteNumero(puntos, partes.torre, partes.piso, partes.unidad), [puntos, partes.torre, partes.piso, partes.unidad]);
  const codigo = completo ? `${codigoProyecto}-${partes.torre}-${partes.piso}-${partes.unidad}-C${String(numero).padStart(2, "0")}` : "";

  async function guardar() {
    const h = Number(altura.replace(",", "."));
    if (!Number.isFinite(h) || h < 0.5 || h > 2.5) return setError("La altura del trípode va de 0,50 a 2,50 m.");
    setGuardando(true);
    setError("");
    try {
      alGuardar(await api.crearPunto({ ...partes, espacio, zona, referenciaFisica: referencia, alturaM: h, modelId: toque.modelId, versionId: toque.versionId, piso3d: toque.piso3d }));
    } catch (err) {
      setError(message(err));
      setGuardando(false);
    }
  }

  const campo = (etiqueta: string, valor: string, cambiar: (v: string) => void, ayuda: string, ancho = "100%") => (
    <div style={{ flex: `1 1 ${ancho}` }}>
      <label style={{ ...labelStyle, fontSize: 12, marginBottom: 2 }}>{etiqueta}</label>
      <input value={valor} onChange={(e) => cambiar(e.target.value)} placeholder={ayuda} title={ayuda} style={{ ...baseInput, width: "100%" }} />
    </div>
  );

  return (
    <div style={{ border: "1px solid var(--tc-gray-300)", borderRadius: 6, padding: 10, marginTop: 8, background: "#fbfcfe" }}>
      <b style={{ fontSize: 13 }}>Nuevo punto de captura</b>
      <p style={{ fontSize: 11.5, color: "var(--tc-gray-500)", margin: "4px 0 8px" }}>
        Piso tocado en x {toque.piso3d[0].toFixed(3)}, y {toque.piso3d[1].toFixed(3)}, z {toque.piso3d[2].toFixed(3)} m. El trípode queda {altura || "?"} m más arriba.
      </p>
      <div style={{ display: "flex", gap: 6 }}>
        {campo("Torre", torre, setTorre, "TR1", "30%")}
        {campo("Piso", piso, setPiso, "P05", "30%")}
        {campo("Unidad", unidad, setUnidad, "APT501, LC03, PAS…", "40%")}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {campo("Espacio", espacio, setEspacio, "Sala-comedor, Alcoba 1…", "60%")}
        {campo("Altura trípode (m)", altura, setAltura, "1.50", "40%")}
      </div>
      <div style={{ marginTop: 6 }}>{campo("Zona", zona, setZona, "Zona social, Zona húmeda, Zona común…")}</div>
      <div style={{ marginTop: 6 }}>{campo("Referencia física", referencia, setReferencia, "A 1,20 m del muro de fachada y 1,80 m del muro de la alcoba 2")}</div>
      {codigo && (
        <p style={{ fontSize: 13, margin: "8px 0 0" }}>
          Código: <b>{codigo}</b>
        </p>
      )}
      {errores.length > 0 && <Notice kind="warning" style={{ marginTop: 6 }}>{errores[0]}</Notice>}
      {error && <Notice kind="error" style={{ marginTop: 6 }}>{error}</Notice>}
      <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
        <button style={linkButton} onClick={alCancelar} disabled={guardando}>Cancelar</button>
        <button style={{ ...acceptButton, padding: "6px 14px", fontSize: 13, opacity: completo && !guardando ? 1 : 0.5 }} onClick={guardar} disabled={!completo || guardando}>
          {guardando ? "Guardando…" : "Guardar punto"}
        </button>
      </div>
    </div>
  );
}
