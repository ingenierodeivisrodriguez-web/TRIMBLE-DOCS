import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { libroCatalogo, leerLibroParametros } from "./excel";
import { leerHojaParametros, planificarImportacion } from "./importar";
import { NDI_INICIALES, parametrosDyco, TDI_INICIALES } from "./semilla";
import type { Parametro } from "./types";

describe("catálogo en Excel", () => {
  it("lo exportado se vuelve a importar sin diferencias (ida y vuelta)", async () => {
    const catalogo: Parametro[] = parametrosDyco().map((d, i) => ({ ...d, id: `id-${i}`, version: 1, actualizado: "", actualizadoPor: null }));
    catalogo[20] = { ...catalogo[20], regla: { min: 0.08, max: 0.5, patron: "" } };
    const hoja = await leerLibroParametros(await libroCatalogo(catalogo, TDI_INICIALES, NDI_INICIALES));
    assert.ok(hoja);
    assert.deepEqual(hoja[0].slice(0, 6), ["N°", "TDI", "NDI", "Dato", "Parámetro", "Descripción"]);
    const { entradas, errores } = leerHojaParametros(hoja);
    assert.deepEqual(errores, []);
    assert.equal(entradas.length, 89);
    const plan = planificarImportacion(entradas, catalogo);
    assert.deepEqual([plan.filas.length, plan.iguales, plan.errores.length], [0, 89, 0]);
  });

  it("trae los niveles NDI del catálogo en su propia hoja, como los grupos TDI", async () => {
    const mod = (await import("exceljs")) as unknown as { default?: typeof import("exceljs") };
    const ExcelJS = (mod.default ?? mod) as typeof import("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await libroCatalogo([], TDI_INICIALES, [{ numero: 1, nombre: "" }, { numero: 4, nombre: "Operación" }]));
    const hoja = wb.getWorksheet("Niveles NDI")!;
    assert.deepEqual((hoja.getRow(3).values as unknown[]).slice(1), ["NDI-4", "Operación"]);
  });
});
