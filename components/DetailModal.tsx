"use client";

import { useEffect, useState } from "react";
import { extLabel, formatBytes, formatDate } from "../lib/format";
import { FileRecord, FilesPageResponse, TypeAggregate } from "../lib/types";

type View = { kind: "others"; items: TypeAggregate[] } | { kind: "files"; ext: string };

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
          <h3 style={{ margin: 0, color: "var(--tc-blue-800)" }}>
            {view.kind === "others" ? "Otros tipos de archivo" : `Archivos: ${extLabel(view.ext)}`}
          </h3>
          <button onClick={onClose} style={closeButtonStyle}>
            ✕
          </button>
        </div>

        <div style={{ overflowY: "auto", padding: "0 22px 22px" }}>
          {view.kind === "others" ? (
            <OthersTable items={view.items} onSelect={(ext) => setView({ kind: "files", ext })} />
          ) : (
            <FilesTable projectId={projectId} accessToken={accessToken} ext={view.ext} />
          )}
        </div>
      </div>
    </div>
  );
}

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

function FilesTable({
  projectId,
  accessToken,
  ext,
}: {
  projectId: string;
  accessToken: string;
  ext: string;
}) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<FilesPageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      projectId,
      ext,
      page: String(page),
      pageSize: String(PAGE_SIZE),
    });
    fetch(`/api/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? "Error al cargar archivos.");
        return res.json();
      })
      .then((json: FilesPageResponse) => {
        if (!cancelled) setData(json);
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
  }, [projectId, ext, page]);

  if (error) return <p style={{ color: "#b3261e" }}>{error}</p>;

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Nombre</th>
            <th style={thStyle}>Carpeta</th>
            <th style={thStyle}>Tamano</th>
            <th style={thStyle}>Subido por</th>
            <th style={thStyle}>Fecha</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td style={tdStyle} colSpan={5}>
                Cargando...
              </td>
            </tr>
          )}
          {!loading &&
            data?.items.map((file: FileRecord) => (
              <tr key={file.id}>
                <td style={tdStyle}>{file.name}</td>
                <td style={tdStyle}>{file.folderPath}</td>
                <td style={tdStyle}>{formatBytes(file.size)}</td>
                <td style={tdStyle}>{file.uploadedBy}</td>
                <td style={tdStyle}>{formatDate(file.modifiedOn)}</td>
              </tr>
            ))}
          {!loading && data?.items.length === 0 && (
            <tr>
              <td style={tdStyle} colSpan={5}>
                No hay archivos.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {data && data.total > data.pageSize && (
        <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 14 }}>
          <button
            style={pagerButtonStyle}
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Anterior
          </button>
          <span style={{ color: "var(--tc-gray-500)", alignSelf: "center", fontSize: 13 }}>
            Pagina {page} de {totalPages} ({data.total} archivos)
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
  padding: "10px 8px",
  borderBottom: "2px solid var(--tc-gray-100)",
  color: "var(--tc-gray-500)",
  fontWeight: 600,
  fontSize: 12,
  textTransform: "uppercase",
  position: "sticky",
  top: 0,
  background: "var(--tc-white)",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid var(--tc-gray-100)",
  color: "var(--tc-gray-700)",
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
