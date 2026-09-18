"use client";

import ExtensionShell from "../../components/ExtensionShell";
import ValidationApp from "../../components/validacion/ValidationApp";

export default function ValidacionApp() {
  return (
    <ExtensionShell title="Validación" iconPath="/icon-validacion.svg" menuCommand="validacion_open">
      {({ projectId, projectName, accessToken }) => (
        <ValidationApp projectId={projectId} projectName={projectName} accessToken={accessToken} />
      )}
    </ExtensionShell>
  );
}
