import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Caller, ServiceError } from "../propiedades/service";
import type { ProjectContacts } from "../propiedades/types";
import { memoriaLectura } from "./presupuestoLectura";
import {
  accionComparativo,
  accionRequisicion,
  activar,
  anularCotizacion,
  Ctx,
  estadoProveedor,
  getAccesos,
  getAuditoria,
  getCotizaciones,
  getProveedores,
  guardarConfig,
  guardarCotizacion,
  guardarProveedor,
  guardarRequisicion,
  guardarUsuario,
} from "./service";
import { ComprasStore, memoryStore } from "./store";
import type { CambioCotizacion, Rol } from "./types";

const OBRA = "obra1";
const HOY = "2026-10-16";
const ana: Caller = { id: "ana", name: "Ana Gómez", isAdmin: true };
const luis: Caller = { id: "luis", name: "Luis Pérez", isAdmin: false };
const marta: Caller = { id: "marta", name: "Marta Díaz", isAdmin: false };
const pedro: Caller = { id: "pedro", name: "Pedro Rojas", isAdmin: false };
const jorge: Caller = { id: "jorge", name: "Jorge Ruiz", isAdmin: false };
const EQUIPO: ProjectContacts = { users: [ana, luis, marta, pedro, jorge].map((p) => ({ id: p.id, name: p.name, email: `${p.id}@obra.co`, pending: false })), groups: [] };

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

async function rejects(promise: Promise<unknown>, status: number, code?: string, texto?: RegExp) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof ServiceError, String(err));
    assert.equal(err.status, status, err.message);
    if (code) assert.equal(err.code, code, err.message);
    if (texto) assert.match(err.message, texto);
    return true;
  });
}

const proveedor = (nit: string, razonSocial: string, extra = {}) => ({
  nit, tipoPersona: "juridica" as const, razonSocial, nombreComercial: "", contacto: "", telefono: "", correo: "", ciudad: "Medellín", direccion: "",
  categorias: ["MT" as const], responsableIva: true, observaciones: "", version: 0, ...extra,
});

/** A project with an approved requisition (blocks 1000 and cement 20) and two suppliers. */
async function obra() {
  const store = memoryStore(() => HOY);
  await activar(ctx(store, ana));
  const { roles } = await getAccesos(ctx(store, ana));
  const rol = (clave: string) => (roles.find((r) => r.clave === clave) as Rol).id;
  for (const [u, c] of [["luis", "residente"], ["marta", "presupuesto_costos"], ["pedro", "compras"], ["jorge", "director"]]) {
    await guardarUsuario(ctx(store, ana), { userId: u, rolId: rol(c), desde: HOY, hasta: null, activo: true, version: 0 });
  }
  const borrador = {
    fechaRequerida: "2026-10-30", prioridad: "normal" as const, justificacion: "Muros piso 1",
    lineas: [{ insumoId: "blq", partidaItemId: null, cantidad: 1000, justificacionExceso: "" }, { insumoId: "cem", partidaItemId: null, cantidad: 20, justificacionExceso: "" }], version: 0,
  };
  const req = (await guardarRequisicion(ctx(store, luis), borrador)).requisiciones[0];
  await accionRequisicion(ctx(store, luis), req.id, { accion: "enviar", motivo: "", version: 1 });
  await accionRequisicion(ctx(store, marta), req.id, { accion: "aprobar", motivo: "", version: 2 });
  await guardarProveedor(ctx(store, pedro), proveedor("890903938", "Ferretería A"));
  const { proveedores } = await guardarProveedor(ctx(store, pedro), proveedor("800.197.268-4", "Materiales B"));
  const aprobada = (await getCotizaciones(ctx(store, pedro))).requisiciones[0];
  const pa = proveedores.find((p) => p.razonSocial === "Ferretería A")!;
  const pb = proveedores.find((p) => p.razonSocial === "Materiales B")!;
  return { store, req: aprobada, pa, pb };
}

function cotizacion(req: { id: string; lineas: { id: string; cantidadAprobada: number | null }[] }, proveedorId: string, precios: [number, number], extra: Partial<CambioCotizacion> = {}): CambioCotizacion {
  return {
    requisicionId: req.id, proveedorId, referencia: "", fecha: "2026-10-12", vigenciaHasta: "2026-11-12", plazoEntregaDias: 5, diasPago: 30, anticipoPct: 0, formaPago: "Crédito 30 días", observaciones: "",
    lineas: req.lineas.map((l, i) => ({ requisicionLineaId: l.id, cantidad: l.cantidadAprobada ?? 0, precioUnitario: precios[i], descuentoPct: 0, ivaPct: 19 })),
    version: 0, ...extra,
  };
}

const CRIT = { precio: 70, entrega: 20, pago: 10 };

describe("proveedores", () => {
  it("guarda el NIT con su dígito de verificación y no lo repite", async () => {
    const { store, pa } = await obra();
    assert.deepEqual([pa.nit, pa.dv, pa.estado], ["890903938", 8, "activo"]);
    await rejects(guardarProveedor(ctx(store, pedro), proveedor("890903938-7", "Otra")), 400, "datos", /es 8, no 7/);
    await rejects(guardarProveedor(ctx(store, pedro), proveedor("890903938", "Otra")), 409, "nit-repetido");
    await rejects(guardarProveedor(ctx(store, luis), proveedor("899999068", "X")), 403, "sin-permiso");
  });

  it("se bloquea con motivo y deja de poder cotizar; se reactiva", async () => {
    const { store, req, pb } = await obra();
    await rejects(estadoProveedor(ctx(store, pedro), pb.id, { estado: "bloqueado", motivo: "", version: 1 }), 400, "motivo-requerido");
    const r = await estadoProveedor(ctx(store, pedro), pb.id, { estado: "bloqueado", motivo: "RUT vencido", version: 1 });
    assert.equal(r.proveedores.find((p) => p.id === pb.id)?.motivoEstado, "RUT vencido");
    await rejects(guardarCotizacion(ctx(store, pedro), cotizacion(req, pb.id, [2_000, 31_000])), 409, "proveedor-no-activo");
    await estadoProveedor(ctx(store, pedro), pb.id, { estado: "activo", motivo: "", version: 2 });
    await guardarCotizacion(ctx(store, pedro), cotizacion(req, pb.id, [2_000, 31_000]));
    // The supplier's history shows the quotation.
    const { cotizaciones } = await getProveedores(ctx(store, pedro));
    assert.equal(cotizaciones.filter((c) => c.proveedorId === pb.id).length, 1);
  });
});

describe("cotizaciones y comparativo", () => {
  it("con menos cotizaciones que el mínimo hay que justificar; la mejor sin más razones pasa", async () => {
    const { store, req, pa, pb } = await obra();
    await guardarCotizacion(ctx(store, pedro), cotizacion(req, pa.id, [2_000, 31_000]));
    const r = await guardarCotizacion(ctx(store, pedro), cotizacion(req, pb.id, [2_050, 31_500], { plazoEntregaDias: 10 }));
    const qa = r.cotizaciones.find((c) => c.proveedorId === pa.id)!;
    const propuesta = { accion: "proponer" as const, criterios: CRIT, cotizacionElegidaId: qa.id, justificacion: "", motivo: "", version: 0 };
    await rejects(accionComparativo(ctx(store, pedro), req.id, propuesta), 400, "justificacion-requerida", /Hay 2 cotización\(es\) vigente\(s\) y se esperan al menos 3/);
    await guardarConfig(ctx(store, ana), { toleranciaPct: 0, minCotizaciones: 2, version: 0 });
    const hecha = await accionComparativo(ctx(store, pedro), req.id, propuesta);
    assert.equal(hecha.comparativos[0].estado, "propuesto");
    assert.equal(hecha.comparativos[0].propuestoPor, "Pedro Rojas");
    // With the comparison proposed, quotations are locked.
    await rejects(guardarCotizacion(ctx(store, pedro), { ...cotizacion(req, pa.id, [1, 1]), id: qa.id, version: 1 }), 409, "comparativo-cerrado");
    await rejects(anularCotizacion(ctx(store, pedro), qa.id, { motivo: "x", version: 1 } as never), 409, "comparativo-cerrado");
  });

  it("elegir una que no es la mejor exige justificación", async () => {
    const { store, req, pa, pb } = await obra();
    await guardarConfig(ctx(store, ana), { toleranciaPct: 0, minCotizaciones: 2, version: 0 });
    await guardarCotizacion(ctx(store, pedro), cotizacion(req, pa.id, [2_000, 31_000]));
    const r = await guardarCotizacion(ctx(store, pedro), cotizacion(req, pb.id, [2_500, 35_000]));
    const qb = r.cotizaciones.find((c) => c.proveedorId === pb.id)!;
    const propuesta = { accion: "proponer" as const, criterios: CRIT, cotizacionElegidaId: qb.id, justificacion: "", motivo: "", version: 0 };
    await rejects(accionComparativo(ctx(store, pedro), req.id, propuesta), 400, "justificacion-requerida", /no es la de mejor puntaje/);
    const ok = await accionComparativo(ctx(store, pedro), req.id, { ...propuesta, justificacion: "Entrega en obra incluida y crédito comprobado" });
    assert.equal(ok.comparativos[0].justificacion, "Entrega en obra incluida y crédito comprobado");
  });

  it("Compras propone y el Director aprueba o devuelve; quien propone no aprueba", async () => {
    const { store, req, pa, pb } = await obra();
    await guardarConfig(ctx(store, ana), { toleranciaPct: 0, minCotizaciones: 2, version: 0 });
    await guardarCotizacion(ctx(store, pedro), cotizacion(req, pa.id, [2_000, 31_000]));
    const r = await guardarCotizacion(ctx(store, pedro), cotizacion(req, pb.id, [2_500, 35_000]));
    const qa = r.cotizaciones.find((c) => c.proveedorId === pa.id)!;
    const base = { criterios: CRIT, cotizacionElegidaId: qa.id, justificacion: "", motivo: "" };
    await accionComparativo(ctx(store, pedro), req.id, { ...base, accion: "proponer", version: 0 });
    await rejects(accionComparativo(ctx(store, pedro), req.id, { ...base, accion: "aprobar", version: 1 }), 403, "sin-permiso");
    await rejects(accionComparativo(ctx(store, jorge), req.id, { ...base, accion: "devolver", version: 1 }), 400, "motivo-requerido");
    await accionComparativo(ctx(store, jorge), req.id, { ...base, accion: "devolver", motivo: "Pide una tercera cotización", version: 1 });
    // Ana (administrator) proposes now and can't approve her own proposal.
    await accionComparativo(ctx(store, ana), req.id, { ...base, accion: "proponer", justificacion: "Solo dos proveedores con cupo", version: 2 });
    await rejects(accionComparativo(ctx(store, ana), req.id, { ...base, accion: "aprobar", version: 3 }), 403, "auto-aprobacion");
    const aprobado = (await accionComparativo(ctx(store, jorge), req.id, { ...base, accion: "aprobar", version: 3 })).comparativos[0];
    assert.deepEqual([aprobado.estado, aprobado.aprobadoPor, aprobado.cotizacionElegidaId], ["aprobado", "Jorge Ruiz", qa.id]);
    const negados = (await getAuditoria(ctx(store, ana), new URLSearchParams({ resultado: "denegado", modulo: "cotizaciones" }))).entradas;
    assert.deepEqual(negados.map((e) => e.detalle.motivo), ["auto-aprobacion", "sin-permiso"]);
  });

  it("solo se cotiza lo aprobado de requisiciones aprobadas, una vez por proveedor", async () => {
    const { store, req, pa, pb } = await obra();
    await guardarCotizacion(ctx(store, pedro), cotizacion(req, pa.id, [2_000, 31_000]));
    await rejects(guardarCotizacion(ctx(store, pedro), cotizacion(req, pa.id, [1, 1])), 409, "cotizacion-duplicada");
    const demasiado = cotizacion(req, pb.id, [1, 1]);
    demasiado.lineas[0].cantidad = 1001;
    await rejects(guardarCotizacion(ctx(store, pedro), demasiado), 400, "cantidad-no-valida");
    await rejects(guardarCotizacion(ctx(store, luis), cotizacion(req, pa.id, [1, 1])), 403);
  });
});
