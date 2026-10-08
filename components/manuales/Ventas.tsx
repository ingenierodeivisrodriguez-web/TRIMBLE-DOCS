"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import type { ManualesApi } from "../../lib/manuales/client";
import { fechaVisible, MAX_MESES } from "../../lib/manuales/licencia";
import { ESTADO_ORDEN_LABELS, etiquetaMeses, pesos, textoEstadoMp } from "../../lib/manuales/textos";
import type { ConfigVentaInfo, EstadoOrden, Orden, Plan } from "../../lib/manuales/types";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fecha(timestamp: string | null): string {
  if (!timestamp) return "";
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** A plan being edited (the price as typed). */
interface FilaPlan {
  meses: number;
  precio: string;
}

const COLORES: Record<EstadoOrden, { fondo: string; texto: string }> = {
  pendiente: { fondo: "#eceff3", texto: "#4b5563" },
  aprobada: { fondo: "#e3f4e6", texto: "#1d6b2f" },
  revisar: { fondo: "#fff1d6", texto: "#8a5300" },
  reembolsada: { fondo: "#fdecea", texto: "#8a1c14" },
};
const ORDEN_ESTADOS: EstadoOrden[] = ["aprobada", "pendiente", "revisar", "reembolsada"];

function precioDe(texto: string): number | null {
  const limpio = texto.replace(/[\s.$]/g, "");
  return /^\d{1,9}$/.test(limpio) && Number(limpio) > 0 ? Number(limpio) : null;
}

/**
 * For administrators: online sales of licenses with Mercado Pago (open or
 * closed, and the plans on sale) and the purchases, each applied by itself
 * to the buyer's license when Mercado Pago approves it.
 */
export default function Ventas({ api }: { api: ManualesApi }) {
  const [config, setConfig] = useState<ConfigVentaInfo | null>(null);
  const [habilitada, setHabilitada] = useState(false);
  const [planes, setPlanes] = useState<FilaPlan[]>([]);
  const [ordenes, setOrdenes] = useState<Orden[] | null>(null);
  const [filtro, setFiltro] = useState<EstadoOrden | "">("");
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([api.venta(), api.pagos()]);
      setConfig(c);
      setHabilitada(c.habilitada);
      setPlanes(c.planes.length ? c.planes.map((x) => ({ meses: x.meses, precio: String(x.precio) })) : [{ meses: 1, precio: "" }, { meses: 12, precio: "" }]);
      setOrdenes(p.ordenes);
    } catch (err) {
      setError(message(err));
    }
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function correr(etiqueta: string, accion: () => Promise<string | void>) {
    setOcupado(etiqueta);
    setError("");
    setAviso("");
    try {
      const texto = await accion();
      if (texto) setAviso(texto);
    } catch (err) {
      setError(message(err));
    } finally {
      setOcupado("");
    }
  }

  function guardar() {
    const lista: Plan[] = [];
    for (const f of planes) {
      const precio = precioDe(f.precio);
      if (!precio) return setError(`Escribe el precio del plan de ${etiquetaMeses(f.meses)} en pesos, sin decimales.`);
      lista.push({ meses: f.meses, precio });
    }
    if (new Set(lista.map((x) => x.meses)).size !== lista.length) return setError("Hay dos planes con los mismos meses.");
    correr("Guardando...", async () => {
      await api.guardarVenta({ habilitada, planes: lista });
      await cargar();
      return habilitada ? "Venta en línea abierta: quien no tenga acceso o quiera renovar verá los planes en Manuales." : "Venta en línea cerrada.";
    });
  }

  function verificar(o: Orden) {
    correr("Consultando Mercado Pago...", async () => {
      const v = await api.verificarPago(o.id);
      setOrdenes((lista) => lista?.map((x) => (x.id === v.id ? v : x)) ?? null);
      return v.estado === "aprobada" ? `Pago aprobado: ${v.email} tiene acceso hasta el ${fechaVisible(v.venceNueva)}.` : `${v.email}: ${textoEstadoMp(v.estadoMp, v.detalleMp)}.`;
    });
  }

  const visibles = useMemo(() => (ordenes ?? []).filter((o) => !filtro || o.estado === filtro), [ordenes, filtro]);
  const resumen = useMemo(() => {
    const mes = new Date().toISOString().slice(0, 7);
    const aprobadas = (ordenes ?? []).filter((o) => o.estado === "aprobada");
    const delMes = aprobadas.filter((o) => (o.pagada ?? "").slice(0, 7) === mes);
    return { aprobadas: aprobadas.length, mes: delMes.length, total: delMes.reduce((s, o) => s + o.monto, 0) };
  }, [ordenes]);

  const mp = config?.mercadoPago;
  const libres = Array.from({ length: MAX_MESES }, (_, i) => i + 1).filter((m) => !planes.some((f) => f.meses === m));

  return (
    <div style={{ flex: 1, overflow: "auto", background: "#f4f6f9" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "18px 16px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <div style={{ ...nota, background: "#fdecea", border: "1px solid #e5a29c", color: "#8a1c14" }}>{error}</div>}
        {aviso && <div style={{ ...nota, background: "var(--tc-blue-100)", border: "1px solid var(--tc-blue-500)", color: "var(--tc-blue-900)" }}>{aviso}</div>}

        <section style={tarjeta}>
          <h2 style={h2}>Mercado Pago</h2>
          {!mp ? (
            <p style={p}>Cargando...</p>
          ) : !mp.configurado ? (
            <div style={{ ...nota, background: "#fff6e0", border: "1px solid #f0c36d", color: "#7a5300" }}>
              Falta la variable <strong>MERCADOPAGO_ACCESS_TOKEN</strong> en Vercel (Settings → Environment Variables) con el Access Token de tu
              aplicación de Mercado Pago (Tus integraciones → Credenciales de producción). Agrégala y vuelve a desplegar.
            </div>
          ) : (
            <>
              <p style={{ ...p, fontSize: 15 }}>
                ✅ Credenciales {mp.prueba ? <strong>de prueba</strong> : "de producción"} configuradas.
                {mp.prueba ? " Los pagos son simulados: usa las tarjetas de prueba de Mercado Pago." : " Los pagos llegan a tu cuenta de Mercado Pago."}
              </p>
              <p style={{ ...p, fontSize: 13, color: "var(--tc-gray-500)" }}>
                Cada compra le pide a Mercado Pago que avise sus pagos a <code style={codigo}>{mp.webhook}</code>; además, la pantalla de quien paga y una
                revisión diaria consultan los pagos pendientes, así que la licencia se activa aunque un aviso se pierda.{" "}
                {mp.firma
                  ? "La firma de los avisos se verifica (MERCADOPAGO_WEBHOOK_SECRET)."
                  : "Opcional: configura esa misma dirección en Mercado Pago → Tus integraciones → Webhooks (evento «Pagos») y guarda su clave secreta en Vercel como MERCADOPAGO_WEBHOOK_SECRET para verificar la firma de los avisos."}
              </p>
            </>
          )}
        </section>

        <section style={tarjeta}>
          <h2 style={h2}>Venta de licencias</h2>
          <p style={p}>
            Quien no tenga acceso (o quiera renovar) elige un plan y paga en Mercado Pago. Al aprobarse el pago, su correo de Trimble Connect queda
            autorizado por esos meses (si su licencia sigue vigente, se suman desde su vencimiento), sin que tengas que hacer nada.
          </p>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
            <input type="checkbox" checked={habilitada} onChange={(e) => setHabilitada(e.target.checked)} />
            Vender licencias en línea
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {planes.map((f, i) => {
              const precio = precioDe(f.precio);
              return (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    value={f.meses}
                    aria-label="Meses del plan"
                    onChange={(e) => setPlanes((l) => l.map((x, j) => (j === i ? { ...x, meses: Number(e.target.value) } : x)))}
                    style={entrada}
                  >
                    {Array.from({ length: MAX_MESES }, (_, k) => k + 1).map((m) => (
                      <option key={m} value={m} disabled={m !== f.meses && planes.some((x) => x.meses === m)}>
                        {etiquetaMeses(m)}
                      </option>
                    ))}
                  </select>
                  <input
                    value={f.precio}
                    inputMode="numeric"
                    placeholder="Precio en pesos"
                    aria-label={`Precio del plan de ${etiquetaMeses(f.meses)}`}
                    onChange={(e) => setPlanes((l) => l.map((x, j) => (j === i ? { ...x, precio: e.target.value } : x)))}
                    style={{ ...entrada, width: 150, border: `1px solid ${f.precio && !precio ? "#d93025" : "var(--tc-gray-300)"}` }}
                  />
                  <span style={{ fontSize: 13, color: "var(--tc-gray-500)", minWidth: 180 }}>
                    {precio ? `${pesos(precio)}${f.meses > 1 ? ` · ${pesos(Math.round(precio / f.meses))} al mes` : ""}` : ""}
                  </span>
                  <button type="button" style={secundario} onClick={() => setPlanes((l) => l.filter((_, j) => j !== i))} aria-label={`Quitar el plan de ${etiquetaMeses(f.meses)}`}>
                    Quitar
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" style={secundario} onClick={() => setPlanes((l) => [...l, { meses: libres[0], precio: "" }])} disabled={!libres.length}>
              Agregar plan
            </button>
            <button type="button" style={primario} onClick={guardar} disabled={!!ocupado || !config}>
              Guardar
            </button>
            {config?.actualizadoEn && (
              <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>
                Modificado el {fecha(config.actualizadoEn)}
                {config.actualizadoPor ? ` por ${config.actualizadoPor}` : ""}
              </span>
            )}
          </div>
        </section>

        <section style={tarjeta}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <h2 style={{ ...h2, margin: 0, flex: 1 }}>Compras</h2>
            <select value={filtro} onChange={(e) => setFiltro(e.target.value as EstadoOrden | "")} style={{ ...entrada, padding: "5px 8px", fontSize: 13 }} aria-label="Estado de la compra">
              <option value="">Todas</option>
              {ORDEN_ESTADOS.map((e) => (
                <option key={e} value={e}>
                  {ESTADO_ORDEN_LABELS[e]} ({(ordenes ?? []).filter((o) => o.estado === e).length})
                </option>
              ))}
            </select>
            <button type="button" style={secundario} onClick={() => correr("Actualizando...", cargar)} disabled={!!ocupado}>
              ↻
            </button>
          </div>
          {ordenes && (
            <p style={{ ...p, fontSize: 13, color: "var(--tc-gray-500)" }}>
              {resumen.aprobadas} compra(s) aprobada(s) en total · este mes {resumen.mes} por {pesos(resumen.total)}
            </p>
          )}
          <div style={{ border: "1px solid #dfe4ea", borderRadius: 6, overflow: "hidden", background: "#fff" }}>
            {visibles.map((o) => (
              <div key={o.id} style={{ padding: "9px 10px", borderBottom: "1px solid #eef1f5", fontSize: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 240 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span>
                      {o.nombre ? `${o.nombre} · ` : ""}
                      {o.email}
                    </span>
                    <span style={{ background: COLORES[o.estado].fondo, color: COLORES[o.estado].texto, borderRadius: 10, padding: "1px 9px", fontSize: 12, fontWeight: 700 }}>
                      {ESTADO_ORDEN_LABELS[o.estado]}
                    </span>
                  </span>
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--tc-gray-500)", marginTop: 2 }}>
                    {fecha(o.creada)} · {etiquetaMeses(o.meses)} · {pesos(o.monto, o.moneda)}
                    {o.estado === "aprobada" && o.venceNueva ? ` · acceso hasta el ${fechaVisible(o.venceNueva)}` : ""}
                    {o.estado !== "aprobada" ? ` · ${textoEstadoMp(o.estadoMp, o.detalleMp)}` : ""}
                    {o.pagoId ? ` · pago ${o.pagoId}` : ""}
                  </span>
                  {o.nota && <span style={{ display: "block", fontSize: 12.5, color: "#8a5300" }}>{o.nota}</span>}
                </span>
                {o.estado === "pendiente" && (
                  <button type="button" style={secundario} onClick={() => verificar(o)} disabled={!!ocupado}>
                    Verificar pago
                  </button>
                )}
              </div>
            ))}
            {ordenes && visibles.length === 0 && (
              <p style={{ ...p, padding: 12, color: "var(--tc-gray-500)", margin: 0 }}>{ordenes.length ? "No hay compras con ese estado." : "Todavía no hay compras."}</p>
            )}
            {!ordenes && !error && <p style={{ ...p, padding: 12, color: "var(--tc-gray-500)", margin: 0 }}>Cargando...</p>}
          </div>
          <p style={{ ...p, fontSize: 12.5, color: "var(--tc-gray-500)", marginTop: 8, marginBottom: 0 }}>
            &quot;Pendiente&quot;: la persona fue a pagar y Mercado Pago aún no aprueba el pago (o no lo completó). &quot;Revisar&quot;: el pago fue por menos
            del valor y no se aplicó. &quot;Reembolsada&quot;: el pago se devolvió; la licencia no se quita sola, suspéndela en &quot;Administrar acceso&quot; si
            corresponde.
          </p>
        </section>
        {ocupado && <p style={{ ...p, color: "var(--tc-blue-700)" }}>{ocupado}</p>}
      </div>
    </div>
  );
}

const tarjeta: CSSProperties = { background: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(10,61,98,0.12)", padding: "16px 18px" };
const h2: CSSProperties = { margin: "0 0 8px", fontSize: 17, color: "var(--tc-blue-900)" };
const p: CSSProperties = { margin: "0 0 10px", fontSize: 14, lineHeight: 1.5 };
const nota: CSSProperties = { borderRadius: 8, padding: "10px 14px", fontSize: 13.5, lineHeight: 1.5 };
const codigo: CSSProperties = { wordBreak: "break-all", background: "#eef1f5", borderRadius: 3, padding: "0 4px" };
const entrada: CSSProperties = { border: "1px solid var(--tc-gray-300)", borderRadius: 5, padding: "7px 8px", fontSize: 14, fontFamily: "inherit", background: "#fff" };
const primario: CSSProperties = {
  border: "1px solid var(--tc-blue-700)",
  background: "var(--tc-blue-600)",
  color: "#fff",
  borderRadius: 5,
  padding: "7px 14px",
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
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
