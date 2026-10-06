// OmniClass: the classification the catalogs follow. The app brings the
// divisions of Table 22 (Work Results), used for partidas; any other table
// (e.g. 23 Products, 41 Materials, 34 Roles for resources) is imported from
// Excel and stored with the catalog.
import type { OmniclassEntry } from "./types";

export const TABLA_22: OmniclassEntry[] = [
  { codigo: "22-01 00 00", titulo: "Requisitos generales" },
  { codigo: "22-02 00 00", titulo: "Condiciones existentes" },
  { codigo: "22-03 00 00", titulo: "Concreto" },
  { codigo: "22-04 00 00", titulo: "Mampostería" },
  { codigo: "22-05 00 00", titulo: "Metales" },
  { codigo: "22-06 00 00", titulo: "Madera, plásticos y compuestos" },
  { codigo: "22-07 00 00", titulo: "Protección térmica y contra la humedad" },
  { codigo: "22-08 00 00", titulo: "Aberturas (puertas y ventanas)" },
  { codigo: "22-09 00 00", titulo: "Acabados" },
  { codigo: "22-10 00 00", titulo: "Especialidades" },
  { codigo: "22-11 00 00", titulo: "Equipamiento" },
  { codigo: "22-12 00 00", titulo: "Mobiliario" },
  { codigo: "22-13 00 00", titulo: "Construcciones especiales" },
  { codigo: "22-14 00 00", titulo: "Equipos de transporte vertical" },
  { codigo: "22-21 00 00", titulo: "Protección contra incendios" },
  { codigo: "22-22 00 00", titulo: "Instalaciones sanitarias" },
  { codigo: "22-23 00 00", titulo: "Climatización (HVAC)" },
  { codigo: "22-25 00 00", titulo: "Automatización integrada" },
  { codigo: "22-26 00 00", titulo: "Instalaciones eléctricas" },
  { codigo: "22-27 00 00", titulo: "Comunicaciones" },
  { codigo: "22-28 00 00", titulo: "Seguridad electrónica" },
  { codigo: "22-31 00 00", titulo: "Movimiento de tierras" },
  { codigo: "22-32 00 00", titulo: "Obras exteriores" },
  { codigo: "22-33 00 00", titulo: "Redes de servicios" },
  { codigo: "22-34 00 00", titulo: "Transporte" },
  { codigo: "22-35 00 00", titulo: "Obras hidráulicas y marítimas" },
  { codigo: "22-40 00 00", titulo: "Integración de procesos" },
  { codigo: "22-41 00 00", titulo: "Equipos de procesamiento y manejo de materiales" },
  { codigo: "22-42 00 00", titulo: "Equipos de calentamiento, enfriamiento y secado de procesos" },
  { codigo: "22-43 00 00", titulo: "Equipos de manejo de gases y líquidos de procesos" },
  { codigo: "22-44 00 00", titulo: "Equipos de control de contaminación y residuos" },
  { codigo: "22-45 00 00", titulo: "Equipos de manufactura de industrias específicas" },
  { codigo: "22-46 00 00", titulo: "Equipos de agua y aguas residuales" },
  { codigo: "22-48 00 00", titulo: "Generación de energía eléctrica" },
];

/** Built-in and imported codes together (imported ones win), sorted by code. */
export function codigosOmniclass(importados: OmniclassEntry[]): OmniclassEntry[] {
  const all = new Map(TABLA_22.map((e) => [e.codigo, e]));
  for (const e of importados) all.set(e.codigo, e);
  return [...all.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
}

/** The table a code belongs to: "22-03 30 00" -> "22". */
export function tablaDe(codigo: string): string {
  const m = /^(\d{2})-/.exec(codigo.trim());
  return m ? m[1] : "";
}

/** The division of a code (its first two levels): "22-03 30 00" -> "22-03". */
export function divisionDe(codigo: string): string {
  const m = /^(\d{2}-\d{2})/.exec(codigo.trim());
  return m ? m[1] : "";
}

/** "22-03 00 00 Concreto", or the code alone when its title isn't known. */
export function etiquetaOmniclass(codigo: string, codigos: Map<string, string>): string {
  if (!codigo) return "";
  const titulo = codigos.get(codigo);
  return titulo ? `${codigo} ${titulo}` : codigo;
}
