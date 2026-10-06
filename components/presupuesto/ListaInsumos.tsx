"use client";

import { CSSProperties, useMemo, useState } from "react";
import { listaInsumos, MetradoModelo } from "../../lib/presupuesto/calc";
import { resolverPresupuesto, snapshotInsumo } from "../../lib/presupuesto/doc";
import { exportarExcel, nombreSeguro } from "../../lib/presupuesto/excel";
import { coincide, fmt } from "../../lib/presupuesto/format";
import { exportarPdf } from "../../lib/presupuesto/pdf";
import { tablaListaInsumos } from "../../lib/presupuesto/reportes";
import { PresupuestoDoc } from "../../lib/presupuesto/types";
import { ConfirmDialog } from "./SimpleDialogs";
import { baseInput, C, linkButton, message, Modal, Notice, NumInput, Square, TextCommit } from "./ui";
import type { Catalogo } from "./usePresupuesto";

/**
 * Every resource the budget uses, added up (image of a bill of materials):
 * its total quantity and amount. Prices and IU edited here are the budget's.
 */
export default function ListaInsumos({
  doc,
  setDoc,
  spId,
  catalogo,
  metradoModelo,
  canEdit,
  proyecto,
  onClose,
}: {
  doc: PresupuestoDoc;
  setDoc: (change: (doc: PresupuestoDoc) => PresupuestoDoc) => void;
  spId: string;
  catalogo: Catalogo | null;
  metradoModelo: Map<string, MetradoModelo>;
  canEdit: boolean;
  proyecto: string;
  onClose: () => void;
}) {
  const [alcance, setAlcance] = useState<string>(spId);
  const [query, setQuery] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState("");
  const sps = useMemo(
    () => (alcance === "*" ? doc.subpresupuestos : doc.subpresupuestos.filter((s) => s.id === alcance)),
    [doc.subpresupuestos, alcance]
  );
  const nombre = alcance === "*" ? "TODOS LOS SUBPRESUPUESTOS" : sps[0]?.nombre ?? "";

  const filas = useMemo(
    () => listaInsumos(sps, resolverPresupuesto(doc), (id) => metradoModelo.get(id) ?? null),
    [sps, doc, metradoModelo]
  );
  const visibles = filas.filter((f) => coincide(`${f.descripcion} ${f.unidad} ${doc.insumos[f.id]?.codigo ?? ""}`, query));
  const total = filas.reduce((sum, f) => sum + f.parcial, 0);
  const ius = useMemo(() => Object.fromEntries(Object.entries(doc.insumos).map(([id, i]) => [id, i.iu])), [doc.insumos]);

  function setInsumo(id: string, patch: { precio?: number; iu?: string }) {
    setDoc((d) => (d.insumos[id] ? { ...d, insumos: { ...d.insumos, [id]: { ...d.insumos[id], ...patch } } } : d));
  }

  function actualizarPrecios() {
    setConfirmar(false);
    if (!catalogo) return;
    setDoc((d) => {
      const insumos = { ...d.insumos };
      for (const id of Object.keys(insumos)) {
        const c = catalogo.insumoMap.get(id);
        if (c) insumos[id] = { ...snapshotInsumo(c), iu: insumos[id].iu || c.iu };
      }
      return { ...d, insumos };
    });
  }

  async function exportar(tipo: "pdf" | "xlsx") {
    setError("");
    try {
      const tabla = tablaListaInsumos(nombre, filas, ius);
      if (tipo === "pdf") await exportarPdf(tabla, proyecto, `Lista de insumos - ${nombre}`);
      else await exportarExcel([tabla], `${nombreSeguro(`Lista de insumos - ${nombre}`)}.xlsx`);
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <Modal
      title={`Lista de insumos: ${nombre}`}
      onClose={onClose}
      width={1200}
      height="88vh"
      toolbar={
        <>
          <button type="button" style={linkButton} onClick={() => exportar("pdf")}>
            PDF
          </button>
          <button type="button" style={linkButton} onClick={() => exportar("xlsx")}>
            Exportar a hoja de cálculo
          </button>
          <span style={sep} />
          <select value={alcance} onChange={(e) => setAlcance(e.target.value)} style={{ ...baseInput, fontSize: 14 }} aria-label="Subpresupuesto">
            {doc.subpresupuestos.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
            <option value="*">Todos los subpresupuestos</option>
          </select>
          {canEdit && catalogo && (
            <button type="button" style={linkButton} onClick={() => setConfirmar(true)} title="Trae los precios actuales del catálogo de insumos">
              Actualizar precios del catálogo
            </button>
          )}
          <span style={{ flex: 1 }} />
          <input type="search" placeholder="Buscar" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...baseInput, width: 260, fontSize: 14 }} aria-label="Buscar insumos" />
        </>
      }
      footer={<span style={{ fontSize: 15, fontWeight: 700 }}>Total: {fmt(total)}</span>}
    >
      {error && <Notice kind="error" style={{ margin: "8px 10px 0" }}>{error}</Notice>}
      {canEdit && (
        <p style={{ margin: "6px 12px", fontSize: 12.5, color: "var(--tc-gray-500)" }}>
          El PU y el IU de cada insumo son los de este presupuesto: al cambiarlos se recalculan todas sus partidas. Recuerda Guardar.
        </p>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#fff" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900, fontSize: 14.5 }}>
          <thead>
            <tr style={{ position: "sticky", top: 0, background: "#f3f4f6", zIndex: 1 }}>
              <th style={{ ...th, width: 30 }} />
              <th style={th}>Insumo</th>
              <th style={{ ...th, width: 80 }}>Unidad</th>
              <th style={{ ...th, width: 140 }}>Cantidad</th>
              <th style={{ ...th, width: 130 }}>PU</th>
              <th style={{ ...th, width: 140 }}>Parcial</th>
              <th style={{ ...th, width: 110 }}>IU</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => (
              <tr key={f.id}>
                <td style={{ ...td, textAlign: "center" }}>
                  <Square rubro={f.tipo} />
                </td>
                <td style={td}>{f.descripcion}</td>
                <td style={{ ...td, textAlign: "center" }}>{f.unidad}</td>
                <td style={tdNum}>{f.porcentajeMO ? "—" : fmt(f.cantidad, 3)}</td>
                <td style={tdNum}>
                  {f.porcentajeMO ? (
                    "—"
                  ) : canEdit ? (
                    <NumInput value={f.precio} decimals={2} onCommit={(v) => v !== null && setInsumo(f.id, { precio: v })} style={{ width: "100%", padding: "2px 4px" }} ariaLabel={`PU de ${f.descripcion}`} />
                  ) : (
                    fmt(f.precio)
                  )}
                </td>
                <td style={tdNum}>{fmt(f.parcial)}</td>
                <td style={{ ...td, textAlign: "center" }}>
                  {canEdit ? (
                    <TextCommit value={ius[f.id] ?? ""} maxLength={40} onCommit={(v) => setInsumo(f.id, { iu: v.trim() })} style={{ width: "100%", padding: "2px 4px", textAlign: "center" }} ariaLabel={`IU de ${f.descripcion}`} />
                  ) : (
                    ius[f.id]
                  )}
                </td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...td, color: "var(--tc-gray-500)", padding: 18 }}>
                  {filas.length === 0 ? "Este presupuesto aún no tiene partidas con insumos y metrado." : "Ningún insumo coincide."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {confirmar && (
        <ConfirmDialog title="Actualizar precios" onClose={() => setConfirmar(false)} onConfirm={actualizarPrecios}>
          Se reemplazarán los precios de todos los insumos del presupuesto por los del catálogo actual. Los que ya no están en el catálogo conservan su precio.
        </ConfirmDialog>
      )}
    </Modal>
  );
}

const th: CSSProperties = { padding: "10px 8px", fontWeight: 600, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.grid}` };
const td: CSSProperties = { padding: "6px 8px", borderBottom: `1px solid ${C.grid}`, borderRight: `1px solid ${C.grid}` };
const tdNum: CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
const sep: CSSProperties = { width: 1, height: 22, background: C.border, margin: "0 6px" };
