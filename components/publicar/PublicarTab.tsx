"use client";

import { useEffect, useState } from "react";
import type { PublicarApi } from "../../lib/publicar/client";
import type { ProyectoInfo, PublicacionInfo, Recepcion } from "../../lib/publicar/types";
import { acceptButton, baseInput, labelStyle, message, Notice } from "../presupuesto/ui";
import { card, linkBtn, select, texto, titulo } from "../compras/estilos";
import Explorador, { Elegido } from "./Explorador";
import ListaPublicaciones from "./ListaPublicaciones";

/**
 * "Publicar" (this project is the origin): pick files and folders, the
 * destination project and a note; they arrive in the reception folder its
 * administrator defined for this project and are kept up to date.
 */
export default function PublicarTab({
  api,
  projectId,
  publicaciones,
  yo,
  esAdmin,
  onPublicado,
  onCambio,
}: {
  api: PublicarApi;
  projectId: string;
  publicaciones: PublicacionInfo[];
  yo: string;
  esAdmin: boolean;
  onPublicado: () => void;
  onCambio: () => void;
}) {
  const [elegidos, setElegidos] = useState<Elegido[]>([]);
  const [proyectos, setProyectos] = useState<ProyectoInfo[] | null>(null);
  const [destino, setDestino] = useState("");
  const [recepcion, setRecepcion] = useState<{ destinoNombre: string; recepcion: Recepcion | null } | null>(null);
  const [nota, setNota] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState<{ publicadas: number; avisos: string[] } | null>(null);

  useEffect(() => {
    api
      .proyectos()
      .then((r) => setProyectos(r.proyectos))
      .catch((err) => setError(message(err)));
  }, [api]);

  useEffect(() => {
    setRecepcion(null);
    if (!destino) return;
    let vigente = true;
    api
      .recepcionHacia(destino)
      .then((r) => vigente && setRecepcion(r))
      .catch((err) => vigente && setError(message(err)));
    return () => {
      vigente = false;
    };
  }, [api, destino]);

  const otros = (proyectos ?? []).filter((p) => !p.actual);
  const listo = elegidos.length > 0 && !!destino && !!recepcion && !busy;

  function alternar(e: Elegido) {
    setHecho(null);
    setElegidos((xs) => (xs.some((x) => x.id === e.id) ? xs.filter((x) => x.id !== e.id) : [...xs, e]));
  }

  async function publicar() {
    if (!listo) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.publicar(
        destino,
        elegidos.map((e) => ({ tipo: e.tipo, id: e.id })),
        nota
      );
      setHecho({ publicadas: r.publicadas.length, avisos: r.avisos });
      if (r.publicadas.length) {
        setElegidos([]);
        setNota("");
        onPublicado();
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const desdeAqui = publicaciones.filter((p) => p.origenProyecto === projectId);

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 900 }}>
      <section style={card}>
        <h2 style={titulo}>Publicar en otro proyecto</h2>
        <p style={texto}>
          Marca archivos o carpetas completas (con sus subcarpetas). Llegan a la carpeta de recepción que el administrador del proyecto destino definió para este proyecto,
          con el mismo nombre, y cada versión nueva que se suba aquí se copia allá. Si alguien cambia el archivo en el destino, no se pisa: se muestra y se decide.
        </p>
        <Explorador api={api} proyecto={projectId} elegir="archivo" conCarpetas seleccionados={elegidos.map((e) => e.id)} onElegir={alternar} />
        {elegidos.length > 0 && (
          <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6 }}>
            {elegidos.map((e) => (
              <li key={e.id}>
                {e.tipo === "carpeta" ? <strong>Carpeta </strong> : null}
                {e.ruta}{" "}
                <button type="button" style={linkBtn} onClick={() => alternar(e)}>
                  quitar
                </button>
              </li>
            ))}
          </ul>
        )}

        <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
          <div>
            <label style={labelStyle} htmlFor="destino-publicar">
              Proyecto destino
            </label>
            {proyectos && otros.length === 0 ? (
              <Notice kind="warning">No perteneces a otro proyecto de Trimble Connect: para publicar necesitas ser miembro del proyecto destino.</Notice>
            ) : (
              <select id="destino-publicar" value={destino} onChange={(e) => setDestino(e.target.value)} style={{ ...select, minWidth: 320 }}>
                <option value="">{proyectos ? "Elige el proyecto destino…" : "Cargando tus proyectos…"}</option>
                {otros.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            )}
            {destino && recepcion && (
              <div style={{ marginTop: 6, fontSize: 13.5 }}>
                {recepcion.recepcion ? (
                  <>
                    Llega a: <strong>{recepcion.recepcion.carpetaRuta}</strong>
                  </>
                ) : (
                  <Notice kind="warning">
                    El administrador de {recepcion.destinoNombre} aún no definió la carpeta de recepción para este proyecto. Puedes publicar: queda esperando y se copia
                    cuando la defina (en su pestaña &quot;Recibido en este proyecto&quot;).
                  </Notice>
                )}
              </div>
            )}
          </div>
          <div>
            <label style={labelStyle} htmlFor="nota-publicar">
              Nota (queda en la actividad)
            </label>
            <textarea id="nota-publicar" value={nota} maxLength={500} rows={2} onChange={(e) => setNota(e.target.value)} placeholder="Por ejemplo: planos para coordinación, emisión para construcción…" style={{ ...baseInput, width: "100%", resize: "vertical" }} />
          </div>
          <div>
            <button type="button" onClick={publicar} disabled={!listo} style={{ ...acceptButton, opacity: listo ? 1 : 0.5, cursor: listo ? "pointer" : "not-allowed" }}>
              {busy ? "Publicando…" : elegidos.length > 1 ? `Publicar ${elegidos.length} elementos` : "Publicar"}
            </button>
            {!listo && !busy && <span style={{ marginLeft: 12, fontSize: 13, color: "var(--tc-gray-500)" }}>Elige qué publicar y el proyecto destino.</span>}
          </div>
          {hecho && (
            <Notice kind={hecho.publicadas ? "info" : "warning"}>
              {hecho.publicadas
                ? `${hecho.publicadas === 1 ? "Publicado" : `${hecho.publicadas} publicados`}: ${recepcion?.recepcion ? "se está copiando al destino (arriba se ve el avance)." : "quedan esperando la carpeta de recepción del destino."}`
                : "No se publicó nada nuevo."}
              {hecho.avisos.map((a, i) => (
                <div key={i}>{a}</div>
              ))}
            </Notice>
          )}
          {error && <Notice kind="error">{error}</Notice>}
        </div>
      </section>

      <section style={card}>
        <h2 style={titulo}>Publicado desde este proyecto</h2>
        <ListaPublicaciones api={api} publicaciones={desdeAqui} lado="hacia" yo={yo} esAdmin={esAdmin} onCambio={onCambio} />
      </section>
    </div>
  );
}
