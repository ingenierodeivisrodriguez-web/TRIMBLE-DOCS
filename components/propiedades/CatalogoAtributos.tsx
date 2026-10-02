"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, PropiedadesApi } from "../../lib/propiedades/client";
import { existingGroups, groupDefinitions } from "../../lib/propiedades/form";
import {
  AttributeDefinition,
  CatalogResponse,
  DATA_TYPE_LABELS,
  DATA_TYPES,
  DataType,
  DEFAULT_GROUP,
} from "../../lib/propiedades/types";
import { isoToDisplay } from "../../lib/propiedades/values";
import { noticeBase, noticeStyles, primaryButtonStyle, secondaryButtonStyle } from "../validacion/ui";

interface Draft {
  title: string;
  dataType: DataType;
  group: string;
  sortOrder: string;
}

const EMPTY_DRAFT: Draft = { title: "", dataType: "text", group: "", sortOrder: "" };

function draftOf(def: AttributeDefinition): Draft {
  return { title: def.title, dataType: def.dataType, group: def.group, sortOrder: String(def.sortOrder) };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Ocurrió un error.";
}

/**
 * The attribute catalog: what can be assigned to elements in the 3D viewer.
 * Shown in the project's left menu and, through the gear button, inside the
 * viewer panel - the same component, so the rules live in one place.
 */
export default function CatalogoAtributos({
  api,
  compact = false,
  onChanged,
}: {
  api: PropiedadesApi;
  /** Narrow layout for the 3D viewer panel. */
  compact?: boolean;
  onChanged?: () => void;
}) {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setCatalog(await api.getCatalog());
      setLoadError("");
    } catch (err) {
      setLoadError(message(err));
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const definitions = useMemo(() => catalog?.definitions ?? [], [catalog]);
  const activeGroups = useMemo(() => groupDefinitions(definitions.filter((d) => d.active)), [definitions]);
  const inactive = definitions.filter((d) => !d.active);
  const groups = useMemo(() => existingGroups(definitions), [definitions]);
  const canEdit = catalog?.canEdit ?? false;

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await load();
      onChanged?.();
      setNotice({ tone: "info", text: success });
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.code === "has-values") await load();
      setNotice({ tone: "error", text: message(err) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function parseOrder(text: string): number | undefined | null {
    if (!text.trim()) return undefined;
    const n = Number(text);
    return Number.isInteger(n) ? n : null;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const order = parseOrder(draft.sortOrder);
    if (order === null) return setNotice({ tone: "error", text: "El orden debe ser un número entero." });
    const ok = await run(
      () => api.createDefinition({ title: draft.title, dataType: draft.dataType, group: draft.group || DEFAULT_GROUP, sortOrder: order }),
      `Atributo "${draft.title.trim()}" creado.`
    );
    if (ok) setDraft({ ...EMPTY_DRAFT, group: draft.group, dataType: draft.dataType });
  }

  async function saveEdit(def: AttributeDefinition) {
    const order = parseOrder(editDraft.sortOrder);
    if (order === null) return setNotice({ tone: "error", text: "El orden debe ser un número entero." });
    const ok = await run(
      () =>
        api.updateDefinition(def.id, {
          title: editDraft.title,
          dataType: editDraft.dataType,
          group: editDraft.group || DEFAULT_GROUP,
          sortOrder: order ?? def.sortOrder,
        }),
      `Atributo "${editDraft.title.trim()}" actualizado.`
    );
    if (ok) setEditingId(null);
  }

  if (loadError && !catalog) {
    return (
      <div style={{ ...noticeBase, ...noticeStyles.error }}>
        No se pudo cargar el catálogo: {loadError}{" "}
        <button type="button" onClick={load} style={linkButtonStyle}>
          Reintentar
        </button>
      </div>
    );
  }
  if (!catalog) return <p style={mutedStyle}>Cargando el catálogo de atributos...</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {!canEdit && (
        <div style={{ ...noticeBase, ...noticeStyles.info }}>
          Solo los administradores del proyecto pueden modificar el catálogo. Aquí ves los atributos disponibles.
        </div>
      )}
      {notice && (
        <div style={{ ...noticeBase, ...(notice.tone === "error" ? noticeStyles.error : noticeStyles.info) }} role="status">
          {notice.text}
        </div>
      )}

      {canEdit && (
        <form onSubmit={create} style={cardStyle}>
          <h3 style={cardTitleStyle}>Nuevo atributo</h3>
          <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
            <Field label="Título" htmlFor="new-title">
              <input
                id="new-title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="Ej. Fecha de instalación"
                maxLength={120}
                required
                style={inputStyle}
              />
            </Field>
            <Field label="Tipo de dato" htmlFor="new-type">
              <TypeSelect id="new-type" value={draft.dataType} onChange={(dataType) => setDraft({ ...draft, dataType })} />
            </Field>
            <Field label="Grupo" htmlFor="new-group">
              <GroupInput id="new-group" value={draft.group} groups={groups} onChange={(group) => setDraft({ ...draft, group })} />
            </Field>
            <Field label="Orden (opcional)" htmlFor="new-order">
              <input
                id="new-order"
                inputMode="numeric"
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })}
                placeholder="Al final"
                style={inputStyle}
              />
            </Field>
          </div>
          <div>
            <button type="submit" disabled={busy || !draft.title.trim()} style={{ ...primaryButtonStyle, opacity: busy || !draft.title.trim() ? 0.55 : 1 }}>
              Agregar atributo
            </button>
          </div>
        </form>
      )}

      {activeGroups.length === 0 ? (
        <div style={cardStyle}>
          <p style={{ ...mutedStyle, margin: 0 }}>
            {canEdit
              ? "Aún no hay atributos. Crea el primero arriba: aparecerá en el panel Propiedades del visor 3D."
              : "Aún no hay atributos en el catálogo. Pídele a un administrador del proyecto que los cree."}
          </p>
        </div>
      ) : (
        activeGroups.map((group) => (
          <section key={group.name} style={cardStyle} aria-label={`Grupo ${group.name}`}>
            <h3 style={cardTitleStyle}>
              {group.name} <span style={countStyle}>{group.attributes.length}</span>
            </h3>
            <ul style={listStyle}>
              {group.attributes.map((def) =>
                editingId === def.id ? (
                  <li key={def.id} style={{ ...rowStyle, flexDirection: "column", alignItems: "stretch" }}>
                    <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                      <Field label="Título" htmlFor={`edit-title-${def.id}`}>
                        <input
                          id={`edit-title-${def.id}`}
                          value={editDraft.title}
                          onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
                          maxLength={120}
                          style={inputStyle}
                        />
                      </Field>
                      <Field label="Tipo de dato" htmlFor={`edit-type-${def.id}`}>
                        <TypeSelect
                          id={`edit-type-${def.id}`}
                          value={editDraft.dataType}
                          disabled={def.valueCount > 0}
                          onChange={(dataType) => setEditDraft({ ...editDraft, dataType })}
                        />
                      </Field>
                      <Field label="Grupo" htmlFor={`edit-group-${def.id}`}>
                        <GroupInput
                          id={`edit-group-${def.id}`}
                          value={editDraft.group}
                          groups={groups}
                          onChange={(group) => setEditDraft({ ...editDraft, group })}
                        />
                      </Field>
                      <Field label="Orden" htmlFor={`edit-order-${def.id}`}>
                        <input
                          id={`edit-order-${def.id}`}
                          inputMode="numeric"
                          value={editDraft.sortOrder}
                          onChange={(e) => setEditDraft({ ...editDraft, sortOrder: e.target.value })}
                          style={inputStyle}
                        />
                      </Field>
                    </div>
                    {def.valueCount > 0 && (
                      <span style={{ fontSize: 11.5, color: "var(--tc-gray-500)" }}>
                        El tipo no se puede cambiar: ya hay {def.valueCount} valores guardados con este tipo.
                      </span>
                    )}
                    <div style={{ display: "flex", gap: 6 }}>
                      <button type="button" onClick={() => saveEdit(def)} disabled={busy} style={primaryButtonStyle}>
                        Guardar
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} style={secondaryButtonStyle}>
                        Cancelar
                      </button>
                    </div>
                  </li>
                ) : (
                  <li key={def.id} style={rowStyle}>
                    <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--tc-gray-700)", wordBreak: "break-word" }}>{def.title}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
                        <Badge>{DATA_TYPE_LABELS[def.dataType]}</Badge>
                        <Badge muted>orden {def.sortOrder}</Badge>
                        <Badge muted>{def.valueCount === 1 ? "1 valor" : `${def.valueCount} valores`}</Badge>
                      </div>
                    </div>
                    {canEdit && (
                      <RowActions
                        def={def}
                        busy={busy}
                        confirming={confirmDeleteId === def.id}
                        onEdit={() => {
                          setEditingId(def.id);
                          setEditDraft(draftOf(def));
                          setConfirmDeleteId(null);
                        }}
                        onToggle={() =>
                          run(() => api.updateDefinition(def.id, { active: false }), `"${def.title}" quedó inactivo; sus valores se conservan.`)
                        }
                        onAskDelete={() => setConfirmDeleteId(def.id)}
                        onCancelDelete={() => setConfirmDeleteId(null)}
                        onDelete={() => run(() => api.deleteDefinition(def.id), `"${def.title}" eliminado.`).then(() => setConfirmDeleteId(null))}
                      />
                    )}
                  </li>
                )
              )}
            </ul>
          </section>
        ))
      )}

      {inactive.length > 0 && (
        <details style={cardStyle}>
          <summary style={{ cursor: "pointer", fontSize: 13.5, fontWeight: 700, color: "var(--tc-gray-500)" }}>
            Inactivos ({inactive.length}): no se asignan valores nuevos, pero los guardados se conservan
          </summary>
          <ul style={{ ...listStyle, marginTop: 10 }}>
            {inactive.map((def) => (
              <li key={def.id} style={rowStyle}>
                <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                  <div style={{ fontSize: 13.5, color: "var(--tc-gray-500)", wordBreak: "break-word" }}>{def.title}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
                    <Badge muted>{DATA_TYPE_LABELS[def.dataType]}</Badge>
                    <Badge muted>{def.group}</Badge>
                    <Badge muted>{def.valueCount === 1 ? "1 valor" : `${def.valueCount} valores`}</Badge>
                    <Badge muted>desde {isoToDisplay(def.updatedAt.slice(0, 10))}</Badge>
                  </div>
                </div>
                {canEdit && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => api.updateDefinition(def.id, { active: true }), `"${def.title}" está activo de nuevo.`)}
                      style={smallButtonStyle}
                    >
                      Reactivar
                    </button>
                    {def.valueCount === 0 &&
                      (confirmDeleteId === def.id ? (
                        <ConfirmDelete
                          onConfirm={() => run(() => api.deleteDefinition(def.id), `"${def.title}" eliminado.`).then(() => setConfirmDeleteId(null))}
                          onCancel={() => setConfirmDeleteId(null)}
                        />
                      ) : (
                        <button type="button" onClick={() => setConfirmDeleteId(def.id)} style={dangerButtonStyle}>
                          Eliminar
                        </button>
                      ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function RowActions({
  def,
  busy,
  confirming,
  onEdit,
  onToggle,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  def: AttributeDefinition;
  busy: boolean;
  confirming: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  if (confirming) return <ConfirmDelete onConfirm={onDelete} onCancel={onCancelDelete} />;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
      <button type="button" onClick={onEdit} disabled={busy} style={smallButtonStyle}>
        Editar
      </button>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        style={smallButtonStyle}
        title="Deja de aparecer para asignar valores nuevos; los valores guardados se conservan"
      >
        Desactivar
      </button>
      {def.valueCount === 0 ? (
        <button type="button" onClick={onAskDelete} disabled={busy} style={dangerButtonStyle}>
          Eliminar
        </button>
      ) : (
        <span style={{ fontSize: 11, color: "var(--tc-gray-500)", alignSelf: "center" }} title="Tiene valores: solo se puede desactivar">
          con valores
        </span>
      )}
    </div>
  );
}

function ConfirmDelete({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
      <span style={{ fontSize: 12, color: "#8a1c14" }}>¿Eliminar definitivamente?</span>
      <button type="button" onClick={onConfirm} style={dangerButtonStyle}>
        Sí, eliminar
      </button>
      <button type="button" onClick={onCancel} style={smallButtonStyle}>
        No
      </button>
    </div>
  );
}

function TypeSelect({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: DataType;
  disabled?: boolean;
  onChange: (value: DataType) => void;
}) {
  return (
    <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as DataType)} style={inputStyle}>
      {DATA_TYPES.map((t) => (
        <option key={t} value={t}>
          {DATA_TYPE_LABELS[t]}
        </option>
      ))}
    </select>
  );
}

/** Free text with the existing groups as suggestions: type a new one or pick one. */
function GroupInput({ id, value, groups, onChange }: { id: string; value: string; groups: string[]; onChange: (v: string) => void }) {
  return (
    <>
      <input
        id={id}
        list={`${id}-list`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={groups.length ? "Elige o escribe un grupo" : DEFAULT_GROUP}
        maxLength={80}
        style={inputStyle}
      />
      <datalist id={`${id}-list`}>
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
    </>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <label htmlFor={htmlFor} style={{ fontSize: 11.5, fontWeight: 600, color: "var(--tc-gray-500)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Badge({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 999,
        padding: "1px 8px",
        background: muted ? "var(--tc-gray-100)" : "var(--tc-blue-100)",
        color: muted ? "var(--tc-gray-500)" : "var(--tc-blue-800)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--tc-white)",
  borderRadius: "var(--tc-radius)",
  boxShadow: "var(--tc-shadow)",
  padding: 14,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const cardTitleStyle: React.CSSProperties = { margin: 0, fontSize: 14, color: "var(--tc-blue-800)" };
const countStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--tc-gray-500)", fontWeight: 600, marginLeft: 4 };
const listStyle: React.CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 };
const rowStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  padding: "8px 10px",
  border: "1px solid var(--tc-gray-100)",
  borderRadius: 8,
  flexWrap: "wrap",
};
const mutedStyle: React.CSSProperties = { fontSize: 13, color: "var(--tc-gray-500)" };
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
const smallButtonStyle: React.CSSProperties = { ...secondaryButtonStyle, padding: "4px 10px", fontSize: 12 };
const dangerButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  border: "1px solid #e5a29c",
  color: "#8a1c14",
  background: "var(--tc-white)",
};
const linkButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "inherit",
  textDecoration: "underline",
  cursor: "pointer",
  padding: 0,
  font: "inherit",
};
