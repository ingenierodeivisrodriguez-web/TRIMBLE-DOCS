"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicarApi } from "../../lib/publicar/client";
import type { PublicacionInfo } from "../../lib/publicar/types";
import { message, Notice } from "../presupuesto/ui";
import ActividadTab from "./ActividadTab";
import CopiaProyectos from "./CopiaProyectos";
import PublicarTab from "./PublicarTab";
import RecibidoTab from "./RecibidoTab";
import Sincronizacion from "./Sincronizacion";

type Pestana = "publicar" | "recibido" | "actividad" | "copia";

const PESTANAS: { id: Pestana; texto: string }[] = [
  { id: "publicar", texto: "Publicar" },
  { id: "recibido", texto: "Recibido en este proyecto" },
  { id: "actividad", texto: "Actividad" },
  { id: "copia", texto: "Copia a mano" },
];

/**
 * "Publicar entre proyectos": publish from this project, receive here (the
 * reception folders and what arrives), the activity, and a one-off copy by
 * hand. On opening, it brings every publication up to date.
 */
export default function PublicarApp({ api, projectId, projectName }: { api: PublicarApi; projectId: string; projectName: string }) {
  const [pestana, setPestana] = useState<Pestana>("publicar");
  const [datos, setDatos] = useState<{ esAdmin: boolean; yo: string; publicaciones: PublicacionInfo[] } | null>(null);
  const [error, setError] = useState("");
  const [pedido, setPedido] = useState(0);
  const [recarga, setRecarga] = useState(0);

  const cargar = useCallback(() => {
    setRecarga((n) => n + 1);
    api
      .publicaciones()
      .then((r) => {
        setDatos(r);
        setError("");
      })
      .catch((err) => setError(message(err)));
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const pendientes = datos?.publicaciones.filter((p) => p.destinoProyecto === projectId).reduce((n, p) => n + p.archivos.filter((a) => a.estado === "diferencia").length, 0) ?? 0;

  return (
    <div style={{ padding: "18px 22px 40px", display: "grid", gap: 14 }}>
      <header style={{ maxWidth: 900 }}>
        <h1 style={{ margin: "0 0 4px", fontSize: 20, color: "var(--tc-blue-800)" }}>Publicar entre proyectos</h1>
        <p style={{ margin: 0, fontSize: 14, color: "var(--tc-gray-500)" }}>
          Publica documentos y carpetas de {projectName || "este proyecto"} en otro proyecto, y cada versión nueva llega sola al destino.
        </p>
      </header>
      <Sincronizacion api={api} pedido={pedido} onCambio={cargar} />
      <nav style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--tc-gray-300)", maxWidth: 1100, flexWrap: "wrap" }}>
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPestana(p.id)}
            style={{
              border: "none",
              borderBottom: pestana === p.id ? "3px solid var(--tc-blue-600)" : "3px solid transparent",
              background: "transparent",
              padding: "8px 12px",
              fontSize: 14,
              fontWeight: pestana === p.id ? 600 : 400,
              color: pestana === p.id ? "var(--tc-blue-800)" : "var(--tc-gray-700)",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {p.texto}
            {p.id === "recibido" && pendientes > 0 ? ` (${pendientes} por decidir)` : ""}
          </button>
        ))}
      </nav>
      {error && <Notice kind="error">{error}</Notice>}
      {pestana === "publicar" && datos && (
        <PublicarTab api={api} projectId={projectId} publicaciones={datos.publicaciones} yo={datos.yo} esAdmin={datos.esAdmin} onPublicado={() => setPedido((n) => n + 1)} onCambio={cargar} />
      )}
      {pestana === "recibido" && datos && <RecibidoTab api={api} projectId={projectId} publicaciones={datos.publicaciones} yo={datos.yo} esAdmin={datos.esAdmin} onCambio={() => setPedido((n) => n + 1)} />}
      {pestana === "actividad" && <ActividadTab api={api} recarga={recarga} />}
      {pestana === "copia" && <CopiaProyectos api={api} projectId={projectId} projectName={projectName} />}
      {!datos && !error && pestana !== "actividad" && pestana !== "copia" && <p style={{ fontSize: 13.5, color: "var(--tc-gray-500)" }}>Cargando…</p>}
    </div>
  );
}
