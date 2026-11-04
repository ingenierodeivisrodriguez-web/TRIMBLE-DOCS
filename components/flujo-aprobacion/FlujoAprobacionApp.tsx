"use client";

import { useCallback, useEffect, useState } from "react";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import type { EstadoFlujos } from "../../lib/flujo-aprobacion/types";
import { message, Notice } from "../presupuesto/ui";
import Flujos from "./Flujos";
import Historial from "./Historial";
import PruebaFase0 from "./PruebaFase0";

type Pestana = "flujos" | "historial" | "prueba";

const PESTANAS: { id: Pestana; texto: string }[] = [
  { id: "flujos", texto: "Flujos" },
  { id: "historial", texto: "Historial" },
  { id: "prueba", texto: "Prueba de Trimble" },
];

/**
 * "Flujo de aprobación": the flows (configuration, phase 1), the history of
 * changes, and the phase 0 test against the real Trimble Connect (kept to
 * check what is still pending: a ToDo for a group, a second copy as v2).
 */
export default function FlujoAprobacionApp({ api, projectId, projectName }: { api: FlujoApi; projectId: string; projectName: string }) {
  const [pestana, setPestana] = useState<Pestana>("flujos");
  const [datos, setDatos] = useState<EstadoFlujos | null>(null);
  const [error, setError] = useState("");
  const [recarga, setRecarga] = useState(0);

  const cargar = useCallback(() => {
    api
      .flujos()
      .then((r) => {
        setDatos(r);
        setError("");
      })
      .catch((err) => setError(message(err)));
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const cambio = (e: EstadoFlujos) => {
    setDatos(e);
    setRecarga((n) => n + 1);
  };

  return (
    <div style={{ padding: "18px 22px 40px", display: "grid", gap: 14 }}>
      <header style={{ maxWidth: 900 }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 20, color: "var(--tc-blue-800)" }}>Flujo de aprobación</h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--tc-gray-500)" }}>
          Revisión y aprobación de entregables de {projectName || "este proyecto"} (modelos, planos, documentos) por flujos con título o hito, por ejemplo
          «Aprobar diseño arquitectónico Torre 1». Lo aprobado pasa solo a la carpeta destino y todo queda en la trazabilidad.
        </p>
      </header>
      <nav style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--tc-gray-300)", maxWidth: 1100, flexWrap: "wrap" }}>
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPestana(p.id)}
            style={{
              border: "none",
              borderBottom: pestana === p.id ? "3px solid var(--tc-blue-600)" : "3px solid transparent",
              background: "transparent",
              padding: "8px 12px",
              fontSize: 14,
              fontWeight: pestana === p.id ? 600 : 400,
              color: pestana === p.id ? "var(--tc-blue-800)" : "var(--tc-gray-700)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {p.texto}
          </button>
        ))}
      </nav>
      {error && pestana !== "prueba" && (
        <Notice kind="error" style={{ maxWidth: 900 }}>
          {error}
        </Notice>
      )}
      {pestana === "flujos" && datos && <Flujos api={api} projectId={projectId} datos={datos} onCambio={cambio} />}
      {pestana === "historial" && <Historial api={api} flujos={datos?.flujos ?? []} recarga={recarga} />}
      {pestana === "prueba" && <PruebaFase0 api={api} projectId={projectId} projectName={projectName} />}
      {pestana === "flujos" && !datos && !error && <p style={{ fontSize: 13.5, color: "var(--tc-gray-500)" }}>Cargando…</p>}
    </div>
  );
}
