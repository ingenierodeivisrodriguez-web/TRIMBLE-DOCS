"use client";

import { CSSProperties, ReactNode, useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { parseDisplayDate, parseNumberInput } from "../../lib/propiedades/values";
import type { Resolver } from "../../lib/presupuesto/calc";
import { agregarEspeciales, DIAS_SEMANA, diaSemana, fechaCorta, festivosColombia, sumarDias } from "../../lib/presupuesto/calendario";
import { exportarExcel, nombreSeguro } from "../../lib/presupuesto/excel";
import { fmt } from "../../lib/presupuesto/format";
import {
  calendarioInsumos,
  calendarioValorizado,
  creaCiclo,
  curvaS,
  estimarDuracion,
  FilaGantt,
  Programado,
  REDONDEO_NOMBRES,
  TipoPeriodo,
} from "../../lib/presupuesto/programacion";
import { tablaCalendarioInsumos, tablaCalendarioValorizado, tablaCurvaS } from "../../lib/presupuesto/reportes";
import {
  CalendarioLaboral,
  Dependencia,
  DiaEspecial,
  PresupuestoDoc,
  Programacion,
  RedondeoDuracion,
  TareaProgramada,
  TIPO_DEPENDENCIA_NOMBRES,
  TipoDependencia,
  TIPOS_DEPENDENCIA,
} from "../../lib/presupuesto/types";
import DateField from "../propiedades/DateField";
import { acceptButton, baseInput, C, labelStyle, message, Modal, Notice, NumInput, Square, TextCommit } from "./ui";

/** A DD-MM-AAAA date field that reports a date (ISO) once what is typed is a real date. */
export function FechaCampo({
  id,
  value,
  onChange,
  allowEmpty,
  width = 150,
  placeholder = "DD-MM-AAAA",
}: {
  id: string;
  value: string | null;
  onChange: (fecha: string | null) => void;
  allowEmpty?: boolean;
  width?: number;
  placeholder?: string;
}) {
  const [text, setText] = useState(value ? fechaCorta(value) : "");
  useEffect(() => setText(value ? fechaCorta(value) : ""), [value]);
  const invalid = text.trim() !== "" && !parseDisplayDate(text);
  return (
    <div style={{ width }}>
      <DateField
        id={id}
        text={text}
        placeholder={placeholder}
        invalid={invalid}
        onText={(t) => {
          setText(t);
          const iso = parseDisplayDate(t);
          if (iso && iso !== value) onChange(iso);
          else if (allowEmpty && t.trim() === "" && value !== null) onChange(null);
        }}
      />
    </div>
  );
}

function Seccion({ titulo, children, extra }: { titulo: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <fieldset style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: "8px 12px 12px", margin: 0, background: "#fff" }}>
      <legend style={{ fontSize: 13.5, fontWeight: 600, padding: "0 6px", color: "var(--tc-gray-700)" }}>
        {titulo}
        {extra}
      </legend>
      {children}
    </fieldset>
  );
}

// ---------------------------------------------------------------- working calendar

export function CalendarioDialog({
  calendario,
  inicio,
  fin,
  editable,
  onAccept,
  onClose,
}: {
  calendario: CalendarioLaboral;
  inicio: string;
  fin: string;
  editable: boolean;
  onAccept: (c: CalendarioLaboral) => void;
  onClose: () => void;
}) {
  const [cal, setCal] = useState<CalendarioLaboral>(() => structuredClone(calendario));
  const anioInicio = +inicio.slice(0, 4);
  const anios = Array.from({ length: Math.min(Math.max(+fin.slice(0, 4) - anioInicio + 2, 2), 12) }, (_, i) => anioInicio + i);
  const [anio, setAnio] = useState(anioInicio);
  const [nota, setNota] = useState("");
  const repetidas = new Set(cal.especiales.map((d) => d.fecha).filter((f, i, all) => all.indexOf(f) !== i));
  const error = !cal.horasSemana.some((h) => h > 0)
    ? "Al menos un día de la semana debe tener horas de trabajo."
    : repetidas.size
      ? `Hay fechas repetidas: ${[...repetidas].map(fechaCorta).join(", ")}.`
      : !(cal.jornada > 0)
        ? "La jornada debe tener horas."
        : "";
  const semana = cal.horasSemana.reduce((a, b) => a + b, 0);
  const setEspecial = (i: number, cambio: Partial<DiaEspecial>) => setCal((c) => ({ ...c, especiales: c.especiales.map((d, k) => (k === i ? { ...d, ...cambio } : d)) }));

  return (
    <Modal
      title="Calendario laboral"
      onClose={onClose}
      width={820}
      height="88vh"
      footer={
        <>
          {error && <span style={{ color: "#8a1c14", fontSize: 13, marginRight: "auto" }}>{error}</span>}
          <button type="button" style={acceptButton} disabled={!editable || !!error} onClick={() => onAccept({ ...cal, especiales: [...cal.especiales].sort((a, b) => a.fecha.localeCompare(b.fecha)) })}>
            Aceptar
          </button>
        </>
      }
    >
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
        <Seccion titulo="Horas de trabajo de cada día de la semana">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
            {DIAS_SEMANA.map((d, i) => (
              <label key={d} style={{ fontSize: 13 }}>
                <span style={labelStyle}>{d}</span>
                <NumInput
                  value={cal.horasSemana[i]}
                  decimals={Number.isInteger(cal.horasSemana[i]) ? 0 : 1}
                  ariaLabel={`Horas del ${d.toLowerCase()}`}
                  readOnly={!editable}
                  onCommit={(v) => setCal((c) => ({ ...c, horasSemana: c.horasSemana.map((h, k) => (k === i ? Math.min(v ?? 0, 24) : h)) }))}
                  style={{ width: "100%" }}
                />
              </label>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13.5, flexWrap: "wrap" }}>
            <span>
              Total semanal: <strong>{fmt(semana, Number.isInteger(semana) ? 0 : 1)} h</strong>. Un día de duración equivale a
            </span>
            <NumInput
              value={cal.jornada}
              decimals={Number.isInteger(cal.jornada) ? 0 : 1}
              ariaLabel="Horas de una jornada"
              readOnly={!editable}
              onCommit={(v) => v && v > 0 && setCal((c) => ({ ...c, jornada: Math.min(v, 24) }))}
              style={{ width: 70 }}
            />
            <span>horas: un sábado de 4 h cuenta medio día.</span>
          </div>
        </Seccion>

        <Seccion titulo={`Días especiales (${cal.especiales.length})`}>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--tc-gray-500)" }}>
            Festivos (0 horas) y días con otro horario. Valen por encima de las horas de la semana.
          </p>
          {editable && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <button
                type="button"
                style={botonSec}
                onClick={() => {
                  const usadas = new Set(cal.especiales.map((d) => d.fecha));
                  let f = cal.especiales.length ? sumarDias(cal.especiales[cal.especiales.length - 1].fecha, 1) : inicio;
                  while (usadas.has(f)) f = sumarDias(f, 1);
                  setCal((c) => ({ ...c, especiales: [...c.especiales, { fecha: f, horas: 0, nombre: "" }] }));
                }}
              >
                + Agregar día
              </button>
              <span style={{ marginLeft: 12, fontSize: 13 }}>Festivos de Colombia de</span>
              <select value={anio} onChange={(e) => setAnio(+e.target.value)} style={{ ...baseInput, width: 90 }} aria-label="Año de los festivos">
                {anios.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <button
                type="button"
                style={botonSec}
                onClick={() => {
                  const r = agregarEspeciales(cal.especiales, festivosColombia(anio));
                  setCal((c) => ({ ...c, especiales: r.especiales }));
                  setNota(r.agregados ? `Se agregaron ${r.agregados} festivos de ${anio}.` : `Los festivos de ${anio} ya estaban.`);
                }}
              >
                Agregar
              </button>
              {nota && <span style={{ fontSize: 12.5, color: "var(--tc-blue-800)" }}>{nota}</span>}
            </div>
          )}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={th}>Fecha</th>
                <th style={th}>Día</th>
                <th style={th}>Horas</th>
                <th style={th}>Nombre</th>
                <th style={{ ...th, width: 30 }} />
              </tr>
            </thead>
            <tbody>
              {cal.especiales.map((d, i) => (
                <tr key={i} style={{ background: repetidas.has(d.fecha) ? "#fdecea" : undefined }}>
                  <td style={td}>
                    {editable ? <FechaCampo id={`especial-${i}`} value={d.fecha} onChange={(f) => f && setEspecial(i, { fecha: f })} width={160} /> : fechaCorta(d.fecha)}
                  </td>
                  <td style={{ ...td, color: "var(--tc-gray-500)" }}>{DIAS_SEMANA[diaSemana(d.fecha)]}</td>
                  <td style={{ ...td, width: 90 }}>
                    <NumInput value={d.horas} decimals={Number.isInteger(d.horas) ? 0 : 1} readOnly={!editable} ariaLabel={`Horas del ${fechaCorta(d.fecha)}`} onCommit={(v) => setEspecial(i, { horas: Math.min(v ?? 0, 24) })} style={{ width: "100%" }} />
                  </td>
                  <td style={td}>
                    {editable ? (
                      <TextCommit value={d.nombre} maxLength={80} placeholder={d.horas === 0 ? "Festivo" : "Horario especial"} onCommit={(t) => setEspecial(i, { nombre: t.trim() })} style={{ width: "100%" }} />
                    ) : (
                      d.nombre
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    {editable && (
                      <button type="button" aria-label={`Quitar el ${fechaCorta(d.fecha)}`} onClick={() => setCal((c) => ({ ...c, especiales: c.especiales.filter((_, k) => k !== i) }))} style={quitar}>
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {cal.especiales.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...td, color: "var(--tc-gray-500)", padding: 10 }}>
                    Sin días especiales.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Seccion>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- estimate durations

export function EstimarDialog({
  res,
  prog,
  editable,
  onAccept,
  onClose,
}: {
  res: Programado;
  prog: Programacion;
  editable: boolean;
  onAccept: (redondeo: RedondeoDuracion, reemplazar: boolean) => void;
  onClose: () => void;
}) {
  const [redondeo, setRedondeo] = useState<RedondeoDuracion>(prog.redondeo);
  const [reemplazar, setReemplazar] = useState(false);
  const jornada = prog.calendario.jornada;
  const filas = useMemo(
    () =>
      res.filas
        .filter((f) => f.tipo === "partida")
        .map((f) => {
          const est = estimarDuracion({ metrado: f.metrado, rendimiento: f.rendimiento ?? 0, jornada: f.item?.jornada ?? jornada }, f.cuadrillas, jornada, redondeo);
          const queda = est === null || (!f.estimada && !reemplazar) ? f.duracion : est;
          return { f, est, queda };
        }),
    [res, redondeo, reemplazar, jornada]
  );
  const manuales = filas.filter((x) => !x.f.estimada).length;
  const sinDatos = filas.filter((x) => x.est === null).length;
  const cambian = filas.filter((x) => x.queda !== x.f.duracion).length;
  const d = (n: number | null) => (n === null ? "—" : fmt(n, Number.isInteger(n) ? 0 : 2));

  return (
    <Modal
      title="Estimar duración"
      onClose={onClose}
      width={1040}
      height="88vh"
      footer={
        <>
          <span style={{ fontSize: 13, marginRight: "auto", color: "var(--tc-gray-700)" }}>{cambian ? `Cambia la duración de ${cambian} partida(s).` : "Ninguna duración cambia."}</span>
          <button type="button" style={acceptButton} disabled={!editable} onClick={() => onAccept(redondeo, reemplazar)}>
            Aplicar
          </button>
        </>
      }
    >
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10, minHeight: 0, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 13.5 }}>
          Duración = <strong>metrado ÷ (rendimiento × cuadrillas)</strong>, en días de {fmt(jornada, 0)} h. El rendimiento es por jornada de cada partida (normalmente 8 h), así que
          una partida de jornada 10 h rinde más por día de calendario. Las partidas sin metrado o sin rendimiento se quedan como están ({sinDatos}).
        </p>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13.5 }}>
          <div role="radiogroup" aria-label="Redondeo">
            <span style={labelStyle}>Redondeo</span>
            {(Object.keys(REDONDEO_NOMBRES) as RedondeoDuracion[]).map((r) => (
              <label key={r} style={{ display: "block" }}>
                <input type="radio" name="redondeo" checked={redondeo === r} onChange={() => setRedondeo(r)} /> {REDONDEO_NOMBRES[r]}
              </label>
            ))}
          </div>
          <div role="radiogroup" aria-label="Qué partidas">
            <span style={labelStyle}>Qué partidas</span>
            <label style={{ display: "block" }}>
              <input type="radio" name="alcance" checked={!reemplazar} onChange={() => setReemplazar(false)} /> Solo las que no tienen duración escrita a mano
            </label>
            <label style={{ display: "block" }}>
              <input type="radio" name="alcance" checked={reemplazar} onChange={() => setReemplazar(true)} /> Todas: reemplaza las {manuales} escritas a mano
            </label>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 200, overflow: "auto", border: `1px solid ${C.border}`, background: "#fff" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ position: "sticky", top: 0 }}>
              <tr>
                <th style={th}>Fila</th>
                <th style={th}>Item</th>
                <th style={th}>Partida</th>
                <th style={th}>Metrado</th>
                <th style={th}>Rendimiento</th>
                <th style={th}>Jornada (h)</th>
                <th style={th}>Cuadrillas</th>
                <th style={th}>Actual</th>
                <th style={th}>Estimada</th>
                <th style={th}>Queda</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(({ f, est, queda }) => (
                <tr key={f.id} style={{ background: queda !== f.duracion ? "#fff7e0" : undefined }}>
                  <td style={tdNum}>{f.fila}</td>
                  <td style={td}>{f.numero}</td>
                  <td style={{ ...td, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.descripcion}>
                    {f.descripcion}
                  </td>
                  <td style={tdNum}>{f.metrado !== null ? fmt(f.metrado) : "—"}</td>
                  <td style={tdNum}>{f.rendimiento !== null ? fmt(f.rendimiento) : "—"}</td>
                  <td style={tdNum}>{fmt(f.item?.jornada ?? jornada, 0)}</td>
                  <td style={tdNum}>{fmt(f.cuadrillas, 0)}</td>
                  <td style={{ ...tdNum, fontWeight: f.estimada ? 400 : 700 }} title={f.estimada ? "Estimada" : "Escrita a mano"}>
                    {d(f.duracion)}
                  </td>
                  <td style={tdNum}>{d(est)}</td>
                  <td style={{ ...tdNum, fontWeight: 700 }}>{d(queda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- one task

function DesfaseInput({ value, onCommit, ariaLabel }: { value: number; onCommit: (n: number) => void; ariaLabel: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={text ?? String(value).replace(".", ",")}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text === null) return;
        const n = parseNumberInput(text);
        setText(null);
        if (n !== null && Math.abs(n) <= 10_000) onCommit(Math.round(n * 100) / 100);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      style={{ ...baseInput, width: 80, textAlign: "right" }}
    />
  );
}

export function TareaDialog({
  fila,
  res,
  prog,
  editable,
  onAccept,
  onClose,
}: {
  fila: FilaGantt;
  res: Programado;
  prog: Programacion;
  editable: boolean;
  onAccept: (t: TareaProgramada) => void;
  onClose: () => void;
}) {
  const t0 = prog.tareas[fila.id] ?? {};
  const jornada = prog.calendario.jornada;
  const [usarEstimada, setUsarEstimada] = useState(t0.duracion === undefined);
  const [duracion, setDuracion] = useState<number>(t0.duracion ?? fila.duracion);
  const [cuadrillas, setCuadrillas] = useState(t0.cuadrillas ?? 1);
  const [inicio, setInicio] = useState<string | null>(t0.inicio ?? null);
  const [deps, setDeps] = useState<Dependencia[]>(t0.predecesoras ?? []);
  const estimada = estimarDuracion({ metrado: fila.metrado, rendimiento: fila.rendimiento ?? 0, jornada: fila.item?.jornada ?? jornada }, cuadrillas, jornada, prog.redondeo);
  const opciones = useMemo(() => res.filas.filter((x) => x.tipo === "partida" && x.id !== fila.id), [res, fila.id]);
  const sucesoras = res.filas.filter((x) => x.predecesoras.some((d) => d.id === fila.id));
  const repetida = deps.some((d, i) => deps.findIndex((e) => e.id === d.id) !== i);
  const ciclo = creaCiclo(prog.tareas, fila.id, deps.map((d) => d.id));
  const error = repetida ? "Hay una predecesora repetida." : ciclo ? "Esas predecesoras forman un ciclo: una de ellas ya depende de esta partida." : "";
  const setDep = (i: number, cambio: Partial<Dependencia>) => setDeps((l) => l.map((d, k) => (k === i ? { ...d, ...cambio } : d)));

  return (
    <Modal
      title={`Tarea ${fila.fila}: ${fila.numero} ${fila.descripcion}`}
      onClose={onClose}
      width={860}
      height="88vh"
      footer={
        <>
          {error && <span style={{ color: "#8a1c14", fontSize: 13, marginRight: "auto" }}>{error}</span>}
          <button
            type="button"
            style={acceptButton}
            disabled={!editable || !!error}
            onClick={() =>
              onAccept({
                ...(usarEstimada ? {} : { duracion }),
                ...(cuadrillas !== 1 ? { cuadrillas } : {}),
                ...(inicio ? { inicio } : {}),
                ...(deps.length ? { predecesoras: deps } : {}),
              })
            }
          >
            Aceptar
          </button>
        </>
      }
    >
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5 }}>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", color: "var(--tc-gray-700)" }}>
          <span>
            Metrado: <strong>{fila.metrado !== null ? fmt(fila.metrado) : "—"}</strong> {fila.unidad}
          </span>
          <span>
            Rendimiento: <strong>{fila.rendimiento !== null ? fmt(fila.rendimiento) : "—"}</strong> {fila.unidad}/día de {fmt(fila.item?.jornada ?? jornada, 0)} h
          </span>
          <span>
            Parcial: <strong>{fmt(fila.parcial)}</strong>
          </span>
          <span>
            Programada: <strong>{fechaCorta(fila.inicio)}</strong> → <strong>{fechaCorta(fila.fin)}</strong> · holgura {fmt(fila.holgura)} días
            {fila.critica && <strong style={{ color: "#d93025" }}> · ruta crítica</strong>}
          </span>
        </div>

        <Seccion titulo="Duración">
          <div style={{ display: "flex", gap: 18, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label>
              <span style={labelStyle}>Cuadrillas</span>
              <NumInput value={cuadrillas} decimals={Number.isInteger(cuadrillas) ? 0 : 2} readOnly={!editable} ariaLabel="Cuadrillas" onCommit={(v) => v && v > 0 && setCuadrillas(v)} style={{ width: 90 }} />
            </label>
            <label style={{ display: "flex", gap: 6, alignItems: "center", paddingBottom: 6 }}>
              <input type="checkbox" checked={usarEstimada} disabled={!editable} onChange={(e) => setUsarEstimada(e.target.checked)} />
              Usar la estimada: <strong>{estimada === null ? "no se puede estimar (sin metrado o rendimiento): 1 día" : `${fmt(estimada, Number.isInteger(estimada) ? 0 : 2)} días`}</strong>
            </label>
            {!usarEstimada && (
              <label>
                <span style={labelStyle}>Días hábiles (0 = hito)</span>
                <NumInput value={duracion} decimals={2} readOnly={!editable} ariaLabel="Duración en días" onCommit={(v) => v !== null && setDuracion(Math.min(v, 10_000))} style={{ width: 110 }} />
              </label>
            )}
          </div>
        </Seccion>

        <Seccion titulo="No comenzar antes de">
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {editable ? <FechaCampo id="tarea-inicio" value={inicio} onChange={setInicio} allowEmpty width={170} /> : <span>{inicio ? fechaCorta(inicio) : "—"}</span>}
            <span style={{ color: "var(--tc-gray-500)", fontSize: 13 }}>Vacío: empieza cuando lo permitan sus predecesoras (o al inicio del proyecto).</span>
          </div>
        </Seccion>

        <Seccion titulo={`Predecesoras (${deps.length})`}>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--tc-gray-500)" }}>
            <strong>FC</strong>: empieza cuando la otra termina · <strong>CC</strong>: empieza cuando la otra empieza · <strong>FF</strong>: termina cuando la otra termina ·{" "}
            <strong>CF</strong>: termina cuando la otra empieza. Desfase en días hábiles: positivo para esperar, <strong>negativo para adelantarse</strong>.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Partida</th>
                <th style={th}>Tipo</th>
                <th style={th}>Desfase (días)</th>
                <th style={{ ...th, width: 30 }} />
              </tr>
            </thead>
            <tbody>
              {deps.map((d, i) => (
                <tr key={i}>
                  <td style={td}>
                    <select value={d.id} disabled={!editable} onChange={(e) => setDep(i, { id: e.target.value })} style={{ ...baseInput, width: "100%" }} aria-label={`Predecesora ${i + 1}`}>
                      {!res.porId.has(d.id) && <option value={d.id}>(ya no existe)</option>}
                      {opciones.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.fila} · {o.numero} {o.descripcion.slice(0, 80)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ ...td, width: 200 }}>
                    <select value={d.tipo} disabled={!editable} onChange={(e) => setDep(i, { tipo: e.target.value as TipoDependencia })} style={{ ...baseInput, width: "100%" }} aria-label={`Tipo de la predecesora ${i + 1}`}>
                      {TIPOS_DEPENDENCIA.map((t) => (
                        <option key={t} value={t}>
                          {t} · {TIPO_DEPENDENCIA_NOMBRES[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ ...td, width: 110 }}>{editable ? <DesfaseInput value={d.desfase} ariaLabel={`Desfase de la predecesora ${i + 1}`} onCommit={(n) => setDep(i, { desfase: n })} /> : fmt(d.desfase)}</td>
                  <td style={{ ...td, textAlign: "center" }}>
                    {editable && (
                      <button type="button" aria-label={`Quitar la predecesora ${i + 1}`} onClick={() => setDeps((l) => l.filter((_, k) => k !== i))} style={quitar}>
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {editable && opciones.length > 0 && (
            <button type="button" style={{ ...botonSec, marginTop: 8 }} onClick={() => setDeps((l) => [...l, { id: opciones.find((o) => !l.some((d) => d.id === o.id))?.id ?? opciones[0].id, tipo: "FC", desfase: 0 }])}>
              + Agregar predecesora
            </button>
          )}
        </Seccion>

        {sucesoras.length > 0 && (
          <Seccion titulo={`Sucesoras (${sucesoras.length})`}>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {sucesoras.map((s) => (
                <li key={s.id}>
                  {s.fila} · {s.numero} {s.descripcion} ({s.predecesoras.find((d) => d.id === fila.id)?.tipo})
                </li>
              ))}
            </ul>
          </Seccion>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- money over time

function SelectorSp({ doc, value, onChange }: { doc: PresupuestoDoc; value: string | null; onChange: (id: string | null) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
      SP:
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} style={{ ...baseInput, minWidth: 220 }} aria-label="Subpresupuesto">
        <option value="">Todos los subpresupuestos</option>
        {doc.subpresupuestos.map((sp) => (
          <option key={sp.id} value={sp.id}>
            {sp.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}

function Alternar<T extends string>({ value, opciones, onChange, label }: { value: T; opciones: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} style={{ display: "inline-flex", border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
      {opciones.map(([v, t]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          style={{ border: "none", padding: "5px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 13, background: value === v ? "var(--tc-blue-600)" : "#fff", color: value === v ? "#fff" : "var(--tc-gray-700)" }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

const PERIODOS: [TipoPeriodo, string][] = [
  ["mes", "Mensual"],
  ["semana", "Semanal"],
];

function useExportar() {
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  async function exportar(fn: () => Promise<void>) {
    setOcupado(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(`No se pudo exportar: ${message(err)}`);
    } finally {
      setOcupado(false);
    }
  }
  return { error, ocupado, exportar };
}

const compacto = new Intl.NumberFormat("es", { notation: "compact", maximumFractionDigits: 1 });

export function CurvaSDialog({ res, doc, proyecto, onClose }: { res: Programado; doc: PresupuestoDoc; proyecto: string; onClose: () => void }) {
  const [tipo, setTipo] = useState<TipoPeriodo>("mes");
  const [spId, setSpId] = useState<string | null>(null);
  const cs = useMemo(() => curvaS(res, tipo, spId), [res, tipo, spId]);
  const datos = cs.periodos.map((p, i) => ({ periodo: p.etiqueta, valor: cs.montos[i], acumulado: cs.porcentaje[i] }));
  const x = useExportar();
  const nombre = spId ? doc.subpresupuestos.find((s) => s.id === spId)?.nombre ?? "" : "Todos los subpresupuestos";
  return (
    <Modal
      title="Curva S"
      onClose={onClose}
      width={1100}
      height="90vh"
      toolbar={
        <>
          <SelectorSp doc={doc} value={spId} onChange={setSpId} />
          <Alternar label="Periodo" value={tipo} opciones={PERIODOS} onChange={setTipo} />
          <button type="button" style={botonSec} disabled={x.ocupado} onClick={() => x.exportar(() => exportarExcel([tablaCurvaS(cs, nombre, tipo)], `${nombreSeguro(`Curva S ${proyecto}`)}.xlsx`))}>
            Exportar a hoja de cálculo
          </button>
          {x.error && <span style={{ color: "#8a1c14", fontSize: 13 }}>{x.error}</span>}
        </>
      }
    >
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ height: 340, background: "#fff", border: `1px solid ${C.border}`, padding: "8px 4px 0" }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={datos} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid stroke="#eef1f5" />
              <XAxis dataKey="periodo" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis yAxisId="v" tick={{ fontSize: 11 }} tickFormatter={(v: number) => compacto.format(v)} width={70} />
              <YAxis yAxisId="p" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v}%`} width={48} />
              <Tooltip formatter={(v, n) => (n === "% acumulado" ? `${fmt(Number(v))} %` : fmt(Number(v)))} />
              <Legend />
              <Bar yAxisId="v" dataKey="valor" name={tipo === "mes" ? "Valor del mes" : "Valor de la semana"} fill="#8fb0f5" />
              <Line yAxisId="p" type="monotone" dataKey="acumulado" name="% acumulado" stroke="#d93025" strokeWidth={2} dot={datos.length <= 40} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, background: "#fff" }}>
          <thead>
            <tr>
              <th style={th}>Periodo</th>
              <th style={th}>Desde</th>
              <th style={th}>Hasta</th>
              <th style={th}>Valor del periodo</th>
              <th style={th}>Acumulado</th>
              <th style={th}>% acumulado</th>
            </tr>
          </thead>
          <tbody>
            {cs.periodos.map((p, i) => (
              <tr key={p.desde}>
                <td style={td}>{p.etiqueta}</td>
                <td style={{ ...td, textAlign: "center" }}>{fechaCorta(p.desde)}</td>
                <td style={{ ...td, textAlign: "center" }}>{fechaCorta(p.hasta)}</td>
                <td style={tdNum}>{fmt(cs.montos[i])}</td>
                <td style={tdNum}>{fmt(cs.acumulado[i])}</td>
                <td style={tdNum}>{fmt(cs.porcentaje[i])} %</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700 }}>
              <td style={td} colSpan={3}>
                TOTAL
              </td>
              <td style={tdNum}>{fmt(cs.total)}</td>
              <td style={td} colSpan={2} />
            </tr>
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function ValorizadoDialog({ res, doc, proyecto, onClose }: { res: Programado; doc: PresupuestoDoc; proyecto: string; onClose: () => void }) {
  const [tipo, setTipo] = useState<TipoPeriodo>("mes");
  const [spId, setSpId] = useState<string | null>(doc.subpresupuestos.length === 1 ? doc.subpresupuestos[0].id : null);
  const cv = useMemo(() => calendarioValorizado(res, spId, tipo), [res, spId, tipo]);
  const x = useExportar();
  const nombre = spId ? doc.subpresupuestos.find((s) => s.id === spId)?.nombre ?? "" : "Todos los subpresupuestos";
  return (
    <Modal
      title="Calendario valorizado"
      onClose={onClose}
      width="96vw"
      height="92vh"
      toolbar={
        <>
          <SelectorSp doc={doc} value={spId} onChange={setSpId} />
          <Alternar label="Periodo" value={tipo} opciones={PERIODOS} onChange={setTipo} />
          <button type="button" style={botonSec} disabled={x.ocupado} onClick={() => x.exportar(() => exportarExcel([tablaCalendarioValorizado(cv, nombre)], `${nombreSeguro(`Calendario valorizado ${proyecto}`)}.xlsx`))}>
            Exportar a hoja de cálculo
          </button>
          {x.error && <span style={{ color: "#8a1c14", fontSize: 13 }}>{x.error}</span>}
        </>
      }
    >
      <TablaPeriodos
        cabeceras={["Item", "Partida", "Unidad", "Metrado", "PU", "Parcial"]}
        anchos={[70, 380, 64, 96, 110, 130]}
        periodos={cv.periodos.map((p, i) => ({ clave: p.desde, titulo: p.etiqueta, sub: `${fmt(cv.porcentajes[i], 3)}%` }))}
        filas={cv.filas.map((f) => ({
          clave: f.fila.id,
          negrita: f.fila.tipo !== "partida",
          celdas: [
            f.fila.tipo === "sp" ? "SP" : f.fila.numero,
            <span key="d" style={{ paddingLeft: (f.fila.nivel - (spId ? 1 : 0)) * 14 }}>{f.fila.tipo === "sp" ? `SP: ${f.fila.descripcion}` : f.fila.descripcion}</span>,
            f.fila.unidad,
            f.fila.metrado !== null ? fmt(f.fila.metrado) : "",
            f.fila.cu !== null ? fmt(f.fila.cu) : "",
            fmt(f.fila.parcial),
          ],
          montos: f.montos,
        }))}
        total={{ etiqueta: "TOTAL", valor: cv.total, montos: cv.totales }}
      />
    </Modal>
  );
}

export function InsumosPeriodoDialog({ res, doc, resolver, proyecto, onClose }: { res: Programado; doc: PresupuestoDoc; resolver: Resolver; proyecto: string; onClose: () => void }) {
  const [tipo, setTipo] = useState<TipoPeriodo>("mes");
  const [modo, setModo] = useState<"costo" | "cantidad">("costo");
  const [spId, setSpId] = useState<string | null>(doc.subpresupuestos.length === 1 ? doc.subpresupuestos[0].id : null);
  const ci = useMemo(() => calendarioInsumos(res, resolver, spId, tipo), [res, resolver, spId, tipo]);
  const x = useExportar();
  const nombre = spId ? doc.subpresupuestos.find((s) => s.id === spId)?.nombre ?? "" : "Todos los subpresupuestos";
  return (
    <Modal
      title="Calendario de insumos"
      onClose={onClose}
      width="96vw"
      height="92vh"
      toolbar={
        <>
          <SelectorSp doc={doc} value={spId} onChange={setSpId} />
          <Alternar label="Periodo" value={tipo} opciones={PERIODOS} onChange={setTipo} />
          <Alternar
            label="Ver"
            value={modo}
            opciones={[
              ["costo", "Costo"],
              ["cantidad", "Cantidades"],
            ]}
            onChange={setModo}
          />
          <button type="button" style={botonSec} disabled={x.ocupado} onClick={() => x.exportar(() => exportarExcel([tablaCalendarioInsumos(ci, nombre, modo)], `${nombreSeguro(`Calendario de insumos ${proyecto}`)}.xlsx`))}>
            Exportar a hoja de cálculo
          </button>
          {x.error && <span style={{ color: "#8a1c14", fontSize: 13 }}>{x.error}</span>}
        </>
      }
    >
      <TablaPeriodos
        cabeceras={["", "Insumo", "Unidad", "Cantidad", "PU", "Parcial"]}
        anchos={[28, 340, 70, 110, 110, 130]}
        periodos={ci.periodos.map((p, i) => ({ clave: p.desde, titulo: p.etiqueta, sub: modo === "costo" && ci.total ? `${fmt((ci.totales[i] / ci.total) * 100, 3)}%` : "" }))}
        filas={ci.filas.map((f) => ({
          clave: f.id,
          celdas: [<Square key="t" rubro={f.tipo} />, f.descripcion, f.unidad, f.porcentajeMO ? "" : fmt(f.cantidad, 3), f.porcentajeMO ? "" : fmt(f.precio), fmt(f.parcial)],
          montos: modo === "costo" || f.porcentajeMO ? f.montos : f.cantidades,
          decimales: modo === "costo" || f.porcentajeMO ? 2 : 3,
        }))}
        total={modo === "costo" ? { etiqueta: "TOTAL", valor: ci.total, montos: ci.totales } : undefined}
      />
    </Modal>
  );
}

/** A table with fixed columns on the left and one column per period. */
function TablaPeriodos({
  cabeceras,
  anchos,
  periodos,
  filas,
  total,
}: {
  cabeceras: string[];
  anchos: number[];
  periodos: { clave: string; titulo: string; sub: string }[];
  filas: { clave: string; celdas: ReactNode[]; montos: number[]; negrita?: boolean; decimales?: number }[];
  total?: { etiqueta: string; valor: number; montos: number[] };
}) {
  const izquierdas = anchos.reduce<number[]>((acc, w, i) => [...acc, i === 0 ? 0 : acc[i - 1] + anchos[i - 1]], []);
  const fija = (i: number): CSSProperties => ({ position: "sticky", left: izquierdas[i], zIndex: 1, background: "inherit", minWidth: anchos[i], maxWidth: anchos[i] });
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#fff" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f3f4f6" }}>
            {cabeceras.map((h, i) => (
              <th key={i} style={{ ...th, ...fija(i), top: 0, zIndex: 3, position: "sticky" }}>
                {h}
              </th>
            ))}
            {periodos.map((p) => (
              <th key={p.clave} style={{ ...th, position: "sticky", top: 0, zIndex: 2, minWidth: 130, background: "#f3f4f6" }}>
                {p.titulo}
                {p.sub && <div style={{ fontWeight: 400, fontSize: 12 }}>{p.sub}</div>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.clave} style={{ background: f.negrita ? C.rowTitle : "#fff", fontWeight: f.negrita ? 700 : 400 }}>
              {f.celdas.map((c, i) => (
                <td key={i} style={{ ...td, ...fija(i), textAlign: i >= 3 ? "right" : i === 2 ? "center" : "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c}
                </td>
              ))}
              {f.montos.map((m, i) => (
                <td key={i} style={{ ...tdNum, color: m === 0 ? "#b8bec7" : undefined }}>
                  {m === 0 ? "—" : fmt(m, f.decimales ?? 2)}
                </td>
              ))}
            </tr>
          ))}
          {total && (
            <tr style={{ background: "#eef2f7", fontWeight: 700 }}>
              {cabeceras.map((_, i) => (
                <td key={i} style={{ ...td, ...fija(i), textAlign: i >= 3 ? "right" : "left" }}>
                  {i === 1 ? total.etiqueta : i === cabeceras.length - 1 ? fmt(total.valor) : ""}
                </td>
              ))}
              {total.montos.map((m, i) => (
                <td key={i} style={tdNum}>
                  {fmt(m)}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
      {filas.length === 0 && <Notice kind="info" style={{ margin: 12 }}>No hay partidas con valor en este subpresupuesto.</Notice>}
    </div>
  );
}

const th: CSSProperties = { padding: "6px 8px", fontWeight: 600, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.grid}`, textAlign: "center", background: "#f3f4f6", fontSize: 13 };
const td: CSSProperties = { padding: "4px 8px", borderBottom: `1px solid ${C.grid}`, borderRight: `1px solid ${C.grid}` };
const tdNum: CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const botonSec: CSSProperties = { border: `1px solid ${C.border}`, background: "#fff", borderRadius: 4, padding: "5px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 13 };
const quitar: CSSProperties = { border: "none", background: "transparent", color: "#b3261e", cursor: "pointer", fontSize: 14, fontFamily: "inherit" };
