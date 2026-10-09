"use client";

import { CSSProperties } from "react";
import type { PagoPedido } from "../../lib/manuales/client";
import { MEDIOS_PAGO, pesos } from "../../lib/manuales/textos";
import { parseDisplayDate } from "../../lib/propiedades/values";
import DateField from "../propiedades/DateField";

/** A payment being registered by hand (dates as DD-MM-AAAA, value as typed). */
export interface FormPagoValor {
  /** "despues": authorize now, register the payment later (the license shows as without payment). */
  tipo: "pago" | "cortesia" | "despues";
  valor: string;
  medio: string;
  fecha: string;
  referencia: string;
  soporte: string;
}

export function formPagoVacio(hoyVisible: string, tipo: FormPagoValor["tipo"] = "pago"): FormPagoValor {
  return { tipo, valor: "", medio: "transferencia", fecha: hoyVisible, referencia: "", soporte: "" };
}

function valorDe(texto: string): number | null {
  const limpio = texto.replace(/[\s.$]/g, "");
  return /^\d{1,9}$/.test(limpio) && Number(limpio) > 0 ? Number(limpio) : null;
}

/** The request for the API (null: no payment now), or the reason the form isn't valid yet. */
export function pedidoPago(f: FormPagoValor): PagoPedido | null | string {
  if (f.tipo === "despues") return null;
  const fecha = parseDisplayDate(f.fecha);
  if (!fecha) return "Escribe la fecha del pago como DD-MM-AAAA.";
  const soporte = f.soporte.trim() || undefined;
  if (f.tipo === "cortesia") return { tipo: "cortesia", fecha, soporte };
  const valor = valorDe(f.valor);
  if (!valor) return "Escribe el valor pagado en pesos, sin decimales.";
  return { tipo: "pago", valor, medio: f.medio, fecha, referencia: f.referencia.trim() || undefined, soporte };
}

/** Payment received (value, method, date, reference, note), courtesy, or later. */
export default function FormPago({ id, valor, onChange, permitirDespues = true }: { id: string; valor: FormPagoValor; onChange: (f: FormPagoValor) => void; permitirDespues?: boolean }) {
  const monto = valorDe(valor.valor);
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label style={campo}>
        Pago
        <select value={valor.tipo} onChange={(e) => onChange({ ...valor, tipo: e.target.value as FormPagoValor["tipo"] })} style={entrada}>
          <option value="pago">Pago recibido</option>
          <option value="cortesia">Cortesía (sin cobro)</option>
          {permitirDespues && <option value="despues">Registrar después</option>}
        </select>
      </label>
      {valor.tipo === "pago" && (
        <>
          <label style={campo}>
            Valor (COP)
            <input
              value={valor.valor}
              inputMode="numeric"
              placeholder="480000"
              onChange={(e) => onChange({ ...valor, valor: e.target.value })}
              style={{ ...entrada, width: 120, border: `1px solid ${valor.valor && !monto ? "#d93025" : "var(--tc-gray-300)"}` }}
            />
          </label>
          <label style={campo}>
            Medio
            <select value={valor.medio} onChange={(e) => onChange({ ...valor, medio: e.target.value })} style={entrada}>
              {Object.entries(MEDIOS_PAGO).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {valor.tipo !== "despues" && (
        <>
          <label style={campo}>
            Fecha del pago
            <DateField id={`${id}-fecha-pago`} text={valor.fecha} placeholder="DD-MM-AAAA" invalid={!!valor.fecha && !parseDisplayDate(valor.fecha)} onText={(t) => onChange({ ...valor, fecha: t })} />
          </label>
          {valor.tipo === "pago" && (
            <label style={campo}>
              Referencia
              <input value={valor.referencia} placeholder="N.º transferencia o factura" onChange={(e) => onChange({ ...valor, referencia: e.target.value })} style={{ ...entrada, width: 190 }} />
            </label>
          )}
          <label style={{ ...campo, flex: "1 1 180px" }}>
            Soporte / nota
            <input
              value={valor.soporte}
              placeholder={valor.tipo === "cortesia" ? "Motivo de la cortesía" : "Opcional"}
              onChange={(e) => onChange({ ...valor, soporte: e.target.value })}
              style={entrada}
            />
          </label>
        </>
      )}
      <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)", paddingBottom: 8 }}>
        {valor.tipo === "pago" && monto
          ? `Entra a los estados de cuenta: ${pesos(monto)}.`
          : valor.tipo === "cortesia"
            ? "Queda registrada en $ 0."
            : valor.tipo === "despues"
              ? "Aparecerá en «Licencias sin pago registrado»."
              : ""}
      </span>
    </div>
  );
}

const campo: CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: 12.5, color: "var(--tc-gray-500)" };
const entrada: CSSProperties = { border: "1px solid var(--tc-gray-300)", borderRadius: 5, padding: "7px 8px", fontSize: 14, fontFamily: "inherit", background: "#fff" };
