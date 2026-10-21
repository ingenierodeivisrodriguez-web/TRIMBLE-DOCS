import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { libroAuditoria, pdfAuditoria } from "./exportarAuditoria";
import type { InformeAuditoria, Totales } from "./types";

const t = (objetos: number, cumple: number, parcial: number, noCumple: number, exigidos: number, cumplidos: number, pct: number): Totales => ({ objetos, cumple, parcial, noCumple, exigidos, cumplidos, pct });
const informe: InformeAuditoria = {
  proyecto: "Torre Norte",
  etapa: { id: "e", codigo: "PRO", nombre: "Proyecto", fecha: "2027-03-15" },
  modelos: [{ fileId: "f", nombre: "ARQ.ifc", versionId: "v-7" }],
  umbralAmarillo: 50,
  valoresBasura: ["N/A"],
  disciplinas: [{ id: "arq", codigo: "ARQ", nombre: "Arquitectura", color: "#2a78d6", totales: t(3, 1, 1, 1, 9, 5, 55.6) }],
  elementos: [{ id: "muro", codigo: "MUR", nombre: "Muro", disciplinaId: "arq", ndi: 2, lod: 300, totales: t(3, 1, 1, 1, 9, 5, 55.6), exigidos: [{ codigo: "ANCHO", obligatorio: true }] }],
  total: t(3, 1, 1, 1, 9, 5, 55.6),
  parametros: { ANCHO: "Ancho", CARGA: "Capacidad de carga" },
  masIncumplidos: [{ codigo: "CARGA", nombre: "Capacidad de carga", fallas: 2, porMotivo: { falta: 0, modelado: 0, sin_llenar: 1, valor: 1 } }],
  porMotivo: { falta: 0, modelado: 1, sin_llenar: 2, valor: 1 },
  aceptados: 1,
  sinClasificar: 1,
  sinExigencia: 0,
  sinGuid: 0,
  elementosSinObjetos: ["LOS · Losa"],
  objetos: [
    { elementoId: "muro", ifcGuid: "1aaaaaaaaaaaaaaaaaaaaa", nombre: "Muro 1", modelo: "ARQ.ifc", exigidos: 3, cumplidos: 3, pct: 100, estado: "cumple", fallas: [] },
    {
      elementoId: "muro", ifcGuid: "2aaaaaaaaaaaaaaaaaaaaa", nombre: "Muro 2", modelo: "ARQ.ifc", exigidos: 3, cumplidos: 0, pct: 0, estado: "no_cumple",
      fallas: [{ codigo: "ANCHO", motivo: "modelado", obligatorio: true }, { codigo: "CARGA", motivo: "sin_llenar", obligatorio: true }, { codigo: "MAT", motivo: "falta", obligatorio: false }],
    },
  ],
  objetosSinClasificar: [{ ifcGuid: "3aaaaaaaaaaaaaaaaaaaaa", nombre: "Silla", clase: "IfcFurniture", tipo: "Silla", modelo: "ARQ.ifc" }],
};

describe("informes de la auditoría", () => {
  it("el Excel trae resumen, detalle por objeto con lo que falta, más incumplidos y sin clasificar", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await libroAuditoria(informe, "21-10-2026"));
    assert.deepEqual(wb.worksheets.map((w) => w.name), ["Resumen", "Detalle por objeto", "Más incumplidos", "Sin clasificar"]);
    const det = wb.getWorksheet("Detalle por objeto")!;
    const fila = det.getRow(3);
    assert.equal(fila.getCell(6).value, "✗ No cumple");
    assert.equal(fila.getCell(10).value, "ANCHO Ancho (problema de modelado); CARGA Capacidad de carga (sin llenar)");
    assert.equal(fila.getCell(11).value, "MAT  (no existe en el objeto)");
    assert.equal((fila.getCell(6).fill as { fgColor: { argb: string } }).fgColor.argb, "FFD03B3B");
    assert.equal(wb.getWorksheet("Sin clasificar")!.getRow(2).getCell(3).value, "IfcFurniture");
    assert.equal(wb.getWorksheet("Resumen")!.getRow(7).getCell(8).value, 0.556);
  });

  it("el PDF sale, también sin imágenes", async () => {
    const pdf = new Uint8Array(await pdfAuditoria(informe, new Map(), "21-10-2026"));
    assert.equal(String.fromCharCode(...pdf.slice(0, 5)), "%PDF-");
    assert.ok(pdf.length > 2000);
  });
});
