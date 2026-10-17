"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { tiene } from "../../lib/compras/accesos";
import type { ComprasApi } from "../../lib/compras/client";
import { numeroCotizacion, totalesCotizacion, totalesLinea } from "../../lib/compras/cotizaciones";
import { fecha, fechaHora } from "../../lib/compras/formato";
import { ESTADOS_ORDEN, numeroOrden, puedeAccionOrden, puedeEditarOrden, TRANSICIONES_ORDEN } from "../../lib/compras/ordenes";
import { nombrePdfOrden, pdfOrden } from "../../lib/compras/pdfOrden";
import { nitConDv } from "../../lib/compras/proveedores";
import { numeroRequisicion } from "../../lib/compras/requisiciones";
import { AccionOrden, EstadoOrden, Orden, OrdenesResponse, Permiso, PorOrdenar, TIPO_ORDEN, TipoOrden } from "../../lib/compras/types";
import { fmt } from "../../lib/presupuesto/format";
import { ApiError } from "../../lib/propiedades/client";
import { isoToDisplay, parseDisplayDate } from "../../lib/propiedades/values";
import { acceptButton, baseInput, C, labelStyle, message, Modal, Notice, NumInput } from "../presupuesto/ui";
import DateField from "../propiedades/DateField";
import DocumentosRegistro from "./DocumentosRegistro";
import { botonPeligro, botonSecundario, etiqueta, linkBtn, select, subtitulo, td, th } from "./estilos";

type Abierta = { orden: Orden } | { nueva: PorOrdenar; tipo: TipoOrden };

/** Purchase orders and contracts: what is still to order from the chosen suppliers, and the documents issued. */
export default function Ordenes({
  api,
  yo,
  permisos,
  proyecto,
  onSinAcceso,
}: {
  api: ComprasApi;
  yo: string;
  permisos: Permiso[];
  proyecto: string;
  onSinAcceso: (err: unknown) => void;
}) {
  const [datos, setDatos] = useState<OrdenesResponse | null>(null);
  const [error, setError] = useState("");
  const [tipo, setTipo] = useState<TipoOrden | "">("");
  const [estado, setEstado] = useState<EstadoOrden | "">("");
  const [abierta, setAbierta] = useState<Abierta | null>(null);

  const cargar = useCallback(async () => {
    setError("");
    try {
      setDatos(await api.getOrdenes());
    } catch (err) {
      setError(message(err));
      onSinAcceso(err);
    }
  }, [api, onSinAcceso]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const proveedor = useCallback((id: string) => datos?.proveedores.find((p) => p.id === id), [datos]);
  const filas = useMemo(() => (datos?.ordenes ?? []).filter((o) => (!tipo || o.tipo === tipo) && (!estado || o.estado === estado)), [datos, tipo, estado]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!datos) return <p style={{ color: "var(--tc-gray-500)" }}>Cargando órdenes y contratos…</p>;

  const pendientes = datos.porOrdenar.filter((p) => Object.values(p.pendientes).some((x) => x > 0));
  const creaOrden = tiene(permisos, "ordenes", "crear");
  const creaContrato = tiene(permisos, "contratos", "crear");
  const actual = abierta && "orden" in abierta ? datos.ordenes.find((o) => o.id === abierta.orden.id) ?? abierta.orden : null;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {pendientes.length > 0 && (creaOrden || creaContrato) && (
        <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6 }}>
          <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontWeight: 600, fontSize: 14 }}>Por ordenar: proveedores elegidos con cantidades pendientes</div>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Requisición</th>
                <th style={th}>Proveedor elegido</th>
                <th style={th}>Cotización</th>
                <th style={{ ...th, textAlign: "right" }}>Valor pendiente (con IVA)</th>
                <th style={th} aria-label="Crear" />
              </tr>
            </thead>
            <tbody>
              {pendientes.map((p) => {
                const valor = p.cotizacion.lineas.reduce((s, l) => s + totalesLinea({ ...l, cantidad: p.pendientes[l.requisicionLineaId] ?? 0 }).total, 0);
                return (
                  <tr key={p.requisicion.id}>
                    <td style={td}>
                      {numeroRequisicion(p.requisicion.numero)} <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>{p.requisicion.justificacion}</span>
                    </td>
                    <td style={td}>{p.proveedor.razonSocial}</td>
                    <td style={td}>{numeroCotizacion(p.cotizacion.numero)}</td>
                    <td style={num}>{fmt(valor)}</td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      {creaOrden && (
                        <button type="button" onClick={() => setAbierta({ nueva: p, tipo: "orden" })} style={{ ...linkBtn, fontSize: 13, marginRight: 10 }}>
                          Crear orden de compra
                        </button>
                      )}
                      {creaContrato && (
                        <button type="button" onClick={() => setAbierta({ nueva: p, tipo: "contrato" })} style={{ ...linkBtn, fontSize: 13 }}>
                          Crear contrato
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoOrden | "")} style={select} aria-label="Tipo">
            <option value="">Órdenes y contratos</option>
            <option value="orden">Órdenes de compra</option>
            <option value="contrato">Contratos</option>
          </select>
          <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoOrden | "")} style={select} aria-label="Estado">
            <option value="">Todos los estados</option>
            {(Object.keys(ESTADOS_ORDEN) as EstadoOrden[]).map((e) => (
              <option key={e} value={e}>
                {ESTADOS_ORDEN[e].texto}
              </option>
            ))}
          </select>
        </div>
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 260px)" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>N.º</th>
                <th style={th}>Proveedor</th>
                <th style={th}>Requisición</th>
                <th style={th}>Entrega / terminación</th>
                <th style={th}>Estado</th>
                <th style={{ ...th, textAlign: "right" }}>Total (con IVA)</th>
                <th style={th}>Elaborada por</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((o) => {
                const e = ESTADOS_ORDEN[o.estado];
                return (
                  <tr key={o.id} onClick={() => setAbierta({ orden: o })} style={{ cursor: "pointer" }}>
                    <td style={{ ...td, fontWeight: 600, whiteSpace: "nowrap" }}>
                      <button type="button" onClick={() => setAbierta({ orden: o })} style={linkBtn}>
                        {numeroOrden(o.tipo, o.numero)}
                      </button>
                      {o.revision > 0 && <span style={{ fontWeight: 400, fontSize: 12, color: "var(--tc-gray-500)" }}> rev. {o.revision}</span>}
                    </td>
                    <td style={td}>{proveedor(o.proveedorId)?.razonSocial}</td>
                    <td style={td}>{datos.porOrdenar.find((p) => p.requisicion.id === o.requisicionId)?.requisicion.numero ? numeroRequisicion(datos.porOrdenar.find((p) => p.requisicion.id === o.requisicionId)!.requisicion.numero) : "—"}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: o.fechaEntrega < datos.hoy && o.estado !== "anulada" ? "#a35200" : undefined }}>{fecha(o.fechaEntrega)}</td>
                    <td style={td}>
                      <span style={etiqueta(e.color, e.fondo)}>{e.texto}</span>
                    </td>
                    <td style={num}>{fmt(totalesCotizacion(o).total)}</td>
                    <td style={td}>{o.elaboradoPor}</td>
                  </tr>
                );
              })}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ ...td, color: "var(--tc-gray-500)" }}>
                    {datos.ordenes.length ? "Ninguna coincide con los filtros." : "Todavía no hay órdenes ni contratos."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {abierta && (
        <OrdenDialog
          key={actual ? `${actual.id}:${actual.version}` : "nueva"}
          api={api}
          datos={datos}
          orden={actual}
          nueva={"nueva" in abierta ? abierta : null}
          yo={yo}
          permisos={permisos}
          proyecto={proyecto}
          onDatos={(d, id) => {
            setDatos(d);
            const o = id ? d.ordenes.find((x) => x.id === id) : undefined;
            setAbierta(o ? { orden: o } : null);
          }}
          onRecargar={cargar}
          onSinAcceso={onSinAcceso}
          onClose={() => setAbierta(null)}
        />
      )}
    </div>
  );
}

interface LineaEdicion {
  incluida: boolean;
  cantidad: number | null;
  precio: number;
  descuento: number;
  iva: number;
}

function OrdenDialog({
  api,
  datos,
  orden: o,
  nueva,
  yo,
  permisos,
  proyecto,
  onDatos,
  onRecargar,
  onSinAcceso,
  onClose,
}: {
  api: ComprasApi;
  datos: OrdenesResponse;
  orden: Orden | null;
  proyecto: string;
  nueva: { nueva: PorOrdenar; tipo: TipoOrden } | null;
  yo: string;
  permisos: Permiso[];
  onDatos: (d: OrdenesResponse, id?: string) => void;
  onRecargar: () => void;
  onSinAcceso: (err: unknown) => void;
  onClose: () => void;
}) {
  const tipo: TipoOrden = o?.tipo ?? nueva!.tipo;
  const fuente = datos.porOrdenar.find((p) => p.requisicion.id === (o?.requisicionId ?? nueva!.nueva.requisicion.id)) ?? nueva?.nueva ?? null;
  const [id] = useState(() => o?.id ?? globalThis.crypto.randomUUID());
  const editable = o ? puedeEditarOrden(o, yo, permisos) : tiene(permisos, TIPO_ORDEN[tipo].modulo, "crear");
  const modifica = (o?.revision ?? 0) > 0;
  const cot = fuente?.cotizacion;
  const [fechaTexto, setFechaTexto] = useState(o ? isoToDisplay(o.fechaEntrega) : "");
  const [campos, setCampos] = useState({
    lugarEntrega: o?.lugarEntrega ?? "",
    formaPago: o?.formaPago ?? cot?.formaPago ?? "",
    objeto: o?.objeto ?? "",
    polizas: o?.polizas ?? "",
    observaciones: o?.observaciones ?? "",
  });
  const [diasPago, setDiasPago] = useState<number | null>(o?.diasPago ?? cot?.diasPago ?? 0);
  const [anticipo, setAnticipo] = useState<number | null>(o?.anticipoPct ?? cot?.anticipoPct ?? 0);
  const [retencion, setRetencion] = useState<number | null>(o?.retencionGarantiaPct ?? (tipo === "contrato" ? 5 : 0));
  const lineasReq = (fuente?.requisicion.lineas ?? []).filter((l) => cot?.lineas.some((c) => c.requisicionLineaId === l.id));
  /** Most this order can take of a line: what is pending plus what it already holds. */
  const maximo = (lineaId: string) => (fuente?.pendientes[lineaId] ?? 0) + (o && o.estado !== "anulada" ? o.lineas.find((l) => l.requisicionLineaId === lineaId)?.cantidad ?? 0 : 0);
  const [lineas, setLineas] = useState<Record<string, LineaEdicion>>(() =>
    Object.fromEntries(
      lineasReq.map((l) => {
        const ol = o?.lineas.find((x) => x.requisicionLineaId === l.id);
        const cl = cot!.lineas.find((x) => x.requisicionLineaId === l.id)!;
        const max = maximo(l.id);
        return [l.id, { incluida: o ? !!ol : max > 0, cantidad: ol?.cantidad ?? (max > 0 ? max : null), precio: ol?.precioUnitario ?? cl.precioUnitario, descuento: ol?.descuentoPct ?? cl.descuentoPct, iva: ol?.ivaPct ?? cl.ivaPct }];
      })
    )
  );
  const [pedirMotivo, setPedirMotivo] = useState<AccionOrden | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const fechaIso = parseDisplayDate(fechaTexto);
  const incluidas = lineasReq.filter((l) => lineas[l.id]?.incluida);
  const problema = !editable
    ? ""
    : !fechaIso
      ? `Escribe la fecha de ${tipo === "contrato" ? "terminación" : "entrega"} como DD-MM-AAAA.`
      : !incluidas.length
        ? "Incluye al menos un insumo."
        : incluidas.some((l) => !lineas[l.id].cantidad || (lineas[l.id].cantidad ?? 0) > maximo(l.id) + 0.00005)
          ? "Cada cantidad debe ser mayor que cero y no pasar lo pendiente."
          : "";
  const paraEnviar = problema || (tipo === "contrato" && !campos.objeto.trim() ? "Escribe el objeto del contrato." : fechaIso && fechaIso < datos.hoy ? "La fecha ya pasó." : "");
  const total = incluidas.reduce((s, l) => s + totalesLinea({ cantidad: lineas[l.id].cantidad ?? 0, precioUnitario: lineas[l.id].precio, descuentoPct: lineas[l.id].descuento, ivaPct: lineas[l.id].iva }).total, 0);

  function fallo(err: unknown) {
    setBusy(false);
    setPedirMotivo(null);
    setError(message(err));
    if (err instanceof ApiError && err.code === "version-conflict") onRecargar();
    onSinAcceso(err);
  }

  async function guardar(): Promise<OrdenesResponse | null> {
    if (problema || !fechaIso || !fuente) return null;
    return api.guardarOrden({
      id,
      tipo,
      requisicionId: fuente.requisicion.id,
      fechaEntrega: fechaIso,
      ...campos,
      diasPago: Math.round(diasPago ?? 0),
      anticipoPct: anticipo ?? 0,
      retencionGarantiaPct: tipo === "contrato" ? retencion ?? 0 : 0,
      lineas: incluidas.map((l) => ({
        requisicionLineaId: l.id,
        cantidad: lineas[l.id].cantidad ?? 0,
        ...(modifica ? { precioUnitario: lineas[l.id].precio, descuentoPct: lineas[l.id].descuento, ivaPct: lineas[l.id].iva } : {}),
      })),
      version: o?.version ?? 0,
    });
  }

  async function guardarYEnviar(enviar: boolean) {
    setBusy(true);
    setError("");
    try {
      const d = await guardar();
      if (!d) return setBusy(false);
      const guardada = d.ordenes.find((x) => x.id === id);
      if (enviar && guardada) onDatos(await api.accionOrden(id, { accion: "enviar", motivo: "", version: guardada.version }), id);
      else onDatos(d, id);
    } catch (err) {
      fallo(err);
    }
  }

  async function accion(a: AccionOrden, motivo: string) {
    if (!o) return;
    setBusy(true);
    setError("");
    try {
      onDatos(await api.accionOrden(o.id, { accion: a, motivo, version: o.version }), o.id);
    } catch (err) {
      fallo(err);
    }
  }

  const ctxAcc = { actorId: yo, permisos };
  const revisiones = o ? datos.revisiones.filter((r) => r.ordenId === o.id) : [];
  const proveedor = fuente?.proveedor ?? datos.proveedores.find((p) => p.id === o?.proveedorId);
  const e = o ? ESTADOS_ORDEN[o.estado] : ESTADOS_ORDEN.borrador;
  const cambiar = (lineaId: string, patch: Partial<LineaEdicion>) => setLineas((ls) => ({ ...ls, [lineaId]: { ...ls[lineaId], ...patch } }));
  const campo = (k: keyof typeof campos, texto: string, multilinea = false) => (
    <div>
      <label style={labelStyle} htmlFor={`orden-${k}`}>
        {texto}
      </label>
      {editable ? (
        multilinea ? (
          <textarea id={`orden-${k}`} rows={2} value={campos[k]} onChange={(ev) => setCampos({ ...campos, [k]: ev.target.value })} style={{ ...baseInput, width: "100%", resize: "vertical" }} />
        ) : (
          <input id={`orden-${k}`} value={campos[k]} onChange={(ev) => setCampos({ ...campos, [k]: ev.target.value })} style={{ ...baseInput, width: "100%" }} />
        )
      ) : (
        <div style={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>{campos[k] || "—"}</div>
      )}
    </div>
  );

  return (
    <Modal
      title={o ? `${numeroOrden(o.tipo, o.numero)}${o.revision ? ` · revisión ${o.revision}` : ""} · ${proveedor?.razonSocial ?? ""}` : `Nuevo ${TIPO_ORDEN[tipo].nombre.toLowerCase()} · ${proveedor?.razonSocial ?? ""}`}
      width={1100}
      height="92vh"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <span style={{ marginRight: "auto", fontSize: 13, color: "var(--tc-gray-500)" }}>{editable && paraEnviar ? paraEnviar : `Total con IVA: ${fmt(total)}`}</span>
          {editable && (
            <>
              <button type="button" onClick={() => guardarYEnviar(false)} disabled={busy || !!problema} style={{ ...botonSecundario, opacity: problema ? 0.5 : 1 }}>
                Guardar borrador
              </button>
              <button type="button" onClick={() => guardarYEnviar(true)} disabled={busy || !!paraEnviar} style={{ ...acceptButton, opacity: paraEnviar ? 0.5 : 1 }}>
                Enviar a aprobación
              </button>
            </>
          )}
          {o && puedeAccionOrden(ctxAcc, o, "aprobar") && (
            <>
              <button type="button" onClick={() => setPedirMotivo("devolver")} disabled={busy} style={botonSecundario}>
                Devolver
              </button>
              <button type="button" onClick={() => setPedirMotivo("aprobar")} disabled={busy} style={acceptButton}>
                Aprobar y emitir
              </button>
            </>
          )}
          {o && puedeAccionOrden(ctxAcc, o, "modificar") && (
            <button type="button" onClick={() => setPedirMotivo("modificar")} disabled={busy} style={botonSecundario}>
              {o.tipo === "contrato" ? "Modificar (otrosí)" : "Modificar"}
            </button>
          )}
          {o && puedeAccionOrden(ctxAcc, o, "anular") && (
            <button type="button" onClick={() => setPedirMotivo("anular")} disabled={busy} style={{ ...botonSecundario, color: C.close }}>
              Anular
            </button>
          )}
        </>
      }
    >
      <div style={{ padding: 14, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
          <span style={etiqueta(e.color, e.fondo)}>{o ? e.texto : "Nueva"}</span>
          <span style={{ color: "var(--tc-gray-500)" }}>
            {TIPO_ORDEN[tipo].nombre} · {fuente ? `${numeroRequisicion(fuente.requisicion.numero)}, ${numeroCotizacion(fuente.cotizacion.numero)}` : ""} ·{" "}
            {proveedor ? `${proveedor.razonSocial} (NIT ${nitConDv(proveedor.nit, proveedor.dv)})` : ""}
          </span>
          {o && (
            <span style={{ color: "var(--tc-gray-500)" }}>
              Elaborada por {o.elaboradoPor}
              {o.aprobada ? ` · emitida el ${fechaHora(o.aprobada)} por ${o.aprobadaPor}` : ""}
            </span>
          )}
        </div>
        {o?.motivo && <Notice kind={o.estado === "aprobada" ? "info" : "warning"}>{o.estado === "anulada" ? "Anulada" : o.estado === "aprobada" ? "Nota" : o.revision > 0 && o.estado === "borrador" ? `Modificación (revisión ${o.revision})` : "Devuelta"}: {o.motivo}</Notice>}
        {modifica && editable && <Notice kind="info">En una modificación se pueden ajustar cantidades y precios; al aprobarla queda emitida la revisión {o?.revision}.</Notice>}

        <div style={{ display: "grid", gridTemplateColumns: "190px 1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="orden-fecha">
              {tipo === "contrato" ? "Fecha de terminación" : "Fecha de entrega"}
            </label>
            {editable ? <DateField id="orden-fecha" text={fechaTexto} placeholder="DD-MM-AAAA" invalid={!!fechaTexto && !fechaIso} onText={setFechaTexto} /> : <div style={{ fontSize: 13.5 }}>{fecha(o?.fechaEntrega ?? null)}</div>}
          </div>
          {campo("lugarEntrega", tipo === "contrato" ? "Lugar de ejecución" : "Lugar de entrega")}
          {campo("formaPago", "Forma de pago y condiciones")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: tipo === "contrato" ? "150px 150px 170px 1fr" : "150px 150px 1fr", gap: 12 }}>
          <div>
            <span style={labelStyle}>Pago a (días)</span>
            <NumInput value={diasPago} decimals={0} readOnly={!editable} onCommit={setDiasPago} ariaLabel="Días de pago" style={{ width: "100%" }} />
          </div>
          <div>
            <span style={labelStyle}>Anticipo (%)</span>
            <NumInput value={anticipo} decimals={2} readOnly={!editable} onCommit={setAnticipo} ariaLabel="Anticipo" style={{ width: "100%" }} />
          </div>
          {tipo === "contrato" && (
            <div>
              <span style={labelStyle}>Retención de garantía (%)</span>
              <NumInput value={retencion} decimals={2} readOnly={!editable} onCommit={setRetencion} ariaLabel="Retención de garantía" style={{ width: "100%" }} />
            </div>
          )}
          {tipo === "contrato" ? campo("polizas", "Pólizas exigidas") : campo("observaciones", "Observaciones")}
        </div>
        {tipo === "contrato" && (
          <>
            {campo("objeto", "Objeto del contrato (qué se contrata)", true)}
            {campo("observaciones", "Observaciones")}
          </>
        )}

        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              {editable && <th style={th}>Incluir</th>}
              <th style={th}>Insumo</th>
              <th style={{ ...th, textAlign: "right" }}>Aprobado</th>
              <th style={{ ...th, textAlign: "right" }}>Cotizado</th>
              {editable && (
                <th style={{ ...th, textAlign: "right" }} title="Lo que aún se puede ordenar (contando las demás órdenes y contratos)">
                  Pendiente
                </th>
              )}
              <th style={{ ...th, textAlign: "right" }}>Cantidad</th>
              <th style={{ ...th, textAlign: "right" }}>Precio unitario</th>
              <th style={{ ...th, textAlign: "right" }}>Desc. %</th>
              <th style={{ ...th, textAlign: "right" }}>IVA %</th>
              <th style={{ ...th, textAlign: "right" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {(editable ? lineasReq : lineasReq.filter((l) => o?.lineas.some((x) => x.requisicionLineaId === l.id))).map((l) => {
              const x = lineas[l.id];
              const cl = cot!.lineas.find((c) => c.requisicionLineaId === l.id)!;
              const t = totalesLinea({ cantidad: x.cantidad ?? 0, precioUnitario: x.precio, descuentoPct: x.descuento, ivaPct: x.iva });
              return (
                <tr key={l.id} style={{ opacity: editable && !x.incluida ? 0.5 : 1 }}>
                  {editable && (
                    <td style={td}>
                      <input type="checkbox" checked={x.incluida} onChange={(ev) => cambiar(l.id, { incluida: ev.target.checked })} aria-label={`Incluir ${l.descripcion}`} />
                    </td>
                  )}
                  <td style={td}>
                    {l.descripcion} <span style={{ color: "var(--tc-gray-500)" }}>({l.unidad})</span>
                  </td>
                  <td style={num}>{fmt(l.cantidadAprobada ?? 0, 4)}</td>
                  <td style={num}>{fmt(cl.cantidad, 4)}</td>
                  {editable && <td style={{ ...num, color: maximo(l.id) <= 0 ? "#b3261e" : undefined }}>{fmt(maximo(l.id), 4)}</td>}
                  <td style={num}>
                    {editable ? (
                      <NumInput value={x.cantidad} decimals={4} allowEmpty readOnly={!x.incluida} onCommit={(v) => cambiar(l.id, { cantidad: v })} ariaLabel={`Cantidad de ${l.descripcion}`} style={celda} />
                    ) : (
                      fmt(x.cantidad ?? 0, 4)
                    )}
                  </td>
                  <td style={num} title={modifica ? "Se puede ajustar en esta modificación" : "Precio de la cotización elegida"}>
                    {editable && modifica ? <NumInput value={x.precio} decimals={2} onCommit={(v) => cambiar(l.id, { precio: v ?? 0 })} ariaLabel={`Precio de ${l.descripcion}`} style={celda} /> : fmt(x.precio)}
                  </td>
                  <td style={num}>{fmt(x.descuento)}</td>
                  <td style={num}>{fmt(x.iva)}</td>
                  <td style={num}>{editable && !x.incluida ? "—" : fmt(t.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {revisiones.length > 0 && (
          <div>
            <span style={labelStyle}>{o?.tipo === "contrato" ? "Otrosíes y versiones anteriores" : "Versiones anteriores"}</span>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <tbody>
                {revisiones.map((r) => (
                  <tr key={r.revision}>
                    <td style={td}>Revisión {r.revision}</td>
                    <td style={td}>
                      modificada el {fechaHora(r.creada)} por {r.por}: {r.motivo}
                    </td>
                    <td style={{ ...td, fontSize: 12.5, color: "var(--tc-gray-500)" }}>
                      {r.anterior.lineas.map((l) => `${l.descripcion} ${fmt(l.cantidad, 4)} a ${fmt(l.precioUnitario)}`).join("; ")} · entrega {fecha(r.anterior.fechaEntrega)}
                    </td>
                    <td style={num}>{fmt(r.anterior.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        {o && (
          <section>
            <h3 style={subtitulo}>Documentos</h3>
            <DocumentosRegistro
              api={api}
              entidadTipo={o.tipo}
              entidadId={o.id}
              permisos={permisos}
              generar={
                o.estado === "aprobada"
                  ? {
                      etiqueta: `Guardar el PDF ${o.revision ? `(revisión ${o.revision}) ` : ""}en el CDE`,
                      tipoDoc: "pdf",
                      crear: async () => ({
                        archivo: await pdfOrden(o, datos.proveedores.find((p) => p.id === o.proveedorId), fuente?.requisicion, proyecto),
                        nombre: nombrePdfOrden(o),
                      }),
                    }
                  : undefined
              }
            />
          </section>
        )}
      </div>

      {pedirMotivo && (
        <MotivoOrden
          accion={pedirMotivo}
          contrato={tipo === "contrato"}
          busy={busy}
          onConfirmar={(m) => accion(pedirMotivo, m)}
          onClose={() => setPedirMotivo(null)}
        />
      )}
    </Modal>
  );
}

function MotivoOrden({ accion, contrato, busy, onConfirmar, onClose }: { accion: AccionOrden; contrato: boolean; busy: boolean; onConfirmar: (m: string) => void; onClose: () => void }) {
  const [motivo, setMotivo] = useState("");
  const opcional = accion === "aprobar";
  const listo = opcional || !!motivo.trim();
  const ayuda: Partial<Record<AccionOrden, string>> = {
    aprobar: "Nota de la aprobación (opcional). Al aprobar queda emitida.",
    devolver: "Qué debe corregir quien la elaboró.",
    anular: "Por qué se anula. Es definitivo, no se borra y libera lo que tenía comprometido.",
    modificar: `Por qué se modifica${contrato ? " (otrosí)" : ""}. La versión actual queda guardada y la nueva vuelve a aprobación.`,
  };
  return (
    <Modal
      title={accion === "modificar" && contrato ? "Modificar (otrosí)" : TRANSICIONES_ORDEN[accion].nombre}
      width={520}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} style={botonSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={() => onConfirmar(motivo.trim())} disabled={busy || !listo} style={{ ...(accion === "anular" ? botonPeligro : acceptButton), opacity: listo ? 1 : 0.5 }}>
            {busy ? "Guardando…" : accion === "modificar" && contrato ? "Modificar" : TRANSICIONES_ORDEN[accion].nombre}
          </button>
        </>
      }
    >
      <div style={{ padding: 16, display: "grid", gap: 8 }}>
        <label style={labelStyle} htmlFor="motivo-orden">
          {ayuda[accion]}
        </label>
        <textarea id="motivo-orden" autoFocus rows={3} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ ...baseInput, width: "100%", resize: "vertical" }} />
      </div>
    </Modal>
  );
}

const num: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const celda: CSSProperties = { width: 120, textAlign: "right" };
