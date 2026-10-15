"use client";

import { CSSProperties, ReactNode, useEffect, useMemo, useState } from "react";
import type { SubpresupuestoCalculado } from "../../lib/presupuesto/calc";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import {
  aplicarPrograma,
  cambiarPadre,
  completarAsignaciones,
  descendientes,
  dividirPorUbicacion,
  edtDesdePresupuesto,
  eliminarActividades,
  eliminarNodo,
  moverNodo,
  repartoDelModelo,
  repartoIgual,
  rutaNodo,
  SIN_DATO,
  Ubicacion,
} from "../../lib/presupuesto/edtProgramacion";
import { coincide, fmt } from "../../lib/presupuesto/format";
import { estimarCostoCop, fmtCop } from "../../lib/presupuesto/ia/cupo";
import { SISTEMA_PROGRAMA } from "../../lib/presupuesto/ia/programa";
import type { BorradorProgramaIA, EstadoIAResponse } from "../../lib/presupuesto/ia/tipos";
import { MAX_ACTIVIDADES_PROGRAMA_IA } from "../../lib/presupuesto/ia/tipos";
import { reglaDel100, textoDependencia, type Programado } from "../../lib/presupuesto/programacion";
import type { Actividad, ColumnaMemoria, NodoEdt, PresupuestoDoc, Programacion } from "../../lib/presupuesto/types";
import { bloqueadoPor, conReintento } from "./AsistenteIAFases";
import { ConfirmDialog } from "./SimpleDialogs";
import { acceptButton, baseInput, C, message, Modal, Notice, NumInput, TextCommit } from "./ui";

const nuevoId = () => globalThis.crypto.randomUUID();

interface PartidaInfo {
  id: string;
  numero: string;
  descripcion: string;
  unidad: string;
  metrado: number;
  parcial: number;
  capitulo: string;
}

/** The budget's partidas with their numbering and chapter, in order. */
function partidasDelPresupuesto(doc: PresupuestoDoc, calculados: Map<string, SubpresupuestoCalculado>): PartidaInfo[] {
  const out: PartidaInfo[] = [];
  for (const sp of doc.subpresupuestos) {
    const titulos: { nivel: number; texto: string }[] = [];
    for (const f of calculados.get(sp.id)?.filas ?? []) {
      while (titulos.length && titulos[titulos.length - 1].nivel >= f.item.nivel) titulos.pop();
      if (f.item.tipo === "titulo") {
        titulos.push({ nivel: f.item.nivel, texto: f.item.descripcion });
        continue;
      }
      out.push({ id: f.item.id, numero: f.numero, descripcion: f.item.descripcion, unidad: f.item.unidad, metrado: f.metrado ?? 0, parcial: f.parcial, capitulo: titulos.map((t) => t.texto).join(" > ") });
    }
  }
  return out;
}

type Seleccion = { tipo: "nodo" | "actividad"; id: string } | null;

/**
 * The schedule's own EDT: its tree of deliverables and work packages, each
 * activity with the part of each partida it does, the 100 % rule, splitting
 * by location and the assistant's proposals. Changes go to the schedule on
 * screen; they are saved with «Guardar».
 */
export function EdtDialog({
  prog,
  setProg,
  res,
  doc,
  calculados,
  canEdit,
  api,
  projectId,
  columnas,
  onClose,
}: {
  prog: Programacion;
  setProg: (cambio: (p: Programacion) => Programacion) => void;
  res: Programado;
  doc: PresupuestoDoc;
  calculados: Map<string, SubpresupuestoCalculado>;
  canEdit: boolean;
  api: PresupuestoApi;
  projectId: string;
  columnas: ColumnaMemoria[];
  onClose: () => void;
}) {
  const [sel, setSel] = useState<Seleccion>(null);
  const [plegados, setPlegados] = useState<Set<string>>(new Set());
  const [buscar, setBuscar] = useState("");
  const [panel, setPanel] = useState<"detalle" | "regla">("detalle");
  const [ventana, setVentana] = useState<"dividir" | "ia" | null>(null);
  const [confirmar, setConfirmar] = useState<{ texto: string; accion: () => void } | null>(null);
  const [nota, setNota] = useState<{ kind: "info" | "warning" | "error"; texto: string } | null>(null);
  const partidas = useMemo(() => partidasDelPresupuesto(doc, calculados), [doc, calculados]);
  const regla = useMemo(() => (prog.actividades ? reglaDel100(doc, calculados, prog) : { faltan: [], sobran: [] }), [doc, calculados, prog]);

  if (!prog.actividades) {
    return (
      <Modal title="Estructura de la programación (EDT)" onClose={onClose} width={860}>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5, lineHeight: 1.55 }}>
          <p style={{ margin: 0 }}>
            Hoy la programación sigue el presupuesto: cada partida es una tarea. Según el PMI, cada estructura tiene un uso distinto, y aquí quedan
            enlazadas:
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>
              <strong>Presupuesto (estructura de costos):</strong> cuánto cuesta, por capítulos y partidas con su análisis de precios. No cambia.
            </li>
            <li>
              <strong>EDT de la programación:</strong> qué se entrega, por entregables y ubicación (torre, piso, zona). Abajo, los paquetes de trabajo con su
              responsable.
            </li>
            <li>
              <strong>Actividades:</strong> cómo y cuándo. Cada una hace un % de una o varias partidas; de ahí salen su cantidad, su duración y su costo. La{" "}
              <strong>regla del 100 %</strong> cuida que cada partida quede asignada completa.
            </li>
          </ul>
          <p style={{ margin: 0 }}>
            Se crea a partir del presupuesto: cada título será un paquete y cada partida una actividad del 100 %, con su mismo id, sus enlaces y su duración, así
            que la línea base, los cortes de avance y las marcas del visor siguen sirviendo. Luego la reorganizas o la divides por pisos.
          </p>
          {!canEdit && <Notice kind="info">Solo los administradores y editores del presupuesto cambian la programación.</Notice>}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              style={{ ...acceptButton, ...(canEdit ? {} : apagado) }}
              disabled={!canEdit}
              onClick={() => {
                setProg((x) => edtDesdePresupuesto(doc, x));
              }}
            >
              Crear la EDT de la programación
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  const edt = prog.edt ?? [];
  const actividades = prog.actividades;
  const nodo = sel?.tipo === "nodo" ? edt.find((n) => n.id === sel.id) ?? null : null;
  const actividad = sel?.tipo === "actividad" ? actividades.find((a) => a.id === sel.id) ?? null : null;
  const asignadoDe = new Map<string, number>();
  for (const a of actividades) for (const x of a.asignaciones) asignadoDe.set(x.partida, (asignadoDe.get(x.partida) ?? 0) + x.pct);
  const visibles = res.filas.filter((f) => (buscar.trim() ? f.tipo === "partida" && coincide(`${f.numero} ${f.descripcion}`, buscar) : !f.ancestros.some((a) => plegados.has(a))));

  const cambiarNodo = (id: string, cambio: Partial<NodoEdt>) => setProg((x) => ({ ...x, edt: (x.edt ?? []).map((n) => (n.id === id ? { ...n, ...cambio } : n)) }));
  const cambiarActividad = (id: string, cambio: (a: Actividad) => Actividad) => setProg((x) => ({ ...x, actividades: (x.actividades ?? []).map((a) => (a.id === id ? cambio(a) : a)) }));
  function nuevoNodo(padre: string | null) {
    const id = nuevoId();
    setProg((x) => ({ ...x, edt: [...(x.edt ?? []), { id, padre, nombre: "NUEVO PAQUETE", responsable: "", ubicacion: [] }] }));
    setSel({ tipo: "nodo", id });
  }
  function nuevaActividad(nodoId: string) {
    const id = nuevoId();
    setProg((x) => ({ ...x, actividades: [...(x.actividades ?? []), { id, nodo: nodoId, nombre: "NUEVA ACTIVIDAD", asignaciones: [] }] }));
    setSel({ tipo: "actividad", id });
  }
  const nodoActual = nodo?.id ?? actividad?.nodo ?? null;
  const preseleccion = actividad ? actividad.asignaciones.map((a) => a.partida) : nodo ? actividades.filter((a) => descendientes(edt, nodo.id).has(a.nodo)).flatMap((a) => a.asignaciones.map((x) => x.partida)) : [];

  return (
    <Modal
      title="Estructura de la programación (EDT)"
      onClose={onClose}
      width="97vw"
      height="94vh"
      toolbar={
        <>
          <button type="button" style={botonSec} disabled={!canEdit} onClick={() => nuevoNodo(nodo ? nodo.id : null)} title="Un paquete nuevo dentro del elegido (o arriba)">
            + Paquete
          </button>
          <button type="button" style={botonSec} disabled={!canEdit || !nodoActual} onClick={() => nodoActual && nuevaActividad(nodoActual)} title="Una actividad en el paquete elegido">
            + Actividad
          </button>
          <button type="button" style={botonSec} disabled={!canEdit} onClick={() => setVentana("dividir")} title="Partir partidas en actividades por piso, zona o torre">
            Dividir por ubicación…
          </button>
          <button type="button" style={botonSec} disabled={!canEdit} onClick={() => setVentana("ia")} title="El asistente propone paquetes de trabajo y la secuencia constructiva">
            🤖 Proponer paquetes y secuencia…
          </button>
          <button
            type="button"
            style={{ ...botonSec, ...(regla.faltan.length || regla.sobran.length ? { borderColor: "#e8a33d", background: "#fff7e0" } : { borderColor: "#7cc08a" }) }}
            aria-pressed={panel === "regla"}
            onClick={() => setPanel((p) => (p === "regla" ? "detalle" : "regla"))}
          >
            Regla del 100 %: {regla.faltan.length || regla.sobran.length ? `${regla.faltan.length + regla.sobran.length} por revisar` : "completa ✓"}
          </button>
          <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar actividad" style={{ ...baseInput, width: 200, marginLeft: "auto" }} aria-label="Buscar actividad" />
        </>
      }
    >
      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 0 }}>
        {/* ---- the tree */}
        <div style={{ width: "48%", minWidth: 380, borderRight: `1px solid ${C.border}`, overflow: "auto", fontSize: 13 }}>
          {visibles.map((f) => {
            const esNodo = f.tipo !== "partida";
            const activo = sel?.id === f.id;
            const n = esNodo ? edt.find((x) => x.id === f.id) : null;
            const a = esNodo ? null : actividades.find((x) => x.id === f.id);
            return (
              <div
                key={f.id}
                onClick={() => setSel({ tipo: esNodo ? "nodo" : "actividad", id: f.id })}
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "center",
                  padding: `4px 8px 4px ${8 + f.nivel * 14}px`,
                  borderBottom: `1px solid ${C.grid}`,
                  background: activo ? C.rowSelected : esNodo ? "#f6f8fb" : "#fff",
                  cursor: "pointer",
                  fontWeight: esNodo ? 700 : 400,
                }}
              >
                {esNodo ? (
                  <button
                    type="button"
                    aria-label={plegados.has(f.id) ? "Desplegar" : "Plegar"}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPlegados((s) => {
                        const x = new Set(s);
                        if (x.has(f.id)) x.delete(f.id);
                        else x.add(f.id);
                        return x;
                      });
                    }}
                    style={plegar}
                  >
                    {plegados.has(f.id) ? "▶" : "▼"}
                  </button>
                ) : (
                  <span style={{ width: 14 }} />
                )}
                <span style={{ color: "var(--tc-gray-500)", fontWeight: 400, minWidth: 40 }}>{f.numero}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.descripcion}>
                  {f.descripcion}
                </span>
                {n?.responsable && <span style={{ ...chip, background: "#e8f0fe", color: "#0b57d0" }}>👤 {n.responsable}</span>}
                {n?.ubicacion.map((u) => (
                  <span key={u.columna} style={{ ...chip, background: "#e6f4ea", color: "#1e6b2e" }} title={`${columnas.find((c) => c.id === u.columna)?.label ?? u.columna} = ${u.valor}`}>
                    📍 {u.valor}
                  </span>
                ))}
                {a && !a.asignaciones.length && <span style={{ ...chip, background: "#f1f3f4", color: "#5f6368" }}>sin costo</span>}
                {a && a.asignaciones.length > 1 && <span style={{ ...chip, background: "#f1f3f4", color: "#5f6368" }}>{a.asignaciones.length} partidas</span>}
                <span style={{ color: "var(--tc-gray-500)", fontWeight: 400, fontVariantNumeric: "tabular-nums" }}>{fmt(f.parcial)}</span>
              </div>
            );
          })}
          {!visibles.length && <p style={{ padding: 12, color: "var(--tc-gray-500)" }}>{buscar ? "Ninguna actividad coincide." : "La EDT está vacía: agrega un paquete."}</p>}
        </div>

        {/* ---- the detail */}
        <div style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5 }}>
          {nota && <Notice kind={nota.kind}>{nota.texto}</Notice>}
          {panel === "regla" ? (
            <ReglaDel100
              regla={regla}
              canEdit={canEdit}
              onCompletar={(ids) => {
                let agregadas = 0;
                setProg((x) => {
                  const r = completarAsignaciones(doc, calculados, x, ids ?? undefined);
                  agregadas = r.agregadas;
                  return r.prog;
                });
                setNota({ kind: "info", texto: `${agregadas} actividad(es) creadas con lo que faltaba. Revisa su paquete y su nombre.` });
              }}
              onVer={(actividadId) => {
                setPanel("detalle");
                setSel({ tipo: "actividad", id: actividadId });
              }}
            />
          ) : nodo ? (
            <DetalleNodo
              nodo={nodo}
              edt={edt}
              columnas={columnas}
              canEdit={canEdit}
              fila={res.porId.get(nodo.id)}
              directas={actividades.filter((a) => a.nodo === nodo.id).length}
              onCambiar={(c) => cambiarNodo(nodo.id, c)}
              onPadre={(padre) => {
                const r = cambiarPadre(edt, nodo.id, padre);
                if ("error" in r) setNota({ kind: "error", texto: r.error });
                else setProg((x) => ({ ...x, edt: r }));
              }}
              onMover={(dir) => setProg((x) => ({ ...x, edt: moverNodo(x.edt ?? [], nodo.id, dir) }))}
              onSubpaquete={() => nuevoNodo(nodo.id)}
              onActividad={() => nuevaActividad(nodo.id)}
              onEliminar={() =>
                setConfirmar({
                  texto: `Se elimina el paquete «${nodo.nombre}»: lo que contiene (paquetes y actividades) pasa al paquete de arriba.`,
                  accion: () => {
                    const r = eliminarNodo(prog, nodo.id);
                    if ("error" in r) setNota({ kind: "error", texto: r.error });
                    else {
                      setProg(() => r);
                      setSel(null);
                    }
                  },
                })
              }
            />
          ) : actividad ? (
            <DetalleActividad
              actividad={actividad}
              edt={edt}
              partidas={partidas}
              asignadoDe={asignadoDe}
              fila={res.porId.get(actividad.id)}
              canEdit={canEdit}
              onCambiar={(c) => cambiarActividad(actividad.id, c)}
              onEliminar={() =>
                setConfirmar({
                  texto: `Se elimina la actividad «${actividad.nombre}» y los enlaces con ella. Su parte de las partidas queda sin asignar (la regla del 100 % lo mostrará).`,
                  accion: () => {
                    setProg((x) => eliminarActividades(x, new Set([actividad.id])));
                    setSel(null);
                  },
                })
              }
            />
          ) : (
            <Notice kind="info">
              Elige un paquete o una actividad a la izquierda. Los paquetes son entregables o ubicaciones (torre, piso, zona) y pueden tener responsable; las
              actividades hacen un % de una o varias partidas del presupuesto. Los cambios se guardan con «Guardar» de la programación.
            </Notice>
          )}
        </div>
      </div>
      {ventana === "dividir" && (
        <DividirDialog
          prog={prog}
          setProg={setProg}
          partidas={partidas}
          asignadoDe={asignadoDe}
          preseleccion={preseleccion}
          padreInicial={nodoActual}
          api={api}
          columnas={columnas}
          onListo={(texto) => {
            setNota({ kind: "info", texto });
            setVentana(null);
          }}
          onClose={() => setVentana(null)}
        />
      )}
      {ventana === "ia" && <ProgramaIADialog prog={prog} setProg={setProg} res={res} api={api} projectId={projectId} alcanceInicial={nodo?.id ?? null} onClose={() => setVentana(null)} />}
      {confirmar && (
        <ConfirmDialog
          title="Confirmar"
          danger
          confirmLabel="Eliminar"
          onClose={() => setConfirmar(null)}
          onConfirm={() => {
            confirmar.accion();
            setConfirmar(null);
          }}
        >
          {confirmar.texto}
        </ConfirmDialog>
      )}
    </Modal>
  );
}

function DetalleNodo({
  nodo,
  edt,
  columnas,
  canEdit,
  fila,
  directas,
  onCambiar,
  onPadre,
  onMover,
  onSubpaquete,
  onActividad,
  onEliminar,
}: {
  nodo: NodoEdt;
  edt: NodoEdt[];
  columnas: ColumnaMemoria[];
  canEdit: boolean;
  fila: Programado["filas"][number] | undefined;
  directas: number;
  onCambiar: (c: Partial<NodoEdt>) => void;
  onPadre: (padre: string | null) => void;
  onMover: (dir: -1 | 1) => void;
  onSubpaquete: () => void;
  onActividad: () => void;
  onEliminar: () => void;
}) {
  const [colNueva, setColNueva] = useState(columnas[0]?.id ?? "");
  const [valNuevo, setValNuevo] = useState("");
  const dentro = descendientes(edt, nodo.id);
  return (
    <>
      <Titulo>Paquete {fila?.numero}</Titulo>
      <Campo etiqueta="Nombre">
        <TextCommit value={nodo.nombre} onCommit={(v) => v.trim() && onCambiar({ nombre: v.trim().toUpperCase() })} style={{ ...baseInput, width: "100%" }} ariaLabel="Nombre del paquete" maxLength={300} />
      </Campo>
      <Campo etiqueta="Responsable (cuenta de control)">
        <TextCommit value={nodo.responsable} onCommit={(v) => onCambiar({ responsable: v.trim() })} placeholder="Quién responde por este paquete" style={{ ...baseInput, width: "100%" }} ariaLabel="Responsable" maxLength={120} />
      </Campo>
      <Campo etiqueta="Dentro de">
        <select value={nodo.padre ?? ""} disabled={!canEdit} onChange={(e) => onPadre(e.target.value || null)} style={{ ...baseInput, width: "100%" }} aria-label="Paquete que lo contiene">
          <option value="">(arriba, sin paquete)</option>
          {edt
            .filter((n) => !dentro.has(n.id))
            .map((n) => (
              <option key={n.id} value={n.id}>
                {rutaNodo(edt, n.id)}
              </option>
            ))}
        </select>
      </Campo>
      <Campo etiqueta="Ubicación en el modelo (sus actividades toman solo esos elementos)">
        {nodo.ubicacion.map((u, i) => (
          <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
            <span style={{ minWidth: 140 }}>{columnas.find((c) => c.id === u.columna)?.label ?? u.columna} =</span>
            <strong>{u.valor}</strong>
            {canEdit && (
              <button type="button" style={quitar} onClick={() => onCambiar({ ubicacion: nodo.ubicacion.filter((_, k) => k !== i) })} aria-label="Quitar filtro">
                ✕
              </button>
            )}
          </div>
        ))}
        {canEdit && columnas.length > 0 && nodo.ubicacion.length < 4 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select value={colNueva} onChange={(e) => setColNueva(e.target.value)} style={baseInput} aria-label="Columna de la ubicación">
              {columnas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <input value={valNuevo} onChange={(e) => setValNuevo(e.target.value)} placeholder={`Valor, o ${SIN_DATO}`} style={{ ...baseInput, flex: 1 }} aria-label="Valor de la ubicación" />
            <button
              type="button"
              style={botonSec}
              disabled={!valNuevo.trim() || !colNueva}
              onClick={() => {
                onCambiar({ ubicacion: [...nodo.ubicacion.filter((u) => u.columna !== colNueva), { columna: colNueva, valor: valNuevo.trim() }] });
                setValNuevo("");
              }}
            >
              Agregar
            </button>
          </div>
        )}
        {!columnas.length && <span style={{ color: "var(--tc-gray-500)" }}>Configura las columnas de la memoria de cantidades para filtrar por ubicación.</span>}
      </Campo>
      <div style={{ color: "var(--tc-gray-500)" }}>
        {directas} actividad(es) directas · costo {fmt(fila?.parcial ?? 0)}
        {fila && !fila.vacia ? ` · del ${fila.inicio.split("-").reverse().join("-")} al ${fila.fin.split("-").reverse().join("-")}` : ""}
      </div>
      {canEdit && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" style={botonSec} onClick={() => onMover(-1)}>
            ↑ Subir
          </button>
          <button type="button" style={botonSec} onClick={() => onMover(1)}>
            ↓ Bajar
          </button>
          <button type="button" style={botonSec} onClick={onSubpaquete}>
            + Subpaquete
          </button>
          <button type="button" style={botonSec} onClick={onActividad}>
            + Actividad aquí
          </button>
          <button type="button" style={{ ...botonSec, color: "#8a1c14", marginLeft: "auto" }} onClick={onEliminar}>
            Eliminar paquete
          </button>
        </div>
      )}
    </>
  );
}

function DetalleActividad({
  actividad,
  edt,
  partidas,
  asignadoDe,
  fila,
  canEdit,
  onCambiar,
  onEliminar,
}: {
  actividad: Actividad;
  edt: NodoEdt[];
  partidas: PartidaInfo[];
  asignadoDe: Map<string, number>;
  fila: Programado["filas"][number] | undefined;
  canEdit: boolean;
  onCambiar: (c: (a: Actividad) => Actividad) => void;
  onEliminar: () => void;
}) {
  const [buscar, setBuscar] = useState("");
  const porId = useMemo(() => new Map(partidas.map((p) => [p.id, p])), [partidas]);
  const opciones = buscar.trim() ? partidas.filter((p) => !actividad.asignaciones.some((a) => a.partida === p.id) && coincide(`${p.numero} ${p.descripcion}`, buscar)).slice(0, 12) : [];
  const setPct = (partida: string, pct: number) => onCambiar((a) => ({ ...a, asignaciones: a.asignaciones.map((x) => (x.partida === partida ? { ...x, pct: Math.round(Math.min(Math.max(pct, 0.0001), 100) * 10000) / 10000 } : x)) }));
  return (
    <>
      <Titulo>Actividad {fila?.numero}</Titulo>
      <Campo etiqueta="Nombre">
        <TextCommit value={actividad.nombre} onCommit={(v) => v.trim() && onCambiar((a) => ({ ...a, nombre: v.trim() }))} style={{ ...baseInput, width: "100%" }} ariaLabel="Nombre de la actividad" maxLength={300} />
      </Campo>
      <Campo etiqueta="Paquete">
        <select value={actividad.nodo} disabled={!canEdit} onChange={(e) => onCambiar((a) => ({ ...a, nodo: e.target.value }))} style={{ ...baseInput, width: "100%" }} aria-label="Paquete de la actividad">
          {edt.map((n) => (
            <option key={n.id} value={n.id}>
              {rutaNodo(edt, n.id)}
            </option>
          ))}
        </select>
      </Campo>
      <Campo etiqueta="Partidas que hace (su parte de la cantidad y del costo)">
        {actividad.asignaciones.length === 0 ? (
          <span style={{ color: "var(--tc-gray-500)" }}>Ninguna: es una actividad sin costo (un hito, un curado, un trámite).</span>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>Partida</th>
                <th style={{ ...th, width: 54 }}>Und.</th>
                <th style={{ ...th, width: 92 }}>%</th>
                <th style={{ ...th, width: 104 }}>Cantidad</th>
                <th style={{ ...th, width: 104 }}>Costo</th>
                <th style={{ ...th, width: 110 }} title="Lo que suman todas sus actividades">
                  Asignado en total
                </th>
                <th style={{ ...th, width: 30 }} />
              </tr>
            </thead>
            <tbody>
              {actividad.asignaciones.map((x) => {
                const p = porId.get(x.partida);
                const f = fila?.asignaciones.find((y) => y.partida === x.partida);
                const total = asignadoDe.get(x.partida) ?? 0;
                return (
                  <tr key={x.partida}>
                    <td style={td}>{p ? `${p.numero} ${p.descripcion}` : <span style={{ color: "#8a1c14" }}>Ya no está en el presupuesto</span>}</td>
                    <td style={{ ...td, textAlign: "center" }}>{p?.unidad}</td>
                    <td style={tdNum}>{canEdit ? <NumInput value={x.pct} decimals={4} ariaLabel={`% de ${p?.descripcion ?? x.partida}`} onCommit={(v) => v !== null && v > 0 && setPct(x.partida, v)} style={celda} /> : fmt(x.pct, 2)}</td>
                    <td style={tdNum}>
                      {canEdit && p && p.metrado > 0 ? (
                        <NumInput value={f?.cantidad ?? 0} decimals={4} ariaLabel={`Cantidad de ${p.descripcion}`} onCommit={(v) => v !== null && v > 0 && setPct(x.partida, (v / p.metrado) * 100)} style={celda} />
                      ) : (
                        fmt(f?.cantidad ?? 0, 2)
                      )}
                    </td>
                    <td style={tdNum}>{fmt(f?.parcial ?? 0)}</td>
                    <td style={{ ...tdNum, color: Math.abs(total - 100) > 1e-6 ? "#b06000" : "#1e6b2e" }}>{fmt(total, 2)} %</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      {canEdit && (
                        <button type="button" style={quitar} aria-label="Quitar partida" onClick={() => onCambiar((a) => ({ ...a, asignaciones: a.asignaciones.filter((y) => y.partida !== x.partida) }))}>
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {canEdit && (
          <div style={{ marginTop: 6 }}>
            <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Agregar una partida del presupuesto: busca por número o descripción" style={{ ...baseInput, width: "100%" }} aria-label="Buscar partida para agregar" />
            {opciones.map((p) => {
              const libre = Math.round((100 - (asignadoDe.get(p.id) ?? 0)) * 10000) / 10000;
              return (
                <button
                  key={p.id}
                  type="button"
                  style={opcion}
                  onClick={() => {
                    onCambiar((a) => ({ ...a, asignaciones: [...a.asignaciones, { partida: p.id, pct: libre > 0 ? libre : 100 }] }));
                    setBuscar("");
                  }}
                >
                  {p.numero} {p.descripcion} <span style={{ color: "var(--tc-gray-500)" }}>({p.unidad} · {libre > 0 ? `libre ${fmt(libre, 2)} %` : "ya asignada completa"})</span>
                </button>
              );
            })}
          </div>
        )}
      </Campo>
      {fila && (
        <div style={{ color: "var(--tc-gray-500)" }}>
          Duración {fmt(fila.duracion, 2)} día(s){fila.estimada ? " (estimada con la cantidad y el rendimiento)" : " (escrita a mano)"} · del {fila.inicio.split("-").reverse().join("-")} al{" "}
          {fila.fin.split("-").reverse().join("-")} · costo {fmt(fila.parcial)}. La duración, las cuadrillas y las predecesoras se editan en el Gantt.
        </div>
      )}
      {canEdit && (
        <div style={{ display: "flex" }}>
          <button type="button" style={{ ...botonSec, color: "#8a1c14", marginLeft: "auto" }} onClick={onEliminar}>
            Eliminar actividad
          </button>
        </div>
      )}
    </>
  );
}

function ReglaDel100({
  regla,
  canEdit,
  onCompletar,
  onVer,
}: {
  regla: ReturnType<typeof reglaDel100>;
  canEdit: boolean;
  onCompletar: (ids: Set<string> | null) => void;
  onVer: (actividad: string) => void;
}) {
  if (!regla.faltan.length && !regla.sobran.length) {
    return <Notice kind="info">Regla del 100 % completa: cada partida del presupuesto está asignada entera, y una sola vez, a las actividades.</Notice>;
  }
  return (
    <>
      <Titulo>Regla del 100 %</Titulo>
      <p style={{ margin: 0, color: "var(--tc-gray-500)" }}>
        Cada partida debe quedar asignada completa y una sola vez a las actividades: así el costo de la programación es igual al del presupuesto.
      </p>
      {regla.faltan.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <strong>Les falta ({regla.faltan.length})</strong>
            {canEdit && (
              <button type="button" style={{ ...botonSec, marginLeft: "auto" }} onClick={() => onCompletar(null)}>
                Crear actividades con todo lo que falta
              </button>
            )}
          </div>
          <TablaRegla filas={regla.faltan} accion={canEdit ? (f) => <button type="button" style={mini} onClick={() => onCompletar(new Set([f.partida]))}>Completar</button> : undefined} onVer={onVer} />
        </>
      )}
      {regla.sobran.length > 0 && (
        <>
          <strong>Asignadas de más ({regla.sobran.length}): baja el % en alguna de sus actividades</strong>
          <TablaRegla filas={regla.sobran} onVer={onVer} />
        </>
      )}
    </>
  );
}

function TablaRegla({ filas, accion, onVer }: { filas: ReturnType<typeof reglaDel100>["faltan"]; accion?: (f: ReturnType<typeof reglaDel100>["faltan"][number]) => ReactNode; onVer: (id: string) => void }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>
          <th style={th}>Partida</th>
          <th style={{ ...th, width: 100 }}>Metrado</th>
          <th style={{ ...th, width: 100 }}>Asignado</th>
          <th style={{ ...th, width: 120 }}>Actividades</th>
          {accion && <th style={{ ...th, width: 100 }} />}
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => (
          <tr key={f.partida}>
            <td style={td}>
              {f.numero} {f.descripcion}
            </td>
            <td style={tdNum}>
              {fmt(f.metrado)} {f.unidad}
            </td>
            <td style={{ ...tdNum, color: "#b06000" }}>{fmt(f.pct, 2)} %</td>
            <td style={td}>
              {f.actividades.slice(0, 3).map((id, i) => (
                <button key={id} type="button" style={linkBtn} onClick={() => onVer(id)}>
                  ver {i + 1}
                </button>
              ))}
            </td>
            {accion && <td style={{ ...td, textAlign: "center" }}>{accion(f)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------- splitting by location

function DividirDialog({
  prog,
  setProg,
  partidas,
  asignadoDe,
  preseleccion,
  padreInicial,
  api,
  columnas,
  onListo,
  onClose,
}: {
  prog: Programacion;
  setProg: (cambio: (p: Programacion) => Programacion) => void;
  partidas: PartidaInfo[];
  asignadoDe: Map<string, number>;
  preseleccion: string[];
  padreInicial: string | null;
  api: PresupuestoApi;
  columnas: ColumnaMemoria[];
  onListo: (texto: string) => void;
  onClose: () => void;
}) {
  const edt = prog.edt ?? [];
  const porId = useMemo(() => new Map(partidas.map((p) => [p.id, p])), [partidas]);
  const [elegidas, setElegidas] = useState<string[]>(() => [...new Set(preseleccion)].filter((id) => porId.has(id)));
  const [buscar, setBuscar] = useState("");
  const [origen, setOrigen] = useState<"modelo" | "manual">(columnas.length ? "modelo" : "manual");
  const [columna, setColumna] = useState(columnas.find((c) => /nivel|piso|level/i.test(c.label))?.id ?? columnas[0]?.id ?? "");
  const [nombres, setNombres] = useState("PISO 1\nPISO 2\nPISO 3");
  const [delModelo, setDelModelo] = useState<{ clave: string; ubicaciones: Ubicacion[]; sinElementos: string[] } | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState("");
  const [padre, setPadre] = useState(padreInicial ?? edt[0]?.id ?? "");
  const [nodoPorUbicacion, setNodoPorUbicacion] = useState(true);
  const [enCada, setEnCada] = useState(true);
  const [desfaseCada, setDesfaseCada] = useState(0);
  const [entre, setEntre] = useState(true);
  const [desfaseEntre, setDesfaseEntre] = useState(0);
  const [invertir, setInvertir] = useState(false);
  const clave = `${columna}|${elegidas.join(",")}`;

  async function leer() {
    setLeyendo(true);
    setError("");
    try {
      const elementos = await api.elementosDe({ itemIds: elegidas });
      setDelModelo({ clave, ...repartoDelModelo(elementos, elegidas, columna) });
    } catch (err) {
      setError(message(err));
    } finally {
      setLeyendo(false);
    }
  }

  const base: Ubicacion[] = origen === "modelo" ? (delModelo?.clave === clave ? delModelo.ubicaciones : []) : repartoIgual(nombres.split("\n"), elegidas);
  const ubicaciones = invertir ? [...base].reverse() : base;
  const opciones = buscar.trim() ? partidas.filter((p) => !elegidas.includes(p.id) && coincide(`${p.numero} ${p.descripcion}`, buscar)).slice(0, 12) : [];
  const actividadesDe = (id: string) => (prog.actividades ?? []).filter((a) => a.asignaciones.some((x) => x.partida === id)).length;
  const reemplazadas = new Set((prog.actividades ?? []).filter((a) => a.asignaciones.some((x) => elegidas.includes(x.partida))).map((a) => a.id)).size;
  const creadas = ubicaciones.reduce((s, u) => s + elegidas.filter((p) => u.pcts[p]).length, 0);
  const incompletas = elegidas.filter((p) => Math.abs((asignadoDe.get(p) ?? 0) - 100) > 1e-6);
  const mover = (i: number, dir: -1 | 1) =>
    setElegidas((l) => {
      const j = i + dir;
      if (j < 0 || j >= l.length) return l;
      const x = [...l];
      [x[i], x[j]] = [x[j], x[i]];
      return x;
    });

  function aplicar() {
    let r: ReturnType<typeof dividirPorUbicacion> | null = null;
    setProg((x) => {
      r = dividirPorUbicacion(x, {
        partidas: elegidas.map((id) => ({ id, descripcion: porId.get(id)!.descripcion })),
        ubicaciones,
        columna: origen === "modelo" ? columna : null,
        padre,
        nodoPorUbicacion,
        enCadaUbicacion: enCada ? { desfase: desfaseCada } : null,
        entreUbicaciones: entre ? { desfase: desfaseEntre } : null,
      });
      return r.prog;
    });
    const hecho = r as ReturnType<typeof dividirPorUbicacion> | null;
    onListo(`${hecho?.creadas ?? creadas} actividad(es) creadas en ${ubicaciones.length} ubicación(es); ${hecho?.reemplazadas ?? reemplazadas} actividad(es) anteriores reemplazadas. Revisa el Gantt y guarda la programación.`);
  }

  return (
    <Modal
      title="Dividir partidas por ubicación"
      onClose={onClose}
      width={1080}
      height="92vh"
      footer={
        <>
          <span style={{ marginRight: "auto", fontSize: 13, color: "var(--tc-gray-700)" }}>
            {creadas ? `Se crean ${creadas} actividad(es) y se reemplazan ${reemplazadas}.` : "Elige partidas y ubicaciones."}
          </span>
          <button type="button" style={{ ...acceptButton, ...(!creadas || !padre ? apagado : {}) }} disabled={!creadas || !padre} onClick={aplicar}>
            Dividir
          </button>
        </>
      }
    >
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5, overflow: "auto" }}>
        <Seccion titulo="1. Partidas, en el orden en que se hacen en cada ubicación">
          {elegidas.map((id, i) => {
            const p = porId.get(id)!;
            return (
              <div key={id} style={{ display: "flex", gap: 6, alignItems: "center", padding: "2px 0" }}>
                <span style={{ width: 22, color: "var(--tc-gray-500)" }}>{i + 1}.</span>
                <span style={{ flex: 1 }}>
                  {p.numero} {p.descripcion} <span style={{ color: "var(--tc-gray-500)" }}>({fmt(p.metrado)} {p.unidad} · hoy en {actividadesDe(id)} actividad(es))</span>
                </span>
                <button type="button" style={mini} onClick={() => mover(i, -1)} aria-label="Subir">
                  ↑
                </button>
                <button type="button" style={mini} onClick={() => mover(i, 1)} aria-label="Bajar">
                  ↓
                </button>
                <button type="button" style={quitar} onClick={() => setElegidas((l) => l.filter((x) => x !== id))} aria-label="Quitar">
                  ✕
                </button>
              </div>
            );
          })}
          <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Agregar partidas: busca por número o descripción" style={{ ...baseInput, width: "100%", marginTop: 6 }} aria-label="Buscar partida" />
          {opciones.map((p) => (
            <button key={p.id} type="button" style={opcion} onClick={() => setElegidas((l) => [...l, p.id])}>
              {p.numero} {p.descripcion} <span style={{ color: "var(--tc-gray-500)" }}>({p.capitulo})</span>
            </button>
          ))}
          {incompletas.length > 0 && (
            <Notice kind="warning" style={{ marginTop: 6 }}>
              {incompletas.length} de estas partidas no están asignadas al 100 % ahora: se reparte la partida completa entre las ubicaciones.
            </Notice>
          )}
        </Seccion>

        <Seccion titulo="2. Ubicaciones">
          <label style={{ display: "block" }}>
            <input type="radio" checked={origen === "modelo"} disabled={!columnas.length} onChange={() => setOrigen("modelo")} /> Del modelo 3D: los elementos asociados a cada partida, según la columna{" "}
            <select value={columna} onChange={(e) => setColumna(e.target.value)} style={baseInput} aria-label="Columna de la memoria de cantidades" disabled={origen !== "modelo"}>
              {columnas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>{" "}
            <button type="button" style={botonSec} disabled={origen !== "modelo" || !elegidas.length || leyendo} onClick={leer}>
              {leyendo ? "Leyendo..." : "Leer los elementos"}
            </button>
          </label>
          <label style={{ display: "block", marginTop: 6 }}>
            <input type="radio" checked={origen === "manual"} onChange={() => setOrigen("manual")} /> Escritas a mano, una por línea (cada partida se reparte en partes iguales; luego ajustas el % de cada actividad)
          </label>
          {origen === "manual" && <textarea value={nombres} onChange={(e) => setNombres(e.target.value)} style={{ ...baseInput, width: 320, minHeight: 90, marginTop: 4 }} aria-label="Ubicaciones" />}
          {error && <Notice kind="error">{error}</Notice>}
          {origen === "modelo" && delModelo?.clave === clave && (
            <>
              {delModelo.sinElementos.length > 0 && (
                <Notice kind="warning" style={{ marginTop: 6 }}>
                  {delModelo.sinElementos.length} partida(s) no tienen elementos asociados en el modelo y no se dividen: {delModelo.sinElementos.map((id) => porId.get(id)?.descripcion).join(" · ")}. Asócialas en el
                  visor o escribe las ubicaciones a mano.
                </Notice>
              )}
              {delModelo.ubicaciones.some((u) => u.valor === SIN_DATO) && (
                <Notice kind="warning" style={{ marginTop: 6 }}>
                  Hay elementos sin dato en esa columna: van a «{SIN_DATO}». Usa «Actualizar la memoria» en el visor si la columna se agregó después de asociarlos.
                </Notice>
              )}
            </>
          )}
          <label style={{ display: "block", marginTop: 6 }}>
            <input type="checkbox" checked={invertir} onChange={(e) => setInvertir(e.target.checked)} /> Invertir el orden (de arriba hacia abajo)
          </label>
        </Seccion>

        <Seccion titulo="3. Dónde y cómo encadenar">
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            <label>
              Dentro de{" "}
              <select value={padre} onChange={(e) => setPadre(e.target.value)} style={{ ...baseInput, minWidth: 260 }} aria-label="Paquete donde van">
                {edt.map((n) => (
                  <option key={n.id} value={n.id}>
                    {rutaNodo(edt, n.id)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input type="checkbox" checked={nodoPorUbicacion} onChange={(e) => setNodoPorUbicacion(e.target.checked)} /> Un paquete por ubicación (con su filtro del modelo)
            </label>
          </div>
          <label style={{ display: "block", marginTop: 6 }}>
            <input type="checkbox" checked={enCada} onChange={(e) => setEnCada(e.target.checked)} /> En cada ubicación, cada partida después de la anterior (fin a comienzo), con{" "}
            <NumInput value={desfaseCada} decimals={1} onCommit={(v) => setDesfaseCada(v ?? 0)} style={{ width: 60 }} ariaLabel="Desfase dentro de cada ubicación" /> día(s) de espera
          </label>
          <label style={{ display: "block", marginTop: 4 }}>
            <input type="checkbox" checked={entre} onChange={(e) => setEntre(e.target.checked)} /> Cada partida, de una ubicación a la siguiente (el tren), con{" "}
            <NumInput value={desfaseEntre} decimals={1} onCommit={(v) => setDesfaseEntre(v ?? 0)} style={{ width: 60 }} ariaLabel="Desfase entre ubicaciones" /> día(s) de espera
          </label>
        </Seccion>

        {ubicaciones.length > 0 && elegidas.length > 0 && (
          <Seccion titulo={`Vista previa: ${ubicaciones.length} ubicación(es)`}>
            <div style={{ overflow: "auto", maxHeight: 280 }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr>
                    <th style={th}>Ubicación</th>
                    {elegidas.map((id) => (
                      <th key={id} style={{ ...th, maxWidth: 160 }} title={porId.get(id)?.descripcion}>
                        {porId.get(id)?.numero}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ubicaciones.map((u) => (
                    <tr key={u.valor}>
                      <td style={td}>{u.valor}</td>
                      {elegidas.map((id) => {
                        const pct = u.pcts[id];
                        const p = porId.get(id)!;
                        return (
                          <td key={id} style={tdNum}>
                            {pct ? `${fmt(pct, 2)} % · ${fmt((p.metrado * pct) / 100)} ${p.unidad}` : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Seccion>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- the assistant

function ProgramaIADialog({
  prog,
  setProg,
  res,
  api,
  projectId,
  alcanceInicial,
  onClose,
}: {
  prog: Programacion;
  setProg: (cambio: (p: Programacion) => Programacion) => void;
  res: Programado;
  api: PresupuestoApi;
  projectId: string;
  alcanceInicial: string | null;
  onClose: () => void;
}) {
  const edt = prog.edt ?? [];
  const [estado, setEstado] = useState<EstadoIAResponse | null>(null);
  const [alcance, setAlcance] = useState<string | null>(alcanceInicial);
  const [contexto, setContexto] = useState(() => {
    try {
      return localStorage.getItem(`presupuesto.ia.contexto.${projectId}`) ?? "";
    } catch {
      return "";
    }
  });
  const [borrador, setBorrador] = useState<BorradorProgramaIA | null>(null);
  const [usarPaquete, setUsarPaquete] = useState<Set<string>>(new Set());
  const [usarPred, setUsarPred] = useState<Set<string>>(new Set());
  const [reemplazar, setReemplazar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [nota, setNota] = useState<{ kind: "info" | "warning" | "error"; texto: string } | null>(null);

  useEffect(() => {
    api.getEstadoIA().then(setEstado, (err) => setNota({ kind: "error", texto: message(err) }));
  }, [api]);

  const filas = res.filas.filter((f) => f.tipo === "partida" && (!alcance || f.ancestros.includes(alcance)));
  const nombres = new Map(res.filas.map((f) => [f.id, `${f.numero} ${f.descripcion}`]));
  const bloqueo = estado ? bloqueadoPor(estado) : "";
  const estimado = estado ? estimarCostoCop(estado.modelo, SISTEMA_PROGRAMA.length + filas.length * 160, filas.length * 70 + 2000, estado.cupo.trm) : 0;

  async function proponer() {
    setOcupado(true);
    setNota(null);
    try {
      localStorage.setItem(`presupuesto.ia.contexto.${projectId}`, contexto);
    } catch {
      // storage unavailable
    }
    try {
      const r = await conReintento(() =>
        api.generarProgramaIA({
          contexto,
          alcance,
          actividades: filas.map((f) => ({ id: f.id, nombre: f.descripcion, unidad: f.unidad, cantidad: f.metrado, duracion: f.duracion, ruta: rutaNodo(edt, f.ancestros[f.ancestros.length - 1] ?? "") })),
        })
      );
      setBorrador(r.borrador);
      setUsarPaquete(new Set(r.borrador.propuesta.actividades.filter((a) => a.paquete.length).map((a) => a.id)));
      setUsarPred(new Set(r.borrador.propuesta.actividades.filter((a) => a.predecesoras.length).map((a) => a.id)));
      if (estado) setEstado({ ...estado, cupo: r.cupo });
      setNota({ kind: "info", texto: `Propuesta lista por ${fmtCop(r.costoCop)}${r.faltantes.length ? `; ${r.faltantes.length} actividad(es) quedaron sin propuesta` : ""}. Revísala y aplica lo que sirva.` });
    } catch (err) {
      setNota({ kind: "error", texto: message(err) });
    } finally {
      setOcupado(false);
    }
  }

  async function decidir(aceptar: boolean) {
    if (!borrador) return;
    setOcupado(true);
    try {
      if (aceptar) {
        const cambios = borrador.propuesta.actividades.map((a) => ({ id: a.id, paquete: usarPaquete.has(a.id) ? a.paquete : null, predecesoras: usarPred.has(a.id) ? a.predecesoras : null }));
        let r: ReturnType<typeof aplicarPrograma> | null = null;
        setProg((x) => {
          r = aplicarPrograma(x, borrador.propuesta.alcance, cambios, reemplazar);
          return r.prog;
        });
        await api.decidirBorradoresIA([
          {
            id: borrador.id,
            estado: "aceptado",
            final: { alcance: borrador.propuesta.alcance, actividades: cambios.map((c) => ({ id: c.id, paquete: c.paquete ?? [], predecesoras: c.predecesoras ?? [] })) },
          },
        ]);
        const hecho = r as ReturnType<typeof aplicarPrograma> | null;
        setNota({
          kind: "info",
          texto: `Aplicado: ${hecho?.movidas ?? 0} actividad(es) movidas de paquete y ${hecho?.enlaces ?? 0} enlace(s) nuevos${hecho?.descartados ? `; ${hecho.descartados} se descartaron porque cerraban un ciclo` : ""}. Revisa el Gantt y guarda.`,
        });
      } else {
        await api.decidirBorradoresIA([{ id: borrador.id, estado: "rechazado" }]);
        setNota({ kind: "info", texto: "Propuesta descartada." });
      }
      setBorrador(null);
    } catch (err) {
      setNota({ kind: "error", texto: message(err) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal title="Proponer paquetes y secuencia con IA" onClose={onClose} width={1100} height="92vh">
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, fontSize: 13.5, overflow: "auto" }}>
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          El asistente agrupa las actividades en paquetes de trabajo (por entregable y ubicación) y propone sus predecesoras con la lógica constructiva
          colombiana. No cambia duraciones ni costos. Se envían el nombre, la unidad, la cantidad, la duración y el paquete actual de cada actividad, y la
          descripción del proyecto; no se envían precios.
        </p>
        {estado && bloqueo && <Notice kind="error">{bloqueo}</Notice>}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label>
            Alcance{" "}
            <select value={alcance ?? ""} onChange={(e) => setAlcance(e.target.value || null)} style={{ ...baseInput, minWidth: 280 }} aria-label="Alcance">
              <option value="">Toda la programación</option>
              {edt.map((n) => (
                <option key={n.id} value={n.id}>
                  {rutaNodo(edt, n.id)}
                </option>
              ))}
            </select>
          </label>
          <span style={{ color: filas.length > MAX_ACTIVIDADES_PROGRAMA_IA ? "#8a1c14" : "var(--tc-gray-500)" }}>
            {filas.length} actividad(es){filas.length > MAX_ACTIVIDADES_PROGRAMA_IA ? ` (máximo ${MAX_ACTIVIDADES_PROGRAMA_IA}: elige un paquete más pequeño)` : ""} · costo estimado {fmtCop(estimado)}
          </span>
        </div>
        <label>
          <span style={{ display: "block", fontSize: 13, color: "var(--tc-gray-500)", marginBottom: 4 }}>Descripción del proyecto (opcional)</span>
          <textarea value={contexto} maxLength={2000} onChange={(e) => setContexto(e.target.value)} style={{ ...baseInput, width: "100%", minHeight: 54 }} aria-label="Descripción del proyecto" />
        </label>
        <div>
          <button
            type="button"
            style={{ ...acceptButton, ...(!estado || bloqueo || ocupado || !filas.length || filas.length > MAX_ACTIVIDADES_PROGRAMA_IA ? apagado : {}) }}
            disabled={!estado || !!bloqueo || ocupado || !filas.length || filas.length > MAX_ACTIVIDADES_PROGRAMA_IA}
            onClick={proponer}
          >
            {ocupado && !borrador ? "Proponiendo..." : "Proponer"}
          </button>
        </div>
        {nota && <Notice kind={nota.kind}>{nota.texto}</Notice>}
        {borrador && (
          <>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <label>
                <input type="checkbox" checked={reemplazar} onChange={(e) => setReemplazar(e.target.checked)} /> Reemplazar las predecesoras actuales (si no, se agregan a las que ya tienen)
              </label>
              <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <button type="button" style={{ ...acceptButton, padding: "6px 14px", fontSize: 14 }} disabled={ocupado} onClick={() => decidir(true)}>
                  Aplicar lo marcado
                </button>
                <button type="button" style={{ ...botonSec, color: "#8a1c14" }} disabled={ocupado} onClick={() => decidir(false)}>
                  Descartar
                </button>
              </span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>Actividad</th>
                  <th style={th}>Paquete propuesto</th>
                  <th style={th}>Predecesoras propuestas</th>
                </tr>
              </thead>
              <tbody>
                {borrador.propuesta.actividades.map((a) => (
                  <tr key={a.id} style={{ verticalAlign: "top" }}>
                    <td style={td}>{nombres.get(a.id) ?? a.id}</td>
                    <td style={td}>
                      {a.paquete.length ? (
                        <label>
                          <input type="checkbox" checked={usarPaquete.has(a.id)} onChange={(e) => setUsarPaquete((s) => alternar(s, a.id, e.target.checked))} /> {a.paquete.join(" > ")}
                        </label>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={td}>
                      {a.predecesoras.length ? (
                        <label>
                          <input type="checkbox" checked={usarPred.has(a.id)} onChange={(e) => setUsarPred((s) => alternar(s, a.id, e.target.checked))} />{" "}
                          {a.predecesoras.map((d) => `${nombres.get(d.id) ?? d.id} (${textoDependencia(d, 0).replace(/^0/, "") || "FC"})`).join(" · ")}
                        </label>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </Modal>
  );
}

function alternar(s: Set<string>, id: string, si: boolean): Set<string> {
  const x = new Set(s);
  if (si) x.add(id);
  else x.delete(id);
  return x;
}

// ---------------------------------------------------------------- small pieces

function Titulo({ children }: { children: ReactNode }) {
  return <div style={{ fontWeight: 700, fontSize: 15 }}>{children}</div>;
}

function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 12.5, color: "var(--tc-gray-500)", marginBottom: 4 }}>{etiqueta}</span>
      {children}
    </label>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: "8px 12px 12px", margin: 0, background: "#fff" }}>
      <legend style={{ fontSize: 13.5, fontWeight: 600, padding: "0 6px" }}>{titulo}</legend>
      {children}
    </fieldset>
  );
}

const th: CSSProperties = { padding: "4px 6px", fontWeight: 600, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.grid}`, textAlign: "center", background: "#f3f4f6", fontSize: 12.5 };
const td: CSSProperties = { padding: "3px 6px", borderBottom: `1px solid ${C.grid}`, borderRight: `1px solid ${C.grid}` };
const tdNum: CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const celda: CSSProperties = { width: "100%", padding: "2px 6px", fontSize: 13, textAlign: "right" };
const chip: CSSProperties = { display: "inline-block", borderRadius: 10, padding: "0 7px", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" };
const botonSec: CSSProperties = { border: `1px solid ${C.border}`, background: "#fff", borderRadius: 4, padding: "5px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 13 };
const mini: CSSProperties = { border: `1px solid ${C.border}`, background: "#fff", borderRadius: 3, padding: "1px 7px", cursor: "pointer", fontFamily: "inherit", fontSize: 12 };
const quitar: CSSProperties = { border: "none", background: "transparent", color: "#b3261e", cursor: "pointer", fontSize: 13, fontFamily: "inherit" };
const plegar: CSSProperties = { border: "none", background: "transparent", cursor: "pointer", fontSize: 10, width: 14, padding: 0, color: "var(--tc-gray-500)" };
const opcion: CSSProperties = { display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: `1px solid ${C.grid}`, background: "#fff", padding: "4px 6px", cursor: "pointer", fontFamily: "inherit", fontSize: 13 };
const linkBtn: CSSProperties = { border: "none", background: "transparent", color: "var(--tc-blue-700)", textDecoration: "underline", cursor: "pointer", padding: "0 4px", fontFamily: "inherit", fontSize: 12.5 };
const apagado: CSSProperties = { opacity: 0.45, cursor: "not-allowed" };
