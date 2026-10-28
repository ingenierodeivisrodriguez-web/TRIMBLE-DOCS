"use client";

import { useState } from "react";
import type { RaApi } from "../../lib/ra/client";
import PanelPreparar from "./PanelPreparar";
import PanelPunto, { VisorPunto } from "./PanelPunto";

type Pestana = "preparar" | "punto";

/** "Realidad aumentada" in the 3D viewer: prepare a model, then place its QR. */
export default function PanelVisorRA({
  api,
  viewer,
  subscribe,
  projectName,
}: {
  api: RaApi;
  viewer: VisorPunto;
  subscribe: (l: (event: string, data: unknown) => void) => () => void;
  projectName: string;
}) {
  const [pestana, setPestana] = useState<Pestana>("preparar");
  const boton = (p: Pestana, texto: string) => (
    <button
      onClick={() => setPestana(p)}
      style={{
        flex: 1,
        padding: "8px 6px",
        border: "none",
        borderBottom: pestana === p ? "3px solid #2f55b0" : "3px solid transparent",
        background: "none",
        fontWeight: pestana === p ? 700 : 500,
        color: pestana === p ? "#2f55b0" : "#4b5563",
        cursor: "pointer",
        fontSize: 13.5,
      }}
    >
      {texto}
    </button>
  );
  return (
    <div>
      <div style={{ display: "flex", borderBottom: "1px solid #dfe4ea" }}>
        {boton("preparar", "Preparar")}
        {boton("punto", "Punto QR")}
      </div>
      {/* "Preparar" stays mounted so a conversion survives a tab switch; "Punto QR" reloads the prepared models each time it opens. */}
      <div style={{ display: pestana === "preparar" ? "block" : "none" }}>
        <PanelPreparar api={api} viewer={viewer} subscribe={subscribe} />
      </div>
      <div style={{ display: pestana === "punto" ? "block" : "none" }}>{pestana === "punto" && <PanelPunto api={api} viewer={viewer} subscribe={subscribe} projectName={projectName} />}</div>
    </div>
  );
}
