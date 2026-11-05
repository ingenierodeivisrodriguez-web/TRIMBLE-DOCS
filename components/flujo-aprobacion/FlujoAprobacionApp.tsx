"use client";

import { useCallback, useEffect, useState } from "react";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import { ESPERANDO } from "../../lib/flujo-aprobacion/registro";
import type { ArchivoInfo, EstadoFlujos } from "../../lib/flujo-aprobacion/types";
import { message, Notice } from "../presupuesto/ui";
import Archivos from "./Archivos";
import Flujos from "./Flujos";
import Historial from "./Historial";
import PruebaFase0 from "./PruebaFase0";
import RevisionCarpetas from "./RevisionCarpetas";

type Pestana = "por-revisar" | "mios" | "todos" | "flujos" | "historial" | "prueba";

/**
 * "Flujo de aprobación": on opening, the review folders of every active flow
 * are walked and new files and versions registered (phase 2); then what waits
 * for the caller, their files, every file, the flows (configuration, phase 1),
 * the history, and the phase 0 test against the real Trimble Connect.
 */
export default function FlujoAprobacionApp({ api, projectId, projectName }: { api: FlujoApi; projectId: string; projectName: string }) {
  const [pestana, setPestana] = useState<Pestana>("por-revisar");
  const [datos, setDatos] = useState<EstadoFlujos | null>(null);
  const [archivos, setArchivos] = useState<{ yo: string; esAdmin: boolean; archivos: ArchivoInfo[] } | null>(null);
  const [error, setError] = useState("");
  const [errorArchivos, setErrorArchivos] = useState("");
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

  const cargarArchivos = useCallback(() => {
    api
      .archivos()
      .then((r) => {
        setArchivos(r);
        setErrorArchivos("");
        setRecarga((n) => n + 1);
      })
      .catch((err) => setErrorArchivos(message(err)));
  }, [api]);

  useEffect(() => {
    cargar();
    cargarArchivos();
  }, [cargar, cargarArchivos]);

  const cambio = (e: EstadoFlujos) => {
    setDatos(e);
    setRecarga((n) => n + 1);
  };

  const porRevisar = archivos?.archivos.filter((a) => a.meToca && ESPERANDO.includes(a.estado)).length ?? 0;
  const pestanas: { id: Pestana; texto: string }[] = [
    { id: "por-revisar", texto: `Por revisar${porRevisar ? ` (${porRevisar})` : ""}` },
    { id: "mios", texto: "Mis archivos" },
    { id: "todos", texto: "Archivos" },
    { id: "flujos", texto: "Flujos" },
    { id: "historial", texto: "Historial" },
    { id: "prueba", texto: "Prueba de Trimble" },
  ];

  return (
    <div style={{ padding: "18px 22px 40px", display: "grid", gap: 14 }}>
      <header style={{ maxWidth: 900 }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 20, color: "var(--tc-blue-800)" }}>Flujo de aprobación</h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--tc-gray-500)" }}>
          Revisión y aprobación de entregables de {projectName || "este proyecto"} (modelos, planos, documentos) por flujos con título o hito, por ejemplo
          «Aprobar diseño arquitectónico Torre 1». Lo aprobado pasa solo a la carpeta destino y todo queda en la trazabilidad.
        </p>
      </header>
      {datos && <RevisionCarpetas api={api} flujos={datos.flujos} onTermino={cargarArchivos} />}
      <nav style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--tc-gray-300)", maxWidth: 1200, flexWrap: "wrap" }}>
        {pestanas.map((p) => (
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
      {(pestana === "por-revisar" || pestana === "mios" || pestana === "todos") && <Archivos api={api} modo={pestana} datos={archivos} error={errorArchivos} onCambio={cargarArchivos} />}
      {pestana === "flujos" && datos && <Flujos api={api} projectId={projectId} datos={datos} onCambio={cambio} />}
      {pestana === "historial" && <Historial api={api} flujos={datos?.flujos ?? []} recarga={recarga} />}
      {pestana === "prueba" && <PruebaFase0 api={api} projectId={projectId} projectName={projectName} />}
      {pestana === "flujos" && !datos && !error && <p style={{ fontSize: 13.5, color: "var(--tc-gray-500)" }}>Cargando…</p>}
    </div>
  );
}
