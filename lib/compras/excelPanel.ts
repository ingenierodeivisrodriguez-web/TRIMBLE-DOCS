// The panel as an Excel workbook (ExcelJS, loaded on demand in the browser):
// the figures, each resource's state and the path of each resource stage by
// stage, with the documents of each record. Dates are real dates shown as
// DD-MM-AAAA; quantities with 4 decimals.
import type { Workbook, Worksheet } from "exceljs";
import { ESTADOS_DOCUMENTO } from "./documentos";
import { numeroCotizacion } from "./cotizaciones";
import { numeroOrden, ESTADOS_ORDEN } from "./ordenes";
import { ESTADOS_RECEPCION, numeroRecepcion } from "./recepciones";
import { ESTADOS_REQUISICION, numeroRequisicion } from "./requisiciones";
import { VIA_COMPRA } from "./types";
import type { DocumentoRuta, Indicador, PanelResponse } from "./types";

const PESOS = '"$" #,##0.00;[Red]-"$" #,##0.00';
const CANTIDAD = "#,##0.0000;[Red]-#,##0.0000";
const PCT = '0.00" %"';
const FECHA = "dd-mm-yyyy";
const FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF0A3D62" } };

const fecha = (iso: string | null): Date | null => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`) : null);

function encabezado(ws: Worksheet, titulos: string[], anchos: number[]) {
  ws.addRow(titulos);
  const row = ws.getRow(ws.rowCount);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = FILL;
  anchos.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: ws.rowCount }];
}

const docs = (d: DocumentoRuta[]) => d.map((x) => `${x.titulo} (${ESTADOS_DOCUMENTO[x.estado].texto.toLowerCase()})`).join("; ");

function valorIndicador(i: Indicador): { valor: number | string; formato?: string } {
  if (i.valor === null) return { valor: "Sin datos suficientes" };
  return { valor: i.valor, formato: i.unidad === "pct" ? PCT : i.unidad === "pesos" ? PESOS : i.unidad === "dias" ? '0.0" días"' : "0" };
}

/** Fills a workbook with the panel (separate from the download, so it can be tested). */
export function llenarLibro(wb: Workbook, p: PanelResponse, proyecto: string): void {
  const ind = wb.addWorksheet("Indicadores");
  ind.addRow([`Panel de compras · ${proyecto}`]).font = { bold: true, size: 13 };
  ind.addRow([`Corte: ${p.hoy.split("-").reverse().join("-")}${p.presupuesto ? ` · presupuesto versión ${p.presupuesto.version}` : ""}`]);
  ind.addRow([]);
  encabezado(ind, ["Indicador", "Valor", "Cómo se calcula"], [42, 22, 110]);
  for (const i of p.indicadores) {
    const v = valorIndicador(i);
    const row = ind.addRow([i.nombre, v.valor, i.ayuda]);
    if (v.formato) row.getCell(2).numFmt = v.formato;
  }

  const ins = wb.addWorksheet("Insumos");
  encabezado(
    ins,
    ["Código", "Insumo", "Und", "Tipo", "Se compra por", "Planificado", "Solicitado", "Aprobado", "Comprometido", "Recibido", "Rechazado", "Por solicitar", "Por recibir", "Precio presupuesto", "Monto planificado", "Valor comprometido (sin IVA)", "Comprometido a precio presupuesto"],
    [12, 40, 7, 6, 16, 14, 14, 14, 14, 14, 14, 14, 14, 16, 18, 22, 22]
  );
  for (const f of p.filas) {
    const row = ins.addRow([f.codigo, f.descripcion, f.unidad, f.tipo, VIA_COMPRA[f.via], f.planificado, f.solicitado, f.aprobado, f.comprometido, f.recibido, f.rechazado, f.porSolicitar, f.porRecibir, f.precio, f.montoPlanificado, f.valorComprometido, f.valorPresupuestoComprometido]);
    for (let c = 6; c <= 13; c++) row.getCell(c).numFmt = CANTIDAD;
    for (let c = 14; c <= 17; c++) row.getCell(c).numFmt = PESOS;
  }

  const tr = wb.addWorksheet("Trazabilidad");
  encabezado(tr, ["Código", "Insumo", "Etapa", "Registro", "Estado", "Fecha", "Proveedor", "Cantidad", "Precio neto (sin IVA)", "Detalle", "Documentos"], [12, 36, 16, 14, 16, 12, 30, 14, 18, 40, 60]);
  const insumo = new Map(p.filas.map((f) => [f.id, f]));
  for (const [id, rutas] of Object.entries(p.rutas)) {
    const f = insumo.get(id);
    const fila = (etapa: string, registro: string, estado: string, cuando: string | null, proveedor: string, cantidad: number | null, precio: number | null, detalle: string, d: DocumentoRuta[]) => {
      const row = tr.addRow([f?.codigo ?? "", f?.descripcion ?? id, etapa, registro, estado, fecha(cuando), proveedor, cantidad, precio, detalle, docs(d)]);
      row.getCell(6).numFmt = FECHA;
      row.getCell(8).numFmt = CANTIDAD;
      row.getCell(9).numFmt = PESOS;
    };
    for (const r of rutas) {
      const q = r.requisicion;
      fila("Requisición", numeroRequisicion(q.numero), ESTADOS_REQUISICION[q.estado].texto, q.creada, "", q.cantidad, null, `Pidió ${q.solicitante}${q.aprobada !== null ? `; aprobado ${q.aprobada}` : ""}`, r.documentos);
      for (const c of r.cotizaciones ?? []) fila("Cotización", numeroCotizacion(c.numero), c.estado === "anulada" ? "Anulada" : c.elegida ? "Elegida" : "Registrada", null, c.proveedor, c.cantidad, c.precioNeto, "", c.documentos);
      for (const o of r.ordenes ?? []) {
        fila(o.tipo === "contrato" ? "Contrato" : "Orden de compra", `${numeroOrden(o.tipo, o.numero)}${o.revision ? ` rev ${o.revision}` : ""}`, ESTADOS_ORDEN[o.estado].texto, o.fechaEntrega, o.proveedor, o.cantidad, o.precioNeto, `Entrega ${o.fechaEntrega.split("-").reverse().join("-")}`, o.documentos);
        for (const x of o.recepciones ?? []) {
          fila("Recepción", numeroRecepcion(x.numero), ESTADOS_RECEPCION[x.estado].texto, x.fecha, o.proveedor, x.aceptado, null, `Recibido ${x.recibido}, rechazado ${x.rechazado}, devuelto ${x.devuelto}`, x.documentos);
        }
      }
    }
  }
}

export async function descargarPanel(p: PanelResponse, proyecto: string): Promise<void> {
  const mod = (await import("exceljs")) as unknown as { default?: typeof import("exceljs") };
  const ExcelJS = (mod.default ?? mod) as typeof import("exceljs");
  const wb = new ExcelJS.Workbook();
  llenarLibro(wb, p, proyecto);
  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `Panel de compras - ${proyecto.replace(/[\\/:*?"<>|]/g, "-")} - ${p.hoy.split("-").reverse().join("-")}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
