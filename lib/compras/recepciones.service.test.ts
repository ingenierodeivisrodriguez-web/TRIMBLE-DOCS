import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Caller, ServiceError } from "../propiedades/service";
import type { ProjectContacts } from "../propiedades/types";
import { memoriaLectura } from "./presupuestoLectura";
import {
  accionComparativo,
  accionOrden,
  accionRecepcion,
  accionRequisicion,
  activar,
  Ctx,
  getAccesos,
  getAuditoria,
  getCotizaciones,
  getInsumos,
  getOrdenes,
  getRecepciones,
  guardarConfig,
  guardarCotizacion,
  guardarOrden,
  guardarProveedor,
  guardarRecepcion,
  guardarRequisicion,
  guardarUsuario,
} from "./service";
import { ComprasStore, memoryStore } from "./store";
import type { CambioOrden, CambioRecepcion, Rol } from "./types";

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

/** OC-0001 issued: 500 blocks and 20 cement bags. */
async function emitida() {
  const o = await obra();
  const r = await guardarOrden(ctx(o.store, pedro), orden(o.req, [{ requisicionLineaId: o.l1, cantidad: 500 }, { requisicionLineaId: o.l2, cantidad: 20 }]));
  const oc = r.ordenes[0];
  await accionOrden(ctx(o.store, pedro), oc.id, { accion: "enviar", motivo: "", version: 1 });
  await accionOrden(ctx(o.store, jorge), oc.id, { accion: "aprobar", motivo: "", version: 2 });
  return { ...o, oc: oc.id };
}

const recibo = (ordenId: string, lineas: CambioRecepcion["lineas"], extra: Partial<CambioRecepcion> = {}): CambioRecepcion => ({
  ordenId, fecha: HOY, remision: "R-881", observaciones: "", lineas, version: 0, ...extra,
});
const ln = (requisicionLineaId: string, recibido: number, rechazado = 0, devuelto = 0, motivo = rechazado ? "Rotos en el cargue" : "") => ({ requisicionLineaId, recibido, rechazado, devuelto, motivo });

describe("recepción en obra", () => {
  it("el residente registra, almacén aprueba; queda en lo recibido del insumo y en lo pendiente de la orden", async () => {
    const { store, oc, l1, l2 } = await emitida();
    const d = await guardarRecepcion(ctx(store, luis), recibo(oc, [ln(l1, 320, 20, 20), ln(l2, 20)]));
    const rec = d.recepciones[0];
    assert.equal(rec.numero, 1);
    assert.deepEqual(rec.lineas.map((l) => [l.recibido, l.aceptado, l.rechazado, l.devuelto]), [[320, 300, 20, 20], [20, 20, 0, 0]]);
    assert.equal(d.ordenes[0].lineas[0].enTramite, 300);
    await accionRecepcion(ctx(store, luis), rec.id, { accion: "enviar", motivo: "", version: 1 });
    await rejects(accionRecepcion(ctx(store, luis), rec.id, { accion: "aprobar", motivo: "", version: 2 }), 403, "sin-permiso");
    const fin = await accionRecepcion(ctx(store, olga), rec.id, { accion: "aprobar", motivo: "", version: 2 });
    assert.equal(fin.recepciones[0].estado, "aprobada");
    assert.deepEqual(fin.ordenes[0].lineas.map((l) => [l.ordenado, l.aceptado, l.pendiente]), [[500, 300, 200], [20, 20, 0]]);
    const insumos = await getInsumos(ctx(store, luis));
    assert.equal(insumos.insumos.find((i) => i.id === "blq")?.recibido, 300);
    // Who receives sees the order without prices.
    assert.equal("precioUnitario" in fin.ordenes[0].lineas[0], false);
  });

  it("no se acepta más de lo ordenado, ni contra una orden sin emitir; sin permiso queda en la auditoría", async () => {
    const { store, oc, l1, req } = await emitida();
    await rejects(guardarRecepcion(ctx(store, luis), recibo(oc, [ln(l1, 501)])), 409, "recepcion-excedida");
    await guardarRecepcion(ctx(store, luis), recibo(oc, [ln(l1, 400)]));
    await rejects(guardarRecepcion(ctx(store, olga), recibo(oc, [ln(l1, 101)])), 409, "recepcion-excedida");
    await rejects(guardarRecepcion(ctx(store, luis), recibo(oc, [ln(l1, 10)], { fecha: "2026-10-17" })), 400, "fecha-futura");
    await rejects(guardarRecepcion(ctx(store, marta), recibo(oc, [ln(l1, 1)])), 403, "sin-permiso");
    const borrador = (await guardarOrden(ctx(store, pedro), orden(req, [{ requisicionLineaId: l1, cantidad: 300 }]))).ordenes.find((o) => o.estado === "borrador")!;
    await rejects(guardarRecepcion(ctx(store, luis), recibo(borrador.id, [ln(l1, 1)])), 409, "orden-no-emitida");
    const audit = await getAuditoria(ctx(store, ana), new URLSearchParams({ modulo: "recepciones" }));
    assert.ok(audit.entradas.some((e) => e.actorId === "marta" && e.resultado === "denegado"));
  });

  it("la orden respeta lo recibido: no se anula y no se baja de lo aceptado", async () => {
    const { store, oc, l1, l2, req } = await emitida();
    const rec = (await guardarRecepcion(ctx(store, luis), recibo(oc, [ln(l1, 200)]))).recepciones[0];
    await rejects(accionOrden(ctx(store, pedro), oc, { accion: "anular", motivo: "Ya no", version: 3 }), 409, "con-recepciones");
    await accionOrden(ctx(store, pedro), oc, { accion: "modificar", motivo: "Se reduce", version: 3 });
    await rejects(guardarRecepcion(ctx(store, luis), recibo(oc, [ln(l1, 1)])), 409, "orden-no-emitida");
    const cambio = (cantidad: number) => orden(req, [{ requisicionLineaId: l1, cantidad }, { requisicionLineaId: l2, cantidad: 20 }], { id: oc, version: 4 });
    await rejects(guardarOrden(ctx(store, pedro), cambio(199)), 409, "bajo-lo-recibido");
    await guardarOrden(ctx(store, pedro), cambio(200));
    // Cancelling the reception frees the order.
    await accionRecepcion(ctx(store, olga), rec.id, { accion: "anular", motivo: "Era de otra obra", version: 1 });
    const o = (await getOrdenes(ctx(store, pedro))).ordenes.find((x) => x.id === oc)!;
    await accionOrden(ctx(store, pedro), oc, { accion: "anular", motivo: "Ya no", version: o.version });
    const vista = await getRecepciones(ctx(store, luis));
    assert.deepEqual([vista.ordenes.length, vista.recepciones[0].estado], [0, "anulada"]);
  });
});
