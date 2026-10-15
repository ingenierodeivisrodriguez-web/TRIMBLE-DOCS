"use client";

import { CSSProperties, MutableRefObject, useRef, useState } from "react";
import { ESTADO_ELEMENTO, EstadoElemento, estadoElementos } from "../../lib/presupuesto/avance";
import { fechaCorta } from "../../lib/presupuesto/calendario";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import type { ElementoVinculado, LineaBaseDatos } from "../../lib/presupuesto/types";
import { MapaGuids, selector, Visor } from "../../lib/presupuesto/viewerMap";
import { todayIso } from "../../lib/propiedades/values";
import { FechaCampo } from "./ProgramacionDialogs";
import { C, message, Modal, Notice } from "./ui";

/**
 * "Avance de obra" in the viewer panel: marks the selected elements as built
 * on a day (for the chosen partida or for all theirs), and colors the model by
 * progress at a date against the baseline. The marks live in the database,
 * never in the model's properties.
 */
export default function PanelAvance({
  api,
  viewer,
  mapa,
  vinculados,
  partida,
  canEdit,
  onMarcado,
}: {
  api: PresupuestoApi;
  viewer: Visor;
  mapa: MutableRefObject<MapaGuids>;
  /** The selected elements, as linked to partidas (with the day each was built). */
  vinculados: ElementoVinculado[];
  /** The partida chosen in the panel. */
  partida: { id: string; etiqueta: string } | null;
  canEdit: boolean;
  /** After marking: read the selection's links again. */
  onMarcado: () => void;
}) {
  const [fecha, setFecha] = useState<string | null>(todayIso());
  const [todas, setTodas] = useState(false);
  const [busy, setBusy] = useState("");
  const [nota, setNota] = useState<{ kind: "info" | "warning" | "error"; text: string } | null>(null);
  const [conflicto, setConflicto] = useState<{ otras: ElementoVinculado[]; pendientes: ElementoVinculado[] } | null>(null);
  const [leyenda, setLeyenda] = useState<Map<EstadoElemento, number> | null>(null);
  const base = useRef<LineaBaseDatos | null | undefined>(undefined);
  const coloreados = useRef<Map<string, number[]> | null>(null);

  const enAlcance = vinculados.filter((v) => (todas || !partida ? true : v.itemId === partida.id));
  const ejecutados = enAlcance.filter((v) => v.ejecutado);
  const fechas = [...new Set(ejecutados.map((v) => v.ejecutado!))].sort();
  const sinPartida = partida && !todas ? new Set(vinculados.map((v) => v.ifcGuid)).size - new Set(enAlcance.map((v) => v.ifcGuid)).size : 0;

  async function marcar(lista: ElementoVinculado[], dia: string | null) {
    setConflicto(null);
    if (!lista.length) return;
    setBusy(dia ? "Marcando..." : "Desmarcando...");
    setNota(null);
    try {
      const n = await api.marcarEjecutados(
        lista.map((v) => ({ itemId: v.itemId, ifcGuid: v.ifcGuid })),
        dia
      );
      setNota({ kind: "info", text: dia ? `${n} elemento(s) marcados como ejecutados el ${fechaCorta(dia)}.` : `${n} elemento(s) vuelven a pendientes.` });
      onMarcado();
    } catch (err) {
      setNota({ kind: "error", text: message(err) });
    } finally {
      setBusy("");
    }
  }

  function pedirMarcar() {
    if (!fecha) return;
    const otras = enAlcance.filter((v) => v.ejecutado && v.ejecutado !== fecha);
    // Never overwrite a different day silently: ask what to do with those.
    if (otras.length) setConflicto({ otras, pendientes: enAlcance.filter((v) => !v.ejecutado) });
    else marcar(enAlcance.filter((v) => v.ejecutado !== fecha), fecha);
  }

  async function colorear(soloPartida: boolean) {
    if (!fecha) return;
    setBusy("Leyendo el avance...");
    setNota(null);
    try {
      if (base.current === undefined) base.current = (await api.getAvance()).lineaBase?.datos ?? null;
      const elementos = soloPartida && partida ? await api.elementosDe({ itemIds: [partida.id] }) : await api.elementosEjecucion();
      if (!elementos.length) {
        setNota({ kind: "info", text: "No hay elementos asociados a partidas para colorear." });
        return;
      }
      const estados = estadoElementos(elementos, fecha, base.current);
      setBusy("Buscando los elementos en el modelo...");
      const u = await mapa.current.ubicar(
        viewer,
        [...estados].map(([ifcGuid, x]) => ({ ifcGuid, modelId: x.modelId })),
        setBusy
      );
      await quitarColores(false);
      const porEstado = new Map<EstadoElemento, Map<string, number[]>>();
      const cuenta = new Map<EstadoElemento, number>();
      for (const [g, x] of estados) {
        const donde = u.ubicacion.get(g);
        if (!donde) continue;
        const m = porEstado.get(x.estado) ?? new Map<string, number[]>();
        m.set(donde.viewerModelId, [...(m.get(donde.viewerModelId) ?? []), donde.runtimeId]);
        porEstado.set(x.estado, m);
        cuenta.set(x.estado, (cuenta.get(x.estado) ?? 0) + 1);
      }
      setBusy("Coloreando...");
      const todos = new Map<string, number[]>();
      for (const [estado, m] of porEstado) {
        await viewer.setObjectState(selector(m), { color: ESTADO_ELEMENTO[estado].color });
        for (const [modelo, ids] of m) todos.set(modelo, [...(todos.get(modelo) ?? []), ...ids]);
      }
      coloreados.current = todos;
      setLeyenda(cuenta);
      const faltan = u.noEncontrados + u.sinModelo;
      setNota({
        kind: faltan ? "warning" : "info",
        text: `Avance al ${fechaCorta(fecha)}${soloPartida && partida ? ` de ${partida.etiqueta}` : ""}: ${u.encontrados} elemento(s) coloreados.${
          faltan ? ` ${faltan} están en modelos que no están abiertos o no se encontraron.` : ""
        }${base.current ? "" : " Sin línea base vigente: los pendientes salen en gris."}`,
      });
    } catch (err) {
      setNota({ kind: "error", text: message(err) });
    } finally {
      setBusy("");
    }
  }

  async function quitarColores(avisar = true) {
    const m = coloreados.current;
    coloreados.current = null;
    if (avisar) setLeyenda(null);
    if (!m) return;
    try {
      await viewer.setObjectState(selector(m), { color: "reset" });
    } catch (err) {
      if (avisar) setNota({ kind: "error", text: message(err) });
    }
  }

  return (
    <details style={{ border: `1px solid ${C.border}`, borderRadius: 5, padding: "6px 8px" }}>
      <summary style={{ cursor: "pointer", fontWeight: 700, fontSize: 13 }}>Avance de obra (elementos ejecutados)</summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8, fontSize: 12.5 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Fecha:
          <FechaCampo id="fecha-ejecucion" value={fecha} onChange={setFecha} width={130} />
        </label>
        {partida && (
          <div role="radiogroup" aria-label="Partidas a marcar">
            <label style={{ display: "block" }}>
              <input type="radio" checked={!todas} onChange={() => setTodas(false)} /> Solo en {partida.etiqueta}
            </label>
            <label style={{ display: "block" }}>
              <input type="radio" checked={todas} onChange={() => setTodas(true)} /> En todas las partidas de los elementos
            </label>
          </div>
        )}
        <div style={{ color: "var(--tc-gray-500)" }}>
          {vinculados.length === 0
            ? "Selecciona en el modelo elementos asociados a partidas para marcarlos."
            : `Selección: ${enAlcance.length} asociación(es) elemento-partida; ${ejecutados.length} ya ejecutadas${fechas.length ? ` (${fechas.map(fechaCorta).join(", ")})` : ""}.`}
          {sinPartida > 0 && ` ${sinPartida} elemento(s) de la selección no son de esta partida.`}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <button type="button" style={primary} disabled={!canEdit || !!busy || !fecha || !enAlcance.length} onClick={pedirMarcar}>
            ✓ Marcar ejecutados
          </button>
          <button type="button" style={btn} disabled={!canEdit || !!busy || !ejecutados.length} onClick={() => marcar(ejecutados, null)}>
            Desmarcar
          </button>
          <button type="button" style={btn} disabled={!!busy || !fecha} onClick={() => colorear(false)} title="Verde: ejecutado; rojo: pendiente y atrasado; amarillo: pendiente en ejecución; gris: todavía no le toca">
            🎨 Colorear todo
          </button>
          <button type="button" style={btn} disabled={!!busy || !fecha || !partida} onClick={() => colorear(true)}>
            🎨 Colorear la partida
          </button>
          {leyenda && (
            <button type="button" style={{ ...btn, gridColumn: "1 / -1" }} disabled={!!busy} onClick={() => quitarColores()}>
              Quitar los colores
            </button>
          )}
        </div>
        {leyenda && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {(Object.keys(ESTADO_ELEMENTO) as EstadoElemento[]).map((e) => (
              <span key={e} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ width: 12, height: 12, borderRadius: 2, background: ESTADO_ELEMENTO[e].color, display: "inline-block" }} />
                {ESTADO_ELEMENTO[e].texto}: <strong>{leyenda.get(e) ?? 0}</strong>
              </span>
            ))}
          </div>
        )}
        {busy && <div style={{ color: "var(--tc-blue-700)" }}>{busy}</div>}
        {nota && <Notice kind={nota.kind}>{nota.text}</Notice>}
        {!canEdit && <span style={{ color: "var(--tc-gray-500)" }}>Solo los administradores y editores del presupuesto marcan el avance; tú puedes colorearlo.</span>}
        <span style={{ fontSize: 11.5, color: "var(--tc-gray-500)" }}>
          El día de ejecución se guarda en el presupuesto (no en las propiedades del modelo). En Programación → Avance, «Leer el avance del modelo 3D» lo convierte en %.
        </span>
      </div>
      {conflicto && fecha && (
        <Modal title="Elementos ya marcados con otra fecha" onClose={() => setConflicto(null)} width={480}>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5 }}>
            <span>
              {conflicto.otras.length} de los seleccionados ya están ejecutados con otra fecha ({[...new Set(conflicto.otras.map((v) => fechaCorta(v.ejecutado!)))].join(", ")}).
              ¿Qué hago?
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button type="button" style={btn} onClick={() => setConflicto(null)}>
                Cancelar
              </button>
              <button type="button" style={btn} disabled={!conflicto.pendientes.length} onClick={() => marcar(conflicto.pendientes, fecha)}>
                Solo marcar los pendientes ({conflicto.pendientes.length})
              </button>
              <button type="button" style={primary} onClick={() => marcar(enAlcance.filter((v) => v.ejecutado !== fecha), fecha)}>
                Cambiar todos al {fechaCorta(fecha)}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </details>
  );
}

const btn: CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  background: "#fff",
  color: "var(--tc-blue-700)",
  borderRadius: 5,
  padding: "6px 8px",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
const primary: CSSProperties = { ...btn, background: "#2e8540", color: "#fff", borderColor: "#1e6b2e" };
