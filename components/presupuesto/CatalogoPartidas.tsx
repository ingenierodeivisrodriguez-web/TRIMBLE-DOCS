"use client";

import { CSSProperties, useMemo, useState } from "react";
import { ApuCalculado, calcularApu } from "../../lib/presupuesto/calc";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import { nuevoId, resolverCatalogo } from "../../lib/presupuesto/doc";
import { coincide, fmt } from "../../lib/presupuesto/format";
import { divisionDe } from "../../lib/presupuesto/omniclass";
import { PartidaCatalogo } from "../../lib/presupuesto/types";
import ApuDialog, { DatosPartida } from "./ApuDialog";
import ApuEditor from "./ApuEditor";
import { ConfirmDialog } from "./SimpleDialogs";
import { baseInput, C, linkButton, message, Modal, Notice, useVirtual } from "./ui";
import type { Catalogo } from "./usePresupuesto";

const ROW = 40;
const COLUMNS = "110px minmax(280px, 1fr) 80px 120px 200px";

/** The catalog of partidas with their APU; a partida can be copied into the budget from here. */
export default function CatalogoPartidas({
  api,
  catalogo,
  canEdit,
  readOnlyNote,
  onSaved,
  onAgregar,
  onClose,
}: {
  api: PresupuestoApi;
  catalogo: Catalogo;
  canEdit: boolean;
  readOnlyNote: string;
  onSaved: (cambios: { partidas?: PartidaCatalogo[]; sinPartida?: string }) => void;
  /** Copies the partida into the open subpresupuesto (only for budget editors). */
  onAgregar?: (p: PartidaCatalogo) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [division, setDivision] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<{ id: string; data: DatosPartida; nuevo: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PartidaCatalogo | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const resolver = useMemo(() => resolverCatalogo(catalogo.insumoMap, catalogo.partidaMap), [catalogo]);
  const calculadas = useMemo(() => {
    const cache = new Map<string, ApuCalculado>();
    const out = new Map<string, ApuCalculado>();
    for (const p of catalogo.partidas) out.set(p.id, calcularApu(p, resolver, { cache, stack: [p.id] }));
    return out;
  }, [catalogo.partidas, resolver]);

  const divisiones = useMemo(() => {
    const set = new Set(catalogo.partidas.map((p) => divisionDe(p.omniclass)).filter(Boolean));
    return [...set].sort().map((d) => ({ codigo: d, titulo: catalogo.titulos.get(`${d} 00 00`) ?? "" }));
  }, [catalogo.partidas, catalogo.titulos]);

  const filas = useMemo(
    () => catalogo.partidas.filter((p) => (!division || divisionDe(p.omniclass) === division) && coincide(`${p.codigo} ${p.descripcion} ${p.unidad} ${p.omniclass}`, query)),
    [catalogo.partidas, division, query]
  );
  const { ref, start, end, padTop, padBottom } = useVirtual(filas.length, ROW);
  const selected = selectedId ? catalogo.partidaMap.get(selectedId) ?? null : null;

  function abrir(nuevo: boolean, base?: PartidaCatalogo, copia = false) {
    setError("");
    const data: DatosPartida = base
      ? {
          codigo: copia ? "" : base.codigo,
          descripcion: copia ? `${base.descripcion} - (COPIA)` : base.descripcion,
          unidad: base.unidad,
          omniclass: base.omniclass,
          rendimiento: base.rendimiento,
          jornada: base.jornada,
          componentes: base.componentes.map((c) => ({ ...c })),
          metrado: 0,
        }
      : { codigo: "", descripcion: "", unidad: "", omniclass: "", rendimiento: 1, jornada: 8, componentes: [], metrado: 0 };
    setForm({ id: nuevo ? nuevoId() : base!.id, data, nuevo });
  }

  async function eliminar(p: PartidaCatalogo) {
    setConfirmDelete(null);
    try {
      await api.eliminarPartida(p.id);
      onSaved({ sinPartida: p.id });
      setSelectedId(null);
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <Modal
      title="Catálogo de Partidas"
      onClose={onClose}
      width={1240}
      height="92vh"
      toolbar={
        <>
          <button type="button" style={linkButton} disabled={!canEdit} onClick={() => abrir(true)}>
            Nuevo
          </button>
          <button type="button" style={linkButton} disabled={!canEdit || !selected} onClick={() => selected && abrir(false, selected)}>
            Editar
          </button>
          <button type="button" style={linkButton} disabled={!canEdit || !selected} onClick={() => selected && abrir(true, selected, true)}>
            Duplicar
          </button>
          <button type="button" style={linkButton} disabled={!canEdit || !selected} onClick={() => selected && setConfirmDelete(selected)}>
            Eliminar
          </button>
          {onAgregar && (
            <>
              <span style={sep} />
              <button
                type="button"
                style={{ ...linkButton, color: "var(--tc-blue-700)", fontWeight: 600 }}
                disabled={!selected}
                onClick={() => {
                  if (!selected) return;
                  onAgregar(selected);
                  setAviso(`"${selected.descripcion}" se agregó al presupuesto.`);
                }}
              >
                ⊕ Agregar al presupuesto
              </button>
            </>
          )}
          <span style={sep} />
          <select value={division} onChange={(e) => setDivision(e.target.value)} style={{ ...baseInput, fontSize: 14, maxWidth: 300 }} aria-label="División OmniClass">
            <option value="">Todas las divisiones OmniClass</option>
            {divisiones.map((d) => (
              <option key={d.codigo} value={d.codigo}>
                {d.codigo} {d.titulo}
              </option>
            ))}
          </select>
          <span style={{ flex: 1 }} />
          <input type="search" placeholder="Buscar" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...baseInput, width: 260, fontSize: 14 }} aria-label="Buscar partidas" />
        </>
      }
    >
      {!canEdit && <Notice kind="info" style={{ margin: "8px 10px 0" }}>{readOnlyNote}</Notice>}
      {error && <Notice kind="error" style={{ margin: "8px 10px 0" }}>{error}</Notice>}
      {aviso && <Notice kind="info" style={{ margin: "8px 10px 0" }}>{aviso}</Notice>}
      <div ref={ref} style={{ flex: "1 1 50%", minHeight: 160, overflow: "auto", background: "#fff" }}>
        <div style={{ minWidth: 820 }}>
          <div style={{ ...grid, height: 44, position: "sticky", top: 0, background: "#f3f4f6", zIndex: 1, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>
            <div style={head}>Código</div>
            <div style={head}>Partida</div>
            <div style={head}>Unidad</div>
            <div style={head}>CU</div>
            <div style={head}>OmniClass</div>
          </div>
          <div style={{ height: padTop }} />
          {filas.slice(start, end).map((p) => (
            <div
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              onDoubleClick={() => canEdit && abrir(false, p)}
              style={{ ...grid, height: ROW, background: p.id === selectedId ? C.rowSelected : "#fff", borderBottom: `1px solid ${C.grid}` }}
            >
              <div style={cell}>{p.codigo}</div>
              <div style={cell} title={p.descripcion}>
                <span style={ellipsis}>{p.descripcion}</span>
              </div>
              <div style={{ ...cell, justifyContent: "center" }}>{p.unidad}</div>
              <div style={{ ...cell, justifyContent: "flex-end" }}>{fmt(calculadas.get(p.id)?.cu ?? 0)}</div>
              <div style={cell} title={catalogo.titulos.get(p.omniclass) ?? ""}>
                <span style={ellipsis}>{p.omniclass}</span>
              </div>
            </div>
          ))}
          <div style={{ height: padBottom }} />
          {filas.length === 0 && (
            <div style={{ padding: 20, color: "var(--tc-gray-500)", fontSize: 14 }}>
              {catalogo.partidas.length === 0 ? "El catálogo de partidas está vacío. Créalas con \"Nuevo\" o impórtalas desde Excel." : "Ninguna partida coincide."}
            </div>
          )}
        </div>
      </div>
      <div style={{ flex: "1 1 50%", minHeight: 200, display: "flex", flexDirection: "column", borderTop: `2px solid ${C.border}`, background: "#fff" }}>
        {selected ? (
          <ApuEditor apu={selected} resolver={resolver} insumos={[]} subpartidas={[]} unidad={selected.unidad} calculada={calculadas.get(selected.id)} />
        ) : (
          <div style={{ padding: 16, color: "var(--tc-gray-500)", fontSize: 14 }}>Elige una partida para ver su análisis de precios unitarios.</div>
        )}
      </div>

      {form && (
        <ApuDialog
          titulo={form.nuevo ? "Nueva partida del catálogo" : "Editar partida del catálogo"}
          modo="catalogo"
          inicial={form.data}
          catalogo={catalogo}
          propioId={form.id}
          onClose={() => setForm(null)}
          onAccept={async (data) => {
            const { metrado: _m, ...partida } = data;
            try {
              await api.guardarPartidas([{ id: form.id, ...partida }]);
              onSaved({ partidas: [{ id: form.id, ...partida, updatedAt: new Date().toISOString(), updatedBy: null }] });
              setSelectedId(form.id);
              setForm(null);
            } catch (err) {
              setError(message(err));
              setForm(null);
            }
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog title="Eliminar partida" danger confirmLabel="Eliminar" onClose={() => setConfirmDelete(null)} onConfirm={() => eliminar(confirmDelete)}>
          ¿Eliminar <strong>{confirmDelete.descripcion}</strong> del catálogo? Los presupuestos que ya la usan conservan su copia.
        </ConfirmDialog>
      )}
    </Modal>
  );
}

const grid: CSSProperties = { display: "grid", gridTemplateColumns: COLUMNS, fontSize: 14.5 };
const cell: CSSProperties = { display: "flex", alignItems: "center", padding: "0 8px", borderRight: `1px solid ${C.grid}`, overflow: "hidden", minWidth: 0 };
const head: CSSProperties = { ...cell, justifyContent: "center" };
const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const sep: CSSProperties = { width: 1, height: 22, background: C.border, margin: "0 6px" };
