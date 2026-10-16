"use client";

import { CSSProperties, ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { parseNumberInput } from "../../lib/propiedades/values";
import { editable, fmt } from "../../lib/presupuesto/format";
import { Rubro, RUBRO_COLORS } from "../../lib/presupuesto/types";
import { noticeBase, noticeStyles } from "../validacion/ui";

export const C = {
  header: "#2f55b0",
  close: "#b3261e",
  accept: "#2e6b22",
  rowSelected: "#cfe0fa",
  rowTitle: "#f6f8fb",
  border: "#dfe4ea",
  grid: "#e8ecf1",
};

/** The cell being edited, lit in yellow so it is clear where one is typing. */
export const celdaActiva: CSSProperties = { background: "#fff7a8", border: "1px solid #d4b106", outline: "none" };

/** How a cell was left: Enter (commits and may go on), Escape (cancels) or elsewhere (commits). */
export type Salida = "enter" | "escape" | "blur";

export const baseInput: CSSProperties = {
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 4,
  padding: "5px 8px",
  fontSize: 13.5,
  fontFamily: "inherit",
  color: "var(--tc-gray-700)",
  background: "var(--tc-white)",
  outline: "none",
  boxSizing: "border-box",
  minWidth: 0,
};

export const cellInput: CSSProperties = {
  ...baseInput,
  width: "100%",
  padding: "3px 6px",
  border: "1px solid var(--tc-blue-500)",
  borderRadius: 3,
  fontSize: 13,
};

export const linkButton: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--tc-gray-700)",
  padding: "6px 8px",
  fontSize: 14,
  cursor: "pointer",
  fontFamily: "inherit",
  borderRadius: 4,
  whiteSpace: "nowrap",
};

export const acceptButton: CSSProperties = {
  border: "none",
  background: C.accept,
  color: "#fff",
  borderRadius: 3,
  padding: "8px 18px",
  fontSize: 15,
  cursor: "pointer",
  fontFamily: "inherit",
};

export const labelStyle: CSSProperties = { display: "block", fontSize: 13, color: "var(--tc-gray-500)", marginBottom: 4 };

export function Notice({ kind, children, style }: { kind: "info" | "warning" | "error"; children: ReactNode; style?: CSSProperties }) {
  return <div style={{ ...noticeBase, ...noticeStyles[kind], fontSize: 13, ...style }}>{children}</div>;
}

/** A small square with the color of a resource kind. */
export function Square({ rubro }: { rubro: Rubro }) {
  return <span style={{ display: "inline-block", width: 11, height: 11, background: RUBRO_COLORS[rubro], borderRadius: 1 }} aria-label={rubro} />;
}

/** "MO: 16.83" box of the APU header. */
export function RubroChip({ label, value, color, strong }: { label: string; value: number; color: string; strong?: boolean }) {
  return (
    <span style={{ display: "inline-flex", border: `1px solid ${color}`, borderRadius: 2, overflow: "hidden", fontSize: 15, lineHeight: "26px" }}>
      <span style={{ background: color, color: "#fff", fontWeight: 700, padding: "0 6px" }}>{label}:</span>
      <span style={{ background: `${color}22`, padding: "0 7px", fontWeight: strong ? 700 : 400, minWidth: 48, textAlign: "right" }}>{fmt(value)}</span>
    </span>
  );
}

/**
 * A number input that shows the number formatted, and the plain number while
 * typing; commits on Enter or when leaving the field.
 */
export function NumInput({
  value,
  decimals = 2,
  onCommit,
  readOnly,
  style,
  ariaLabel,
  allowEmpty,
  autoFocus,
  onLeave,
}: {
  value: number | null;
  decimals?: number;
  onCommit?: (value: number | null) => void;
  readOnly?: boolean;
  style?: CSSProperties;
  ariaLabel?: string;
  allowEmpty?: boolean;
  autoFocus?: boolean;
  /** After leaving the field (and committing, unless with Escape). */
  onLeave?: (how: Salida) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const salida = useRef<Salida | null>(null);
  const shown = text ?? (value === null ? "" : fmt(value, decimals));
  const editando = text !== null;
  function commit() {
    if (text === null) return;
    const parsed = text.trim() === "" ? null : parseNumberInput(text);
    setText(null);
    if (parsed === null && !(allowEmpty && text.trim() === "")) return;
    if (parsed !== null && parsed < 0) return;
    if (parsed !== value) onCommit?.(parsed);
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={shown}
      readOnly={readOnly || !onCommit}
      autoFocus={autoFocus}
      onFocus={(e) => {
        if (readOnly || !onCommit) return;
        setText(editable(value, Math.max(decimals, 4)));
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const how = salida.current ?? "blur";
        salida.current = null;
        if (how === "escape") setText(null);
        else commit();
        onLeave?.(how);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== "Escape") return;
        salida.current = e.key === "Enter" ? "enter" : "escape";
        (e.target as HTMLInputElement).blur();
      }}
      style={{
        ...baseInput,
        textAlign: "right",
        background: readOnly || !onCommit ? "transparent" : "var(--tc-white)",
        border: readOnly || !onCommit ? "1px solid transparent" : baseInput.border,
        ...style,
        ...(editando ? celdaActiva : {}),
      }}
    />
  );
}

/** A text input that commits on Enter or blur (Escape cancels). */
export function TextCommit({
  value,
  onCommit,
  style,
  ariaLabel,
  autoFocus,
  placeholder,
  maxLength = 300,
  onLeave,
}: {
  value: string;
  onCommit: (value: string) => void;
  style?: CSSProperties;
  ariaLabel?: string;
  autoFocus?: boolean;
  placeholder?: string;
  maxLength?: number;
  /** After leaving the field (and committing, unless with Escape). */
  onLeave?: (how: Salida) => void;
}) {
  const [text, setText] = useState(value);
  const [foco, setFoco] = useState(false);
  const salida = useRef<Salida | null>(null);
  useEffect(() => setText(value), [value]);
  return (
    <input
      type="text"
      value={text}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => setFoco(true)}
      onBlur={() => {
        const how = salida.current ?? "blur";
        salida.current = null;
        setFoco(false);
        if (how === "escape") setText(value);
        else if (text !== value) onCommit(text);
        onLeave?.(how);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== "Escape") return;
        salida.current = e.key === "Enter" ? "enter" : "escape";
        (e.target as HTMLInputElement).blur();
      }}
      style={{ ...baseInput, ...style, ...(foco ? celdaActiva : {}) }}
    />
  );
}

/** A dialog in the style of the budget tool: blue title bar, red close button. */
export function Modal({
  title,
  onClose,
  width = 900,
  height,
  children,
  toolbar,
  footer,
}: {
  title: string;
  onClose: () => void;
  width?: number | string;
  height?: number | string;
  children: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="presentation"
      style={{ position: "fixed", inset: 0, background: "rgba(20,30,45,0.35)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width,
          maxWidth: "100%",
          height,
          maxHeight: "100%",
          background: "#f7f8fa",
          boxShadow: "0 12px 40px rgba(0,0,0,0.3)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div style={{ background: C.header, color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 500, padding: "9px 14px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{ border: "none", background: C.close, color: "#fff", fontSize: 16, width: 38, alignSelf: "stretch", cursor: "pointer", fontFamily: "inherit" }}
          >
            X
          </button>
        </div>
        {toolbar && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap", flexShrink: 0 }}>{toolbar}</div>
        )}
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>{children}</div>
        {footer && <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, padding: "10px 14px", flexShrink: 0 }}>{footer}</div>}
      </div>
    </div>
  );
}

/** Tracks a scroll container to render only the rows in view (fixed row height). */
export function useVirtual(count: number, rowHeight: number, extra: { after: number; height: number } | null = null) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ top: 0, height: 600 });
  const update = useCallback(() => {
    const el = ref.current;
    if (el) setView({ top: el.scrollTop, height: el.clientHeight || 600 });
  }, []);
  useLayoutEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [update]);
  const overscan = 10;
  const bloque = extra && extra.after >= 0 && extra.after < count ? extra : null;
  // Primitives, so `reveal` keeps its identity while the block doesn't change.
  const bloqueAfter = bloque?.after ?? -1;
  const bloqueAlto = bloque?.height ?? 0;
  /** The row at a scroll position, with the block (if any) taking its height after row `after`. */
  const rowAt = (y: number) => {
    if (!bloque) return y / rowHeight;
    const corte = (bloque.after + 1) * rowHeight;
    if (y <= corte) return y / rowHeight;
    if (y <= corte + bloque.height) return bloque.after + 1;
    return (y - bloque.height) / rowHeight;
  };
  const start = Math.max(0, Math.floor(rowAt(view.top)) - overscan);
  const end = Math.min(count, Math.ceil(rowAt(view.top + view.height)) + overscan);
  /** Scrolls so that row `index` is visible. */
  const reveal = useCallback(
    (index: number, headerHeight = 0) => {
      const el = ref.current;
      if (!el || index < 0) return;
      const top = index * rowHeight + (bloqueAfter >= 0 && index > bloqueAfter ? bloqueAlto : 0);
      const visibleTop = el.scrollTop;
      const visibleBottom = el.scrollTop + el.clientHeight - headerHeight - rowHeight;
      if (top < visibleTop) el.scrollTop = top;
      else if (top > visibleBottom) el.scrollTop = top - el.clientHeight + headerHeight + rowHeight * 2;
    },
    [rowHeight, bloqueAfter, bloqueAlto]
  );
  return {
    ref,
    start,
    end,
    padTop: start * rowHeight + (bloque && bloque.after < start ? bloque.height : 0),
    padBottom: Math.max(0, (count - end) * rowHeight) + (bloque && bloque.after >= end ? bloque.height : 0),
    reveal,
    /** The block goes between rows when it falls in the rendered window. */
    bloqueVisible: !!bloque && bloque.after >= start && bloque.after < end,
  };
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
