import { ContratoCompras } from "../lecturas/compras";
import { consumoDeApu, MetradoModelo, redondear } from "../presupuesto/calc";
import { resolverPresupuesto } from "../presupuesto/doc";
import { plegar } from "../presupuesto/format";
import { numerar } from "../presupuesto/tree";
import { ColumnaMemoria, Memoria, PresupuestoDoc, Programacion, SIN_DATO_UBICACION } from "../presupuesto/types";
import {
  CambioMedicion,
  ContratoMedible,
  ElementoMedido,
  LineaMemoria,
  MAX_ELEMENTOS_MEDICION,
  MAX_LINEAS_MEDICION,
  MedicionObra,
  Nivel,
  Nodo,
  PartidaMedible,
  PropuestaUbicacion,
  Ubicacion,
} from "./types";

/**
 * Measurements of the work done (mediciones de obra), as pure functions. The
 * SQL of supabase/control-obra.sql (obra_guardar_medicion and its trigger)
 * checks the same rules again; the memory store follows them too.
 *
 * - A measurement is of ONE partida, in ONE location (a value of each level of
 *   the structure), by one contract of Compras or by own crews.
 * - From the model: elements linked to that partida in Presupuesto, each one
 *   with the % measured now; its quantity is that % of what the model gives it
 *   (Presupuesto's rule). Per element and partida, all the measurements that
 *   aren't cancelled add up to 100 % at most (50 % now and 50 % later is fine).
 * - By hand: a memoria de cantidades, each line veces × the dimensions written.
 */

export const numeroMedicion = (n: number) => `MED-${String(n).padStart(4, "0")}`;

/** A line of the memoria: veces × largo × ancho × alto, leaving out the empty dimensions (only veces: a count). */
export function cantidadLinea(l: Pick<LineaMemoria, "veces" | "largo" | "ancho" | "alto">): number {
  let c = l.veces;
  for (const d of [l.largo, l.ancho, l.alto]) if (d !== null) c *= d;
  return redondear(c, 4);
}

/** What a % of an element gives: % × the model's quantity, 4 decimals. */
export function cantidadElemento(porcentaje: number, cantidadModelo: number): number {
  return redondear((porcentaje / 100) * cantidadModelo, 4);
}

/** The measurement's quantity: its elements' or its lines' (each already rounded, as they are shown). */
export function cantidadMedicion(m: { origen: "modelo" | "manual"; elementos: Pick<ElementoMedido, "cantidad">[]; lineas: Pick<LineaMemoria, "cantidad">[] }): number {
  const partes = m.origen === "modelo" ? m.elementos.map((e) => e.cantidad) : m.lineas.map((l) => l.cantidad);
  return redondear(partes.reduce((a, b) => a + b, 0), 4);
}

/** The % already measured of each element in a partida by the measurements in force (leaving one out, when editing it). */
export function medidoPorElemento(mediciones: MedicionObra[], partidaId: string, sinMedicion?: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of mediciones) {
    if (m.partidaId !== partidaId || m.estado === "anulada" || m.id === sinMedicion) continue;
    for (const e of m.elementos) out.set(e.ifcGuid, redondear((out.get(e.ifcGuid) ?? 0) + e.porcentaje, 4));
  }
  return out;
}

/** The elements that would go over 100 % with these new ones (with what each would reach). */
export function superan100(medido: Map<string, number>, nuevos: { ifcGuid: string; nombre: string; porcentaje: number }[]): { ifcGuid: string; nombre: string; total: number }[] {
  const suma = new Map(medido);
  for (const e of nuevos) suma.set(e.ifcGuid, redondear((suma.get(e.ifcGuid) ?? 0) + e.porcentaje, 4));
  return [...new Map(nuevos.map((e) => [e.ifcGuid, e])).values()].filter((e) => suma.get(e.ifcGuid)! > 100).map((e) => ({ ifcGuid: e.ifcGuid, nombre: e.nombre, total: suma.get(e.ifcGuid)! }));
}

/** Why the measurement as sent can't be saved (only its shape; the partida, contract and location are checked apart), or null. */
export function revisarForma(c: CambioMedicion, hoy: string): string | null {
  if (c.fecha > hoy) return "La fecha de la medición no puede ser futura.";
  if (c.origen === "modelo") {
    if (!c.elementos.length) return "Selecciona en el modelo los elementos que se midieron.";
    if (c.lineas.length) return "Una medición del modelo no lleva memoria de cantidades.";
    if (c.elementos.length > MAX_ELEMENTOS_MEDICION) return `Una medición admite hasta ${MAX_ELEMENTOS_MEDICION.toLocaleString("es")} elementos.`;
    if (new Set(c.elementos.map((e) => e.ifcGuid)).size !== c.elementos.length) return "Un elemento está repetido en la medición.";
    const malo = c.elementos.find((e) => !(e.porcentaje > 0 && e.porcentaje <= 100));
    if (malo) return `${malo.nombre || malo.ifcGuid}: el porcentaje debe ser mayor que 0 y hasta 100.`;
  } else {
    if (!c.lineas.length) return "Escribe al menos una línea de la memoria de cantidades.";
    if (c.elementos.length) return "Una medición a mano no lleva elementos del modelo.";
    if (c.lineas.length > MAX_LINEAS_MEDICION) return `La memoria admite hasta ${MAX_LINEAS_MEDICION} líneas.`;
    const total = redondear(c.lineas.reduce((a, l) => a + cantidadLinea(l), 0), 4);
    if (!(total > 0)) return "La cantidad medida debe ser mayor que cero.";
  }
  return null;
}

// ---------------------------------------------------------------- what is measured: the budget's partidas and Compras' contracts

/** The partidas of the budget with their number, chapter, contracted quantity and the resources a contract can do. */
export function partidasMedibles(doc: PresupuestoDoc, metrados: Map<string, MetradoModelo>): PartidaMedible[] {
  const r = resolverPresupuesto(doc);
  const out: PartidaMedible[] = [];
  for (const sp of doc.subpresupuestos) {
    const numeros = numerar(sp.items);
    const titulos: { nivel: number; descripcion: string }[] = [];
    sp.items.forEach((item, i) => {
      if (item.tipo === "titulo") {
        while (titulos.length && titulos[titulos.length - 1].nivel >= item.nivel) titulos.pop();
        titulos.push({ nivel: item.nivel, descripcion: item.descripcion });
        return;
      }
      const capitulo = titulos.filter((t) => t.nivel < item.nivel).map((t) => t.descripcion);
      const consumo = consumoDeApu(item, 1, r);
      const insumosContrato = [...consumo.cantidades.keys()].filter((id) => ["SC", "MO"].includes(doc.insumos[id]?.tipo ?? ""));
      const modelo = metrados.get(item.id);
      out.push({
        id: item.id,
        numero: numeros[i],
        descripcion: item.descripcion,
        unidad: item.unidad,
        subpresupuesto: sp.nombre,
        capitulo: capitulo.join(" › "),
        metrado: redondear(modelo ? modelo.valor : item.metrado, 4),
        insumosContrato,
        inactiva: !!(item as { inactiva?: unknown }).inactiva,
      });
    });
  }
  return out;
}

/** The approved contracts as the measurements see them: who, and which resources (no prices). */
export function contratosMedibles(contratos: ContratoCompras[]): ContratoMedible[] {
  return contratos.map((c) => ({
    id: c.id,
    numero: c.numero,
    revision: c.revision,
    proveedor: c.proveedor,
    nit: c.nit,
    insumos: c.lineas.map((l) => ({ insumoId: l.insumoId, descripcion: l.descripcion, unidad: l.unidad, partidaItemId: l.partidaItemId })),
  }));
}

/** The contracts that can have done a partida: one of its lines is a subcontract or labor resource of its APU (and not for another partida). */
export function contratosDePartida(p: Pick<PartidaMedible, "id" | "insumosContrato">, contratos: ContratoMedible[]): ContratoMedible[] {
  const set = new Set(p.insumosContrato);
  return contratos.filter((c) => c.insumos.some((l) => set.has(l.insumoId) && (l.partidaItemId === null || l.partidaItemId === p.id)));
}

// ---------------------------------------------------------------- where: the structure of the work

/** The levels in order, keeping their parents first. */
const enOrden = (niveles: Nivel[]) => [...niveles].sort((a, b) => a.orden - b.orden || a.clave.localeCompare(b.clave));

/** "Torre 1 · Piso 2". */
export function textoUbicacion(u: Ubicacion, niveles: Nivel[], nodos: Nodo[]): string {
  const conocidos = enOrden(niveles).filter((n) => u[n.clave]);
  const resto = Object.keys(u).filter((k) => !niveles.some((n) => n.clave === k));
  return [...conocidos.map((n) => n.clave), ...resto].map((k) => nodos.find((x) => x.id === u[k])?.valor ?? "?").join(" · ");
}

/** Why this location isn't valid in the project, or null. `niveles`: those in force, active. */
export function revisarUbicacion(u: Ubicacion, niveles: Nivel[], nodos: Nodo[], obligatorios: string[]): string | null {
  const claves = Object.keys(u);
  if (!claves.length) return "Indica la ubicación de la medición (torre, piso, eje o zona).";
  for (const k of claves) {
    const nivel = niveles.find((n) => n.clave === k && n.activo);
    if (!nivel) return `El nivel "${k}" no existe en la estructura de este proyecto o está desactivado.`;
    const nodo = nodos.find((x) => x.id === u[k]);
    if (!nodo || nodo.nivelClave !== k) return `${nivel.nombre}: el valor elegido no existe.`;
    if (nodo.estado === "inactivo") return `${nivel.nombre}: ${nodo.valor} está inactivo.`;
    // A value inside another (Piso 2 of Torre 1) must agree with the one chosen above.
    if (nodo.padreId && nivel.padreClave && u[nivel.padreClave] && u[nivel.padreClave] !== nodo.padreId) {
      return `${nivel.nombre}: ${nodo.valor} no pertenece a ${nodos.find((x) => x.id === u[nivel.padreClave!])?.valor ?? "lo elegido arriba"}.`;
    }
  }
  const faltan = obligatorios.filter((k) => !u[k]).map((k) => niveles.find((n) => n.clave === k)?.nombre ?? k);
  if (faltan.length) return `La ubicación debe indicar: ${faltan.join(", ")}.`;
  return null;
}

/** The level a column of Presupuesto's memoria feeds: same property of the model or attribute, or else the same name. */
export function nivelDeColumna(col: ColumnaMemoria, niveles: Nivel[]): Nivel | null {
  const activos = niveles.filter((n) => n.activo);
  const misma = activos.find(
    (n) =>
      (col.fuente === "modelo" && n.fuente === "modelo" && plegar(n.claveFuente) === plegar(col.clave)) ||
      (col.fuente === "propiedad" && n.fuente === "propiedad" && n.claveFuente === col.clave)
  );
  return misma ?? activos.find((n) => plegar(n.nombre) === plegar(col.label)) ?? null;
}

/**
 * The location an element's memoria points to: for each column that feeds a
 * level, the value of that level with the same text. A value that exists in
 * several places (Piso 2 of each tower) is taken only inside the value already
 * found above it; one that exists once also gives the value above it.
 */
export function ubicacionDeMemoria(memoria: Memoria | null, columnas: ColumnaMemoria[], niveles: Nivel[], nodos: Nodo[]): Ubicacion {
  const u: Ubicacion = {};
  if (!memoria) return u;
  const pendientes: { nivel: Nivel; valor: string }[] = [];
  for (const col of columnas) {
    const valor = memoria[col.id];
    const nivel = valor && valor.trim() ? nivelDeColumna(col, niveles) : null;
    if (nivel && !pendientes.some((p) => p.nivel.clave === nivel.clave)) pendientes.push({ nivel, valor });
  }
  // Each pass may settle a parent that tells which of several values is meant below it.
  for (let pasada = 0; pasada <= pendientes.length; pasada++) {
    for (const { nivel, valor } of pendientes) {
      if (u[nivel.clave]) continue;
      let candidatos = nodos.filter((x) => x.nivelClave === nivel.clave && x.estado !== "inactivo" && plegar(x.valor) === plegar(valor));
      const padre = nivel.padreClave ? u[nivel.padreClave] : undefined;
      if (padre) candidatos = candidatos.filter((x) => x.padreId === padre);
      if (candidatos.length !== 1) continue;
      u[nivel.clave] = candidatos[0].id;
      if (nivel.padreClave && !padre && candidatos[0].padreId) u[nivel.padreClave] = candidatos[0].padreId;
    }
  }
  return u;
}

/** The common location of several elements (null if they don't agree) and how many are in each one. */
export function ubicacionComun(
  ubicaciones: Ubicacion[],
  niveles: Nivel[],
  nodos: Nodo[]
): { comun: Ubicacion | null; grupos: { texto: string; elementos: number }[] } {
  const grupos = new Map<string, { u: Ubicacion; n: number }>();
  for (const u of ubicaciones) {
    const k = JSON.stringify(Object.entries(u).sort());
    grupos.set(k, { u, n: (grupos.get(k)?.n ?? 0) + 1 });
  }
  const lista = [...grupos.values()].sort((a, b) => b.n - a.n);
  return {
    comun: lista.length === 1 && Object.keys(lista[0].u).length ? lista[0].u : null,
    grupos: lista.map((g) => ({ texto: Object.keys(g.u).length ? textoUbicacion(g.u, niveles, nodos) : "(sin ubicación en el modelo)", elementos: g.n })),
  };
}

/**
 * The values the schedule's EDT gives the structure: its work packages filter
 * the model by columns of the memoria (Nivel = PISO 2); each column that feeds a
 * level proposes its values. Nothing is created here: the person chooses.
 */
export function propuestasDesdeEdt(
  programacion: Pick<Programacion, "edt"> | null,
  columnas: ColumnaMemoria[],
  niveles: Nivel[],
  nodos: Nodo[]
): { propuestas: PropuestaUbicacion[]; columnasSinNivel: string[] } {
  const propuestas = new Map<string, PropuestaUbicacion>();
  const sinNivel = new Set<string>();
  for (const n of programacion?.edt ?? []) {
    for (const f of n.ubicacion ?? []) {
      if (!f.valor.trim() || f.valor === SIN_DATO_UBICACION) continue;
      const col = columnas.find((c) => c.id === f.columna);
      const nivel = col ? nivelDeColumna(col, niveles) : null;
      if (!nivel) {
        sinNivel.add(col?.label ?? f.columna);
        continue;
      }
      const k = `${nivel.clave}|${plegar(f.valor)}`;
      if (propuestas.has(k)) continue;
      propuestas.set(k, {
        nivelClave: nivel.clave,
        nivelNombre: nivel.nombre,
        valor: f.valor.trim(),
        existe: nodos.some((x) => x.nivelClave === nivel.clave && plegar(x.valor) === plegar(f.valor)),
      });
    }
  }
  return {
    propuestas: [...propuestas.values()].sort((a, b) => a.nivelNombre.localeCompare(b.nivelNombre, "es") || a.valor.localeCompare(b.valor, "es", { numeric: true })),
    columnasSinNivel: [...sinNivel],
  };
}
