import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cobertura, criteriosValidos, evaluar, razonesJustificacion, revisarComparativo, revisarCotizacion, totalesCotizacion, totalesLinea } from "./cotizaciones";
import { digitoVerificacion, leerNit, nitConDv } from "./proveedores";
import { ROLES_INICIALES } from "./roles";
import type { AccionSobreComparativo, CambioCotizacion, Comparativo, Cotizacion, Proveedor, Requisicion } from "./types";

const HOY = "2026-10-16";
const permisosDe = (clave: string) => ROLES_INICIALES.find((r) => r.clave === clave)!.permisos;
const COMPRAS = permisosDe("compras");
const DIRECTOR = permisosDe("director");

const req: Requisicion = {
  id: "r1", numero: 1, estado: "aprobada", solicitanteId: "luis", solicitanteNombre: "Luis", fechaRequerida: "2026-10-30", prioridad: "normal", justificacion: "x", motivo: "",
  presupuestoVersion: 1, enviada: null, enviadaPor: null, decidida: null, decididaPor: null, version: 3, creada: "", actualizado: null, actualizadoPor: null,
  lineas: [
    { id: "l1", insumoId: "cem", partidaItemId: null, codigo: "", descripcion: "CEMENTO", unidad: "BLS", tipo: "MT", precio: 32_000, cantidad: 100, cantidadAprobada: 100, planificado: 400, justificacionExceso: "" },
    { id: "l2", insumoId: "are", partidaItemId: null, codigo: "", descripcion: "ARENA", unidad: "M3", tipo: "MT", precio: 80_000, cantidad: 10, cantidadAprobada: 8, planificado: 30, justificacionExceso: "" },
    { id: "l3", insumoId: "ace", partidaItemId: null, codigo: "", descripcion: "ACERO", unidad: "KG", tipo: "MT", precio: 4_500, cantidad: 50, cantidadAprobada: 0, planificado: 900, justificacionExceso: "" },
  ],
};
const prov = (id: string, estado: Proveedor["estado"] = "activo"): Proveedor => ({
  id, nit: "900123456", dv: 8, tipoPersona: "juridica", razonSocial: id.toUpperCase(), nombreComercial: "", contacto: "", telefono: "", correo: "", ciudad: "", direccion: "",
  categorias: ["MT"], responsableIva: true, observaciones: "", estado, motivoEstado: "", version: 1, creado: "", creadoPor: "", actualizado: null, actualizadoPor: null,
});
const PROVEEDORES = new Map([["a", prov("a")], ["b", prov("b")], ["c", prov("c")], ["x", prov("x", "bloqueado")]]);
function cot(id: string, proveedorId: string, precios: [number, number] | [number], extra: Partial<Cotizacion> = {}): Cotizacion {
  const lineas = [{ id: `${id}-1`, requisicionLineaId: "l1", cantidad: 100, precioUnitario: precios[0], descuentoPct: 0, ivaPct: 19 }];
  if (precios[1] !== undefined) lineas.push({ id: `${id}-2`, requisicionLineaId: "l2", cantidad: 8, precioUnitario: precios[1], descuentoPct: 0, ivaPct: 19 });
  return {
    id, numero: 1, requisicionId: "r1", proveedorId, referencia: "", fecha: "2026-10-10", vigenciaHasta: "2026-11-10", plazoEntregaDias: 5, diasPago: 30, anticipoPct: 0, formaPago: "",
    observaciones: "", estado: "registrada", motivo: "", lineas, version: 1, creada: "", creadaPor: "", actualizado: null, actualizadoPor: null, ...extra,
  };
}
const CRIT = { precio: 70, entrega: 20, pago: 10 };

describe("proveedores: NIT", () => {
  it("calcula el dígito de verificación de la DIAN", () => {
    assert.equal(digitoVerificacion("890903938"), 8);
    assert.equal(digitoVerificacion("800197268"), 4);
    assert.equal(digitoVerificacion("899999068"), 1);
    assert.equal(nitConDv("890903938"), "890.903.938-8");
  });

  it("lee el NIT como se escriba y rechaza un dígito equivocado", () => {
    assert.deepEqual(leerNit("890.903.938-8"), { nit: "890903938", dv: 8 });
    assert.deepEqual(leerNit("890903938"), { nit: "890903938", dv: 8 });
    assert.ok("error" in leerNit("890903938-7"));
    assert.ok("error" in leerNit("123"));
  });
});

describe("cotizaciones: totales y cobertura", () => {
  it("aplica descuento y luego IVA, línea por línea", () => {
    assert.deepEqual(totalesLinea({ cantidad: 100, precioUnitario: 30_000, descuentoPct: 5, ivaPct: 19 }), { bruto: 3_000_000, descuento: 150_000, neto: 2_850_000, iva: 541_500, total: 3_391_500 });
    assert.equal(totalesCotizacion(cot("q", "a", [30_000, 80_000])).total, 3_570_000 + 761_600);
  });

  it("cubre todo solo si cotiza todas las líneas aprobadas con su cantidad (la de 0 no cuenta)", () => {
    assert.deepEqual(cobertura(cot("q", "a", [30_000, 80_000]), req), { cubiertas: 2, de: 2, completa: true });
    assert.deepEqual(cobertura(cot("q", "a", [30_000]), req), { cubiertas: 1, de: 2, completa: false });
  });
});

describe("comparativo: puntajes", () => {
  const cots = [
    cot("q1", "a", [30_000, 80_000], { plazoEntregaDias: 10, diasPago: 30 }),
    cot("q2", "b", [32_000, 78_000], { plazoEntregaDias: 2, diasPago: 60 }),
    cot("q3", "c", [20_000], { plazoEntregaDias: 1, diasPago: 0 }), // incomplete
    cot("q4", "a", [10_000, 10_000], { vigenciaHasta: "2026-10-15" }), // expired
    cot("q5", "x", [10_000, 10_000]), // blocked supplier
  ];
  const ev = evaluar(cots, req, PROVEEDORES, CRIT, HOY);
  const de = (id: string) => ev.find((e) => e.cotizacionId === id)!;

  it("las vencidas y las de proveedores no activos no se pueden elegir y no puntúan", () => {
    assert.equal(de("q4").elegible, false);
    assert.match(de("q4").motivo, /Vencida el 15-10-2026/);
    assert.equal(de("q5").elegible, false);
    assert.equal(de("q5").puntaje, 0);
  });

  it("el precio se compara contra la más barata que cubre todo; entrega y pago con sus fórmulas", () => {
    assert.equal(de("q1").puntajes.precio, 100);
    assert.equal(de("q2").puntajes.precio, 95.19); // 4,331,600 / 4,550,560
    assert.equal(de("q2").puntajes.entrega, 66.67); // (1+1)/(2+1)
    assert.equal(de("q1").puntajes.entrega, 18.18); // 2/11
    assert.equal(de("q2").puntajes.pago, 100);
    assert.equal(de("q3").puntajes.pago, 1.64); // 1/61
  });

  it("la mejor es la de mayor puntaje entre las que cubren todo", () => {
    // q1: 70 + 3.64 + 5.08 = 78.72; q2: 66.63 + 13.33 + 10 = 89.97.
    assert.equal(de("q1").puntaje, 78.72);
    assert.equal(de("q2").puntaje, 89.97);
    assert.deepEqual(ev.filter((e) => e.mejor).map((e) => e.cotizacionId), ["q2"]);
  });

  it("pide justificar si la elegida no es la mejor, si no cubre todo o si hay menos cotizaciones de las esperadas", () => {
    assert.deepEqual(razonesJustificacion(ev, "q2", 3), []);
    assert.deepEqual(razonesJustificacion(ev, "q1", 3), ["La elegida no es la de mejor puntaje."]);
    assert.deepEqual(razonesJustificacion(ev, "q3", 3), ["La elegida no cubre todo lo aprobado.", "La elegida no es la de mejor puntaje."]);
    assert.deepEqual(razonesJustificacion(ev, "q2", 4), ["Hay 3 cotización(es) vigente(s) y se esperan al menos 4."]);
  });

  it("los pesos deben ser enteros que sumen 100", () => {
    assert.equal(criteriosValidos(CRIT), true);
    assert.equal(criteriosValidos({ precio: 70, entrega: 20, pago: 20 }), false);
    assert.equal(criteriosValidos({ precio: 70.5, entrega: 19.5, pago: 10 }), false);
  });
});

describe("comparativo: proponer y aprobar", () => {
  const cots = [cot("q1", "a", [30_000, 80_000]), cot("q2", "b", [32_000, 78_000], { plazoEntregaDias: 2, diasPago: 60 }), cot("q3", "c", [31_000, 79_000])];
  const ev = evaluar(cots, req, PROVEEDORES, CRIT, HOY);
  const accion = (a: Partial<AccionSobreComparativo>): AccionSobreComparativo => ({ accion: "proponer", criterios: CRIT, cotizacionElegidaId: "q2", justificacion: "", motivo: "", version: 0, ...a });
  const ctx = (actorId: string, permisos: readonly string[]) => ({ actorId, permisos: permisos as never, hoy: HOY, minCotizaciones: 3 });
  const propuesto: Comparativo = { requisicionId: "r1", estado: "propuesto", criterios: CRIT, cotizacionElegidaId: "q2", justificacion: "", motivo: "", propuesto: "", propuestoPorId: "pedro", propuestoPor: "Pedro", aprobado: null, aprobadoPor: null, version: 2 };

  it("Compras propone la mejor sin justificar; otra necesita justificación", () => {
    const mejor = ev.find((e) => e.mejor)!.cotizacionId;
    assert.equal(revisarComparativo(ctx("pedro", COMPRAS), req, undefined, ev, accion({ cotizacionElegidaId: mejor })), null);
    const otra = ev.find((e) => !e.mejor)!.cotizacionId;
    assert.equal(revisarComparativo(ctx("pedro", COMPRAS), req, undefined, ev, accion({ cotizacionElegidaId: otra })), "justificacion-requerida");
    assert.equal(revisarComparativo(ctx("pedro", COMPRAS), req, undefined, ev, accion({ cotizacionElegidaId: otra, justificacion: "Mejor servicio posventa" })), null);
    assert.equal(revisarComparativo(ctx("pedro", COMPRAS), req, undefined, ev, accion({ cotizacionElegidaId: "nada" })), "cotizacion-no-elegible");
  });

  it("quien propone no aprueba; el Director aprueba o devuelve con motivo", () => {
    assert.equal(revisarComparativo(ctx("pedro", COMPRAS), req, propuesto, ev, accion({ accion: "aprobar", version: 2 })), "sin-permiso");
    assert.equal(revisarComparativo(ctx("pedro", DIRECTOR), req, propuesto, ev, accion({ accion: "aprobar", version: 2 })), "auto-aprobacion");
    assert.equal(revisarComparativo(ctx("ana", DIRECTOR), req, propuesto, ev, accion({ accion: "aprobar", version: 2 })), null);
    assert.equal(revisarComparativo(ctx("ana", DIRECTOR), req, propuesto, ev, accion({ accion: "devolver", version: 2 })), "motivo-requerido");
    assert.equal(revisarComparativo(ctx("pedro", COMPRAS), req, propuesto, ev, accion({ version: 2 })), "estado-no-valido");
  });

  it("solo sobre requisiciones aprobadas y con la versión vigente", () => {
    assert.equal(revisarComparativo(ctx("pedro", COMPRAS), { ...req, estado: "anulada" }, undefined, ev, accion({})), "requisicion-no-aprobada");
    assert.equal(revisarComparativo(ctx("ana", DIRECTOR), req, propuesto, ev, accion({ accion: "aprobar", version: 1 })), "version-conflict");
  });
});

describe("registrar cotizaciones", () => {
  const cambio = (extra: Partial<CambioCotizacion> = {}): CambioCotizacion => ({
    requisicionId: "r1", proveedorId: "a", referencia: "", fecha: "2026-10-10", vigenciaHasta: "2026-11-10", plazoEntregaDias: 5, diasPago: 30, anticipoPct: 0, formaPago: "", observaciones: "",
    lineas: [{ requisicionLineaId: "l1", cantidad: 100, precioUnitario: 30_000, descuentoPct: 0, ivaPct: 19 }], version: 0, ...extra,
  });
  const ctx = { actorId: "pedro", permisos: COMPRAS, hoy: HOY, minCotizaciones: 3 };

  it("solo sobre lo aprobado, de proveedores activos, una por proveedor y con el comparativo abierto", () => {
    assert.equal(revisarCotizacion(ctx, cambio(), null, req, undefined, PROVEEDORES.get("a"), []), null);
    assert.equal(revisarCotizacion(ctx, cambio({ lineas: [{ requisicionLineaId: "l1", cantidad: 101, precioUnitario: 1, descuentoPct: 0, ivaPct: 19 }] }), null, req, undefined, PROVEEDORES.get("a"), []), "cantidad-no-valida");
    assert.equal(revisarCotizacion(ctx, cambio({ lineas: [{ requisicionLineaId: "l3", cantidad: 1, precioUnitario: 1, descuentoPct: 0, ivaPct: 19 }] }), null, req, undefined, PROVEEDORES.get("a"), []), "datos");
    assert.equal(revisarCotizacion(ctx, cambio({ proveedorId: "x" }), null, req, undefined, PROVEEDORES.get("x"), []), "proveedor-no-activo");
    assert.equal(revisarCotizacion(ctx, cambio(), null, req, undefined, PROVEEDORES.get("a"), [cot("q1", "a", [1])]), "cotizacion-duplicada");
    const cerrado: Comparativo = { requisicionId: "r1", estado: "propuesto", criterios: CRIT, cotizacionElegidaId: null, justificacion: "", motivo: "", propuesto: null, propuestoPorId: null, propuestoPor: null, aprobado: null, aprobadoPor: null, version: 1 };
    assert.equal(revisarCotizacion(ctx, cambio(), null, req, cerrado, PROVEEDORES.get("a"), []), "comparativo-cerrado");
    assert.equal(revisarCotizacion(ctx, cambio(), null, { ...req, estado: "enviada" }, undefined, PROVEEDORES.get("a"), []), "requisicion-no-aprobada");
    assert.equal(revisarCotizacion({ ...ctx, permisos: permisosDe("residente") }, cambio(), null, req, undefined, PROVEEDORES.get("a"), []), "sin-permiso");
  });
});
