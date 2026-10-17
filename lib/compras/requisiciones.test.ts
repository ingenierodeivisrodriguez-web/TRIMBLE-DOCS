import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROLES_INICIALES } from "./roles";
import { excesos, limite, numeroRequisicion, puedeAccion, puedeEditar, revisarAccion, solicitadoPorInsumo } from "./requisiciones";
import type { AccionSobreRequisicion, LineaRequisicion, Permiso, Requisicion } from "./types";

const HOY = "2026-10-16";
const permisosDe = (clave: string) => ROLES_INICIALES.find((r) => r.clave === clave)!.permisos;
const RESIDENTE = permisosDe("residente");
const DIRECTOR = permisosDe("director");
const COSTOS = permisosDe("presupuesto_costos");

function linea(id: string, insumoId: string, cantidad: number, extra: Partial<LineaRequisicion> = {}): LineaRequisicion {
  return { id, insumoId, partidaItemId: null, codigo: "", descripcion: insumoId.toUpperCase(), unidad: "UND", tipo: "MT", precio: 1000, cantidad, cantidadAprobada: null, planificado: null, justificacionExceso: "", ...extra };
}
function req(id: string, estado: Requisicion["estado"], lineas: LineaRequisicion[], extra: Partial<Requisicion> = {}): Requisicion {
  return {
    id, numero: 1, estado, solicitanteId: "luis", solicitanteNombre: "Luis", fechaRequerida: "2026-10-20", prioridad: "normal", justificacion: "Fundición losa piso 2",
    motivo: "", presupuestoVersion: null, enviada: null, enviadaPor: null, decidida: null, decididaPor: null, lineas, version: 1, creada: "", actualizado: null, actualizadoPor: null, ...extra,
  };
}
const PLAN = new Map([["cem", 100], ["ace", 1000]]);
const ctx = (actorId: string, permisos: readonly Permiso[], requisiciones: Requisicion[], toleranciaPct = 0) => ({ actorId, permisos, hoy: HOY, toleranciaPct, planificados: PLAN, requisiciones });
const accion = (a: Partial<AccionSobreRequisicion> & Pick<AccionSobreRequisicion, "accion">): AccionSobreRequisicion => ({ motivo: "", version: 1, ...a });

describe("lo solicitado de cada insumo", () => {
  it("cuentan las enviadas completas y las aprobadas por lo aprobado; borradores, rechazadas y anuladas no", () => {
    const m = solicitadoPorInsumo([
      req("a", "enviada", [linea("1", "cem", 30)]),
      req("b", "aprobada", [linea("2", "cem", 50, { cantidadAprobada: 40 })]),
      req("c", "borrador", [linea("3", "cem", 99)]),
      req("d", "rechazada", [linea("4", "cem", 99)]),
      req("e", "anulada", [linea("5", "cem", 99)]),
    ]);
    assert.deepEqual(m.get("cem"), { solicitado: 70, aprobado: 40 });
    assert.equal(solicitadoPorInsumo([req("a", "enviada", [linea("1", "cem", 30)])], "a").size, 0);
  });

  it("el límite es lo planificado más la tolerancia", () => {
    assert.equal(limite(100, 0), 100);
    assert.equal(limite(418.47, 5), 439.3935);
  });

  it("un insumo pasa el límite sumando todas sus líneas y lo ya pedido en otras requisiciones", () => {
    const otros = new Map([["cem", { solicitado: 70, aprobado: 0 }]]);
    const e = excesos([linea("1", "cem", 20), linea("2", "cem", 15), linea("3", "ace", 10)], PLAN, 0, otros);
    assert.deepEqual(e.map((x) => [x.insumoId, x.otros, x.pedido, x.limite]), [["cem", 70, 35, 100]]);
    assert.equal(excesos([linea("1", "cem", 30)], PLAN, 0, otros).length, 0);
    // A resource no longer in the budget has nothing left.
    assert.equal(excesos([linea("1", "viejo", 1)], PLAN, 0, new Map()).length, 1);
  });
});

describe("estados y permisos", () => {
  it("el borrador lo edita quien lo pidió o quien edita requisiciones, y solo en borrador", () => {
    assert.equal(puedeEditar({ estado: "borrador", solicitanteId: "luis" }, "luis", ["requisiciones.crear"]), true);
    assert.equal(puedeEditar({ estado: "borrador", solicitanteId: "luis" }, "marta", ["requisiciones.crear"]), false);
    assert.equal(puedeEditar({ estado: "borrador", solicitanteId: "luis" }, "marta", ["requisiciones.editar"]), true);
    assert.equal(puedeEditar({ estado: "enviada", solicitanteId: "luis" }, "luis", RESIDENTE), false);
  });

  it("solo se pasa de un estado a los permitidos", () => {
    const r = req("r", "aprobada", [linea("1", "cem", 10)]);
    assert.equal(revisarAccion(ctx("ana", DIRECTOR, [r]), r, accion({ accion: "aprobar" })), "estado-no-valido");
    assert.equal(revisarAccion(ctx("luis", RESIDENTE, [r]), r, accion({ accion: "enviar" })), "estado-no-valido");
    assert.equal(revisarAccion(ctx("ana", DIRECTOR, [r]), r, accion({ accion: "anular", motivo: "Se cambió el diseño" })), null);
    const anulada = req("x", "anulada", []);
    assert.equal(revisarAccion(ctx("ana", DIRECTOR, [anulada]), anulada, accion({ accion: "anular", motivo: "x" })), "estado-no-valido");
  });

  it("quien pide no decide sobre su propia requisición", () => {
    const r = req("r", "enviada", [linea("1", "cem", 10)], { solicitanteId: "ana" });
    for (const a of ["aprobar", "rechazar", "devolver"] as const) {
      assert.equal(revisarAccion(ctx("ana", DIRECTOR, [r]), r, accion({ accion: a, motivo: "x" })), "auto-aprobacion", a);
      assert.equal(puedeAccion(ctx("ana", DIRECTOR, [r]), r, a), false);
    }
    assert.equal(puedeAccion(ctx("pedro", DIRECTOR, [r]), r, "aprobar"), true);
    assert.equal(revisarAccion(ctx("pedro", RESIDENTE, [r]), r, accion({ accion: "aprobar" })), "sin-permiso");
  });

  it("rechazar, devolver y anular piden motivo", () => {
    const r = req("r", "enviada", [linea("1", "cem", 10)]);
    assert.equal(revisarAccion(ctx("ana", DIRECTOR, [r]), r, accion({ accion: "rechazar", motivo: " " })), "motivo-requerido");
    assert.equal(revisarAccion(ctx("ana", DIRECTOR, [r]), r, accion({ accion: "devolver", motivo: "Falta la partida" })), null);
  });

  it("guardar sobre una versión vieja es un conflicto", () => {
    const r = req("r", "enviada", [linea("1", "cem", 10)], { version: 3 });
    assert.equal(revisarAccion(ctx("ana", DIRECTOR, [r]), r, accion({ accion: "aprobar", version: 2 })), "version-conflict");
  });
});

describe("enviar", () => {
  it("pide insumos, justificación y una fecha que no haya pasado", () => {
    const vacia = req("r", "borrador", []);
    assert.equal(revisarAccion(ctx("luis", RESIDENTE, [vacia]), vacia, accion({ accion: "enviar" })), "sin-lineas");
    const sinPorque = req("r", "borrador", [linea("1", "cem", 10)], { justificacion: "" });
    assert.equal(revisarAccion(ctx("luis", RESIDENTE, [sinPorque]), sinPorque, accion({ accion: "enviar" })), "justificacion-requerida");
    const vieja = req("r", "borrador", [linea("1", "cem", 10)], { fechaRequerida: "2026-10-15" });
    assert.equal(revisarAccion(ctx("luis", RESIDENTE, [vieja]), vieja, accion({ accion: "enviar" })), "fecha-pasada");
  });

  it("no se pasa del presupuesto sin justificar el exceso, contando lo que ya pidieron otros", () => {
    const otra = req("o", "aprobada", [linea("9", "cem", 80, { cantidadAprobada: 80 })]);
    const r = req("r", "borrador", [linea("1", "cem", 30)]);
    assert.equal(revisarAccion(ctx("luis", RESIDENTE, [otra, r]), r, accion({ accion: "enviar" })), "cantidad-excedida");
    // With 10 % of tolerance (limit 110) it fits.
    assert.equal(revisarAccion(ctx("luis", RESIDENTE, [otra, r], 10), r, accion({ accion: "enviar" })), null);
    const justificada = req("r", "borrador", [linea("1", "cem", 30, { justificacionExceso: "Desperdicio mayor por el clima" })]);
    assert.equal(revisarAccion(ctx("luis", RESIDENTE, [otra, justificada]), justificada, accion({ accion: "enviar" })), null);
  });
});

describe("aprobar", () => {
  const r = req("r", "enviada", [linea("1", "cem", 60), linea("2", "ace", 500)]);

  it("se aprueba todo o una parte, nunca más de lo pedido ni nada", () => {
    assert.equal(revisarAccion(ctx("ana", COSTOS, [r]), r, accion({ accion: "aprobar" })), null);
    assert.equal(revisarAccion(ctx("ana", COSTOS, [r]), r, accion({ accion: "aprobar", aprobadas: { "1": 40, "2": 0 } })), null);
    assert.equal(revisarAccion(ctx("ana", COSTOS, [r]), r, accion({ accion: "aprobar", aprobadas: { "1": 61 } })), "cantidad-no-valida");
    assert.equal(revisarAccion(ctx("ana", COSTOS, [r]), r, accion({ accion: "aprobar", aprobadas: { "1": 0, "2": 0 } })), "cantidad-no-valida");
    assert.equal(revisarAccion(ctx("ana", COSTOS, [r]), r, accion({ accion: "aprobar", aprobadas: { otra: 1 } })), "cantidad-no-valida");
  });

  it("aprobar por encima del presupuesto requiere el permiso especial (el Director lo tiene)", () => {
    const otra = req("o", "aprobada", [linea("9", "cem", 70, { cantidadAprobada: 70 })]);
    const todos = [otra, r];
    assert.equal(revisarAccion(ctx("ana", COSTOS, todos), r, accion({ accion: "aprobar" })), "exceso-sin-permiso");
    assert.equal(revisarAccion(ctx("ana", COSTOS, todos), r, accion({ accion: "aprobar", aprobadas: { "1": 30 } })), null);
    assert.equal(revisarAccion(ctx("ana", DIRECTOR, todos), r, accion({ accion: "aprobar" })), null);
  });

  it("numera las requisiciones como REQ-0001", () => {
    assert.equal(numeroRequisicion(7), "REQ-0007");
    assert.equal(numeroRequisicion(12345), "REQ-12345");
  });
});
