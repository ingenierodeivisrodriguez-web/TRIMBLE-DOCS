"use client";

import { useEffect, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import { formatBytes } from "../../lib/format";
import type { PublicarApi } from "../../lib/publicar/client";
import type { CopiaResponse, ProyectoInfo } from "../../lib/publicar/types";
import { acceptButton, C, labelStyle, message, Notice } from "../presupuesto/ui";
import { botonSecundario, card, linkBtn, select, td, texto, titulo } from "../compras/estilos";
import Explorador, { Elegido } from "./Explorador";

interface EnDestino {
  fileId: string;
  versionId: string;
  revision: number | null;
}

interface Fila {
  estado: "trabajando" | "copiado" | "al-dia" | "distinto" | "error";
  mensaje: string;
  /** What the destination has, when it differs (to replace it only if it hasn't changed since). */
  destino?: EnDestino;
  /** The copy in the destination, to ask for its viewer conversion. */
  copiaId?: string;
  visor?: string;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cadena = (v: unknown) => (typeof v === "string" ? v : "");

const MARCA: Record<Fila["estado"], { signo: string; color: string }> = {
  trabajando: { signo: "·", color: "var(--tc-gray-500)" },
  copiado: { signo: "✔", color: "#2e6b22" },
  "al-dia": { signo: "✔", color: "#2e6b22" },
  distinto: { signo: "!", color: "#9a6700" },
  error: { signo: "✖", color: "#b3261e" },
};

/**
 * Copies the latest version of the chosen files of this project to a folder
 * of another project, under the same name and without creating folders. A
 * file already there is left alone when it's the same and only replaced
 * (as a new version) when the person confirms it.
 */
export default function CopiaProyectos({ api, projectId, projectName }: { api: PublicarApi; projectId: string; projectName: string }) {
  const [archivos, setArchivos] = useState<Elegido[]>([]);
  const [proyectos, setProyectos] = useState<ProyectoInfo[] | null>(null);
  const [errorProyectos, setErrorProyectos] = useState("");
  const [destino, setDestino] = useState("");
  const [carpeta, setCarpeta] = useState<Elegido | null>(null);
  const [filas, setFilas] = useState<Record<string, Fila>>({});
  const [busy, setBusy] = useState(false);
  const [recarga, setRecarga] = useState(0);
  const [fin, setFin] = useState<string | null>(null);

  useEffect(() => {
    api
      .proyectos()
      .then((r) => setProyectos(r.proyectos))
      .catch((err) => setErrorProyectos(message(err)));
  }, [api]);

  const otros = (proyectos ?? []).filter((p) => !p.actual);
  const nombreDestino = otros.find((p) => p.id === destino)?.nombre ?? "";
  const listo = archivos.length > 0 && !!destino && !!carpeta && !busy;

  const poner = (id: string, f: Fila) => setFilas((fs) => ({ ...fs, [id]: { ...fs[id], ...f } }));
  const limpiar = () => {
    setFilas({});
    setFin(null);
  };

  function alternar(e: Elegido) {
    setArchivos((as) => (as.some((a) => a.id === e.id) ? as.filter((a) => a.id !== e.id) : [...as, e]));
    limpiar();
  }

  /** Waits for Trimble to confirm an upload in the destination (up to 3 minutes). */
  async function confirmar(uploadId: string): Promise<CopiaResponse | null> {
    for (let i = 0; i < 90; i++) {
      const r = await api.copia("estado-subida", { destino, uploadId });
      if (r.datos.status === "DONE" || !r.ok) return r;
      await esperar(2000);
    }
    return null;
  }

  async function verVisor(a: Elegido, copiaId: string) {
    let visor: string;
    try {
      visor = (await api.copia("estado-visor", { destino, fileId: copiaId })).mensaje;
    } catch (err) {
      visor = `No se pudo leer el estado del visor: ${message(err)}`;
    }
    setFilas((fs) => ({ ...fs, [a.id]: { ...fs[a.id], visor } }));
  }

  /** Copies one file; `siVersion` replaces what the destination has (confirmed by the person). */
  async function copiarUno(a: Elegido, siVersion?: string, sinModelo = false): Promise<void> {
    const base = { destino, carpetaId: carpeta!.id, fileId: a.id };
    try {
      if (!siVersion && !sinModelo) {
        poner(a.id, { estado: "trabajando", mensaje: "Comparando con la carpeta del destino…" });
        const r = await api.copia("revisar", base);
        if (!r.ok) return poner(a.id, { estado: "error", mensaje: r.mensaje });
        if (r.datos.situacion === "al-dia") return poner(a.id, { estado: "al-dia", mensaje: r.mensaje });
        if (r.datos.situacion === "distinto") {
          const d = r.datos.destino as EnDestino;
          return poner(a.id, { estado: "distinto", mensaje: r.mensaje, destino: d });
        }
      }
      poner(a.id, { estado: "trabajando", mensaje: "Copiando la última versión…" });
      const c = await api.copia("copiar", { ...base, ...(siVersion ? { siVersion } : {}), ...(sinModelo ? { sinModelo: "1" } : {}) });
      if (!c.ok) {
        if (c.datos.reintentarSinModelo && !sinModelo) return copiarUno(a, siVersion, true);
        return poner(a.id, { estado: "error", mensaje: c.mensaje });
      }
      let copiaId = cadena(c.datos.fileId);
      let mensaje = c.mensaje;
      if (c.datos.metodo === "servidor") {
        poner(a.id, { estado: "trabajando", mensaje: `${c.mensaje} Esperando la confirmación de Trimble…` });
        const e = await confirmar(cadena(c.datos.uploadId));
        if (e?.datos.status !== "DONE") return poner(a.id, { estado: "error", mensaje: `${c.mensaje} ${e?.mensaje ?? "Trimble no confirmó la carga en 3 minutos (puede seguir procesándola)."}` });
        copiaId = cadena(e.datos.fileId);
        mensaje = `${c.mensaje} ${e.mensaje}`;
      }
      poner(a.id, { estado: "copiado", mensaje, copiaId: copiaId || undefined });
      if (copiaId) await verVisor(a, copiaId);
    } catch (err) {
      poner(a.id, { estado: "error", mensaje: message(err) });
    }
  }

  async function copiarTodos() {
    if (!listo) return;
    setBusy(true);
    limpiar();
    try {
      for (const a of archivos) await copiarUno(a);
    } finally {
      setRecarga((n) => n + 1);
      setFin(fechaHora(new Date().toISOString()));
      setBusy(false);
    }
  }

  async function reemplazar(a: Elegido, d: EnDestino) {
    setBusy(true);
    try {
      await copiarUno(a, d.versionId);
    } finally {
      setRecarga((n) => n + 1);
      setBusy(false);
    }
  }

  const resumen = fin
    ? [
        `Copia a otro proyecto · ${fin}`,
        `Origen: ${projectName}`,
        `Destino: ${nombreDestino} · ${carpeta?.ruta ?? ""}`,
        ...archivos.map((a) => {
          const f = filas[a.id];
          return `${f ? MARCA[f.estado].signo : "·"} ${a.ruta}: ${f?.mensaje ?? "sin copiar"}${f?.visor ? ` ${f.visor}` : ""}`;
        }),
      ].join("\n")
    : "";

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 900 }}>
      <section style={card}>
        <h2 style={titulo}>Copiar a otro proyecto</h2>
        <p style={texto}>
          Copia la <strong>última versión</strong> de los archivos que elijas a una carpeta de otro proyecto donde también eres miembro, con el mismo nombre y sin crear
          carpetas. Si en esa carpeta ya hay un archivo con el mismo nombre: si es igual, queda como está; si es distinto, te lo muestra y solo lo reemplaza (como versión
          nueva) si lo confirmas.
        </p>
        <p style={texto}>
          Para que el visor del destino no tenga que convertir otra vez los modelos 3D, primero intenta que Trimble copie la versión por dentro; si no puede, el servidor pasa el
          archivo junto con el modelo ya convertido de este proyecto; si tampoco, pasa solo el archivo y Trimble lo convierte en el destino. Al final dice cómo va la conversión.
        </p>
        <p style={{ ...texto, fontSize: 13, color: "var(--tc-gray-500)", marginBottom: 0 }}>
          Por ahora la copia se hace a mano y no queda en la Actividad. La carpeta de recepción del destino, la publicación con actualización automática y la actividad vienen en
          las fases siguientes. No borra nada ni cambia este proyecto.
        </p>
      </section>

      <section style={card}>
        <h2 style={titulo}>1. Los archivos de este proyecto</h2>
        <Explorador api={api} proyecto={projectId} elegir="archivo" seleccionados={archivos.map((a) => a.id)} onElegir={alternar} />
        {archivos.length === 0 ? (
          <p style={{ ...texto, margin: "8px 0 0", color: "var(--tc-gray-500)" }}>Abre las carpetas y marca uno o varios archivos (pueden ser de carpetas distintas).</p>
        ) : (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>
              {archivos.length === 1 ? "1 archivo elegido" : `${archivos.length} archivos elegidos`}
              {" · "}
              <button
                type="button"
                style={linkBtn}
                disabled={busy}
                onClick={() => {
                  setArchivos([]);
                  limpiar();
                }}
              >
                quitar todos
              </button>
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6 }}>
              {archivos.map((a) => (
                <li key={a.id}>
                  {a.ruta}
                  <span style={{ color: "var(--tc-gray-500)" }}>
                    {a.revision !== null ? ` · versión ${a.revision}` : ""}
                    {a.tamano !== null ? ` · ${formatBytes(a.tamano)}` : ""}
                  </span>{" "}
                  <button type="button" style={linkBtn} disabled={busy} onClick={() => alternar(a)}>
                    quitar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section style={card}>
        <h2 style={titulo}>2. El proyecto destino</h2>
        {errorProyectos ? (
          <Notice kind="error">{errorProyectos}</Notice>
        ) : !proyectos ? (
          <p style={{ ...texto, color: "var(--tc-gray-500)" }}>Cargando tus proyectos…</p>
        ) : otros.length === 0 ? (
          <Notice kind="warning">No perteneces a otro proyecto de Trimble Connect: para copiar necesitas ser miembro de un segundo proyecto.</Notice>
        ) : (
          <>
            <label style={labelStyle} htmlFor="destino">
              Proyectos donde eres miembro
            </label>
            <select
              id="destino"
              value={destino}
              disabled={busy}
              onChange={(e) => {
                setDestino(e.target.value);
                setCarpeta(null);
                limpiar();
              }}
              style={{ ...select, minWidth: 320 }}
            >
              <option value="">Elige el proyecto destino…</option>
              {otros.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </>
        )}
      </section>

      {destino && (
        <section style={card}>
          <h2 style={titulo}>3. La carpeta del destino</h2>
          <p style={texto}>Abre la carpeta donde deben quedar los archivos y pulsa &quot;Usar esta carpeta&quot;. Necesitas permiso para subir archivos ahí.</p>
          <Explorador
            key={destino}
            api={api}
            proyecto={destino}
            elegir="carpeta"
            seleccionados={carpeta ? [carpeta.id] : []}
            recarga={recarga}
            onElegir={(e) => {
              setCarpeta(e);
              limpiar();
            }}
          />
          {carpeta && (
            <p style={{ ...texto, margin: "8px 0 0" }}>
              Carpeta elegida: <strong>{carpeta.ruta}</strong>
            </p>
          )}
        </section>
      )}

      <section style={card}>
        <button type="button" onClick={copiarTodos} disabled={!listo} style={{ ...acceptButton, opacity: listo ? 1 : 0.5, cursor: listo ? "pointer" : "not-allowed" }}>
          {busy ? "Copiando…" : archivos.length > 1 ? `Copiar ${archivos.length} archivos` : "Copiar"}
        </button>
        {!listo && !busy && <span style={{ marginLeft: 12, fontSize: 13, color: "var(--tc-gray-500)" }}>Elige los archivos, el proyecto destino y la carpeta.</span>}

        {Object.keys(filas).length > 0 && (
          <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 14 }}>
            <tbody>
              {archivos.map((a) => {
                const f = filas[a.id];
                if (!f) return null;
                return (
                  <tr key={a.id}>
                    <td style={{ ...td, width: 22, fontSize: 16, fontWeight: 700, color: MARCA[f.estado].color }}>{MARCA[f.estado].signo}</td>
                    <td style={{ ...td, fontWeight: 600, maxWidth: 240, wordBreak: "break-word" }}>{a.nombre}</td>
                    <td style={td}>
                      {f.mensaje}
                      {f.visor && <div style={{ marginTop: 4, color: "var(--tc-gray-500)" }}>{f.visor}</div>}
                      {f.estado === "distinto" && f.destino && (
                        <div style={{ marginTop: 6 }}>
                          <button type="button" disabled={busy} onClick={() => reemplazar(a, f.destino!)} style={{ ...botonSecundario, padding: "4px 10px", fontSize: 13 }}>
                            Subir la versión de este proyecto como versión nueva
                          </button>
                        </div>
                      )}
                      {f.estado === "copiado" && f.copiaId && (
                        <div style={{ marginTop: 4 }}>
                          <button type="button" style={linkBtn} disabled={busy} onClick={() => verVisor(a, f.copiaId!)}>
                            Revisar otra vez la conversión
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {fin && !busy && (
          <>
            <label style={{ ...labelStyle, marginTop: 12 }} htmlFor="resumen-copia">
              Para compartir el resultado, copia este texto:
            </label>
            <textarea
              id="resumen-copia"
              readOnly
              rows={Math.min(14, resumen.split("\n").length + 1)}
              value={resumen}
              onFocus={(e) => e.target.select()}
              style={{ width: "100%", boxSizing: "border-box", fontFamily: "monospace", fontSize: 12, border: `1px solid ${C.border}`, padding: 8 }}
            />
          </>
        )}
      </section>
    </div>
  );
}
