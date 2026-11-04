"use client";

import { useState } from "react";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import { revisarDatos } from "../../lib/flujo-aprobacion/flujos";
import { EstadoFlujos, Flujo, MAX_PASOS, MIN_PASOS } from "../../lib/flujo-aprobacion/types";
import { ApiError } from "../../lib/propiedades/client";
import { botonSecundario, card, linkBtn, subtitulo, texto, titulo } from "../compras/estilos";
import Explorador from "../publicar/Explorador";
import { acceptButton, baseInput, C, labelStyle, message, Notice } from "../presupuesto/ui";

interface Carpeta {
  id: string;
  ruta: string;
}

const chip = { display: "inline-flex", gap: 6, alignItems: "center", border: `1px solid ${C.border}`, borderRadius: 12, padding: "2px 10px", fontSize: 13, background: "#f6f8fb" } as const;
const flecha = { ...botonSecundario, padding: "2px 8px", fontSize: 13 } as const;

/**
 * Creating or changing a flow: its title or milestone, review folders,
 * destination folder and steps (+ adicionar, − quitar, renombrar). The same
 * checks as the server run before sending; a change that leaves assignments
 * without sense asks first.
 */
export default function EditorFlujo({
  api,
  projectId,
  flujo,
  onGuardado,
  onCancelar,
}: {
  api: FlujoApi;
  projectId: string;
  flujo: Flujo | null;
  onGuardado: (e: EstadoFlujos) => void;
  onCancelar: () => void;
}) {
  const [hito, setHito] = useState(flujo?.hito ?? "");
  const [carpetas, setCarpetas] = useState<Carpeta[]>(flujo?.carpetas.map((c) => ({ id: c.id, ruta: c.ruta })) ?? []);
  const [destino, setDestino] = useState<Carpeta | null>(flujo ? { id: flujo.destino.id, ruta: flujo.destino.ruta } : null);
  const [pasos, setPasos] = useState<{ id?: string; nombre: string }[]>(flujo?.pasos.map((p) => ({ ...p })) ?? [{ nombre: "Revisa" }, { nombre: "Aprueba" }]);
  const [explorando, setExplorando] = useState<"revision" | "destino" | null>(flujo ? null : "revision");
  const [error, setError] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const datos = { hito, carpetas: carpetas.map((c) => c.id), destino: destino?.id ?? "", pasos };
  const problema = revisarDatos(datos);

  function cambiarPaso(i: number, nombre: string) {
    setPasos((ps) => ps.map((p, j) => (j === i ? { ...p, nombre } : p)));
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

  async function guardar(conConfirmacion = false) {
    if (problema) {
      setError(problema);
      return;
    }
    setOcupado(true);
    setError("");
    try {
      const r = await api.guardarFlujo({ ...datos, ...(flujo ? { id: flujo.id, version: flujo.version } : {}), ...(conConfirmacion ? { confirmar: true } : {}) });
      setConfirmar("");
      onGuardado(r);
    } catch (err) {
      // ApiError over HTTP; the service's own error when called directly (same code).
      if ((err instanceof ApiError || err instanceof Error) && (err as { code?: string }).code === "confirmar-asignaciones") setConfirmar(err.message);
      else setError(message(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section style={{ ...card, maxWidth: 1000, borderColor: "var(--tc-blue-500)" }}>
      <h2 style={titulo}>{flujo ? `Editar «${flujo.hito}»` : "Nuevo flujo"}</h2>

      <label style={labelStyle} htmlFor="hito">
        Título o hito del flujo: el nombre que soportan sus archivos
      </label>
      <input id="hito" value={hito} onChange={(e) => setHito(e.target.value)} maxLength={120} placeholder="Por ejemplo: Aprobar diseño arquitectónico Torre 1" style={{ ...baseInput, width: "100%", fontSize: 15 }} />

      <h3 style={subtitulo}>Carpetas de revisión</h3>
      <p style={{ ...texto, margin: "0 0 6px", fontSize: 13.5 }}>Donde se suben los archivos que pasan por el flujo (con sus subcarpetas).</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        {carpetas.length === 0 && <span style={{ fontSize: 13.5, color: "var(--tc-gray-500)" }}>Ninguna todavía.</span>}
        {carpetas.map((c) => (
          <span key={c.id} style={chip}>
            {c.ruta}
            <button type="button" style={linkBtn} onClick={() => setCarpetas((cs) => cs.filter((x) => x.id !== c.id))} aria-label={`Quitar ${c.ruta}`} title="Quitar esta carpeta">
              ✕
            </button>
          </span>
        ))}
      </div>
      <button type="button" style={linkBtn} onClick={() => setExplorando(explorando === "revision" ? null : "revision")}>
        {explorando === "revision" ? "Cerrar el explorador" : "+ Agregar carpetas de revisión"}
      </button>
      {explorando === "revision" && (
        <div style={{ marginTop: 6 }}>
          <Explorador
            api={api}
            proyecto={projectId}
            elegir="carpeta"
            seleccionados={carpetas.map((c) => c.id)}
            onElegir={(e) => setCarpetas((cs) => (cs.some((x) => x.id === e.id) ? cs.filter((x) => x.id !== e.id) : [...cs, { id: e.id, ruta: e.ruta }]))}
          />
          <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: "4px 0 0" }}>Abre cada carpeta y pulsa «Usar esta carpeta»; púlsalo otra vez para quitarla.</p>
        </div>
      )}

      <h3 style={subtitulo}>Carpeta destino</h3>
      <p style={{ ...texto, margin: "0 0 6px", fontSize: 13.5 }}>
        Adonde se copia la última versión aprobada. No puede estar dentro de una carpeta de revisión (lo aprobado se volvería a revisar).
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {destino ? <span style={chip}>{destino.ruta}</span> : <span style={{ fontSize: 13.5, color: "var(--tc-gray-500)" }}>Sin elegir.</span>}
        <button type="button" style={linkBtn} onClick={() => setExplorando(explorando === "destino" ? null : "destino")}>
          {explorando === "destino" ? "Cerrar el explorador" : destino ? "Cambiar" : "Elegir la carpeta destino"}
        </button>
      </div>
      {explorando === "destino" && (
        <div style={{ marginTop: 6 }}>
          <Explorador
            api={api}
            proyecto={projectId}
            elegir="carpeta"
            seleccionados={destino ? [destino.id] : []}
            onElegir={(e) => {
              setDestino({ id: e.id, ruta: e.ruta });
              setExplorando(null);
            }}
          />
        </div>
      )}

      <h3 style={subtitulo}>Pasos</h3>
      <ol style={{ margin: "0 0 6px", paddingLeft: 22, display: "grid", gap: 6, fontSize: 14 }}>
        <li>
          <strong>Realiza</strong> <span style={{ color: "var(--tc-gray-500)" }}>— quien sube el archivo y lo corrige si lo rechazan (siempre es el primero).</span>
        </li>
        {pasos.map((p, i) => (
          <li key={p.id ?? `nuevo-${i}`}>
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input value={p.nombre} onChange={(e) => cambiarPaso(i, e.target.value)} maxLength={40} aria-label={`Nombre del paso ${i + 2}`} style={{ ...baseInput, width: 220 }} />
              <button type="button" style={flecha} onClick={() => moverPaso(i, -1)} disabled={i === 0} title="Subir">
                ↑
              </button>
              <button type="button" style={flecha} onClick={() => moverPaso(i, 1)} disabled={i === pasos.length - 1} title="Bajar">
                ↓
              </button>
              <button type="button" style={flecha} onClick={() => setPasos((ps) => ps.filter((_, j) => j !== i))} disabled={pasos.length <= MIN_PASOS} title="Quitar este paso">
                − quitar
              </button>
              {i === pasos.length - 1 && <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>Al aprobar este paso, el archivo pasa a la carpeta destino.</span>}
            </span>
          </li>
        ))}
      </ol>
      <button type="button" style={{ ...botonSecundario, padding: "4px 12px", fontSize: 13.5 }} onClick={() => setPasos((ps) => [...ps, { nombre: "" }])} disabled={pasos.length >= MAX_PASOS}>
        + Adicionar paso
      </button>
      {pasos.length >= MAX_PASOS && <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)", marginLeft: 8 }}>Hasta {MAX_PASOS} pasos después de «Realiza».</span>}

      {error && (
        <Notice kind="error" style={{ marginTop: 12 }}>
          {error}
        </Notice>
      )}
      {confirmar && (
        <Notice kind="warning" style={{ marginTop: 12 }}>
          {confirmar}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" onClick={() => guardar(true)} disabled={ocupado} style={{ ...acceptButton, padding: "6px 14px", fontSize: 14 }}>
              Guardar y desactivarlas
            </button>
            <button type="button" onClick={() => setConfirmar("")} style={{ ...botonSecundario, padding: "6px 14px", fontSize: 14 }}>
              Seguir editando
            </button>
          </div>
        </Notice>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={() => guardar()} disabled={ocupado} style={{ ...acceptButton, opacity: ocupado ? 0.6 : 1 }} title={problema ?? "Guardar el flujo"}>
          {ocupado ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" onClick={onCancelar} style={botonSecundario}>
          Cancelar
        </button>
        {problema && <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>{problema}</span>}
      </div>
    </section>
  );
}
