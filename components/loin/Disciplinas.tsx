"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import type { LoinApi } from "../../lib/loin/client";
import { conteoPorNdi } from "../../lib/loin/ndi";
import type { Disciplina, Elemento, ElementosResponse, EstadoResponse, GrupoTdi, Imagen, Parametro } from "../../lib/loin/types";
import { CATEGORY_COLORS } from "../../lib/graficos/colors";
import { acceptButton, C, labelStyle, message, Modal, Notice } from "../presupuesto/ui";
import ElementoDialog from "./ElementoDialog";
import { ayuda, botonPrincipal, botonSecundario, campo, ETIQUETA_NDI, inactivo, linkBtn } from "./estilos";
import PlantillasDialog from "./PlantillasDialog";

/** Disciplines on the left, the elements to model of the chosen one on the right. */
export default function Disciplinas({ api, estado, parametros, tdiGrupos }: { api: LoinApi; estado: EstadoResponse; parametros: Parametro[]; tdiGrupos: GrupoTdi[] }) {
  const [datos, setDatos] = useState<ElementosResponse | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [elegida, setElegida] = useState<string | null>(null);
  const [inactivos, setInactivos] = useState(false);
  const [editarDisciplina, setEditarDisciplina] = useState<Disciplina | "nueva" | null>(null);
  const [editarElemento, setEditarElemento] = useState<Elemento | "nuevo" | null>(null);
  const [plantillas, setPlantillas] = useState(false);
  const [busy, setBusy] = useState(false);
  const puede = estado.canEdit;
  const catalogo = useMemo(() => new Map(parametros.map((p) => [p.id, p])), [parametros]);

  const cargar = useCallback(async () => {
    setError("");
    try {
      const d = await api.getElementos();
      setDatos(d);
      setElegida((actual) => (actual && d.disciplinas.some((x) => x.id === actual) ? actual : (d.disciplinas.find((x) => x.activo)?.id ?? null)));
    } catch (err) {
      setError(message(err));
    }
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function cargarSugeridas() {
    setBusy(true);
    setError("");
    setAviso("");
    try {
      const r = await api.cargarSugeridas();
      setAviso(
        r.disciplinas
          ? `Listo: ${r.disciplinas} disciplina(s) y ${r.elementos} elemento(s) agregados. Ajusta lo que necesites y asigna los parámetros de cada elemento.${r.yaExistian.length ? ` Ya existían: ${r.yaExistian.join(", ")}.` : ""}`
          : "Todas las disciplinas sugeridas ya están en el proyecto (se reconocen por su código)."
      );
      await cargar();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  if (!datos) {
    return error ? (
      <Notice kind="error">
        {error}{" "}
        <button type="button" style={linkBtn} onClick={cargar}>
          Reintentar
        </button>
      </Notice>
    ) : (
      <p style={{ color: "var(--tc-gray-500)" }}>Cargando disciplinas…</p>
    );
  }

  const disciplinas = datos.disciplinas.filter((d) => inactivos || d.activo);
  const actual = datos.disciplinas.find((d) => d.id === elegida) ?? null;
  const elementos = datos.elementos.filter((e) => e.disciplinaId === elegida && (inactivos || e.activo));
  const imagenesDe = (id: string) => datos.imagenes.filter((i) => i.elementoId === id);
  const reemplazar = <T extends { id: string }>(lista: T[], x: T) => (lista.some((y) => y.id === x.id) ? lista.map((y) => (y.id === x.id ? x : y)) : [...lista, x]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {puede && (
          <>
            <button type="button" style={botonPrincipal} onClick={() => setEditarDisciplina("nueva")}>
              + Disciplina
            </button>
            <button type="button" style={botonSecundario} onClick={cargarSugeridas} disabled={busy} title="Arquitectura, Estructura, Hidrosanitaria, Eléctrica, Mecánica, Red contra incendio, Gas, Telecomunicaciones, Urbanismo y General, con sus elementos usuales y su clase IFC">
              {busy ? "Cargando…" : "Cargar disciplinas sugeridas"}
            </button>
          </>
        )}
        <button type="button" style={botonSecundario} onClick={() => setPlantillas(true)}>
          Plantillas…
        </button>
        <label style={{ fontSize: 13.5, display: "inline-flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} /> Ver inactivos
        </label>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {aviso && <Notice kind="info">{aviso}</Notice>}
      {!estado.imagenesDisponibles && <Notice kind="warning">El servidor no tiene dónde guardar imágenes (falta conectar Supabase): las fichas funcionan, pero sin imágenes de referencia.</Notice>}

      <div style={{ display: "flex", gap: 12, flex: 1, minHeight: 0, flexWrap: "wrap" }}>
        <aside style={{ flex: "0 0 270px", background: "#fff", border: `1px solid ${C.border}`, borderRadius: 4, overflow: "auto", maxHeight: "calc(100vh - 200px)" }}>
          {disciplinas.length === 0 && (
            <p style={{ ...ayuda, padding: 12 }}>{puede ? "Sin disciplinas. Créalas una por una, carga las sugeridas o usa una plantilla." : "Todavía no hay disciplinas en este proyecto."}</p>
          )}
          {disciplinas.map((d) => {
            const n = datos.elementos.filter((e) => e.disciplinaId === d.id && e.activo).length;
            return (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                onClick={() => setElegida(d.id)}
                onKeyDown={(e) => e.key === "Enter" && setElegida(d.id)}
                style={{ ...filaDisciplina, background: d.id === elegida ? C.rowSelected : undefined, opacity: d.activo ? 1 : 0.55 }}
              >
                <span style={{ width: 12, height: 12, borderRadius: 3, background: d.color, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>{d.codigo}</strong> · {d.nombre} {!d.activo && <span style={inactivo}>Inactiva</span>}
                  <span style={{ display: "block", fontSize: 12, color: "var(--tc-gray-500)" }}>{n} elemento(s)</span>
                </span>
                {puede && (
                  <button
                    type="button"
                    style={{ ...linkBtn, textDecoration: "none" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditarDisciplina(d);
                    }}
                    aria-label={`Editar ${d.nombre}`}
                    title="Editar la disciplina"
                  >
                    ✎
                  </button>
                )}
              </div>
            );
          })}
        </aside>

        <section style={{ flex: "1 1 500px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {actual && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h2 style={{ margin: 0, fontSize: 16, color: "var(--tc-blue-800)" }}>
                <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: actual.color, marginRight: 6 }} />
                {actual.nombre}: elementos a modelar
              </h2>
              {puede && actual.activo && (
                <button type="button" style={botonPrincipal} onClick={() => setEditarElemento("nuevo")}>
                  + Elemento
                </button>
              )}
            </div>
          )}
          {actual && elementos.length === 0 && <p style={ayuda}>Esta disciplina no tiene elementos todavía.</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10, overflow: "auto", alignContent: "start" }}>
            {elementos.map((e) => {
              const img = imagenesDe(e.id)[0];
              const conteo = conteoPorNdi(e.parametros, catalogo);
              return (
                <button key={e.id} type="button" onClick={() => setEditarElemento(e)} style={{ ...tarjeta, opacity: e.activo ? 1 : 0.55 }}>
                  <span style={miniatura}>
                    {img?.url ? <img src={img.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 11, color: "var(--tc-gray-500)" }}>Sin imagen</span>}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <span style={{ display: "block", fontWeight: 600, fontSize: 14 }}>
                      {e.nombre} {!e.activo && <span style={inactivo}>Inactivo</span>}
                    </span>
                    <span style={{ display: "block", fontSize: 12.5, color: "var(--tc-gray-500)" }}>
                      {e.codigo} · {e.claseIfc || "sin clase IFC"}
                      {e.tipoPredefinido ? ` (${e.tipoPredefinido})` : ""}
                    </span>
                    <span style={{ display: "flex", gap: 4, marginTop: 5, flexWrap: "wrap" }}>
                      {([1, 2, 3] as const).map((n) =>
                        conteo[n].obligatorios + conteo[n].opcionales > 0 ? (
                          <span key={n} style={ETIQUETA_NDI[n]} title={`${conteo[n].obligatorios} obligatorio(s), ${conteo[n].opcionales} opcional(es)`}>
                            NDI-{n}: {conteo[n].obligatorios + conteo[n].opcionales}
                          </span>
                        ) : null
                      )}
                      {e.parametros.length === 0 && <span style={{ fontSize: 12, color: "#b3261e" }}>Sin parámetros exigidos</span>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      {editarDisciplina && (
        <DisciplinaDialog
          api={api}
          disciplina={editarDisciplina === "nueva" ? null : editarDisciplina}
          siguienteOrden={Math.max(0, ...datos.disciplinas.map((d) => d.orden)) + 1}
          colorSugerido={CATEGORY_COLORS[datos.disciplinas.length % CATEGORY_COLORS.length]}
          onGuardada={(d) => {
            setDatos({ ...datos, disciplinas: reemplazar(datos.disciplinas, d) });
            setElegida(d.id);
            setEditarDisciplina(null);
          }}
          onClose={() => setEditarDisciplina(null)}
        />
      )}
      {editarElemento && actual && (
        <ElementoDialog
          api={api}
          estado={estado}
          disciplinas={datos.disciplinas}
          disciplinaId={actual.id}
          elemento={editarElemento === "nuevo" ? null : editarElemento}
          siguienteOrden={Math.max(0, ...elementos.map((e) => e.orden)) + 1}
          parametros={parametros}
          tdiGrupos={tdiGrupos}
          imagenes={editarElemento === "nuevo" ? [] : imagenesDe(editarElemento.id)}
          puedeEditar={puede}
          onGuardado={(e) => setDatos((d) => (d ? { ...d, elementos: reemplazar(d.elementos, e) } : d))}
          onImagenes={(elementoId: string, lista: Imagen[]) => setDatos((d) => (d ? { ...d, imagenes: [...d.imagenes.filter((i) => i.elementoId !== elementoId), ...lista] } : d))}
          onClose={() => setEditarElemento(null)}
        />
      )}
      {plantillas && (
        <PlantillasDialog
          api={api}
          estado={estado}
          disciplinas={datos.disciplinas}
          onAplicada={async (texto) => {
            setAviso(texto);
            await cargar();
          }}
          onClose={() => setPlantillas(false)}
        />
      )}
    </div>
  );
}

function DisciplinaDialog({
  api,
  disciplina,
  siguienteOrden,
  colorSugerido,
  onGuardada,
  onClose,
}: {
  api: LoinApi;
  disciplina: Disciplina | null;
  siguienteOrden: number;
  colorSugerido: string;
  onGuardada: (d: Disciplina) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState(() => disciplina ?? { codigo: "", nombre: "", color: colorSugerido, orden: siguienteOrden, activo: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    setBusy(true);
    setError("");
    try {
      onGuardada(await api.guardarDisciplina({ ...d, id: disciplina?.id ?? crypto.randomUUID(), version: disciplina?.version ?? 0 }));
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={disciplina ? `Disciplina ${disciplina.codigo}` : "Nueva disciplina"}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" style={botonSecundario} onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" style={acceptButton} onClick={guardar} disabled={busy || !d.codigo.trim() || !d.nombre.trim()}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      <div style={{ padding: 16, display: "grid", gridTemplateColumns: "120px 1fr 80px", gap: 12, alignItems: "end" }}>
        {error && <Notice kind="error" style={{ gridColumn: "1 / -1" }}>{error}</Notice>}
        <label>
          <span style={labelStyle}>Código</span>
          <input value={d.codigo} onChange={(e) => setD({ ...d, codigo: e.target.value.toUpperCase() })} maxLength={20} placeholder="ARQ" style={campo} aria-label="Código" />
        </label>
        <label>
          <span style={labelStyle}>Nombre</span>
          <input value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} maxLength={120} placeholder="Arquitectura" style={campo} aria-label="Nombre" />
        </label>
        <label>
          <span style={labelStyle}>Color</span>
          <input type="color" value={d.color} onChange={(e) => setD({ ...d, color: e.target.value })} style={{ width: "100%", height: 34, border: `1px solid ${C.border}`, padding: 2 }} aria-label="Color" />
        </label>
        <label style={{ gridColumn: "1 / -1", fontSize: 14, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={d.activo} onChange={(e) => setD({ ...d, activo: e.target.checked })} /> Activa
          <span style={{ ...ayuda, margin: 0 }}>(las disciplinas no se borran: se desactivan)</span>
        </label>
      </div>
    </Modal>
  );
}

const filaDisciplina: CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: `1px solid ${C.grid}`, cursor: "pointer", fontSize: 14 };
const tarjeta: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
  background: "#fff",
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: 8,
  cursor: "pointer",
  fontFamily: "inherit",
  color: "inherit",
};
const miniatura: CSSProperties = { width: 64, height: 64, flexShrink: 0, borderRadius: 4, background: "#eef1f5", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" };
