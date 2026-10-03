"use client";

import { useMemo, useState } from "react";
import { normalizeForSearch } from "../../lib/folderTree";
import { bucketCounts, formatNumber, GENERAL_GROUP, ModelDataset, SlicerSpec } from "../../lib/graficos/modelData";
import type { GroupField } from "../../lib/propiedades/grouping";

function fieldLabel(field: GroupField): string {
  return field.unit ? `${field.label} (${field.unit})` : field.label;
}

/**
 * Slicers of one Simulador chart ("segmentadores", as in Gráficos de Modelos):
 * pick a text or date field and tick the values to keep. They filter only
 * this chart (and what it colors in the model).
 */
export default function SimSlicers({
  fields,
  datasets,
  slicers,
  onChange,
  title = "Segmentadores",
  emptyHint = "Filtra los elementos de este gráfico por un dato de texto o fecha, p. ej. solo ciertos tipos o niveles.",
}: {
  title?: string;
  /** Shown while there are no slicers yet. */
  emptyHint?: string;
  fields: GroupField[];
  /** Every element with the simulated date, unfiltered: the lists always show every value. */
  datasets: ModelDataset[];
  slicers: SlicerSpec[];
  onChange: (slicers: SlicerSpec[]) => void;
}) {
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const used = new Set(slicers.map((s) => s.field));
  const candidates = fields.filter((f) => f.kind !== "number" && !used.has(f.key));
  const active = slicers.filter((s) => s.selected !== null).length;

  return (
    <details style={boxStyle} open={slicers.length > 0 || undefined}>
      <summary style={summaryStyle}>
        {title}
        {slicers.length > 0 && (
          <span style={{ fontWeight: 600, color: active ? "var(--tc-blue-700)" : "var(--tc-gray-500)" }}>
            {" "}
            · {active ? `${active} filtrando` : "sin filtrar"}
          </span>
        )}
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value=""
            onChange={(e) => {
              const field = byKey.get(e.target.value);
              if (field) onChange([...slicers, { field: field.key, kind: field.kind, selected: null }]);
            }}
            disabled={candidates.length === 0}
            style={addSelectStyle}
            aria-label="Agregar segmentador"
          >
            <option value="">+ Agregar segmentador...</option>
            {candidates.map((f) => (
              <option key={f.key} value={f.key}>
                {f.kind === "date" ? "📅 " : ""}
                {fieldLabel(f)}
                {f.fromApp ? " — atributo del proyecto" : f.group !== GENERAL_GROUP ? ` — ${f.group}` : ""}
              </option>
            ))}
          </select>
          {active > 0 && (
            <button type="button" style={linkStyle} onClick={() => onChange(slicers.map((s) => ({ ...s, selected: null })))}>
              Quitar filtros
            </button>
          )}
        </div>
        {slicers.length === 0 && (
          <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>
            {emptyHint}
          </span>
        )}
        {slicers.map((slicer) => {
          const field = byKey.get(slicer.field);
          if (!field) return null;
          return (
            <SlicerBox
              key={slicer.field}
              field={field}
              datasets={datasets}
              selected={slicer.selected}
              onSelect={(selected) => onChange(slicers.map((s) => (s.field === slicer.field ? { ...s, selected } : s)))}
              onRemove={() => onChange(slicers.filter((s) => s.field !== slicer.field))}
            />
          );
        })}
      </div>
    </details>
  );
}

function SlicerBox({
  field,
  datasets,
  selected,
  onSelect,
  onRemove,
}: {
  field: GroupField;
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
    // Every value ticked means "no filter".
    onSelect(next.size === values.length ? null : values.filter((v) => next.has(v.key)).map((v) => v.key));
  }

  return (
    <div style={{ ...slicerStyle, borderColor: selected ? "var(--tc-blue-500)" : "var(--tc-gray-100)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--tc-gray-700)", wordBreak: "break-word" }}>{fieldLabel(field)}</div>
          <div style={{ fontSize: 11, color: "var(--tc-gray-500)" }}>
            {selected ? `${selected.length} de ${values.length} valores` : `Todos (${values.length} valores)`}
          </div>
        </div>
        <button type="button" onClick={onRemove} style={removeStyle} aria-label={`Quitar segmentador ${field.label}`}>
          ✕
        </button>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" style={linkStyle} onClick={() => onSelect(null)}>
          Todos
        </button>
        <button type="button" style={linkStyle} onClick={() => onSelect([])}>
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
          aria-label={`Buscar valor de ${field.label}`}
        />
      )}
      <div style={{ maxHeight: 150, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {visible.map((v) => (
          <label key={v.key} style={valueRowStyle}>
            <input type="checkbox" checked={selectedSet.has(v.key)} onChange={() => toggle(v.key)} />
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v.label}>
              {v.label}
            </span>
            <span style={{ fontSize: 11, color: "var(--tc-gray-500)", fontVariantNumeric: "tabular-nums" }}>{formatNumber(v.objects)}</span>
          </label>
        ))}
        {visible.length === 0 && <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>Sin coincidencias.</span>}
      </div>
    </div>
  );
}

const boxStyle: React.CSSProperties = { border: "1px solid var(--tc-gray-100)", borderRadius: 8, padding: "6px 10px", background: "var(--tc-blue-50)" };
const summaryStyle: React.CSSProperties = { cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "var(--tc-blue-800)" };
const slicerStyle: React.CSSProperties = {
  border: "1px solid var(--tc-gray-100)",
  borderRadius: 8,
  padding: 8,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minWidth: 0,
  background: "var(--tc-white)",
};
const linkStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--tc-blue-700)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  padding: 0,
  fontFamily: "inherit",
};
const addSelectStyle: React.CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 12,
  color: "var(--tc-blue-700)",
  background: "var(--tc-white)",
  fontFamily: "inherit",
  maxWidth: "100%",
};
const removeStyle: React.CSSProperties = {
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
const valueRowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--tc-gray-700)", cursor: "pointer" };
