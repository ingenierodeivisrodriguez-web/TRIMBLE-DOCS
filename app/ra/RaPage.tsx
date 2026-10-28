"use client";

import PanelPreparar from "../../components/ra/PanelPreparar";
import RaApp from "../../components/ra/RaApp";
import RaShell from "../../components/ra/RaShell";
import type { Host } from "../../components/trimble/ExtensionShell";

export default function RaPage({ forceHost }: { forceHost?: Host }) {
  return (
    <RaShell forceHost={forceHost}>
      {({ host, projectName, api, viewer, subscribe }) =>
        host === "3dviewer" && viewer ? <PanelPreparar api={api} viewer={viewer} subscribe={subscribe} /> : <RaApp api={api} projectName={projectName} />
      }
    </RaShell>
  );
}
