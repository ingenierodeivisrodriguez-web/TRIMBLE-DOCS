"use client";

import { noticeBase, noticeStyles } from "../validacion/ui";
import type { ModelData } from "./useModelData";

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString("es")} ${n === 1 ? one : many}`;
}

/**
 * The models loaded in the viewer, to include or leave out of a tool. Shared
 * by the panel's tools: checking a model in one checks it in the others.
 */
export default function ModelosCard({ data, emptyText }: { data: ModelData; emptyText: string }) {
  const { models, checked, setChecked, sizes, reading, readError, guidError } = data;
  const loaded = models ?? [];
  return (
    <details open style={cardStyle}>
      <summary style={titleStyle}>
        Modelos ({checked.length}/{loaded.length})
      </summary>
      {models === null ? (
        <span style={mutedStyle}>Buscando los modelos cargados...</span>
      ) : loaded.length === 0 ? (
        <span style={mutedStyle}>{emptyText}</span>
      ) : (
        <ul style={listStyle}>
          {loaded.map((e) => {
            const isChecked = checked.includes(e.key);
            const size = sizes[e.key];
            const status =
              e.status === "listing"
                ? "buscando objetos..."
                : e.status === "empty"
                  ? "sin objetos"
                  : e.status === "error"
                    ? "no se pudo leer"
                    : reading && reading.name === e.spec.name && isChecked
                      ? `leyendo ${reading.done.toLocaleString("es")} de ${reading.total.toLocaleString("es")}`
                      : size !== undefined
                        ? count(size, "elemento", "elementos")
                        : isChecked
                          ? "en espera"
                          : count(e.list?.runtimeIds.length ?? 0, "objeto", "objetos");
            return (
              <li key={e.key}>
                <label style={checkRowStyle}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => setChecked((prev) => (prev.includes(e.key) ? prev.filter((k) => k !== e.key) : [...prev, e.key]))}
                  />
                  <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{e.spec.name}</span>
                  <span style={metaStyle}>{status}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {readError && <div style={{ ...noticeBase, ...noticeStyles.error }}>{readError}</div>}
      {guidError && <div style={{ ...noticeBase, ...noticeStyles.warning }}>{guidError}</div>}
    </details>
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--tc-white)",
  borderRadius: "var(--tc-radius)",
  boxShadow: "var(--tc-shadow)",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 14, fontWeight: 700, color: "var(--tc-blue-800)", cursor: "pointer" };
const mutedStyle: React.CSSProperties = { fontSize: 12.5, color: "var(--tc-gray-500)" };
const metaStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--tc-gray-500)", whiteSpace: "nowrap" };
const listStyle: React.CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 };
const checkRowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--tc-gray-700)", cursor: "pointer" };
