import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DatosMatriz, libroMatriz, pdfMatriz } from "./exportarMatriz";
import { COLOR_LOD, indiceCeldas, SIN_REQUERIMIENTO } from "./matriz";
import { parametrosDyco } from "./semilla";
import type { CeldaMatriz, Disciplina, Elemento, Etapa, Parametro } from "./types";

const catalogo: Parametro[] = parametrosDyco()
  .slice(14, 20)
  .map((d, i) => ({ ...d, id: `p${i}`, version: 1, actualizado: "", actualizadoPor: null }));
const disciplina: Disciplina = { id: "arq", codigo: "ARQ", nombre: "Arquitectura", color: "#2a78d6", orden: 1, activo: true, version: 1, actualizado: "", actualizadoPor: null };
const muro: Elemento = {
  id: "m", disciplinaId: "arq", codigo: "MUR", nombre: "Muro", claseIfc: "IfcWall", tipoPredefinido: "", clasificacionSistema: "", clasificacionCodigo: "", notas: "",
  parametros: catalogo.map((p) => ({ parametroId: p.id, obligatorio: true, ndi: null, regla: null })), regla: null, orden: 1, activo: true, version: 1, actualizado: "", actualizadoPor: null,
};
const puerta: Elemento = { ...muro, id: "p", codigo: "PUE", nombre: "Puerta", claseIfc: "IfcDoor", parametros: [] };
const etapas: Etapa[] = [
  { id: "e1", codigo: "ANT", nombre: "Anteproyecto", fecha: "2026-11-30", orden: 1, activo: true, version: 1, actualizado: "", actualizadoPor: null },
  { id: "e2", codigo: "CON", nombre: "Construcción", fecha: null, orden: 2, activo: true, version: 1, actualizado: "", actualizadoPor: null },
];
const celda = (elementoId: string, etapaId: string, extra: Partial<CeldaMatriz>): CeldaMatriz => ({
  ...SIN_REQUERIMIENTO, id: `${elementoId}${etapaId}`, elementoId, etapaId, version: 1, actualizado: "", actualizadoPor: null, ...extra,
});
const datos: DatosMatriz = {
  proyecto: "Torre Norte",
  grupos: [{ disciplina, elementos: [muro, puerta] }],
  etapas,
  celdas: indiceCeldas([celda("m", "e1", { lod: 200, ndi: 1, propositos: ["Coordinación"], actor: "Arquitecto" }), celda("m", "e2", { lod: 350, ndi: 2 })]),
  catalogo: new Map(catalogo.map((p) => [p.id, p])),
  emitida: "21-10-2026",
};

describe("exportar la matriz LOIN", () => {
  it("el Excel trae la matriz con colores, el detalle por celda, la información exigida y las etapas", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await libroMatriz(datos));
    assert.deepEqual(wb.worksheets.map((w) => w.name), ["Matriz LOIN", "Detalle por celda", "Información exigida", "Etapas"]);
    const m = wb.getWorksheet("Matriz LOIN")!;
    assert.deepEqual((m.getRow(4).values as unknown[]).slice(1), ["Disciplina", "Código", "Elemento", "Clase IFC", "Anteproyecto\n30-11-2026", "Construcción"]);
    const filaMuro = m.getRow(6);
    assert.equal(filaMuro.getCell(5).value, "LOD 200 · NDI-1");
    assert.equal(filaMuro.getCell(6).value, "LOD 350 · NDI-2");
    assert.equal((filaMuro.getCell(6).fill as { fgColor: { argb: string } }).fgColor.argb, `FF${COLOR_LOD[350].fondo.slice(1).toUpperCase()}`);
    assert.equal(m.getRow(7).getCell(5).value, "—");
    const det = wb.getWorksheet("Detalle por celda")!;
    assert.equal(det.rowCount, 3);
    assert.deepEqual((det.getRow(2).values as unknown[]).slice(5, 11), ["Anteproyecto", "30-11-2026", 200, "NDI-1", "Coordinación", "Arquitecto"]);
    // NDI-1 at the first stage: the NDI-1 parameters (all six of the slice are NDI-1); NDI-2 at the second: the same six.
    assert.equal(wb.getWorksheet("Información exigida")!.rowCount, 1 + 6 + 6);
    assert.equal(wb.getWorksheet("Etapas")!.getRow(3).getCell(4).value, "");
  });

  it("el PDF sale como documento horizontal", async () => {
    const pdf = new Uint8Array(await pdfMatriz(datos));
    assert.equal(String.fromCharCode(...pdf.slice(0, 5)), "%PDF-");
    assert.ok(pdf.length > 2000);
  });
});
