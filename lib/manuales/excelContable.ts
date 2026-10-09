// The statement as an Excel workbook for the accountant (ExcelJS, loaded on
// demand in the browser): summary, month by month, the ledger of movements
// and the payments to review. Dates are real dates shown as DD-MM-AAAA.
import type { Worksheet } from "exceljs";
import { EstadoDeCuenta, etiquetaTipo, FilaMes } from "./contabilidad";
import { fechaVisible } from "./licencia";
import { NOMBRE_PASARELA } from "./pasarelas";
import { etiquetaMedio, etiquetaMeses } from "./textos";

const PESOS = '"$" #,##0;[Red]-"$" #,##0';
const FECHA = "dd-mm-yyyy";
const FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF0A3D62" } };

function fecha(iso: string | null): Date | null {
  return iso ? new Date(`${iso}T00:00:00Z`) : null;
}

function encabezado(ws: Worksheet, titulos: string[], anchos: number[]) {
  ws.addRow(titulos);
  const row = ws.getRow(ws.rowCount);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = FILL;
  anchos.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: ws.rowCount }];
}

export async function descargarEstado(e: EstadoDeCuenta, meses: FilaMes[], titulo: string, nombre: string) {
  const mod = (await import("exceljs")) as unknown as { default?: typeof import("exceljs") };
  const ExcelJS = (mod.default ?? mod) as typeof import("exceljs");
  const wb = new ExcelJS.Workbook();

  const r = wb.addWorksheet("Resumen");
  r.getColumn(1).width = 46;
  r.getColumn(2).width = 18;
  r.addRow([titulo]).font = { bold: true, size: 14 };
  r.addRow([`Período: ${fechaVisible(e.desde)} a ${fechaVisible(e.hasta)} · valores brutos en COP, antes de comisiones y retenciones de las pasarelas`]);
  r.addRow([]);
  const filas: [string, number, boolean?][] = [
    ["RECAUDO (caja)", NaN, true],
    [`Ventas aprobadas (${e.ventas})${e.cortesias ? ` · ${e.cortesias} cortesía(s) en $ 0` : ""}`, e.bruto],
    [`Reembolsos (${e.reembolsosCantidad})`, -e.reembolsos],
    ["Recaudo neto", e.neto, true],
    ["Ticket promedio", e.ticketPromedio],
    ["", NaN],
    ["INGRESOS (devengo por término de la licencia)", NaN, true],
    ["Ingreso diferido al inicio del período", e.diferidoInicial],
    ["(+) Ventas del período no reembolsadas", e.recaudoNoReembolsado],
    ["(−) Ingreso devengado en el período", -e.devengado],
    ["Ingreso diferido al cierre del período", e.diferidoFinal, true],
  ];
  for (const [texto, valor, negrita] of filas) {
    const row = r.addRow(Number.isNaN(valor) ? [texto] : [texto, valor]);
    if (negrita) row.font = { bold: true };
    row.getCell(2).numFmt = PESOS;
  }
  r.addRow([]);
  r.addRow(["POR PASARELA", "Neto"]).font = { bold: true };
  for (const p of e.porPasarela) r.addRow([`${NOMBRE_PASARELA[p.pasarela]} (${p.ventas} ventas)`, p.neto]).getCell(2).numFmt = PESOS;
  r.addRow([]);
  r.addRow(["POR PLAN", "Neto"]).font = { bold: true };
  for (const p of e.porPlan) r.addRow([`${etiquetaMeses(p.meses)} (${p.ventas} ventas)`, p.neto]).getCell(2).numFmt = PESOS;

  if (meses.length) {
    const m = wb.addWorksheet("Por mes");
    encabezado(m, ["Mes", "Ventas", "Recaudo bruto", "Reembolsos", "Recaudo neto", "Ingreso devengado", "Diferido al cierre"], [12, 10, 16, 14, 16, 18, 18]);
    for (const f of meses) {
      const row = m.addRow([f.mes, f.ventas, f.bruto, -f.reembolsos, f.neto, f.devengado, f.diferido]);
      for (let c = 3; c <= 7; c++) row.getCell(c).numFmt = PESOS;
    }
  }

  const mv = wb.addWorksheet("Movimientos");
  encabezado(
    mv,
    ["Fecha", "Tipo", "Comprador", "Correo", "Plan", "Pasarela", "Id del pago", "Compra", "Valor", "Licencia desde", "Licencia hasta"],
    [12, 11, 24, 30, 10, 14, 24, 24, 14, 14, 14]
  );
  for (const x of e.movimientos) {
    const row = mv.addRow([
      fecha(x.fecha),
      etiquetaTipo(x),
      x.nombre,
      x.email,
      etiquetaMeses(x.meses),
      x.pasarela === "manual" ? `Manual · ${etiquetaMedio(x.medio)}` : NOMBRE_PASARELA[x.pasarela],
      x.pagoId ?? "",
      x.orden,
      x.valor,
      fecha(x.desde),
      fecha(x.hasta),
    ]);
    for (const c of [1, 10, 11]) row.getCell(c).numFmt = FECHA;
    row.getCell(9).numFmt = PESOS;
  }

  if (e.porRevisar.length) {
    const rv = wb.addWorksheet("Por revisar");
    encabezado(rv, ["Fecha de pago", "Comprador", "Correo", "Pasarela", "Id del pago", "Valor de la compra", "Nota"], [14, 24, 30, 14, 24, 18, 60]);
    for (const o of e.porRevisar) {
      const row = rv.addRow([o.pagada ? new Date(o.pagada) : null, o.nombre, o.email, NOMBRE_PASARELA[o.pasarela], o.pagoId ?? "", o.monto, o.nota ?? ""]);
      row.getCell(1).numFmt = FECHA;
      row.getCell(6).numFmt = PESOS;
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
