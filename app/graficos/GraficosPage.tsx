"use client";

import GraficosApp from "../../components/graficos/GraficosApp";
import ViewerShell from "../../components/graficos/ViewerShell";

export default function GraficosPage() {
  return <ViewerShell>{({ viewer, subscribe }) => <GraficosApp viewer={viewer} subscribe={subscribe} />}</ViewerShell>;
}
