// How online sales read on screen (shared by the server and the screens).
import type { EstadoOrden } from "./types";

/** "$ 135.000" */
export function pesos(valor: number, moneda = "COP"): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: moneda, maximumFractionDigits: 0 }).format(valor);
}

export function etiquetaMeses(meses: number): string {
  return `${meses} ${meses === 1 ? "mes" : "meses"}`;
}

export const ESTADO_ORDEN_LABELS: Record<EstadoOrden, string> = {
  pendiente: "Pendiente",
  aprobada: "Aprobada",
  revisar: "Revisar",
  reembolsada: "Reembolsada",
};

/** "Pago rechazado: fondos insuficientes" and the like, for Mercado Pago's statuses. */
export function textoEstadoMp(estado: string | null, detalle: string | null): string {
  switch (estado) {
    case "approved":
      return "Pago aprobado";
    case "pending":
    case "in_process":
    case "authorized":
      return detalle === "pending_waiting_payment" || detalle === "pending_waiting_transfer"
        ? "Pago pendiente: Mercado Pago espera que completes el pago (por ejemplo, en efectivo o PSE)"
        : "Pago en revisión en Mercado Pago";
    case "in_mediation":
      return "Pago en disputa en Mercado Pago";
    case "rejected":
      return detalle === "cc_rejected_insufficient_amount"
        ? "Pago rechazado: fondos insuficientes"
        : detalle === "cc_rejected_bad_filled_security_code" || detalle === "cc_rejected_bad_filled_date" || detalle === "cc_rejected_bad_filled_other"
          ? "Pago rechazado: revisa los datos de la tarjeta"
          : "Pago rechazado";
    case "cancelled":
      return "Pago cancelado";
    case "refunded":
      return "Pago reembolsado";
    case "charged_back":
      return "Pago con contracargo";
    default:
      return "Aún no hay pago";
  }
}
