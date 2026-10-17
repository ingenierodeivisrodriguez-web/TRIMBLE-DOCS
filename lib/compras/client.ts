import { createRequester, TokenSource } from "../propiedades/client";
import type { ProjectContacts } from "../propiedades/types";
import type {
  AccesosResponse,
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
