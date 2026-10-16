"use client";

import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import { calcularApu, esPorcentajeMO, InsumoRef, Resolver } from "../../lib/presupuesto/calc";
import { JORNADA, resolverCatalogo } from "../../lib/presupuesto/doc";
import { fmt } from "../../lib/presupuesto/format";
import {
  buscadorReferencias,
  calcularPropuesta,
  catalogoParaApu,
  claveLinea,
  fueraDeRango,
  muestraEvaluacion,
  partidasParaApu,
  ResultadoEvaluacionApu,
  resultadoEvaluacion,
  resumenEvaluacion,
  SISTEMA_APU,
  sinPrecio,
} from "../../lib/presupuesto/ia/apu";
import { estimarCostoCop, fmtCop } from "../../lib/presupuesto/ia/cupo";
import { BorradorApuIA, Confianza, EstadoCupo, EstadoIAResponse, MAX_CATALOGO_IA, PartidaApuIA, PropuestaApu, ResumenesIA } from "../../lib/presupuesto/ia/tipos";
import type { Componente, Insumo, ItemPartida, PartidaCatalogo, PresupuestoDoc, TipoInsumo } from "../../lib/presupuesto/types";
import { Aviso, bloqueadoPor, botonSec, conReintento, iaChip, apagado, Progreso, quitar, Seccion, td, th } from "./AsistenteIAFases";
import { acceptButton, labelStyle, message, Notice, NumInput, Square } from "./ui";

/** Partidas per call: each answer must fit in one server function (about a minute). */
const LOTE_APU = 3;

const CONFIANZA: Record<Confianza, { texto: string; color: string; fondo: string }> = {
  alta: { texto: "Confianza alta", color: "#1e6b2e", fondo: "#e3f4e6" },
  media: { texto: "Confianza media", color: "#7a5300", fondo: "#fff3cd" },
  baja: { texto: "Confianza baja: revisar", color: "#8a1c14", fondo: "#fdecea" },
};

/** What the budget gets when an analysis is applied: the partida's yield and lines, and the resources to price it with. */
export interface CambioApu {
  itemId: string;
  rendimiento: number;
  componentes: Componente[];
  insumos: Insumo[];
}

// ---------------------------------------------------------------- phase 4: the unit cost analysis

export function ApuIA({
  api,
  doc,
  spId,
  projectId,
  estado,
  catalogo,
  puedeCatalogo,
  aplicarApu,
  crearInsumos,
  onCupo,
  onResumen,
}: {
  api: PresupuestoApi;
  doc: PresupuestoDoc;
  spId: string;
  projectId: string;
  estado: EstadoIAResponse;
  catalogo: { insumos: Insumo[]; partidas: PartidaCatalogo[] } | null;
  /** The person can add to the catalog (needed for the new resources). */
  puedeCatalogo: boolean;
  /** Puts accepted analyses into the budget's partidas; answers how many were found. */
  aplicarApu: (cambios: CambioApu[]) => number;
  /** Creates resources in the catalog (without a price) and answers them. */
  crearInsumos: (lista: { descripcion: string; unidad: string; tipo: TipoInsumo }[]) => Promise<Insumo[]>;
  onCupo: (c: EstadoCupo) => void;
  onResumen: (r: ResumenesIA) => void;
}) {
  const [contexto] = useState(() => {
    try {
      return localStorage.getItem(`presupuesto.ia.contexto.${projectId}`) ?? "";
    } catch {
      return "";
    }
  });
  const [todo, setTodo] = useState(false);
  const [soloSinAnalisis, setSoloSinAnalisis] = useState(true);
  const [borradores, setBorradores] = useState<BorradorApuIA[] | null>(null);
  const [ediciones, setEdiciones] = useState<Map<string, PropuestaApu>>(new Map());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [progreso, setProgreso] = useState<{ hechos: number; total: number; costo: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [nota, setNota] = useState<{ kind: "info" | "warning" | "error"; texto: string } | null>(null);
  const cancelar = useRef(false);
  const bloqueo = bloqueadoPor(estado);

  const insumosCat = useMemo(() => catalogo?.insumos ?? [], [catalogo]);
  const partidasCat = useMemo(() => catalogo?.partidas ?? [], [catalogo]);
  const insumoMap = useMemo(() => new Map(insumosCat.map((i) => [i.id, i])), [insumosCat]);
  const partidaMap = useMemo(() => new Map(partidasCat.map((p) => [p.id, p])), [partidasCat]);
  const buscador = useMemo(() => buscadorReferencias(partidasCat, insumoMap), [partidasCat, insumoMap]);
  const partidas = useMemo(
    () => partidasParaApu(doc, todo ? null : spId, soloSinAnalisis).map((p) => ({ ...p, referencias: buscador.referencias(p) })),
    [doc, todo, spId, soloSinAnalisis, buscador]
  );
  const items = useMemo(() => new Map(doc.subpresupuestos.flatMap((sp) => sp.items.filter((i): i is ItemPartida => i.tipo === "partida").map((i) => [i.id, i]))), [doc]);
  // Prices as the budget has them (else the catalog's): what the partida will cost once applied.
  const precio = useMemo(() => (id: string): InsumoRef | null => doc.insumos[id] ?? insumoMap.get(id) ?? null, [doc, insumoMap]);
  const resolver: Resolver = useMemo(() => ({ insumo: precio, subpartida: (id) => doc.subpartidas[id] ?? partidaMap.get(id) ?? null }), [precio, doc, partidaMap]);
  const lotes = Math.ceil(partidas.length / LOTE_APU);
  const estimado = estimarCostoCop(
    estado.modelo,
    lotes * (SISTEMA_APU.length + Math.min(insumosCat.length, MAX_CATALOGO_IA) * 45) + partidas.length * 1500,
    partidas.length * 1200,
    estado.cupo.trm
  );

  useEffect(() => {
    if (estado.puedeUsar) api.borradoresApuIA().then(setBorradores, (err) => setNota({ kind: "error", texto: message(err) }));
  }, [api, estado.puedeUsar]);

  async function generar() {
    cancelar.current = false;
    setOcupado(true);
    setNota(null);
    let costo = 0;
    let faltantes = 0;
    let error = "";
    for (let k = 0; k < lotes && !cancelar.current; k++) {
      setProgreso({ hechos: k, total: lotes, costo });
      const lote = partidas.slice(k * LOTE_APU, (k + 1) * LOTE_APU);
      try {
        const r = await conReintento(() => api.generarApuIA({ contexto, partidas: lote, catalogo: catalogoParaApu(insumosCat, lote, MAX_CATALOGO_IA) }));
        costo += r.costoCop;
        faltantes += r.faltantes.length;
        onCupo(r.cupo);
        setBorradores((l) => {
          const nuevos = new Set(r.borradores.map((b) => b.itemId));
          return [...(l ?? []).filter((b) => !nuevos.has(b.itemId)), ...r.borradores];
        });
        if (r.cupo.nivel === "agotado") {
          error = r.cupo.mensaje;
          break;
        }
      } catch (err) {
        error = message(err);
        break;
      }
    }
    setProgreso({ hechos: lotes, total: lotes, costo });
    setOcupado(false);
    const faltan = faltantes ? ` ${faltantes} partida(s) quedaron sin análisis: vuelve a pedirlas.` : "";
    setNota(
      error
        ? { kind: "error", texto: `Se detuvo: ${error}${faltan}` }
        : { kind: cancelar.current ? "warning" : "info", texto: `Listo por ${fmtCop(costo)}.${faltan} Revisa abajo cada análisis antes de aplicarlo.` }
    );
  }

  const propuestaDe = (b: BorradorApuIA) => ediciones.get(b.id) ?? b.propuesta;
  const editar = (b: BorradorApuIA, p: PropuestaApu) => setEdiciones((m) => new Map(m).set(b.id, p));

  async function aplicar(lista: BorradorApuIA[]) {
    const aplicables = lista.filter((b) => items.has(b.itemId));
    if (!aplicables.length) return;
    setOcupado(true);
    setNota(null);
    try {
      // The new resources go into the catalog first (once each), without a price.
      const nuevos = new Map<string, { descripcion: string; unidad: string; tipo: TipoInsumo }>();
      for (const b of aplicables) for (const l of propuestaDe(b).lineas) if (!l.insumoId) nuevos.set(claveLinea(l), { descripcion: l.descripcion, unidad: l.unidad, tipo: l.tipo });
      const creados = new Map<string, Insumo>();
      if (nuevos.size && puedeCatalogo) {
        const hechos = await crearInsumos([...nuevos.values()]);
        [...nuevos.keys()].forEach((clave, i) => hechos[i] && creados.set(clave, hechos[i]));
      }
      let omitidas = 0;
      const cambios: CambioApu[] = [];
      const decisiones = aplicables.map((b) => {
        const p = propuestaDe(b);
        const usadas = p.lineas.filter((l) => (l.insumoId ? insumoMap.has(l.insumoId) || !!doc.insumos[l.insumoId] : creados.has(claveLinea(l))));
        omitidas += p.lineas.length - usadas.length;
        const insumos: Insumo[] = [];
        const componentes: Componente[] = usadas.map((l) => {
          const ins = l.insumoId ? insumoMap.get(l.insumoId) : creados.get(claveLinea(l));
          if (ins) insumos.push(ins);
          return { tipo: "insumo", id: ins?.id ?? l.insumoId!, cuadrilla: l.cuadrilla, cantidad: l.cantidad };
        });
        cambios.push({ itemId: b.itemId, rendimiento: p.rendimiento, componentes, insumos });
        // What was applied, in the proposal's terms (new resources without their new id).
        return { id: b.id, estado: "aceptado" as const, final: { ...p, lineas: usadas } };
      });
      const n = aplicarApu(cambios);
      const r = await api.decidirBorradoresIA(decisiones);
      onResumen(r.resumen);
      quitarDeLaLista(aplicables);
      setNota({
        kind: omitidas ? "warning" : "info",
        texto:
          `${n} análisis aplicado(s) al presupuesto: guárdalo para conservarlos.` +
          (creados.size ? ` Se crearon ${creados.size} insumo(s) en el catálogo sin precio: ponles precio en la Lista de insumos del presupuesto y en el catálogo.` : "") +
          (omitidas ? ` ${omitidas} línea(s) con insumos nuevos no se agregaron porque no puedes modificar el catálogo.` : "") +
          (lista.length > aplicables.length ? ` ${lista.length - aplicables.length} no se aplicaron porque la partida ya no existe (descártalos).` : ""),
      });
    } catch (err) {
      setNota({ kind: "error", texto: message(err) });
    } finally {
      setOcupado(false);
    }
  }

  async function descartar(lista: BorradorApuIA[]) {
    if (!lista.length) return;
    setOcupado(true);
    setNota(null);
    try {
      const r = await api.decidirBorradoresIA(lista.map((b) => ({ id: b.id, estado: "rechazado" as const })));
      onResumen(r.resumen);
      quitarDeLaLista(lista);
      setNota({ kind: "info", texto: `${lista.length} análisis descartado(s).` });
    } catch (err) {
      setNota({ kind: "error", texto: message(err) });
    } finally {
      setOcupado(false);
    }
  }

  function quitarDeLaLista(lista: BorradorApuIA[]) {
    const ids = new Set(lista.map((b) => b.id));
    setBorradores((l) => (l ?? []).filter((b) => !ids.has(b.id)));
    setSel((s) => new Set([...s].filter((id) => !ids.has(id))));
  }

  const seleccionados = (borradores ?? []).filter((b) => sel.has(b.id));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, overflow: "auto", minHeight: 0 }}>
      <Aviso estado={estado} />
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
        Arma el <strong>análisis de precios unitarios</strong> de las partidas: rendimiento, cuadrillas de mano de obra y equipos, y cantidades de materiales con
        su desperdicio. Usa los insumos de tu catálogo ({insumosCat.length}) y, como ejemplo, tus partidas parecidas que ya tienen análisis. Los precios salen
        siempre de tu catálogo o del presupuesto, nunca de la IA. Si falta un insumo, lo propone para crearlo sin precio.
      </p>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--tc-gray-500)" }}>
        Al proveedor de IA{estado.proveedor ? ` (${estado.proveedor}, modelo ${estado.modelo})` : ""} se envían la descripción, la unidad y el capítulo de cada
        partida, los insumos del catálogo (sin precios) y los análisis de las partidas parecidas (sin precios).
        {estado.proveedor === "Google" && " En el nivel gratuito de Google AI Studio, Google puede usar lo enviado para mejorar sus productos."}
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13.5 }}>
        <div role="radiogroup" aria-label="Alcance">
          <span style={labelStyle}>Partidas de</span>
          <label style={{ display: "block" }}>
            <input type="radio" checked={!todo} onChange={() => setTodo(false)} /> Este subpresupuesto
          </label>
          <label style={{ display: "block" }}>
            <input type="radio" checked={todo} onChange={() => setTodo(true)} /> Todo el presupuesto
          </label>
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "flex-start", paddingTop: 20 }}>
          <input type="checkbox" checked={soloSinAnalisis} onChange={(e) => setSoloSinAnalisis(e.target.checked)} />
          Solo las partidas sin análisis de precios (sin insumos)
        </label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", fontSize: 13.5 }}>
        <span>
          <strong>{partidas.length}</strong> partida(s) en {lotes} lote(s) de {LOTE_APU}; {partidas.filter((p) => p.referencias.length).length} con partidas parecidas
          en el catálogo. Costo estimado: <strong>{fmtCop(estimado)}</strong> (puede variar).
        </span>
        {!ocupado || !progreso ? (
          <button
            type="button"
            style={{ ...acceptButton, marginLeft: "auto", ...(bloqueo || !partidas.length || ocupado || !catalogo ? apagado : {}) }}
            disabled={!!bloqueo || !partidas.length || ocupado || !catalogo}
            onClick={generar}
          >
            Proponer análisis
          </button>
        ) : (
          <button type="button" style={{ ...botonSec, marginLeft: "auto" }} onClick={() => (cancelar.current = true)}>
            Cancelar después de este lote
          </button>
        )}
      </div>
      {!catalogo && <Notice kind="info">Cargando el catálogo...</Notice>}
      {partidas.length === 0 && (
        <Notice kind="info">
          No hay partidas {soloSinAnalisis ? "sin análisis de precios " : ""}en {todo ? "el presupuesto" : "este subpresupuesto"}.
          {soloSinAnalisis ? " Desmarca la casilla para proponer un análisis nuevo de las que ya tienen (al aplicarlo reemplaza el actual)." : ""}
        </Notice>
      )}
      {progreso && <Progreso hechos={progreso.hechos} total={progreso.total} texto={`${ocupado ? `Lote ${Math.min(progreso.hechos + 1, progreso.total)} de ${progreso.total}...` : "Terminado."} ${fmtCop(progreso.costo)}`} />}
      {nota && <Notice kind={nota.kind}>{nota.texto}</Notice>}

      {borradores && borradores.length > 0 && (
        <Seccion titulo={`Análisis propuestos por revisar (${borradores.length})`}>
          {!puedeCatalogo && borradores.some((b) => b.propuesta.lineas.some((l) => !l.insumoId)) && (
            <Notice kind="info">Algunos análisis traen insumos nuevos: como no puedes modificar el catálogo, esas líneas no se agregan al aplicarlos.</Notice>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "6px 0 10px", flexWrap: "wrap", fontSize: 13 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={borradores.every((b) => sel.has(b.id))} onChange={(e) => setSel(e.target.checked ? new Set(borradores.map((b) => b.id)) : new Set())} /> Seleccionar todos
            </label>
            <button type="button" style={{ ...acceptButton, padding: "6px 14px", fontSize: 14, ...(ocupado || !seleccionados.length ? apagado : {}) }} disabled={ocupado || !seleccionados.length} onClick={() => aplicar(seleccionados)}>
              Aplicar seleccionados ({seleccionados.length})
            </button>
            <button type="button" style={{ ...botonSec, color: "#8a1c14" }} disabled={ocupado || !seleccionados.length} onClick={() => descartar(seleccionados)}>
              Descartar seleccionados
            </button>
            <span style={{ marginLeft: "auto", color: "var(--tc-gray-500)" }}>Corrige el rendimiento, las cuadrillas o las cantidades antes de aplicar. Luego pulsa Guardar.</span>
          </div>
          {borradores.map((b) => (
            <TarjetaApu
              key={b.id}
              b={b}
              p={propuestaDe(b)}
              item={items.get(b.itemId) ?? null}
              seleccionado={sel.has(b.id)}
              onSeleccionar={(v) =>
                setSel((s) => {
                  const n = new Set(s);
                  if (v) n.add(b.id);
                  else n.delete(b.id);
                  return n;
                })
              }
              precio={precio}
              resolver={resolver}
              parecidas={buscador.parecidas}
              ocupado={ocupado}
              onEditar={(p) => editar(b, p)}
              onAplicar={() => aplicar([b])}
              onDescartar={() => descartar([b])}
            />
          ))}
        </Seccion>
      )}

      {catalogo && (
        <EvaluarApu
          api={api}
          estado={estado}
          insumos={insumosCat}
          partidas={partidasCat}
          insumoMap={insumoMap}
          partidaMap={partidaMap}
          buscador={buscador}
          ocupado={ocupado}
          setOcupado={setOcupado}
          onCupo={onCupo}
        />
      )}
    </div>
  );
}

/** One proposed analysis: its lines with the budget's prices, its unit cost against the current one and similar catalog partidas. */
function TarjetaApu({
  b,
  p,
  item,
  seleccionado,
  onSeleccionar,
  precio,
  resolver,
  parecidas,
  ocupado,
  onEditar,
  onAplicar,
  onDescartar,
}: {
  b: BorradorApuIA;
  p: PropuestaApu;
  item: ItemPartida | null;
  seleccionado: boolean;
  onSeleccionar: (v: boolean) => void;
  precio: (id: string) => InsumoRef | null;
  resolver: Resolver;
  parecidas: (q: { descripcion: string; unidad: string }) => PartidaCatalogo[];
  ocupado: boolean;
  onEditar: (p: PropuestaApu) => void;
  onAplicar: () => void;
  onDescartar: () => void;
}) {
  const jornada = item?.jornada || JORNADA;
  const calc = useMemo(() => calcularPropuesta(p, jornada, precio), [p, jornada, precio]);
  const actual = useMemo(() => (item && item.componentes.length ? calcularApu(item, resolver).cu : null), [item, resolver]);
  const refs = useMemo(() => (item ? parecidas(item).map((x) => ({ descripcion: x.descripcion, cu: calcularApu(x, resolver).cu })) : []), [item, parecidas, resolver]);
  const sinPrecios = sinPrecio(calc);
  const fuera = fueraDeRango(calc.cu, refs.map((r) => r.cu));
  const conf = CONFIANZA[p.confianza];
  const cambiarLinea = (i: number, campo: "cuadrilla" | "cantidad", v: number) => onEditar({ ...p, lineas: p.lineas.map((l, k) => (k === i ? { ...l, [campo]: v } : l)) });
  return (
    <div style={{ border: `1px solid ${seleccionado ? "var(--tc-blue-500)" : "#dfe4ea"}`, borderRadius: 4, marginBottom: 10 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 10px", background: "#eef2f7", flexWrap: "wrap", fontSize: 13 }}>
        <input type="checkbox" aria-label={`Seleccionar ${b.referencia}`} checked={seleccionado} onChange={(e) => onSeleccionar(e.target.checked)} />
        <span style={iaChip}>IA</span>
        <strong>{b.referencia}</strong>
        {item && <span style={{ color: "var(--tc-gray-500)" }}>({item.unidad})</span>}
        <span style={{ ...chip, color: conf.color, background: conf.fondo }}>{conf.texto}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button type="button" style={{ ...botonSec, color: "#1e6b2e" }} disabled={ocupado || !item} onClick={onAplicar}>
            ✓ Aplicar
          </button>
          <button type="button" style={{ ...botonSec, color: "#8a1c14" }} disabled={ocupado} onClick={onDescartar}>
            ✕ Descartar
          </button>
        </span>
      </div>
      <div style={{ padding: "8px 10px", display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Rendimiento
          <NumInput value={p.rendimiento} decimals={4} ariaLabel={`Rendimiento de ${b.referencia}`} onCommit={(n) => n && n > 0 && onEditar({ ...p, rendimiento: n })} style={{ width: 100 }} />
          {item ? `${item.unidad}/día` : ""} (jornada de {jornada} h)
        </label>
        <span>
          CU propuesto: <strong>{fmt(calc.cu)}</strong>
        </span>
        {actual !== null && (
          <span style={{ color: "#7a5300" }}>
            Tiene análisis: CU actual {fmt(actual)} (al aplicar se reemplaza)
          </span>
        )}
        {refs.length > 0 && (
          <span style={{ color: fuera ? "#8a1c14" : "var(--tc-gray-500)" }} title={refs.map((r) => `${r.descripcion}: ${fmt(r.cu)}`).join("\n")}>
            {fuera ? "⚠ Fuera del rango de" : "Parecidas del catálogo"}: {fmt(Math.min(...refs.map((r) => r.cu)))} a {fmt(Math.max(...refs.map((r) => r.cu)))}
          </span>
        )}
        {sinPrecios > 0 && <span style={{ color: "#8a1c14" }}>{sinPrecios} insumo(s) sin precio</span>}
        {!item && <span style={{ color: "#8a1c14" }}>La partida ya no existe en el presupuesto.</span>}
      </div>
      {p.supuestos && <div style={{ padding: "0 10px 8px", fontSize: 12.5, color: "var(--tc-gray-500)" }}>Supuestos: {p.supuestos}</div>}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ ...th, width: 50 }}>Tipo</th>
            <th style={th}>Insumo</th>
            <th style={{ ...th, width: 70 }}>Unidad</th>
            <th style={{ ...th, width: 90 }}>Cuadrilla</th>
            <th style={{ ...th, width: 100 }}>Cantidad</th>
            <th style={{ ...th, width: 100 }}>Precio</th>
            <th style={{ ...th, width: 100 }}>Parcial</th>
            <th style={{ ...th, width: 30 }} />
          </tr>
        </thead>
        <tbody>
          {p.lineas.map((l, i) => {
            const c = calc.lineas[i];
            return (
              <tr key={claveLinea(l)}>
                <td style={{ ...td, textAlign: "center" }}>
                  <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                    <Square rubro={l.tipo} /> {l.tipo}
                  </span>
                </td>
                <td style={td}>
                  {l.descripcion}{" "}
                  {!l.insumoId && (
                    <span style={{ ...chip, background: "#fff3cd", color: "#7a5300", fontSize: 11 }} title="No está en el catálogo: al aplicar se crea sin precio">
                      nuevo
                    </span>
                  )}
                </td>
                <td style={{ ...td, textAlign: "center" }}>{l.unidad}</td>
                <td style={tdNum}>
                  {l.cuadrilla !== null ? <NumInput value={l.cuadrilla} decimals={2} ariaLabel={`Cuadrilla de ${l.descripcion}`} onCommit={(n) => n !== null && n > 0 && cambiarLinea(i, "cuadrilla", n)} style={{ width: 80 }} /> : ""}
                </td>
                <td style={tdNum}>
                  {l.cuadrilla === null ? (
                    <NumInput value={l.cantidad} decimals={4} ariaLabel={`Cantidad de ${l.descripcion}`} onCommit={(n) => n !== null && n > 0 && cambiarLinea(i, "cantidad", n)} style={{ width: 90 }} />
                  ) : (
                    fmt(c?.cantidad ?? 0, 4)
                  )}
                </td>
                <td style={{ ...tdNum, color: c && !c.porcentaje && c.precio === 0 ? "#8a1c14" : undefined }}>{c?.porcentaje ? (esPorcentajeMO(c.unidad) ? "% MO" : "% partida") : c && c.precio === 0 ? "sin precio" : fmt(c?.precio ?? 0)}</td>
                <td style={tdNum}>{fmt(c?.parcial ?? 0)}</td>
                <td style={{ ...td, textAlign: "center" }}>
                  <button type="button" title="Quitar esta línea" aria-label={`Quitar ${l.descripcion}`} disabled={p.lineas.length <= 1} onClick={() => onEditar({ ...p, lineas: p.lineas.filter((_, k) => k !== i) })} style={quitar}>
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- evaluation against the catalog

/**
 * Asks for the analysis of catalog partidas that already have one, without
 * showing it to the model, and compares the unit costs (with the catalog's
 * prices). Nothing is saved; it shows whether the assistant is good enough for
 * this company before trusting it, and again after changing the model.
 */
function EvaluarApu({
  api,
  estado,
  insumos,
  partidas,
  insumoMap,
  partidaMap,
  buscador,
  ocupado,
  setOcupado,
  onCupo,
}: {
  api: PresupuestoApi;
  estado: EstadoIAResponse;
  insumos: Insumo[];
  partidas: PartidaCatalogo[];
  insumoMap: Map<string, Insumo>;
  partidaMap: Map<string, PartidaCatalogo>;
  buscador: ReturnType<typeof buscadorReferencias>;
  ocupado: boolean;
  setOcupado: (v: boolean) => void;
  onCupo: (c: EstadoCupo) => void;
}) {
  const [n, setN] = useState(10);
  const [resultados, setResultados] = useState<ResultadoEvaluacionApu[] | null>(null);
  const [progreso, setProgreso] = useState<{ hechos: number; total: number; costo: number } | null>(null);
  const [nota, setNota] = useState<{ kind: "info" | "error"; texto: string } | null>(null);
  const bloqueo = bloqueadoPor(estado);
  const resolver = useMemo(() => resolverCatalogo(insumoMap, partidaMap), [insumoMap, partidaMap]);
  const cuDe = useMemo(() => {
    const cache = new Map<string, number>();
    return (p: PartidaCatalogo) => {
      let cu = cache.get(p.id);
      if (cu === undefined) cache.set(p.id, (cu = calcularApu(p, resolver).cu));
      return cu;
    };
  }, [resolver]);
  const muestra = useMemo(() => muestraEvaluacion(partidas, cuDe, n), [partidas, cuDe, n]);
  const lotes = Math.ceil(muestra.length / LOTE_APU);
  const estimado = estimarCostoCop(estado.modelo, lotes * (SISTEMA_APU.length + Math.min(insumos.length, MAX_CATALOGO_IA) * 45) + muestra.length * 1500, muestra.length * 1200, estado.cupo.trm);

  async function evaluar() {
    setOcupado(true);
    setNota(null);
    setResultados(null);
    const propuestas = new Map<string, PropuestaApu>();
    let costo = 0;
    let error = "";
    const pedidas: PartidaApuIA[] = muestra.map((p) => ({
      id: p.id,
      item: p.codigo.slice(0, 40),
      descripcion: p.descripcion,
      unidad: p.unidad,
      capitulo: "",
      jornada: p.jornada || JORNADA,
      // Its own analysis (and its copies with the same description) is never shown.
      referencias: buscador.referencias(p, { id: p.id, descripcion: p.descripcion }),
    }));
    for (let k = 0; k < lotes; k++) {
      setProgreso({ hechos: k, total: lotes, costo });
      const lote = pedidas.slice(k * LOTE_APU, (k + 1) * LOTE_APU);
      try {
        const r = await conReintento(() => api.generarApuIA({ contexto: "", partidas: lote, catalogo: catalogoParaApu(insumos, lote, MAX_CATALOGO_IA), evaluar: true }));
        costo += r.costoCop;
        onCupo(r.cupo);
        for (const x of r.propuestas) propuestas.set(x.itemId, x.propuesta);
      } catch (err) {
        error = message(err);
        break;
      }
    }
    setProgreso({ hechos: lotes, total: lotes, costo });
    const evaluadas = error ? muestra.filter((p) => propuestas.has(p.id)) : muestra;
    setResultados(evaluadas.map((p) => resultadoEvaluacion(p, cuDe(p), propuestas.get(p.id) ?? null, (id) => insumoMap.get(id) ?? null)));
    setOcupado(false);
    setNota(error ? { kind: "error", texto: `Se detuvo: ${error}` } : { kind: "info", texto: `Evaluación terminada por ${fmtCop(costo)}.` });
  }

  const resumen = resultados ? resumenEvaluacion(resultados) : null;
  return (
    <details style={{ fontSize: 13.5 }}>
      <summary style={{ cursor: "pointer", fontWeight: 600 }}>Evaluar el asistente con tu catálogo</summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          Pide el análisis de partidas de tu catálogo que ya lo tienen, sin mostrárselo, y compara el costo unitario con los precios del catálogo. Meta: al menos
          la mitad dentro de ±25 % y ningún insumo inventado. No cambia nada. Repítela cuando cambies de modelo para comparar.
        </p>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Partidas
            <select value={n} onChange={(e) => setN(Number(e.target.value))} style={{ padding: "4px 6px" }}>
              {[6, 10, 20, 30].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
          <span style={{ color: "var(--tc-gray-500)" }}>
            {muestra.length} partida(s) aptas de la muestra. Costo estimado: {fmtCop(estimado)}.
          </span>
          <button type="button" style={{ ...botonSec, marginLeft: "auto", ...(bloqueo || ocupado || !muestra.length ? apagado : {}) }} disabled={!!bloqueo || ocupado || !muestra.length} onClick={evaluar}>
            Evaluar {muestra.length} partida(s)
          </button>
        </div>
        {!muestra.length && <Notice kind="info">Tu catálogo no tiene partidas con al menos dos insumos y costo unitario para evaluar.</Notice>}
        {progreso && ocupado && <Progreso hechos={progreso.hechos} total={progreso.total} texto={`Lote ${Math.min(progreso.hechos + 1, progreso.total)} de ${progreso.total}... ${fmtCop(progreso.costo)}`} />}
        {nota && <Notice kind={nota.kind}>{nota.texto}</Notice>}
        {resumen && resultados && (
          <>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              <Meta ok={resumen.pctDentro >= 0.5} texto={`${Math.round(resumen.pctDentro * 100)} % con CU dentro de ±25 % (meta: 50 %)`} />
              <Meta ok={resumen.nuevos === 0} texto={`${resumen.nuevos} insumo(s) inventados (meta: 0)`} />
              <Meta ok={resumen.sinRespuesta === 0} texto={`${resumen.sinRespuesta} sin análisis (meta: 0)`} />
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>Partida del catálogo</th>
                  <th style={{ ...th, width: 60 }}>Unidad</th>
                  <th style={{ ...th, width: 110 }}>CU catálogo</th>
                  <th style={{ ...th, width: 110 }}>CU IA</th>
                  <th style={{ ...th, width: 90 }}>Diferencia</th>
                  <th style={{ ...th, width: 80 }}>Nuevos</th>
                </tr>
              </thead>
              <tbody>
                {resultados.map((r) => {
                  const dentro = r.diferencia !== null && Math.abs(r.diferencia) <= 0.25;
                  return (
                    <tr key={r.id}>
                      <td style={td}>{r.descripcion}</td>
                      <td style={{ ...td, textAlign: "center" }}>{r.unidad}</td>
                      <td style={tdNum}>{fmt(r.cuReal)}</td>
                      <td style={tdNum}>{r.cuIa === null ? "sin respuesta" : fmt(r.cuIa)}</td>
                      <td style={{ ...tdNum, color: dentro ? "#1e6b2e" : "#8a1c14" }}>{r.diferencia === null ? "" : `${r.diferencia > 0 ? "+" : ""}${Math.round(r.diferencia * 100)} %`}</td>
                      <td style={tdNum}>{r.nuevos || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>
    </details>
  );
}

function Meta({ ok, texto }: { ok: boolean; texto: string }) {
  return (
    <span style={{ ...chip, fontSize: 13, padding: "4px 10px", color: ok ? "#1e6b2e" : "#8a1c14", background: ok ? "#e3f4e6" : "#fdecea" }}>
      {ok ? "✓" : "✕"} {texto}
    </span>
  );
}

const chip: CSSProperties = { display: "inline-block", borderRadius: 10, padding: "2px 8px", fontSize: 12, fontWeight: 600 };
const tdNum: CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
