"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/propiedades/client";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import type { ControlAvance, LineaBase, LineaBaseDatos, LineaBaseResumen } from "../../lib/presupuesto/types";
import { message } from "./ui";

/**
 * Progress control: the baselines (the one in force with its rows) and the
 * progress reports (cortes), loaded the first time the schedule is opened,
 * edited in memory and saved with their own version.
 */
export function useAvance(api: PresupuestoApi, abierta: boolean, usuario: string | null) {
  const [avance, setAvanceState] = useState<ControlAvance | null>(null);
  const [lineasBase, setLineasBase] = useState<LineaBaseResumen[]>([]);
  const [lineaBase, setLineaBase] = useState<LineaBase | null>(null);
  const [meta, setMeta] = useState<{ version: number; updatedAt: string | null; updatedBy: string | null }>({ version: 0, updatedAt: null, updatedBy: null });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState<{ text: string; conflict: boolean } | null>(null);
  const ref = useRef<ControlAvance | null>(null);
  ref.current = avance;
  const cargando = useRef(false);

  const cargar = useCallback(async () => {
    cargando.current = true;
    setLoadError("");
    try {
      const r = await api.getAvance();
      const a = r.avance ?? { cortes: [] };
      ref.current = a;
      setAvanceState(a);
      setLineasBase(r.lineasBase);
      setLineaBase(r.lineaBase);
      setMeta({ version: r.version, updatedAt: r.updatedAt, updatedBy: r.updatedBy });
      setDirty(false);
      setSaveError(null);
    } catch (err) {
      setLoadError(message(err));
    } finally {
      cargando.current = false;
    }
  }, [api]);

  useEffect(() => {
    if (abierta && !ref.current && !cargando.current) cargar();
  }, [abierta, cargar]);

  const setAvance = useCallback((change: (a: ControlAvance) => ControlAvance) => {
    const actual = ref.current;
    if (!actual) return;
    const next = change(actual);
    if (next === actual) return;
    ref.current = next;
    setAvanceState(next);
    setDirty(true);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    const actual = ref.current;
    if (!actual) return false;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await api.guardarAvance(actual, meta.version);
      if (ref.current === actual) setDirty(false);
      setMeta({ version: r.version, updatedAt: new Date().toISOString(), updatedBy: usuario });
      return true;
    } catch (err) {
      setSaveError({ text: message(err), conflict: err instanceof ApiError && err.code === "version-conflict" });
      return false;
    } finally {
      setSaving(false);
    }
  }, [api, meta.version, usuario]);

  /** Saves the schedule on screen as the baseline in force. */
  const crearLineaBase = useCallback(
    async (nombre: string, datos: LineaBaseDatos) => {
      const r = await api.crearLineaBase(nombre, datos);
      setLineasBase((l) => [r, ...l.map((x) => ({ ...x, vigente: false }))]);
      setLineaBase({ ...r, datos });
      return r;
    },
    [api]
  );

  /** Measures against another of the saved baselines. */
  const usarLineaBase = useCallback(
    async (id: string) => {
      const [lista, linea] = await Promise.all([api.usarLineaBase(id), api.getLineaBase(id)]);
      setLineasBase(lista);
      setLineaBase({ ...linea, vigente: true });
    },
    [api]
  );

  // Warn before leaving with unsaved progress.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return {
    avance,
    setAvance,
    lineasBase,
    lineaBase,
    meta,
    dirty,
    saving,
    loadError,
    saveError,
    save,
    recargar: cargar,
    crearLineaBase,
    usarLineaBase,
    resumenEjecucion: api.resumenEjecucion,
    elementosDe: api.elementosDe,
  };
}
