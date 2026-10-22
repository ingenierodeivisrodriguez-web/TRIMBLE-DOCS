"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import type { LoinApi } from "../../lib/loin/client";
import { exportarMatrizExcel, exportarMatrizPdf } from "../../lib/loin/exportarMatriz";
import {
  avisosElemento,
  clave,
  colorCelda,
  COLOR_LOD,
  COLOR_SOLO_NDI,
  DESCRIPCION_LOD,
  etapasOrdenadas,
  exigeAlgo,
  fechaCorta,
  gruposMatriz,
  indiceCeldas,
  parametrosExigidos,
  PlanAplicar,
  planCopiarEtapa,
  planDisciplina,
  PROPOSITOS_SUGERIDOS,
  SIN_REQUERIMIENTO,
  textoCelda,
} from "../../lib/loin/matriz";
import { CeldaMatriz, Disciplina, Elemento, ElementosResponse, Etapa, EstadoResponse, Lod, LODS, MatrizResponse, NDIS, Ndi, Parametro, Requerimiento } from "../../lib/loin/types";
import { coincide } from "../../lib/presupuesto/format";
import { acceptButton, C, labelStyle, message, Modal, Notice } from "../presupuesto/ui";
import EtapasDialog from "./EtapasDialog";
import ExportarIdsDialog from "./ExportarIdsDialog";
import { ayuda, botonSecundario, campo, linkBtn, select } from "./estilos";

type Masivo = { tipo: "disciplina"; disciplina: Disciplina; etapa: Etapa } | { tipo: "copiar"; desde: Etapa; hacia: Etapa };

/** Elements × stages: the geometric level (LOD), the information level (NDI), the purpose and who delivers it. */
export default function Matriz({ api, estado, parametros, proyecto }: { api: LoinApi; estado: EstadoResponse; parametros: Parametro[]; proyecto: string }) {
  const [elems, setElems] = useState<ElementosResponse | null>(null);
  const [matriz, setMatriz] = useState<MatrizResponse | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [disciplinaId, setDisciplinaId] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [editar, setEditar] = useState<{ elemento: Elemento; etapa: Etapa } | null>(null);
  const [masivo, setMasivo] = useState<Masivo | null>(null);
  const [etapasDlg, setEtapasDlg] = useState(false);
  const [exportando, setExportando] = useState("");
  const [idsDlg, setIdsDlg] = useState(false);
  const puede = estado.canEdit;
  const catalogo = useMemo(() => new Map(parametros.map((p) => [p.id, p])), [parametros]);

  const cargar = useCallback(async () => {
    setError("");
    try {
      const [e, m] = await Promise.all([api.getElementos(), api.getMatriz()]);
      setElems(e);
      setMatriz(m);
    } catch (err) {
      setError(message(err));
    }
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /** Saved cells replace theirs without reading everything again. */
  const alGuardar = useCallback((guardadas: CeldaMatriz[]) => {
    setMatriz((m) => {
      if (!m) return m;
      const porId = new Map(m.celdas.map((c) => [c.id, c]));
      for (const c of guardadas) porId.set(c.id, c);
      return { ...m, celdas: [...porId.values()] };
    });
  }, []);

  const etapas = useMemo(() => (matriz ? etapasOrdenadas(matriz.etapas) : []), [matriz]);
  const celdas = useMemo(() => indiceCeldas(matriz?.celdas ?? []), [matriz]);
  const grupos = useMemo(() => {
    if (!elems) return [];
    return gruposMatriz(elems.disciplinas, elems.elementos, disciplinaId || null)
      .map((g) => ({ ...g, elementos: g.elementos.filter((e) => coincide(`${e.codigo} ${e.nombre} ${e.claseIfc}`, busqueda)) }))
      .filter((g) => g.elementos.length > 0);
  }, [elems, disciplinaId, busqueda]);
  const avisos = useMemo(() => {
    const out = new Map<string, Map<string, string[]>>();
    for (const g of grupos) for (const e of g.elementos) out.set(e.id, avisosElemento(e, etapas, celdas, catalogo));
    return out;
  }, [grupos, etapas, celdas, catalogo]);

  if (!elems || !matriz) {
    return error ? (
      <Notice kind="error">
        {error}{" "}
        <button type="button" style={linkBtn} onClick={cargar}>
          Reintentar
        </button>
      </Notice>
    ) : (
      <p style={{ color: "var(--tc-gray-500)" }}>Cargando la matriz…</p>
    );
  }

  const totalElementos = grupos.reduce((s, g) => s + g.elementos.length, 0);
  const conExigencia = grupos.reduce((s, g) => s + g.elementos.reduce((t, e) => t + etapas.filter((et) => exigeAlgo(celdas.get(clave(e.id, et.id)))).length, 0), 0);
  const datosExportar = () => ({ proyecto, grupos, etapas, celdas, catalogo });

  async function exportar(tipo: "excel" | "pdf") {
    setExportando(tipo === "excel" ? "Preparando el Excel…" : "Preparando el PDF…");
    setError("");
    try {
      if (tipo === "excel") await exportarMatrizExcel(datosExportar());
      else await exportarMatrizPdf(datosExportar());
    } catch (err) {
      setError(message(err));
    } finally {
      setExportando("");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" style={botonSecundario} onClick={() => setEtapasDlg(true)}>
          Etapas…
        </button>
        <select value={disciplinaId} onChange={(e) => setDisciplinaId(e.target.value)} style={select} aria-label="Disciplina">
          <option value="">Todas las disciplinas</option>
          {elems.disciplinas
            .filter((d) => d.activo)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.codigo} · {d.nombre}
              </option>
            ))}
        </select>
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar elemento" aria-label="Buscar elemento" style={{ ...campo, width: 200 }} />
        <button type="button" style={botonSecundario} onClick={() => exportar("excel")} disabled={!!exportando || etapas.length === 0} title="Matriz con colores, detalle por celda, información exigida (parámetros) y etapas: para anexar al BEP">
          Exportar Excel
        </button>
        <button type="button" style={botonSecundario} onClick={() => exportar("pdf")} disabled={!!exportando || etapas.length === 0} title="La matriz con sus colores y la leyenda, en hojas horizontales">
          Exportar PDF
        </button>
        <button type="button" style={botonSecundario} onClick={() => setIdsDlg(true)} disabled={etapas.length === 0} title="Archivo IDS (buildingSMART) con la información que pide una etapa, para que el diseñador revise su IFC antes de subirlo">
          Exportar IDS…
        </button>
        <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>
          {totalElementos} elemento(s) × {etapas.length} etapa(s) · {conExigencia} celda(s) con exigencia{exportando && ` · ${exportando}`}
        </span>
      </div>

      <Leyenda />
      {error && <Notice kind="error">{error}</Notice>}
      {aviso && <Notice kind="info">{aviso}</Notice>}
      {etapas.length === 0 && (
        <Notice kind="info">
          No hay etapas activas. {puede ? "Pulsa \"Etapas…\" para crearlas o cargar las sugeridas (Anteproyecto, Proyecto, Licencia, Construcción, As-built)." : "Las crean los editores."}
        </Notice>
      )}
      {etapas.length > 0 && grupos.length === 0 && <Notice kind="info">No hay elementos activos {busqueda || disciplinaId ? "con ese filtro" : "todavía: créalos en la pestaña Disciplinas y elementos"}.</Notice>}

      {etapas.length > 0 && grupos.length > 0 && (
        <div style={{ flex: 1, minHeight: 240, overflow: "auto", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 4, maxHeight: "calc(100vh - 230px)" }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}>
            <thead>
              <tr>
                <th style={{ ...cabecera, left: 0, zIndex: 3, minWidth: 250, textAlign: "left" }}>Elemento</th>
                {etapas.map((et, i) => (
                  <th key={et.id} style={{ ...cabecera, minWidth: 128 }}>
                    <span style={{ display: "block" }}>{et.nombre}</span>
                    <span style={{ display: "block", fontWeight: 400, fontSize: 11.5, color: "var(--tc-gray-500)" }}>{fechaCorta(et.fecha) || "sin fecha"}</span>
                    {puede && i > 0 && (
                      <button type="button" style={{ ...linkBtn, fontSize: 11.5, fontWeight: 400 }} onClick={() => setMasivo({ tipo: "copiar", desde: etapas[i - 1], hacia: et })} title={`Cada elemento toma lo que pide en ${etapas[i - 1].nombre}`}>
                        Copiar de la anterior
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <GrupoFilas
                  key={g.disciplina.id}
                  disciplina={g.disciplina}
                  elementos={g.elementos}
                  etapas={etapas}
                  celdas={celdas}
                  avisos={avisos}
                  catalogo={catalogo}
                  puede={puede}
                  onCelda={(elemento, etapa) => setEditar({ elemento, etapa })}
                  onDisciplina={(etapa) => setMasivo({ tipo: "disciplina", disciplina: g.disciplina, etapa })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editar && (
        <CeldaDialog
          api={api}
          elemento={editar.elemento}
          etapa={editar.etapa}
          disciplina={elems.disciplinas.find((d) => d.id === editar.elemento.disciplinaId) ?? null}
          celda={celdas.get(clave(editar.elemento.id, editar.etapa.id)) ?? null}
          catalogo={catalogo}
          puedeEditar={puede}
          onGuardada={(c) => {
            alGuardar([c]);
            setEditar(null);
          }}
          onClose={() => setEditar(null)}
        />
      )}
      {masivo && (
        <MasivoDialog
          api={api}
          masivo={masivo}
          elementos={elems.elementos}
          disciplinas={elems.disciplinas}
          disciplinaId={disciplinaId || null}
          celdas={celdas}
          onGuardadas={(guardadas) => {
            alGuardar(guardadas);
            setAviso(`Listo: ${guardadas.length} celda(s) guardada(s).`);
            setMasivo(null);
          }}
          onClose={() => setMasivo(null)}
        />
      )}
      {idsDlg && (
        <ExportarIdsDialog proyecto={proyecto} etapas={etapas} disciplinas={elems.disciplinas} elementos={elems.elementos} celdas={celdas} catalogo={catalogo} onClose={() => setIdsDlg(false)} />
      )}
      {etapasDlg && <EtapasDialog api={api} etapas={matriz.etapas} puedeEditar={puede} onCambio={cargar} onClose={() => setEtapasDlg(false)} />}
    </div>
  );
}

function Leyenda() {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }} aria-label="Leyenda de colores">
      <span style={{ color: "var(--tc-gray-500)" }}>LOD (detalle geométrico):</span>
      {LODS.map((l) => (
        <span key={l} title={DESCRIPCION_LOD[l]} style={{ ...chip, background: COLOR_LOD[l].fondo, color: COLOR_LOD[l].texto }}>
          LOD {l}
        </span>
      ))}
      <span title="Se pide información (NDI) pero no un nivel de detalle geométrico" style={{ ...chip, background: COLOR_SOLO_NDI.fondo, color: COLOR_SOLO_NDI.texto }}>
        Solo NDI
      </span>
      <span title="No se exige en esa etapa" style={{ ...chip, background: VACIA, color: "var(--tc-gray-500)" }}>
        — No se exige
      </span>
      <span style={{ color: "var(--tc-gray-500)" }}>· NDI acumulativo: NDI-2 exige los parámetros NDI-1 y NDI-2 del elemento · ⚠ revisar</span>
    </div>
  );
}

function GrupoFilas({
  disciplina,
  elementos,
  etapas,
  celdas,
  avisos,
  catalogo,
  puede,
  onCelda,
  onDisciplina,
}: {
  disciplina: Disciplina;
  elementos: Elemento[];
  etapas: Etapa[];
  celdas: Map<string, CeldaMatriz>;
  avisos: Map<string, Map<string, string[]>>;
  catalogo: Map<string, Parametro>;
  puede: boolean;
  onCelda: (e: Elemento, et: Etapa) => void;
  onDisciplina: (et: Etapa) => void;
}) {
  return (
    <>
      <tr>
        <td style={{ ...grupoTd, left: 0, position: "sticky", zIndex: 2 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: disciplina.color, marginRight: 6 }} />
          {disciplina.codigo} · {disciplina.nombre} <span style={{ fontWeight: 400, color: "var(--tc-gray-500)" }}>({elementos.length})</span>
        </td>
        {etapas.map((et) => (
          <td key={et.id} style={{ ...grupoTd, textAlign: "center" }}>
            {puede && (
              <button type="button" style={{ ...linkBtn, fontSize: 11.5 }} onClick={() => onDisciplina(et)} title={`Dar el mismo LOD / NDI a todos los elementos de ${disciplina.nombre} en ${et.nombre}`}>
                Asignar a todos
              </button>
            )}
          </td>
        ))}
      </tr>
      {elementos.map((e) => (
        <tr key={e.id}>
          <td style={{ ...nombreTd, left: 0, position: "sticky", zIndex: 1 }}>
            <span style={{ fontWeight: 600 }}>{e.nombre}</span>
            <span style={{ display: "block", fontSize: 11.5, color: "var(--tc-gray-500)" }}>
              {e.codigo} · {e.claseIfc || "sin clase IFC"}
            </span>
          </td>
          {etapas.map((et) => {
            const c = celdas.get(clave(e.id, et.id)) ?? null;
            const color = colorCelda(c);
            const lista = avisos.get(e.id)?.get(et.id) ?? [];
            const params = parametrosExigidos(e, c?.ndi ?? null, catalogo);
            const titulo = [
              `${e.nombre} · ${et.nombre}`,
              exigeAlgo(c) ? textoCelda(c) : "No se exige en esta etapa",
              c?.lod != null ? DESCRIPCION_LOD[c.lod] : "",
              c?.ndi != null ? `Información: ${params.obligatorios + params.opcionales} parámetro(s), ${params.obligatorios} obligatorio(s)` : "",
              c?.propositos.length ? `Propósito: ${c.propositos.join(", ")}` : "",
              c?.actor ? `Entrega: ${c.actor}` : "",
              c?.nota ? `Nota: ${c.nota}` : "",
              ...lista.map((a) => `⚠ ${a}`),
            ]
              .filter(Boolean)
              .join("\n");
            return (
              <td key={et.id} style={{ padding: 2, borderBottom: `1px solid ${C.grid}` }}>
                <button
                  type="button"
                  onClick={() => onCelda(e, et)}
                  title={titulo}
                  aria-label={titulo}
                  style={{ ...celdaBtn, background: color?.fondo ?? VACIA, color: color?.texto ?? "var(--tc-gray-500)", cursor: "pointer" }}
                >
                  {textoCelda(c) || "—"}
                  {lista.length > 0 && <span style={{ marginLeft: 4 }}>⚠</span>}
                </button>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}

/** LOD, NDI, purposes, actor and note: shared by one cell and many. */
function RequerimientoForm({
  valores,
  onChange,
  ro,
  disciplina,
  conteo,
}: {
  valores: Requerimiento;
  onChange: (r: Requerimiento) => void;
  ro: boolean;
  disciplina: Disciplina | null;
  /** Parameters an element would require at each NDI (one cell only). */
  conteo?: (ndi: Ndi) => { obligatorios: number; opcionales: number };
}) {
  const [otro, setOtro] = useState("");
  const set = (patch: Partial<Requerimiento>) => onChange({ ...valores, ...patch });
  const propositos = [...PROPOSITOS_SUGERIDOS, ...valores.propositos.filter((p) => !PROPOSITOS_SUGERIDOS.includes(p))];
  const alternar = (p: string) => set({ propositos: valores.propositos.includes(p) ? valores.propositos.filter((x) => x !== p) : [...valores.propositos, p] });
  const actores = [disciplina ? `Diseñador de ${disciplina.nombre.toLowerCase()}` : "", "Coordinador BIM", "Constructor", "Interventoría", "Fabricante / proveedor"].filter(Boolean);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <span style={labelStyle}>LOD — detalle geométrico</span>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <button type="button" disabled={ro} onClick={() => set({ lod: null })} style={opcion(valores.lod === null, VACIA, "var(--tc-gray-700)")}>
            Sin LOD
          </button>
          {LODS.map((l) => (
            <button key={l} type="button" disabled={ro} onClick={() => set({ lod: l as Lod })} style={opcion(valores.lod === l, COLOR_LOD[l].fondo, COLOR_LOD[l].texto)} title={DESCRIPCION_LOD[l]}>
              {l}
            </button>
          ))}
        </div>
        <p style={ayuda}>{valores.lod !== null ? `LOD ${valores.lod}: ${DESCRIPCION_LOD[valores.lod]}` : "Sin nivel de detalle geométrico en esta etapa."}</p>
      </div>
      <div>
        <span style={labelStyle}>NDI — nivel de información (acumulativo)</span>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <button type="button" disabled={ro} onClick={() => set({ ndi: null })} style={opcion(valores.ndi === null, VACIA, "var(--tc-gray-700)")}>
            Sin NDI
          </button>
          {NDIS.map((n) => {
            const c = conteo?.(n);
            return (
              <button key={n} type="button" disabled={ro} onClick={() => set({ ndi: n })} style={opcion(valores.ndi === n, "#e3edfb", "#1f4f9c")}>
                NDI-{n}
                {c && <span style={{ fontWeight: 400 }}> · {c.obligatorios + c.opcionales} parám.</span>}
              </button>
            );
          })}
        </div>
        {conteo && valores.ndi !== null && (
          <p style={ayuda}>
            Exige {conteo(valores.ndi).obligatorios} parámetro(s) obligatorio(s) y {conteo(valores.ndi).opcionales} opcional(es): los de NDI ≤ {valores.ndi} asignados al elemento.
          </p>
        )}
      </div>
      <div>
        <span style={labelStyle}>Propósito</span>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {propositos.map((p) => (
            <button key={p} type="button" disabled={ro} onClick={() => alternar(p)} style={opcion(valores.propositos.includes(p), "#e4f3df", "#2e6b22")}>
              {p}
            </button>
          ))}
        </div>
        {!ro && (
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input value={otro} onChange={(e) => setOtro(e.target.value)} maxLength={60} placeholder="Otro propósito" style={{ ...campo, width: 220 }} aria-label="Otro propósito" />
            <button
              type="button"
              style={botonSecundario}
              disabled={!otro.trim()}
              onClick={() => {
                if (!valores.propositos.includes(otro.trim())) set({ propositos: [...valores.propositos, otro.trim()] });
                setOtro("");
              }}
            >
              Agregar
            </button>
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label>
          <span style={labelStyle}>Actor responsable (quién entrega)</span>
          <input value={valores.actor} onChange={(e) => set({ actor: e.target.value })} readOnly={ro} maxLength={120} list="loin-actores" placeholder={actores[0] ?? ""} style={campo} aria-label="Actor responsable" />
          <datalist id="loin-actores">
            {actores.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <label>
          <span style={labelStyle}>Nota (opcional)</span>
          <input value={valores.nota} onChange={(e) => set({ nota: e.target.value })} readOnly={ro} maxLength={500} placeholder="Ubicación, apariencia, comportamiento paramétrico…" style={campo} aria-label="Nota" />
        </label>
      </div>
    </div>
  );
}

function CeldaDialog({
  api,
  elemento,
  etapa,
  disciplina,
  celda,
  catalogo,
  puedeEditar,
  onGuardada,
  onClose,
}: {
  api: LoinApi;
  elemento: Elemento;
  etapa: Etapa;
  disciplina: Disciplina | null;
  celda: CeldaMatriz | null;
  catalogo: Map<string, Parametro>;
  puedeEditar: boolean;
  onGuardada: (c: CeldaMatriz) => void;
  onClose: () => void;
}) {
  const [valores, setValores] = useState<Requerimiento>(() =>
    celda ? { lod: celda.lod, ndi: celda.ndi, propositos: [...celda.propositos], actor: celda.actor, nota: celda.nota } : { ...SIN_REQUERIMIENTO }
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function guardar(v: Requerimiento) {
    setBusy(true);
    setError("");
    try {
      const [c] = await api.guardarMatriz([{ ...v, elementoId: elemento.id, etapaId: etapa.id, id: celda?.id ?? crypto.randomUUID(), version: celda?.version ?? 0 }]);
      onGuardada(c);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`${elemento.nombre} · ${etapa.nombre}`}
      onClose={() => !busy && onClose()}
      width={720}
      footer={
        <>
          {puedeEditar && exigeAlgo(celda) && (
            <button type="button" style={{ ...botonSecundario, marginRight: "auto" }} disabled={busy} onClick={() => guardar({ ...valores, lod: null, ndi: null })} title="La celda queda sin LOD ni NDI (no se borra)">
              No se exige en esta etapa
            </button>
          )}
          <button type="button" style={botonSecundario} onClick={onClose} disabled={busy}>
            {puedeEditar ? "Cancelar" : "Cerrar"}
          </button>
          {puedeEditar && (
            <button type="button" style={acceptButton} onClick={() => guardar(valores)} disabled={busy}>
              {busy ? "Guardando…" : "Guardar"}
            </button>
          )}
        </>
      }
    >
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ ...ayuda, margin: 0 }}>
          {disciplina ? `${disciplina.codigo} · ${disciplina.nombre} · ` : ""}
          {elemento.codigo} · {elemento.claseIfc || "sin clase IFC"} · {fechaCorta(etapa.fecha) || "etapa sin fecha"}
        </p>
        {error && <Notice kind="error">{error}</Notice>}
        <RequerimientoForm valores={valores} onChange={setValores} ro={!puedeEditar} disciplina={disciplina} conteo={(n) => parametrosExigidos(elemento, n, catalogo)} />
      </div>
    </Modal>
  );
}

/** The same values for a whole discipline at one stage, or a stage copied from the one before. */
function MasivoDialog({
  api,
  masivo,
  elementos,
  disciplinas,
  disciplinaId,
  celdas,
  onGuardadas,
  onClose,
}: {
  api: LoinApi;
  masivo: Masivo;
  elementos: Elemento[];
  disciplinas: Disciplina[];
  disciplinaId: string | null;
  celdas: Map<string, CeldaMatriz>;
  onGuardadas: (c: CeldaMatriz[]) => void;
  onClose: () => void;
}) {
  const [valores, setValores] = useState<Requerimiento>({ ...SIN_REQUERIMIENTO, lod: 200, ndi: 1 });
  const [sobrescribir, setSobrescribir] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const nuevoId = () => crypto.randomUUID();
  const plan: PlanAplicar =
    masivo.tipo === "disciplina"
      ? planDisciplina(elementos, masivo.disciplina.id, masivo.etapa.id, valores, celdas, sobrescribir, nuevoId)
      : planCopiarEtapa(elementos, masivo.desde.id, masivo.hacia.id, celdas, sobrescribir, nuevoId, disciplinaId);
  const ambito = masivo.tipo === "copiar" && disciplinaId ? ` (solo ${disciplinas.find((d) => d.id === disciplinaId)?.nombre ?? "la disciplina elegida"})` : "";

  async function guardar() {
    setBusy("Guardando…");
    setError("");
    try {
      onGuardadas(await api.guardarMatriz(plan.guardar, (hechas) => setBusy(`Guardando ${hechas} de ${plan.guardar.length}…`)));
    } catch (err) {
      setError(message(err));
      setBusy("");
    }
  }

  return (
    <Modal
      title={masivo.tipo === "disciplina" ? `${masivo.disciplina.nombre} · ${masivo.etapa.nombre}: asignar a todos` : `${masivo.hacia.nombre}: copiar de ${masivo.desde.nombre}${ambito}`}
      onClose={() => !busy && onClose()}
      width={720}
      footer={
        <>
          <span style={{ marginRight: "auto", fontSize: 13, color: "var(--tc-gray-500)" }}>{busy}</span>
          <button type="button" style={botonSecundario} onClick={onClose} disabled={!!busy}>
            Cancelar
          </button>
          <button type="button" style={acceptButton} onClick={guardar} disabled={!!busy || plan.guardar.length === 0}>
            Guardar {plan.guardar.length} celda(s)
          </button>
        </>
      }
    >
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <Notice kind="error">{error}</Notice>}
        {masivo.tipo === "disciplina" ? (
          <RequerimientoForm valores={valores} onChange={setValores} ro={false} disciplina={masivo.disciplina} />
        ) : (
          <p style={{ margin: 0, fontSize: 14 }}>Cada elemento activo toma en {masivo.hacia.nombre} el LOD, el NDI, el propósito, el actor y la nota que tiene en {masivo.desde.nombre}. Los elementos sin exigencia en {masivo.desde.nombre} no se tocan.</p>
        )}
        <Notice kind={plan.distintas > 0 ? "warning" : "info"}>
          Se llenan <strong>{plan.nuevas}</strong> celda(s) vacía(s) · <strong>{plan.iguales}</strong> ya tienen esos valores ·{" "}
          <strong>{plan.distintas}</strong> ya piden otra cosa{plan.distintas > 0 && !sobrescribir ? " y no se tocan" : plan.distintas > 0 ? " y se cambiarán" : ""}.
        </Notice>
        {plan.distintas > 0 && (
          <label style={{ fontSize: 14, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={sobrescribir} onChange={(e) => setSobrescribir(e.target.checked)} />
            Cambiar también las {plan.distintas} celda(s) que ya piden otra cosa
          </label>
        )}
      </div>
    </Modal>
  );
}

const VACIA = "#f1f3f5";
const chip: CSSProperties = { borderRadius: 4, padding: "2px 8px", fontWeight: 600, whiteSpace: "nowrap" };
const cabecera: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 2,
  background: "#fff",
  borderBottom: `1px solid ${C.border}`,
  padding: "6px 8px",
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--tc-gray-700)",
  textAlign: "center",
  verticalAlign: "bottom",
};
const grupoTd: CSSProperties = { background: "#f6f8fb", padding: "5px 8px", fontSize: 13, fontWeight: 600, borderBottom: `1px solid ${C.border}`, color: "var(--tc-blue-800)" };
const nombreTd: CSSProperties = { background: "#fff", padding: "4px 8px", fontSize: 13, borderBottom: `1px solid ${C.grid}`, minWidth: 250, maxWidth: 320 };
const celdaBtn: CSSProperties = { width: "100%", minHeight: 34, border: "none", borderRadius: 4, fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", whiteSpace: "nowrap", padding: "0 6px" };

function opcion(activa: boolean, fondo: string, texto: string): CSSProperties {
  return {
    border: activa ? "2px solid var(--tc-gray-700)" : `1px solid ${C.border}`,
    background: activa ? fondo : "#fff",
    color: activa ? texto : "var(--tc-gray-700)",
    borderRadius: 4,
    padding: activa ? "4px 10px" : "5px 11px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
