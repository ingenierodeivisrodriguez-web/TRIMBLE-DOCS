import { fecha } from "../compras/formato";
import { esMotivo, MENSAJES } from "./accesos";
import { EVENTOS_LICENCIA } from "./licencias";
import { ACCIONES, EntradaBitacora, EstadoFlujo, GRUPOS_LICENCIA, MODULOS, TIPOS_FLUJO } from "./types";

/** How the bitácora reads on screen. */

const ACCIONES_BITACORA: Record<string, string> = {
  ingreso: "Entrar a Control de Obra",
  "empresa.crear": "Crear empresa",
  "empresa.cambiar": "Cambiar empresa",
  "empresa.guardar": "Crear o cambiar una empresa",
  "licencias.registrar": "Registrar licencia",
  "administradores.nombrar": "Nombrar administrador de la empresa",
  "administradores.quitar": "Quitar administrador de la empresa",
  "administradores.guardar": "Nombrar o quitar un administrador",
  "admin.consultar": "Consultar empresas y licencias",
  "admin.bitacora": "Consultar la bitácora (administración técnica)",
  "usuarios.vincular": "Primera entrada de una persona invitada",
  "usuarios.activar": "Reactivar persona en la empresa",
  "usuarios.desactivar": "Desactivar persona en la empresa",
  "usuarios.guardar": "Activar o desactivar una persona",
  "proyecto.vincular": "Registrar el proyecto en la empresa",
  "proyecto.desvincular": "Retirar el proyecto de la empresa",
  "accesos.asignar": "Dar acceso",
  "accesos.cambiar": "Cambiar acceso",
  "accesos.revocar": "Revocar acceso",
  "accesos.guardar": "Dar o cambiar un acceso",
  "accesos.consultar": "Consultar accesos",
  "accesos.contactos": "Ver el equipo del proyecto",
  "roles.crear": "Crear rol",
  "roles.cambiar": "Cambiar rol",
  "roles.guardar": "Crear o cambiar un rol",
  "estructura.consultar": "Consultar la estructura de obra",
  "estructura.guardar": "Cambiar la estructura de obra",
  "estructura.nivel.crear": "Crear nivel de la estructura",
  "estructura.nivel.cambiar": "Cambiar nivel de la estructura",
  "estructura.nodo.crear": "Crear valor de un nivel",
  "estructura.nodo.cambiar": "Cambiar valor de un nivel",
  "config.cambiar": "Cambiar la configuración del proyecto",
  "config.guardar": "Cambiar la configuración del proyecto",
  "bitacora.consultar": "Consultar la bitácora",
  "bitacora.verificar": "Verificar la integridad de la bitácora",
  "flujos.consultar": "Consultar los flujos de aprobación",
  "flujos.guardar": "Cambiar un flujo de aprobación",
  "flujos.cambiar": "Cambiar un flujo de aprobación",
  "flujo.enviar": "Enviar a aprobación",
  "flujo.aprobar": "Aprobar",
  "flujo.devolver": "Devolver al paso anterior",
  "flujo.anular": "Anular",
};

export const ESTADOS_FLUJO: Record<EstadoFlujo, { texto: string; color: string; fondo: string }> = {
  borrador: { texto: "Borrador", color: "#4b5563", fondo: "#eef1f4" },
  devuelto: { texto: "Devuelto", color: "#7a5a00", fondo: "#fff4d1" },
  en_tramite: { texto: "En aprobación", color: "#1d4f91", fondo: "#e3edfb" },
  aprobado: { texto: "Aprobado", color: "#2e6b22", fondo: "#e3f3de" },
  anulado: { texto: "Anulado", color: "#b3261e", fondo: "#fbe4e2" },
};

const nombreTipo = (tipo: unknown) => TIPOS_FLUJO.find((t) => t.id === tipo)?.nombre ?? String(tipo ?? "");

/** "Elabora: Residente de obra → Aprueba: Director de proyecto". */
function pasosEnPalabras(x: unknown): string {
  return Array.isArray(x) ? (x as { nombre?: unknown; rol?: unknown }[]).map((p) => `${String(p.nombre ?? "")}: ${String(p.rol ?? "")}`).join(" → ") : "";
}

export function nombreAccion(accion: string): string {
  return ACCIONES_BITACORA[accion] ?? accion;
}

/** The modules a bitácora row can belong to, for the filter. */
export const MODULOS_BITACORA: { id: string; nombre: string }[] = [{ id: "empresas", nombre: "Empresas y licencias" }, ...MODULOS.map((m) => ({ id: m.id, nombre: m.nombre }))];

/** "cantidades.verificar" -> "Cantidades: Verificar". */
export function nombrePermiso(p: string): string {
  const [m, a] = p.split(".");
  return `${MODULOS.find((x) => x.id === m)?.nombre ?? m}: ${ACCIONES.find((x) => x.id === a)?.nombre ?? a}`;
}

type Vigencia = { rol?: unknown; adminProyecto?: unknown; desde?: unknown; hasta?: unknown; activo?: unknown };

function vigencia(v: Vigencia): string {
  const partes = [String(v.rol ?? "")];
  if (v.adminProyecto === true) partes.push("administra el proyecto");
  if (v.activo === false) partes.push("revocado");
  else {
    if (typeof v.desde === "string") partes.push(`desde ${fecha(v.desde)}`);
    partes.push(typeof v.hasta === "string" ? `hasta ${fecha(v.hasta)}` : "sin fecha final");
  }
  return partes.join(", ");
}

const CAMPOS: Record<string, string> = {
  nombre: "Nombre",
  nit: "NIT",
  activa: "Activa",
  responsableTecnico: "Responsable técnico",
  toleranciaVerificacionPct: "Tolerancia (%)",
  permiteAceptadoConObservaciones: "Aceptado con observaciones",
};

const valor = (x: unknown) => (x === null || x === undefined || x === "" ? "—" : typeof x === "boolean" ? (x ? "sí" : "no") : String(x));
const par = (x: unknown) => (Array.isArray(x) && x.length === 2 ? `${valor(x[0])} → ${valor(x[1])}` : valor(x));

/** What a row is about, in words ("Luis Pérez", "Torre 1", "El proyecto"), not internal ids. */
export function sobreQue(e: EntradaBitacora): string {
  const d = e.cambios ?? {};
  const texto = (x: unknown) => (typeof x === "string" && x.trim() ? x : null);
  switch (e.objetoTipo) {
    case "":
      return "—";
    case "proyecto":
      return "El proyecto";
    case "empresa":
      return texto(d.nombre) ?? "La empresa";
    case "licencia":
      return "La licencia";
    case "usuario":
      return texto(d.persona) ?? texto(d.email) ?? e.objetoId;
    case "rol":
      return `Rol ${texto(d.nombre) ?? ""}`.trim();
    case "nivel":
      return `Nivel ${texto(d.nombre) ?? e.objetoId}`;
    case "nodo":
      return texto(d.valor) ?? "Valor de un nivel";
    case "flujo":
      return `Flujo de ${nombreTipo(e.objetoId).toLowerCase()}`;
    default:
      if (TIPOS_FLUJO.some((t) => t.id === e.objetoTipo)) return `${nombreTipo(e.objetoTipo)}: ${texto(d.documento) ?? e.objetoId.slice(0, 8)}`;
      return `${e.objetoTipo} ${e.objetoId}`.trim();
  }
}

/** One line saying what happened in a bitácora row (why it was refused, what changed). */
export function detalleEntrada(e: EntradaBitacora): string {
  const d = e.cambios ?? {};
  const conMotivo = (texto: string) => (e.motivo ? `${texto}${texto ? ". " : ""}Motivo: ${e.motivo}` : texto);
  if (e.resultado !== "ok") {
    const motivo = typeof d.motivo === "string" ? d.motivo : "";
    const texto = esMotivo(motivo) ? MENSAJES[motivo] : motivo;
    return typeof d.permiso === "string" ? `${texto} (permiso: ${nombrePermiso(d.permiso)})` : texto;
  }
  if (/^accesos\.(asignar|cambiar|revocar)$/.test(e.accion)) {
    const antes = d.antes as Vigencia | null | undefined;
    const despues = d.despues as Vigencia | undefined;
    if (!despues) return "";
    return `${valor(d.persona)}: ${antes ? `${vigencia(antes)} → ${vigencia(despues)}` : vigencia(despues)}`;
  }
  if (e.accion.startsWith("roles.")) {
    const lista = (x: unknown) => (Array.isArray(x) ? (x as string[]).map(nombrePermiso) : []);
    const partes = [String(d.nombre ?? "")];
    const mas = lista(d.agregados);
    const menos = lista(d.quitados);
    if (mas.length) partes.push(`agregó ${mas.join("; ")}`);
    if (menos.length) partes.push(`quitó ${menos.join("; ")}`);
    if (d.activo === false) partes.push("rol desactivado");
    return partes.join(". ");
  }
  if (e.accion === "licencias.registrar") {
    const grupos = Array.isArray(d.grupos) ? (d.grupos as string[]).map((g) => GRUPOS_LICENCIA.find((x) => x.id === g)?.nombre ?? g) : [];
    return conMotivo(
      `${EVENTOS_LICENCIA[d.evento as keyof typeof EVENTOS_LICENCIA] ?? valor(d.evento)}: ${valor(d.plan)}, desde ${fecha(String(d.desde ?? ""))}${
        typeof d.hasta === "string" ? ` hasta ${fecha(d.hasta)}` : ", sin vencimiento"
      }, ${valor(d.maxProyectos)} proyecto(s), ${valor(d.maxUsuarios)} persona(s); módulos: ${grupos.join(", ") || "solo los básicos"}`
    );
  }
  if (e.accion.startsWith("administradores.") || e.accion === "usuarios.vincular") return valor(d.email);
  if (e.accion.startsWith("usuarios.")) return valor(d.persona);
  if (e.accion === "empresa.crear") return `${valor(d.nombre)}${d.nit ? `, NIT ${valor(d.nit)}` : ""}; ${valor(d.roles)} roles iniciales`;
  if (e.accion === "empresa.cambiar" || e.accion === "config.cambiar") {
    return Object.entries(d)
      .map(([k, v]) => `${CAMPOS[k] ?? k}: ${par(v)}`)
      .join("; ");
  }
  if (e.accion === "proyecto.vincular") return valor(d.proyecto);
  if (e.accion === "proyecto.desvincular") return conMotivo("");
  if (e.accion.startsWith("estructura.nivel.")) {
    return `${d.alcance === "plantilla" ? "Plantilla de la empresa" : "Este proyecto"}: ${valor(d.nombre)} (${valor(d.fuente)}${d.claveFuente ? ` · ${valor(d.claveFuente)}` : ""})${d.activo === false ? ", desactivado" : ""}`;
  }
  if (e.accion.startsWith("estructura.nodo.")) {
    const antes = d.antes as { valor?: unknown; estado?: unknown } | null;
    return `${valor(d.nivel)}: ${antes && antes.valor !== d.valor ? `${valor(antes.valor)} → ` : ""}${valor(d.valor)}${d.responsable ? `, responsable ${valor(d.responsable)}` : ""}, ${valor(d.estado)}`;
  }
  if (e.accion === "flujos.cambiar") {
    const antes = pasosEnPalabras(d.antes);
    return `${nombreTipo(d.tipo)}: ${antes ? `antes ${antes}; ahora ` : ""}${pasosEnPalabras(d.despues)}`;
  }
  if (e.accion.startsWith("flujo.")) {
    const estado = ESTADOS_FLUJO[d.estado as EstadoFlujo]?.texto.toLowerCase() ?? valor(d.estado);
    return conMotivo(`Paso ${valor(d.paso)}: queda ${estado}`);
  }
  if (e.accion === "bitacora.verificar") return d.integra ? `Íntegra (${valor(d.filas)} filas)` : `Rota en la fila ${valor(d.rotaEn)} de ${valor(d.filas)}`;
  return conMotivo("");
}
