"use client";

import { useEffect, useState } from "react";
import PropiedadesShell, { PropiedadesContext } from "../../../components/propiedades/PropiedadesShell";
import SeleccionPorGrupos from "../../../components/propiedades/SeleccionPorGrupos";
import { isValuesChanged } from "../../../lib/propiedades/messages";

export default function AgrupacionPage() {
  return <PropiedadesShell forceHost="3dviewer">{(context) => (context.viewer ? <Agrupacion context={context} /> : null)}</PropiedadesShell>;
}

/**
 * "Seleccionar por agrupación" as its own 3D viewer extension, shown on the
 * right while the Propiedades panel stays on the left. When Propiedades saves
 * values (it broadcasts VALUES_CHANGED), the attributes are read again here.
 */
function Agrupacion({ context }: { context: PropiedadesContext }) {
  const { subscribe, viewer, projectId, getAccessToken, api } = context;
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(
    () =>
      subscribe((event, data) => {
        if (event === "extension.broadcast" && isValuesChanged(data)) setDataVersion((v) => v + 1);
      }),
    [subscribe]
  );

  return (
    <div style={{ height: "100vh", overflowY: "auto" }}>
      <SeleccionPorGrupos
        active
        viewer={viewer!}
        subscribe={subscribe}
        projectId={projectId}
        getAccessToken={getAccessToken}
        api={api}
        dataVersion={dataVersion}
      />
    </div>
  );
}
