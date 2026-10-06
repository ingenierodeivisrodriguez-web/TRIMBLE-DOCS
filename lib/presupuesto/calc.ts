// The budget's arithmetic, following the usual APU practice: quantities to 4
// decimals, amounts to 2, a unit cost is the sum of its rounded amounts, and
// a partida's amount is its quantity (metrado) times its unit cost.
import { evaluarFormula, FormulaError, VARIABLE_RE, VARIABLES_FIJAS } from "./formula";
import { numerar } from "./tree";
import type {
  Apu,
  Componente,
  FilaPie,
  FormatoGasto,
  GastosGenerales,
  Item,
  ItemGasto,
  Rubro,
  Subpresupuesto,
  TipoInsumo,
  TituloGasto,
} from "./types";

/** Rounds half away from zero, without the 1.005 → 1.00 binary surprise. */
export function redondear(n: number, decimales: number): number {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** decimales;
  const scaled = Number((Math.abs(n) * f).toPrecision(15));
  return (Math.sign(n) * Math.round(scaled)) / f;
}

/** Resources measured as a percentage of the labor of the partida (e.g. hand tools, "%MO"). */
export function esPorcentajeMO(unidad: string): boolean {
  return unidad.replace(/\s+/g, "").toUpperCase() === "%MO";
}

export function rubrosVacios(): Record<Rubro, number> {
  return { MO: 0, MT: 0, EQ: 0, SC: 0, SP: 0 };
}

// ---------------------------------------------------------------- APU

export interface InsumoRef {
  descripcion: string;
  unidad: string;
  tipo: TipoInsumo;
  precio: number;
}

export interface SubpartidaRef extends Apu {
  descripcion: string;
  unidad: string;
}

/** Where an APU finds its resources and subpartidas (the catalog, or the budget). */
export interface Resolver {
  insumo(id: string): InsumoRef | null;
  subpartida(id: string): SubpartidaRef | null;
}

export interface LineaApu {
  /** Position in `componentes`. */
  index: number;
  componente: Componente;
  rubro: Rubro;
  descripcion: string;
  unidad: string;
  cuadrilla: number | null;
  cantidad: number;
  precio: number;
  parcial: number;
  /** A "%MO" line: `cantidad` is a percentage and `precio` the partida's labor. */
  porcentajeMO: boolean;
  error: string | null;
}

export interface ApuCalculado {
  lineas: LineaApu[];
  rubros: Record<Rubro, number>;
  /** Unit cost. */
  cu: number;
}

/** A line's quantity: from the crew when it has one (cuadrilla × jornada ÷ rendimiento), else as typed. */
export function cantidadComponente(c: Componente, apu: Pick<Apu, "rendimiento" | "jornada">): number {
  if (c.cuadrilla !== null && apu.rendimiento > 0) return redondear((c.cuadrilla * apu.jornada) / apu.rendimiento, 4);
  return redondear(c.cantidad, 4);
}

/** The crew that gives `cantidad` (for when the quantity of a crew line is typed). */
export function cuadrillaPara(cantidad: number, apu: Pick<Apu, "rendimiento" | "jornada">): number {
  return apu.jornada > 0 ? redondear((cantidad * apu.rendimiento) / apu.jornada, 4) : 0;
}

export interface ApuOptions {
  /** Unit costs of subpartidas already computed in this pass. */
  cache?: Map<string, ApuCalculado>;
  /** Ids of the partidas being computed (to stop circular subpartidas). */
  stack?: string[];
}

export function calcularApu(apu: Apu, r: Resolver, options: ApuOptions = {}): ApuCalculado {
  const cache = options.cache ?? new Map<string, ApuCalculado>();
  const stack = options.stack ?? [];
  const lineas: LineaApu[] = apu.componentes.map((c, index) => {
    const base = { index, componente: c, cuadrilla: null, porcentajeMO: false, error: null };
    if (c.tipo === "insumo") {
      const ins = r.insumo(c.id);
      if (!ins) {
        return { ...base, rubro: "MT", descripcion: "(insumo no encontrado)", unidad: "", cantidad: redondear(c.cantidad, 4), precio: 0, parcial: 0, error: "El insumo ya no existe." };
      }
      if (esPorcentajeMO(ins.unidad)) {
        // Amount set below, once the partida's labor is known.
        return { ...base, rubro: ins.tipo, descripcion: ins.descripcion, unidad: ins.unidad, cantidad: redondear(c.cantidad, 4), precio: 0, parcial: 0, porcentajeMO: true };
      }
      const cantidad = cantidadComponente(c, apu);
      return {
        ...base,
        rubro: ins.tipo,
        descripcion: ins.descripcion,
        unidad: ins.unidad,
        cuadrilla: c.cuadrilla === null ? null : redondear(c.cuadrilla, 4),
        cantidad,
        precio: ins.precio,
        parcial: redondear(cantidad * ins.precio, 2),
      };
    }
    const sub = r.subpartida(c.id);
    const cantidad = redondear(c.cantidad, 4);
    if (!sub) {
      return { ...base, rubro: "SP", descripcion: "(subpartida no encontrada)", unidad: "", cantidad, precio: 0, parcial: 0, error: "La subpartida ya no existe." };
    }
    if (stack.includes(c.id)) {
      return { ...base, rubro: "SP", descripcion: sub.descripcion, unidad: sub.unidad, cantidad, precio: 0, parcial: 0, error: "La subpartida se contiene a sí misma." };
    }
    let calculada = cache.get(c.id);
    if (!calculada) {
      calculada = calcularApu(sub, r, { cache, stack: [...stack, c.id] });
      cache.set(c.id, calculada);
    }
    return { ...base, rubro: "SP", descripcion: sub.descripcion, unidad: sub.unidad, cantidad, precio: calculada.cu, parcial: redondear(cantidad * calculada.cu, 2) };
  });

  const manoDeObra = redondear(
    lineas.filter((l) => l.rubro === "MO" && !l.porcentajeMO && !l.error).reduce((sum, l) => sum + l.parcial, 0),
    2
  );
  for (const l of lineas) {
    if (!l.porcentajeMO) continue;
    l.precio = manoDeObra;
    l.parcial = redondear((l.cantidad / 100) * manoDeObra, 2);
  }

  const rubros = rubrosVacios();
  for (const l of lineas) if (!l.error) rubros[l.rubro] += l.parcial;
  for (const k of Object.keys(rubros) as Rubro[]) rubros[k] = redondear(rubros[k], 2);
  const cu = redondear(rubros.MO + rubros.MT + rubros.EQ + rubros.SC + rubros.SP, 2);
  return { lineas, rubros, cu };
}

// ---------------------------------------------------------------- the budget's rows

/** A partida's quantity from its model elements. */
export interface MetradoModelo {
  valor: number;
  elementos: number;
  campoLabel: string;
}

export interface FilaPresupuesto {
  item: Item;
  index: number;
  /** "1.2.3" */
  numero: string;
  /** Effective quantity (null for titles). */
  metrado: number | null;
  /** Set when the quantity comes from the model. */
  metradoModelo: MetradoModelo | null;
  cu: number | null;
  parcial: number;
  rubros: Record<Rubro, number>;
  apu: ApuCalculado | null;
}

export interface SubpresupuestoCalculado {
  filas: FilaPresupuesto[];
  /** Direct cost: the sum of every partida's amount. */
  cd: number;
  rubros: Record<Rubro, number>;
}

export function calcularSubpresupuesto(
  sp: Subpresupuesto,
  r: Resolver,
  metradoModelo: (itemId: string) => MetradoModelo | null = () => null,
  cache: Map<string, ApuCalculado> = new Map()
): SubpresupuestoCalculado {
  const numeros = numerar(sp.items);
  const filas: FilaPresupuesto[] = [];
  const titulos: FilaPresupuesto[] = []; // the open ancestors of the current row
  const total = rubrosVacios();
  let cd = 0;

  sp.items.forEach((item, index) => {
    while (titulos.length && (titulos[titulos.length - 1].item.nivel >= item.nivel)) titulos.pop();
    if (item.tipo === "titulo") {
      const fila: FilaPresupuesto = { item, index, numero: numeros[index], metrado: null, metradoModelo: null, cu: null, parcial: 0, rubros: rubrosVacios(), apu: null };
      filas.push(fila);
      titulos.push(fila);
      return;
    }
    const modelo = metradoModelo(item.id);
    const metrado = redondear(modelo ? modelo.valor : item.metrado, 2);
    const apu = calcularApu(item, r, { cache });
    const rubros = rubrosVacios();
    for (const k of Object.keys(rubros) as Rubro[]) rubros[k] = redondear(metrado * apu.rubros[k], 2);
    const parcial = redondear(metrado * apu.cu, 2);
    filas.push({ item, index, numero: numeros[index], metrado, metradoModelo: modelo, cu: apu.cu, parcial, rubros, apu });
    cd += parcial;
    for (const k of Object.keys(rubros) as Rubro[]) total[k] += rubros[k];
    for (const t of titulos) {
      t.parcial += parcial;
      for (const k of Object.keys(rubros) as Rubro[]) t.rubros[k] += rubros[k];
    }
  });

  for (const f of filas) {
    if (f.item.tipo !== "titulo") continue;
    f.parcial = redondear(f.parcial, 2);
    for (const k of Object.keys(f.rubros) as Rubro[]) f.rubros[k] = redondear(f.rubros[k], 2);
  }
  for (const k of Object.keys(total) as Rubro[]) total[k] = redondear(total[k], 2);
  return { filas, cd: redondear(cd, 2), rubros: total };
}

// ---------------------------------------------------------------- list of resources

export interface FilaInsumo {
  id: string;
  descripcion: string;
  unidad: string;
  tipo: TipoInsumo;
  /** Total quantity (for "%MO" resources, not meaningful: their amount is money). */
  cantidad: number;
  precio: number;
  parcial: number;
  porcentajeMO: boolean;
}

const ORDEN_TIPO: Record<TipoInsumo, number> = { MO: 0, MT: 1, EQ: 2, SC: 3 };

/**
 * Every resource the given partidas use, added up: each partida's metrado
 * times the quantity in its APU, going into subpartidas.
 */
export function listaInsumos(
  sps: Subpresupuesto[],
  r: Resolver,
  metradoModelo: (itemId: string) => MetradoModelo | null = () => null
): FilaInsumo[] {
  const cantidades = new Map<string, number>();
  const montos = new Map<string, number>(); // "%MO" resources
  const cache = new Map<string, ApuCalculado>();

  function acumular(apu: Apu, factor: number, stack: string[]) {
    if (factor === 0) return;
    const calculada = calcularApu(apu, r, { cache, stack });
    for (const l of calculada.lineas) {
      if (l.error) continue;
      const c = l.componente;
      if (c.tipo === "subpartida") {
        const sub = r.subpartida(c.id);
        if (sub) acumular(sub, factor * l.cantidad, [...stack, c.id]);
      } else if (l.porcentajeMO) {
        montos.set(c.id, (montos.get(c.id) ?? 0) + factor * l.parcial);
      } else {
        cantidades.set(c.id, (cantidades.get(c.id) ?? 0) + factor * l.cantidad);
      }
    }
  }

  for (const sp of sps) {
    for (const item of sp.items) {
      if (item.tipo !== "partida") continue;
      const modelo = metradoModelo(item.id);
      acumular(item, redondear(modelo ? modelo.valor : item.metrado, 2), []);
    }
  }

  const filas: FilaInsumo[] = [];
  for (const [id, cantidad] of cantidades) {
    const ins = r.insumo(id);
    if (!ins) continue;
    const q = redondear(cantidad, 4);
    filas.push({ id, descripcion: ins.descripcion, unidad: ins.unidad, tipo: ins.tipo, cantidad: q, precio: ins.precio, parcial: redondear(q * ins.precio, 2), porcentajeMO: false });
  }
  for (const [id, monto] of montos) {
    const ins = r.insumo(id);
    if (!ins) continue;
    filas.push({ id, descripcion: ins.descripcion, unidad: ins.unidad, tipo: ins.tipo, cantidad: 0, precio: 0, parcial: redondear(monto, 2), porcentajeMO: true });
  }
  return filas.sort(
    (a, b) => ORDEN_TIPO[a.tipo] - ORDEN_TIPO[b.tipo] || a.descripcion.localeCompare(b.descripcion, "es", { sensitivity: "base" })
  );
}

// ---------------------------------------------------------------- general expenses

export function parcialGasto(item: ItemGasto, formato: FormatoGasto): number {
  const base = item.cantidad * item.precio;
  return redondear(formato === "personal" ? base * (item.participacion / 100) * item.tiempo : base, 2);
}

export function totalTituloGasto(t: TituloGasto): number {
  return redondear(t.items.reduce((sum, i) => sum + parcialGasto(i, t.formato), 0), 2);
}

export function totalGastos(g: GastosGenerales): { fijos: number; variables: number; total: number } {
  const fijos = redondear(g.fijos.reduce((sum, t) => sum + totalTituloGasto(t), 0), 2);
  const variables = redondear(g.variables.reduce((sum, t) => sum + totalTituloGasto(t), 0), 2);
  return { fijos, variables, total: redondear(fijos + variables, 2) };
}

/** General expenses as a fraction of the whole budget's direct cost (FGG in footer formulas). */
export function factorGastos(gg: number, cdTotal: number): number {
  return cdTotal > 0 ? gg / cdTotal : 0;
}

// ---------------------------------------------------------------- footer

export interface FilaPieCalculada {
  fila: FilaPie;
  valor: number | null;
  error: string | null;
}

/** Each footer row's value, in order: a formula sees CD, FGG and the variables of the rows above. */
export function calcularPie(pie: FilaPie[], base: { cd: number; fgg: number }): FilaPieCalculada[] {
  const variables = new Map<string, number>([
    ["CD", base.cd],
    ["FGG", base.fgg],
  ]);
  return pie.map((fila) => {
    const nombre = fila.variable.trim().toUpperCase();
    let valor: number | null = null;
    let error: string | null = null;
    if (!VARIABLE_RE.test(fila.variable.trim())) error = "La variable debe empezar con una letra y usar solo letras, números o _.";
    else if (VARIABLES_FIJAS.includes(nombre)) error = `${nombre} ya existe; usa otro nombre.`;
    else if (variables.has(nombre)) error = `La variable ${nombre} está repetida.`;
    else {
      try {
        valor = redondear(evaluarFormula(fila.formula, variables), 2);
      } catch (err) {
        error = err instanceof FormulaError ? err.message : "Fórmula no válida.";
      }
    }
    if (!error || !variables.has(nombre)) variables.set(nombre, valor ?? Number.NaN);
    return { fila, valor, error };
  });
}

/** The footer of the reference budget: general expenses, profit, subtotal, tax and total. */
export function pieInicial(): FilaPie[] {
  return [
    { variable: "PGG", descripcion: "GASTOS GENERALES", formula: "CD * FGG", iu: "", resaltar: false },
    { variable: "UTI", descripcion: "UTILIDAD 10%", formula: "CD * 0.10", iu: "", resaltar: false },
    { variable: "ST", descripcion: "SUB TOTAL", formula: "CD + PGG + UTI", iu: "", resaltar: true },
    { variable: "IGV", descripcion: "IGV 18%", formula: "ST * 0.18", iu: "", resaltar: false },
    { variable: "TOTAL", descripcion: "TOTAL PRESUPUESTO", formula: "ST + IGV", iu: "", resaltar: true },
  ];
}
