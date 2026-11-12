/**
 * Notices through Trimble's own ToDos (phase 3; the format was confirmed in
 * the phase 0 test: `label` + `assignees: [{ id, type }]`, and Trimble e-mails
 * the person). One ToDo per group of files that wait for the same people on
 * the same step, so registering many files at once doesn't flood anyone; the
 * links go in the description (attaching the file was refused by Trimble).
 * A ToDo for a group that Trimble refuses is sent again to its members.
 */
import type { Respuesta } from "../compras/cde";
import { codigoFlujo } from "./flujos";
import { corto } from "./prueba";
import { NOMBRE_EXTENSION, TIPO_TAREA } from "./nombre";
import { responsablesArchivo } from "./registro";
import type { DatosCorreo } from "./correo";
import type { ArchivoRegistro, Aviso, Firma, Flujo } from "./types";

/** Files listed with their link in one ToDo; the rest are counted. */
export const MAX_EN_AVISO = 15;

const recorte = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What a ToDo needs from its flow. */
export type FlujoTarea = Pick<Flujo, "hito" | "pasos"> & Partial<Pick<Flujo, "notas" | "vence" | "codigo">>;

/**
 * The texts Trimble shows on the flow's ToDos (11-11-2026): the code on the
 * line above, only the flow's title, only its description (the title again
 * when it has none: Trimble requires one) and its due date at noon in Colombia,
 * so it shows that same day.
 */
export function textosTarea(flujo: Pick<Flujo, "hito"> & Partial<Pick<Flujo, "notas" | "vence" | "codigo">>): NonNullable<Aviso["trimble"]> {
  return {
    label: codigoFlujo(flujo.codigo),
    title: recorte(flujo.hito, 120),
    description: recorte((flujo.notas ?? "").trim() || flujo.hito, 3000),
    dueDate: flujo.vence ? `${flujo.vence}T17:00:00+0000` : null,
  };
}

/** The ToDo types tried, in order: the owner's wish («Flujo documental» since the rename of 12-11-2026), then «Solicitud» (Trimble's list is fixed). */
export const TIPOS_TAREA = [TIPO_TAREA, "Request"] as const;

/** One ToDo per (step, same people) for the files of a flow that now wait for someone. */
export function avisosRevision(archivos: ArchivoRegistro[], flujo: FlujoTarea, enlace: (a: ArchivoRegistro) => string): Aviso[] {
  const grupos = new Map<string, { archivos: ArchivoRegistro[]; para: Aviso["para"] }>();
  for (const a of archivos) {
    const resp = responsablesArchivo(a, flujo);
    if (!resp.length) continue;
    const para = [...new Map(resp.map((r) => [`${r.tipo}:${r.id}`, { tipo: r.tipo, id: r.id, nombre: r.nombre }])).values()];
    const clave = `${a.flujoId}|${a.pasos[a.pasoActual]?.id}|${para.map((p) => `${p.tipo}:${p.id}`).sort().join(",")}`;
    const g = grupos.get(clave) ?? { archivos: [], para };
    g.archivos.push(a);
    grupos.set(clave, g);
  }
  return [...grupos.values()].map(({ archivos: as, para }) => {
    const a = as[0];
    const hito = flujo.hito;
    const paso = a.pasos[a.pasoActual]?.nombre ?? "";
    const lineas = as.slice(0, MAX_EN_AVISO).map((x) => `• ${x.nombre} — versión ${x.revision ?? "?"}${x.estado === "nueva-version" ? " (versión nueva)" : ""}: ${enlace(x)}`);
    const mas = as.length > MAX_EN_AVISO ? [`… y ${as.length - MAX_EN_AVISO} más: ábrelos en ${NOMBRE_EXTENSION}, flujo «${hito}» → Archivos → Me toca.`] : [];
    return {
      titulo: recorte(as.length === 1 ? `Revisar: ${a.nombre} (${paso}) — ${hito}` : `Revisar ${as.length} archivos (${paso}) — ${hito}`, 120),
      descripcion: recorte(
        [`Flujo «${hito}»: te toca el paso «${paso}».`, ...lineas, ...mas, `Apruébalos o recházalos en la extensión ${NOMBRE_EXTENSION}: abre el flujo «${hito}» → Archivos → Me toca.`].join("\n"),
        3000
      ),
      trimble: textosTarea(flujo),
      para,
      archivos: as.map((x) => x.id),
      tipo: "revision" as const,
      pasoId: a.pasos[a.pasoActual]?.id ?? null,
      correo: {
        tipo: "revision",
        codigo: codigoFlujo(flujo.codigo),
        hito,
        notas: flujo.notas ?? "",
        vence: flujo.vence ?? null,
        paso,
        archivos: as.map((x) => ({ nombre: x.nombre, revision: x.revision ?? null, enlace: enlace(x), nueva: x.estado === "nueva-version" })),
        mas: 0,
      } satisfies DatosCorreo,
    };
  });
}

/** The ToDo to the uploader of a rejected version, with the reason (null when Trimble didn't say who uploaded it). */
export function avisoRechazo(a: ArchivoRegistro, firma: Firma, flujo: Pick<Flujo, "hito"> & Partial<Pick<Flujo, "notas" | "vence" | "codigo">>, enlace: string): Aviso | null {
  if (!a.subidoPorId) return null;
  const hito = flujo.hito;
  const carpeta = a.ruta.slice(0, Math.max(0, a.ruta.length - a.nombre.length - 3));
  return {
    titulo: recorte(`Corregir: ${a.nombre} (rechazado) — ${hito}`, 120),
    descripcion: recorte(
      [
        `${firma.quien} rechazó la versión ${firma.revision ?? "?"} en «${firma.paso}» del flujo «${hito}».`,
        `Motivo: ${firma.comentario}`,
        `Corrige el archivo y sube la versión nueva con el mismo nombre en la misma carpeta (${carpeta}).`,
        `Abrir: ${enlace}`,
      ].join("\n"),
      3000
    ),
    trimble: textosTarea(flujo),
    para: [{ tipo: "persona", id: a.subidoPorId, nombre: a.subidoPor }],
    archivos: [a.id],
    tipo: "correccion",
    pasoId: null,
    correo: {
      tipo: "correccion",
      codigo: codigoFlujo(flujo.codigo),
      hito,
      notas: flujo.notas ?? "",
      vence: flujo.vence ?? null,
      paso: firma.paso,
      archivos: [{ nombre: a.nombre, revision: firma.revision ?? a.revision ?? null, enlace, nueva: false }],
      mas: 0,
      rechazo: { quien: firma.quien, motivo: firma.comentario, carpeta },
    },
  };
}

const ok = (r: Respuesta) => r.estado >= 200 && r.estado < 300;

/**
 * States tried to close a ToDo, in order: Trimble doesn't document the values
 * for its API (10-11-2026), so "CLOSED" (what the owner asked) and then "DONE".
 * The "Prueba de conexión con Trimble" shows which one a project takes.
 */
export const ESTADOS_CIERRE = ["CLOSED", "DONE"] as const;

/**
 * Closes a ToDo with PATCH /todos/{id} { status }, trying each state; an answer
 * that says another status is taken as refused. Never throws.
 */
export async function cerrarTarea(actualizar: (cuerpo: Record<string, unknown>) => Promise<Respuesta>): Promise<{ ok: boolean; estado: string | null; mensaje: string }> {
  let ultima: Respuesta | null = null;
  try {
    for (const status of ESTADOS_CIERRE) {
      const r = await actualizar({ status });
      const dice = (r.cuerpo as { status?: unknown } | null)?.status;
      if (ok(r) && (typeof dice !== "string" || dice.toUpperCase() === status)) return { ok: true, estado: status, mensaje: `Trimble la dejó en estado ${status}.` };
      ultima = r;
      // Without permission, or the ToDo is gone: another state won't help.
      if (r.estado === 401 || r.estado === 403 || r.estado === 404) break;
    }
  } catch (err) {
    return { ok: false, estado: null, mensaje: `No se pudo cerrar: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { ok: false, estado: null, mensaje: ultima ? `Trimble no la cerró (${ultima.estado}): ${corto(ultima)}` : "Trimble no la cerró." };
}

/** A ToDo body to try, the code it puts on it and what it left out (for the history). */
export interface VarianteTarea {
  cuerpo: Record<string, unknown>;
  etiqueta: string | null;
  nota: string;
}

/**
 * The ToDo bodies tried, in order, until Trimble accepts one: the flow's code,
 * title, description, due date and type «Flujo de aprobación»; then type
 * «Solicitud», then no type; the code with a suffix («FLUJO-01-2») in case
 * Trimble wants it unique; without the due date; and the format of before
 * (summary + links), which is known to work. A notice without the flow's
 * texts (older callers) only sends that last one.
 */
export function variantesTarea(projectId: string, aviso: Aviso, assignees: unknown[], otraEtiqueta: string | null = null): VarianteTarea[] {
  const anterior: VarianteTarea = { cuerpo: { projectId, label: aviso.titulo, description: aviso.descripcion, assignees }, etiqueta: null, nota: "" };
  const t = aviso.trimble;
  if (!t) return [anterior];
  const out: VarianteTarea[] = [];
  const etiquetas = t.label ? [t.label, ...(otraEtiqueta && otraEtiqueta !== t.label ? [otraEtiqueta] : [])] : [null];
  const base = (etiqueta: string | null) => ({ projectId, ...(etiqueta ? { label: etiqueta } : {}), title: t.title, description: t.description, assignees });
  for (const etiqueta of etiquetas) {
    const repetida = etiqueta && etiqueta !== t.label ? `«${t.label}» ya estaba usada en Trimble` : "";
    for (const tipo of [...TIPOS_TAREA, null]) {
      const sinTipo = tipo === "Request" ? `tipo «Solicitud»: Trimble no aceptó «${TIPO_TAREA}»` : tipo === null ? `sin tipo: Trimble no aceptó «${TIPO_TAREA}» ni «Solicitud»` : "";
      out.push({ cuerpo: { ...base(etiqueta), ...(t.dueDate ? { dueDate: t.dueDate } : {}), ...(tipo ? { type: tipo } : {}) }, etiqueta, nota: [sinTipo, repetida].filter(Boolean).join("; ") });
    }
  }
  const ultima = etiquetas[etiquetas.length - 1];
  if (t.dueDate) out.push({ cuerpo: base(ultima), etiqueta: ultima, nota: "sin tipo ni fecha de vencimiento: Trimble no los aceptó" });
  out.push({ ...anterior, nota: "con el texto de antes: Trimble no aceptó el título del flujo" });
  return out;
}

/** Statuses after which another body may work (a field Trimble didn't take); any other stops trying. */
const REINTENTAR = [400, 409, 422];

/** Creates the ToDo in Trimble; a group Trimble refuses is replaced by its members. Never throws. */
export async function enviarAviso(
  crear: (cuerpo: Record<string, unknown>) => Promise<Respuesta>,
  projectId: string,
  aviso: Aviso,
  miembros: (groupId: string) => Promise<{ id: string }[]>,
  /** The code to use if Trimble refuses the flow's one as repeated («FLUJO-01-2»). */
  otraEtiqueta: string | null = null
): Promise<{ ok: boolean; todoId: string | null; mensaje: string; etiqueta: string | null }> {
  const quienes = aviso.para.map((p) => p.nombre + (p.tipo === "grupo" ? " (grupo)" : "")).join(", ");
  const id = (respuesta: unknown) => {
    const v = (respuesta as { id?: unknown } | null)?.id;
    return typeof v === "string" ? v : null;
  };
  const probar = async (assignees: { id: string; type: string }[]): Promise<{ r: Respuesta; v: VarianteTarea | null }> => {
    let ultima: Respuesta = { estado: 0, cuerpo: null };
    for (const v of variantesTarea(projectId, aviso, assignees, otraEtiqueta)) {
      const r = await crear(v.cuerpo);
      if (ok(r)) return { r, v };
      ultima = r;
      if (!REINTENTAR.includes(r.estado)) break;
    }
    return { r: ultima, v: null };
  };
  const hecho = (r: Respuesta, v: VarianteTarea, extra: string) => ({
    ok: true,
    todoId: id(r.cuerpo),
    etiqueta: v.etiqueta,
    mensaje: `Tarea de Trimble ${v.etiqueta ? `${v.etiqueta} ` : ""}para ${quienes}${extra}: «${aviso.titulo}»${v.nota ? ` (${v.nota})` : ""}.`,
  });
  try {
    const a = await probar(aviso.para.map((p) => ({ id: p.id, type: p.tipo === "grupo" ? "GROUP" : "USER" })));
    if (a.v) return hecho(a.r, a.v, "");
    const r = a.r;
    if (!aviso.para.some((p) => p.tipo === "grupo") || r.estado === 401 || r.estado === 403) {
      return { ok: false, todoId: null, etiqueta: null, mensaje: `Trimble no creó la tarea para ${quienes} (${r.estado}): ${corto(r)}` };
    }
    const personas = new Set(aviso.para.filter((p) => p.tipo === "persona").map((p) => p.id));
    for (const g of aviso.para.filter((p) => p.tipo === "grupo")) for (const m of await miembros(g.id)) personas.add(m.id);
    if (!personas.size) return { ok: false, todoId: null, etiqueta: null, mensaje: `Trimble no aceptó la tarea para el grupo y el grupo no tiene miembros: no se avisó a ${quienes}.` };
    const b = await probar([...personas].map((id) => ({ id, type: "USER" })));
    if (b.v) return hecho(b.r, b.v, " (a cada miembro del grupo)");
    return { ok: false, todoId: null, etiqueta: null, mensaje: `Trimble no creó la tarea para ${quienes} (${b.r.estado}): ${corto(b.r)}` };
  } catch (err) {
    return { ok: false, todoId: null, etiqueta: null, mensaje: `No se pudo crear la tarea para ${quienes}: ${err instanceof Error ? err.message : String(err)}` };
  }
}
