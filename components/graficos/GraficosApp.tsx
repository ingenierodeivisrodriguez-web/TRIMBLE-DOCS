"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelSpec } from "trimble-connect-workspace-api";
import type { ColorGroup } from "../../lib/graficos/colors";
import {
  applySlicers,
  bucketOf,
  buildDataset,
  CommonField,
  commonFields,
  formatNumber,
  GENERAL_GROUP,
  memberCount,
  Members,
  mergeMembers,
  ModelDataset,
  SlicerSpec,
} from "../../lib/graficos/modelData";
import { buildReportPdf, downloadBlob, ReportChart, snapshotToJpeg, svgToPng } from "../../lib/graficos/pdfReport";
import { addView, loadViews, SavedView, storeViews } from "../../lib/graficos/savedViews";
import {
  listModelObjects,
  ModelObjectList,
  modelHasData,
  readAllProperties,
  selectorFor,
  ViewerLike,
} from "../../lib/graficos/viewerReader";
import { normalizeForSearch } from "../../lib/folderTree";
import ChartCard, { CardReport, CardSpec, ChartType, FIELD_DRAG_TYPE, fieldLabel, kindMark } from "./ChartCard";
import Slicers from "./Slicers";
import type { ViewerEventListener, ViewerProject } from "./ViewerShell";

type ModelStatus = "checking" | "data" | "empty" | "error";

interface ModelEntry {
  key: string;
  spec: ModelSpec;
  status: ModelStatus;
  objectCount: number;
  list?: ModelObjectList;
}

interface ReadingState {
  modelName: string;
  done: number;
  total: number;
}

const INITIAL_TYPES: ChartType[] = ["column", "horizontal", "donut"];

function emptySpec(type: ChartType): CardSpec {
  return { type, category: null, value: null, compareBy: null, periodA: null, periodB: null };
}

/**
 * The bar / slice whose objects are selected in the viewer. It only stays
 * highlighted while the chart it came from is unchanged: `source` and `spec`
 * are the exact data and spec it was computed from.
 */
interface ViewerSelection {
  chart: number;
  key: string;
  members: Members;
  count: number;
  source: ModelDataset[];
  spec: CardSpec;
}

// A model can be reloaded in the viewer as another version; the data only
// stays valid for the exact version it was read from.
function modelKey(spec: ModelSpec): string {
  return `${spec.id}:${spec.versionId ?? ""}`;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Waits for React to commit and the browser to paint (so charts reflect export
 * mode). Capped, because a hidden page doesn't run animation frames at all.
 */
const nextPaint = () =>
  Promise.race([
    new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    wait(400),
  ]);
// Time the viewer gets to redraw after its colors change, before a snapshot is taken.
const VIEWER_REDRAW_MS = 900;
const SNAPSHOT_TIMEOUT_MS = 15000;

/** Rejects if `promise` takes longer than `ms` (a report without a picture beats a stuck export). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    wait(ms).then(() => {
      throw new Error("timeout");
    }),
  ]);
}

function defaultViewName(): string {
  return `Vista ${new Date().toLocaleString("es", { dateStyle: "short", timeStyle: "short" })}`;
}

export default function GraficosApp({
  viewer,
  subscribe,
  project,
}: {
  viewer: ViewerLike;
  subscribe: (listener: ViewerEventListener) => () => void;
  project: ViewerProject;
}) {
  const [models, setModels] = useState<ModelEntry[] | null>(null);
  const [unloaded, setUnloaded] = useState<ModelSpec[]>([]);
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [datasets, setDatasets] = useState<Record<string, ModelDataset>>({});
  const [reading, setReading] = useState<ReadingState | null>(null);
  const [readError, setReadError] = useState("");
  const [charts, setCharts] = useState<CardSpec[]>(() => INITIAL_TYPES.map(emptySpec));
  const [slicers, setSlicers] = useState<SlicerSpec[]>([]);
  const [viewerSelection, setViewerSelection] = useState<ViewerSelection | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const [search, setSearch] = useState("");
  const [fieldsCollapsed, setFieldsCollapsed] = useState(false);

  // "Colorear": the chart painting the model, and a nudge to make it repaint.
  const [coloring, setColoring] = useState<number | null>(null);
  const [colorVersion, setColorVersion] = useState(0);
  const [colorError, setColorError] = useState("");

  // Saved views ("vistas guardadas"), kept in this browser per project.
  const storageProject = project.id || "sin-proyecto";
  const [views, setViews] = useState<SavedView[]>([]);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [saveName, setSaveName] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [viewNotice, setViewNotice] = useState("");
  const [pendingModels, setPendingModels] = useState<{ id: string; name: string }[]>([]);

  // PDF export.
  const [exportMode, setExportMode] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [exportError, setExportError] = useState("");
  const reportGetters = useRef<((() => CardReport | null) | null)[]>([]);

  const unmounted = useRef(false);
  // Probe results survive a model being unloaded and loaded again (same version).
  const probeResults = useRef(new Map<string, Pick<ModelEntry, "status" | "objectCount" | "list">>());
  const probing = useRef(new Set<string>());
  const readingKey = useRef<string | null>(null);
  const refreshState = useRef({ running: false, again: false });

  useEffect(() => {
    // Reset on (re)mount too: React's development double-mount runs the cleanup once.
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  const updateModel = useCallback((key: string, patch: Partial<ModelEntry>) => {
    setModels((prev) => prev?.map((e) => (e.key === key ? { ...e, ...patch } : e)) ?? prev);
  }, []);

  const refreshOnce = useCallback(async () => {
    const loaded = (await viewer.getModels("loaded")) ?? [];
    const notLoaded = (await viewer.getModels("unloaded").catch(() => [])) ?? [];
    if (unmounted.current) return;

    const loadedKeys = new Set(loaded.map(modelKey));
    const loadedIds = new Set(loaded.map((m) => m.id));
    setUnloaded(notLoaded.filter((m) => !loadedIds.has(m.id)));
    setModels((prev) => {
      const previous = new Map((prev ?? []).map((e) => [e.key, e]));
      return loaded.map((spec) => {
        const key = modelKey(spec);
        return (
          previous.get(key) ?? { key, spec, status: "checking", objectCount: 0, ...probeResults.current.get(key) }
        );
      });
    });
    setSelected((prev) => prev.filter((key) => loadedKeys.has(key)));

    // Probe new models one at a time: each probe is a few viewer round-trips,
    // and the viewer is also busy rendering whatever was just loaded.
    for (const spec of loaded) {
      const key = modelKey(spec);
      if (probeResults.current.has(key) || probing.current.has(key)) continue;
      probing.current.add(key);
      try {
        const list = await listModelObjects(viewer, spec);
        const hasData = await modelHasData(viewer, list);
        if (unmounted.current) return;
        const result = { status: hasData ? "data" : "empty", objectCount: list.runtimeIds.length, list } as const;
        probeResults.current.set(key, result);
        updateModel(key, result);
      } catch {
        updateModel(key, { status: "error" }); // not cached, so the next refresh retries it
      } finally {
        probing.current.delete(key);
      }
    }
  }, [viewer, updateModel]);

  // Model-state events arrive in bursts while a model loads; coalesce them
  // into at most one extra refresh after the one already running.
  const refresh = useCallback(async () => {
    const state = refreshState.current;
    if (state.running) {
      state.again = true;
      return;
    }
    state.running = true;
    try {
      do {
        state.again = false;
        await refreshOnce();
      } while (state.again && !unmounted.current);
      setListError("");
    } catch (err) {
      setListError(err instanceof Error ? err.message : "No se pudo leer la lista de modelos.");
      setModels((prev) => prev ?? []);
    } finally {
      state.running = false;
    }
  }, [refreshOnce]);

  useEffect(() => {
    refresh();
    return subscribe((event) => {
      if (event === "viewer.onModelStateChanged" || event === "viewer.onModelReset") refresh();
    });
  }, [refresh, subscribe]);

  // Read the full properties of selected models, one model at a time, caching
  // each so re-selecting it later is instant.
  useEffect(() => {
    if (readingKey.current || !models) return;
    const next = selected
      .map((key) => models.find((e) => e.key === key))
      .find((e): e is ModelEntry => !!e && e.status === "data" && !!e.list && !datasets[e.key]);
    if (!next || !next.list) return;

    readingKey.current = next.key;
    setReadError("");
    setReading({ modelName: next.spec.name, done: 0, total: next.list.runtimeIds.length });
    readAllProperties(
      viewer,
      next.list,
      (done, total) => {
        if (!unmounted.current) setReading({ modelName: next.spec.name, done, total });
      },
      () => unmounted.current
    )
      .then((raw) => {
        if (raw && !unmounted.current) {
          setDatasets((prev) => ({ ...prev, [next.key]: buildDataset(next.key, next.spec.name, raw) }));
        }
      })
      .catch((err: unknown) => {
        if (unmounted.current) return;
        setReadError(
          `No se pudieron leer las propiedades de "${next.spec.name}": ${err instanceof Error ? err.message : "error desconocido"}. Vuelve a marcarlo para reintentar.`
        );
        // Deselect it rather than retrying in a loop; checking it again retries.
        setSelected((prev) => prev.filter((key) => key !== next.key));
      })
      .finally(() => {
        readingKey.current = null;
        if (!unmounted.current) setReading(null);
      });
    // `reading` is a dependency so that finishing one model (setReading(null))
    // re-runs this effect and starts on the next selected model.
  }, [selected, models, datasets, reading, viewer]);

  const selectedWithData = useMemo(
    () => selected.filter((key) => models?.some((e) => e.key === key && e.status === "data")),
    [selected, models]
  );
  const allRead = selectedWithData.every((key) => datasets[key]);
  const activeDatasets = useMemo(
    () => (allRead ? selectedWithData.map((key) => datasets[key]) : null),
    [allRead, selectedWithData, datasets]
  );
  const fields = useMemo(() => (activeDatasets ? commonFields(activeDatasets) : []), [activeDatasets]);

  // Slicers on fields the selected models don't share are kept (they come
  // back if the models are selected again) but don't filter anything.
  const effectiveSlicers = useMemo(() => {
    const byKey = new Map(fields.map((f) => [f.key, f]));
    return slicers.filter((s) => byKey.has(s.field)).map((s) => ({ ...s, kind: byKey.get(s.field)!.kind }));
  }, [slicers, fields]);
  const filteredDatasets = useMemo(
    () => (activeDatasets ? applySlicers(activeDatasets, effectiveSlicers) : null),
    [activeDatasets, effectiveSlicers]
  );
  const countObjects = (list: ModelDataset[] | null) => (list ?? []).reduce((sum, d) => sum + d.records.length, 0);

  const viewerModelIds = useMemo(
    () => Object.fromEntries((models ?? []).filter((e) => e.list).map((e) => [e.key, e.list!.queryModelId])),
    [models]
  );
  const liveSelection =
    viewerSelection &&
    viewerSelection.source === filteredDatasets &&
    viewerSelection.spec === charts[viewerSelection.chart]
      ? viewerSelection
      : null;

  async function selectInViewer(chart: number, key: string, members: Members) {
    setSelectionError("");
    const selector = selectorFor(members, viewerModelIds);
    try {
      if (liveSelection && liveSelection.chart === chart && liveSelection.key === key) {
        // Clicking the highlighted bar again deselects exactly what it selected.
        await viewer.setSelection(selector, "remove");
        setViewerSelection(null);
        return;
      }
      await viewer.setSelection(selector, "set");
      if (!filteredDatasets) return;
      setViewerSelection({ chart, key, members, count: memberCount(members), source: filteredDatasets, spec: charts[chart] });
    } catch (err) {
      setSelectionError(err instanceof Error ? err.message : "No se pudo seleccionar en el visor.");
    }
  }

  async function clearViewerSelection() {
    if (!liveSelection) return;
    try {
      await viewer.setSelection(selectorFor(liveSelection.members, viewerModelIds), "remove");
    } catch {
      // The user may already have changed the selection in the viewer; nothing to undo.
    }
    setViewerSelection(null);
  }

  // ------------------------------------------------------------ colorear

  // Viewer color changes run one at a time, in order, so an older coloring
  // still in flight can never land on top of a newer one.
  const colorQueue = useRef<Promise<void>>(Promise.resolve());
  // Objects this extension has painted, so exactly those can be reset later.
  const painted = useRef<Members>({});
  const viewerModelIdsRef = useRef(viewerModelIds);
  useEffect(() => {
    viewerModelIdsRef.current = viewerModelIds;
  }, [viewerModelIds]);

  const enqueueColors = useCallback((task: () => Promise<void>) => {
    const run = colorQueue.current.then(task).catch((err: unknown) => {
      if (!unmounted.current) setColorError(err instanceof Error ? err.message : "No se pudieron aplicar los colores.");
    });
    colorQueue.current = run;
    return run;
  }, []);

  const resetPainted = useCallback(async () => {
    const members = painted.current;
    painted.current = {};
    if (memberCount(members) > 0) {
      await viewer.setObjectState(selectorFor(members, viewerModelIdsRef.current), { color: "reset" });
    }
  }, [viewer]);

  const paint = useCallback(
    async (groups: ColorGroup[]) => {
      await resetPainted();
      for (const group of groups) {
        if (memberCount(group.members) === 0) continue;
        await viewer.setObjectState(selectorFor(group.members, viewerModelIdsRef.current), { color: group.color });
      }
      painted.current = mergeMembers(groups.map((g) => g.members));
    },
    [viewer, resetPainted]
  );

  const applyColors = useCallback(
    (groups: ColorGroup[]) => {
      setColorError("");
      enqueueColors(() => paint(groups));
    },
    [enqueueColors, paint]
  );

  function toggleColoring(chart: number) {
    if (coloring === chart) {
      setColoring(null);
      enqueueColors(resetPainted);
    } else {
      // That card's effect paints the model, resetting the previous colors first.
      setColoring(chart);
    }
  }

  // ------------------------------------------------------------ vistas guardadas

  useEffect(() => {
    setViews(loadViews(storageProject));
  }, [storageProject]);

  function persistViews(next: SavedView[]) {
    setViews(next);
    if (!storeViews(storageProject, next)) {
      setViewNotice("Este navegador no deja guardar datos a la extensión: las vistas se perderán al cerrar el panel.");
    }
  }

  function saveView() {
    const name = (saveName ?? "").trim() || defaultViewName();
    const savedModels = selectedWithData
      .map((key) => models?.find((e) => e.key === key))
      .filter((e): e is ModelEntry => !!e)
      .map((e) => ({ id: e.spec.id, name: e.spec.name }));
    const view: SavedView = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      savedAt: new Date().toISOString(),
      models: savedModels,
      charts,
      slicers,
    };
    persistViews(addView(views, view));
    setActiveViewId(view.id);
    setSaveName(null);
    setViewNotice(`Vista “${name}” guardada.`);
  }

  function openView(view: SavedView) {
    const available = models ?? [];
    const keys: string[] = [];
    const missing: { id: string; name: string }[] = [];
    for (const saved of view.models) {
      // Matched by file id, so the view still opens after a model gets a new version.
      const entry = available.find((e) => e.spec.id === saved.id && e.status !== "empty" && e.status !== "error");
      if (entry) keys.push(entry.key);
      else missing.push(saved);
    }
    setSelected(keys);
    setCharts(view.charts);
    setSlicers(view.slicers);
    setPendingModels(missing);
    setActiveViewId(view.id);
    setViewsOpen(false);
    setViewNotice(missing.length === 0 ? `Vista “${view.name}” abierta.` : "");
    if (coloring !== null) {
      setColoring(null);
      enqueueColors(resetPainted);
    }
  }

  function deleteView(id: string) {
    persistViews(views.filter((v) => v.id !== id));
    if (activeViewId === id) setActiveViewId(null);
  }

  // Models a view needs that weren't loaded: select them as soon as they show up.
  useEffect(() => {
    if (pendingModels.length === 0 || !models) return;
    const arrived = pendingModels
      .map((pending) => ({ pending, entry: models.find((e) => e.spec.id === pending.id && e.status !== "checking") }))
      .filter((x): x is { pending: { id: string; name: string }; entry: ModelEntry } => !!x.entry);
    if (arrived.length === 0) return;
    setSelected((prev) => [
      ...prev,
      ...arrived.filter((x) => x.entry.status === "data" && !prev.includes(x.entry.key)).map((x) => x.entry.key),
    ]);
    setPendingModels((prev) => prev.filter((p) => !arrived.some((x) => x.pending.id === p.id)));
  }, [models, pendingModels]);

  async function loadPendingModels() {
    for (const m of pendingModels) {
      try {
        await viewer.toggleModel(m.id, true, false);
      } catch {
        // Left in the pending list, which already tells the user it isn't loaded.
      }
    }
    refresh();
  }

  // ------------------------------------------------------------ exportar PDF

  const registerReport = useMemo(
    () =>
      charts.map((_, i) => (getReport: (() => CardReport | null) | null) => {
        reportGetters.current[i] = getReport;
      }),
    [charts.length]
  );

  function describeFilters(): string[] {
    const byKey = new Map(fields.map((f) => [f.key, f]));
    return effectiveSlicers
      .filter((s) => s.selected !== null)
      .map((s) => {
        const field = byKey.get(s.field);
        const values = (s.selected ?? []).map((key) => bucketOf(s.kind, key).label);
        return `${field ? fieldLabel(field) : s.field}: ${values.length ? values.join(", ") : "(ningún valor)"}`;
      });
  }

  async function exportPdf() {
    if (exportMode) return;
    setExportError("");
    const coloredBefore = coloring;
    setExportMode(true);
    try {
      setExportStatus("Preparando los gráficos...");
      await nextPaint();
      await wait(150);
      const cards = reportGetters.current
        .map((getReport) => getReport?.() ?? null)
        .filter((r): r is CardReport => r !== null);
      if (cards.length === 0) throw new Error("Configura al menos un gráfico con datos antes de exportar.");

      const reportCharts: ReportChart[] = [];
      for (const [i, card] of cards.entries()) {
        // "El modelo según el gráfico": paint the model like this chart, then capture it.
        setExportStatus(`Coloreando el modelo para el gráfico ${i + 1} de ${cards.length}...`);
        await enqueueColors(() => paint(card.colorGroups));
        await wait(VIEWER_REDRAW_MS);
        const snapshot = await withTimeout(viewer.getSnapshot(), SNAPSHOT_TIMEOUT_MS).catch(() => null);
        const modelImage = snapshot ? await snapshotToJpeg(snapshot).catch(() => null) : null;
        const chartImage = card.svg ? await svgToPng(card.svg).catch(() => null) : null;
        reportCharts.push({ ...card, chartImage, modelImage });
      }

      setExportStatus("Generando el PDF...");
      const blob = await buildReportPdf({
        projectName: project.name,
        generatedAt: new Date(),
        models: (activeDatasets ?? []).map((d) => `${d.modelName} (${formatNumber(d.records.length)} objetos)`),
        filters: describeFilters(),
        charts: reportCharts,
      });
      downloadBlob(blob, `informe-graficos-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "No se pudo generar el PDF.");
    } finally {
      // Leave the model as the user had it: no colors, or the colored chart's again.
      await enqueueColors(resetPainted);
      setExportStatus("");
      setExportMode(false);
      if (coloredBefore !== null) setColorVersion((v) => v + 1);
    }
  }

  const visibleFields = useMemo(() => {
    const q = normalizeForSearch(search.trim());
    if (!q) return fields;
    return fields.filter((f) => normalizeForSearch(`${f.label} ${f.group}`).includes(q));
  }, [fields, search]);

  function toggleModel(key: string) {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function loadModel(spec: ModelSpec) {
    try {
      await viewer.toggleModel(spec.id, true, false);
    } catch (err) {
      setListError(err instanceof Error ? err.message : `No se pudo cargar "${spec.name}".`);
    }
    refresh();
  }

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <header>
        <h1 style={{ color: "var(--tc-blue-900)", margin: "0 0 4px", fontSize: 20 }}>Gráficos de Modelos</h1>
        <p style={{ color: "var(--tc-gray-500)", margin: 0, fontSize: 13 }}>
          Elige uno o varios modelos cargados en el visor y arrastra sus datos a los gráficos.
        </p>
      </header>

      <Panel title="1. Modelos en el visor" action={<button type="button" onClick={() => refresh()} style={smallButtonStyle}>Actualizar</button>}>
        {listError && <div style={{ fontSize: 12.5, color: "#8a1c14", marginBottom: 8 }}>{listError}</div>}
        {models === null ? (
          <Muted>Buscando modelos cargados...</Muted>
        ) : models.length === 0 ? (
          <Muted>No hay modelos cargados en el visor. Carga un modelo y aparecerá aquí.</Muted>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {models.map((entry) => (
              <ModelRow
                key={entry.key}
                entry={entry}
                checked={selected.includes(entry.key)}
                onToggle={() => toggleModel(entry.key)}
              />
            ))}
          </ul>
        )}
        {unloaded.length > 0 && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontSize: 12.5, color: "var(--tc-gray-500)" }}>
              Otros modelos del proyecto, no cargados en el visor ({unloaded.length})
            </summary>
            <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {unloaded.map((spec) => (
                <li key={spec.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                  <span style={{ color: "var(--tc-gray-700)", wordBreak: "break-word" }}>{spec.name}</span>
                  <button type="button" onClick={() => loadModel(spec)} style={smallButtonStyle}>
                    Cargar
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Panel>

      <div style={{ position: "sticky", top: 0, zIndex: 5 }}>
        <Panel
          title="2. Datos en común"
          action={
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 6 }}>
              <button
                type="button"
                onClick={() => setSaveName((v) => (v === null ? defaultViewName() : null))}
                disabled={selectedWithData.length === 0}
                style={{ ...smallButtonStyle, opacity: selectedWithData.length === 0 ? 0.5 : 1 }}
                title="Guarda los modelos, los gráficos y los segmentadores para volver a verlos con un clic"
              >
                💾 Guardar vista
              </button>
              <button type="button" onClick={() => setViewsOpen((v) => !v)} style={viewsOpen ? smallButtonActiveStyle : smallButtonStyle}>
                🕘 Vistas guardadas ({views.length})
              </button>
              <button
                type="button"
                onClick={exportPdf}
                disabled={exportMode || !activeDatasets || fields.length <= 1}
                style={{ ...smallButtonStyle, opacity: exportMode || !activeDatasets || fields.length <= 1 ? 0.5 : 1 }}
                title="Informe con cada gráfico, el modelo coloreado según el gráfico y sus datos"
              >
                {exportMode ? "Exportando..." : "📄 Exportar PDF"}
              </button>
              {fields.length > 1 && (
                <button type="button" onClick={() => setFieldsCollapsed((v) => !v)} style={smallButtonStyle}>
                  {fieldsCollapsed ? "Mostrar datos" : "Ocultar"}
                </button>
              )}
            </div>
          }
        >
          {saveName !== null && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveView();
              }}
              style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}
            >
              <input
                autoFocus
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Nombre de la vista"
                aria-label="Nombre de la vista"
                style={{ ...searchStyle, flex: "1 1 200px", width: "auto" }}
              />
              <button type="submit" style={smallButtonActiveStyle}>
                Guardar
              </button>
              <button type="button" onClick={() => setSaveName(null)} style={smallButtonStyle}>
                Cancelar
              </button>
            </form>
          )}
          {viewsOpen && (
            <SavedViewsList views={views} activeId={activeViewId} onOpen={openView} onDelete={deleteView} />
          )}
          {viewNotice && <Notice onClose={() => setViewNotice("")}>{viewNotice}</Notice>}
          {pendingModels.length > 0 && (
            <Notice onClose={() => setPendingModels([])}>
              Esta vista usa modelos que no están cargados en el visor: {pendingModels.map((m) => m.name).join(", ")}.{" "}
              <button type="button" onClick={loadPendingModels} style={inlineLinkStyle}>
                Cargarlos
              </button>{" "}
              (se marcan solos al terminar de cargar).
            </Notice>
          )}
          {exportStatus && <Notice>{exportStatus}</Notice>}
          {exportError && <Notice tone="error" onClose={() => setExportError("")}>{exportError}</Notice>}
          {colorError && (
            <Notice tone="error" onClose={() => setColorError("")}>
              No se pudieron aplicar los colores en el visor: {colorError}
            </Notice>
          )}
          {readError && <div style={{ fontSize: 12.5, color: "#8a1c14", marginBottom: 8 }}>{readError}</div>}
          {selectedWithData.length === 0 ? (
            <Muted>Selecciona uno o varios modelos con datos para ver los datos que tienen en común.</Muted>
          ) : !activeDatasets ? (
            <ReadingProgress reading={reading} />
          ) : fields.length <= 1 ? (
            <Muted>Los modelos seleccionados no comparten ningún dato. Prueba con otra combinación.</Muted>
          ) : fieldsCollapsed ? (
            <Muted>{fields.length} datos disponibles. Pulsa “Mostrar datos” para arrastrarlos.</Muted>
          ) : (
            <>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Buscar entre ${fields.length} datos...`}
                style={searchStyle}
              />
              <div style={{ fontSize: 11.5, color: "var(--tc-gray-500)", margin: "6px 0" }}>
                Arrastra un dato a un gráfico o a los segmentadores: texto (<b>Aa</b>) y fechas (<b>📅</b>, por mes)
                forman categorías; los numéricos (<b>#</b>) se suman.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 104, overflowY: "auto", paddingBottom: 2 }}>
                {visibleFields.map((field) => (
                  <FieldChip key={field.key} field={field} />
                ))}
                {visibleFields.length === 0 && <Muted>Ningún dato coincide con la búsqueda.</Muted>}
              </div>
            </>
          )}
        </Panel>
      </div>

      {activeDatasets && fields.length > 1 && (
        <Slicers
          fields={fields}
          datasets={activeDatasets}
          slicers={effectiveSlicers}
          onChange={setSlicers}
          shownObjects={countObjects(filteredDatasets)}
          totalObjects={countObjects(activeDatasets)}
        />
      )}

      {selectionError && (
        <div style={{ fontSize: 12.5, color: "#8a1c14" }}>No se pudo seleccionar en el visor: {selectionError}</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
        {charts.map((spec, i) => (
          <ChartCard
            key={i}
            spec={spec}
            fields={fields}
            datasets={filteredDatasets}
            onChange={(update) => setCharts((prev) => prev.map((s, j) => (j === i ? update(s) : s)))}
            selection={liveSelection?.chart === i ? { key: liveSelection.key, count: liveSelection.count } : null}
            onSelectObjects={(key, members) => selectInViewer(i, key, members)}
            onClearSelection={clearViewerSelection}
            colored={coloring === i}
            onToggleColors={() => toggleColoring(i)}
            onApplyColors={applyColors}
            colorVersion={colorVersion}
            exportMode={exportMode}
            registerReport={registerReport[i]}
          />
        ))}
      </div>
    </div>
  );
}

function SavedViewsList({
  views,
  activeId,
  onOpen,
  onDelete,
}: {
  views: SavedView[];
  activeId: string | null;
  onOpen: (view: SavedView) => void;
  onDelete: (id: string) => void;
}) {
  if (views.length === 0) {
    return (
      <div style={{ ...noticeBoxStyle, marginBottom: 10 }}>
        Aún no hay vistas guardadas. Configura los gráficos y pulsa “💾 Guardar vista”.
      </div>
    );
  }
  return (
    <ul
      style={{
        listStyle: "none",
        margin: "0 0 10px",
        padding: 0,
        maxHeight: 220,
        overflowY: "auto",
        border: "1px solid var(--tc-gray-100)",
        borderRadius: 8,
      }}
    >
      {views.map((view) => {
        const configured = view.charts.filter((c) => c.category).length;
        return (
          <li
            key={view.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderBottom: "1px solid var(--tc-gray-100)",
              background: view.id === activeId ? "var(--tc-blue-50)" : undefined,
            }}
          >
            <button type="button" onClick={() => onOpen(view)} style={viewButtonStyle} title="Abrir esta vista">
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--tc-blue-800)", wordBreak: "break-word" }}>
                {view.id === activeId ? "▸ " : ""}
                {view.name}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--tc-gray-500)" }}>
                {new Date(view.savedAt).toLocaleString("es", { dateStyle: "short", timeStyle: "short" })} ·{" "}
                {configured} gráfico{configured === 1 ? "" : "s"} · {view.models.map((m) => m.name).join(", ") || "sin modelos"}
                {view.slicers.some((s) => s.selected !== null) ? " · con filtros" : ""}
              </span>
            </button>
            <button type="button" onClick={() => onOpen(view)} style={smallButtonStyle}>
              Abrir
            </button>
            <button
              type="button"
              onClick={() => onDelete(view.id)}
              style={deleteButtonStyle}
              aria-label={`Eliminar la vista ${view.name}`}
              title="Eliminar del historial"
            >
              ✕
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Notice({
  children,
  tone = "info",
  onClose,
}: {
  children: React.ReactNode;
  tone?: "info" | "error";
  onClose?: () => void;
}) {
  return (
    <div
      style={{
        ...noticeBoxStyle,
        ...(tone === "error" ? { background: "#fdecea", color: "#8a1c14", border: "1px solid #e5a29c" } : {}),
        marginBottom: 8,
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <span>{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} style={{ ...deleteButtonStyle, background: "transparent" }} aria-label="Cerrar aviso">
          ✕
        </button>
      )}
    </div>
  );
}

function ModelRow({
  entry,
  checked,
  onToggle,
}: {
  entry: ModelEntry;
  checked: boolean;
  onToggle: () => void;
}) {
  const selectable = entry.status === "data";
  const badge =
    entry.status === "checking"
      ? { text: "Revisando...", tone: "neutral" as const }
      : entry.status === "data"
        ? { text: `Con datos · ${formatNumber(entry.objectCount)} objetos`, tone: "good" as const }
        : entry.status === "empty"
          ? { text: "Sin datos", tone: "neutral" as const }
          : { text: "No se pudo leer", tone: "bad" as const };

  return (
    <li>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          borderRadius: 8,
          border: `1px solid ${checked ? "var(--tc-blue-500)" : "var(--tc-gray-100)"}`,
          background: checked ? "var(--tc-blue-50)" : "var(--tc-white)",
          cursor: selectable ? "pointer" : "default",
          opacity: selectable ? 1 : 0.65,
        }}
      >
        <input type="checkbox" checked={checked} disabled={!selectable} onChange={onToggle} />
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--tc-gray-700)", wordBreak: "break-word" }}>
          {entry.spec.name}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: "nowrap",
            borderRadius: 999,
            padding: "2px 8px",
            background: badge.tone === "good" ? "#e6f4ea" : badge.tone === "bad" ? "#fdecea" : "var(--tc-gray-100)",
            color: badge.tone === "good" ? "#006300" : badge.tone === "bad" ? "#8a1c14" : "var(--tc-gray-500)",
          }}
        >
          {badge.tone === "good" ? "✓ " : ""}
          {badge.text}
        </span>
      </label>
    </li>
  );
}

function FieldChip({ field }: { field: CommonField }) {
  const numeric = field.kind === "number";
  return (
    <span
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(FIELD_DRAG_TYPE, field.key);
        e.dataTransfer.setData("text/plain", fieldLabel(field));
        e.dataTransfer.effectAllowed = "copy";
      }}
      title={`${field.group === GENERAL_GROUP ? "Dato general" : field.group} · ${formatNumber(field.objectCount)} objetos`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 10px",
        borderRadius: 999,
        border: `1px solid ${numeric ? "var(--tc-blue-500)" : "var(--tc-gray-300)"}`,
        background: numeric ? "var(--tc-blue-100)" : "var(--tc-white)",
        color: "var(--tc-gray-700)",
        fontSize: 12.5,
        cursor: "grab",
        userSelect: "none",
        maxWidth: "100%",
      }}
    >
      <span style={{ fontSize: 10.5, fontWeight: 700, color: numeric ? "var(--tc-blue-700)" : "var(--tc-gray-500)" }}>
        {kindMark(field)}
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fieldLabel(field)}</span>
    </span>
  );
}

function ReadingProgress({ reading }: { reading: ReadingState | null }) {
  const pct = reading && reading.total > 0 ? Math.round((reading.done / reading.total) * 100) : 0;
  return (
    <div>
      <div style={{ fontSize: 12.5, color: "var(--tc-gray-700)", marginBottom: 6 }}>
        {reading
          ? `Leyendo propiedades de "${reading.modelName}"... ${formatNumber(reading.done)} de ${formatNumber(reading.total)} objetos`
          : "Preparando la lectura de propiedades..."}
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "var(--tc-gray-100)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--tc-blue-500)", transition: "width 200ms" }} />
      </div>
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "var(--tc-white)",
        borderRadius: "var(--tc-radius)",
        boxShadow: "var(--tc-shadow)",
        padding: 14,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 14, color: "var(--tc-blue-800)" }}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>{children}</div>;
}

const smallButtonStyle: React.CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  background: "var(--tc-white)",
  color: "var(--tc-blue-700)",
  borderRadius: 6,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const smallButtonActiveStyle: React.CSSProperties = {
  ...smallButtonStyle,
  background: "var(--tc-blue-600)",
  color: "var(--tc-white)",
  border: "1px solid var(--tc-blue-700)",
};

const noticeBoxStyle: React.CSSProperties = {
  background: "var(--tc-blue-100)",
  border: "1px solid var(--tc-blue-500)",
  color: "var(--tc-blue-900)",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 12.5,
};

const inlineLinkStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 0,
  color: "var(--tc-blue-700)",
  fontWeight: 700,
  textDecoration: "underline",
  cursor: "pointer",
  fontSize: "inherit",
};

const viewButtonStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 2,
  border: "none",
  background: "transparent",
  padding: 0,
  textAlign: "left",
  cursor: "pointer",
  fontFamily: "inherit",
};

const deleteButtonStyle: React.CSSProperties = {
  border: "none",
  background: "var(--tc-gray-100)",
  borderRadius: 6,
  width: 24,
  height: 24,
  cursor: "pointer",
  color: "var(--tc-gray-700)",
  fontSize: 11,
  flexShrink: 0,
};

const searchStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 13,
  color: "var(--tc-gray-700)",
  fontFamily: "inherit",
};
