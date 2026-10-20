"use client";
// TEMPORARY local preview (never commit): Compras with the real service rules on a memory store and a fake Trimble Connect.
// Copy to app/dev-preview-compras/page.tsx, adjust the seed to the case, and delete it (and .next/dev) when done.
// window.apiFalsa and window.trimbleFalso are there to drive and inspect it from javascript_tool.
import { useEffect, useState } from "react";
import ComprasApp from "../../components/compras/ComprasApp";
import type { ComprasApi } from "../../lib/compras/client";
import { memoriaLectura } from "../../lib/compras/presupuestoLectura";
import { trimbleFalso } from "../../lib/compras/pruebas/trimbleFalso";
import * as svc from "../../lib/compras/service";
import { memoryStore } from "../../lib/compras/store";
import type { Rol } from "../../lib/compras/types";
import { hoyIso } from "../../lib/manuales/licencia";
import { ApiError } from "../../lib/propiedades/client";
import { Caller, ServiceError } from "../../lib/propiedades/service";

const p = (id: string, name: string, isAdmin = false): Caller => ({ id, name, isAdmin });
const ana = p("ana", "Ana Gómez", true);
const luis = p("luis", "Luis Pérez");
const marta = p("marta", "Marta Díaz");
const pedro = p("pedro", "Pedro Rojas");
const jorge = p("jorge", "Jorge Ruiz");
const olga = p("olga", "Olga Ríos");
const equipo = [ana, luis, marta, pedro, jorge, olga];
const lectura = memoriaLectura({
  demo: {
    documento: {
      data: {
        subpresupuestos: [{ id: "sp1", nombre: "ESTRUCTURA", pie: [], items: [{ id: "muro", tipo: "partida", nivel: 0, codigo: "", descripcion: "MURO", unidad: "M2", omniclass: "", rendimiento: 10, jornada: 8, metrado: 100, origenId: null, componentes: [{ tipo: "insumo", id: "blq", cuadrilla: null, cantidad: 12.5 }, { tipo: "insumo", id: "cem", cuadrilla: null, cantidad: 0.2 }] }] }],
        insumos: {
          blq: { codigo: "MT-04", descripcion: "BLOQUE No. 5", unidad: "UND", precio: 2_100, tipo: "MT", iu: "", omniclass: "" },
          cem: { codigo: "MT-01", descripcion: "CEMENTO", unidad: "BLS", precio: 32_000, tipo: "MT", iu: "", omniclass: "" },
        },
        subpartidas: {},
        gastos: { fijos: [], variables: [] },
      },
      version: 1,
      updatedAt: null,
      updatedBy: null,
    },
  },
});
const t = trimbleFalso();
const store = memoryStore();
const hoy = hoyIso();
const ctx = (caller: Caller = ana): svc.Ctx => ({
  projectId: "demo",
  caller,
  store,
  presupuesto: lectura,
  hoy,
  deps: {
    contactos: async () => ({ users: equipo.map((x) => ({ id: x.id, name: x.name, email: "", pending: false })), groups: [] }),
    cde: async () => ({ cliente: t.cliente, rootId: "raiz" }),
    fetch: t.fetchFalso,
  },
});

async function sembrar() {
  await svc.activar(ctx());
  const { roles } = await svc.getAccesos(ctx());
  const rol = (c: string) => (roles.find((r) => r.clave === c) as Rol).id;
  for (const [u, c] of [["luis", "residente"], ["marta", "presupuesto_costos"], ["pedro", "compras"], ["jorge", "director"], ["olga", "almacen"]]) {
    await svc.guardarUsuario(ctx(), { userId: u, rolId: rol(c), desde: hoy, hasta: null, activo: true, version: 0 });
  }
  await svc.guardarConfig(ctx(), { toleranciaPct: 0, minCotizaciones: 1, version: 0 });
  const r0 = (await svc.guardarRequisicion(ctx(luis), { fechaRequerida: "2026-10-30", prioridad: "normal", justificacion: "Muros piso 1", lineas: [{ insumoId: "blq", partidaItemId: null, cantidad: 1000, justificacionExceso: "" }, { insumoId: "cem", partidaItemId: null, cantidad: 20, justificacionExceso: "" }], version: 0 })).requisiciones[0];
  await svc.accionRequisicion(ctx(luis), r0.id, { accion: "enviar", motivo: "", version: 1 });
  await svc.accionRequisicion(ctx(marta), r0.id, { accion: "aprobar", motivo: "", version: 2 });
  const { proveedores } = await svc.guardarProveedor(ctx(pedro), { nit: "890903938", tipoPersona: "juridica", razonSocial: "Ferretería A", nombreComercial: "", contacto: "Carlos", telefono: "3001234567", correo: "", ciudad: "Medellín", direccion: "", categorias: ["MT"], responsableIva: true, observaciones: "", version: 0 });
  const req = (await svc.getCotizaciones(ctx(pedro))).requisiciones[0];
  const [l1, l2] = req.lineas;
  const { cotizaciones } = await svc.guardarCotizacion(ctx(pedro), {
    requisicionId: req.id, proveedorId: proveedores[0].id, referencia: "COT-55", fecha: hoy, vigenciaHasta: "2026-12-31", plazoEntregaDias: 5, diasPago: 30, anticipoPct: 0, formaPago: "", observaciones: "",
    lineas: [{ requisicionLineaId: l1.id, cantidad: 1000, precioUnitario: 2_000, descuentoPct: 0, ivaPct: 19 }, { requisicionLineaId: l2.id, cantidad: 20, precioUnitario: 31_000, descuentoPct: 0, ivaPct: 19 }],
    version: 0,
  });
  const base = { criterios: { precio: 70, entrega: 20, pago: 10 }, cotizacionElegidaId: cotizaciones[0].id, justificacion: "", motivo: "" };
  await svc.accionComparativo(ctx(pedro), req.id, { ...base, accion: "proponer", version: 0 });
  await svc.accionComparativo(ctx(jorge), req.id, { ...base, accion: "aprobar", version: 1 });
  const oc = (await svc.guardarOrden(ctx(pedro), { tipo: "orden", requisicionId: req.id, fechaEntrega: "2026-10-28", lugarEntrega: "Obra Torre Norte", formaPago: "Crédito 30 días", diasPago: 30, anticipoPct: 0, retencionGarantiaPct: 0, objeto: "", polizas: "", observaciones: "", lineas: [{ requisicionLineaId: l1.id, cantidad: 1000 }, { requisicionLineaId: l2.id, cantidad: 20 }], version: 0 })).ordenes[0];
  await svc.accionOrden(ctx(pedro), oc.id, { accion: "enviar", motivo: "", version: 1 });
  await svc.accionOrden(ctx(jorge), oc.id, { accion: "aprobar", motivo: "", version: 2 });
  // A reception registered by Luis, waiting for approval.
  const rec = (await svc.guardarRecepcion(ctx(luis), { ordenId: oc.id, fecha: hoy, remision: "R-881", observaciones: "", lineas: [{ requisicionLineaId: l1.id, recibido: 420, rechazado: 20, devuelto: 20, motivo: "Rotos en el cargue" }], version: 0 })).recepciones[0];
  await svc.accionRecepcion(ctx(luis), rec.id, { accion: "enviar", motivo: "", version: 1 });
  await svc.accionRecepcion(ctx(olga), rec.id, { accion: "aprobar", motivo: "", version: 2 });
  await svc.prepararCarpetas(ctx());
}
const listo = sembrar();

const w = async <T,>(f: () => Promise<T>): Promise<T> => {
  await new Promise((x) => setTimeout(x, 150));
  try {
    return await f();
  } catch (e) {
    if (e instanceof ServiceError) throw new ApiError(e.message, e.status, e.code);
    throw e;
  }
};
const q = (o: Record<string, string | undefined> = {}) => new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]);
const api: ComprasApi = {
  getEstado: () => w(() => svc.getEstado(ctx())),
  activar: () => w(() => svc.activar(ctx())),
  getAccesos: () => w(() => svc.getAccesos(ctx())),
  getContactos: () => w(() => svc.getContactos(ctx())),
  guardarUsuario: (c) => w(() => svc.guardarUsuario(ctx(), c)),
  guardarRol: (c) => w(() => svc.guardarRol(ctx(), c)),
  getAuditoria: () => w(() => svc.getAuditoria(ctx(), new URLSearchParams())).then((x) => x.entradas),
  getInsumos: () => w(() => svc.getInsumos(ctx())),
  getRequisiciones: () => w(() => svc.getRequisiciones(ctx())),
  guardarRequisicion: (c) => w(() => svc.guardarRequisicion(ctx(), c)),
  accionRequisicion: (id, a) => w(() => svc.accionRequisicion(ctx(), id, a)),
  guardarConfig: (c) => w(() => svc.guardarConfig(ctx(), c)),
  getProveedores: () => w(() => svc.getProveedores(ctx())),
  guardarProveedor: (c) => w(() => svc.guardarProveedor(ctx(), c)),
  estadoProveedor: (id, c) => w(() => svc.estadoProveedor(ctx(), id, c)),
  getCotizaciones: () => w(() => svc.getCotizaciones(ctx())),
  guardarCotizacion: (c) => w(() => svc.guardarCotizacion(ctx(), c)),
  anularCotizacion: (id, motivo, version) => w(() => svc.anularCotizacion(ctx(), id, { motivo, version })),
  accionComparativo: (id, a) => w(() => svc.accionComparativo(ctx(), id, a)),
  getOrdenes: () => w(() => svc.getOrdenes(ctx())),
  guardarOrden: (c) => w(() => svc.guardarOrden(ctx(), c)),
  accionOrden: (id, a) => w(() => svc.accionOrden(ctx(), id, a)),
  getRecepciones: () => w(() => svc.getRecepciones(ctx())),
  getPanel: () => w(() => svc.getPanel(ctx())),
  guardarRecepcion: (c) => w(() => svc.guardarRecepcion(ctx(), c)),
  accionRecepcion: (id, a) => w(() => svc.accionRecepcion(ctx(), id, a)),
  pruebaCde: (paso, datos = {}) => w(() => svc.pruebaCde(ctx(), { paso, ...datos })),
  getDocumentos: (f = {}) => w(() => svc.getDocumentos(ctx(), q(f))),
  crearDocumento: (n) => w(() => svc.crearDocumento(ctx(), n)),
  enviarDocumento: async (id, archivo) => w(async () => svc.enviarDocumento(ctx(), id, new Uint8Array(await archivo.arrayBuffer()))),
  confirmarDocumento: (id) => w(() => svc.confirmarDocumento(ctx(), id)),
  reintentarDocumento: (id) => w(() => svc.reintentarDocumento(ctx(), id)),
  abrirDocumento: (id) => w(() => svc.abrirDocumento(ctx(), id)),
  anularDocumento: (id, motivo) => w(() => svc.anularDocumento(ctx(), id, { motivo })),
  historialDocumento: (id) => w(() => svc.getHistorialDocumento(ctx(), id)).then((x) => x.historial),
  guardarTiposDocumento: (tipos, version) => w(() => svc.guardarTiposDocumento(ctx(), { tipos, version })),
  inspeccionarCarpetas: () => w(() => svc.inspeccionarCarpetas(ctx())),
  prepararCarpetas: () => w(() => svc.prepararCarpetas(ctx())),
};
Object.assign(globalThis, { trimbleFalso: t, apiFalsa: api });

export default function Page() {
  const [ok, setOk] = useState<string | null>(null);
  useEffect(() => {
    listo.then(() => setOk("ok"), (e) => setOk(String(e)));
  }, []);
  if (ok !== "ok") return <p>{ok ?? "Sembrando…"}</p>;
  return <ComprasApp api={api} projectId="demo" projectName="Torre Norte (pruebas)" />;
}
