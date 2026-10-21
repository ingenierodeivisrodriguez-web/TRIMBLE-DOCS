// Discipline templates: a whole discipline (its elements, required parameters,
// modeling notes and reference images) saved in the base project, so any
// project that uses the same catalog can copy it. The copy is independent:
// changing it doesn't change the template or other projects.
import { plegar } from "../presupuesto/format";
import type { ContenidoPlantilla, Disciplina, Elemento, ElementoData, ImagenPlantilla } from "./types";

export interface ImagenOrigen {
  id: string;
  elementoId: string;
  ruta: string;
  nombre: string;
  tipo: string;
  ancho: number;
  alto: number;
  bytes: number;
}

/** What a template keeps of a discipline: its active elements, in order, and where each image's copy goes. */
export function contenidoPlantilla(
  disciplina: Disciplina,
  elementos: Elemento[],
  imagenes: ImagenOrigen[],
  rutaCopia: (img: ImagenOrigen) => string
): { contenido: ContenidoPlantilla; copias: { desde: string; hacia: string }[] } {
  const copias: { desde: string; hacia: string }[] = [];
  const propios = elementos.filter((e) => e.disciplinaId === disciplina.id && e.activo).sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo));
  return {
    contenido: {
      disciplina: { codigo: disciplina.codigo, nombre: disciplina.nombre, color: disciplina.color },
      elementos: propios.map((e) => ({
        codigo: e.codigo,
        nombre: e.nombre,
        claseIfc: e.claseIfc,
        tipoPredefinido: e.tipoPredefinido,
        clasificacionSistema: e.clasificacionSistema,
        clasificacionCodigo: e.clasificacionCodigo,
        notas: e.notas,
        parametros: e.parametros.map((p) => ({ ...p })),
        regla: e.regla ? structuredClone(e.regla) : null,
        orden: e.orden,
        imagenes: imagenes
          .filter((i) => i.elementoId === e.id)
          .map((i): ImagenPlantilla => {
            const hacia = rutaCopia(i);
            copias.push({ desde: i.ruta, hacia });
            return { ruta: hacia, nombre: i.nombre, tipo: i.tipo, ancho: i.ancho, alto: i.alto, bytes: i.bytes };
          }),
      })),
    },
    copias,
  };
}

export interface ElementoCopiado {
  datos: ElementoData;
  imagenes: ImagenPlantilla[];
}

/**
 * The elements a template creates in a discipline of a project. Required
 * parameters that the project's catalog doesn't have (it uses another base,
 * or they were removed) are left out and counted.
 */
export function elementosDePlantilla(contenido: ContenidoPlantilla, disciplinaId: string, parametrosDelCatalogo: Set<string>): { elementos: ElementoCopiado[]; parametrosQuitados: number } {
  let parametrosQuitados = 0;
  const elementos = contenido.elementos.map((e) => {
    const parametros = e.parametros.filter((p) => parametrosDelCatalogo.has(p.parametroId));
    parametrosQuitados += e.parametros.length - parametros.length;
    const { imagenes, ...resto } = e;
    return { datos: { ...resto, parametros, disciplinaId, activo: true }, imagenes };
  });
  return { elementos, parametrosQuitados };
}

/** A discipline code not used in the project yet: the template's, or with -2, -3… */
export function codigoLibre(codigo: string, usados: string[]): string {
  const ya = new Set(usados.map((c) => plegar(c)));
  if (!ya.has(plegar(codigo))) return codigo;
  for (let i = 2; ; i++) {
    const c = `${codigo.slice(0, 16)}-${i}`;
    if (!ya.has(plegar(c))) return c;
  }
}
