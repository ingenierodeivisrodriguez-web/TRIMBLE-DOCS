"use client";

import { useEffect, useState } from "react";
import { downloadDuplicatesExport } from "../../lib/validacion/download";
import { DuplicatesSummary } from "../../lib/validacion/types";
import Card from "../Card";
import StatCard from "../StatCard";
import DuplicatesChart from "./DuplicatesChart";
import DuplicatesTable from "./DuplicatesTable";
import type { AnalysisState } from "./useAnalysis";
import { inputStyle, noticeBase, noticeStyles, secondaryButtonStyle } from "./ui";

const n = (value: number) => value.toLocaleString("es");

function percent(part: number, total: number): string {
  if (total <= 0) return "—";
  return `${((part / total) * 100).toLocaleString("es", { maximumFractionDigits: 1 })}%`;
}

/**
 * Files that share the exact same name (including extension) in different
 * folders of the project - independent of the naming-convention config, so
 * this tab is useful even before any template is configured.
 */
export default function DuplicatesView({
  projectId,
  accessToken,
  state,
  onAnalyze,
}: {
  projectId: string;
  accessToken: string;
  state: AnalysisState;
  onAnalyze: () => void;
}) {
  if (state.status === "idle") {
    return (
      <Card>
        <p style={{ margin: 0, color: "var(--tc-gray-700)", fontSize: 14 }}>
          El análisis no se ejecuta solo. Pulsa <strong>Analizar</strong> para recorrer todas las carpetas
          del proyecto y buscar archivos con el mismo nombre en distintas carpetas.
        </p>
      </Card>
    );
  }

  if (state.status === "running") {
    return (
      <Card>
        <div style={{ textAlign: "center", padding: "24px 12px", color: "var(--tc-gray-500)" }}>
          <div style={{ fontSize: 15, color: "var(--tc-blue-800)", fontWeight: 600 }}>
            Analizando los archivos del proyecto...
          </div>
          {state.progress && state.progress.folders > 0 && (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              {n(state.progress.files)} archivos encontrados en {n(state.progress.folders)} carpetas
              recorridas
              <br />
              Los proyectos grandes pueden tardar un poco.
            </div>
          )}
        </div>
      </Card>
    );
  }

  if (state.status === "error") {
    return (
      <Card>
        <div style={{ ...noticeBase, ...noticeStyles.error }}>
          <strong>No se pudo completar el análisis.</strong>
          <p style={{ margin: "6px 0 10px" }}>{state.message}</p>
          <button type="button" style={secondaryButtonStyle} onClick={onAnalyze}>
            Reintentar
          </button>
        </div>
      </Card>
    );
  }

  return (
    <DuplicatesDone
      key={state.runId}
      projectId={projectId}
      accessToken={accessToken}
      summary={state.summary.duplicates}
    />
  );
}

function DuplicatesDone({
  projectId,
  accessToken,
  summary,
}: {
  projectId: string;
  accessToken: string;
  summary: DuplicatesSummary;
}) {
  const [ext, setExt] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [q, setQ] = useState("");
  const [filteredTotal, setFilteredTotal] = useState<number | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "csv" | null>(null);
  const [exportError, setExportError] = useState("");

  const filters: Record<string, string> = {};
  if (ext) filters.ext = ext;
  if (q.trim()) filters.q = q.trim();
  const filtered = Object.keys(filters).length > 0;
  const shown = filteredTotal ?? summary.groups;

  useEffect(() => {
    const timer = setTimeout(() => setQ(searchText), 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  const clearFilters = () => {
    setSearchText("");
    setQ("");
    setExt(null);
  };

  async function runExport(format: "xlsx" | "csv") {
    setExporting(format);
    setExportError("");
    try {
      await downloadDuplicatesExport(projectId, accessToken, format, filters);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "No se pudo exportar.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>
        Analizado el {new Date(summary.analyzedAt).toLocaleString("es")}. {n(summary.totalFiles)} archivos en
        total. Se agrupan por nombre exacto (con extensión), sin importar mayúsculas/minúsculas.
      </div>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <StatCard
          label="Archivos duplicados"
          value={n(summary.duplicateFiles)}
          hint={`${percent(summary.duplicateFiles, summary.totalFiles)} de los archivos del proyecto`}
        />
        <StatCard
          label="Grupos de nombres repetidos"
          value={n(summary.groups)}
          hint="Cada grupo es un nombre que aparece en más de una carpeta"
        />
      </section>

      <DuplicatesChart summary={summary} activeExt={ext} onSelectExt={setExt} />

      <Card>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <button
            type="button"
            style={{ ...secondaryButtonStyle, opacity: shown === 0 || exporting ? 0.5 : 1 }}
            disabled={shown === 0 || exporting !== null}
            onClick={() => runExport("xlsx")}
          >
            {exporting === "xlsx" ? "Exportando..." : `Exportar Excel (${n(shown)})`}
          </button>
          <button
            type="button"
            style={{ ...secondaryButtonStyle, opacity: shown === 0 || exporting ? 0.5 : 1 }}
            disabled={shown === 0 || exporting !== null}
            onClick={() => runExport("csv")}
          >
            {exporting === "csv" ? "Exportando..." : "Exportar CSV"}
          </button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <input
            type="search"
            value={searchText}
            placeholder="Buscar por nombre o carpeta..."
            onChange={(e) => setSearchText(e.target.value)}
            style={{ ...inputStyle, flex: "1 1 260px", minWidth: 200 }}
          />
          {ext && (
            <span style={filterChipStyle}>
              {ext === "sin-extension" ? "Sin extensión" : `.${ext}`}
              <button type="button" aria-label="Quitar filtro de extensión" onClick={() => setExt(null)} style={chipButtonStyle}>
                ✕
              </button>
            </span>
          )}
          {filtered && (
            <button type="button" style={{ ...secondaryButtonStyle, padding: "4px 12px" }} onClick={clearFilters}>
              Limpiar filtros
            </button>
          )}
        </div>

        {exportError && (
          <div style={{ ...noticeBase, ...noticeStyles.error, marginBottom: 12 }}>{exportError}</div>
        )}

        <div style={{ fontSize: 12, color: "var(--tc-gray-500)", marginBottom: 8 }}>
          {filtered
            ? `${n(shown)} de ${n(summary.groups)} grupos coinciden con los filtros`
            : `${n(summary.groups)} grupos`}
        </div>

        <DuplicatesTable projectId={projectId} accessToken={accessToken} filters={filters} onTotalChange={setFilteredTotal} />
      </Card>
    </div>
  );
}

const filterChipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "#fff1d6",
  color: "#7a5300",
  border: "1px solid #f0c36d",
  borderRadius: 999,
  padding: "4px 6px 4px 12px",
  fontSize: 13,
  fontWeight: 600,
};

const chipButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#7a5300",
  cursor: "pointer",
  width: 20,
  height: 20,
  borderRadius: 999,
  fontSize: 11,
  padding: 0,
};
