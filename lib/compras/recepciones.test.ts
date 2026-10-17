import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERMISOS_VALIDOS } from "./types";
import type { CambioRecepcion, Orden, Permiso, Recepcion } from "./types";
import { revisarAccionOrden, revisarOrden } from "./ordenes";
import {
  aceptadoDeOrden,
  avanceRecepcion,
  numeroRecepcion,
  ordenesPorRecibir,
  puedeAccionRecepcion,
  recibidoPorInsumo,
  revisarAccionRecepcion,
  revisarRecepcion,
} from "./recepciones";

const HOY = "2026-10-17";
const ALMACEN: Permiso[] = ["recepciones.ver", "recepciones.crear", "recepciones.editar", "recepciones.aprobar", "recepciones.anular"];
const RESIDENTE: Permiso[] = ["recepciones.ver", "recepciones.crear"];

const orden: Orden = {
  id: "oc1", tipo: "orden", numero: 1, requisicionId: "r", cotizacionId: "q", proveedorId: "p", estado: "aprobada", revision: 0,
  elaboradoPorId: "pedro", elaboradoPor: "Pedro", motivo: "", enviada: null, aprobada: "2026-10-16T10:00:00Z", aprobadaPor: "Jorge",
  lineas: [
    { id: "a", requisicionLineaId: "rl-blq", insumoId: "blq", codigo: "MT-04", descripcion: "BLOQUE", unidad: "UND", tipo: "MT", cantidad: 1000, precioUnitario: 2000, descuentoPct: 0, ivaPct: 19 },
    { id: "b", requisicionLineaId: "rl-cem", insumoId: "cem", codigo: "MT-01", descripcion: "CEMENTO", unidad: "BLS", tipo: "MT", cantidad: 20, precioUnitario: 31000, descuentoPct: 0, ivaPct: 19 },
  ],
  version: 3, creada: "2026-10-15T10:00:00Z", actualizado: null, actualizadoPor: null,
  fechaEntrega: "2026-10-28", lugarEntrega: "Obra", formaPago: "", diasPago: 30, anticipoPct: 0, retencionGarantiaPct: 0, objeto: "", polizas: "", observaciones: "",
};

function recepcion(id: string, estado: Recepcion["estado"], lineas: [string, number, number][], por = "luis"): Recepcion {
  return {
    id, numero: 1, ordenId: "oc1", estado, fecha: HOY, remision: "", observaciones: "", elaboradoPorId: por, elaboradoPor: por, motivo: "", enviada: null, aprobada: null, aprobadaPor: null,
    lineas: lineas.map(([rl, recibido, rechazado], i) => ({
      id: `${id}-${i}`, requisicionLineaId: rl, insumoId: rl.slice(3), codigo: "", descripcion: "", unidad: "", tipo: "MT", recibido, aceptado: recibido - rechazado, rechazado, devuelto: 0, motivo: rechazado ? "Rotos" : "",
    })),
    version: 1, creada: "2026-10-17T08:00:00Z", actualizado: null, actualizadoPor: null,
  };
}

const cambio = (lineas: CambioRecepcion["lineas"], extra: Partial<CambioRecepcion> = {}): CambioRecepcion => ({ ordenId: "oc1", fecha: HOY, remision: "R-88", observaciones: "", lineas, version: 0, ...extra });
const linea = (requisicionLineaId: string, recibido: number, rechazado = 0, devuelto = 0, motivo = rechazado ? "Rotos" : "") => ({ requisicionLineaId, recibido, rechazado, devuelto, motivo });
const ctx = { actorId: "luis", permisos: RESIDENTE, hoy: HOY };

describe("número de la recepción", () => {
  it("REC con cuatro cifras", () => assert.equal(numeroRecepcion(7), "REC-0007"));
});

describe("registrar lo que llega", () => {
  it("aceptado más rechazado es lo recibido; lo devuelto no pasa lo rechazado; el rechazo lleva motivo", () => {
    assert.equal(revisarRecepcion(ctx, cambio([linea("rl-blq", 500, 20, 20)]), null, orden, []), null);
    assert.equal(revisarRecepcion(ctx, cambio([linea("rl-blq", 500, 600)]), null, orden, []), "rechazo-no-valido");
    assert.equal(revisarRecepcion(ctx, cambio([linea("rl-blq", 500, 20, 21)]), null, orden, []), "rechazo-no-valido");
    assert.equal(revisarRecepcion(ctx, cambio([linea("rl-blq", 500, 20, 0, " ")]), null, orden, []), "rechazo-no-valido");
    assert.equal(revisarRecepcion(ctx, cambio([linea("rl-blq", 0)]), null, orden, []), "cantidad-no-valida");
  });

  it("lo aceptado, sumando las recepciones no anuladas (borradores incluidos), no pasa lo ordenado", () => {
    const previas = [recepcion("r1", "aprobada", [["rl-blq", 600, 0]]), recepcion("r2", "borrador", [["rl-blq", 300, 0]]), recepcion("r3", "anulada", [["rl-blq", 900, 0]])];
    assert.equal(revisarRecepcion(ctx, cambio([linea("rl-blq", 100)]), null, orden, previas), null);
    assert.equal(revisarRecepcion(ctx, cambio([linea("rl-blq", 101)]), null, orden, previas), "recepcion-excedida");
    // Over what was ordered, but the excess rejected: allowed.
    assert.equal(revisarRecepcion(ctx, cambio([linea("rl-blq", 150, 50, 50)]), null, orden, previas), null);
    // Editing its own draft doesn't count it twice.
    const r2 = previas[1];
    assert.equal(revisarRecepcion(ctx, cambio([linea("rl-blq", 400)], { id: "r2", version: 1 }), r2, orden, previas), null);
  });

  it("solo contra órdenes emitidas, con fecha que no sea futura y líneas de esa orden", () => {
    assert.equal(revisarRecepcion(ctx, cambio([linea("rl-blq", 1)]), null, { ...orden, estado: "borrador" }, []), "orden-no-emitida");
    assert.equal(revisarRecepcion(ctx, cambio([linea("rl-blq", 1)], { fecha: "2026-10-18" }), null, orden, []), "fecha-futura");
    assert.equal(revisarRecepcion(ctx, cambio([linea("rl-xxx", 1)]), null, orden, []), "datos");
    assert.equal(revisarRecepcion(ctx, cambio([]), null, orden, []), "sin-lineas");
    assert.equal(revisarRecepcion({ ...ctx, permisos: ["recepciones.ver"] }, cambio([linea("rl-blq", 1)]), null, orden, []), "sin-permiso");
  });
});

describe("estados de la recepción", () => {
  it("quien la registró no la aprueba; anular y devolver piden motivo", () => {
    const r = recepcion("r1", "enviada", [["rl-blq", 10, 0]]);
    const a = { accion: "aprobar" as const, motivo: "", version: 1 };
    assert.equal(revisarAccionRecepcion({ actorId: "luis", permisos: ALMACEN, hoy: HOY }, r, a, orden), "auto-aprobacion");
    assert.equal(revisarAccionRecepcion({ actorId: "olga", permisos: ALMACEN, hoy: HOY }, r, a, orden), null);
    assert.equal(revisarAccionRecepcion({ actorId: "olga", permisos: ALMACEN, hoy: HOY }, r, { accion: "devolver", motivo: "", version: 1 }, orden), "motivo-requerido");
    assert.equal(revisarAccionRecepcion({ actorId: "olga", permisos: ALMACEN, hoy: HOY }, r, a, { ...orden, estado: "borrador", revision: 1 }), "orden-no-emitida");
    assert.equal(puedeAccionRecepcion({ actorId: "luis", permisos: RESIDENTE }, r, "aprobar"), false);
    assert.equal(puedeAccionRecepcion({ actorId: "olga", permisos: ALMACEN }, r, "anular"), true);
  });
});

describe("la orden respeta lo recibido", () => {
  it("con recepciones vigentes no se anula; una modificación no baja una línea por debajo de lo aceptado", () => {
    const recs = [recepcion("r1", "aprobada", [["rl-blq", 600, 0]])];
    const todo = { actorId: "pedro", permisos: PERMISOS_VALIDOS, hoy: HOY };
    assert.equal(revisarAccionOrden(todo, orden, { accion: "anular", motivo: "x", version: 3 }, true), "con-recepciones");
    assert.equal(revisarAccionOrden(todo, orden, { accion: "anular", motivo: "x", version: 3 }, false), null);
    assert.deepEqual([...aceptadoDeOrden(recs, "oc1")], [["rl-blq", 600]]);
    const enModificacion = { ...orden, estado: "borrador" as const, revision: 1 };
    const req = { id: "r", estado: "aprobada", lineas: [{ id: "rl-blq", cantidadAprobada: 1000 }, { id: "rl-cem", cantidadAprobada: 20 }] } as never;
    const comp = { requisicionId: "r", estado: "aprobado", cotizacionElegidaId: "q" } as never;
    const cot = { id: "q", lineas: [{ requisicionLineaId: "rl-blq", cantidad: 1000 }, { requisicionLineaId: "rl-cem", cantidad: 20 }] } as never;
    const base = { tipo: "orden" as const, requisicionId: "r", fechaEntrega: "2026-10-28", lugarEntrega: "", formaPago: "", diasPago: 0, anticipoPct: 0, retencionGarantiaPct: 0, objeto: "", polizas: "", observaciones: "", id: "oc1", version: 3 };
    const ac = aceptadoDeOrden(recs, "oc1");
    assert.equal(revisarOrden(todo, { ...base, lineas: [{ requisicionLineaId: "rl-blq", cantidad: 599 }] }, enModificacion, req, comp, cot, [enModificacion], ac), "bajo-lo-recibido");
    assert.equal(revisarOrden(todo, { ...base, lineas: [{ requisicionLineaId: "rl-cem", cantidad: 20 }] }, enModificacion, req, comp, cot, [enModificacion], ac), "bajo-lo-recibido");
    assert.equal(revisarOrden(todo, { ...base, lineas: [{ requisicionLineaId: "rl-blq", cantidad: 600 }] }, enModificacion, req, comp, cot, [enModificacion], ac), null);
  });
});

describe("lo pendiente por recibir", () => {
  it("separa lo aprobado de lo que está en trámite y dice si la orden está completa", () => {
    const recs = [recepcion("r1", "aprobada", [["rl-blq", 1000, 0], ["rl-cem", 12, 2]]), recepcion("r2", "enviada", [["rl-cem", 5, 0]])];
    const [o] = ordenesPorRecibir([orden], recs, []);
    assert.deepEqual(
      o.lineas.map((l) => [l.aceptado, l.enTramite, l.rechazado, l.pendiente]),
      [
        [1000, 0, 0, 0],
        [10, 5, 2, 5],
      ]
    );
    assert.equal(avanceRecepcion(o).estado, "parcial");
    assert.deepEqual([...recibidoPorInsumo(recs)], [["blq", 1000], ["cem", 10]]);
    const completa = ordenesPorRecibir([orden], [...recs, recepcion("r3", "aprobada", [["rl-cem", 10, 0]])], [])[0];
    assert.deepEqual(avanceRecepcion(completa), { estado: "completa", pct: 100 });
    // A cancelled order with no receptions isn't listed.
    assert.equal(ordenesPorRecibir([{ ...orden, estado: "anulada" }], [], []).length, 0);
  });
});
