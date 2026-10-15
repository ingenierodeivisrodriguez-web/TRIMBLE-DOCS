"use client";

import { CSSProperties, useMemo, useState } from "react";
import { diasEntre, fechaCorta, MESES_CORTOS, sumarDias } from "../../lib/presupuesto/calendario";
import { lineaDeBalance } from "../../lib/presupuesto/edtProgramacion";
import { fmt } from "../../lib/presupuesto/format";
import type { Programado } from "../../lib/presupuesto/programacion";
import { todayIso } from "../../lib/propiedades/values";
import { C, Modal, Notice } from "./ui";

/** The categorical palette, in its fixed order (never cycled: a 9th kind of work is shown by choosing which to see). */
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const MAX_SERIES = SERIES.length;
const FILA = 34;
const IZQ = 150;
const ARRIBA = 40;

/**
 * The line of balance: places (floors, zones) up the side and time along,
 * each kind of work a band that climbs from place to place. Parallel bands
 * keep their pace; bands that come together are crews that will run into
 * each other.
 */
export function LineaBalanceDialog({ res, avancePct, onClose }: { res: Programado; avancePct: Map<string, number> | null; onClose: () => void }) {
  const lb = useMemo(() => lineaDeBalance(res), [res]);
  // Each kind of work shown keeps its color slot (showing or hiding another doesn't repaint it).
  const [slots, setSlots] = useState<Map<string, number>>(() => new Map(lb.trabajos.slice(0, MAX_SERIES).map((t, i) => [t.clave, i])));
  const [tabla, setTabla] = useState(false);
  const ver = new Set(slots.keys());
  const visibles = lb.trabajos.filter((t) => slots.has(t.clave));
  const color = new Map([...slots].map(([clave, i]) => [clave, SERIES[i]]));
  function alternarTrabajo(clave: string, si: boolean) {
    setSlots((m) => {
      const x = new Map(m);
      if (!si) x.delete(clave);
      else if (!x.has(clave)) {
        const libre = SERIES.findIndex((_, i) => ![...x.values()].includes(i));
        if (libre >= 0) x.set(clave, libre);
      }
      return x;
    });
  }

  const inicio = res.inicio;
  const dias = Math.max(diasEntre(inicio, res.fin) + 2, 14);
  const pxDia = Math.max(3, Math.min(28, Math.floor(1000 / dias)));
  const ancho = IZQ + dias * pxDia + 20;
  const n = lb.ubicaciones.length;
  const alto = ARRIBA + n * FILA + 10;
  const x = (fecha: string) => IZQ + diasEntre(inicio, fecha) * pxDia;
  const y = (u: number) => ARRIBA + (n - 1 - u) * FILA + FILA / 2; // the first place at the bottom
  const meses: { x: number; label: string }[] = [];
  for (let d = 0; d < dias; d++) {
    const f = sumarDias(inicio, d);
    if (d === 0 || f.slice(8) === "01") meses.push({ x: IZQ + d * pxDia, label: `${MESES_CORTOS[+f.slice(5, 7) - 1]}-${f.slice(0, 4)}` });
  }
  const hoy = todayIso();

  if (n < 2 || !lb.trabajos.length) {
    return (
      <Modal title="Línea de balance" onClose={onClose} width={720}>
        <div style={{ padding: 16 }}>
          <Notice kind="info">
            La línea de balance necesita el mismo trabajo en dos o más ubicaciones. En Estructura (EDT) usa «Dividir por ubicación» para partir las partidas por
            piso o zona.
          </Notice>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Línea de balance"
      onClose={onClose}
      width="96vw"
      height="92vh"
      toolbar={
        <>
          <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>
            {n} ubicaciones · {lb.trabajos.length} tipos de trabajo{lb.trabajos.length > MAX_SERIES ? ` (se ven hasta ${MAX_SERIES} a la vez)` : ""}
          </span>
          <button type="button" style={{ ...botonSec, marginLeft: "auto" }} aria-pressed={tabla} onClick={() => setTabla((v) => !v)}>
            {tabla ? "Ver la gráfica" : "Ver como tabla"}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ width: 260, borderRight: `1px solid ${C.border}`, overflow: "auto", padding: 10, fontSize: 13 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Trabajos</div>
          {lb.trabajos.map((t) => {
            const activo = ver.has(t.clave);
            const lleno = !activo && ver.size >= MAX_SERIES;
            return (
              <label key={t.clave} style={{ display: "flex", gap: 6, alignItems: "center", padding: "3px 0", opacity: lleno ? 0.5 : 1 }} title={lleno ? `Se ven hasta ${MAX_SERIES} a la vez: quita uno para ver este` : t.nombre}>
                <input
                  type="checkbox"
                  checked={activo}
                  disabled={lleno}
                  onChange={(e) => alternarTrabajo(t.clave, e.target.checked)}
                />
                <span style={{ width: 12, height: 12, borderRadius: 3, background: activo ? color.get(t.clave) : "transparent", border: `1px solid ${activo ? color.get(t.clave) : C.border}`, flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.nombre}</span>
              </label>
            );
          })}
          <p style={{ fontSize: 12, color: "var(--tc-gray-500)", lineHeight: 1.45 }}>
            Cada banda es un trabajo que sube de ubicación en ubicación. Si dos bandas se acercan o se cruzan, esas cuadrillas se van a estorbar: separa sus
            inicios o iguala sus ritmos (cuadrillas). La parte oscura de cada tramo es su avance en el último corte.
          </p>
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: "auto", background: "#fff" }}>
          {tabla ? (
            <table style={{ borderCollapse: "collapse", fontSize: 12.5, margin: 10 }}>
              <thead>
                <tr>
                  <th style={th}>Ubicación</th>
                  {visibles.map((t) => (
                    <th key={t.clave} style={{ ...th, maxWidth: 180 }}>
                      {t.nombre}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lb.ubicaciones.map((u, i) => (
                  <tr key={u.id}>
                    <td style={td}>{u.nombre}</td>
                    {visibles.map((t) => {
                      const tramos = t.tramos.filter((x2) => x2.ubicacion === i);
                      return (
                        <td key={t.clave} style={{ ...td, whiteSpace: "nowrap" }}>
                          {tramos.map((x2) => `${fechaCorta(x2.inicio)} → ${fechaCorta(x2.fin)}${avancePct?.get(x2.actividad) ? ` (${fmt(avancePct.get(x2.actividad)!)} %)` : ""}`).join(" · ") || "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <svg width={ancho} height={alto} role="img" aria-label="Línea de balance" style={{ display: "block" }}>
              {/* months */}
              {meses.map((m) => (
                <g key={m.x}>
                  <line x1={m.x} y1={ARRIBA - 6} x2={m.x} y2={alto - 10} stroke="#e6e9ee" />
                  <text x={m.x + 4} y={ARRIBA - 12} fontSize={11} fill="#5f6368">
                    {m.label}
                  </text>
                </g>
              ))}
              {/* places */}
              {lb.ubicaciones.map((u, i) => (
                <g key={u.id}>
                  <line x1={IZQ} y1={y(i) + FILA / 2} x2={ancho - 20} y2={y(i) + FILA / 2} stroke="#f0f2f5" />
                  <text x={IZQ - 8} y={y(i) + 4} fontSize={12} fill="#3c4043" textAnchor="end">
                    {u.nombre.length > 20 ? `${u.nombre.slice(0, 19)}…` : u.nombre}
                  </text>
                </g>
              ))}
              {/* today */}
              {hoy >= inicio && hoy <= res.fin && <line x1={x(hoy)} y1={ARRIBA - 6} x2={x(hoy)} y2={alto - 10} stroke="#e8710a" strokeDasharray="4 3" />}
              {/* each kind of work: the lines joining its starts and its finishes, and a bar in each place */}
              {visibles.map((t) => {
                const c = color.get(t.clave)!;
                const orden = [...t.tramos].sort((a, b) => a.ubicacion - b.ubicacion);
                const inicios = orden.map((x2) => `${x(x2.inicio)},${y(x2.ubicacion)}`).join(" ");
                const fines = orden.map((x2) => `${x(x2.fin) + pxDia},${y(x2.ubicacion)}`).join(" ");
                return (
                  <g key={t.clave}>
                    <polyline points={inicios} fill="none" stroke={c} strokeWidth={2} />
                    <polyline points={fines} fill="none" stroke={c} strokeWidth={2} />
                    {orden.map((x2) => {
                      const x0 = x(x2.inicio);
                      const w = Math.max(x(x2.fin) + pxDia - x0, 3);
                      const pct = Math.min(avancePct?.get(x2.actividad) ?? 0, 100);
                      return (
                        <g key={x2.actividad}>
                          <title>{`${t.nombre} · ${lb.ubicaciones[x2.ubicacion].nombre}\n${fechaCorta(x2.inicio)} → ${fechaCorta(x2.fin)}${pct ? `\nAvance: ${fmt(pct)} %` : ""}`}</title>
                          <rect x={x0} y={y(x2.ubicacion) - 6} width={w} height={12} rx={4} fill={c} fillOpacity={0.35} stroke="#fff" strokeWidth={2} />
                          {pct > 0 && <rect x={x0} y={y(x2.ubicacion) - 6} width={(w * pct) / 100} height={12} rx={4} fill={c} />}
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>
    </Modal>
  );
}

const th: CSSProperties = { padding: "4px 6px", fontWeight: 600, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.grid}`, textAlign: "center", background: "#f3f4f6" };
const td: CSSProperties = { padding: "3px 6px", borderBottom: `1px solid ${C.grid}`, borderRight: `1px solid ${C.grid}` };
const botonSec: CSSProperties = { border: `1px solid ${C.border}`, background: "#fff", borderRadius: 4, padding: "5px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 13 };
