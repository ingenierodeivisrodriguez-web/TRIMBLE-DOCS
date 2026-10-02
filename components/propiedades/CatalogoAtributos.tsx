"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, PropiedadesApi } from "../../lib/propiedades/client";
import { existingGroups, groupDefinitions } from "../../lib/propiedades/form";
import {
  applyGroupResponsables,
  commonResponsables,
  responsableKey,
  withCurrentNames,
} from "../../lib/propiedades/responsables";
import {
  AttributeDefinition,
  CatalogResponse,
  DATA_TYPE_LABELS,
  DATA_TYPES,
  DataType,
  DEFAULT_GROUP,
  ProjectContacts,
  Responsable,
} from "../../lib/propiedades/types";
import { isoToDisplay } from "../../lib/propiedades/values";
import { noticeBase, noticeStyles, primaryButtonStyle, secondaryButtonStyle } from "../validacion/ui";
import ResponsablesPicker, { ResponsableChip } from "./ResponsablesPicker";

interface Draft {
  title: string;
  dataType: DataType;
  group: string;
  sortOrder: string;
  responsables: Responsable[];
}

const EMPTY_DRAFT: Draft = { title: "", dataType: "text", group: "", sortOrder: "", responsables: [] };

function draftOf(def: AttributeDefinition): Draft {
  return { title: def.title, dataType: def.dataType, group: def.group, sortOrder: String(def.sortOrder), responsables: def.responsables };
}

const RESPONSABLES_HINT =
  "Además de los administradores, solo ellos podrán asignar los valores en el visor 3D. Sin responsables, solo los administradores.";

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
  const [contacts, setContacts] = useState<ProjectContacts | null>(null);
  const [contactsError, setContactsError] = useState("");
  /** Whether the new attribute's responsables were picked by hand (else they follow its group). */
  const [newTouched, setNewTouched] = useState(false);
  const [groupEdit, setGroupEdit] = useState<{ name: string; before: Responsable[]; value: Responsable[] } | null>(null);

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

  const loadContacts = useCallback(async () => {
    setContactsError("");
    try {
      setContacts(await api.getContacts());
    } catch (err) {
      setContactsError(message(err));
    }
  }, [api]);

  // Only administrators pick responsables, so only they need the project's team.
  useEffect(() => {
    if (canEdit && !contacts && !contactsError) loadContacts();
  }, [canEdit, contacts, contactsError, loadContacts]);

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

  /** What every active attribute of a group shares, suggested for a new attribute in that group. */
  function groupCommon(name: string): Responsable[] {
    return commonResponsables(definitions.filter((d) => d.active && d.group === name.trim()));
  }

  async function saveGroupResponsables(attributes: AttributeDefinition[]) {
    if (!groupEdit) return;
    const changes = applyGroupResponsables(attributes, groupEdit.before, groupEdit.value);
    if (changes.length === 0) return setGroupEdit(null);
    const ok = await run(async () => {
      for (const change of changes) await api.updateDefinition(change.id, { responsables: change.responsables });
    }, `Responsables de "${groupEdit.name}" actualizados en ${changes.length === 1 ? "1 atributo" : `${changes.length} atributos`}.`);
    if (ok) setGroupEdit(null);
  }

  function picker(id: string, value: Responsable[], onChange: (value: Responsable[]) => void) {
    return (
      <ResponsablesPicker
        id={id}
        value={withCurrentNames(value, contacts)}
        onChange={onChange}
        contacts={contacts}
        contactsError={contactsError}
        onRetry={loadContacts}
      />
    );
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
      () =>
        api.createDefinition({
          title: draft.title,
          dataType: draft.dataType,
          group: draft.group || DEFAULT_GROUP,
          sortOrder: order,
          responsables: draft.responsables,
        }),
      `Atributo "${draft.title.trim()}" creado.`
    );
    if (ok) setDraft({ ...EMPTY_DRAFT, group: draft.group, dataType: draft.dataType, responsables: draft.responsables });
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
          responsables: editDraft.responsables,
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
          Solo los administradores del proyecto pueden modificar el catálogo y sus responsables. Aquí ves los atributos disponibles y quién puede asignar cada uno.
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
              <GroupInput
                id="new-group"
                value={draft.group}
                groups={groups}
                onChange={(group) => setDraft({ ...draft, group, responsables: newTouched ? draft.responsables : groupCommon(group) })}
              />
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
            <div style={{ gridColumn: "1 / -1" }}>
              <Field label="Responsables (opcional)" htmlFor="new-responsables">
                {picker("new-responsables", draft.responsables, (responsables) => {
                  setNewTouched(true);
                  setDraft({ ...draft, responsables });
                })}
                <span style={hintStyle}>{RESPONSABLES_HINT}</span>
              </Field>
            </div>
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <h3 style={cardTitleStyle}>
                {group.name} <span style={countStyle}>{group.attributes.length}</span>
              </h3>
              {canEdit && groupEdit?.name !== group.name && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const common = commonResponsables(group.attributes);
                    setGroupEdit({ name: group.name, before: common, value: common });
                  }}
                  style={smallButtonStyle}
                >
                  Responsables del grupo
                </button>
              )}
            </div>
            {groupEdit?.name === group.name && (
              <div style={groupPanelStyle}>
                <Field label={`Responsables de todo el grupo "${group.name}"`} htmlFor={`group-resp-${group.name}`}>
                  {picker(`group-resp-${group.name}`, groupEdit.value, (value) => setGroupEdit({ ...groupEdit, value }))}
                </Field>
                <span style={hintStyle}>
                  Lo que agregues o quites aquí se aplica a {group.attributes.length === 1 ? "su atributo" : `sus ${group.attributes.length} atributos`}.
                  Los responsables asignados a un solo atributo no cambian.
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => saveGroupResponsables(group.attributes)} disabled={busy} style={primaryButtonStyle}>
                    Guardar
                  </button>
                  <button type="button" onClick={() => setGroupEdit(null)} style={secondaryButtonStyle}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
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
                      <div style={{ gridColumn: "1 / -1" }}>
                        <Field label="Responsables" htmlFor={`edit-resp-${def.id}`}>
                          {picker(`edit-resp-${def.id}`, editDraft.responsables, (responsables) => setEditDraft({ ...editDraft, responsables }))}
                          <span style={hintStyle}>{RESPONSABLES_HINT}</span>
                        </Field>
                      </div>
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
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
                        <span style={assignLabelStyle}>Asignan:</span>
                        {def.responsables.length ? (
                          withCurrentNames(def.responsables, contacts).map((r) => <ResponsableChip key={responsableKey(r)} r={r} />)
                        ) : (
                          <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>solo administradores</span>
                        )}
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
const hintStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--tc-gray-500)", lineHeight: 1.4 };
const assignLabelStyle: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--tc-gray-500)" };
const groupPanelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 10,
  borderRadius: 8,
  background: "var(--tc-blue-50)",
  border: "1px solid var(--tc-blue-100)",
};
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
