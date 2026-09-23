"use client";

import { useEffect, useState } from "react";
import { CrawlProgress, fetchWithProgress } from "../../lib/apiClient";
import { formatBytes, formatDate, buildFileViewerUrl } from "../../lib/format";
import { DuplicateGroup, ResultsPage } from "../../lib/validacion/types";
import Pager from "../Pager";

const PAGE_SIZE = 15;

/** One page of duplicate-name groups, fetched from the server, one card per group. */
export default function DuplicatesTable({
  projectId,
  accessToken,
  filters,
  onTotalChange,
}: {
  projectId: string;
  accessToken: string;
  /** Extra query parameters (ext, q). */
  filters: Record<string, string>;
  onTotalChange: (total: number) => void;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ResultsPage<DuplicateGroup> | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [error, setError] = useState("");

  const filterKey = JSON.stringify(filters);
  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setProgress(null);
    const params = new URLSearchParams({
      projectId,
      page: String(page),
      pageSize: String(PAGE_SIZE),
      ...filters,
    });
    fetchWithProgress<ResultsPage<DuplicateGroup>>(
      `/api/validacion/duplicates?${params.toString()}`,
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
        if (!cancelled) setError(err instanceof Error ? err.message : "No se pudieron cargar los duplicados.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, accessToken, page, JSON.stringify(filters)]);

  if (error) return <p style={{ color: "#b3261e" }}>{error}</p>;

  if (loading) {
    return (
      <p style={{ color: "var(--tc-gray-500)", fontSize: 14 }}>
        {progress && progress.folders > 0
          ? `Cargando... (${progress.files.toLocaleString("es")} archivos encontrados hasta ahora)`
          : "Cargando..."}
      </p>
    );
  }

  if (data?.items.length === 0) {
    return (
      <p style={{ color: "var(--tc-gray-500)", fontSize: 14 }}>
        {Object.keys(filters).length > 0
          ? "Ningún grupo coincide con los filtros aplicados."
          : "No se encontraron archivos con el mismo nombre en distintas carpetas."}
      </p>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {data?.items.map((group) => <DuplicateGroupCard key={group.key} projectId={projectId} group={group} />)}
      </div>
      {data && (
        <Pager page={page} pageSize={PAGE_SIZE} total={data.total} noun="grupos" onPageChange={setPage} />
      )}
    </div>
  );
}

function DuplicateGroupCard({ projectId, group }: { projectId: string; group: DuplicateGroup }) {
  return (
    <div
      style={{
        border: "1px solid var(--tc-gray-300)",
        borderLeft: "4px solid #d9822b",
        borderRadius: 8,
        padding: "10px 14px",
        background: "var(--tc-white)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontFamily: "Consolas, monospace", fontSize: 14, fontWeight: 600, wordBreak: "break-all" }}>
          {group.name}
        </span>
        <span
          style={{
            background: "#fff1d6",
            color: "#7a5300",
            borderRadius: 999,
            padding: "2px 10px",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.3,
          }}
        >
          {group.count} copias
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {["Carpeta", "Modificado", "Tamaño", "Subido por", "", ""].map((h, i) => (
                <th key={i} style={thStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {group.files.map((file) => (
              <tr key={file.id}>
                <td style={tdStyle}>{file.folderPath}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{formatDate(file.modifiedOn)}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{formatBytes(file.size)}</td>
                <td style={tdStyle}>{file.uploadedBy}</td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
                  {file.probablyCurrent && (
                    <span
                      style={{
                        background: "var(--tc-blue-600)",
                        color: "var(--tc-white)",
                        borderRadius: 999,
                        padding: "2px 8px",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      PROBABLE VIGENTE
                    </span>
                  )}
                </td>
                <td style={tdStyle}>
                  <a
                    href={buildFileViewerUrl(projectId, file)}
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
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 6px",
  borderBottom: "2px solid var(--tc-gray-100)",
  color: "var(--tc-gray-500)",
  fontWeight: 600,
  fontSize: 11,
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 6px",
  borderBottom: "1px solid var(--tc-gray-100)",
  color: "var(--tc-gray-700)",
  verticalAlign: "top",
};
