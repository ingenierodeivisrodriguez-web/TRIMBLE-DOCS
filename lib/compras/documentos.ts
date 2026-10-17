import { diasEntre } from "../manuales/licencia";
import type { Documento, EntidadDocumento, Modulo, TipoDocumentoLegal } from "./types";

/**
 * Documents of Compras in the project's CDE: where each kind goes, the
 * fixed name each file gets, the kinds of documents of each record, and how
 * a supplier's legal file (expediente) stands. Pure functions.
 */

/** The folders Compras uses, under one folder in the project's root. */
export const CARPETAS: { clave: string; nombre: string; padre: string | null }[] = [
  { clave: "raiz", nombre: "Compras y Contrataciones", padre: null },
  { clave: "requisiciones", nombre: "Requisiciones", padre: "raiz" },
  { clave: "cotizaciones", nombre: "Cotizaciones", padre: "raiz" },
  { clave: "ordenes", nombre: "Órdenes de compra", padre: "raiz" },
  { clave: "contratos", nombre: "Contratos", padre: "raiz" },
  { clave: "proveedores", nombre: "Documentación legal de proveedores", padre: "raiz" },
  { clave: "recepciones", nombre: "Actas y recepciones", padre: "raiz" },
];

export function rutaCarpeta(clave: string): string {
  const c = CARPETAS.find((x) => x.clave === clave);
  if (!c) return clave;
  return c.padre ? `${rutaCarpeta(c.padre)} / ${c.nombre}` : c.nombre;
}

export const CARPETA_DE: Record<EntidadDocumento, string> = {
  requisicion: "requisiciones",
  cotizacion: "cotizaciones",
  orden: "ordenes",
  contrato: "contratos",
  proveedor: "proveedores",
  recepcion: "recepciones",
};

/** The module whose "documentos" permission uploads and opens each record's documents. */
export const MODULO_DE: Record<EntidadDocumento, Modulo> = {
  requisicion: "requisiciones",
  cotizacion: "cotizaciones",
  orden: "ordenes",
  contrato: "contratos",
  proveedor: "proveedores",
  recepcion: "recepciones",
};

/** The kinds of document of each record (a supplier's are the configurable legal ones). */
export const TIPOS_SOPORTE: Record<Exclude<EntidadDocumento, "proveedor">, { clave: string; nombre: string }[]> = {
  requisicion: [{ clave: "soporte", nombre: "Soporte" }],
  cotizacion: [
    { clave: "cotizacion", nombre: "Cotización del proveedor" },
    { clave: "soporte", nombre: "Soporte" },
  ],
  orden: [
    { clave: "pdf", nombre: "Orden de compra (PDF)" },
    { clave: "firmada", nombre: "Orden aceptada por el proveedor" },
    { clave: "soporte", nombre: "Soporte" },
  ],
  contrato: [
    { clave: "pdf", nombre: "Contrato (PDF)" },
    { clave: "firmado", nombre: "Contrato firmado" },
    { clave: "poliza", nombre: "Póliza" },
    { clave: "soporte", nombre: "Soporte" },
  ],
  recepcion: [
    { clave: "acta", nombre: "Acta de recepción" },
    { clave: "remision", nombre: "Remisión del proveedor" },
    { clave: "soporte", nombre: "Soporte" },
  ],
};

export const TIPOS_LEGALES_INICIALES: TipoDocumentoLegal[] = [
  { clave: "rut", nombre: "RUT", obligatorio: true, vigenciaDias: null, activo: true },
  { clave: "camara", nombre: "Certificado de existencia y representación (Cámara de Comercio)", obligatorio: true, vigenciaDias: 30, activo: true },
  { clave: "cedula", nombre: "Cédula del representante legal", obligatorio: true, vigenciaDias: null, activo: true },
  { clave: "bancaria", nombre: "Certificación bancaria", obligatorio: true, vigenciaDias: 90, activo: true },
  { clave: "seguridad_social", nombre: "Certificado de pago de seguridad social y parafiscales", obligatorio: true, vigenciaDias: 30, activo: true },
  { clave: "polizas", nombre: "Pólizas", obligatorio: false, vigenciaDias: null, activo: true },
  { clave: "otro", nombre: "Otro documento", obligatorio: false, vigenciaDias: null, activo: true },
];

/** Biggest file that can be uploaded (single upload, no parts). */
export const MAX_TAMANO = 100 * 1024 * 1024;
/** Biggest file the server can send on the browser's behalf (Vercel takes up to 4.5 MB per request). */
export const MAX_RELEVO = 4 * 1024 * 1024;

/** A name Trimble Connect accepts: no \ / : * ? " < > | nor control characters, trimmed. */
export function nombreSeguro(texto: string, max = 120): string {
  const limpio = texto
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return limpio.slice(0, max).trim() || "documento";
}

/**
 * The file's name in Trimble: "REQ-0007 - Soporte - factura proforma [1a2b3c4d].pdf".
 * It carries the record, the kind, the original name and the document's id,
 * so it is unique and the same on every retry.
 */
export function nombreArchivo(prefijo: string, titulo: string, original: string, documentoId: string): string {
  const punto = original.lastIndexOf(".");
  const ext = punto > 0 ? nombreSeguro(original.slice(punto + 1), 10).toLowerCase() : "";
  const base = nombreSeguro(punto > 0 ? original.slice(0, punto) : original, 60);
  return `${nombreSeguro(`${prefijo} - ${titulo} - ${base}`, 140)} [${documentoId.replace(/-/g, "").slice(0, 8)}]${ext ? `.${ext}` : ""}`;
}

/** A supplier's own folder inside "Documentación legal de proveedores". */
export function carpetaProveedor(nitConDv: string, razonSocial: string): string {
  return nombreSeguro(`${nitConDv} ${razonSocial}`, 120);
}

/** "2026-10-16" + 30 days. */
export function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** When a legal document would expire if issued today (null: it doesn't expire). */
export function sugerirVence(tipo: Pick<TipoDocumentoLegal, "vigenciaDias">, hoy: string): string | null {
  return tipo.vigenciaDias ? sumarDias(hoy, tipo.vigenciaDias) : null;
}

export const DIAS_AVISO = 15;
export type EstadoVigencia = "vigente" | "por-vencer" | "vencido" | "sin-vencimiento";

export function vigencia(vence: string | null, hoy: string): EstadoVigencia {
  if (!vence) return "sin-vencimiento";
  const dias = diasEntre(hoy, vence);
  return dias < 0 ? "vencido" : dias <= DIAS_AVISO ? "por-vencer" : "vigente";
}

export type EstadoExpediente = "completo" | "por-vencer" | "vencido" | "incompleto";

export interface ItemExpediente {
  tipo: TipoDocumentoLegal;
  /** The latest backed-up document of this kind (null: none). */
  documento: Documento | null;
  estado: EstadoVigencia | "falta" | "sin-respaldo";
}

/**
 * How a supplier's legal file stands: each active kind with its latest
 * document confirmed by Trimble. Incomplete when a mandatory one is missing
 * or not backed up yet; then expired, then about to expire.
 */
export function expediente(proveedorId: string, documentos: Documento[], tipos: TipoDocumentoLegal[], hoy: string): { estado: EstadoExpediente; items: ItemExpediente[] } {
  const propios = documentos.filter((d) => d.entidadTipo === "proveedor" && d.entidadId === proveedorId && d.estado !== "anulado");
  const items: ItemExpediente[] = tipos
    .filter((t) => t.activo)
    .map((tipo) => {
      const delTipo = propios.filter((d) => d.tipoDoc === tipo.clave).sort((a, b) => b.creado.localeCompare(a.creado));
      const respaldado = delTipo.find((d) => d.estado === "respaldado") ?? null;
      if (!respaldado) return { tipo, documento: delTipo[0] ?? null, estado: delTipo.length ? "sin-respaldo" : "falta" };
      return { tipo, documento: respaldado, estado: vigencia(respaldado.vence, hoy) };
    });
  const obligatorios = items.filter((i) => i.tipo.obligatorio);
  const estado: EstadoExpediente = obligatorios.some((i) => i.estado === "falta" || i.estado === "sin-respaldo")
    ? "incompleto"
    : items.some((i) => i.documento && i.estado === "vencido" && i.tipo.obligatorio)
      ? "vencido"
      : items.some((i) => i.estado === "por-vencer" || (i.estado === "vencido" && !i.tipo.obligatorio))
        ? "por-vencer"
        : "completo";
  return { estado, items };
}

export const ESTADOS_DOCUMENTO: Record<Documento["estado"], { texto: string; color: string; fondo: string }> = {
  pendiente: { texto: "Pendiente de respaldo", color: "#7a5a00", fondo: "#fff4d1" },
  respaldado: { texto: "Respaldado en el CDE", color: "#2e6b22", fondo: "#e3f3de" },
  error: { texto: "Error al cargar", color: "#b3261e", fondo: "#fbe4e2" },
  anulado: { texto: "Anulado", color: "#6b7684", fondo: "#eef1f4" },
};

export const ESTADOS_EXPEDIENTE: Record<EstadoExpediente, { texto: string; color: string; fondo: string }> = {
  completo: { texto: "Completo", color: "#2e6b22", fondo: "#e3f3de" },
  "por-vencer": { texto: "Por vencer", color: "#7a5a00", fondo: "#fff4d1" },
  vencido: { texto: "Vencido", color: "#b3261e", fondo: "#fbe4e2" },
  incompleto: { texto: "Incompleto", color: "#a35200", fondo: "#fdebd8" },
};

/** The kinds of document a record takes. */
export function tiposDe(entidad: EntidadDocumento, legales: TipoDocumentoLegal[]): { clave: string; nombre: string }[] {
  return entidad === "proveedor" ? legales.filter((t) => t.activo).map((t) => ({ clave: t.clave, nombre: t.nombre })) : TIPOS_SOPORTE[entidad];
}

/** The kinds of legal documents as saved: valid keys, names, days; never removed (deactivated). */
export function revisarTipos(tipos: TipoDocumentoLegal[], antes: TipoDocumentoLegal[]): string | null {
  if (!tipos.length || tipos.length > 30) return "Entre 1 y 30 tipos de documento.";
  const claves = new Set<string>();
  for (const t of tipos) {
    if (!/^[a-z0-9_]{1,40}$/.test(t.clave)) return `Clave no válida: "${t.clave}".`;
    if (claves.has(t.clave)) return `La clave "${t.clave}" está repetida.`;
    claves.add(t.clave);
    if (!t.nombre.trim() || t.nombre.length > 120) return "Cada tipo necesita un nombre (máximo 120 caracteres).";
    if (t.vigenciaDias !== null && (!Number.isInteger(t.vigenciaDias) || t.vigenciaDias < 1 || t.vigenciaDias > 3650)) return `${t.nombre}: la vigencia va de 1 a 3650 días, o vacía.`;
  }
  const faltan = antes.filter((a) => !claves.has(a.clave));
  if (faltan.length) return `No se quitan tipos que ya existían (${faltan.map((f) => f.nombre).join(", ")}): desactívalos.`;
  return null;
}
