/**
 * «Correos de aviso» (phase 2 of the extension's e-mails, 11-11-2026): what
 * each project's administrators set: whether the extension sends its e-mails,
 * whether the Trimble ToDo is still created (Trimble sends its own e-mail, so
 * turning it off leaves only the extension's), which notices send an e-mail,
 * the subject and opening line of each one (with data in braces), who gets a
 * copy and the extension's address in this project. Pure: the browser uses it
 * too, for the preview.
 */

export interface TextoCorreo {
  asunto: string;
  intro: string;
}

export interface ConfigCorreo {
  /** Send the extension's e-mails. */
  activo: boolean;
  /** Also create the Trimble ToDo (and its e-mail). Off: only the extension's e-mail. */
  tareasTrimble: boolean;
  /** Which notices send an e-mail: a step that waits for someone, a rejected file to its uploader. */
  eventos: { revision: boolean; correccion: boolean };
  textos: { revision: TextoCorreo; correccion: TextoCorreo };
  /** Addresses that get one copy of each notice. */
  copia: string[];
  /** The extension's id in this project, from its address (null: the default). */
  idExtension: string | null;
}

/** The texts of before (phase 1). */
export const TEXTOS_INICIALES: ConfigCorreo["textos"] = {
  revision: { asunto: "{codigo} · Te toca «{paso}»: {flujo}", intro: "Te toca el paso «{paso}» del flujo:" },
  correccion: { asunto: "{codigo} · Rechazado: corrige «{archivo}» — {flujo}", intro: "{quien} rechazó la versión {version} de «{archivo}» en el paso «{paso}» del flujo:" },
};

export const CONFIG_INICIAL: ConfigCorreo = {
  activo: true,
  tareasTrimble: true,
  eventos: { revision: true, correccion: true },
  textos: TEXTOS_INICIALES,
  copia: [],
  idExtension: null,
};

/** The data a text can carry, in braces. */
export const DATOS_TEXTO: { clave: string; que: string }[] = [
  { clave: "codigo", que: "código del flujo (FLUJO-01)" },
  { clave: "flujo", que: "título del flujo" },
  { clave: "paso", que: "paso" },
  { clave: "archivo", que: "archivo (o «A-101.pdf y 2 más»)" },
  { clave: "version", que: "versión del archivo" },
  { clave: "vence", que: "vencimiento (DD-MM-AAAA)" },
  { clave: "proyecto", que: "proyecto" },
  { clave: "persona", que: "nombre de quien recibe el correo" },
  { clave: "quien", que: "quien rechazó (solo en el rechazo)" },
];
const CLAVES = new Set(DATOS_TEXTO.map((d) => d.clave));

/** People who get a copy of each notice. */
export const MAX_COPIA = 5;
export const LIMITES = { asunto: [3, 160], intro: [3, 600] } as const;

/**
 * Puts the data into a text. A datum without value leaves nothing (and no
 * separator at the start, for a flow without code); one not known stays as written.
 */
export function rellenar(plantilla: string, valores: Record<string, string>): string {
  return plantilla
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in valores ? valores[k] : m))
    .replace(/^[ \t]*[·—–\-:|][ \t]*/, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const CORREO_VALIDO = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const ENLACE = /\/projects\/([^/?#\s]+)\/extension\/([^/?#\s]+)/;
const ID_SOLO = /^[0-9a-z][0-9a-z-]{7,63}$/i;
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const texto = (v: unknown, inicial: string) => (typeof v === "string" ? v : inicial);
const bool = (v: unknown, inicial: boolean) => (typeof v === "boolean" ? v : inicial);

/** The addresses written in one field (commas, semicolons, spaces or lines). */
export function separarCorreos(v: unknown): string[] {
  const partes = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? v.split(/[\s,;]+/) : [];
  return partes.map((p) => p.trim()).filter(Boolean);
}

/** A stored configuration (or nothing) with whatever it lacks taken from the initial one. */
export function conInicial(datos: unknown): ConfigCorreo {
  const d = obj(datos);
  const ev = obj(d.eventos);
  const tx = obj(d.textos);
  const t = (k: "revision" | "correccion"): TextoCorreo => {
    const o = obj(tx[k]);
    return { asunto: texto(o.asunto, TEXTOS_INICIALES[k].asunto), intro: texto(o.intro, TEXTOS_INICIALES[k].intro) };
  };
  return {
    activo: bool(d.activo, true),
    tareasTrimble: bool(d.tareasTrimble, true),
    eventos: { revision: bool(ev.revision, true), correccion: bool(ev.correccion, true) },
    textos: { revision: t("revision"), correccion: t("correccion") },
    copia: separarCorreos(d.copia).filter((c) => CORREO_VALIDO.test(c)).slice(0, MAX_COPIA),
    idExtension: typeof d.idExtension === "string" && ID_SOLO.test(d.idExtension) ? d.idExtension : null,
  };
}

/**
 * The extension's id from what an administrator pasted: the address of the
 * browser with the extension open in this project, or the id alone; "" is the default.
 */
export function idDeExtension(pegado: string, projectId: string): { id: string | null; error: string | null } {
  const v = pegado.trim();
  if (!v) return { id: null, error: null };
  const m = ENLACE.exec(v);
  if (m) {
    const proyecto = decodeURIComponent(m[1]);
    if (proyecto !== projectId) return { id: null, error: `Esa dirección es de otro proyecto (${proyecto}): abre la extensión en este proyecto y copia su dirección otra vez.` };
    const id = decodeURIComponent(m[2]);
    return ID_SOLO.test(id) ? { id, error: null } : { id: null, error: "La dirección pegada no trae el código de la extensión." };
  }
  if (ID_SOLO.test(v)) return { id: v, error: null };
  return { id: null, error: "Pega la dirección del navegador con la extensión abierta (empieza con https://web.connect.trimble.com/projects/…)." };
}

/** Why a text can't be used, or null. */
function revisarTexto(t: string, que: string, [min, max]: readonly [number, number]): string | null {
  const limpio = t.trim();
  if (limpio.length < min || limpio.length > max) return `${que}: escribe de ${min} a ${max} caracteres.`;
  const raros = [...limpio.matchAll(/\{(\w*)\}/g)].map((m) => m[1]).filter((k) => !CLAVES.has(k));
  if (raros.length) return `${que}: «{${raros[0]}}» no es un dato que se pueda poner. Usa: ${DATOS_TEXTO.map((d) => `{${d.clave}}`).join(", ")}.`;
  return null;
}

/**
 * What an administrator sent from the window, checked: the configuration, or
 * why it can't be saved. `enlace` is what they pasted as the extension's address.
 */
export function revisarConfigCorreo(body: unknown, projectId: string): { config: ConfigCorreo; error: null } | { config: null; error: string } {
  const b = obj(body);
  const base = conInicial({ ...b, copia: [], idExtension: null });
  const textos = { revision: { ...base.textos.revision }, correccion: { ...base.textos.correccion } };
  for (const [k, nombre] of [
    ["revision", "«Te toca un paso»"],
    ["correccion", "«Archivo rechazado»"],
  ] as const) {
    textos[k] = { asunto: textos[k].asunto.replace(/[\r\n\t]+/g, " ").trim(), intro: textos[k].intro.replace(/\r\n?/g, "\n").trim() };
    const error = revisarTexto(textos[k].asunto, `Asunto de ${nombre}`, LIMITES.asunto) ?? revisarTexto(textos[k].intro, `Texto de ${nombre}`, LIMITES.intro);
    if (error) return { config: null, error };
  }
  const copia: string[] = [];
  for (const c of separarCorreos(b.copia)) {
    if (!CORREO_VALIDO.test(c)) return { config: null, error: `«${c}» no es un correo válido (en «Enviar copia a»).` };
    if (!copia.some((x) => x.toLowerCase() === c.toLowerCase())) copia.push(c);
  }
  if (copia.length > MAX_COPIA) return { config: null, error: `En «Enviar copia a» caben hasta ${MAX_COPIA} correos.` };
  const ext = idDeExtension(typeof b.enlace === "string" ? b.enlace : typeof b.idExtension === "string" ? b.idExtension : "", projectId);
  if (ext.error) return { config: null, error: ext.error };
  const config: ConfigCorreo = { ...base, textos, copia, idExtension: ext.id };
  if (!config.tareasTrimble && !config.activo) {
    return { config: null, error: "Si no se crean las tareas de Trimble, los correos de la extensión deben quedar activos: si no, nadie recibe avisos." };
  }
  return { config, error: null };
}

/** What deserves a warning before saving (nothing blocks). */
export function advertenciasCorreo(c: ConfigCorreo, configurado: boolean): string[] {
  const out: string[] = [];
  if (c.activo && !configurado) out.push("No hay cuenta de Gmail en Vercel: los correos no saldrán hasta ponerla.");
  if (!c.tareasTrimble && !c.eventos.revision) out.push("Nadie recibirá aviso cuando le toque un paso (sin tarea de Trimble ni correo).");
  if (!c.tareasTrimble && !c.eventos.correccion) out.push("Nadie recibirá aviso cuando le rechacen un archivo (sin tarea de Trimble ni correo).");
  if (c.activo && !c.eventos.revision && !c.eventos.correccion) out.push("Los correos están activos pero no hay ningún aviso marcado: no saldrá ninguno.");
  return out;
}

const sino = (v: boolean) => (v ? "sí" : "no");
const comillas = (s: string) => `«${s}»`;

/** What changed, in words, for the history. */
export function cambiosCorreo(antes: ConfigCorreo, despues: ConfigCorreo): string[] {
  const out: string[] = [];
  const si = (cond: boolean, t: string) => cond && out.push(t);
  si(antes.activo !== despues.activo, `Correos de la extensión: ${despues.activo ? "activos" : "apagados"}`);
  si(antes.tareasTrimble !== despues.tareasTrimble, `Crear también la tarea de Trimble: ${sino(despues.tareasTrimble)}`);
  si(antes.eventos.revision !== despues.eventos.revision, `Correo cuando a alguien le toca un paso: ${sino(despues.eventos.revision)}`);
  si(antes.eventos.correccion !== despues.eventos.correccion, `Correo cuando rechazan un archivo: ${sino(despues.eventos.correccion)}`);
  for (const [k, nombre] of [
    ["revision", "«Te toca un paso»"],
    ["correccion", "«Archivo rechazado»"],
  ] as const) {
    si(antes.textos[k].asunto !== despues.textos[k].asunto, `Asunto de ${nombre}: ${comillas(despues.textos[k].asunto)}`);
    si(antes.textos[k].intro !== despues.textos[k].intro, `Texto de ${nombre}: ${comillas(despues.textos[k].intro.replace(/\n+/g, " "))}`);
  }
  si(antes.copia.join(",") !== despues.copia.join(","), `Enviar copia a: ${despues.copia.length ? despues.copia.join(", ") : "nadie"}`);
  si(antes.idExtension !== despues.idExtension, `Código de la extensión en este proyecto: ${despues.idExtension ?? "el de siempre"}`);
  return out;
}
