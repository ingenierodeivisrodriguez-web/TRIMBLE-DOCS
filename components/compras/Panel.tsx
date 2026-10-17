"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { tiene } from "../../lib/compras/accesos";
import type { ComprasApi } from "../../lib/compras/client";
import { numeroCotizacion } from "../../lib/compras/cotizaciones";
import { ESTADOS_DOCUMENTO, MODULO_DE } from "../../lib/compras/documentos";
import { descargarPanel } from "../../lib/compras/excelPanel";
import { fecha } from "../../lib/compras/formato";
import { ESTADOS_ORDEN, numeroOrden } from "../../lib/compras/ordenes";
import { ESTADOS_RECEPCION, numeroRecepcion } from "../../lib/compras/recepciones";
import { ESTADOS_REQUISICION, numeroRequisicion } from "../../lib/compras/requisiciones";
import { abrirEnPestana } from "../../lib/compras/subida";
import type { DocumentoRuta, FilaPanel, Indicador, PanelResponse, Permiso, RutaRequisicion } from "../../lib/compras/types";
import { coincide, fmt } from "../../lib/presupuesto/format";
import { baseInput, C, message, Modal, Notice } from "../presupuesto/ui";
import { botonSecundario, etiqueta, linkBtn, td, th } from "./estilos";

/** The panel: figures, each resource's state (planned to received) and its path through Compras. */
export default function Panel({ api, permisos, proyecto, onSinAcceso }: { api: ComprasApi; permisos: Permiso[]; proyecto: string; onSinAcceso: (err: unknown) => void }) {
  const [datos, setDatos] = useState<PanelResponse | null>(null);
  const [error, setError] = useState("");
  const [buscar, setBuscar] = useState("");
  const [conMovimiento, setConMovimiento] = useState(false);
  const [ruta, setRuta] = useState<FilaPanel | null>(null);
  const [exportando, setExportando] = useState(false);

  const cargar = useCallback(async () => {
    setError("");
    try {
      setDatos(await api.getPanel());
    } catch (err) {
      setError(message(err));
      onSinAcceso(err);
    }
  }, [api, onSinAcceso]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const filas = useMemo(
    () => (datos?.filas ?? []).filter((f) => (!conMovimiento || f.solicitado > 0 || f.comprometido > 0) && coincide(`${f.codigo} ${f.descripcion}`, buscar)),
    [datos, buscar, conMovimiento]
  );

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!datos) return <p style={{ color: "var(--tc-gray-500)" }}>Cargando el panel…</p>;

  async function exportar() {
    setExportando(true);
    try {
      await descargarPanel(datos!, proyecto);
    } catch (err) {
      setError(message(err));
    } finally {
      setExportando(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>
          Corte del {fecha(datos.hoy)}
          {datos.presupuesto ? ` · presupuesto versión ${datos.presupuesto.version}` : " · el proyecto no tiene presupuesto guardado"}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={cargar} style={botonSecundario}>
          Actualizar
        </button>
        <button type="button" onClick={exportar} disabled={exportando} style={botonSecundario} title="Indicadores, insumos y la ruta de cada insumo, en un libro de Excel">
          {exportando ? "Preparando…" : "Exportar a Excel"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10 }}>
        {datos.indicadores.map((i) => (
          <Tarjeta key={i.clave} i={i} />
        ))}
      </div>

      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Insumos: de lo planificado a lo recibido</span>
          <input type="search" placeholder="Buscar insumo" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ ...baseInput, width: 240 }} aria-label="Buscar insumo" />
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={conMovimiento} onChange={(e) => setConMovimiento(e.target.checked)} /> Solo los que tienen movimiento
          </label>
          <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>
            {filas.length} de {datos.filas.length}
          </span>
        </div>
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 330px)" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Insumo</th>
                <th style={th}>Und</th>
                <th style={th} title="Recibido (verde), comprometido por recibir (azul) y aprobado sin ordenar (amarillo), sobre lo planificado">
                  Avance
                </th>
                <th style={thNum}>Planificado</th>
                <th style={thNum}>Solicitado</th>
                <th style={thNum}>Aprobado</th>
                <th style={thNum}>Comprometido</th>
                <th style={thNum}>Recibido</th>
                <th style={thNum} title="Planificado menos solicitado">
                  Por solicitar
                </th>
                <th style={thNum} title="Comprometido menos recibido">
                  Por recibir
                </th>
                <th style={thNum} title="Valor de las órdenes emitidas (sin IVA) frente a las mismas cantidades al precio del presupuesto">
                  Comprado vs. presupuesto
                </th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const tieneRuta = (datos.rutas[f.id] ?? []).length > 0;
                const dif = f.valorComprometido === null || !f.valorPresupuestoComprometido ? null : ((f.valorComprometido - f.valorPresupuestoComprometido) / f.valorPresupuestoComprometido) * 100;
                return (
                  <tr key={f.id}>
                    <td style={td}>
                      {tieneRuta ? (
                        <button type="button" onClick={() => setRuta(f)} style={{ ...linkBtn, textAlign: "left" }} title="Ver la ruta de este insumo">
                          {f.codigo} {f.descripcion}
                        </button>
                      ) : (
                        `${f.codigo} ${f.descripcion}`
                      )}
                    </td>
                    <td style={td}>{f.unidad}</td>
                    <td style={{ ...td, minWidth: 110 }}>
                      <Barra f={f} />
                    </td>
                    <td style={num}>{fmt(f.planificado, 4)}</td>
                    <td style={num}>{cero(f.solicitado)}</td>
                    <td style={num}>{cero(f.aprobado)}</td>
                    <td style={num}>{cero(f.comprometido)}</td>
                    <td style={num}>{cero(f.recibido)}</td>
                    <td style={{ ...num, color: f.porSolicitar < 0 ? "#b3261e" : undefined }}>{fmt(f.porSolicitar, 4)}</td>
                    <td style={num}>{cero(f.porRecibir)}</td>
                    <td style={{ ...num, color: dif !== null && dif > 0 ? "#b3261e" : dif !== null && dif < 0 ? "#2e6b22" : undefined }}>
                      {dif === null ? "—" : `${dif > 0 ? "+" : ""}${fmt(dif)} %`}
                    </td>
                  </tr>
                );
              })}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ ...td, color: "var(--tc-gray-500)" }}>
                    {datos.filas.length ? "Ningún insumo coincide." : "El presupuesto no tiene insumos que se compren."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {!datos.ve.requisiciones && <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: 0 }}>Tu rol no ve requisiciones, así que la ruta de cada insumo no se muestra.</p>}

      {ruta && <RutaDialog api={api} fila={ruta} rutas={datos.rutas[ruta.id] ?? []} ve={datos.ve} permisos={permisos} onClose={() => setRuta(null)} />}
    </div>
  );
}

const cero = (n: number) => (n ? fmt(n, 4) : "—");

function Tarjeta({ i }: { i: Indicador }) {
  const texto =
    i.valor === null ? "Sin datos suficientes" : i.unidad === "pct" ? `${fmt(i.valor)} %` : i.unidad === "pesos" ? `$ ${fmt(i.valor)}` : i.unidad === "dias" ? `${fmt(i.valor, 1)} días` : fmt(i.valor, 0);
  return (
    <div style={{ background: "#fff", border: `1px solid ${i.alerta ? "#e0a100" : C.border}`, borderLeft: `4px solid ${i.alerta ? "#e0a100" : C.header}`, borderRadius: 6, padding: "10px 12px" }} title={i.ayuda}>
      <div style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>{i.nombre}</div>
      <div style={{ fontSize: i.valor === null ? 14 : 22, fontWeight: 600, color: i.valor === null ? "var(--tc-gray-500)" : "var(--tc-blue-800)", marginTop: 4 }}>{texto}</div>
      <div style={{ fontSize: 11.5, color: "var(--tc-gray-500)", marginTop: 4 }}>{i.ayuda}</div>
    </div>
  );
}

/** Planned as 100 %: received, committed still to receive, approved not yet ordered. */
function Barra({ f }: { f: FilaPanel }) {
  if (!(f.planificado > 0)) return null;
  const tope = Math.max(f.planificado, f.aprobado, f.comprometido);
  const w = (x: number) => `${Math.max(0, Math.min(100, (x / tope) * 100))}%`;
  const recibido = f.recibido;
  const enCamino = Math.max(0, f.comprometido - f.recibido);
  const sinOrdenar = Math.max(0, f.aprobado - f.comprometido);
  return (
    <div
      style={{ display: "flex", height: 8, background: "#eef1f4", borderRadius: 4, overflow: "hidden" }}
      title={`Recibido ${fmt(recibido, 4)} · por recibir ${fmt(enCamino, 4)} · aprobado sin ordenar ${fmt(sinOrdenar, 4)} · planificado ${fmt(f.planificado, 4)}`}
    >
      <div style={{ width: w(recibido), background: "#3f8f3a" }} />
      <div style={{ width: w(enCamino), background: "#2f55b0" }} />
      <div style={{ width: w(sinOrdenar), background: "#e0a100" }} />
    </div>
  );
}

/** The path of one resource: each requisition line with its quotations, orders, receptions and documents. */
function RutaDialog({
  api,
  fila: f,
  rutas,
  ve,
  permisos,
  onClose,
}: {
  api: ComprasApi;
  fila: FilaPanel;
  rutas: RutaRequisicion[];
  ve: PanelResponse["ve"];
  permisos: Permiso[];
  onClose: () => void;
}) {
  const [error, setError] = useState("");
  const Docs = ({ d }: { d: DocumentoRuta[] }) =>
    d.length ? (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
        {d.map((x) => {
          const e = ESTADOS_DOCUMENTO[x.estado];
          const abre = x.estado === "respaldado" && tiene(permisos, MODULO_DE[x.entidadTipo], "documentos");
          return (
            <span key={x.id} style={{ ...etiqueta(e.color, e.fondo), display: "inline-flex", gap: 6 }} title={`${x.nombreArchivo} · ${e.texto}`}>
              📄 {x.titulo}
              {abre && (
                <button type="button" onClick={() => abrirEnPestana(api, x.id).catch((err) => setError(message(err)))} style={{ ...linkBtn, fontSize: 12 }}>
                  Abrir
                </button>
              )}
            </span>
          );
        })}
      </div>
    ) : null;

  return (
    <Modal title={`Ruta de ${f.codigo} ${f.descripcion}`} width={980} height="88vh" onClose={onClose}>
      <div style={{ padding: 14, display: "grid", gap: 12 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--tc-gray-500)" }}>
          Planificado {fmt(f.planificado, 4)} {f.unidad} · solicitado {fmt(f.solicitado, 4)} · comprometido {fmt(f.comprometido, 4)} · recibido {fmt(f.recibido, 4)}. Presupuesto → requisición → cotización → orden o contrato → recepción.
        </p>
        {error && <Notice kind="error">{error}</Notice>}
        {rutas.map((r) => {
          const er = ESTADOS_REQUISICION[r.requisicion.estado];
          return (
            <div key={r.requisicionLineaId} style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: 10 }}>
              <Etapa nombre="Requisición">
                <strong>{numeroRequisicion(r.requisicion.numero)}</strong> <span style={etiqueta(er.color, er.fondo)}>{er.texto}</span> · {fecha(r.requisicion.creada.slice(0, 10))} · pidió {r.requisicion.solicitante} · cantidad{" "}
                {fmt(r.requisicion.cantidad, 4)}
                {r.requisicion.aprobada !== null ? ` · aprobada ${fmt(r.requisicion.aprobada, 4)}` : ""}
                <Docs d={r.documentos} />
              </Etapa>
              {r.cotizaciones === null ? (
                <Etapa nombre="Cotizaciones">
                  <span style={{ color: "var(--tc-gray-500)" }}>Tu rol no ve cotizaciones.</span>
                </Etapa>
              ) : (
                r.cotizaciones.length > 0 && (
                  <Etapa nombre="Cotizaciones">
                    {r.cotizaciones.map((c) => (
                      <div key={c.id} style={{ marginBottom: 4 }}>
                        <strong>{numeroCotizacion(c.numero)}</strong> {c.proveedor} · {fmt(c.cantidad, 4)} a $ {fmt(c.precioNeto)} (sin IVA)
                        {c.elegida && <span style={{ ...etiqueta("#2e6b22", "#e3f3de"), marginLeft: 6 }}>Elegida</span>}
                        {c.estado === "anulada" && <span style={{ ...etiqueta("#6b7684", "#eef1f4"), marginLeft: 6 }}>Anulada</span>}
                        <Docs d={c.documentos} />
                      </div>
                    ))}
                  </Etapa>
                )
              )}
              {r.ordenes === null ? (
                <Etapa nombre="Órdenes y contratos">
                  <span style={{ color: "var(--tc-gray-500)" }}>Tu rol no ve órdenes ni contratos.</span>
                </Etapa>
              ) : (
                r.ordenes.map((o) => {
                  const eo = ESTADOS_ORDEN[o.estado];
                  return (
                    <Etapa key={o.id} nombre={o.tipo === "contrato" ? "Contrato" : "Orden de compra"}>
                      <strong>
                        {numeroOrden(o.tipo, o.numero)}
                        {o.revision ? ` rev. ${o.revision}` : ""}
                      </strong>{" "}
                      <span style={etiqueta(eo.color, eo.fondo)}>{eo.texto}</span> · {o.proveedor} · {fmt(o.cantidad, 4)} a $ {fmt(o.precioNeto)} (sin IVA) · entrega {fecha(o.fechaEntrega)}
                      <Docs d={o.documentos} />
                      {o.recepciones === null ? (
                        <div style={{ color: "var(--tc-gray-500)", marginTop: 4 }}>Tu rol no ve recepciones.</div>
                      ) : (
                        o.recepciones.map((x) => {
                          const ex = ESTADOS_RECEPCION[x.estado];
                          return (
                            <div key={x.id} style={{ marginTop: 6, paddingLeft: 14, borderLeft: `3px solid ${C.grid}` }}>
                              <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>Recepción </span>
                              <strong>{numeroRecepcion(x.numero)}</strong> <span style={etiqueta(ex.color, ex.fondo)}>{ex.texto}</span> · {fecha(x.fecha)} · recibido {fmt(x.recibido, 4)}, aceptado {fmt(x.aceptado, 4)}
                              {x.rechazado ? `, rechazado ${fmt(x.rechazado, 4)}` : ""}
                              {x.devuelto ? `, devuelto ${fmt(x.devuelto, 4)}` : ""}
                              <Docs d={x.documentos} />
                            </div>
                          );
                        })
                      )}
                    </Etapa>
                  );
                })
              )}
            </div>
          );
        })}
        {!ve.recepciones && <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: 0 }}>Las etapas que tu rol no ve aparecen ocultas.</p>}
      </div>
    </Modal>
  );
}

function Etapa({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: 10, padding: "6px 0", borderTop: `1px solid ${C.grid}`, fontSize: 13 }}>
      <div style={{ fontWeight: 600, color: "var(--tc-blue-800)" }}>{nombre}</div>
      <div>{children}</div>
    </div>
  );
}

const num: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const thNum: CSSProperties = { ...th, textAlign: "right" };
