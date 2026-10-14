"use client";

import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../lib/propiedades/client";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import { fecha } from "../../lib/presupuesto/format";
import { estimarCostoCop, fmtCop } from "../../lib/presupuesto/ia/cupo";
import { partidasParaEdt, SISTEMA_EDT } from "../../lib/presupuesto/ia/edt";
import { BorradorIA, Confianza, CupoGlobalIA, CupoIA, EstadoCupo, EstadoIAResponse, TAREA_IA_NOMBRES } from "../../lib/presupuesto/ia/tipos";
import type { PresupuestoDoc } from "../../lib/presupuesto/types";
import { acceptButton, baseInput, C, labelStyle, message, Modal, Notice, NumInput } from "./ui";

/** Partidas per call: each answer must fit in one server function (about a minute). */
const LOTE = 5;
const POR_PAGINA = 40;

type Pestana = "edt" | "borradores" | "uso";

/**
 * The AI assistant: proposes the EDT dictionary of the partidas as drafts,
 * which a person accepts (into the budget, saved as always), edits or
 * rejects; with the monthly quota and the usage log.
 */
export default function AsistenteIA({
  api,
  doc,
  spId,
  projectId,
  aplicarEdt,
  onClose,
}: {
  api: PresupuestoApi;
  doc: PresupuestoDoc;
  /** The subpresupuesto on screen. */
  spId: string;
  projectId: string;
  /** Puts accepted texts into the budget; answers how many partidas were found. */
  aplicarEdt: (cambios: { itemId: string; descripcion: string; criterios: string }[]) => number;
  onClose: () => void;
}) {
  const [pestana, setPestana] = useState<Pestana>("edt");
  const [estado, setEstado] = useState<EstadoIAResponse | null>(null);
  const [error, setError] = useState("");
  const [borradores, setBorradores] = useState<BorradorIA[] | null>(null);

  const cargar = useCallback(async () => {
    setError("");
    try {
      setEstado(await api.getEstadoIA());
    } catch (err) {
      setError(message(err));
    }
  }, [api]);
  const cargarBorradores = useCallback(async () => {
    try {
      setBorradores(await api.borradoresIA());
    } catch (err) {
      setError(message(err));
    }
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);
  useEffect(() => {
    if (estado?.puedeUsar && borradores === null) cargarBorradores();
  }, [estado?.puedeUsar, borradores, cargarBorradores]);

  const pendientes = borradores?.length ?? estado?.resumen.pendientes ?? 0;

  return (
    <Modal
      title="🤖 Asistente IA"
      onClose={onClose}
      width={1180}
      height="92vh"
      toolbar={
        <div role="tablist" style={{ display: "flex", gap: 4 }}>
          <Tab activa={pestana === "edt"} onClick={() => setPestana("edt")}>
            Diccionario EDT
          </Tab>
          <Tab activa={pestana === "borradores"} onClick={() => setPestana("borradores")}>
            Borradores por revisar ({pendientes})
          </Tab>
          <Tab activa={pestana === "uso"} onClick={() => setPestana("uso")}>
            Uso y cupo
          </Tab>
        </div>
      }
    >
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0 }}>
        {error && <Notice kind="error">{error}</Notice>}
        {!estado ? (
          !error && <div style={{ color: "var(--tc-gray-500)" }}>Cargando el asistente...</div>
        ) : pestana === "edt" ? (
          <GenerarEdt
            api={api}
            doc={doc}
            spId={spId}
            projectId={projectId}
            estado={estado}
            onCupo={(cupo) => setEstado((e) => (e ? { ...e, cupo } : e))}
            onTerminado={() => {
              cargarBorradores();
              cargar();
            }}
            onRevisar={() => setPestana("borradores")}
          />
        ) : pestana === "borradores" ? (
          <Borradores
            api={api}
            doc={doc}
            borradores={borradores}
            puedeUsar={estado.puedeUsar}
            aplicarEdt={aplicarEdt}
            onDecididos={(ids, resumen) => {
              setBorradores((l) => (l ? l.filter((b) => !ids.has(b.id)) : l));
              setEstado((e) => (e ? { ...e, resumen } : e));
            }}
          />
        ) : (
          <UsoYCupo api={api} estado={estado} onEstado={setEstado} />
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- generate

function BannerCupo({ cupo }: { cupo: EstadoCupo }) {
  if (cupo.nivel === "deshabilitada" || cupo.nivel === "agotado") return <Notice kind="error">{cupo.mensaje}</Notice>;
  if (cupo.nivel === "aviso") return <Notice kind="warning">{cupo.mensaje}</Notice>;
  return null;
}

function GenerarEdt({
  api,
  doc,
  spId,
  projectId,
  estado,
  onCupo,
  onTerminado,
  onRevisar,
}: {
  api: PresupuestoApi;
  doc: PresupuestoDoc;
  spId: string;
  projectId: string;
  estado: EstadoIAResponse;
  onCupo: (c: EstadoCupo) => void;
  onTerminado: () => void;
  onRevisar: () => void;
}) {
  const claveContexto = `presupuesto.ia.contexto.${projectId}`;
  const [todo, setTodo] = useState(false);
  const [soloIncompletas, setSoloIncompletas] = useState(true);
  const [contexto, setContexto] = useState(() => {
    try {
      return localStorage.getItem(claveContexto) ?? "";
    } catch {
      return "";
    }
  });
  const [progreso, setProgreso] = useState<{ lote: number; lotes: number; borradores: number; faltantes: number; costo: number } | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [resultado, setResultado] = useState<{ texto: string; kind: "info" | "warning" | "error" } | null>(null);
  const cancelar = useRef(false);

  const partidas = useMemo(() => partidasParaEdt(doc, todo ? null : spId, soloIncompletas), [doc, todo, spId, soloIncompletas]);
  const lotes = Math.ceil(partidas.length / LOTE);
  // A typical cost (about 300 tokens written per partida); the server stops a batch that could go over the quota.
  const estimado = useMemo(() => {
    const entrada = lotes * SISTEMA_EDT.length + partidas.length * 260 + contexto.length * lotes;
    return estimarCostoCop(estado.modelo, entrada, partidas.length * 300 + lotes * 500, estado.cupo.trm);
  }, [lotes, partidas.length, contexto.length, estado.modelo, estado.cupo.trm]);
  const bloqueado = !estado.disponible || !estado.puedeUsar || estado.cupo.nivel === "deshabilitada" || estado.cupo.nivel === "agotado";

  async function generar() {
    try {
      localStorage.setItem(claveContexto, contexto);
    } catch {
      // storage unavailable
    }
    cancelar.current = false;
    setCorriendo(true);
    setResultado(null);
    let borradores = 0;
    let faltantes = 0;
    let costo = 0;
    let detenido: string | null = null;
    for (let k = 0; k < lotes && !cancelar.current; k++) {
      setProgreso({ lote: k + 1, lotes, borradores, faltantes, costo });
      const lote = partidas.slice(k * LOTE, (k + 1) * LOTE);
      let intento = 0;
      for (;;) {
        try {
          const r = await api.generarEdtIA(contexto, lote);
          borradores += r.borradores.length;
          faltantes += r.faltantes.length;
          costo += r.costoCop;
          onCupo(r.cupo);
          if (r.cupo.nivel === "agotado") detenido = r.cupo.mensaje;
          break;
        } catch (err) {
          const reintentar = err instanceof ApiError && [429, 502, 503, 504].includes(err.status) && err.code !== "ia-sin-clave";
          if (reintentar && intento === 0) {
            intento++;
            await new Promise((r) => setTimeout(r, 6000));
            continue;
          }
          detenido = message(err);
          break;
        }
      }
      if (detenido) break;
    }
    setProgreso({ lote: lotes, lotes, borradores, faltantes, costo });
    setCorriendo(false);
    const base = `Se generaron ${borradores} borrador(es) por ${fmtCop(costo)}.${faltantes ? ` ${faltantes} partida(s) quedaron sin respuesta: vuelve a generar para pedirlas.` : ""}`;
    setResultado(
      detenido
        ? { kind: "error", texto: `${base} Se detuvo: ${detenido}` }
        : cancelar.current
          ? { kind: "warning", texto: `${base} Se canceló antes de terminar.` }
          : { kind: "info", texto: base }
    );
    onTerminado();
  }

  return (
    <>
      {!estado.disponible && (
        <Notice kind="error">El asistente IA no está configurado en el servidor: el administrador de la plataforma debe poner la variable ANTHROPIC_API_KEY en Vercel.</Notice>
      )}
      {!estado.puedeUsar && <Notice kind="info">Solo los administradores del proyecto y los editores del presupuesto usan el asistente.</Notice>}
      <BannerCupo cupo={estado.cupo} />
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
        Redacta la <strong>descripción del trabajo</strong> y los <strong>criterios de aceptación</strong> de cada partida, con la terminología y las normas
        colombianas (NSR-10, NTC, RETIE...). El <strong>responsable</strong> no se propone: lo asignas tú. Nada cambia en el presupuesto hasta que revises y
        aceptes cada borrador.
      </p>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--tc-gray-500)" }}>
        Al proveedor de IA (Anthropic, modelo {estado.modelo}) se envían el número, la descripción, la unidad y el capítulo de cada partida, su texto
        actual del diccionario y el contexto que escribas. No se envían precios, nombres ni correos.
      </p>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", fontSize: 13.5 }}>
        <div role="radiogroup" aria-label="Alcance">
          <span style={labelStyle}>Partidas de</span>
          <label style={{ display: "block" }}>
            <input type="radio" checked={!todo} onChange={() => setTodo(false)} /> Este subpresupuesto ({doc.subpresupuestos.find((s) => s.id === spId)?.nombre})
          </label>
          <label style={{ display: "block" }}>
            <input type="radio" checked={todo} onChange={() => setTodo(true)} /> Todo el presupuesto
          </label>
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "flex-start", paddingTop: 20 }}>
          <input type="checkbox" checked={soloIncompletas} onChange={(e) => setSoloIncompletas(e.target.checked)} />
          Solo las que no tienen descripción o criterios
        </label>
      </div>
      <label>
        <span style={labelStyle}>Contexto del proyecto (opcional, ayuda a que el texto sea más preciso)</span>
        <textarea
          value={contexto}
          maxLength={2000}
          onChange={(e) => setContexto(e.target.value)}
          placeholder="Ej.: Edificio de vivienda estrato 6 en Bogotá, 15 pisos, 4 apartamentos por piso, 2 pisos de comercio, sótanos de parqueadero y cuartos técnicos."
          style={{ ...baseInput, width: "100%", minHeight: 64, resize: "vertical" }}
        />
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", fontSize: 13.5 }}>
        <span>
          <strong>{partidas.length}</strong> partida(s) en {lotes} lote(s) de {LOTE}. Costo estimado: <strong>{fmtCop(estimado)}</strong> (puede variar).
        </span>
        <span style={{ color: "var(--tc-gray-500)" }}>
          Disponible este mes: {fmtCop(Math.max(0, Math.min(estado.cupo.cupoProyectoCop - estado.cupo.gastoProyectoCop, estado.cupo.cupoUsuarioCop - estado.cupo.gastoUsuarioCop)))}
        </span>
        {!corriendo ? (
          <button type="button" style={{ ...acceptButton, marginLeft: "auto" }} disabled={bloqueado || partidas.length === 0} onClick={generar}>
            Generar borradores
          </button>
        ) : (
          <button type="button" style={{ ...botonSec, marginLeft: "auto" }} onClick={() => (cancelar.current = true)}>
            Cancelar después de este lote
          </button>
        )}
      </div>
      {progreso && (
        <div>
          <div style={{ height: 10, background: "#e6eaf0", borderRadius: 5, overflow: "hidden" }}>
            <div style={{ width: `${(progreso.lote / Math.max(progreso.lotes, 1)) * 100}%`, height: "100%", background: "var(--tc-blue-600)", transition: "width .3s" }} />
          </div>
          <div style={{ fontSize: 12.5, color: "var(--tc-gray-500)", marginTop: 4 }}>
            {corriendo ? `Lote ${progreso.lote} de ${progreso.lotes}...` : "Terminado."} {progreso.borradores} borrador(es) · {fmtCop(progreso.costo)}
          </div>
        </div>
      )}
      {resultado && (
        <Notice kind={resultado.kind}>
          {resultado.texto}{" "}
          {!corriendo && (
            <button type="button" style={linkBtn} onClick={onRevisar}>
              Revisar los borradores
            </button>
          )}
        </Notice>
      )}
    </>
  );
}

// ---------------------------------------------------------------- review

const CONFIANZA: Record<Confianza, { texto: string; color: string; fondo: string }> = {
  alta: { texto: "Alta", color: "#1e6b2e", fondo: "#e3f4e6" },
  media: { texto: "Media", color: "#7a5300", fondo: "#fff3cd" },
  baja: { texto: "Baja: revisar", color: "#8a1c14", fondo: "#fdecea" },
};

function Borradores({
  api,
  doc,
  borradores,
  puedeUsar,
  aplicarEdt,
  onDecididos,
}: {
  api: PresupuestoApi;
  doc: PresupuestoDoc;
  borradores: BorradorIA[] | null;
  puedeUsar: boolean;
  aplicarEdt: (cambios: { itemId: string; descripcion: string; criterios: string }[]) => number;
  onDecididos: (ids: Set<string>, resumen: EstadoIAResponse["resumen"]) => void;
}) {
  const [textos, setTextos] = useState<Map<string, { descripcion: string; criterios: string }>>(new Map());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pagina, setPagina] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [nota, setNota] = useState<{ kind: "info" | "error"; texto: string } | null>(null);
  const existentes = useMemo(() => new Set(doc.subpresupuestos.flatMap((s) => s.items.filter((i) => i.tipo === "partida").map((i) => i.id))), [doc]);

  if (!puedeUsar) return <Notice kind="info">Solo los administradores del proyecto y los editores del presupuesto revisan los borradores.</Notice>;
  if (!borradores) return <div style={{ color: "var(--tc-gray-500)" }}>Cargando los borradores...</div>;
  if (borradores.length === 0) {
    return (
      <>
        {nota && <Notice kind={nota.kind}>{nota.texto}</Notice>}
        <Notice kind="info">No hay borradores por revisar. Genéralos en la pestaña Diccionario EDT.</Notice>
      </>
    );
  }

  const texto = (b: BorradorIA) => textos.get(b.id) ?? { descripcion: b.propuesta.descripcion, criterios: b.propuesta.criterios };
  const paginas = Math.ceil(borradores.length / POR_PAGINA);
  const visibles = borradores.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);

  async function decidir(lista: BorradorIA[], estado: "aceptado" | "rechazado") {
    if (!lista.length) return;
    setOcupado(true);
    setNota(null);
    try {
      const aceptables = estado === "aceptado" ? lista.filter((b) => existentes.has(b.itemId)) : lista;
      if (estado === "aceptado") aplicarEdt(aceptables.map((b) => ({ itemId: b.itemId, ...texto(b) })));
      const r = await api.decidirBorradoresIA(aceptables.map((b) => ({ id: b.id, estado, ...(estado === "aceptado" ? { final: texto(b) } : {}) })));
      onDecididos(new Set(aceptables.map((b) => b.id)), r.resumen);
      setSel(new Set());
      const omitidas = lista.length - aceptables.length;
      setNota({
        kind: "info",
        texto:
          estado === "aceptado"
            ? `${aceptables.length} aceptado(s) y puestos en el presupuesto: guárdalo para conservarlos.${omitidas ? ` ${omitidas} no se aplicaron porque la partida ya no existe (recházalos).` : ""}`
            : `${aceptables.length} rechazado(s).`,
      });
    } catch (err) {
      setNota({ kind: "error", texto: message(err) });
    } finally {
      setOcupado(false);
    }
  }

  const seleccionados = borradores.filter((b) => sel.has(b.id));
  return (
    <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 13.5 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={visibles.every((b) => sel.has(b.id))}
            onChange={(e) =>
              setSel((s) => {
                const n = new Set(s);
                for (const b of visibles) {
                  if (e.target.checked) n.add(b.id);
                  else n.delete(b.id);
                }
                return n;
              })
            }
          />
          Seleccionar los de esta página
        </label>
        <button type="button" style={{ ...acceptButton, padding: "6px 14px", fontSize: 14 }} disabled={ocupado || !seleccionados.length} onClick={() => decidir(seleccionados, "aceptado")}>
          Aceptar seleccionados ({seleccionados.length})
        </button>
        <button type="button" style={{ ...botonSec, color: "#8a1c14" }} disabled={ocupado || !seleccionados.length} onClick={() => decidir(seleccionados, "rechazado")}>
          Rechazar seleccionados
        </button>
        <span style={{ marginLeft: "auto", color: "var(--tc-gray-500)" }}>Puedes corregir el texto antes de aceptarlo. Lo aceptado va al presupuesto: luego pulsa Guardar.</span>
      </div>
      {nota && <Notice kind={nota.kind}>{nota.texto}</Notice>}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", border: `1px solid ${C.border}`, background: "#fff" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
            <tr>
              <th style={{ ...th, width: 30 }} />
              <th style={{ ...th, width: 220 }}>Partida</th>
              <th style={th}>Descripción del trabajo</th>
              <th style={th}>Criterios de aceptación</th>
              <th style={{ ...th, width: 86 }}>Confianza</th>
              <th style={{ ...th, width: 92 }} />
            </tr>
          </thead>
          <tbody>
            {visibles.map((b) => {
              const t = texto(b);
              const existe = existentes.has(b.itemId);
              const cambiar = (campo: "descripcion" | "criterios", v: string) => setTextos((m) => new Map(m).set(b.id, { ...t, [campo]: v }));
              const conf = CONFIANZA[b.propuesta.confianza];
              return (
                <tr key={b.id} style={{ verticalAlign: "top", background: sel.has(b.id) ? "#f0f5fd" : undefined }}>
                  <td style={td}>
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${b.referencia}`}
                      checked={sel.has(b.id)}
                      onChange={(e) =>
                        setSel((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(b.id);
                          else n.delete(b.id);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td style={td}>
                    <span style={iaChip}>IA</span> {b.referencia}
                    {!existe && <div style={{ color: "#8a1c14", fontSize: 12, marginTop: 4 }}>La partida ya no existe en el presupuesto.</div>}
                  </td>
                  <td style={td}>
                    <textarea aria-label={`Descripción de ${b.referencia}`} value={t.descripcion} maxLength={2000} onChange={(e) => cambiar("descripcion", e.target.value)} style={area} />
                    {b.anterior?.descripcion && <div style={antes}>Antes: {b.anterior.descripcion}</div>}
                  </td>
                  <td style={td}>
                    <textarea aria-label={`Criterios de ${b.referencia}`} value={t.criterios} maxLength={2000} onChange={(e) => cambiar("criterios", e.target.value)} style={area} />
                    {b.anterior?.criterios && <div style={antes}>Antes: {b.anterior.criterios}</div>}
                  </td>
                  <td style={td}>
                    <span style={{ ...chip, color: conf.color, background: conf.fondo }}>{conf.texto}</span>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <button type="button" title="Aceptar y poner en el presupuesto" disabled={ocupado || !existe} onClick={() => decidir([b], "aceptado")} style={{ ...mini, color: "#1e6b2e" }}>
                      ✓ Aceptar
                    </button>
                    <button type="button" title="Rechazar" disabled={ocupado} onClick={() => decidir([b], "rechazado")} style={{ ...mini, color: "#8a1c14", marginTop: 4 }}>
                      ✕ Rechazar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {paginas > 1 && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", fontSize: 13 }}>
          <button type="button" style={botonSec} disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>
            ‹ Anterior
          </button>
          Página {pagina + 1} de {paginas} · {borradores.length} borradores
          <button type="button" style={botonSec} disabled={pagina >= paginas - 1} onClick={() => setPagina((p) => p + 1)}>
            Siguiente ›
          </button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- usage and quota

function Barra({ etiqueta, gasto, cupo }: { etiqueta: string; gasto: number; cupo: number }) {
  const pct = cupo > 0 ? Math.min(gasto / cupo, 1) : 1;
  const color = pct >= 1 ? "#d93025" : pct >= 0.8 ? "#e8a33d" : "#2e8540";
  return (
    <div style={{ flex: 1, minWidth: 260 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 4 }}>
        <strong>{etiqueta}</strong>
        <span>
          {fmtCop(gasto)} de {fmtCop(cupo)} ({cupo > 0 ? Math.round((gasto / cupo) * 100) : 100} %)
        </span>
      </div>
      <div style={{ height: 12, background: "#e6eaf0", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ width: `${pct * 100}%`, height: "100%", background: color }} />
      </div>
    </div>
  );
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function UsoYCupo({ api, estado, onEstado }: { api: PresupuestoApi; estado: EstadoIAResponse; onEstado: (e: EstadoIAResponse) => void }) {
  const { cupo, resumen } = estado;
  const decididos = resumen.aceptadosSinCambios + resumen.aceptadosEditados + resumen.rechazados;
  const pct = (n: number) => (decididos ? `${Math.round((n / decididos) * 100)} %` : "—");
  const mes = +cupo.mes.slice(5, 7) - 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, overflow: "auto" }}>
      <BannerCupo cupo={cupo} />
      <Seccion titulo={`Cupo de ${MESES[mes]} de ${cupo.mes.slice(0, 4)} (se renueva el 1 de ${MESES[(mes + 1) % 12]}, hora de Colombia)`}>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <Barra etiqueta="Proyecto" gasto={cupo.gastoProyectoCop} cupo={cupo.cupoProyectoCop} />
          <Barra etiqueta="Tú" gasto={cupo.gastoUsuarioCop} cupo={cupo.cupoUsuarioCop} />
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--tc-gray-500)" }}>
          Costo estimado con los precios del proveedor ({estado.modelo}) y una TRM de {fmtCop(cupo.trm)} por dólar. {cupo.propio ? "Este proyecto tiene cupo propio." : "Este proyecto usa el cupo por defecto."} Aviso al 80 %
          y bloqueo al 100 %.
        </p>
      </Seccion>

      <Seccion titulo="Evaluación de los borradores">
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", fontSize: 13.5 }}>
          <span>
            Aceptados sin cambios: <strong>{resumen.aceptadosSinCambios}</strong> ({pct(resumen.aceptadosSinCambios)})
          </span>
          <span>
            Aceptados con cambios: <strong>{resumen.aceptadosEditados}</strong> ({pct(resumen.aceptadosEditados)})
          </span>
          <span>
            Rechazados: <strong>{resumen.rechazados}</strong> ({pct(resumen.rechazados)})
          </span>
          <span>
            Por revisar: <strong>{resumen.pendientes}</strong>
          </span>
        </div>
        <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--tc-gray-500)" }}>Meta de la fase 1: al menos el 70 % de los borradores aceptados sin cambios.</p>
      </Seccion>

      {estado.puedeAdministrar && <AdministrarCupos api={api} estado={estado} onEstado={onEstado} />}

      <Seccion titulo={`Registro de uso (últimas ${estado.usos.length} solicitudes)`}>
        {estado.usos.length === 0 ? (
          <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>Todavía no se ha usado el asistente en este proyecto.</span>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={th}>Fecha</th>
                <th style={th}>Persona</th>
                <th style={th}>Tarea</th>
                <th style={th}>Partidas</th>
                <th style={th}>Tokens (entrada / salida)</th>
                <th style={th}>Costo</th>
                <th style={th}>Estado</th>
                <th style={th}>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {estado.usos.map((u) => (
                <tr key={u.id}>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{fecha(u.creado)}</td>
                  <td style={td}>{u.userName}</td>
                  <td style={td}>{TAREA_IA_NOMBRES[u.tarea] ?? u.tarea}</td>
                  <td style={tdNum}>{u.items}</td>
                  <td style={tdNum}>
                    {(u.tokensEntrada + u.tokensCacheLectura + u.tokensCacheEscritura).toLocaleString("es-CO")} / {u.tokensSalida.toLocaleString("es-CO")}
                  </td>
                  <td style={tdNum}>{fmtCop(u.costoCop)}</td>
                  <td style={{ ...td, color: u.estado === "ok" ? "#1e6b2e" : "#8a1c14" }}>{ESTADOS[u.estado]}</td>
                  <td style={{ ...td, color: "var(--tc-gray-500)" }}>{u.detalle}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Seccion>
      {!estado.gestorConfigurado && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--tc-gray-500)" }}>
          Para administrar los cupos, el dueño de la plataforma configura en Vercel la variable PRESUPUESTO_IA_PROYECTO_GESTOR con el id de su proyecto gestor.
        </p>
      )}
    </div>
  );
}

const ESTADOS = { ok: "Correcto", error: "Error", rechazado: "Rechazado por la IA", incompleto: "Incompleto" };

function AdministrarCupos({ api, estado, onEstado }: { api: PresupuestoApi; estado: EstadoIAResponse; onEstado: (e: EstadoIAResponse) => void }) {
  const [proyecto, setProyecto] = useState<CupoIA>({ habilitada: estado.cupo.habilitada, cupoProyectoCop: estado.cupo.cupoProyectoCop, cupoUsuarioCop: estado.cupo.cupoUsuarioCop });
  const [global, setGlobal] = useState<CupoGlobalIA>(estado.global ?? { habilitada: false, cupoProyectoCop: 0, cupoUsuarioCop: 0, trm: estado.cupo.trm });
  const [nota, setNota] = useState<{ kind: "info" | "error"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function guardar(patch: { proyecto?: CupoIA; global?: CupoGlobalIA }, texto: string) {
    setOcupado(true);
    setNota(null);
    try {
      onEstado(await api.guardarCupoIA(patch));
      setNota({ kind: "info", texto });
    } catch (err) {
      setNota({ kind: "error", texto: message(err) });
    } finally {
      setOcupado(false);
    }
  }

  const campos = (v: CupoIA, set: (c: CupoIA) => void, conTrm?: { trm: number; setTrm: (n: number) => void }) => (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap", fontSize: 13.5 }}>
      <label style={{ display: "flex", gap: 6, alignItems: "center", paddingBottom: 6 }}>
        <input type="checkbox" checked={v.habilitada} onChange={(e) => set({ ...v, habilitada: e.target.checked })} /> Habilitado
      </label>
      <label>
        <span style={labelStyle}>Cupo mensual del proyecto (COP)</span>
        <NumInput value={v.cupoProyectoCop} decimals={0} onCommit={(n) => set({ ...v, cupoProyectoCop: n ?? 0 })} style={{ width: 160 }} ariaLabel="Cupo mensual del proyecto" />
      </label>
      <label>
        <span style={labelStyle}>Cupo mensual por persona (COP)</span>
        <NumInput value={v.cupoUsuarioCop} decimals={0} onCommit={(n) => set({ ...v, cupoUsuarioCop: n ?? 0 })} style={{ width: 160 }} ariaLabel="Cupo mensual por persona" />
      </label>
      {conTrm && (
        <label>
          <span style={labelStyle}>TRM (pesos por dólar)</span>
          <NumInput value={conTrm.trm} decimals={2} onCommit={(n) => n && conTrm.setTrm(n)} style={{ width: 120 }} ariaLabel="TRM" />
        </label>
      )}
    </div>
  );

  return (
    <Seccion titulo="Administrar cupos (administradores de la plataforma)">
      {nota && <Notice kind={nota.kind}>{nota.texto}</Notice>}
      <h4 style={h4}>Este proyecto</h4>
      {campos(proyecto, setProyecto)}
      <button type="button" style={{ ...botonSec, marginTop: 8 }} disabled={ocupado} onClick={() => guardar({ proyecto }, "Cupo del proyecto guardado.")}>
        Guardar el cupo de este proyecto
      </button>
      <h4 style={{ ...h4, marginTop: 16 }}>Por defecto, para los proyectos sin cupo propio</h4>
      {campos(global, (c) => setGlobal({ ...global, ...c }), { trm: global.trm, setTrm: (trm) => setGlobal({ ...global, trm }) })}
      <button type="button" style={{ ...botonSec, marginTop: 8 }} disabled={ocupado} onClick={() => guardar({ global }, "Valores por defecto guardados.")}>
        Guardar los valores por defecto
      </button>
    </Seccion>
  );
}

// ---------------------------------------------------------------- small pieces

function Tab({ activa, onClick, children }: { activa: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={activa}
      onClick={onClick}
      style={{
        border: "none",
        borderBottom: activa ? "3px solid var(--tc-blue-600)" : "3px solid transparent",
        background: "transparent",
        padding: "6px 12px",
        fontSize: 14,
        fontWeight: activa ? 700 : 400,
        cursor: "pointer",
        fontFamily: "inherit",
        color: "var(--tc-gray-700)",
      }}
    >
      {children}
    </button>
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

const th: CSSProperties = { padding: "6px 8px", fontWeight: 600, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.grid}`, textAlign: "center", background: "#f3f4f6" };
const td: CSSProperties = { padding: "6px 8px", borderBottom: `1px solid ${C.grid}`, borderRight: `1px solid ${C.grid}` };
const tdNum: CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const area: CSSProperties = { ...baseInput, width: "100%", minHeight: 74, resize: "vertical", fontSize: 13, lineHeight: 1.4 };
const antes: CSSProperties = { fontSize: 12, color: "var(--tc-gray-500)", marginTop: 4 };
const chip: CSSProperties = { display: "inline-block", borderRadius: 10, padding: "2px 8px", fontSize: 12, fontWeight: 600 };
const iaChip: CSSProperties = { ...chip, background: "#ede7f6", color: "#5e35b1", padding: "1px 6px", fontSize: 11 };
const mini: CSSProperties = { display: "block", width: "100%", border: `1px solid ${C.border}`, background: "#fff", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5 };
const botonSec: CSSProperties = { border: `1px solid ${C.border}`, background: "#fff", borderRadius: 4, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 13.5 };
const linkBtn: CSSProperties = { border: "none", background: "transparent", color: "var(--tc-blue-700)", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" };
const h4: CSSProperties = { margin: "4px 0 8px", fontSize: 13.5 };
