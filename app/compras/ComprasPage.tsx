"use client";

import ComprasApp from "../../components/compras/ComprasApp";
import ComprasShell from "../../components/compras/ComprasShell";

export default function ComprasPage() {
  return <ComprasShell>{({ projectId, projectName, api }) => <ComprasApp api={api} projectId={projectId} projectName={projectName} />}</ComprasShell>;
}
