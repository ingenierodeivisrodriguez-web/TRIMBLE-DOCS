"use client";

import LoinApp from "../../components/loin/LoinApp";
import LoinShell from "../../components/loin/LoinShell";
import PanelVisor from "../../components/loin/PanelVisor";
import type { VisorLoin } from "../../lib/loin/lecturaVisor";
import type { Host } from "../../components/trimble/ExtensionShell";

export default function LoinPage({ forceHost }: { forceHost?: Host }) {
  return (
    <LoinShell forceHost={forceHost}>
      {({ host, projectId, projectName, api, viewer, subscribe }) =>
        host === "3dviewer" && viewer ? (
          <PanelVisor api={api} viewer={viewer as unknown as VisorLoin} subscribe={subscribe} proyecto={projectName || projectId} />
        ) : (
          <LoinApp api={api} projectId={projectId} projectName={projectName} />
        )
      }
    </LoinShell>
  );
}
