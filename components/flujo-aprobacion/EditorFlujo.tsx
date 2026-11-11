"use client";

import { CSSProperties, useEffect, useState } from "react";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import { claveHito, nombreDeRuta, revisarDatos } from "../../lib/flujo-aprobacion/flujos";
import { Equipo, EstadoFlujos, Flujo, MAX_ARCHIVOS, MAX_PASOS, MIN_PASOS } from "../../lib/flujo-aprobacion/types";
import { isoToDisplay, parseDisplayDate } from "../../lib/propiedades/values";
import { botonSecundario, linkBtn, select } from "../compras/estilos";
import DateField from "../propiedades/DateField";
import Explorador, { Elegido } from "../publicar/Explorador";
import { baseInput, C, message, Notice } from "../presupuesto/ui";

interface ArchivoElegido {
  id: string;
  nombre: string;
  ruta: string;
}

interface PasoForm {
  id?: string;
  nombre: string;
  /** "persona:id" or "grupo:id", or "". */
  responsable: string;
  /** The name it had, for a responsible no longer in Trimble's team. */
  nombreResponsable?: string;
}

const ROJO = "#b3261e";
const AZUL = "#2f4f8f";
const chip = { display: "inline-flex", gap: 6, alignItems: "center", border: `1px solid ${C.border}`, borderRadius: 12, padding: "2px 10px", fontSize: 13, background: "#f6f8fb", maxWidth: "100%" } as const;
const flecha = { ...botonSecundario, padding: "2px 8px", fontSize: 13 } as const;
const etiqueta: CSSProperties = { display: "block", fontSize: 13.5, color: "var(--tc-gray-700)", marginBottom: 4 };
const campo: CSSProperties = { ...baseInput, width: "100%", fontSize: 14.5, padding: "8px 10px" };
const seccion: CSSProperties = { margin: "18px 0 6px", paddingTop: 14, borderTop: `1px solid ${C.grid}`, fontSize: 15, fontWeight: 600, color: "var(--tc-gray-800)" };
const ayuda: CSSProperties = { fontSize: 12.5, color: "var(--tc-gray-500)", margin: "4px 0 0" };
const botonTexto: CSSProperties = { border: "none", background: "transparent", color: "var(--tc-gray-700)", fontSize: 15, padding: "8px 14px", cursor: "pointer", fontFamily: "inherit" };

/**
 * Creating or changing a flow, in a floating box over the darkened screen
 * (like Trimble's own dialogs): title, description, due date, the files that
 * go through it (several at once, from any folder) and its steps, each with
 * its responsible from Trimble's team. No destination folder: the approver
 * will decide. The same checks as the server run before sending. A click
 * outside does nothing, and closing with changes asks first.
 */
export default function EditorFlujo({
  api,
  projectId,
  flujo,
  equipo,
  onGuardado,
  onCancelar,
}: {
  api: FlujoApi;
  projectId: string;
  flujo: Flujo | null;
  /** Trimble's people and groups (null while loading). */
  equipo: Equipo | null;
  onGuardado: (e: EstadoFlujos, id: string | null) => void;
  onCancelar: () => void;
}) {
  const [hito, setHito] = useState(flujo?.hito ?? "");
  const [venceTexto, setVenceTexto] = useState(flujo?.vence ? isoToDisplay(flujo.vence) : "");
  const [notas, setNotas] = useState(flujo?.notas ?? "");
  const [archivos, setArchivos] = useState<ArchivoElegido[]>(flujo?.archivos.map((a) => ({ id: a.id, nombre: nombreDeRuta(a.ruta), ruta: a.ruta })) ?? []);
  const [pasos, setPasos] = useState<PasoForm[]>(
    flujo?.pasos.map((p) => ({ id: p.id, nombre: p.nombre, responsable: p.responsable ? `${p.responsable.tipo}:${p.responsable.id}` : "", nombreResponsable: p.responsable?.nombre })) ?? [
      { nombre: "Revisa", responsable: "" },
      { nombre: "Aprueba", responsable: "" },
    ]
  );
  const [explorando, setExplorando] = useState(false);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmarCierre, setConfirmarCierre] = useState(false);

  const venceIso = venceTexto.trim() ? parseDisplayDate(venceTexto) : null;
  const venceMal = !!venceTexto.trim() && !venceIso;
  const envio = pasos.map((p) => {
    const [tipo, id] = p.responsable.split(":");
    return { ...(p.id ? { id: p.id } : {}), nombre: p.nombre, responsable: id ? { tipo: tipo as "persona" | "grupo", id } : null };
  });
  const datos = { hito, archivos: archivos.map((a) => a.id), pasos: envio, vence: venceIso ?? "", notas };
  const problema = venceMal ? "Escribe la fecha de vencimiento como DD-MM-AAAA o déjala vacía." : revisarDatos(datos);
  const sinTitulo = !hito.trim();

  // What was there on opening, to know whether closing loses something.
  const huella = JSON.stringify({ hito, venceTexto, notas, archivos: archivos.map((a) => a.id), pasos: pasos.map((p) => [p.nombre, p.responsable]) });
  const [inicial] = useState(huella);
  const cambiado = huella !== inicial;

  function pedirCerrar() {
    if (ocupado) return;
    if (cambiado) setConfirmarCierre(true);
    else onCancelar();
  }

  // Escape closes like the ✕ (asking first when something was typed).
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (e.key !== "Escape" || ocupado) return;
      if (cambiado) setConfirmarCierre(true);
      else onCancelar();
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [cambiado, ocupado, onCancelar]);

  function alternar(e: Elegido) {
    setArchivos((as) => (as.some((x) => x.id === e.id) ? as.filter((x) => x.id !== e.id) : [...as, { id: e.id, nombre: e.nombre, ruta: e.ruta }]));
  }
  function varios(es: Elegido[], marcar: boolean) {
    setArchivos((as) => (marcar ? [...as, ...es.filter((e) => !as.some((x) => x.id === e.id)).map((e) => ({ id: e.id, nombre: e.nombre, ruta: e.ruta }))] : as.filter((x) => !es.some((e) => e.id === x.id))));
  }
  function cambiarPaso(i: number, cambio: Partial<PasoForm>) {
    setPasos((ps) => ps.map((p, j) => (j === i ? { ...p, ...cambio } : p)));
  }
  function moverPaso(i: number, d: -1 | 1) {
    setPasos((ps) => {
      const otro = i + d;
      if (otro < 0 || otro >= ps.length) return ps;
      const nuevo = [...ps];
      [nuevo[i], nuevo[otro]] = [nuevo[otro], nuevo[i]];
      return nuevo;
    });
  }

  async function guardar() {
    if (problema) {
      setError(problema);
      return;
    }
    setOcupado(true);
    setError("");
    try {
      const r = await api.guardarFlujo({ ...datos, ...(flujo ? { id: flujo.id, version: flujo.version } : {}) });
      // The saved flow (new ones: the one with this milestone).
      const guardado = flujo ? flujo.id : (r.flujos.find((f) => f.hitoClave === claveHito(hito))?.id ?? null);
      onGuardado(r, guardado);
    } catch (err) {
      setError(message(err));
    } finally {
      setOcupado(false);
    }
  }

  /** The dropdown's options: groups, then people; a responsible no longer in the team stays visible. */
  const opciones = (p: PasoForm) => {
    const enEquipo = !p.responsable || !equipo || equipo.grupos.some((g) => `grupo:${g.id}` === p.responsable) || equipo.personas.some((x) => `persona:${x.id}` === p.responsable);
    return (
      <>
        <option value="">{equipo ? "Responsable…" : "Cargando el equipo…"}</option>
        {!enEquipo && <option value={p.responsable}>{`${p.nombreResponsable ?? "?"} (ya no está en el equipo)`}</option>}
        {!equipo && p.responsable && <option value={p.responsable}>{p.nombreResponsable ?? "…"}</option>}
        {equipo && equipo.grupos.length > 0 && (
          <optgroup label="Grupos">
            {equipo.grupos.map((g) => (
              <option key={g.id} value={`grupo:${g.id}`}>
                {g.nombre}
              </option>
            ))}
          </optgroup>
        )}
        {equipo && (
          <optgroup label="Personas">
            {equipo.personas.map((x) => (
              <option key={x.id} value={`persona:${x.id}`}>
                {x.nombre}
                {x.pendiente ? " (invitación pendiente)" : ""}
              </option>
            ))}
          </optgroup>
        )}
      </>
    );
  };

  const nombreVentana = flujo ? `Editar «${flujo.hito}»` : "Crear flujo";

  return (
    <div role="presentation" style={{ position: "fixed", inset: 0, background: "rgba(20,30,45,0.45)", zIndex: 55, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ventana-flujo-titulo"
        style={{ width: 720, maxWidth: "100%", maxHeight: "100%", background: "#fff", borderRadius: 4, boxShadow: "0 16px 48px rgba(0,0,0,0.32)", display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "18px 24px 10px", flexShrink: 0 }}>
          <h2 id="ventana-flujo-titulo" style={{ margin: 0, fontSize: 19, fontWeight: 700, color: "var(--tc-gray-800)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {nombreVentana}
          </h2>
          <button type="button" onClick={pedirCerrar} disabled={ocupado} aria-label="Cerrar" title="Cerrar" style={{ border: "none", background: "transparent", fontSize: 22, lineHeight: 1, color: "var(--tc-gray-700)", cursor: ocupado ? "default" : "pointer", padding: 4 }}>
            ✕
          </button>
        </header>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 24px 18px" }}>
          <label style={etiqueta} htmlFor="ventana-flujo-hito">
            Título
          </label>
          <input
            id="ventana-flujo-hito"
            autoFocus
            value={hito}
            onChange={(e) => setHito(e.target.value)}
            maxLength={120}
            placeholder="Por ejemplo: Aprobar diseño arquitectónico Torre 1"
            aria-invalid={sinTitulo}
            style={{ ...campo, borderBottom: sinTitulo ? `2px solid ${ROJO}` : campo.border }}
          />
          {sinTitulo && <p style={{ ...ayuda, color: ROJO, fontSize: 13 }}>Se requiere este campo.</p>}

          <label style={{ ...etiqueta, marginTop: 14 }} htmlFor="ventana-flujo-descripcion">
            Descripción
          </label>
          <textarea
            id="ventana-flujo-descripcion"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Por ejemplo: entrega del diseñador arquitectónico, revisar contra la lista de chequeo del contrato"
            style={{ ...campo, resize: "vertical" }}
          />

          <label style={{ ...etiqueta, marginTop: 14 }} htmlFor="ventana-flujo-vence">
            Fecha de vencimiento <span style={{ color: "var(--tc-gray-500)", fontSize: 12.5 }}>(opcional)</span>
          </label>
          <div style={{ width: 210 }}>
            <DateField id="ventana-flujo-vence" text={venceTexto} placeholder="DD-MM-AAAA" invalid={venceMal} onText={setVenceTexto} />
          </div>
          {venceMal && <p style={{ ...ayuda, color: ROJO }}>Escribe la fecha como DD-MM-AAAA, por ejemplo 30-11-2026.</p>}

          <h3 style={seccion}>
            Archivos {archivos.length > 0 && <span style={{ fontWeight: 400, fontSize: 13.5, color: "var(--tc-gray-500)" }}>({archivos.length} marcados)</span>}
          </h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, maxHeight: 132, overflowY: "auto" }}>
            {archivos.length === 0 && <span style={{ fontSize: 13.5, color: "var(--tc-gray-500)" }}>Ninguno todavía.</span>}
            {archivos.map((a) => (
              <span key={a.id} style={chip} title={a.ruta}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.nombre}</span>
                <button type="button" style={linkBtn} onClick={() => setArchivos((as) => as.filter((x) => x.id !== a.id))} aria-label={`Quitar ${a.nombre}`} title="Quitar este archivo del flujo">
                  ✕
                </button>
              </span>
            ))}
          </div>
          <button type="button" style={{ ...botonSecundario, padding: "5px 12px", fontSize: 13.5 }} onClick={() => setExplorando(!explorando)}>
            {explorando ? "Cerrar el explorador" : "+ Agregar archivos"}
          </button>
          {explorando && (
            <div style={{ marginTop: 8 }}>
              <Explorador api={api} proyecto={projectId} elegir="archivo" seleccionados={archivos.map((a) => a.id)} onElegir={alternar} onElegirVarios={varios} />
              <p style={ayuda}>Abre cada carpeta y marca la casilla de cada archivo (otro clic lo quita). Puedes marcar varios, de distintas carpetas; hasta {MAX_ARCHIVOS} por flujo.</p>
            </div>
          )}
          <p style={ayuda}>Queda fija la versión que cada archivo tiene al guardar: si después suben una versión nueva, el flujo la avisa pero sigue con la suya.</p>
          {flujo?.destino && <p style={ayuda}>Este flujo se creó con carpeta destino («{flujo.destino.ruta}»): lo aprobado se sigue copiando ahí.</p>}

          <h3 style={seccion}>Agregar pasos</h3>
          <ol style={{ margin: "0 0 8px", paddingLeft: 22, display: "grid", gap: 8, fontSize: 14 }}>
            <li>
              <strong>Realiza</strong> <span style={{ color: "var(--tc-gray-500)" }}>— quien sube el archivo y lo corrige si lo rechazan (siempre es el primero).</span>
            </li>
            {pasos.map((p, i) => (
              <li key={p.id ?? `nuevo-${i}`}>
                <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <input value={p.nombre} onChange={(e) => cambiarPaso(i, { nombre: e.target.value })} maxLength={40} placeholder="Nombre del paso" aria-label={`Nombre del paso ${i + 2}`} style={{ ...baseInput, width: 150 }} />
                  <button type="button" style={flecha} onClick={() => moverPaso(i, -1)} disabled={i === 0} title="Subir">
                    ↑
                  </button>
                  <button type="button" style={flecha} onClick={() => moverPaso(i, 1)} disabled={i === pasos.length - 1} title="Bajar">
                    ↓
                  </button>
                  <button type="button" style={flecha} onClick={() => setPasos((ps) => ps.filter((_, j) => j !== i))} disabled={pasos.length <= MIN_PASOS} title="Quitar este paso">
                    − quitar
                  </button>
                  <select
                    value={p.responsable}
                    onChange={(e) => cambiarPaso(i, { responsable: e.target.value })}
                    aria-label={`Responsable del paso ${i + 2}`}
                    style={{ ...select, flex: "1 1 170px", minWidth: 170, borderColor: p.responsable ? undefined : "#e0a800" }}
                  >
                    {opciones(p)}
                  </select>
                </span>
                {i === pasos.length - 1 && <span style={{ display: "block", fontSize: 12.5, color: "var(--tc-gray-500)", marginTop: 3 }}>El responsable de este paso aprueba el archivo.</span>}
              </li>
            ))}
          </ol>
          <button type="button" style={{ ...botonSecundario, padding: "5px 12px", fontSize: 13.5 }} onClick={() => setPasos((ps) => [...ps, { nombre: "", responsable: "" }])} disabled={pasos.length >= MAX_PASOS}>
            + Adicionar paso
          </button>
          {pasos.length >= MAX_PASOS && <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)", marginLeft: 8 }}>Hasta {MAX_PASOS} pasos después de «Realiza».</span>}

          {error && (
            <Notice kind="error" style={{ marginTop: 14 }}>
              {error}
            </Notice>
          )}
        </div>

        <footer style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 24px", borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
          {confirmarCierre ? (
            <>
              <span style={{ fontSize: 14, color: "var(--tc-gray-700)", marginRight: "auto" }}>¿Cerrar sin guardar? Se pierde lo que escribiste.</span>
              <button type="button" onClick={() => setConfirmarCierre(false)} style={botonTexto}>
                Seguir editando
              </button>
              <button type="button" onClick={onCancelar} style={{ ...botonTexto, background: ROJO, color: "#fff", borderRadius: 3, fontWeight: 600 }}>
                Cerrar sin guardar
              </button>
            </>
          ) : (
            <>
              {problema && !sinTitulo && <span style={{ fontSize: 13, color: "var(--tc-gray-500)", marginRight: "auto", flex: "1 1 220px" }}>{problema}</span>}
              <button type="button" onClick={pedirCerrar} disabled={ocupado} style={botonTexto}>
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void guardar()}
                disabled={ocupado}
                title={problema ?? "Guardar el flujo y registrar sus archivos"}
                style={{ border: "none", background: AZUL, color: "#fff", borderRadius: 3, padding: "9px 22px", fontSize: 15, fontWeight: 600, cursor: ocupado ? "default" : "pointer", fontFamily: "inherit", opacity: problema || ocupado ? 0.5 : 1 }}
              >
                {ocupado ? "Guardando y registrando los archivos…" : "Guardar"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
