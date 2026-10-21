import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  camposDeModelos,
  valoresFrecuentes,
  claseBase,
  clasificar,
  cumpleCondicion,
  cumpleRegla,
  ModeloLeido,
  ObjetoModelo,
  objetoDesdeRaw,
  probarRegla,
  reglaDesdeClase,
  resumenSinClasificar,
  textoRegla,
  valorCampo,
} from "./clasificacion";
import type { Disciplina, Elemento, ReglaAsociacion } from "./types";

const objeto = (runtimeId: number, clase: string, extra: Partial<ObjetoModelo> = {}, grupos: Record<string, Record<string, unknown>> = {}): ObjetoModelo => ({
  runtimeId,
  ifcGuid: `${String(runtimeId).padStart(2, "0")}aaaaaaaaaaaaaaaaaaaa`,
  clase,
  nombre: "",
  tipo: "",
  descripcion: "",
  props: { grupos: Object.entries(grupos).map(([nombre, ps]) => ({ nombre, propiedades: Object.entries(ps).map(([n, valor]) => ({ nombre: n, valor })) })), atributos: {} },
  ...extra,
});
const disc = (id: string, orden: number, activo = true): Disciplina => ({ id, codigo: id.toUpperCase(), nombre: id, color: "#000000", orden, activo, version: 1, actualizado: "", actualizadoPor: null });
const elemento = (id: string, disciplinaId: string, regla: ReglaAsociacion | null, extra: Partial<Elemento> = {}): Elemento => ({
  id, disciplinaId, codigo: id.toUpperCase(), nombre: id, claseIfc: "", tipoPredefinido: "", clasificacionSistema: "", clasificacionCodigo: "", notas: "",
  parametros: [], regla, orden: 0, activo: true, version: 1, actualizado: "", actualizadoPor: null, ...extra,
});
const regla = (modo: "todas" | "alguna", ...condiciones: [string, ReglaAsociacion["condiciones"][number]["operador"], string][]): ReglaAsociacion => ({
  modo,
  condiciones: condiciones.map(([campo, operador, valor]) => ({ campo, operador, valor })),
});

describe("reglas de asociación", () => {
  const losa = objeto(1, "IFCSLABSTANDARDCASE", { nombre: "Losa maciza:LOSA 12 cm", tipo: "LOSA 12 cm" }, { Restricciones: { Nivel: "Piso 2" }, Pset_SlabCommon: { LoadBearing: true } });

  it("la clase IFC compara sin mayúsculas y un subtipo escrito completo cuenta como su clase", () => {
    assert.equal(claseBase("IfcWallStandardCase"), "ifcwall");
    assert.ok(cumpleCondicion(losa, { campo: "@clase", operador: "igual", valor: "IfcSlab" }));
    assert.ok(!cumpleCondicion(losa, { campo: "@clase", operador: "igual", valor: "IfcSlabs" }));
  });

  it("nombre, tipo, nivel y propiedades con contiene, empieza, distinto, existe…", () => {
    assert.ok(cumpleCondicion(losa, { campo: "@tipo", operador: "contiene", valor: "losa" }));
    assert.ok(cumpleCondicion(losa, { campo: "@nombre", operador: "empieza", valor: "Losa maciza" }));
    assert.ok(!cumpleCondicion(losa, { campo: "@nombre", operador: "contiene", valor: "" }));
    assert.equal(valorCampo(losa, "@nivel"), "Piso 2");
    assert.ok(cumpleCondicion(losa, { campo: "@nivel", operador: "igual", valor: "piso 2" }));
    assert.ok(cumpleCondicion(losa, { campo: "Pset_*Common.LoadBearing", operador: "existe", valor: "" }));
    assert.ok(cumpleCondicion(losa, { campo: "*.Material", operador: "no_existe", valor: "" }));
    assert.ok(cumpleCondicion(losa, { campo: "@tipo", operador: "distinto", valor: "LOSA 15 cm" }));
    assert.ok(cumpleCondicion(losa, { campo: "@tipo", operador: "no_contiene", valor: "aligerada" }));
  });

  it("Y exige todas las condiciones, O alguna; sin condiciones no toma nada", () => {
    assert.ok(cumpleRegla(losa, regla("todas", ["@clase", "igual", "IfcSlab"], ["@tipo", "contiene", "LOSA"])));
    assert.ok(!cumpleRegla(losa, regla("todas", ["@clase", "igual", "IfcSlab"], ["@tipo", "contiene", "RAMPA"])));
    assert.ok(cumpleRegla(losa, regla("alguna", ["@clase", "igual", "IfcBeam"], ["@tipo", "contiene", "LOSA"])));
    assert.ok(!cumpleRegla(losa, { modo: "todas", condiciones: [] }));
    assert.ok(!cumpleRegla(losa, null));
    assert.equal(textoRegla(regla("todas", ["@clase", "igual", "IfcSlab"], ["@tipo", "contiene", "LOSA"])), 'Clase IFC es "IfcSlab" y Tipo contiene "LOSA"');
    assert.equal(textoRegla(regla("alguna", ["*.Material", "existe", ""])), "*.Material tiene valor");
    assert.equal(textoRegla(null), "Sin regla");
    assert.deepEqual(reglaDesdeClase("IfcWall"), regla("todas", ["@clase", "igual", "IfcWall"]));
    assert.equal(reglaDesdeClase(""), null);
  });

  it("lee el objeto del visor con su IFCGUID: la propiedad IfcGUID gana sobre el id externo", () => {
    const raw = { id: 7, class: "IfcWall", product: { name: "Muro 1", objectType: "Muro básico" }, properties: [{ name: "Datos de identidad", properties: [{ name: "IfcGUID", value: "3CqVfw$t15ihB2vPgB1wri", type: 5 }] }] };
    const o = objetoDesdeRaw(raw, null);
    assert.deepEqual([o.runtimeId, o.ifcGuid, o.clase, o.nombre, o.tipo], [7, "3CqVfw$t15ihB2vPgB1wri", "IfcWall", "Muro 1", "Muro básico"]);
    assert.equal(o.props.atributos.Name, "Muro 1");
    assert.equal(objetoDesdeRaw({ id: 8, class: "IfcDoor" }, "e9ae8a6f-0000-4000-8000-000000000001").ifcGuid?.length, 22);
    assert.equal(objetoDesdeRaw({ id: 9 }, "handle-123").ifcGuid, null);
  });
});

describe("clasificar los objetos de los modelos", () => {
  const disciplinas = [disc("arq", 1), disc("est", 2), disc("vieja", 3, false)];
  const elementos = [
    elemento("muro", "arq", regla("todas", ["@clase", "igual", "IfcWall"]), { orden: 1 }),
    elemento("muroCortina", "arq", regla("todas", ["@clase", "igual", "IfcWall"], ["@tipo", "contiene", "cortina"]), { orden: 2 }),
    elemento("losa", "est", regla("todas", ["@clase", "igual", "IfcSlab"])),
    elemento("columna", "est", regla("todas", ["@clase", "igual", "IfcColumn"]), { activo: false }),
    elemento("proyecto", "arq", regla("todas", ["@clase", "igual", "IfcProject"]), { orden: 0 }),
  ];
  const arq: ModeloLeido = {
    fileId: "f-arq",
    nombre: "ARQ.ifc",
    viewerModelId: "v-arq",
    objetos: [
      objeto(1, "IfcProject"),
      objeto(2, "IfcBuildingStorey"),
      objeto(3, "IfcWall", { tipo: "Muro cortina" }),
      objeto(4, "IfcWallStandardCase"),
      objeto(5, "IfcSlab"),
      objeto(6, "IfcFurniture", { tipo: "Silla" }),
      objeto(7, "IfcFurniture", { tipo: "Silla", ifcGuid: null }),
      objeto(8, "IfcColumn"),
    ],
  };
  const sinDisciplina: ModeloLeido = { fileId: "f-x", nombre: "Coordinación.ifc", viewerModelId: "v-x", objetos: [objeto(1, "IfcWall")] };

  it("la asociación manual gana, luego la primera regla en orden; los contenedores no cuentan y los modelos sin disciplina se avisan", () => {
    const manuales = new Map([[arq.objetos[4].ifcGuid!, "muro"]]); // the slab, by hand, is a "muro"
    const r = clasificar([arq, sinDisciplina], new Map([["f-arq", ["arq"]]]), disciplinas, elementos, manuales);
    assert.deepEqual(r.porObjeto.get("f-arq:1"), { elementoId: "proyecto", origen: "regla", tambien: [] });
    assert.deepEqual(r.porObjeto.get("f-arq:3"), { elementoId: "muro", origen: "regla", tambien: ["muroCortina"] });
    assert.equal(r.porObjeto.get("f-arq:4")?.elementoId, "muro");
    assert.deepEqual(r.porObjeto.get("f-arq:5"), { elementoId: "muro", origen: "manual", tambien: [] });
    assert.equal(r.ambiguos, 1);
    assert.equal(r.ignorados, 1); // the storey
    // Furniture has no rule, the column's element is inactive and the slab's discipline isn't this model's.
    assert.deepEqual(r.sinClasificar.map((s) => s.objeto.runtimeId), [6, 7, 8]);
    assert.equal(r.sinGuid, 1);
    assert.deepEqual(r.porElemento.get("muro"), { regla: 2, manual: 1 });
    assert.deepEqual(r.modelosSinDisciplina, ["Coordinación.ifc"]);
    assert.deepEqual(resumenSinClasificar(r.sinClasificar), [
      { clase: "IfcFurniture", tipo: "Silla", cantidad: 2 },
      { clase: "IfcColumn", tipo: "(sin tipo)", cantidad: 1 },
    ]);
  });

  it("un modelo de varias disciplinas se compara con los elementos de todas", () => {
    const r = clasificar([arq], new Map([["f-arq", ["arq", "est", "vieja"]]]), disciplinas, elementos, new Map());
    assert.equal(r.porObjeto.get("f-arq:5")?.elementoId, "losa");
  });

  it("los nombres de propiedades y los valores más comunes salen de lo leído", () => {
    const m: ModeloLeido = {
      fileId: "f", nombre: "M", viewerModelId: "v",
      objetos: [
        objeto(1, "IfcWall", { tipo: "Muro 15" }, { "Datos de identidad": { Marca: "M1", Comentarios: "" }, Pset_WallCommon: { LoadBearing: true } }),
        objeto(2, "IfcWall", { tipo: "Muro 15" }, { "Datos de identidad": { Marca: "M2" } }),
        objeto(3, "IfcWall", { tipo: "Muro 20" }),
      ],
    };
    assert.deepEqual(camposDeModelos([m]), [
      { grupo: "Datos de identidad", propiedad: "Marca", cuenta: 2 },
      { grupo: "Datos de identidad", propiedad: "Comentarios", cuenta: 1 },
      { grupo: "Pset_WallCommon", propiedad: "LoadBearing", cuenta: 1 },
    ]);
    assert.deepEqual(valoresFrecuentes([m], "@tipo"), [{ valor: "Muro 15", cuenta: 2 }, { valor: "Muro 20", cuenta: 1 }]);
  });

  it("Probar regla devuelve los objetos que toma, por modelo", () => {
    const p = probarRegla([arq, sinDisciplina], regla("todas", ["@clase", "igual", "IfcWall"]));
    assert.deepEqual(p.map((x) => [x.viewerModelId, x.objetos.map((o) => o.runtimeId)]), [["v-arq", [3, 4]], ["v-x", [1]]]);
  });
});
