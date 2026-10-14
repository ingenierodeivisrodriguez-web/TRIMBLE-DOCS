"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/propiedades/client";
import { todayIso } from "../../lib/propiedades/values";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import { programacionVacia } from "../../lib/presupuesto/programacion";
import type { Programacion } from "../../lib/presupuesto/types";
import { message } from "./ui";

/**
 * The budget's schedule: loaded the first time it is opened, edited in memory
 * and saved apart from the budget (with its own version).
 */
export function useProgramacion(api: PresupuestoApi, abierta: boolean, usuario: string | null) {
  const [prog, setProgState] = useState<Programacion | null>(null);
  const [meta, setMeta] = useState<{ version: number; updatedAt: string | null; updatedBy: string | null }>({ version: 0, updatedAt: null, updatedBy: null });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState<{ text: string; conflict: boolean } | null>(null);
  const ref = useRef<Programacion | null>(null);
  ref.current = prog;
  const cargando = useRef(false);

  const cargar = useCallback(async () => {
    cargando.current = true;
    setLoadError("");
    try {
      const r = await api.getProgramacion();
      const p = r.programacion ?? programacionVacia(todayIso());
      ref.current = p;
      setProgState(p);
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

  const setProg = useCallback((change: (p: Programacion) => Programacion) => {
    const actual = ref.current;
    if (!actual) return;
    const next = change(actual);
    if (next === actual) return;
    ref.current = next;
    setProgState(next);
    setDirty(true);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    const actual = ref.current;
    if (!actual) return false;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await api.guardarProgramacion(actual, meta.version);
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

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return { prog, setProg, meta, dirty, saving, loadError, saveError, save, recargar: cargar };
}
