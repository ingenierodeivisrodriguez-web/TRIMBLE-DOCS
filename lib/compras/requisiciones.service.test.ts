import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Caller, ServiceError } from "../propiedades/service";
import type { ProjectContacts } from "../propiedades/types";
import { memoriaLectura } from "./presupuestoLectura";
import { accionRequisicion, activar, Ctx, getAccesos, getAuditoria, getInsumos, getRequisiciones, guardarConfig, guardarRequisicion, guardarUsuario } from "./service";
import { ComprasStore, memoryStore } from "./store";
import type { CambioRequisicion, Rol } from "./types";

const OBRA = "obra1";
const HOY = "2026-10-16";
const ana: Caller = { id: "ana", name: "Ana Gómez", isAdmin: true };
const luis: Caller = { id: "luis", name: "Luis Pérez", isAdmin: false };
const marta: Caller = { id: "marta", name: "Marta Díaz", isAdmin: false };
const jorge: Caller = { id: "jorge", name: "Jorge Ruiz", isAdmin: false };
const EQUIPO: ProjectContacts = { users: [ana, luis, marta, jorge].map((p) => ({ id: p.id, name: p.name, email: `${p.id}@obra.co`, pending: false })), groups: [] };

// Wall: 60 m2 from the model × 12.5 blocks = 750 blocks planned.
const lectura = memoriaLectura({
  [OBRA]: {
    documento: {
      data: {
        subpresupuestos: [
          {
            id: "sp1",
            nombre: "ESTRUCTURA",
            pie: [],
            items: [
              { id: "muro", tipo: "partida", nivel: 0, codigo: "", descripcion: "MURO", unidad: "M2", omniclass: "", rendimiento: 10, jornada: 8, metrado: 50, origenId: null, componentes: [{ tipo: "insumo", id: "blq", cuadrilla: null, cantidad: 12.5 }] },
            ],
          },
        ],
        insumos: { blq: { codigo: "MT-04", descripcion: "BLOQUE No. 5", unidad: "UND", precio: 2_100, tipo: "MT", iu: "", omniclass: "" } },
        subpartidas: {},
        gastos: { fijos: [], variables: [] },
      },
      version: 7,
      updatedAt: null,
      updatedBy: null,
    },
    mediciones: [{ itemId: "muro", campo: "Area", campoLabel: "Área", unidad: "M2" }],
    resumen: [{ itemId: "muro", elementos: 2, suma: 60 }],
  },
});

const ctx = (store: ComprasStore, caller: Caller): Ctx => ({ projectId: OBRA, caller, store, presupuesto: lectura, hoy: HOY, deps: { contactos: async () => EQUIPO } });

async function rejects(promise: Promise<unknown>, status: number, code?: string, texto?: RegExp) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof ServiceError, String(err));
    assert.equal(err.status, status, err.message);
    if (code) assert.equal(err.code, code, err.message);
    if (texto) assert.match(err.message, texto);
    return true;
  });
}

async function obra() {
  const store = memoryStore(() => HOY);
  await activar(ctx(store, ana));
  const { roles } = await getAccesos(ctx(store, ana));
  const rol = (clave: string) => (roles.find((r) => r.clave === clave) as Rol).id;
  for (const [u, c] of [["luis", "residente"], ["marta", "presupuesto_costos"], ["jorge", "director"]]) {
    await guardarUsuario(ctx(store, ana), { userId: u, rolId: rol(c), desde: HOY, hasta: null, activo: true, version: 0 });
  }
  return store;
}

const borrador = (cantidad: number, extra: Partial<CambioRequisicion> = {}): CambioRequisicion => ({
  fechaRequerida: "2026-10-25",
  prioridad: "alta",
  justificacion: "Muros del piso 2",
  lineas: [{ insumoId: "blq", partidaItemId: "muro", cantidad, justificacionExceso: "" }],
  version: 0,
  ...extra,
});

/** Creates a requisition and returns it (the newest). */
async function crear(store: ComprasStore, caller: Caller, cantidad: number, extra: Partial<CambioRequisicion> = {}) {
  const r = await guardarRequisicion(ctx(store, caller), borrador(cantidad, extra));
  return r.requisiciones[0];
}
const enviar = (store: ComprasStore, caller: Caller, id: string, version: number) => accionRequisicion(ctx(store, caller), id, { accion: "enviar", motivo: "", version });

describe("requisiciones: crear y enviar", () => {
  it("la línea toma del presupuesto los datos del insumo y el envío guarda lo planificado y la versión", async () => {
    const store = await obra();
    const r = await crear(store, luis, 500);
    assert.equal(r.numero, 1);
    assert.equal(r.estado, "borrador");
    assert.equal(r.solicitanteNombre, "Luis Pérez");
    assert.deepEqual([r.lineas[0].codigo, r.lineas[0].descripcion, r.lineas[0].unidad, r.lineas[0].precio], ["MT-04", "BLOQUE No. 5", "UND", 2_100]);
    const enviada = (await enviar(store, luis, r.id, 1)).requisiciones[0];
    assert.equal(enviada.estado, "enviada");
    assert.equal(enviada.presupuestoVersion, 7);
    assert.equal(enviada.lineas[0].planificado, 750);
    await rejects(guardarRequisicion(ctx(store, luis), { ...borrador(1), id: r.id, version: 2 }), 409, "estado-no-valido");
  });

  it("solo insumos del presupuesto, en partidas que los usan, y sin repetir", async () => {
    const store = await obra();
    await rejects(guardarRequisicion(ctx(store, luis), borrador(1, { lineas: [{ insumoId: "otro", partidaItemId: null, cantidad: 1, justificacionExceso: "" }] })), 400, "insumo-no-valido");
    await rejects(guardarRequisicion(ctx(store, luis), borrador(1, { lineas: [{ insumoId: "blq", partidaItemId: "losa", cantidad: 1, justificacionExceso: "" }] })), 400, "insumo-no-valido");
    const dos = { insumoId: "blq", partidaItemId: null, cantidad: 1, justificacionExceso: "" };
    await rejects(guardarRequisicion(ctx(store, luis), borrador(1, { lineas: [dos, dos] })), 409, "linea-duplicada");
    await rejects(guardarRequisicion(ctx(store, marta), borrador(1)), 403, "sin-permiso");
  });

  it("no se pide más de lo planificado sin justificarlo, y el mensaje dice cuánto", async () => {
    const store = await obra();
    const r1 = await crear(store, luis, 500);
    await enviar(store, luis, r1.id, 1);
    const r2 = await crear(store, luis, 300);
    await rejects(enviar(store, luis, r2.id, 1), 409, "cantidad-excedida", /BLOQUE No\. 5: se pedirían 800\.0000 UND en total \(ya pedidos 500\.0000\) y el límite es 750\.0000/);
    // With 10 % of tolerance the limit is 825.
    await rejects(guardarConfig(ctx(store, luis), { toleranciaPct: 10, version: 0 }), 403, "sin-permiso");
    await guardarConfig(ctx(store, ana), { toleranciaPct: 10, version: 0 });
    assert.equal((await enviar(store, luis, r2.id, 1)).requisiciones[0].estado, "enviada");
  });

  it("dos personas enviando a la vez no pasan juntas el límite", async () => {
    const store = await obra();
    const a = await crear(store, luis, 400);
    const b = await crear(store, luis, 400);
    const resultados = await Promise.allSettled([enviar(store, luis, a.id, 1), enviar(store, luis, b.id, 1)]);
    assert.deepEqual(resultados.map((x) => x.status).sort(), ["fulfilled", "rejected"]);
    const { requisiciones } = await getRequisiciones(ctx(store, luis));
    assert.equal(requisiciones.filter((r) => r.estado === "enviada").length, 1);
  });
});

describe("requisiciones: aprobar, rechazar y anular", () => {
  it("se aprueba una parte y los insumos muestran lo solicitado y lo aprobado", async () => {
    const store = await obra();
    const r = await crear(store, luis, 500);
    await enviar(store, luis, r.id, 1);
    const aprobada = (await accionRequisicion(ctx(store, marta), r.id, { accion: "aprobar", motivo: "Por ahora 300", aprobadas: { [r.lineas[0].id]: 300 }, version: 2 })).requisiciones[0];
    assert.equal(aprobada.estado, "aprobada");
    assert.equal(aprobada.lineas[0].cantidadAprobada, 300);
    assert.equal(aprobada.decididaPor, "Marta Díaz");
    const blq = (await getInsumos(ctx(store, luis))).insumos[0];
    assert.deepEqual([blq.cantidad, blq.solicitado, blq.aprobado], [750, 300, 300]);
  });

  it("quien pide no aprueba la suya, y sin permiso tampoco; ambas cosas quedan en la auditoría", async () => {
    const store = await obra();
    const propia = await crear(store, ana, 10);
    await enviar(store, ana, propia.id, 1);
    await rejects(accionRequisicion(ctx(store, ana), propia.id, { accion: "aprobar", motivo: "", version: 2 }), 403, "auto-aprobacion");
    const r = await crear(store, luis, 10);
    await enviar(store, luis, r.id, 1);
    await rejects(accionRequisicion(ctx(store, luis), r.id, { accion: "aprobar", motivo: "", version: 2 }), 403);
    const negados = (await getAuditoria(ctx(store, ana), new URLSearchParams({ resultado: "denegado", modulo: "requisiciones" }))).entradas;
    assert.deepEqual(
      negados.map((e) => [e.accion, e.detalle.motivo]),
      [
        ["requisiciones.aprobar", "sin-permiso"],
        ["requisiciones.aprobar", "auto-aprobacion"],
      ]
    );
  });

  it("aprobar por encima del presupuesto solo con el permiso especial", async () => {
    const store = await obra();
    const r1 = await crear(store, luis, 700);
    await enviar(store, luis, r1.id, 1);
    const r2 = await crear(store, luis, 100, { lineas: [{ insumoId: "blq", partidaItemId: "muro", cantidad: 100, justificacionExceso: "Reposición por daño" }] });
    await enviar(store, luis, r2.id, 1);
    await rejects(accionRequisicion(ctx(store, marta), r2.id, { accion: "aprobar", motivo: "", version: 2 }), 403, "exceso-sin-permiso");
    const r = await accionRequisicion(ctx(store, jorge), r2.id, { accion: "aprobar", motivo: "Autorizado por dirección", version: 2 });
    assert.equal(r.requisiciones.find((x) => x.id === r2.id)?.estado, "aprobada");
  });

  it("rechazar, devolver y anular piden motivo; la devuelta vuelve a borrador y se puede corregir", async () => {
    const store = await obra();
    const r = await crear(store, luis, 50);
    await enviar(store, luis, r.id, 1);
    await rejects(accionRequisicion(ctx(store, marta), r.id, { accion: "devolver", motivo: "", version: 2 }), 400, "motivo-requerido");
    const devuelta = (await accionRequisicion(ctx(store, marta), r.id, { accion: "devolver", motivo: "Indica el piso", version: 2 })).requisiciones[0];
    assert.deepEqual([devuelta.estado, devuelta.motivo], ["borrador", "Indica el piso"]);
    await guardarRequisicion(ctx(store, luis), { ...borrador(40, { justificacion: "Muros del piso 2, eje A-C" }), id: r.id, version: 3 });
    await enviar(store, luis, r.id, 4);
    const anulada = (await accionRequisicion(ctx(store, luis), r.id, { accion: "anular", motivo: "Se cambió a muro en drywall", version: 5 })).requisiciones[0];
    assert.equal(anulada.estado, "anulada");
    await rejects(accionRequisicion(ctx(store, jorge), r.id, { accion: "aprobar", motivo: "", version: 6 }), 409, "estado-no-valido");
  });
});
