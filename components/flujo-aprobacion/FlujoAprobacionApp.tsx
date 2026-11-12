"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import { puedeCambiar } from "../../lib/flujo-aprobacion/flujos";
import { filasFlujos, filtrarFilas, FiltroLista, opcionesFiltro, resumenTablero } from "../../lib/flujo-aprobacion/lista";
import { diaColombia } from "../../lib/flujo-aprobacion/trazabilidad";
import type { ArchivoInfo, Equipo, EstadoFlujos, Flujo } from "../../lib/flujo-aprobacion/types";
import { baseInput, message, Modal, Notice } from "../presupuesto/ui";
import { descargarTrazabilidad } from "./descargas";
import EditorFlujo from "./EditorFlujo";
import ListaFlujos from "./ListaFlujos";
import ConfigCorreos from "./ConfigCorreos";
import MenuPuntos from "./MenuPuntos";
import PanelFlujo from "./PanelFlujo";
import RevisionCarpetas from "./RevisionCarpetas";
import Tablero from "./Tablero";
import Trazabilidad from "./Trazabilidad";

type Panel = { tipo: "detalle"; id: string; desactivar?: boolean; reactivar?: boolean } | { tipo: "nuevo" } | { tipo: "editar"; id: string } | null;

/** The window's width, to lay the side panel over the list on narrow screens. */
function useAncho() {
  const [ancho, setAncho] = useState(1400);
  useEffect(() => {
    const medir = () => setAncho(window.innerWidth);
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);
  return ancho;
}

/**
 * "Flujo de aprobación" in one screen, like Trimble's own lists: on opening,
 * the chosen files of every active flow are read and new versions registered;
 * below, the flows as a table with filters, and a click on a row opens its
 * details on the right (steps and responsibles, files and decisions, history,
 * comments). "Nuevo" (any member) and "Editar" open the flow form in a
 * floating box over the darkened screen.
 */
export default function FlujoAprobacionApp({ api, projectId, projectName }: { api: FlujoApi; projectId: string; projectName: string }) {
  const [datos, setDatos] = useState<EstadoFlujos | null>(null);
  const [archivos, setArchivos] = useState<{ yo: string; esAdmin: boolean; archivos: ArchivoInfo[] } | null>(null);
  const [equipo, setEquipo] = useState<Equipo | null>(null);
  const [error, setError] = useState("");
  const [errorArchivos, setErrorArchivos] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [filtro, setFiltro] = useState<FiltroLista>({});
  // «Prueba de conexión con Trimble» is hidden since 11-11-2026 (the owner: no longer needed);
  // PruebaFase0.tsx and /api/flujo-aprobacion/prueba stay, to show it again if Trimble changes.
  const [ventana, setVentana] = useState<"trazabilidad" | "correos" | null>(null);
  const [aviso, setAviso] = useState<{ kind: "info" | "error"; texto: string } | null>(null);
  const ancho = useAncho();
  const angosto = ancho < 1000;

  const cargar = useCallback(() => {
    api
      .flujos()
      .then((r) => {
        setDatos(r);
        setError("");
      })
      .catch((err) => setError(message(err)));
  }, [api]);

  const cargarArchivos = useCallback(() => {
    api
      .archivos()
      .then((r) => {
        setArchivos(r);
        setErrorArchivos("");
        setRecarga((n) => n + 1);
      })
      .catch((err) => setErrorArchivos(message(err)));
  }, [api]);

  useEffect(() => {
    cargar();
    cargarArchivos();
  }, [cargar, cargarArchivos]);

  // Arriving from an e-mail's button (phase 3): open that flow, or the files waiting for the person.
  const preguntado = useRef(false);
  useEffect(() => {
    if (!datos || preguntado.current) return;
    preguntado.current = true;
    api
      .pendiente()
      .then((p) => {
        if (p.flujoId && datos.flujos.some((f) => f.id === p.flujoId)) setPanel({ tipo: "detalle", id: p.flujoId });
        else if (p.porRevisar) setFiltro((f) => ({ ...f, porRevisar: true }));
        if (p.mensaje) setAviso({ kind: "info", texto: p.mensaje });
      })
      .catch(() => undefined);
  }, [api, datos]);

  // Trimble's people and groups, for choosing each step's responsible: read when the form opens.
  const editando = panel?.tipo === "nuevo" || panel?.tipo === "editar";
  useEffect(() => {
    if (!editando || equipo) return;
    api
      .equipo()
      .then(setEquipo)
      .catch((err) => setAviso({ kind: "error", texto: `No se pudo leer el equipo de Trimble: ${message(err)}` }));
  }, [api, editando, equipo]);

  // Copies to the destination that went through an upload: ask Trimble every few seconds
  // until it confirms them (only the person who started one, or an administrator).
  const intentos = useRef(new Map<string, number>());
  const [vuelta, setVuelta] = useState(0);
  useEffect(() => {
    if (!archivos) return;
    const enCurso = archivos.archivos.filter(
      (a) => a.traslado?.estado === "en-curso" && (a.traslado.porId === archivos.yo || archivos.esAdmin) && (intentos.current.get(a.id) ?? 0) < 45
    );
    if (!enCurso.length) return;
    const t = setTimeout(async () => {
      let cambio = false;
      for (const a of enCurso) {
        intentos.current.set(a.id, (intentos.current.get(a.id) ?? 0) + 1);
        try {
          const r = await api.traslado("confirmar", a.id);
          if (r.traslado?.estado !== "en-curso") cambio = true;
        } catch {
          // Asked again on the next round.
        }
      }
      if (cambio) cargarArchivos();
      else setVuelta((n) => n + 1);
    }, 4000);
    return () => clearTimeout(t);
  }, [archivos, vuelta, api, cargarArchivos]);

  const cambio = (e: EstadoFlujos) => {
    setDatos(e);
    setRecarga((n) => n + 1);
  };

  const hoy = diaColombia(new Date().toISOString());
  const filas = useMemo(() => (datos ? filasFlujos(datos.flujos, archivos?.archivos ?? [], hoy, datos.cierres) : []), [datos, archivos, hoy]);
  const visibles = useMemo(() => filtrarFilas(filas, filtro, hoy), [filas, filtro, hoy]);
  const opciones = useMemo(() => opcionesFiltro(filas), [filas]);
  const resumen = useMemo(() => resumenTablero(filas, archivos?.archivos ?? []), [filas, archivos]);
  const seleccionada = panel && panel.tipo !== "nuevo" ? filas.find((f) => f.flujo.id === panel.id) : undefined;
  const porRevisarTotal = filas.reduce((n, f) => n + f.porRevisar, 0);

  async function activar(f: Flujo) {
    try {
      cambio(await api.cambiarEstado(f.id, f.version, true));
    } catch (err) {
      setAviso({ kind: "error", texto: message(err) });
    }
  }
  async function pdf(f: Flujo) {
    try {
      await descargarTrazabilidad(api, { flujoId: f.id }, projectName, f.hito);
    } catch (err) {
      setAviso({ kind: "error", texto: `No se pudo generar el PDF: ${message(err)}` });
    }
  }

  // The form floats over the darkened screen; while editing, the flow's details stay behind it.
  // A flow closed by its first decision is never edited: only its details show.
  const abierto = !!panel && panel.tipo !== "nuevo" && !!seleccionada;
  const ventanaEditor =
    panel?.tipo === "nuevo" || (panel?.tipo === "editar" && seleccionada && !seleccionada.cierre) ? (
      <EditorFlujo
        key={panel.tipo === "nuevo" ? "nuevo" : panel.id}
        api={api}
        projectId={projectId}
        flujo={panel.tipo === "editar" ? (seleccionada?.flujo ?? null) : null}
        equipo={equipo}
        onGuardado={(e, id) => {
          cambio(e);
          // Its files were registered while saving.
          cargarArchivos();
          setAviso(e.mensaje ? { kind: "info", texto: e.mensaje } : null);
          setPanel(id ? { tipo: "detalle", id } : null);
        }}
        onCancelar={() => setPanel(panel.tipo === "editar" ? { tipo: "detalle", id: panel.id } : null)}
      />
    ) : null;
  const contenidoPanel =
    (panel?.tipo === "detalle" || panel?.tipo === "editar") && seleccionada && datos ? (
      <PanelFlujo
        key={seleccionada.flujo.id}
        api={api}
        projectId={projectId}
        projectName={projectName}
        fila={seleccionada}
        datos={datos}
        archivos={archivos}
        errorArchivos={errorArchivos}
        recarga={recarga}
        pedirDesactivar={panel.tipo === "detalle" && !!panel.desactivar}
        pedirReactivar={panel.tipo === "detalle" && !!panel.reactivar}
        onCambio={cambio}
        onCambioArchivos={() => {
          cargarArchivos();
          // A decision closes the flow: read the flows again.
          cargar();
        }}
        onEditar={() => setPanel({ tipo: "editar", id: seleccionada.flujo.id })}
        onCerrar={() => setPanel(null)}
      />
    ) : null;

  return (
    <div style={{ padding: "16px 20px 32px", background: "#f4f6f9", minHeight: "100vh", boxSizing: "border-box" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 auto", minWidth: 0, display: "grid", gap: 12 }}>
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 500, color: "var(--tc-gray-700)" }}>Flujo de aprobación</h1>
              <input
                value={filtro.texto ?? ""}
                onChange={(e) => setFiltro({ ...filtro, texto: e.target.value })}
                placeholder="Buscar flujo"
                aria-label="Buscar flujo"
                style={{ ...baseInput, borderRadius: 18, padding: "7px 14px", width: 220, background: "#eef1f5", border: "1px solid transparent", fontSize: 14 }}
              />
              {porRevisarTotal > 0 && (
                <button
                  type="button"
                  onClick={() => setFiltro({ ...filtro, porRevisar: !filtro.porRevisar })}
                  style={{ border: "none", background: "#fff1d6", color: "#8a5a00", borderRadius: 14, padding: "4px 12px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                  title="Ver solo los flujos con archivos que esperan tu paso"
                >
                  Tienes {porRevisarTotal} {porRevisarTotal === 1 ? "archivo" : "archivos"} por revisar
                </button>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {datos && (
                <button
                  type="button"
                  onClick={() => setPanel({ tipo: "nuevo" })}
                  style={{ border: "none", background: "#2f4f8f", color: "#fff", borderRadius: 3, padding: "10px 22px", fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                >
                  Nuevo
                </button>
              )}
              <MenuPuntos
                titulo="Más opciones"
                opciones={[
                  { texto: "Exportar trazabilidad (todos los flujos)…", onClick: () => setVentana("trazabilidad") },
                  // «Correos de aviso» (administrators): the e-mails, the Trimble ToDos and the test e-mail.
                  // Hidden at the owner's request (12-11-2026, once set): `oculto: !datos?.esAdmin` shows it again.
                  { texto: "Correos de aviso…", onClick: () => setVentana("correos"), oculto: true },
                ]}
              />
            </div>
          </header>
          {datos && <Tablero resumen={resumen} estado={filtro.estado ?? ""} onEstado={(estado) => setFiltro({ ...filtro, estado })} />}
          {datos && <RevisionCarpetas api={api} flujos={datos.flujos} onTermino={cargarArchivos} />}
          {error && <Notice kind="error">{error}</Notice>}
          {aviso && <Notice kind={aviso.kind}>{aviso.texto}</Notice>}
          {!datos && !error && <p style={{ fontSize: 13.5, color: "var(--tc-gray-500)" }}>Cargando…</p>}
          {datos && (
            <ListaFlujos
              filas={visibles}
              total={filas.length}
              filtro={filtro}
              onFiltro={setFiltro}
              opciones={opciones}
              seleccionado={seleccionada?.flujo.id ?? null}
              onSeleccionar={(id) => setPanel({ tipo: "detalle", id })}
              puedeEditar={(f) => puedeCambiar(f, { id: datos.yo, esAdmin: datos.esAdmin })}
              onEditar={(f) => setPanel({ tipo: "editar", id: f.id })}
              onActivar={(f) => void activar(f)}
              onDesactivar={(f) => setPanel({ tipo: "detalle", id: f.id, desactivar: true })}
              onReactivar={(f) => setPanel({ tipo: "detalle", id: f.id, reactivar: true })}
              onPdf={(f) => void pdf(f)}
            />
          )}
        </div>

        {abierto && !angosto && (
          <aside
            style={{
              flex: "0 0 min(560px, 46%)",
              position: "sticky",
              top: 8,
              maxHeight: "calc(100vh - 16px)",
              overflowY: "auto",
              background: "#fff",
              borderLeft: "1px solid #dfe4ea",
              boxShadow: "-2px 0 10px rgba(20,40,70,.08)",
            }}
          >
            {contenidoPanel}
          </aside>
        )}
      </div>
      {abierto && angosto && (
        <aside style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(560px, 100%)", overflowY: "auto", background: "#fff", boxShadow: "-4px 0 18px rgba(20,40,70,.22)", zIndex: 40 }}>{contenidoPanel}</aside>
      )}

      {ventanaEditor}

      {ventana === "trazabilidad" && (
        <Modal title="Trazabilidad de todos los flujos" onClose={() => setVentana(null)} width={1100}>
          <Trazabilidad api={api} flujos={datos?.flujos ?? []} projectName={projectName} />
        </Modal>
      )}
      {ventana === "correos" && <ConfigCorreos api={api} projectId={projectId} projectName={projectName} onClose={() => setVentana(null)} />}
    </div>
  );
}
