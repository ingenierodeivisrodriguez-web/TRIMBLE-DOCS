"use client";

import { CSSProperties, ReactNode, useEffect, useMemo, useState } from "react";
import type { Resolver, SubpresupuestoCalculado } from "../../lib/presupuesto/calc";
import { fechaCorta } from "../../lib/presupuesto/calendario";
import { exportarExcel, nombreSeguro } from "../../lib/presupuesto/excel";
import { fecha, fmt } from "../../lib/presupuesto/format";
import { calendarioInsumos, calendarioValorizado, curvaS, leerPredecesoras, programar } from "../../lib/presupuesto/programacion";
import { tablaCalendarioInsumos, tablaCalendarioValorizado, tablaCurvaS, tablaProgramacion } from "../../lib/presupuesto/reportes";
import { MAX_DURACION_DIAS, PresupuestoDoc, TareaProgramada } from "../../lib/presupuesto/types";
import Gantt from "./Gantt";
import { CalendarioDialog, CurvaSDialog, EstimarDialog, FechaCampo, InsumosPeriodoDialog, TareaDialog, ValorizadoDialog } from "./ProgramacionDialogs";
import { ConfirmDialog } from "./SimpleDialogs";
import { C, message, Notice } from "./ui";
import type { useProgramacion } from "./useProgramacion";

type Dialogo =
  | { tipo: "calendario" | "estimar" | "curva" | "valorizado" | "insumos" | "recargar" }
  | { tipo: "tarea"; id: string };

/**
 * The schedule (Gantt) of the budget: its outline gives the tasks, the
 * partidas' metrado and rendimiento their durations, and the user links them
 * and sets the calendar.
 */
export default function Programacion({
  p,
  doc,
  calculados,
  resolver,
  canEdit,
  projectName,
  presupuestoSinGuardar,
  onVolver,
}: {
  p: ReturnType<typeof useProgramacion>;
  doc: PresupuestoDoc;
  calculados: Map<string, SubpresupuestoCalculado>;
  resolver: Resolver;
  canEdit: boolean;
  projectName: string;
  presupuestoSinGuardar: boolean;
  onVolver: () => void;
}) {
  const { prog, setProg } = p;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [critica, setCritica] = useState(false);
  const [pxDia, setPxDia] = useState(24);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [aviso, setAviso] = useState("");
  const [exportando, setExportando] = useState(false);

  const calculo = useMemo(() => {
    if (!prog) return null;
    try {
      return { res: programar(doc, calculados, prog), error: "" };
    } catch (err) {
      return { res: null, error: message(err) };
    }
  }, [doc, calculados, prog]);
  const res = calculo?.res ?? null;
  const visibles = useMemo(() => (res ? res.filas.filter((f) => !f.ancestros.some((a) => collapsed.has(a))) : []), [res, collapsed]);
  const partidas = res ? res.filas.filter((f) => f.tipo === "partida").length : 0;

  // Ctrl+S saves the schedule.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (canEdit && p.dirty && !p.saving) p.save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit, p]);

  /** Changes a partida's settings; empty settings are dropped. */
  function setTarea(id: string, cambio: (t: TareaProgramada) => TareaProgramada) {
    setProg((x) => {
      const t = cambio({ ...(x.tareas[id] ?? {}) });
      const tareas = { ...x.tareas };
      if (Object.keys(t).length) tareas[id] = t;
      else delete tareas[id];
      return { ...x, tareas };
    });
  }

  async function exportar() {
    if (!res) return;
    setExportando(true);
    setAviso("");
    try {
      await exportarExcel(
        [
          tablaProgramacion(res, projectName),
          tablaCalendarioValorizado(calendarioValorizado(res, null, "mes"), "Todos los subpresupuestos"),
          tablaCalendarioInsumos(calendarioInsumos(res, resolver, null, "mes"), "Todos los subpresupuestos", "costo"),
          tablaCurvaS(curvaS(res, "mes"), "Todos los subpresupuestos", "mes"),
        ],
        `${nombreSeguro(`Programación ${projectName}`)}.xlsx`
      );
    } catch (err) {
      setAviso(`No se pudo exportar: ${message(err)}`);
    } finally {
      setExportando(false);
    }
  }

  const dis = !canEdit;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#fff", fontSize: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: C.header, color: "#fff", flexWrap: "wrap" }}>
        <HeadButton onClick={onVolver} strong>
          ← Presupuesto
        </HeadButton>
        <strong style={{ fontSize: 16, margin: "0 8px" }}>Programación</strong>
        <span style={{ fontSize: 13, opacity: 0.85, marginRight: "auto" }}>
          {projectName}
          {!canEdit && " · solo consulta"}
        </span>
        <HeadButton onClick={() => setDialogo({ tipo: "calendario" })} disabled={!prog}>
          Calendario laboral
        </HeadButton>
        <HeadButton onClick={() => setDialogo({ tipo: "valorizado" })} disabled={!res}>
          Calendario valorizado
        </HeadButton>
        <HeadButton onClick={() => setDialogo({ tipo: "insumos" })} disabled={!res}>
          Calendario de insumos
        </HeadButton>
        <HeadButton onClick={() => setDialogo({ tipo: "curva" })} disabled={!res}>
          📈 Curva S
        </HeadButton>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap", background: "#fafbfc", fontSize: 13.5 }}>
        <Tb onClick={() => p.save()} disabled={dis || !p.dirty || p.saving} title="Guardar la programación (Ctrl+S)" strong={p.dirty}>
          {p.saving ? "Guardando..." : "Guardar"}
        </Tb>
        <Sep />
        <span>Inicio:</span>
        {prog && (canEdit ? <FechaCampo id="prog-inicio" value={prog.inicio} onChange={(f) => f && setProg((x) => ({ ...x, inicio: f }))} width={150} /> : <strong>{fechaCorta(prog.inicio)}</strong>)}
        <span style={{ marginLeft: 6 }}>
          Fin: <strong>{res ? fechaCorta(res.fin) : "—"}</strong>
          {res && <span style={{ color: "var(--tc-gray-500)" }}> ({fmt(res.dias, Number.isInteger(res.dias) ? 0 : 2)} días hábiles)</span>}
        </span>
        <span style={{ marginLeft: 6 }} title="La fecha en que el proyecto debería terminar: se marca en el diagrama y avisa si se pasa">
          Fecha fin:
        </span>
        {prog &&
          (canEdit ? (
            <FechaCampo id="prog-fin" value={prog.finObjetivo} allowEmpty placeholder="(opcional)" onChange={(f) => setProg((x) => ({ ...x, finObjetivo: f }))} width={150} />
          ) : (
            <strong>{prog.finObjetivo ? fechaCorta(prog.finObjetivo) : "—"}</strong>
          ))}
        <Sep />
        <Tb onClick={() => setDialogo({ tipo: "estimar" })} disabled={!res} title="Calcular la duración con el metrado y el rendimiento">
          ⏱ Estimar duración
        </Tb>
        <Tb onClick={() => setCritica((v) => !v)} disabled={!res} title="Colorear en rojo la ruta crítica" strong={critica} pressed={critica}>
          {critica ? "Ocultar ruta crítica" : "Mostrar ruta crítica"}
        </Tb>
        <Tb onClick={exportar} disabled={!res || exportando} title="Programación, calendario valorizado, calendario de insumos y curva S">
          Excel
        </Tb>
        <Sep />
        <span>Zoom:</span>
        <Tb onClick={() => setPxDia((z) => Math.max(3, Math.round(z / 1.4)))} title="Alejar">
          −
        </Tb>
        <span style={{ minWidth: 34, textAlign: "center" }}>{Math.round((pxDia / 24) * 100)}%</span>
        <Tb onClick={() => setPxDia((z) => Math.min(80, Math.round(z * 1.4)))} title="Acercar">
          +
        </Tb>
      </div>

      {/* status */}
      <div style={{ padding: "4px 10px", fontSize: 12.5, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.grid}`, minHeight: 22 }}>
        {p.saveError ? (
          <span style={{ color: "#8a1c14" }}>
            {p.saveError.text}{" "}
            {p.saveError.conflict && (
              <button type="button" style={linkBtn} onClick={() => setDialogo({ tipo: "recargar" })}>
                Recargar la programación guardada
              </button>
            )}
          </span>
        ) : p.dirty ? (
          <span style={{ color: "#7a5300" }}>Cambios sin guardar.</span>
        ) : p.meta.updatedAt ? (
          <span style={{ color: "var(--tc-gray-500)" }}>
            Guardada{p.meta.updatedBy ? ` por ${p.meta.updatedBy}` : ""} el {fecha(p.meta.updatedAt)}.
          </span>
        ) : prog ? (
          <span style={{ color: "var(--tc-gray-500)" }}>Todavía no se ha guardado: las duraciones salen del metrado y el rendimiento de cada partida.</span>
        ) : null}
        {presupuestoSinGuardar && <span style={{ color: "#7a5300" }}>El presupuesto tiene cambios sin guardar: aquí se usa lo que ves en pantalla.</span>}
        {res?.avisos.map((a) => (
          <span key={a} style={{ color: "#7a5300" }}>
            {a}
          </span>
        ))}
        {aviso && <span style={{ color: "#8a1c14" }}>{aviso}</span>}
        {critica && res && (
          <span style={{ color: "#d93025" }}>
            Ruta crítica: {res.filas.filter((f) => f.tipo === "partida" && f.critica).length} partida(s) sin holgura.
          </span>
        )}
      </div>

      {p.loadError ? (
        <div style={{ padding: 20 }}>
          <Notice kind="error">No se pudo cargar la programación: {p.loadError}</Notice>
        </div>
      ) : !prog || !calculo ? (
        <div style={{ padding: 24, color: "var(--tc-gray-500)" }}>Cargando la programación...</div>
      ) : calculo.error || !res ? (
        <div style={{ padding: 20 }}>
          <Notice kind="error">{calculo.error}</Notice>
        </div>
      ) : partidas === 0 ? (
        <div style={{ padding: 20 }}>
          <Notice kind="info">El presupuesto no tiene partidas todavía: agrégalas en el presupuesto y vuelve aquí para programarlas.</Notice>
        </div>
      ) : (
        <Gantt
          res={res}
          filas={visibles}
          selectedId={selectedId}
          onSelect={setSelectedId}
          collapsed={collapsed}
          onToggle={(id) =>
            setCollapsed((c) => {
              const n = new Set(c);
              if (n.has(id)) n.delete(id);
              else n.add(id);
              return n;
            })
          }
          critica={critica}
          pxDia={pxDia}
          finObjetivo={prog.finObjetivo}
          editable={canEdit}
          onDuracion={(id, v) =>
            setTarea(id, (t) => {
              if (v === null) delete t.duracion;
              else t.duracion = Math.min(Math.round(v * 100) / 100, MAX_DURACION_DIAS);
              return t;
            })
          }
          onInicio={(id, f) =>
            setTarea(id, (t) => {
              if (f) t.inicio = f;
              else delete t.inicio;
              return t;
            })
          }
          onCuadrillas={(id, n) =>
            setTarea(id, (t) => {
              if (!n || n <= 0 || n === 1) delete t.cuadrillas;
              else t.cuadrillas = Math.min(n, 1000);
              return t;
            })
          }
          onPredecesoras={(id, texto) => {
            const r = leerPredecesoras(texto, res, id, prog.tareas);
            const fila = res.porId.get(id)?.fila;
            if ("error" in r) {
              setAviso(`Predecesoras de la fila ${fila}: ${r.error}`);
              return r.error;
            }
            setAviso("");
            setTarea(id, (t) => {
              if (r.deps.length) t.predecesoras = r.deps;
              else delete t.predecesoras;
              return t;
            });
            return null;
          }}
          onOpen={(id) => setDialogo({ tipo: "tarea", id })}
        />
      )}

      {renderDialogo()}
    </div>
  );

  function renderDialogo(): ReactNode {
    if (!dialogo || !prog) return null;
    const close = () => setDialogo(null);
    switch (dialogo.tipo) {
      case "calendario":
        return (
          <CalendarioDialog
            calendario={prog.calendario}
            inicio={prog.inicio}
            fin={res?.fin ?? prog.inicio}
            editable={canEdit}
            onClose={close}
            onAccept={(calendario) => {
              setProg((x) => ({ ...x, calendario }));
              close();
            }}
          />
        );
      case "estimar":
        return res ? (
          <EstimarDialog
            res={res}
            prog={prog}
            editable={canEdit}
            onClose={close}
            onAccept={(redondeo, reemplazar) => {
              setProg((x) => {
                const tareas = { ...x.tareas };
                if (reemplazar) {
                  for (const f of res.filas) {
                    if (f.tipo !== "partida" || f.estimacion === null || tareas[f.id]?.duracion === undefined) continue;
                    const { duracion: _d, ...resto } = tareas[f.id] ?? {};
                    if (Object.keys(resto).length) tareas[f.id] = resto;
                    else delete tareas[f.id];
                  }
                }
                return { ...x, redondeo, tareas };
              });
              close();
            }}
          />
        ) : null;
      case "tarea": {
        const fila = res?.porId.get(dialogo.id);
        return fila && res ? (
          <TareaDialog
            fila={fila}
            res={res}
            prog={prog}
            editable={canEdit}
            onClose={close}
            onAccept={(t) => {
              setTarea(fila.id, () => t);
              close();
            }}
          />
        ) : null;
      }
      case "curva":
        return res ? <CurvaSDialog res={res} doc={doc} proyecto={projectName} onClose={close} /> : null;
      case "valorizado":
        return res ? <ValorizadoDialog res={res} doc={doc} proyecto={projectName} onClose={close} /> : null;
      case "insumos":
        return res ? <InsumosPeriodoDialog res={res} doc={doc} resolver={resolver} proyecto={projectName} onClose={close} /> : null;
      case "recargar":
        return (
          <ConfirmDialog
            title="Recargar la programación"
            danger
            confirmLabel="Recargar"
            onClose={close}
            onConfirm={() => {
              p.recargar();
              close();
            }}
          >
            Se cargará la versión guardada por la otra persona y se perderán tus cambios sin guardar en la programación.
          </ConfirmDialog>
        );
    }
  }
}

function HeadButton({ onClick, disabled, children, strong }: { onClick: () => void; disabled?: boolean; children: ReactNode; strong?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        border: "1px solid rgba(255,255,255,0.45)",
        background: strong ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)",
        color: "#fff",
        borderRadius: 4,
        padding: "5px 10px",
        fontSize: 13,
        fontWeight: strong ? 700 : 400,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function Tb({ onClick, disabled, title, children, strong, pressed }: { onClick: () => void; disabled?: boolean; title: string; children: ReactNode; strong?: boolean; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={pressed}
      style={{
        border: pressed ? "1px solid #d93025" : "none",
        background: pressed ? "#fdecea" : strong && !disabled ? "#fff3cd" : "transparent",
        color: disabled ? "#b8bec7" : pressed ? "#a52714" : "var(--tc-gray-700)",
        padding: "5px 8px",
        fontSize: 14,
        cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit",
        borderRadius: 4,
        fontWeight: strong ? 700 : 400,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span style={{ width: 1, height: 22, background: C.border, margin: "0 4px" }} />;
}

const linkBtn: CSSProperties = { border: "none", background: "transparent", color: "var(--tc-blue-700)", textDecoration: "underline", cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: 12.5 };
