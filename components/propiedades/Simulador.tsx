"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColorGroup } from "../../lib/graficos/colors";
import { applySlicers, mergeMembers, Members, SlicerSpec } from "../../lib/graficos/modelData";
import { selectorFor } from "../../lib/graficos/viewerReader";
import { availableFields, GroupField } from "../../lib/propiedades/grouping";
import type { PropiedadesViewer } from "../../lib/propiedades/selection";
import {
  buildTimeline,
  countUpTo,
  datedDatasets,
  dayNumber,
  excludedMembers,
  isoFromDay,
  membersOf,
  progressCurve,
  progressPercent,
  shownDatasets,
  today,
} from "../../lib/propiedades/simulation";
import { isoToDisplay } from "../../lib/propiedades/values";
import { noticeBase, noticeStyles, primaryButtonStyle, secondaryButtonStyle } from "../validacion/ui";
import ModelosCard from "./ModelosCard";
import SimChartCard, { SimChartSpec } from "./SimChartCard";
import SimSlicers from "./SimSlicers";
import type { ModelData } from "./useModelData";

/** Viewer updates per second while playing. */
const TICK_MS = 200;
const DURATIONS = [
  { seconds: 15, label: "15 segundos" },
  { seconds: 30, label: "30 segundos" },
  { seconds: 60, label: "1 minuto" },
  { seconds: 120, label: "2 minutos" },
];
/** Elements that appear in the current step (dataviz orange: stands out on gray models). */
const HIGHLIGHT = "#eb6834";
/** Elements without the date, when shown as context. */
const GHOST = "#d7dee6";

type UndatedMode = "gris" | "ocultar" | "igual";

const DEFAULT_CHARTS: SimChartSpec[] = [
  { type: "column", category: null, value: null },
  { type: "horizontal", category: null, value: null },
  { type: "donut", category: null, value: null },
];

function readSlicers(key: string): SlicerSpec[] {
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (Array.isArray(stored)) return stored as SlicerSpec[];
  } catch {
    // storage unavailable or not ours
  }
  return [];
}

function readCharts(key: string): SimChartSpec[] {
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (Array.isArray(stored) && stored.length === DEFAULT_CHARTS.length) return stored as SimChartSpec[];
  } catch {
    // storage unavailable or not ours
  }
  return DEFAULT_CHARTS;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Ocurrió un error.";
}

function fieldName(f: GroupField): string {
  return f.fromApp ? `${f.label} (atributo del proyecto · ${f.group})` : `${f.label} (${f.group})`;
}

function percentText(value: number): string {
  return `${value.toLocaleString("es", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
}

/**
 * "Simulador": builds a timeline from a date of the elements (a native date
 * property of the models or a date attribute of this app) and, as it plays,
 * shows in the 3D viewer the elements whose date has been reached. The
 * progress is the share of the elements with that date already shown.
 */
export default function Simulador({
  active,
  viewer,
  data,
  projectId,
}: {
  /** Whether the tab is visible: playback pauses when it isn't. */
  active: boolean;
  viewer: PropiedadesViewer;
  data: ModelData;
  projectId: string;
}) {
  const { merged, allRead, reading } = data;
  const storageKey = `propiedades.simulador.${projectId}`;

  const [fieldKey, setFieldKey] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });
  const [durationSec, setDurationSec] = useState(30);
  const [undatedMode, setUndatedMode] = useState<UndatedMode>("gris");
  const [highlight, setHighlight] = useState(true);
  /** Days since the first date (fractional while playing). */
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [error, setError] = useState("");
  /** What takes part in the simulation ("segmentadores" of the whole simulator). */
  const slicersKey = `propiedades.simulador.segmentadores.${projectId}`;
  const [simSlicers, setSimSlicers] = useState<SlicerSpec[]>(() => readSlicers(slicersKey));
  const chartsKey = `propiedades.simulador.graficos.${projectId}`;
  const [charts, setCharts] = useState<SimChartSpec[]>(() => readCharts(chartsKey));
  const [chartNote, setChartNote] = useState("");
  /** The chart painting the model ("Colorear"), and its colors. */
  const [coloredChart, setColoredChart] = useState<number | null>(null);
  const [colorGroups, setColorGroups] = useState<ColorGroup[] | null>(null);

  // ------------------------------------------------------------ timeline

  const allFields = useMemo(() => availableFields(merged), [merged]);
  const dateFields = useMemo(() => allFields.filter((f) => f.kind === "date"), [allFields]);
  const field = dateFields.find((f) => f.key === fieldKey) ?? null;

  // Pick the first date available (the project's attributes come first) when none is chosen.
  useEffect(() => {
    if (allRead && !reading && dateFields.length && !dateFields.some((f) => f.key === fieldKey)) setFieldKey(dateFields[0].key);
  }, [allRead, reading, dateFields, fieldKey]);

  useEffect(() => {
    try {
      if (fieldKey) sessionStorage.setItem(storageKey, fieldKey);
    } catch {
      // storage unavailable
    }
  }, [storageKey, fieldKey]);

  const fromApp = !!field?.fromApp;
  const { wantAppValues } = data;
  useEffect(() => {
    if (fromApp) wantAppValues();
  }, [fromApp, wantAppValues]);

  // Only the elements that pass the simulator's slicers take part; the rest are context, like the undated ones.
  const filtering = simSlicers.some((s) => s.selected !== null);
  const passing = useMemo(() => applySlicers(merged, simSlicers), [merged, simSlicers]);
  const excluded = useMemo(
    () => (filtering ? excludedMembers(merged, passing) : { members: {}, count: 0 }),
    [filtering, merged, passing]
  );
  const timeline = useMemo(() => (field ? buildTimeline(passing, field.key) : null), [passing, field]);
  /** Elements that don't take part: without the date, or left out by the slicers. */
  const context = useMemo(
    () =>
      timeline
        ? { members: mergeMembers([timeline.undated, excluded.members]), count: timeline.undatedCount + excluded.count }
        : { members: {}, count: 0 },
    [timeline, excluded]
  );
  const datedTotal = useMemo(
    () =>
      field && filtering
        ? merged.reduce((n, d) => n + d.records.filter((r) => dayNumber(r.values[field.key]) !== null).length, 0)
        : 0,
    [field, filtering, merged]
  );

  useEffect(() => {
    try {
      sessionStorage.setItem(slicersKey, JSON.stringify(simSlicers));
    } catch {
      // storage unavailable
    }
  }, [slicersKey, simSlicers]);
  const items = useMemo(() => timeline?.items ?? [], [timeline]);
  const start = timeline?.start ?? null;
  const end = timeline?.end ?? null;
  const span = start !== null && end !== null ? end - start : 0;
  const day = start !== null ? start + Math.min(span, Math.floor(position)) : null;
  const shown = day !== null ? countUpTo(items, day) : 0;
  const percent = progressPercent(shown, items.length);
  const curve = useMemo(() => (start !== null && end !== null ? progressCurve(items, start, end, 80) : []), [items, start, end]);
  const todayOffset = start !== null && end !== null && today() >= start && today() <= end ? today() - start : null;

  // ------------------------------------------------------------ charts

  // The charts use the elements with the date; at each moment, only those already shown.
  const dated = useMemo(() => (field ? datedDatasets(passing, field.key) : []), [passing, field]);
  const fullDated = useMemo(() => dated.map((d) => d.dataset), [dated]);
  const cutoff = shown > 0 ? items[shown - 1].day : null;
  const shownData = useMemo(() => shownDatasets(dated, cutoff), [dated, cutoff]);
  const chartsUseApp = charts.some((c) => [c.category, c.value].some((k) => k?.startsWith("prop:")));

  useEffect(() => {
    if (chartsUseApp) wantAppValues();
  }, [chartsUseApp, wantAppValues]);

  useEffect(() => {
    try {
      sessionStorage.setItem(chartsKey, JSON.stringify(charts));
    } catch {
      // storage unavailable
    }
  }, [chartsKey, charts]);

  // ------------------------------------------------------------ viewer

  // The viewer is driven from refs, so a running update always uses the current data.
  const state = useRef({
    items,
    viewerModelIds: data.viewerModelIds,
    highlight,
    /** Elements shown so far (null: the viewer isn't prepared). */
    applied: null as number | null,
    target: 0,
    running: false,
    highlighted: null as Members | null,
    /** What was changed in the viewer, to restore it. */
    touched: [] as Members[],
    /** "Colorear": element -> color of its category in the colored chart (null: off). */
    colorMap: null as Map<string, Map<number, string>> | null,
    /** The colors changed: paint the elements already shown again. */
    repaint: false,
  });
  state.current.items = items;
  state.current.viewerModelIds = data.viewerModelIds;
  state.current.highlight = highlight;

  const sel = useCallback((members: Members) => selectorFor(members, state.current.viewerModelIds), []);

  /**
   * Paints elements [from, to) of the timeline with their category's color
   * ("Colorear"); with `resetOthers`, the ones without a color go back to theirs.
   */
  const paint = useCallback(
    async (from: number, to: number, resetOthers: boolean) => {
      const s = state.current;
      const byColor = new Map<string | null, Members>();
      for (let i = from; i < to; i++) {
        const item = s.items[i];
        const color = s.colorMap?.get(item.model)?.get(item.runtimeId) ?? null;
        if (color === null && !resetOthers) continue;
        const members = byColor.get(color) ?? {};
        (members[item.model] ??= []).push(item.runtimeId);
        byColor.set(color, members);
      }
      for (const [color, members] of byColor) await viewer.setObjectState(sel(members), { color: color ?? "reset" });
    },
    [viewer, sel]
  );

  /** Brings the viewer to `target` elements shown, a step at a time, never two updates at once. */
  const pump = useCallback(async () => {
    const s = state.current;
    if (s.running) return;
    s.running = true;
    try {
      while (s.applied !== null && (s.applied !== s.target || s.repaint)) {
        if (s.repaint) {
          // The colors changed (Colorear on, off or another chart): repaint what is shown.
          s.repaint = false;
          s.highlighted = null;
          await paint(0, s.applied, true);
          continue;
        }
        const from = s.applied;
        const to = s.target;
        if (to > from) {
          const batch = membersOf(s.items, from, to);
          if (s.colorMap) {
            // Each element appears in its category's color.
            await viewer.setObjectState(sel(batch), { visible: true });
            await paint(from, to, false);
            s.highlighted = null;
          } else {
            if (s.highlighted) await viewer.setObjectState(sel(s.highlighted), { color: "reset" });
            await viewer.setObjectState(sel(batch), s.highlight ? { visible: true, color: HIGHLIGHT } : { visible: true });
            s.highlighted = s.highlight ? batch : null;
          }
        } else {
          await viewer.setObjectState(sel(membersOf(s.items, to, from)), { visible: false, color: "reset" });
          s.highlighted = null;
        }
        if (s.applied === null) break; // restored meanwhile
        s.applied = to;
      }
    } catch (err) {
      setError(`El visor no aceptó el cambio: ${message(err)}`);
      setPlaying(false);
    } finally {
      s.running = false;
    }
  }, [viewer, sel, paint]);

  /** Hides every element with the date and sets how the rest look; then the timeline shows them. */
  const prepare = useCallback(async () => {
    if (!timeline || items.length === 0) return false;
    const s = state.current;
    setError("");
    try {
      const all = membersOf(items, 0, items.length);
      await viewer.setObjectState(sel(all), { visible: false });
      s.touched = [all];
      if (context.count > 0 && undatedMode !== "igual") {
        await viewer.setObjectState(sel(context.members), undatedMode === "gris" ? { color: GHOST } : { visible: false });
        s.touched.push(context.members);
      }
      s.applied = 0;
      s.highlighted = null;
      setPrepared(true);
      pump();
      return true;
    } catch (err) {
      setError(`No se pudo preparar la simulación en el visor: ${message(err)}`);
      return false;
    }
  }, [timeline, items, context, undatedMode, viewer, sel, pump]);

  /** Puts back the visibility and colors the simulation changed. */
  const restore = useCallback(async () => {
    const s = state.current;
    setPlaying(false);
    const touched = s.touched;
    s.applied = null;
    s.highlighted = null;
    s.touched = [];
    s.colorMap = null;
    s.repaint = false;
    setPrepared(false);
    setColoredChart(null);
    setColorGroups(null);
    for (const members of touched) {
      await viewer.setObjectState(sel(members), { visible: "reset", color: "reset" }).catch(() => undefined);
    }
  }, [viewer, sel]);

  // The viewer follows the timeline position.
  useEffect(() => {
    state.current.target = shown;
    if (prepared) pump();
  }, [shown, prepared, pump]);

  // A different date, models or option makes a different simulation: start it over.
  const restoreRef = useRef(restore);
  restoreRef.current = restore;
  useEffect(() => {
    if (state.current.applied !== null) restoreRef.current();
    setPosition(0);
  }, [timeline, undatedMode]);

  // Leaving the tab pauses; closing the panel restores the model.
  useEffect(() => {
    if (!active) setPlaying(false);
  }, [active]);
  useEffect(() => () => void restoreRef.current(), []);

  // Playback: the whole timeline in `durationSec`.
  useEffect(() => {
    if (!playing) return;
    const step = span / ((durationSec * 1000) / TICK_MS);
    const id = setInterval(() => {
      setPosition((p) => {
        const next = Math.min(span, p + step);
        if (next >= span) setPlaying(false);
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, span, durationSec]);

  async function play() {
    if (!prepared && !(await prepare())) return;
    if (position >= span) setPosition(0);
    setPlaying(true);
  }

  // "Colorear": the colored chart's categories become a color per element, and the
  // model is painted again (entering the simulation if it wasn't running).
  const prepareRef = useRef(prepare);
  prepareRef.current = prepare;
  useEffect(() => {
    const s = state.current;
    if (coloredChart === null || !colorGroups) {
      if (s.colorMap) {
        s.colorMap = null;
        s.repaint = true;
        pump();
      }
      return;
    }
    const map = new Map<string, Map<number, string>>();
    for (const group of colorGroups) {
      for (const [model, ids] of Object.entries(group.members)) {
        const perModel = map.get(model) ?? new Map<number, string>();
        for (const id of ids) perModel.set(id, group.color);
        map.set(model, perModel);
      }
    }
    s.colorMap = map;
    s.repaint = true;
    if (s.applied !== null) pump();
    else prepareRef.current();
  }, [coloredChart, colorGroups, pump]);

  const receiveColorGroups = useCallback((groups: ColorGroup[]) => setColorGroups(groups), []);

  function toggleColors(index: number) {
    setColorGroups(null);
    setColoredChart((current) => (current === index ? null : index));
  }

  async function selectFromChart(members: Members, label: string, objects: number) {
    try {
      await viewer.setSelection(selectorFor(members, data.viewerModelIds), "set");
      setChartNote(`${objects.toLocaleString("es")} ${objects === 1 ? "elemento seleccionado" : "elementos seleccionados"} en el modelo: ${label}.`);
    } catch (err) {
      setChartNote(`No se pudo seleccionar en el visor: ${message(err)}`);
    }
  }

  async function jump(to: number) {
    setPlaying(false);
    setPosition(Math.max(0, Math.min(span, to)));
    if (!prepared) await prepare();
  }

  // ------------------------------------------------------------ render

  const curvePath = curve.map((v, i) => `${i === 0 ? "M" : "L"}${((i / (curve.length - 1)) * 100).toFixed(2)},${(39 - (v / 100) * 37).toFixed(2)}`).join(" ");
  const cursorX = span > 0 ? (Math.min(span, position) / span) * 100 : 100;

  return (
    <div style={pageStyle}>
      <header>
        <h2 style={titleStyle}>Simulador</h2>
        <p style={subtitleStyle}>
          Reproduce en el visor 3D la aparición de los elementos según una fecha: del modelo o un atributo del proyecto.
        </p>
      </header>

      {error && <div style={{ ...noticeBase, ...noticeStyles.error }}>{error}</div>}

      <ModelosCard data={data} emptyText="Carga un modelo en el visor para simular sus elementos." />

      <section style={cardStyle}>
        <label htmlFor="sim-field" style={sectionTitleStyle}>
          Fecha a simular
        </label>
        {dateFields.length === 0 ? (
          <span style={mutedStyle}>
            {reading || !allRead
              ? "Leyendo las propiedades de los modelos..."
              : "Los modelos marcados no tienen propiedades de fecha. Crea un atributo de tipo Fecha en el catálogo de Propiedades y asígnalo a los elementos."}
          </span>
        ) : (
          <select id="sim-field" value={field?.key ?? ""} onChange={(e) => setFieldKey(e.target.value)} style={inputStyle}>
            {dateFields.map((f) => (
              <option key={f.key} value={f.key}>
                {fieldName(f)} · {f.objectCount.toLocaleString("es")} elementos
              </option>
            ))}
          </select>
        )}
        {dateFields.length > 0 && (
          <SimSlicers
            title="Segmentadores: qué simular"
            emptyHint="Elige qué elementos entran en la simulación por un dato de texto o fecha, p. ej. solo ciertos tipos, niveles o fases. Los demás quedan como contexto."
            fields={allFields}
            datasets={merged}
            slicers={simSlicers}
            onChange={setSimSlicers}
          />
        )}
        {filtering && field && (
          <span style={{ fontSize: 12, color: "var(--tc-blue-900)" }}>
            Se simulan {items.length.toLocaleString("es")} de {datedTotal.toLocaleString("es")} elementos con &quot;{field.label}&quot;.
          </span>
        )}
        {data.propNote && <span style={hintStyle}>{data.propNote}</span>}
        {data.guidBusy && fromApp && <span style={hintStyle}>{data.guidBusy}</span>}
      </section>

      {field && timeline && start !== null && end !== null && day !== null && (
        <section style={cardStyle} aria-label="Línea de tiempo">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={labelStyle}>Fecha</div>
              <div style={bigStyle}>{isoToDisplay(isoFromDay(day))}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={labelStyle}>Avance</div>
              <div style={{ ...bigStyle, color: "var(--tc-blue-700)" }} aria-live="polite">
                {percentText(percent)}
              </div>
            </div>
          </div>
          <div style={barTrackStyle} role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-label="Avance">
            <div style={{ ...barFillStyle, width: `${percent}%` }} />
          </div>
          <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>
            {shown.toLocaleString("es")} de {items.length.toLocaleString("es")} elementos con &quot;{field.label}&quot;
          </div>

          <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ width: "100%", height: 70, display: "block" }} role="img" aria-label="Curva de avance acumulado">
            <defs>
              <clipPath id="sim-past">
                <rect x="0" y="0" width={cursorX} height="40" />
              </clipPath>
            </defs>
            <path d={`${curvePath} L100,39 L0,39 Z`} fill="var(--tc-blue-100)" />
            <path d={`${curvePath} L100,39 L0,39 Z`} fill="#9cc9ef" clipPath="url(#sim-past)" />
            <path d={curvePath} fill="none" stroke="var(--tc-blue-600)" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
            <line x1={cursorX} x2={cursorX} y1="0" y2="40" stroke={HIGHLIGHT} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </svg>

          <input
            type="range"
            min={0}
            max={span}
            step={1}
            value={Math.min(span, Math.floor(position))}
            onChange={(e) => jump(Number(e.target.value))}
            aria-label="Fecha de la simulación"
            style={{ width: "100%", accentColor: "var(--tc-blue-600)" }}
            disabled={span === 0}
          />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--tc-gray-500)" }}>
            <span>Inicio {isoToDisplay(isoFromDay(start))}</span>
            <span>{span.toLocaleString("es")} días</span>
            <span>Fin {isoToDisplay(isoFromDay(end))}</span>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" onClick={() => jump(0)} style={controlStyle} aria-label="Ir al inicio" title="Ir al inicio">
              ⏮
            </button>
            {playing ? (
              <button type="button" onClick={() => setPlaying(false)} style={{ ...primaryButtonStyle, minWidth: 110 }}>
                ⏸ Pausar
              </button>
            ) : (
              <button type="button" onClick={play} style={{ ...primaryButtonStyle, minWidth: 110 }} disabled={items.length === 0}>
                ▶ {position >= span && prepared ? "Repetir" : "Reproducir"}
              </button>
            )}
            <button type="button" onClick={() => jump(span)} style={controlStyle} aria-label="Ir al final" title="Ir al final">
              ⏭
            </button>
            {todayOffset !== null && (
              <button type="button" onClick={() => jump(todayOffset)} style={secondaryButtonStyle} title="Ir a la fecha de hoy">
                Hoy
              </button>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--tc-gray-700)", marginLeft: "auto" }}>
              Duración
              <select value={durationSec} onChange={(e) => setDurationSec(Number(e.target.value))} style={{ ...inputStyle, width: "auto" }}>
                {DURATIONS.map((d) => (
                  <option key={d.seconds} value={d.seconds}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      )}

      {field && timeline && items.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }} aria-label="Gráficos del avance">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <h3 style={sectionTitleStyle}>Gráficos del avance</h3>
            <span style={hintStyle}>Muestran solo los elementos que ya aparecieron.</span>
          </div>
          {chartNote && (
            <div style={{ ...noticeBase, ...noticeStyles.info }} role="status">
              {chartNote}
            </div>
          )}
          <div style={chartsGridStyle}>
            {charts.map((spec, i) => (
              <SimChartCard
                key={i}
                spec={spec}
                onChange={(next) => setCharts((prev) => prev.map((c, j) => (j === i ? next : c)))}
                fields={allFields}
                full={fullDated}
                shown={shownData}
                animate={!playing}
                onSelect={selectFromChart}
                colored={coloredChart === i}
                onToggleColors={() => toggleColors(i)}
                onColorGroups={receiveColorGroups}
              />
            ))}
          </div>
        </section>
      )}

      {field && timeline && (
        <section style={cardStyle}>
          <h3 style={sectionTitleStyle}>Opciones</h3>
          <fieldset style={{ border: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <legend style={{ fontSize: 12.5, color: "var(--tc-gray-700)", marginBottom: 4 }}>
              Elementos que no entran en la simulación ({context.count.toLocaleString("es")}): sin &quot;{field.label}&quot;
              {excluded.count > 0 ? " o fuera de los segmentadores" : ""}
            </legend>
            {(
              [
                ["gris", "Mostrarlos en gris, como contexto"],
                ["ocultar", "Ocultarlos"],
                ["igual", "Dejarlos como están"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} style={radioStyle}>
                <input type="radio" name="sim-undated" checked={undatedMode === value} onChange={() => setUndatedMode(value)} />
                {label}
              </label>
            ))}
          </fieldset>
          <label style={{ ...radioStyle, opacity: coloredChart !== null ? 0.55 : 1 }}>
            <input
              type="checkbox"
              checked={highlight && coloredChart === null}
              disabled={coloredChart !== null}
              onChange={(e) => setHighlight(e.target.checked)}
            />
            Resaltar en naranja lo que aparece en cada paso
          </label>
          {coloredChart !== null && (
            <span style={hintStyle}>Mientras un gráfico colorea el modelo, cada elemento aparece con el color de su categoría.</span>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" onClick={restore} disabled={!prepared} style={{ ...secondaryButtonStyle, opacity: prepared ? 1 : 0.55 }}>
              Restablecer modelo
            </button>
            <span style={hintStyle}>Vuelve a mostrar todo con sus colores originales.</span>
          </div>
        </section>
      )}
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
const sectionTitleStyle: React.CSSProperties = { margin: 0, fontSize: 14, fontWeight: 700, color: "var(--tc-blue-800)" };
const mutedStyle: React.CSSProperties = { fontSize: 12.5, color: "var(--tc-gray-500)" };
const hintStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--tc-gray-500)" };
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "var(--tc-gray-500)" };
const bigStyle: React.CSSProperties = { fontSize: 24, fontWeight: 700, color: "var(--tc-blue-900)", fontVariantNumeric: "tabular-nums", lineHeight: 1.15 };
const barTrackStyle: React.CSSProperties = { height: 10, borderRadius: 999, background: "var(--tc-gray-100)", overflow: "hidden" };
const barFillStyle: React.CSSProperties = { height: "100%", borderRadius: 999, background: "var(--tc-blue-600)", transition: `width ${TICK_MS}ms linear` };
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
const controlStyle: React.CSSProperties = { ...secondaryButtonStyle, padding: "6px 10px", fontSize: 14, lineHeight: 1 };
const chartsGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 };
const radioStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--tc-gray-700)", cursor: "pointer" };
