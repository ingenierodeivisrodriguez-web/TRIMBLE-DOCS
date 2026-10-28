"use client";

import { useEffect, useRef, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { PublicarApi } from "../../lib/publicar/client";
import type { PasoArchivo } from "../../lib/publicar/types";
import { C, message } from "../presupuesto/ui";
import { botonSecundario } from "../compras/estilos";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Copies one followed file and waits (up to 3 minutes) for Trimble to confirm an upload. */
export async function copiarSeguido(api: PublicarApi, archivoId: string, siVersion?: string): Promise<PasoArchivo> {
  let r = await api.pasoArchivo(siVersion ? "reemplazar" : "copiar", archivoId, siVersion);
  for (let i = 0; r.ok && !r.listo && r.uploadId && i < 90; i++) {
    await esperar(2000);
    r = await api.pasoArchivo("confirmar", archivoId);
  }
  return r;
}

interface Resultado {
  cuando: string;
  revisadas: number;
  copiados: number;
  diferencias: number;
  errores: string[];
  avisos: string[];
}

/**
 * Keeps the publications from and to this project up to date: when the page
 * opens (and when `pedido` changes, or with "Revisar ahora") it reviews them
 * and copies, one by one, the versions that are missing in the destination.
 */
export default function Sincronizacion({ api, pedido, onCambio }: { api: PublicarApi; pedido: number; onCambio: () => void }) {
  const [trabajando, setTrabajando] = useState<string | null>("Revisando las publicaciones de este proyecto…");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState("");
  const corriendo = useRef(false);
  const avisarCambio = useRef(onCambio);
  avisarCambio.current = onCambio;

  async function revisar() {
    if (corriendo.current) return;
    corriendo.current = true;
    setError("");
    setTrabajando("Revisando las publicaciones de este proyecto…");
    try {
      const plan = await api.plan();
      const r: Resultado = { cuando: fechaHora(new Date().toISOString()), revisadas: plan.revisadas, copiados: 0, diferencias: plan.diferencias, errores: [], avisos: plan.avisos };
      for (const [i, t] of plan.tareas.entries()) {
        setTrabajando(`Copiando ${i + 1} de ${plan.tareas.length}: ${t.subcarpeta ? `${t.subcarpeta}/` : ""}${t.nombre}…`);
        try {
          const p = await copiarSeguido(api, t.archivoId);
          if (p.ok && p.listo) r.copiados++;
          else if (p.diferencia) r.diferencias++;
          else if (!p.ocupado) r.errores.push(`${t.nombre}: ${p.mensaje}`);
        } catch (err) {
          r.errores.push(`${t.nombre}: ${message(err)}`);
        }
      }
      setResultado(r);
      avisarCambio.current();
    } catch (err) {
      setError(message(err));
    } finally {
      corriendo.current = false;
      setTrabajando(null);
    }
  }

  useEffect(() => {
    revisar();
    // Runs when the page opens and every time `pedido` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido]);

  const resumen = resultado
    ? [
        resultado.copiados
          ? `${resultado.copiados === 1 ? "1 versión copiada" : `${resultado.copiados} versiones copiadas`}`
          : resultado.revisadas
            ? "Todo al día"
            : resultado.avisos.length
              ? "Nada que copiar por ahora (ver los avisos)"
              : "No hay publicaciones activas de o hacia este proyecto",
        resultado.diferencias ? `${resultado.diferencias} ${resultado.diferencias === 1 ? "archivo distinto" : "archivos distintos"} en el destino por decidir` : "",
        resultado.errores.length ? `${resultado.errores.length} con error` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const color = error || resultado?.errores.length ? "#b3261e" : resultado?.diferencias ? "#8a5a00" : "var(--tc-gray-700)";

  return (
    <div style={{ maxWidth: 900, boxSizing: "border-box", border: `1px solid ${C.border}`, borderRadius: 6, background: "#f6f8fb", padding: "10px 14px", fontSize: 13.5 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ flex: 1, minWidth: 220, color }}>
          {trabajando ?? (error ? `No se pudo revisar: ${error}` : resultado ? `${resumen}. Revisado el ${resultado.cuando}.` : "")}
        </span>
        <button type="button" onClick={revisar} disabled={!!trabajando} style={{ ...botonSecundario, padding: "4px 12px", fontSize: 13, opacity: trabajando ? 0.6 : 1 }}>
          {trabajando ? "Revisando…" : "Revisar ahora"}
        </button>
      </div>
      {!trabajando && resultado && (resultado.avisos.length > 0 || resultado.errores.length > 0) && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: "pointer", color: "var(--tc-gray-500)" }}>
            Ver {resultado.avisos.length + resultado.errores.length === 1 ? "el aviso" : `los ${resultado.avisos.length + resultado.errores.length} avisos`}
          </summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
            {[...resultado.errores, ...resultado.avisos].map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      )}
      <div style={{ marginTop: 4, fontSize: 12, color: "var(--tc-gray-500)" }}>
        Las versiones nuevas se copian cuando abre esta extensión alguien que pertenece a los dos proyectos, o cuando la abre cualquiera si esa persona conectó su
        cuenta (pestaña &quot;Usuario en ambos proyectos&quot;).
      </div>
    </div>
  );
}
