"use client";

import LoinApp from "../../components/loin/LoinApp";
import LoinShell from "../../components/loin/LoinShell";

export default function LoinPage() {
  return <LoinShell>{({ projectId, projectName, api }) => <LoinApp api={api} projectId={projectId} projectName={projectName} />}</LoinShell>;
}
