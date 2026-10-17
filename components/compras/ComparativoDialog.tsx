"use client";

import { CSSProperties, useMemo, useState } from "react";
import { tiene } from "../../lib/compras/accesos";
import type { ComprasApi } from "../../lib/compras/client";
import { cobertura, ESTADOS_COMPARATIVO, evaluar, lineasAprobadas, numeroCotizacion, razonesJustificacion, totalesCotizacion, totalesLinea } from "../../lib/compras/cotizaciones";
import { fecha, fechaHora } from "../../lib/compras/formato";
import { nitConDv } from "../../lib/compras/proveedores";
import { numeroRequisicion } from "../../lib/compras/requisiciones";
import { AccionComparativo, Cotizacion, CotizacionesResponse, Criterios, CRITERIOS_INICIALES, Permiso, Requisicion } from "../../lib/compras/types";
import { fmt } from "../../lib/presupuesto/format";
import { ApiError } from "../../lib/propiedades/client";
import { isoToDisplay, parseDisplayDate } from "../../lib/propiedades/values";
import { acceptButton, baseInput, C, labelStyle, message, Modal, Notice, NumInput } from "../presupuesto/ui";
import DateField from "../propiedades/DateField";
import DocumentosRegistro from "./DocumentosRegistro";
import { botonPeligro, botonSecundario, etiqueta, linkBtn, select, subtitulo, td, th } from "./estilos";

/** A requisition's quotations side by side, their scores, and the choice of supplier (proposed, then approved). */
export default function ComparativoDialog({
  api,
  datos,
  requisicion: r,
  yo,
  permisos,
  onDatos,
  onRecargar,
  onSinAcceso,
  onClose,
}: {
  api: ComprasApi;
  datos: CotizacionesResponse;
  requisicion: Requisicion;
  yo: string;
  permisos: Permiso[];
  onDatos: (d: CotizacionesResponse) => void;
  onRecargar: () => void;
  onSinAcceso: (err: unknown) => void;
  onClose: () => void;
}) {
  const comp = datos.comparativos.find((c) => c.requisicionId === r.id);
  const estado = comp?.estado ?? "borrador";
  const prepara = tiene(permisos, "cotizaciones", "crear") || tiene(permisos, "cotizaciones", "editar");
  const abierto = estado === "borrador";
  const decide = estado === "propuesto" && tiene(permisos, "cotizaciones", "aprobar") && comp?.propuestoPorId !== yo;
  const [criterios, setCriterios] = useState<Criterios>(comp?.criterios ?? CRITERIOS_INICIALES);
  const [elegida, setElegida] = useState<string | null>(comp?.cotizacionElegidaId ?? null);
  const [justificacion, setJustificacion] = useState(comp?.justificacion ?? "");
  const [editarCot, setEditarCot] = useState<Cotizacion | "nueva" | null>(null);
  const [anular, setAnular] = useState<Cotizacion | null>(null);
  const [pedirMotivo, setPedirMotivo] = useState<"aprobar" | "devolver" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const proveedores = useMemo(() => new Map(datos.proveedores.map((p) => [p.id, p])), [datos.proveedores]);
  const cots = datos.cotizaciones.filter((c) => c.requisicionId === r.id && c.estado === "registrada").sort((a, b) => a.numero - b.numero);
  const anuladas = datos.cotizaciones.filter((c) => c.requisicionId === r.id && c.estado === "anulada");
  const pesosOk = [criterios.precio, criterios.entrega, criterios.pago].every((x) => Number.isInteger(x) && x >= 0) && criterios.precio + criterios.entrega + criterios.pago === 100;
  const evaluaciones = useMemo(() => evaluar(cots, r, proveedores, pesosOk ? criterios : CRITERIOS_INICIALES, datos.hoy), [cots, r, proveedores, criterios, pesosOk, datos.hoy]);
  const ev = (id: string) => evaluaciones.find((e) => e.cotizacionId === id);
  const razones = razonesJustificacion(evaluaciones, elegida, datos.config.minCotizaciones);
  const lineas = lineasAprobadas(r);

  async function accion(a: AccionComparativo, motivo = "") {
    setBusy(true);
    setError("");
    try {
      onDatos(await api.accionComparativo(r.id, { accion: a, criterios, cotizacionElegidaId: elegida, justificacion: justificacion.trim(), motivo, version: comp?.version ?? 0 }));
    } catch (err) {
      setBusy(false);
      setPedirMotivo(null);
      setError(message(err));
      if (err instanceof ApiError && err.code === "version-conflict") onRecargar();
      onSinAcceso(err);
    }
  }

  const e = ESTADOS_COMPARATIVO[comp ? comp.estado : "sin"];
  const paraProponer = !pesosOk
    ? "Los pesos deben sumar 100."
    : !elegida
      ? "Elige la cotización."
      : !ev(elegida)?.elegible
        ? "La elegida no se puede elegir (vencida o proveedor no activo)."
        : razones.length && !justificacion.trim()
          ? "Escribe la justificación de la elección."
          : "";

  return (
    <Modal
      title={`${numeroRequisicion(r.numero)} · comparativo de cotizaciones`}
      width={1200}
      height="92vh"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <span style={{ marginRight: "auto", fontSize: 13, color: "var(--tc-gray-500)" }}>{abierto && prepara ? paraProponer : ""}</span>
          {abierto && prepara && (
            <>
              <button type="button" onClick={() => accion("guardar")} disabled={busy || !pesosOk} style={botonSecundario}>
                Guardar
              </button>
              <button type="button" onClick={() => accion("proponer")} disabled={busy || !!paraProponer} style={{ ...acceptButton, opacity: paraProponer ? 0.5 : 1 }}>
                Proponer este proveedor
              </button>
            </>
          )}
          {decide && (
            <>
              <button type="button" onClick={() => setPedirMotivo("devolver")} disabled={busy} style={botonSecundario}>
                Devolver
              </button>
              <button type="button" onClick={() => setPedirMotivo("aprobar")} disabled={busy} style={acceptButton}>
                Aprobar proveedor
              </button>
            </>
          )}
        </>
      }
    >
      <div style={{ padding: 14, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
          <span style={etiqueta(e.color, e.fondo)}>{e.texto}</span>
          <span style={{ color: "var(--tc-gray-500)" }}>
            Pedida por {r.solicitanteNombre} para el {fecha(r.fechaRequerida)}: {r.justificacion}
          </span>
        </div>
        {comp?.propuesto && (
          <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>
            Propuesto por {comp.propuestoPor} el {fechaHora(comp.propuesto)}
            {comp.aprobado ? ` · aprobado por ${comp.aprobadoPor} el ${fechaHora(comp.aprobado)}` : ""}
          </span>
        )}
        {comp?.motivo && <Notice kind={estado === "borrador" ? "warning" : "info"}>{estado === "borrador" ? `Devuelto: ${comp.motivo}` : `Nota: ${comp.motivo}`}</Notice>}
        {estado === "propuesto" && comp?.propuestoPorId === yo && tiene(permisos, "cotizaciones", "aprobar") && (
          <Notice kind="info">Tú lo propusiste: lo aprueba otra persona.</Notice>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {abierto && tiene(permisos, "cotizaciones", "crear") && (
            <button type="button" onClick={() => setEditarCot("nueva")} style={{ ...acceptButton, padding: "6px 14px", fontSize: 14 }}>
              ＋ Registrar cotización
            </button>
          )}
          <span style={{ fontSize: 13, color: cots.length < datos.config.minCotizaciones ? "#a35200" : "var(--tc-gray-500)" }}>
            {cots.length} cotización(es) registrada(s); se esperan {datos.config.minCotizaciones}.
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 13 }}>Pesos:</span>
          {(["precio", "entrega", "pago"] as const).map((k) => (
            <label key={k} style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 4 }}>
              {k === "precio" ? "Precio" : k === "entrega" ? "Entrega" : "Pago"}
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={criterios[k]}
                disabled={!abierto || !prepara}
                onChange={(ev2) => setCriterios({ ...criterios, [k]: Number(ev2.target.value) })}
                style={{ ...baseInput, width: 58, textAlign: "right" }}
                aria-label={`Peso ${k}`}
              />
            </label>
          ))}
          <span style={{ fontSize: 12.5, color: pesosOk ? "var(--tc-gray-500)" : "#b3261e" }}>= {criterios.precio + criterios.entrega + criterios.pago}</span>
        </div>

        {cots.length === 0 ? (
          <Notice kind="info">Todavía no hay cotizaciones para esta requisición.</Notice>
        ) : (
          <div style={{ overflow: "auto", border: `1px solid ${C.border}` }}>
            <table style={{ borderCollapse: "collapse", minWidth: "100%" }}>
              <thead>
                <tr>
                  <th style={{ ...th, minWidth: 220 }}>Insumo</th>
                  <th style={{ ...th, textAlign: "right" }}>Aprobado</th>
                  <th style={{ ...th, textAlign: "right" }} title="Precio unitario del presupuesto">
                    Presupuesto
                  </th>
                  {cots.map((c) => {
                    const p = proveedores.get(c.proveedorId);
                    const x = ev(c.id);
                    return (
                      <th key={c.id} style={{ ...th, minWidth: 170, textAlign: "right", background: elegida === c.id ? "#eef6ea" : "#fff", whiteSpace: "normal" }}>
                        <div style={{ color: "var(--tc-gray-700)" }}>{p?.razonSocial ?? "?"}</div>
                        <div style={{ fontWeight: 400 }}>
                          {numeroCotizacion(c.numero)}
                          {x?.mejor && <span style={{ ...etiqueta("#2e6b22", "#e3f3de"), marginLeft: 4 }}>Mejor</span>}
                        </div>
                        {abierto && (
                          <div style={{ fontWeight: 400 }}>
                            {tiene(permisos, "cotizaciones", "editar") && (
                              <button type="button" onClick={() => setEditarCot(c)} style={{ ...linkBtn, fontSize: 12 }}>
                                Corregir
                              </button>
                            )}{" "}
                            {tiene(permisos, "cotizaciones", "anular") && (
                              <button type="button" onClick={() => setAnular(c)} style={{ ...linkBtn, fontSize: 12, color: C.close }}>
                                Anular
                              </button>
                            )}
                          </div>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {lineas.map((l) => (
                  <tr key={l.id}>
                    <td style={td}>
                      {l.descripcion} <span style={{ color: "var(--tc-gray-500)" }}>({l.unidad})</span>
                    </td>
                    <td style={num}>{fmt(l.cantidadAprobada ?? 0, 4)}</td>
                    <td style={num}>{fmt(l.precio)}</td>
                    {cots.map((c) => {
                      const cl = c.lineas.find((x) => x.requisicionLineaId === l.id);
                      if (!cl) return <td key={c.id} style={{ ...num, color: "#b3261e", background: elegida === c.id ? "#f6fbf4" : undefined }}>No cotiza</td>;
                      const t = totalesLinea(cl);
                      const unitario = cl.cantidad ? t.neto / cl.cantidad : 0;
                      const dif = l.precio ? ((unitario - l.precio) / l.precio) * 100 : 0;
                      return (
                        <td key={c.id} style={{ ...num, background: elegida === c.id ? "#f6fbf4" : undefined }} title={`Neto unitario ${fmt(unitario)} · IVA ${fmt(cl.ivaPct)} %`}>
                          {fmt(unitario)}
                          <span style={{ fontSize: 11.5, marginLeft: 4, color: dif > 0 ? "#b3261e" : "#2e6b22" }}>
                            {dif > 0 ? "+" : ""}
                            {fmt(dif, 1)} %
                          </span>
                          {cl.cantidad < (l.cantidadAprobada ?? 0) && <div style={{ fontSize: 11.5, color: "#a35200" }}>solo {fmt(cl.cantidad, 4)}</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <Fila etiqueta="Subtotal (sin IVA)" cots={cots} elegida={elegida} valor={(c) => fmt(totalesCotizacion(c).neto)} fuerte />
                <Fila etiqueta="IVA" cots={cots} elegida={elegida} valor={(c) => fmt(totalesCotizacion(c).iva)} />
                <Fila etiqueta="Total" cots={cots} elegida={elegida} valor={(c) => fmt(totalesCotizacion(c).total)} fuerte />
                <Fila etiqueta="Entrega" cots={cots} elegida={elegida} valor={(c) => `${c.plazoEntregaDias} día(s)`} />
                <Fila etiqueta="Pago" cots={cots} elegida={elegida} valor={(c) => `${c.diasPago ? `${c.diasPago} días` : "Contado"}${c.anticipoPct ? `, anticipo ${fmt(c.anticipoPct)} %` : ""}`} />
                <Fila
                  etiqueta="Vigencia"
                  cots={cots}
                  elegida={elegida}
                  valor={(c) => (
                    <span style={{ color: c.vigenciaHasta < datos.hoy ? "#b3261e" : undefined }}>
                      hasta {fecha(c.vigenciaHasta)}
                    </span>
                  )}
                />
                <Fila
                  etiqueta="Cubre lo aprobado"
                  cots={cots}
                  elegida={elegida}
                  valor={(c) => {
                    const x = cobertura(c, r);
                    return <span style={{ color: x.completa ? "#2e6b22" : "#a35200" }}>{x.completa ? "Todo" : `${x.cubiertas} de ${x.de}`}</span>;
                  }}
                />
                <Fila
                  etiqueta="Puntaje (precio · entrega · pago)"
                  cots={cots}
                  elegida={elegida}
                  valor={(c) => {
                    const x = ev(c.id);
                    if (!x?.elegible) return <span style={{ color: "#b3261e" }}>{x?.motivo}</span>;
                    return (
                      <span title={`Precio ${fmt(x.puntajes.precio)} · Entrega ${fmt(x.puntajes.entrega)} · Pago ${fmt(x.puntajes.pago)}`}>
                        <strong>{fmt(x.puntaje)}</strong>
                        <span style={{ fontSize: 11.5, color: "var(--tc-gray-500)" }}>
                          {" "}
                          ({fmt(x.puntajes.precio, 0)} · {fmt(x.puntajes.entrega, 0)} · {fmt(x.puntajes.pago, 0)})
                        </span>
                      </span>
                    );
                  }}
                />
                <tr>
                  <td style={{ ...td, fontWeight: 600 }} colSpan={3}>
                    Elegida
                  </td>
                  {cots.map((c) => (
                    <td key={c.id} style={{ ...td, textAlign: "right", background: elegida === c.id ? "#eef6ea" : undefined }}>
                      <input
                        type="radio"
                        name="elegida"
                        checked={elegida === c.id}
                        disabled={!abierto || !prepara || !ev(c.id)?.elegible}
                        onChange={() => setElegida(c.id)}
                        aria-label={`Elegir ${proveedores.get(c.proveedorId)?.razonSocial ?? ""}`}
                      />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div>
          <label style={labelStyle} htmlFor="comp-justificacion">
            Justificación de la elección {razones.length ? "(obligatoria)" : "(opcional)"}
          </label>
          {razones.length > 0 && abierto && (
            <ul style={{ margin: "0 0 6px", paddingLeft: 18, fontSize: 13, color: "#a35200" }}>
              {razones.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
          {abierto && prepara ? (
            <textarea
              id="comp-justificacion"
              rows={2}
              maxLength={1000}
              value={justificacion}
              onChange={(ev2) => setJustificacion(ev2.target.value)}
              style={{ ...baseInput, width: "100%", resize: "vertical" }}
              placeholder="Ej.: único proveedor con disponibilidad inmediata en la zona"
            />
          ) : (
            <div style={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>{comp?.justificacion || "—"}</div>
          )}
        </div>
        {anuladas.length > 0 && (
          <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: 0 }}>
            Anuladas: {anuladas.map((c) => `${numeroCotizacion(c.numero)} ${proveedores.get(c.proveedorId)?.razonSocial ?? ""} (${c.motivo})`).join("; ")}
          </p>
        )}
        {error && <Notice kind="error">{error}</Notice>}
      </div>

      {editarCot && (
        <CotizacionDialog
          api={api}
          datos={datos}
          requisicion={r}
          cotizacion={editarCot === "nueva" ? null : editarCot}
          permisos={permisos}
          onGuardado={(d) => {
            onDatos(d);
            setEditarCot(null);
          }}
          onClose={() => setEditarCot(null)}
        />
      )}
      {anular && (
        <MotivoDialog
          titulo={`Anular ${numeroCotizacion(anular.numero)}`}
          ayuda="Por qué se anula. No se borra y queda en la auditoría."
          boton="Anular"
          peligro
          busy={busy}
          onConfirmar={async (motivo) => {
            setBusy(true);
            setError("");
            try {
              onDatos(await api.anularCotizacion(anular.id, motivo, anular.version));
              setAnular(null);
              setBusy(false);
            } catch (err) {
              setBusy(false);
              setAnular(null);
              setError(message(err));
            }
          }}
          onClose={() => setAnular(null)}
        />
      )}
      {pedirMotivo && (
        <MotivoDialog
          titulo={pedirMotivo === "aprobar" ? "Aprobar proveedor" : "Devolver comparativo"}
          ayuda={pedirMotivo === "aprobar" ? "Nota de la aprobación (opcional)." : "Qué debe revisar quien lo propuso."}
          boton={pedirMotivo === "aprobar" ? "Aprobar" : "Devolver"}
          opcional={pedirMotivo === "aprobar"}
          busy={busy}
          onConfirmar={(m) => accion(pedirMotivo, m)}
          onClose={() => setPedirMotivo(null)}
        />
      )}
    </Modal>
  );
}

function Fila({ etiqueta: texto, cots, elegida, valor, fuerte }: { etiqueta: string; cots: Cotizacion[]; elegida: string | null; valor: (c: Cotizacion) => React.ReactNode; fuerte?: boolean }) {
  return (
    <tr style={{ background: "#fafbfc" }}>
      <td style={{ ...td, fontWeight: fuerte ? 700 : 600 }} colSpan={3}>
        {texto}
      </td>
      {cots.map((c) => (
        <td key={c.id} style={{ ...num, fontWeight: fuerte ? 700 : 400, background: elegida === c.id ? "#eef6ea" : undefined }}>
          {valor(c)}
        </td>
      ))}
    </tr>
  );
}

interface LineaEdicion {
  cotiza: boolean;
  cantidad: number | null;
  precio: number | null;
  descuento: number | null;
  iva: number | null;
}

function CotizacionDialog({
  api,
  datos,
  requisicion: r,
  cotizacion: c,
  permisos,
  onGuardado,
  onClose,
}: {
  api: ComprasApi;
  datos: CotizacionesResponse;
  requisicion: Requisicion;
  cotizacion: Cotizacion | null;
  permisos: Permiso[];
  onGuardado: (d: CotizacionesResponse) => void;
  onClose: () => void;
}) {
  const ocupados = new Set(datos.cotizaciones.filter((x) => x.requisicionId === r.id && x.estado === "registrada" && x.id !== c?.id).map((x) => x.proveedorId));
  const disponibles = datos.proveedores.filter((p) => p.estado === "activo" && !ocupados.has(p.id));
  const [proveedorId, setProveedorId] = useState(c?.proveedorId ?? "");
  const [referencia, setReferencia] = useState(c?.referencia ?? "");
  const [fechaTexto, setFechaTexto] = useState(isoToDisplay(c?.fecha ?? datos.hoy));
  const [vigenciaTexto, setVigenciaTexto] = useState(c ? isoToDisplay(c.vigenciaHasta) : "");
  const [plazo, setPlazo] = useState<number | null>(c?.plazoEntregaDias ?? null);
  const [diasPago, setDiasPago] = useState<number | null>(c?.diasPago ?? 0);
  const [anticipo, setAnticipo] = useState<number | null>(c?.anticipoPct ?? 0);
  const [formaPago, setFormaPago] = useState(c?.formaPago ?? "");
  const [observaciones, setObservaciones] = useState(c?.observaciones ?? "");
  const proveedor = datos.proveedores.find((p) => p.id === proveedorId);
  const [lineas, setLineas] = useState<Record<string, LineaEdicion>>(() =>
    Object.fromEntries(
      lineasAprobadas(r).map((l) => {
        const cl = c?.lineas.find((x) => x.requisicionLineaId === l.id);
        return [l.id, { cotiza: c ? !!cl : true, cantidad: cl?.cantidad ?? l.cantidadAprobada, precio: cl?.precioUnitario ?? null, descuento: cl?.descuentoPct ?? 0, iva: cl?.ivaPct ?? 19 }];
      })
    )
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const fechaIso = parseDisplayDate(fechaTexto);
  const vigenciaIso = parseDisplayDate(vigenciaTexto);
  const elegidas = lineasAprobadas(r).filter((l) => lineas[l.id]?.cotiza);
  const problema = !proveedorId
    ? "Elige el proveedor."
    : !fechaIso || !vigenciaIso
      ? "Escribe la fecha y la vigencia como DD-MM-AAAA."
      : vigenciaIso < fechaIso
        ? "La vigencia no puede terminar antes de la fecha."
        : plazo === null
          ? "Escribe el plazo de entrega en días."
          : !elegidas.length
            ? "Marca al menos un insumo cotizado."
            : elegidas.some((l) => lineas[l.id].precio === null || !lineas[l.id].cantidad)
              ? "Cada insumo cotizado necesita cantidad y precio."
              : elegidas.some((l) => (lineas[l.id].cantidad ?? 0) > (l.cantidadAprobada ?? 0))
                ? "No se cotiza más de lo aprobado."
                : "";
  const total = elegidas.reduce((s, l) => {
    const x = lineas[l.id];
    return s + totalesLinea({ cantidad: x.cantidad ?? 0, precioUnitario: x.precio ?? 0, descuentoPct: x.descuento ?? 0, ivaPct: x.iva ?? 0 }).total;
  }, 0);

  async function guardar() {
    if (problema || !fechaIso || !vigenciaIso) return;
    setBusy(true);
    setError("");
    try {
      onGuardado(
        await api.guardarCotizacion({
          ...(c ? { id: c.id } : {}),
          requisicionId: r.id,
          proveedorId,
          referencia: referencia.trim(),
          fecha: fechaIso,
          vigenciaHasta: vigenciaIso,
          plazoEntregaDias: Math.round(plazo ?? 0),
          diasPago: Math.round(diasPago ?? 0),
          anticipoPct: anticipo ?? 0,
          formaPago: formaPago.trim(),
          observaciones: observaciones.trim(),
          lineas: elegidas.map((l) => ({
            requisicionLineaId: l.id,
            cantidad: lineas[l.id].cantidad ?? 0,
            precioUnitario: lineas[l.id].precio ?? 0,
            descuentoPct: lineas[l.id].descuento ?? 0,
            ivaPct: lineas[l.id].iva ?? 0,
          })),
          version: c?.version ?? 0,
        })
      );
    } catch (err) {
      setBusy(false);
      setError(message(err));
    }
  }

  const cambiar = (id: string, patch: Partial<LineaEdicion>) => setLineas((ls) => ({ ...ls, [id]: { ...ls[id], ...patch } }));

  return (
    <Modal
      title={c ? `Corregir ${numeroCotizacion(c.numero)}` : `Registrar cotización · ${numeroRequisicion(r.numero)}`}
      width={1000}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <span style={{ marginRight: "auto", fontSize: 13, color: "var(--tc-gray-500)" }}>{problema || `Total con IVA: ${fmt(total)}`}</span>
          <button type="button" onClick={onClose} disabled={busy} style={botonSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={busy || !!problema} style={{ ...acceptButton, opacity: problema ? 0.5 : 1 }}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      <div style={{ padding: 14, display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 170px 170px", gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="cot-proveedor">
              Proveedor
            </label>
            <select
              id="cot-proveedor"
              value={proveedorId}
              onChange={(e) => {
                setProveedorId(e.target.value);
                const p = datos.proveedores.find((x) => x.id === e.target.value);
                if (p && !p.responsableIva) setLineas((ls) => Object.fromEntries(Object.entries(ls).map(([k, v]) => [k, { ...v, iva: 0 }])));
              }}
              style={{ ...select, width: "100%" }}
            >
              <option value="">Elige un proveedor activo…</option>
              {(c && proveedor && !disponibles.includes(proveedor) ? [proveedor, ...disponibles] : disponibles).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.razonSocial} · {nitConDv(p.nit, p.dv)}
                </option>
              ))}
            </select>
            {!disponibles.length && !c && <span style={{ fontSize: 12, color: "#a35200" }}>No hay proveedores activos sin cotización: regístralos en la pestaña Proveedores.</span>}
            {proveedor && !proveedor.responsableIva && <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>No es responsable de IVA: IVA 0 %.</span>}
          </div>
          <div>
            <label style={labelStyle} htmlFor="cot-ref">
              N.º del proveedor
            </label>
            <input id="cot-ref" value={referencia} maxLength={80} onChange={(e) => setReferencia(e.target.value)} style={{ ...baseInput, width: "100%" }} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="cot-fecha">
              Fecha
            </label>
            <DateField id="cot-fecha" text={fechaTexto} placeholder="DD-MM-AAAA" invalid={!!fechaTexto && !fechaIso} onText={setFechaTexto} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="cot-vigencia">
              Vigente hasta
            </label>
            <DateField id="cot-vigencia" text={vigenciaTexto} placeholder="DD-MM-AAAA" invalid={!!vigenciaTexto && !vigenciaIso} onText={setVigenciaTexto} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "150px 150px 150px 1fr", gap: 12 }}>
          <div>
            <span style={labelStyle}>Entrega (días)</span>
            <NumInput value={plazo} decimals={0} allowEmpty onCommit={setPlazo} ariaLabel="Plazo de entrega en días" style={{ width: "100%" }} />
          </div>
          <div>
            <span style={labelStyle}>Pago a (días; 0 contado)</span>
            <NumInput value={diasPago} decimals={0} onCommit={setDiasPago} ariaLabel="Días de pago" style={{ width: "100%" }} />
          </div>
          <div>
            <span style={labelStyle}>Anticipo (%)</span>
            <NumInput value={anticipo} decimals={2} onCommit={setAnticipo} ariaLabel="Anticipo" style={{ width: "100%" }} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="cot-forma">
              Forma de pago y condiciones
            </label>
            <input id="cot-forma" value={formaPago} maxLength={200} onChange={(e) => setFormaPago(e.target.value)} style={{ ...baseInput, width: "100%" }} placeholder="Ej.: crédito 30 días, entrega en obra" />
          </div>
        </div>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Cotiza</th>
              <th style={th}>Insumo</th>
              <th style={{ ...th, textAlign: "right" }}>Aprobado</th>
              <th style={{ ...th, textAlign: "right" }}>Cantidad</th>
              <th style={{ ...th, textAlign: "right" }}>Precio unitario (sin IVA)</th>
              <th style={{ ...th, textAlign: "right" }}>Descuento %</th>
              <th style={{ ...th, textAlign: "right" }}>IVA %</th>
              <th style={{ ...th, textAlign: "right" }}>Total</th>
              <th style={{ ...th, textAlign: "right" }}>Presupuesto</th>
            </tr>
          </thead>
          <tbody>
            {lineasAprobadas(r).map((l) => {
              const x = lineas[l.id];
              const t = totalesLinea({ cantidad: x.cantidad ?? 0, precioUnitario: x.precio ?? 0, descuentoPct: x.descuento ?? 0, ivaPct: x.iva ?? 0 });
              return (
                <tr key={l.id} style={{ opacity: x.cotiza ? 1 : 0.5 }}>
                  <td style={td}>
                    <input type="checkbox" checked={x.cotiza} onChange={(e) => cambiar(l.id, { cotiza: e.target.checked })} aria-label={`Cotiza ${l.descripcion}`} />
                  </td>
                  <td style={td}>
                    {l.descripcion} <span style={{ color: "var(--tc-gray-500)" }}>({l.unidad})</span>
                  </td>
                  <td style={num}>{fmt(l.cantidadAprobada ?? 0, 4)}</td>
                  <td style={num}>
                    <NumInput value={x.cantidad} decimals={4} allowEmpty readOnly={!x.cotiza} onCommit={(v) => cambiar(l.id, { cantidad: v })} ariaLabel={`Cantidad de ${l.descripcion}`} style={celda} />
                  </td>
                  <td style={num}>
                    <NumInput value={x.precio} decimals={2} allowEmpty readOnly={!x.cotiza} onCommit={(v) => cambiar(l.id, { precio: v })} ariaLabel={`Precio de ${l.descripcion}`} style={celda} />
                  </td>
                  <td style={num}>
                    <NumInput value={x.descuento} decimals={2} readOnly={!x.cotiza} onCommit={(v) => cambiar(l.id, { descuento: v })} ariaLabel={`Descuento de ${l.descripcion}`} style={{ ...celda, width: 70 }} />
                  </td>
                  <td style={num}>
                    <NumInput value={x.iva} decimals={2} readOnly={!x.cotiza} onCommit={(v) => cambiar(l.id, { iva: v })} ariaLabel={`IVA de ${l.descripcion}`} style={{ ...celda, width: 70 }} />
                  </td>
                  <td style={num}>{x.cotiza ? fmt(t.total) : "—"}</td>
                  <td style={{ ...num, color: "var(--tc-gray-500)" }}>{fmt(l.precio)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div>
          <label style={labelStyle} htmlFor="cot-obs">
            Observaciones
          </label>
          <textarea id="cot-obs" rows={2} maxLength={1000} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} style={{ ...baseInput, width: "100%", resize: "vertical" }} />
        </div>
        {c && (
          <section>
            <h3 style={subtitulo}>Documentos de la cotización</h3>
            <DocumentosRegistro api={api} entidadTipo="cotizacion" entidadId={c.id} permisos={permisos} />
          </section>
        )}
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

function MotivoDialog({
  titulo,
  ayuda,
  boton,
  opcional,
  peligro,
  busy,
  onConfirmar,
  onClose,
}: {
  titulo: string;
  ayuda: string;
  boton: string;
  opcional?: boolean;
  peligro?: boolean;
  busy: boolean;
  onConfirmar: (motivo: string) => void;
  onClose: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const listo = opcional || !!motivo.trim();
  return (
    <Modal
      title={titulo}
      width={520}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} style={botonSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={() => onConfirmar(motivo.trim())} disabled={busy || !listo} style={{ ...(peligro ? botonPeligro : acceptButton), opacity: listo ? 1 : 0.5 }}>
            {busy ? "Guardando…" : boton}
          </button>
        </>
      }
    >
      <div style={{ padding: 16, display: "grid", gap: 8 }}>
        <label style={labelStyle} htmlFor="motivo-comp">
          {ayuda}
        </label>
        <textarea id="motivo-comp" autoFocus rows={3} maxLength={1000} value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ ...baseInput, width: "100%", resize: "vertical" }} />
      </div>
    </Modal>
  );
}

const num: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const celda: CSSProperties = { width: 120, textAlign: "right" };
