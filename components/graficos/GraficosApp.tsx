"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelSpec } from "trimble-connect-workspace-api";
import {
  buildDataset,
  ChartSpec,
  CommonField,
  commonFields,
  formatNumber,
  GENERAL_GROUP,
  ModelDataset,
} from "../../lib/graficos/modelData";
import {
  listModelObjects,
  ModelObjectList,
  modelHasData,
  readAllProperties,
  ViewerLike,
} from "../../lib/graficos/viewerReader";
import { normalizeForSearch } from "../../lib/folderTree";
import ChartCard, { ChartKind, FIELD_DRAG_TYPE, fieldLabel } from "./ChartCard";
import type { ViewerEventListener } from "./ViewerShell";

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

const CHARTS: { title: string; kind: ChartKind }[] = [
  { title: "Barras verticales", kind: "column" },
  { title: "Barras horizontales", kind: "horizontal" },
  { title: "Circular", kind: "donut" },
];

const EMPTY_SPEC: ChartSpec = { category: null, value: null };

// A model can be reloaded in the viewer as another version; the data only
// stays valid for the exact version it was read from.
function modelKey(spec: ModelSpec): string {
  return `${spec.id}:${spec.versionId ?? ""}`;
}

export default function GraficosApp({
  viewer,
  subscribe,
}: {
  viewer: ViewerLike;
  subscribe: (listener: ViewerEventListener) => () => void;
}) {
  const [models, setModels] = useState<ModelEntry[] | null>(null);
  const [unloaded, setUnloaded] = useState<ModelSpec[]>([]);
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [datasets, setDatasets] = useState<Record<string, ModelDataset>>({});
  const [reading, setReading] = useState<ReadingState | null>(null);
  const [readError, setReadError] = useState("");
  const [charts, setCharts] = useState<ChartSpec[]>(() => CHARTS.map(() => EMPTY_SPEC));
  const [search, setSearch] = useState("");

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
        <Panel title="2. Datos en común">
          {readError && <div style={{ fontSize: 12.5, color: "#8a1c14", marginBottom: 8 }}>{readError}</div>}
          {selectedWithData.length === 0 ? (
            <Muted>Selecciona uno o varios modelos con datos para ver los datos que tienen en común.</Muted>
          ) : !activeDatasets ? (
            <ReadingProgress reading={reading} />
          ) : fields.length <= 1 ? (
            <Muted>Los modelos seleccionados no comparten ningún dato. Prueba con otra combinación.</Muted>
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
                Arrastra un dato a un gráfico: los de texto (<b>Aa</b>) forman las categorías y los numéricos (<b>#</b>)
                se suman.
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 150, overflowY: "auto", paddingBottom: 2 }}>
                {visibleFields.map((field) => (
                  <FieldChip key={field.key} field={field} />
                ))}
                {visibleFields.length === 0 && <Muted>Ningún dato coincide con la búsqueda.</Muted>}
              </div>
            </>
          )}
        </Panel>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
        {CHARTS.map((chart, i) => (
          <ChartCard
            key={chart.kind}
            title={chart.title}
            kind={chart.kind}
            spec={charts[i]}
            fields={fields}
            datasets={activeDatasets}
            onChange={(update) => setCharts((prev) => prev.map((s, j) => (j === i ? update(s) : s)))}
          />
        ))}
      </div>
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
        {numeric ? "#" : "Aa"}
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

const searchStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 13,
  color: "var(--tc-gray-700)",
  fontFamily: "inherit",
};
