"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PropiedadesApi } from "../../lib/propiedades/client";
import {
  consequences,
  FieldSummary,
  groupDefinitions,
  pendingChanges,
  summarizeValues,
  summaryOf,
} from "../../lib/propiedades/form";
import { readSelection, SelectedElement, SelectionRead, PropiedadesViewer } from "../../lib/propiedades/selection";
import {
  AttributeDefinition,
  AttributeValue,
  CatalogResponse,
  DATA_TYPE_LABELS,
  MAX_ELEMENTS_PER_REQUEST,
  MAX_TEXT_LENGTH,
  StoredValue,
  TargetElement,
} from "../../lib/propiedades/types";
import {
  formatNumberInput,
  formatValue,
  isoToDisplay,
  parseDisplayDate,
  parseNumberInput,
} from "../../lib/propiedades/values";
import { noticeBase, noticeStyles, primaryButtonStyle, secondaryButtonStyle } from "../validacion/ui";
import CatalogoAtributos from "./CatalogoAtributos";
import DateField from "./DateField";
import type { ViewerEventListener } from "./PropiedadesShell";

type ViewerSelection = { modelId: string; objectRuntimeIds?: number[] }[];

/** A field the user has touched: what they typed, and the value it means (null = clear). */
interface FieldEdit {
  raw: string;
  value: AttributeValue | null;
  error: string | null;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Ocurrió un error.";
}

function selectionFrom(data: unknown): ViewerSelection {
  if (Array.isArray(data)) return data as ViewerSelection;
  const inner = (data as { data?: unknown } | null)?.data;
  return Array.isArray(inner) ? (inner as ViewerSelection) : [];
}

function objectCount(selection: ViewerSelection): number {
  return selection.reduce((sum, g) => sum + (g.objectRuntimeIds?.length ?? 0), 0);
}

/** A stored timestamp as the user's local date, DD-MM-AAAA. */
function timestampToDisplay(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return isoToDisplay(timestamp.slice(0, 10));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** An edit that leaves the field as it is stored (it won't be saved). */
function isNoop(edit: FieldEdit, summary: FieldSummary): boolean {
  if (edit.error) return false;
  if (edit.value === null) return summary.kind === "empty";
  return summary.kind === "same" && summary.value === edit.value;
}

/** What an untouched field shows for the selection's stored value(s). */
function initialRaw(def: AttributeDefinition, summary: FieldSummary): string {
  if (summary.kind !== "same") return "";
  if (def.dataType === "date") return isoToDisplay(String(summary.value));
  if (def.dataType === "number" && typeof summary.value === "number") return formatNumberInput(summary.value);
  return String(summary.value);
}

/** Interprets what the user typed in a field of the given type. */
function interpret(def: AttributeDefinition, raw: string): FieldEdit {
  const text = raw.trim();
  if (!text) return { raw, value: null, error: null };
  if (def.dataType === "number") {
    const n = parseNumberInput(text);
    return n === null ? { raw, value: null, error: "Escribe un número, p. ej. 12,5" } : { raw, value: n, error: null };
  }
  if (def.dataType === "date") {
    if (text.length < 10) return { raw, value: null, error: "Fecha incompleta: DD-MM-AAAA" };
    const iso = parseDisplayDate(text);
    return iso ? { raw, value: iso, error: null } : { raw, value: null, error: "Esa fecha no existe" };
  }
  return { raw, value: text, error: null };
}

/**
 * The "Propiedades" panel of the 3D viewer: shows and edits this app's
 * attribute values for the elements selected in the model, keyed by IFCGUID.
 */
export default function PanelPropiedades({
  api,
  viewer,
  subscribe,
}: {
  api: PropiedadesApi;
  viewer: PropiedadesViewer;
  subscribe: (listener: ViewerEventListener) => () => void;
}) {
  const [view, setView] = useState<"form" | "catalog">("form");
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [catalogError, setCatalogError] = useState("");

  const [selection, setSelection] = useState<ViewerSelection | null>(null);
  const [queued, setQueued] = useState<ViewerSelection | null>(null);
  const [read, setRead] = useState<SelectionRead | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [values, setValues] = useState<StoredValue[]>([]);
  const [loadError, setLoadError] = useState("");

  const [edits, setEdits] = useState<Record<string, FieldEdit>>({});
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const loadSeq = useRef(0);
  /** Whether there are edits the user still has to save or discard. */
  const dirty = useRef(false);

  // ---------------------------------------------------------------- catalog

  const loadCatalog = useCallback(async () => {
    try {
      setCatalog(await api.getCatalog());
      setCatalogError("");
    } catch (err) {
      setCatalogError(message(err));
    }
  }, [api]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // ---------------------------------------------------------------- selection

  // A new selection waits while there are unsaved edits for the current one:
  // the user decides whether to save them or let them go.
  const onSelection = useCallback((next: ViewerSelection) => {
    if (dirty.current) setQueued(next);
    else setSelection(next);
  }, []);

  useEffect(() => {
    viewer.getSelection().then((s) => onSelection(selectionFrom(s)), () => onSelection([]));
    return subscribe((event, data) => {
      if (event === "viewer.onSelectionChanged") onSelection(selectionFrom(data));
    });
  }, [viewer, subscribe, onSelection]);

  const loadValues = useCallback(
    async (elements: SelectedElement[]) => {
      const guids = [...new Set(elements.map((e) => e.resolution.guid).filter((g): g is string => !!g))];
      return guids.length ? api.queryValues(guids) : [];
    },
    [api]
  );

  useEffect(() => {
    if (!selection) return;
    const seq = ++loadSeq.current;
    const current = () => seq === loadSeq.current;
    setEdits({});
    setConfirming(false);
    setResult(null);
    setLoadError("");
    const total = objectCount(selection);
    if (total === 0) {
      setRead({ elements: [], skipped: 0 });
      setValues([]);
      setProgress(null);
      return;
    }
    setProgress({ done: 0, total });
    (async () => {
      try {
        const r = await readSelection(viewer, selection, (done, all) => current() && setProgress({ done, total: all }));
        const stored = await loadValues(r.elements);
        if (!current()) return;
        setRead(r);
        setValues(stored);
      } catch (err) {
        if (current()) {
          setRead(null);
          setLoadError(message(err));
        }
      } finally {
        if (current()) setProgress(null);
      }
    })();
  }, [selection, viewer, loadValues]);

  // ---------------------------------------------------------------- derived

  const elements = read?.elements ?? [];
  const withGuid = elements.filter((e) => e.resolution.guid);
  const withoutGuid = elements.filter((e) => !e.resolution.guid);
  const targets: TargetElement[] = useMemo(() => {
    const byGuid = new Map<string, TargetElement>();
    for (const e of elements) if (e.resolution.guid) byGuid.set(e.resolution.guid, { ifcGuid: e.resolution.guid, modelId: e.fileId });
    return [...byGuid.values()];
  }, [elements]);
  const guids = useMemo(() => targets.map((t) => t.ifcGuid), [targets]);
  const summaries = useMemo(() => summarizeValues(guids, values), [guids, values]);

  const definitions = catalog?.definitions ?? [];
  const groups = useMemo(() => groupDefinitions(definitions.filter((d) => d.active)), [definitions]);
  const inactiveWithValues = definitions.filter((d) => !d.active && summaries.has(d.id));

  const editMap = useMemo(() => {
    const map = new Map<string, AttributeValue | null>();
    for (const [id, edit] of Object.entries(edits)) if (!edit.error) map.set(id, edit.value);
    return map;
  }, [edits]);
  const changes = useMemo(() => pendingChanges(editMap, summaries), [editMap, summaries]);
  const hasErrors = Object.values(edits).some((e) => e.error);
  dirty.current = changes.length > 0 || hasErrors;

  // Once nothing is left unsaved (saved, discarded or every change undone),
  // the panel catches up with the latest selection waiting in the viewer.
  useEffect(() => {
    if (queued && !saving && changes.length === 0 && !hasErrors) {
      setSelection(queued);
      setQueued(null);
    }
  }, [queued, saving, changes.length, hasErrors]);
  const toConfirm = useMemo(
    () => consequences(changes, summaries, definitions, targets.length),
    [changes, summaries, definitions, targets.length]
  );

  // ---------------------------------------------------------------- actions

  function setField(def: AttributeDefinition, edit: FieldEdit) {
    setResult(null);
    setConfirming(false);
    setEdits((prev) => ({ ...prev, [def.id]: edit }));
  }

  function revert(id: string) {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setConfirming(false);
  }

  function discard() {
    setEdits({});
    setConfirming(false);
    dirty.current = false;
  }

  async function save(confirmed: boolean) {
    if (hasErrors) return;
    if (changes.length === 0) {
      discard();
      return;
    }
    if (toConfirm.length > 0 && !confirmed) {
      setConfirming(true);
      return;
    }
    setSaving(true);
    setResult(null);
    try {
      await api.saveValues(targets, changes);
      const fresh = await loadValues(elements);
      setValues(fresh);
      setEdits({});
      dirty.current = false;
      setConfirming(false);
      setResult({
        tone: "info",
        text: `Guardado: ${changes.length === 1 ? "1 atributo" : `${changes.length} atributos`} en ${
          targets.length === 1 ? "1 elemento" : `${targets.length} elementos`
        }.`,
      });
    } catch (err) {
      if (targets.length > MAX_ELEMENTS_PER_REQUEST) {
        // Big selections are saved in several all-or-nothing batches, so the
        // first ones may already be stored: show what actually is.
        setValues(await loadValues(elements).catch(() => values));
        setResult({
          tone: "error",
          text: `El guardado se interrumpió: ${message(err).replace(/\.?$/, ".")} La selección se guarda en lotes de ${MAX_ELEMENTS_PER_REQUEST.toLocaleString("es")} elementos y los primeros pueden haber quedado guardados; tus cambios siguen en el formulario para volver a guardar.`,
        });
      } else {
        setResult({ tone: "error", text: `No se guardó nada: ${message(err)}` });
      }
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------- render

  if (view === "catalog") {
    return (
      <div style={pageStyle}>
        <header style={headerStyle}>
          <button type="button" onClick={() => setView("form")} style={secondaryButtonStyle}>
            ← Volver a Propiedades
          </button>
        </header>
        <h1 style={titleStyle}>Catálogo de atributos</h1>
        <CatalogoAtributos api={api} compact onChanged={loadCatalog} />
      </div>
    );
  }

  const total = objectCount(selection ?? []);
  const single = targets.length === 1;

  return (
    <div style={{ ...pageStyle, padding: `14px 14px ${changes.length > 0 || hasErrors ? 120 : 20}px` }}>
      <header style={headerStyle}>
        <div>
          <h1 style={titleStyle}>Propiedades</h1>
          <p style={subtitleStyle}>Atributos del proyecto asignados por IFCGUID a los elementos seleccionados.</p>
        </div>
        <button
          type="button"
          onClick={() => setView("catalog")}
          style={gearStyle}
          aria-label="Catálogo de atributos"
          title="Catálogo de atributos"
        >
          ⚙
        </button>
      </header>

      {catalogError && (
        <div style={{ ...noticeBase, ...noticeStyles.error }}>
          No se pudo cargar el catálogo: {catalogError}{" "}
          <button type="button" onClick={loadCatalog} style={inlineLinkStyle}>
            Reintentar
          </button>
        </div>
      )}

      {queued && (
        <div style={{ ...noticeBase, ...noticeStyles.warning }} role="alert">
          <strong>La selección cambió en el visor.</strong> Tienes cambios sin guardar para{" "}
          {targets.length === 1 ? "el elemento anterior" : `los ${targets.length} elementos anteriores`}.
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => save(false)} disabled={saving || hasErrors} style={primaryButtonStyle}>
              Guardar en la selección anterior
            </button>
            <button type="button" onClick={discard} style={secondaryButtonStyle}>
              Descartar cambios
            </button>
          </div>
        </div>
      )}

      <SelectionSummary
        total={total}
        loading={progress}
        loadError={loadError}
        withGuid={withGuid.length}
        unique={targets.length}
        withoutGuid={withoutGuid}
        skipped={read?.skipped ?? 0}
        elements={elements}
      />

      {result && (
        <div style={{ ...noticeBase, ...(result.tone === "error" ? noticeStyles.error : noticeStyles.info) }} role="status">
          {result.text}
        </div>
      )}

      {!progress && targets.length > 0 && !catalog && !catalogError && (
        <div style={cardStyle}>
          <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>Cargando el catálogo de atributos...</span>
        </div>
      )}

      {!progress && targets.length > 0 && catalog && (
        <>
          {groups.length === 0 ? (
            <div style={cardStyle}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--tc-gray-500)" }}>
                El catálogo aún no tiene atributos activos.{" "}
                {catalog.canEdit ? "Créalos con el botón ⚙." : "Pídele a un administrador del proyecto que los cree."}
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <details key={group.name} open style={cardStyle}>
                <summary style={groupSummaryStyle}>
                  {group.name} <span style={{ fontWeight: 600, color: "var(--tc-gray-500)", fontSize: 12 }}>{group.attributes.length}</span>
                </summary>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
                  {group.attributes.map((def) => (
                    <AttributeField
                      key={def.id}
                      def={def}
                      summary={summaryOf(summaries, def.id)}
                      edit={edits[def.id]}
                      elementCount={targets.length}
                      single={single}
                      onEdit={(edit) => setField(def, edit)}
                      onRevert={() => revert(def.id)}
                    />
                  ))}
                </div>
              </details>
            ))
          )}

          {inactiveWithValues.length > 0 && (
            <details style={cardStyle}>
              <summary style={groupSummaryStyle}>Atributos inactivos con valores ({inactiveWithValues.length})</summary>
              <p style={{ fontSize: 12, color: "var(--tc-gray-500)", margin: "8px 0" }}>
                Ya no se asignan, pero sus valores se conservan y se pueden consultar.
              </p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {inactiveWithValues.map((def) => (
                  <li key={def.id} style={{ fontSize: 13, color: "var(--tc-gray-700)" }}>
                    <strong>{def.title}:</strong> <ReadOnlyValue def={def} summary={summaryOf(summaries, def.id)} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {(changes.length > 0 || hasErrors) && (
        <footer style={footerStyle}>
          {confirming && (
            <div style={{ ...noticeBase, ...noticeStyles.warning, marginBottom: 8 }} role="alertdialog" aria-label="Confirmar cambios">
              <strong>Confirma antes de guardar:</strong>
              <ul style={{ margin: "6px 0", paddingLeft: 18 }}>
                {toConfirm.map((c) => (
                  <li key={c.title}>
                    <strong>{c.title}</strong>: {c.detail}.
                  </li>
                ))}
              </ul>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" onClick={() => save(true)} disabled={saving} style={primaryButtonStyle}>
                  Confirmar y guardar
                </button>
                <button type="button" onClick={() => setConfirming(false)} style={secondaryButtonStyle}>
                  Revisar
                </button>
              </div>
            </div>
          )}
          {!confirming && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, color: "var(--tc-gray-700)", flex: 1, minWidth: 140 }}>
                {hasErrors
                  ? "Corrige los campos marcados para guardar."
                  : `${changes.length === 1 ? "1 cambio" : `${changes.length} cambios`} para ${
                      targets.length === 1 ? "1 elemento" : `${targets.length} elementos`
                    }`}
              </span>
              <button type="button" onClick={discard} disabled={saving} style={secondaryButtonStyle}>
                Descartar
              </button>
              <button
                type="button"
                onClick={() => save(false)}
                disabled={saving || hasErrors || changes.length === 0}
                style={{ ...primaryButtonStyle, opacity: saving || hasErrors || changes.length === 0 ? 0.55 : 1 }}
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          )}
        </footer>
      )}
    </div>
  );
}

function SelectionSummary({
  total,
  loading,
  loadError,
  withGuid,
  unique,
  withoutGuid,
  skipped,
  elements,
}: {
  total: number;
  loading: { done: number; total: number } | null;
  loadError: string;
  withGuid: number;
  unique: number;
  withoutGuid: SelectedElement[];
  skipped: number;
  elements: SelectedElement[];
}) {
  if (total === 0 && !loading) {
    return (
      <div style={{ ...cardStyle, alignItems: "flex-start" }}>
        <strong style={{ fontSize: 13.5, color: "var(--tc-blue-800)" }}>Sin selección</strong>
        <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>
          Selecciona uno o varios elementos en el modelo 3D para ver y asignar sus propiedades.
        </span>
      </div>
    );
  }
  if (loading) {
    return (
      <div style={cardStyle}>
        <span style={{ fontSize: 13, color: "var(--tc-gray-700)" }}>
          Leyendo {loading.done.toLocaleString("es")} de {loading.total.toLocaleString("es")} elementos seleccionados...
        </span>
      </div>
    );
  }
  if (loadError) {
    return <div style={{ ...noticeBase, ...noticeStyles.error }}>No se pudo leer la selección: {loadError}</div>;
  }
  const conflicts = elements.filter((e) => e.resolution.conflict);
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "baseline" }}>
        <strong style={{ fontSize: 14, color: "var(--tc-blue-800)" }}>
          {elements.length === 1 ? "1 elemento seleccionado" : `${elements.length.toLocaleString("es")} elementos seleccionados`}
        </strong>
        <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>
          · {withGuid.toLocaleString("es")} con IFCGUID
          {unique < withGuid ? ` (${unique.toLocaleString("es")} distintos)` : ""}
        </span>
      </div>
      {skipped > 0 && (
        <div style={{ ...noticeBase, ...noticeStyles.warning }}>
          La selección es muy grande: se tomaron los primeros {(elements.length).toLocaleString("es")} objetos y se dejaron fuera{" "}
          {skipped.toLocaleString("es")}.
        </div>
      )}
      {withoutGuid.length > 0 && (
        <div style={{ ...noticeBase, ...noticeStyles.warning }} role="status">
          <strong>
            {withoutGuid.length === elements.length
              ? "Ningún elemento seleccionado tiene IFCGUID"
              : `${withoutGuid.length === 1 ? "1 elemento no tiene" : `${withoutGuid.length} elementos no tienen`} IFCGUID`}
          </strong>{" "}
          (geometría no IFC): no se {withoutGuid.length === 1 ? "le" : "les"} pueden asignar propiedades
          {withoutGuid.length < elements.length ? "; el resto de la selección sí." : "."}
          <div style={{ fontSize: 12, marginTop: 4 }}>
            {withoutGuid
              .slice(0, 5)
              .map((e) => e.name)
              .join(", ")}
            {withoutGuid.length > 5 ? ` y ${withoutGuid.length - 5} más` : ""}
          </div>
        </div>
      )}
      <details>
        <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--tc-gray-500)" }}>
          Origen del IFCGUID{conflicts.length ? ` · ${conflicts.length} con diferencias` : ""}
        </summary>
        <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0", display: "flex", flexDirection: "column" }}>
          {elements.slice(0, 50).map((e) => (
            <li key={e.key} style={diagnosticRowStyle}>
              <div style={{ fontWeight: 600, color: "var(--tc-gray-700)" }}>
                {e.name} <span style={{ fontWeight: 400, color: "var(--tc-gray-500)" }}>· {e.modelName}</span>
              </div>
              {e.resolution.guid && (
                <div style={{ fontFamily: "Consolas, monospace", color: "var(--tc-blue-900)" }}>{e.resolution.guid}</div>
              )}
              <div style={{ color: e.resolution.guid ? "var(--tc-gray-500)" : "#8a1c14" }}>
                {e.resolution.sourceLabel}
                {e.resolution.externalId && e.resolution.source !== "external" ? ` · id externo: ${e.resolution.externalId}` : ""}
              </div>
              {e.resolution.conflict && <div style={{ color: "#8a5300" }}>{e.resolution.conflict}</div>}
            </li>
          ))}
        </ul>
        {elements.length > 50 && <div style={{ fontSize: 11, color: "var(--tc-gray-500)" }}>Se muestran los primeros 50.</div>}
      </details>
    </div>
  );
}

function AttributeField({
  def,
  summary,
  edit,
  elementCount,
  single,
  onEdit,
  onRevert,
}: {
  def: AttributeDefinition;
  summary: FieldSummary;
  edit: FieldEdit | undefined;
  elementCount: number;
  single: boolean;
  onEdit: (edit: FieldEdit) => void;
  onRevert: () => void;
}) {
  const id = `attr-${def.id}`;
  const mixed = summary.kind === "mixed" && !edit;
  const placeholder = mixed ? "Valores mixtos" : def.dataType === "date" ? "DD-MM-AAAA" : def.dataType === "number" ? "Número" : "Sin valor";
  const raw = edit ? edit.raw : initialRaw(def, summary);

  let control: React.ReactNode;
  if (def.dataType === "boolean") {
    const current = edit ? edit.value : summary.kind === "same" ? summary.value : summary.kind === "empty" ? null : undefined;
    const option = (label: string, value: boolean | null) => {
      const active = current === value;
      return (
        <button
          type="button"
          onClick={() => onEdit({ raw: "", value, error: null })}
          aria-pressed={active}
          style={{
            ...segmentStyle,
            background: active ? "var(--tc-blue-600)" : "var(--tc-white)",
            color: active ? "var(--tc-white)" : "var(--tc-gray-700)",
          }}
        >
          {label}
        </button>
      );
    };
    control = (
      <div role="group" aria-labelledby={`${id}-label`} style={{ display: "flex", gap: 0 }}>
        {option("Sí", true)}
        {option("No", false)}
        {option("Sin valor", null)}
      </div>
    );
  } else if (def.dataType === "date") {
    control = (
      <DateField id={id} text={raw} placeholder={placeholder} invalid={!!edit?.error} onText={(text) => onEdit(interpret(def, text))} />
    );
  } else {
    control = (
      <input
        id={id}
        type="text"
        inputMode={def.dataType === "number" ? "decimal" : "text"}
        value={raw}
        placeholder={placeholder}
        onChange={(e) => onEdit(interpret(def, e.target.value))}
        aria-invalid={!!edit?.error}
        maxLength={MAX_TEXT_LENGTH}
        style={{ ...inputStyle, borderColor: edit?.error ? "#d03b3b" : "var(--tc-gray-300)" }}
      />
    );
  }

  let status: React.ReactNode = null;
  if (edit?.error) status = <span style={{ color: "#b3261e" }}>{edit.error}</span>;
  else if (edit && !isNoop(edit, summary))
    status = (
      <span style={{ color: "var(--tc-blue-700)" }}>
        {edit.value === null && summary.kind !== "empty" ? "Se borrará el valor" : "Cambio sin guardar"} ·{" "}
        <button type="button" onClick={onRevert} style={inlineLinkStyle}>
          Deshacer
        </button>
      </span>
    );
  else if (summary.kind === "mixed")
    status = (
      <span>
        Valores mixtos: {summary.withValue} de {elementCount} elementos tienen valor
        {summary.distinct > 1 ? ` (${summary.distinct} distintos)` : ""}. No se cambian si no editas el campo.
      </span>
    );
  else if (summary.kind === "same" && !edit)
    status = (
      <span>
        {single ? "Modificado" : "Última modificación"}
        {summary.updatedBy ? ` por ${summary.updatedBy}` : ""} el{" "}
        <span style={{ whiteSpace: "nowrap" }}>{timestampToDisplay(summary.updatedAt)}</span>
      </span>
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label id={`${id}-label`} htmlFor={def.dataType === "boolean" ? undefined : id} style={labelStyle}>
        {def.title}
        <span style={typeHintStyle}>{DATA_TYPE_LABELS[def.dataType]}</span>
        {mixed && <span style={mixedBadgeStyle}>Valores mixtos</span>}
      </label>
      {control}
      {status && <div style={{ fontSize: 11.5, color: "var(--tc-gray-500)" }}>{status}</div>}
    </div>
  );
}

function ReadOnlyValue({ def, summary }: { def: AttributeDefinition; summary: FieldSummary }) {
  if (summary.kind === "same") return <>{formatValue(def.dataType, summary.value)}</>;
  if (summary.kind === "mixed") return <em>valores mixtos</em>;
  return <em>sin valor</em>;
}

const pageStyle: React.CSSProperties = { padding: 14, display: "flex", flexDirection: "column", gap: 12, maxWidth: 720, margin: "0 auto" };
const headerStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 };
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 19, color: "var(--tc-blue-900)" };
const subtitleStyle: React.CSSProperties = { margin: "2px 0 0", fontSize: 12.5, color: "var(--tc-gray-500)" };
const gearStyle: React.CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  background: "var(--tc-white)",
  color: "var(--tc-blue-700)",
  borderRadius: 8,
  width: 36,
  height: 36,
  fontSize: 18,
  cursor: "pointer",
  flexShrink: 0,
};
const cardStyle: React.CSSProperties = {
  background: "var(--tc-white)",
  borderRadius: "var(--tc-radius)",
  boxShadow: "var(--tc-shadow)",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
const groupSummaryStyle: React.CSSProperties = { cursor: "pointer", fontSize: 14, fontWeight: 700, color: "var(--tc-blue-800)" };
const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--tc-gray-700)",
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
};
const typeHintStyle: React.CSSProperties = { fontSize: 11, fontWeight: 500, color: "var(--tc-gray-500)" };
const mixedBadgeStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  color: "#7a5300",
  background: "#fff6e0",
  border: "1px solid #f0c36d",
  borderRadius: 999,
  padding: "0 7px",
};
const inputStyle: React.CSSProperties = {
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
  color: "var(--tc-gray-700)",
  background: "var(--tc-white)",
  fontFamily: "inherit",
  width: "100%",
};
const segmentStyle: React.CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  padding: "5px 12px",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  marginRight: -1,
};
const inlineLinkStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--tc-blue-700)",
  textDecoration: "underline",
  cursor: "pointer",
  padding: 0,
  font: "inherit",
};
const footerStyle: React.CSSProperties = {
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  padding: "10px 14px calc(10px + env(safe-area-inset-bottom, 0px))",
  background: "var(--tc-white)",
  borderTop: "1px solid var(--tc-gray-300)",
  boxShadow: "0 -4px 16px rgba(10,61,98,0.12)",
  zIndex: 20,
};
const diagnosticRowStyle: React.CSSProperties = {
  fontSize: 11.5,
  padding: "6px 0",
  borderBottom: "1px solid var(--tc-gray-100)",
  overflowWrap: "anywhere",
  display: "flex",
  flexDirection: "column",
  gap: 1,
};
