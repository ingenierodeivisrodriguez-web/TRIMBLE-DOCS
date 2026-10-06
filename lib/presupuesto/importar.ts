// Importing catalogs from the Excel template: sheets read as plain rows are
// matched to what the catalog already has (by code, or by description and
// unit when there is no code) and turned into the rows to save.
import { parseNumberInput } from "../propiedades/values";
import { creaCicloCatalogo, nuevoId } from "./doc";
import { plegar } from "./format";
import {
  Componente,
  Insumo,
  InsumoData,
  MAX_COMPONENTES,
  MAX_SHORT_TEXT,
  MAX_TEXT,
  OmniclassEntry,
  PartidaCatalogo,
  PartidaData,
  TipoInsumo,
} from "./types";

export type Celda = string | number | boolean | Date | null;
/** A sheet as rows of cells; the first row is the header. */
export type Hoja = Celda[][];

export interface Libro {
  insumos?: Hoja;
  partidas?: Hoja;
  apu?: Hoja;
  omniclass?: Hoja;
}

export interface PlanImportacion {
  insumos: (InsumoData & { id: string })[];
  partidas: (PartidaData & { id: string })[];
  omniclass: OmniclassEntry[];
  errores: string[];
  resumen: {
    insumosNuevos: number;
    insumosActualizados: number;
    insumosSinCambios: number;
    partidasNuevas: number;
    partidasActualizadas: number;
    partidasSinCambios: number;
  };
}

// ---------------------------------------------------------------- headers

const COLUMNAS = {
  insumos: {
    codigo: ["codigo", "cod", "codigo insumo"],
    descripcion: ["descripcion", "insumo", "insumos", "nombre"],
    unidad: ["unidad", "und", "unid", "um"],
    precio: ["precio", "pu", "precio unitario", "costo", "valor"],
    tipo: ["tipo", "tipo mo mt eq sc", "clase"],
    iu: ["iu", "indice unificado", "indice"],
    omniclass: ["omniclass", "clasificacion omniclass", "clasificacion"],
  },
  partidas: {
    codigo: ["codigo", "cod", "codigo partida"],
    descripcion: ["descripcion", "partida", "nombre"],
    unidad: ["unidad", "und", "unid", "um"],
    rendimiento: ["rendimiento", "rend"],
    jornada: ["jornada", "jornada h", "horas", "horas jornada"],
    omniclass: ["omniclass", "clasificacion omniclass", "clasificacion"],
  },
  apu: {
    partida: ["codigo partida", "partida", "cod partida"],
    tipo: ["tipo", "tipo componente", "insumo o subpartida"],
    codigo: ["codigo insumo o subpartida", "codigo insumo", "codigo", "codigo componente"],
    descripcion: ["descripcion", "descripcion si no hay codigo", "insumo", "nombre"],
    unidad: ["unidad", "unidad si no hay codigo", "und"],
    cuadrilla: ["cuadrilla"],
    cantidad: ["cantidad", "cant"],
  },
  omniclass: {
    codigo: ["codigo", "omniclass number", "number", "omniclass", "numero"],
    titulo: ["titulo", "title", "nombre", "descripcion"],
  },
} as const;

function normalizarEncabezado(value: Celda): string {
  return plegar(String(value ?? ""))
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Column index of each field, from the header row. */
function columnas<K extends string>(header: Celda[], spec: Record<K, readonly string[]>): Partial<Record<K, number>> {
  const names = header.map(normalizarEncabezado);
  const out: Partial<Record<K, number>> = {};
  const used = new Set<number>();
  for (const key of Object.keys(spec) as K[]) {
    for (const alias of spec[key]) {
      const i = names.findIndex((n, idx) => !used.has(idx) && n === alias);
      if (i >= 0) {
        out[key] = i;
        used.add(i);
        break;
      }
    }
  }
  return out;
}

function texto(value: Celda): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function numero(value: Celda): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return parseNumberInput(String(value));
}

const TIPOS: Record<string, TipoInsumo> = {
  mo: "MO",
  "mano de obra": "MO",
  mt: "MT",
  material: "MT",
  materiales: "MT",
  eq: "EQ",
  equipo: "EQ",
  equipos: "EQ",
  herramienta: "EQ",
  herramientas: "EQ",
  "equipos y herramientas": "EQ",
  tr: "EQ",
  transporte: "EQ",
  sc: "SC",
  subcontrato: "SC",
  subcontratos: "SC",
};

export function tipoDe(value: Celda): TipoInsumo | null {
  return TIPOS[plegar(texto(value)).replace(/\s+/g, " ")] ?? null;
}

const clave = (descripcion: string, unidad: string) => `${plegar(descripcion).replace(/\s+/g, " ")}|${plegar(unidad)}`;
const claveCodigo = (codigo: string) => codigo.trim().toLowerCase();

function filasDe(hoja: Hoja | undefined): { header: Celda[]; rows: { n: number; cells: Celda[] }[] } {
  if (!hoja || hoja.length === 0) return { header: [], rows: [] };
  // The header is the first row with at least two filled cells.
  const h = hoja.findIndex((r) => r.filter((c) => texto(c)).length >= 2);
  if (h < 0) return { header: [], rows: [] };
  return {
    header: hoja[h],
    rows: hoja
      .slice(h + 1)
      .map((cells, i) => ({ n: h + i + 2, cells }))
      .filter((r) => r.cells.some((c) => texto(c))),
  };
}

function igualInsumo(a: InsumoData, b: InsumoData): boolean {
  return a.codigo === b.codigo && a.descripcion === b.descripcion && a.unidad === b.unidad && a.precio === b.precio && a.tipo === b.tipo && a.iu === b.iu && a.omniclass === b.omniclass;
}

function igualPartida(a: PartidaData, b: PartidaData): boolean {
  return (
    a.codigo === b.codigo &&
    a.descripcion === b.descripcion &&
    a.unidad === b.unidad &&
    a.rendimiento === b.rendimiento &&
    a.jornada === b.jornada &&
    a.omniclass === b.omniclass &&
    JSON.stringify(a.componentes) === JSON.stringify(b.componentes)
  );
}

// ---------------------------------------------------------------- plan

export function planificarImportacion(libro: Libro, catalogo: { insumos: Insumo[]; partidas: PartidaCatalogo[] }): PlanImportacion {
  const errores: string[] = [];
  const resumen = { insumosNuevos: 0, insumosActualizados: 0, insumosSinCambios: 0, partidasNuevas: 0, partidasActualizadas: 0, partidasSinCambios: 0 };

  // ---- insumos
  const insPorCodigo = new Map<string, Insumo | (InsumoData & { id: string })>();
  const insPorClave = new Map<string, Insumo | (InsumoData & { id: string })>();
  for (const i of catalogo.insumos) {
    if (i.codigo) insPorCodigo.set(claveCodigo(i.codigo), i);
    insPorClave.set(clave(i.descripcion, i.unidad), i);
  }
  const insumos: (InsumoData & { id: string })[] = [];
  const hojaIns = filasDe(libro.insumos);
  if (hojaIns.rows.length) {
    const col = columnas(hojaIns.header, COLUMNAS.insumos);
    if (col.descripcion === undefined) errores.push('Hoja "Insumos": falta la columna "Descripción".');
    else {
      const vistos = new Map<string, number>();
      for (const { n, cells } of hojaIns.rows) {
        const get = (k: keyof typeof col) => (col[k] === undefined ? null : cells[col[k]!]);
        const data: InsumoData = {
          codigo: texto(get("codigo")),
          descripcion: texto(get("descripcion")),
          unidad: texto(get("unidad")),
          precio: numero(get("precio")) ?? 0,
          tipo: tipoDe(get("tipo")) ?? ("" as TipoInsumo),
          iu: texto(get("iu")),
          omniclass: texto(get("omniclass")),
        };
        const where = `Insumos, fila ${n}`;
        if (!data.descripcion) {
          errores.push(`${where}: falta la descripción.`);
          continue;
        }
        if (!data.tipo) {
          errores.push(`${where}: el tipo "${texto(get("tipo"))}" no es MO, MT, EQ ni SC.`);
          continue;
        }
        if (data.precio < 0) {
          errores.push(`${where}: el precio no puede ser negativo.`);
          continue;
        }
        if (data.descripcion.length > MAX_TEXT || data.codigo.length > MAX_SHORT_TEXT || data.unidad.length > 20) {
          errores.push(`${where}: algún texto es demasiado largo.`);
          continue;
        }
        const k = data.codigo ? `c:${claveCodigo(data.codigo)}` : `d:${clave(data.descripcion, data.unidad)}`;
        if (vistos.has(k)) {
          errores.push(`${where}: repite el insumo de la fila ${vistos.get(k)}.`);
          continue;
        }
        vistos.set(k, n);
        const existente = (data.codigo ? insPorCodigo.get(claveCodigo(data.codigo)) : undefined) ?? (data.codigo ? undefined : insPorClave.get(clave(data.descripcion, data.unidad)));
        const row = { id: existente?.id ?? nuevoId(), ...data };
        if (!existente) resumen.insumosNuevos++;
        else if (igualInsumo(existente, data)) {
          resumen.insumosSinCambios++;
        } else resumen.insumosActualizados++;
        if (!existente || !igualInsumo(existente, data)) insumos.push(row);
        if (data.codigo) insPorCodigo.set(claveCodigo(data.codigo), row);
        insPorClave.set(clave(data.descripcion, data.unidad), row);
      }
    }
  }

  // ---- partidas
  const parPorCodigo = new Map<string, PartidaData & { id: string }>();
  const parPorClave = new Map<string, PartidaData & { id: string }>();
  for (const p of catalogo.partidas) {
    if (p.codigo) parPorCodigo.set(claveCodigo(p.codigo), p);
    parPorClave.set(clave(p.descripcion, p.unidad), p);
  }
  const planeadas = new Map<string, PartidaData & { id: string; fila: number }>();
  const hojaPar = filasDe(libro.partidas);
  if (hojaPar.rows.length) {
    const col = columnas(hojaPar.header, COLUMNAS.partidas);
    if (col.descripcion === undefined) errores.push('Hoja "Partidas": falta la columna "Descripción".');
    else {
      const vistos = new Map<string, number>();
      for (const { n, cells } of hojaPar.rows) {
        const get = (k: keyof typeof col) => (col[k] === undefined ? null : cells[col[k]!]);
        const where = `Partidas, fila ${n}`;
        const codigo = texto(get("codigo"));
        const descripcion = texto(get("descripcion"));
        const unidad = texto(get("unidad"));
        if (!descripcion) {
          errores.push(`${where}: falta la descripción.`);
          continue;
        }
        const rendimiento = numero(get("rendimiento")) ?? 1;
        const jornada = numero(get("jornada")) ?? 8;
        if (!(rendimiento > 0) || !(jornada > 0)) {
          errores.push(`${where}: el rendimiento y la jornada deben ser mayores que 0.`);
          continue;
        }
        if (descripcion.length > MAX_TEXT || codigo.length > MAX_SHORT_TEXT || unidad.length > 20) {
          errores.push(`${where}: algún texto es demasiado largo.`);
          continue;
        }
        const k = codigo ? `c:${claveCodigo(codigo)}` : `d:${clave(descripcion, unidad)}`;
        if (vistos.has(k)) {
          errores.push(`${where}: repite la partida de la fila ${vistos.get(k)}.`);
          continue;
        }
        vistos.set(k, n);
        const existente = codigo ? parPorCodigo.get(claveCodigo(codigo)) : parPorClave.get(clave(descripcion, unidad));
        const row = {
          id: existente?.id ?? nuevoId(),
          codigo,
          descripcion,
          unidad,
          rendimiento,
          jornada,
          omniclass: texto(get("omniclass")),
          componentes: existente ? existente.componentes.map((c) => ({ ...c })) : [],
          fila: n,
        };
        planeadas.set(row.id, row);
        if (codigo) parPorCodigo.set(claveCodigo(codigo), row);
        parPorClave.set(clave(descripcion, unidad), row);
      }
    }
  }

  // ---- APU lines (they replace the components of the partidas they mention)
  const hojaApu = filasDe(libro.apu);
  if (hojaApu.rows.length) {
    const col = columnas(hojaApu.header, COLUMNAS.apu);
    if (col.partida === undefined) errores.push('Hoja "APU": falta la columna "Código partida".');
    else {
      const nuevas = new Map<string, Componente[]>();
      for (const { n, cells } of hojaApu.rows) {
        const get = (k: keyof typeof col) => (col[k] === undefined ? null : cells[col[k]!]);
        const where = `APU, fila ${n}`;
        const codPartida = texto(get("partida"));
        const partida = parPorCodigo.get(claveCodigo(codPartida));
        if (!partida) {
          errores.push(`${where}: no hay una partida con el código "${codPartida}".`);
          continue;
        }
        const esSub = /^(sp|sub|subpartida|sub partida)$/.test(plegar(texto(get("tipo"))));
        const codigo = texto(get("codigo"));
        let id: string | undefined;
        if (esSub) {
          id = parPorCodigo.get(claveCodigo(codigo))?.id;
          if (!id) {
            errores.push(`${where}: no hay una partida con el código "${codigo}" para usar como subpartida.`);
            continue;
          }
          if (id === partida.id) {
            errores.push(`${where}: una partida no puede ser subpartida de sí misma.`);
            continue;
          }
        } else {
          id = (codigo ? insPorCodigo.get(claveCodigo(codigo)) : insPorClave.get(clave(texto(get("descripcion")), texto(get("unidad")))))?.id;
          if (!id) {
            errores.push(`${where}: no se encontró el insumo "${codigo || texto(get("descripcion"))}".`);
            continue;
          }
        }
        const cuadrilla = esSub ? null : numero(get("cuadrilla"));
        const cantidad = numero(get("cantidad")) ?? 0;
        if ((cuadrilla !== null && cuadrilla < 0) || cantidad < 0) {
          errores.push(`${where}: la cuadrilla y la cantidad no pueden ser negativas.`);
          continue;
        }
        const lista = nuevas.get(partida.id) ?? [];
        if (lista.length >= MAX_COMPONENTES) {
          errores.push(`${where}: la partida supera los ${MAX_COMPONENTES} insumos.`);
          continue;
        }
        lista.push({ tipo: esSub ? "subpartida" : "insumo", id, cuadrilla, cantidad });
        nuevas.set(partida.id, lista);
      }
      for (const [id, componentes] of nuevas) {
        const p = planeadas.get(id) ?? (() => {
          const base = catalogo.partidas.find((x) => x.id === id)!;
          const copia = { id: base.id, codigo: base.codigo, descripcion: base.descripcion, unidad: base.unidad, rendimiento: base.rendimiento, jornada: base.jornada, omniclass: base.omniclass, componentes: base.componentes, fila: 0 };
          planeadas.set(id, copia);
          return copia;
        })();
        p.componentes = componentes;
      }
    }
  }

  // Circular subpartidas (directly or through others) can't be saved.
  const todas = new Map<string, PartidaCatalogo>(catalogo.partidas.map((p) => [p.id, p]));
  for (const p of planeadas.values()) todas.set(p.id, { ...p, updatedAt: null, updatedBy: null });
  const partidas: (PartidaData & { id: string })[] = [];
  const existentes = new Map(catalogo.partidas.map((p) => [p.id, p]));
  for (const { fila, ...p } of planeadas.values()) {
    const ciclo = p.componentes.some((c) => c.tipo === "subpartida" && creaCicloCatalogo(todas, c.id, p.id));
    if (ciclo) {
      errores.push(`Partida "${p.descripcion}"${fila ? ` (fila ${fila})` : ""}: sus subpartidas la contienen a ella misma.`);
      continue;
    }
    const antes = existentes.get(p.id);
    if (!antes) resumen.partidasNuevas++;
    else if (igualPartida(antes, p)) {
      resumen.partidasSinCambios++;
      continue;
    } else resumen.partidasActualizadas++;
    partidas.push(p);
  }

  // ---- OmniClass codes
  const omniclass: OmniclassEntry[] = [];
  const hojaOmni = filasDe(libro.omniclass);
  if (hojaOmni.rows.length) {
    const col = columnas(hojaOmni.header, COLUMNAS.omniclass);
    if (col.codigo === undefined || col.titulo === undefined) errores.push('Hoja "OmniClass": faltan las columnas "Código" y "Título".');
    else {
      for (const { n, cells } of hojaOmni.rows) {
        const codigo = texto(cells[col.codigo]);
        const titulo = texto(cells[col.titulo]);
        if (!codigo || !titulo) continue;
        if (codigo.length > 60 || titulo.length > 300) {
          errores.push(`OmniClass, fila ${n}: texto demasiado largo.`);
          continue;
        }
        omniclass.push({ codigo, titulo });
      }
    }
  }

  return { insumos, partidas, omniclass, errores, resumen };
}
