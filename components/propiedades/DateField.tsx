"use client";

import { useEffect, useRef, useState } from "react";
import { isoToDisplay, parseDisplayDate, todayIso } from "../../lib/propiedades/values";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];

/** Keeps only digits and inserts the dashes of DD-MM-AAAA while typing. */
function mask(text: string): string {
  const d = text.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}-${d.slice(2)}`;
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`;
}

/**
 * Date input that always reads and writes DD-MM-AAAA (the native date input
 * follows the browser's locale instead, and its picker can't be opened from
 * inside Trimble Connect's iframe), with a small calendar.
 */
export default function DateField({
  id,
  text,
  placeholder,
  invalid,
  onText,
}: {
  id: string;
  /** What the field shows, in DD-MM-AAAA. */
  text: string;
  placeholder: string;
  invalid: boolean;
  onText: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const iso = parseDisplayDate(text);
  const start = iso ?? todayIso();
  const [view, setView] = useState({ year: +start.slice(0, 4), month: +start.slice(5, 7) - 1 });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function openCalendar() {
    const base = parseDisplayDate(text) ?? todayIso();
    setView({ year: +base.slice(0, 4), month: +base.slice(5, 7) - 1 });
    setOpen((v) => !v);
  }

  function shift(months: number) {
    setView(({ year, month }) => {
      const m = month + months;
      return { year: year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  }

  const first = new Date(view.year, view.month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(view.year, view.month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(offset).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const today = todayIso();
  const isoOf = (day: number) => `${view.year}-${String(view.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return (
    <div ref={box} style={{ position: "relative", display: "flex", gap: 6 }}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={text}
        placeholder={placeholder}
        onChange={(e) => onText(mask(e.target.value))}
        aria-invalid={invalid}
        style={{ ...inputStyle, borderColor: invalid ? "#d03b3b" : "var(--tc-gray-300)", flex: 1, minWidth: 0 }}
      />
      <button type="button" onClick={openCalendar} style={calendarButtonStyle} aria-label="Abrir calendario" aria-expanded={open}>
        📅
      </button>
      {open && (
        <div role="dialog" aria-label="Calendario" style={popoverStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <button type="button" onClick={() => shift(-1)} style={navButtonStyle} aria-label="Mes anterior">
              ‹
            </button>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--tc-blue-800)" }}>
              {MONTHS[view.month]} {view.year}
            </span>
            <button type="button" onClick={() => shift(1)} style={navButtonStyle} aria-label="Mes siguiente">
              ›
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 32px)", gap: 2 }}>
            {WEEKDAYS.map((w) => (
              <span key={w} style={{ fontSize: 11, color: "var(--tc-gray-500)", textAlign: "center", fontWeight: 600 }}>
                {w}
              </span>
            ))}
            {cells.map((day, i) =>
              day === null ? (
                <span key={`e${i}`} />
              ) : (
                <button
                  key={day}
                  type="button"
                  onClick={() => {
                    onText(isoToDisplay(isoOf(day)));
                    setOpen(false);
                  }}
                  style={{
                    ...dayStyle,
                    background: isoOf(day) === iso ? "var(--tc-blue-600)" : "transparent",
                    color: isoOf(day) === iso ? "var(--tc-white)" : "var(--tc-gray-700)",
                    fontWeight: isoOf(day) === today ? 700 : 400,
                    outline: isoOf(day) === today ? "1px solid var(--tc-blue-500)" : "none",
                  }}
                  aria-label={isoToDisplay(isoOf(day))}
                >
                  {day}
                </button>
              )
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              onText(isoToDisplay(today));
              setOpen(false);
            }}
            style={{ ...navButtonStyle, width: "100%", marginTop: 6, fontSize: 12 }}
          >
            Hoy ({isoToDisplay(today)})
          </button>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
  color: "var(--tc-gray-700)",
  background: "var(--tc-white)",
  fontFamily: "inherit",
  fontVariantNumeric: "tabular-nums",
};

const calendarButtonStyle: React.CSSProperties = {
  border: "1px solid var(--tc-gray-300)",
  background: "var(--tc-white)",
  borderRadius: 6,
  width: 34,
  cursor: "pointer",
  fontSize: 14,
};

const popoverStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  right: 0,
  zIndex: 30,
  background: "var(--tc-white)",
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(10,61,98,0.18)",
  padding: 10,
};

const navButtonStyle: React.CSSProperties = {
  border: "1px solid var(--tc-gray-100)",
  background: "var(--tc-blue-50)",
  color: "var(--tc-blue-700)",
  borderRadius: 6,
  padding: "3px 10px",
  cursor: "pointer",
  fontFamily: "inherit",
};

const dayStyle: React.CSSProperties = {
  width: 32,
  height: 28,
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12.5,
  fontFamily: "inherit",
  fontVariantNumeric: "tabular-nums",
};
