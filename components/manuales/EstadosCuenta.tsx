"use client";

import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { ManualesApi } from "../../lib/manuales/client";
import { estadoDeCuenta, etiquetaTipo, fechaLocal, porMes, rango, sinPagoRegistrado } from "../../lib/manuales/contabilidad";
import { descargarEstado } from "../../lib/manuales/excelContable";
import { fechaVisible } from "../../lib/manuales/licencia";
import { NOMBRE_PASARELA } from "../../lib/manuales/pasarelas";
import { etiquetaMedio, etiquetaMeses, pesos } from "../../lib/manuales/textos";
import type { AutorizadoInfo, Orden } from "../../lib/manuales/types";
import FormPago, { FormPagoValor, formPagoVacio, pedidoPago } from "./FormPago";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * For administrators: statements of the license sales for fiscal reviews and
 * financial control, for a month or a year: cash collected and refunded,
 * revenue accrued over each license's term and deferred at the close (with
 * its reconciliation), by gateway and plan, the ledger of movements, the
 * payments to review, and all of it as an Excel workbook.
 */
export default function EstadosCuenta({ api }: { api: ManualesApi }) {
  const [datos, setDatos] = useState<{ hoy: string; zona: string; ordenes: Orden[] } | null>(null);
  const [anio, setAnio] = useState<number | null>(null);
  /** "" for the whole year, "01".."12" for a month. */
  const [mes, setMes] = useState("");
  const [filtro, setFiltro] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [autorizados, setAutorizados] = useState<AutorizadoInfo[]>([]);
  const [registrando, setRegistrando] = useState<{ email: string; pago: FormPagoValor } | null>(null);
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    setError("");
    try {
      const [d, a] = await Promise.all([api.contabilidad(), api.autorizados()]);
      setDatos(d);
      setAutorizados(a.autorizados);
      setAnio((a) => a ?? Number(d.hoy.slice(0, 4)));
      setMes((m) => m || d.hoy.slice(5, 7));
    } catch (err) {
      setError(message(err));
    }
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const anios = useMemo(() => {
    if (!datos) return [];
    const actual = Number(datos.hoy.slice(0, 4));
    const primero = Math.min(actual, ...datos.ordenes.filter((o) => o.pagada).map((o) => Number(o.pagada!.slice(0, 4))));
    return Array.from({ length: actual - primero + 1 }, (_, i) => actual - i);
  }, [datos]);

  const periodo = anio ? (mes ? `${anio}-${mes}` : String(anio)) : null;
  const estado = useMemo(() => {
    if (!datos || !periodo) return null;
    const { desde, hasta } = rango(periodo);
    return estadoDeCuenta(datos.ordenes, desde, hasta, datos.zona);
  }, [datos, periodo]);
  const meses = useMemo(() => (datos && anio ? porMes(datos.ordenes, anio, datos.hoy, datos.zona) : []), [datos, anio]);

  const sinPago = useMemo(() => (datos ? sinPagoRegistrado(autorizados, datos.ordenes) : []), [autorizados, datos]);

  async function registrarPago() {
    if (!registrando) return;
    const pago = pedidoPago(registrando.pago);
    if (typeof pago === "string" || !pago) return setError(pago || "Elige el tipo de pago.");
    setOcupado("Registrando el pago...");
    setError("");
    try {
      await api.actualizarAutorizado(registrando.email, { pago });
      setAviso(`Pago de ${registrando.email} registrado.`);
      setRegistrando(null);
      await cargar();
    } catch (err) {
      setError(message(err));
    } finally {
      setOcupado("");
    }
  }

  const nombrePeriodo = anio ? (mes ? `${MESES[Number(mes) - 1]} de ${anio}` : `Año ${anio}`) : "";
  const movimientos = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return (estado?.movimientos ?? []).filter((m) => !f || m.email.includes(f) || m.nombre.toLowerCase().includes(f) || (m.pagoId ?? "").toLowerCase().includes(f));
  }, [estado, filtro]);

  async function exportar() {
    if (!estado || !periodo) return;
    setOcupado("Generando el Excel...");
    try {
      await descargarEstado(estado, meses, `Estado de cuenta · Licencias de Manuales · ${nombrePeriodo}`, `estado-de-cuenta-manuales-${periodo}.xlsx`);
    } catch (err) {
      setError(message(err));
    } finally {
      setOcupado("");
    }
  }

  const mesesDelAnio = anio && datos && anio === Number(datos.hoy.slice(0, 4)) ? Number(datos.hoy.slice(5, 7)) : 12;

  return (
    <div style={{ flex: 1, overflow: "auto", background: "#f4f6f9" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "18px 16px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <div style={{ ...nota, background: "#fdecea", border: "1px solid #e5a29c", color: "#8a1c14" }}>{error}</div>}
        {aviso && <div style={{ ...nota, background: "var(--tc-blue-100)", border: "1px solid var(--tc-blue-500)", color: "var(--tc-blue-900)" }}>{aviso}</div>}

        {datos && sinPago.length > 0 && (
          <section style={{ ...tarjeta, border: "1px solid #f0c36d" }}>
            <h3 style={h3}>Licencias sin pago registrado ({sinPago.length})</h3>
            <p style={{ ...p, fontSize: 13 }}>
              Tienen acceso hoy, pero su licencia no tiene una compra en línea, un pago manual ni una cortesía que la respalde. Registra cómo pagaron para
              que entren a los estados de cuenta.
            </p>
            <div style={{ border: "1px solid #dfe4ea", borderRadius: 6, overflow: "hidden" }}>
              {sinPago.map((a) => (
                <div key={a.email} style={{ padding: "8px 10px", borderBottom: "1px solid #eef1f5", fontSize: 13.5 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ flex: 1, minWidth: 220 }}>
                      {a.nombre ? `${a.nombre} · ` : ""}
                      {a.email}
                      <span style={{ display: "block", fontSize: 12, color: "var(--tc-gray-500)" }}>
                        {a.vence ? `Licencia ${a.inicio ? `del ${fechaVisible(a.inicio)} ` : ""}al ${fechaVisible(a.vence)}` : "Sin vencimiento"} · autorizado por{" "}
                        {a.agregadoPor ?? "—"}
                      </span>
                    </span>
                    {registrando?.email === a.email ? (
                      <button type="button" style={secundario} onClick={() => setRegistrando(null)}>
                        Cancelar
                      </button>
                    ) : (
                      <button
                        type="button"
                        style={secundario}
                        onClick={() => setRegistrando({ email: a.email, pago: formPagoVacio(fechaVisible(datos.hoy)) })}
                        disabled={!!ocupado}
                      >
                        Registrar pago
                      </button>
                    )}
                  </div>
                  {registrando?.email === a.email && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #c9d6e6", display: "flex", flexDirection: "column", gap: 8 }}>
                      <FormPago id={`sin-pago-${a.email}`} valor={registrando.pago} permitirDespues={false} onChange={(pago) => setRegistrando({ email: a.email, pago })} />
                      <div>
                        <button type="button" style={primario} onClick={registrarPago} disabled={!!ocupado}>
                          {ocupado || "Guardar pago"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section style={{ ...tarjeta, display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ ...h2, marginBottom: 2 }}>Estado de cuenta · {nombrePeriodo || "..."}</h2>
            <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>
              Ventas de licencias de Manuales en pesos (COP), por día de Colombia. Valores brutos, antes de comisiones y retenciones de las pasarelas.
            </span>
          </div>
          <label style={campo}>
            Año
            <select value={anio ?? ""} onChange={(e) => setAnio(Number(e.target.value))} style={entrada} disabled={!datos}>
              {anios.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label style={campo}>
            Período
            <select value={mes} onChange={(e) => setMes(e.target.value)} style={entrada} disabled={!datos}>
              <option value="">Todo el año</option>
              {MESES.slice(0, mesesDelAnio).map((m, i) => (
                <option key={m} value={String(i + 1).padStart(2, "0")}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <button type="button" style={primario} onClick={exportar} disabled={!estado || !!ocupado}>
            {ocupado || "Exportar a Excel"}
          </button>
          <button type="button" style={secundario} onClick={cargar} title="Volver a cargar" aria-label="Volver a cargar">
            ↻
          </button>
        </section>

        {!estado ? (
          <p style={p}>{error ? "" : "Cargando..."}</p>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
              <Indicador
                titulo="Recaudo bruto"
                valor={pesos(estado.bruto)}
                detalle={`${estado.ventas} venta(s)${estado.cortesias ? ` · ${estado.cortesias} cortesía(s)` : ""}`}
              />
              <Indicador titulo="Reembolsos" valor={pesos(neg(estado.reembolsos))} detalle={`${estado.reembolsosCantidad} reembolso(s)`} rojo={estado.reembolsos > 0} />
              <Indicador titulo="Recaudo neto" valor={pesos(estado.neto)} detalle={`Ticket promedio ${pesos(estado.ticketPromedio)}`} fuerte />
              <Indicador titulo="Ingreso devengado" valor={pesos(estado.devengado)} detalle="Servicio prestado en el período" />
              <Indicador titulo="Ingreso diferido al cierre" valor={pesos(estado.diferidoFinal)} detalle={`Por prestar después del ${fechaVisible(estado.hasta)}`} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
              <section style={tarjeta}>
                <h3 style={h3}>Conciliación del ingreso diferido</h3>
                <Tabla
                  derecha={[1]}
                  filas={[
                    [`Diferido al ${fechaVisible(diaAntes(estado.desde))}`, pesos(estado.diferidoInicial)],
                    ["(+) Ventas del período no reembolsadas", pesos(estado.recaudoNoReembolsado)],
                    ["(−) Ingreso devengado en el período", pesos(neg(estado.devengado))],
                    [<strong key="t">Diferido al {fechaVisible(estado.hasta)}</strong>, <strong key="v">{pesos(estado.diferidoFinal)}</strong>],
                  ]}
                />
                <p style={{ ...p, fontSize: 12.5, color: "var(--tc-gray-500)", margin: "8px 0 0" }}>
                  Cada licencia se reconoce día a día durante su término (desde el pago, o desde el vencimiento anterior si se renovó antes de vencer).
                  Las compras reembolsadas no generan ingreso.
                </p>
              </section>
              <section style={tarjeta}>
                <h3 style={h3}>Por pasarela</h3>
                <Tabla
                  titulos={["Pasarela", "Ventas", "Bruto", "Reembolsos", "Neto"]}
                  filas={estado.porPasarela.map((x) => [NOMBRE_PASARELA[x.pasarela], x.ventas, pesos(x.bruto), pesos(neg(x.reembolsos)), pesos(x.neto)])}
                  vacio="Sin movimientos en el período."
                />
                <h3 style={{ ...h3, marginTop: 14 }}>Por plan</h3>
                <Tabla
                  titulos={["Plan", "Ventas", "Bruto", "Reembolsos", "Neto"]}
                  filas={estado.porPlan.map((x) => [etiquetaMeses(x.meses), x.ventas, pesos(x.bruto), pesos(neg(x.reembolsos)), pesos(x.neto)])}
                  vacio="Sin movimientos en el período."
                />
              </section>
            </div>

            <section style={tarjeta}>
              <h3 style={h3}>Mes a mes · {anio}</h3>
              <Tabla
                titulos={["Mes", "Ventas", "Recaudo bruto", "Reembolsos", "Recaudo neto", "Devengado", "Diferido al cierre"]}
                filas={meses.map((m) => [MESES[Number(m.mes.slice(5)) - 1], m.ventas, pesos(m.bruto), pesos(neg(m.reembolsos)), pesos(m.neto), pesos(m.devengado), pesos(m.diferido)])}
                vacio="Sin meses para mostrar."
              />
            </section>

            <section style={tarjeta}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <h3 style={{ ...h3, margin: 0, flex: 1 }}>Libro de movimientos ({estado.movimientos.length})</h3>
                <input
                  type="search"
                  value={filtro}
                  onChange={(e) => setFiltro(e.target.value)}
                  placeholder="Filtrar por persona o id del pago"
                  aria-label="Filtrar movimientos"
                  style={{ ...entrada, padding: "5px 8px", fontSize: 13, minWidth: 220 }}
                />
              </div>
              <Tabla
                titulos={["Fecha", "Tipo", "Comprador", "Plan", "Pasarela / medio", "Id o referencia", "Valor", "Licencia"]}
                derecha={[6]}
                filas={movimientos.map((m) => [
                  fechaVisible(m.fecha),
                  m.tipo === "reembolso" ? (
                    <span key="r" style={{ color: "#8a1c14" }}>
                      {etiquetaTipo(m)}
                    </span>
                  ) : (
                    etiquetaTipo(m)
                  ),
                  <span key="c">
                    {m.nombre ? `${m.nombre} · ` : ""}
                    {m.email}
                  </span>,
                  etiquetaMeses(m.meses),
                  m.pasarela === "manual" ? `Manual · ${etiquetaMedio(m.medio)}` : NOMBRE_PASARELA[m.pasarela],
                  <code key="p" style={{ fontSize: 12 }}>
                    {m.pagoId ?? ""}
                  </code>,
                  <span key="v" style={{ color: m.valor < 0 ? "#8a1c14" : undefined, whiteSpace: "nowrap" }}>
                    {pesos(m.valor)}
                  </span>,
                  m.hasta ? `${fechaVisible(m.desde)} → ${fechaVisible(m.hasta)}` : "Sin vencimiento",
                ])}
                vacio={estado.movimientos.length ? "Ningún movimiento coincide con el filtro." : "Sin movimientos en el período."}
              />
            </section>

            {estado.porRevisar.length > 0 && (
              <section style={{ ...tarjeta, border: "1px solid #f0c36d" }}>
                <h3 style={h3}>Pagos por revisar ({estado.porRevisar.length})</h3>
                <p style={{ ...p, fontSize: 13 }}>
                  Llegaron por menos del valor de la compra y no activaron licencia: no están en el recaudo. Revísalos en la pasarela para devolverlos o
                  completar la venta.
                </p>
                <Tabla
                  titulos={["Fecha de pago", "Comprador", "Pasarela", "Id del pago", "Valor de la compra", "Nota"]}
                  derecha={[4]}
                  filas={estado.porRevisar.map((o) => [
                    fechaVisible(o.pagada ? fechaLocal(o.pagada, datos?.zona) : null),
                    o.email,
                    NOMBRE_PASARELA[o.pasarela],
                    o.pagoId ?? "",
                    pesos(o.monto),
                    o.nota ?? "",
                  ])}
                />
              </section>
            )}

            <p style={{ ...p, fontSize: 12.5, color: "var(--tc-gray-500)" }}>
              Para la revisión fiscal: el recaudo se concilia con los extractos de Mercado Pago y Wompi por el id del pago, y allí están las comisiones,
              retenciones e impuestos que descuentan las pasarelas. El ingreso devengado y el diferido reconocen cada licencia por el tiempo de servicio
              prestado. Este informe no reemplaza la contabilidad formal ni la facturación electrónica.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** -0 would show as "-$ 0". */
const neg = (n: number) => (n ? -n : 0);

function diaAntes(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function Indicador({ titulo, valor, detalle, fuerte, rojo }: { titulo: string; valor: string; detalle: string; fuerte?: boolean; rojo?: boolean }) {
  return (
    <div style={{ ...tarjeta, padding: "12px 14px", borderTop: `3px solid ${fuerte ? "#1d6b2f" : rojo ? "#b3261e" : "var(--tc-blue-600)"}` }}>
      <div style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>{titulo}</div>
      <div style={{ fontSize: 21, fontWeight: 700, color: rojo ? "#8a1c14" : "var(--tc-blue-900)", whiteSpace: "nowrap" }}>{valor}</div>
      <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>{detalle}</div>
    </div>
  );
}

/** `derecha`: the columns with amounts (right-aligned, header included); by default every column but the first. */
function Tabla({ titulos, filas, vacio, derecha }: { titulos?: string[]; filas: ReactNode[][]; vacio?: string; derecha?: number[] }) {
  const alDerecha = (i: number) => (derecha ? derecha.includes(i) : i > 0);
  if (!filas.length) return <p style={{ ...p, fontSize: 13, color: "var(--tc-gray-500)", margin: 0 }}>{vacio}</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        {titulos && (
          <thead>
            <tr>
              {titulos.map((t, i) => (
                <th key={t} style={{ ...celda, textAlign: alDerecha(i) ? "right" : "left", background: "#eef2f6", fontWeight: 600, whiteSpace: "nowrap" }}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {filas.map((f, i) => (
            <tr key={i}>
              {f.map((c, j) => (
                <td key={j} style={{ ...celda, textAlign: alDerecha(j) ? "right" : "left" }}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const tarjeta: CSSProperties = { background: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(10,61,98,0.12)", padding: "16px 18px" };
const h2: CSSProperties = { margin: "0 0 8px", fontSize: 17, color: "var(--tc-blue-900)" };
const h3: CSSProperties = { margin: "0 0 8px", fontSize: 15, color: "var(--tc-blue-900)" };
const p: CSSProperties = { margin: "0 0 10px", fontSize: 14, lineHeight: 1.5 };
const nota: CSSProperties = { borderRadius: 8, padding: "10px 14px", fontSize: 13.5, lineHeight: 1.5 };
const celda: CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #eef1f5", verticalAlign: "top" };
const campo: CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: 12.5, color: "var(--tc-gray-500)" };
const entrada: CSSProperties = { border: "1px solid var(--tc-gray-300)", borderRadius: 5, padding: "7px 8px", fontSize: 14, fontFamily: "inherit", background: "#fff" };
const primario: CSSProperties = {
  border: "1px solid var(--tc-blue-700)",
  background: "var(--tc-blue-600)",
  color: "#fff",
  borderRadius: 5,
  padding: "8px 14px",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
const secundario: CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  background: "#fff",
  color: "var(--tc-blue-700)",
  borderRadius: 5,
  padding: "7px 12px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
