"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MetradoModelo } from "../../lib/presupuesto/calc";
import { ApiError } from "../../lib/propiedades/client";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import { limpiarDocumento } from "../../lib/presupuesto/doc";
import { codigosOmniclass } from "../../lib/presupuesto/omniclass";
import {
  CatalogoResponse,
  CONTEO,
  EstadoResponse,
  Insumo,
  OmniclassEntry,
  PartidaCatalogo,
  PresupuestoDoc,
  ResumenElementos,
} from "../../lib/presupuesto/types";
import { message } from "./ui";

export interface Catalogo {
  baseProjectId: string;
  insumos: Insumo[];
  partidas: PartidaCatalogo[];
  insumoMap: Map<string, Insumo>;
  partidaMap: Map<string, PartidaCatalogo>;
  /** Imported OmniClass codes. */
  omniclass: OmniclassEntry[];
  /** Built-in and imported codes. */
  codigos: OmniclassEntry[];
  titulos: Map<string, string>;
}

export function armarCatalogo(r: Pick<CatalogoResponse, "baseProjectId" | "insumos" | "partidas" | "omniclass">): Catalogo {
  const codigos = codigosOmniclass(r.omniclass);
  return {
    baseProjectId: r.baseProjectId,
    insumos: r.insumos,
    partidas: r.partidas,
    insumoMap: new Map(r.insumos.map((i) => [i.id, i])),
    partidaMap: new Map(r.partidas.map((p) => [p.id, p])),
    omniclass: r.omniclass,
    codigos,
    titulos: new Map(codigos.map((c) => [c.codigo, c.titulo])),
  };
}

function porDescripcion<T extends { descripcion: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.descripcion.localeCompare(b.descripcion, "es", { sensitivity: "base" }));
}

/**
 * The budget screen's data: what the caller may do, the catalogs, the budget
 * being edited (saved with the Guardar button) and the quantities taken from
 * the model's elements.
 */
export function usePresupuesto(api: PresupuestoApi) {
  const [estado, setEstado] = useState<EstadoResponse | null>(null);
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [doc, setDocState] = useState<PresupuestoDoc | null>(null);
  const [meta, setMeta] = useState<{ version: number; updatedAt: string | null; updatedBy: string | null }>({ version: 0, updatedAt: null, updatedBy: null });
  const [resumen, setResumen] = useState<ResumenElementos | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState<{ text: string; conflict: boolean } | null>(null);
  const [catalogoError, setCatalogoError] = useState("");
  const docRef = useRef<PresupuestoDoc | null>(null);
  docRef.current = doc;

  const loadDocumento = useCallback(async () => {
    const r = await api.getDocumento();
    setDocState(r.doc);
    setMeta({ version: r.version, updatedAt: r.updatedAt, updatedBy: r.updatedBy });
    setDirty(false);
    setSaveError(null);
  }, [api]);

  const reloadResumen = useCallback(async () => {
    try {
      setResumen(await api.getResumen());
    } catch {
      // The quantities from the model are optional: without them the typed ones count.
    }
  }, [api]);

  const reloadCatalogo = useCallback(async () => {
    try {
      setCatalogo(armarCatalogo(await api.getCatalogo()));
      setCatalogoError("");
    } catch (err) {
      setCatalogoError(message(err));
    }
  }, [api]);

  const reloadEstado = useCallback(async () => {
    setEstado(await api.getEstado());
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [e] = await Promise.all([api.getEstado(), loadDocumento(), reloadCatalogo(), reloadResumen()]);
        if (!cancelled) setEstado(e);
      } catch (err) {
        if (!cancelled) setLoadError(message(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, loadDocumento, reloadCatalogo, reloadResumen]);

  /** Applies a change to the budget being edited (saved later with Guardar). */
  const setDoc = useCallback((change: (doc: PresupuestoDoc) => PresupuestoDoc) => {
    const current = docRef.current;
    if (!current) return;
    const next = change(current);
    if (next === current) return;
    docRef.current = next;
    setDocState(next);
    setDirty(true);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    const current = docRef.current;
    if (!current) return false;
    setSaving(true);
    setSaveError(null);
    try {
      const limpio = limpiarDocumento(current);
      const r = await api.guardarDocumento(limpio, meta.version);
      // Edits made while saving stay pending.
      if (docRef.current === current) {
        setDocState(limpio);
        docRef.current = limpio;
        setDirty(false);
      }
      setMeta({ version: r.version, updatedAt: new Date().toISOString(), updatedBy: estado?.user.name ?? null });
      reloadResumen();
      return true;
    } catch (err) {
      setSaveError({ text: message(err), conflict: err instanceof ApiError && err.code === "version-conflict" });
      return false;
    } finally {
      setSaving(false);
    }
  }, [api, meta.version, estado, reloadResumen]);

  /** Drops the unsaved changes and loads what is stored. */
  const discard = useCallback(async () => {
    try {
      await Promise.all([loadDocumento(), reloadResumen()]);
    } catch (err) {
      setSaveError({ text: message(err), conflict: false });
    }
  }, [loadDocumento, reloadResumen]);

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

  /** A partida's quantity from its model elements, when it measures them. */
  const metradoModelo = useMemo(() => {
    const out = new Map<string, MetradoModelo>();
    if (!resumen) return out;
    const sumas = new Map(resumen.resumen.map((r) => [r.itemId, r]));
    for (const m of resumen.mediciones) {
      const r = sumas.get(m.itemId);
      if (!m.campo || !r || r.elementos === 0) continue;
      out.set(m.itemId, { valor: m.campo === CONTEO ? r.elementos : r.suma, elementos: r.elementos, campoLabel: m.campoLabel });
    }
    return out;
  }, [resumen]);

  /** Element counts of every partida (measured or not). */
  const elementosPorItem = useMemo(() => new Map((resumen?.resumen ?? []).map((r) => [r.itemId, r.elementos])), [resumen]);

  /** Updates the catalog in place after a save, without reloading it all. */
  const catalogoGuardado = useCallback(
    (cambios: { insumos?: Insumo[]; partidas?: PartidaCatalogo[]; sinInsumo?: string; sinPartida?: string }) => {
      setCatalogo((c) => {
        if (!c) return c;
        const insumos = new Map(c.insumoMap);
        const partidas = new Map(c.partidaMap);
        for (const i of cambios.insumos ?? []) insumos.set(i.id, i);
        for (const p of cambios.partidas ?? []) partidas.set(p.id, p);
        if (cambios.sinInsumo) insumos.delete(cambios.sinInsumo);
        if (cambios.sinPartida) partidas.delete(cambios.sinPartida);
        return armarCatalogo({
          baseProjectId: c.baseProjectId,
          insumos: porDescripcion([...insumos.values()]),
          partidas: porDescripcion([...partidas.values()]),
          omniclass: c.omniclass,
        });
      });
    },
    []
  );

  return {
    estado,
    setEstado,
    reloadEstado,
    catalogo,
    catalogoError,
    reloadCatalogo,
    catalogoGuardado,
    doc,
    setDoc,
    meta,
    dirty,
    saving,
    save,
    discard,
    loadError,
    saveError,
    clearSaveError: () => setSaveError(null),
    resumen,
    reloadResumen,
    metradoModelo,
    elementosPorItem,
  };
}

export type PresupuestoState = ReturnType<typeof usePresupuesto>;
