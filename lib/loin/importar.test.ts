import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { entradasDyco, leerHojaParametros, planificarImportacion } from "./importar";
import { parametrosDyco } from "./semilla";
import type { Parametro } from "./types";

const guardados = (): Parametro[] => parametrosDyco().map((d, i) => ({ ...d, id: `id-${i}`, version: 1, actualizado: "", actualizadoPor: null }));

describe("importar parámetros", () => {
  it("lee la hoja del listado DYCO (título arriba, TDI-A, NDI-1, filas sin N°)", () => {
    const hoja = [
      ["1. Lista de parámetros DYCO"],
      [],
      ["N°", "TDI", "NDI", "Dato", "Parámetro", "Descripción"],
      [1, "TDI-A", "NDI-1", "A ingresar", "Codigo de proyecto", "Se refiere al código del proyecto"],
      ["—", "TDI-C", "NDI-2", "A ingresar", "Espacio", "Nombre descriptivo"],
      [2, "TDI-A", "NDI-1", "(sin definir)", "Constructor responsable", ""],
      [3, "TDI-X", "NDI-7", "Quizás", "Malo", ""],
      [null, null, null, null, null, null],
    ];
    const { entradas, errores } = leerHojaParametros(hoja);
    assert.equal(entradas.length, 3);
    assert.deepEqual(entradas[0].datos, { nombre: "Codigo de proyecto", numero: 1, tdi: "A", ndi: 1, origen: "a_ingresar", descripcion: "Se refiere al código del proyecto" });
    assert.equal(entradas[1].datos.numero, null);
    assert.equal(entradas[2].datos.origen, "por_definir");
    // Each wrong cell is told apart, and the row is left out.
    assert.deepEqual(
      errores.map((e) => e.split(":")[1].trim().split(" ").slice(0, 3).join(" ")),
      ["el NDI debe", "el Dato debe"]
    );
    assert.ok(errores.every((e) => e.startsWith('Fila 7 ("Malo")')));
    assert.deepEqual(entradas[0].columnas, ["numero", "tdi", "ndi", "origen", "nombre", "descripcion"]);
  });

  it("lee las columnas que agrega la app: tipo, valores, regla y equivalencias", () => {
    const hoja = [
      ["N°", "Parámetro", "Código", "Tipo de dato", "Valores permitidos", "Mínimo", "Máximo", "Patrón", "Equivalencias de lectura", "Activo"],
      [21, "Grosor", "DYCO-021", "Número", "", 0.08, 0.5, "", "Qto_SlabBaseQuantities.Width (sugerida); *.Grosor", "Sí"],
      [20, "Estado", "DYCO-020", "Lista de valores", "NUEVO; EXISTENTE", "", "", "", "", "No"],
    ];
    const { entradas, errores } = leerHojaParametros(hoja);
    assert.deepEqual(errores, []);
    assert.equal(entradas[0].datos.tipoDato, "numero");
    assert.deepEqual(entradas[0].datos.regla, { min: 0.08, max: 0.5, patron: "" });
    assert.equal(entradas[0].datos.alias?.[0].sugerida, true);
    assert.deepEqual(entradas[1].datos.valoresPermitidos, ["NUEVO", "EXISTENTE"]);
    assert.equal(entradas[1].datos.activo, false);
  });

  it("en un catálogo vacío todo el listado DYCO entra como nuevo", () => {
    const plan = planificarImportacion(entradasDyco(), []);
    assert.equal(plan.filas.length, 89);
    assert.ok(plan.filas.every((f) => f.tipo === "nuevo"));
    assert.deepEqual(plan.errores, []);
  });

  it("volver a cargar el listado no cambia nada; un parámetro distinto se muestra con sus diferencias", () => {
    const catalogo = guardados();
    assert.equal(planificarImportacion(entradasDyco(), catalogo).iguales, 89);

    catalogo[0] = { ...catalogo[0], ndi: 2, descripcion: "Cambiada a mano", alias: [] };
    const plan = planificarImportacion(entradasDyco(), catalogo);
    assert.equal(plan.filas.length, 1);
    assert.equal(plan.filas[0].tipo, "cambia");
    assert.deepEqual(
      plan.filas[0].diferencias.map((d) => [d.campo, d.antes, d.despues]),
      [
        ["ndi", "NDI-2", "NDI-1"],
        ["descripcion", "Cambiada a mano", "Se refiere al código del proyecto"],
      ]
    );
    // Only DYCO's own columns are applied: the aliases that were removed by hand stay removed.
    assert.deepEqual(plan.filas[0].datos.alias, []);
  });

  it("reconoce por código, luego por N° y luego por nombre; las columnas ausentes no borran nada", () => {
    const catalogo = guardados();
    const { entradas } = leerHojaParametros([
      ["N°", "Parámetro", "Descripción"],
      [18, "Capacidad de carga", "Nueva descripción"],
      [null, "Grosor", "Espesor de la losa"],
      [500, "Parámetro propio", "Uno nuevo"],
    ]);
    const plan = planificarImportacion(entradas, catalogo);
    const [carga, grosor, nuevo] = plan.filas;
    assert.equal(carga.existente?.codigo, "DYCO-018");
    assert.ok(carga.datos.alias.some((a) => a.propiedad === "LoadBearing"));
    assert.equal(grosor.existente?.codigo, "DYCO-021");
    assert.equal(nuevo.tipo, "nuevo");
    assert.equal(nuevo.datos.codigo, "DYCO-500");
    assert.deepEqual(nuevo.datos.alias, [{ grupo: "*", propiedad: "Parámetro propio", sugerida: false }]);
  });

  it("una fila repetida o un código ajeno es un error y no se guarda", () => {
    const catalogo = guardados();
    const { entradas } = leerHojaParametros([
      ["Código", "Parámetro"],
      ["DYCO-001", "Código de proyecto (otra vez)"],
      ["DYCO-001", "Repetido"],
      ["X-1", "Nuevo uno"],
      ["X-1", "Nuevo dos"],
    ]);
    const plan = planificarImportacion(entradas, catalogo);
    assert.deepEqual(plan.filas.map((f) => [f.tipo, f.datos.codigo, f.datos.nombre]), [
      ["cambia", "DYCO-001", "Código de proyecto (otra vez)"],
      ["nuevo", "X-1", "Nuevo uno"],
    ]);
    assert.equal(plan.errores.length, 2);
    assert.match(plan.errores[0], /repetido en el archivo/);
    assert.match(plan.errores[1], /ya lo usa otro parámetro/);
  });
});
