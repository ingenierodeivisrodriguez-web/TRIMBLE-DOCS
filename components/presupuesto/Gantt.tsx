"use client";

import { CSSProperties, ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { diasEntre, fechaCorta, MESES_CORTOS, sumarDias } from "../../lib/presupuesto/calendario";
import { fmt } from "../../lib/presupuesto/format";
import { FilaGantt, Programado, textoPredecesoras } from "../../lib/presupuesto/programacion";
import { parseDisplayDate, todayIso } from "../../lib/propiedades/values";
import { C, NumInput, TextCommit } from "./ui";

const ROW_H = 30;
const HEAD_H = 50;
const OVERSCAN = 12;

const COLUMNAS: { key: string; titulo: string; ancho: number; align?: "left" | "right" | "center"; title?: string }[] = [
  { key: "fila", titulo: "#", ancho: 42, align: "right", title: "Número de fila: así se escriben las predecesoras" },
  { key: "item", titulo: "Item", ancho: 66 },
  { key: "partida", titulo: "Partida", ancho: 300 },
  { key: "duracion", titulo: "Duración", ancho: 80, align: "right", title: "Días hábiles. Vacío: se estima con metrado ÷ (rendimiento × cuadrillas)" },
  { key: "inicio", titulo: "Inicio", ancho: 112, align: "center", title: "Escribir una fecha fija 'no comenzar antes de'; vacío la quita" },
  { key: "fin", titulo: "Fin", ancho: 96, align: "center" },
  { key: "pred", titulo: "Predecesoras", ancho: 124, title: "Filas, p. ej. 4; 6CC+2; 9FF-1 (FC fin-comienzo, CC, FF, CF; + días de espera, - días de adelanto)" },
  { key: "cuad", titulo: "Cuadrillas", ancho: 80, align: "right" },
  { key: "rend", titulo: "Rendimiento", ancho: 96, align: "right" },
  { key: "metrado", titulo: "Metrado", ancho: 100, align: "right" },
  { key: "holgura", titulo: "Holgura", ancho: 72, align: "right", title: "Días que puede retrasarse sin mover el fin del proyecto" },
];
const ANCHO_TABLA = COLUMNAS.reduce((s, c) => s + c.ancho, 0);

const COLOR = {
  barra: "#6f8ff0",
  barraBorde: "#4a6fdc",
  critica: "#d93025",
  criticaBorde: "#a52714",
  resumen: "#3c4043",
  enlace: "#7b8794",
  noLaborable: "#eef1f5",
  parcial: "#f6f8fb",
  hoy: "#e8710a",
  finObjetivo: "#8e24aa",
  base: "#9aa0a6",
  avance: "#1f3fa8",
  avanceCritica: "#8b1a10",
};

export interface GanttProps {
  res: Programado;
  /** The rows shown (collapsed titles hide theirs). */
  filas: FilaGantt[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  critica: boolean;
  /** Pixels per day. */
  pxDia: number;
  finObjetivo: string | null;
  editable: boolean;
  onDuracion: (id: string, dias: number | null) => void;
  onInicio: (id: string, fecha: string | null) => void;
  /** Answers an error to show, or null. */
  onPredecesoras: (id: string, texto: string) => string | null;
  onCuadrillas: (id: string, n: number | null) => void;
  onOpen: (id: string) => void;
  /** A bar was dragged onto another: `de` becomes a predecessor of `a`. */
  onEnlazar: (de: string, a: string) => void;
  /** Double click on the arrow from `de` to `a`. */
  onEditarEnlace: (de: string, a: string) => void;
  /** The baseline's dates of each row, drawn as a thin bar under it (null: not shown). */
  lineaBase?: Map<string, { inicio: string; fin: string }> | null;
  /** Each partida's % done in the latest progress report, drawn inside its bar. */
  avancePct?: Map<string, number> | null;
}

/** A link being drawn by dragging from a bar (positions in the chart's body). */
interface Arrastre {
  de: string;
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** Where the press started (screen), to tell a click from a drag. */
  sx: number;
  sy: number;
  activo: boolean;
}

export default function Gantt(props: GanttProps) {
  const { res, filas, selectedId, onSelect, collapsed, onToggle, critica, pxDia, finObjetivo, editable, lineaBase, avancePct } = props;
  const izq = useRef<HTMLDivElement>(null);
  const der = useRef<HTMLDivElement>(null);
  const [anchoIzq, setAnchoIzq] = useState(640);
  const [vista, setVista] = useState({ top: 0, alto: 600 });
  const [errores, setErrores] = useState<Map<string, string>>(new Map());
  const cuerpo = useRef<HTMLDivElement>(null);
  const [arrastre, setArrastre] = useState<Arrastre | null>(null);
  const [enlaceSobre, setEnlaceSobre] = useState<string | null>(null);

  useLayoutEffect(() => {
    const r = der.current;
    if (!r) return;
    const actualizar = () => setVista({ top: r.scrollTop, alto: r.clientHeight });
    actualizar();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(actualizar) : null;
    ro?.observe(r);
    return () => ro?.disconnect();
  }, []);

  function alDesplazar() {
    const r = der.current;
    if (!r) return;
    if (izq.current && izq.current.scrollTop !== r.scrollTop) izq.current.scrollTop = r.scrollTop;
    setVista({ top: r.scrollTop, alto: r.clientHeight });
  }

  const start = Math.max(0, Math.floor(vista.top / ROW_H) - OVERSCAN);
  const end = Math.min(filas.length, Math.ceil((vista.top + vista.alto) / ROW_H) + OVERSCAN);
  const altoCuerpo = filas.length * ROW_H + 24;

  // ---- the time scale: a few days before the start to a couple of weeks after the end
  const desde = sumarDias(res.inicio, -3);
  const ultimo = finObjetivo && finObjetivo > res.fin ? finObjetivo : res.fin;
  const dias = Math.max(diasEntre(desde, ultimo) + 15, 45);
  const ancho = dias * pxDia;
  const base = diasEntre(desde, res.cal.inicio);
  const x = (h: number, extremo: "inicio" | "fin") => (base + res.cal.posicion(h, extremo)) * pxDia;
  const diaX = (fecha: string) => diasEntre(desde, fecha) * pxDia;

  const escala = useMemo(() => {
    const meses: { left: number; width: number; label: string }[] = [];
    const marcas: { left: number; width: number; label: string; rojo: boolean }[] = [];
    const noLaborables: { left: number; parcial: boolean }[] = [];
    for (let i = 0; i < dias; i++) {
      const f = sumarDias(desde, i);
      const ultimoMes = meses[meses.length - 1];
      const etiqueta = `${MESES_CORTOS[+f.slice(5, 7) - 1]}-${f.slice(0, 4)}`;
      if (!ultimoMes || ultimoMes.label !== etiqueta) meses.push({ left: i * pxDia, width: pxDia, label: etiqueta });
      else ultimoMes.width += pxDia;
      const horas = res.cal.horasDel(f);
      if (horas === 0) noLaborables.push({ left: i * pxDia, parcial: false });
      else if (horas < res.cal.cfg.jornada) noLaborables.push({ left: i * pxDia, parcial: true });
      if (pxDia >= 16) marcas.push({ left: i * pxDia, width: pxDia, label: String(+f.slice(8, 10)), rojo: horas === 0 });
      else if (pxDia >= 4 && (new Date(`${f}T00:00:00Z`).getUTCDay() === 1 || i === 0)) marcas.push({ left: i * pxDia, width: pxDia * 7, label: fechaCorta(f).slice(0, 5), rojo: false });
    }
    return { meses, marcas, noLaborables };
  }, [desde, dias, pxDia, res.cal]);

  // ---- links between the rows shown
  const indice = useMemo(() => new Map(filas.map((f, i) => [f.id, i])), [filas]);
  const enlaces = useMemo(() => {
    const out: { de: number; a: number; tipo: string; critico: boolean }[] = [];
    filas.forEach((f, i) => {
      for (const d of f.predecesoras) {
        const j = indice.get(d.id);
        if (j === undefined || res.enCiclo.has(f.id)) continue;
        out.push({ de: j, a: i, tipo: d.tipo, critico: f.critica && filas[j].critica });
      }
    });
    return out;
  }, [filas, indice, res.enCiclo]);
  const filaDe = (id: string) => res.porId.get(id)?.fila;

  function irA(f: FilaGantt) {
    const r = der.current;
    if (!r || f.vacia) return;
    const x0 = x(f.es, "inicio");
    if (x0 < r.scrollLeft + 20 || x0 > r.scrollLeft + r.clientWidth - 80) r.scrollLeft = Math.max(0, x0 - 60);
  }

  /** Where the pointer is, in the chart's body. */
  function punto(e: { clientX: number; clientY: number }) {
    const r = cuerpo.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** The partida a link would go to, at a height of the chart's body. */
  function destinoEn(y: number, de: string): FilaGantt | null {
    const f = filas[Math.floor(y / ROW_H)];
    return f && f.tipo === "partida" && f.id !== de ? f : null;
  }

  function empezarEnlace(e: React.PointerEvent, f: FilaGantt, i: number) {
    if (!editable || e.button !== 0 || !cuerpo.current) return;
    const p = punto(e);
    const xFin = f.ef > f.es ? x(f.ef, "fin") : x(f.es, "inicio");
    setArrastre({ de: f.id, x0: xFin, y0: i * ROW_H + ROW_H / 2, x: p.x, y: p.y, sx: e.clientX, sy: e.clientY, activo: false });
    try {
      cuerpo.current.setPointerCapture(e.pointerId); // keep receiving the moves outside the bar
    } catch {
      // not an active pointer (e.g. a synthetic event): moves over the chart still arrive
    }
  }

  function moverEnlace(e: React.PointerEvent) {
    if (!arrastre) return;
    const activo = arrastre.activo || Math.hypot(e.clientX - arrastre.sx, e.clientY - arrastre.sy) > 5;
    // Near an edge, the chart scrolls to reach rows and days out of view.
    const sc = der.current;
    if (activo && sc) {
      const r = sc.getBoundingClientRect();
      if (e.clientY < r.top + HEAD_H + 24) sc.scrollTop -= 14;
      else if (e.clientY > r.bottom - 28) sc.scrollTop += 14;
      if (e.clientX < r.left + 24) sc.scrollLeft -= 14;
      else if (e.clientX > r.right - 28) sc.scrollLeft += 14;
    }
    const p = punto(e);
    setArrastre({ ...arrastre, x: p.x, y: p.y, activo });
  }

  function soltarEnlace(e: React.PointerEvent) {
    if (!arrastre) return;
    try {
      cuerpo.current?.releasePointerCapture(e.pointerId);
    } catch {
      // it wasn't captured
    }
    const destino = arrastre.activo ? destinoEn(punto(e).y, arrastre.de) : null;
    setArrastre(null);
    if (destino) props.onEnlazar(arrastre.de, destino.id);
  }

  function arrastrarDivisor(e: React.PointerEvent<HTMLDivElement>) {
    const inicioX = e.clientX;
    const inicioAncho = anchoIzq;
    const mover = (ev: PointerEvent) => setAnchoIzq(Math.min(Math.max(inicioAncho + ev.clientX - inicioX, 220), ANCHO_TABLA + 2));
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  }

  const hoy = todayIso();
  const visibles = filas.slice(start, end);

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", borderTop: `1px solid ${C.border}` }}>
      {/* ---- the table */}
      <div
        ref={izq}
        style={{ width: anchoIzq, flexShrink: 0, overflowX: "auto", overflowY: "hidden", position: "relative" }}
        onScroll={() => {
          // Moving through the table with the keyboard scrolls it: the chart follows.
          const l = izq.current;
          if (l && der.current && der.current.scrollTop !== l.scrollTop) der.current.scrollTop = l.scrollTop;
        }}
        onWheel={(e) => {
          if (der.current && Math.abs(e.deltaY) >= Math.abs(e.deltaX)) der.current.scrollTop += e.deltaY;
        }}
      >
        <div style={{ width: ANCHO_TABLA, position: "relative" }}>
          <div style={{ position: "sticky", top: 0, zIndex: 3, display: "flex", height: HEAD_H, background: "#f3f4f6", borderBottom: `1px solid ${C.border}` }}>
            {COLUMNAS.map((c) => (
              <div key={c.key} title={c.title} style={{ ...celdaCabecera, width: c.ancho }}>
                {c.titulo}
              </div>
            ))}
          </div>
          <div style={{ position: "relative", height: altoCuerpo }}>
            {visibles.map((f, k) => {
              const i = start + k;
              const sel = f.id === selectedId;
              const esPartida = f.tipo === "partida";
              const error = errores.get(f.id);
              return (
                <div
                  key={f.id}
                  onMouseDown={() => {
                    onSelect(f.id);
                    irA(f);
                  }}
                  onDoubleClick={() => esPartida && props.onOpen(f.id)}
                  style={{
                    position: "absolute",
                    top: i * ROW_H,
                    left: 0,
                    width: ANCHO_TABLA,
                    height: ROW_H,
                    display: "flex",
                    background: sel ? C.rowSelected : esPartida ? "#fff" : C.rowTitle,
                    borderBottom: `1px solid ${C.grid}`,
                    fontWeight: esPartida ? 400 : 700,
                    fontSize: 13,
                  }}
                >
                  <Celda c={0} style={{ color: "var(--tc-gray-500)", fontWeight: 400 }}>
                    {f.fila}
                  </Celda>
                  <Celda c={1}>{f.tipo === "sp" ? "SP" : f.numero}</Celda>
                  <Celda c={2} style={{ paddingLeft: 4 + (f.nivel ?? 0) * 14 }} title={f.descripcion}>
                    {!esPartida && (
                      <button type="button" aria-label={collapsed.has(f.id) ? "Desplegar" : "Plegar"} onClick={() => onToggle(f.id)} style={plegar}>
                        {collapsed.has(f.id) ? "▶" : "▼"}
                      </button>
                    )}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: critica && f.critica && esPartida ? COLOR.critica : undefined }}>
                      {f.tipo === "sp" ? `SP: ${f.descripcion}` : f.descripcion}
                    </span>
                  </Celda>
                  <Celda c={3}>
                    {esPartida && editable ? (
                      <NumInput
                        value={f.duracion}
                        decimals={Number.isInteger(f.duracion) ? 0 : 2}
                        allowEmpty
                        ariaLabel={`Duración de la fila ${f.fila}`}
                        onCommit={(v) => props.onDuracion(f.id, v)}
                        style={{ ...celdaInput, fontWeight: f.estimada ? 400 : 700 }}
                      />
                    ) : (
                      !f.vacia && <span style={{ fontWeight: esPartida && !f.estimada ? 700 : undefined }}>{fmt(f.duracion, Number.isInteger(f.duracion) ? 0 : 2)}</span>
                    )}
                  </Celda>
                  <Celda c={4} title={f.restriccion ? `No comenzar antes del ${fechaCorta(f.restriccion)}` : undefined}>
                    {esPartida && editable ? (
                      <CeldaFecha
                        fecha={f.inicio}
                        fija={!!f.restriccion}
                        fila={f.fila}
                        onCommit={(fecha) => props.onInicio(f.id, fecha)}
                      />
                    ) : (
                      !f.vacia && (
                        <>
                          {fechaCorta(f.inicio)}
                          {f.restriccion && " 📌"}
                        </>
                      )
                    )}
                  </Celda>
                  <Celda c={5}>{!f.vacia && fechaCorta(f.fin)}</Celda>
                  <Celda c={6} title={error ?? (res.enCiclo.has(f.id) ? "Estas predecesoras forman un ciclo: se ignoran" : undefined)}>
                    {esPartida && editable ? (
                      <TextCommit
                        value={textoPredecesoras(f.predecesoras, filaDe)}
                        ariaLabel={`Predecesoras de la fila ${f.fila}`}
                        maxLength={400}
                        onCommit={(texto) => {
                          const err = props.onPredecesoras(f.id, texto);
                          setErrores((m) => {
                            const n = new Map(m);
                            if (err) n.set(f.id, err);
                            else n.delete(f.id);
                            return n;
                          });
                        }}
                        style={{ ...celdaInput, textAlign: "left", borderColor: error ? "#d03b3b" : res.enCiclo.has(f.id) ? "#e8a33d" : undefined }}
                      />
                    ) : (
                      esPartida && textoPredecesoras(f.predecesoras, filaDe)
                    )}
                  </Celda>
                  <Celda c={7}>
                    {esPartida && editable ? (
                      <NumInput value={f.cuadrillas} decimals={Number.isInteger(f.cuadrillas) ? 0 : 2} allowEmpty ariaLabel={`Cuadrillas de la fila ${f.fila}`} onCommit={(v) => props.onCuadrillas(f.id, v)} style={celdaInput} />
                    ) : (
                      esPartida && fmt(f.cuadrillas, 0)
                    )}
                  </Celda>
                  <Celda c={8}>{f.rendimiento !== null && fmt(f.rendimiento)}</Celda>
                  <Celda c={9}>{f.metrado !== null && fmt(f.metrado)}</Celda>
                  <Celda c={10} style={{ color: f.critica ? COLOR.critica : undefined }}>
                    {!f.vacia && esPartida && fmt(f.holgura, Number.isInteger(f.holgura) ? 0 : 2)}
                  </Celda>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ---- the divider */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Ancho de la tabla"
        onPointerDown={arrastrarDivisor}
        style={{ width: 6, flexShrink: 0, cursor: "col-resize", background: "#d5dbe3", borderLeft: "1px solid #c3cad4", borderRight: "1px solid #c3cad4" }}
      />

      {/* ---- the chart */}
      <div ref={der} onScroll={alDesplazar} style={{ flex: 1, minWidth: 0, overflow: "auto", position: "relative" }}>
        <div style={{ width: ancho, position: "relative" }}>
          <div style={{ position: "sticky", top: 0, zIndex: 3, height: HEAD_H, background: "#f3f4f6", borderBottom: `1px solid ${C.border}` }}>
            {escala.meses.map((m) => (
              <div key={m.label} style={{ position: "absolute", left: m.left, width: m.width, top: 0, height: 24, borderRight: `1px solid ${C.border}`, ...cabeceraTexto, fontWeight: 700 }}>
                {m.width >= 54 ? m.label : m.label.slice(0, 3)}
              </div>
            ))}
            {escala.marcas.map((m) => (
              <div key={m.left} style={{ position: "absolute", left: m.left, width: m.width, top: 24, height: HEAD_H - 24, borderTop: `1px solid ${C.border}`, borderRight: `1px solid ${C.grid}`, ...cabeceraTexto, fontSize: 11.5, color: m.rojo ? "#c5221f" : undefined }}>
                {m.label}
              </div>
            ))}
            {finObjetivo && (
              <div style={{ position: "absolute", left: diaX(finObjetivo) + pxDia - 1, top: 24, height: HEAD_H - 24, borderLeft: `2px dashed ${COLOR.finObjetivo}` }} title={`Fecha fin: ${fechaCorta(finObjetivo)}`} />
            )}
          </div>
          <div
            ref={cuerpo}
            style={{ position: "relative", height: altoCuerpo, cursor: arrastre?.activo ? "crosshair" : undefined, touchAction: arrastre ? "none" : undefined }}
            onPointerMove={moverEnlace}
            onPointerUp={soltarEnlace}
            onPointerCancel={() => setArrastre(null)}
            onMouseDown={(e) => {
              const i = Math.floor((e.clientY - e.currentTarget.getBoundingClientRect().top) / ROW_H);
              if (filas[i]) onSelect(filas[i].id);
            }}
            onDoubleClick={(e) => {
              const i = Math.floor((e.clientY - e.currentTarget.getBoundingClientRect().top) / ROW_H);
              if (filas[i]?.tipo === "partida") props.onOpen(filas[i].id);
            }}
          >
            {/* non-working days */}
            <svg width={ancho} height={altoCuerpo} style={{ position: "absolute", top: 0, left: 0 }} aria-hidden>
              {escala.noLaborables.map((d) => (
                <rect key={d.left} x={d.left} y={0} width={pxDia} height={altoCuerpo} fill={d.parcial ? COLOR.parcial : COLOR.noLaborable} />
              ))}
            </svg>
            {/* the selected row */}
            {selectedId && indice.has(selectedId) && (
              <div style={{ position: "absolute", left: 0, width: ancho, top: indice.get(selectedId)! * ROW_H, height: ROW_H, background: "rgba(120,160,230,0.18)" }} />
            )}
            {/* today and the due date */}
            {diasEntre(desde, hoy) >= 0 && diasEntre(desde, hoy) < dias && (
              <div title={`Hoy: ${fechaCorta(hoy)}`} style={{ position: "absolute", top: 0, height: altoCuerpo, left: diaX(hoy), borderLeft: `1px solid ${COLOR.hoy}` }} />
            )}
            {finObjetivo && (
              <div title={`Fecha fin: ${fechaCorta(finObjetivo)}`} style={{ position: "absolute", top: 0, height: altoCuerpo, left: diaX(finObjetivo) + pxDia - 1, borderLeft: `2px dashed ${COLOR.finObjetivo}` }} />
            )}
            {/* the baseline: a thin bar under each row */}
            {lineaBase &&
              visibles.map((f, k) => {
                const b = lineaBase.get(f.id);
                if (!b) return null;
                const i = start + k;
                return (
                  <div
                    key={`lb-${f.id}`}
                    title={`Línea base: ${fechaCorta(b.inicio)} → ${fechaCorta(b.fin)}`}
                    style={{ position: "absolute", top: i * ROW_H + 24, left: diaX(b.inicio), width: Math.max(diaX(b.fin) + pxDia - diaX(b.inicio), 2), height: 4, background: COLOR.base, borderRadius: 2 }}
                  />
                );
              })}
            {/* bars */}
            {visibles.map((f, k) => {
              if (f.vacia) return null;
              const i = start + k;
              const x0 = x(f.es, "inicio");
              const x1 = f.ef > f.es ? x(f.ef, "fin") : x0;
              const pct = f.tipo === "partida" ? avancePct?.get(f.id) : undefined;
              const titulo = `${f.numero} ${f.descripcion}\n${fechaCorta(f.inicio)} → ${fechaCorta(f.fin)} · ${fmt(f.duracion, 2)} días${f.tipo === "partida" ? ` · holgura ${fmt(f.holgura, 2)}` : ""}${pct !== undefined ? ` · avance ${fmt(pct)} %` : ""}`;
              const roja = critica && f.critica;
              if (f.tipo !== "partida") {
                return (
                  <div key={f.id} title={titulo} style={{ position: "absolute", top: i * ROW_H + 10, left: x0, width: Math.max(x1 - x0, 2), height: 9 }}>
                    <div
                      style={{
                        height: "100%",
                        borderRadius: 2,
                        background:
                          f.tipo === "sp"
                            ? `repeating-linear-gradient(135deg, ${roja ? COLOR.critica : "#5f6368"} 0 6px, #e8eaed 6px 12px)`
                            : roja
                              ? COLOR.criticaBorde
                              : COLOR.resumen,
                        border: f.tipo === "sp" ? `1px solid ${roja ? COLOR.critica : "#5f6368"}` : "none",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                );
              }
              if (f.duracion === 0) {
                return (
                  <div
                    key={f.id}
                    title={titulo}
                    onPointerDown={(e) => empezarEnlace(e, f, i)}
                    style={{ position: "absolute", top: i * ROW_H + 9, left: x0 - 6, width: 12, height: 12, transform: "rotate(45deg)", background: roja ? COLOR.critica : COLOR.resumen, cursor: editable ? "crosshair" : undefined }}
                  />
                );
              }
              return (
                <div
                  key={f.id}
                  title={editable ? `${titulo}\nArrastra hasta otra actividad para que esta sea su predecesora.` : titulo}
                  onPointerDown={(e) => empezarEnlace(e, f, i)}
                  style={{
                    position: "absolute",
                    top: i * ROW_H + 8,
                    left: x0,
                    width: Math.max(x1 - x0, 3),
                    height: 14,
                    cursor: editable ? "crosshair" : undefined,
                    touchAction: editable ? "none" : undefined,
                    borderRadius: 3,
                    background: roja ? COLOR.critica : COLOR.barra,
                    border: `1px solid ${roja ? COLOR.criticaBorde : COLOR.barraBorde}`,
                    boxSizing: "border-box",
                    overflow: "hidden",
                  }}
                >
                  {pct !== undefined && pct > 0 && (
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(pct, 100)}%`, background: roja ? COLOR.avanceCritica : COLOR.avance, pointerEvents: "none" }} />
                  )}
                </div>
              );
            })}
            {/* the activity a dragged link would go to */}
            {arrastre?.activo &&
              (() => {
                const destino = destinoEn(arrastre.y, arrastre.de);
                if (!destino) return null;
                return (
                  <div
                    style={{ position: "absolute", left: 0, width: ancho, top: Math.floor(arrastre.y / ROW_H) * ROW_H, height: ROW_H, background: "rgba(46,160,67,0.16)", outline: "1px solid #2ea043", pointerEvents: "none" }}
                  />
                );
              })()}
            {/* links */}
            <svg width={ancho} height={altoCuerpo} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", overflow: "visible" }} aria-hidden>
              <defs>
                <marker id="gantt-flecha" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 z" fill={COLOR.enlace} />
                </marker>
                <marker id="gantt-flecha-critica" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 z" fill={COLOR.critica} />
                </marker>
                <marker id="gantt-flecha-sobre" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
                  <path d="M0,0 L7,3.5 L0,7 z" fill="#1a73e8" />
                </marker>
                <marker id="gantt-flecha-nueva" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill="#2ea043" />
                </marker>
              </defs>
              {arrastre?.activo && (
                <>
                  <circle cx={arrastre.x0} cy={arrastre.y0} r={4} fill="#2ea043" />
                  <line x1={arrastre.x0} y1={arrastre.y0} x2={arrastre.x} y2={arrastre.y} stroke="#2ea043" strokeWidth={2} strokeDasharray="6 4" markerEnd="url(#gantt-flecha-nueva)" />
                </>
              )}
              {enlaces
                .filter((e) => Math.min(e.de, e.a) < end && Math.max(e.de, e.a) >= start)
                .map((e) => {
                  const p = filas[e.de];
                  const s = filas[e.a];
                  const desdeFin = e.tipo === "FC" || e.tipo === "FF";
                  const hastaInicio = e.tipo === "FC" || e.tipo === "CC";
                  const x1 = desdeFin ? (p.ef > p.es ? x(p.ef, "fin") : x(p.es, "inicio")) : x(p.es, "inicio");
                  const x2 = hastaInicio ? x(s.es, "inicio") : s.ef > s.es ? x(s.ef, "fin") : x(s.es, "inicio");
                  const y1 = e.de * ROW_H + ROW_H / 2;
                  const y2 = e.a * ROW_H + ROW_H / 2;
                  const xa = desdeFin ? x1 + 6 : x1 - 6;
                  const xb = hastaInicio ? x2 - 6 : x2 + 6;
                  const ym = y2 > y1 ? y2 - ROW_H / 2 + 2 : y2 + ROW_H / 2 - 2;
                  const roja = critica && e.critico;
                  const clave = `${p.id}>${s.id}`;
                  const sobre = enlaceSobre === clave;
                  const dep = s.predecesoras.find((x) => x.id === p.id);
                  const d =
                    (hastaInicio ? xa <= xb : xa >= xb)
                      ? `M${x1},${y1} H${xa} V${y2} H${x2}`
                      : `M${x1},${y1} H${xa} V${ym} H${xb} V${y2} H${x2}`;
                  return (
                    <g key={clave}>
                      <path
                        d={d}
                        fill="none"
                        stroke={sobre ? "#1a73e8" : roja ? COLOR.critica : COLOR.enlace}
                        strokeWidth={sobre ? 2.4 : roja ? 1.6 : 1.1}
                        markerEnd={`url(#${sobre ? "gantt-flecha-sobre" : roja ? "gantt-flecha-critica" : "gantt-flecha"})`}
                      />
                      {/* a wider invisible line, easier to point at: double click edits the link */}
                      <path
                        d={d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={10}
                        style={{ pointerEvents: arrastre ? "none" : "stroke", cursor: "pointer" }}
                        onMouseEnter={() => setEnlaceSobre(clave)}
                        onMouseLeave={() => setEnlaceSobre((k) => (k === clave ? null : k))}
                        onMouseDown={(ev) => ev.stopPropagation()}
                        onDoubleClick={(ev) => {
                          ev.stopPropagation();
                          props.onEditarEnlace(p.id, s.id);
                        }}
                      >
                        <title>{`Fila ${p.fila} → fila ${s.fila}: ${dep?.tipo ?? e.tipo}${dep?.desfase ? ` ${dep.desfase > 0 ? "+" : ""}${dep.desfase} d` : ""}\nDoble clic para cambiar o eliminar el enlace.`}</title>
                      </path>
                    </g>
                  );
                })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function Celda({ c, children, style, title }: { c: number; children?: ReactNode; style?: CSSProperties; title?: string }) {
  const col = COLUMNAS[c];
  return (
    <div
      title={title}
      style={{
        width: col.ancho,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: col.align === "right" ? "flex-end" : col.align === "center" ? "center" : "flex-start",
        padding: "0 5px",
        borderRight: `1px solid ${C.grid}`,
        boxSizing: "border-box",
        overflow: "hidden",
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
        gap: 4,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The start date of a partida: typing one fixes "don't start before"; clearing it lets it follow its predecessors. */
function CeldaFecha({ fecha, fija, fila, onCommit }: { fecha: string; fija: boolean; fila: number; onCommit: (fecha: string | null) => void }) {
  const [error, setError] = useState(false);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 2, width: "100%" }}>
      <TextCommit
        value={fechaCorta(fecha)}
        ariaLabel={`Inicio de la fila ${fila}`}
        placeholder="DD-MM-AAAA"
        maxLength={10}
        onCommit={(texto) => {
          if (texto.trim() === "") {
            setError(false);
            onCommit(null);
            return;
          }
          const iso = parseDisplayDate(texto);
          setError(!iso);
          if (iso) onCommit(iso);
        }}
        style={{ ...celdaInput, textAlign: "center", borderColor: error ? "#d03b3b" : undefined, fontWeight: fija ? 700 : 400 }}
      />
      {fija && (
        <button type="button" title="Quitar la fecha fija: seguirá a sus predecesoras" aria-label={`Quitar la fecha fija de la fila ${fila}`} onClick={() => onCommit(null)} style={plegar}>
          📌
        </button>
      )}
    </span>
  );
}

const celdaCabecera: CSSProperties = {
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 600,
  fontSize: 13,
  borderRight: `1px solid ${C.border}`,
  boxSizing: "border-box",
  textAlign: "center",
  padding: "0 4px",
};
const cabeceraTexto: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, overflow: "hidden", whiteSpace: "nowrap", boxSizing: "border-box" };
const celdaInput: CSSProperties = { width: "100%", padding: "2px 4px", fontSize: 13, background: "#fff", border: "1px solid #e1e5eb" };
const plegar: CSSProperties = { border: "none", background: "transparent", cursor: "pointer", fontSize: 10, padding: "0 2px", color: "var(--tc-gray-500)", fontFamily: "inherit", flexShrink: 0 };
