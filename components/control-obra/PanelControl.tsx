"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelSpec } from "trimble-connect-workspace-api";
import type { ObraApi } from "../../lib/control-obra/client";
import { cantidadElemento, contratosDePartida, numeroMedicion, revisarUbicacion } from "../../lib/control-obra/mediciones";
import { ElementosMediblesResponse, EstadoResponse, MedicionesResponse, Ubicacion } from "../../lib/control-obra/types";
import { redondear } from "../../lib/presupuesto/calc";
import { coincide, fmt } from "../../lib/presupuesto/format";
import { MapaGuids, selector, Visor } from "../../lib/presupuesto/viewerMap";
import { readSelection, SelectedElement } from "../../lib/propiedades/selection";
import { isoToDisplay, parseDisplayDate, parseNumberInput } from "../../lib/propiedades/values";
import { acceptButton, baseInput, C, celdaActiva, labelStyle, message, Notice } from "../presupuesto/ui";
import DateField from "../propiedades/DateField";
import { linkBtn, select } from "../compras/estilos";
import type { ViewerEventListener } from "../trimble/ExtensionShell";
import UbicacionSelector from "./UbicacionSelector";

type ViewerSelection = { modelId: string; objectRuntimeIds?: number[] }[];

function selectionFrom(data: unknown): ViewerSelection {
  if (Array.isArray(data)) return data as ViewerSelection;
  const inner = (data as { data?: unknown } | null)?.data;
  return Array.isArray(inner) ? (inner as ViewerSelection) : [];
}

/** A selected element ready to measure: what Presupuesto says of it and the % to measure now. */
interface Fila {
  ifcGuid: string;
  modelId: string;
  versionId: string | null;
  nombre: string;
  cantidadModelo: number;
  medido: number;
  pct: string;
}

/**
 * "Control de Obra" in the 3D viewer: choose a partida, select the elements
 * built, and register the measurement (each element's quantity comes from
 * Presupuesto; per element and partida never more than 100 %). Nothing is
 * written in the model.
 */
export default function PanelControl({ api, viewer, subscribe }: { api: ObraApi; viewer: Visor; subscribe: (l: ViewerEventListener) => () => void }) {
  const [estado, setEstado] = useState<EstadoResponse | null>(null);
  const [datos, setDatos] = useState<MedicionesResponse | null>(null);
  const [error, setError] = useState("");
  const [buscar, setBuscar] = useState("");
  const [partidaId, setPartidaId] = useState("");
  const [seleccion, setSeleccion] = useState<ViewerSelection>([]);
  const [leidos, setLeidos] = useState<{ elementos: SelectedElement[]; versiones: Map<string, string | null>; sinGuid: number } | null>(null);
  const [leyendo, setLeyendo] = useState("");
  const [medibles, setMedibles] = useState<ElementosMediblesResponse | null>(null);
  const [filas, setFilas] = useState<Fila[]>([]);
  const [ubicacion, setUbicacion] = useState<Ubicacion>({});
  const [contratoId, setContratoId] = useState("");
  const [fechaTexto, setFechaTexto] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [todos, setTodos] = useState("");
  const [busy, setBusy] = useState(false);
  const [nota, setNota] = useState<{ kind: "info" | "warning" | "error"; text: string } | null>(null);
  const mapa = useRef(new MapaGuids());
  const seq = useRef(0);

  const cargar = useCallback(async () => {
    setError("");
    try {
      const e = await api.getEstado();
      setEstado(e);
      if (!e.acceso?.permisos.includes("cantidades.ver")) return;
      const d = await api.getMediciones();
      setDatos(d);
      setFechaTexto((t) => t || isoToDisplay(d.hoy));
    } catch (err) {
      setError(message(err));
    }
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Elements somebody asked to see from the project's menu: select them and fly there.
  useEffect(() => {
    let cancelado = false;
    (async () => {
      const vista = await api.tomarVista().catch(() => null);
      if (!vista || cancelado || !vista.elementos.length) return;
      if (vista.partidaId) setPartidaId(vista.partidaId);
      setNota({ kind: "info", text: `Buscando en el modelo los ${vista.elementos.length.toLocaleString("es")} elemento(s) que pediste ver...` });
      let u: Awaited<ReturnType<MapaGuids["ubicar"]>> | null = null;
      for (let intento = 0; intento < 40 && !cancelado; intento++) {
        u = await new MapaGuids().ubicar(viewer, vista.elementos, () => {}).catch(() => null);
        if (u && u.encontrados > 0 && u.sinModelo === 0) break;
        if (u && u.sinModelo === 0 && intento >= 3) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (cancelado) return;
      if (!u || !u.encontrados) {
        setNota({ kind: "warning", text: "No se encontraron esos elementos en los modelos cargados. Abre el modelo al que pertenecen." });
        return;
      }
      await viewer.setSelection(selector(u.porModelo), "set").catch(() => undefined);
      await viewer.setCamera(selector(u.porModelo)).catch(() => undefined);
      setNota({ kind: "info", text: `${u.encontrados.toLocaleString("es")} elemento(s) seleccionados.` });
    })();
    return () => {
      cancelado = true;
    };
  }, [api, viewer]);

  // ---- the viewer's selection
  useEffect(() => {
    viewer.getSelection().then((s) => setSeleccion(selectionFrom(s)), () => setSeleccion([]));
    return subscribe((event, data) => {
      if (event === "viewer.onSelectionChanged") setSeleccion(selectionFrom(data));
    });
  }, [viewer, subscribe]);

  useEffect(() => {
    const id = ++seq.current;
    const total = seleccion.reduce((s, g) => s + (g.objectRuntimeIds?.length ?? 0), 0);
    // A new selection: the message about the previous one no longer applies.
    setNota((n) => (n?.kind === "info" ? null : n));
    if (!total) {
      setLeidos(null);
      setLeyendo("");
      return;
    }
    setLeyendo(`Leyendo ${total.toLocaleString("es")} elemento(s)...`);
    (async () => {
      try {
        const r = await readSelection(viewer, seleccion, (done, all) => id === seq.current && setLeyendo(`Leyendo elementos: ${done} de ${all}...`));
        const modelos = ((await viewer.getModels("loaded").catch(() => [])) ?? []) as ModelSpec[];
        if (id !== seq.current) return;
        const versiones = new Map<string, string | null>(modelos.map((m) => [m.id, m.versionId ?? null]));
        for (const e of r.elements) if (e.resolution.guid) mapa.current.recordar(e.fileId, e.viewerModelId, e.resolution.guid, e.runtimeId);
        setLeidos({ elementos: r.elements.filter((e) => e.resolution.guid), versiones, sinGuid: r.elements.filter((e) => !e.resolution.guid).length });
        setLeyendo("");
      } catch (err) {
        if (id === seq.current) {
          setLeyendo("");
          setNota({ kind: "error", text: `No se pudo leer la selección: ${message(err)}` });
        }
      }
    })();
  }, [seleccion, viewer]);

  // ---- what the partida can measure of the selection
  const consultar = useCallback(async () => {
    if (!partidaId || !leidos?.elementos.length) {
      setMedibles(null);
      setFilas([]);
      return;
    }
    try {
      const unicos = [...new Map(leidos.elementos.map((e) => [e.resolution.guid!, e])).values()];
      const r = await api.elementosMedibles({ partidaId, ifcGuids: unicos.map((e) => e.resolution.guid!) });
      setMedibles(r);
      setFilas(
        r.elementos
          .filter((x) => x.asociado && x.medido < 100)
          .map((x) => {
            const e = unicos.find((u) => u.resolution.guid === x.ifcGuid)!;
            return {
              ifcGuid: x.ifcGuid,
              modelId: x.modelId || e.fileId,
              versionId: leidos.versiones.get(e.fileId) ?? null,
              nombre: e.name,
              cantidadModelo: x.cantidadModelo ?? 0,
              medido: x.medido,
              pct: String(redondear(100 - x.medido, 4)),
            };
          })
      );
      setUbicacion(r.ubicacionComun ?? {});
    } catch (err) {
      setNota({ kind: "error", text: message(err) });
    }
  }, [api, partidaId, leidos]);

  useEffect(() => {
    consultar();
  }, [consultar]);

  const partida = datos?.partidas.find((p) => p.id === partidaId);
  const contratos = partida && datos ? contratosDePartida(partida, datos.contratos) : [];
  const candidatas = useMemo(
    () => (datos?.partidas ?? []).filter((p) => !p.inactiva && (!buscar.trim() || coincide(`${p.numero} ${p.descripcion} ${p.capitulo}`, buscar))).slice(0, 200),
    [datos, buscar]
  );
  const leidas = filas.map((f) => ({ ...f, porcentaje: parseNumberInput(f.pct.replace(/\s/g, "")) ?? NaN }));
  const total = redondear(leidas.reduce((a, f) => a + (Number.isFinite(f.porcentaje) ? cantidadElemento(f.porcentaje, f.cantidadModelo) : 0), 0), 4);
  const iso = parseDisplayDate(fechaTexto);
  const noAsociados = medibles?.elementos.filter((x) => !x.asociado).length ?? 0;
  const completos = medibles?.elementos.filter((x) => x.asociado && x.medido >= 100).length ?? 0;
  const problema = !datos
    ? null
    : !partida
      ? "Elige la partida."
      : !filas.length
        ? "Selecciona en el modelo elementos de esta partida que falten por medir."
        : leidas.some((f) => !(f.porcentaje > 0 && f.porcentaje <= redondear(100 - f.medido, 4)))
          ? "Cada elemento lleva un % mayor que 0 y no más de lo que le falta."
          : revisarUbicacion(ubicacion, datos.niveles, datos.nodos, datos.ubicacionObligatoria) ??
            (!iso ? "Escribe la fecha (DD-MM-AAAA)." : iso > datos.hoy ? "La fecha no puede ser futura." : null);

  async function registrar() {
    if (problema || !partida || !iso) return;
    setBusy(true);
    setNota(null);
    try {
      const d = await api.guardarMedicion({
        partidaId: partida.id,
        contratoId: contratoId || null,
        ubicacion,
        fecha: iso,
        origen: "modelo",
        observaciones,
        elementos: leidas.map((f) => ({ modelId: f.modelId, versionId: f.versionId, ifcGuid: f.ifcGuid, nombre: f.nombre, porcentaje: f.porcentaje })),
        lineas: [],
        version: 0,
      });
      setDatos(d);
      const m = d.mediciones[0];
      setNota({ kind: "info", text: `${numeroMedicion(m.numero)} registrada: ${fmt(m.cantidad, 4)} ${m.partidaUnidad} de ${m.partidaNumero} ${m.partidaDescripcion} en ${m.ubicacionTexto}.` });
      setObservaciones("");
      await consultar();
    } catch (err) {
      setNota({ kind: "error", text: message(err) });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <div style={{ padding: 12 }}><Notice kind="error">{error}</Notice></div>;
  if (!estado) return <p style={{ padding: 12, color: "var(--tc-gray-500)" }}>Revisando tu acceso…</p>;
  if (!estado.acceso?.permisos.includes("cantidades.ver")) {
    return (
      <div style={{ padding: 12 }}>
        <Notice kind="warning">No tienes acceso a las mediciones de Control de Obra en este proyecto. Pídeselo a un administrador.</Notice>
      </div>
    );
  }
  if (!datos) return <p style={{ padding: 12, color: "var(--tc-gray-500)" }}>Cargando…</p>;
  const puedeMedir = datos.puede.crear;

  return (
    <div style={{ padding: 12, display: "grid", gap: 12, fontSize: 13.5 }}>
      <div>
        <strong style={{ fontSize: 15 }}>Medir desde el modelo</strong>
        <p style={{ margin: "4px 0 0", color: "var(--tc-gray-500)" }}>Elige la partida y selecciona en el modelo los elementos ejecutados. Nada se escribe en el modelo.</p>
      </div>
      {!puedeMedir && <Notice kind="info">Tu rol puede consultar las mediciones, no registrarlas.</Notice>}
      <div>
        <label style={labelStyle} htmlFor="pc-partida">
          Partida
        </label>
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar partida" aria-label="Buscar partida" style={{ ...baseInput, width: "100%", marginBottom: 4 }} />
        <select id="pc-partida" size={5} value={partidaId} onChange={(e) => setPartidaId(e.target.value)} style={{ ...select, width: "100%" }}>
          {candidatas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.numero} {p.descripcion} ({p.unidad})
            </option>
          ))}
        </select>
      </div>

      {leyendo && <p style={{ margin: 0, color: "var(--tc-gray-500)" }}>{leyendo}</p>}
      {!leyendo && !leidos && <p style={{ margin: 0, color: "var(--tc-gray-500)" }}>Selecciona elementos en el modelo.</p>}
      {leidos && leidos.sinGuid > 0 && <Notice kind="warning">{leidos.sinGuid} elemento(s) sin IFCGUID no se pueden medir desde el modelo.</Notice>}
      {partida && medibles && (noAsociados > 0 || completos > 0) && (
        <Notice kind="info">
          {noAsociados > 0 && `${noAsociados} elemento(s) no están asociados a esta partida en Presupuesto: asócialos allí o mídelos a mano. `}
          {completos > 0 && `${completos} ya están medidos al 100 % en esta partida.`}
        </Notice>
      )}

      {partida && filas.length > 0 && (
        <>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, maxHeight: 240, overflow: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12.5 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--tc-gray-500)" }}>
                  <th style={{ padding: 4 }}>Elemento</th>
                  <th style={{ padding: 4, textAlign: "right" }} title="La cantidad que tiene en Presupuesto para esta partida">
                    Modelo
                  </th>
                  <th style={{ padding: 4, textAlign: "right" }}>Ya</th>
                  <th style={{ padding: 4, textAlign: "right" }}>% ahora</th>
                </tr>
              </thead>
              <tbody>
                {leidas.map((f, i) => (
                  <tr key={f.ifcGuid} style={{ borderTop: `1px solid ${C.grid}` }}>
                    <td style={{ padding: 4 }} title={f.ifcGuid}>
                      {f.nombre}
                    </td>
                    <td style={{ padding: 4, textAlign: "right" }}>{fmt(f.cantidadModelo, 4)}</td>
                    <td style={{ padding: 4, textAlign: "right" }}>{f.medido ? `${fmt(f.medido, 2)} %` : "—"}</td>
                    <td style={{ padding: 4, textAlign: "right" }}>
                      <input
                        value={filas[i].pct}
                        inputMode="decimal"
                        disabled={!puedeMedir}
                        aria-label={`${f.nombre}: % que se mide ahora`}
                        onChange={(e) => setFilas((x) => x.map((y, j) => (j === i ? { ...y, pct: e.target.value } : y)))}
                        onFocus={(e) => (e.target.style.background = celdaActiva.background as string)}
                        onBlur={(e) => (e.target.style.background = "")}
                        style={{ ...baseInput, width: 64, textAlign: "right" }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {puedeMedir && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span>Mismo % para todos:</span>
              <input value={todos} onChange={(e) => setTodos(e.target.value)} inputMode="decimal" aria-label="Mismo porcentaje para todos" style={{ ...baseInput, width: 64, textAlign: "right" }} />
              <button
                type="button"
                style={linkBtn}
                onClick={() => {
                  const v = parseNumberInput(todos);
                  if (v !== null) setFilas((x) => x.map((f) => ({ ...f, pct: String(Math.min(v, redondear(100 - f.medido, 4))) })));
                }}
              >
                Aplicar
              </button>
            </div>
          )}
          <p style={{ margin: 0 }} title="Suma de % × cantidad del modelo de cada elemento">
            Cantidad a registrar: <strong>{fmt(total, 4)}</strong> {partida.unidad} ({filas.length} elemento(s))
          </p>
          {medibles && !medibles.ubicacionComun && medibles.ubicaciones.length > 1 && (
            <Notice kind="warning">
              Los elementos están en ubicaciones distintas ({medibles.ubicaciones.map((u) => `${u.texto}: ${u.elementos}`).join("; ")}). Una medición tiene una sola
              ubicación: separa la selección o elige la ubicación.
            </Notice>
          )}
          <div>
            <span style={labelStyle}>Ubicación</span>
            <UbicacionSelector niveles={datos.niveles} nodos={datos.nodos} obligatorios={datos.ubicacionObligatoria} value={ubicacion} onChange={setUbicacion} disabled={!puedeMedir} idBase="pc-ubic" />
          </div>
          <div>
            <label style={labelStyle} htmlFor="pc-contrato">
              Quién la ejecutó
            </label>
            <select id="pc-contrato" value={contratoId} disabled={!puedeMedir} onChange={(e) => setContratoId(e.target.value)} style={{ ...select, width: "100%" }}>
              <option value="">Obra propia (sin subcontrato)</option>
              {contratos.map((c) => (
                <option key={c.id} value={c.id}>
                  CT-{String(c.numero).padStart(4, "0")} {c.proveedor}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="pc-fecha">
              Fecha de ejecución
            </label>
            <DateField id="pc-fecha" text={fechaTexto} placeholder="DD-MM-AAAA" invalid={!iso || iso > datos.hoy} onText={setFechaTexto} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="pc-obs">
              Observaciones
            </label>
            <input id="pc-obs" value={observaciones} maxLength={2000} disabled={!puedeMedir} onChange={(e) => setObservaciones(e.target.value)} style={{ ...baseInput, width: "100%" }} />
          </div>
          {puedeMedir && problema && <Notice kind="warning">{problema}</Notice>}
          {puedeMedir && (
            <button type="button" onClick={registrar} disabled={busy || !!problema} style={{ ...acceptButton, opacity: problema ? 0.5 : 1 }}>
              {busy ? "Registrando…" : "Registrar medición"}
            </button>
          )}
        </>
      )}
      {nota && <Notice kind={nota.kind}>{nota.text}</Notice>}
    </div>
  );
}
