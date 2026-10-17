import { ApiError, createRequester, TokenSource } from "../propiedades/client";
import type { ProjectContacts } from "../propiedades/types";
import type {
  AccionSobreRecepcion,
  CambioRecepcion,
  RecepcionesResponse,
  Documento,
  DocumentosResponse,
  EntidadDocumento,
  EstadoCarpetas,
  NuevoDocumento,
  SubidaDocumento,
  SyncEntrada,
  TipoDocumentoLegal,
  AccesosResponse,
  AccionSobreOrden,
  CambioOrden,
  OrdenesResponse,
  PasoPruebaCde,
  PruebaCdeResponse,
  AccionSobreComparativo,
  CambioCotizacion,
  CambioEstadoProveedor,
  CambioProveedor,
  CotizacionesResponse,
  ProveedoresResponse,
  AccionSobreRequisicion,
  CambioAsignacion,
  CambioRequisicion,
  CambioRol,
  ConfigCompras,
  EntradaAuditoria,
  EstadoResponse,
  FiltroAuditoria,
  InsumosResponse,
  RequisicionesResponse,
} from "./types";

/** What the Compras screen needs from the data service. */
export interface ComprasApi {
  getEstado(): Promise<EstadoResponse>;
  activar(): Promise<EstadoResponse>;
  getAccesos(): Promise<AccesosResponse>;
  getContactos(): Promise<ProjectContacts>;
  guardarUsuario(cambio: CambioAsignacion): Promise<AccesosResponse>;
  guardarRol(cambio: CambioRol): Promise<AccesosResponse>;
  getAuditoria(filtro: FiltroAuditoria): Promise<EntradaAuditoria[]>;
  getInsumos(): Promise<InsumosResponse>;
  getRequisiciones(): Promise<RequisicionesResponse>;
  guardarRequisicion(cambio: CambioRequisicion): Promise<RequisicionesResponse>;
  accionRequisicion(id: string, accion: AccionSobreRequisicion): Promise<RequisicionesResponse>;
  guardarConfig(config: ConfigCompras): Promise<ConfigCompras>;
  getProveedores(): Promise<ProveedoresResponse>;
  guardarProveedor(cambio: Omit<CambioProveedor, "nit"> & { nit: string }): Promise<ProveedoresResponse>;
  estadoProveedor(id: string, cambio: CambioEstadoProveedor): Promise<ProveedoresResponse>;
  getCotizaciones(): Promise<CotizacionesResponse>;
  guardarCotizacion(cambio: CambioCotizacion): Promise<CotizacionesResponse>;
  anularCotizacion(id: string, motivo: string, version: number): Promise<CotizacionesResponse>;
  accionComparativo(requisicionId: string, accion: AccionSobreComparativo): Promise<CotizacionesResponse>;
  getOrdenes(): Promise<OrdenesResponse>;
  guardarOrden(cambio: CambioOrden): Promise<OrdenesResponse>;
  accionOrden(id: string, accion: AccionSobreOrden): Promise<OrdenesResponse>;
  getRecepciones(): Promise<RecepcionesResponse>;
  guardarRecepcion(cambio: CambioRecepcion): Promise<RecepcionesResponse>;
  accionRecepcion(id: string, accion: AccionSobreRecepcion): Promise<RecepcionesResponse>;
  pruebaCde(paso: PasoPruebaCde, datos?: { carpetaId?: string; uploadId?: string }): Promise<PruebaCdeResponse>;
  getDocumentos(filtro?: { entidadTipo?: EntidadDocumento; entidadId?: string }): Promise<DocumentosResponse>;
  crearDocumento(nuevo: NuevoDocumento & { id: string }): Promise<SubidaDocumento>;
  /** The server sends the file to Trimble (small files, when the browser can't). */
  enviarDocumento(id: string, archivo: Blob): Promise<{ documento: Documento }>;
  confirmarDocumento(id: string): Promise<{ documento: Documento }>;
  reintentarDocumento(id: string): Promise<SubidaDocumento>;
  abrirDocumento(id: string): Promise<{ url: string }>;
  anularDocumento(id: string, motivo: string): Promise<{ documento: Documento }>;
  historialDocumento(id: string): Promise<SyncEntrada[]>;
  guardarTiposDocumento(tipos: TipoDocumentoLegal[], version: number): Promise<DocumentosResponse>;
  inspeccionarCarpetas(): Promise<EstadoCarpetas>;
  prepararCarpetas(): Promise<EstadoCarpetas>;
}

/** The HTTP client for /api/compras, authenticated with the user's Trimble token. */
export function comprasApi(projectId: string, auth: TokenSource): ComprasApi {
  const request = createRequester("/api/compras", projectId, auth);
  return {
    getEstado: () => request<EstadoResponse>("/estado"),
    activar: () => request<EstadoResponse>("/activar", { method: "POST" }),
    getAccesos: () => request<AccesosResponse>("/accesos"),
    getContactos: () => request<ProjectContacts>("/contactos"),
    getInsumos: () => request<InsumosResponse>("/insumos"),
    getRequisiciones: () => request<RequisicionesResponse>("/requisiciones"),
    guardarRequisicion: (cambio) => request<RequisicionesResponse>("/requisiciones", { method: "PUT", body: JSON.stringify(cambio) }),
    accionRequisicion: (id, accion) => request<RequisicionesResponse>(`/requisiciones/${encodeURIComponent(id)}/estado`, { method: "POST", body: JSON.stringify(accion) }),
    guardarConfig: (config) => request<ConfigCompras>("/config", { method: "PUT", body: JSON.stringify(config) }),
    getProveedores: () => request<ProveedoresResponse>("/proveedores"),
    guardarProveedor: (cambio) => request<ProveedoresResponse>("/proveedores", { method: "PUT", body: JSON.stringify(cambio) }),
    estadoProveedor: (id, cambio) => request<ProveedoresResponse>(`/proveedores/${encodeURIComponent(id)}/estado`, { method: "POST", body: JSON.stringify(cambio) }),
    getCotizaciones: () => request<CotizacionesResponse>("/cotizaciones"),
    guardarCotizacion: (cambio) => request<CotizacionesResponse>("/cotizaciones", { method: "PUT", body: JSON.stringify(cambio) }),
    anularCotizacion: (id, motivo, version) => request<CotizacionesResponse>(`/cotizaciones/${encodeURIComponent(id)}/anular`, { method: "POST", body: JSON.stringify({ motivo, version }) }),
    getOrdenes: () => request<OrdenesResponse>("/ordenes"),
    getRecepciones: () => request<RecepcionesResponse>("/recepciones"),
    guardarRecepcion: (cambio) => request<RecepcionesResponse>("/recepciones", { method: "PUT", body: JSON.stringify(cambio) }),
    accionRecepcion: (id, accion) => request<RecepcionesResponse>(`/recepciones/${encodeURIComponent(id)}/estado`, { method: "POST", body: JSON.stringify(accion) }),
    getDocumentos: (filtro = {}) => {
      const q = new URLSearchParams();
      if (filtro.entidadTipo) q.set("entidadTipo", filtro.entidadTipo);
      if (filtro.entidadId) q.set("entidadId", filtro.entidadId);
      const qs = q.toString();
      return request<DocumentosResponse>(`/documentos${qs ? `?${qs}` : ""}`);
    },
    crearDocumento: (nuevo) => request<SubidaDocumento>("/documentos", { method: "POST", body: JSON.stringify(nuevo) }),
    async enviarDocumento(id, archivo) {
      // Raw bytes, not JSON: its own request with the same token.
      const token = (auth.refresh ? await auth.refresh() : "") || auth.get();
      const res = await fetch(`/api/compras/documentos/${encodeURIComponent(id)}/contenido?projectId=${encodeURIComponent(projectId)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
        body: archivo,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(body.error ?? `Error ${res.status}`, res.status, body.code);
      return body as { documento: Documento };
    },
    confirmarDocumento: (id) => request<{ documento: Documento }>(`/documentos/${encodeURIComponent(id)}/confirmar`, { method: "POST" }),
    reintentarDocumento: (id) => request<SubidaDocumento>(`/documentos/${encodeURIComponent(id)}/reintentar`, { method: "POST" }),
    abrirDocumento: (id) => request<{ url: string }>(`/documentos/${encodeURIComponent(id)}/abrir`, { method: "POST" }),
    anularDocumento: (id, motivo) => request<{ documento: Documento }>(`/documentos/${encodeURIComponent(id)}/anular`, { method: "POST", body: JSON.stringify({ motivo }) }),
    historialDocumento: (id) => request<{ historial: SyncEntrada[] }>(`/documentos/${encodeURIComponent(id)}/historial`).then((r) => r.historial),
    guardarTiposDocumento: (tipos, version) => request<DocumentosResponse>("/documentos/tipos", { method: "PUT", body: JSON.stringify({ tipos, version }) }),
    inspeccionarCarpetas: () => request<EstadoCarpetas>("/cde/carpetas"),
    prepararCarpetas: () => request<EstadoCarpetas>("/cde/carpetas", { method: "POST" }),
    pruebaCde: (paso, datos = {}) => request<PruebaCdeResponse>("/cde/prueba", { method: "POST", body: JSON.stringify({ paso, ...datos }) }),
    guardarOrden: (cambio) => request<OrdenesResponse>("/ordenes", { method: "PUT", body: JSON.stringify(cambio) }),
    accionOrden: (id, accion) => request<OrdenesResponse>(`/ordenes/${encodeURIComponent(id)}/estado`, { method: "POST", body: JSON.stringify(accion) }),
    accionComparativo: (requisicionId, accion) => request<CotizacionesResponse>(`/comparativos/${encodeURIComponent(requisicionId)}`, { method: "POST", body: JSON.stringify(accion) }),
    guardarUsuario: (cambio) => request<AccesosResponse>("/accesos/usuarios", { method: "PUT", body: JSON.stringify(cambio) }),
    guardarRol: (cambio) => request<AccesosResponse>("/accesos/roles", { method: "PUT", body: JSON.stringify(cambio) }),
    async getAuditoria(f) {
      const q = new URLSearchParams();
      if (f.desde) q.set("desde", f.desde);
      if (f.hasta) q.set("hasta", f.hasta);
      if (f.actorId) q.set("actor", f.actorId);
      if (f.modulo) q.set("modulo", f.modulo);
      if (f.resultado) q.set("resultado", f.resultado);
      if (f.antesDe) q.set("antesDe", String(f.antesDe));
      if (f.limite) q.set("limite", String(f.limite));
      const qs = q.toString();
      return (await request<{ entradas: EntradaAuditoria[] }>(`/auditoria${qs ? `?${qs}` : ""}`)).entradas;
    },
  };
}
