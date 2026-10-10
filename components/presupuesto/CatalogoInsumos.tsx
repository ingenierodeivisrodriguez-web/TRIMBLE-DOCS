"use client";

import { CSSProperties, useMemo, useState } from "react";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import { nuevoId } from "../../lib/presupuesto/doc";
import { coincide, fmt } from "../../lib/presupuesto/format";
import { tablaDe } from "../../lib/presupuesto/omniclass";
import { Insumo, InsumoData, TipoInsumo, TIPO_LABELS, TIPOS_INSUMO } from "../../lib/presupuesto/types";
import { ConfirmDialog } from "./SimpleDialogs";
import { acceptButton, baseInput, C, labelStyle, linkButton, message, Modal, Notice, NumInput, Square, useVirtual } from "./ui";
import type { Catalogo } from "./usePresupuesto";

const ROW = 40;
const COLUMNS = "30px minmax(260px, 1fr) 80px 120px 140px 90px 150px";

/** The catalog of resources: search, filter by kind, and (with permission) create, edit, duplicate or delete. */
export default function CatalogoInsumos({
  api,
  catalogo,
  canEdit,
  readOnlyNote,
  onSaved,
  onClose,
}: {
  api: PresupuestoApi;
  catalogo: Catalogo;
  canEdit: boolean;
  readOnlyNote: string;
  onSaved: (cambios: { insumos?: Insumo[]; sinInsumo?: string }) => void;
  onClose: () => void;
}) {
  const [tipo, setTipo] = useState<TipoInsumo | "">("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<{ id: string; data: InsumoData; nuevo: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Insumo | null>(null);
  const [error, setError] = useState("");

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of catalogo.insumos) c[i.tipo] = (c[i.tipo] ?? 0) + 1;
    return c;
  }, [catalogo.insumos]);

  const filas = useMemo(
    () => catalogo.insumos.filter((i) => (!tipo || i.tipo === tipo) && coincide(`${i.codigo} ${i.descripcion} ${i.unidad} ${i.omniclass} ${i.iu}`, query)),
    [catalogo.insumos, tipo, query]
  );
  const { ref, start, end, padTop, padBottom } = useVirtual(filas.length, ROW);
  const selected = selectedId ? catalogo.insumoMap.get(selectedId) ?? null : null;

  function abrir(nuevo: boolean, base?: Insumo, copia = false) {
    setError("");
    const data: InsumoData = base
      ? { codigo: copia ? "" : base.codigo, descripcion: copia ? `${base.descripcion} - (COPIA)` : base.descripcion, unidad: base.unidad, precio: base.precio, tipo: base.tipo, iu: base.iu, omniclass: base.omniclass }
      : { codigo: "", descripcion: "", unidad: "", precio: 0, tipo: tipo || "MT", iu: "", omniclass: "" };
    setForm({ id: nuevo ? nuevoId() : base!.id, data, nuevo });
  }

  async function eliminar(ins: Insumo) {
    setConfirmDelete(null);
    try {
      await api.eliminarInsumo(ins.id);
      onSaved({ sinInsumo: ins.id });
      setSelectedId(null);
    } catch (err) {
      setError(message(err));
    }
  }

  const disabled = !canEdit;
  return (
    <Modal
      title="Catálogo de Insumos"
      onClose={onClose}
      width={1200}
      height="88vh"
      toolbar={
        <>
          <button type="button" style={linkButton} disabled={disabled} onClick={() => abrir(true)}>
            Nuevo
          </button>
          <button type="button" style={linkButton} disabled={disabled || !selected} onClick={() => selected && abrir(false, selected)}>
            Editar
          </button>
          <button type="button" style={linkButton} disabled={disabled || !selected} onClick={() => selected && abrir(true, selected, true)}>
            Duplicar
          </button>
          <button type="button" style={linkButton} disabled={disabled || !selected} onClick={() => selected && setConfirmDelete(selected)}>
            Eliminar
          </button>
          <span style={sep} />
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: "var(--tc-gray-500)" }}>
            Tipo:
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoInsumo | "")} style={{ ...baseInput, fontSize: 14 }}>
              <option value="">TODOS LOS REGISTROS ({catalogo.insumos.length})</option>
              {TIPOS_INSUMO.map((t) => (
                <option key={t} value={t}>
                  {TIPO_LABELS[t].toUpperCase()} ({counts[t] ?? 0})
                </option>
              ))}
            </select>
          </label>
          <span style={{ flex: 1 }} />
          <input type="search" placeholder="Buscar" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...baseInput, width: 280, fontSize: 14 }} aria-label="Buscar insumos" />
        </>
      }
    >
      {!canEdit && <Notice kind="info" style={{ margin: "8px 10px 0" }}>{readOnlyNote}</Notice>}
      {error && <Notice kind="error" style={{ margin: "8px 10px 0" }}>{error}</Notice>}
      <div ref={ref} style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#fff" }}>
        <div style={{ minWidth: 900 }}>
          <div style={{ ...grid, height: 44, position: "sticky", top: 0, background: "#f3f4f6", zIndex: 1, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>
            <div />
            <div style={head}>Insumos</div>
            <div style={head}>Unidad</div>
            <div style={head}>Precio</div>
            <div style={head}>Tipo</div>
            <div style={head}>IU</div>
            <div style={head}>OmniClass</div>
          </div>
          <div style={{ height: padTop }} />
          {filas.slice(start, end).map((i) => (
            <div
              key={i.id}
              onClick={() => setSelectedId(i.id)}
              onDoubleClick={() => canEdit && abrir(false, i)}
              style={{ ...grid, height: ROW, background: i.id === selectedId ? C.rowSelected : "#fff", borderBottom: `1px solid ${C.grid}`, cursor: "default" }}
            >
              <div style={{ ...cell, justifyContent: "center" }}>
                <Square rubro={i.tipo} />
              </div>
              <div style={cell} title={i.codigo ? `${i.codigo} · ${i.descripcion}` : i.descripcion}>
                <span style={ellipsis}>{i.descripcion}</span>
              </div>
              <div style={{ ...cell, justifyContent: "center" }}>{i.unidad}</div>
              <div style={{ ...cell, justifyContent: "flex-end" }}>{fmt(i.precio)}</div>
              <div style={cell}>{TIPO_LABELS[i.tipo].toUpperCase()}</div>
              <div style={cell}>{i.iu}</div>
              <div style={cell} title={catalogo.titulos.get(i.omniclass) ?? ""}>
                <span style={ellipsis}>{i.omniclass}</span>
              </div>
            </div>
          ))}
          <div style={{ height: padBottom }} />
          {filas.length === 0 && (
            <div style={{ padding: 20, color: "var(--tc-gray-500)", fontSize: 14 }}>
              {catalogo.insumos.length === 0 ? "El catálogo de insumos está vacío. Créalos con \"Nuevo\" o impórtalos desde Excel." : "Ningún insumo coincide con la búsqueda."}
            </div>
          )}
        </div>
      </div>
      <div style={{ padding: "4px 10px", fontSize: 12.5, color: "var(--tc-gray-500)" }}>
        {filas.length.toLocaleString("es")} de {catalogo.insumos.length.toLocaleString("es")} insumos
      </div>

      {form && (
        <InsumoForm
          titulo={form.nuevo ? "Nuevo insumo" : "Editar insumo"}
          inicial={form.data}
          catalogo={catalogo}
          onClose={() => setForm(null)}
          onAccept={async (data) => {
            await api.guardarInsumos([{ id: form.id, ...data }]);
            onSaved({ insumos: [{ id: form.id, ...data, updatedAt: new Date().toISOString(), updatedBy: null }] });
            setSelectedId(form.id);
            setForm(null);
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog title="Eliminar insumo" danger confirmLabel="Eliminar" onClose={() => setConfirmDelete(null)} onConfirm={() => eliminar(confirmDelete)}>
          ¿Eliminar <strong>{confirmDelete.descripcion}</strong> del catálogo? Los presupuestos que ya lo usan conservan su copia y su precio.
        </ConfirmDialog>
      )}
    </Modal>
  );
}

/** Creates an insumo in the catalog from where it is needed (e.g. a partida's analysis), starting from the typed name. */
export function InsumoNuevoDialog({
  api,
  catalogo,
  descripcion,
  onCreated,
  onClose,
}: {
  api: PresupuestoApi;
  catalogo: Catalogo;
  descripcion: string;
  onCreated: (insumo: Insumo) => void;
  onClose: () => void;
}) {
  return (
    <InsumoForm
      titulo="Nuevo insumo"
      inicial={{ codigo: "", descripcion, unidad: "", precio: 0, tipo: "MT", iu: "", omniclass: "" }}
      catalogo={catalogo}
      onClose={onClose}
      onAccept={async (data) => {
        const id = nuevoId();
        await api.guardarInsumos([{ id, ...data }]);
        onCreated({ id, ...data, updatedAt: new Date().toISOString(), updatedBy: null });
      }}
    />
  );
}

function InsumoForm({
  titulo,
  inicial,
  catalogo,
  onAccept,
  onClose,
}: {
  titulo: string;
  inicial: InsumoData;
  catalogo: Catalogo;
  onAccept: (data: InsumoData) => Promise<void>;
  onClose: () => void;
}) {
  const [data, setData] = useState(inicial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const codigos = useMemo(() => catalogo.codigos.filter((c) => tablaDe(c.codigo) !== "22"), [catalogo.codigos]);
  const ius = useMemo(() => [...new Set(catalogo.insumos.map((i) => i.iu).filter(Boolean))].sort(), [catalogo.insumos]);

  async function aceptar() {
    if (!data.descripcion.trim()) return setError("Escribe la descripción del insumo.");
    setSaving(true);
    setError("");
    try {
      await onAccept({ ...data, codigo: data.codigo.trim(), descripcion: data.descripcion.trim(), unidad: data.unidad.trim(), iu: data.iu.trim(), omniclass: data.omniclass.trim() });
    } catch (err) {
      setError(message(err));
      setSaving(false);
    }
  }

  return (
    <Modal
      title={titulo}
      onClose={onClose}
      width={760}
      footer={
        <>
          {error && <span style={{ color: "#8a1c14", fontSize: 13.5 }}>{error}</span>}
          <button type="button" style={acceptButton} disabled={saving} onClick={aceptar}>
            {saving ? "Guardando..." : "Aceptar"}
          </button>
        </>
      }
    >
      <div style={{ padding: "14px 16px", display: "grid", gridTemplateColumns: "130px 1fr 110px", gap: 12 }}>
        <label>
          <span style={labelStyle}>Código</span>
          <input value={data.codigo} maxLength={40} onChange={(e) => setData({ ...data, codigo: e.target.value })} style={f} />
        </label>
        <label>
          <span style={labelStyle}>Descripción</span>
          <input autoFocus value={data.descripcion} maxLength={300} onChange={(e) => setData({ ...data, descripcion: e.target.value })} style={f} />
        </label>
        <label>
          <span style={labelStyle}>Unidad</span>
          <input value={data.unidad} maxLength={20} onChange={(e) => setData({ ...data, unidad: e.target.value })} style={f} placeholder="HH, KG, M3, %MO..." />
        </label>
        <label>
          <span style={labelStyle}>Precio</span>
          <NumInput value={data.precio} decimals={2} onCommit={(v) => v !== null && setData({ ...data, precio: v })} style={{ ...f, textAlign: "right" }} />
        </label>
        <label>
          <span style={labelStyle}>Tipo</span>
          <select value={data.tipo} onChange={(e) => setData({ ...data, tipo: e.target.value as TipoInsumo })} style={f}>
            {TIPOS_INSUMO.map((t) => (
              <option key={t} value={t}>
                {t} · {TIPO_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span style={labelStyle}>IU</span>
          <input value={data.iu} list="presupuesto-ius" maxLength={40} onChange={(e) => setData({ ...data, iu: e.target.value })} style={f} />
          <datalist id="presupuesto-ius">
            {ius.map((iu) => (
              <option key={iu} value={iu} />
            ))}
          </datalist>
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          <span style={labelStyle}>Clasificación OmniClass (p. ej. Tabla 23 Productos, 41 Materiales o 34 Roles)</span>
          <input value={data.omniclass} list="presupuesto-omniclass-insumos" maxLength={60} onChange={(e) => setData({ ...data, omniclass: e.target.value })} style={{ ...f, maxWidth: 360 }} placeholder="p. ej. 23-13 35 11" />
          <datalist id="presupuesto-omniclass-insumos">
            {codigos.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.titulo}
              </option>
            ))}
          </datalist>
          {data.omniclass && <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)", marginLeft: 8 }}>{catalogo.titulos.get(data.omniclass) ?? ""}</span>}
        </label>
        <p style={{ gridColumn: "1 / -1", margin: 0, fontSize: 12.5, color: "var(--tc-gray-500)" }}>
          Para herramientas que se cobran como porcentaje de la mano de obra, usa la unidad <strong>%MO</strong>: en la partida, su cantidad es el porcentaje.
        </p>
      </div>
    </Modal>
  );
}

const grid: CSSProperties = { display: "grid", gridTemplateColumns: COLUMNS, fontSize: 14.5 };
const cell: CSSProperties = { display: "flex", alignItems: "center", padding: "0 8px", borderRight: `1px solid ${C.grid}`, overflow: "hidden", minWidth: 0 };
const head: CSSProperties = { ...cell, justifyContent: "center" };
const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const sep: CSSProperties = { width: 1, height: 22, background: C.border, margin: "0 6px" };
const f: CSSProperties = { ...baseInput, width: "100%", fontSize: 15, padding: "8px 10px" };
