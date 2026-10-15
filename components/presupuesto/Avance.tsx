"use client";

import { CSSProperties, ReactNode, useMemo, useState } from "react";
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  corteAnterior,
  curvaValorGanado,
  ESTADO_AVANCE,
  EstadoAvance,
  FilaControl,
  filasControl,
  Indicadores,
  indicadores,
  lecturaIndicadores,
  lineaBaseDe,
  Medidor,
  nuevoCorte,
  pctDelModelo,
} from "../../lib/presupuesto/avance";
import { diasEntre, fechaCorta } from "../../lib/presupuesto/calendario";
import { exportarExcel, nombreSeguro } from "../../lib/presupuesto/excel";
import { coincide, fecha, fmt } from "../../lib/presupuesto/format";
import type { FilaGantt, Programado, TipoPeriodo } from "../../lib/presupuesto/programacion";
import { tablasValorGanado } from "../../lib/presupuesto/reportes";
import type { AvancePartida, CorteAvance, EjecucionItem, LineaBase, Programacion } from "../../lib/presupuesto/types";
import { todayIso } from "../../lib/propiedades/values";
import { Alternar, compacto, FechaCampo, PERIODOS, useExportar } from "./ProgramacionDialogs";
import { ConfirmDialog } from "./SimpleDialogs";
import { acceptButton, baseInput, C, message, Modal, Notice, NumInput, TextCommit, useVirtual } from "./ui";
import type { useAvance } from "./useAvance";

type Avance = ReturnType<typeof useAvance>;

// ---------------------------------------------------------------- baseline

/** The baseline in force, the saved ones, and saving the schedule on screen as a new one. */
export function LineaBaseDialog({
  av,
  res,
  prog,
  canEdit,
  pendiente,
  onClose,
}: {
  av: Avance;
  res: Programado;
  prog: Programacion;
  canEdit: boolean;
  /** Why the schedule can't be frozen now ("" when it can). */
  pendiente: string;
  onClose: () => void;
}) {
  const [nombre, setNombre] = useState(`Línea base ${av.lineasBase.length + 1}`);
  const [ocupado, setOcupado] = useState(false);
  const [nota, setNota] = useState<{ kind: "info" | "error"; texto: string } | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [usar, setUsar] = useState<{ id: string; nombre: string } | null>(null);
  const datos = useMemo(() => lineaBaseDe(res, prog), [res, prog]);
  const partidas = datos.tareas.filter((t) => t.tipo === "partida").length;
  const vig = av.lineaBase;

  async function guardar() {
    setConfirmar(false);
    setOcupado(true);
    setNota(null);
    try {
      const r = await av.crearLineaBase(nombre.trim(), datos);
      setNota({ kind: "info", texto: `«${r.nombre}» guardada: el avance y el valor ganado se miden ahora contra ella.` });
      setNombre(`Línea base ${av.lineasBase.length + 2}`);
    } catch (err) {
      setNota({ kind: "error", texto: message(err) });
    } finally {
      setOcupado(false);
    }
  }

  async function medirContra(id: string) {
    setUsar(null);
    setOcupado(true);
    setNota(null);
    try {
      await av.usarLineaBase(id);
      setNota({ kind: "info", texto: "Listo: el avance se mide contra esa línea base." });
    } catch (err) {
      setNota({ kind: "error", texto: message(err) });
    } finally {
      setOcupado(false);
    }
  }

  const finDif = vig ? diasEntre(vig.fin, res.fin) : 0;
  const costoDif = vig ? datos.total - vig.total : 0;
  return (
    <Modal title="Línea base" onClose={onClose} width={980} height="86vh">
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
          La <strong>línea base</strong> es la programación aprobada, congelada: las fechas, la duración y el costo de cada partida. El avance de cada corte se
          compara con ella para saber si la obra va adelantada o atrasada, en plazo y en costo. Si se reprograma, se guarda otra; las anteriores se conservan.
        </p>
        {nota && <Notice kind={nota.kind}>{nota.texto}</Notice>}
        <Seccion titulo="Vigente">
          {vig ? (
            <div style={{ fontSize: 13.5, lineHeight: 1.7 }}>
              <strong>{vig.nombre}</strong>, guardada el {fecha(vig.creada)}
              {vig.creadaPor ? ` por ${vig.creadaPor}` : ""}.<br />
              Del {fechaCorta(vig.inicio)} al {fechaCorta(vig.fin)} · {vig.partidas} partidas · costo {fmt(vig.total)}.
              <br />
              <span style={{ color: finDif || Math.abs(costoDif) >= 0.01 ? "#7a5300" : "var(--tc-gray-500)" }}>
                La programación de hoy termina el {fechaCorta(res.fin)}
                {finDif ? ` (${Math.abs(finDif)} día(s) calendario ${finDif > 0 ? "después" : "antes"})` : " (igual)"} y cuesta {fmt(datos.total)}
                {Math.abs(costoDif) >= 0.01 ? ` (${costoDif > 0 ? "+" : ""}${fmt(costoDif)})` : " (igual)"}.
              </span>
            </div>
          ) : (
            <span style={{ fontSize: 13.5, color: "var(--tc-gray-500)" }}>Todavía no hay línea base. Guárdala cuando la programación esté aprobada.</span>
          )}
        </Seccion>

        <Seccion titulo="Guardar la programación de hoy como línea base">
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", fontSize: 13.5 }}>
            <label>
              <span style={{ display: "block", fontSize: 13, color: "var(--tc-gray-500)", marginBottom: 4 }}>Nombre</span>
              <input value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} style={{ ...baseInput, width: 320 }} aria-label="Nombre de la línea base" />
            </label>
            <span style={{ color: "var(--tc-gray-500)" }}>
              {partidas} partidas · del {fechaCorta(datos.inicio)} al {fechaCorta(datos.fin)} · costo {fmt(datos.total)}
            </span>
            <button
              type="button"
              style={{ ...acceptButton, marginLeft: "auto", ...(!canEdit || pendiente || ocupado || !nombre.trim() || !partidas ? apagado : {}) }}
              disabled={!canEdit || !!pendiente || ocupado || !nombre.trim() || !partidas}
              onClick={() => (vig ? setConfirmar(true) : guardar())}
            >
              Guardar como línea base
            </button>
          </div>
          {!canEdit && <Notice kind="info" style={{ marginTop: 8 }}>Solo los administradores y editores del presupuesto guardan líneas base.</Notice>}
          {canEdit && pendiente && <Notice kind="warning" style={{ marginTop: 8 }}>{pendiente}</Notice>}
        </Seccion>

        <Seccion titulo={`Líneas base guardadas (${av.lineasBase.length})`}>
          {av.lineasBase.length === 0 ? (
            <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>Ninguna todavía.</span>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={th}>Nombre</th>
                  <th style={th}>Guardada</th>
                  <th style={th}>Inicio</th>
                  <th style={th}>Fin</th>
                  <th style={th}>Costo</th>
                  <th style={th}>Partidas</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {av.lineasBase.map((l) => (
                  <tr key={l.id}>
                    <td style={td}>
                      <strong>{l.nombre}</strong>
                    </td>
                    <td style={td}>
                      {fecha(l.creada)}
                      {l.creadaPor ? ` · ${l.creadaPor}` : ""}
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>{fechaCorta(l.inicio)}</td>
                    <td style={{ ...td, textAlign: "center" }}>{fechaCorta(l.fin)}</td>
                    <td style={tdNum}>{fmt(l.total)}</td>
                    <td style={tdNum}>{l.partidas}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      {l.vigente ? (
                        <span style={{ ...chip, color: "#1e6b2e", background: "#e3f4e6" }}>Vigente</span>
                      ) : (
                        <button type="button" style={botonSec} disabled={!canEdit || ocupado} onClick={() => setUsar({ id: l.id, nombre: l.nombre })}>
                          Medir contra esta
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Seccion>
      </div>
      {confirmar && vig && (
        <ConfirmDialog title="Nueva línea base" confirmLabel="Guardar" onClose={() => setConfirmar(false)} onConfirm={guardar}>
          «{nombre.trim()}» reemplaza a «{vig.nombre}» como línea base vigente: el avance y el valor ganado se medirán contra ella. «{vig.nombre}» se conserva y
          puedes volver a medir contra ella.
        </ConfirmDialog>
      )}
      {usar && (
        <ConfirmDialog title="Cambiar la línea base vigente" confirmLabel="Medir contra esta" onClose={() => setUsar(null)} onConfirm={() => medirContra(usar.id)}>
          El avance y el valor ganado se medirán contra «{usar.nombre}».
        </ConfirmDialog>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- progress reports

const ROW = 30;

interface Fila {
  clave: string;
  /** A row of the baseline, or a partida of today's budget that isn't in it. */
  control: FilaControl | null;
  nueva: FilaGantt | null;
  encabezado?: string;
}

/** The progress reports: each partida's cumulative % and actual cost at a date, with what the viewer says. */
export function AvanceDialog({ av, res, canEdit, onClose }: { av: Avance; res: Programado; canEdit: boolean; onClose: () => void }) {
  const base = av.lineaBase;
  const cortes = useMemo(() => av.avance?.cortes ?? [], [av.avance]);
  const [corteId, setCorteId] = useState<string | null>(() => (cortes.length ? cortes[cortes.length - 1].id : null));
  const [nuevaFecha, setNuevaFecha] = useState<string | null>(todayIso());
  const [error, setError] = useState("");
  const [spId, setSpId] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [soloActivas, setSoloActivas] = useState(false);
  const [modelo, setModelo] = useState<{ fecha: string; items: Map<string, EjecucionItem> } | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [confirmar, setConfirmar] = useState<"eliminar" | "modelo" | null>(null);
  const corte = cortes.find((c) => c.id === corteId) ?? null;
  const m = useMemo(() => (base ? new Medidor(base.datos) : null), [base]);
  const filas = useMemo(() => (m && corte ? filasControl(m, corte) : []), [m, corte]);
  const ind = useMemo(() => (m && corte ? indicadores(m, corte) : null), [m, corte]);
  const previo = corte ? corteAnterior(cortes, corte.fecha) : null;
  const enPresupuesto = useMemo(() => new Map(res.filas.map((f) => [f.id, f])), [res]);
  const nuevas = useMemo(() => (m ? res.filas.filter((f) => f.tipo === "partida" && !m.porId.has(f.id)) : []), [m, res]);
  const editable = canEdit && !!corte;
  const modeloVigente = modelo && corte && modelo.fecha === corte.fecha ? modelo.items : null;

  const visibles = useMemo((): Fila[] => {
    const filtra = !!texto.trim() || soloActivas;
    const pasa = (id: string, descripcion: string, numero: string, sp: string, pct: number, plan: number) =>
      (!spId || sp === spId) && (!texto.trim() || coincide(`${numero} ${descripcion}`, texto)) && (!soloActivas || pct > 0 || plan > 0 || (previo?.partidas[id]?.pct ?? 0) > 0);
    const out: Fila[] = filas
      .filter((f) => (f.tarea.tipo === "partida" ? pasa(f.tarea.id, f.tarea.descripcion, f.tarea.numero, f.tarea.spId, f.pctReal, f.pctPlaneado) : !filtra && (!spId || f.tarea.spId === spId)))
      .map((f) => ({ clave: f.tarea.id, control: f, nueva: null }));
    const extra = nuevas.filter((f) => pasa(f.id, f.descripcion, f.numero, f.spId, corte?.partidas[f.id]?.pct ?? 0, 0));
    if (extra.length) {
      out.push({ clave: "__nuevas", control: null, nueva: null, encabezado: `Partidas nuevas, que no están en la línea base (${extra.length}): su avance se guarda, pero no cuenta en el valor ganado hasta guardar otra línea base.` });
      out.push(...extra.map((f) => ({ clave: f.id, control: null, nueva: f })));
    }
    return out;
  }, [filas, nuevas, texto, soloActivas, spId, previo, corte]);

  const { ref, start, end, padTop, padBottom } = useVirtual(visibles.length, ROW);

  if (!base || !m) {
    return (
      <Modal title="Avance de obra" onClose={onClose} width={720}>
        <div style={{ padding: 16 }}>
          <Notice kind="info">Primero guarda la línea base (botón «Línea base»): el avance se mide contra la programación aprobada.</Notice>
        </div>
      </Modal>
    );
  }

  function cambiarCortes(cambio: (c: CorteAvance[]) => CorteAvance[]) {
    av.setAvance((a) => ({ ...a, cortes: cambio(a.cortes).sort((x, y) => x.fecha.localeCompare(y.fecha)) }));
  }

  function crearCorte() {
    if (!nuevaFecha) return;
    if (cortes.some((c) => c.fecha === nuevaFecha)) {
      setError(`Ya hay un corte del ${fechaCorta(nuevaFecha)}: elígelo en la lista.`);
      return;
    }
    setError("");
    const c = nuevoCorte(globalThis.crypto.randomUUID(), nuevaFecha, corteAnterior(cortes, nuevaFecha));
    cambiarCortes((l) => [...l, c]);
    setCorteId(c.id);
  }

  function cambiarFecha(f: string | null) {
    if (!corte || !f || f === corte.fecha) return;
    if (cortes.some((c) => c.fecha === f && c.id !== corte.id)) {
      setError(`Ya hay un corte del ${fechaCorta(f)}.`);
      return;
    }
    setError("");
    cambiarCortes((l) => l.map((c) => (c.id === corte.id ? { ...c, fecha: f } : c)));
  }

  /** Changes a partida's progress in this cut; one without progress or cost isn't kept. */
  function setPartida(id: string, cambio: (a: AvancePartida) => AvancePartida) {
    if (!corte) return;
    cambiarCortes((l) =>
      l.map((c) => {
        if (c.id !== corte.id) return c;
        const partidas = { ...c.partidas };
        const a = cambio(partidas[id] ? { ...partidas[id] } : { pct: 0 });
        if (a.pct > 0 || a.costo !== undefined) partidas[id] = a;
        else delete partidas[id];
        return { ...c, partidas };
      })
    );
  }

  async function leerModelo() {
    if (!corte) return;
    setLeyendo(true);
    setError("");
    try {
      const items = await av.resumenEjecucion(corte.fecha);
      setModelo({ fecha: corte.fecha, items: new Map(items.map((x) => [x.itemId, x])) });
    } catch (err) {
      setError(message(err));
    } finally {
      setLeyendo(false);
    }
  }

  // Partidas whose % differs from what the viewer says (only those with linked elements).
  const difierenDelModelo =
    modeloVigente && corte
      ? [...m.porId.keys(), ...nuevas.map((f) => f.id)].filter((id) => {
          const pm = pctDelModelo(modeloVigente.get(id));
          return pm !== null && Math.abs(pm - (corte.partidas[id]?.pct ?? 0)) > 0.005;
        })
      : [];

  function usarModelo(ids: string[]) {
    if (!modeloVigente) return;
    for (const id of ids) {
      const pm = pctDelModelo(modeloVigente.get(id));
      if (pm !== null) setPartida(id, (a) => ({ ...a, pct: pm }));
    }
  }

  const spRows = base.datos.tareas.filter((t) => t.tipo === "sp");
  return (
    <Modal
      title="Avance de obra"
      onClose={onClose}
      width="97vw"
      height="94vh"
      toolbar={
        <>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 600 }}>
            Corte:
            <select value={corte?.id ?? ""} onChange={(e) => setCorteId(e.target.value || null)} style={{ ...baseInput, minWidth: 150 }} aria-label="Corte de avance">
              {cortes.length === 0 && <option value="">(ninguno)</option>}
              {[...cortes].reverse().map((c) => (
                <option key={c.id} value={c.id}>
                  {fechaCorta(c.fecha)}
                </option>
              ))}
            </select>
          </label>
          {canEdit && (
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <FechaCampo id="nuevo-corte" value={nuevaFecha} onChange={setNuevaFecha} width={130} />
              <button type="button" style={botonSec} disabled={!nuevaFecha} onClick={crearCorte} title="Copia el avance del corte anterior a esa fecha para actualizarlo">
                + Nuevo corte
              </button>
            </span>
          )}
          {canEdit && corte && (
            <button type="button" style={{ ...botonSec, color: "#8a1c14" }} onClick={() => setConfirmar("eliminar")}>
              Eliminar este corte
            </button>
          )}
          <button
            type="button"
            style={{ ...acceptButton, padding: "6px 16px", fontSize: 14, marginLeft: "auto", ...(!canEdit || !av.dirty || av.saving ? apagado : {}) }}
            disabled={!canEdit || !av.dirty || av.saving}
            onClick={() => av.save()}
          >
            {av.saving ? "Guardando..." : "Guardar el avance"}
          </button>
        </>
      }
    >
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0 }}>
        <div style={{ fontSize: 12.5, display: "flex", gap: 12, flexWrap: "wrap", color: "var(--tc-gray-500)" }}>
          <span>
            Línea base: <strong style={{ color: "var(--tc-gray-700)" }}>{base.nombre}</strong> ({fechaCorta(base.inicio)} a {fechaCorta(base.fin)})
          </span>
          {av.saveError ? (
            <span style={{ color: "#8a1c14" }}>
              {av.saveError.text}{" "}
              {av.saveError.conflict && (
                <button type="button" style={linkBtn} onClick={() => av.recargar()}>
                  Recargar el avance guardado
                </button>
              )}
            </span>
          ) : av.dirty ? (
            <span style={{ color: "#7a5300" }}>Cambios sin guardar.</span>
          ) : av.meta.updatedAt ? (
            <span>
              Guardado{av.meta.updatedBy ? ` por ${av.meta.updatedBy}` : ""} el {fecha(av.meta.updatedAt)}.
            </span>
          ) : null}
          {!canEdit && <span>Solo consulta: el avance lo registran los administradores y editores del presupuesto.</span>}
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        {!corte ? (
          <Notice kind="info">
            Todavía no hay cortes. Elige la fecha del primer corte arriba y pulsa «+ Nuevo corte»; luego escribe el % acumulado de cada partida (o la cantidad
            ejecutada) y, si lo llevas, su costo real acumulado.
          </Notice>
        ) : (
          <>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                Fecha del corte:
                {canEdit ? <FechaCampo id="fecha-corte" value={corte.fecha} onChange={cambiarFecha} width={130} /> : <strong>{fechaCorta(corte.fecha)}</strong>}
              </span>
              <span style={{ display: "flex", gap: 6, alignItems: "center", flex: 1, minWidth: 260 }}>
                Nota:
                {canEdit ? (
                  <TextCommit
                    value={corte.nota}
                    onCommit={(v) => cambiarCortes((l) => l.map((c) => (c.id === corte.id ? { ...c, nota: v } : c)))}
                    placeholder="Opcional: lluvias, cambio de frente..."
                    style={{ ...baseInput, flex: 1 }}
                    ariaLabel="Nota del corte"
                  />
                ) : (
                  <span>{corte.nota || "—"}</span>
                )}
              </span>
              {previo && <span style={{ color: "var(--tc-gray-500)" }}>Corte anterior: {fechaCorta(previo.fecha)}</span>}
            </div>
            {ind && <ResumenIndicadores ind={ind} />}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
              <select value={spId ?? ""} onChange={(e) => setSpId(e.target.value || null)} style={{ ...baseInput, minWidth: 200 }} aria-label="Subpresupuesto">
                <option value="">Todos los subpresupuestos</option>
                {spRows.map((s) => (
                  <option key={s.id} value={s.spId}>
                    {s.descripcion}
                  </option>
                ))}
              </select>
              <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar partida" style={{ ...baseInput, width: 220 }} aria-label="Buscar partida" />
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" checked={soloActivas} onChange={(e) => setSoloActivas(e.target.checked)} /> Solo las que tienen avance o ya debían empezar
              </label>
              <button type="button" style={{ ...botonSec, marginLeft: "auto" }} disabled={leyendo} onClick={leerModelo} title="Lee los elementos marcados como ejecutados en el visor 3D hasta la fecha del corte">
                {leyendo ? "Leyendo..." : `Leer el avance del modelo 3D al ${fechaCorta(corte.fecha)}`}
              </button>
              {modeloVigente && editable && difierenDelModelo.length > 0 && (
                <button type="button" style={{ ...botonSec, color: "#0b57d0" }} onClick={() => setConfirmar("modelo")}>
                  Usar el % del modelo en {difierenDelModelo.length} partida(s)
                </button>
              )}
              {modeloVigente && difierenDelModelo.length === 0 && <span style={{ color: "#1e6b2e" }}>El avance coincide con el modelo.</span>}
            </div>
            <div ref={ref} style={{ flex: 1, minHeight: 0, overflow: "auto", border: `1px solid ${C.border}`, background: "#fff" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13, tableLayout: "fixed", width: COLUMNAS.reduce((s, c) => s + c.ancho, 0) }}>
                <colgroup>
                  {COLUMNAS.map((c) => (
                    <col key={c.titulo} style={{ width: c.ancho }} />
                  ))}
                </colgroup>
                <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                  <tr>
                    {COLUMNAS.map((c) => (
                      <th key={c.titulo} style={{ ...th, height: ROW }} title={c.title}>
                        {c.titulo}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {padTop > 0 && (
                    <tr style={{ height: padTop }}>
                      <td colSpan={COLUMNAS.length} />
                    </tr>
                  )}
                  {visibles.slice(start, end).map((f) =>
                    f.encabezado ? (
                      <tr key={f.clave} style={{ height: ROW }}>
                        <td colSpan={COLUMNAS.length} style={{ ...td, background: "#fff3cd", color: "#7a5300", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {f.encabezado}
                        </td>
                      </tr>
                    ) : (
                      <FilaAvance
                        key={f.clave}
                        f={f}
                        corte={corte}
                        previo={previo}
                        enPresupuesto={!!enPresupuesto.get(f.control?.tarea.id ?? f.nueva?.id ?? "")}
                        metradoHoy={enPresupuesto.get(f.control?.tarea.id ?? f.nueva?.id ?? "")?.metrado ?? null}
                        modelo={modeloVigente}
                        editable={editable}
                        setPartida={setPartida}
                      />
                    )
                  )}
                  {padBottom > 0 && (
                    <tr style={{ height: padBottom }}>
                      <td colSpan={COLUMNAS.length} />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>
              El % es acumulado a la fecha del corte. La cantidad ejecutada se convierte en % con el metrado de la partida. El costo real (acumulado, opcional)
              permite medir el costo: el CPI usa las partidas que lo tienen.
            </span>
          </>
        )}
      </div>
      {confirmar === "eliminar" && corte && (
        <ConfirmDialog
          title="Eliminar el corte"
          danger
          confirmLabel="Eliminar"
          onClose={() => setConfirmar(null)}
          onConfirm={() => {
            cambiarCortes((l) => l.filter((c) => c.id !== corte.id));
            const resto = cortes.filter((c) => c.id !== corte.id);
            setCorteId(resto.length ? resto[resto.length - 1].id : null);
            setConfirmar(null);
          }}
        >
          Se quitará el corte del {fechaCorta(corte.fecha)} con el avance de sus {Object.keys(corte.partidas).length} partida(s). No se borra nada hasta que pulses «Guardar el avance».
        </ConfirmDialog>
      )}
      {confirmar === "modelo" && corte && (
        <ConfirmDialog
          title="Usar el avance del modelo"
          confirmLabel="Usar el del modelo"
          onClose={() => setConfirmar(null)}
          onConfirm={() => {
            usarModelo(difierenDelModelo);
            setConfirmar(null);
          }}
        >
          En {difierenDelModelo.length} partida(s) el % escrito en este corte es distinto del que dan sus elementos marcados como ejecutados en el visor. Se
          reemplazará por el del modelo; puedes revisarlo antes de guardar.
        </ConfirmDialog>
      )}
    </Modal>
  );
}

const COLUMNAS: { titulo: string; ancho: number; title?: string }[] = [
  { titulo: "Item", ancho: 70 },
  { titulo: "Partida", ancho: 320 },
  { titulo: "Und.", ancho: 52 },
  { titulo: "Inicio LB", ancho: 92 },
  { titulo: "Fin LB", ancho: 92 },
  { titulo: "Costo LB", ancho: 118, title: "Costo de la partida en la línea base (BAC)" },
  { titulo: "% planeado", ancho: 82, title: "Lo que la línea base preveía tener hecho a la fecha del corte" },
  { titulo: "% real", ancho: 92, title: "Avance acumulado a la fecha del corte" },
  { titulo: "Cant. ejecutada", ancho: 112, title: "Lo mismo, en cantidad: se convierte en % con el metrado" },
  { titulo: "% modelo 3D", ancho: 112, title: "Según los elementos marcados como ejecutados en el visor (por cantidad, o por conteo si no se miden)" },
  { titulo: "Costo real acum.", ancho: 130, title: "Opcional: lo gastado en la partida hasta la fecha (acumulado)" },
  { titulo: "Valor ganado", ancho: 118, title: "Costo LB × % real (EV)" },
  { titulo: "Estado", ancho: 96 },
];

function FilaAvance({
  f,
  corte,
  previo,
  enPresupuesto,
  metradoHoy,
  modelo,
  editable,
  setPartida,
}: {
  f: Fila;
  corte: CorteAvance;
  previo: CorteAvance | null;
  enPresupuesto: boolean;
  metradoHoy: number | null;
  modelo: Map<string, EjecucionItem> | null;
  editable: boolean;
  setPartida: (id: string, cambio: (a: AvancePartida) => AvancePartida) => void;
}) {
  const c = f.control;
  const t = c?.tarea;
  const n = f.nueva;
  const id = t?.id ?? n!.id;
  const esPartida = t ? t.tipo === "partida" : true;
  const a = corte.partidas[id];
  const pct = a?.pct ?? 0;
  const antes = previo?.partidas[id]?.pct ?? 0;
  const metrado = metradoHoy ?? t?.metrado ?? n?.metrado ?? null;
  const pm = esPartida && modelo ? pctDelModelo(modelo.get(id)) : null;
  const estado: EstadoAvance | null = c ? c.estado : null;
  const negrita = !esPartida;
  const nivel = t ? t.nivel : n!.nivel;
  const celda = (contenido: ReactNode, estilo: CSSProperties = {}) => <td style={{ ...td, ...estilo }}>{contenido}</td>;
  return (
    <tr style={{ height: ROW, background: negrita ? "#f6f8fb" : undefined, fontWeight: negrita ? 700 : 400 }}>
      {celda(t?.tipo === "sp" ? "SP" : t?.numero ?? n?.numero, { whiteSpace: "nowrap" })}
      {celda(
        <span style={{ paddingLeft: Math.max(0, nivel - 1) * 12, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={t?.descripcion ?? n?.descripcion}>
          {t?.tipo === "sp" ? `SP: ${t.descripcion}` : t?.descripcion ?? n?.descripcion}
          {esPartida && !enPresupuesto && <span style={{ color: "#8a1c14", fontWeight: 400, fontSize: 11.5 }}> (ya no está en el presupuesto)</span>}
        </span>
      )}
      {celda(esPartida ? t?.unidad ?? n?.unidad : "", { textAlign: "center" })}
      {celda(t ? fechaCorta(t.inicio) : "", { textAlign: "center" })}
      {celda(t ? fechaCorta(t.fin) : "", { textAlign: "center" })}
      {celda(c ? fmt(c.bac) : "", tdNumExtra)}
      {celda(c ? `${fmt(c.pctPlaneado)} %` : "", tdNumExtra)}
      {celda(
        esPartida && editable ? (
          <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <NumInput value={pct} decimals={2} ariaLabel={`% real de ${t?.descripcion ?? n?.descripcion}`} onCommit={(v) => setPartida(id, (x) => ({ ...x, pct: Math.min(Math.max(v ?? 0, 0), 100) }))} style={celdaInput} />
            {pct < antes - 0.005 && (
              <span title={`Es menor que en el corte anterior (${fmt(antes)} %): el avance es acumulado.`} style={{ color: "#b06000" }}>
                ⚠
              </span>
            )}
          </span>
        ) : esPartida ? (
          `${fmt(pct)} %`
        ) : c ? (
          `${fmt(c.pctReal)} %`
        ) : (
          ""
        ),
        tdNumExtra
      )}
      {celda(
        esPartida && metrado && metrado > 0 ? (
          editable ? (
            <NumInput
              value={Math.round(((pct / 100) * metrado) * 100) / 100}
              decimals={2}
              ariaLabel={`Cantidad ejecutada de ${t?.descripcion ?? n?.descripcion}`}
              onCommit={(v) => setPartida(id, (x) => ({ ...x, pct: Math.round(Math.min(Math.max(((v ?? 0) / metrado) * 100, 0), 100) * 100) / 100 }))}
              style={celdaInput}
            />
          ) : (
            fmt((pct / 100) * metrado)
          )
        ) : (
          ""
        ),
        tdNumExtra
      )}
      {celda(
        pm === null ? (
          ""
        ) : (
          <span style={{ display: "flex", justifyContent: "flex-end", gap: 4, alignItems: "center" }}>
            {fmt(pm)} %
            {editable && Math.abs(pm - pct) > 0.005 && (
              <button type="button" title="Usar este % en el corte" onClick={() => setPartida(id, (x) => ({ ...x, pct: pm }))} style={mini}>
                usar
              </button>
            )}
          </span>
        ),
        { ...tdNumExtra, color: pm !== null && Math.abs(pm - pct) > 0.005 ? "#0b57d0" : undefined }
      )}
      {celda(
        esPartida && editable ? (
          <NumInput
            value={a?.costo ?? null}
            decimals={2}
            allowEmpty
            ariaLabel={`Costo real de ${t?.descripcion ?? n?.descripcion}`}
            onCommit={(v) =>
              setPartida(id, (x) => {
                const { costo: _c, ...resto } = x;
                return v === null ? resto : { ...resto, costo: Math.max(v, 0) };
              })
            }
            style={celdaInput}
          />
        ) : c?.ac !== null && c?.ac !== undefined ? (
          fmt(c.ac)
        ) : (
          ""
        ),
        tdNumExtra
      )}
      {celda(c ? fmt(c.ev) : "", tdNumExtra)}
      {celda(estado ? <span style={{ ...chip, color: ESTADO_AVANCE[estado].color, background: ESTADO_AVANCE[estado].fondo }}>{ESTADO_AVANCE[estado].texto}</span> : n ? <span style={{ fontSize: 11.5, color: "#7a5300" }}>fuera de LB</span> : "", { textAlign: "center" })}
    </tr>
  );
}

function ResumenIndicadores({ ind }: { ind: Indicadores }) {
  const color = (x: number | null) => (x === null ? undefined : x < 0.98 ? "#8a1c14" : x > 1.02 ? "#0b57d0" : "#1e6b2e");
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
      <Dato titulo="% planeado" valor={`${fmt(ind.pctPlaneado)} %`} />
      <Dato titulo="% real" valor={`${fmt(ind.pctReal)} %`} />
      <Dato titulo="Valor planeado (PV)" valor={fmt(ind.pv)} />
      <Dato titulo="Valor ganado (EV)" valor={fmt(ind.ev)} />
      <Dato titulo="Costo real (AC)" valor={ind.ac === null ? "—" : fmt(ind.ac)} />
      <Dato titulo="SPI" valor={ind.spi === null ? "—" : fmt(ind.spi, 3)} color={color(ind.spi)} />
      <Dato titulo="CPI" valor={ind.cpi === null ? "—" : fmt(ind.cpi, 3)} color={color(ind.cpi)} />
      <Dato
        titulo="Plazo"
        valor={ind.terminada ? "Terminada" : ind.svDias === null ? "—" : ind.svDias < -0.5 ? `${fmt(-ind.svDias, 1)} días atrasada` : ind.svDias > 0.5 ? `${fmt(ind.svDias, 1)} días adelantada` : "Al día"}
        color={ind.svDias === null || ind.terminada ? undefined : ind.svDias < -0.5 ? "#8a1c14" : ind.svDias > 0.5 ? "#0b57d0" : "#1e6b2e"}
      />
    </div>
  );
}

function Dato({ titulo, valor, color, grande }: { titulo: string; valor: string; color?: string; grande?: boolean }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: grande ? "8px 12px" : "4px 10px", background: "#fff", minWidth: grande ? 150 : 110 }}>
      <div style={{ color: "var(--tc-gray-500)", fontSize: grande ? 12 : 11.5 }}>{titulo}</div>
      <div style={{ fontWeight: 700, fontSize: grande ? 17 : 13.5, color, fontVariantNumeric: "tabular-nums" }}>{valor}</div>
    </div>
  );
}

// ---------------------------------------------------------------- earned value

/** The planned S-curve against the earned one and the actual cost, with the indicators of a cut. */
export function ValorGanadoDialog({ av, proyecto, onClose }: { av: Avance; proyecto: string; onClose: () => void }) {
  const base: LineaBase | null = av.lineaBase;
  const cortes = useMemo(() => av.avance?.cortes ?? [], [av.avance]);
  const [corteId, setCorteId] = useState<string | null>(cortes.length ? cortes[cortes.length - 1].id : null);
  const [alcance, setAlcance] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoPeriodo>("semana");
  const x = useExportar();
  const m = useMemo(() => (base ? new Medidor(base.datos) : null), [base]);
  const corte = cortes.find((c) => c.id === corteId) ?? null;
  const curva = useMemo(() => (m ? curvaValorGanado(m, cortes, tipo, alcance) : null), [m, cortes, tipo, alcance]);
  const ind = useMemo(() => (m && corte ? indicadores(m, corte, alcance) : null), [m, corte, alcance]);
  const filas = useMemo(() => (m && corte ? filasControl(m, corte) : []), [m, corte]);
  const historia = useMemo(() => (m ? cortes.map((c) => indicadores(m, c, alcance)) : []), [m, cortes, alcance]);

  if (!base || !m || !curva) {
    return (
      <Modal title="Valor ganado" onClose={onClose} width={720}>
        <div style={{ padding: 16 }}>
          <Notice kind="info">Primero guarda la línea base (botón «Línea base») y registra el avance en cortes (botón «Avance»).</Notice>
        </div>
      </Modal>
    );
  }

  const opciones = base.datos.tareas.filter((t) => t.tipo === "sp" || (t.tipo === "titulo" && t.nivel <= 2));
  const nombreAlcance = alcance ? m.porId.get(alcance)?.descripcion ?? "" : "Todo el presupuesto";
  const datos = curva.puntos.map((p) => ({ periodo: p.periodo.etiqueta, pv: p.pv, ev: p.ev, ac: p.ac }));
  const capitulos = filas.filter((f) => f.tarea.tipo !== "partida" && (!alcance || f.tarea.id === alcance || f.tarea.ancestros.includes(alcance)));
  return (
    <Modal
      title="Valor ganado"
      onClose={onClose}
      width={1180}
      height="92vh"
      toolbar={
        <>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 600 }}>
            Corte:
            <select value={corte?.id ?? ""} onChange={(e) => setCorteId(e.target.value || null)} style={{ ...baseInput, minWidth: 130 }} aria-label="Corte">
              {cortes.length === 0 && <option value="">(ninguno)</option>}
              {[...cortes].reverse().map((c) => (
                <option key={c.id} value={c.id}>
                  {fechaCorta(c.fecha)}
                </option>
              ))}
            </select>
          </label>
          <select value={alcance ?? ""} onChange={(e) => setAlcance(e.target.value || null)} style={{ ...baseInput, minWidth: 240 }} aria-label="Alcance">
            <option value="">Todo el presupuesto</option>
            {opciones.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tipo === "sp" ? `SP: ${t.descripcion}` : `${"  ".repeat(Math.max(0, t.nivel - 1))}${t.numero} ${t.descripcion}`}
              </option>
            ))}
          </select>
          <Alternar label="Periodo" value={tipo} opciones={PERIODOS} onChange={setTipo} />
          <button
            type="button"
            style={botonSec}
            disabled={x.ocupado || !corte}
            onClick={() => corte && x.exportar(() => exportarExcel(tablasValorGanado(filas, curvaValorGanado(m, cortes, tipo, null), corte.fecha, base.nombre, tipo), `${nombreSeguro(`Valor ganado ${proyecto}`)}.xlsx`))}
          >
            Exportar a hoja de cálculo
          </button>
          {x.error && <span style={{ color: "#8a1c14", fontSize: 13 }}>{x.error}</span>}
        </>
      }
    >
      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, overflow: "auto" }}>
        <div style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>
          {nombreAlcance} · línea base «{base.nombre}» ({fechaCorta(base.inicio)} a {fechaCorta(base.fin)})
        </div>
        {!corte && <Notice kind="info">Todavía no hay cortes de avance: la gráfica muestra solo lo planeado. Registra el avance en el botón «Avance».</Notice>}
        {ind && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Dato grande titulo="Costo LB (BAC)" valor={fmt(ind.bac)} />
              <Dato grande titulo={`Planeado (PV) · ${fmt(ind.pctPlaneado)} %`} valor={fmt(ind.pv)} />
              <Dato grande titulo={`Ganado (EV) · ${fmt(ind.pctReal)} %`} valor={fmt(ind.ev)} color="#1e6b2e" />
              <Dato grande titulo={`Costo real (AC)${ind.ac !== null ? ` · ${ind.conCosto} partida(s)` : ""}`} valor={ind.ac === null ? "—" : fmt(ind.ac)} color="#b3261e" />
              <Dato grande titulo="SPI (plazo)" valor={ind.spi === null ? "—" : fmt(ind.spi, 3)} color={semaforo(ind.spi)} />
              <Dato grande titulo="CPI (costo)" valor={ind.cpi === null ? "—" : fmt(ind.cpi, 3)} color={semaforo(ind.cpi)} />
              <Dato grande titulo="Variación de plazo (SV)" valor={fmt(ind.sv)} color={ind.sv < 0 ? "#8a1c14" : undefined} />
              <Dato grande titulo="Variación de costo (CV)" valor={ind.cv === null ? "—" : fmt(ind.cv)} color={ind.cv !== null && ind.cv < 0 ? "#8a1c14" : undefined} />
              <Dato
                grande
                titulo="Desfase (días hábiles)"
                valor={ind.terminada ? "Terminada" : ind.svDias === null ? "—" : `${ind.svDias > 0 ? "+" : ""}${fmt(ind.svDias, 1)}`}
                color={ind.svDias === null || ind.terminada ? undefined : ind.svDias < -0.5 ? "#8a1c14" : ind.svDias > 0.5 ? "#0b57d0" : "#1e6b2e"}
              />
              <Dato grande titulo={`Fin estimado (LB: ${fechaCorta(alcance ? m.porId.get(alcance)?.fin ?? base.fin : base.fin)})`} valor={ind.finEstimado ? fechaCorta(ind.finEstimado) : "—"} />
              <Dato grande titulo="Costo estimado al final (EAC)" valor={ind.eac === null ? "—" : fmt(ind.eac)} color={ind.vac !== null && ind.vac < 0 ? "#8a1c14" : undefined} />
            </div>
            <Notice kind="info">
              {lecturaIndicadores(ind).map((l) => (
                <div key={l}>{l}</div>
              ))}
            </Notice>
          </>
        )}
        <div style={{ height: 340, flexShrink: 0, background: "#fff", border: `1px solid ${C.border}`, padding: "8px 4px 0" }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={datos} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid stroke="#eef1f5" />
              <XAxis dataKey="periodo" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => compacto.format(v)} width={70} />
              <Tooltip formatter={(v) => (v === null || v === undefined ? "—" : fmt(Number(v)))} />
              <Legend />
              <Line type="monotone" dataKey="pv" name="Planeado (PV, línea base)" stroke="#4a77e8" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="ev" name="Ganado (EV, real)" stroke="#2e8540" strokeWidth={2.5} dot={datos.length <= 60} connectNulls={false} />
              <Line type="monotone" dataKey="ac" name="Costo real (AC)" stroke="#d93025" strokeWidth={2} strokeDasharray="6 4" dot={datos.length <= 60} connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {historia.length > 0 && (
          <Tabla
            titulo="Cortes"
            cabeceras={["Fecha", "% planeado", "% real", "PV", "EV", "AC", "SPI", "CPI", "Desfase (días)"]}
            filas={historia.map((i) => [
              fechaCorta(i.fecha),
              `${fmt(i.pctPlaneado)} %`,
              `${fmt(i.pctReal)} %`,
              fmt(i.pv),
              fmt(i.ev),
              i.ac === null ? "—" : fmt(i.ac),
              i.spi === null ? "—" : fmt(i.spi, 3),
              i.cpi === null ? "—" : fmt(i.cpi, 3),
              i.terminada ? "Terminada" : i.svDias === null ? "—" : fmt(i.svDias, 1),
            ])}
          />
        )}
        {corte && capitulos.length > 0 && (
          <Tabla
            titulo={`Por subpresupuesto y capítulo al ${fechaCorta(corte.fecha)}`}
            cabeceras={["Capítulo", "Costo LB", "PV", "EV", "AC", "% planeado", "% real", "SPI", "CPI", "Estado"]}
            filas={capitulos.map((f) => [
              <span key="d" style={{ paddingLeft: f.tarea.nivel * 12, fontWeight: f.tarea.tipo === "sp" ? 700 : 600 }}>
                {f.tarea.tipo === "sp" ? `SP: ${f.tarea.descripcion}` : `${f.tarea.numero} ${f.tarea.descripcion}`}
              </span>,
              fmt(f.bac),
              fmt(f.pv),
              fmt(f.ev),
              f.ac === null ? "—" : fmt(f.ac),
              `${fmt(f.pctPlaneado)} %`,
              `${fmt(f.pctReal)} %`,
              f.spi === null ? "—" : fmt(f.spi, 3),
              f.cpi === null ? "—" : fmt(f.cpi, 3),
              <span key="e" style={{ ...chip, color: ESTADO_AVANCE[f.estado].color, background: ESTADO_AVANCE[f.estado].fondo }}>
                {ESTADO_AVANCE[f.estado].texto}
              </span>,
            ])}
          />
        )}
        <p style={{ margin: 0, fontSize: 12, color: "var(--tc-gray-500)", lineHeight: 1.5 }}>
          PV: lo que la línea base preveía ejecutar (en costo) hasta la fecha. EV: el costo de la línea base de lo realmente ejecutado. AC: lo gastado. SPI = EV ÷ PV
          y CPI = EV ÷ AC (menos de 1 es atraso o sobrecosto). El desfase en días compara la fecha en que la línea base preveía lo ejecutado con la del corte.
        </p>
      </div>
    </Modal>
  );
}

const semaforo = (x: number | null) => (x === null ? undefined : x < 0.98 ? "#8a1c14" : x > 1.02 ? "#0b57d0" : "#1e6b2e");

function Tabla({ titulo, cabeceras, filas }: { titulo: string; cabeceras: string[]; filas: ReactNode[][] }) {
  return (
    <Seccion titulo={titulo}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            {cabeceras.map((c) => (
              <th key={c} style={th}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i}>
              {f.map((c, k) => (
                <td key={k} style={k === 0 ? td : tdNum}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Seccion>
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
const td: CSSProperties = { padding: "3px 6px", borderBottom: `1px solid ${C.grid}`, borderRight: `1px solid ${C.grid}`, overflow: "hidden" };
const tdNumExtra: CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const tdNum: CSSProperties = { ...td, ...tdNumExtra };
const celdaInput: CSSProperties = { width: "100%", padding: "2px 6px", fontSize: 13, textAlign: "right" };
const chip: CSSProperties = { display: "inline-block", borderRadius: 10, padding: "1px 8px", fontSize: 11.5, fontWeight: 600 };
const botonSec: CSSProperties = { border: `1px solid ${C.border}`, background: "#fff", borderRadius: 4, padding: "5px 10px", cursor: "pointer", fontFamily: "inherit", fontSize: 13 };
const mini: CSSProperties = { border: "1px solid #0b57d0", background: "#fff", color: "#0b57d0", borderRadius: 3, padding: "0 5px", cursor: "pointer", fontFamily: "inherit", fontSize: 11 };
const linkBtn: CSSProperties = { border: "none", background: "transparent", color: "var(--tc-blue-700)", textDecoration: "underline", cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: 12.5 };
const apagado: CSSProperties = { opacity: 0.45, cursor: "not-allowed" };
