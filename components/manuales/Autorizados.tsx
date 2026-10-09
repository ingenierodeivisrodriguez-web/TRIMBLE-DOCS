"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import type { LicenciaPedido, ManualesApi } from "../../lib/manuales/client";
import { DIAS_AVISO, ESTADO_LABELS, EstadoLicencia, fechaVisible, MAX_MESES, sumarMeses } from "../../lib/manuales/licencia";
import type { AutorizadoInfo } from "../../lib/manuales/types";
import { parseDisplayDate } from "../../lib/propiedades/values";
import DateField from "../propiedades/DateField";
import FormPago, { FormPagoValor, formPagoVacio, pedidoPago } from "./FormPago";

type Modo = "meses" | "fecha" | "sin";

/** A license being edited: 1-12 months from a date, up to a date, or without expiry (dates as DD-MM-AAAA). */
interface FormLicencia {
  modo: Modo;
  meses: number;
  desde: string;
  hasta: string;
}

const COLORES: Record<EstadoLicencia, { fondo: string; texto: string }> = {
  activa: { fondo: "#e3f4e6", texto: "#1d6b2f" },
  "por-vencer": { fondo: "#fff1d6", texto: "#8a5300" },
  vencida: { fondo: "#fdecea", texto: "#8a1c14" },
  suspendida: { fondo: "#eceff3", texto: "#4b5563" },
  "sin-vencimiento": { fondo: "#e4effa", texto: "#0a4f8c" },
};
const ORDEN: EstadoLicencia[] = ["activa", "por-vencer", "vencida", "suspendida", "sin-vencimiento"];

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

/** The request for the API, or the reason the form isn't valid yet. */
function pedido(f: FormLicencia): LicenciaPedido | string {
  if (f.modo === "sin") return { sinVencimiento: true };
  const inicio = parseDisplayDate(f.desde);
  if (!inicio) return "Escribe la fecha de inicio como DD-MM-AAAA.";
  if (f.modo === "meses") return { meses: f.meses, inicio };
  const vence = parseDisplayDate(f.hasta);
  if (!vence) return "Escribe la fecha de vencimiento como DD-MM-AAAA.";
  if (vence < inicio) return "El vencimiento no puede ser antes del inicio.";
  return { vence, inicio };
}

/** The expiry the form leads to, to show it before saving. */
function venceDe(f: FormLicencia): string | null {
  if (f.modo === "sin") return null;
  const inicio = parseDisplayDate(f.desde);
  if (f.modo === "meses") return inicio ? sumarMeses(inicio, f.meses) : null;
  return parseDisplayDate(f.hasta);
}

export function EstadoBadge({ estado }: { estado: EstadoLicencia }) {
  const c = COLORES[estado];
  return <span style={{ background: c.fondo, color: c.texto, borderRadius: 10, padding: "1px 9px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>{ESTADO_LABELS[estado]}</span>;
}

/** Months (1-12), up to a date, or without expiry; and from when. */
function EditorLicencia({ id, valor, onChange }: { id: string; valor: FormLicencia; onChange: (f: FormLicencia) => void }) {
  const vence = venceDe(valor);
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label style={campo}>
        Licencia
        <select
          value={valor.modo === "meses" ? String(valor.meses) : valor.modo}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "fecha" || v === "sin") onChange({ ...valor, modo: v });
            else onChange({ ...valor, modo: "meses", meses: Number(v) });
          }}
          style={entrada}
        >
          {Array.from({ length: MAX_MESES }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m} {m === 1 ? "mes" : "meses"}
            </option>
          ))}
          <option value="fecha">Hasta una fecha...</option>
          <option value="sin">Sin vencimiento</option>
        </select>
      </label>
      {valor.modo !== "sin" && (
        <label style={campo}>
          Desde
          <DateField id={`${id}-desde`} text={valor.desde} placeholder="DD-MM-AAAA" invalid={!!valor.desde && !parseDisplayDate(valor.desde)} onText={(t) => onChange({ ...valor, desde: t })} />
        </label>
      )}
      {valor.modo === "fecha" && (
        <label style={campo}>
          Vence el
          <DateField id={`${id}-hasta`} text={valor.hasta} placeholder="DD-MM-AAAA" invalid={!!valor.hasta && !parseDisplayDate(valor.hasta)} onText={(t) => onChange({ ...valor, hasta: t })} />
        </label>
      )}
      <span style={{ fontSize: 13, color: "var(--tc-gray-500)", paddingBottom: 8 }}>
        {valor.modo === "sin" ? "Puede leer hasta que lo suspendas o lo quites." : vence ? `Vence el ${fechaVisible(vence)} (último día con acceso).` : ""}
      </span>
    </div>
  );
}

/**
 * The people authorized to read the manuals: each with a license (1 to 12
 * months, up to a date, or without expiry) and its status; they can be
 * renewed, suspended, reactivated or removed.
 */
export default function Autorizados({ api }: { api: ManualesApi }) {
  const [lista, setLista] = useState<AutorizadoInfo[] | null>(null);
  const [hoy, setHoy] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [nueva, setNueva] = useState<FormLicencia | null>(null);
  const [pagoNuevo, setPagoNuevo] = useState<FormPagoValor | null>(null);
  const [filtro, setFiltro] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoLicencia | "">("");
  const [editando, setEditando] = useState<{ email: string; form: FormLicencia; pago: FormPagoValor } | null>(null);
  const [quitando, setQuitando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    try {
      const r = await api.autorizados();
      setLista(r.autorizados);
      setHoy(r.hoy);
      setNueva((n) => n ?? { modo: "meses", meses: MAX_MESES, desde: fechaVisible(r.hoy), hasta: "" });
      setPagoNuevo((p) => p ?? formPagoVacio(fechaVisible(r.hoy)));
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
      await cargar();
    } catch (err) {
      setError(message(err));
    } finally {
      setOcupado("");
    }
  }

  function autorizar() {
    if (!nueva || !pagoNuevo) return;
    const lic = pedido(nueva);
    if (typeof lic === "string") return setError(lic);
    const pago = pedidoPago(pagoNuevo);
    if (typeof pago === "string") return setError(pago);
    correr("Autorizando...", async () => {
      const r = await api.autorizar(texto, lic, pago ?? undefined);
      setTexto(r.invalidos.join("\n"));
      if (pago) setPagoNuevo({ ...pagoNuevo, valor: "", referencia: "", soporte: "" });
      return `${r.agregados} persona(s) autorizada(s).${r.pagos ? ` ${r.pagos} pago(s) registrado(s) en los estados de cuenta.` : ""}${r.invalidos.length ? ` No son correos válidos: ${r.invalidos.join(", ")}.` : ""}`;
    });
  }

  function abrirEditor(a: AutorizadoInfo) {
    // A license still in force is renewed from its end; otherwise from today.
    const enCurso = a.vence && (a.estado === "activa" || a.estado === "por-vencer");
    const desde = fechaVisible(enCurso ? a.vence : hoy);
    setEditando({
      email: a.email,
      pago: formPagoVacio(fechaVisible(hoy)),
      form: a.vence && !a.licenciaMeses ? { modo: "fecha", meses: MAX_MESES, desde: fechaVisible(a.inicio ?? hoy), hasta: fechaVisible(a.vence) } : { modo: "meses", meses: a.licenciaMeses ?? MAX_MESES, desde, hasta: "" },
    });
  }

  function guardarLicencia() {
    if (!editando) return;
    const lic = pedido(editando.form);
    if (typeof lic === "string") return setError(lic);
    const pago = pedidoPago(editando.pago);
    if (typeof pago === "string") return setError(pago);
    const email = editando.email;
    correr("Guardando la licencia...", async () => {
      await api.actualizarAutorizado(email, { licencia: lic, pago: pago ?? undefined });
      setEditando(null);
      return `Licencia de ${email} actualizada${pago ? (pago.tipo === "pago" ? " y pago registrado" : " como cortesía") : ""}.`;
    });
  }

  const conteo = useMemo(() => {
    const c: Partial<Record<EstadoLicencia, number>> = {};
    for (const a of lista ?? []) c[a.estado] = (c[a.estado] ?? 0) + 1;
    return c;
  }, [lista]);

  const visibles = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return (lista ?? []).filter((a) => (!estadoFiltro || a.estado === estadoFiltro) && (!f || a.email.includes(f) || a.nombre.toLowerCase().includes(f)));
  }, [lista, filtro, estadoFiltro]);

  return (
    <section style={tarjeta}>
      <h2 style={h2}>Personas autorizadas</h2>
      <p style={p}>
        Pueden leer los manuales desde cualquier proyecto donde esté instalada la app, iniciando sesión en Trimble Connect con ese correo, mientras su
        licencia esté vigente. Los administradores de MANAGER PROJECT siempre pueden.
      </p>
      {error && <div style={{ ...nota, background: "#fdecea", border: "1px solid #e5a29c", color: "#8a1c14", marginBottom: 10 }}>{error}</div>}
      {aviso && <div style={{ ...nota, background: "var(--tc-blue-100)", border: "1px solid var(--tc-blue-500)", color: "var(--tc-blue-900)", marginBottom: 10 }}>{aviso}</div>}

      <label style={{ display: "block", fontSize: 13, color: "var(--tc-gray-500)", marginBottom: 4 }} htmlFor="manuales-correos">
        Correos (separados por coma, punto y coma o en líneas; admite &quot;Nombre &lt;correo&gt;&quot;)
      </label>
      <textarea
        id="manuales-correos"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={3}
        placeholder="ana@tuempresa.com, Luis Gómez <luis@contratista.com>"
        style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--tc-gray-300)", borderRadius: 6, padding: 8, fontSize: 14, fontFamily: "inherit" }}
      />
      {nueva && (
        <div style={{ marginTop: 8 }}>
          <EditorLicencia id="nueva" valor={nueva} onChange={setNueva} />
        </div>
      )}
      {pagoNuevo && (
        <div style={{ marginTop: 8 }}>
          <FormPago id="nueva" valor={pagoNuevo} onChange={setPagoNuevo} />
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <button type="button" style={primario} onClick={autorizar} disabled={!!ocupado || !texto.trim() || !nueva}>
          Autorizar
        </button>
        <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)", marginLeft: 10 }}>
          Si el correo ya estaba autorizado, se le asigna esta licencia nueva. Con varios correos, el pago se registra para cada uno.
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18, marginBottom: 6, flexWrap: "wrap" }}>
        <strong style={{ flex: 1, minWidth: 200 }}>
          {lista ? `${lista.length} persona(s) autorizada(s)` : "Cargando..."}
          {lista && lista.length > 0 && (
            <span style={{ fontWeight: 400, fontSize: 12.5, color: "var(--tc-gray-500)" }}>
              {" · "}
              {ORDEN.filter((e) => conteo[e]).map((e) => `${conteo[e]} ${ESTADO_LABELS[e].toLowerCase()}`).join(" · ")}
            </span>
          )}
        </strong>
        <select value={estadoFiltro} onChange={(e) => setEstadoFiltro(e.target.value as EstadoLicencia | "")} style={{ ...entrada, padding: "5px 8px", fontSize: 13 }} aria-label="Estado de cuenta">
          <option value="">Todos los estados</option>
          {ORDEN.map((e) => (
            <option key={e} value={e}>
              {ESTADO_LABELS[e]} ({conteo[e] ?? 0})
            </option>
          ))}
        </select>
        <input
          type="search"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Filtrar"
          aria-label="Filtrar personas"
          style={{ border: "1px solid var(--tc-gray-300)", borderRadius: 4, padding: "5px 8px", fontSize: 13, fontFamily: "inherit" }}
        />
      </div>

      <div style={{ border: "1px solid #dfe4ea", borderRadius: 6, overflow: "hidden", background: "#fff" }}>
        {visibles.map((a) => {
          const abierto = editando?.email === a.email;
          return (
            <div key={a.email} style={{ padding: "9px 10px", borderBottom: "1px solid #eef1f5", fontSize: 14, background: abierto ? "var(--tc-blue-50)" : "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 220 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {a.nombre ? `${a.nombre} · ` : ""}
                      {a.email}
                    </span>
                    <EstadoBadge estado={a.estado} />
                  </span>
                  <span style={{ display: "block", fontSize: 12.5, color: "var(--tc-gray-500)", marginTop: 2 }}>{detalleLicencia(a)}</span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--tc-gray-500)" }}>
                    Autorizado el {fecha(a.agregadoEn)}
                    {a.agregadoPor ? ` por ${a.agregadoPor}` : ""}
                  </span>
                </span>
                {quitando === a.email ? (
                  <>
                    <button type="button" style={peligro} onClick={() =>
                        correr("Quitando...", async () => {
                          await api.quitarAutorizado(a.email);
                          setQuitando(null);
                          return `Se quitó el acceso a ${a.email}.`;
                        })
                      }>
                      Quitar acceso
                    </button>
                    <button type="button" style={secundario} onClick={() => setQuitando(null)}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" style={secundario} onClick={() => (abierto ? setEditando(null) : abrirEditor(a))} disabled={!!ocupado}>
                      {abierto ? "Cerrar" : "Licencia"}
                    </button>
                    <button
                      type="button"
                      style={a.suspendido ? secundario : peligro}
                      disabled={!!ocupado}
                      onClick={() =>
                        correr(a.suspendido ? "Reactivando..." : "Suspendiendo...", async () => {
                          await api.actualizarAutorizado(a.email, { suspendido: !a.suspendido });
                          return a.suspendido ? `${a.email} puede volver a leer los manuales.` : `Se suspendió el acceso de ${a.email}.`;
                        })
                      }
                    >
                      {a.suspendido ? "Reactivar" : "Suspender"}
                    </button>
                    <button type="button" style={secundario} onClick={() => setQuitando(a.email)} disabled={!!ocupado}>
                      Quitar
                    </button>
                  </>
                )}
              </div>
              {abierto && editando && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #c9d6e6" }}>
                  <EditorLicencia id={`lic-${a.email}`} valor={editando.form} onChange={(form) => setEditando({ ...editando, form })} />
                  <div style={{ marginTop: 8 }}>
                    <FormPago id={`pago-${a.email}`} valor={editando.pago} onChange={(pago) => setEditando({ ...editando, pago })} />
                  </div>
                  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    <button type="button" style={primario} onClick={guardarLicencia} disabled={!!ocupado}>
                      Guardar licencia
                    </button>
                    <button type="button" style={secundario} onClick={() => setEditando(null)}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {lista && visibles.length === 0 && (
          <p style={{ ...p, padding: 12, color: "var(--tc-gray-500)", margin: 0 }}>{lista.length ? "Nadie coincide con el filtro." : "Todavía no hay personas autorizadas."}</p>
        )}
      </div>
      {ocupado && <p style={{ ...p, color: "var(--tc-blue-700)", marginTop: 8 }}>{ocupado}</p>}
      <p style={{ ...p, fontSize: 12.5, color: "var(--tc-gray-500)", marginTop: 8, marginBottom: 0 }}>
        &quot;Por vencer&quot;: le quedan {DIAS_AVISO} días o menos. Al vencer o suspenderse, la persona ve &quot;No tiene acceso&quot; con el motivo.
      </p>
    </section>
  );
}

function detalleLicencia(a: AutorizadoInfo): string {
  if (!a.vence) return a.suspendido ? "Sin vencimiento · suspendida" : "Sin vencimiento";
  const tipo = a.licenciaMeses ? `Licencia de ${a.licenciaMeses} ${a.licenciaMeses === 1 ? "mes" : "meses"}` : "Licencia hasta una fecha";
  const desde = a.inicio ? ` desde el ${fechaVisible(a.inicio)}` : "";
  const dias = a.diasRestantes ?? 0;
  const resto = dias < 0 ? ` · venció hace ${-dias} día(s)` : dias === 0 ? " · hoy es su último día" : ` · quedan ${dias} día(s)`;
  return `${tipo}${desde} · vence el ${fechaVisible(a.vence)}${a.suspendido ? "" : resto}`;
}

const tarjeta: CSSProperties = { background: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(10,61,98,0.12)", padding: "16px 18px" };
const h2: CSSProperties = { margin: "0 0 8px", fontSize: 17, color: "var(--tc-blue-900)" };
const p: CSSProperties = { margin: "0 0 10px", fontSize: 14, lineHeight: 1.5 };
const nota: CSSProperties = { borderRadius: 8, padding: "10px 14px", fontSize: 13.5, lineHeight: 1.5 };
const campo: CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: 12.5, color: "var(--tc-gray-500)" };
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
const peligro: CSSProperties = { ...secundario, color: "#8a1c14", border: "1px solid #e5a29c" };
