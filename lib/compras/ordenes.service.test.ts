import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Caller, ServiceError } from "../propiedades/service";
import type { ProjectContacts } from "../propiedades/types";
import { memoriaLectura } from "./presupuestoLectura";
import {
  accionComparativo,
  accionOrden,
  accionRequisicion,
  activar,
  Ctx,
  getAccesos,
  getAuditoria,
  getCotizaciones,
  getInsumos,
  getOrdenes,
  guardarConfig,
  guardarCotizacion,
  guardarOrden,
  guardarProveedor,
  guardarRequisicion,
  guardarRol,
  guardarUsuario,
} from "./service";
import { ComprasStore, memoryStore } from "./store";
import type { CambioOrden, Rol } from "./types";

const OBRA = "obra1";
const HOY = "2026-10-16";
const persona = (id: string, name: string, isAdmin = false): Caller => ({ id, name, isAdmin });
const ana = persona("ana", "Ana Gómez", true);
const luis = persona("luis", "Luis Pérez");
const marta = persona("marta", "Marta Díaz");
const pedro = persona("pedro", "Pedro Rojas");
const jorge = persona("jorge", "Jorge Ruiz");
const sara = persona("sara", "Sara León");
const fede = persona("fede", "Federico Mora");
const olga = persona("olga", "Olga Ríos");
const EQUIPO: ProjectContacts = { users: [ana, luis, marta, pedro, jorge, sara, fede, olga].map((p) => ({ id: p.id, name: p.name, email: `${p.id}@obra.co`, pending: false })), groups: [] };

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
              { id: "muro", tipo: "partida", nivel: 0, codigo: "", descripcion: "MURO", unidad: "M2", omniclass: "", rendimiento: 10, jornada: 8, metrado: 100, origenId: null, componentes: [{ tipo: "insumo", id: "blq", cuadrilla: null, cantidad: 12.5 }, { tipo: "insumo", id: "cem", cuadrilla: null, cantidad: 0.2 }] },
            ],
          },
        ],
        insumos: {
          blq: { codigo: "MT-04", descripcion: "BLOQUE No. 5", unidad: "UND", precio: 2_100, tipo: "MT", iu: "", omniclass: "" },
          cem: { codigo: "MT-01", descripcion: "CEMENTO", unidad: "BLS", precio: 32_000, tipo: "MT", iu: "", omniclass: "" },
        },
        subpartidas: {},
        gastos: { fijos: [], variables: [] },
      },
      version: 7,
      updatedAt: null,
      updatedBy: null,
    },
  },
});

const ctx = (store: ComprasStore, caller: Caller): Ctx => ({ projectId: OBRA, caller, store, presupuesto: lectura, hoy: HOY, deps: { contactos: async () => EQUIPO } });

async function rejects(promise: Promise<unknown>, status: number, code?: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof ServiceError, String(err));
    assert.equal(err.status, status, err.message);
    if (code) assert.equal(err.code, code, err.message);
    return true;
  });
}

/** Approved requisition (blocks 1000, cement 20) whose comparison chose A (blocks 800 at 2,000; cement 20 at 31,000). */
async function obra() {
  const store = memoryStore(() => HOY);
  await activar(ctx(store, ana));
  const { roles } = await getAccesos(ctx(store, ana));
  const rol = (clave: string) => (roles.find((r) => r.clave === clave) as Rol).id;
  for (const [u, c] of [["luis", "residente"], ["marta", "presupuesto_costos"], ["pedro", "compras"], ["jorge", "director"], ["sara", "juridica"], ["fede", "finanzas"], ["olga", "almacen"]]) {
    await guardarUsuario(ctx(store, ana), { userId: u, rolId: rol(c), desde: HOY, hasta: null, activo: true, version: 0 });
  }
  await guardarConfig(ctx(store, ana), { toleranciaPct: 0, minCotizaciones: 1, version: 0 });
  const borrador = {
    fechaRequerida: "2026-10-30", prioridad: "normal" as const, justificacion: "Muros piso 1",
    lineas: [{ insumoId: "blq", partidaItemId: null, cantidad: 1000, justificacionExceso: "" }, { insumoId: "cem", partidaItemId: null, cantidad: 20, justificacionExceso: "" }], version: 0,
  };
  const r0 = (await guardarRequisicion(ctx(store, luis), borrador)).requisiciones[0];
  await accionRequisicion(ctx(store, luis), r0.id, { accion: "enviar", motivo: "", version: 1 });
  await accionRequisicion(ctx(store, marta), r0.id, { accion: "aprobar", motivo: "", version: 2 });
  const { proveedores } = await guardarProveedor(ctx(store, pedro), {
    nit: "890903938", tipoPersona: "juridica", razonSocial: "Ferretería A", nombreComercial: "", contacto: "", telefono: "", correo: "", ciudad: "", direccion: "", categorias: ["MT"], responsableIva: true, observaciones: "", version: 0,
  });
  const req = (await getCotizaciones(ctx(store, pedro))).requisiciones[0];
  const [l1, l2] = req.lineas;
  const { cotizaciones } = await guardarCotizacion(ctx(store, pedro), {
    requisicionId: req.id, proveedorId: proveedores[0].id, referencia: "", fecha: "2026-10-12", vigenciaHasta: "2026-11-12", plazoEntregaDias: 5, diasPago: 30, anticipoPct: 0, formaPago: "", observaciones: "",
    lineas: [
      { requisicionLineaId: l1.id, cantidad: 800, precioUnitario: 2_000, descuentoPct: 0, ivaPct: 19 },
      { requisicionLineaId: l2.id, cantidad: 20, precioUnitario: 31_000, descuentoPct: 0, ivaPct: 19 },
    ],
    version: 0,
  });
  const base = { criterios: { precio: 70, entrega: 20, pago: 10 }, cotizacionElegidaId: cotizaciones[0].id, justificacion: "Solo tiene 800 bloques disponibles", motivo: "" };
  await accionComparativo(ctx(store, pedro), req.id, { ...base, accion: "proponer", version: 0 });
  await accionComparativo(ctx(store, jorge), req.id, { ...base, accion: "aprobar", version: 1 });
  return { store, req, l1: l1.id, l2: l2.id };
}

const orden = (req: { id: string }, lineas: CambioOrden["lineas"], extra: Partial<CambioOrden> = {}): CambioOrden => ({
  tipo: "orden", requisicionId: req.id, fechaEntrega: "2026-10-25", lugarEntrega: "Obra Torre Norte", formaPago: "Crédito 30 días", diasPago: 30, anticipoPct: 0,
  retencionGarantiaPct: 0, objeto: "", polizas: "", observaciones: "", lineas, version: 0, ...extra,
});

describe("órdenes de compra", () => {
  it("salen del proveedor elegido con los precios de su cotización", async () => {
    const { store, req, l1, l2 } = await obra();
    const r = await guardarOrden(ctx(store, pedro), orden(req, [{ requisicionLineaId: l1, cantidad: 500, precioUnitario: 1 }, { requisicionLineaId: l2, cantidad: 20 }]));
    const oc = r.ordenes[0];
    assert.equal(oc.numero, 1);
    assert.deepEqual(oc.lineas.map((l) => [l.descripcion, l.cantidad, l.precioUnitario]), [["BLOQUE No. 5", 500, 2_000], ["CEMENTO", 20, 31_000]]);
    assert.equal(r.porOrdenar.length, 1);
  });

  it("no se compromete dos veces: lo que queda es lo cotizado menos las otras órdenes", async () => {
    const { store, req, l1 } = await obra();
    await guardarOrden(ctx(store, pedro), orden(req, [{ requisicionLineaId: l1, cantidad: 500 }]));
    await rejects(guardarOrden(ctx(store, pedro), orden(req, [{ requisicionLineaId: l1, cantidad: 301 }])), 409, "doble-compromiso");
    await guardarOrden(ctx(store, pedro), orden(req, [{ requisicionLineaId: l1, cantidad: 300 }]));
    await rejects(guardarOrden(ctx(store, sara), orden(req, [{ requisicionLineaId: l1, cantidad: 1 }], { tipo: "contrato" })), 409, "doble-compromiso");
    await rejects(guardarOrden(ctx(store, pedro), orden(req, [{ requisicionLineaId: l1, cantidad: 1 }], { tipo: "contrato" })), 403, "sin-permiso");
  });

  it("se emite con la aprobación de otra persona y queda comprometido en los insumos", async () => {
    const { store, req, l1 } = await obra();
    const oc = (await guardarOrden(ctx(store, pedro), orden(req, [{ requisicionLineaId: l1, cantidad: 500 }]))).ordenes[0];
    await accionOrden(ctx(store, pedro), oc.id, { accion: "enviar", motivo: "", version: 1 });
    await rejects(accionOrden(ctx(store, pedro), oc.id, { accion: "aprobar", motivo: "", version: 2 }), 403, "sin-permiso");
    const emitida = (await accionOrden(ctx(store, jorge), oc.id, { accion: "aprobar", motivo: "", version: 2 })).ordenes[0];
    assert.deepEqual([emitida.estado, emitida.aprobadaPor], ["aprobada", "Jorge Ruiz"]);
    const blq = (await getInsumos(ctx(store, pedro))).insumos.find((i) => i.id === "blq")!;
    assert.deepEqual([blq.solicitado, blq.aprobado, blq.comprometido], [1000, 1000, 500]);
    // Its requisition can't be cancelled while the order is in force.
    await rejects(accionRequisicion(ctx(store, jorge), req.id, { accion: "anular", motivo: "x", version: 3 }), 409, "con-ordenes");
  });

  it("modificar una emitida guarda cómo era y abre una revisión que puede cambiar precios", async () => {
    const { store, req, l1 } = await obra();
    const oc = (await guardarOrden(ctx(store, pedro), orden(req, [{ requisicionLineaId: l1, cantidad: 500 }]))).ordenes[0];
    await accionOrden(ctx(store, pedro), oc.id, { accion: "enviar", motivo: "", version: 1 });
    await accionOrden(ctx(store, jorge), oc.id, { accion: "aprobar", motivo: "", version: 2 });
    await rejects(accionOrden(ctx(store, pedro), oc.id, { accion: "modificar", motivo: "", version: 3 }), 400, "motivo-requerido");
    const abierta = (await accionOrden(ctx(store, pedro), oc.id, { accion: "modificar", motivo: "Ajuste de precio pactado", version: 3 })).ordenes[0];
    assert.deepEqual([abierta.estado, abierta.revision], ["borrador", 1]);
    const r = await guardarOrden(ctx(store, pedro), { ...orden(req, [{ requisicionLineaId: l1, cantidad: 500, precioUnitario: 1_950 }]), id: oc.id, version: 4 });
    assert.equal(r.ordenes[0].lineas[0].precioUnitario, 1_950);
    await accionOrden(ctx(store, pedro), oc.id, { accion: "enviar", motivo: "", version: 5 });
    const final = await accionOrden(ctx(store, fede), oc.id, { accion: "aprobar", motivo: "", version: 6 });
    assert.equal(final.ordenes[0].aprobadaPor, "Federico Mora");
    assert.deepEqual(final.revisiones.map((x) => [x.revision, x.motivo, x.anterior.lineas[0].precioUnitario, x.anterior.total]), [[0, "Ajuste de precio pactado", 2_000, 1_190_000]]);
  });

  it("el contrato pide objeto; quien lo elabora no lo aprueba; anular libera la cantidad", async () => {
    const { store, req, l1 } = await obra();
    const oc = (await guardarOrden(ctx(store, pedro), orden(req, [{ requisicionLineaId: l1, cantidad: 800 }]))).ordenes[0];
    await rejects(accionOrden(ctx(store, pedro), oc.id, { accion: "anular", motivo: "", version: 1 }), 400, "motivo-requerido");
    await accionOrden(ctx(store, pedro), oc.id, { accion: "anular", motivo: "Se hará por contrato", version: 1 });
    const ct = (await guardarOrden(ctx(store, sara), orden(req, [{ requisicionLineaId: l1, cantidad: 800 }], { tipo: "contrato" }))).ordenes.find((o) => o.tipo === "contrato")!;
    await rejects(accionOrden(ctx(store, sara), ct.id, { accion: "enviar", motivo: "", version: 1 }), 400, "objeto-requerido");
    await guardarOrden(ctx(store, sara), { ...orden(req, [{ requisicionLineaId: l1, cantidad: 800 }], { tipo: "contrato", objeto: "Suministro de bloque No. 5", polizas: "Cumplimiento 10 %" }), id: ct.id, version: 1 });
    await accionOrden(ctx(store, sara), ct.id, { accion: "enviar", motivo: "", version: 2 });
    // Ana (administrator) prepares another one and can't approve it herself.
    const propia = (await guardarOrden(ctx(store, ana), orden(req, [{ requisicionLineaId: (await getOrdenes(ctx(store, ana))).porOrdenar[0].requisicion.lineas[1].id, cantidad: 20 }]))).ordenes.find((o) => o.elaboradoPorId === "ana")!;
    await accionOrden(ctx(store, ana), propia.id, { accion: "enviar", motivo: "", version: 1 });
    await rejects(accionOrden(ctx(store, ana), propia.id, { accion: "aprobar", motivo: "", version: 2 }), 403, "auto-aprobacion");
    const negados = (await getAuditoria(ctx(store, ana), new URLSearchParams({ resultado: "denegado", modulo: "ordenes" }))).entradas;
    assert.deepEqual(negados.map((e) => e.detalle.motivo), ["auto-aprobacion"]);
  });

  it("cada rol ve solo los tipos que su permiso deja: Almacén ve órdenes, no contratos", async () => {
    const { store, req, l1 } = await obra();
    await guardarOrden(ctx(store, pedro), orden(req, [{ requisicionLineaId: l1, cantidad: 100 }]));
    await guardarOrden(ctx(store, sara), orden(req, [{ requisicionLineaId: l1, cantidad: 100 }], { tipo: "contrato" }));
    assert.deepEqual((await getOrdenes(ctx(store, olga))).ordenes.map((o) => o.tipo), ["orden"]);
    assert.deepEqual((await getOrdenes(ctx(store, sara))).ordenes.map((o) => o.tipo).sort(), ["contrato", "orden"]);
    const { roles } = await guardarRol(ctx(store, ana), { nombre: "Visitante", descripcion: "", permisos: ["insumos.ver"], activo: true, version: 0 });
    const visitante = roles.find((r) => r.nombre === "Visitante")!;
    await guardarUsuario(ctx(store, ana), { userId: "marta", rolId: visitante.id, desde: HOY, hasta: null, activo: true, version: 1 });
    await rejects(getOrdenes(ctx(store, marta)), 403, "sin-permiso");
  });
});
