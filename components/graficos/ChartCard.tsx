"use client";

import { useMemo, useState } from "react";
import {
  aggregate,
  ChartSpec,
  CommonField,
  foldRows,
  formatNumber,
  ModelDataset,
} from "../../lib/graficos/modelData";
import { ColumnChart, DonutChart, HorizontalBarChart, MAX_COLUMNS, MAX_HORIZONTAL_BARS, MAX_SLICES } from "./Charts";

export type ChartKind = "column" | "horizontal" | "donut";

export const FIELD_DRAG_TYPE = "application/x-graficos-field";

const TABLE_ROW_LIMIT = 200;

export function fieldLabel(field: CommonField): string {
  return field.unit ? `${field.label} (${field.unit})` : field.label;
}

/** Reads the dragged field key, if the drag came from one of our chips. */
function draggedKey(e: React.DragEvent): string | null {
  return e.dataTransfer.getData(FIELD_DRAG_TYPE) || null;
}

function acceptsDrag(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(FIELD_DRAG_TYPE);
}

export default function ChartCard({
  title,
  kind,
  spec,
  fields,
  datasets,
  onChange,
}: {
  title: string;
  kind: ChartKind;
  spec: ChartSpec;
  fields: CommonField[];
  /** null while the selected models are still being read. */
  datasets: ModelDataset[] | null;
  /** Receives an updater of the latest spec, so quick successive drops never overwrite each other. */
  onChange: (update: (prev: ChartSpec) => ChartSpec) => void;
}) {
  const [showTable, setShowTable] = useState(false);
  const [dragOver, setDragOver] = useState<"card" | "category" | "value" | null>(null);
  const [notice, setNotice] = useState("");

  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const numericFields = fields.filter((f) => f.kind === "number");
  const category = spec.category ? byKey.get(spec.category) : undefined;
  const value = spec.value ? byKey.get(spec.value) : undefined;

  const result = useMemo(
    () => (datasets && category ? aggregate(datasets, { category: category.key, value: value?.key ?? null }) : null),
    [datasets, category, value]
  );

  const unitLabel = value ? (value.unit ?? "") : "objetos";
  const valueTitle = value ? fieldLabel(value) : "Cantidad de objetos";

  function place(key: string, target: "card" | "category" | "value") {
    const field = byKey.get(key);
    if (!field) return;
    setNotice("");
    if (target === "category" || (target === "card" && field.kind === "text")) {
      onChange((prev) => ({ ...prev, category: key }));
      return;
    }
    if (field.kind !== "number") {
      setNotice(`"${field.label}" es un dato de texto: solo se pueden sumar datos numéricos (longitud, área, volumen...).`);
      return;
    }
    // A number still needs categories to split by; "Modelo" always exists,
    // and the user can swap it for any other field.
    onChange((prev) => ({
      value: key,
      category: prev.category && byKey.has(prev.category) ? prev.category : "@model",
    }));
  }

  function dropHandlers(target: "card" | "category" | "value") {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!acceptsDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        setDragOver(target);
      },
      onDragLeave: (e: React.DragEvent) => {
        e.stopPropagation();
        setDragOver((current) => (current === target ? null : current));
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(null);
        const key = draggedKey(e);
        if (key) place(key, target);
      },
    };
  }

  const rows = result?.rows ?? [];
  const chartRows =
    kind === "column"
      ? foldRows(rows, MAX_COLUMNS)
      : kind === "horizontal"
        ? foldRows(rows, MAX_HORIZONTAL_BARS)
        : foldRows(rows, MAX_SLICES);

  return (
    <section
      {...dropHandlers("card")}
      style={{
        background: "var(--tc-white)",
        borderRadius: "var(--tc-radius)",
        boxShadow: dragOver === "card" ? "0 0 0 2px var(--tc-blue-500), var(--tc-shadow)" : "var(--tc-shadow)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: "var(--tc-gray-500)" }}>
            {title.toUpperCase()}
          </div>
          <h3 style={{ margin: "2px 0 0", fontSize: 14.5, color: "var(--tc-blue-800)", wordBreak: "break-word" }}>
            {category ? `${valueTitle} por ${fieldLabel(category)}` : "Sin datos asignados"}
          </h3>
        </div>
        {result && rows.length > 0 && (
          <button type="button" onClick={() => setShowTable((v) => !v)} style={linkButtonStyle}>
            {showTable ? "Ver gráfico" : "Ver tabla"}
          </button>
        )}
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 8px", alignItems: "center" }}>
        <SlotLabel>Categorías</SlotLabel>
        <Slot highlighted={dragOver === "category"} {...dropHandlers("category")}>
          <select
            value={category?.key ?? ""}
            disabled={fields.length === 0}
            onChange={(e) => {
              const next = e.target.value || null;
              onChange((prev) => ({ ...prev, category: next }));
            }}
            style={selectStyle}
            aria-label={`Categorías del gráfico ${title}`}
          >
            <option value="">Arrastra o elige un dato...</option>
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {optionLabel(f)}
              </option>
            ))}
          </select>
        </Slot>
        <SlotLabel>Valor</SlotLabel>
        <Slot highlighted={dragOver === "value"} {...dropHandlers("value")}>
          <select
            value={value?.key ?? ""}
            disabled={fields.length === 0}
            onChange={(e) => {
              const next = e.target.value || null;
              onChange((prev) => ({ ...prev, value: next }));
            }}
            style={selectStyle}
            aria-label={`Valor del gráfico ${title}`}
          >
            <option value="">Cantidad de objetos</option>
            {numericFields.map((f) => (
              <option key={f.key} value={f.key}>
                Suma de {optionLabel(f)}
              </option>
            ))}
          </select>
        </Slot>
      </div>

      {notice && <div style={{ fontSize: 12, color: "#8a1c14" }}>{notice}</div>}

      <div style={{ minHeight: 200, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {!category ? (
          <Placeholder highlighted={dragOver !== null}>
            {fields.length === 0
              ? "Selecciona uno o varios modelos para ver sus datos."
              : "Arrastra aquí un dato de la lista para construir este gráfico."}
          </Placeholder>
        ) : !datasets ? (
          <Placeholder>Leyendo los datos de los modelos...</Placeholder>
        ) : rows.length === 0 ? (
          <Placeholder>Ningún objeto de los modelos seleccionados tiene estos datos.</Placeholder>
        ) : showTable ? (
          <DataTable rows={rows} categoryTitle={fieldLabel(category)} valueTitle={valueTitle} />
        ) : kind === "column" ? (
          <ColumnChart rows={chartRows} unitLabel={unitLabel} />
        ) : kind === "horizontal" ? (
          <HorizontalBarChart rows={chartRows} unitLabel={unitLabel} />
        ) : (
          <DonutChart rows={chartRows} unitLabel={unitLabel} />
        )}
      </div>

      {result && rows.length > 0 && (
        <div style={{ fontSize: 11.5, color: "var(--tc-gray-500)" }}>
          {formatNumber(result.objectsWithData)} de {formatNumber(result.totalObjects)} objetos tienen estos datos ·{" "}
          {formatNumber(rows.length)} categorías
          {chartRows.length < rows.length && !showTable ? " (las menores se agrupan en “Otros”)" : ""}
        </div>
      )}
    </section>
  );
}

function optionLabel(field: CommonField): string {
  return field.group === "General" ? fieldLabel(field) : `${fieldLabel(field)} — ${field.group}`;
}

function SlotLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12, fontWeight: 600, color: "var(--tc-gray-500)" }}>{children}</span>;
}

function Slot({
  highlighted,
  children,
  ...handlers
}: {
  highlighted: boolean;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...handlers}
      style={{
        borderRadius: 6,
        outline: highlighted ? "2px solid var(--tc-blue-500)" : "none",
        background: highlighted ? "var(--tc-blue-100)" : "transparent",
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

function Placeholder({ children, highlighted }: { children: React.ReactNode; highlighted?: boolean }) {
  return (
    <div
      style={{
        border: `1.5px dashed ${highlighted ? "var(--tc-blue-500)" : "var(--tc-gray-300)"}`,
        background: highlighted ? "var(--tc-blue-50)" : "transparent",
        borderRadius: 8,
        minHeight: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 16,
        fontSize: 13,
        color: "var(--tc-gray-500)",
      }}
    >
      {children}
    </div>
  );
}

function DataTable({
  rows,
  categoryTitle,
  valueTitle,
}: {
  rows: { label: string; value: number; objects: number }[];
  categoryTitle: string;
  valueTitle: string;
}) {
  const shown = rows.slice(0, TABLE_ROW_LIMIT);
  return (
    <div style={{ maxHeight: 300, overflowY: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ position: "sticky", top: 0, background: "var(--tc-white)" }}>
            <th style={thStyle}>{categoryTitle}</th>
            <th style={{ ...thStyle, textAlign: "right" }}>{valueTitle}</th>
            <th style={{ ...thStyle, textAlign: "right" }}>Objetos</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <tr key={row.label}>
              <td style={{ ...tdStyle, wordBreak: "break-word" }}>{row.label}</td>
              <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {formatNumber(row.value)}
              </td>
              <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {formatNumber(row.objects)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length && (
        <div style={{ fontSize: 11.5, color: "var(--tc-gray-500)", padding: "6px 4px" }}>
          Se muestran las {TABLE_ROW_LIMIT} categorías mayores de {formatNumber(rows.length)}.
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 12.5,
  color: "var(--tc-gray-700)",
  background: "var(--tc-white)",
  fontFamily: "inherit",
};

const linkButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--tc-blue-700)",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  padding: 0,
  whiteSpace: "nowrap",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 6px",
  borderBottom: "1px solid var(--tc-gray-300)",
  color: "var(--tc-gray-500)",
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: "5px 6px",
  borderBottom: "1px solid var(--tc-gray-100)",
  color: "var(--tc-gray-700)",
};
