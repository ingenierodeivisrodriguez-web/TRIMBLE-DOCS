/**
 * Phase 0 of "Flujo de aprobación": checks against the real Trimble Connect,
 * with the user's own session, what the approval flow will rely on:
 * - the project's people and groups, and who belongs to each group (the
 *   "listado nativo" the administrator picks from);
 * - a file's versions and who uploaded each one, and a direct link to it;
 * - copying the latest version to another folder of the same project (the
 *   same name makes a new version there) and whether the viewer reconverts it;
 * - a ToDo assigned to a person or a group with the file attached, which is
 *   Trimble's own notification; the API's body format isn't documented
 *   publicly, so a few are tried and Trimble's answers are reported.
 * Nothing is stored in Supabase and nothing is deleted.
 */
import { buscarEnCarpeta, estadoSubida, explicarEstado, leerCarpeta, Respuesta } from "../compras/cde";
import { fechaHora } from "../compras/formato";
import { buildFileViewerUrl } from "../format";
import { copiarUltimaVersion, leerArchivo, leerEstadoVisor, Lado } from "../publicar/copiar";
import type { ProjectGroup, ProjectUser } from "../trimbleApi";
import { esIdTrimble, FlujoError } from "./errores";
import { GrupoEquipo, IntentoTrimble, PASOS_PRUEBA, PasoPrueba, PersonaEquipo, PruebaResponse, TAREA_PRUEBA, VersionTrimble } from "./types";

export interface DepsPrueba {
  projectId: string;
  /** This project through the user's token. */
  lado: Lado;
  /** The user running the test. */
  yo: string;
  /** The project's people; with a group id, only that group's. */
  personas(groupId?: string): Promise<ProjectUser[]>;
  grupos(): Promise<ProjectGroup[]>;
  fetch?: typeof fetch;
  reloj?: () => number;
}

/** Groups whose members are read (one request each). */
export const MAX_GRUPOS = 40;

const ok = (r: Respuesta) => r.estado >= 200 && r.estado < 300;
const texto = (v: unknown) => (typeof v === "string" && v ? v : null);
const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const porNombre = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/** "Ana Ruiz", else the email, else "". */
export function nombrePersona(p: unknown): string {
  const o = (p ?? {}) as Record<string, unknown>;
  return [texto(o.firstName), texto(o.lastName)].filter(Boolean).join(" ").trim() || texto(o.email) || "";
}

/** Trimble's answer, cut short to show it. */
export function corto(r: Respuesta): string {
  const t = typeof r.cuerpo === "string" ? r.cuerpo : JSON.stringify(r.cuerpo ?? "");
  return t.length > 200 ? `${t.slice(0, 200)}…` : t;
}

/** A file's versions as Trimble lists them, oldest first; null when the answer isn't a list. */
export function versionesDe(cuerpo: unknown): VersionTrimble[] | null {
  const items = (cuerpo as { items?: unknown } | null)?.items;
  const lista = Array.isArray(cuerpo) ? cuerpo : Array.isArray(items) ? items : null;
  if (!lista) return null;
  return lista
    .flatMap((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const versionId = texto(o.versionId) ?? texto(o.id);
      if (!versionId) return [];
      const modifico = nombrePersona(o.modifiedBy);
      const creo = nombrePersona(o.createdBy);
      const subio = modifico || creo;
      return [{ versionId, revision: numero(o.revision), subio, creo: creo && creo !== subio ? creo : "", fecha: texto(o.modifiedOn) ?? texto(o.createdOn), tamano: numero(o.size) }];
    })
    .sort((a, b) => (a.revision ?? 0) - (b.revision ?? 0));
}

function extension(nombre: string): string {
  const i = nombre.lastIndexOf(".");
  return i > 0 && i < nombre.length - 1 ? nombre.slice(i + 1).toLowerCase() : "";
}

/** The file in Trimble's viewer (its latest version) and the folder it is in. */
export function enlacesArchivo(projectId: string, a: { id: string; nombre: string; versionId: string | null; padreId: string | null }) {
  return {
    visor: buildFileViewerUrl(projectId, { id: a.id, ext: extension(a.nombre), versionId: a.versionId ?? a.id }),
    carpeta: a.padreId ? `https://web.connect.trimble.com/projects/${encodeURIComponent(projectId)}/data/folder/${encodeURIComponent(a.padreId)}` : null,
  };
}

/** The ToDo bodies tried, in order, until Trimble accepts one. */
export function formatosTarea(o: { projectId: string; titulo: string; descripcion: string; asignadoId: string; tipo: "USER" | "GROUP" }): { formato: string; cuerpo: Record<string, unknown> }[] {
  const asignado = { id: o.asignadoId, type: o.tipo };
  return [
    { formato: "label + assignees [{ id, type }]", cuerpo: { projectId: o.projectId, label: o.titulo, description: o.descripcion, assignees: [asignado] } },
    { formato: "title + assignees [{ id, type }]", cuerpo: { projectId: o.projectId, title: o.titulo, description: o.descripcion, assignees: [asignado] } },
    { formato: "label + assignees [id]", cuerpo: { projectId: o.projectId, label: o.titulo, description: o.descripcion, assignees: [o.asignadoId] } },
  ];
}

/** Tries each body in turn; stops at the first one Trimble accepts, or when it refuses the session or permission. */
async function intentar(pedir: (cuerpo: Record<string, unknown>) => Promise<Respuesta>, formatos: { formato: string; cuerpo: Record<string, unknown> }[]) {
  const intentos: IntentoTrimble[] = [];
  for (const f of formatos) {
    const r = await pedir(f.cuerpo);
    intentos.push({ formato: f.formato, http: r.estado, detalle: ok(r) ? "" : corto(r) });
    if (ok(r)) return { intentos, aceptado: f.formato, respuesta: r };
    if (r.estado === 401 || r.estado === 403) break;
  }
  return { intentos, aceptado: null, respuesta: null };
}

/** Runs one step of the phase 0 test. */
export async function pasoPrueba(deps: DepsPrueba, body: unknown): Promise<PruebaResponse> {
  const o = (body ?? {}) as Record<string, unknown>;
  const paso = o.paso as PasoPrueba;
  if (!PASOS_PRUEBA.includes(paso)) throw new FlujoError("Paso no válido.");
  const id = (k: string) => {
    const v = o[k];
    if (!esIdTrimble(v)) throw new FlujoError(`Falta ${k} o no es válido.`);
    return v;
  };
  const opcional = (k: string) => (o[k] === undefined || o[k] === "" ? null : id(k));
  const responder = (bien: boolean, mensaje: string, datos: Record<string, unknown> = {}): PruebaResponse => ({ paso, ok: bien, mensaje, datos });
  const c = deps.lado.cliente;

  if (paso === "equipo") return equipo(deps, responder);

  if (paso === "estado-subida") {
    const s = await estadoSubida(c, id("uploadId"));
    const listo = s.status === "DONE";
    const fallo = s.status === "ERROR" || s.status === "EXPIRED" || !ok(s.respuesta);
    const mensaje = listo
      ? `Trimble confirmó la carga: versión ${s.revision ?? "?"} en la carpeta destino.`
      : s.status === "ERROR"
        ? `Trimble marcó error en la carga: ${s.errorReason ?? "sin detalle"}.`
        : `Estado de la carga: ${s.status ?? explicarEstado(s.respuesta.estado)}.`;
    return responder(!fallo, mensaje, { status: s.status, fileId: s.fileId, versionId: s.versionId, revision: s.revision, http: s.respuesta.estado });
  }

  if (paso === "estado-visor") {
    const r = await c.pedir("GET", `/files/${encodeURIComponent(id("fileId"))}/status`);
    if (!ok(r)) return responder(false, `Trimble no dio el estado de la conversión: ${explicarEstado(r.estado)}`, { http: r.estado });
    const e = leerEstadoVisor(r.cuerpo);
    const palabras = e.listo === true ? "Listo para ver" : e.listo === false ? "La conversión falló" : "En conversión o sin dato";
    return responder(true, `${palabras} (Trimble: ${e.texto}).`, { estado: e.texto, listo: e.listo });
  }

  // archivo / copiar / tarea: the file is read again each time (its name never comes from the browser).
  const leido = await leerArchivo(c, id("fileId"));
  const a = leido.archivo;
  if (!a) return responder(false, `No se pudo leer el archivo: ${explicarEstado(leido.respuesta.estado)}`, { http: leido.respuesta.estado });
  const enlaces = enlacesArchivo(deps.projectId, a);

  if (paso === "archivo") {
    const rutas = [`/files/fs/${encodeURIComponent(a.id)}/versions`, `/files/${encodeURIComponent(a.id)}/versions`];
    const intentos: IntentoTrimble[] = [];
    let versiones: VersionTrimble[] | null = null;
    let ruta: string | null = null;
    for (const r of rutas) {
      const res = await c.pedir("GET", r);
      const v = ok(res) ? versionesDe(res.cuerpo) : null;
      intentos.push({ formato: `GET ${r.replace(encodeURIComponent(a.id), "{id}")}`, http: res.estado, detalle: v ? "" : corto(res) });
      if (v) {
        versiones = v;
        ruta = intentos[intentos.length - 1].formato;
        break;
      }
    }
    const datos = { nombre: a.nombre, revision: a.revision, versionId: a.versionId, padreId: a.padreId, enlaces, versiones: versiones ?? [], ruta, intentos };
    if (!versiones) return responder(false, `“${a.nombre}” está en la versión ${a.revision ?? "?"}, pero Trimble no entregó la lista de sus versiones.`, datos);
    const conQuien = versiones.filter((v) => v.subio).length;
    const quien =
      conQuien === versiones.length
        ? "Trimble dice quién subió cada versión."
        : conQuien
          ? `Trimble dice quién subió ${conQuien} de las ${versiones.length} versiones.`
          : "Trimble no dice quién subió cada versión.";
    return responder(conQuien > 0, `“${a.nombre}”: ${versiones.length} ${versiones.length === 1 ? "versión" : "versiones"} (la última es la ${a.revision ?? "?"}). ${quien}`, datos);
  }

  if (paso === "copiar") {
    const carpetaId = id("carpetaId");
    if (carpetaId === a.padreId) return responder(false, "Elige una carpeta destino distinta de la carpeta donde está el archivo.");
    const { carpeta, respuesta } = await leerCarpeta(c, carpetaId);
    if (!carpeta) return responder(false, `No se pudo leer la carpeta destino: ${explicarEstado(respuesta.estado)}`, { http: respuesta.estado });
    if (carpeta.permiso === "READ") return responder(false, `Solo tienes lectura en “${carpeta.nombre}”: elige una carpeta donde puedas subir archivos.`);
    const enDestino = await buscarEnCarpeta(c, carpetaId, a.nombre, "FILE");
    const antes = enDestino ? (await leerArchivo(c, enDestino.id)).archivo : null;
    const siVersion = opcional("siVersion");
    if (enDestino && !siVersion) {
      const quien = [antes?.modificadoPor, antes?.modificado ? fechaHora(antes.modificado) : ""].filter(Boolean).join(", ");
      return responder(true, `En “${carpeta.nombre}” ya hay un “${a.nombre}” (versión ${antes?.revision ?? "?"}${quien ? `, ${quien}` : ""}). No se reemplaza sin tu confirmación: confírmalo para probar que llega como versión nueva.`, {
        confirmar: true,
        versionId: enDestino.versionId,
        revision: antes?.revision ?? null,
      });
    }
    if (enDestino && siVersion !== enDestino.versionId) return responder(false, "El archivo de la carpeta destino cambió después de revisarlo: cópialo otra vez para verlo.", { cambio: true });
    const r = await copiarUltimaVersion({ origen: deps.lado, destino: deps.lado, archivo: a, carpetaId, enDestino, sinModelo: o.sinModelo === "1", fetch: deps.fetch, reloj: deps.reloj });
    const { ok: bien, mensaje, ...datos } = r;
    const desde = antes ? ` Antes había la versión ${antes.revision ?? "?"} en la carpeta destino.` : " No estaba en la carpeta destino.";
    return responder(bien, `${mensaje}${bien ? desde : ""}`, { ...datos, antes: antes?.revision ?? null, origen: a.revision, carpeta: carpeta.nombre });
  }

  // tarea
  const tipo = o.asignadoTipo === "grupo" ? "GROUP" : o.asignadoTipo === "persona" ? "USER" : null;
  if (!tipo) throw new FlujoError("Elige si la tarea es para una persona o un grupo.");
  const asignadoId = id("asignadoId");
  const nombre = (typeof o.asignadoNombre === "string" ? o.asignadoNombre.trim().slice(0, 120) : "") || asignadoId;
  const titulo = `${TAREA_PRUEBA}: revisar ${a.nombre}`.slice(0, 120);
  const descripcion = [
    `Tarea de prueba de la extensión Flujo de aprobación (se puede borrar).`,
    `Archivo: ${a.nombre}, versión ${a.revision ?? "?"}.`,
    `Abrir en Trimble Connect: ${enlaces.visor}`,
  ].join("\n");

  const tipos = await c.pedir("GET", `/todos/types?projectId=${encodeURIComponent(deps.projectId)}`);
  const listaTipos = ok(tipos) && Array.isArray(tipos.cuerpo) ? (tipos.cuerpo as unknown[]).map((t) => texto((t as Record<string, unknown>)?.name) ?? texto((t as Record<string, unknown>)?.label) ?? "").filter(Boolean) : null;

  const creada = await intentar((cuerpo) => c.pedir("POST", "/todos", { cuerpo }), formatosTarea({ projectId: deps.projectId, titulo, descripcion, asignadoId, tipo }));
  const base = { titulo, intentos: creada.intentos, tipos: listaTipos, tiposHttp: tipos.estado };
  if (!creada.respuesta) {
    const ultimo = creada.intentos[creada.intentos.length - 1];
    return responder(false, `Trimble no creó la tarea con ninguno de los ${creada.intentos.length} formatos probados (último: ${explicarEstado(ultimo?.http ?? 0)}).`, base);
  }
  const todoId = texto((creada.respuesta.cuerpo as Record<string, unknown> | null)?.id);
  if (!todoId) return responder(true, `Trimble aceptó la tarea (formato «${creada.aceptado}») pero no devolvió su identificador: búscala en ToDo de Trimble.`, { ...base, formato: creada.aceptado });

  const adjunto = await intentar(
    (cuerpo) => c.pedir("POST", `/todos/${encodeURIComponent(todoId)}/attachments`, { cuerpo }),
    [
      { formato: "attachments [fileId]", cuerpo: { attachments: [a.id] } },
      { formato: "attachments [{ id, type: FILE }]", cuerpo: { attachments: [{ id: a.id, type: "FILE" }] } },
    ]
  );
  const leida = await c.pedir("GET", `/todos/${encodeURIComponent(todoId)}`);
  const asignados = ok(leida) ? JSON.stringify((leida.cuerpo as Record<string, unknown> | null)?.assignees ?? null) : null;
  const confirmado = asignados === null ? null : asignados.includes(asignadoId);

  const partes = [
    `Trimble creó la tarea «${titulo}» para ${nombre} (${tipo === "USER" ? "persona" : "grupo"}) con el formato «${creada.aceptado}».`,
    adjunto.aceptado ? "El archivo quedó adjunto a la tarea." : "No se pudo adjuntar el archivo: el enlace va en la descripción.",
    confirmado === false ? `Ojo: al leer la tarea, Trimble no muestra a ${nombre} como asignado.` : "",
    `Revisa en ToDo de Trimble que aparezca y pregunta si a ${tipo === "USER" ? "la persona" : "los miembros del grupo"} les llegó el correo.`,
  ];
  return responder(confirmado !== false, partes.filter(Boolean).join(" "), {
    ...base,
    formato: creada.aceptado,
    todoId,
    adjunto: adjunto.aceptado,
    intentosAdjunto: adjunto.intentos,
    asignados: asignados && asignados.length > 300 ? `${asignados.slice(0, 300)}…` : asignados,
    confirmado,
  });
}

async function equipo(deps: DepsPrueba, responder: (bien: boolean, mensaje: string, datos?: Record<string, unknown>) => PruebaResponse): Promise<PruebaResponse> {
  const [todas, grupos] = await Promise.all([deps.personas(), deps.grupos().catch((err: unknown) => (err instanceof Error ? err : new Error(String(err))))]);
  const personas: PersonaEquipo[] = todas
    .filter((p) => (p.status ?? "ACTIVE").toUpperCase() !== "REMOVED")
    .map((p) => ({ id: p.id, nombre: nombrePersona(p) || p.id, email: p.email ?? "", admin: p.role === "ADMIN", pendiente: (p.status ?? "").toUpperCase() === "PENDING" }))
    .sort((x, y) => porNombre.compare(x.nombre, y.nombre));
  const admins = personas.filter((p) => p.admin).length;
  const resumen = `${personas.length} ${personas.length === 1 ? "persona" : "personas"} (${admins} ${admins === 1 ? "administrador" : "administradores"})`;
  if (grupos instanceof Error) {
    return responder(false, `Trimble entregó ${resumen}, pero no la lista de grupos (${grupos.message}).`, { personas, grupos: [], yo: deps.yo });
  }

  const leer = grupos.slice(0, MAX_GRUPOS);
  const miembros = await Promise.allSettled(leer.map((g) => deps.personas(g.id)));
  const lista: GrupoEquipo[] = grupos
    .map((g, i) => {
      const m = miembros[i];
      return {
        id: g.id,
        nombre: g.name || "(sin nombre)",
        miembros: m?.status === "fulfilled" ? m.value.map((p) => nombrePersona(p) || p.id).sort(porNombre.compare) : null,
        total: typeof g.usersCount === "number" ? g.usersCount : null,
      };
    })
    .sort((x, y) => porNombre.compare(x.nombre, y.nombre));
  const leidos = lista.filter((g) => g.miembros !== null).length;

  const avisos: string[] = [];
  if (grupos.length > MAX_GRUPOS) avisos.push(`Solo se leyeron los miembros de los primeros ${MAX_GRUPOS} grupos.`);
  // If the group filter were ignored, every group would come back with the whole project.
  if (personas.length > 1 && leidos > 1 && lista.every((g) => g.miembros === null || g.miembros.length === todas.length)) {
    avisos.push("Ojo: cada grupo trae a todas las personas del proyecto; puede que Trimble no esté filtrando por grupo.");
  }
  const distintos = lista.filter((g) => g.miembros !== null && g.total !== null && g.total !== g.miembros.length);
  if (distintos.length) avisos.push(`En ${distintos.length} ${distintos.length === 1 ? "grupo" : "grupos"} el número de miembros no coincide con el que dice Trimble.`);

  const mensaje = grupos.length
    ? `Trimble entregó ${resumen} y ${grupos.length} ${grupos.length === 1 ? "grupo" : "grupos"}; se leyeron los miembros de ${leidos} de ${Math.min(grupos.length, MAX_GRUPOS)}.`
    : `Trimble entregó ${resumen}; el proyecto no tiene grupos.`;
  return responder(leidos === Math.min(grupos.length, MAX_GRUPOS) && avisos.length === 0, [mensaje, ...avisos].join(" "), { personas, grupos: lista, yo: deps.yo });
}
