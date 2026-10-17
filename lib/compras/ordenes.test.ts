import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { comprometidoPorInsumo, comprometidoPorLinea, maximoLinea, numeroOrden, puedeAccionOrden, revisarAccionOrden, revisarOrden } from "./ordenes";
import { ROLES_INICIALES } from "./roles";
import type { AccionSobreOrden, CambioOrden, Comparativo, Cotizacion, Orden, Requisicion } from "./types";

const HOY = "2026-10-16";
const permisosDe = (clave: string) => ROLES_INICIALES.find((r) => r.clave === clave)!.permisos;
const COMPRAS = permisosDe("compras");
const DIRECTOR = permisosDe("director");
const JURIDICA = permisosDe("juridica");
const FINANZAS = permisosDe("finanzas");

const req: Requisicion = {
  id: "r1", numero: 1, estado: "aprobada", solicitanteId: "luis", solicitanteNombre: "Luis", fechaRequerida: "2026-10-30", prioridad: "normal", justificacion: "x", motivo: "",
  presupuestoVersion: 1, enviada: null, enviadaPor: null, decidida: null, decididaPor: null, version: 3, creada: "", actualizado: null, actualizadoPor: null,
  lineas: [
    { id: "l1", insumoId: "blq", partidaItemId: null, codigo: "", descripcion: "BLOQUE", unidad: "UND", tipo: "MT", precio: 2_100, cantidad: 1000, cantidadAprobada: 1000, planificado: 5000, justificacionExceso: "" },
    { id: "l2", insumoId: "cem", partidaItemId: null, codigo: "", descripcion: "CEMENTO", unidad: "BLS", tipo: "MT", precio: 32_000, cantidad: 20, cantidadAprobada: 20, planificado: 80, justificacionExceso: "" },
  ],
};
const cot: Cotizacion = {
  id: "q1", numero: 1, requisicionId: "r1", proveedorId: "a", referencia: "", fecha: "2026-10-10", vigenciaHasta: "2026-11-10", plazoEntregaDias: 5, diasPago: 30, anticipoPct: 0,
  formaPago: "", observaciones: "", estado: "registrada", motivo: "", version: 1, creada: "", creadaPor: "", actualizado: null, actualizadoPor: null,
  lineas: [
    { id: "c1", requisicionLineaId: "l1", cantidad: 800, precioUnitario: 2_000, descuentoPct: 0, ivaPct: 19 },
    { id: "c2", requisicionLineaId: "l2", cantidad: 20, precioUnitario: 31_000, descuentoPct: 0, ivaPct: 19 },
  ],
};
const comp: Comparativo = {
  requisicionId: "r1", estado: "aprobado", criterios: { precio: 70, entrega: 20, pago: 10 }, cotizacionElegidaId: "q1", justificacion: "", motivo: "",
  propuesto: null, propuestoPorId: "pedro", propuestoPor: "Pedro", aprobado: null, aprobadoPor: null, version: 2,
};
function orden(id: string, estado: Orden["estado"], cantidades: [number, number?], extra: Partial<Orden> = {}): Orden {
  const lineas = [{ id: `${id}-1`, requisicionLineaId: "l1", insumoId: "blq", codigo: "", descripcion: "BLOQUE", unidad: "UND", tipo: "MT" as const, cantidad: cantidades[0], precioUnitario: 2_000, descuentoPct: 0, ivaPct: 19 }];
  if (cantidades[1] !== undefined) lineas.push({ id: `${id}-2`, requisicionLineaId: "l2", insumoId: "cem", codigo: "", descripcion: "CEMENTO", unidad: "BLS", tipo: "MT", cantidad: cantidades[1], precioUnitario: 31_000, descuentoPct: 0, ivaPct: 19 });
  return {
    id, tipo: "orden", numero: 1, requisicionId: "r1", cotizacionId: "q1", proveedorId: "a", estado, revision: 0, elaboradoPorId: "pedro", elaboradoPor: "Pedro", motivo: "",
    enviada: null, aprobada: null, aprobadaPor: null, lineas, version: 1, creada: "", actualizado: null, actualizadoPor: null,
    fechaEntrega: "2026-10-25", lugarEntrega: "Obra", formaPago: "", diasPago: 30, anticipoPct: 0, retencionGarantiaPct: 0, objeto: "", polizas: "", observaciones: "", ...extra,
  };
}
const cambio = (cantidades: [number, number?], extra: Partial<CambioOrden> = {}): CambioOrden => ({
  tipo: "orden", requisicionId: "r1",
  lineas: [{ requisicionLineaId: "l1", cantidad: cantidades[0] }, ...(cantidades[1] !== undefined ? [{ requisicionLineaId: "l2", cantidad: cantidades[1] }] : [])],
  fechaEntrega: "2026-10-25", lugarEntrega: "Obra", formaPago: "", diasPago: 30, anticipoPct: 0, retencionGarantiaPct: 0, objeto: "", polizas: "", observaciones: "", version: 0, ...extra,
});
const ctx = (actorId: string, permisos: readonly string[]) => ({ actorId, permisos: permisos as never, hoy: HOY });

describe("compromiso de cada línea", () => {
  it("cuentan todas las órdenes no anuladas (también los borradores); lo comprometido del insumo solo las emitidas", () => {
    const ordenes = [orden("a", "aprobada", [300, 5]), orden("b", "borrador", [200]), orden("c", "anulada", [500])];
    assert.deepEqual([...comprometidoPorLinea(ordenes)], [["l1", 500], ["l2", 5]]);
    assert.deepEqual([...comprometidoPorLinea(ordenes, "a")], [["l1", 200]]);
    assert.deepEqual([...comprometidoPorInsumo(ordenes)], [["blq", 300], ["cem", 5]]);
  });

  it("lo máximo a ordenar es lo aprobado y cotizado menos lo que tomaron otras", () => {
    assert.equal(maximoLinea(req.lineas[0], 800, 0), 800);
    assert.equal(maximoLinea(req.lineas[0], 1200, 300), 700);
    assert.equal(maximoLinea(req.lineas[0], 800, 900), 0);
    assert.equal(numeroOrden("orden", 7), "OC-0007");
    assert.equal(numeroOrden("contrato", 12), "CT-0012");
  });
});

describe("guardar órdenes", () => {
  it("Compras crea órdenes desde el proveedor elegido; Jurídica, contratos", () => {
    assert.equal(revisarOrden(ctx("pedro", COMPRAS), cambio([800, 20]), null, req, comp, cot, []), null);
    assert.equal(revisarOrden(ctx("pedro", COMPRAS), cambio([800], { tipo: "contrato" }), null, req, comp, cot, []), "sin-permiso");
    assert.equal(revisarOrden(ctx("sara", JURIDICA), cambio([800], { tipo: "contrato" }), null, req, comp, cot, []), null);
  });

  it("sin comparativo aprobado no hay orden", () => {
    assert.equal(revisarOrden(ctx("pedro", COMPRAS), cambio([1]), null, req, { ...comp, estado: "propuesto" }, cot, []), "sin-proveedor-elegido");
    assert.equal(revisarOrden(ctx("pedro", COMPRAS), cambio([1]), null, { ...req, estado: "anulada" }, comp, cot, []), "requisicion-no-aprobada");
  });

  it("no se compromete dos veces la misma cantidad: ni más de lo cotizado ni de lo que dejan otras órdenes", () => {
    assert.equal(revisarOrden(ctx("pedro", COMPRAS), cambio([801]), null, req, comp, cot, []), "doble-compromiso");
    const otra = orden("a", "borrador", [500]);
    assert.equal(revisarOrden(ctx("pedro", COMPRAS), cambio([301]), null, req, comp, cot, [otra]), "doble-compromiso");
    assert.equal(revisarOrden(ctx("pedro", COMPRAS), cambio([300]), null, req, comp, cot, [otra]), null);
    // Editing that same draft doesn't count it against itself; a cancelled one frees its quantity.
    assert.equal(revisarOrden(ctx("pedro", COMPRAS), cambio([800], { version: 1 }), otra, req, comp, cot, [otra]), null);
    assert.equal(revisarOrden(ctx("pedro", COMPRAS), cambio([800]), null, req, comp, cot, [{ ...otra, estado: "anulada" }]), null);
  });

  it("solo líneas aprobadas y cotizadas, una vez cada una, y en borrador", () => {
    assert.equal(revisarOrden(ctx("pedro", COMPRAS), { ...cambio([1]), lineas: [{ requisicionLineaId: "otra", cantidad: 1 }] }, null, req, comp, cot, []), "datos");
    assert.equal(revisarOrden(ctx("pedro", COMPRAS), { ...cambio([1]), lineas: [] }, null, req, comp, cot, []), "sin-lineas");
    const emitida = orden("a", "aprobada", [1]);
    assert.equal(revisarOrden(ctx("pedro", COMPRAS), cambio([1], { version: 1 }), emitida, req, comp, cot, [emitida]), "estado-no-valido");
  });
});

describe("estados de la orden", () => {
  const a = (accion: AccionSobreOrden["accion"], motivo = "", version = 1): AccionSobreOrden => ({ accion, motivo, version });

  it("quien la elabora la envía; la aprueba otra persona con el permiso (Director o Finanzas)", () => {
    const o = orden("o", "borrador", [100]);
    assert.equal(revisarAccionOrden(ctx("pedro", COMPRAS), o, a("enviar")), null);
    const enviada = { ...o, estado: "enviada" as const };
    assert.equal(revisarAccionOrden(ctx("pedro", COMPRAS), enviada, a("aprobar")), "sin-permiso");
    assert.equal(revisarAccionOrden(ctx("pedro", [...COMPRAS, "ordenes.aprobar"]), enviada, a("aprobar")), "auto-aprobacion");
    assert.equal(revisarAccionOrden(ctx("ana", DIRECTOR), enviada, a("aprobar")), null);
    assert.equal(revisarAccionOrden(ctx("fe", FINANZAS), enviada, a("aprobar")), null);
    assert.equal(puedeAccionOrden(ctx("pedro", COMPRAS), enviada, "aprobar"), false);
  });

  it("devolver, anular y modificar piden motivo; modificar solo la emitida", () => {
    const enviada = orden("o", "enviada", [100]);
    assert.equal(revisarAccionOrden(ctx("ana", DIRECTOR), enviada, a("devolver")), "motivo-requerido");
    const emitida = orden("o", "aprobada", [100]);
    assert.equal(revisarAccionOrden(ctx("pedro", COMPRAS), emitida, a("modificar")), "motivo-requerido");
    assert.equal(revisarAccionOrden(ctx("pedro", COMPRAS), emitida, a("modificar", "El proveedor amplió el plazo")), null);
    assert.equal(revisarAccionOrden(ctx("pedro", COMPRAS), enviada, a("modificar", "x")), "estado-no-valido");
    assert.equal(revisarAccionOrden(ctx("pedro", COMPRAS), emitida, a("anular", "Proveedor incumplió")), null);
  });

  it("el contrato pide objeto, y la fecha de entrega no puede haber pasado", () => {
    const contrato = orden("c", "borrador", [100], { tipo: "contrato", elaboradoPorId: "sara" });
    assert.equal(revisarAccionOrden(ctx("sara", JURIDICA), contrato, a("enviar")), "objeto-requerido");
    assert.equal(revisarAccionOrden(ctx("sara", JURIDICA), { ...contrato, objeto: "Suministro e instalación de mampostería" }, a("enviar")), null);
    assert.equal(revisarAccionOrden(ctx("pedro", COMPRAS), orden("o", "borrador", [1], { fechaEntrega: "2026-10-15" }), a("enviar")), "fecha-pasada");
  });
});
