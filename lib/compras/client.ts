import { createRequester, TokenSource } from "../propiedades/client";
import type { ProjectContacts } from "../propiedades/types";
import type {
  AccesosResponse,
  AccionSobreOrden,
  CambioOrden,
  OrdenesResponse,
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
