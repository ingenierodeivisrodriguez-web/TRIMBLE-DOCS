import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detalleEntrada, fecha, fechaHora, nombrePermiso } from "./formato";
import type { EntradaAuditoria } from "./types";

const entrada = (e: Partial<EntradaAuditoria>): EntradaAuditoria => ({
  id: 1, creado: "2026-10-16T19:05:00Z", actorId: "ana", actorNombre: "Ana", accion: "", modulo: "accesos",
  objetoTipo: "", objetoId: "", sujetoId: null, sujetoNombre: "", resultado: "ok", detalle: {}, ...e,
});

describe("formato de Compras", () => {
  it("las fechas se ven DD-MM-AAAA y la hora es la de Colombia", () => {
    assert.equal(fecha("2026-10-16"), "16-10-2026");
    assert.equal(fecha(null), "");
    assert.equal(fechaHora("2026-10-16T19:05:00Z"), "16-10-2026 14:05");
    assert.equal(fechaHora("2026-10-17T02:30:00Z"), "16-10-2026 21:30");
  });

  it("los permisos se nombran con palabras de la herramienta", () => {
    assert.equal(nombrePermiso("requisiciones.aprobar"), "Requisiciones: Aprobar / rechazar");
  });

  it("la auditoría dice qué cambió y por qué se negó", () => {
    assert.equal(
      detalleEntrada(entrada({ accion: "accesos.cambiar", detalle: { antes: { rol: "Residente", desde: "2026-01-01", hasta: null, activo: true }, despues: { rol: "Director", desde: "2026-01-01", hasta: "2026-12-31", activo: true } } })),
      "Residente, desde 01-01-2026, sin fecha final → Director, desde 01-01-2026, hasta 31-12-2026"
    );
    assert.equal(detalleEntrada(entrada({ accion: "accesos.revocar", detalle: { antes: { rol: "Residente", activo: true, desde: "2026-01-01", hasta: null }, despues: { rol: "Residente", activo: false } } })), "Residente, desde 01-01-2026, sin fecha final → Residente, revocado");
    assert.equal(detalleEntrada(entrada({ accion: "roles.cambiar", detalle: { agregados: ["panel.ver"], quitados: [], activo: true } })), "Agregó Panel y trazabilidad: Ver");
    assert.match(detalleEntrada(entrada({ resultado: "denegado", accion: "accesos.consultar", detalle: { motivo: "sin-permiso", permiso: "accesos.ver" } })), /^Tu rol no permite hacer esto\. \(permiso: Accesos y roles: Ver\)$/);
    assert.equal(detalleEntrada(entrada({ resultado: "denegado", accion: "ingreso", detalle: { motivo: "no-activado" } })), "Compras no está activado en el proyecto.");
  });
});

describe("auditoría de requisiciones", () => {
  it("dice el cambio de estado, lo aprobado y el motivo", () => {
    assert.equal(
      detalleEntrada(entrada({ accion: "requisiciones.aprobar", modulo: "requisiciones", detalle: { de: "enviada", a: "aprobada", motivo: "Por ahora 300", aprobadas: { "BLOQUE No. 5": 300 } } })),
      "Por aprobar → Aprobada. aprobado: BLOQUE No. 5 300. motivo: Por ahora 300"
    );
    assert.equal(detalleEntrada(entrada({ accion: "requisiciones.crear", detalle: { lineas: 2, fecha_requerida: "2026-10-25" } })), "2 insumo(s), requerida el 25-10-2026");
    assert.equal(detalleEntrada(entrada({ accion: "config.cambiar", detalle: { tolerancia_antes: 0, tolerancia: 5 } })), "Tolerancia 0 % → 5 %");
  });
});
