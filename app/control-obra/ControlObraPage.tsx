"use client";

import ControlObraApp from "../../components/control-obra/ControlObraApp";
import ControlObraShell from "../../components/control-obra/ControlObraShell";

export default function ControlObraPage() {
  return <ControlObraShell>{({ projectId, projectName, api }) => <ControlObraApp api={api} projectId={projectId} projectName={projectName} />}</ControlObraShell>;
}
