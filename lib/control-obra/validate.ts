import { leerNit } from "../compras/proveedores";
import { ServiceError } from "../propiedades/service";
import { isValidIsoDate } from "../propiedades/values";
import { esCorreo } from "./accesos";
import { esPermisoValido } from "./roles";
import {
  CambioAsignacion,
  CambioEmpresa,
  CambioFlujo,
  CambioMedicion,
  CambioNivel,
  CambioNodo,
  CambioRol,
  ConfigProyecto,
  EstadoNodo,
  EventoLicencia,
  FiltroBitacora,
  FuenteNivel,
  GRUPOS_LICENCIA,
  GrupoLicencia,
  MAX_BITACORA,
  MAX_ELEMENTOS_MEDICION,
  MAX_LINEAS_MEDICION,
  MAX_PASOS,
  MODULOS,
  NuevaLicencia,
  TIPOS_FLUJO,
  Ubicacion,
  VistaObra,
} from "./types";

/** Checks everything that comes from the browser before the rules see it. */

function bad(message: string): never {
  throw new ServiceError(message, 400, "datos");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_ID_RE = /^[A-Za-z0-9_.@:-]{1,100}$/;
const EVENTOS: EventoLicencia[] = ["activacion", "renovacion", "cambio", "suspension", "reactivacion"];
const FUENTES: FuenteNivel[] = ["modelo", "propiedad", "manual"];
const ESTADOS_NODO: EstadoNodo[] = ["activo", "cerrado", "inactivo"];
const MODULOS_BITACORA = new Set<string>([...MODULOS.map((m) => m.id), "empresas"]);

type Obj = Record<string, unknown>;
const objeto = (body: unknown): Obj => (body && typeof body === "object" && !Array.isArray(body) ? (body as Obj) : bad("Se esperaba un objeto."));

function texto(value: unknown, what: string, max: number): string {
  if (typeof value !== "string") bad(`${what}: se esperaba un texto.`);
  if (value.length > max) bad(`${what}: máximo ${max} caracteres.`);
  return value;
}

function fecha(value: unknown, what: string): string {
  if (typeof value !== "string" || !isValidIsoDate(value)) bad(`${what}: fecha no válida.`);
  return value;
}

function fechaOpcional(value: unknown, what: string): string | null {
  return value === null || value === undefined || value === "" ? null : fecha(value, what);
}

function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) bad("Falta la versión de lo que se está editando.");
  return value;
}

function booleano(value: unknown, what: string): boolean {
  if (typeof value !== "boolean") bad(`Falta indicar ${what}.`);
  return value;
}

function uuid(value: unknown, what: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) bad(`${what} no válido.`);
  return value;
}

function uuidOpcional(value: unknown, what: string): string | undefined {
  return value === undefined ? undefined : uuid(value, what);
}

function entero(value: unknown, what: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) bad(`${what}: un entero entre ${min} y ${max}.`);
  return value;
}

export function leerUserId(value: unknown): string {
  if (typeof value !== "string" || !USER_ID_RE.test(value)) bad("Persona no válida.");
  return value;
}

// ---------------------------------------------------------------- technical administrator

/** A company; its NIT, when given, with the right check digit. */
export function leerCambioEmpresa(body: unknown): CambioEmpresa & { nitLimpio: string; dv: number | null } {
  const o = objeto(body);
  const id = uuidOpcional(o.id, "Empresa");
  const nombre = texto(o.nombre, "Nombre", 150).trim();
  if (!nombre) bad("La empresa necesita un nombre.");
  const nitTexto = o.nit === undefined ? "" : texto(o.nit, "NIT", 30).trim();
  let nitLimpio = "";
  let dv: number | null = null;
  if (nitTexto) {
    const r = leerNit(nitTexto);
    if ("error" in r) bad(r.error);
    nitLimpio = r.nit;
    dv = r.dv;
  }
  return { ...(id ? { id } : {}), nombre, nit: nitTexto, activa: booleano(o.activa, "si la empresa queda activa"), version: version(o.version), nitLimpio, dv };
}

export function leerNuevaLicencia(body: unknown): NuevaLicencia {
  const o = objeto(body);
  const evento = o.evento as EventoLicencia;
  if (!EVENTOS.includes(evento)) bad("Evento de licencia no válido.");
  if (!Array.isArray(o.grupos)) bad("Los módulos deben ser una lista.");
  const grupos = [...new Set(o.grupos as unknown[])].map((g) => {
    if (typeof g !== "string" || !GRUPOS_LICENCIA.some((x) => x.id === g)) bad(`Módulo no válido: "${String(g)}".`);
    return g as GrupoLicencia;
  });
  return {
    empresaId: uuid(o.empresaId, "Empresa"),
    evento,
    plan: texto(o.plan, "Plan", 80).trim(),
    desde: fecha(o.desde, "Desde"),
    hasta: fechaOpcional(o.hasta, "Hasta"),
    maxProyectos: entero(o.maxProyectos, "Proyectos", 1, 10_000),
    maxUsuarios: entero(o.maxUsuarios, "Personas", 1, 100_000),
    grupos: GRUPOS_LICENCIA.map((g) => g.id).filter((g) => grupos.includes(g)),
    suspendida: evento === "suspension",
    motivo: o.motivo === undefined ? "" : texto(o.motivo, "Motivo", 1000).trim(),
    soporte: o.soporte === undefined ? "" : texto(o.soporte, "Soporte", 300).trim(),
  };
}

export function leerAdminEmpresa(body: unknown): { empresaId: string; email: string; nombre: string; admin: boolean } {
  const o = objeto(body);
  const email = texto(o.email, "Correo", 254).trim().toLowerCase();
  if (!esCorreo(email)) bad("Escribe el correo de Trimble Connect de la persona.");
  return {
    empresaId: uuid(o.empresaId, "Empresa"),
    email,
    nombre: o.nombre === undefined ? "" : texto(o.nombre, "Nombre", 200).trim(),
    admin: booleano(o.admin, "si queda como administrador"),
  };
}

// ---------------------------------------------------------------- company and project

export function leerVincular(body: unknown): { empresaId: string } {
  return { empresaId: uuid(objeto(body).empresaId, "Empresa") };
}

export function leerMotivo(body: unknown): string {
  const motivo = texto(objeto(body).motivo, "Motivo", 1000).trim();
  if (!motivo) throw new ServiceError("Escribe el motivo.", 400, "motivo-requerido");
  return motivo;
}

export function leerCambioAsignacion(body: unknown): CambioAsignacion {
  const o = objeto(body);
  const desde = fecha(o.desde, "Desde");
  const hasta = fechaOpcional(o.hasta, "Hasta");
  if (hasta !== null && hasta < desde) bad("La fecha final no puede ser anterior a la inicial.");
  return {
    userId: leerUserId(o.userId),
    rolId: uuid(o.rolId, "Rol"),
    adminProyecto: booleano(o.adminProyecto, "si es administrador del proyecto"),
    desde,
    hasta,
    activo: booleano(o.activo, "si el acceso queda activo"),
    version: version(o.version),
  };
}

export function leerCambioRol(body: unknown): CambioRol {
  const o = objeto(body);
  const id = uuidOpcional(o.id, "Rol");
  const nombre = texto(o.nombre, "Nombre", 80).trim();
  if (!nombre) bad("El rol necesita un nombre.");
  if (!Array.isArray(o.permisos)) bad("Los permisos deben ser una lista.");
  for (const p of o.permisos) if (!esPermisoValido(p)) bad(`Permiso no válido: "${String(p)}".`);
  return {
    ...(id ? { id } : {}),
    nombre,
    descripcion: o.descripcion === undefined ? "" : texto(o.descripcion, "Descripción", 300).trim(),
    permisos: [...new Set(o.permisos as string[])] as CambioRol["permisos"],
    activo: booleano(o.activo, "si el rol queda activo"),
    version: version(o.version),
  };
}

export function leerCambioUsuario(body: unknown): { id: string; activo: boolean; version: number } {
  const o = objeto(body);
  return { id: uuid(o.id, "Persona"), activo: booleano(o.activo, "si la persona queda activa"), version: version(o.version) };
}

/** Level keys ("torre", "nivel"): no repeated ones. */
function leerClavesNivel(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) bad("Los niveles obligatorios deben ser una lista.");
  const claves = value.map((x) => (typeof x === "string" && /^[a-z][a-z0-9_]{1,39}$/.test(x) ? x : bad("Nivel no válido.")));
  return [...new Set(claves)];
}

export function leerConfig(body: unknown): ConfigProyecto {
  const o = objeto(body);
  const responsableTecnicoId = o.responsableTecnicoId === null || o.responsableTecnicoId === undefined ? null : leerUserId(o.responsableTecnicoId);
  const tol = o.toleranciaVerificacionPct;
  if (typeof tol !== "number" || !Number.isFinite(tol) || tol < 0 || tol > 100) bad("La tolerancia debe estar entre 0 % y 100 %.");
  return {
    responsableTecnicoId,
    responsableTecnicoNombre: responsableTecnicoId ? texto(o.responsableTecnicoNombre, "Responsable técnico", 200).trim() : "",
    toleranciaVerificacionPct: Math.round(tol * 100) / 100,
    permiteAceptadoConObservaciones: booleano(o.permiteAceptadoConObservaciones, "si se permite aceptar con observaciones"),
    ubicacionObligatoria: leerClavesNivel(o.ubicacionObligatoria ?? []),
    version: version(o.version),
  };
}

export function leerCambioNivel(body: unknown): CambioNivel & { plantilla: boolean } {
  const o = objeto(body);
  const id = uuidOpcional(o.id, "Nivel");
  const fuente = o.fuente as FuenteNivel;
  if (!FUENTES.includes(fuente)) bad("Fuente del nivel no válida.");
  const padre = o.padreClave === null || o.padreClave === undefined || o.padreClave === "" ? null : texto(o.padreClave, "Nivel superior", 40);
  return {
    ...(id ? { id } : {}),
    plantilla: booleano(o.plantilla, "si es de la plantilla de la empresa"),
    projectId: null,
    clave: texto(o.clave, "Clave", 40).trim(),
    nombre: texto(o.nombre, "Nombre", 60).trim(),
    orden: entero(o.orden, "Orden", 0, 999),
    padreClave: padre,
    fuente,
    claveFuente: fuente === "manual" ? "" : texto(o.claveFuente, "Propiedad o atributo", 200).trim(),
    activo: booleano(o.activo, "si el nivel queda activo"),
    version: version(o.version),
  };
}

export function leerCambioNodo(body: unknown): CambioNodo {
  const o = objeto(body);
  const id = uuidOpcional(o.id, "Valor");
  const estado = o.estado as EstadoNodo;
  if (!ESTADOS_NODO.includes(estado)) bad("Estado no válido.");
  const responsableId = o.responsableId === null || o.responsableId === undefined || o.responsableId === "" ? null : leerUserId(o.responsableId);
  const inicio = fechaOpcional(o.inicio, "Inicio");
  const fin = fechaOpcional(o.fin, "Fin");
  if (inicio && fin && fin < inicio) bad("La fecha final no puede ser anterior a la inicial.");
  return {
    ...(id ? { id } : {}),
    nivelClave: texto(o.nivelClave, "Nivel", 40),
    valor: texto(o.valor, "Valor", 120).trim(),
    padreId: o.padreId === null || o.padreId === undefined || o.padreId === "" ? null : uuid(o.padreId, "Valor superior"),
    responsableId,
    responsableNombre: responsableId ? texto(o.responsableNombre, "Responsable", 200).trim() : "",
    inicio,
    fin,
    estado,
    nota: o.nota === undefined ? "" : texto(o.nota, "Nota", 500).trim(),
    version: version(o.version),
  };
}

// ---------------------------------------------------------------- bitácora

export function leerFiltroBitacora(params: URLSearchParams): FiltroBitacora {
  const f: FiltroBitacora = {};
  const desde = params.get("desde");
  const hasta = params.get("hasta");
  if (desde) f.desde = fecha(desde, "Desde");
  if (hasta) f.hasta = fecha(hasta, "Hasta");
  const actor = params.get("actor");
  if (actor) f.actorId = leerUserId(actor);
  const modulo = params.get("modulo");
  if (modulo) {
    if (!MODULOS_BITACORA.has(modulo)) bad("Módulo no válido.");
    f.modulo = modulo;
  }
  const resultado = params.get("resultado");
  if (resultado) {
    if (resultado !== "ok" && resultado !== "denegado" && resultado !== "error") bad("Resultado no válido.");
    f.resultado = resultado;
  }
  if (params.get("soloProyecto") === "1") f.soloProyecto = true;
  const antes = params.get("antesDe");
  if (antes) {
    const n = Number(antes);
    if (!Number.isInteger(n) || n < 1) bad("Posición no válida.");
    f.antesDe = n;
  }
  const limite = params.get("limite");
  if (limite) {
    const n = Number(limite);
    if (!Number.isInteger(n) || n < 1 || n > MAX_BITACORA) bad("Límite no válido.");
    f.limite = n;
  }
  return f;
}

/** The empresa of the technical administrator's queries (none: the global chain). */
export function leerEmpresaOpcional(value: string | null): string | null {
  return value ? uuid(value, "Empresa") : null;
}

/** A project's flow for one kind of document: its steps (the rules check the roles). */
export function leerCambioFlujo(body: unknown): CambioFlujo {
  const o = objeto(body);
  const tipo = TIPOS_FLUJO.find((t) => t.id === o.tipo)?.id ?? bad("Tipo de documento no válido.");
  if (!Array.isArray(o.pasos) || o.pasos.length > MAX_PASOS) bad(`Los pasos deben ser una lista de hasta ${MAX_PASOS}.`);
  const pasos = o.pasos.map((x, i) => {
    const p = objeto(x);
    if (typeof p.rolId !== "string" || !UUID_RE.test(p.rolId)) bad(`Paso ${i + 1}: rol no válido.`);
    return { nombre: texto(p.nombre, `Paso ${i + 1}`, 40).trim(), rolId: p.rolId };
  });
  return { tipo, pasos, version: version(o.version) };
}

// ---------------------------------------------------------------- measurements

const IFC_GUID_RE = /^[0-3][0-9A-Za-z_$]{21}$/;
const CLAVE_NIVEL_RE = /^[a-z][a-z0-9_]{1,39}$/;
const MAX_MEDIDA = 1_000_000_000;

function numero(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_MEDIDA) bad(`${what}: número no válido.`);
  return value;
}

function numeroOpcional(value: unknown, what: string): number | null {
  return value === null || value === undefined || value === "" ? null : numero(value, what);
}

function partidaId(value: unknown): string {
  const id = texto(value, "Partida", 100).trim();
  if (!id) bad("Elige la partida.");
  return id;
}

function ifcGuid(value: unknown): string {
  if (typeof value !== "string" || !IFC_GUID_RE.test(value)) bad("IFCGUID no válido.");
  return value;
}

function modelId(value: unknown): string {
  const id = texto(value, "Modelo", 100).trim();
  if (!id) bad("Falta el modelo del elemento.");
  return id;
}

/** { torre: <id del valor>, nivel: <id del valor> } */
export function leerUbicacion(value: unknown): Ubicacion {
  const o = objeto(value ?? {});
  const entradas = Object.entries(o);
  if (entradas.length > 20) bad("Demasiados niveles en la ubicación.");
  const u: Ubicacion = {};
  for (const [k, v] of entradas) {
    if (!CLAVE_NIVEL_RE.test(k)) bad("Nivel de la ubicación no válido.");
    if (typeof v !== "string" || !UUID_RE.test(v)) bad("Valor de la ubicación no válido.");
    u[k] = v;
  }
  return u;
}

export function leerCambioMedicion(body: unknown): CambioMedicion {
  const o = objeto(body);
  const origen = o.origen === "modelo" || o.origen === "manual" ? o.origen : bad("Origen de la medición no válido.");
  const elementos = Array.isArray(o.elementos) ? o.elementos : bad("Faltan los elementos (lista vacía si es a mano).");
  const lineas = Array.isArray(o.lineas) ? o.lineas : bad("Falta la memoria (lista vacía si es del modelo).");
  if (elementos.length > MAX_ELEMENTOS_MEDICION) bad(`Una medición admite hasta ${MAX_ELEMENTOS_MEDICION} elementos.`);
  if (lineas.length > MAX_LINEAS_MEDICION) bad(`La memoria admite hasta ${MAX_LINEAS_MEDICION} líneas.`);
  return {
    ...(o.id === undefined ? {} : { id: uuid(o.id, "Medición") }),
    partidaId: partidaId(o.partidaId),
    contratoId: o.contratoId === null || o.contratoId === undefined || o.contratoId === "" ? null : uuid(o.contratoId, "Contrato"),
    ubicacion: leerUbicacion(o.ubicacion),
    fecha: fecha(o.fecha, "Fecha"),
    origen,
    observaciones: texto(o.observaciones ?? "", "Observaciones", 2000),
    elementos: elementos.map((x) => {
      const e = objeto(x);
      return {
        modelId: modelId(e.modelId),
        versionId: e.versionId === null || e.versionId === undefined || e.versionId === "" ? null : texto(e.versionId, "Versión del modelo", 100),
        ifcGuid: ifcGuid(e.ifcGuid),
        nombre: typeof e.nombre === "string" ? e.nombre.slice(0, 300) : "",
        porcentaje: numero(e.porcentaje, "Porcentaje"),
      };
    }),
    lineas: lineas.map((x, i) => {
      const l = objeto(x);
      const n = `Línea ${i + 1}`;
      return {
        descripcion: texto(l.descripcion ?? "", `${n}: descripción`, 200),
        veces: numero(l.veces, `${n}: veces`),
        largo: numeroOpcional(l.largo, `${n}: largo`),
        ancho: numeroOpcional(l.ancho, `${n}: ancho`),
        alto: numeroOpcional(l.alto, `${n}: alto`),
      };
    }),
    version: version(o.version),
  };
}

export function leerAnularMedicion(body: unknown): { id: string; motivo: string; version: number } {
  const o = objeto(body);
  return { id: uuid(o.id, "Medición"), motivo: texto(o.motivo, "Motivo", 2000).trim(), version: version(o.version) };
}

/** The partida and the selected elements' IFCGUIDs (and the measurement being edited, if any). */
export function leerElementosMedibles(body: unknown): { partidaId: string; ifcGuids: string[]; medicionId: string | null } {
  const o = objeto(body);
  if (!Array.isArray(o.ifcGuids) || o.ifcGuids.length > MAX_ELEMENTOS_MEDICION) bad("Lista de elementos no válida.");
  return {
    partidaId: partidaId(o.partidaId),
    ifcGuids: [...new Set(o.ifcGuids.map(ifcGuid))],
    medicionId: o.medicionId === null || o.medicionId === undefined ? null : uuid(o.medicionId, "Medición"),
  };
}

export function leerVista(body: unknown): VistaObra {
  const o = objeto(body);
  if (!Array.isArray(o.elementos) || o.elementos.length > MAX_ELEMENTOS_MEDICION) bad("Lista de elementos no válida.");
  return {
    partidaId: o.partidaId === null || o.partidaId === undefined ? null : partidaId(o.partidaId),
    elementos: o.elementos.map((x) => {
      const e = objeto(x);
      return { modelId: modelId(e.modelId), ifcGuid: ifcGuid(e.ifcGuid) };
    }),
  };
}
