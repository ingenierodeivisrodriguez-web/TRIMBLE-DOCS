"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { ComprasApi } from "../../lib/compras/client";
import { fechaHora } from "../../lib/compras/formato";
import { InsumosResponse, VIA_COMPRA, ViaCompra } from "../../lib/compras/types";
import { coincide, fmt } from "../../lib/presupuesto/format";
import { TIPO_LABELS, TIPOS_INSUMO, TipoInsumo } from "../../lib/presupuesto/types";
import { baseInput, C, message, Notice, Square } from "../presupuesto/ui";
import { botonSecundario, card, etiqueta, linkBtn, select, td, texto, th, titulo } from "./estilos";

/** The resources planned in Presupuesto, read only, with the partidas that use each one. */
export default function Insumos({ api, onSinAcceso }: { api: ComprasApi; onSinAcceso: (err: unknown) => void }) {
  const [datos, setDatos] = useState<InsumosResponse | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [tipo, setTipo] = useState<TipoInsumo | "">("");
  const [via, setVia] = useState<ViaCompra | "">("");
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const cargar = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setDatos(await api.getInsumos());
    } catch (err) {
      setError(message(err));
      onSinAcceso(err);
    } finally {
      setBusy(false);
    }
  }, [api, onSinAcceso]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const visibles = useMemo(
    () =>
      (datos?.insumos ?? []).filter(
        (i) => (!tipo || i.tipo === tipo) && (!via || i.via === via) && coincide(`${i.codigo} ${i.descripcion} ${i.unidad}`, buscar)
      ),
    [datos, tipo, via, buscar]
  );
  const total = visibles.reduce((s, i) => s + i.monto, 0);

  function alternar(id: string) {
    setAbiertos((a) => {
      const n = new Set(a);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!datos) return <p style={{ color: "var(--tc-gray-500)" }}>Leyendo el presupuesto…</p>;
  if (!datos.presupuesto) {
    return (
      <div style={card}>
        <h2 style={titulo}>Este proyecto no tiene presupuesto guardado</h2>
        <p style={{ ...texto, marginBottom: 0 }}>Los insumos salen de la extensión Presupuesto: cuando se guarde el presupuesto del proyecto, aparecerán aquí.</p>
      </div>
    );
  }

  const p = datos.presupuesto;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ ...texto, margin: 0, fontSize: 13 }}>
        Presupuesto guardado el {fechaHora(p.actualizado ?? "")}
        {p.actualizadoPor ? ` por ${p.actualizadoPor}` : ""} (versión {p.version}). Las cantidades son las de la Lista de insumos de Presupuesto, con
        todos sus subpresupuestos y el metrado del modelo cuando la partida lo toma de ahí. Aquí solo se consultan: se cambian en Presupuesto.
      </p>
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
          <input type="search" placeholder="Buscar por código o descripción" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ ...baseInput, width: 260 }} aria-label="Buscar insumo" />
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoInsumo | "")} style={select} aria-label="Tipo de insumo">
            <option value="">Todos los tipos</option>
            {TIPOS_INSUMO.map((t) => (
              <option key={t} value={t}>
                {TIPO_LABELS[t]}
              </option>
            ))}
          </select>
          <select value={via} onChange={(e) => setVia(e.target.value as ViaCompra | "")} style={select} aria-label="Se compra por">
            <option value="">Orden de compra y contrato</option>
            <option value="orden">{VIA_COMPRA.orden}</option>
            <option value="contrato">{VIA_COMPRA.contrato}</option>
          </select>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>
            {visibles.length} de {datos.insumos.length} insumos · <strong style={{ color: "var(--tc-gray-700)" }}>{fmt(total)}</strong>
          </span>
          <button type="button" onClick={cargar} disabled={busy} style={{ ...botonSecundario, padding: "5px 12px", fontSize: 13.5 }} title="Vuelve a leer el presupuesto">
            {busy ? "Leyendo…" : "Actualizar"}
          </button>
        </div>
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 260px)" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Código</th>
                <th style={th}>Descripción</th>
                <th style={th}>Und</th>
                <th style={th}>Tipo</th>
                <th style={th}>Se compra por</th>
                <th style={{ ...th, textAlign: "right" }} title="Cantidad planificada en el presupuesto">
                  Planificado
                </th>
                <th style={{ ...th, textAlign: "right" }} title="En requisiciones enviadas o aprobadas (lo aprobado, una vez aprobadas)">
                  Solicitado
                </th>
                <th style={{ ...th, textAlign: "right" }}>Aprobado</th>
                <th style={{ ...th, textAlign: "right" }} title="Planificado menos solicitado">
                  Por solicitar
                </th>
                <th style={{ ...th, textAlign: "right" }}>Precio</th>
                <th style={{ ...th, textAlign: "right" }}>Monto planificado</th>
                <th style={th}>Partidas</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((i) => {
                const abierto = abiertos.has(i.id);
                return (
                  <Fragment key={i.id}>
                    <tr style={{ background: abierto ? C.rowSelected : undefined }}>
                      <td style={{ ...td, whiteSpace: "nowrap", color: "var(--tc-gray-500)" }}>{i.codigo}</td>
                      <td style={td}>{i.descripcion}</td>
                      <td style={td}>{i.unidad}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        <Square rubro={i.tipo} /> {i.tipo}
                      </td>
                      <td style={td}>
                        <span style={etiqueta(i.via === "orden" ? "#0b5fa5" : "#7d2a8c", i.via === "orden" ? "#eaf4fc" : "#f3e6f5")}>{VIA_COMPRA[i.via]}</span>
                      </td>
                      <td style={num}>{fmt(i.cantidad, 4)}</td>
                      <td style={num}>{i.solicitado ? fmt(i.solicitado, 4) : "—"}</td>
                      <td style={num}>{i.aprobado ? fmt(i.aprobado, 4) : "—"}</td>
                      <td style={{ ...num, color: i.cantidad - i.solicitado < 0 ? "#b3261e" : undefined, fontWeight: i.cantidad - i.solicitado < 0 ? 600 : undefined }}>
                        {fmt(i.cantidad - i.solicitado, 4)}
                      </td>
                      <td style={num}>{fmt(i.precio)}</td>
                      <td style={num}>{fmt(i.monto)}</td>
                      <td style={td}>
                        <button type="button" onClick={() => alternar(i.id)} style={linkBtn} aria-expanded={abierto}>
                          {i.usos.length} {abierto ? "▲" : "▼"}
                        </button>
                      </td>
                    </tr>
                    {abierto && (
                      <tr>
                        <td colSpan={12} style={{ ...td, background: "#f7f9fc", padding: "6px 12px 10px 40px" }}>
                          <table style={{ borderCollapse: "collapse", width: "100%" }}>
                            <thead>
                              <tr>
                                <th style={sub}>Subpresupuesto</th>
                                <th style={sub}>Ítem</th>
                                <th style={sub}>Partida</th>
                                <th style={{ ...sub, textAlign: "right" }}>Metrado</th>
                                <th style={{ ...sub, textAlign: "right" }}>{`Cantidad (${i.unidad})`}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {i.usos.map((u) => (
                                <tr key={`${u.itemId}`}>
                                  <td style={subTd}>{u.subpresupuesto}</td>
                                  <td style={subTd}>{u.numero}</td>
                                  <td style={subTd}>{u.descripcion}</td>
                                  <td style={{ ...subTd, textAlign: "right", whiteSpace: "nowrap" }} title={u.desdeModelo ? "Metrado tomado de los elementos del modelo" : "Metrado escrito"}>
                                    {fmt(u.metrado)} {u.unidad}
                                    {u.desdeModelo && <span style={{ ...etiqueta("#2e6b22", "#e3f3de"), marginLeft: 6 }}>3D</span>}
                                  </td>
                                  <td style={{ ...subTd, textAlign: "right" }}>{fmt(u.cantidad, 4)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {visibles.length === 0 && (
                <tr>
                  <td style={{ ...td, color: "var(--tc-gray-500)" }} colSpan={12}>
                    {datos.insumos.length ? "Ningún insumo coincide con los filtros." : "El presupuesto no tiene insumos con cantidad."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {datos.porcentaje.length > 0 && (
        <p style={{ ...texto, margin: 0, fontSize: 12.5, color: "var(--tc-gray-500)" }}>
          No aparecen {datos.porcentaje.length} insumo(s) en porcentaje ({datos.porcentaje.map((x) => `${x.descripcion}: ${fmt(x.monto)}`).join("; ")}): son un valor
          sobre otras líneas, no una cantidad que se compre.
        </p>
      )}
      <p style={{ ...texto, margin: 0, fontSize: 12.5, color: "var(--tc-gray-500)" }}>
        Solicitado cuenta las requisiciones enviadas (lo pedido) y las aprobadas (lo aprobado); los borradores, rechazadas y anuladas no cuentan. Lo
        comprometido y lo recibido aparecerán con las órdenes y la recepción.
      </p>
    </div>
  );
}

const num = { ...td, textAlign: "right" as const, whiteSpace: "nowrap" as const, fontVariantNumeric: "tabular-nums" };
const sub = { ...th, position: "static" as const, background: "transparent", fontSize: 12 };
const subTd = { ...td, fontSize: 12.5, padding: "4px 8px" };
