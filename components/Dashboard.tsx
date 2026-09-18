"use client";

import { useEffect, useMemo, useState } from "react";
import { CrawlProgress, fetchWithProgress } from "../lib/apiClient";
import { formatBytes } from "../lib/format";
import { groupTopN } from "../lib/grouping";
import { SummaryResponse } from "../lib/types";
import Card from "./Card";
import DetailModal from "./DetailModal";
import GrowthTimelineChart from "./GrowthTimelineChart";
import StatCard from "./StatCard";
import TypeDonutChart from "./TypeDonutChart";
import TypeSizeBarChart from "./TypeSizeBarChart";

const TOP_N = 7;
const RECENT_DAY_OPTIONS = [7, 15, 30];

type ModalView =
  | { kind: "others"; items: SummaryResponse["byType"] }
  | { kind: "files"; ext: string }
  | { kind: "recent"; days: number };

export default function Dashboard({
  projectId,
  projectName,
  accessToken,
}: {
  projectId: string;
  projectName: string;
  accessToken: string;
}) {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [error, setError] = useState<string>("");
  const [modalView, setModalView] = useState<ModalView | null>(null);

  useEffect(() => {
    if (!projectId || !accessToken) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setProgress(null);
    fetchWithProgress<SummaryResponse>(
      `/api/summary?projectId=${encodeURIComponent(projectId)}`,
      accessToken,
      (p) => {
        if (!cancelled) setProgress(p);
      },
      () => cancelled
    )
      .then((json) => {
        if (!cancelled && json) setSummary(json);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, accessToken]);

  const countChart = useMemo(
    () => (summary ? groupTopN(summary.byType, "count", TOP_N) : null),
    [summary]
  );
  const sizeChart = useMemo(
    () => (summary ? groupTopN(summary.byType, "size", TOP_N) : null),
    [summary]
  );

  if (loading) {
    return (
      <CenteredMessage>
        Analizando los documentos del proyecto...
        {progress && progress.folders > 0 && (
          <div style={{ marginTop: 8, fontSize: 13 }}>
            {progress.files.toLocaleString("es")} archivos encontrados en{" "}
            {progress.folders.toLocaleString("es")} carpetas recorridas
            <br />
            Los proyectos grandes pueden tardar un poco la primera vez.
          </div>
        )}
      </CenteredMessage>
    );
  }
  if (error) {
    return <CenteredMessage isError>{error}</CenteredMessage>;
  }
  if (!summary || !countChart || !sizeChart) {
    return <CenteredMessage>Sin datos disponibles.</CenteredMessage>;
  }

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      <header>
        <h1 style={{ color: "var(--tc-blue-900)", margin: "0 0 4px" }}>Resumen Archivos</h1>
        <p style={{ color: "var(--tc-gray-500)", margin: 0 }}>
          {projectName || summary.project.name}
        </p>
      </header>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <StatCard label="Total de archivos" value={summary.totals.filesCount.toLocaleString("es")} />
        <StatCard label="Tipos distintos" value={summary.totals.typesCount.toLocaleString("es")} />
        <StatCard label="Tamano total" value={formatBytes(summary.totals.totalSize)} />
      </section>

      <section
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
          background: "var(--tc-white)",
          borderRadius: "var(--tc-radius)",
          boxShadow: "var(--tc-shadow)",
          padding: "14px 20px",
        }}
      >
        <span style={{ color: "var(--tc-gray-500)", fontSize: 13, fontWeight: 600 }}>
          CARGADOS EN LOS ULTIMOS
        </span>
        {RECENT_DAY_OPTIONS.map((days) => (
          <button
            key={days}
            onClick={() => setModalView({ kind: "recent", days })}
            style={recentButtonStyle}
          >
            {days} dias
          </button>
        ))}
      </section>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <Card title="Archivos por tipo" flex={1}>
          <TypeDonutChart
            data={countChart.chartData}
            onSliceClick={(item) =>
              item.isOthers
                ? setModalView({ kind: "others", items: countChart.othersItems })
                : setModalView({ kind: "files", ext: item.ext })
            }
          />
        </Card>
        <Card title="Tamano ocupado por tipo" flex={1}>
          <TypeSizeBarChart
            data={sizeChart.chartData}
            onBarClick={(item) =>
              item.isOthers
                ? setModalView({ kind: "others", items: sizeChart.othersItems })
                : setModalView({ kind: "files", ext: item.ext })
            }
          />
        </Card>
      </section>

      <Card title="Crecimiento acumulado de documentos">
        <GrowthTimelineChart weekly={summary.timeline.weekly} monthly={summary.timeline.monthly} />
      </Card>

      {modalView && (
        <DetailModal
          initialView={modalView}
          projectId={projectId}
          accessToken={accessToken}
          onClose={() => setModalView(null)}
        />
      )}
    </div>
  );
}

const recentButtonStyle: React.CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  background: "var(--tc-blue-50)",
  color: "var(--tc-blue-700)",
  borderRadius: 6,
  padding: "6px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

function CenteredMessage({ children, isError }: { children: React.ReactNode; isError?: boolean }) {
  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: isError ? "#b3261e" : "var(--tc-gray-500)",
        padding: 24,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}
