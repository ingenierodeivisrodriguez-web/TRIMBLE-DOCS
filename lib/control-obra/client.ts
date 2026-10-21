import { createRequester, TokenSource } from "../propiedades/client";
import type { ProjectContacts } from "../propiedades/types";
import type {
  AccesosResponse,
  CambioAsignacion,
  CambioEmpresa,
  CambioFlujo,
  CambioNivel,
  CambioNodo,
  CambioRol,
  ConfigProyecto,
  EmpresasResponse,
  EntradaBitacora,
  EstadoResponse,
  EstructuraResponse,
  FiltroBitacora,
  FlujosResponse,
  Licencia,
  NuevaLicencia,
  VerificacionBitacora,
} from "./types";

/** What the Control de Obra screens need from the data service. */
export interface ObraApi {
  getEstado(): Promise<EstadoResponse>;
  vincular(empresaId: string): Promise<EstadoResponse>;
  desvincular(motivo: string): Promise<EstadoResponse>;
  getAccesos(): Promise<AccesosResponse>;
  getContactos(): Promise<ProjectContacts>;
  guardarAsignacion(cambio: CambioAsignacion): Promise<AccesosResponse>;
  guardarRol(cambio: CambioRol): Promise<AccesosResponse>;
  guardarUsuario(cambio: { id: string; activo: boolean; version: number }): Promise<AccesosResponse>;
  getEstructura(): Promise<EstructuraResponse>;
  guardarNivel(cambio: Omit<CambioNivel, "projectId"> & { plantilla: boolean }): Promise<EstructuraResponse>;
  guardarNodo(cambio: CambioNodo): Promise<EstructuraResponse>;
  guardarConfig(config: ConfigProyecto): Promise<EstructuraResponse>;
  getFlujos(): Promise<FlujosResponse>;
  guardarFlujo(cambio: CambioFlujo): Promise<FlujosResponse>;
  getBitacora(filtro: FiltroBitacora): Promise<{ entradas: EntradaBitacora[]; todaLaEmpresa: boolean }>;
  verificarBitacora(): Promise<VerificacionBitacora>;
  admin: {
    getEmpresas(): Promise<EmpresasResponse>;
    guardarEmpresa(cambio: CambioEmpresa): Promise<EmpresasResponse>;
    getLicencias(empresaId: string): Promise<Licencia[]>;
    registrarLicencia(l: Omit<NuevaLicencia, "suspendida">): Promise<EmpresasResponse>;
    guardarAdministrador(a: { empresaId: string; email: string; nombre: string; admin: boolean }): Promise<EmpresasResponse>;
    getBitacora(empresaId: string | null, filtro: FiltroBitacora): Promise<EntradaBitacora[]>;
    verificarBitacora(empresaId: string | null): Promise<VerificacionBitacora>;
  };
}

/** "?desde=…&hasta=…" from a filter of the bitácora. */
export function consultaBitacora(f: FiltroBitacora, extra: Record<string, string> = {}): string {
  const q = new URLSearchParams(extra);
  if (f.desde) q.set("desde", f.desde);
  if (f.hasta) q.set("hasta", f.hasta);
  if (f.actorId) q.set("actor", f.actorId);
  if (f.modulo) q.set("modulo", f.modulo);
  if (f.resultado) q.set("resultado", f.resultado);
  if (f.soloProyecto) q.set("soloProyecto", "1");
  if (f.antesDe) q.set("antesDe", String(f.antesDe));
  if (f.limite) q.set("limite", String(f.limite));
  const qs = q.toString();
  return qs ? `?${qs}` : "";
}

/** The HTTP client for /api/control-obra, authenticated with the user's Trimble token. */
export function obraApi(projectId: string, auth: TokenSource): ObraApi {
  const request = createRequester("/api/control-obra", projectId, auth);
  const put = <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) });
  const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return {
    getEstado: () => request<EstadoResponse>("/estado"),
    vincular: (empresaId) => post<EstadoResponse>("/vincular", { empresaId }),
    desvincular: (motivo) => post<EstadoResponse>("/desvincular", { motivo }),
    getAccesos: () => request<AccesosResponse>("/accesos"),
    getContactos: () => request<ProjectContacts>("/contactos"),
    guardarAsignacion: (cambio) => put<AccesosResponse>("/accesos/asignaciones", cambio),
    guardarRol: (cambio) => put<AccesosResponse>("/accesos/roles", cambio),
    guardarUsuario: (cambio) => put<AccesosResponse>("/accesos/usuarios", cambio),
    getEstructura: () => request<EstructuraResponse>("/estructura"),
    guardarNivel: (cambio) => put<EstructuraResponse>("/estructura/niveles", cambio),
    guardarNodo: (cambio) => put<EstructuraResponse>("/estructura/nodos", cambio),
    guardarConfig: (config) => put<EstructuraResponse>("/config", config),
    getFlujos: () => request<FlujosResponse>("/flujos"),
    guardarFlujo: (cambio) => put<FlujosResponse>("/flujos", cambio),
    getBitacora: (f) => request<{ entradas: EntradaBitacora[]; todaLaEmpresa: boolean }>(`/bitacora${consultaBitacora(f)}`),
    verificarBitacora: () => post<VerificacionBitacora>("/bitacora/verificar"),
    admin: {
      getEmpresas: () => request<EmpresasResponse>("/admin/empresas"),
      guardarEmpresa: (cambio) => put<EmpresasResponse>("/admin/empresas", cambio),
      getLicencias: (empresaId) => request<{ licencias: Licencia[] }>(`/admin/licencias?empresaId=${encodeURIComponent(empresaId)}`).then((r) => r.licencias),
      registrarLicencia: (l) => post<EmpresasResponse>("/admin/licencias", l),
      guardarAdministrador: (a) => put<EmpresasResponse>("/admin/administradores", a),
      getBitacora: (empresaId, f) =>
        request<{ entradas: EntradaBitacora[] }>(`/admin/bitacora${consultaBitacora(f, empresaId ? { empresaId } : {})}`).then((r) => r.entradas),
      verificarBitacora: (empresaId) => post<VerificacionBitacora>(`/admin/bitacora/verificar${empresaId ? `?empresaId=${encodeURIComponent(empresaId)}` : ""}`),
    },
  };
}
