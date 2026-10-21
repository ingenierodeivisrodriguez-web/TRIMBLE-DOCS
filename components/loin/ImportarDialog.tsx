"use client";

import { useMemo, useState } from "react";
import type { LoinApi } from "../../lib/loin/client";
import { NOMBRE_CAMPO, PlanImportacion } from "../../lib/loin/importar";
import type { Parametro } from "../../lib/loin/types";
import { acceptButton, C, message, Modal, Notice } from "../presupuesto/ui";
import { botonSecundario, etiqueta, linkBtn, td, th } from "./estilos";

/**
 * What an import (Excel or the DYCO list) would do, row by row. New
 * parameters come checked; those that would change an existing one come
 * unchecked, with their differences, so nothing is overwritten unless
 * someone chooses it.
 */
export default function ImportarDialog({
  api,
  titulo,
  plan,
  onGuardados,
  onClose,
}: {
  api: LoinApi;
  titulo: string;
  plan: PlanImportacion;
  onGuardados: (p: Parametro[]) => void;
  onClose: () => void;
}) {
  const [elegidas, setElegidas] = useState(() => new Set(plan.filas.flatMap((f, i) => (f.tipo === "nuevo" ? [i] : []))));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const nuevos = plan.filas.filter((f) => f.tipo === "nuevo").length;
  const cambian = plan.filas.length - nuevos;
  const ids = useMemo(() => plan.filas.map(() => crypto.randomUUID()), [plan]);

  const marcar = (i: number, si: boolean) =>
    setElegidas((s) => {
      const n = new Set(s);
      if (si) n.add(i);
      else n.delete(i);
      return n;
    });

  async function guardar() {
    setError("");
    const filas = plan.filas
      .map((f, i) => ({ f, i }))
      .filter(({ i }) => elegidas.has(i))
      .map(({ f, i }) => ({ ...f.datos, id: f.existente?.id ?? ids[i], version: f.existente?.version ?? 0 }));
    setBusy(`Guardando 0 de ${filas.length}…`);
    try {
      const guardados = await api.guardarParametros(filas, (hechos) => setBusy(`Guardando ${hechos} de ${filas.length}…`));
      onGuardados(guardados);
      onClose();
    } catch (err) {
      setError(message(err));
      setBusy("");
    }
  }

  return (
    <Modal
      title={titulo}
      onClose={() => !busy && onClose()}
      width={1100}
      height="88vh"
      footer={
        <>
          <span style={{ marginRight: "auto", fontSize: 13, color: "var(--tc-gray-500)" }}>{busy}</span>
          <button type="button" style={botonSecundario} onClick={onClose} disabled={!!busy}>
            Cancelar
          </button>
          <button type="button" style={acceptButton} onClick={guardar} disabled={!!busy || elegidas.size === 0}>
            Guardar {elegidas.size} seleccionado(s)
          </button>
        </>
      }
    >
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10, minHeight: 0 }}>
        <p style={{ margin: 0, fontSize: 14 }}>
          <strong>{nuevos}</strong> nuevo(s) · <strong>{cambian}</strong> con diferencias · <strong>{plan.iguales}</strong> igual(es) a los del catálogo (no se tocan).
          {cambian > 0 && " Revisa cada diferencia: solo se cambia lo que marques."}
        </p>
        {error && <Notice kind="error">{error}</Notice>}
        {plan.errores.length > 0 && (
          <Notice kind="warning">
            {plan.errores.length} fila(s) no se importan:
            <ul style={{ margin: "4px 0 0", paddingLeft: 18, maxHeight: 120, overflow: "auto" }}>
              {plan.errores.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </Notice>
        )}
        <div style={{ display: "flex", gap: 12, fontSize: 13 }}>
          <button type="button" style={linkBtn} onClick={() => setElegidas(new Set(plan.filas.map((_, i) => i)))}>
            Marcar todos
          </button>
          <button type="button" style={linkBtn} onClick={() => setElegidas(new Set(plan.filas.flatMap((f, i) => (f.tipo === "nuevo" ? [i] : []))))}>
            Solo los nuevos
          </button>
          <button type="button" style={linkBtn} onClick={() => setElegidas(new Set())}>
            Ninguno
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto", border: `1px solid ${C.border}`, background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 28 }} />
                <th style={th}>Fila</th>
                <th style={th}>Qué pasa</th>
                <th style={th}>Código</th>
                <th style={th}>Parámetro</th>
                <th style={th}>Diferencias (antes → después)</th>
              </tr>
            </thead>
            <tbody>
              {plan.filas.map((f, i) => (
                <tr key={i} style={{ background: elegidas.has(i) ? "#f3f8ff" : undefined }}>
                  <td style={td}>
                    <input type="checkbox" checked={elegidas.has(i)} onChange={(e) => marcar(i, e.target.checked)} aria-label={`Importar ${f.datos.nombre}`} />
                  </td>
                  <td style={td}>{f.fila ?? ""}</td>
                  <td style={td}>{f.tipo === "nuevo" ? <span style={etiqueta("#2e6b22", "#e4f3df")}>Nuevo</span> : <span style={etiqueta("#7a4d00", "#fcefd6")}>Cambia</span>}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{f.datos.codigo}</td>
                  <td style={td}>{f.datos.nombre}</td>
                  <td style={{ ...td, fontSize: 12.5 }}>
                    {f.diferencias.map((d) => (
                      <div key={d.campo} style={{ marginBottom: 3 }}>
                        <strong>{NOMBRE_CAMPO[d.campo]}:</strong>{" "}
                        <span style={{ color: "#b3261e", textDecoration: "line-through" }} title={d.antes}>
                          {corto(d.antes) || "(vacío)"}
                        </span>{" "}
                        →{" "}
                        <span style={{ color: "#2e6b22" }} title={d.despues}>
                          {corto(d.despues) || "(vacío)"}
                        </span>
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

const corto = (t: string) => (t.length > 140 ? `${t.slice(0, 140)}…` : t);
