"use client";

import Dashboard from "../../components/Dashboard";
import ExtensionShell from "../../components/ExtensionShell";

export default function ExtensionApp() {
  return (
    <ExtensionShell title="Resumen Archivos" iconPath="/icon.svg" menuCommand="resumen_archivos_open">
      {({ projectId, projectName, accessToken }) => (
        <Dashboard projectId={projectId} projectName={projectName} accessToken={accessToken} />
      )}
    </ExtensionShell>
  );
}
