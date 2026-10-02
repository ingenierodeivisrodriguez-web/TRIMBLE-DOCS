"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { responsableKey } from "../../lib/propiedades/responsables";
import type { ProjectContacts, Responsable } from "../../lib/propiedades/types";

const MAX_SHOWN = 60;

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function ResponsableIcon({ type }: { type: Responsable["type"] }) {
  return type === "group" ? (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="5.5" cy="5" r="2.3" fill="currentColor" />
      <circle cx="11" cy="5.5" r="2" fill="currentColor" opacity="0.7" />
      <path d="M1 13c0-2.5 2-4 4.5-4S10 10.5 10 13z" fill="currentColor" />
      <path d="M10.5 9.2c2.3 0 4.5 1.3 4.5 3.8h-4c0-1.5-.2-2.7-.5-3.8z" fill="currentColor" opacity="0.7" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="5" r="2.8" fill="currentColor" />
      <path d="M2.5 14c0-3 2.5-5 5.5-5s5.5 2 5.5 5z" fill="currentColor" />
    </svg>
  );
}

/** A responsable as a chip; with `onRemove`, it has a button to take it out. */
export function ResponsableChip({ r, onRemove }: { r: Responsable; onRemove?: () => void }) {
  return (
    <span style={chipStyle} title={r.type === "group" ? `Grupo ${r.name}` : r.name}>
      <ResponsableIcon type={r.type} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} style={chipRemoveStyle} aria-label={`Quitar a ${r.name}`}>
          ×
        </button>
      )}
    </span>
  );
}

/**
 * Picks people and groups of the project (Trimble Connect's team) as an
 * attribute's responsables: chips for the chosen ones and a search box that
 * lists the rest, groups first.
 */
export default function ResponsablesPicker({
  id,
  value,
  onChange,
  contacts,
  contactsError,
  onRetry,
}: {
  id: string;
  value: Responsable[];
  onChange: (value: Responsable[]) => void;
  contacts: ProjectContacts | null;
  contactsError: string;
  onRetry?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const chosen = useMemo(() => new Set(value.map(responsableKey)), [value]);
  const options = useMemo(() => {
    if (!contacts) return { groups: [], users: [], more: 0 };
    const q = fold(query.trim());
    const groups = contacts.groups.filter(
      (g) => !chosen.has(responsableKey({ type: "group", id: g.id })) && (!q || fold(g.name).includes(q))
    );
    const users = contacts.users.filter(
      (u) => !chosen.has(responsableKey({ type: "user", id: u.id })) && (!q || fold(`${u.name} ${u.email}`).includes(q))
    );
    const shownGroups = groups.slice(0, MAX_SHOWN);
    const shownUsers = users.slice(0, Math.max(0, MAX_SHOWN - shownGroups.length));
    return { groups: shownGroups, users: shownUsers, more: groups.length + users.length - shownGroups.length - shownUsers.length };
  }, [contacts, query, chosen]);

  function add(r: Responsable) {
    onChange([...value, r]);
    setQuery("");
  }

  const first: Responsable | null = options.groups[0]
    ? { type: "group", id: options.groups[0].id, name: options.groups[0].name }
    : options.users[0]
      ? { type: "user", id: options.users[0].id, name: options.users[0].name }
      : null;

  return (
    <div ref={box} style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6 }}>
      {value.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {value.map((r) => (
            <ResponsableChip key={responsableKey(r)} r={r} onRemove={() => onChange(value.filter((x) => responsableKey(x) !== responsableKey(r)))} />
          ))}
        </div>
      )}
      <input
        id={id}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
          if (e.key === "Enter") {
            e.preventDefault();
            if (first) add(first);
          }
        }}
        placeholder={value.length ? "Agregar otra persona o grupo..." : "Buscar persona o grupo del proyecto..."}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        style={inputStyle}
      />
      {open && (
        <div id={`${id}-list`} role="listbox" style={popoverStyle}>
          {contactsError ? (
            <div style={{ padding: 10, fontSize: 12.5, color: "#8a1c14" }}>
              No se pudo cargar el equipo del proyecto: {contactsError}{" "}
              {onRetry && (
                <button type="button" onClick={onRetry} style={linkStyle}>
                  Reintentar
                </button>
              )}
            </div>
          ) : !contacts ? (
            <div style={emptyStyle}>Cargando el equipo del proyecto...</div>
          ) : options.groups.length + options.users.length === 0 ? (
            <div style={emptyStyle}>{query ? "Nadie coincide con la búsqueda." : "Ya están todos agregados."}</div>
          ) : (
            <>
              {options.groups.length > 0 && <div style={sectionStyle}>Grupos</div>}
              {options.groups.map((g) => (
                <button
                  key={`g-${g.id}`}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => add({ type: "group", id: g.id, name: g.name })}
                  style={optionStyle}
                >
                  <ResponsableIcon type="group" />
                  <span style={{ flex: 1, minWidth: 0 }}>{g.name}</span>
                  {g.usersCount !== null && <span style={metaStyle}>{g.usersCount === 1 ? "1 persona" : `${g.usersCount} personas`}</span>}
                </button>
              ))}
              {options.users.length > 0 && <div style={sectionStyle}>Personas</div>}
              {options.users.map((u) => (
                <button
                  key={`u-${u.id}`}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => add({ type: "user", id: u.id, name: u.name })}
                  style={optionStyle}
                >
                  <ResponsableIcon type="user" />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {u.name}
                    {u.pending && <span style={metaStyle}> · invitación pendiente</span>}
                    {u.email && <span style={{ ...metaStyle, display: "block" }}>{u.email}</span>}
                  </span>
                </button>
              ))}
              {options.more > 0 && <div style={emptyStyle}>Y {options.more} más: escribe para filtrar.</div>}
            </>
          )}
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
  minWidth: 0,
  width: "100%",
};
const chipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  maxWidth: "100%",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--tc-blue-800)",
  background: "var(--tc-blue-100)",
  border: "1px solid #cfe3f5",
  borderRadius: 999,
  padding: "2px 8px",
};
const chipRemoveStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--tc-blue-700)",
  cursor: "pointer",
  fontSize: 15,
  lineHeight: 1,
  padding: "0 0 0 2px",
};
const popoverStyle: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  marginTop: 4,
  zIndex: 40,
  maxHeight: 280,
  overflowY: "auto",
  background: "var(--tc-white)",
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 8,
  boxShadow: "0 8px 24px rgba(10,61,98,0.18)",
  padding: 4,
};
const sectionStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "var(--tc-gray-500)",
  padding: "6px 8px 2px",
};
const optionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  textAlign: "left",
  border: "none",
  background: "transparent",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
  color: "var(--tc-gray-700)",
  cursor: "pointer",
  fontFamily: "inherit",
};
const metaStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--tc-gray-500)", fontWeight: 400 };
const emptyStyle: React.CSSProperties = { padding: 10, fontSize: 12.5, color: "var(--tc-gray-500)" };
const linkStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "inherit",
  textDecoration: "underline",
  cursor: "pointer",
  padding: 0,
  font: "inherit",
};
