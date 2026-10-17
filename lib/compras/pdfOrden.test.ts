import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nombrePdfOrden, pdfOrden } from "./pdfOrden";
import type { Orden } from "./types";

const orden: Orden = {
  id: "7a1b2c3d-0000-4000-8000-000000000001", tipo: "orden", numero: 7, requisicionId: "r", cotizacionId: "q", proveedorId: "p", estado: "aprobada", revision: 1,
  elaboradoPorId: "pedro", elaboradoPor: "Pedro Rojas", motivo: "", enviada: null, aprobada: "2026-10-16T15:00:00Z", aprobadaPor: "Jorge Ruiz",
  lineas: [{ id: "l", requisicionLineaId: "rl", insumoId: "blq", codigo: "MT-04", descripcion: "BLOQUE No. 5", unidad: "UND", tipo: "MT", cantidad: 3000, precioUnitario: 1950, descuentoPct: 0, ivaPct: 19 }],
  version: 7, creada: "2026-10-15T10:00:00Z", actualizado: null, actualizadoPor: null,
  fechaEntrega: "2026-10-26", lugarEntrega: "Obra", formaPago: "Crédito 30 días", diasPago: 30, anticipoPct: 10, retencionGarantiaPct: 0, objeto: "", polizas: "", observaciones: "",
};

describe("PDF de la orden", () => {
  it("sale idéntico cada vez (así un reintento lleva la misma huella)", async () => {
    const a = new Uint8Array(await (await pdfOrden(orden, undefined, undefined, "Torre Norte")).arrayBuffer());
    const b = new Uint8Array(await (await pdfOrden(orden, undefined, undefined, "Torre Norte")).arrayBuffer());
    assert.ok(a.length > 1000);
    assert.deepEqual(a, b);
    assert.equal(nombrePdfOrden(orden), "OC-0007 rev 1.pdf");
  });
});
