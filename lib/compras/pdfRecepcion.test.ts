import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nombrePdfRecepcion, pdfRecepcion } from "./pdfRecepcion";
import type { OrdenPorRecibir, Recepcion } from "./types";

const recepcion: Recepcion = {
  id: "8a1b2c3d-0000-4000-8000-000000000001", numero: 3, ordenId: "o", estado: "aprobada", fecha: "2026-10-17", remision: "R-881", observaciones: "Llegó en dos viajes",
  elaboradoPorId: "luis", elaboradoPor: "Luis Pérez", motivo: "", enviada: null, aprobada: "2026-10-17T15:00:00Z", aprobadaPor: "Olga Ríos",
  lineas: [{ id: "l", requisicionLineaId: "rl", insumoId: "blq", codigo: "MT-04", descripcion: "BLOQUE No. 5", unidad: "UND", tipo: "MT", recibido: 320, aceptado: 300, rechazado: 20, devuelto: 20, motivo: "Rotos en el cargue" }],
  version: 3, creada: "2026-10-17T10:00:00Z", actualizado: null, actualizadoPor: null,
};
const orden: OrdenPorRecibir = {
  id: "o", tipo: "orden", numero: 1, revision: 0, estado: "aprobada", proveedor: "Ferretería A", nit: "890.903.938-8", fechaEntrega: "2026-10-28", lugarEntrega: "Obra",
  lineas: [{ requisicionLineaId: "rl", insumoId: "blq", codigo: "MT-04", descripcion: "BLOQUE No. 5", unidad: "UND", tipo: "MT", ordenado: 500, aceptado: 300, enTramite: 0, rechazado: 20, devuelto: 20, pendiente: 200 }],
};

describe("acta de recepción en PDF", () => {
  it("sale idéntica cada vez (así un reintento lleva la misma huella)", async () => {
    const a = new Uint8Array(await (await pdfRecepcion(recepcion, orden, "Torre Norte")).arrayBuffer());
    const b = new Uint8Array(await (await pdfRecepcion(recepcion, orden, "Torre Norte")).arrayBuffer());
    assert.ok(a.length > 1000);
    assert.deepEqual(a, b);
    assert.equal(nombrePdfRecepcion(recepcion), "Acta REC-0003.pdf");
  });
});
