"use client";

import { useEffect, useState } from "react";
import { downloadExport } from "../../lib/validacion/download";
import {
  filterParams,
  hasActiveFilters,
  NO_FILTERS,
  ResultFilters,
} from "../../lib/validacion/filterParams";
import { AnalysisSummary, ResultsTab, TEMPLATE_TITLES, TemplateKey } from "../../lib/validacion/types";
import Card from "../Card";
import StatCard from "../StatCard";
import ResultsCharts from "./ResultsCharts";
import ResultsTable from "./ResultsTable";
import type { AnalysisState } from "./useAnalysis";
import {
  inputStyle,
  noticeBase,
  noticeStyles,
  primaryButtonStyle,
  secondaryButtonStyle,
} from "./ui";

function percent(part: number, total: number): string {
  if (total <= 0) return "—";
  return `${((part / total) * 100).toLocaleString("es", { maximumFractionDigits: 1 })}%`;
}

const n = (value: number) => value.toLocaleString("es");

export default function ResultsView({
  projectId,
  accessToken,
  state,
  configured,
  onAnalyze,
  onGoToConfig,
}: {
  projectId: string;
  accessToken: string;
  state: AnalysisState;
  configured: boolean;
  onAnalyze: () => void;
  onGoToConfig: () => void;
}) {
  if (!configured) {
    return (
      <Card>
        <div style={{ ...noticeBase, ...noticeStyles.info }}>
          <strong>Aún no hay reglas de nomenclatura configuradas para este proyecto.</strong>
          <p style={{ margin: "6px 0 10px" }}>
            Define al menos una plantilla (extensiones y campos del nombre) y guárdala; después podrás
            analizar los archivos.
          </p>
          <button type="button" style={primaryButtonStyle} onClick={onGoToConfig}>
            Ir a Configuración
          </button>
        </div>
      </Card>
    );
  }

  if (state.status === "idle") {
    return (
      <Card>
        <p style={{ margin: 0, color: "var(--tc-gray-700)", fontSize: 14 }}>
          El análisis no se ejecuta solo. Pulsa <strong>Analizar</strong> para recorrer todas las carpetas
          del proyecto y validar el nombre de cada archivo contra la configuración guardada.
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
    <ResultsDone
      key={state.runId}
      projectId={projectId}
      accessToken={accessToken}
      summary={state.summary}
    />
  );
}

function ResultsDone({
  projectId,
  accessToken,
  summary,
}: {
  projectId: string;
  accessToken: string;
  summary: AnalysisSummary;
}) {
  const [tab, setTab] = useState<ResultsTab>("nonconforming");
  const [filters, setFilters] = useState<ResultFilters>(NO_FILTERS);
  const [searchText, setSearchText] = useState("");
  const [filteredTotal, setFilteredTotal] = useState<number | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "csv" | null>(null);
  const [exportError, setExportError] = useState("");

  const { totals, templates } = summary;
  const tabTotal = tab === "nonconforming" ? totals.nonConforming : totals.unclassified;
  const queryFilters = filterParams(tab, filters);
  const filtered = hasActiveFilters(tab, filters);
  const shown = filteredTotal ?? tabTotal;

  // Search as you type, without hitting the server on every keystroke.
  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((f) => (f.q === searchText ? f : { ...f, q: searchText })),
      300
    );
    return () => clearTimeout(timer);
  }, [searchText]);

  // Switch tab and replace the card/chart/chip selection, keeping the search text.
  const go = (nextTab: ResultsTab, next: Partial<ResultFilters> = {}) => {
    setTab(nextTab);
    setFilters((f) => ({ ...NO_FILTERS, q: f.q, ...next }));
  };
  const toggleTemplate = (key: TemplateKey) =>
    go("nonconforming", tab === "nonconforming" && filters.template === key ? {} : { template: key });
  const toggleField = (fieldLabel: string | null) =>
    go("nonconforming", fieldLabel ? { field: fieldLabel } : {});
  const toggleExt = (ext: string) => go("unclassified", filters.ext === ext ? {} : { ext });
  const clearFilters = () => {
    setSearchText("");
    setFilters(NO_FILTERS);
  };
  const clearSearch = () => {
    setSearchText("");
    setFilters((f) => ({ ...f, q: "" }));
  };

  async function runExport(format: "xlsx" | "csv") {
    setExporting(format);
    setExportError("");
    try {
      await downloadExport(projectId, accessToken, tab, format, queryFilters);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "No se pudo exportar.");
    } finally {
      setExporting(null);
    }
  }

  const chips: { label: string; remove: () => void }[] = [];
  if (tab === "nonconforming" && filters.template) {
    chips.push({ label: TEMPLATE_TITLES[filters.template], remove: () => go("nonconforming") });
  }
  if (tab === "nonconforming" && filters.field) {
    chips.push({ label: `Campo: ${filters.field}`, remove: () => go("nonconforming") });
  }
  if (tab === "unclassified" && filters.ext) {
    chips.push({
      label: filters.ext === "sin-extension" ? "Sin extensión" : `.${filters.ext}`,
      remove: () => go("unclassified"),
    });
  }
  if (filters.q.trim()) {
    chips.push({ label: `Texto: “${filters.q.trim()}”`, remove: clearSearch });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>
        Analizado el {new Date(summary.analyzedAt).toLocaleString("es")}
        {summary.configUpdatedAt &&
          ` con la configuración guardada el ${new Date(summary.configUpdatedAt).toLocaleString("es")}`}
        . {n(totals.files)} archivos en total. Haz clic en las tarjetas y en los gráficos para filtrar
        la tabla.
      </div>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <StatCard
          label="Cumplimiento general"
          value={percent(totals.conforming, totals.classified)}
          hint={`${n(totals.conforming)} de ${n(totals.classified)} archivos con plantilla son conformes`}
          active={tab === "nonconforming" && !filtered}
          title="Ver todos los archivos no conformes"
          onClick={() => go("nonconforming")}
        />
        <StatCard
          label={TEMPLATE_TITLES.graphic}
          value={percent(templates.graphic.conforming, templates.graphic.total)}
          hint={`${n(templates.graphic.conforming)} de ${n(templates.graphic.total)} conformes`}
          active={tab === "nonconforming" && filters.template === "graphic"}
          title="Ver los no conformes de esta plantilla"
          onClick={() => toggleTemplate("graphic")}
        />
        <StatCard
          label={TEMPLATE_TITLES.nonGraphic}
          value={percent(templates.nonGraphic.conforming, templates.nonGraphic.total)}
          hint={`${n(templates.nonGraphic.conforming)} de ${n(templates.nonGraphic.total)} conformes`}
          active={tab === "nonconforming" && filters.template === "nonGraphic"}
          title="Ver los no conformes de esta plantilla"
          onClick={() => toggleTemplate("nonGraphic")}
        />
        <StatCard
          label="Sin clasificar / Requiere revisión"
          value={n(totals.unclassified)}
          hint={`${percent(totals.unclassified, totals.files)} de los archivos; no entran en el porcentaje`}
          active={tab === "unclassified"}
          title="Ver los archivos sin clasificar"
          onClick={() => go("unclassified")}
        />
      </section>

      <ResultsCharts
        summary={summary}
        activeField={tab === "nonconforming" ? filters.field : null}
        onSelectStatus={(status) => go(status)}
        onSelectField={toggleField}
      />

      <Card>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <TabButton active={tab === "nonconforming"} onClick={() => go("nonconforming")}>
              No conformes ({n(totals.nonConforming)})
            </TabButton>
            <TabButton active={tab === "unclassified"} onClick={() => go("unclassified")}>
              Sin clasificar ({n(totals.unclassified)})
            </TabButton>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
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
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <input
            type="search"
            value={searchText}
            placeholder={
              tab === "nonconforming"
                ? "Buscar por nombre, carpeta o motivo..."
                : "Buscar por nombre o carpeta..."
            }
            onChange={(e) => setSearchText(e.target.value)}
            style={{ ...inputStyle, flex: "1 1 260px", minWidth: 200 }}
          />
          {chips.map((chip) => (
            <span key={chip.label} style={filterChipStyle}>
              {chip.label}
              <button
                type="button"
                aria-label={`Quitar filtro ${chip.label}`}
                onClick={chip.remove}
                style={chipButtonStyle}
              >
                ✕
              </button>
            </span>
          ))}
          {filtered && (
            <button
              type="button"
              style={{ ...secondaryButtonStyle, padding: "4px 12px" }}
              onClick={clearFilters}
            >
              Limpiar filtros
            </button>
          )}
        </div>

        {exportError && (
          <div style={{ ...noticeBase, ...noticeStyles.error, marginBottom: 12 }}>{exportError}</div>
        )}

        {tab === "unclassified" && summary.unclassifiedByExt.length > 0 && (
          <div style={{ ...noticeBase, ...noticeStyles.info, marginBottom: 12 }}>
            <div style={{ marginBottom: 6 }}>
              Extensiones sin plantilla (haz clic para filtrar). Asígnalas a una plantilla en
              Configuración para validarlas:
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {summary.unclassifiedByExt.slice(0, 20).map((e) => (
                <button
                  key={e.ext}
                  type="button"
                  onClick={() => toggleExt(e.ext)}
                  style={{
                    ...extButtonStyle,
                    background: filters.ext === e.ext ? "var(--tc-blue-600)" : "var(--tc-white)",
                    color: filters.ext === e.ext ? "var(--tc-white)" : "var(--tc-blue-800)",
                  }}
                >
                  {e.ext === "sin-extension" ? "(sin extensión)" : `.${e.ext}`} · {n(e.count)}
                </button>
              ))}
              {summary.unclassifiedByExt.length > 20 && (
                <span style={{ alignSelf: "center" }}>y {summary.unclassifiedByExt.length - 20} más</span>
              )}
            </div>
          </div>
        )}

        <div style={{ fontSize: 12, color: "var(--tc-gray-500)", marginBottom: 8 }}>
          {filtered
            ? `${n(shown)} de ${n(tabTotal)} archivos coinciden con los filtros`
            : `${n(tabTotal)} archivos`}
        </div>

        <ResultsTable
          key={tab}
          projectId={projectId}
          accessToken={accessToken}
          tab={tab}
          filters={queryFilters}
          onTotalChange={setFilteredTotal}
        />
      </Card>
    </div>
  );
}

function TabButton({
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
        border: "1px solid var(--tc-blue-500)",
        background: active ? "var(--tc-blue-600)" : "var(--tc-white)",
        color: active ? "var(--tc-white)" : "var(--tc-blue-700)",
        borderRadius: 6,
        padding: "6px 16px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

const filterChipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "var(--tc-blue-100)",
  color: "var(--tc-blue-900)",
  border: "1px solid var(--tc-blue-500)",
  borderRadius: 999,
  padding: "4px 6px 4px 12px",
  fontSize: 13,
  fontWeight: 600,
};

const chipButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--tc-blue-700)",
  cursor: "pointer",
  width: 20,
  height: 20,
  borderRadius: 999,
  fontSize: 11,
  padding: 0,
};

const extButtonStyle: React.CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  borderRadius: 999,
  padding: "3px 12px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
