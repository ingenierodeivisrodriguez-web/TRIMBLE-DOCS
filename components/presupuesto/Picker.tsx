"use client";

import { CSSProperties, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { plegar } from "../../lib/presupuesto/format";
import { baseInput } from "./ui";

const MAX_SHOWN = 80;

/**
 * A search box with a list of matches below (every typed word must appear):
 * arrows move, Enter picks, Escape cancels.
 */
export default function Picker<T>({
  options,
  textOf,
  render,
  onPick,
  onCancel,
  placeholder,
  autoFocus = true,
  style,
  initial = "",
  keepOpen,
}: {
  options: T[];
  /** What the search looks in. */
  textOf: (option: T) => string;
  render: (option: T) => ReactNode;
  onPick: (option: T) => void;
  onCancel?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  style?: CSSProperties;
  initial?: string;
  /** Show the list even before typing. */
  keepOpen?: boolean;
}) {
  const [query, setQuery] = useState(initial);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);
  const folded = useMemo(() => options.map((o) => plegar(textOf(o))), [options, textOf]);

  const matches = useMemo(() => {
    const words = plegar(query).split(/\s+/).filter(Boolean);
    if (words.length === 0) return keepOpen ? options.slice(0, MAX_SHOWN) : [];
    const out: T[] = [];
    for (let i = 0; i < options.length && out.length < MAX_SHOWN; i++) {
      if (words.every((w) => folded[i].includes(w))) out.push(options[i]);
    }
    return out;
  }, [query, options, folded, keepOpen]);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div style={{ position: "relative", ...style }}>
      <input
        type="search"
        value={query}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (matches[active]) onPick(matches[active]);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            onCancel?.();
          }
        }}
        style={{ ...baseInput, width: "100%", background: "#fffbd6" }}
        aria-autocomplete="list"
      />
      {open && matches.length > 0 && (
        <div
          ref={listRef}
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 20,
            minWidth: "100%",
            maxWidth: 640,
            maxHeight: 320,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid #888",
            boxShadow: "0 6px 18px rgba(0,0,0,0.18)",
          }}
        >
          {matches.map((option, i) => (
            <div
              key={i}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(option);
              }}
              onMouseEnter={() => setActive(i)}
              style={{
                padding: "6px 10px",
                fontSize: 14,
                cursor: "pointer",
                whiteSpace: "nowrap",
                background: i === active ? "#e3edfb" : "transparent",
              }}
            >
              {render(option)}
            </div>
          ))}
          {matches.length === MAX_SHOWN && (
            <div style={{ padding: "6px 10px", fontSize: 12, color: "var(--tc-gray-500)" }}>Escribe más para acotar la búsqueda.</div>
          )}
        </div>
      )}
    </div>
  );
}
