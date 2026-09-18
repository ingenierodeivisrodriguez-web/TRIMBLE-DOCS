"use client";

import { useEffect, useMemo, useState } from "react";
import { CrawlProgress, fetchWithProgress } from "../lib/apiClient";
import { buildFileViewerUrl, extLabel, formatBytes, formatDate } from "../lib/format";
import { FileRecord, FilesListResponse, TypeAggregate } from "../lib/types";

type View =
  | { kind: "others"; items: TypeAggregate[] }
  | { kind: "files"; ext: string }
  | { kind: "recent"; days: number };

const PAGE_SIZE = 25;

export default function DetailModal({
  initialView,
  projectId,
  accessToken,
  onClose,
}: {
  initialView: View;
  projectId: string;
  accessToken: string;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>(initialView);
  const [fileCount, setFileCount] = useState<number | null>(null);

  useEffect(() => {
    setFileCount(null);
  }, [view]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 61, 98, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--tc-white)",
          borderRadius: "var(--tc-radius)",
          width: "min(920px, 100%)",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 12px 32px rgba(10,61,98,0.3)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 22px",
            borderBottom: "1px solid var(--tc-gray-100)",
          }}
        >
          <div>
            <h3 style={{ margin: 0, color: "var(--tc-blue-800)" }}>
              {view.kind === "others" && "Otros tipos de archivo"}
              {view.kind === "files" && `Archivos: ${extLabel(view.ext)}`}
              {view.kind === "recent" && `Archivos cargados en los ultimos ${view.days} dias`}
            </h3>
            {view.kind !== "others" && fileCount !== null && (
              <span style={countBadgeStyle}>{fileCount.toLocaleString("es")} en total</span>
            )}
          </div>
          <button onClick={onClose} style={closeButtonStyle}>
            ✕
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "0 22px 22px" }}>
          {view.kind === "others" && (
            <OthersTable items={view.items} onSelect={(ext) => setView({ kind: "files", ext })} />
          )}
          {view.kind === "files" && (
            <FilesTable
              projectId={projectId}
              accessToken={accessToken}
              query={{ ext: view.ext }}
              onCountChange={setFileCount}
            />
          )}
          {view.kind === "recent" && (
            <FilesTable
              projectId={projectId}
              accessToken={accessToken}
              query={{ days: view.days }}
              onCountChange={setFileCount}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const countBadgeStyle: React.CSSProperties = {
  display: "block",
  marginTop: 2,
  fontSize: 13,
  color: "var(--tc-gray-500)",
};

const closeButtonStyle: React.CSSProperties = {
  border: "none",
  background: "var(--tc-gray-100)",
  borderRadius: 6,
  width: 30,
  height: 30,
  cursor: "pointer",
  color: "var(--tc-gray-700)",
  fontSize: 14,
};

function OthersTable({
  items,
  onSelect,
}: {
  items: TypeAggregate[];
  onSelect: (ext: string) => void;
}) {
  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>Tipo</th>
          <th style={thStyle}>Archivos</th>
          <th style={thStyle}>Tamano</th>
          <th style={thStyle} />
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.ext} style={{ cursor: "pointer" }} onClick={() => onSelect(item.ext)}>
            <td style={tdStyle}>{extLabel(item.ext)}</td>
            <td style={tdStyle}>{item.count}</td>
            <td style={tdStyle}>{formatBytes(item.size)}</td>
            <td style={{ ...tdStyle, color: "var(--tc-blue-600)" }}>Ver archivos →</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type SortKey = "name" | "folderPath" | "size" | "uploadedBy" | "modifiedOn" | "version";
type SortDir = "asc" | "desc";

const DEFAULT_SORT_DIR: Record<SortKey, SortDir> = {
  name: "asc",
  folderPath: "asc",
  size: "desc",
  uploadedBy: "asc",
  modifiedOn: "desc",
  version: "desc",
};

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Nombre" },
  { key: "folderPath", label: "Carpeta" },
  { key: "size", label: "Tamano" },
  { key: "uploadedBy", label: "Subido por" },
  { key: "modifiedOn", label: "Fecha" },
  { key: "version", label: "Version" },
];

const COLUMN_COUNT = COLUMNS.length + 1; // + the non-sortable "Abrir" column

function compareFiles(a: FileRecord, b: FileRecord, key: SortKey): number {
  if (key === "size") return a.size - b.size;
  if (key === "version") return a.version - b.version;
  if (key === "modifiedOn") return a.modifiedOn < b.modifiedOn ? -1 : a.modifiedOn > b.modifiedOn ? 1 : 0;
  return a[key].localeCompare(b[key], "es", { sensitivity: "base" });
}

type FilesQuery = { ext: string } | { days: number };

function FilesTable({
  projectId,
  accessToken,
  query,
  onCountChange,
}: {
  projectId: string;
  accessToken: string;
  query: FilesQuery;
  onCountChange: (count: number) => void;
}) {
  const [allItems, setAllItems] = useState<FileRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState<CrawlProgress | null>(null);
  const [error, setError] = useState<string>("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("modifiedOn");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const queryKey = "ext" in query ? `ext:${query.ext}` : `days:${query.days}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setLoadingProgress(null);
    const params = new URLSearchParams({
      projectId,
      ...("ext" in query ? { ext: query.ext } : { days: String(query.days) }),
    });
    fetchWithProgress<FilesListResponse>(
      `/api/files?${params.toString()}`,
      accessToken,
      (p) => {
        if (!cancelled) setLoadingProgress(p);
      },
      () => cancelled
    )
      .then((json) => {
        if (!cancelled && json) setAllItems(json.items);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, queryKey, accessToken]);

  const filteredSorted = useMemo(() => {
    if (!allItems) return [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? allItems.filter(
          (f) =>
            f.name.toLowerCase().includes(q) ||
            f.folderPath.toLowerCase().includes(q) ||
            f.uploadedBy.toLowerCase().includes(q)
        )
      : allItems;
    const sorted = [...filtered].sort((a, b) => compareFiles(a, b, sortKey));
    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [allItems, search, sortKey, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [search, sortKey, sortDir]);

  useEffect(() => {
    onCountChange(filteredSorted.length);
  }, [filteredSorted.length, onCountChange]);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(DEFAULT_SORT_DIR[key]);
    }
  }

  if (error) return <p style={{ color: "#b3261e" }}>{error}</p>;

  const totalPages = Math.max(1, Math.ceil(filteredSorted.length / PAGE_SIZE));
  const pageItems = filteredSorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nombre, carpeta o usuario..."
        style={searchInputStyle}
      />

      <table style={tableStyle}>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th key={col.key} style={thStyle}>
                <button style={sortButtonStyle} onClick={() => handleSort(col.key)}>
                  {col.label}
                  <span style={{ opacity: sortKey === col.key ? 1 : 0.25, marginLeft: 4 }}>
                    {sortKey === col.key && sortDir === "asc" ? "▲" : "▼"}
                  </span>
                </button>
              </th>
            ))}
            <th style={thStyle} />
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td style={tdStyle} colSpan={COLUMN_COUNT}>
                {loadingProgress && loadingProgress.folders > 0
                  ? `Cargando... (${loadingProgress.files.toLocaleString("es")} archivos encontrados hasta ahora)`
                  : "Cargando..."}
              </td>
            </tr>
          )}
          {!loading &&
            pageItems.map((file) => (
              <tr key={file.id}>
                <td style={tdStyle}>{file.name}</td>
                <td style={tdStyle}>{file.folderPath}</td>
                <td style={tdStyle}>{formatBytes(file.size)}</td>
                <td style={tdStyle}>{file.uploadedBy}</td>
                <td style={tdStyle}>{formatDate(file.modifiedOn)}</td>
                <td style={tdStyle}>v{file.version}</td>
                <td style={tdStyle}>
                  <a
                    href={buildFileViewerUrl(projectId, file)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={openLinkStyle}
                  >
                    Abrir ↗
                  </a>
                </td>
              </tr>
            ))}
          {!loading && pageItems.length === 0 && (
            <tr>
              <td style={tdStyle} colSpan={COLUMN_COUNT}>
                No hay archivos que coincidan con la busqueda.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {!loading && filteredSorted.length > PAGE_SIZE && (
        <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 14 }}>
          <button
            style={pagerButtonStyle}
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Anterior
          </button>
          <span style={{ color: "var(--tc-gray-500)", alignSelf: "center", fontSize: 13 }}>
            Pagina {page} de {totalPages} ({filteredSorted.length} archivos)
          </span>
          <button
            style={pagerButtonStyle}
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente →
          </button>
        </div>
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
  padding: 0,
  borderBottom: "2px solid var(--tc-gray-100)",
  color: "var(--tc-gray-500)",
  fontWeight: 600,
  fontSize: 12,
  textTransform: "uppercase",
  position: "sticky",
  top: 0,
  background: "var(--tc-white)",
};

const sortButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  width: "100%",
  border: "none",
  background: "transparent",
  cursor: "pointer",
  padding: "10px 8px",
  color: "inherit",
  font: "inherit",
  textTransform: "inherit",
};

const searchInputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 14px",
  marginBottom: 14,
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 8,
  fontSize: 14,
  color: "var(--tc-gray-700)",
  outline: "none",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid var(--tc-gray-100)",
  color: "var(--tc-gray-700)",
};

const openLinkStyle: React.CSSProperties = {
  color: "var(--tc-blue-600)",
  fontWeight: 600,
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const pagerButtonStyle: React.CSSProperties = {
  border: "1px solid var(--tc-gray-300)",
  background: "var(--tc-white)",
  borderRadius: 6,
  padding: "6px 14px",
  cursor: "pointer",
  fontSize: 13,
  color: "var(--tc-blue-700)",
};
