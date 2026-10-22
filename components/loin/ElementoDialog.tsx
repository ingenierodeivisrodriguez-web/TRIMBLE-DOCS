"use client";

import { CSSProperties, useMemo, useRef, useState } from "react";
import type { LoinApi } from "../../lib/loin/client";
import { reducirImagen } from "../../lib/loin/imagen";
import { agregarGrupo, conteoPorNdi, ndiDe } from "../../lib/loin/ndi";
import { describirRegla, errorPatron } from "../../lib/loin/reglas";
import { textoAlias } from "../../lib/loin/alias";
import { CLASES_IFC, textoRegla } from "../../lib/loin/clasificacion";
import ReglaEditor from "./ReglaEditor";
import { CamposModelo, Disciplina, Elemento, ElementoData, EstadoResponse, GrupoTdi, Imagen, MAX_IMAGENES_ELEMENTO, NDIS, Ndi, Parametro, ParametroExigido, REGLA_VACIA, ReglaValor } from "../../lib/loin/types";
import { coincide, fecha } from "../../lib/presupuesto/format";
import { acceptButton, baseInput, C, labelStyle, message, Modal, Notice, NumInput } from "../presupuesto/ui";
import { area, ayuda, botonPeligro, botonSecundario, campo, ETIQUETA_NDI, inactivo, linkBtn, select, td, th } from "./estilos";

type Seccion = "ficha" | "parametros" | "imagenes";

/** One element to model: its sheet, the parameters it must carry and its reference images. */
export default function ElementoDialog({
  api,
  estado,
  disciplinas,
  disciplinaId,
  elemento,
  siguienteOrden,
  parametros,
  tdiGrupos,
  imagenes,
  camposModelo,
  puedeEditar,
  onGuardado,
  onImagenes,
  onClose,
}: {
  api: LoinApi;
  estado: EstadoResponse;
  disciplinas: Disciplina[];
  disciplinaId: string;
  elemento: Elemento | null;
  siguienteOrden: number;
  parametros: Parametro[];
  tdiGrupos: GrupoTdi[];
  imagenes: Imagen[];
  camposModelo: CamposModelo | null;
  puedeEditar: boolean;
  onGuardado: (e: Elemento) => void;
  onImagenes: (elementoId: string, lista: Imagen[]) => void;
  onClose: () => void;
}) {
  const [actual, setActual] = useState<Elemento | null>(elemento);
  const [d, setD] = useState<ElementoData>(() =>
    elemento
      ? structuredClone(elemento)
      : { disciplinaId, codigo: "", nombre: "", claseIfc: "", tipoPredefinido: "", clasificacionSistema: "", clasificacionCodigo: "", notas: "", parametros: [], regla: null, orden: siguienteOrden, activo: true }
  );
  const [fotos, setFotos] = useState<Imagen[]>(imagenes);
  const [seccion, setSeccion] = useState<Seccion>("ficha");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [cambios, setCambios] = useState(false);
  const ro = !puedeEditar;
  const catalogo = useMemo(() => new Map(parametros.map((p) => [p.id, p])), [parametros]);
  const set = (patch: Partial<ElementoData>) => {
    setD((x) => ({ ...x, ...patch }));
    setCambios(true);
    setOk("");
  };

  async function guardar() {
    setError("");
    if (!d.codigo.trim() || !d.nombre.trim()) return setError("Faltan el código y el nombre del elemento.");
    const malo = d.parametros.find((p) => p.regla && errorPatron(p.regla.patron));
    if (malo) return setError(`La regla propia de "${catalogo.get(malo.parametroId)?.nombre}" tiene un patrón no válido.`);
    setBusy("Guardando…");
    try {
      const guardado = await api.guardarElemento({ ...d, id: actual?.id ?? crypto.randomUUID(), version: actual?.version ?? 0 });
      setActual(guardado);
      setD(structuredClone(guardado));
      setCambios(false);
      setOk(actual ? "Cambios guardados." : "Elemento creado. Ya puedes agregarle imágenes de referencia.");
      onGuardado(guardado);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
    }
  }

  const conteo = conteoPorNdi(d.parametros, catalogo);
  const titulo = actual ? `${actual.codigo} · ${actual.nombre}` : "Nuevo elemento";

  return (
    <Modal
      title={titulo}
      onClose={() => !busy && onClose()}
      width={1020}
      height="90vh"
      toolbar={
        <>
          {(["ficha", "parametros", "imagenes"] as Seccion[]).map((s) => (
            <button key={s} type="button" onClick={() => setSeccion(s)} style={pestana(s === seccion)}>
              {s === "ficha" ? "Ficha" : s === "parametros" ? `Parámetros exigidos (${d.parametros.length})` : `Imágenes (${fotos.length})`}
            </button>
          ))}
        </>
      }
      footer={
        <>
          {actual && (
            <span style={{ marginRight: "auto", fontSize: 12.5, color: "var(--tc-gray-500)" }}>
              Versión {actual.version} · {fecha(actual.actualizado)}
              {actual.actualizadoPor ? ` · ${actual.actualizadoPor}` : ""}
            </span>
          )}
          <button type="button" style={botonSecundario} onClick={onClose} disabled={!!busy}>
            {cambios && !ro ? "Cerrar sin guardar" : "Cerrar"}
          </button>
          {!ro && (
            <button type="button" style={acceptButton} onClick={guardar} disabled={!!busy || (!cambios && !!actual)}>
              {busy === "Guardando…" ? busy : "Guardar"}
            </button>
          )}
        </>
      }
    >
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <Notice kind="error">{error}</Notice>}
        {ok && <Notice kind="info">{ok}</Notice>}
        {seccion === "ficha" && <Ficha d={d} set={set} ro={ro} disciplinas={disciplinas} camposModelo={camposModelo} />}
        {seccion === "parametros" && <Exigidos d={d} set={set} ro={ro} parametros={parametros} catalogo={catalogo} tdiGrupos={tdiGrupos} conteo={conteo} />}
        {seccion === "imagenes" && (
          <Imagenes
            api={api}
            elemento={actual}
            fotos={fotos}
            disponible={estado.imagenesDisponibles}
            ro={ro}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
            onCambio={(lista) => {
              setFotos(lista);
              if (actual) onImagenes(actual.id, lista);
            }}
          />
        )}
      </div>
    </Modal>
  );
}

function Ficha({
  d,
  set,
  ro,
  disciplinas,
  camposModelo,
}: {
  d: ElementoData;
  set: (p: Partial<ElementoData>) => void;
  ro: boolean;
  disciplinas: Disciplina[];
  camposModelo: CamposModelo | null;
}) {
  const campos = useMemo(() => (camposModelo?.campos ?? []).slice(0, 600).map((c) => textoAlias({ grupo: c.grupo, propiedad: c.propiedad })), [camposModelo]);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "10px 12px" }}>
      <label style={{ gridColumn: "span 1" }}>
        <span style={labelStyle}>Código</span>
        <input value={d.codigo} onChange={(e) => set({ codigo: e.target.value.toUpperCase() })} readOnly={ro} maxLength={30} placeholder="MUR" style={campo} aria-label="Código" />
      </label>
      <label style={{ gridColumn: "span 3" }}>
        <span style={labelStyle}>Nombre</span>
        <input value={d.nombre} onChange={(e) => set({ nombre: e.target.value })} readOnly={ro} maxLength={200} placeholder="Muro de mampostería" style={campo} aria-label="Nombre" />
      </label>
      <label style={{ gridColumn: "span 2" }}>
        <span style={labelStyle}>Disciplina</span>
        <select value={d.disciplinaId} onChange={(e) => set({ disciplinaId: e.target.value })} disabled={ro} style={{ ...select, width: "100%" }} aria-label="Disciplina">
          {disciplinas.filter((x) => x.activo || x.id === d.disciplinaId).map((x) => (
            <option key={x.id} value={x.id}>
              {x.codigo} · {x.nombre}
            </option>
          ))}
        </select>
      </label>
      <label style={{ gridColumn: "span 2" }}>
        <span style={labelStyle}>Clase IFC</span>
        <input value={d.claseIfc} onChange={(e) => set({ claseIfc: e.target.value.trim() })} readOnly={ro} list="loin-clases-ifc" placeholder="IfcWall" style={campo} aria-label="Clase IFC" />
        <datalist id="loin-clases-ifc">
          {CLASES_IFC.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label style={{ gridColumn: "span 2" }}>
        <span style={labelStyle}>Tipo predefinido (opcional)</span>
        <input value={d.tipoPredefinido} onChange={(e) => set({ tipoPredefinido: e.target.value.toUpperCase().replace(/\s+/g, "") })} readOnly={ro} placeholder="SOLIDWALL, FLOOR…" style={campo} aria-label="Tipo predefinido" />
      </label>
      <label style={{ gridColumn: "span 1" }}>
        <span style={labelStyle}>Clasificación</span>
        <select value={d.clasificacionSistema} onChange={(e) => set({ clasificacionSistema: e.target.value })} disabled={ro} style={{ ...select, width: "100%" }} aria-label="Sistema de clasificación">
          <option value="">Ninguna</option>
          <option value="OmniClass">OmniClass</option>
          <option value="Uniclass">Uniclass</option>
          {d.clasificacionSistema && !["OmniClass", "Uniclass"].includes(d.clasificacionSistema) && <option value={d.clasificacionSistema}>{d.clasificacionSistema}</option>}
        </select>
      </label>
      <label style={{ gridColumn: "span 1" }}>
        <span style={labelStyle}>Código de clasificación</span>
        <input value={d.clasificacionCodigo} onChange={(e) => set({ clasificacionCodigo: e.target.value })} readOnly={ro || !d.clasificacionSistema} maxLength={60} placeholder="21-02 10 10" style={campo} aria-label="Código de clasificación" />
      </label>
      <label style={{ gridColumn: "1 / -1" }}>
        <span style={labelStyle}>Notas de modelado</span>
        <textarea
          value={d.notas}
          onChange={(e) => set({ notas: e.target.value })}
          readOnly={ro}
          maxLength={4000}
          placeholder="Cómo se modela: por capas o compuesto, por nivel, uniones con otros elementos, qué no se modela…"
          style={{ ...area, minHeight: 150 }}
          aria-label="Notas de modelado"
        />
      </label>
      <div style={{ gridColumn: "1 / -1" }}>
        <span style={labelStyle}>Regla de asociación con los modelos</span>
        <ReglaEditor regla={d.regla} onChange={(regla) => set({ regla })} ro={ro} claseIfc={d.claseIfc} campos={campos} valores={() => []} />
        <p style={ayuda}>
          {textoRegla(d.regla)}. Pruébala en el visor 3D (panel Requisitos BIM → Reglas → Probar regla), donde se ve cuántos objetos toma y se resaltan.
        </p>
      </div>
      <label style={{ gridColumn: "1 / -1", fontSize: 14, display: "flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={d.activo} onChange={(e) => set({ activo: e.target.checked })} disabled={ro} /> Activo
        <span style={{ ...ayuda, margin: 0 }}>(los elementos no se borran: se desactivan)</span>
      </label>
    </div>
  );
}

function Exigidos({
  d,
  set,
  ro,
  parametros,
  catalogo,
  tdiGrupos,
  conteo,
}: {
  d: ElementoData;
  set: (p: Partial<ElementoData>) => void;
  ro: boolean;
  parametros: Parametro[];
  catalogo: Map<string, Parametro>;
  tdiGrupos: GrupoTdi[];
  conteo: ReturnType<typeof conteoPorNdi>;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [tdi, setTdi] = useState(tdiGrupos[0]?.codigo ?? "A");
  const [ndi, setNdi] = useState<Ndi>(1);
  const [reglaAbierta, setReglaAbierta] = useState<string | null>(null);
  const asignados = new Set(d.parametros.map((p) => p.parametroId));
  const disponibles = parametros.filter((p) => p.activo && !asignados.has(p.id) && coincide(`${p.codigo} ${p.nombre} TDI-${p.tdi} NDI-${p.ndi}`, busqueda));
  const cambiar = (id: string, patch: Partial<ParametroExigido>) => set({ parametros: d.parametros.map((p) => (p.parametroId === id ? { ...p, ...patch } : p)) });
  const enGrupo = parametros.filter((p) => p.activo && p.tdi === tdi && p.ndi === ndi && !asignados.has(p.id)).length;
  const ordenados = [...d.parametros].sort((a, b) => {
    const pa = catalogo.get(a.parametroId);
    const pb = catalogo.get(b.parametroId);
    return (pa?.tdi ?? "~").localeCompare(pb?.tdi ?? "~") || (pa ? ndiDe(a, pa) : 9) - (pb ? ndiDe(b, pb) : 9) || (pa?.numero ?? 0) - (pb?.numero ?? 0);
  });

  return (
    <>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {NDIS.map((n) => (
          <span key={n} style={ETIQUETA_NDI[n]}>
            NDI-{n}: {conteo[n].obligatorios} obligatorio(s) · {conteo[n].opcionales} opcional(es)
          </span>
        ))}
      </div>
      <p style={ayuda}>
        El NDI es acumulativo: cuando la matriz de una etapa pida NDI-2, este elemento deberá tener todos sus parámetros NDI-1 y NDI-2. Cada parámetro toma el NDI y la regla del catálogo, salvo que aquí le
        pongas los suyos (solo para este elemento).
      </p>
      {!ro && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 4, padding: 8 }}>
          <span style={{ fontSize: 13.5 }}>Agregar todos los</span>
          <select value={ndi} onChange={(e) => setNdi(Number(e.target.value) as Ndi)} style={select} aria-label="NDI a agregar">
            {NDIS.map((n) => (
              <option key={n} value={n}>
                NDI-{n}
              </option>
            ))}
          </select>
          <span style={{ fontSize: 13.5 }}>del grupo</span>
          <select value={tdi} onChange={(e) => setTdi(e.target.value)} style={select} aria-label="Grupo TDI a agregar">
            {tdiGrupos.map((g) => (
              <option key={g.codigo} value={g.codigo}>
                TDI-{g.codigo} · {g.nombre}
              </option>
            ))}
          </select>
          <button type="button" style={botonSecundario} disabled={enGrupo === 0} onClick={() => set({ parametros: agregarGrupo(d.parametros, parametros, tdi, ndi) })}>
            Agregar {enGrupo}
          </button>
        </div>
      )}

      <div style={{ border: `1px solid ${C.border}`, background: "#fff", maxHeight: 340, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Código</th>
              <th style={th}>Parámetro</th>
              <th style={th}>TDI</th>
              <th style={th}>NDI</th>
              <th style={th}>Obligatorio</th>
              <th style={th}>Regla</th>
              {!ro && <th style={th} />}
            </tr>
          </thead>
          <tbody>
            {ordenados.length === 0 && (
              <tr>
                <td style={td} colSpan={7}>
                  Sin parámetros exigidos.
                </td>
              </tr>
            )}
            {ordenados.map((a) => {
              const p = catalogo.get(a.parametroId);
              if (!p) {
                return (
                  <tr key={a.parametroId}>
                    <td style={td} colSpan={6}>
                      <span style={{ color: "#b3261e" }}>Este parámetro ya no está en el catálogo del proyecto (no se exige).</span>
                    </td>
                    {!ro && (
                      <td style={td}>
                        <button type="button" style={linkBtn} onClick={() => set({ parametros: d.parametros.filter((x) => x.parametroId !== a.parametroId) })}>
                          Quitar
                        </button>
                      </td>
                    )}
                  </tr>
                );
              }
              const regla = a.regla ?? p.regla;
              return (
                <tr key={a.parametroId} style={{ opacity: p.activo ? 1 : 0.55 }}>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{p.codigo}</td>
                  <td style={td} title={p.descripcion}>
                    {p.nombre} {!p.activo && <span style={inactivo}>Inactivo en el catálogo</span>}
                  </td>
                  <td style={td}>TDI-{p.tdi}</td>
                  <td style={td}>
                    <select
                      value={a.ndi ?? 0}
                      onChange={(e) => cambiar(a.parametroId, { ndi: Number(e.target.value) ? (Number(e.target.value) as Ndi) : null })}
                      disabled={ro}
                      style={select}
                      aria-label={`NDI de ${p.nombre}`}
                    >
                      <option value={0}>NDI-{p.ndi} (catálogo)</option>
                      {NDIS.filter((n) => n !== p.ndi).map((n) => (
                        <option key={n} value={n}>
                          NDI-{n} (propio)
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <input type="checkbox" checked={a.obligatorio} onChange={(e) => cambiar(a.parametroId, { obligatorio: e.target.checked })} disabled={ro} aria-label={`${p.nombre} obligatorio`} />
                  </td>
                  <td style={{ ...td, fontSize: 12.5 }}>
                    {describirRegla(regla, p.unidad) || <span style={{ color: "var(--tc-gray-500)" }}>No vacío</span>}
                    {a.regla ? " (propia)" : ""}{" "}
                    {!ro && (p.tipoDato === "numero" || p.tipoDato === "texto" || p.tipoDato === "lista") && (
                      <button type="button" style={linkBtn} onClick={() => setReglaAbierta(reglaAbierta === a.parametroId ? null : a.parametroId)}>
                        {reglaAbierta === a.parametroId ? "Listo" : "Cambiar"}
                      </button>
                    )}
                    {reglaAbierta === a.parametroId && (
                      <ReglaPropia p={p} regla={a.regla} onCambio={(r) => cambiar(a.parametroId, { regla: r })} />
                    )}
                  </td>
                  {!ro && (
                    <td style={td}>
                      <button type="button" style={linkBtn} onClick={() => set({ parametros: d.parametros.filter((x) => x.parametroId !== a.parametroId) })}>
                        Quitar
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!ro && (
        <div>
          <span style={labelStyle}>Agregar del catálogo</span>
          <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar por código, nombre, TDI-B, NDI-2…" style={{ ...baseInput, width: "100%", padding: "6px 10px" }} aria-label="Buscar en el catálogo" />
          <div style={{ border: `1px solid ${C.border}`, background: "#fff", maxHeight: 220, overflow: "auto", marginTop: 6 }}>
            {disponibles.slice(0, 60).map((p) => (
              <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderBottom: `1px solid ${C.grid}`, fontSize: 13.5 }}>
                <span style={{ width: 80, flexShrink: 0 }}>{p.codigo}</span>
                <span style={{ flex: 1 }} title={p.descripcion}>
                  {p.nombre}
                </span>
                <span>TDI-{p.tdi}</span>
                <span style={ETIQUETA_NDI[p.ndi]}>NDI-{p.ndi}</span>
                <button type="button" style={linkBtn} onClick={() => set({ parametros: [...d.parametros, { parametroId: p.id, obligatorio: true, ndi: null, regla: null }] })}>
                  + Agregar
                </button>
              </div>
            ))}
            {disponibles.length > 60 && <p style={{ ...ayuda, padding: "4px 8px" }}>…y {disponibles.length - 60} más: afina la búsqueda.</p>}
            {disponibles.length === 0 && <p style={{ ...ayuda, padding: "4px 8px" }}>No hay más parámetros activos que coincidan.</p>}
          </div>
        </div>
      )}
    </>
  );
}

/** The element's own bounds or pattern for a parameter (null: the catalog's). */
function ReglaPropia({ p, regla, onCambio }: { p: Parametro; regla: ReglaValor | null; onCambio: (r: ReglaValor | null) => void }) {
  const r = regla ?? { ...REGLA_VACIA, ...p.regla };
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
      {p.tipoDato === "numero" ? (
        <>
          <span>Mín.</span>
          <NumInput value={r.min} decimals={4} allowEmpty onCommit={(v) => onCambio({ ...r, min: v })} style={{ width: 80 }} ariaLabel="Mínimo propio" />
          <span>Máx.</span>
          <NumInput value={r.max} decimals={4} allowEmpty onCommit={(v) => onCambio({ ...r, max: v })} style={{ width: 80 }} ariaLabel="Máximo propio" />
        </>
      ) : (
        <input value={r.patron} onChange={(e) => onCambio({ ...r, patron: e.target.value })} placeholder="Patrón" style={{ ...baseInput, fontFamily: "monospace", width: 180 }} aria-label="Patrón propio" />
      )}
      {regla && (
        <button type="button" style={linkBtn} onClick={() => onCambio(null)}>
          Usar la del catálogo
        </button>
      )}
      {regla && errorPatron(regla.patron) && <span style={{ color: "#b3261e" }}>Patrón no válido</span>}
    </div>
  );
}

function Imagenes({
  api,
  elemento,
  fotos,
  disponible,
  ro,
  busy,
  setBusy,
  setError,
  onCambio,
}: {
  api: LoinApi;
  elemento: Elemento | null;
  fotos: Imagen[];
  disponible: boolean;
  ro: boolean;
  busy: string;
  setBusy: (t: string) => void;
  setError: (t: string) => void;
  onCambio: (lista: Imagen[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [grande, setGrande] = useState<Imagen | null>(null);
  const [quitar, setQuitar] = useState<string | null>(null);

  async function subir(archivos: File[]) {
    if (!elemento) return;
    setError("");
    let lista = [...fotos];
    const cupo = MAX_IMAGENES_ELEMENTO - lista.length;
    if (archivos.length > cupo) setError(`Cada elemento admite hasta ${MAX_IMAGENES_ELEMENTO} imágenes: se suben solo las primeras ${cupo}.`);
    for (const [i, a] of archivos.slice(0, Math.max(0, cupo)).entries()) {
      setBusy(`Reduciendo y subiendo ${i + 1} de ${Math.min(archivos.length, cupo)}…`);
      try {
        const r = await reducirImagen(a);
        lista = [...lista, await api.subirImagen(elemento.id, r)];
        onCambio(lista);
      } catch (err) {
        setError(message(err));
        break;
      }
    }
    setBusy("");
  }

  async function eliminar(id: string) {
    setBusy("Quitando la imagen…");
    setError("");
    try {
      await api.eliminarImagen(id);
      onCambio(fotos.filter((f) => f.id !== id));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy("");
      setQuitar(null);
    }
  }

  if (!disponible) return <Notice kind="warning">El servidor no tiene dónde guardar imágenes (falta conectar Supabase Storage).</Notice>;
  if (!elemento) return <Notice kind="info">Guarda el elemento primero; luego podrás subirle imágenes de referencia.</Notice>;

  return (
    <>
      <p style={ayuda}>
        Fotos o capturas de cómo debe verse el elemento modelado (PNG, JPG o WebP). Se reducen en tu navegador a 1600 px antes de subirlas y se guardan en un depósito privado: solo las ven los
        miembros del proyecto, con enlaces que vencen en una hora. Hasta {MAX_IMAGENES_ELEMENTO} por elemento.
      </p>
      {!ro && (
        <div>
          <button type="button" style={botonSecundario} onClick={() => input.current?.click()} disabled={!!busy || fotos.length >= MAX_IMAGENES_ELEMENTO}>
            Subir imágenes
          </button>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) subir(files);
            }}
          />
          {busy && <span style={{ marginLeft: 10, fontSize: 13, color: "var(--tc-gray-500)" }}>{busy}</span>}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
        {fotos.map((f) => (
          <figure key={f.id} style={{ margin: 0, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
            <button type="button" onClick={() => setGrande(f)} style={{ border: "none", padding: 0, display: "block", width: "100%", height: 150, background: "#eef1f5", cursor: "zoom-in" }}>
              {f.url ? <img src={f.url} alt={f.nombre} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 12 }}>Sin enlace</span>}
            </button>
            <figcaption style={{ padding: "6px 8px", fontSize: 12.5 }}>
              <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.nombre}>
                {f.nombre}
              </span>
              <span style={{ color: "var(--tc-gray-500)" }}>
                {f.ancho}×{f.alto} px · {Math.round(f.bytes / 1024)} KB · {fecha(f.subida).slice(0, 10)}
              </span>
              {!ro &&
                (quitar === f.id ? (
                  <span style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    <button type="button" style={{ ...botonPeligro, padding: "3px 10px", fontSize: 12.5 }} onClick={() => eliminar(f.id)} disabled={!!busy}>
                      Quitar
                    </button>
                    <button type="button" style={{ ...botonSecundario, padding: "3px 10px", fontSize: 12.5 }} onClick={() => setQuitar(null)}>
                      No
                    </button>
                  </span>
                ) : (
                  <button type="button" style={{ ...linkBtn, display: "block", marginTop: 4 }} onClick={() => setQuitar(f.id)}>
                    Quitar imagen
                  </button>
                ))}
            </figcaption>
          </figure>
        ))}
      </div>
      {fotos.length === 0 && <p style={ayuda}>Este elemento no tiene imágenes todavía.</p>}
      {grande && (
        <Modal title={grande.nombre} onClose={() => setGrande(null)} width={Math.min(grande.ancho + 40, 1400)}>
          <img src={grande.url} alt={grande.nombre} style={{ maxWidth: "100%", display: "block", margin: "0 auto" }} />
        </Modal>
      )}
    </>
  );
}

function pestana(activa: boolean): CSSProperties {
  return {
    border: "none",
    borderBottom: `3px solid ${activa ? C.header : "transparent"}`,
    background: "transparent",
    padding: "6px 12px",
    fontSize: 14,
    fontWeight: activa ? 600 : 400,
    color: activa ? C.header : "var(--tc-gray-700)",
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
