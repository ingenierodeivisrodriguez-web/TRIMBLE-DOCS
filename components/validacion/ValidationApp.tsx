"use client";

import { useCallback, useEffect, useState } from "react";
import { isConfigured } from "../../lib/validacion/config";
import type { ValidationConfig } from "../../lib/validacion/types";
import Card from "../Card";
import ConfigEditor from "./ConfigEditor";
import DuplicatesView from "./DuplicatesView";
import ResultsView from "./ResultsView";
import { useAnalysis } from "./useAnalysis";
import { noticeBase, noticeStyles, primaryButtonStyle } from "./ui";

type Tab = "results" | "duplicates" | "config";

export default function ValidationApp({
  projectId,
  projectName,
  accessToken,
}: {
  projectId: string;
  projectName: string;
  accessToken: string;
}) {
  const [tab, setTab] = useState<Tab>("results");
  const [saved, setSaved] = useState<ValidationConfig | null>(null);
  const [loadError, setLoadError] = useState("");
  const [dirty, setDirty] = useState(false);
  const { state, analyze } = useAnalysis(projectId, accessToken);

  useEffect(() => {
    if (!projectId || !accessToken) return;
    let cancelled = false;
    setLoadError("");
    fetch(`/api/validacion/config?projectId=${encodeURIComponent(projectId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error ?? `No se pudo cargar la configuración (error ${res.status}).`);
        return body.config as ValidationConfig;
      })
      .then((config) => {
        if (!cancelled) setSaved(config);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "No se pudo cargar la configuración.");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, accessToken]);

  const configured = saved !== null && isConfigured(saved);
  const running = state.status === "running";

  const handleAnalyze = useCallback(() => {
    // One click feeds both the Resultados and Duplicados tabs; stay on
    // whichever the user is looking at instead of forcing a switch, but move
    // off Configuración (there is nothing to show there while it runs).
    setTab((t) => (t === "config" ? "results" : t));
    analyze();
  }, [analyze]);

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ color: "var(--tc-blue-900)", margin: "0 0 4px" }}>Validación</h1>
          <p style={{ color: "var(--tc-gray-500)", margin: 0 }}>
            {projectName} · Nomenclatura de archivos
          </p>
        </div>
        <button
          type="button"
          style={{
            ...primaryButtonStyle,
            fontSize: 15,
            padding: "10px 26px",
            opacity: running ? 0.55 : 1,
          }}
          disabled={running}
          title={
            configured
              ? undefined
              : "Sin reglas de nomenclatura configuradas: solo se buscarán archivos duplicados."
          }
          onClick={handleAnalyze}
        >
          {running ? "Analizando..." : "Analizar"}
        </button>
      </header>

      <nav style={{ display: "flex", gap: 4, borderBottom: "2px solid var(--tc-gray-100)" }}>
        <TabLink active={tab === "results"} onClick={() => setTab("results")}>
          Resultados
        </TabLink>
        <TabLink active={tab === "duplicates"} onClick={() => setTab("duplicates")}>
          Duplicados
        </TabLink>
        <TabLink active={tab === "config"} onClick={() => setTab("config")}>
          Configuración{dirty ? " •" : ""}
        </TabLink>
      </nav>

      {loadError && (
        <Card>
          <div style={{ ...noticeBase, ...noticeStyles.error }}>
            <strong>No se pudo cargar la configuración del proyecto.</strong>
            <p style={{ margin: "6px 0 0" }}>{loadError}</p>
          </div>
        </Card>
      )}

      {!loadError && saved === null && (
        <div style={{ color: "var(--tc-gray-500)", textAlign: "center", padding: 32 }}>
          Cargando la configuración del proyecto...
        </div>
      )}

      {saved !== null && (
        <>
          <div style={{ display: tab === "results" ? "block" : "none" }}>
            <ResultsView
              projectId={projectId}
              accessToken={accessToken}
              state={state}
              configured={configured}
              onAnalyze={handleAnalyze}
              onGoToConfig={() => setTab("config")}
            />
          </div>
          <div style={{ display: tab === "duplicates" ? "block" : "none" }}>
            <DuplicatesView projectId={projectId} accessToken={accessToken} state={state} onAnalyze={handleAnalyze} />
          </div>
          <div style={{ display: tab === "config" ? "block" : "none" }}>
            <ConfigEditor
              projectId={projectId}
              accessToken={accessToken}
              initial={saved}
              onSaved={setSaved}
              onDirtyChange={setDirty}
            />
          </div>
        </>
      )}
    </div>
  );
}

function TabLink({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "none",
        background: "transparent",
        padding: "10px 18px",
        fontSize: 15,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        color: active ? "var(--tc-blue-700)" : "var(--tc-gray-500)",
        borderBottom: active ? "3px solid var(--tc-blue-600)" : "3px solid transparent",
        marginBottom: -2,
      }}
    >
      {children}
    </button>
  );
}
