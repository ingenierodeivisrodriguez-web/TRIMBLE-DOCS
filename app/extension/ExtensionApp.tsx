"use client";

import { useState } from "react";
import Dashboard from "../../components/Dashboard";
import ExtensionShell from "../../components/ExtensionShell";
import FolderTreeTab from "../../components/folderTree/FolderTreeTab";
import PermissionAuditTab from "../../components/permissionAudit/PermissionAuditTab";

type Tab = "resumen" | "estructura" | "auditoria";

export default function ExtensionApp() {
  const [tab, setTab] = useState<Tab>("resumen");

  return (
    <ExtensionShell title="Resumen Archivos" iconPath="/icon.svg" menuCommand="resumen_archivos_open">
      {({ projectId, projectName, accessToken }) => (
        <div>
          <div style={tabBarStyle}>
            <TabButton active={tab === "resumen"} onClick={() => setTab("resumen")}>
              Resumen
            </TabButton>
            <TabButton active={tab === "estructura"} onClick={() => setTab("estructura")}>
              Estructura de Carpetas
            </TabButton>
            <TabButton active={tab === "auditoria"} onClick={() => setTab("auditoria")}>
              Auditoría de Permisos
            </TabButton>
          </div>

          {/* All tabs stay mounted (just hidden) so switching back and forth
              keeps search text, scroll position and expand/collapse state. */}
          <div style={{ display: tab === "resumen" ? "block" : "none" }}>
            <Dashboard projectId={projectId} projectName={projectName} accessToken={accessToken} />
          </div>
          <div style={{ display: tab === "estructura" ? "block" : "none" }}>
            <FolderTreeTab projectId={projectId} accessToken={accessToken} />
          </div>
          <div style={{ display: tab === "auditoria" ? "block" : "none" }}>
            <PermissionAuditTab projectId={projectId} accessToken={accessToken} />
          </div>
        </div>
      )}
    </ExtensionShell>
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
      onClick={onClick}
      style={{
        border: "none",
        background: "transparent",
        padding: "14px 20px",
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
        color: active ? "var(--tc-blue-700)" : "var(--tc-gray-500)",
        borderBottom: active ? "2px solid var(--tc-blue-700)" : "2px solid transparent",
      }}
    >
      {children}
    </button>
  );
}

const tabBarStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  background: "var(--tc-white)",
  borderBottom: "1px solid var(--tc-gray-100)",
  position: "sticky",
  top: 0,
  zIndex: 10,
};
