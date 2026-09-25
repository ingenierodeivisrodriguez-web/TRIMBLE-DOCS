"use client";

import { useMemo, useState } from "react";
import { normalizeForSearch } from "../../lib/folderTree";
import { bucketCounts, CommonField, formatNumber, ModelDataset, SlicerSpec } from "../../lib/graficos/modelData";
import { FIELD_DRAG_TYPE, fieldLabel, kindMark } from "./ChartCard";

/**
 * Slicers ("segmentadores"): pick a text or date field, then tick the values
 * to keep. They apply to every chart at once - one filter row above
 * everything it scopes.
 */
export default function Slicers({
  fields,
  datasets,
  slicers,
  onChange,
  shownObjects,
  totalObjects,
}: {
  fields: CommonField[];
  /** Unfiltered data of the selected models (slicer lists always show every value). */
  datasets: ModelDataset[];
  slicers: SlicerSpec[];
  onChange: (update: (prev: SlicerSpec[]) => SlicerSpec[]) => void;
  shownObjects: number;
  totalObjects: number;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState("");
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const used = new Set(slicers.map((s) => s.field));
  const candidates = fields.filter((f) => f.kind !== "number" && !used.has(f.key));
  const filtering = slicers.some((s) => s.selected !== null);

  function add(key: string) {
    const field = byKey.get(key);
    if (!field) return;
    setNotice("");
    if (field.kind === "number") {
      setNotice(`Los segmentadores filtran por datos de texto o fecha; "${field.label}" es numérico.`);
      return;
    }
    onChange((prev) =>
      prev.some((s) => s.field === key) ? prev : [...prev, { field: key, kind: field.kind, selected: null }]
    );
  }

  return (
    <section
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(FIELD_DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const key = e.dataTransfer.getData(FIELD_DRAG_TYPE);
        if (key) add(key);
      }}
      style={{
        background: "var(--tc-white)",
        borderRadius: "var(--tc-radius)",
        boxShadow: dragOver ? "0 0 0 2px var(--tc-blue-500), var(--tc-shadow)" : "var(--tc-shadow)",
        padding: 14,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 14, color: "var(--tc-blue-800)" }}>3. Segmentadores</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {filtering && (
            <button type="button" style={linkButtonStyle} onClick={() => onChange((prev) => prev.map((s) => ({ ...s, selected: null })))}>
              Quitar filtros
            </button>
          )}
          <select
            value=""
            onChange={(e) => e.target.value && add(e.target.value)}
            disabled={candidates.length === 0}
            style={addSelectStyle}
            aria-label="Agregar segmentador"
          >
            <option value="">+ Agregar segmentador...</option>
            {candidates.map((f) => (
              <option key={f.key} value={f.key}>
                {f.kind === "date" ? "📅 " : ""}
                {fieldLabel(f)}
                {f.group !== "General" ? ` — ${f.group}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {notice && <div style={{ fontSize: 12, color: "#8a1c14", marginTop: 6 }}>{notice}</div>}

      {slicers.length === 0 ? (
        <div
          style={{
            marginTop: 10,
            border: `1.5px dashed ${dragOver ? "var(--tc-blue-500)" : "var(--tc-gray-300)"}`,
            borderRadius: 8,
            padding: "12px 14px",
            fontSize: 12.5,
            color: "var(--tc-gray-500)",
            textAlign: "center",
          }}
        >
          Arrastra aquí un dato de texto (Aa) o de fecha (📅) para filtrar los elementos de todos los gráficos, por
          ejemplo solo ciertos tipos, materiales o meses.
        </div>
      ) : (
        <div
          style={{
            marginTop: 10,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
            gap: 10,
          }}
        >
          {slicers.map((slicer) => {
            const field = byKey.get(slicer.field);
            if (!field) return null;
            return (
              <SlicerCard
                key={slicer.field}
                field={field}
                datasets={datasets}
                selected={slicer.selected}
                onSelect={(selected) =>
                  onChange((prev) => prev.map((s) => (s.field === slicer.field ? { ...s, selected } : s)))
                }
                onRemove={() => onChange((prev) => prev.filter((s) => s.field !== slicer.field))}
              />
            );
          })}
        </div>
      )}

      {filtering && (
        <div style={{ fontSize: 12, color: "var(--tc-blue-900)", marginTop: 8 }}>
          Los gráficos muestran {formatNumber(shownObjects)} de {formatNumber(totalObjects)} objetos.
        </div>
      )}
    </section>
  );
}

function SlicerCard({
  field,
  datasets,
  selected,
  onSelect,
  onRemove,
}: {
  field: CommonField;
  datasets: ModelDataset[];
  selected: string[] | null;
  onSelect: (selected: string[] | null) => void;
  onRemove: () => void;
}) {
  const [search, setSearch] = useState("");
  const values = useMemo(() => bucketCounts(datasets, field.key, field.kind), [datasets, field]);
  const selectedSet = new Set(selected ?? values.map((v) => v.key));
  const visible = useMemo(() => {
    const q = normalizeForSearch(search.trim());
    return q ? values.filter((v) => normalizeForSearch(v.label).includes(q)) : values;
  }, [values, search]);

  function toggle(key: string) {
    const next = new Set(selectedSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // Every value ticked means "no filter" - which also lets values that appear later pass.
    onSelect(next.size === values.length ? null : values.filter((v) => next.has(v.key)).map((v) => v.key));
  }

  return (
    <div
      style={{
        border: `1px solid ${selected ? "var(--tc-blue-500)" : "var(--tc-gray-100)"}`,
        borderRadius: 8,
        padding: 10,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--tc-gray-700)", wordBreak: "break-word" }}>
            <span style={{ color: "var(--tc-gray-500)", fontWeight: 600, marginRight: 4 }}>{kindMark(field)}</span>
            {fieldLabel(field)}
          </div>
          <div style={{ fontSize: 11, color: "var(--tc-gray-500)" }}>
            {selected ? `${selected.length} de ${values.length} valores` : `Todos (${values.length} valores)`}
          </div>
        </div>
        <button type="button" onClick={onRemove} style={removeButtonStyle} aria-label={`Quitar segmentador ${field.label}`}>
          ✕
        </button>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" style={linkButtonStyle} onClick={() => onSelect(null)}>
          Todos
        </button>
        <button type="button" style={linkButtonStyle} onClick={() => onSelect([])}>
          Ninguno
        </button>
      </div>

      {values.length > 8 && (
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar valor..."
          style={searchStyle}
        />
      )}

      <div style={{ maxHeight: 170, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {visible.map((v) => (
          <label
            key={v.key}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--tc-gray-700)", cursor: "pointer" }}
          >
            <input type="checkbox" checked={selectedSet.has(v.key)} onChange={() => toggle(v.key)} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v.label}>
              {v.label}
            </span>
            <span style={{ fontSize: 11, color: "var(--tc-gray-500)", fontVariantNumeric: "tabular-nums" }}>
              {formatNumber(v.objects)}
            </span>
          </label>
        ))}
        {visible.length === 0 && <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>Sin coincidencias.</span>}
      </div>
    </div>
  );
}

const linkButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--tc-blue-700)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  padding: 0,
};

const addSelectStyle: React.CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 12,
  color: "var(--tc-blue-700)",
  background: "var(--tc-white)",
  fontFamily: "inherit",
  maxWidth: 220,
};

const removeButtonStyle: React.CSSProperties = {
  border: "none",
  background: "var(--tc-gray-100)",
  borderRadius: 6,
  width: 22,
  height: 22,
  cursor: "pointer",
  color: "var(--tc-gray-700)",
  fontSize: 11,
  flexShrink: 0,
};

const searchStyle: React.CSSProperties = {
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 12,
  fontFamily: "inherit",
};
