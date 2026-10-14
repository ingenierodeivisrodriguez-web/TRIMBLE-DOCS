"use client";

import { CSSProperties, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../lib/propiedades/client";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import { estimarCostoCop, fmtCop } from "../../lib/presupuesto/ia/cupo";
import { pisosDe, SISTEMA_PARTIDAS } from "../../lib/presupuesto/ia/estructura";
import { candidatos, partidasParaInsumos, SISTEMA_INSUMOS } from "../../lib/presupuesto/ia/insumos";
import {
  AgrupacionEdt,
  BorradorEstructuraIA,
  BorradorInsumoIA,
  CapituloIA,
  DetalleEdt,
  EstadoCupo,
  EstadoIAResponse,
  MAX_CATALOGO_IA,
  PropuestaCapitulo,
  PropuestaInsumo,
  ResumenesIA,
} from "../../lib/presupuesto/ia/tipos";
import { Insumo, PartidaCatalogo, PresupuestoDoc, TIPOS_INSUMO, TipoInsumo } from "../../lib/presupuesto/types";
import { acceptButton, baseInput, C, labelStyle, message, Notice, Square } from "./ui";

/** Partidas per call for the resources. */
const LOTE_INSUMOS = 6;

/** Calls the assistant, retrying once after a few seconds when the provider is busy or limited. */
export async function conReintento<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof ApiError) || ![429, 502, 503, 504].includes(err.status) || ["ia-sin-clave", "ia-cupo", "ia-frecuencia"].includes(err.code ?? "")) throw err;
    await new Promise((r) => setTimeout(r, 6000));
    return fn();
  }
}

export function bloqueadoPor(estado: EstadoIAResponse): string {
  if (!estado.disponible) return "El asistente IA no está configurado en el servidor (falta la clave del proveedor en Vercel).";
  if (!estado.puedeUsar) return "Solo los administradores del proyecto y los editores del presupuesto usan el asistente.";
  if (estado.cupo.nivel === "deshabilitada" || estado.cupo.nivel === "agotado") return estado.cupo.mensaje;
  return "";
}

export function Aviso({ estado }: { estado: EstadoIAResponse }) {
  const b = bloqueadoPor(estado);
  if (b) return <Notice kind="error">{b}</Notice>;
  if (estado.cupo.nivel === "aviso") return <Notice kind="warning">{estado.cupo.mensaje}</Notice>;
  return null;
}

export function Progreso({ hechos, total, texto }: { hechos: number; total: number; texto: string }) {
  return (
    <div>
      <div style={{ height: 10, background: "#e6eaf0", borderRadius: 5, overflow: "hidden" }}>
        <div style={{ width: `${(hechos / Math.max(total, 1)) * 100}%`, height: "100%", background: "var(--tc-blue-600)", transition: "width .3s" }} />
      </div>
      <div style={{ fontSize: 12.5, color: "var(--tc-gray-500)", marginTop: 4 }}>{texto}</div>
    </div>
  );
}

// ---------------------------------------------------------------- phase 3: create the EDT

export function CrearEdt({
  api,
  doc,
  spId,
  projectId,
  estado,
  partidasCatalogo,
  insertarCapitulo,
  onCupo,
  onResumen,
}: {
  api: PresupuestoApi;
  doc: PresupuestoDoc;
  spId: string;
  projectId: string;
  estado: EstadoIAResponse;
  partidasCatalogo: PartidaCatalogo[];
  /** Adds a chapter (with its partidas, repeated per floor when it says so) at the end of a subpresupuesto. */
  insertarCapitulo: (spId: string, capitulo: PropuestaCapitulo, pisos: number) => number;
  onCupo: (c: EstadoCupo) => void;
  onResumen: (r: ResumenesIA) => void;
}) {
  const clave = `presupuesto.ia.contexto.${projectId}`;
  const [descripcion, setDescripcion] = useState(() => {
    try {
      return localStorage.getItem(clave) ?? "";
    } catch {
      return "";
    }
  });
  const [agrupacion, setAgrupacion] = useState<AgrupacionEdt>("capitulos");
  const [detalle, setDetalle] = useState<DetalleEdt>("resumido");
  const [pisos, setPisos] = useState(() => pisosDe(descripcion));
  const [destino, setDestino] = useState(spId);
  const [capitulos, setCapitulos] = useState<(CapituloIA & { incluir: boolean })[] | null>(null);
  const [borradores, setBorradores] = useState<BorradorEstructuraIA[] | null>(null);
  const [ediciones, setEdiciones] = useState<Map<string, PropuestaCapitulo>>(new Map());
  const [ocupado, setOcupado] = useState("");
  const [progreso, setProgreso] = useState<{ hechos: number; total: number; costo: number } | null>(null);
  const [nota, setNota] = useState<{ kind: "info" | "warning" | "error"; texto: string } | null>(null);
  const cancelar = useRef(false);
  const bloqueo = bloqueadoPor(estado);
  const pedido = { descripcion: descripcion.trim(), agrupacion, detalle };

  useEffect(() => {
    if (estado.puedeUsar) api.borradoresEstructuraIA().then(setBorradores, (err) => setNota({ kind: "error", texto: message(err) }));
  }, [api, estado.puedeUsar]);

  function guardarDescripcion() {
    try {
      localStorage.setItem(clave, descripcion);
    } catch {
      // storage unavailable
    }
  }

  async function proponerCapitulos() {
    guardarDescripcion();
    setOcupado("Proponiendo los capítulos...");
    setNota(null);
    try {
      const r = await conReintento(() => api.proponerCapitulosIA(pedido));
      setCapitulos(r.capitulos.map((c) => ({ ...c, incluir: true })));
      onCupo(r.cupo);
      setNota({ kind: "info", texto: `${r.capitulos.length} capítulos propuestos por ${fmtCop(r.costoCop)}. Quita o corrige los que quieras y pide sus partidas.` });
    } catch (err) {
      setNota({ kind: "error", texto: message(err) });
    } finally {
      setOcupado("");
    }
  }

  async function proponerPartidas() {
    if (!capitulos) return;
    const elegidos = capitulos.filter((c) => c.incluir && c.titulo.trim());
    cancelar.current = false;
    setOcupado("Proponiendo las partidas...");
    setNota(null);
    let costo = 0;
    let error = "";
    for (let k = 0; k < elegidos.length && !cancelar.current; k++) {
      setProgreso({ hechos: k, total: elegidos.length, costo });
      const cap = elegidos[k];
      const textos = [cap.titulo, cap.alcance, pedido.descripcion];
      const catalogo = candidatos(partidasCatalogo, textos, MAX_CATALOGO_IA).map((p) => ({ id: p.id, descripcion: p.descripcion, unidad: p.unidad }));
      try {
        const r = await conReintento(() =>
          api.proponerPartidasIA({ ...pedido, capitulo: cap, otros: elegidos.filter((c) => c !== cap).map((c) => c.titulo), catalogo })
        );
        costo += r.costoCop;
        onCupo(r.cupo);
        setBorradores((l) => [...(l ?? []).filter((b) => b.itemId !== r.borrador.itemId), r.borrador]);
      } catch (err) {
        error = `${cap.titulo}: ${message(err)}`;
        break;
      }
    }
    setProgreso({ hechos: elegidos.length, total: elegidos.length, costo });
    setOcupado("");
    setNota(
      error
        ? { kind: "error", texto: `Se detuvo en ${error}` }
        : { kind: cancelar.current ? "warning" : "info", texto: `Partidas propuestas por ${fmtCop(costo)}. Revísalas abajo e insértalas en el presupuesto.` }
    );
  }

  const capituloDe = (b: BorradorEstructuraIA) => ediciones.get(b.id) ?? b.propuesta;
  const editar = (b: BorradorEstructuraIA, c: PropuestaCapitulo) => setEdiciones((m) => new Map(m).set(b.id, c));

  async function decidir(lista: BorradorEstructuraIA[], aceptar: boolean) {
    setOcupado(aceptar ? "Insertando..." : "Descartando...");
    setNota(null);
    try {
      let partidas = 0;
      const decisiones = lista.map((b) => {
        const c = capituloDe(b);
        if (aceptar) partidas += insertarCapitulo(destino, c, pisos);
        return aceptar ? { id: b.id, estado: "aceptado" as const, final: c } : { id: b.id, estado: "rechazado" as const };
      });
      const r = await api.decidirBorradoresIA(decisiones);
      onResumen(r.resumen);
      const ids = new Set(lista.map((b) => b.id));
      setBorradores((l) => (l ?? []).filter((b) => !ids.has(b.id)));
      const sp = doc.subpresupuestos.find((s) => s.id === destino)?.nombre ?? "";
      setNota({
        kind: "info",
        texto: aceptar
          ? `${lista.length} capítulo(s) con ${partidas} partida(s) insertados al final de ${sp}. Revisa el presupuesto y guárdalo; los metrados quedan en 0.`
          : `${lista.length} capítulo(s) descartados.`,
      });
    } catch (err) {
      setNota({ kind: "error", texto: message(err) });
    } finally {
      setOcupado("");
    }
  }

  const estimado = estimarCostoCop(estado.modelo, (capitulos?.filter((c) => c.incluir).length ?? 12) * (SISTEMA_PARTIDAS.length + Math.min(partidasCatalogo.length, MAX_CATALOGO_IA) * 45 + 600), (capitulos?.filter((c) => c.incluir).length ?? 12) * 900, estado.cupo.trm);

  return (
    <>
      <Aviso estado={estado} />
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
        Describe el proyecto y el asistente arma la EDT: primero los <strong>capítulos</strong> (los revisas) y luego las <strong>partidas</strong> de cada uno.
        Usa las partidas de tu catálogo ({partidasCatalogo.length}) cuando sirven, así llegan con su análisis de precios; las demás quedan como partidas
        nuevas, y su análisis se arma en la pestaña <strong>Análisis (APU)</strong>. No pone precios ni metrados.
      </p>
      <label>
        <span style={labelStyle}>Descripción del proyecto</span>
        <textarea
          value={descripcion}
          maxLength={2000}
          onChange={(e) => {
            setDescripcion(e.target.value);
            setPisos(pisosDe(e.target.value));
          }}
          placeholder="Ej.: Edificio de vivienda estrato 6 en Bogotá, 15 pisos, 4 apartamentos por piso, 2 pisos de comercio, 2 sótanos de parqueadero, cuartos técnicos y depósitos."
          style={{ ...baseInput, width: "100%", minHeight: 70, resize: "vertical" }}
        />
      </label>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13.5, alignItems: "flex-start" }}>
        <div role="radiogroup" aria-label="Agrupación">
          <span style={labelStyle}>Agrupar</span>
          <label style={{ display: "block" }}>
            <input type="radio" checked={agrupacion === "capitulos"} onChange={() => setAgrupacion("capitulos")} /> Solo por capítulos
          </label>
          <label style={{ display: "block" }}>
            <input type="radio" checked={agrupacion === "pisos"} onChange={() => setAgrupacion("pisos")} /> Por capítulos y pisos
          </label>
        </div>
        {agrupacion === "pisos" && (
          <label>
            <span style={labelStyle}>Pisos tipo</span>
            <input type="number" min={1} max={200} value={pisos} onChange={(e) => setPisos(Math.max(1, Math.min(200, Number(e.target.value) || 1)))} style={{ ...baseInput, width: 90 }} />
          </label>
        )}
        <div role="radiogroup" aria-label="Detalle">
          <span style={labelStyle}>Detalle</span>
          <label style={{ display: "block" }}>
            <input type="radio" checked={detalle === "resumido"} onChange={() => setDetalle("resumido")} /> Resumido
          </label>
          <label style={{ display: "block" }}>
            <input type="radio" checked={detalle === "detallado"} onChange={() => setDetalle("detallado")} /> Detallado
          </label>
        </div>
        <label>
          <span style={labelStyle}>Insertar en</span>
          <select value={destino} onChange={(e) => setDestino(e.target.value)} style={{ ...baseInput, minWidth: 220 }}>
            {doc.subpresupuestos.map((sp) => (
              <option key={sp.id} value={sp.id}>
                {sp.nombre}
              </option>
            ))}
          </select>
        </label>
        <button type="button" style={{ ...acceptButton, marginLeft: "auto", alignSelf: "center", ...(bloqueo || pedido.descripcion.length < 15 || ocupado ? apagado : {}) }} disabled={!!bloqueo || pedido.descripcion.length < 15 || !!ocupado} onClick={proponerCapitulos}>
          1. Proponer capítulos
        </button>
      </div>

      {capitulos && (
        <Seccion titulo={`Capítulos (${capitulos.filter((c) => c.incluir).length} de ${capitulos.length})`}>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 2fr auto", gap: "6px 10px", alignItems: "center", fontSize: 13 }}>
            {capitulos.map((c, i) => (
              <Fila key={i}>
                <input type="checkbox" aria-label={`Incluir ${c.titulo}`} checked={c.incluir} onChange={(e) => setCapitulos((l) => l!.map((x, k) => (k === i ? { ...x, incluir: e.target.checked } : x)))} />
                <input value={c.titulo} aria-label={`Título del capítulo ${i + 1}`} onChange={(e) => setCapitulos((l) => l!.map((x, k) => (k === i ? { ...x, titulo: e.target.value.toUpperCase() } : x)))} style={{ ...baseInput, fontWeight: 600 }} />
                <span style={{ color: "var(--tc-gray-500)" }}>{c.alcance}</span>
                {agrupacion === "pisos" ? (
                  <label style={{ whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={c.porPiso} onChange={(e) => setCapitulos((l) => l!.map((x, k) => (k === i ? { ...x, porPiso: e.target.checked } : x)))} /> por piso
                  </label>
                ) : (
                  <span />
                )}
              </Fila>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10, flexWrap: "wrap", fontSize: 13.5 }}>
            <span style={{ color: "var(--tc-gray-500)" }}>Costo estimado de las partidas: {fmtCop(estimado)} (puede variar).</span>
            {ocupado && progreso ? (
              <button type="button" style={{ ...botonSec, marginLeft: "auto" }} onClick={() => (cancelar.current = true)}>
                Cancelar después de este capítulo
              </button>
            ) : (
              <button type="button" style={{ ...acceptButton, marginLeft: "auto", ...(bloqueo || ocupado ? apagado : {}) }} disabled={!!bloqueo || !!ocupado} onClick={proponerPartidas}>
                2. Proponer las partidas
              </button>
            )}
          </div>
        </Seccion>
      )}
      {progreso && <Progreso hechos={progreso.hechos} total={progreso.total} texto={`${ocupado ? `Capítulo ${Math.min(progreso.hechos + 1, progreso.total)} de ${progreso.total}...` : "Terminado."} ${fmtCop(progreso.costo)}`} />}
      {ocupado && !progreso && <span style={{ fontSize: 13, color: "var(--tc-blue-700)" }}>{ocupado}</span>}
      {nota && <Notice kind={nota.kind}>{nota.texto}</Notice>}

      {borradores && borradores.length > 0 && (
        <Seccion titulo={`Capítulos propuestos por revisar (${borradores.length})`}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap", fontSize: 13 }}>
            <button type="button" style={{ ...acceptButton, padding: "6px 14px", fontSize: 14, ...(ocupado ? apagado : {}) }} disabled={!!ocupado} onClick={() => decidir(borradores, true)}>
              Insertar todos en el presupuesto
            </button>
            <span style={{ color: "var(--tc-gray-500)" }}>
              Se agregan al final del subpresupuesto elegido{agrupacion === "pisos" ? `; los capítulos «por piso» se repiten en ${pisos} piso(s)` : ""}.
            </span>
          </div>
          {borradores.map((b) => {
            const c = capituloDe(b);
            return (
              <div key={b.id} style={{ border: `1px solid ${C.border}`, borderRadius: 4, marginBottom: 10 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "6px 10px", background: "#eef2f7", flexWrap: "wrap" }}>
                  <span style={iaChip}>IA</span>
                  <input value={c.titulo} aria-label="Título del capítulo" onChange={(e) => editar(b, { ...c, titulo: e.target.value.toUpperCase() })} style={{ ...baseInput, fontWeight: 700, minWidth: 260 }} />
                  {c.porPiso && <span style={{ fontSize: 12, color: "var(--tc-blue-800)" }}>se repite por piso</span>}
                  <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>
                    {c.partidas.length} partidas · {c.partidas.filter((p) => p.catalogoId).length} del catálogo
                  </span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <button type="button" style={{ ...botonSec, color: "#1e6b2e" }} disabled={!!ocupado || !c.partidas.length} onClick={() => decidir([b], true)}>
                      ✓ Insertar
                    </button>
                    <button type="button" style={{ ...botonSec, color: "#8a1c14" }} disabled={!!ocupado} onClick={() => decidir([b], false)}>
                      ✕ Descartar
                    </button>
                  </span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <tbody>
                    {c.partidas.map((p, i) => (
                      <tr key={i}>
                        <td style={{ ...td, width: 30, textAlign: "center" }}>
                          <button type="button" title="Quitar esta partida" aria-label={`Quitar ${p.descripcion}`} onClick={() => editar(b, { ...c, partidas: c.partidas.filter((_, k) => k !== i) })} style={quitar}>
                            ✕
                          </button>
                        </td>
                        <td style={td}>
                          {p.catalogoId ? (
                            p.descripcion
                          ) : (
                            <input value={p.descripcion} aria-label="Descripción" onChange={(e) => editar(b, { ...c, partidas: c.partidas.map((x, k) => (k === i ? { ...x, descripcion: e.target.value } : x)) })} style={{ ...baseInput, width: "100%" }} />
                          )}
                        </td>
                        <td style={{ ...td, width: 90 }}>
                          {p.catalogoId ? (
                            p.unidad
                          ) : (
                            <input value={p.unidad} aria-label="Unidad" onChange={(e) => editar(b, { ...c, partidas: c.partidas.map((x, k) => (k === i ? { ...x, unidad: e.target.value.toUpperCase() } : x)) })} style={{ ...baseInput, width: "100%" }} />
                          )}
                        </td>
                        <td style={{ ...td, width: 170, fontSize: 12, color: p.catalogoId ? "#1e6b2e" : "#7a5300" }}>{p.catalogoId ? "Del catálogo (con análisis)" : "Nueva: sin análisis de precios"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </Seccion>
      )}
    </>
  );
}

// ---------------------------------------------------------------- phase 2: resources

export function InsumosIA({
  api,
  doc,
  spId,
  projectId,
  estado,
  insumosCatalogo,
  puedeCatalogo,
  crearInsumos,
  onCupo,
  onResumen,
}: {
  api: PresupuestoApi;
  doc: PresupuestoDoc;
  spId: string;
  projectId: string;
  estado: EstadoIAResponse;
  insumosCatalogo: Insumo[];
  /** The person can add to the catalog. */
  puedeCatalogo: boolean;
  /** Creates the resources in the catalog (without a price). */
  crearInsumos: (lista: Pick<PropuestaInsumo, "descripcion" | "unidad" | "tipo">[]) => Promise<Insumo[]>;
  onCupo: (c: EstadoCupo) => void;
  onResumen: (r: ResumenesIA) => void;
}) {
  const clave = `presupuesto.ia.contexto.${projectId}`;
  const [contexto] = useState(() => {
    try {
      return localStorage.getItem(clave) ?? "";
    } catch {
      return "";
    }
  });
  const [todo, setTodo] = useState(false);
  const [soloSinAnalisis, setSoloSinAnalisis] = useState(true);
  const [borradores, setBorradores] = useState<BorradorInsumoIA[] | null>(null);
  const [ediciones, setEdiciones] = useState<Map<string, PropuestaInsumo>>(new Map());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [delCatalogo, setDelCatalogo] = useState<Map<string, { descripcion: string; partidas: Set<string> }>>(new Map());
  const [progreso, setProgreso] = useState<{ hechos: number; total: number; costo: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [nota, setNota] = useState<{ kind: "info" | "warning" | "error"; texto: string } | null>(null);
  const cancelar = useRef(false);
  const bloqueo = bloqueadoPor(estado);
  const partidas = useMemo(() => partidasParaInsumos(doc, todo ? null : spId, soloSinAnalisis), [doc, todo, spId, soloSinAnalisis]);
  const lotes = Math.ceil(partidas.length / LOTE_INSUMOS);
  const estimado = estimarCostoCop(estado.modelo, lotes * (SISTEMA_INSUMOS.length + Math.min(insumosCatalogo.length, MAX_CATALOGO_IA) * 40) + partidas.length * 200, partidas.length * 400, estado.cupo.trm);

  useEffect(() => {
    if (estado.puedeUsar) api.borradoresInsumosIA().then(setBorradores, (err) => setNota({ kind: "error", texto: message(err) }));
  }, [api, estado.puedeUsar]);

  async function generar() {
    cancelar.current = false;
    setOcupado(true);
    setNota(null);
    let costo = 0;
    let error = "";
    const acumulado = new Map(delCatalogo);
    for (let k = 0; k < lotes && !cancelar.current; k++) {
      setProgreso({ hechos: k, total: lotes, costo });
      const lote = partidas.slice(k * LOTE_INSUMOS, (k + 1) * LOTE_INSUMOS);
      const catalogo = candidatos(insumosCatalogo, lote.map((p) => `${p.descripcion} ${p.capitulo}`), MAX_CATALOGO_IA).map((i) => ({ id: i.id, descripcion: i.descripcion, unidad: i.unidad, tipo: i.tipo }));
      try {
        const r = await conReintento(() => api.generarInsumosIA(contexto, lote, catalogo));
        costo += r.costoCop;
        onCupo(r.cupo);
        setBorradores((l) => {
          const nuevos = new Set(r.borradores.map((b) => b.itemId));
          return [...(l ?? []).filter((b) => !nuevos.has(b.itemId)), ...r.borradores];
        });
        for (const d of r.delCatalogo) {
          const a = acumulado.get(d.id) ?? { descripcion: d.descripcion, partidas: new Set<string>() };
          d.partidas.forEach((p) => a.partidas.add(p));
          acumulado.set(d.id, a);
        }
        setDelCatalogo(new Map(acumulado));
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
    setNota(error ? { kind: "error", texto: `Se detuvo: ${error}` } : { kind: cancelar.current ? "warning" : "info", texto: `Listo por ${fmtCop(costo)}. Revisa abajo los insumos que faltan en el catálogo.` });
  }

  const propuestaDe = (b: BorradorInsumoIA) => ediciones.get(b.id) ?? b.propuesta;
  const editar = (b: BorradorInsumoIA, p: PropuestaInsumo) => setEdiciones((m) => new Map(m).set(b.id, p));

  async function decidir(lista: BorradorInsumoIA[], aceptar: boolean) {
    if (!lista.length) return;
    setOcupado(true);
    setNota(null);
    try {
      if (aceptar) await crearInsumos(lista.map(propuestaDe));
      const r = await api.decidirBorradoresIA(lista.map((b) => (aceptar ? { id: b.id, estado: "aceptado" as const, final: propuestaDe(b) } : { id: b.id, estado: "rechazado" as const })));
      onResumen(r.resumen);
      const ids = new Set(lista.map((b) => b.id));
      setBorradores((l) => (l ?? []).filter((b) => !ids.has(b.id)));
      setSel(new Set());
      setNota({ kind: "info", texto: aceptar ? `${lista.length} insumo(s) creados en el catálogo sin precio: pónselo en Catálogo de insumos.` : `${lista.length} descartado(s).` });
    } catch (err) {
      setNota({ kind: "error", texto: message(err) });
    } finally {
      setOcupado(false);
    }
  }

  const seleccionados = (borradores ?? []).filter((b) => sel.has(b.id));
  return (
    <>
      <Aviso estado={estado} />
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
        Revisa qué <strong>insumos</strong> (mano de obra, materiales, equipos y subcontratos) necesitan las partidas. Los que ya están en tu catálogo
        ({insumosCatalogo.length}) se señalan; los que faltan se proponen para crearlos <strong>sin precio</strong>: el precio lo pones tú. El análisis de
        cada partida (cuadrillas, rendimientos y cantidades) se arma en la pestaña <strong>Análisis (APU)</strong>.
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
          <strong>{partidas.length}</strong> partida(s) en {lotes} lote(s) de {LOTE_INSUMOS}. Costo estimado: <strong>{fmtCop(estimado)}</strong> (puede variar).
        </span>
        {!ocupado || !progreso ? (
          <button type="button" style={{ ...acceptButton, marginLeft: "auto", ...(bloqueo || !partidas.length || ocupado ? apagado : {}) }} disabled={!!bloqueo || !partidas.length || ocupado} onClick={generar}>
            Revisar insumos
          </button>
        ) : (
          <button type="button" style={{ ...botonSec, marginLeft: "auto" }} onClick={() => (cancelar.current = true)}>
            Cancelar después de este lote
          </button>
        )}
      </div>
      {partidas.length === 0 && <Notice kind="info">No hay partidas {soloSinAnalisis ? "sin análisis de precios " : ""}en {todo ? "el presupuesto" : "este subpresupuesto"}.</Notice>}
      {progreso && <Progreso hechos={progreso.hechos} total={progreso.total} texto={`${ocupado ? `Lote ${Math.min(progreso.hechos + 1, progreso.total)} de ${progreso.total}...` : "Terminado."} ${fmtCop(progreso.costo)}`} />}
      {nota && <Notice kind={nota.kind}>{nota.texto}</Notice>}
      {delCatalogo.size > 0 && (
        <details style={{ fontSize: 13 }}>
          <summary>{delCatalogo.size} insumo(s) del catálogo sirven para estas partidas</summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {[...delCatalogo.values()].map((d) => (
              <li key={d.descripcion}>
                {d.descripcion} <span style={{ color: "var(--tc-gray-500)" }}>({[...d.partidas].length} partida(s))</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {borradores && borradores.length > 0 && (
        <Seccion titulo={`Insumos que faltan en el catálogo (${borradores.length})`}>
          {!puedeCatalogo && <Notice kind="info">No puedes modificar el catálogo de este proyecto: puedes revisarlos, pero los crea un administrador o editor de la base.</Notice>}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap", fontSize: 13 }}>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={borradores.every((b) => sel.has(b.id))} onChange={(e) => setSel(e.target.checked ? new Set(borradores.map((b) => b.id)) : new Set())} /> Seleccionar todos
            </label>
            <button type="button" style={{ ...acceptButton, padding: "6px 14px", fontSize: 14, ...(!puedeCatalogo || ocupado || !seleccionados.length ? apagado : {}) }} disabled={!puedeCatalogo || ocupado || !seleccionados.length} onClick={() => decidir(seleccionados, true)}>
              Crear en el catálogo ({seleccionados.length})
            </button>
            <button type="button" style={{ ...botonSec, color: "#8a1c14" }} disabled={ocupado || !seleccionados.length} onClick={() => decidir(seleccionados, false)}>
              Descartar seleccionados
            </button>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 30 }} />
                <th style={{ ...th, width: 90 }}>Tipo</th>
                <th style={th}>Insumo</th>
                <th style={{ ...th, width: 90 }}>Unidad</th>
                <th style={th}>Lo usan</th>
              </tr>
            </thead>
            <tbody>
              {borradores.map((b) => {
                const p = propuestaDe(b);
                return (
                  <tr key={b.id} style={{ verticalAlign: "top", background: sel.has(b.id) ? "#f0f5fd" : undefined }}>
                    <td style={td}>
                      <input
                        type="checkbox"
                        aria-label={`Seleccionar ${p.descripcion}`}
                        checked={sel.has(b.id)}
                        onChange={(e) =>
                          setSel((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(b.id);
                            else n.delete(b.id);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td style={td}>
                      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <Square rubro={p.tipo} />
                        <select value={p.tipo} aria-label="Tipo" onChange={(e) => editar(b, { ...p, tipo: e.target.value as TipoInsumo })} style={{ ...baseInput, padding: "3px 4px" }}>
                          {TIPOS_INSUMO.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </span>
                    </td>
                    <td style={td}>
                      <input value={p.descripcion} aria-label="Descripción del insumo" onChange={(e) => editar(b, { ...p, descripcion: e.target.value.toUpperCase() })} style={{ ...baseInput, width: "100%" }} />
                    </td>
                    <td style={td}>
                      <input value={p.unidad} aria-label="Unidad del insumo" onChange={(e) => editar(b, { ...p, unidad: e.target.value.toUpperCase() })} style={{ ...baseInput, width: "100%" }} />
                    </td>
                    <td style={{ ...td, fontSize: 12, color: "var(--tc-gray-500)" }}>{p.usadoEn.join(" · ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Seccion>
      )}
    </>
  );
}

// ---------------------------------------------------------------- small pieces

function Fila({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: "8px 12px 12px", margin: 0, background: "#fff" }}>
      <legend style={{ fontSize: 13.5, fontWeight: 600, padding: "0 6px" }}>{titulo}</legend>
      {children}
    </fieldset>
  );
}

export const th: CSSProperties = { padding: "6px 8px", fontWeight: 600, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.grid}`, textAlign: "center", background: "#f3f4f6" };
export const td: CSSProperties = { padding: "5px 8px", borderBottom: `1px solid ${C.grid}`, borderRight: `1px solid ${C.grid}` };
export const botonSec: CSSProperties = { border: `1px solid ${C.border}`, background: "#fff", borderRadius: 4, padding: "5px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 13 };
export const quitar: CSSProperties = { border: "none", background: "transparent", color: "#b3261e", cursor: "pointer", fontSize: 13, fontFamily: "inherit" };
export const iaChip: CSSProperties = { display: "inline-block", borderRadius: 10, background: "#ede7f6", color: "#5e35b1", padding: "1px 6px", fontSize: 11, fontWeight: 600 };
export const apagado: CSSProperties = { opacity: 0.45, cursor: "not-allowed" };
