"use client";

import { useEffect, useState } from "react";
import { CrawlProgress, fetchWithProgress } from "../../lib/apiClient";
import { buildFileViewerUrl } from "../../lib/format";
import {
  NonConformingRow,
  ResultsPage,
  ResultsTab,
  TEMPLATE_TITLES,
  UnclassifiedRow,
} from "../../lib/validacion/types";
import Pager from "../Pager";

const PAGE_SIZE = 25;

/** One page of the non-conforming (or unclassified) files, fetched from the server. */
export default function ResultsTable({
  projectId,
  accessToken,
  tab,
  filters,
  onTotalChange,
}: {
  projectId: string;
  accessToken: string;
  tab: ResultsTab;
  /** Extra query parameters (template, field, ext, q) from filterParams(). */
  filters: Record<string, string>;
  onTotalChange: (total: number) => void;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ResultsPage<NonConformingRow | UnclassifiedRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [error, setError] = useState("");

  // A different filter/tab is a different list: start from its first page.
  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    setPage(1);
  }, [filterKey, tab]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setProgress(null);
    const params = new URLSearchParams({
      projectId,
      tab,
      page: String(page),
      pageSize: String(PAGE_SIZE),
      ...filters,
    });
    fetchWithProgress<ResultsPage<NonConformingRow | UnclassifiedRow>>(
      `/api/validacion/results?${params.toString()}`,
      accessToken,
      (p) => {
        if (!cancelled) setProgress(p);
      },
      () => cancelled
    )
      .then((json) => {
        if (cancelled || !json) return;
        setData(json);
        onTotalChange(json.total);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "No se pudieron cargar los resultados.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, accessToken, tab, page, JSON.stringify(filters)]);

  if (error) return <p style={{ color: "#b3261e" }}>{error}</p>;

  const isNonConforming = tab === "nonconforming";
  const columns = isNonConforming
    ? ["Archivo", "Carpeta", "Plantilla", "Campo(s) que fallaron", "Motivo", ""]
    : ["Archivo", "Carpeta", "Extensión", ""];

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              {columns.map((column, i) => (
                <th key={i} style={thStyle}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td style={tdStyle} colSpan={columns.length}>
                  {progress && progress.folders > 0
                    ? `Cargando... (${progress.files.toLocaleString("es")} archivos encontrados hasta ahora)`
                    : "Cargando..."}
                </td>
              </tr>
            )}
            {!loading && data?.items.length === 0 && (
              <tr>
                <td style={tdStyle} colSpan={columns.length}>
                  {Object.keys(filters).length > 0
                    ? "Ningún archivo coincide con los filtros aplicados."
                    : isNonConforming
                      ? "No hay archivos no conformes. ¡Todo cumple la nomenclatura configurada!"
                      : "No hay archivos sin clasificar."}
                </td>
              </tr>
            )}
            {!loading &&
              data?.items.map((row) => (
                <tr key={row.id}>
                  <td style={{ ...tdStyle, wordBreak: "break-word", minWidth: 160 }}>{row.name}</td>
                  <td style={{ ...tdStyle, minWidth: 120 }}>{row.folderPath}</td>
                  {"issues" in row ? (
                    <>
                      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{TEMPLATE_TITLES[row.template]}</td>
                      <td style={{ ...tdStyle, minWidth: 130 }}>
                        {[...new Set(row.issues.map((i) => i.fieldLabel))].join(", ")}
                      </td>
                      <td style={{ ...tdStyle, minWidth: 260 }}>
                        {row.issues.map((issue, i) => (
                          <div key={i} style={{ marginBottom: i < row.issues.length - 1 ? 4 : 0 }}>
                            {issue.message}
                          </div>
                        ))}
                      </td>
                    </>
                  ) : (
                    <td style={tdStyle}>{row.ext === "sin-extension" ? "(sin extensión)" : `.${row.ext}`}</td>
                  )}
                  <td style={tdStyle}>
                    <a
                      href={buildFileViewerUrl(projectId, row)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--tc-blue-600)", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}
                    >
                      Abrir ↗
                    </a>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {data && (
        <Pager page={page} pageSize={PAGE_SIZE} total={data.total} noun="archivos" onPageChange={setPage} />
      )}
    </div>
  );
}

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "2px solid var(--tc-gray-100)",
  color: "var(--tc-gray-500)",
  fontWeight: 600,
  fontSize: 12,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid var(--tc-gray-100)",
  color: "var(--tc-gray-700)",
  verticalAlign: "top",
};
