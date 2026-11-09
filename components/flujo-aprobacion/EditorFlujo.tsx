"use client";

import { useState } from "react";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import { claveHito, nombreDeRuta, revisarDatos } from "../../lib/flujo-aprobacion/flujos";
import { Equipo, EstadoFlujos, Flujo, MAX_ARCHIVOS, MAX_PASOS, MIN_PASOS } from "../../lib/flujo-aprobacion/types";
import { botonSecundario, card, linkBtn, select, subtitulo, texto, titulo } from "../compras/estilos";
import Explorador, { Elegido } from "../publicar/Explorador";
import { acceptButton, baseInput, C, labelStyle, message, Notice } from "../presupuesto/ui";

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

const chip = { display: "inline-flex", gap: 6, alignItems: "center", border: `1px solid ${C.border}`, borderRadius: 12, padding: "2px 10px", fontSize: 13, background: "#f6f8fb", maxWidth: "100%" } as const;
const flecha = { ...botonSecundario, padding: "2px 8px", fontSize: 13 } as const;

/**
 * Creating or changing a flow: its title or milestone, the files that go
 * through it (several at once, from any folder, with their checkboxes) and
 * its steps (+ adicionar, − quitar, renombrar), each with its responsible
 * from Trimble's team. No destination folder: the approver will decide. The
 * same checks as the server run before sending.
 */
export default function EditorFlujo({
  api,
  projectId,
  flujo,
  equipo,
  onGuardado,
  onCancelar,
  enPanel = false,
}: {
  api: FlujoApi;
  projectId: string;
  flujo: Flujo | null;
  /** Trimble's people and groups (null while loading). */
  equipo: Equipo | null;
  onGuardado: (e: EstadoFlujos, id: string | null) => void;
  onCancelar: () => void;
  /** Inside the side panel: no card around it. */
  enPanel?: boolean;
}) {
  const [hito, setHito] = useState(flujo?.hito ?? "");
  const [vence, setVence] = useState(flujo?.vence ?? "");
  const [notas, setNotas] = useState(flujo?.notas ?? "");
  const [archivos, setArchivos] = useState<ArchivoElegido[]>(flujo?.archivos.map((a) => ({ id: a.id, nombre: nombreDeRuta(a.ruta), ruta: a.ruta })) ?? []);
  const [pasos, setPasos] = useState<PasoForm[]>(
    flujo?.pasos.map((p) => ({ id: p.id, nombre: p.nombre, responsable: p.responsable ? `${p.responsable.tipo}:${p.responsable.id}` : "", nombreResponsable: p.responsable?.nombre })) ?? [
      { nombre: "Revisa", responsable: "" },
      { nombre: "Aprueba", responsable: "" },
    ]
  );
  const [explorando, setExplorando] = useState(!flujo);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const envio = pasos.map((p) => {
    const [tipo, id] = p.responsable.split(":");
    return { ...(p.id ? { id: p.id } : {}), nombre: p.nombre, responsable: id ? { tipo: tipo as "persona" | "grupo", id } : null };
  });
  const datos = { hito, archivos: archivos.map((a) => a.id), pasos: envio, vence, notas };
  const problema = revisarDatos(datos);

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

  return (
    <section style={enPanel ? { padding: 0 } : { ...card, maxWidth: 1000, borderColor: "var(--tc-blue-500)" }}>
      <h2 style={titulo}>{flujo ? `Editar «${flujo.hito}»` : "Nuevo flujo"}</h2>

      <label style={labelStyle} htmlFor="hito">
        Título o hito del flujo: el nombre que soportan sus archivos
      </label>
      <input id="hito" value={hito} onChange={(e) => setHito(e.target.value)} maxLength={120} placeholder="Por ejemplo: Aprobar diseño arquitectónico Torre 1" style={{ ...baseInput, width: "100%", fontSize: 15 }} />

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
        <label>
          <span style={labelStyle}>Fecha de vencimiento (opcional)</span>
          <input type="date" value={vence} onChange={(e) => setVence(e.target.value)} style={baseInput} />
        </label>
        {vence && (
          <button type="button" style={{ ...linkBtn, alignSelf: "end", marginBottom: 6 }} onClick={() => setVence("")}>
            Quitar la fecha
          </button>
        )}
      </div>
      <label style={{ display: "block", marginTop: 10 }}>
        <span style={labelStyle}>Notas</span>
        <textarea value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={2000} rows={3} placeholder="Por ejemplo: entrega del diseñador arquitectónico, revisar contra la lista de chequeo del contrato" style={{ ...baseInput, width: "100%", resize: "vertical" }} />
      </label>

      <h3 style={subtitulo}>Archivos del flujo {archivos.length > 0 && <span style={{ fontWeight: 400, fontSize: 13.5, color: "var(--tc-gray-500)" }}>({archivos.length} marcados)</span>}</h3>
      <p style={{ ...texto, margin: "0 0 6px", fontSize: 13.5 }}>
        Marca los archivos que pasan por este flujo: puedes marcar varios, de distintas carpetas. Sus versiones nuevas entran solas a revisión; un archivo nuevo se agrega editando el flujo.
      </p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6, maxHeight: 132, overflowY: "auto" }}>
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
      <button type="button" style={linkBtn} onClick={() => setExplorando(!explorando)}>
        {explorando ? "Cerrar el explorador" : "+ Agregar archivos"}
      </button>
      {explorando && (
        <div style={{ marginTop: 6 }}>
          <Explorador api={api} proyecto={projectId} elegir="archivo" seleccionados={archivos.map((a) => a.id)} onElegir={alternar} onElegirVarios={varios} />
          <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: "4px 0 0" }}>
            Abre cada carpeta y marca la casilla de cada archivo (otro clic lo quita). Hasta {MAX_ARCHIVOS} archivos por flujo.
          </p>
        </div>
      )}
      {flujo?.destino && (
        <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: "8px 0 0" }}>
          Este flujo se creó con carpeta destino («{flujo.destino.ruta}»): lo aprobado se sigue copiando ahí.
        </p>
      )}

      <h3 style={subtitulo}>Pasos y responsables</h3>
      <ol style={{ margin: "0 0 6px", paddingLeft: 22, display: "grid", gap: 8, fontSize: 14 }}>
        <li>
          <strong>Realiza</strong> <span style={{ color: "var(--tc-gray-500)" }}>— quien sube el archivo y lo corrige si lo rechazan (siempre es el primero).</span>
        </li>
        {pasos.map((p, i) => (
          <li key={p.id ?? `nuevo-${i}`}>
            <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input value={p.nombre} onChange={(e) => cambiarPaso(i, { nombre: e.target.value })} maxLength={40} aria-label={`Nombre del paso ${i + 2}`} style={{ ...baseInput, width: 150 }} />
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
      <button type="button" style={{ ...botonSecundario, padding: "4px 12px", fontSize: 13.5 }} onClick={() => setPasos((ps) => [...ps, { nombre: "", responsable: "" }])} disabled={pasos.length >= MAX_PASOS}>
        + Adicionar paso
      </button>
      {pasos.length >= MAX_PASOS && <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)", marginLeft: 8 }}>Hasta {MAX_PASOS} pasos después de «Realiza».</span>}

      {error && (
        <Notice kind="error" style={{ marginTop: 12 }}>
          {error}
        </Notice>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={() => void guardar()} disabled={ocupado} style={{ ...acceptButton, opacity: ocupado ? 0.6 : 1 }} title={problema ?? "Guardar el flujo y registrar sus archivos"}>
          {ocupado ? "Guardando y registrando los archivos…" : "Guardar"}
        </button>
        <button type="button" onClick={onCancelar} style={botonSecundario}>
          Cancelar
        </button>
        {problema && <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>{problema}</span>}
      </div>
    </section>
  );
}
