"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildDataset, ModelDataset, ObjectRecord, RawObject } from "../../lib/graficos/modelData";
import { readSelection, SelectedElement } from "../../lib/propiedades/selection";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import { coincide, fmt } from "../../lib/presupuesto/format";
import { CampoMedible, camposMedibles, etiquetaCampo, sugerirCampo, valorDe } from "../../lib/presupuesto/medicion";
import { numerar } from "../../lib/presupuesto/tree";
import { CONTEO, EstadoResponse, ItemPartida, Medicion, PresupuestoDoc, ResumenElementos } from "../../lib/presupuesto/types";
import { leerDataset, MapaGuids, selector, Visor } from "../../lib/presupuesto/viewerMap";
import type { ViewerEventListener } from "../trimble/ExtensionShell";
import { ConfirmDialog } from "./SimpleDialogs";
import { baseInput, C, message, Notice } from "./ui";

type ViewerSelection = { modelId: string; objectRuntimeIds?: number[] }[];

function selectionFrom(data: unknown): ViewerSelection {
  if (Array.isArray(data)) return data as ViewerSelection;
  const inner = (data as { data?: unknown } | null)?.data;
  return Array.isArray(inner) ? (inner as ViewerSelection) : [];
}

interface Leida {
  elementos: SelectedElement[];
  /** Properties of the selected elements, per model, to measure them. */
  datasets: ModelDataset[];
  records: Map<string, ObjectRecord>; // guid -> record
  sinGuid: number;
  omitidos: number;
}

/**
 * "Presupuesto" in the 3D viewer: choose a partida of the saved budget and
 * add or remove the selected elements; the partida can take its quantity
 * from them (a property such as the volume, or their count).
 */
export default function PanelVisor({ api, viewer, subscribe }: { api: PresupuestoApi; viewer: Visor; subscribe: (l: ViewerEventListener) => () => void }) {
  const [estado, setEstado] = useState<EstadoResponse | null>(null);
  const [doc, setDoc] = useState<PresupuestoDoc | null>(null);
  const [resumen, setResumen] = useState<ResumenElementos | null>(null);
  const [loadError, setLoadError] = useState("");
  const [spId, setSpId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [itemId, setItemId] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<ViewerSelection>([]);
  const [leida, setLeida] = useState<Leida | null>(null);
  const [leyendo, setLeyendo] = useState("");
  const [deSeleccion, setDeSeleccion] = useState<Map<string, number>>(new Map());
  const [campoElegido, setCampoElegido] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState("");
  const [nota, setNota] = useState<{ kind: "info" | "warning" | "error"; text: string } | null>(null);
  const [remedir, setRemedir] = useState<{ campo: string | null } | null>(null);
  const mapa = useRef(new MapaGuids());
  const seq = useRef(0);

  const cargar = useCallback(async () => {
    setLoadError("");
    try {
      const [e, d, r] = await Promise.all([api.getEstado(), api.getDocumento(), api.getResumen()]);
      setEstado(e);
      setDoc(d.doc);
      setResumen(r);
    } catch (err) {
      setLoadError(message(err));
    }
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const recargarResumen = useCallback(async () => setResumen(await api.getResumen()), [api]);

  // ---- the viewer's selection
  useEffect(() => {
    viewer.getSelection().then((s) => setSeleccion(selectionFrom(s)), () => setSeleccion([]));
    return subscribe((event, data) => {
      if (event === "viewer.onSelectionChanged") setSeleccion(selectionFrom(data));
    });
  }, [viewer, subscribe]);

  useEffect(() => {
    const id = ++seq.current;
    const current = () => id === seq.current;
    const total = seleccion.reduce((sum, g) => sum + (g.objectRuntimeIds?.length ?? 0), 0);
    setDeSeleccion(new Map());
    if (total === 0) {
      setLeida(null);
      setLeyendo("");
      return;
    }
    setLeyendo(`Leyendo ${total.toLocaleString("es")} elemento(s)...`);
    (async () => {
      try {
        const r = await readSelection(viewer, seleccion, (done, all) => current() && setLeyendo(`Leyendo elementos: ${done} de ${all}...`), { keepProperties: true });
        if (!current()) return;
        const porModelo = new Map<string, { nombre: string; raws: RawObject[]; guids: (string | null)[] }>();
        const records = new Map<string, ObjectRecord>();
        let sinGuid = 0;
        for (const e of r.elements) {
          const g = e.resolution.guid;
          if (!g) sinGuid++;
          else mapa.current.recordar(e.fileId, e.viewerModelId, g, e.runtimeId);
          const m = porModelo.get(e.fileId) ?? { nombre: e.modelName, raws: [], guids: [] };
          if (e.properties) {
            m.raws.push(e.properties);
            m.guids.push(g);
          }
          porModelo.set(e.fileId, m);
        }
        const datasets: ModelDataset[] = [];
        for (const [fileId, m] of porModelo) {
          const ds = buildDataset(fileId, m.nombre, m.raws);
          ds.records.forEach((rec, i) => {
            const g = m.guids[i];
            if (g) records.set(g, rec);
          });
          datasets.push(ds);
        }
        setLeida({ elementos: r.elements, datasets, records, sinGuid, omitidos: r.skipped });
        setLeyendo("");
        const guids = [...records.keys(), ...r.elements.map((e) => e.resolution.guid).filter((g): g is string => !!g && !records.has(g))];
        if (guids.length) {
          const vinculados = await api.elementosDe({ ifcGuids: [...new Set(guids)] });
          if (!current()) return;
          const cuenta = new Map<string, number>();
          for (const v of vinculados) cuenta.set(v.itemId, (cuenta.get(v.itemId) ?? 0) + 1);
          setDeSeleccion(cuenta);
        }
      } catch (err) {
        if (current()) {
          setLeyendo("");
          setNota({ kind: "error", text: `No se pudo leer la selección: ${message(err)}` });
        }
      }
    })();
  }, [seleccion, viewer, api]);

  // ---- derived
  const sp = doc ? doc.subpresupuestos.find((s) => s.id === spId) ?? doc.subpresupuestos[0] : null;
  const numeros = useMemo(() => (sp ? numerar(sp.items) : []), [sp]);
  const itemsPorId = useMemo(() => {
    const m = new Map<string, { item: ItemPartida; numero: string; sp: string }>();
    for (const s of doc?.subpresupuestos ?? []) {
      const nums = numerar(s.items);
      s.items.forEach((i, k) => i.tipo === "partida" && m.set(i.id, { item: i, numero: nums[k], sp: s.nombre }));
    }
    return m;
  }, [doc]);
  const cuentas = useMemo(() => new Map((resumen?.resumen ?? []).map((r) => [r.itemId, r])), [resumen]);
  const mediciones = useMemo(() => new Map((resumen?.mediciones ?? []).map((m) => [m.itemId, m])), [resumen]);
  const filas = useMemo(() => {
    if (!sp) return [];
    if (!query.trim()) return sp.items.map((item, i) => ({ item, numero: numeros[i] }));
    return sp.items.map((item, i) => ({ item, numero: numeros[i] })).filter((f) => f.item.tipo === "partida" && coincide(`${f.numero} ${f.item.descripcion}`, query));
  }, [sp, numeros, query]);

  const sel = itemId ? itemsPorId.get(itemId) ?? null : null;
  const medicion: Medicion | null = itemId ? mediciones.get(itemId) ?? null : null;
  const cuenta = itemId ? cuentas.get(itemId) : undefined;
  const campos: CampoMedible[] = useMemo(() => camposMedibles(leida?.datasets ?? []), [leida]);
  const sugerido = sel ? sugerirCampo(sel.item.unidad, campos) : null;
  const campo: string | null = campoElegido !== undefined ? campoElegido : medicion ? medicion.campo : sugerido;
  const conGuid = leida ? leida.elementos.filter((e) => e.resolution.guid) : [];
  const canEdit = !!estado?.canEdit;

  useEffect(() => setCampoElegido(undefined), [itemId]);

  function labelDe(c: string | null): string {
    return etiquetaCampo(c, campos, c === medicion?.campo ? medicion?.campoLabel : undefined);
  }

  async function guardarMedicionSiCambia(c: string | null) {
    if (!sel) return;
    if (medicion && medicion.campo === c) return;
    const camp = campos.find((x) => x.key === c);
    await api.guardarMedicion({ itemId: sel.item.id, campo: c, campoLabel: labelDe(c), unidad: c === CONTEO ? "und" : camp?.unit ?? "" });
  }

  async function agregar() {
    if (!sel || !leida) return;
    setBusy("Agregando...");
    setNota(null);
    try {
      const upsert = conGuid.map((e) => ({ ifcGuid: e.resolution.guid!, modelId: e.fileId, cantidad: valorDe(leida.records.get(e.resolution.guid!), campo) }));
      const unicos = [...new Map(upsert.map((u) => [u.ifcGuid, u])).values()];
      await api.guardarElementos(sel.item.id, unicos, []);
      await guardarMedicionSiCambia(campo);
      await recargarResumen();
      const sinValor = campo && campo !== CONTEO ? unicos.filter((u) => u.cantidad === null).length : 0;
      const partes = [`${unicos.length} elemento(s) asociados a ${sel.numero} ${sel.item.descripcion}.`];
      if (sinValor) partes.push(`${sinValor} no tienen "${labelDe(campo)}": cuentan 0.`);
      if (leida.sinGuid) partes.push(`${leida.sinGuid} sin IFCGUID no se pudieron asociar.`);
      setNota({ kind: sinValor || leida.sinGuid ? "warning" : "info", text: partes.join(" ") });
      setDeSeleccion((m) => new Map(m).set(sel.item.id, unicos.length));
    } catch (err) {
      setNota({ kind: "error", text: message(err) });
    } finally {
      setBusy("");
    }
  }

  async function quitarSeleccion() {
    if (!sel) return;
    setBusy("Quitando...");
    setNota(null);
    try {
      const guids = [...new Set(conGuid.map((e) => e.resolution.guid!))];
      await api.guardarElementos(sel.item.id, [], guids);
      await recargarResumen();
      setDeSeleccion((m) => {
        const n = new Map(m);
        n.delete(sel.item.id);
        return n;
      });
      setNota({ kind: "info", text: `Se quitaron de ${sel.numero} ${sel.item.descripcion} los elementos seleccionados que tenía.` });
    } catch (err) {
      setNota({ kind: "error", text: message(err) });
    } finally {
      setBusy("");
    }
  }

  async function seleccionarEnModelo() {
    if (!sel) return;
    setBusy("Buscando en el modelo...");
    setNota(null);
    try {
      const elementos = await api.elementosDe({ itemIds: [sel.item.id] });
      if (!elementos.length) {
        setNota({ kind: "info", text: "Esta partida no tiene elementos asociados." });
        return;
      }
      const u = await mapa.current.ubicar(viewer, elementos, setBusy);
      if (u.encontrados) await viewer.setSelection(selector(u.porModelo), "set");
      const faltan = [u.noEncontrados && `${u.noEncontrados} no están en los modelos cargados`, u.sinModelo && `${u.sinModelo} son de modelos que no están abiertos`].filter(Boolean);
      setNota({ kind: faltan.length ? "warning" : "info", text: `${u.encontrados} de ${elementos.length} elemento(s) seleccionados en el modelo.${faltan.length ? ` ${faltan.join("; ")}.` : ""}` });
    } catch (err) {
      setNota({ kind: "error", text: message(err) });
    } finally {
      setBusy("");
    }
  }

  /** Measures again every element of the partida with another property. */
  async function aplicarMedicion(c: string | null) {
    if (!sel) return;
    setRemedir(null);
    setBusy("Midiendo...");
    setNota(null);
    try {
      const elementos = await api.elementosDe({ itemIds: [sel.item.id] });
      let medidos = 0;
      let faltan = 0;
      if (elementos.length) {
        if (c === null) {
          // Only linked: the quantities stop counting.
        } else {
          const u = await mapa.current.ubicar(viewer, elementos, setBusy);
          const porGuid = new Map<string, number | null>();
          for (const [viewerModelId, ids] of u.porModelo) {
            const ds = await leerDataset(viewer, viewerModelId, "", ids);
            const porRt = new Map(ds.records.map((r) => [r.runtimeId, r]));
            for (const [guid, where] of u.ubicacion) {
              if (where.viewerModelId === viewerModelId) porGuid.set(guid, valorDe(porRt.get(where.runtimeId), c));
            }
          }
          const upsert = elementos.filter((e) => porGuid.has(e.ifcGuid)).map((e) => ({ ifcGuid: e.ifcGuid, modelId: e.modelId, cantidad: porGuid.get(e.ifcGuid) ?? null }));
          medidos = upsert.length;
          faltan = elementos.length - upsert.length;
          if (upsert.length) await api.guardarElementos(sel.item.id, upsert, []);
        }
      }
      await guardarMedicionSiCambia(c);
      setCampoElegido(undefined);
      await recargarResumen();
      setNota({
        kind: faltan ? "warning" : "info",
        text:
          c === null
            ? "La partida vuelve a usar su metrado manual (sus elementos siguen asociados)."
            : `Medición: ${labelDe(c)}. ${medidos} elemento(s) medidos${faltan ? `; ${faltan} no están en los modelos cargados y conservan su cantidad anterior` : ""}.`,
      });
    } catch (err) {
      setNota({ kind: "error", text: message(err) });
    } finally {
      setBusy("");
    }
  }

  // ---------------------------------------------------------------- render

  if (loadError) {
    return (
      <div style={{ padding: 14 }}>
        <Notice kind="error">No se pudo cargar el presupuesto: {loadError}</Notice>
        <button type="button" style={{ ...btn, marginTop: 10 }} onClick={cargar}>
          Reintentar
        </button>
      </div>
    );
  }
  if (!doc || !estado || !sp) return <div style={{ padding: 14, color: "var(--tc-gray-500)" }}>Cargando el presupuesto...</div>;

  const totalSel = seleccion.reduce((sum, g) => sum + (g.objectRuntimeIds?.length ?? 0), 0);
  const metradoModelo = cuenta && medicion?.campo ? (medicion.campo === CONTEO ? cuenta.elementos : cuenta.suma) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontSize: 13.5, background: "#fff" }}>
      <div style={{ background: C.header, color: "#fff", padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 15 }}>Presupuesto</strong>
        <span style={{ fontSize: 12, opacity: 0.85, flex: 1 }}>{canEdit ? "asociar elementos" : "solo consulta"}</span>
        <button type="button" onClick={cargar} style={{ ...btnHeader }} title="Volver a cargar el presupuesto guardado">
          ↻ Recargar
        </button>
      </div>

      <div style={{ padding: "8px 10px", display: "flex", gap: 6, borderBottom: `1px solid ${C.border}` }}>
        <select value={sp.id} onChange={(e) => setSpId(e.target.value)} style={{ ...baseInput, flex: "0 1 45%" }} aria-label="Subpresupuesto">
          {doc.subpresupuestos.map((s) => (
            <option key={s.id} value={s.id}>
              {s.nombre}
            </option>
          ))}
        </select>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar partida" style={{ ...baseInput, flex: 1 }} aria-label="Buscar partida" />
      </div>

      <div style={{ flex: "1 1 40%", minHeight: 120, overflow: "auto" }}>
        {filas.map(({ item, numero }) => {
          if (item.tipo === "titulo") {
            return (
              <div key={item.id} style={{ padding: `5px 10px 3px ${10 + item.nivel * 12}px`, fontWeight: 700, background: "#f6f8fb", borderBottom: `1px solid ${C.grid}`, fontSize: 12.5 }}>
                {numero} {item.descripcion}
              </div>
            );
          }
          const n = cuentas.get(item.id)?.elementos ?? 0;
          const enSel = deSeleccion.get(item.id);
          const active = item.id === itemId;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setItemId(item.id)}
              style={{
                display: "flex",
                width: "100%",
                alignItems: "center",
                gap: 6,
                border: "none",
                borderBottom: `1px solid ${C.grid}`,
                background: active ? C.rowSelected : "#fff",
                padding: `6px 10px 6px ${10 + item.nivel * 12}px`,
                textAlign: "left",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 13,
              }}
            >
              <span style={{ color: "var(--tc-gray-500)", minWidth: 34 }}>{numero}</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.descripcion}>
                {item.descripcion}
              </span>
              <span style={{ color: "var(--tc-gray-500)", fontSize: 12 }}>{item.unidad}</span>
              {enSel ? (
                <span style={{ ...badge, background: "#fde7d9", color: "#9a3c0c" }} title="Elementos seleccionados que ya pertenecen a esta partida">
                  ● {enSel}
                </span>
              ) : null}
              {n > 0 && (
                <span style={badge} title="Elementos asociados">
                  {n}
                </span>
              )}
            </button>
          );
        })}
        {filas.length === 0 && (
          <p style={{ padding: 12, color: "var(--tc-gray-500)" }}>
            {query ? "Ninguna partida coincide." : "Este subpresupuesto no tiene partidas guardadas. Créalas en el menú Presupuesto del proyecto y guarda."}
          </p>
        )}
      </div>

      <div style={{ flex: "0 0 auto", borderTop: `2px solid ${C.border}`, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, maxHeight: "58vh", overflow: "auto" }}>
        <div style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>
          {leyendo ||
            (totalSel
              ? `Selección: ${totalSel.toLocaleString("es")} elemento(s)${leida?.sinGuid ? ` · ${leida.sinGuid} sin IFCGUID` : ""}${leida?.omitidos ? ` · ${leida.omitidos} no leídos (máx. 5.000)` : ""}`
              : "Selecciona elementos en el modelo para asociarlos a una partida.")}
        </div>
        {deSeleccion.size > 0 && (
          <div style={{ fontSize: 12.5 }}>
            Partidas de la selección:{" "}
            {[...deSeleccion].map(([id, n]) => {
              const p = itemsPorId.get(id);
              if (!p) return null;
              return (
                <button key={id} type="button" style={chip} onClick={() => setItemId(id)} title={`${p.sp} · ${p.item.descripcion}`}>
                  {p.numero} {p.item.descripcion.slice(0, 28)}
                  {p.item.descripcion.length > 28 ? "…" : ""} ({n})
                </button>
              );
            })}
          </div>
        )}

        {sel ? (
          <>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {sel.numero} {sel.item.descripcion}
              </div>
              <div style={{ color: "var(--tc-gray-500)", fontSize: 12.5 }}>
                {sel.sp} · {sel.item.unidad || "sin unidad"} · {cuenta?.elementos ?? 0} elemento(s) asociado(s) · metrado{" "}
                {metradoModelo !== null ? `del modelo: ${fmt(metradoModelo)}` : `manual: ${fmt(sel.item.metrado)}`}
              </div>
            </div>
            <label style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>
              Metrado desde el modelo
              <select
                value={campo ?? ""}
                disabled={!canEdit || !!busy}
                onChange={(e) => {
                  const c = e.target.value || null;
                  if ((cuenta?.elementos ?? 0) > 0 && medicion?.campo !== c) setRemedir({ campo: c });
                  else setCampoElegido(c);
                }}
                style={{ ...baseInput, width: "100%", marginTop: 3 }}
              >
                <option value="">Solo asociar (metrado manual)</option>
                <option value={CONTEO}>Conteo de elementos</option>
                {campo && campo !== CONTEO && !campos.some((x) => x.key === campo) && <option value={campo}>{labelDe(campo)}</option>}
                {campos.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.label}
                    {x.unit ? ` (${x.unit})` : ""}
                    {x.key === sugerido ? " · sugerido" : ""}
                  </option>
                ))}
              </select>
              {!campos.length && <span style={{ fontSize: 11.5 }}>Selecciona elementos para ver sus propiedades numéricas.</span>}
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <button type="button" style={primary} disabled={!canEdit || !!busy || !conGuid.length || !!leyendo} onClick={agregar}>
                ⊕ Agregar selección{conGuid.length ? ` (${conGuid.length})` : ""}
              </button>
              <button type="button" style={btn} disabled={!canEdit || !!busy || !conGuid.length || !!leyendo} onClick={quitarSeleccion}>
                ⊖ Quitar selección
              </button>
              <button type="button" style={{ ...btn, gridColumn: "1 / -1" }} disabled={!!busy || !(cuenta?.elementos)} onClick={seleccionarEnModelo}>
                Seleccionar sus elementos en el modelo
              </button>
            </div>
          </>
        ) : (
          <p style={{ margin: 0, color: "var(--tc-gray-500)" }}>Elige una partida de la lista.</p>
        )}
        {busy && <div style={{ fontSize: 12.5, color: "var(--tc-blue-700)" }}>{busy}</div>}
        {nota && <Notice kind={nota.kind}>{nota.text}</Notice>}
        {!canEdit && <Notice kind="info">Solo los administradores y editores del presupuesto asocian elementos; tú puedes consultar.</Notice>}
        <p style={{ margin: 0, fontSize: 11.5, color: "var(--tc-gray-500)" }}>
          Aquí aparece el presupuesto guardado. Las partidas nuevas se ven después de guardarlas en el menú Presupuesto (↻ Recargar).
        </p>
      </div>

      {remedir && sel && (
        <ConfirmDialog title="Cambiar la medición" onClose={() => setRemedir(null)} onConfirm={() => aplicarMedicion(remedir.campo)}>
          {remedir.campo
            ? `Se medirán de nuevo los ${cuenta?.elementos ?? 0} elementos de la partida con "${labelDe(remedir.campo)}". Los que estén en modelos no cargados conservan su cantidad.`
            : "La partida usará su metrado manual; sus elementos siguen asociados."}
        </ConfirmDialog>
      )}
    </div>
  );
}

const btn: CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  background: "#fff",
  color: "var(--tc-blue-700)",
  borderRadius: 5,
  padding: "7px 8px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
const primary: CSSProperties = { ...btn, background: "var(--tc-blue-600)", color: "#fff", borderColor: "var(--tc-blue-700)" };
const btnHeader: CSSProperties = { border: "1px solid rgba(255,255,255,0.5)", background: "transparent", color: "#fff", borderRadius: 4, padding: "3px 8px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" };
const badge: CSSProperties = { fontSize: 11, fontWeight: 700, background: "#dbe8fb", color: "var(--tc-blue-800)", borderRadius: 9, padding: "1px 7px" };
const chip: CSSProperties = { border: "1px solid #f0b48f", background: "#fff6f0", borderRadius: 10, padding: "1px 8px", margin: "2px 4px 2px 0", fontSize: 12, cursor: "pointer", fontFamily: "inherit" };
