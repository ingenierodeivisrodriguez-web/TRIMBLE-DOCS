"use client";

import { useCallback, useEffect, useState } from "react";
import type { ComprasApi } from "../../lib/compras/client";
import { ESTADOS_COMPARATIVO, lineasAprobadas, numeroCotizacion } from "../../lib/compras/cotizaciones";
import { fecha } from "../../lib/compras/formato";
import { numeroRequisicion } from "../../lib/compras/requisiciones";
import { CotizacionesResponse, Permiso } from "../../lib/compras/types";
import { C, message, Notice } from "../presupuesto/ui";
import ComparativoDialog from "./ComparativoDialog";
import { etiqueta, linkBtn, td, th } from "./estilos";

/** Approved requisitions to quote: how many quotations each one has and how its comparison goes. */
export default function Cotizaciones({ api, yo, permisos, onSinAcceso }: { api: ComprasApi; yo: string; permisos: Permiso[]; onSinAcceso: (err: unknown) => void }) {
  const [datos, setDatos] = useState<CotizacionesResponse | null>(null);
  const [error, setError] = useState("");
  const [abierta, setAbierta] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError("");
    try {
      setDatos(await api.getCotizaciones());
    } catch (err) {
      setError(message(err));
      onSinAcceso(err);
    }
  }, [api, onSinAcceso]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!datos) return <p style={{ color: "var(--tc-gray-500)" }}>Cargando cotizaciones…</p>;

  const requisicion = abierta ? datos.requisiciones.find((r) => r.id === abierta) : undefined;
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6 }}>
      <div style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, fontSize: 13, color: "var(--tc-gray-500)" }}>
        Se cotizan las requisiciones aprobadas (lo aprobado de cada línea). Se esperan al menos <strong>{datos.config.minCotizaciones}</strong> cotizaciones por
        requisición; con menos, la elección se justifica.
      </div>
      <div style={{ overflow: "auto", maxHeight: "calc(100vh - 200px)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Requisición</th>
              <th style={th}>Solicitante</th>
              <th style={th}>Requerida</th>
              <th style={{ ...th, textAlign: "right" }}>Insumos aprobados</th>
              <th style={{ ...th, textAlign: "right" }}>Cotizaciones vigentes</th>
              <th style={th}>Comparativo</th>
              <th style={th}>Proveedor elegido</th>
            </tr>
          </thead>
          <tbody>
            {datos.requisiciones.map((r) => {
              const cots = datos.cotizaciones.filter((c) => c.requisicionId === r.id && c.estado === "registrada");
              const vigentes = cots.filter((c) => c.vigenciaHasta >= datos.hoy).length;
              const comp = datos.comparativos.find((c) => c.requisicionId === r.id);
              const e = ESTADOS_COMPARATIVO[comp?.estado ?? "sin"];
              const elegida = comp?.estado === "aprobado" ? datos.cotizaciones.find((c) => c.id === comp.cotizacionElegidaId) : undefined;
              return (
                <tr key={r.id} onClick={() => setAbierta(r.id)} style={{ cursor: "pointer" }}>
                  <td style={{ ...td, fontWeight: 600 }}>
                    <button type="button" onClick={() => setAbierta(r.id)} style={linkBtn}>
                      {numeroRequisicion(r.numero)}
                    </button>
                    <div style={{ fontSize: 12, fontWeight: 400, color: "var(--tc-gray-500)" }}>{r.justificacion}</div>
                  </td>
                  <td style={td}>{r.solicitanteNombre}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{fecha(r.fechaRequerida)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{lineasAprobadas(r).length}</td>
                  <td style={{ ...td, textAlign: "right", color: vigentes < datos.config.minCotizaciones ? "#a35200" : undefined }}>{vigentes}</td>
                  <td style={td}>
                    <span style={etiqueta(e.color, e.fondo)}>{e.texto}</span>
                  </td>
                  <td style={td}>
                    {elegida ? `${datos.proveedores.find((p) => p.id === elegida.proveedorId)?.razonSocial ?? ""} (${numeroCotizacion(elegida.numero)})` : "—"}
                  </td>
                </tr>
              );
            })}
            {datos.requisiciones.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...td, color: "var(--tc-gray-500)" }}>
                  No hay requisiciones aprobadas para cotizar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {requisicion && (
        <ComparativoDialog
          key={`${requisicion.id}:${datos.comparativos.find((c) => c.requisicionId === requisicion.id)?.version ?? 0}`}
          api={api}
          datos={datos}
          requisicion={requisicion}
          yo={yo}
          permisos={permisos}
          onDatos={setDatos}
          onRecargar={cargar}
          onSinAcceso={onSinAcceso}
          onClose={() => setAbierta(null)}
        />
      )}
    </div>
  );
}
