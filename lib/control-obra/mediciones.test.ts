import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ContratoCompras } from "../lecturas/compras";
import type { ColumnaMemoria, PresupuestoDoc } from "../presupuesto/types";
import {
  cantidadElemento,
  cantidadLinea,
  cantidadMedicion,
  contratosDePartida,
  contratosMedibles,
  medidoPorElemento,
  nivelDeColumna,
  numeroMedicion,
  partidasMedibles,
  propuestasDesdeEdt,
  revisarForma,
  revisarUbicacion,
  superan100,
  textoUbicacion,
  ubicacionComun,
  ubicacionDeMemoria,
} from "./mediciones";
import { CambioMedicion, MedicionObra, Nivel, Nodo } from "./types";

// ---- the budget of the acceptance test: 1.1 Muro en bloque No. 5, 500 m2
const doc = {
  subpresupuestos: [
    {
      id: "sp1",
      nombre: "TORRE 1",
      pie: [],
      items: [
        { id: "t1", tipo: "titulo", nivel: 0, descripcion: "MAMPOSTERÍA" },
        { id: "p11", tipo: "partida", nivel: 1, codigo: "", descripcion: "Muro en bloque No. 5", unidad: "M2", omniclass: "", rendimiento: 12, jornada: 8, metrado: 500, origenId: null,
          componentes: [{ tipo: "insumo", id: "sc03", cuadrilla: null, cantidad: 1 }, { tipo: "insumo", id: "blq", cuadrilla: null, cantidad: 12.5 }, { tipo: "subpartida", id: "sub1", cuadrilla: null, cantidad: 0.01 }] },
        { id: "t2", tipo: "titulo", nivel: 0, descripcion: "ACABADOS" },
        { id: "p21", tipo: "partida", nivel: 1, codigo: "", descripcion: "Lavada de muro", unidad: "M2", omniclass: "", rendimiento: 40, jornada: 8, metrado: 900, origenId: null, modo: "3d",
          componentes: [{ tipo: "insumo", id: "ofi", cuadrilla: 1, cantidad: 0 }] },
      ],
    },
  ],
  insumos: {
    sc03: { codigo: "SC-03", descripcion: "Mano de obra muro", unidad: "M2", precio: 28000, tipo: "SC", iu: "", omniclass: "" },
    blq: { codigo: "MT-04", descripcion: "Bloque No. 5", unidad: "UND", precio: 2100, tipo: "MT", iu: "", omniclass: "" },
    ofi: { codigo: "MO-01", descripcion: "Oficial", unidad: "HH", precio: 12000, tipo: "MO", iu: "", omniclass: "" },
    mez: { codigo: "MT-09", descripcion: "Mortero", unidad: "M3", precio: 400000, tipo: "MT", iu: "", omniclass: "" },
  },
  subpartidas: { sub1: { id: "sub1", descripcion: "Mortero de pega", unidad: "M3", rendimiento: 1, jornada: 8, componentes: [{ tipo: "insumo", id: "mez", cuadrilla: null, cantidad: 1 }, { tipo: "insumo", id: "ofi", cuadrilla: 1, cantidad: 0 }] } },
  gastos: { fijos: [], variables: [] },
} as unknown as PresupuestoDoc;

const contrato = (id: string, numero: number, lineas: Partial<ContratoCompras["lineas"][number]>[]): ContratoCompras => ({
  id, numero, revision: 0, proveedorId: `pv${numero}`, proveedor: `Proveedor ${numero}`, nit: "", anticipoPct: 0, retencionGarantiaPct: 0, aprobada: null,
  lineas: lineas.map((l) => ({ requisicionLineaId: "rl", insumoId: "", codigo: "", descripcion: "", unidad: "", tipo: "SC", cantidad: 1, precioUnitario: 1, descuentoPct: 0, ivaPct: 0, partidaItemId: null, ...l })),
});

// ---- the structure: Torre 1 > Piso 1, Piso 2; Torre 2 > Piso 1; zones
const nivel = (clave: string, nombre: string, orden: number, padreClave: string | null, fuente: Nivel["fuente"] = "manual", claveFuente = ""): Nivel => ({
  id: clave, projectId: null, clave, nombre, orden, padreClave, fuente, claveFuente, activo: true, version: 1,
});
const NIVELES = [nivel("torre", "Torre", 1, null), nivel("nivel", "Nivel", 5, "torre", "modelo", "Nivel"), nivel("zona", "Zona", 3, "torre", "modelo", "Zona")];
const nodo = (id: string, nivelClave: string, valor: string, padreId: string | null = null, estado: Nodo["estado"] = "activo"): Nodo => ({
  id, nivelClave, valor, padreId, responsableId: null, responsableNombre: "", inicio: null, fin: null, estado, nota: "", version: 1,
});
const NODOS = [nodo("t1", "torre", "Torre 1"), nodo("t2", "torre", "Torre 2"), nodo("t1p1", "nivel", "Piso 1", "t1"), nodo("t1p2", "nivel", "PISO 2", "t1"), nodo("t2p1", "nivel", "Piso 1", "t2"), nodo("viejo", "nivel", "Sótano", "t1", "inactivo")];
const COLUMNAS: ColumnaMemoria[] = [
  { id: "niv", label: "Nivel", fuente: "modelo", clave: "Nivel" },
  { id: "zon", label: "Zona", fuente: "modelo", clave: "Zona" },
  { id: "esp", label: "Espacio", fuente: "modelo", clave: "Espacio" },
];

const medicion = (id: string, elementos: [string, number][], extra: Partial<MedicionObra> = {}): MedicionObra => ({
  id, numero: 1, partidaId: "p11", partidaNumero: "1.1", partidaDescripcion: "", partidaUnidad: "M2", contratoId: null, contratoNumero: null, proveedor: "",
  ubicacion: {}, ubicacionTexto: "", fecha: "2026-10-15", origen: "modelo", cantidad: 0, estado: "registrada", observaciones: "", motivo: "", elaboradoPorId: "rosa", elaboradoPor: "Rosa",
  elementos: elementos.map(([ifcGuid, porcentaje]) => ({ modelId: "m1", versionId: null, ifcGuid, nombre: ifcGuid, porcentaje, cantidadModelo: 10, cantidad: cantidadElemento(porcentaje, 10) })),
  lineas: [], version: 1, creada: "", actualizado: null, actualizadoPor: null, ...extra,
});

describe("cantidades de una medición", () => {
  it("una línea de la memoria es veces × las dimensiones escritas (las vacías no cuentan)", () => {
    // The parapet of the acceptance test: 10 m × 1.50 m.
    assert.equal(cantidadLinea({ veces: 1, largo: 10, ancho: null, alto: 1.5 }), 15);
    assert.equal(cantidadLinea({ veces: -2, largo: 1.2, ancho: null, alto: 2.1 }), -5.04, "un vano se descuenta con veces negativo");
    assert.equal(cantidadLinea({ veces: 7, largo: null, ancho: null, alto: null }), 7, "solo veces: un conteo");
    assert.equal(cantidadLinea({ veces: 3, largo: 0.3333, ancho: 0.3333, alto: 1 }), 0.3333);
  });

  it("un elemento medido en parte da ese porcentaje de lo que dice el modelo, a 4 decimales", () => {
    assert.equal(cantidadElemento(50, 6.75), 3.375);
    assert.equal(cantidadElemento(100, 6.75), 6.75);
    assert.equal(cantidadElemento(33.3333, 10), 3.3333);
    assert.equal(cantidadMedicion({ origen: "modelo", elementos: [{ cantidad: 6.75 }, { cantidad: 3.375 }], lineas: [] }), 10.125);
    assert.equal(cantidadMedicion({ origen: "manual", elementos: [], lineas: [{ cantidad: 15 }, { cantidad: -5.04 }] }), 9.96);
    assert.equal(numeroMedicion(7), "MED-0007");
  });
});

describe("regla del 100 % por elemento y partida", () => {
  it("un muro se mide al 50 % y luego al 50 %, pero no un 60 % más", () => {
    const hechas = [medicion("a", [["muro1", 50], ["muro2", 100]])];
    const medido = medidoPorElemento(hechas, "p11");
    assert.deepEqual(superan100(medido, [{ ifcGuid: "muro1", nombre: "Muro 1", porcentaje: 50 }]), []);
    assert.deepEqual(superan100(medido, [{ ifcGuid: "muro1", nombre: "Muro 1", porcentaje: 60 }, { ifcGuid: "muro3", nombre: "Muro 3", porcentaje: 100 }]), [{ ifcGuid: "muro1", nombre: "Muro 1", total: 110 }]);
    assert.deepEqual(superan100(medido, [{ ifcGuid: "muro2", nombre: "Muro 2", porcentaje: 0.0001 }]).map((e) => e.total), [100.0001]);
  });

  it("el mismo elemento se paga en otra partida aparte (1.1 Muros y 2.1 Lavada de muro)", () => {
    const hechas = [medicion("a", [["muro1", 100]]), medicion("b", [["muro1", 100]], { partidaId: "p21" })];
    assert.equal(medidoPorElemento(hechas, "p11").get("muro1"), 100);
    assert.equal(medidoPorElemento(hechas, "p21").get("muro1"), 100);
  });

  it("lo anulado no cuenta, y al editar una medición no se cuenta a sí misma", () => {
    const hechas = [medicion("a", [["muro1", 100]], { estado: "anulada" }), medicion("b", [["muro2", 70]])];
    assert.equal(medidoPorElemento(hechas, "p11").get("muro1"), undefined);
    assert.equal(medidoPorElemento(hechas, "p11", "b").get("muro2"), undefined);
  });
});

describe("forma de una medición", () => {
  const base: CambioMedicion = { partidaId: "p11", contratoId: null, ubicacion: { torre: "t1" }, fecha: "2026-10-15", origen: "manual", observaciones: "", elementos: [], lineas: [{ descripcion: "Antepecho", veces: 1, largo: 10, ancho: null, alto: 1.5 }], version: 0 };
  it("revisa fecha, origen, porcentajes, repetidos y que la cantidad sea positiva", () => {
    assert.equal(revisarForma(base, "2026-10-21"), null);
    assert.match(revisarForma({ ...base, fecha: "2026-10-22" }, "2026-10-21")!, /futura/);
    assert.match(revisarForma({ ...base, lineas: [{ descripcion: "", veces: -1, largo: 2, ancho: null, alto: null }] }, "2026-10-21")!, /mayor que cero/);
    const modelo: CambioMedicion = { ...base, origen: "modelo", lineas: [], elementos: [{ modelId: "m1", versionId: null, ifcGuid: "g1", nombre: "Muro 1", porcentaje: 100 }] };
    assert.equal(revisarForma(modelo, "2026-10-21"), null);
    assert.match(revisarForma({ ...modelo, elementos: [{ ...modelo.elementos[0], porcentaje: 0 }] }, "2026-10-21")!, /Muro 1: el porcentaje/);
    assert.match(revisarForma({ ...modelo, elementos: [...modelo.elementos, ...modelo.elementos] }, "2026-10-21")!, /repetido/);
    assert.match(revisarForma({ ...modelo, elementos: [] }, "2026-10-21")!, /Selecciona/);
  });
});

describe("qué se mide: partidas del presupuesto y contratos de Compras", () => {
  it("cada partida trae su número, capítulo, cantidad contratada y los insumos que hace un contrato (también dentro de subpartidas)", () => {
    const metrados = new Map([["p21", { valor: 620, elementos: 30, campoLabel: "Área" }]]);
    const [muro, lavada] = partidasMedibles(doc, metrados);
    assert.deepEqual([muro.numero, muro.capitulo, muro.metrado, muro.inactiva], ["1.1", "MAMPOSTERÍA", 500, false]);
    assert.deepEqual(muro.insumosContrato.sort(), ["ofi", "sc03"], "el bloque y el mortero no se contratan por acta");
    assert.equal(lavada.metrado, 620, "metrado del modelo");
  });

  it("los contratos que pueden haber hecho una partida: con un insumo SC o MO de su APU, y no destinado a otra partida", () => {
    const muro = partidasMedibles(doc, new Map())[0];
    const contratos = contratosMedibles([
      contrato("ct1", 1, [{ insumoId: "sc03", partidaItemId: "p11" }]),
      contrato("ct2", 2, [{ insumoId: "sc03", partidaItemId: "otra" }]),
      contrato("ct3", 3, [{ insumoId: "blq", tipo: "MT" }]),
      contrato("ct4", 4, [{ insumoId: "ofi", tipo: "MO" }]),
    ]);
    assert.deepEqual(contratosDePartida(muro, contratos).map((c) => c.numero), [1, 4]);
  });
});

describe("ubicación de una medición", () => {
  it("se escribe en el orden de los niveles", () => {
    assert.equal(textoUbicacion({ nivel: "t1p2", torre: "t1" }, NIVELES, NODOS), "Torre 1 · PISO 2");
  });

  it("exige al menos un nivel, los obligatorios del proyecto, valores activos y que el piso sea de esa torre", () => {
    assert.match(revisarUbicacion({}, NIVELES, NODOS, [])!, /Indica la ubicación/);
    assert.equal(revisarUbicacion({ torre: "t1", nivel: "t1p2" }, NIVELES, NODOS, ["torre", "nivel"]), null);
    assert.match(revisarUbicacion({ torre: "t1" }, NIVELES, NODOS, ["torre", "nivel"])!, /debe indicar: Nivel/);
    assert.match(revisarUbicacion({ torre: "t2", nivel: "t1p2" }, NIVELES, NODOS, [])!, /Nivel: PISO 2 no pertenece a Torre 2/);
    assert.match(revisarUbicacion({ nivel: "viejo" }, NIVELES, NODOS, [])!, /Sótano está inactivo/);
    assert.match(revisarUbicacion({ torre: "t1p1" }, NIVELES, NODOS, [])!, /Torre: el valor elegido no existe/);
    assert.match(revisarUbicacion({ eje: "x" }, NIVELES, NODOS, [])!, /"eje" no existe/);
  });

  it("la memoria del elemento en Presupuesto sugiere la ubicación (columna ↔ nivel por propiedad o por nombre, valor sin tildes ni mayúsculas)", () => {
    assert.equal(nivelDeColumna(COLUMNAS[0], NIVELES)?.clave, "nivel");
    assert.equal(nivelDeColumna({ id: "x", label: "TORRE", fuente: "ifcguid", clave: "" }, NIVELES)?.clave, "torre", "por nombre");
    assert.equal(nivelDeColumna(COLUMNAS[2], NIVELES), null);
    assert.deepEqual(ubicacionDeMemoria({ niv: "Piso 2", esp: "Sala" }, COLUMNAS, NIVELES, NODOS), { nivel: "t1p2", torre: "t1" }, "PISO 2 solo está en la Torre 1");
    assert.deepEqual(ubicacionDeMemoria({ niv: "Piso 9" }, COLUMNAS, NIVELES, NODOS), {}, "un valor que no está en la estructura no se inventa");
    // "Piso 1" exists in both towers: without knowing the tower it isn't chosen; with it, it is.
    assert.deepEqual(ubicacionDeMemoria({ niv: "Piso 1" }, COLUMNAS, NIVELES, NODOS), {});
    const conTorre: ColumnaMemoria[] = [...COLUMNAS, { id: "tor", label: "Torre", fuente: "modelo", clave: "Torre" }];
    assert.deepEqual(ubicacionDeMemoria({ niv: "Piso 1", tor: "Torre 2" }, conTorre, NIVELES, NODOS), { torre: "t2", nivel: "t2p1" });
  });

  it("varios elementos: la ubicación común si coinciden; si no, cuántos hay en cada una", () => {
    const una = ubicacionComun([{ nivel: "t1p2" }, { nivel: "t1p2" }], NIVELES, NODOS);
    assert.deepEqual(una.comun, { nivel: "t1p2" });
    const dos = ubicacionComun([{ nivel: "t1p2" }, { nivel: "t1p1" }, { nivel: "t1p2" }, {}], NIVELES, NODOS);
    assert.equal(dos.comun, null);
    assert.deepEqual(dos.grupos, [{ texto: "PISO 2", elementos: 2 }, { texto: "Piso 1", elementos: 1 }, { texto: "(sin ubicación en el modelo)", elementos: 1 }]);
  });

  it("la EDT de la programación propone los valores de sus paquetes por ubicación, sin crear nada", () => {
    const programacion = {
      edt: [
        { id: "a", padre: null, nombre: "Piso 2", responsable: "", ubicacion: [{ columna: "niv", valor: "Piso 2" }] },
        { id: "b", padre: null, nombre: "Piso 3", responsable: "", ubicacion: [{ columna: "niv", valor: "PISO 3" }, { columna: "esp", valor: "Hall" }] },
        { id: "c", padre: null, nombre: "Sin dato", responsable: "", ubicacion: [{ columna: "niv", valor: "(sin dato)" }] },
      ],
    };
    const r = propuestasDesdeEdt(programacion, COLUMNAS, NIVELES, NODOS);
    assert.deepEqual(r.propuestas.map((p) => [p.nivelNombre, p.valor, p.existe]), [["Nivel", "Piso 2", true], ["Nivel", "PISO 3", false]]);
    assert.deepEqual(r.columnasSinNivel, ["Espacio"]);
  });
});
