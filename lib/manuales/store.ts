import { StoreError } from "../propiedades/store";
import { periodoComprado } from "./licencia";
import { IdPasarela, NOMBRE_PASARELA } from "./pasarelas";
import type { EstadoOrden, Orden, Plan } from "./types";

/**
 * Persistence of "Manuales" (tables of supabase/manuales.sql): the technical
 * account, pending connections and the authorized people. Supabase in
 * production, memory for development and tests.
 */
export interface CuentaTecnica {
  refreshCifrado: string;
  accessCifrado: string | null;
  accessExpira: string | null;
  cuentaId: string | null;
  cuentaNombre: string;
  cuentaEmail: string;
  conectadaPor: string | null;
  conectadaEn: string;
  renovadaEn: string;
}

export interface Licencia {
  /** 1 to 12, or null (up to a chosen date, or without expiry). */
  licenciaMeses: number | null;
  /** ISO dates; `vence` is the last day with access (null: no expiry). */
  inicio: string | null;
  vence: string | null;
  suspendido: boolean;
}

export interface Autorizado extends Licencia {
  email: string;
  nombre: string;
  agregadoPor: string | null;
  agregadoEn: string;
}

export interface EstadoOauth {
  state: string;
  verifier: string;
  redirectUri: string;
  creadoPor: string;
  expira: string;
}

export interface ConfigVenta {
  habilitada: boolean;
  planes: Plan[];
  actualizadoPor: string | null;
  actualizadoEn: string | null;
}

export const VENTA_CERRADA: ConfigVenta = { habilitada: false, planes: [], actualizadoPor: null, actualizadoEn: null };

/** A payment reported by a gateway, to apply to its order. */
export interface PagoAplicable {
  orden: string;
  pagoId: string;
  estadoPago: string;
  detallePago: string;
  monto: number;
  moneda: string;
  /** Today (ISO): a license in force is extended from its end, otherwise from today. */
  hoy: string;
}

export interface ResultadoAplicar {
  resultado: "aplicada" | "ya-aplicada" | "pendiente" | "revisar" | "reembolsada" | "duplicado" | "sin-cambios" | "no-existe";
  email?: string;
  /** The license's new expiry (null: it doesn't expire). */
  vence?: string | null;
}

/** Who the license of a person who bought it says added them. */
export function porPago(pasarela: IdPasarela): string {
  return `Compra en ${NOMBRE_PASARELA[pasarela]}`;
}

export interface ManualesStore {
  getCuenta(): Promise<CuentaTecnica | null>;
  /** A newly connected account (replaces the previous one). */
  guardarCuenta(c: Omit<CuentaTecnica, "conectadaEn" | "renovadaEn">): Promise<void>;
  /** New tokens after a refresh; frees the turn. */
  guardarTokens(t: { refreshCifrado: string; accessCifrado: string; accessExpira: string }): Promise<void>;
  borrarCuenta(): Promise<void>;
  /** Takes the turn to refresh the session (only one at a time: refresh tokens are single-use). */
  tomarTurno(segundos: number): Promise<boolean>;
  soltarTurno(): Promise<void>;
  crearEstado(e: EstadoOauth): Promise<void>;
  /** Returns and deletes a pending connection, if it hasn't expired. */
  consumirEstado(state: string): Promise<EstadoOauth | null>;
  listarAutorizados(): Promise<Autorizado[]>;
  /** Adds people (or re-adds them: their license is replaced). */
  agregarAutorizados(lista: { email: string; nombre: string }[], por: string, licencia: Licencia): Promise<void>;
  quitarAutorizado(email: string): Promise<boolean>;
  getAutorizado(email: string): Promise<Autorizado | null>;
  /** False when the e-mail isn't authorized. */
  actualizarLicencia(email: string, licencia: Partial<Licencia>): Promise<boolean>;
  /** Online sales: whether they are open and the plans on sale. */
  getVenta(): Promise<ConfigVenta>;
  guardarVenta(v: { habilitada: boolean; planes: Plan[] }, por: string): Promise<void>;
  crearOrden(o: Pick<Orden, "id" | "email" | "nombre" | "meses" | "monto" | "moneda" | "pasarela">): Promise<void>;
  marcarPreferencia(id: string, preferenciaId: string): Promise<void>;
  getOrden(id: string): Promise<Orden | null>;
  /** Newest first. */
  listarOrdenes(f: { email?: string; estado?: EstadoOrden; desde?: string; limite: number }): Promise<Orden[]>;
  /**
   * Applies a payment to its order, all at once: an approved one (for the
   * order's amount) creates or extends the person's license by the months
   * bought, only once per order; other statuses are only recorded.
   */
  aplicarPago(p: PagoAplicable): Promise<ResultadoAplicar>;
}

const SETUP_HINT =
  "Faltan las tablas de Manuales en Supabase: abre Supabase → SQL Editor y ejecuta una vez el archivo supabase/manuales.sql del repositorio.";
const VENTAS_HINT =
  "Faltan las tablas de la venta en línea de Manuales: abre Supabase → SQL Editor y ejecuta de nuevo el archivo supabase/manuales.sql (es seguro repetirlo; no borra datos).";
const UPGRADE_HINT =
  "Falta actualizar las tablas de Manuales para las licencias: abre Supabase → SQL Editor y ejecuta de nuevo el archivo supabase/manuales.sql (es seguro repetirlo; no borra datos).";

interface AutorizadoRow {
  email: string;
  nombre: string;
  agregado_por: string | null;
  agregado_en: string;
  licencia_meses: number | null;
  inicio: string | null;
  vence: string | null;
  suspendido: boolean | null;
}
const COLUMNAS_AUTORIZADO = "email,nombre,agregado_por,agregado_en,licencia_meses,inicio,vence,suspendido";

function toAutorizado(r: AutorizadoRow): Autorizado {
  return {
    email: r.email,
    nombre: r.nombre,
    agregadoPor: r.agregado_por,
    agregadoEn: r.agregado_en,
    licenciaMeses: r.licencia_meses,
    inicio: r.inicio,
    vence: r.vence,
    suspendido: !!r.suspendido,
  };
}

function licenciaRow(l: Partial<Licencia>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (l.licenciaMeses !== undefined) out.licencia_meses = l.licenciaMeses;
  if (l.inicio !== undefined) out.inicio = l.inicio;
  if (l.vence !== undefined) out.vence = l.vence;
  if (l.suspendido !== undefined) out.suspendido = l.suspendido;
  return out;
}

interface OrdenRow {
  id: string;
  email: string;
  nombre: string;
  meses: number;
  monto: number | string;
  moneda: string;
  pasarela: IdPasarela | null;
  estado: EstadoOrden;
  preferencia_id: string | null;
  pago_id: string | null;
  estado_mp: string | null;
  detalle_mp: string | null;
  creada: string;
  pagada: string | null;
  vence_anterior: string | null;
  vence_nueva: string | null;
  nota: string | null;
}
const COLUMNAS_ORDEN = "id,email,nombre,meses,monto,moneda,pasarela,estado,preferencia_id,pago_id,estado_mp,detalle_mp,creada,pagada,vence_anterior,vence_nueva,nota";

function toOrden(r: OrdenRow): Orden {
  return {
    id: r.id,
    email: r.email,
    nombre: r.nombre,
    meses: r.meses,
    monto: Number(r.monto),
    moneda: r.moneda,
    pasarela: r.pasarela ?? "mercadopago",
    estado: r.estado,
    preferenciaId: r.preferencia_id,
    pagoId: r.pago_id,
    estadoPago: r.estado_mp,
    detallePago: r.detalle_mp,
    creada: r.creada,
    pagada: r.pagada,
    venceAnterior: r.vence_anterior,
    venceNueva: r.vence_nueva,
    nota: r.nota,
  };
}

interface CuentaRow {
  refresh_cifrado: string;
  access_cifrado: string | null;
  access_expira: string | null;
  cuenta_id: string | null;
  cuenta_nombre: string;
  cuenta_email: string;
  conectada_por: string | null;
  conectada_en: string;
  renovada_en: string;
}

function supabaseStore(): ManualesStore | null {
  const rawUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!rawUrl || !key) return null;
  const rest = `${rawUrl.replace(/\/+$/, "")}/rest/v1`;
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(`${rest}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (res.ok) return res;
    const body = await res.text().catch(() => "");
    if (/manuales_venta|manuales_pagos|manuales_aplicar_pago|pasarela/.test(body) && /PGRST20[245]|42P01|42703|42883|Could not find the|does not exist/i.test(body)) throw new StoreError(VENTAS_HINT);
    if (/licencia_meses|suspendido|\bvence\b|\binicio\b/.test(body) && /42703|PGRST204|column/i.test(body)) throw new StoreError(UPGRADE_HINT);
    if (/PGRST20[25]|42P01|42883|Could not find the (table|function)|does not exist/i.test(body)) throw new StoreError(SETUP_HINT);
    if (res.status === 401 || res.status === 403) throw new StoreError("Supabase rechazó la clave del servidor (SUPABASE_SERVICE_ROLE_KEY).");
    let message = "";
    try {
      message = JSON.parse(body).message ?? "";
    } catch {
      // not JSON
    }
    throw new StoreError(`Supabase respondió ${res.status}${message ? `: ${message}` : ""}`);
  }
  const json = async <T>(path: string, init?: RequestInit) => (await (await call(path, init)).json()) as T;
  const eq = (v: string) => `eq.${encodeURIComponent(v)}`;
  const now = () => new Date().toISOString();

  return {
    async getCuenta() {
      const rows = await json<CuentaRow[]>("/manuales_cuenta?id=eq.1&select=refresh_cifrado,access_cifrado,access_expira,cuenta_id,cuenta_nombre,cuenta_email,conectada_por,conectada_en,renovada_en");
      const r = rows[0];
      return r
        ? {
            refreshCifrado: r.refresh_cifrado,
            accessCifrado: r.access_cifrado,
            accessExpira: r.access_expira,
            cuentaId: r.cuenta_id,
            cuentaNombre: r.cuenta_nombre,
            cuentaEmail: r.cuenta_email,
            conectadaPor: r.conectada_por,
            conectadaEn: r.conectada_en,
            renovadaEn: r.renovada_en,
          }
        : null;
    },
    async guardarCuenta(c) {
      await call("/manuales_cuenta?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          id: 1,
          refresh_cifrado: c.refreshCifrado,
          access_cifrado: c.accessCifrado,
          access_expira: c.accessExpira,
          cuenta_id: c.cuentaId,
          cuenta_nombre: c.cuentaNombre,
          cuenta_email: c.cuentaEmail,
          conectada_por: c.conectadaPor,
          conectada_en: now(),
          renovada_en: now(),
          turno_hasta: null,
        }),
      });
    },
    async guardarTokens(t) {
      await call("/manuales_cuenta?id=eq.1", {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ refresh_cifrado: t.refreshCifrado, access_cifrado: t.accessCifrado, access_expira: t.accessExpira, renovada_en: now(), turno_hasta: null }),
      });
    },
    async borrarCuenta() {
      await call("/manuales_cuenta?id=eq.1", { method: "DELETE", headers: { Prefer: "return=minimal" } });
    },
    async tomarTurno(segundos) {
      return json<boolean>("/rpc/manuales_tomar_turno", { method: "POST", body: JSON.stringify({ p_segundos: segundos }) });
    },
    async soltarTurno() {
      await call("/manuales_cuenta?id=eq.1", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ turno_hasta: null }) });
    },
    async crearEstado(e) {
      // Old pending connections go away with each new one.
      await call(`/manuales_oauth_estados?expira=lt.${encodeURIComponent(now())}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
      await call("/manuales_oauth_estados", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ state: e.state, verifier: e.verifier, redirect_uri: e.redirectUri, creado_por: e.creadoPor, expira: e.expira }),
      });
    },
    async consumirEstado(state) {
      const rows = await json<{ state: string; verifier: string; redirect_uri: string; creado_por: string | null; expira: string }[]>(
        `/manuales_oauth_estados?state=${eq(state)}&expira=gt.${encodeURIComponent(now())}`,
        { method: "DELETE", headers: { Prefer: "return=representation" } }
      );
      const r = rows[0];
      return r ? { state: r.state, verifier: r.verifier, redirectUri: r.redirect_uri, creadoPor: r.creado_por ?? "", expira: r.expira } : null;
    },
    async listarAutorizados() {
      const rows = await json<AutorizadoRow[]>(`/manuales_autorizados?select=${COLUMNAS_AUTORIZADO}&order=email.asc&limit=5000`);
      return rows.map(toAutorizado);
    },
    async agregarAutorizados(lista, por, licencia) {
      if (!lista.length) return;
      await call("/manuales_autorizados?on_conflict=email", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(lista.map((a) => ({ email: a.email, nombre: a.nombre, agregado_por: por, agregado_en: now(), ...licenciaRow(licencia) }))),
      });
    },
    async quitarAutorizado(email) {
      const rows = await json<unknown[]>(`/manuales_autorizados?email=${eq(email)}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
      return rows.length > 0;
    },
    async getAutorizado(email) {
      const rows = await json<AutorizadoRow[]>(`/manuales_autorizados?email=${eq(email)}&select=${COLUMNAS_AUTORIZADO}`);
      return rows.length ? toAutorizado(rows[0]) : null;
    },
    async actualizarLicencia(email, licencia) {
      const rows = await json<unknown[]>(`/manuales_autorizados?email=${eq(email)}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(licenciaRow(licencia)),
      });
      return rows.length > 0;
    },
    async getVenta() {
      const rows = await json<{ habilitada: boolean; planes: Plan[] | null; actualizado_por: string | null; actualizado_en: string }[]>(
        "/manuales_venta?id=eq.1&select=habilitada,planes,actualizado_por,actualizado_en"
      );
      const r = rows[0];
      return r ? { habilitada: r.habilitada, planes: r.planes ?? [], actualizadoPor: r.actualizado_por, actualizadoEn: r.actualizado_en } : { ...VENTA_CERRADA };
    },
    async guardarVenta(v, por) {
      await call("/manuales_venta?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ id: 1, habilitada: v.habilitada, planes: v.planes, actualizado_por: por, actualizado_en: now() }),
      });
    },
    async crearOrden(o) {
      await call("/manuales_pagos", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ id: o.id, email: o.email, nombre: o.nombre, meses: o.meses, monto: o.monto, moneda: o.moneda, pasarela: o.pasarela }),
      });
    },
    async marcarPreferencia(id, preferenciaId) {
      await call(`/manuales_pagos?id=${eq(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ preferencia_id: preferenciaId, actualizada: now() }) });
    },
    async getOrden(id) {
      const rows = await json<OrdenRow[]>(`/manuales_pagos?id=${eq(id)}&select=${COLUMNAS_ORDEN}`);
      return rows.length ? toOrden(rows[0]) : null;
    },
    async listarOrdenes(f) {
      let q = `/manuales_pagos?select=${COLUMNAS_ORDEN}&order=creada.desc&limit=${f.limite}`;
      if (f.email) q += `&email=${eq(f.email)}`;
      if (f.estado) q += `&estado=${eq(f.estado)}`;
      if (f.desde) q += `&creada=gte.${encodeURIComponent(f.desde)}`;
      return (await json<OrdenRow[]>(q)).map(toOrden);
    },
    async aplicarPago(p) {
      return json<ResultadoAplicar>("/rpc/manuales_aplicar_pago", {
        method: "POST",
        body: JSON.stringify({
          p_orden: p.orden,
          p_pago_id: p.pagoId,
          p_estado_mp: p.estadoPago,
          p_detalle_mp: p.detallePago,
          p_monto: p.monto,
          p_moneda: p.moneda,
          p_hoy: p.hoy,
        }),
      });
    },
  };
}

export function memoryStore(): ManualesStore {
  let cuenta: (CuentaTecnica & { turnoHasta: number }) | null = null;
  const estados = new Map<string, EstadoOauth>();
  const autorizados = new Map<string, Autorizado>();
  let venta: ConfigVenta = { ...VENTA_CERRADA };
  const ordenes = new Map<string, Orden>();
  const now = () => new Date().toISOString();
  return {
    async getCuenta() {
      if (!cuenta) return null;
      const { turnoHasta: _t, ...c } = cuenta;
      return { ...c };
    },
    async guardarCuenta(c) {
      cuenta = { ...c, conectadaEn: now(), renovadaEn: now(), turnoHasta: 0 };
    },
    async guardarTokens(t) {
      if (cuenta) cuenta = { ...cuenta, ...t, renovadaEn: now(), turnoHasta: 0 };
    },
    async borrarCuenta() {
      cuenta = null;
    },
    async tomarTurno(segundos) {
      if (!cuenta || cuenta.turnoHasta > Date.now()) return false;
      cuenta.turnoHasta = Date.now() + segundos * 1000;
      return true;
    },
    async soltarTurno() {
      if (cuenta) cuenta.turnoHasta = 0;
    },
    async crearEstado(e) {
      estados.set(e.state, e);
    },
    async consumirEstado(state) {
      const e = estados.get(state);
      estados.delete(state);
      return e && Date.parse(e.expira) > Date.now() ? e : null;
    },
    async listarAutorizados() {
      return [...autorizados.values()].sort((a, b) => a.email.localeCompare(b.email));
    },
    async agregarAutorizados(lista, por, licencia) {
      for (const a of lista) autorizados.set(a.email, { email: a.email, nombre: a.nombre, agregadoPor: por, agregadoEn: now(), ...licencia });
    },
    async quitarAutorizado(email) {
      return autorizados.delete(email);
    },
    async getAutorizado(email) {
      const a = autorizados.get(email);
      return a ? { ...a } : null;
    },
    async actualizarLicencia(email, licencia) {
      const a = autorizados.get(email);
      if (!a) return false;
      const cambios = Object.fromEntries(Object.entries(licencia).filter(([, v]) => v !== undefined));
      autorizados.set(email, { ...a, ...cambios });
      return true;
    },
    async getVenta() {
      return { ...venta, planes: venta.planes.map((p) => ({ ...p })) };
    },
    async guardarVenta(v, por) {
      venta = { habilitada: v.habilitada, planes: v.planes.map((p) => ({ ...p })), actualizadoPor: por, actualizadoEn: now() };
    },
    async crearOrden(o) {
      if (ordenes.has(o.id)) throw new StoreError("La compra ya existe.");
      ordenes.set(o.id, {
        ...o,
        estado: "pendiente",
        preferenciaId: null,
        pagoId: null,
        estadoPago: null,
        detallePago: null,
        creada: now(),
        pagada: null,
        venceAnterior: null,
        venceNueva: null,
        nota: null,
      });
    },
    async marcarPreferencia(id, preferenciaId) {
      const o = ordenes.get(id);
      if (o) ordenes.set(id, { ...o, preferenciaId });
    },
    async getOrden(id) {
      const o = ordenes.get(id);
      return o ? { ...o } : null;
    },
    async listarOrdenes(f) {
      return [...ordenes.values()]
        .filter((o) => (!f.email || o.email === f.email) && (!f.estado || o.estado === f.estado) && (!f.desde || o.creada >= f.desde))
        .sort((a, b) => b.creada.localeCompare(a.creada))
        .slice(0, f.limite)
        .map((o) => ({ ...o }));
    },
    async aplicarPago(p) {
      // Same rules as manuales_aplicar_pago in supabase/manuales.sql.
      const o = ordenes.get(p.orden);
      if (!o) return { resultado: "no-existe" };
      const cambiar = (c: Partial<Orden>) => ordenes.set(o.id, { ...o, ...c });
      if (p.estadoPago === "refunded" || p.estadoPago === "charged_back") {
        if (o.estado !== "aprobada" || o.pagoId !== p.pagoId) return { resultado: "sin-cambios" };
        cambiar({ estado: "reembolsada", estadoPago: p.estadoPago, detallePago: p.detallePago });
        return { resultado: "reembolsada", email: o.email };
      }
      if (p.estadoPago !== "approved") {
        if (o.estado !== "pendiente") return { resultado: "sin-cambios" };
        cambiar({ estadoPago: p.estadoPago, detallePago: p.detallePago });
        return { resultado: "pendiente", email: o.email };
      }
      if (o.pagoId === p.pagoId) return { resultado: "ya-aplicada", email: o.email, vence: o.venceNueva };
      if (o.estado !== "pendiente") {
        cambiar({ nota: [o.nota, `Otro pago aprobado (${p.pagoId}) para esta compra: revísalo en ${NOMBRE_PASARELA[o.pasarela]}.`].filter(Boolean).join(" ") });
        return { resultado: "duplicado", email: o.email };
      }
      const pagado = { pagoId: p.pagoId, estadoPago: p.estadoPago, detallePago: p.detallePago, pagada: now() };
      if (p.monto < o.monto || p.moneda.toUpperCase() !== o.moneda.toUpperCase()) {
        cambiar({ ...pagado, estado: "revisar", nota: `Se pagaron ${p.monto} ${p.moneda} y la compra era de ${o.monto} ${o.moneda}: no se aplicó la licencia.` });
        return { resultado: "revisar", email: o.email };
      }
      const a = autorizados.get(o.email);
      const periodo = periodoComprado(a ? a.vence : undefined, o.meses, p.hoy);
      if (!periodo) {
        cambiar({ ...pagado, estado: "aprobada", nota: "La persona ya tenía acceso sin vencimiento: no se cambió su licencia." });
        return { resultado: "aplicada", email: o.email, vence: null };
      }
      autorizados.set(
        o.email,
        a
          ? { ...a, nombre: a.nombre || o.nombre, licenciaMeses: o.meses, inicio: periodo.inicio, vence: periodo.vence }
          : { email: o.email, nombre: o.nombre, agregadoPor: porPago(o.pasarela), agregadoEn: now(), licenciaMeses: o.meses, inicio: periodo.inicio, vence: periodo.vence, suspendido: false }
      );
      cambiar({ ...pagado, estado: "aprobada", venceAnterior: a?.vence ?? null, venceNueva: periodo.vence });
      return { resultado: "aplicada", email: o.email, vence: periodo.vence };
    },
  };
}

let selected: ManualesStore | null | undefined;
let devStore: ManualesStore | undefined;

export function manualesStore(): ManualesStore {
  if (selected === undefined) selected = supabaseStore();
  if (selected) return selected;
  if (process.env.NODE_ENV === "production") {
    throw new StoreError("La base de datos de Manuales no está conectada (Supabase). Conéctala en Vercel, ejecuta supabase/manuales.sql y vuelve a desplegar.");
  }
  return (devStore ??= memoryStore());
}
