"use client";

import { CSSProperties, Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { tiene } from "../../lib/compras/accesos";
import type { ComprasApi } from "../../lib/compras/client";
import { fecha, fechaHora } from "../../lib/compras/formato";
import { numeroOrden } from "../../lib/compras/ordenes";
import { nombrePdfRecepcion, pdfRecepcion } from "../../lib/compras/pdfRecepcion";
import { avanceRecepcion, ESTADOS_RECEPCION, numeroRecepcion, puedeAccionRecepcion, puedeEditarRecepcion, TRANSICIONES_RECEPCION } from "../../lib/compras/recepciones";
import type { AccionRecepcion, EstadoRecepcion, OrdenPorRecibir, Permiso, Recepcion, RecepcionesResponse } from "../../lib/compras/types";
import { TIPO_ORDEN } from "../../lib/compras/types";
import { redondear } from "../../lib/presupuesto/calc";
import { fmt } from "../../lib/presupuesto/format";
import { ApiError } from "../../lib/propiedades/client";
import { isoToDisplay, parseDisplayDate } from "../../lib/propiedades/values";
import { acceptButton, baseInput, C, labelStyle, message, Modal, Notice, NumInput } from "../presupuesto/ui";
import DateField from "../propiedades/DateField";
import DocumentosRegistro from "./DocumentosRegistro";
import { botonPeligro, botonSecundario, etiqueta, linkBtn, select, subtitulo, td, th } from "./estilos";

type Abierta = { recepcion: Recepcion } | { orden: OrdenPorRecibir };

const AVANCE: Record<ReturnType<typeof avanceRecepcion>["estado"], { texto: string; color: string; fondo: string }> = {
  "sin-recibir": { texto: "Sin recibir", color: "#3c4550", fondo: "#eef1f4" },
  parcial: { texto: "Parcial", color: "#7a5a00", fondo: "#fff4d1" },
  completa: { texto: "Completa", color: "#2e6b22", fondo: "#e3f3de" },
};

/** Receptions on site: what is still to receive of each issued order or contract, and the receptions. */
export default function Recepciones({
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
  const [datos, setDatos] = useState<RecepcionesResponse | null>(null);
  const [error, setError] = useState("");
  const [estado, setEstado] = useState<EstadoRecepcion | "">("");
  const [abierta, setAbierta] = useState<Abierta | null>(null);
  const [detalle, setDetalle] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError("");
    try {
      setDatos(await api.getRecepciones());
    } catch (err) {
      setError(message(err));
      onSinAcceso(err);
    }
  }, [api, onSinAcceso]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const filas = useMemo(() => (datos?.recepciones ?? []).filter((r) => !estado || r.estado === estado), [datos, estado]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!datos) return <p style={{ color: "var(--tc-gray-500)" }}>Cargando recepciones…</p>;

  const orden = (id: string) => datos.ordenes.find((o) => o.id === id);
  const crea = tiene(permisos, "recepciones", "crear");
  const actual = abierta && "recepcion" in abierta ? datos.recepciones.find((r) => r.id === abierta.recepcion.id) ?? abierta.recepcion : null;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6 }}>
        <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontWeight: 600, fontSize: 14 }}>Órdenes y contratos emitidos: lo ordenado y lo recibido</div>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>N.º</th>
              <th style={th}>Proveedor</th>
              <th style={th}>Entrega / terminación</th>
              <th style={th}>Recibido</th>
              <th style={th} aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {datos.ordenes.map((o) => {
              const av = avanceRecepcion(o);
              const a = AVANCE[av.estado];
              const abierto = detalle === o.id;
              return (
                <Fragment key={o.id}>
                  <tr>
                    <td style={{ ...td, fontWeight: 600, whiteSpace: "nowrap" }}>
                      {numeroOrden(o.tipo, o.numero)}
                      {o.revision > 0 && <span style={{ fontWeight: 400, fontSize: 12, color: "var(--tc-gray-500)" }}> rev. {o.revision}</span>}
                      {o.estado !== "aprobada" && <div style={{ fontWeight: 400, fontSize: 12, color: "#a35200" }}>{o.estado === "anulada" ? "Anulada" : "En modificación: no se recibe"}</div>}
                    </td>
                    <td style={td}>
                      {o.proveedor}
                      <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>NIT {o.nit}</div>
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: o.fechaEntrega < datos.hoy && av.estado !== "completa" ? "#a35200" : undefined }}>{fecha(o.fechaEntrega)}</td>
                    <td style={td}>
                      <span style={etiqueta(a.color, a.fondo)}>{a.texto}</span> <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>{fmt(av.pct)} %</span>
                    </td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      <button type="button" onClick={() => setDetalle(abierto ? null : o.id)} style={{ ...linkBtn, fontSize: 13, marginRight: 10 }}>
                        {abierto ? "Ocultar" : "Ordenado vs. recibido"}
                      </button>
                      {crea && o.estado === "aprobada" && o.lineas.some((l) => l.pendiente > 0) && (
                        <button type="button" onClick={() => setAbierta({ orden: o })} style={{ ...linkBtn, fontSize: 13 }}>
                          Registrar recepción
                        </button>
                      )}
                    </td>
                  </tr>
                  {abierto && (
                    <tr>
                      <td colSpan={5} style={{ ...td, background: "#f7f9fc" }}>
                        <Diferencias orden={o} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {datos.ordenes.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...td, color: "var(--tc-gray-500)" }}>
                  No hay órdenes ni contratos emitidos todavía.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Recepciones</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoRecepcion | "")} style={select} aria-label="Estado">
            <option value="">Todos los estados</option>
            {(Object.keys(ESTADOS_RECEPCION) as EstadoRecepcion[]).map((e) => (
              <option key={e} value={e}>
                {ESTADOS_RECEPCION[e].texto}
              </option>
            ))}
          </select>
        </div>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>N.º</th>
              <th style={th}>Orden / contrato</th>
              <th style={th}>Fecha de recibo</th>
              <th style={th}>Remisión</th>
              <th style={th}>Estado</th>
              <th style={th}>Registró</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((r) => {
              const e = ESTADOS_RECEPCION[r.estado];
              const o = orden(r.ordenId);
              return (
                <tr key={r.id} onClick={() => setAbierta({ recepcion: r })} style={{ cursor: "pointer" }}>
                  <td style={{ ...td, fontWeight: 600 }}>
                    <button type="button" onClick={() => setAbierta({ recepcion: r })} style={linkBtn}>
                      {numeroRecepcion(r.numero)}
                    </button>
                  </td>
                  <td style={td}>{o ? `${numeroOrden(o.tipo, o.numero)} · ${o.proveedor}` : "—"}</td>
                  <td style={td}>{fecha(r.fecha)}</td>
                  <td style={td}>{r.remision || "—"}</td>
                  <td style={td}>
                    <span style={etiqueta(e.color, e.fondo)}>{e.texto}</span>
                  </td>
                  <td style={td}>{r.elaboradoPor}</td>
                </tr>
              );
            })}
            {filas.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...td, color: "var(--tc-gray-500)" }}>
                  {datos.recepciones.length ? "Ninguna coincide con el filtro." : "Todavía no hay recepciones."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {abierta && (
        <RecepcionDialog
          key={actual ? `${actual.id}:${actual.version}` : "nueva"}
          api={api}
          datos={datos}
          recepcion={actual}
          orden={actual ? orden(actual.ordenId) : "orden" in abierta ? abierta.orden : undefined}
          yo={yo}
          permisos={permisos}
          proyecto={proyecto}
          onDatos={(d, id) => {
            setDatos(d);
            const r = id ? d.recepciones.find((x) => x.id === id) : undefined;
            setAbierta(r ? { recepcion: r } : null);
          }}
          onRecargar={cargar}
          onSinAcceso={onSinAcceso}
          onClose={() => setAbierta(null)}
        />
      )}
    </div>
  );
}

/** Ordered against received, line by line. */
function Diferencias({ orden: o }: { orden: OrdenPorRecibir }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={th}>Insumo</th>
            <th style={th}>Und</th>
            <th style={thNum}>Ordenado</th>
            <th style={thNum} title="En recepciones aprobadas">
              Aceptado
            </th>
            <th style={thNum} title="En recepciones en borrador o por aprobar">
              En trámite
            </th>
            <th style={thNum}>Rechazado</th>
            <th style={thNum}>Devuelto</th>
            <th style={thNum}>Pendiente</th>
          </tr>
        </thead>
        <tbody>
          {o.lineas.map((l) => (
            <tr key={l.requisicionLineaId}>
              <td style={td}>
                {l.codigo} {l.descripcion}
              </td>
              <td style={td}>{l.unidad}</td>
              <td style={num}>{fmt(l.ordenado, 4)}</td>
              <td style={num}>{fmt(l.aceptado, 4)}</td>
              <td style={num}>{l.enTramite ? fmt(l.enTramite, 4) : "—"}</td>
              <td style={{ ...num, color: l.rechazado ? "#b3261e" : undefined }}>{l.rechazado ? fmt(l.rechazado, 4) : "—"}</td>
              <td style={num}>{l.devuelto ? fmt(l.devuelto, 4) : "—"}</td>
              <td style={{ ...num, fontWeight: 600 }}>{fmt(l.pendiente, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface LineaEdicion {
  recibido: number | null;
  rechazado: number | null;
  devuelto: number | null;
  motivo: string;
}

/** One reception: what arrived of each line (received, rejected, returned), its decision and its record in the CDE. */
function RecepcionDialog({
  api,
  datos,
  recepcion: r,
  orden: o,
  yo,
  permisos,
  proyecto,
  onDatos,
  onRecargar,
  onSinAcceso,
  onClose,
}: {
  api: ComprasApi;
  datos: RecepcionesResponse;
  recepcion: Recepcion | null;
  orden: OrdenPorRecibir | undefined;
  yo: string;
  permisos: Permiso[];
  proyecto: string;
  onDatos: (d: RecepcionesResponse, id?: string) => void;
  onRecargar: () => void;
  onSinAcceso: (err: unknown) => void;
  onClose: () => void;
}) {
  const [id] = useState(() => r?.id ?? globalThis.crypto.randomUUID());
  const editable = r ? puedeEditarRecepcion(r, yo, permisos) : tiene(permisos, "recepciones", "crear");
  const [fechaTexto, setFechaTexto] = useState(isoToDisplay(r?.fecha ?? datos.hoy));
  const [remision, setRemision] = useState(r?.remision ?? "");
  const [observaciones, setObservaciones] = useState(r?.observaciones ?? "");
  const [lineas, setLineas] = useState<Record<string, LineaEdicion>>(() =>
    Object.fromEntries(
      (o?.lineas ?? []).map((l) => {
        const rl = r?.lineas.find((x) => x.requisicionLineaId === l.requisicionLineaId);
        return [l.requisicionLineaId, { recibido: rl?.recibido ?? null, rechazado: rl?.rechazado ?? 0, devuelto: rl?.devuelto ?? 0, motivo: rl?.motivo ?? "" }];
      })
    )
  );
  const [pedirMotivo, setPedirMotivo] = useState<AccionRecepcion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Most this reception can accept of a line: what is pending plus what it already holds.
  const maximo = (rl: string) => {
    const l = o?.lineas.find((x) => x.requisicionLineaId === rl);
    const propio = r && r.estado !== "anulada" ? r.lineas.find((x) => x.requisicionLineaId === rl)?.aceptado ?? 0 : 0;
    return redondear((l?.pendiente ?? 0) + propio, 4);
  };
  const fechaIso = parseDisplayDate(fechaTexto);
  const incluidas = (o?.lineas ?? []).filter((l) => (lineas[l.requisicionLineaId]?.recibido ?? 0) > 0);
  const errorLinea = (rl: string): string => {
    const x = lineas[rl];
    const recibido = x.recibido ?? 0;
    const rechazado = x.rechazado ?? 0;
    const devuelto = x.devuelto ?? 0;
    if (rechazado > recibido) return "Lo rechazado pasa lo recibido.";
    if (devuelto > rechazado) return "Lo devuelto pasa lo rechazado.";
    if (rechazado > 0 && !x.motivo.trim()) return "Escribe por qué se rechazó.";
    if (recibido - rechazado > maximo(rl) + 0.00005) return `Se aceptarían ${fmt(recibido - rechazado, 4)} y quedan ${fmt(maximo(rl), 4)} por recibir: rechaza el excedente.`;
    return "";
  };
  const problema = !editable
    ? ""
    : !fechaIso
      ? "Escribe la fecha de recibo como DD-MM-AAAA."
      : fechaIso > datos.hoy
        ? "La fecha de recibo no puede ser posterior a hoy."
        : !incluidas.length
          ? "Escribe lo recibido de al menos un insumo."
          : incluidas.map((l) => errorLinea(l.requisicionLineaId)).find(Boolean) ?? "";

  function fallo(err: unknown) {
    setBusy(false);
    setPedirMotivo(null);
    setError(message(err));
    if (err instanceof ApiError && err.code === "version-conflict") onRecargar();
    onSinAcceso(err);
  }

  async function guardarYEnviar(enviar: boolean) {
    if (problema || !fechaIso || !o) return;
    setBusy(true);
    setError("");
    try {
      const d = await api.guardarRecepcion({
        id,
        ordenId: o.id,
        fecha: fechaIso,
        remision: remision.trim(),
        observaciones: observaciones.trim(),
        lineas: incluidas.map((l) => {
          const x = lineas[l.requisicionLineaId];
          return { requisicionLineaId: l.requisicionLineaId, recibido: x.recibido ?? 0, rechazado: x.rechazado ?? 0, devuelto: x.devuelto ?? 0, motivo: x.motivo.trim() };
        }),
        version: r?.version ?? 0,
      });
      const guardada = d.recepciones.find((x) => x.id === id);
      if (enviar && guardada) onDatos(await api.accionRecepcion(id, { accion: "enviar", motivo: "", version: guardada.version }), id);
      else onDatos(d, id);
    } catch (err) {
      fallo(err);
    }
  }

  async function accion(a: AccionRecepcion, motivo: string) {
    if (!r) return;
    setBusy(true);
    setError("");
    try {
      onDatos(await api.accionRecepcion(r.id, { accion: a, motivo, version: r.version }), r.id);
    } catch (err) {
      fallo(err);
    }
  }

  const ctxAcc = { actorId: yo, permisos };
  const e = r ? ESTADOS_RECEPCION[r.estado] : ESTADOS_RECEPCION.borrador;
  const cambiar = (rl: string, patch: Partial<LineaEdicion>) => setLineas((ls) => ({ ...ls, [rl]: { ...ls[rl], ...patch } }));

  return (
    <Modal
      title={r ? `${numeroRecepcion(r.numero)} · ${o ? numeroOrden(o.tipo, o.numero) : ""} · ${o?.proveedor ?? ""}` : `Nueva recepción · ${o ? numeroOrden(o.tipo, o.numero) : ""} · ${o?.proveedor ?? ""}`}
      width={1100}
      height="92vh"
      onClose={() => !busy && onClose()}
      footer={
        <>
          {editable && problema && <span style={{ marginRight: "auto", fontSize: 13, color: "var(--tc-gray-500)" }}>{problema}</span>}
          {editable && (
            <>
              <button type="button" onClick={() => guardarYEnviar(false)} disabled={busy || !!problema} style={{ ...botonSecundario, opacity: problema ? 0.5 : 1 }}>
                Guardar borrador
              </button>
              <button type="button" onClick={() => guardarYEnviar(true)} disabled={busy || !!problema} style={{ ...acceptButton, opacity: problema ? 0.5 : 1 }}>
                Enviar a aprobación
              </button>
            </>
          )}
          {r && puedeAccionRecepcion(ctxAcc, r, "aprobar") && (
            <>
              <button type="button" onClick={() => setPedirMotivo("devolver")} disabled={busy} style={botonSecundario}>
                Devolver
              </button>
              <button type="button" onClick={() => setPedirMotivo("aprobar")} disabled={busy} style={acceptButton}>
                Aprobar
              </button>
            </>
          )}
          {r && puedeAccionRecepcion(ctxAcc, r, "anular") && (
            <button type="button" onClick={() => setPedirMotivo("anular")} disabled={busy} style={{ ...botonSecundario, color: C.close }}>
              Anular
            </button>
          )}
        </>
      }
    >
      <div style={{ padding: 14, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
          <span style={etiqueta(e.color, e.fondo)}>{r ? e.texto : "Nueva"}</span>
          <span style={{ color: "var(--tc-gray-500)" }}>
            {o ? `${TIPO_ORDEN[o.tipo].nombre} ${numeroOrden(o.tipo, o.numero)}${o.revision ? ` (revisión ${o.revision})` : ""} · ${o.proveedor} (NIT ${o.nit}) · entrega ${fecha(o.fechaEntrega)}${o.lugarEntrega ? `, ${o.lugarEntrega}` : ""}` : ""}
          </span>
          {r && (
            <span style={{ color: "var(--tc-gray-500)" }}>
              Registró {r.elaboradoPor}
              {r.aprobada ? ` · aprobada el ${fechaHora(r.aprobada)} por ${r.aprobadaPor}` : ""}
            </span>
          )}
        </div>
        {r?.motivo && <Notice kind={r.estado === "aprobada" ? "info" : "warning"}>{r.estado === "anulada" ? "Anulada" : r.estado === "aprobada" ? "Nota" : "Devuelta"}: {r.motivo}</Notice>}
        {editable && <Notice kind="info">Escribe lo que llegó de cada insumo. Lo aceptado es lo recibido menos lo rechazado y no puede pasar lo pendiente de la orden; lo que sobre, recházalo con su motivo.</Notice>}

        <div style={{ display: "grid", gridTemplateColumns: "190px 220px 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="rec-fecha">
              Fecha de recibo
            </label>
            {editable ? <DateField id="rec-fecha" text={fechaTexto} placeholder="DD-MM-AAAA" invalid={!fechaIso} onText={setFechaTexto} /> : <div style={{ fontSize: 13.5 }}>{fecha(r!.fecha)}</div>}
          </div>
          <div>
            <label style={labelStyle} htmlFor="rec-remision">
              Remisión del proveedor
            </label>
            {editable ? <input id="rec-remision" maxLength={100} value={remision} onChange={(ev) => setRemision(ev.target.value)} style={{ ...baseInput, width: "100%" }} /> : <div style={{ fontSize: 13.5 }}>{remision || "—"}</div>}
          </div>
          <div>
            <label style={labelStyle} htmlFor="rec-obs">
              Observaciones
            </label>
            {editable ? (
              <input id="rec-obs" maxLength={1000} value={observaciones} onChange={(ev) => setObservaciones(ev.target.value)} style={{ ...baseInput, width: "100%" }} />
            ) : (
              <div style={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>{observaciones || "—"}</div>
            )}
          </div>
        </div>

        <div style={{ overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Insumo</th>
                <th style={th}>Und</th>
                <th style={thNum}>Ordenado</th>
                <th style={thNum} title="Lo que falta por recibir, sin contar esta recepción">
                  Por recibir
                </th>
                <th style={thNum}>Recibido</th>
                <th style={thNum}>Rechazado</th>
                <th style={thNum}>Devuelto</th>
                <th style={thNum}>Aceptado</th>
                <th style={th}>Motivo del rechazo</th>
              </tr>
            </thead>
            <tbody>
              {(o?.lineas ?? [])
                .filter((l) => editable || r?.lineas.some((x) => x.requisicionLineaId === l.requisicionLineaId))
                .map((l) => {
                  const x = lineas[l.requisicionLineaId];
                  const aceptado = redondear((x.recibido ?? 0) - (x.rechazado ?? 0), 4);
                  const err = (x.recibido ?? 0) > 0 ? errorLinea(l.requisicionLineaId) : "";
                  const entrada = (k: "recibido" | "rechazado" | "devuelto", allowEmpty: boolean) =>
                    editable ? (
                      <NumInput value={x[k]} decimals={4} allowEmpty={allowEmpty} onCommit={(v) => cambiar(l.requisicionLineaId, { [k]: v ?? (allowEmpty ? null : 0) })} ariaLabel={`${k} de ${l.descripcion}`} style={celda} />
                    ) : (
                      fmt(x[k] ?? 0, 4)
                    );
                  return (
                    <tr key={l.requisicionLineaId} style={{ background: err ? "#fdf1f0" : undefined }} title={err || undefined}>
                      <td style={td}>
                        {l.codigo} {l.descripcion}
                      </td>
                      <td style={td}>{l.unidad}</td>
                      <td style={num}>{fmt(l.ordenado, 4)}</td>
                      <td style={num}>{fmt(maximo(l.requisicionLineaId), 4)}</td>
                      <td style={num}>{entrada("recibido", true)}</td>
                      <td style={num}>{entrada("rechazado", false)}</td>
                      <td style={num}>{entrada("devuelto", false)}</td>
                      <td style={{ ...num, fontWeight: 600, color: err ? "#b3261e" : undefined }}>{(x.recibido ?? 0) > 0 ? fmt(aceptado, 4) : "—"}</td>
                      <td style={td}>
                        {editable ? (
                          <input
                            value={x.motivo}
                            maxLength={500}
                            disabled={!(x.rechazado ?? 0)}
                            placeholder={x.rechazado ? "Por qué se rechazó" : ""}
                            onChange={(ev) => cambiar(l.requisicionLineaId, { motivo: ev.target.value })}
                            style={{ ...baseInput, width: "100%" }}
                            aria-label={`Motivo del rechazo de ${l.descripcion}`}
                          />
                        ) : (
                          x.motivo || "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {error && <Notice kind="error">{error}</Notice>}

        {r && (
          <section>
            <h3 style={subtitulo}>Acta y soportes</h3>
            <DocumentosRegistro
              api={api}
              entidadTipo="recepcion"
              entidadId={r.id}
              permisos={permisos}
              generar={
                r.estado === "aprobada"
                  ? {
                      etiqueta: "Guardar el acta en el CDE",
                      tipoDoc: "acta",
                      crear: async () => ({ archivo: await pdfRecepcion(r, o, proyecto), nombre: nombrePdfRecepcion(r) }),
                    }
                  : undefined
              }
            />
          </section>
        )}
      </div>

      {pedirMotivo && <MotivoRecepcion accion={pedirMotivo} busy={busy} onConfirmar={(m) => accion(pedirMotivo, m)} onClose={() => setPedirMotivo(null)} />}
    </Modal>
  );
}

function MotivoRecepcion({ accion, busy, onConfirmar, onClose }: { accion: AccionRecepcion; busy: boolean; onConfirmar: (m: string) => void; onClose: () => void }) {
  const [motivo, setMotivo] = useState("");
  const obligatorio = accion === "devolver" || accion === "anular";
  const listo = !obligatorio || !!motivo.trim();
  const ayuda: Record<AccionRecepcion, string> = {
    enviar: "",
    aprobar: "Nota (opcional). Al aprobar, lo aceptado cuenta como recibido en la orden y en el insumo.",
    devolver: "Qué hay que corregir (obligatorio). Vuelve a borrador para quien la registró.",
    anular: "Por qué se anula (obligatorio). Lo aceptado deja de contar como recibido; no se borra nada.",
  };
  return (
    <Modal
      title={TRANSICIONES_RECEPCION[accion].nombre}
      width={520}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} style={botonSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={() => onConfirmar(motivo.trim())} disabled={busy || !listo} style={{ ...(accion === "anular" ? botonPeligro : acceptButton), opacity: listo ? 1 : 0.5 }}>
            {busy ? "Guardando…" : TRANSICIONES_RECEPCION[accion].nombre}
          </button>
        </>
      }
    >
      <div style={{ padding: 16, display: "grid", gap: 8 }}>
        <label style={labelStyle} htmlFor="motivo-recepcion">
          {ayuda[accion]}
        </label>
        <textarea id="motivo-recepcion" autoFocus rows={3} maxLength={1000} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} style={{ ...baseInput, width: "100%", resize: "vertical" }} />
      </div>
    </Modal>
  );
}

const num: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const thNum: CSSProperties = { ...th, textAlign: "right" };
const celda: CSSProperties = { width: 110, textAlign: "right" };
