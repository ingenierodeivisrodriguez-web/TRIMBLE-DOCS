import { ApiError, createRequester, TokenSource } from "../propiedades/client";
import type { IdPasarela } from "./pasarelas";
import { expiresSoon } from "../propiedades/token";
import type {
  ArchivoResponse,
  AutorizadoInfo,
  BusquedaResponse,
  CarpetaResponse,
  CompraIniciada,
  ConfigVentaInfo,
  EstadoCompra,
  EstadoManuales,
  Orden,
  Plan,
} from "./types";

/** A license as the administrator sets it: 1-12 months from a date, up to a date, or without expiry. */
export type LicenciaPedido = { meses: number; inicio?: string } | { vence: string; inicio?: string } | { sinVencimiento: true };

export interface ManualesApi {
  /** Who the user is and what they can do (and, for administrators, the technical account). */
  estado(): Promise<EstadoManuales>;
  /** Administrators: the Trimble sign-in URL to connect the technical account. */
  conectar(): Promise<{ url: string }>;
  /** Administrators: finishes the connection with the address Trimble sent the browser to. */
  completar(enlace: string): Promise<{ ok: boolean; titulo: string; texto: string }>;
  desconectar(): Promise<void>;
  /** The authorized people, and "today" as the server counts licenses. */
  autorizados(): Promise<{ hoy: string; autorizados: AutorizadoInfo[] }>;
  autorizar(texto: string, licencia: LicenciaPedido): Promise<{ agregados: number; invalidos: string[] }>;
  actualizarAutorizado(email: string, cambios: { licencia?: LicenciaPedido; suspendido?: boolean }): Promise<void>;
  quitarAutorizado(email: string): Promise<void>;
  /** Starts the purchase of a license of `meses` for the user's own e-mail with a gateway (pay it at the returned `url`). */
  comprar(meses: number, pasarela: IdPasarela): Promise<CompraIniciada>;
  /** How the user's purchase is going (also checked against its gateway while pending). */
  compra(orden: string): Promise<EstadoCompra>;
  /** Administrators: online sales and how Mercado Pago and Wompi are set up. */
  venta(): Promise<ConfigVentaInfo>;
  guardarVenta(v: { habilitada: boolean; planes: Plan[] }): Promise<void>;
  /** Administrators: the purchases, newest first. */
  pagos(): Promise<{ hoy: string; ordenes: Orden[] }>;
  /** Administrators: every purchase with a payment, for the statements (and today / the time zone days are counted in). */
  contabilidad(): Promise<{ hoy: string; zona: string; ordenes: Orden[] }>;
  /** Administrators: checks a pending purchase against its gateway now. */
  verificarPago(orden: string): Promise<Orden>;
  carpeta(folderId?: string | null): Promise<CarpetaResponse>;
  buscar(q: string): Promise<BusquedaResponse>;
  /** A fresh link to the file (or its PDF rendition) and the link to open it in Trimble Connect. */
  archivo(fileId: string, pdf?: boolean): Promise<ArchivoResponse>;
  /** The file's content (or its PDF rendition), reporting progress as it arrives. */
  contenido(fileId: string, pdf: boolean, onProgress?: (loaded: number, total: number | null) => void, signal?: AbortSignal): Promise<Blob>;
}

export function manualesApi(projectId: string, auth: TokenSource): ManualesApi {
  const request = createRequester("/api/manuales", projectId, auth);
  const q = (params: Record<string, string | null | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
    const text = s.toString();
    return text ? `?${text}` : "";
  };

  async function contenido(fileId: string, pdf: boolean, onProgress?: (loaded: number, total: number | null) => void, signal?: AbortSignal): Promise<Blob> {
    const url = `/api/manuales/archivo/contenido${q({ fileId, pdf: pdf ? "1" : null, projectId })}`;
    const send = (token: string) => fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal });
    let token = auth.get();
    if (auth.refresh && (!token || expiresSoon(token))) token = (await auth.refresh()) || token;
    let res = await send(token);
    if (res.status === 401 && auth.refresh) {
      const fresh = await auth.refresh();
      if (fresh) res = await send(fresh);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.error ?? `Error ${res.status}`, res.status, body.code);
    }
    const type = res.headers.get("content-type") ?? "application/octet-stream";
    const total = Number(res.headers.get("content-length")) || null;
    if (!res.body) return new Blob([await res.arrayBuffer()], { type });
    const reader = res.body.getReader();
    const partes: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      partes.push(value);
      loaded += value.length;
      onProgress?.(loaded, total);
    }
    return new Blob(partes as BlobPart[], { type });
  }

  const send = (method: string, body?: unknown): RequestInit => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

  return {
    estado: () => request("/estado"),
    conectar: () => request("/admin/conectar", send("POST", {})),
    completar: (enlace) => request("/admin/completar", send("POST", { enlace })),
    async desconectar() {
      await request("/admin/cuenta", send("DELETE"));
    },
    autorizados: () => request("/admin/autorizados"),
    autorizar: (texto, licencia) => request("/admin/autorizados", send("POST", { texto, licencia })),
    async actualizarAutorizado(email, cambios) {
      await request("/admin/autorizados", send("PATCH", { email, ...cambios }));
    },
    async quitarAutorizado(email) {
      await request(`/admin/autorizados${q({ email })}`, send("DELETE"));
    },
    comprar: (meses, pasarela) => request("/pagos", send("POST", { meses, pasarela })),
    compra: (orden) => request(`/pagos/orden${q({ id: orden })}`),
    venta: () => request("/admin/venta"),
    async guardarVenta(v) {
      await request("/admin/venta", send("PUT", v));
    },
    pagos: () => request("/admin/pagos"),
    contabilidad: () => request("/admin/contabilidad"),
    async verificarPago(orden) {
      return (await request<{ orden: Orden }>("/admin/pagos", send("POST", { orden }))).orden;
    },
    carpeta: (folderId) => request(`/carpeta${q({ folderId })}`),
    buscar: (text) => request(`/buscar${q({ q: text })}`),
    archivo: (fileId, pdf) => request(`/archivo${q({ fileId, pdf: pdf ? "1" : null })}`),
    contenido,
  };
}
