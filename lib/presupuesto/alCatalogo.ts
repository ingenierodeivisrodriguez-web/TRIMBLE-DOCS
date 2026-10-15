// Saving budget partidas into the catalog (base de datos de partidas), the
// way back of partidaDesdeCatalogo: each partida with its analysis, the
// resources the catalog lacks (with this budget's price, under the same id)
// and the subpartidas it uses. Nothing in the catalog changes without the
// person choosing it: a partida that is already there and differs is left
// alone unless they choose to update it or to add it as another one.
import { ApuCalculado, calcularApu, InsumoRef, redondear, Resolver } from "./calc";
import { nuevoId } from "./doc";
import { plegar } from "./format";
import type { Apu, Componente, Insumo, InsumoData, ItemPartida, PartidaCatalogo, PartidaData, PresupuestoDoc } from "./types";

export interface CatalogoActual {
  insumos: Map<string, Insumo>;
  partidas: Map<string, PartidaCatalogo>;
}

/** What tells two partidas (or resources) apart by name: folded description and unit. */
export function claveNombre(descripcion: string, unidad: string): string {
  const n = (t: string) => plegar(t).replace(/\s+/g, " ").trim();
  return `${n(descripcion)}|${n(unidad)}`;
}

export type EstadoAlCatalogo = "nueva" | "igual" | "distinta";
export type AccionAlCatalogo = "crear" | "actualizar" | "omitir";

export interface FilaAlCatalogo {
  /** Key of the row: the catalog partida it matches, or the new partida's name. */
  clave: string;
  /** The budget rows it covers, in order (the same partida repeated, e.g. on each floor). */
  itemIds: string[];
  descripcion: string;
  unidad: string;
  /** The catalog partida it matches: the one it was copied from, or one with its same description and unit. */
  catalogoId: string | null;
  estado: EstadoAlCatalogo;
  /** What goes to the catalog (its lines pointing at catalog ids), from the first row. */
  datos: PartidaData;
  /** Rows of the group whose analysis is not the first one's. */
  distintasEnGrupo: number;
  /** Analysis lines left out: their resource or subpartida no longer exists. */
  lineasSinOrigen: number;
  /** Resources it needs that the catalog lacks, and budget subpartidas it needs created there. */
  insumos: Set<string>;
  subpartidas: Set<string>;
}

export interface SubpartidaAlCatalogo {
  /** Its id in the catalog (new). */
  id: string;
  /** Its id in the budget. */
  presupuestoId: string;
  datos: PartidaData;
}

export interface PlanAlCatalogo {
  filas: FilaAlCatalogo[];
  /** Resources to create, by id (the budget's id; its price is the budget's). */
  insumos: Map<string, InsumoData>;
  /** Budget subpartidas to create in the catalog, by their budget id. */
  subpartidas: Map<string, SubpartidaAlCatalogo>;
}

/** The EDT dictionary goes without the person in charge (who belongs to this project). */
function edtParaCatalogo(p: PartidaData): Pick<PartidaData, "edt"> {
  const descripcion = p.edt?.descripcion ?? "";
  const criterios = p.edt?.criterios ?? "";
  return descripcion || criterios ? { edt: { descripcion, criterios, responsable: "" } } : {};
}

/**
 * Plans saving `items` (budget partidas, in order) into the catalog. Rows of
 * the same partida (same catalog origin, or same description and unit) go as
 * one. `crearId` makes the ids of new subpartidas (for tests).
 */
export function planAlCatalogo(doc: PresupuestoDoc, items: ItemPartida[], catalogo: CatalogoActual, crearId: () => string = nuevoId): PlanAlCatalogo {
  const partidaPorNombre = new Map<string, string>();
  for (const p of catalogo.partidas.values()) {
    const k = claveNombre(p.descripcion, p.unidad);
    if (!partidaPorNombre.has(k)) partidaPorNombre.set(k, p.id);
  }
  const insumoPorNombre = new Map<string, string>();
  for (const i of catalogo.insumos.values()) {
    const k = claveNombre(i.descripcion, i.unidad);
    if (!insumoPorNombre.has(k)) insumoPorNombre.set(k, i.id);
  }
  const insumos = new Map<string, InsumoData>();
  const subpartidas = new Map<string, SubpartidaAlCatalogo & { insumos: Set<string>; subs: Set<string> }>();

  /** An analysis with its lines pointing at the catalog, and what it needs created. */
  function convertir(apu: PartidaData): { datos: PartidaData; insumos: Set<string>; subs: Set<string>; sinOrigen: number } {
    const necesita = { insumos: new Set<string>(), subs: new Set<string>() };
    let sinOrigen = 0;
    const componentes: Componente[] = [];
    for (const c of apu.componentes) {
      if (c.tipo === "insumo") {
        if (catalogo.insumos.has(c.id)) {
          componentes.push({ ...c });
          continue;
        }
        const ins = doc.insumos[c.id];
        if (!ins) {
          sinOrigen++;
          continue;
        }
        const igual = insumoPorNombre.get(claveNombre(ins.descripcion, ins.unidad));
        if (igual) {
          componentes.push({ ...c, id: igual });
          continue;
        }
        insumos.set(c.id, { ...ins });
        necesita.insumos.add(c.id);
        componentes.push({ ...c });
        continue;
      }
      const sub = doc.subpartidas[c.id];
      if (!sub) {
        sinOrigen++;
        continue;
      }
      if (sub.origenId && catalogo.partidas.has(sub.origenId)) {
        componentes.push({ ...c, id: sub.origenId });
        continue;
      }
      let s = subpartidas.get(c.id);
      if (!s) {
        // Reserved before going in, so one reached twice (or in a loop) is made once.
        s = { id: crearId(), presupuestoId: c.id, datos: sub, insumos: new Set(), subs: new Set() };
        subpartidas.set(c.id, s);
        const dentro = convertir(sub);
        s.datos = dentro.datos;
        s.insumos = dentro.insumos;
        s.subs = dentro.subs;
      }
      necesita.subs.add(c.id);
      componentes.push({ ...c, id: s.id });
    }
    const datos: PartidaData = {
      codigo: apu.codigo,
      descripcion: apu.descripcion,
      unidad: apu.unidad,
      omniclass: apu.omniclass,
      rendimiento: apu.rendimiento,
      jornada: apu.jornada,
      ...edtParaCatalogo(apu),
      componentes,
    };
    return { datos, ...necesita, sinOrigen };
  }

  const grupos = new Map<string, { items: ItemPartida[]; catalogoId: string | null }>();
  for (const it of items) {
    const catalogoId = it.origenId && catalogo.partidas.has(it.origenId) ? it.origenId : partidaPorNombre.get(claveNombre(it.descripcion, it.unidad)) ?? null;
    const clave = catalogoId ?? `nueva:${claveNombre(it.descripcion, it.unidad)}`;
    const g = grupos.get(clave) ?? { items: [], catalogoId };
    g.items.push(it);
    grupos.set(clave, g);
  }

  const filas: FilaAlCatalogo[] = [];
  for (const [clave, g] of grupos) {
    const primera = convertir(g.items[0]);
    const distintasEnGrupo = g.items.slice(1).filter((it) => !mismoAnalisis(convertir(it).datos, primera.datos)).length;
    // Everything a row needs, through its subpartidas too.
    const ins = new Set(primera.insumos);
    const subs = new Set<string>();
    const pendientes = [...primera.subs];
    while (pendientes.length) {
      const id = pendientes.pop()!;
      if (subs.has(id)) continue;
      subs.add(id);
      const s = subpartidas.get(id)!;
      for (const x of s.insumos) ins.add(x);
      pendientes.push(...s.subs);
    }
    const cat = g.catalogoId ? catalogo.partidas.get(g.catalogoId)! : null;
    filas.push({
      clave,
      itemIds: g.items.map((it) => it.id),
      descripcion: g.items[0].descripcion,
      unidad: g.items[0].unidad,
      catalogoId: g.catalogoId,
      estado: !cat ? "nueva" : mismaPartida(fusion(primera.datos, cat), cat) ? "igual" : "distinta",
      datos: primera.datos,
      distintasEnGrupo,
      lineasSinOrigen: primera.sinOrigen,
      insumos: ins,
      subpartidas: subs,
    });
  }
  return {
    filas,
    insumos,
    subpartidas: new Map([...subpartidas].map(([k, s]) => [k, { id: s.id, presupuestoId: s.presupuestoId, datos: s.datos }])),
  };
}

/** Updating a catalog partida keeps what the budget's leaves empty: its code, OmniClass and EDT dictionary. */
export function fusion(datos: PartidaData, cat: PartidaData): PartidaData {
  const out: PartidaData = { ...datos, codigo: datos.codigo || cat.codigo, omniclass: datos.omniclass || cat.omniclass };
  if (!datos.edt && cat.edt) out.edt = { ...cat.edt };
  return out;
}

const componenteIgual = (a: Componente, b: Componente) =>
  a.tipo === b.tipo && a.id === b.id && (a.cuadrilla === null ? b.cuadrilla === null : b.cuadrilla !== null && redondear(a.cuadrilla, 4) === redondear(b.cuadrilla, 4)) && redondear(a.cantidad, 4) === redondear(b.cantidad, 4);

/** Same unit cost analysis: yield, day and lines. */
export function mismoAnalisis(a: Apu, b: Apu): boolean {
  return (
    redondear(a.rendimiento, 4) === redondear(b.rendimiento, 4) &&
    a.jornada === b.jornada &&
    a.componentes.length === b.componentes.length &&
    a.componentes.every((c, i) => componenteIgual(c, b.componentes[i]))
  );
}

/** Same partida and analysis (the person in charge of the EDT doesn't count). */
export function mismaPartida(a: PartidaData, b: PartidaData): boolean {
  return (
    a.codigo === b.codigo &&
    a.descripcion === b.descripcion &&
    a.unidad === b.unidad &&
    a.omniclass === b.omniclass &&
    (a.edt?.descripcion ?? "") === (b.edt?.descripcion ?? "") &&
    (a.edt?.criterios ?? "") === (b.edt?.criterios ?? "") &&
    mismoAnalisis(a, b)
  );
}

/** The unit cost a row's partida will have in the catalog: with the catalog's prices (the new resources, with the budget's). */
export function cuEnCatalogo(plan: PlanAlCatalogo, datos: PartidaData, catalogo: CatalogoActual): ApuCalculado {
  const subs = new Map([...plan.subpartidas.values()].map((s) => [s.id, s.datos]));
  const resolver: Resolver = {
    insumo: (id): InsumoRef | null => catalogo.insumos.get(id) ?? plan.insumos.get(id) ?? null,
    subpartida: (id) => catalogo.partidas.get(id) ?? subs.get(id) ?? null,
  };
  return calcularApu(datos, resolver);
}

export interface GuardadoAlCatalogo {
  insumos: (InsumoData & { id: string })[];
  /** Subpartidas first, so the partidas that use them come after. */
  partidas: (PartidaData & { id: string })[];
  /** The catalog partida each budget row now comes from, and each budget subpartida. */
  items: Map<string, string>;
  subpartidas: Map<string, string>;
  creadas: number;
  actualizadas: number;
  /** Codes left out because the catalog (or another row) already has them. */
  avisos: string[];
}

/**
 * What to send for the chosen actions (a row not in `acciones` is left out):
 * the resources and subpartidas the chosen partidas need, and the partidas.
 * Rows already equal only get their budget rows linked to the catalog.
 */
export function guardadoAlCatalogo(
  plan: PlanAlCatalogo,
  acciones: Map<string, AccionAlCatalogo>,
  catalogo: CatalogoActual,
  crearId: () => string = nuevoId
): GuardadoAlCatalogo {
  const out: GuardadoAlCatalogo = { insumos: [], partidas: [], items: new Map(), subpartidas: new Map(), creadas: 0, actualizadas: 0, avisos: [] };
  const insumosUsados = new Set<string>();
  const subsUsadas = new Set<string>();
  const codigosPartida = new Map<string, string>(); // folded code → catalog id
  for (const p of catalogo.partidas.values()) if (p.codigo.trim()) codigosPartida.set(plegar(p.codigo.trim()), p.id);
  const codigosInsumo = new Set([...catalogo.insumos.values()].map((i) => plegar(i.codigo.trim())).filter(Boolean));

  /** The partida's code, or "" when another catalog partida (or one sent now) has it. */
  function codigoLibre(codigo: string, id: string, descripcion: string): string {
    const k = plegar(codigo.trim());
    if (!k) return "";
    const de = codigosPartida.get(k);
    if (de && de !== id) {
      out.avisos.push(`"${descripcion}": el código ${codigo} ya lo tiene otra partida del catálogo; se guarda sin código.`);
      return "";
    }
    codigosPartida.set(k, id);
    return codigo;
  }

  const elegidas: { fila: FilaAlCatalogo; accion: "crear" | "actualizar" }[] = [];
  for (const fila of plan.filas) {
    const accion = acciones.get(fila.clave);
    if (!accion || accion === "omitir") continue;
    if (fila.estado === "igual") {
      for (const id of fila.itemIds) out.items.set(id, fila.catalogoId!);
      continue;
    }
    const a = accion === "actualizar" && fila.catalogoId ? "actualizar" : "crear";
    elegidas.push({ fila, accion: a });
    for (const x of fila.insumos) insumosUsados.add(x);
    for (const x of fila.subpartidas) subsUsadas.add(x);
  }

  for (const id of insumosUsados) {
    const ins = plan.insumos.get(id)!;
    const k = plegar(ins.codigo.trim());
    let codigo = ins.codigo;
    if (k && codigosInsumo.has(k)) {
      out.avisos.push(`Insumo "${ins.descripcion}": el código ${ins.codigo} ya lo tiene otro insumo del catálogo; se guarda sin código.`);
      codigo = "";
    } else if (k) codigosInsumo.add(k);
    out.insumos.push({ ...ins, codigo, id });
  }
  for (const id of subsUsadas) {
    const s = plan.subpartidas.get(id)!;
    out.partidas.push({ ...s.datos, codigo: codigoLibre(s.datos.codigo, s.id, s.datos.descripcion), id: s.id });
    out.subpartidas.set(id, s.id);
  }
  for (const { fila, accion } of elegidas) {
    if (accion === "actualizar") {
      const cat = catalogo.partidas.get(fila.catalogoId!)!;
      const datos = fusion(fila.datos, cat);
      const codigo = datos.codigo === cat.codigo ? cat.codigo : codigoLibre(datos.codigo, cat.id, datos.descripcion) || cat.codigo;
      out.partidas.push({ ...datos, codigo, id: cat.id });
      for (const id of fila.itemIds) out.items.set(id, cat.id);
      out.actualizadas++;
      continue;
    }
    const id = crearId();
    out.partidas.push({ ...fila.datos, codigo: codigoLibre(fila.datos.codigo, id, fila.datos.descripcion), id });
    for (const x of fila.itemIds) out.items.set(x, id);
    out.creadas++;
  }
  return out;
}

/** The budget after saving: its rows (and subpartidas) now come from those catalog partidas. */
export function vincularAlCatalogo(doc: PresupuestoDoc, g: Pick<GuardadoAlCatalogo, "items" | "subpartidas">): PresupuestoDoc {
  if (!g.items.size && !g.subpartidas.size) return doc;
  const subpartidas = { ...doc.subpartidas };
  for (const [id, origenId] of g.subpartidas) if (subpartidas[id]) subpartidas[id] = { ...subpartidas[id], origenId };
  return {
    ...doc,
    subpartidas,
    subpresupuestos: doc.subpresupuestos.map((sp) => ({
      ...sp,
      items: sp.items.map((it) => {
        const origenId = it.tipo === "partida" ? g.items.get(it.id) : undefined;
        return origenId && it.tipo === "partida" && it.origenId !== origenId ? { ...it, origenId } : it;
      }),
    })),
  };
}
