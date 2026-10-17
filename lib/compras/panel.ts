import { redondear } from "../presupuesto/calc";
import { totalesLinea } from "./cotizaciones";
import type {
  Comparativo,
  Cotizacion,
  Documento,
  DocumentoRuta,
  FilaPanel,
  Indicador,
  InsumoPlanificado,
  Orden,
  Proveedor,
  Recepcion,
  Requisicion,
  RutaRequisicion,
  VisibilidadRuta,
} from "./types";

/**
 * The panel and the path of each resource, as pure functions over what the
 * other phases store: planned (Presupuesto), asked and approved
 * (requisitions), committed (issued orders and contracts) and received
 * (approved receptions). A figure without enough data is null ("sin datos
 * suficientes"), never a made-up zero.
 */

const neto = (l: { precioUnitario: number; descuentoPct: number }) => redondear(l.precioUnitario * (1 - l.descuentoPct / 100), 2);
const pct = (parte: number, todo: number) => (todo > 0 ? redondear((parte / todo) * 100, 2) : null);
const DIA = 86_400_000;

/** Each planned resource with its value committed (orders without VAT) and what was rejected on site. */
export function filasPanel(insumos: InsumoPlanificado[], ordenes: Orden[], recepciones: Recepcion[]): FilaPanel[] {
  const valor = new Map<string, number>();
  for (const o of ordenes) {
    if (o.estado !== "aprobada") continue;
    for (const l of o.lineas) valor.set(l.insumoId, redondear((valor.get(l.insumoId) ?? 0) + totalesLinea(l).neto, 2));
  }
  const rechazado = new Map<string, number>();
  for (const r of recepciones) {
    if (r.estado !== "aprobada") continue;
    for (const l of r.lineas) rechazado.set(l.insumoId, redondear((rechazado.get(l.insumoId) ?? 0) + l.rechazado, 4));
  }
  return insumos.map((i) => ({
    id: i.id,
    codigo: i.codigo,
    descripcion: i.descripcion,
    unidad: i.unidad,
    tipo: i.tipo,
    via: i.via,
    precio: i.precio,
    planificado: i.cantidad,
    solicitado: i.solicitado,
    aprobado: i.aprobado,
    comprometido: i.comprometido,
    recibido: i.recibido,
    rechazado: rechazado.get(i.id) ?? 0,
    porSolicitar: redondear(i.cantidad - i.solicitado, 4),
    porRecibir: Math.max(0, redondear(i.comprometido - i.recibido, 4)),
    montoPlanificado: i.monto,
    valorComprometido: valor.has(i.id) ? valor.get(i.id)! : null,
    valorPresupuestoComprometido: redondear(i.comprometido * i.precio, 2),
  }));
}

export interface DatosIndicadores {
  filas: FilaPanel[];
  requisiciones: Requisicion[];
  ordenes: Orden[];
  recepciones: Recepcion[];
  documentos: Documento[];
  /** Active suppliers whose legal file is incomplete or expired (null: not computed). */
  expedientesPorCompletar: number | null;
  hoy: string;
}

export function indicadores(d: DatosIndicadores): Indicador[] {
  const planificado = d.filas.reduce((s, f) => s + f.montoPlanificado, 0);
  const comprometido = d.filas.reduce((s, f) => s + (f.valorComprometido ?? 0), 0);
  const comprometidoPresupuesto = d.filas.reduce((s, f) => s + (f.valorComprometido === null ? 0 : f.valorPresupuestoComprometido), 0);

  // Received value: accepted in approved receptions at each order line's net price.
  let valorRecibido = 0;
  let recibido = 0;
  let rechazado = 0;
  for (const r of d.recepciones) {
    if (r.estado !== "aprobada") continue;
    const o = d.ordenes.find((x) => x.id === r.ordenId);
    for (const l of r.lineas) {
      const ol = o?.lineas.find((x) => x.requisicionLineaId === l.requisicionLineaId);
      if (ol) valorRecibido += l.aceptado * neto(ol);
      recibido += l.recibido;
      rechazado += l.rechazado;
    }
  }

  const tiempos = d.requisiciones
    .filter((r) => r.estado === "aprobada" && r.enviada && r.decidida)
    .map((r) => (Date.parse(r.decidida!) - Date.parse(r.enviada!)) / DIA)
    .filter((x) => Number.isFinite(x) && x >= 0);

  const aceptadoAprobado = (o: Orden, rl: string) =>
    d.recepciones.filter((r) => r.ordenId === o.id && r.estado === "aprobada").reduce((s, r) => s + r.lineas.filter((l) => l.requisicionLineaId === rl).reduce((x, l) => x + l.aceptado, 0), 0);
  const vencidas = d.ordenes.filter((o) => o.estado === "aprobada" && o.fechaEntrega < d.hoy && o.lineas.some((l) => aceptadoAprobado(o, l.requisicionLineaId) < l.cantidad)).length;

  const porAprobar = {
    requisiciones: d.requisiciones.filter((r) => r.estado === "enviada").length,
    ordenes: d.ordenes.filter((o) => o.estado === "enviada").length,
    recepciones: d.recepciones.filter((r) => r.estado === "enviada").length,
  };
  const docsPendientes = d.documentos.filter((x) => x.estado === "pendiente" || x.estado === "error").length;
  const desviacion = comprometidoPresupuesto > 0 ? redondear(((comprometido - comprometidoPresupuesto) / comprometidoPresupuesto) * 100, 2) : null;
  const rechazoPct = pct(rechazado, recibido);

  return [
    {
      clave: "comprometido",
      nombre: "Presupuesto de compras comprometido",
      valor: pct(comprometido, planificado),
      unidad: "pct",
      ayuda: "Valor de las órdenes y contratos emitidos (sin IVA) sobre el valor planificado de los insumos que se compran.",
    },
    {
      clave: "valor-comprometido",
      nombre: "Valor comprometido",
      valor: d.ordenes.some((o) => o.estado === "aprobada") ? redondear(comprometido, 2) : null,
      unidad: "pesos",
      ayuda: "Suma de las órdenes y contratos emitidos, sin IVA.",
    },
    {
      clave: "desviacion",
      nombre: "Precio comprado frente al presupuesto",
      valor: desviacion,
      unidad: "pct",
      ayuda: "Lo comprometido (precios de las órdenes, sin IVA) frente a las mismas cantidades al precio del presupuesto. Positivo: se compró más caro.",
      alerta: desviacion !== null && desviacion > 0,
    },
    {
      clave: "recibido",
      nombre: "Comprometido ya recibido",
      valor: pct(valorRecibido, comprometido),
      unidad: "pct",
      ayuda: "Lo aceptado en recepciones aprobadas, al precio de su orden, sobre el valor comprometido.",
    },
    {
      clave: "rechazo",
      nombre: "Rechazado en obra",
      valor: rechazoPct,
      unidad: "pct",
      ayuda: "Cantidad rechazada sobre la recibida, en recepciones aprobadas.",
      alerta: rechazoPct !== null && rechazoPct > 5,
    },
    {
      clave: "tiempo-aprobacion",
      nombre: "Tiempo para aprobar una requisición",
      valor: tiempos.length ? redondear(tiempos.reduce((s, x) => s + x, 0) / tiempos.length, 1) : null,
      unidad: "dias",
      ayuda: `Promedio entre el envío y la aprobación, en días (${tiempos.length} requisición(es) aprobada(s)).`,
    },
    {
      clave: "por-aprobar",
      nombre: "Esperando aprobación",
      valor: porAprobar.requisiciones + porAprobar.ordenes + porAprobar.recepciones,
      unidad: "cantidad",
      ayuda: `${porAprobar.requisiciones} requisición(es), ${porAprobar.ordenes} orden(es) o contrato(s) y ${porAprobar.recepciones} recepción(es).`,
    },
    {
      clave: "entregas-vencidas",
      nombre: "Entregas vencidas",
      valor: vencidas,
      unidad: "cantidad",
      ayuda: "Órdenes y contratos emitidos cuya fecha de entrega o terminación ya pasó sin recibir todo.",
      alerta: vencidas > 0,
    },
    {
      clave: "documentos-pendientes",
      nombre: "Documentos sin respaldo en el CDE",
      valor: docsPendientes,
      unidad: "cantidad",
      ayuda: "Cargas pendientes o con error: aún no cuentan como respaldadas.",
      alerta: docsPendientes > 0,
    },
    {
      clave: "expedientes",
      nombre: "Proveedores con expediente por completar",
      valor: d.expedientesPorCompletar,
      unidad: "cantidad",
      ayuda: "Proveedores activos con documentos legales obligatorios faltantes, sin confirmar o vencidos.",
      alerta: (d.expedientesPorCompletar ?? 0) > 0,
    },
  ];
}

export interface DatosRuta {
  requisiciones: Requisicion[];
  cotizaciones: Cotizacion[];
  comparativos: Comparativo[];
  proveedores: Proveedor[];
  ordenes: Orden[];
  recepciones: Recepcion[];
  documentos: Documento[];
}

/** The path of every resource asked in a requisition (drafts aside), showing only what the caller can see. */
export function rutasInsumos(d: DatosRuta, ve: VisibilidadRuta): Record<string, RutaRequisicion[]> {
  if (!ve.requisiciones) return {};
  const docs = (tipo: Documento["entidadTipo"], id: string): DocumentoRuta[] =>
    d.documentos
      .filter((x) => x.entidadTipo === tipo && x.entidadId === id && x.estado !== "anulado")
      .map((x) => ({ id: x.id, titulo: x.titulo, nombreArchivo: x.nombreArchivo, estado: x.estado, entidadTipo: x.entidadTipo }));
  const proveedor = (id: string) => d.proveedores.find((p) => p.id === id)?.razonSocial ?? "";
  const out: Record<string, RutaRequisicion[]> = {};
  for (const r of [...d.requisiciones].sort((a, b) => a.numero - b.numero)) {
    if (r.estado === "borrador") continue;
    const comp = d.comparativos.find((c) => c.requisicionId === r.id);
    for (const rl of r.lineas) {
      const cotizaciones = ve.cotizaciones
        ? d.cotizaciones
            .filter((c) => c.requisicionId === r.id)
            .flatMap((c) => {
              const cl = c.lineas.find((x) => x.requisicionLineaId === rl.id);
              return cl
                ? [{ id: c.id, numero: c.numero, estado: c.estado, proveedor: proveedor(c.proveedorId), cantidad: cl.cantidad, precioNeto: neto(cl), elegida: comp?.estado === "aprobado" && comp.cotizacionElegidaId === c.id, documentos: docs("cotizacion", c.id) }]
                : [];
            })
        : null;
      const ordenes =
        ve.ordenes || ve.contratos
          ? d.ordenes
              .filter((o) => (o.tipo === "orden" ? ve.ordenes : ve.contratos))
              .flatMap((o) => {
                const ol = o.lineas.find((x) => x.requisicionLineaId === rl.id);
                if (!ol) return [];
                const recepciones = ve.recepciones
                  ? d.recepciones
                      .filter((x) => x.ordenId === o.id)
                      .flatMap((x) => {
                        const l = x.lineas.find((y) => y.requisicionLineaId === rl.id);
                        return l
                          ? [{ id: x.id, numero: x.numero, estado: x.estado, fecha: x.fecha, recibido: l.recibido, aceptado: l.aceptado, rechazado: l.rechazado, devuelto: l.devuelto, documentos: docs("recepcion", x.id) }]
                          : [];
                      })
                  : null;
                return [{ id: o.id, tipo: o.tipo, numero: o.numero, revision: o.revision, estado: o.estado, proveedor: proveedor(o.proveedorId), fechaEntrega: o.fechaEntrega, cantidad: ol.cantidad, precioNeto: neto(ol), documentos: docs(o.tipo, o.id), recepciones }];
              })
          : null;
      (out[rl.insumoId] ??= []).push({
        requisicionLineaId: rl.id,
        requisicion: { id: r.id, numero: r.numero, estado: r.estado, creada: r.creada, solicitante: r.solicitanteNombre, cantidad: rl.cantidad, aprobada: rl.cantidadAprobada },
        documentos: docs("requisicion", r.id),
        cotizaciones,
        ordenes,
      });
    }
  }
  return out;
}
