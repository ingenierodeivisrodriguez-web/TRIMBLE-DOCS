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
  getPanel,
  getRecepciones,
  guardarConfig,
  guardarCotizacion,
  guardarOrden,
  guardarProveedor,
  guardarRecepcion,
  guardarRequisicion,
  guardarUsuario,
} from "./service";
import { llenarLibro } from "./excelPanel";
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

const valor = (p: Awaited<ReturnType<typeof getPanel>>, clave: string) => p.indicadores.find((i) => i.clave === clave)?.valor;

describe("panel de compras", () => {
  it("sin órdenes, lo que no se puede calcular dice sin datos (null), no cero", async () => {
    const { store } = await obra();
    const p = await getPanel(ctx(store, ana));
    assert.equal(valor(p, "comprometido"), 0);
    for (const clave of ["valor-comprometido", "desviacion", "recibido", "rechazo"]) assert.equal(valor(p, clave), null, clave);
    assert.equal(valor(p, "tiempo-aprobacion"), 0);
    assert.equal(valor(p, "expedientes"), 1);
  });

  it("compara lo comprado con el presupuesto y mide lo recibido y lo rechazado", async () => {
    const { store, oc, l1 } = await emitida();
    let p = await getPanel(ctx(store, marta));
    // 500 blocks at 2,000 and 20 bags at 31,000 = 1,620,000; at budget prices 1,050,000 + 640,000 = 1,690,000.
    assert.equal(valor(p, "valor-comprometido"), 1_620_000);
    assert.equal(valor(p, "desviacion"), -4.14);
    const blq = p.filas.find((f) => f.id === "blq")!;
    assert.deepEqual([blq.planificado, blq.solicitado, blq.comprometido, blq.porSolicitar, blq.valorComprometido], [1250, 1000, 500, 250, 1_000_000]);
    const rec = (await guardarRecepcion(ctx(store, luis), recibo(oc, [ln(l1, 320, 20, 20)]))).recepciones[0];
    await accionRecepcion(ctx(store, luis), rec.id, { accion: "enviar", motivo: "", version: 1 });
    assert.equal(valor(await getPanel(ctx(store, marta)), "por-aprobar"), 1);
    await accionRecepcion(ctx(store, olga), rec.id, { accion: "aprobar", motivo: "", version: 2 });
    p = await getPanel(ctx(store, marta));
    // 300 accepted at 2,000 = 600,000 of 1,620,000.
    assert.equal(valor(p, "recibido"), 37.04);
    assert.equal(valor(p, "rechazo"), 6.25);
    assert.equal(p.indicadores.find((i) => i.clave === "rechazo")?.alerta, true);
    assert.deepEqual([p.filas.find((f) => f.id === "blq")!.recibido, p.filas.find((f) => f.id === "blq")!.porRecibir, p.filas.find((f) => f.id === "blq")!.rechazado], [300, 200, 20]);
  });

  it("la ruta del insumo va de la requisición a la recepción y solo muestra lo que cada rol puede ver", async () => {
    const { store, oc, l1 } = await emitida();
    await guardarRecepcion(ctx(store, luis), recibo(oc, [ln(l1, 100)]));
    const ruta = (await getPanel(ctx(store, ana))).rutas.blq;
    assert.equal(ruta.length, 1);
    const [r] = ruta;
    assert.deepEqual([r.requisicion.numero, r.requisicion.cantidad, r.requisicion.aprobada], [1, 1000, 1000]);
    assert.deepEqual(r.cotizaciones?.map((c) => [c.proveedor, c.cantidad, c.precioNeto, c.elegida]), [["Ferretería A", 800, 2000, true]]);
    assert.deepEqual(r.ordenes?.map((o) => [o.numero, o.cantidad, o.recepciones?.map((x) => [x.numero, x.aceptado, x.estado])]), [[1, 500, [[1, 100, "borrador"]]]]);
    // Finance sees orders and receptions but not requisitions: no path; Almacén has no panel at all.
    const fin = await getPanel(ctx(store, fede));
    assert.deepEqual([fin.ve.requisiciones, Object.keys(fin.rutas).length], [false, 0]);
    await assert.rejects(getPanel(ctx(store, olga)), (e: unknown) => e instanceof ServiceError && e.status === 403);
  });
});

describe("panel en Excel", () => {
  it("lleva los indicadores (sin datos dicho en palabras), los insumos y la ruta etapa por etapa", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { store, oc, l1 } = await emitida();
    await guardarRecepcion(ctx(store, luis), recibo(oc, [ln(l1, 100)]));
    const p = await getPanel(ctx(store, ana));
    const wb = new ExcelJS.Workbook();
    llenarLibro(wb, p, "Torre Norte");
    assert.deepEqual(wb.worksheets.map((w) => w.name), ["Indicadores", "Insumos", "Trazabilidad"]);
    const ind = wb.getWorksheet("Indicadores")!;
    const rechazo = ind.getSheetValues().find((r) => Array.isArray(r) && r[1] === "Rechazado en obra") as unknown[];
    assert.equal(rechazo[2], "Sin datos suficientes");
    const etapas = (wb.getWorksheet("Trazabilidad")!.getSheetValues() as unknown[][]).filter((r) => r && r[1] === "MT-04").map((r) => `${r[3]} ${r[4]}`);
    assert.deepEqual(etapas, ["Requisición REQ-0001", "Cotización COT-0001", "Orden de compra OC-0001", "Recepción REC-0001"]);
  });
});
