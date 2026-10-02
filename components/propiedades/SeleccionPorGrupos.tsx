"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelSpec } from "trimble-connect-workspace-api";
import { buildDataset, mergeMembers, Members, ModelDataset } from "../../lib/graficos/modelData";
import { mergePropiedades, PropiedadesData } from "../../lib/graficos/propiedades";
import { fetchPropiedades, PropiedadesUnavailableError } from "../../lib/graficos/propiedadesClient";
import {
  listModelObjects,
  ModelObjectList,
  readAllProperties,
  readObjectGuids,
  selectorFor,
  ViewerLike,
} from "../../lib/graficos/viewerReader";
import type { PropiedadesApi } from "../../lib/propiedades/client";
import {
  availableFields,
  countObjects,
  filterFields,
  filterGroups,
  GroupField,
  groupObjects,
  GroupRow,
  MAX_GROUP_FIELDS,
  resolveSavedFields,
} from "../../lib/propiedades/grouping";
import type { PropiedadesViewer } from "../../lib/propiedades/selection";
import type { SavedGrouping, SavedGroupingField } from "../../lib/propiedades/types";
import { noticeBase, noticeStyles, primaryButtonStyle, secondaryButtonStyle } from "../validacion/ui";
import type { ViewerEventListener } from "./PropiedadesShell";

const MAX_ROWS_SHOWN = 300;
const MAX_FIELDS_SHOWN = 200;

interface ModelEntry {
  key: string;
  spec: ModelSpec;
  status: "listing" | "ready" | "empty" | "error";
  list?: ModelObjectList;
}

/** `selection`: it reports a selection made in the viewer (offers to show its properties). */
type Notice = { tone: "info" | "warning" | "error"; text: string; selection?: boolean } | null;

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Ocurrió un error.";
}

function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString("es")} ${n === 1 ? one : many}`;
}

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/**
 * "Seleccionar por agrupación": groups the objects of the loaded models by
 * one to three fields (native properties of the model or attributes of this
 * app) and selects a group in the 3D viewer with one click - which also loads
 * those elements in the Propiedades form. Configurations can be saved for the
 * whole project.
 */
export default function SeleccionPorGrupos({
  active,
  viewer,
  subscribe,
  projectId,
  getAccessToken,
  api,
  dataVersion,
  onShowForm,
}: {
  /** Whether the tab is visible: models are only read then. */
  active: boolean;
  viewer: PropiedadesViewer;
  subscribe: (listener: ViewerEventListener) => () => void;
  projectId: string;
  getAccessToken: (fresh?: boolean) => Promise<string>;
  api: PropiedadesApi;
  /** Changes when attribute values or the catalog change, to read them again. */
  dataVersion: number;
  /** Switches to the Propiedades tab, where the selected elements are shown. */
  onShowForm?: () => void;
}) {
  // The Gráficos readers only use getObjects, getObjectProperties and convertToObjectIds.
  const reader = viewer as unknown as ViewerLike;

  const [models, setModels] = useState<ModelEntry[] | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [datasets, setDatasets] = useState<Record<string, ModelDataset>>({});
  const [reading, setReading] = useState<{ name: string; done: number; total: number } | null>(null);
  const [readError, setReadError] = useState("");
  const [propData, setPropData] = useState<PropiedadesData | null>(null);
  const [propNote, setPropNote] = useState("");
  const [guidMaps, setGuidMaps] = useState<Record<string, Map<number, string>>>({});
  const [guidBusy, setGuidBusy] = useState("");

  const [chosen, setChosen] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fieldQuery, setFieldQuery] = useState("");
  const [rowQuery, setRowQuery] = useState("");
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const [saved, setSaved] = useState<SavedGrouping[] | null>(null);
  const [savedError, setSavedError] = useState("");
  const [saveName, setSaveName] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [pending, setPending] = useState<SavedGrouping | null>(null);

  /** What was being grouped, kept for this browser tab in case Trimble Connect reloads the panel. */
  const storageKey = `propiedades.agrupacion.${projectId}`;
  const restored = useRef<{ fields: SavedGroupingField[]; models: string[] } | null>(null);
  const unmounted = useRef(false);
  const readingKey = useRef<string | null>(null);
  const listing = useRef(new Set<string>());
  /** Models already offered once: new ones start checked, ones the user unchecked stay so. */
  const seen = useRef(new Set<string>());
  const started = useRef(false);

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  // Restore once: the fields are matched when the models are read (like a saved configuration).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      const data = raw ? JSON.parse(raw) : null;
      if (data && Array.isArray(data.fields) && Array.isArray(data.models)) {
        restored.current = data;
        if (data.fields.length) {
          setPending({
            id: "",
            name: "",
            fields: data.fields,
            modelNames: [],
            createdBy: null,
            createdById: null,
            createdAt: "",
            canDelete: false,
          });
        }
      }
    } catch {
      // storage unavailable: start empty
    }
  }, [storageKey]);

  // ------------------------------------------------------------ models

  const refreshModels = useCallback(async () => {
    const loaded = ((await viewer.getModels("loaded").catch(() => [])) ?? []) as ModelSpec[];
    if (unmounted.current) return;
    setModels((prev) => {
      const previous = new Map((prev ?? []).map((e) => [e.key, e]));
      return loaded.map((spec) => previous.get(spec.id) ?? { key: spec.id, spec, status: "listing" });
    });
    // New models are included by default; models no longer loaded drop out.
    const keys = new Set(loaded.map((m) => m.id));
    const fresh = loaded
      .filter((m) => !seen.current.has(m.id))
      // After a reload, only the models that were checked before.
      .filter((m) => !restored.current || restored.current.models.length === 0 || restored.current.models.includes(m.name))
      .map((m) => m.id);
    for (const m of loaded) seen.current.add(m.id);
    setChecked((prev) => [...prev.filter((k) => keys.has(k)), ...fresh.filter((k) => !prev.includes(k))]);

    for (const spec of loaded) {
      if (listing.current.has(spec.id)) continue;
      listing.current.add(spec.id);
      try {
        const list = await listModelObjects(reader, spec);
        if (unmounted.current) return;
        setModels((prev) =>
          prev?.map((e) =>
            e.key === spec.id ? { ...e, list, status: list.runtimeIds.length ? "ready" : "empty" } : e
          ) ?? prev
        );
      } catch {
        listing.current.delete(spec.id); // a later refresh retries it
        setModels((prev) => prev?.map((e) => (e.key === spec.id ? { ...e, status: "error" } : e)) ?? prev);
      }
    }
  }, [viewer, reader]);

  useEffect(() => {
    if (!active) return;
    refreshModels();
    return subscribe((event) => {
      if (event === "viewer.onModelStateChanged" || event === "viewer.onModelReset") refreshModels();
    });
  }, [active, refreshModels, subscribe]);

  // Read the checked models' properties, one model at a time, keeping each.
  useEffect(() => {
    if (!active || readingKey.current || !models) return;
    const next = models.find((e) => checked.includes(e.key) && e.status === "ready" && e.list && !datasets[e.key]);
    if (!next || !next.list) return;
    readingKey.current = next.key;
    setReadError("");
    setReading({ name: next.spec.name, done: 0, total: next.list.runtimeIds.length });
    readAllProperties(
      reader,
      next.list,
      (done, total) => !unmounted.current && setReading({ name: next.spec.name, done, total }),
      () => unmounted.current
    )
      .then((raw) => {
        if (raw && !unmounted.current) setDatasets((prev) => ({ ...prev, [next.key]: buildDataset(next.key, next.spec.name, raw) }));
      })
      .catch((err: unknown) => {
        if (unmounted.current) return;
        setReadError(`No se pudieron leer las propiedades de "${next.spec.name}": ${message(err)}. Márcalo de nuevo para reintentar.`);
        setChecked((prev) => prev.filter((k) => k !== next.key));
      })
      .finally(() => {
        readingKey.current = null;
        if (!unmounted.current) setReading(null);
      });
  }, [active, models, checked, datasets, reader, reading]);

  // ------------------------------------------------------------ attributes of the app

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetchPropiedades(projectId, getAccessToken)
      .then((data) => {
        if (cancelled) return;
        setPropData(data);
        setPropNote("");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPropNote(
          err instanceof PropiedadesUnavailableError
            ? "Los atributos del proyecto no están disponibles para agrupar; las propiedades del modelo sí."
            : `No se pudieron leer los atributos del proyecto: ${message(err)}`
        );
      });
    return () => {
      cancelled = true;
    };
  }, [active, projectId, getAccessToken, dataVersion]);

  // ------------------------------------------------------------ derived

  const ready = useMemo(() => checked.map((k) => datasets[k]).filter((d): d is ModelDataset => !!d), [checked, datasets]);
  const merged = useMemo(() => (propData ? mergePropiedades(ready, guidMaps, propData) : ready), [ready, propData, guidMaps]);
  const fields = useMemo(() => availableFields(merged), [merged]);
  const fieldByKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const chosenFields = useMemo(
    () => chosen.map((k) => fieldByKey.get(k)).filter((f): f is GroupField => !!f),
    [chosen, fieldByKey]
  );
  const allRead =
    !!models && checked.length > 0 && checked.every((k) => datasets[k] || models.find((e) => e.key === k)?.status === "empty");
  const rows = useMemo(() => groupObjects(merged, chosenFields), [merged, chosenFields]);
  const shownRows = useMemo(() => filterGroups(rows, rowQuery), [rows, rowQuery]);
  const viewerModelIds = useMemo(
    () => Object.fromEntries((models ?? []).filter((e) => e.list).map((e) => [e.key, e.list!.queryModelId])),
    [models]
  );

  // Attribute values attach by IFCGUID: objects without a GUID property of
  // their own (IFC models; Revit has "IfcGUID") need the viewer's ids, read
  // only once an attribute of the project is chosen for grouping.
  const needGuids = useMemo(() => {
    if (!propData?.values.length || !chosenFields.some((f) => f.fromApp)) return [];
    return ready.filter((d) => !guidMaps[d.modelId] && viewerModelIds[d.modelId] && d.records.some((r) => !r.ifcGuid));
  }, [propData, chosenFields, ready, guidMaps, viewerModelIds]);

  useEffect(() => {
    if (!active || needGuids.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const dataset of needGuids) {
        if (cancelled) return;
        setGuidBusy(`Leyendo los identificadores IFC de "${dataset.modelName}"...`);
        try {
          const map = await readObjectGuids(reader, viewerModelIds[dataset.modelId], dataset.records.map((r) => r.runtimeId));
          if (!cancelled) setGuidMaps((prev) => ({ ...prev, [dataset.modelId]: map }));
        } catch (err) {
          if (!cancelled) {
            setGuidMaps((prev) => ({ ...prev, [dataset.modelId]: new Map() }));
            setNotice({ tone: "warning", text: `No se pudieron leer los identificadores de "${dataset.modelName}": ${message(err)}` });
          }
        }
      }
      if (!cancelled) setGuidBusy("");
    })();
    return () => {
      cancelled = true;
    };
  }, [active, needGuids, reader, viewerModelIds]);

  useEffect(() => {
    // While a configuration is still being applied, keep what was stored.
    if (!models || pending) return;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          fields: chosenFields.map((f) => ({ key: f.key, label: f.label, group: f.group })),
          models: models.filter((e) => checked.includes(e.key)).map((e) => e.spec.name),
        })
      );
    } catch {
      // storage unavailable: nothing to remember
    }
  }, [storageKey, chosenFields, checked, models, pending]);

  // A new grouping starts with nothing marked.
  useEffect(() => {
    setMarked(new Set());
    setLastSelected(null);
  }, [chosen, checked]);

  // ------------------------------------------------------------ saved configurations

  const loadSaved = useCallback(async () => {
    try {
      setSaved(await api.listGroupings());
      setSavedError("");
    } catch (err) {
      setSavedError(message(err));
    }
  }, [api]);

  useEffect(() => {
    if (active && !started.current) {
      started.current = true;
      loadSaved();
    }
  }, [active, loadSaved]);

  function applySaved(config: SavedGrouping) {
    setNotice(null);
    const names = new Set(config.modelNames);
    const matching = (models ?? []).filter((e) => names.has(e.spec.name)).map((e) => e.key);
    if (matching.length) setChecked(matching);
    else if (config.modelNames.length) {
      setNotice({ tone: "warning", text: `Los modelos con que se guardó (${config.modelNames.join(", ")}) no están cargados; se usan los marcados.` });
    }
    setChosen([]);
    setPending(config);
  }

  // Fields of a saved configuration are matched once its models are read.
  useEffect(() => {
    if (!pending || !allRead || reading) return;
    const { found, missing } = resolveSavedFields(pending.fields, fields);
    setChosen(found.map((f) => f.key));
    setPending(null);
    if (!pending.name) return; // restored after a reload: nothing to announce
    if (missing.length) {
      setNotice({ tone: "warning", text: `"${pending.name}": no se encontró ${missing.join(", ")} en los modelos marcados.` });
    } else {
      setNotice({ tone: "info", text: `Configuración "${pending.name}" aplicada.` });
    }
  }, [pending, allRead, reading, fields]);

  async function saveConfig() {
    const name = saveName.trim();
    if (!name || chosenFields.length === 0) return;
    setSavingConfig(true);
    setNotice(null);
    try {
      await api.saveGrouping({
        name,
        fields: chosenFields.map((f) => ({ key: f.key, label: f.label, group: f.group })),
        modelNames: (models ?? []).filter((e) => checked.includes(e.key)).map((e) => e.spec.name),
      });
      setSaveName("");
      await loadSaved();
      setNotice({ tone: "info", text: `Configuración "${name}" guardada para todo el proyecto.` });
    } catch (err) {
      setNotice({ tone: "error", text: `No se guardó la configuración: ${message(err)}` });
    } finally {
      setSavingConfig(false);
    }
  }

  async function removeSaved(config: SavedGrouping) {
    setConfirmDelete(null);
    try {
      await api.deleteGrouping(config.id);
      await loadSaved();
      setNotice({ tone: "info", text: `Configuración "${config.name}" eliminada.` });
    } catch (err) {
      setNotice({ tone: "error", text: `No se eliminó: ${message(err)}` });
    }
  }

  // ------------------------------------------------------------ selection in the viewer

  async function selectInViewer(members: Members, objects: number, what: string, rowKey: string | null) {
    try {
      await viewer.setSelection(selectorFor(members, viewerModelIds), "set");
      setLastSelected(rowKey);
      setNotice({
        tone: "info",
        text: `${count(objects, "elemento seleccionado", "elementos seleccionados")} en el modelo: ${what}.`,
        selection: true,
      });
    } catch (err) {
      setNotice({ tone: "error", text: `No se pudo seleccionar en el visor: ${message(err)}` });
    }
  }

  function rowName(row: GroupRow): string {
    return row.labels.join(" · ");
  }

  const markedRows = rows.filter((r) => marked.has(r.key));

  // ------------------------------------------------------------ render

  if (!active && !models) return null;

  const loadedModels = models ?? [];
  const pickerFields = filterFields(
    fields.filter((f) => !chosen.includes(f.key)),
    fieldQuery
  ).slice(0, MAX_FIELDS_SHOWN);

  return (
    <div style={pageStyle}>
      <header>
        <h2 style={titleStyle}>Seleccionar por agrupación</h2>
        <p style={subtitleStyle}>
          Agrupa los elementos por propiedades del modelo o atributos del proyecto y selecciona un grupo en el visor 3D.
        </p>
      </header>

      {notice && (
        <div style={{ ...noticeBase, ...noticeStyles[notice.tone] }} role="status">
          {notice.text}
          {notice.selection && onShowForm && (
            <>
              {" "}
              <button type="button" onClick={onShowForm} style={linkStyle}>
                Ver y asignar sus atributos
              </button>
            </>
          )}
        </div>
      )}

      {/* Models */}
      <details open style={cardStyle}>
        <summary style={sectionTitleStyle}>
          Modelos ({checked.length}/{loadedModels.length})
        </summary>
        {models === null ? (
          <span style={mutedStyle}>Buscando los modelos cargados...</span>
        ) : loadedModels.length === 0 ? (
          <span style={mutedStyle}>Carga un modelo en el visor para agrupar sus elementos.</span>
        ) : (
          <ul style={listStyle}>
            {loadedModels.map((e) => {
              const isChecked = checked.includes(e.key);
              const ds = datasets[e.key];
              const status =
                e.status === "listing"
                  ? "buscando objetos..."
                  : e.status === "empty"
                    ? "sin objetos"
                    : e.status === "error"
                      ? "no se pudo leer"
                      : reading && reading.name === e.spec.name && isChecked
                        ? `leyendo ${reading.done.toLocaleString("es")} de ${reading.total.toLocaleString("es")}`
                        : ds
                          ? count(ds.records.length, "elemento", "elementos")
                          : isChecked
                            ? "en espera"
                            : count(e.list?.runtimeIds.length ?? 0, "objeto", "objetos");
              return (
                <li key={e.key}>
                  <label style={checkRowStyle}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() =>
                        setChecked((prev) => (prev.includes(e.key) ? prev.filter((k) => k !== e.key) : [...prev, e.key]))
                      }
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
      </details>

      {/* Group by */}
      <section style={cardStyle}>
        <h3 style={sectionTitleStyle}>Agrupar por</h3>
        {chosen.length > 0 && (
          <ol style={{ ...listStyle, gap: 6 }}>
            {chosen.map((key, i) => {
              const f = fieldByKey.get(key);
              return (
                <li key={key} style={chosenRowStyle}>
                  <span style={levelStyle}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 11, color: "var(--tc-gray-500)" }}>
                      {f ? (f.fromApp ? `Atributo del proyecto · ${f.group}` : f.group) : "..."}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--tc-gray-700)", overflowWrap: "anywhere" }}>
                      {f?.label ?? key}
                    </span>
                  </span>
                  {i > 0 && (
                    <button
                      type="button"
                      onClick={() => setChosen((prev) => [...prev.slice(0, i - 1), prev[i], prev[i - 1], ...prev.slice(i + 1)])}
                      style={iconButtonStyle}
                      aria-label={`Subir ${f?.label ?? key}`}
                      title="Subir de nivel"
                    >
                      ↑
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setChosen((prev) => prev.filter((k) => k !== key))}
                    style={iconButtonStyle}
                    aria-label={`Quitar ${f?.label ?? key}`}
                    title="Quitar"
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {chosen.length < MAX_GROUP_FIELDS && (
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            disabled={fields.length === 0}
            style={{ ...addButtonStyle, opacity: fields.length === 0 ? 0.55 : 1 }}
            aria-expanded={pickerOpen}
          >
            <span style={plusStyle}>+</span> Añadir propiedad para agrupar por
          </button>
        )}
        {fields.length === 0 && checked.length > 0 && (
          <span style={mutedStyle}>
            {reading ? "Leyendo las propiedades de los modelos..." : allRead ? "Los modelos marcados no tienen propiedades." : "Esperando los modelos..."}
          </span>
        )}
        {pickerOpen && fields.length > 0 && (
          <div style={pickerStyle}>
            <input
              autoFocus
              value={fieldQuery}
              onChange={(e) => setFieldQuery(e.target.value)}
              placeholder="Buscar propiedad (p. ej. Level, cumple calidad)..."
              style={inputStyle}
              aria-label="Buscar propiedad"
            />
            <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column" }}>
              {pickerFields.length === 0 && <span style={{ ...mutedStyle, padding: 8 }}>Ninguna propiedad coincide.</span>}
              {pickerFields.map((f, i) => {
                const header = f.fromApp ? `Atributos del proyecto · ${f.group}` : f.group;
                const prevHeader = i > 0 ? (pickerFields[i - 1].fromApp ? `Atributos del proyecto · ${pickerFields[i - 1].group}` : pickerFields[i - 1].group) : null;
                return (
                  <div key={f.key}>
                    {header !== prevHeader && <div style={pickerHeaderStyle}>{header}</div>}
                    <button
                      type="button"
                      onClick={() => {
                        setChosen((prev) => [...prev, f.key]);
                        setPickerOpen(false);
                        setFieldQuery("");
                      }}
                      style={pickerOptionStyle}
                    >
                      <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                        {f.label}
                        {f.unit ? <span style={metaStyle}> ({f.unit})</span> : null}
                      </span>
                      <span style={metaStyle}>{count(f.objectCount, "elemento", "elementos")}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {propNote && <span style={{ fontSize: 11.5, color: "var(--tc-gray-500)" }}>{propNote}</span>}
      </section>

      {/* Results */}
      {chosenFields.length > 0 && (
        <section style={cardStyle}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <h3 style={sectionTitleStyle}>Resultados</h3>
            <span style={metaStyle}>
              {count(rows.length, "grupo", "grupos")} · {count(countObjects(rows), "elemento", "elementos")}
            </span>
          </div>
          {(reading || guidBusy) && (
            <span style={mutedStyle}>{guidBusy || "Leyendo modelos: los resultados se completan al terminar."}</span>
          )}
          {rows.length > 8 && (
            <input
              value={rowQuery}
              onChange={(e) => setRowQuery(e.target.value)}
              placeholder="Filtrar resultados..."
              style={inputStyle}
              aria-label="Filtrar resultados"
            />
          )}
          <p style={{ ...mutedStyle, margin: 0, fontSize: 11.5 }}>
            Haz clic en un grupo para seleccionar sus elementos en el modelo, o marca varios y usa &quot;Seleccionar marcados&quot;.
          </p>
          <ul style={{ ...listStyle, gap: 0 }}>
            {shownRows.slice(0, MAX_ROWS_SHOWN).map((row) => {
              const isLast = lastSelected === row.key;
              return (
                <li key={row.key} style={{ ...resultRowStyle, background: isLast ? "var(--tc-blue-100)" : "transparent" }}>
                  <input
                    type="checkbox"
                    checked={marked.has(row.key)}
                    onChange={() =>
                      setMarked((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.key)) next.delete(row.key);
                        else next.add(row.key);
                        return next;
                      })
                    }
                    aria-label={`Marcar ${rowName(row)}`}
                  />
                  <button
                    type="button"
                    onClick={() => selectInViewer(row.members, row.objects, rowName(row), row.key)}
                    style={resultButtonStyle}
                    title="Seleccionar estos elementos en el modelo"
                    aria-label={`Seleccionar ${rowName(row)}: ${count(row.objects, "elemento", "elementos")}`}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                      {row.labels.map((label, i) => (
                        <span key={i} style={label.startsWith("(") ? { color: "var(--tc-gray-500)", fontStyle: "italic" } : undefined}>
                          {i > 0 && <span style={{ color: "var(--tc-gray-500)" }}> · </span>}
                          {label}
                        </span>
                      ))}
                    </span>
                    <span style={countBadgeStyle}>{row.objects.toLocaleString("es")}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {shownRows.length > MAX_ROWS_SHOWN && (
            <span style={mutedStyle}>
              Se muestran {MAX_ROWS_SHOWN} de {shownRows.length.toLocaleString("es")} grupos: filtra para encontrar el resto.
            </span>
          )}
          {shownRows.length === 0 && rows.length > 0 && <span style={mutedStyle}>Ningún grupo coincide con el filtro.</span>}
          {markedRows.length > 0 && (
            <div style={markedBarStyle}>
              <span style={{ flex: 1, minWidth: 120, fontSize: 12.5 }}>
                {count(markedRows.length, "grupo marcado", "grupos marcados")} · {count(countObjects(markedRows), "elemento", "elementos")}
              </span>
              <button type="button" onClick={() => setMarked(new Set())} style={secondaryButtonStyle}>
                Desmarcar
              </button>
              <button
                type="button"
                onClick={() =>
                  selectInViewer(
                    mergeMembers(markedRows.map((r) => r.members)),
                    countObjects(markedRows),
                    count(markedRows.length, "grupo", "grupos"),
                    null
                  )
                }
                style={primaryButtonStyle}
              >
                Seleccionar marcados
              </button>
            </div>
          )}
        </section>
      )}

      {/* Saved configurations */}
      <section style={cardStyle}>
        <h3 style={sectionTitleStyle}>Configuraciones guardadas</h3>
        {savedError ? (
          <div style={{ ...noticeBase, ...noticeStyles.error }}>
            {savedError}{" "}
            <button type="button" onClick={loadSaved} style={linkStyle}>
              Reintentar
            </button>
          </div>
        ) : saved === null ? (
          <span style={mutedStyle}>Cargando...</span>
        ) : saved.length === 0 ? (
          <span style={mutedStyle}>Aún no hay configuraciones guardadas en el proyecto.</span>
        ) : (
          <ul style={{ ...listStyle, gap: 6 }}>
            {saved.map((config) => (
              <li key={config.id} style={savedRowStyle}>
                <button
                  type="button"
                  onClick={() => applySaved(config)}
                  style={savedButtonStyle}
                  title="Aplicar esta configuración"
                  disabled={pending?.id === config.id}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--tc-blue-800)" }}>
                    {config.name}
                    {pending?.id === config.id ? " (aplicando...)" : ""}
                  </span>
                  <span style={{ fontSize: 11.5, color: "var(--tc-gray-500)" }}>
                    {config.fields.map((f) => f.label).join(" › ")}
                    {config.createdBy ? ` · ${config.createdBy.replace(/ \(.*\)$/, "")}` : ""}
                    {config.createdAt ? ` · ${stamp(config.createdAt)}` : ""}
                  </span>
                </button>
                {config.canDelete &&
                  (confirmDelete === config.id ? (
                    <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <button type="button" onClick={() => removeSaved(config)} style={dangerSmallStyle}>
                        Eliminar
                      </button>
                      <button type="button" onClick={() => setConfirmDelete(null)} style={smallButtonStyle}>
                        No
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(config.id)}
                      style={iconButtonStyle}
                      aria-label={`Eliminar ${config.name}`}
                      title="Eliminar"
                    >
                      ×
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveConfig();
          }}
          style={{ display: "flex", gap: 6, flexWrap: "wrap" }}
        >
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder={chosenFields.length ? "Nombre, p. ej. Muros por nivel" : "Elige primero por qué agrupar"}
            maxLength={80}
            disabled={chosenFields.length === 0}
            style={{ ...inputStyle, flex: "1 1 160px" }}
            aria-label="Nombre de la configuración"
          />
          <button
            type="submit"
            disabled={savingConfig || !saveName.trim() || chosenFields.length === 0}
            style={{ ...primaryButtonStyle, opacity: savingConfig || !saveName.trim() || chosenFields.length === 0 ? 0.55 : 1 }}
          >
            {savingConfig ? "Guardando..." : "Guardar configuración"}
          </button>
        </form>
        <span style={{ fontSize: 11.5, color: "var(--tc-gray-500)" }}>
          Se guardan para todo el proyecto: por qué propiedades agrupar y con qué modelos. Las elimina quien las guardó o un
          administrador.
        </span>
      </section>
    </div>
  );
}

const pageStyle: React.CSSProperties = { padding: 14, display: "flex", flexDirection: "column", gap: 12, maxWidth: 720, margin: "0 auto" };
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 17, color: "var(--tc-blue-900)" };
const subtitleStyle: React.CSSProperties = { margin: "2px 0 0", fontSize: 12.5, color: "var(--tc-gray-500)" };
const cardStyle: React.CSSProperties = {
  background: "var(--tc-white)",
  borderRadius: "var(--tc-radius)",
  boxShadow: "var(--tc-shadow)",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
const sectionTitleStyle: React.CSSProperties = { margin: 0, fontSize: 14, fontWeight: 700, color: "var(--tc-blue-800)", cursor: "default" };
const mutedStyle: React.CSSProperties = { fontSize: 12.5, color: "var(--tc-gray-500)" };
const metaStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--tc-gray-500)", whiteSpace: "nowrap" };
const listStyle: React.CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 };
const checkRowStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--tc-gray-700)", cursor: "pointer" };
const chosenRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 8px",
  border: "1px solid var(--tc-gray-100)",
  borderRadius: 8,
  background: "var(--tc-blue-50)",
};
const levelStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 999,
  background: "var(--tc-blue-600)",
  color: "var(--tc-white)",
  fontSize: 11,
  fontWeight: 700,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};
const iconButtonStyle: React.CSSProperties = {
  border: "1px solid var(--tc-gray-300)",
  background: "var(--tc-white)",
  color: "var(--tc-gray-700)",
  borderRadius: 6,
  width: 26,
  height: 26,
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1,
  flexShrink: 0,
};
const addButtonStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "none",
  background: "transparent",
  color: "var(--tc-blue-700)",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
  padding: "4px 0",
  fontFamily: "inherit",
  textAlign: "left",
};
const plusStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 999,
  background: "var(--tc-blue-600)",
  color: "var(--tc-white)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 15,
  lineHeight: 1,
};
const pickerStyle: React.CSSProperties = {
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 8,
  padding: 8,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  background: "var(--tc-white)",
};
const pickerHeaderStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "var(--tc-gray-500)",
  padding: "8px 6px 2px",
};
const pickerOptionStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  border: "none",
  background: "transparent",
  borderRadius: 6,
  padding: "6px",
  fontSize: 13,
  color: "var(--tc-gray-700)",
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "inherit",
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
const resultRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "2px 6px",
  borderBottom: "1px solid var(--tc-gray-100)",
  borderRadius: 4,
};
const resultButtonStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "none",
  background: "transparent",
  padding: "7px 0",
  fontSize: 13,
  color: "var(--tc-gray-700)",
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "inherit",
};
const countBadgeStyle: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  color: "var(--tc-blue-800)",
  background: "var(--tc-blue-100)",
  borderRadius: 999,
  padding: "1px 8px",
  flexShrink: 0,
  fontVariantNumeric: "tabular-nums",
};
const markedBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
  padding: 8,
  borderRadius: 8,
  background: "var(--tc-blue-50)",
  border: "1px solid var(--tc-blue-100)",
  position: "sticky",
  bottom: 0,
};
const savedRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid var(--tc-gray-100)",
  borderRadius: 8,
  padding: "4px 6px 4px 10px",
};
const savedButtonStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 1,
  border: "none",
  background: "transparent",
  padding: "4px 0",
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "inherit",
  overflowWrap: "anywhere",
};
const smallButtonStyle: React.CSSProperties = { ...secondaryButtonStyle, padding: "3px 8px", fontSize: 12 };
const dangerSmallStyle: React.CSSProperties = { ...smallButtonStyle, border: "1px solid #e5a29c", color: "#8a1c14" };
const linkStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "inherit",
  textDecoration: "underline",
  cursor: "pointer",
  padding: 0,
  font: "inherit",
};
