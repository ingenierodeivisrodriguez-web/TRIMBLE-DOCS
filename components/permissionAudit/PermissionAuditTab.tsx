"use client";

import { useState } from "react";
import type { AccessLevel } from "../../lib/trimbleApi";
import type { FolderAuditResult } from "../../lib/permissionAudit";
import Card from "../Card";
import StatCard from "../StatCard";
import { noticeBase, noticeStyles, primaryButtonStyle, secondaryButtonStyle } from "../validacion/ui";
import type { PermissionAuditState } from "./usePermissionAudit";
import { usePermissionAudit } from "./usePermissionAudit";

const n = (value: number) => value.toLocaleString("es");

const ACCESS_LABEL: Record<AccessLevel, string> = {
  READ: "READ (lectura)",
  FULL_ACCESS: "FULL_ACCESS (control total)",
  NO_ACCESS: "NO_ACCESS (sin acceso)",
};

type Filter = "all" | "open" | "fullAccess" | "customInheritance";

export default function PermissionAuditTab({
  projectId,
  accessToken,
}: {
  projectId: string;
  accessToken: string;
}) {
  const { state, runAudit } = usePermissionAudit(projectId, accessToken);

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <header
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 12,
        }}
      >
        <div>
          <h1 style={{ color: "var(--tc-blue-900)", margin: "0 0 4px" }}>Auditoría de Permisos</h1>
          <p style={{ color: "var(--tc-gray-500)", margin: 0, maxWidth: 640, fontSize: 13.5 }}>
            Carpetas de este proyecto con permisos personalizados: acceso abierto a todo el proyecto,
            control total otorgado directamente a una persona, o herencia desactivada.
          </p>
        </div>
        <button
          type="button"
          style={{ ...primaryButtonStyle, opacity: state.status === "running" ? 0.6 : 1 }}
          onClick={runAudit}
          disabled={state.status === "running"}
        >
          {state.status === "running"
            ? "Auditando..."
            : state.status === "idle"
              ? "Ejecutar auditoría"
              : "Actualizar auditoría"}
        </button>
      </header>

      <Body state={state} onRetry={runAudit} />
    </div>
  );
}

function Body({ state, onRetry }: { state: PermissionAuditState; onRetry: () => void }) {
  if (state.status === "idle") {
    return (
      <Card>
        <p style={{ margin: 0, color: "var(--tc-gray-700)", fontSize: 14 }}>
          La auditoría no se ejecuta sola. Pulsa <strong>Ejecutar auditoría</strong> para revisar los
          permisos de cada carpeta del proyecto — esto llama a la API de Trimble una vez por carpeta, así
          que en proyectos grandes puede tardar un poco.
        </p>
      </Card>
    );
  }

  if (state.status === "running") {
    return (
      <Card>
        <div style={{ textAlign: "center", padding: "24px 12px", color: "var(--tc-gray-500)" }}>
          <div style={{ fontSize: 15, color: "var(--tc-blue-800)", fontWeight: 600 }}>
            Revisando los permisos del proyecto...
          </div>
          {state.progress && state.progress.total > 0 ? (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              {n(state.progress.checked)} de {n(state.progress.total)} carpetas revisadas
            </div>
          ) : (
            <div style={{ marginTop: 8, fontSize: 13 }}>Recorriendo la estructura de carpetas...</div>
          )}
        </div>
      </Card>
    );
  }

  if (state.status === "error") {
    return (
      <Card>
        <div style={{ ...noticeBase, ...noticeStyles.error }}>
          <strong>No se pudo completar la auditoría.</strong>
          <p style={{ margin: "6px 0 10px" }}>{state.message}</p>
          <button type="button" style={secondaryButtonStyle} onClick={onRetry}>
            Reintentar
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Results
      key={state.runId}
      results={state.results}
      totalFolders={state.totalFolders}
      auditedAt={state.auditedAt}
    />
  );
}

function Results({
  results,
  totalFolders,
  auditedAt,
}: {
  results: FolderAuditResult[];
  totalFolders: number;
  auditedAt: number;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (results.length === 0) {
    return (
      <Card>
        <div style={{ ...noticeBase, ...noticeStyles.info }}>
          Ninguna carpeta de este proyecto tiene permisos personalizados: todas heredan el acceso por
          defecto del proyecto.
        </div>
      </Card>
    );
  }

  const openCount = results.filter((r) => r.openToEveryone).length;
  const fullAccessCount = results.filter((r) => r.directFullAccessUsers.length > 0).length;
  const customInheritanceCount = results.filter((r) => !r.inheritanceEnabled).length;

  const filtered = results.filter((r) => {
    if (filter === "open") return r.openToEveryone;
    if (filter === "fullAccess") return r.directFullAccessUsers.length > 0;
    if (filter === "customInheritance") return !r.inheritanceEnabled;
    return true;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>
        Auditado el {new Date(auditedAt).toLocaleString("es")}. {n(results.length)} carpeta(s) con
        permisos personalizados{totalFolders > 0 ? ` de ${n(totalFolders)} revisadas` : ""}. Haz clic en
        las tarjetas para filtrar la lista, y en una carpeta para ver el detalle.
      </div>

      <section style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <StatCard
          label="Carpetas con permisos propios"
          value={n(results.length)}
          hint="Al menos un acceso directo (no heredado)"
          active={filter === "all"}
          title="Ver todas"
          onClick={() => setFilter("all")}
        />
        <StatCard
          label="Abiertas a todo el proyecto"
          value={n(openCount)}
          hint="Comparten con todos los miembros del proyecto"
          active={filter === "open"}
          title="Ver solo estas"
          onClick={() => setFilter("open")}
        />
        <StatCard
          label="Control total directo a una persona"
          value={n(fullAccessCount)}
          hint="FULL_ACCESS otorgado a un usuario, no a un grupo"
          active={filter === "fullAccess"}
          title="Ver solo estas"
          onClick={() => setFilter("fullAccess")}
        />
        <StatCard
          label="Herencia desactivada"
          value={n(customInheritanceCount)}
          hint="La carpeta no hereda permisos de su carpeta padre"
          active={filter === "customInheritance"}
          title="Ver solo estas"
          onClick={() => setFilter("customInheritance")}
        />
      </section>

      <Card>
        <div style={{ fontSize: 12, color: "var(--tc-gray-500)", marginBottom: 8 }}>
          {filter === "all"
            ? `${n(filtered.length)} carpetas`
            : `${n(filtered.length)} de ${n(results.length)} carpetas coinciden con el filtro`}
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((folder) => (
            <FolderRow
              key={folder.folderId}
              folder={folder}
              expanded={expandedId === folder.folderId}
              onToggle={() => setExpandedId(expandedId === folder.folderId ? null : folder.folderId)}
            />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function FolderRow({
  folder,
  expanded,
  onToggle,
}: {
  folder: FolderAuditResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li style={{ border: "1px solid var(--tc-gray-100)", borderRadius: 8, padding: "10px 14px" }}>
      <button type="button" onClick={onToggle} style={folderRowButtonStyle}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--tc-gray-700)" }}>
          {expanded ? "▾" : "▸"} {folder.path}
        </span>
        {folder.openToEveryone && <Badge tone="warning">🌐 Abierto a todos</Badge>}
        {folder.directFullAccessUsers.length > 0 && (
          <Badge tone="warning">⚠ Control total directo: {folder.directFullAccessUsers.join(", ")}</Badge>
        )}
        {!folder.inheritanceEnabled && <Badge tone="info">Herencia desactivada</Badge>}
      </button>

      {expanded && (
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {folder.entries.map((entry, i) => (
            <li
              key={i}
              style={{
                fontSize: 12.5,
                color: "var(--tc-gray-700)",
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span>
                {entry.principalType === "group" && "👥 "}
                {entry.principalType === "all" && "🌐 "}
                {entry.name}
              </span>
              <span style={{ fontWeight: 600, color: "var(--tc-blue-700)", whiteSpace: "nowrap" }}>
                {ACCESS_LABEL[entry.accessLevel]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "warning" | "info" }) {
  const toneStyle =
    tone === "warning"
      ? { background: "#fff6e0", color: "#7a5300", border: "1px solid #f0c36d" }
      : { background: "var(--tc-blue-100)", color: "var(--tc-blue-900)", border: "1px solid var(--tc-blue-500)" };
  return (
    <span style={{ ...toneStyle, borderRadius: 999, padding: "2px 10px", fontSize: 11.5, fontWeight: 600 }}>
      {children}
    </span>
  );
}

const folderRowButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 0,
  width: "100%",
  textAlign: "left",
  cursor: "pointer",
  fontFamily: "inherit",
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
};
