"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelSpec } from "trimble-connect-workspace-api";
import { Auditado, auditar, ESTADOS, MOTIVOS_FALLA, ObjetoAuditado } from "../../lib/loin/auditoria";
import { clasificar, claveObjeto, ModeloLeido, ResultadoClasificacion } from "../../lib/loin/clasificacion";
import type { LoinApi } from "../../lib/loin/client";
import { exportarAuditoriaExcel, exportarAuditoriaPdf, imagenesParaPdf } from "../../lib/loin/exportarAuditoria";
import { selectorDe, VisorLoin } from "../../lib/loin/lecturaVisor";
import { etapasOrdenadas, fechaCorta, indiceCeldas } from "../../lib/loin/matriz";
import type { Disciplina, ElementosResponse, EstadoObjeto, EstadoResponse, Excepcion, MatrizResponse, Parametro } from "../../lib/loin/types";
import { readSelection, SelectedElement } from "../../lib/propiedades/selection";
import type { PropiedadesViewer } from "../../lib/propiedades/selection";
import { acceptButton, C, message } from "../presupuesto/ui";
import { area, ayuda, botonSecundario, campo, linkBtn, select } from "./estilos";
import VistaResumenAuditoria, { ChipEstado } from "./VistaResumenAuditoria";

type ViewerSelection = { modelId: string; objectRuntimeIds?: number[] }[];
type Nota = { kind: "info" | "warning" | "error"; text: string };
const n = (x: number) => x.toLocaleString("es");

/**
 * The audit of a stage in the 3D viewer: reads the chosen models, classifies
 * their objects, checks each one's required parameters, paints them green,
 * yellow, red or gray, and shows what a clicked object lacks (with its
 * element's reference image). Failures can be accepted as exceptions and the
 * audit saved for the history.
 */
export default function PanelAuditoria({
  api,
  viewer,
  puede,
  proyecto,
  estado,
  elems,
  cargados,
  disciplinasDeModelo,
  manuales,
  seleccion,
  ocupado,
  asegurarLeidos,
  colorear,
  quitarColores,
  setNota,
}: {
  api: LoinApi;
  viewer: VisorLoin;
  puede: boolean;
  proyecto: string;
  estado: EstadoResponse;
  elems: ElementosResponse;
  cargados: ModelSpec[];
  disciplinasDeModelo: Map<string, string[]>;
  manuales: Map<string, string>;
  seleccion: ViewerSelection;
  ocupado: boolean;
  asegurarLeidos: (ids: string[]) => Promise<ModeloLeido[] | null>;
  colorear: (g: { color: string; porModelo: Map<string, number[]> }[], seleccionar: Map<string, number[]> | null) => Promise<void>;
  quitarColores: () => Promise<void>;
  setNota: (n: Nota) => void;
}) {
  const [datos, setDatos] = useState<{ catalogo: Parametro[]; matriz: MatrizResponse; excepciones: Excepcion[] } | null>(null);
  const [error, setError] = useState("");
  const [etapaId, setEtapaId] = useState("");
  const [discSel, setDiscSel] = useState<Set<string> | null>(null);
  const [modSel, setModSel] = useState<Set<string> | null>(null);
  const [auditado, setAuditado] = useState<Auditado | null>(null);
  const base = useRef<{ modelos: ModeloLeido[]; clasificacion: ResultadoClasificacion } | null>(null);
  const [busy, setBusy] = useState("");
  const [notaAuditoria, setNotaAuditoria] = useState("");

  const cargar = useCallback(async () => {
    setError("");
    try {
      const [c, matriz, excepciones] = await Promise.all([api.getCatalogo(), api.getMatriz(), api.getExcepciones()]);
      setDatos({ catalogo: c.parametros, matriz, excepciones });
      const etapas = etapasOrdenadas(matriz.etapas);
      const conNdi = etapas.find((e) => matriz.celdas.some((x) => x.etapaId === e.id && x.ndi !== null));
      setEtapaId((actual) => actual || conNdi?.id || etapas[0]?.id || "");
    } catch (err) {
      setError(message(err));
    }
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const disciplinas = useMemo(() => elems.disciplinas.filter((d) => d.activo).sort((a, b) => a.orden - b.orden), [elems]);
  const modelos = useMemo(() => cargados.filter((m) => (disciplinasDeModelo.get(m.id) ?? []).length > 0), [cargados, disciplinasDeModelo]);
  const conModelo = useMemo(() => disciplinas.filter((d) => modelos.some((m) => (disciplinasDeModelo.get(m.id) ?? []).includes(d.id))), [disciplinas, modelos, disciplinasDeModelo]);
  const elementosPorId = useMemo(() => new Map(elems.elementos.map((e) => [e.id, e])), [elems]);
  const disciplinaPorId = useMemo(() => new Map(elems.disciplinas.map((d) => [d.id, d])), [elems]);

  function calcular(b: { modelos: ModeloLeido[]; clasificacion: ResultadoClasificacion }, excepciones: Excepcion[]): Auditado | null {
    if (!datos) return null;
    const etapa = datos.matriz.etapas.find((e) => e.id === etapaId);
    if (!etapa) return null;
    const r = auditar({
      proyecto,
      etapa,
      modelos: b.modelos,
      versiones: new Map(cargados.map((m) => [m.id, m.versionId ?? null])),
      clasificacion: b.clasificacion,
      disciplinas: elems.disciplinas,
      elementos: elems.elementos,
      catalogo: new Map(datos.catalogo.map((p) => [p.id, p])),
      celdas: indiceCeldas(datos.matriz.celdas),
      valoresBasura: estado.config.valoresBasura,
      umbralAmarillo: estado.config.umbralAmarillo,
      excepciones: new Set(excepciones.filter((x) => x.activa && x.etapaId === etapa.id).map((x) => `${x.ifcGuid}|${x.parametroId}`)),
      disciplinaIds: discSel,
    });
    setAuditado(r);
    return r;
  }

  async function pintar(r: Auditado) {
    const grupos = new Map<EstadoObjeto | "sin_clasificar", Map<string, number[]>>();
    const agregar = (k: EstadoObjeto | "sin_clasificar", modelo: string, id: number) => {
      const m = grupos.get(k) ?? new Map<string, number[]>();
      m.set(modelo, [...(m.get(modelo) ?? []), id]);
      grupos.set(k, m);
    };
    for (const o of r.detalle.values()) agregar(o.estado, o.viewerModelId, o.runtimeId);
    const viewerDe = new Map((base.current?.modelos ?? []).map((m) => [m.fileId, m.viewerModelId]));
    for (const s of base.current?.clasificacion.sinClasificar ?? []) agregar("sin_clasificar", viewerDe.get(s.fileId) ?? s.fileId, s.objeto.runtimeId);
    await colorear([...grupos].map(([k, porModelo]) => ({ color: ESTADOS[k].color, porModelo })), null);
  }

  async function auditarAhora() {
    if (!datos) return;
    const ids = modelos.filter((m) => !modSel || modSel.has(m.id)).map((m) => m.id);
    if (ids.length === 0) {
      setNota({ kind: "warning", text: "No hay modelos con disciplina para auditar. Asígnalas en la pestaña Modelos." });
      return;
    }
    setBusy("Auditando…");
    try {
      const leidos = await asegurarLeidos(ids);
      if (!leidos) return;
      const clasificacion = clasificar(leidos, disciplinasDeModelo, elems.disciplinas, elems.elementos, manuales);
      base.current = { modelos: leidos, clasificacion };
      const r = calcular(base.current, datos.excepciones);
      if (r) await pintar(r);
    } catch (err) {
      setNota({ kind: "error", text: message(err) });
    } finally {
      setBusy("");
    }
  }

  async function guardar() {
    if (!auditado) return;
    setBusy("Guardando la auditoría…");
    try {
      const a = await api.guardarAuditoria(auditado.informe, notaAuditoria, (hechas, total) => setBusy(`Guardando la auditoría: ${hechas} de ${total} partes…`));
      setNota({ kind: "info", text: `Auditoría guardada (${fechaCorta(a.creada.slice(0, 10))}). Queda en el menú del proyecto, pestaña Auditorías, para el historial y los informes.` });
      setNotaAuditoria("");
    } catch (err) {
      setNota({ kind: "error", text: `No se terminó de guardar: ${message(err)} Puedes volver a intentarlo.` });
    } finally {
      setBusy("");
    }
  }

  async function exportar(tipo: "excel" | "pdf") {
    if (!auditado) return;
    setBusy(tipo === "excel" ? "Preparando el Excel…" : "Preparando el PDF…");
    try {
      if (tipo === "excel") await exportarAuditoriaExcel(auditado.informe);
      else {
        const urls = new Map<string, string>();
        for (const e of auditado.informe.elementos) {
          const img = elems.imagenes.find((i) => i.elementoId === e.id && i.url);
          if (img) urls.set(e.id, img.url);
        }
        await exportarAuditoriaPdf(auditado.informe, await imagenesParaPdf(urls));
      }
    } catch (err) {
      setNota({ kind: "error", text: message(err) });
    } finally {
      setBusy("");
    }
  }

  async function aceptar(filas: { objeto: ObjetoAuditado; parametroId: string }[], justificacion: string) {
    if (!datos || !base.current) return;
    setBusy("Guardando las excepciones…");
    try {
      const creadas = await api.crearExcepciones(
        filas.map((f) => ({ id: crypto.randomUUID(), etapaId, ifcGuid: f.objeto.ifcGuid!, parametroId: f.parametroId, elementoId: f.objeto.elementoId, justificacion }))
      );
      const excepciones = await api.getExcepciones();
      setDatos({ ...datos, excepciones });
      const r = calcular(base.current, excepciones);
      if (r) await pintar(r);
      setNota({ kind: "info", text: `${n(creadas)} incumplimiento(s) aceptado(s) como excepción. Quedan en el historial con tu nombre y la justificación.` });
    } catch (err) {
      setNota({ kind: "error", text: message(err) });
    } finally {
      setBusy("");
    }
  }

  if (error) return <p style={{ ...ayuda, color: "#b3261e" }}>{error}</p>;
  if (!datos) return <p style={ayuda}>Cargando la matriz y el catálogo…</p>;
  const etapas = etapasOrdenadas(datos.matriz.etapas);
  const alternar = (s: Set<string> | null, todos: string[], id: string) => {
    const actual = new Set(s ?? todos);
    if (actual.has(id)) actual.delete(id);
    else actual.add(id);
    return actual.size === todos.length ? null : actual;
  };

  return (
    <>
      {etapas.length === 0 && <p style={ayuda}>No hay etapas: créalas en el menú del proyecto, pestaña Matriz LOIN.</p>}
      <div style={tarjeta}>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          Etapa
          <select
            value={etapaId}
            onChange={(e) => {
              setEtapaId(e.target.value);
              setAuditado(null);
            }}
            style={{ ...select, flex: 1 }}
            aria-label="Etapa"
          >
            {etapas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre}
                {e.fecha ? ` (${fechaCorta(e.fecha)})` : ""}
              </option>
            ))}
          </select>
        </label>
        <div style={{ marginTop: 6, fontSize: 12.5 }}>Disciplinas:</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {conModelo.map((d) => {
            const activa = !discSel || discSel.has(d.id);
            return (
              <button key={d.id} type="button" aria-pressed={activa} onClick={() => setDiscSel(alternar(discSel, conModelo.map((x) => x.id), d.id))} style={chipBoton(activa, d.color)}>
                {d.codigo}
              </button>
            );
          })}
          {conModelo.length === 0 && <span style={ayuda}>Ningún modelo cargado tiene disciplina (pestaña Modelos).</span>}
        </div>
        <div style={{ marginTop: 6, fontSize: 12.5 }}>Modelos:</div>
        {modelos.map((m) => (
          <label key={m.id} style={{ display: "flex", gap: 6, fontSize: 12.5, alignItems: "center" }}>
            <input type="checkbox" checked={!modSel || modSel.has(m.id)} onChange={() => setModSel(alternar(modSel, modelos.map((x) => x.id), m.id))} />
            <span style={{ wordBreak: "break-word" }}>{m.name ?? m.id}</span>
            {m.versionId && <span style={{ color: "var(--tc-gray-500)" }}>(versión {m.versionId.slice(0, 10)})</span>}
          </label>
        ))}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <button type="button" style={{ ...acceptButton, padding: "7px 14px", fontSize: 14 }} disabled={!!busy || ocupado || !etapaId} onClick={auditarAhora}>
            {auditado ? "Auditar de nuevo" : "Auditar"}
          </button>
          {auditado && (
            <>
              <button type="button" style={botonSecundario} disabled={!!busy} onClick={() => pintar(auditado)}>
                Colorear
              </button>
              <button type="button" style={linkBtn} onClick={() => quitarColores()}>
                Quitar colores
              </button>
            </>
          )}
        </div>
        {busy && <p style={ayuda}>{busy}</p>}
      </div>

      {auditado && (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12 }} aria-label="Colores en el visor">
            <ChipEstado estado="cumple" />
            <ChipEstado estado="parcial" />
            <ChipEstado estado="no_cumple" />
            <ChipEstado estado="sin_clasificar" />
          </div>
          <div style={tarjeta}>
            <VistaResumenAuditoria resumen={auditado.informe} compacto />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              <button
                type="button"
                style={botonSecundario}
                onClick={() => {
                  const m = new Map<string, number[]>();
                  for (const o of auditado.detalle.values()) if (o.estado === "no_cumple") m.set(o.viewerModelId, [...(m.get(o.viewerModelId) ?? []), o.runtimeId]);
                  viewer.setSelection(selectorDe(m), "set").catch(() => {});
                }}
              >
                Seleccionar los que no cumplen
              </button>
              <button type="button" style={botonSecundario} disabled={!!busy} onClick={() => exportar("excel")}>
                Excel
              </button>
              <button type="button" style={botonSecundario} disabled={!!busy} onClick={() => exportar("pdf")}>
                PDF
              </button>
            </div>
            {puede && (
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <input value={notaAuditoria} onChange={(e) => setNotaAuditoria(e.target.value)} maxLength={500} placeholder="Nota (opcional): p. ej. entrega del 21-10" style={{ ...campo, flex: "1 1 160px", width: "auto" }} aria-label="Nota de la auditoría" />
                <button type="button" style={{ ...acceptButton, padding: "7px 14px", fontSize: 14 }} disabled={!!busy} onClick={guardar} title="Guarda el resultado con la fecha, tu nombre, la versión de cada modelo y la configuración usada">
                  Guardar auditoría
                </button>
              </div>
            )}
          </div>
          <DetalleSeleccion
            viewer={viewer}
            seleccion={seleccion}
            auditado={auditado}
            puede={puede}
            busy={!!busy}
            elementosPorId={elementosPorId}
            disciplinaPorId={disciplinaPorId}
            imagenes={elems.imagenes}
            onAceptar={aceptar}
          />
        </>
      )}
    </>
  );
}

/** What the selected object lacks, with its element's reference image; failures can be accepted. */
function DetalleSeleccion({
  viewer,
  seleccion,
  auditado,
  puede,
  busy,
  elementosPorId,
  disciplinaPorId,
  imagenes,
  onAceptar,
}: {
  viewer: VisorLoin;
  seleccion: ViewerSelection;
  auditado: Auditado;
  puede: boolean;
  busy: boolean;
  elementosPorId: Map<string, ElementosResponse["elementos"][number]>;
  disciplinaPorId: Map<string, Disciplina>;
  imagenes: ElementosResponse["imagenes"];
  onAceptar: (filas: { objeto: ObjetoAuditado; parametroId: string }[], justificacion: string) => Promise<void>;
}) {
  const [seleccionados, setSeleccionados] = useState<SelectedElement[]>([]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [justificacion, setJustificacion] = useState("");
  const [todos, setTodos] = useState(true);

  useEffect(() => {
    let vigente = true;
    if (seleccion.reduce((s, g) => s + (g.objectRuntimeIds ?? []).length, 0) === 0) {
      setSeleccionados([]);
      return;
    }
    readSelection(viewer as unknown as PropiedadesViewer, seleccion)
      .then((r) => vigente && setSeleccionados(r.elements))
      .catch(() => vigente && setSeleccionados([]));
    return () => {
      vigente = false;
    };
  }, [viewer, seleccion]);

  const auditados = seleccionados.flatMap((s) => {
    const o = auditado.detalle.get(claveObjeto(s.fileId, s.runtimeId));
    return o ? [o] : [];
  });
  const o = auditados[0];
  useEffect(() => setMarcados(new Set()), [o?.fileId, o?.runtimeId]);

  if (seleccionados.length === 0) return <p style={ayuda}>Selecciona un objeto en el visor para ver qué le falta.</p>;
  if (!o) return <p style={ayuda}>Lo seleccionado no está auditado en esta etapa (sin clasificar, sin exigencia o de otro modelo).</p>;
  const el = elementosPorId.get(o.elementoId);
  const d = el ? disciplinaPorId.get(el.disciplinaId) : undefined;
  const img = imagenes.find((i) => i.elementoId === o.elementoId && i.url);
  const fallan = o.revisiones.filter((r) => r.estado !== "ok" && r.estado !== "aceptado");
  const objetivos = todos ? auditados : [o];
  const filas = objetivos.flatMap((x) =>
    x.ifcGuid ? x.revisiones.filter((r) => marcados.has(r.parametroId) && r.estado !== "ok" && r.estado !== "aceptado").map((r) => ({ objeto: x, parametroId: r.parametroId })) : []
  );

  return (
    <div style={tarjeta}>
      <div style={{ display: "flex", gap: 8 }}>
        {img && <img src={img.url} alt={`Referencia de ${el?.nombre}`} style={{ width: 84, height: 64, objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />}
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: "block", wordBreak: "break-word" }}>{o.nombre}</strong>
          <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>
            {d?.codigo} · {el?.nombre} · {o.cumplidos} de {o.exigidos} obligatorios
          </span>
          <div style={{ marginTop: 4 }}>
            <ChipEstado estado={o.estado} /> <span style={{ fontSize: 13, fontWeight: 600 }}>{o.pct.toLocaleString("es")} %</span>
          </div>
        </div>
      </div>
      {auditados.length > 1 && <p style={ayuda}>{n(auditados.length)} objetos auditados seleccionados; abajo, el detalle del primero.</p>}
      {!o.ifcGuid && <p style={{ ...ayuda, color: "#7a4d00" }}>Este objeto no tiene IFCGUID: no se le pueden aceptar excepciones ni queda en la auditoría guardada con su identificador.</p>}
      <div style={{ marginTop: 6 }}>
        {o.revisiones.map((r) => {
          const falla = r.estado !== "ok" && r.estado !== "aceptado";
          const icono = r.estado === "ok" ? "✓" : r.estado === "aceptado" ? "◎" : "✗";
          const color = r.estado === "ok" ? ESTADOS.cumple.color : r.estado === "aceptado" ? "#4a3aa7" : r.obligatorio ? ESTADOS.no_cumple.color : "#7a4d00";
          return (
            <div key={r.parametroId} style={{ display: "flex", gap: 6, alignItems: "flex-start", padding: "3px 0", borderBottom: `1px solid ${C.grid}`, fontSize: 12.5 }}>
              {puede && falla && o.ifcGuid ? (
                <input
                  type="checkbox"
                  checked={marcados.has(r.parametroId)}
                  onChange={(e) => {
                    const s = new Set(marcados);
                    if (e.target.checked) s.add(r.parametroId);
                    else s.delete(r.parametroId);
                    setMarcados(s);
                  }}
                  aria-label={`Aceptar ${r.nombre}`}
                  style={{ marginTop: 2 }}
                />
              ) : (
                <span style={{ width: 13 }} />
              )}
              <span style={{ color, fontWeight: 700, width: 12 }} aria-hidden>
                {icono}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>
                  {r.codigo} · {r.nombre}
                </span>
                {!r.obligatorio && <span style={{ color: "var(--tc-gray-500)" }}> (opcional)</span>}
                <span style={{ display: "block", color: "var(--tc-gray-500)", wordBreak: "break-word" }}>
                  {r.estado === "ok" ? `${r.valor} · ${r.ruta}` : r.estado === "aceptado" ? `Aceptado por excepción${r.valor ? ` · ${r.valor}` : ""}` : `${MOTIVOS_FALLA[r.estado]}${r.detalle ? `: ${r.detalle}` : ""}`}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      {puede && fallan.length > 0 && o.ifcGuid && (
        <div style={{ marginTop: 8 }}>
          <textarea value={justificacion} onChange={(e) => setJustificacion(e.target.value)} maxLength={1000} placeholder="Justificación (obligatoria): por qué se acepta este incumplimiento" style={{ ...area, minHeight: 54 }} aria-label="Justificación de la excepción" />
          {auditados.length > 1 && (
            <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} /> A todos los objetos seleccionados con esa falla
            </label>
          )}
          <button
            type="button"
            style={{ ...acceptButton, padding: "6px 12px", fontSize: 13.5, marginTop: 4 }}
            disabled={busy || filas.length === 0 || justificacion.trim().length < 5}
            onClick={() => onAceptar(filas, justificacion.trim()).then(() => setJustificacion(""))}
          >
            Aceptar {n(filas.length)} incumplimiento(s)
          </button>
        </div>
      )}
    </div>
  );
}

const tarjeta: CSSProperties = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 5, padding: 8 };

function chipBoton(activa: boolean, color: string): CSSProperties {
  return {
    border: `1px solid ${activa ? color : C.border}`,
    background: activa ? color : "#fff",
    color: activa ? "#fff" : "var(--tc-gray-700)",
    borderRadius: 10,
    padding: "2px 9px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
