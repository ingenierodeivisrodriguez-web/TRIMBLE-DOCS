"use client";

import { useEffect, useState } from "react";
import type { AncestorRef } from "../../lib/folderTreeClient";

interface PermissionEntry {
  principalType: "user" | "group" | "all";
  name: string;
  email?: string;
  accessLevel: "READ" | "FULL_ACCESS" | "NO_ACCESS";
  direct: boolean;
  inheritedFromName?: string;
}

interface PermissionsResponse {
  entries: PermissionEntry[];
  inheritanceEnabled: boolean;
}

const ACCESS_LABEL: Record<PermissionEntry["accessLevel"], string> = {
  READ: "READ (lectura)",
  FULL_ACCESS: "FULL_ACCESS (control total)",
  NO_ACCESS: "NO_ACCESS (sin acceso)",
};

const ACCESS_COLOR: Record<PermissionEntry["accessLevel"], string> = {
  READ: "var(--tc-blue-700)",
  FULL_ACCESS: "#1a8a4a",
  NO_ACCESS: "#b3261e",
};

export default function PermissionsPanel({
  projectId,
  accessToken,
  folderId,
  folderName,
  ancestors,
  onClose,
}: {
  projectId: string;
  accessToken: string;
  folderId: string;
  folderName: string;
  /** Root-first ancestor chain, including the project's own root folder. */
  ancestors: AncestorRef[];
  onClose: () => void;
}) {
  const [data, setData] = useState<PermissionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setData(null);
    const params = new URLSearchParams({
      projectId,
      folderId,
      ancestors: JSON.stringify(ancestors),
    });
    fetch(`/api/folder-permissions?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error ?? "Error al cargar permisos.");
        return res.json();
      })
      .then((json: PermissionsResponse) => {
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
  }, [projectId, accessToken, folderId, ancestors]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10, 61, 98, 0.35)",
        zIndex: 1100,
        display: "flex",
        justifyContent: "flex-end",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(380px, 90vw)",
          height: "100%",
          background: "var(--tc-white)",
          boxShadow: "-8px 0 24px rgba(10,61,98,0.25)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--tc-gray-100)",
          }}
        >
          <div>
            <h3 style={{ margin: 0, color: "var(--tc-blue-800)", fontSize: 15 }}>Permisos</h3>
            <p style={{ margin: "2px 0 0", color: "var(--tc-gray-500)", fontSize: 13 }}>{folderName}</p>
          </div>
          <button onClick={onClose} style={closeButtonStyle}>
            ✕
          </button>
        </div>

        <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>
          {loading && <p style={{ color: "var(--tc-gray-500)", fontSize: 13 }}>Cargando permisos...</p>}
          {error && <p style={{ color: "#b3261e", fontSize: 13 }}>{error}</p>}

          {data && data.entries.length === 0 && (
            <p style={{ color: "var(--tc-gray-500)", fontSize: 13 }}>
              No hay permisos explicitos para esta carpeta.
            </p>
          )}

          {data && data.entries.length > 0 && (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {data.entries.map((entry, i) => (
                <li
                  key={`${entry.principalType}-${entry.name}-${entry.accessLevel}-${i}`}
                  style={{
                    border: "1px solid var(--tc-gray-100)",
                    borderRadius: 8,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5, color: "var(--tc-gray-700)" }}>
                      {entry.principalType === "group" && "👥 "}
                      {entry.principalType === "all" && "🌐 "}
                      {entry.name}
                    </span>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        color: ACCESS_COLOR[entry.accessLevel],
                        whiteSpace: "nowrap",
                      }}
                    >
                      {ACCESS_LABEL[entry.accessLevel]}
                    </span>
                  </div>
                  {entry.email && (
                    <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>{entry.email}</div>
                  )}
                  <div style={{ fontSize: 11.5, marginTop: 4 }}>
                    {entry.direct ? (
                      <span style={directBadgeStyle}>Directo en esta carpeta</span>
                    ) : (
                      <span style={inheritedBadgeStyle}>
                        Heredado{entry.inheritedFromName ? ` de "${entry.inheritedFromName}"` : ""}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
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
  width: 28,
  height: 28,
  cursor: "pointer",
  color: "var(--tc-gray-700)",
  fontSize: 13,
  flexShrink: 0,
};

const directBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 999,
  background: "var(--tc-blue-100)",
  color: "var(--tc-blue-700)",
  fontWeight: 600,
};

const inheritedBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 999,
  background: "var(--tc-gray-100)",
  color: "var(--tc-gray-500)",
  fontWeight: 600,
};
