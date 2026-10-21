"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelSpec } from "trimble-connect-workspace-api";
import { textoAlias } from "../../lib/loin/alias";
import {
  camposDeModelos,
  clasificar,
  claveObjeto,
  ModeloLeido,
  probarRegla,
  ResultadoClasificacion,
  resumenSinClasificar,
  textoRegla,
  valoresFrecuentes,
} from "../../lib/loin/clasificacion";
import type { LoinApi } from "../../lib/loin/client";
import { leerModelo, selectorDe, VisorLoin } from "../../lib/loin/lecturaVisor";
import type { Disciplina, Elemento, ElementosResponse, EstadoResponse, ReglaAsociacion, VisorResponse } from "../../lib/loin/types";
import { OTHER_COLOR } from "../../lib/graficos/colors";
import { readSelection, SelectedElement } from "../../lib/propiedades/selection";
import type { PropiedadesViewer } from "../../lib/propiedades/selection";
import type { ViewerEventListener } from "../trimble/ExtensionShell";
import { acceptButton, C, message, Notice } from "../presupuesto/ui";
import { ayuda, botonSecundario, etiqueta, linkBtn, select } from "./estilos";
import ReglaEditor from "./ReglaEditor";

type ViewerSelection = { modelId: string; objectRuntimeIds?: number[] }[];
type Pestana = "modelos" | "reglas" | "clasificacion";

function selectionFrom(data: unknown): ViewerSelection {
  if (Array.isArray(data)) return data as ViewerSelection;
  const inner = (data as { data?: unknown } | null)?.data;
  return Array.isArray(inner) ? (inner as ViewerSelection) : [];
}

const n = (x: number) => x.toLocaleString("es");

/**
 * "Requisitos BIM (LOIN)" in the 3D viewer: which models belong to which
 * discipline, the rules that say which objects are each element to model
 * ("Probar regla" highlights them), manual links by IFCGUID (which win over
 * the rules) and the objects that match nothing. It only reads the models.
 */
export default function PanelVisor({ api, viewer, subscribe }: { api: LoinApi; viewer: VisorLoin; subscribe: (l: ViewerEventListener) => () => void }) {
  const [estado, setEstado] = useState<EstadoResponse | null>(null);
  const [elems, setElems] = useState<ElementosResponse | null>(null);
  const [visor, setVisor] = useState<VisorResponse | null>(null);
  const [error, setError] = useState("");
  const [cargados, setCargados] = useState<ModelSpec[]>([]);
  const [leidos, setLeidos] = useState<Map<string, ModeloLeido>>(new Map());
  const leidosRef = useRef(leidos);
  const [lectura, setLectura] = useState<{ texto: string; hechos: number; total: number } | null>(null);
  const cancelar = useRef(false);
  const [pestana, setPestana] = useState<Pestana>("modelos");
  const [nota, setNota] = useState<{ kind: "info" | "warning" | "error"; text: string } | null>(null);
  const [resultado, setResultado] = useState<ResultadoClasificacion | null>(null);
  const [seleccion, setSeleccion] = useState<ViewerSelection>([]);
  const coloreados = useRef(new Map<string, number[]>());
  const puede = !!estado?.canEdit;

  const refrescarModelos = useCallback(async () => {
    const m = ((await viewer.getModels("loaded").catch(() => [])) ?? []) as ModelSpec[];
    setCargados(m);
  }, [viewer]);

  const cargar = useCallback(async () => {
    setError("");
    try {
      const [e, el, v] = await Promise.all([api.getEstado(), api.getElementos(), api.getVisor()]);
      setEstado(e);
      setElems(el);
      setVisor(v);
    } catch (err) {
      setError(message(err));
    }
    await refrescarModelos();
  }, [api, refrescarModelos]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    viewer.getSelection().then((s) => setSeleccion(selectionFrom(s)), () => setSeleccion([]));
    return subscribe((event, data) => {
      if (event === "viewer.onSelectionChanged") setSeleccion(selectionFrom(data));
      else if (/model/i.test(event)) refrescarModelos();
    });
  }, [viewer, subscribe, refrescarModelos]);

  const disciplinasDeModelo = useMemo(() => new Map((visor?.modelos ?? []).map((m) => [m.fileId, m.disciplinaIds])), [visor]);
  const manuales = useMemo(() => new Map((visor?.asociaciones ?? []).map((a) => [a.ifcGuid, a.elementoId])), [visor]);
  const disciplinas = useMemo(() => (elems?.disciplinas ?? []).filter((d) => d.activo).sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo)), [elems]);
  const elementos = useMemo(() => (elems?.elementos ?? []).filter((e) => e.activo), [elems]);

  /** Reads (once) the loaded models among these files; null if cancelled. */
  async function asegurarLeidos(fileIds: string[]): Promise<ModeloLeido[] | null> {
    const mapa = new Map(leidosRef.current);
    cancelar.current = false;
    for (const id of fileIds) {
      if (mapa.has(id)) continue;
      const spec = cargados.find((m) => m.id === id);
      if (!spec) continue;
      const nombre = spec.name ?? spec.id;
      setLectura({ texto: `Leyendo ${nombre}…`, hechos: 0, total: 0 });
      try {
        const m = await leerModelo(viewer, spec, (hechos, total) => setLectura({ texto: `Leyendo ${nombre}`, hechos, total }), () => cancelar.current);
        if (!m) {
          setLectura(null);
          setNota({ kind: "info", text: "Lectura cancelada." });
          return null;
        }
        mapa.set(id, m);
        leidosRef.current = mapa;
        setLeidos(new Map(mapa));
      } catch (err) {
        setLectura(null);
        setNota({ kind: "error", text: `No se pudo leer ${nombre}: ${message(err)}` });
        return null;
      }
    }
    setLectura(null);
    return fileIds.flatMap((id) => (mapa.has(id) ? [mapa.get(id)!] : []));
  }

  function olvidarLecturas() {
    leidosRef.current = new Map();
    setLeidos(new Map());
    setResultado(null);
    setNota({ kind: "info", text: "Se leerán de nuevo los modelos cuando haga falta (por ejemplo, después de cargar una versión nueva)." });
  }

  async function quitarColores() {
    for (const [modelId, ids] of coloreados.current) {
      await viewer.setObjectState(selectorDe(new Map([[modelId, ids]])), { color: "reset" }).catch(() => {});
    }
    coloreados.current = new Map();
  }

  async function colorear(grupos: { color: string; porModelo: Map<string, number[]> }[], seleccionar: Map<string, number[]> | null) {
    await quitarColores();
    for (const g of grupos) {
      if (g.porModelo.size === 0) continue;
      await viewer.setObjectState(selectorDe(g.porModelo), { color: g.color });
      for (const [modelId, ids] of g.porModelo) coloreados.current.set(modelId, [...(coloreados.current.get(modelId) ?? []), ...ids]);
    }
    if (seleccionar) await viewer.setSelection(selectorDe(seleccionar), "set");
  }

  async function clasificarAhora(): Promise<ResultadoClasificacion | null> {
    if (!elems || !visor) return null;
    const conDisciplina = cargados.filter((m) => (disciplinasDeModelo.get(m.id) ?? []).length > 0).map((m) => m.id);
    if (conDisciplina.length === 0) {
      setNota({ kind: "warning", text: "Ningún modelo cargado tiene disciplina. Asígnala en la pestaña Modelos." });
      return null;
    }
    const modelos = await asegurarLeidos(conDisciplina);
    if (!modelos) return null;
    const sinDisciplina = cargados.filter((m) => !conDisciplina.includes(m.id)).map((m) => m.name ?? m.id);
    const r = clasificar(modelos, disciplinasDeModelo, elems.disciplinas, elems.elementos, manuales);
    r.modelosSinDisciplina.push(...sinDisciplina);
    setResultado(r);
    return r;
  }

  if (error) {
    return (
      <div style={{ padding: 12 }}>
        <Notice kind="error">
          {error}{" "}
          <button type="button" style={linkBtn} onClick={cargar}>
            Reintentar
          </button>
        </Notice>
      </div>
    );
  }
  if (!estado || !elems || !visor) return <p style={{ padding: 12, color: "var(--tc-gray-500)" }}>Cargando Requisitos BIM…</p>;

  return (
    <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8, fontSize: 13.5, background: "#f7f8fa", minHeight: "100vh", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <strong style={{ color: C.header, fontSize: 15 }}>Requisitos BIM (LOIN)</strong>
        <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>{puede ? "Editor" : "Consulta"}</span>
      </div>
      <nav style={{ display: "flex", gap: 2, borderBottom: `1px solid ${C.border}` }} aria-label="Secciones del panel">
        {(
          [
            ["modelos", "Modelos"],
            ["reglas", "Reglas"],
            ["clasificacion", "Clasificación"],
          ] as [Pestana, string][]
        ).map(([id, nombre]) => (
          <button key={id} type="button" onClick={() => setPestana(id)} style={tab(id === pestana)} aria-current={id === pestana ? "page" : undefined}>
            {nombre}
          </button>
        ))}
      </nav>

      {lectura && (
        <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 4, padding: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5 }}>
            <span>
              {lectura.texto}
              {lectura.total > 0 && `: ${n(lectura.hechos)} de ${n(lectura.total)} objetos`}
            </span>
            <button type="button" style={linkBtn} onClick={() => (cancelar.current = true)}>
              Cancelar
            </button>
          </div>
          <div style={{ height: 6, background: "#e8ecf1", borderRadius: 3, marginTop: 6, overflow: "hidden" }}>
            <div style={{ width: `${lectura.total ? Math.round((lectura.hechos / lectura.total) * 100) : 5}%`, height: "100%", background: C.header }} />
          </div>
        </div>
      )}
      {nota && (
        <Notice kind={nota.kind}>
          {nota.text}{" "}
          <button type="button" style={linkBtn} onClick={() => setNota(null)}>
            Cerrar
          </button>
        </Notice>
      )}

      {pestana === "modelos" && (
        <Modelos
          api={api}
          puede={puede}
          cargados={cargados}
          visor={visor}
          disciplinas={disciplinas}
          leidos={leidos}
          ocupado={!!lectura}
          onVisor={setVisor}
          onLeer={async (ids) => {
            const m = await asegurarLeidos(ids);
            if (m) setNota({ kind: "info", text: `Leídos ${m.length} modelo(s): ${n(m.reduce((s, x) => s + x.objetos.length, 0))} objetos.` });
          }}
          onGuardarCampos={async () => {
            const modelos = await asegurarLeidos(cargados.map((m) => m.id));
            if (!modelos) return;
            const campos = camposDeModelos(modelos);
            await api.guardarCamposModelo({ modelos: modelos.map((m) => m.nombre), campos });
            setNota({ kind: "info", text: `Guardados ${n(campos.length)} nombres de propiedades: en el menú del proyecto ya se pueden elegir como equivalencias de lectura.` });
          }}
          onOlvidar={olvidarLecturas}
          onRefrescar={refrescarModelos}
          setNota={setNota}
        />
      )}
      {pestana === "reglas" && (
        <Reglas
          api={api}
          puede={puede}
          disciplinas={disciplinas}
          elementos={elementos}
          cargados={cargados}
          disciplinasDeModelo={disciplinasDeModelo}
          leidos={leidos}
          ocupado={!!lectura}
          asegurarLeidos={asegurarLeidos}
          colorear={colorear}
          quitarColores={quitarColores}
          onElemento={(e) => setElems((x) => (x ? { ...x, elementos: x.elementos.map((y) => (y.id === e.id ? e : y)) } : x))}
          setNota={setNota}
        />
      )}
      {pestana === "clasificacion" && (
        <Clasificacion
          api={api}
          viewer={viewer}
          puede={puede}
          disciplinas={disciplinas}
          elementos={elementos}
          resultado={resultado}
          leidos={leidos}
          seleccion={seleccion}
          manuales={manuales}
          ocupado={!!lectura}
          onClasificar={clasificarAhora}
          onAsociaciones={(cambio) => {
            const nuevo: VisorResponse = { ...visor, asociaciones: cambio(visor.asociaciones) };
            setVisor(nuevo);
            if (elems && resultado) {
              const mapa = new Map(nuevo.asociaciones.map((a) => [a.ifcGuid, a.elementoId]));
              setResultado(clasificar([...leidosRef.current.values()].filter((m) => (disciplinasDeModelo.get(m.fileId) ?? []).length > 0), disciplinasDeModelo, elems.disciplinas, elems.elementos, mapa));
            }
          }}
          colorear={colorear}
          quitarColores={quitarColores}
          setNota={setNota}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- models

function Modelos({
  api,
  puede,
  cargados,
  visor,
  disciplinas,
  leidos,
  ocupado,
  onVisor,
  onLeer,
  onGuardarCampos,
  onOlvidar,
  onRefrescar,
  setNota,
}: {
  api: LoinApi;
  puede: boolean;
  cargados: ModelSpec[];
  visor: VisorResponse;
  disciplinas: Disciplina[];
  leidos: Map<string, ModeloLeido>;
  ocupado: boolean;
  onVisor: (v: VisorResponse) => void;
  onLeer: (ids: string[]) => Promise<void>;
  onGuardarCampos: () => Promise<void>;
  onOlvidar: () => void;
  onRefrescar: () => Promise<void>;
  setNota: (n: { kind: "info" | "warning" | "error"; text: string }) => void;
}) {
  const [guardando, setGuardando] = useState("");
  const asignado = (fileId: string) => visor.modelos.find((m) => m.fileId === fileId)?.disciplinaIds ?? [];
  const noCargados = visor.modelos.filter((m) => m.disciplinaIds.length > 0 && !cargados.some((c) => c.id === m.fileId));

  async function alternar(spec: ModelSpec, disciplinaId: string) {
    const actuales = asignado(spec.id);
    const disciplinaIds = actuales.includes(disciplinaId) ? actuales.filter((d) => d !== disciplinaId) : [...actuales, disciplinaId];
    setGuardando(spec.id);
    try {
      const modelo = await api.guardarModelo({ fileId: spec.id, nombre: spec.name ?? spec.id, disciplinaIds });
      onVisor({ ...visor, modelos: [...visor.modelos.filter((m) => m.fileId !== spec.id), modelo] });
    } catch (err) {
      setNota({ kind: "error", text: message(err) });
    } finally {
      setGuardando("");
    }
  }

  return (
    <>
      <p style={{ ...ayuda, margin: 0 }}>
        Marca a qué disciplina pertenece cada modelo cargado: sus objetos se comparan con las reglas de los elementos de esa disciplina. Se guarda por archivo, así que sirve también para
        las versiones nuevas. Un modelo puede tener varias disciplinas.
      </p>
      {cargados.length === 0 && (
        <Notice kind="info">
          No hay modelos cargados en el visor.{" "}
          <button type="button" style={linkBtn} onClick={onRefrescar}>
            Volver a mirar
          </button>
        </Notice>
      )}
      {cargados.map((spec) => {
        const ids = asignado(spec.id);
        const leido = leidos.get(spec.id);
        return (
          <div key={spec.id} style={tarjeta}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
              <strong style={{ wordBreak: "break-word" }}>{spec.name ?? spec.id}</strong>
              <span style={{ fontSize: 12, color: "var(--tc-gray-500)", whiteSpace: "nowrap" }}>{leido ? `${n(leido.objetos.length)} objetos` : "sin leer"}</span>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
              {disciplinas.map((d) => {
                const activa = ids.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={!puede || guardando === spec.id}
                    onClick={() => alternar(spec, d.id)}
                    title={d.nombre}
                    aria-pressed={activa}
                    style={{ ...chip, background: activa ? d.color : "#fff", color: activa ? "#fff" : "var(--tc-gray-700)", borderColor: activa ? d.color : C.border }}
                  >
                    {d.codigo}
                  </button>
                );
              })}
            </div>
            {ids.length === 0 && <p style={{ ...ayuda, color: "#7a4d00" }}>Sin disciplina: sus objetos no se clasifican.</p>}
          </div>
        );
      })}
      {noCargados.length > 0 && <p style={ayuda}>Modelos con disciplina que no están cargados ahora: {noCargados.map((m) => m.nombre || m.fileId).join(", ")}.</p>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" style={botonSecundario} disabled={ocupado || cargados.length === 0} onClick={() => onLeer(cargados.map((m) => m.id))} title="Lee todos los objetos de los modelos cargados (solo lectura)">
          Leer los modelos
        </button>
        {puede && (
          <button
            type="button"
            style={botonSecundario}
            disabled={ocupado || cargados.length === 0}
            onClick={() => onGuardarCampos().catch((err) => setNota({ kind: "error", text: message(err) }))}
            title="Guarda los nombres de grupos y propiedades de los modelos para elegir las equivalencias de lectura desde el menú del proyecto"
          >
            Guardar nombres de propiedades
          </button>
        )}
        {leidos.size > 0 && (
          <button type="button" style={linkBtn} onClick={onOlvidar} disabled={ocupado}>
            Volver a leer
          </button>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- rules

function Reglas({
  api,
  puede,
  disciplinas,
  elementos,
  cargados,
  disciplinasDeModelo,
  leidos,
  ocupado,
  asegurarLeidos,
  colorear,
  quitarColores,
  onElemento,
  setNota,
}: {
  api: LoinApi;
  puede: boolean;
  disciplinas: Disciplina[];
  elementos: Elemento[];
  cargados: ModelSpec[];
  disciplinasDeModelo: Map<string, string[]>;
  leidos: Map<string, ModeloLeido>;
  ocupado: boolean;
  asegurarLeidos: (ids: string[]) => Promise<ModeloLeido[] | null>;
  colorear: (g: { color: string; porModelo: Map<string, number[]> }[], seleccionar: Map<string, number[]> | null) => Promise<void>;
  quitarColores: () => Promise<void>;
  onElemento: (e: Elemento) => void;
  setNota: (n: { kind: "info" | "warning" | "error"; text: string }) => void;
}) {
  const [disciplinaId, setDisciplinaId] = useState(disciplinas[0]?.id ?? "");
  const propios = elementos.filter((e) => e.disciplinaId === disciplinaId).sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo));
  const [elementoId, setElementoId] = useState("");
  const elemento = propios.find((e) => e.id === elementoId) ?? propios[0] ?? null;
  const [regla, setRegla] = useState<ReglaAsociacion | null>(elemento?.regla ?? null);
  const [cambios, setCambios] = useState(false);
  const [prueba, setPrueba] = useState<{ total: number; porModelo: { nombre: string; cantidad: number; ejemplos: string[] }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const disciplina = disciplinas.find((d) => d.id === disciplinaId) ?? null;
  const modelosDeDisciplina = useMemo(() => cargados.filter((m) => (disciplinasDeModelo.get(m.id) ?? []).includes(disciplinaId)), [cargados, disciplinasDeModelo, disciplinaId]);
  const leidosDisciplina = useMemo(() => modelosDeDisciplina.flatMap((m) => (leidos.has(m.id) ? [leidos.get(m.id)!] : [])), [modelosDeDisciplina, leidos]);
  // Reading every object is slow on big models: the names and values are worked out once per models read.
  const campos = useMemo(() => camposDeModelos(leidosDisciplina.length ? leidosDisciplina : [...leidos.values()], 600).map((c) => textoAlias({ grupo: c.grupo, propiedad: c.propiedad })), [leidos, leidosDisciplina]);
  const cacheValores = useMemo(() => new Map<string, string[]>(), [leidosDisciplina]);
  const valores = (campo: string) => {
    if (!cacheValores.has(campo)) cacheValores.set(campo, valoresFrecuentes(leidosDisciplina, campo).map((v) => v.valor));
    return cacheValores.get(campo)!;
  };

  useEffect(() => {
    setRegla(elemento?.regla ?? null);
    setCambios(false);
    setPrueba(null);
    // Only when another element is chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elemento?.id]);

  async function probar() {
    if (!elemento) return;
    if (modelosDeDisciplina.length === 0) {
      setNota({ kind: "warning", text: `Ningún modelo cargado es de ${disciplina?.nombre ?? "esta disciplina"}. Asígnalo en la pestaña Modelos.` });
      return;
    }
    setBusy(true);
    try {
      const modelos = await asegurarLeidos(modelosDeDisciplina.map((m) => m.id));
      if (!modelos) return;
      const encontrados = probarRegla(modelos, regla);
      const porModelo = new Map(encontrados.map((x) => [x.viewerModelId, x.objetos.map((o) => o.runtimeId)]));
      const total = encontrados.reduce((s, x) => s + x.objetos.length, 0);
      setPrueba({
        total,
        porModelo: encontrados.map((x) => ({
          nombre: modelos.find((m) => m.fileId === x.fileId)?.nombre ?? x.fileId,
          cantidad: x.objetos.length,
          ejemplos: [...new Set(x.objetos.map((o) => o.tipo || o.nombre || o.clase))].slice(0, 6),
        })),
      });
      if (total > 0) await colorear([{ color: disciplina?.color ?? "#2a78d6", porModelo }], porModelo);
      else await quitarColores();
    } catch (err) {
      setNota({ kind: "error", text: message(err) });
    } finally {
      setBusy(false);
    }
  }

  async function guardar() {
    if (!elemento) return;
    setBusy(true);
    try {
      const guardado = await api.guardarElemento({ ...elemento, regla });
      onElemento(guardado);
      setCambios(false);
      setNota({ kind: "info", text: `Regla de ${guardado.nombre} guardada: ${textoRegla(guardado.regla)}.` });
    } catch (err) {
      setNota({ kind: "error", text: message(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <select
          value={disciplinaId}
          onChange={(e) => {
            setDisciplinaId(e.target.value);
            setElementoId("");
          }}
          style={{ ...select, flex: "1 1 120px" }}
          aria-label="Disciplina"
        >
          {disciplinas.map((d) => (
            <option key={d.id} value={d.id}>
              {d.codigo} · {d.nombre}
            </option>
          ))}
        </select>
        <select value={elemento?.id ?? ""} onChange={(e) => setElementoId(e.target.value)} style={{ ...select, flex: "2 1 160px" }} aria-label="Elemento">
          {propios.map((e) => (
            <option key={e.id} value={e.id}>
              {e.codigo} · {e.nombre}
              {e.regla ? "" : " (sin regla)"}
            </option>
          ))}
        </select>
      </div>
      {!elemento && <p style={ayuda}>Esta disciplina no tiene elementos activos.</p>}
      {elemento && (
        <div style={tarjeta}>
          <ReglaEditor
            regla={regla}
            onChange={(r) => {
              setRegla(r);
              setCambios(true);
              setPrueba(null);
            }}
            ro={!puede}
            claseIfc={elemento.claseIfc}
            campos={campos}
            valores={valores}
          />
          <p style={{ ...ayuda, marginTop: 8 }}>{textoRegla(regla)}</p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            <button type="button" style={botonSecundario} onClick={probar} disabled={busy || ocupado} title="Cuenta los objetos de los modelos de la disciplina que toma esta regla, los resalta y los selecciona en el visor">
              Probar regla
            </button>
            {puede && (
              <button type="button" style={{ ...acceptButton, padding: "7px 14px", fontSize: 14 }} onClick={guardar} disabled={busy || !cambios}>
                Guardar regla
              </button>
            )}
            <button type="button" style={linkBtn} onClick={() => quitarColores().then(() => setPrueba(null))}>
              Quitar resaltado
            </button>
          </div>
          {prueba && (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              <strong>{prueba.total === 0 ? "La regla no toma ningún objeto." : `Toma ${n(prueba.total)} objeto(s)`}</strong>
              {prueba.porModelo.map((m) => (
                <div key={m.nombre} style={{ marginTop: 3 }}>
                  {m.nombre}: {n(m.cantidad)}
                  {m.ejemplos.length > 0 && <span style={{ color: "var(--tc-gray-500)" }}> · {m.ejemplos.join(", ")}</span>}
                </div>
              ))}
              {prueba.total > 0 && <p style={ayuda}>Quedaron seleccionados y pintados con el color de la disciplina.</p>}
            </div>
          )}
        </div>
      )}
      {elemento && modelosDeDisciplina.length === 0 && <p style={{ ...ayuda, color: "#7a4d00" }}>Ningún modelo cargado es de esta disciplina: asígnalo en la pestaña Modelos para probar la regla.</p>}
    </>
  );
}

// ---------------------------------------------------------------- classification and manual links

function Clasificacion({
  api,
  viewer,
  puede,
  disciplinas,
  elementos,
  resultado,
  leidos,
  seleccion,
  manuales,
  ocupado,
  onClasificar,
  onAsociaciones,
  colorear,
  quitarColores,
  setNota,
}: {
  api: LoinApi;
  viewer: VisorLoin;
  puede: boolean;
  disciplinas: Disciplina[];
  elementos: Elemento[];
  resultado: ResultadoClasificacion | null;
  leidos: Map<string, ModeloLeido>;
  seleccion: ViewerSelection;
  manuales: Map<string, string>;
  ocupado: boolean;
  onClasificar: () => Promise<ResultadoClasificacion | null>;
  onAsociaciones: (cambio: (a: VisorResponse["asociaciones"]) => VisorResponse["asociaciones"]) => void;
  colorear: (g: { color: string; porModelo: Map<string, number[]> }[], seleccionar: Map<string, number[]> | null) => Promise<void>;
  quitarColores: () => Promise<void>;
  setNota: (n: { kind: "info" | "warning" | "error"; text: string }) => void;
}) {
  const [busy, setBusy] = useState("");
  const [seleccionados, setSeleccionados] = useState<SelectedElement[]>([]);
  const [leyendoSel, setLeyendoSel] = useState(false);
  const [destino, setDestino] = useState("");
  const porId = useMemo(() => new Map(elementos.map((e) => [e.id, e])), [elementos]);
  const colorDe = useMemo(() => new Map(disciplinas.map((d) => [d.id, d.color])), [disciplinas]);
  const viewerIdDe = useMemo(() => new Map([...leidos.values()].map((m) => [m.fileId, m.viewerModelId])), [leidos]);

  // The selected objects with their IFCGUID (to link them by hand).
  useEffect(() => {
    let vigente = true;
    const total = seleccion.reduce((s, g) => s + (g.objectRuntimeIds ?? []).length, 0);
    if (total === 0) {
      setSeleccionados([]);
      return;
    }
    setLeyendoSel(true);
    readSelection(viewer as unknown as PropiedadesViewer, seleccion)
      .then((r) => vigente && setSeleccionados(r.elements))
      .catch(() => vigente && setSeleccionados([]))
      .finally(() => vigente && setLeyendoSel(false));
    return () => {
      vigente = false;
    };
  }, [viewer, seleccion]);

  async function correr(texto: string, f: () => Promise<void>) {
    setBusy(texto);
    try {
      await f();
    } catch (err) {
      setNota({ kind: "error", text: message(err) });
    } finally {
      setBusy("");
    }
  }

  const porModelo = (lista: { fileId: string; runtimeId: number }[]) => {
    const m = new Map<string, number[]>();
    for (const x of lista) {
      const v = viewerIdDe.get(x.fileId) ?? x.fileId;
      m.set(v, [...(m.get(v) ?? []), x.runtimeId]);
    }
    return m;
  };

  async function colorearPorDisciplina(r: ResultadoClasificacion) {
    const grupos = new Map<string, { fileId: string; runtimeId: number }[]>();
    for (const [clave, c] of r.porObjeto) {
      const [fileId, rt] = [clave.slice(0, clave.lastIndexOf(":")), Number(clave.slice(clave.lastIndexOf(":") + 1))];
      const color = colorDe.get(porId.get(c.elementoId)?.disciplinaId ?? "") ?? "#2a78d6";
      grupos.set(color, [...(grupos.get(color) ?? []), { fileId, runtimeId: rt }]);
    }
    const sin = r.sinClasificar.map((s) => ({ fileId: s.fileId, runtimeId: s.objeto.runtimeId }));
    await colorear([...[...grupos].map(([color, lista]) => ({ color, porModelo: porModelo(lista) })), { color: OTHER_COLOR, porModelo: porModelo(sin) }], null);
  }

  const conGuid = seleccionados.filter((s) => s.resolution.guid);
  const conManual = conGuid.filter((s) => manuales.has(s.resolution.guid!));

  async function asociar(elementoId: string | null) {
    const objetos = (elementoId ? conGuid : conManual).map((s) => ({ ifcGuid: s.resolution.guid!, fileId: s.fileId }));
    if (objetos.length === 0) return;
    await correr(elementoId ? "Asociando…" : "Quitando…", async () => {
      await api.asociar(elementoId, objetos);
      const guids = new Set(objetos.map((o) => o.ifcGuid));
      const ahora = new Date().toISOString();
      onAsociaciones((lista) => [
        ...lista.filter((a) => !guids.has(a.ifcGuid)),
        ...(elementoId ? objetos.map((o) => ({ ifcGuid: o.ifcGuid, fileId: o.fileId, elementoId, creado: ahora, creadoPor: null })) : []),
      ]);
      const e = elementoId ? porId.get(elementoId) : null;
      setNota({ kind: "info", text: e ? `${n(objetos.length)} objeto(s) asociado(s) a mano a ${e.nombre}.` : `Se quitó la asociación manual de ${n(objetos.length)} objeto(s): vuelven a depender de las reglas.` });
    });
  }

  const estadoDe = (s: SelectedElement): string => {
    const g = s.resolution.guid;
    if (!g) return "sin IFCGUID";
    const m = manuales.get(g);
    if (m) return `${porId.get(m)?.nombre ?? "elemento"} (a mano)`;
    const c = resultado?.porObjeto.get(claveObjeto(s.fileId, s.runtimeId));
    if (c) return `${porId.get(c.elementoId)?.nombre ?? "elemento"} (regla)`;
    return resultado ? "sin clasificar" : "—";
  };

  const sinResumen = resultado ? resumenSinClasificar(resultado.sinClasificar) : [];

  return (
    <>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" style={{ ...acceptButton, padding: "7px 14px", fontSize: 14 }} disabled={!!busy || ocupado} onClick={() => correr("Clasificando…", async () => void (await onClasificar()))}>
          {resultado ? "Clasificar de nuevo" : "Clasificar los modelos"}
        </button>
        {resultado && (
          <>
            <button type="button" style={botonSecundario} disabled={!!busy} onClick={() => correr("Coloreando…", () => colorearPorDisciplina(resultado))} title="Cada objeto con el color de su disciplina; los sin clasificar en gris">
              Colorear por disciplina
            </button>
            <button type="button" style={linkBtn} onClick={() => quitarColores()}>
              Quitar colores
            </button>
          </>
        )}
      </div>
      {busy && <p style={ayuda}>{busy}</p>}

      {resultado && (
        <div style={tarjeta}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span style={etiqueta("#2e6b22", "#e4f3df")}>{n(resultado.porObjeto.size)} clasificados</span>
            <span style={etiqueta("#6b7280", "#eceef1")}>{n(resultado.sinClasificar.length)} sin clasificar</span>
            {resultado.ambiguos > 0 && <span style={etiqueta("#7a4d00", "#fcefd6")} title="Objetos que cumplen la regla de más de un elemento: queda el primero en orden">{n(resultado.ambiguos)} con varias reglas</span>}
          </div>
          <p style={ayuda}>
            {n(resultado.ignorados)} objeto(s) del árbol del modelo (proyecto, niveles, aberturas…) no cuentan.
            {resultado.sinGuid > 0 && ` ${n(resultado.sinGuid)} objeto(s) no tienen IFCGUID: no se pueden asociar a mano ni auditar.`}
            {resultado.modelosSinDisciplina.length > 0 && ` Sin disciplina (no se clasifican): ${resultado.modelosSinDisciplina.join(", ")}.`}
          </p>
          {disciplinas.map((d) => {
            const propios = elementos.filter((e) => e.disciplinaId === d.id);
            const filas = propios.map((e) => ({ e, c: resultado.porElemento.get(e.id) ?? { regla: 0, manual: 0 } }));
            if (!filas.some((f) => f.c.regla + f.c.manual > 0)) return null;
            return (
              <details key={d.id} style={{ marginTop: 6 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                  <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: d.color, marginRight: 6 }} />
                  {d.codigo} · {d.nombre}: {n(filas.reduce((s, f) => s + f.c.regla + f.c.manual, 0))}
                </summary>
                {filas.map(({ e, c }) => (
                  <div key={e.id} style={{ display: "flex", justifyContent: "space-between", gap: 6, padding: "2px 0 2px 16px", fontSize: 12.5, color: c.regla + c.manual === 0 ? "#b3261e" : undefined }}>
                    <span>{e.nombre}</span>
                    <span>
                      {c.regla + c.manual === 0 ? "ningún objeto" : `${n(c.regla)} por regla${c.manual ? ` · ${n(c.manual)} a mano` : ""}`}
                    </span>
                  </div>
                ))}
              </details>
            );
          })}
          {sinResumen.length > 0 && (
            <details style={{ marginTop: 8 }} open>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Sin clasificar: {n(resultado.sinClasificar.length)}</summary>
              <p style={ayuda}>Agrupados por clase y tipo. Para cada grupo, ajusta una regla o asócialos a mano.</p>
              {sinResumen.slice(0, 40).map((g) => (
                <div key={`${g.clase}|${g.tipo}`} style={{ display: "flex", justifyContent: "space-between", gap: 6, padding: "2px 0", fontSize: 12.5 }}>
                  <span style={{ wordBreak: "break-word" }}>
                    {g.clase} · {g.tipo}
                  </span>
                  <span style={{ whiteSpace: "nowrap" }}>
                    {n(g.cantidad)}{" "}
                    <button
                      type="button"
                      style={linkBtn}
                      onClick={() =>
                        correr("Seleccionando…", async () => {
                          const lista = resultado.sinClasificar.filter((s) => (s.objeto.clase || "(sin clase)") === g.clase && (s.objeto.tipo || s.objeto.nombre || "(sin tipo)") === g.tipo);
                          await viewer.setSelection(selectorDe(porModelo(lista.map((s) => ({ fileId: s.fileId, runtimeId: s.objeto.runtimeId })))), "set");
                        })
                      }
                    >
                      Seleccionar
                    </button>
                  </span>
                </div>
              ))}
              {sinResumen.length > 40 && <p style={ayuda}>…y {sinResumen.length - 40} grupo(s) más.</p>}
              <button
                type="button"
                style={{ ...linkBtn, marginTop: 4 }}
                onClick={() =>
                  correr("Seleccionando…", async () => {
                    await viewer.setSelection(selectorDe(porModelo(resultado.sinClasificar.map((s) => ({ fileId: s.fileId, runtimeId: s.objeto.runtimeId })))), "set");
                  })
                }
              >
                Seleccionar todos los sin clasificar
              </button>
            </details>
          )}
        </div>
      )}

      <div style={tarjeta}>
        <strong>Asociación manual (gana sobre las reglas)</strong>
        <p style={ayuda}>
          Selecciona objetos en el visor y elige el elemento. Se guarda por IFCGUID: si el objeto sigue en la versión nueva del modelo, sigue asociado.
        </p>
        {leyendoSel && <p style={ayuda}>Leyendo la selección…</p>}
        {!leyendoSel && seleccionados.length === 0 && <p style={ayuda}>No hay objetos seleccionados.</p>}
        {seleccionados.length > 0 && (
          <>
            <p style={{ margin: "4px 0", fontSize: 13 }}>
              {n(seleccionados.length)} seleccionado(s){conGuid.length < seleccionados.length ? ` · ${n(seleccionados.length - conGuid.length)} sin IFCGUID (no se pueden asociar)` : ""}
            </p>
            {seleccionados.slice(0, 6).map((s) => (
              <div key={s.key} style={{ fontSize: 12.5, display: "flex", justifyContent: "space-between", gap: 6 }}>
                <span style={{ wordBreak: "break-word" }}>{s.name}</span>
                <span style={{ color: "var(--tc-gray-500)", whiteSpace: "nowrap" }}>{estadoDe(s)}</span>
              </div>
            ))}
            {seleccionados.length > 6 && <p style={ayuda}>…y {n(seleccionados.length - 6)} más.</p>}
            {puede && conGuid.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                <select value={destino} onChange={(e) => setDestino(e.target.value)} style={{ ...select, flex: "1 1 180px" }} aria-label="Elemento al que se asocian">
                  <option value="">Elige el elemento…</option>
                  {disciplinas.map((d) => (
                    <optgroup key={d.id} label={`${d.codigo} · ${d.nombre}`}>
                      {elementos
                        .filter((e) => e.disciplinaId === d.id)
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.codigo} · {e.nombre}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
                <button type="button" style={{ ...acceptButton, padding: "6px 12px", fontSize: 13.5 }} disabled={!destino || !!busy} onClick={() => asociar(destino)}>
                  Asociar {n(conGuid.length)}
                </button>
                {conManual.length > 0 && (
                  <button type="button" style={botonSecundario} disabled={!!busy} onClick={() => asociar(null)}>
                    Quitar asociación manual ({n(conManual.length)})
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

const tarjeta: CSSProperties = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 5, padding: 8 };
const chip: CSSProperties = { border: "1px solid", borderRadius: 10, padding: "2px 9px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };

function tab(activa: boolean): CSSProperties {
  return {
    border: "none",
    borderBottom: `3px solid ${activa ? C.header : "transparent"}`,
    background: "transparent",
    padding: "7px 10px 5px",
    fontSize: 13.5,
    fontWeight: activa ? 600 : 400,
    color: activa ? C.header : "var(--tc-gray-700)",
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
