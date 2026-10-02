"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelSpec } from "trimble-connect-workspace-api";
import { buildDataset, ModelDataset } from "../../lib/graficos/modelData";
import { mergePropiedades, PropiedadesData } from "../../lib/graficos/propiedades";
import { fetchPropiedades, PropiedadesUnavailableError } from "../../lib/graficos/propiedadesClient";
import {
  listModelObjects,
  ModelObjectList,
  readAllProperties,
  readObjectGuids,
  ViewerLike,
} from "../../lib/graficos/viewerReader";
import type { PropiedadesViewer } from "../../lib/propiedades/selection";
import type { ViewerEventListener } from "./PropiedadesShell";

export interface ModelEntry {
  key: string;
  spec: ModelSpec;
  status: "listing" | "ready" | "empty" | "error";
  list?: ModelObjectList;
}

/** The loaded models' data, read once and shared by the panel's tools (grouping, simulator). */
export interface ModelData {
  models: ModelEntry[] | null;
  checked: string[];
  setChecked: (update: (prev: string[]) => string[]) => void;
  /** Checked models already read, with the project's attributes merged in (as "prop:" fields). */
  merged: ModelDataset[];
  /** Elements read per model (dataset key). */
  sizes: Record<string, number>;
  /** Whether every checked model has been read. */
  allRead: boolean;
  reading: { name: string; done: number; total: number } | null;
  readError: string;
  /** Why the project's attributes are missing, if they are. */
  propNote: string;
  /** Reading the viewer's ids, to attach the project's attributes. */
  guidBusy: string;
  guidError: string;
  /** Dataset key -> the model id the viewer answers with (for selections and object states). */
  viewerModelIds: Record<string, string>;
  /** A tool uses the project's attributes: read the viewer's ids where models have no IfcGUID property. */
  wantAppValues: () => void;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "Ocurrió un error.";
}

/**
 * Lists the models loaded in the viewer, reads the checked ones (one at a
 * time, once each) and joins the project's attributes onto their objects by
 * IFCGUID. Only works while `active` (a tool that needs it is visible). The
 * checked models are remembered for this browser tab, in case Trimble Connect
 * reloads the panel.
 */
export function useModelData({
  active,
  viewer,
  subscribe,
  projectId,
  getAccessToken,
  dataVersion,
}: {
  active: boolean;
  viewer: PropiedadesViewer;
  subscribe: (listener: ViewerEventListener) => () => void;
  projectId: string;
  getAccessToken: (fresh?: boolean) => Promise<string>;
  /** Changes when attribute values or the catalog change, to read them again. */
  dataVersion: number;
}): ModelData {
  // The Gráficos readers only use getObjects, getObjectProperties and convertToObjectIds.
  const reader = viewer as unknown as ViewerLike;

  const [models, setModels] = useState<ModelEntry[] | null>(null);
  const [checked, setCheckedState] = useState<string[]>([]);
  const [datasets, setDatasets] = useState<Record<string, ModelDataset>>({});
  const [reading, setReading] = useState<ModelData["reading"]>(null);
  const [readError, setReadError] = useState("");
  const [propData, setPropData] = useState<PropiedadesData | null>(null);
  const [propNote, setPropNote] = useState("");
  const [guidMaps, setGuidMaps] = useState<Record<string, Map<number, string>>>({});
  const [guidBusy, setGuidBusy] = useState("");
  const [guidError, setGuidError] = useState("");
  const [appValuesWanted, setAppValuesWanted] = useState(false);

  const storageKey = `propiedades.modelos.${projectId}`;
  /** Names of the models checked before a reload of the panel (null: none remembered). */
  const restored = useRef<string[] | null | undefined>(undefined);
  const unmounted = useRef(false);
  const readingKey = useRef<string | null>(null);
  const listing = useRef(new Set<string>());
  /** Models already offered once: new ones start checked, ones the user unchecked stay so. */
  const seen = useRef(new Set<string>());

  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

  const setChecked = useCallback((update: (prev: string[]) => string[]) => setCheckedState(update), []);

  // ------------------------------------------------------------ models

  const refreshModels = useCallback(async () => {
    if (restored.current === undefined) {
      try {
        const raw = sessionStorage.getItem(storageKey);
        const names = raw ? JSON.parse(raw) : null;
        restored.current = Array.isArray(names) && names.length ? names : null;
      } catch {
        restored.current = null;
      }
    }
    const loaded = ((await viewer.getModels("loaded").catch(() => [])) ?? []) as ModelSpec[];
    if (unmounted.current) return;
    setModels((prev) => {
      const previous = new Map((prev ?? []).map((e) => [e.key, e]));
      return loaded.map((spec) => previous.get(spec.id) ?? { key: spec.id, spec, status: "listing" });
    });
    // New models are included by default (after a reload, the ones checked
    // before); models no longer loaded drop out.
    const keys = new Set(loaded.map((m) => m.id));
    const fresh = loaded
      .filter((m) => !seen.current.has(m.id))
      .filter((m) => !restored.current || restored.current.includes(m.name))
      .map((m) => m.id);
    for (const m of loaded) seen.current.add(m.id);
    setCheckedState((prev) => [...prev.filter((k) => keys.has(k)), ...fresh.filter((k) => !prev.includes(k))]);

    for (const spec of loaded) {
      if (listing.current.has(spec.id)) continue;
      listing.current.add(spec.id);
      try {
        const list = await listModelObjects(reader, spec);
        if (unmounted.current) return;
        setModels(
          (prev) => prev?.map((e) => (e.key === spec.id ? { ...e, list, status: list.runtimeIds.length ? "ready" : "empty" } : e)) ?? prev
        );
      } catch {
        listing.current.delete(spec.id); // a later refresh retries it
        setModels((prev) => prev?.map((e) => (e.key === spec.id ? { ...e, status: "error" } : e)) ?? prev);
      }
    }
  }, [viewer, reader, storageKey]);

  useEffect(() => {
    if (!active) return;
    refreshModels();
    return subscribe((event) => {
      if (event === "viewer.onModelStateChanged" || event === "viewer.onModelReset") refreshModels();
    });
  }, [active, refreshModels, subscribe]);

  useEffect(() => {
    if (!models) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(models.filter((e) => checked.includes(e.key)).map((e) => e.spec.name)));
    } catch {
      // storage unavailable: nothing to remember
    }
  }, [storageKey, models, checked]);

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
        setCheckedState((prev) => prev.filter((k) => k !== next.key));
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
            ? "Los atributos del proyecto no están disponibles; las propiedades del modelo sí."
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
  const allRead =
    !!models && checked.length > 0 && checked.every((k) => datasets[k] || models.find((e) => e.key === k)?.status === "empty");
  const viewerModelIds = useMemo(
    () => Object.fromEntries((models ?? []).filter((e) => e.list).map((e) => [e.key, e.list!.queryModelId])),
    [models]
  );

  // Attribute values attach by IFCGUID: objects without a GUID property of
  // their own (IFC models; Revit has "IfcGUID") need the viewer's ids, read
  // only once a tool uses an attribute of the project.
  const needGuids = useMemo(() => {
    if (!appValuesWanted || !propData?.values.length) return [];
    return ready.filter((d) => !guidMaps[d.modelId] && viewerModelIds[d.modelId] && d.records.some((r) => !r.ifcGuid));
  }, [appValuesWanted, propData, ready, guidMaps, viewerModelIds]);

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
            setGuidError(`No se pudieron leer los identificadores de "${dataset.modelName}": ${message(err)}`);
          }
        }
      }
      if (!cancelled) setGuidBusy("");
    })();
    return () => {
      cancelled = true;
    };
  }, [active, needGuids, reader, viewerModelIds]);

  const wantAppValues = useCallback(() => setAppValuesWanted(true), []);
  const sizes = useMemo(() => Object.fromEntries(Object.entries(datasets).map(([k, d]) => [k, d.records.length])), [datasets]);

  return {
    models,
    checked,
    setChecked,
    merged,
    sizes,
    allRead,
    reading,
    readError,
    propNote,
    guidBusy,
    guidError,
    viewerModelIds,
    wantAppValues,
  };
}
