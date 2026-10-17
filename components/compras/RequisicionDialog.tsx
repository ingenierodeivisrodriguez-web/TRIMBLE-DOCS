"use client";

import { CSSProperties, useMemo, useState } from "react";
import { tiene } from "../../lib/compras/accesos";
import type { ComprasApi } from "../../lib/compras/client";
import { fecha, fechaHora } from "../../lib/compras/formato";
import { cantidadesAprobadas, ESTADOS_REQUISICION, excesos, limite, numeroRequisicion, puedeAccion, puedeEditar, solicitadoPorInsumo, TRANSICIONES } from "../../lib/compras/requisiciones";
import { AccionRequisicion, InsumoPlanificado, InsumosResponse, Permiso, PRIORIDADES, Prioridad, Requisicion, RequisicionesResponse } from "../../lib/compras/types";
import { ApiError } from "../../lib/propiedades/client";
import { isoToDisplay, parseDisplayDate } from "../../lib/propiedades/values";
import { coincide, fmt } from "../../lib/presupuesto/format";
import { acceptButton, baseInput, C, labelStyle, message, Modal, Notice, NumInput, TextCommit } from "../presupuesto/ui";
import DateField from "../propiedades/DateField";
import { botonPeligro, botonSecundario, etiqueta, linkBtn, select, td, th } from "./estilos";

interface LineaBorrador {
  insumoId: string;
  partidaItemId: string | null;
  cantidad: number | null;
  justificacionExceso: string;
}

/** One requisition: its draft (resources from the budget, quantities, justification) or its decision. */
export default function RequisicionDialog({
  api,
  datos,
  insumos,
  requisicion,
  yo,
  permisos,
  onDatos,
  onAbrir,
  onRecargar,
  onSinAcceso,
  onClose,
}: {
  api: ComprasApi;
  datos: RequisicionesResponse;
  insumos: InsumosResponse | null;
  /** null: a new one. */
  requisicion: Requisicion | null;
  yo: string;
  permisos: Permiso[];
  onDatos: (d: RequisicionesResponse) => void;
  onAbrir: (id: string) => void;
  onRecargar: () => void;
  onSinAcceso: (err: unknown) => void;
  onClose: () => void;
}) {
  const r = requisicion;
  const [id] = useState(() => r?.id ?? globalThis.crypto.randomUUID());
  const editable = r ? puedeEditar(r, yo, permisos) : tiene(permisos, "requisiciones", "crear");
  const [fechaTexto, setFechaTexto] = useState(r ? isoToDisplay(r.fechaRequerida) : "");
  const [prioridad, setPrioridad] = useState<Prioridad>(r?.prioridad ?? "normal");
  const [justificacion, setJustificacion] = useState(r?.justificacion ?? "");
  const [lineas, setLineas] = useState<LineaBorrador[]>(
    () => r?.lineas.map((l) => ({ insumoId: l.insumoId, partidaItemId: l.partidaItemId, cantidad: l.cantidad, justificacionExceso: l.justificacionExceso })) ?? []
  );
  const [aprobadas, setAprobadas] = useState<Record<string, number>>(() => Object.fromEntries((r?.lineas ?? []).map((l) => [l.id, l.cantidad])));
  const [buscar, setBuscar] = useState("");
  const [pedirMotivo, setPedirMotivo] = useState<AccionRequisicion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const plan = useMemo(() => new Map((insumos?.insumos ?? []).map((i) => [i.id, i])), [insumos]);
  const planificados = useMemo(() => new Map((insumos?.insumos ?? []).map((i) => [i.id, i.cantidad])), [insumos]);
  const otros = useMemo(() => solicitadoPorInsumo(datos.requisiciones, r?.id), [datos.requisiciones, r?.id]);
  const tol = datos.config.toleranciaPct;
  const dato = (insumoId: string) => {
    const p = plan.get(insumoId);
    const s = r?.lineas.find((l) => l.insumoId === insumoId);
    return { descripcion: p?.descripcion ?? s?.descripcion ?? insumoId, codigo: p?.codigo ?? s?.codigo ?? "", unidad: p?.unidad ?? s?.unidad ?? "", precio: p?.precio ?? s?.precio ?? 0 };
  };

  // Over the budget while editing (what is typed) and while approving (what would be approved).
  const excesoBorrador = useMemo(
    () => new Set(excesos(lineas.map((l) => ({ insumoId: l.insumoId, descripcion: "", unidad: "", cantidad: l.cantidad ?? 0 })), planificados, tol, otros).map((e) => e.insumoId)),
    [lineas, planificados, tol, otros]
  );
  const excesoAprobacion = useMemo(
    () => (r && r.estado === "enviada" ? excesos(cantidadesAprobadas(r, aprobadas), planificados, tol, otros) : []),
    [r, aprobadas, planificados, tol, otros]
  );

  const candidatos = useMemo(() => {
    if (!buscar.trim()) return [];
    const usados = new Set(lineas.filter((l) => !l.partidaItemId).map((l) => l.insumoId));
    return (insumos?.insumos ?? []).filter((i) => !usados.has(i.id) && coincide(`${i.codigo} ${i.descripcion}`, buscar)).slice(0, 12);
  }, [buscar, insumos, lineas]);

  function agregar(i: InsumoPlanificado) {
    const disponible = Math.max(0, Math.round((limite(i.cantidad, tol) - (otros.get(i.id)?.solicitado ?? 0)) * 10_000) / 10_000);
    setLineas((ls) => [...ls, { insumoId: i.id, partidaItemId: null, cantidad: disponible > 0 ? disponible : null, justificacionExceso: "" }]);
    setBuscar("");
  }
  const cambiar = (n: number, patch: Partial<LineaBorrador>) => setLineas((ls) => ls.map((l, i) => (i === n ? { ...l, ...patch } : l)));

  const fechaIso = parseDisplayDate(fechaTexto);
  const problema = !editable
    ? ""
    : !fechaIso
      ? "Escribe la fecha requerida como DD-MM-AAAA."
      : lineas.some((l) => !l.cantidad || l.cantidad <= 0)
        ? "Cada insumo necesita una cantidad mayor que cero."
        : "";
  const paraEnviar = problema
    ? problema
    : !lineas.length
      ? "Agrega al menos un insumo."
      : !justificacion.trim()
        ? "Escribe para qué se necesita (justificación)."
        : fechaIso && fechaIso < datos.hoy
          ? "La fecha requerida ya pasó."
          : lineas.some((l) => excesoBorrador.has(l.insumoId) && !l.justificacionExceso.trim())
            ? "Justifica las líneas que pasan el presupuesto."
            : "";

  function fallo(err: unknown) {
    setBusy(false);
    setError(message(err));
    if (err instanceof ApiError && err.code === "version-conflict") onRecargar();
    onSinAcceso(err);
  }

  async function guardar(): Promise<RequisicionesResponse | null> {
    if (problema || !fechaIso) return null;
    const d = await api.guardarRequisicion({
      id,
      fechaRequerida: fechaIso,
      prioridad,
      justificacion: justificacion.trim(),
      lineas: lineas.map((l) => ({ insumoId: l.insumoId, partidaItemId: l.partidaItemId, cantidad: l.cantidad ?? 0, justificacionExceso: l.justificacionExceso.trim() })),
      version: r?.version ?? 0,
    });
    return d;
  }

  async function soloGuardar() {
    setBusy(true);
    setError("");
    try {
      const d = await guardar();
      if (d) {
        onDatos(d);
        onAbrir(id);
      }
      setBusy(false);
    } catch (err) {
      fallo(err);
    }
  }

  async function guardarYEnviar() {
    setBusy(true);
    setError("");
    try {
      const d = await guardar();
      const guardada = d?.requisiciones.find((x) => x.id === id);
      if (!d || !guardada) return setBusy(false);
      onDatos(d);
      onDatos(await api.accionRequisicion(id, { accion: "enviar", motivo: "", version: guardada.version }));
      onAbrir(id);
    } catch (err) {
      fallo(err);
    }
  }

  async function decidir(accion: AccionRequisicion, motivo: string) {
    if (!r) return;
    setBusy(true);
    setError("");
    try {
      onDatos(await api.accionRequisicion(r.id, { accion, motivo, ...(accion === "aprobar" ? { aprobadas } : {}), version: r.version }));
      setPedirMotivo(null);
      onAbrir(r.id);
    } catch (err) {
      setPedirMotivo(null);
      fallo(err);
    }
  }

  const ctxAcc = { actorId: yo, permisos };
  const puedeExceder = tiene(permisos, "requisiciones", "exceder");
  const aprobando = !!r && puedeAccion(ctxAcc, r, "aprobar");
  const estado = r ? ESTADOS_REQUISICION[r.estado] : ESTADOS_REQUISICION.borrador;
  const valor = lineas.reduce((s, l) => s + (l.cantidad ?? 0) * dato(l.insumoId).precio, 0);

  return (
    <Modal
      title={r ? `${numeroRequisicion(r.numero)} · ${r.solicitanteNombre}` : "Nueva requisición"}
      width={1100}
      height="90vh"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <span style={{ marginRight: "auto", fontSize: 13, color: "var(--tc-gray-500)" }}>
            {editable ? paraEnviar || `Valor estimado: ${fmt(valor)}` : `Valor estimado: ${fmt(valor)}`}
          </span>
          {editable && (
            <>
              <button type="button" onClick={soloGuardar} disabled={busy || !!problema} style={{ ...botonSecundario, opacity: problema ? 0.5 : 1 }}>
                Guardar borrador
              </button>
              <button type="button" onClick={guardarYEnviar} disabled={busy || !!paraEnviar} style={{ ...acceptButton, opacity: paraEnviar ? 0.5 : 1 }} title="Guarda y la manda a aprobación">
                {busy ? "Guardando…" : "Enviar a aprobación"}
              </button>
            </>
          )}
          {aprobando && (
            <>
              <button type="button" onClick={() => setPedirMotivo("devolver")} disabled={busy} style={botonSecundario}>
                Devolver
              </button>
              <button type="button" onClick={() => setPedirMotivo("rechazar")} disabled={busy} style={botonPeligro}>
                Rechazar
              </button>
              <button
                type="button"
                onClick={() => setPedirMotivo("aprobar")}
                disabled={busy || (excesoAprobacion.length > 0 && !puedeExceder)}
                style={{ ...acceptButton, opacity: excesoAprobacion.length > 0 && !puedeExceder ? 0.5 : 1 }}
              >
                Aprobar
              </button>
            </>
          )}
          {r && puedeAccion(ctxAcc, r, "anular") && (
            <button type="button" onClick={() => setPedirMotivo("anular")} disabled={busy} style={{ ...botonSecundario, color: C.close }}>
              Anular
            </button>
          )}
        </>
      }
    >
      <div style={{ padding: 14, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
          <span style={etiqueta(estado.color, estado.fondo)}>{estado.texto}</span>
          {r && <span style={{ color: "var(--tc-gray-500)" }}>{historial(r)}</span>}
        </div>
        {r?.motivo && (r.estado === "borrador" || r.estado === "rechazada" || r.estado === "anulada" || r.estado === "aprobada") && (
          <Notice kind={r.estado === "aprobada" ? "info" : "warning"}>
            {r.estado === "borrador" ? "Devuelta para corregir" : r.estado === "aprobada" ? "Nota de la aprobación" : `Motivo (${estado.texto.toLowerCase()})`}: {r.motivo}
          </Notice>
        )}
        {!insumos && <Notice kind="info">Tu rol no consulta los insumos del presupuesto: ves la requisición tal como se guardó.</Notice>}

        <div style={{ display: "grid", gridTemplateColumns: "200px 160px 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="req-fecha">
              Fecha requerida en obra
            </label>
            {editable ? (
              <DateField id="req-fecha" text={fechaTexto} placeholder="DD-MM-AAAA" invalid={!!fechaTexto && !fechaIso} onText={setFechaTexto} />
            ) : (
              <div style={valorFijo}>{fecha(r?.fechaRequerida ?? null)}</div>
            )}
          </div>
          <div>
            <label style={labelStyle} htmlFor="req-prioridad">
              Prioridad
            </label>
            {editable ? (
              <select id="req-prioridad" value={prioridad} onChange={(e) => setPrioridad(e.target.value as Prioridad)} style={{ ...select, width: "100%" }}>
                {PRIORIDADES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            ) : (
              <div style={valorFijo}>{PRIORIDADES.find((p) => p.id === r?.prioridad)?.nombre}</div>
            )}
          </div>
          <div>
            <label style={labelStyle} htmlFor="req-justificacion">
              Para qué se necesita (justificación)
            </label>
            {editable ? (
              <textarea
                id="req-justificacion"
                value={justificacion}
                maxLength={1000}
                rows={2}
                onChange={(e) => setJustificacion(e.target.value)}
                style={{ ...baseInput, width: "100%", resize: "vertical" }}
                placeholder="Ej.: muros del piso 2, ejes A a C, según programación de la semana 43"
              />
            ) : (
              <div style={valorFijo}>{r?.justificacion}</div>
            )}
          </div>
        </div>

        {editable && insumos && (
          <div style={{ position: "relative" }}>
            <input
              type="search"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              placeholder="＋ Agregar un insumo del presupuesto: escribe código o descripción"
              style={{ ...baseInput, width: "100%" }}
              aria-label="Agregar insumo"
            />
            {candidatos.length > 0 && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20, background: "#fff", border: `1px solid ${C.border}`, boxShadow: "0 6px 18px rgba(0,0,0,0.15)", maxHeight: 280, overflow: "auto" }}>
                {candidatos.map((i) => {
                  const disponible = limite(i.cantidad, tol) - (otros.get(i.id)?.solicitado ?? 0);
                  return (
                    <button key={i.id} type="button" onClick={() => agregar(i)} style={opcion}>
                      <span>
                        <span style={{ color: "var(--tc-gray-500)" }}>{i.codigo}</span> {i.descripcion} <span style={{ color: "var(--tc-gray-500)" }}>({i.unidad})</span>
                      </span>
                      <span style={{ fontSize: 12, color: disponible > 0 ? "var(--tc-gray-500)" : "#b3261e", whiteSpace: "nowrap" }}>
                        Disponible {fmt(disponible, 4)} de {fmt(i.cantidad, 4)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div style={{ overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Insumo</th>
                <th style={th}>Partida</th>
                <th style={th}>Und</th>
                <th style={{ ...th, textAlign: "right" }}>Cantidad</th>
                {aprobando && <th style={{ ...th, textAlign: "right" }}>Aprobar</th>}
                {r?.estado === "aprobada" && <th style={{ ...th, textAlign: "right" }}>Aprobada</th>}
                <th style={{ ...th, textAlign: "right" }} title="Cantidad planificada en el presupuesto">
                  Planificado
                </th>
                <th style={{ ...th, textAlign: "right" }} title="Ya pedido en otras requisiciones enviadas o aprobadas">
                  Pedido en otras
                </th>
                <th style={{ ...th, textAlign: "right" }} title={`Planificado + ${fmt(tol)} % de tolerancia − pedido en otras`}>
                  Disponible
                </th>
                <th style={{ ...th, textAlign: "right" }}>Valor est.</th>
                {editable && <th style={th} aria-label="Quitar" />}
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, n) => {
                const d = dato(l.insumoId);
                const p = plan.get(l.insumoId);
                const pedidoOtros = otros.get(l.insumoId)?.solicitado ?? 0;
                const disponible = limite(p?.cantidad ?? 0, tol) - pedidoOtros;
                const guardada = r?.lineas.find((x) => x.insumoId === l.insumoId && x.partidaItemId === l.partidaItemId);
                const pasa = editable ? excesoBorrador.has(l.insumoId) : !!l.justificacionExceso;
                return (
                  <tr key={`${l.insumoId}|${l.partidaItemId ?? ""}|${n}`} style={{ background: pasa ? "#fff8e6" : undefined }}>
                    <td style={td}>
                      <div>
                        <span style={{ color: "var(--tc-gray-500)" }}>{d.codigo}</span> {d.descripcion}
                      </div>
                      {!p && insumos && <div style={{ fontSize: 12, color: "#b3261e" }}>Ya no está en el presupuesto vigente.</div>}
                      {pasa && (
                        <div style={{ marginTop: 4 }}>
                          <span style={{ fontSize: 12, color: "#a35200" }}>Pasa lo que queda del presupuesto. Justificación del exceso:</span>
                          {editable ? (
                            <TextCommit
                              value={l.justificacionExceso}
                              onCommit={(v) => cambiar(n, { justificacionExceso: v })}
                              maxLength={500}
                              placeholder="Por qué se necesita más de lo planificado"
                              style={{ width: "100%", marginTop: 2 }}
                              ariaLabel={`Justificación del exceso de ${d.descripcion}`}
                            />
                          ) : (
                            <div style={{ fontSize: 12.5 }}>{l.justificacionExceso}</div>
                          )}
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, minWidth: 180 }}>
                      {editable && p ? (
                        <select
                          value={l.partidaItemId ?? ""}
                          onChange={(e) => cambiar(n, { partidaItemId: e.target.value || null })}
                          style={{ ...select, width: "100%", fontSize: 12.5 }}
                          aria-label={`Partida de ${d.descripcion}`}
                        >
                          <option value="">Todo el proyecto</option>
                          {p.usos.map((u) => (
                            <option key={u.itemId} value={u.itemId}>
                              {u.numero} {u.descripcion}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ fontSize: 12.5 }}>{l.partidaItemId ? partidaTexto(p, l.partidaItemId) : "Todo el proyecto"}</span>
                      )}
                    </td>
                    <td style={td}>{d.unidad}</td>
                    <td style={{ ...num, minWidth: 110 }}>
                      {editable ? (
                        <NumInput value={l.cantidad} decimals={4} onCommit={(v) => cambiar(n, { cantidad: v })} allowEmpty ariaLabel={`Cantidad de ${d.descripcion}`} style={{ width: 110, textAlign: "right" }} />
                      ) : (
                        fmt(l.cantidad ?? 0, 4)
                      )}
                    </td>
                    {aprobando && guardada && (
                      <td style={{ ...num, minWidth: 110 }}>
                        <NumInput
                          value={aprobadas[guardada.id] ?? guardada.cantidad}
                          decimals={4}
                          onCommit={(v) => setAprobadas((a) => ({ ...a, [guardada.id]: v ?? 0 }))}
                          ariaLabel={`Cantidad a aprobar de ${d.descripcion}`}
                          style={{ width: 110, textAlign: "right" }}
                        />
                      </td>
                    )}
                    {r?.estado === "aprobada" && <td style={num}>{fmt(guardada?.cantidadAprobada ?? 0, 4)}</td>}
                    <td style={num}>{p ? fmt(p.cantidad, 4) : guardada?.planificado !== null && guardada?.planificado !== undefined ? fmt(guardada.planificado, 4) : "—"}</td>
                    <td style={num}>{fmt(pedidoOtros, 4)}</td>
                    <td style={{ ...num, color: disponible < (l.cantidad ?? 0) ? "#b3261e" : undefined }}>{insumos ? fmt(disponible, 4) : "—"}</td>
                    <td style={num}>{fmt((l.cantidad ?? 0) * d.precio)}</td>
                    {editable && (
                      <td style={td}>
                        <button type="button" onClick={() => setLineas((ls) => ls.filter((_, i) => i !== n))} style={{ ...linkBtn, color: C.close, textDecoration: "none" }} aria-label={`Quitar ${d.descripcion}`}>
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {lineas.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ ...td, color: "var(--tc-gray-500)" }}>
                    {editable ? "Busca arriba los insumos que necesitas." : "Sin insumos."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {aprobando && excesoAprobacion.length > 0 && (
          <Notice kind={puedeExceder ? "warning" : "error"}>
            Lo que se aprobaría pasa el presupuesto en: {excesoAprobacion.map((e) => `${e.descripcion} (límite ${fmt(e.limite, 4)}, con esto ${fmt(e.otros + e.pedido, 4)})`).join("; ")}.{" "}
            {puedeExceder ? "Tienes el permiso para aprobarlo sobre el presupuesto." : "Baja las cantidades a aprobar o pide a quien tenga el permiso “Aprobar sobre el presupuesto”."}
          </Notice>
        )}
        {error && <Notice kind="error">{error}</Notice>}
      </div>

      {pedirMotivo && (
        <MotivoDialog
          accion={pedirMotivo}
          busy={busy}
          onConfirmar={(m) => decidir(pedirMotivo, m)}
          onClose={() => setPedirMotivo(null)}
        />
      )}
    </Modal>
  );
}

function partidaTexto(p: InsumoPlanificado | undefined, itemId: string): string {
  const u = p?.usos.find((x) => x.itemId === itemId);
  return u ? `${u.numero} ${u.descripcion}` : "Partida que ya no usa este insumo";
}

function historial(r: Requisicion): string {
  const partes = [`Creada el ${fechaHora(r.creada)}`];
  if (r.enviada) partes.push(`enviada el ${fechaHora(r.enviada)}${r.enviadaPor ? ` por ${r.enviadaPor}` : ""}`);
  if (r.decidida && r.estado !== "enviada") partes.push(`${r.estado === "borrador" ? "devuelta" : ESTADOS_REQUISICION[r.estado].texto.toLowerCase()} el ${fechaHora(r.decidida)}${r.decididaPor ? ` por ${r.decididaPor}` : ""}`);
  if (r.presupuestoVersion) partes.push(`contra la versión ${r.presupuestoVersion} del presupuesto`);
  return partes.join(" · ");
}

function MotivoDialog({ accion, busy, onConfirmar, onClose }: { accion: AccionRequisicion; busy: boolean; onConfirmar: (motivo: string) => void; onClose: () => void }) {
  const [motivo, setMotivo] = useState("");
  const opcional = accion === "aprobar";
  const listo = opcional || !!motivo.trim();
  const ayuda: Partial<Record<AccionRequisicion, string>> = {
    aprobar: "Nota de la aprobación (opcional).",
    devolver: "Qué debe corregir quien la pidió. Vuelve a borrador.",
    rechazar: "Por qué se rechaza. Es definitivo.",
    anular: "Por qué se anula. Es definitivo y no se borra.",
  };
  return (
    <Modal
      title={TRANSICIONES[accion].nombre}
      width={520}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} style={botonSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={() => onConfirmar(motivo.trim())} disabled={busy || !listo} style={{ ...(accion === "aprobar" ? acceptButton : botonPeligro), opacity: listo ? 1 : 0.5 }}>
            {busy ? "Guardando…" : TRANSICIONES[accion].nombre}
          </button>
        </>
      }
    >
      <div style={{ padding: 16, display: "grid", gap: 8 }}>
        <label style={labelStyle} htmlFor="motivo">
          {ayuda[accion]}
        </label>
        <textarea id="motivo" autoFocus rows={3} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ ...baseInput, width: "100%", resize: "vertical" }} />
      </div>
    </Modal>
  );
}

const num: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const valorFijo: CSSProperties = { fontSize: 13.5, padding: "5px 0", whiteSpace: "pre-wrap" };
const opcion: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  width: "100%",
  textAlign: "left",
  border: "none",
  borderBottom: `1px solid ${C.grid}`,
  background: "#fff",
  padding: "7px 10px",
  fontSize: 13.5,
  cursor: "pointer",
  fontFamily: "inherit",
};
