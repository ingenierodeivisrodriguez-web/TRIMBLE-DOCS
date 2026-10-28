"use client";

import { CSSProperties, useCallback, useEffect, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import { descargar } from "../../lib/presupuesto/excel";
import { coordenadasIfc } from "../../lib/ra/anclaje";
import type { RaApi } from "../../lib/ra/client";
import { TEXTO_ESTADO_QR } from "../../lib/ra/codigo";
import { hojaPdf, nombreHoja } from "../../lib/ra/hoja";
import { tamanoLegible } from "../../lib/ra/limites";
import type { EstadoResponse, ModeloVista, PuntoVista } from "../../lib/ra/types";

const AZUL = "#2f55b0";
const dia = (ts: string | null) => (ts ? fechaHora(ts).slice(0, 10) : "—");
const miles = (n: number) => n.toLocaleString("en-US");
const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

const MOTIVO: Record<string, string> = {
  vencido: "se venció sin usarse",
  manual: "eliminado a mano",
  "subida-incompleta": "la subida no terminó",
};

/**
 * Project menu: the models prepared for the phone, when each one goes away
 * by itself, and (administrators) after how many unused days that happens.
 * Preparing a model is done from the 3D viewer's panel.
 */
export default function RaApp({ api, projectName }: { api: RaApi; projectName: string }) {
  const [estado, setEstado] = useState<EstadoResponse | null>(null);
  const [error, setError] = useState("");
  const [dias, setDias] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [verHistorial, setVerHistorial] = useState(false);
  const [anular, setAnular] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError("");
    try {
      const e = await api.getEstado();
      setEstado(e);
      setDias(String(e.config.diasSinUso));
    } catch (err) {
      setError(mensaje(err));
    }
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardarDias() {
    const n = Number(dias);
    if (!Number.isInteger(n) || n < 1 || n > 365) return setError("Escriba un número de días entre 1 y 365.");
    setGuardando(true);
    setError("");
    try {
      await api.guardarConfig(n);
      setAviso(`Guardado: los modelos se eliminan a los ${n} días sin uso (también los ya preparados).`);
      await cargar();
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(m: ModeloVista) {
    setConfirmar(null);
    setError("");
    try {
      await api.eliminar(m.id);
      setAviso(`Se eliminó el archivo de «${m.nombre}». El registro queda en el historial.`);
      await cargar();
    } catch (err) {
      setError(mensaje(err));
    }
  }

  async function anularQr(p: PuntoVista) {
    setAnular(null);
    setError("");
    try {
      await api.anularPunto(p.id);
      setAviso(`Se anuló el QR «${p.nombre}»: ya no abre el modelo. Si ya está pegado en obra, retírelo.`);
      await cargar();
    } catch (err) {
      setError(mensaje(err));
    }
  }

  async function hoja(p: PuntoVista) {
    const m = estado?.modelos.find((x) => x.id === p.modeloId);
    if (!m) return;
    try {
      const blob = await hojaPdf({
        nombre: p.nombre,
        referencia: p.referencia,
        url: p.url,
        codigo: p.codigo,
        vence: dia(p.vence),
        proyecto: projectName,
        modelo: m.nombre,
        elemento: p.elemento,
        coordenadas: coordenadasIfc(p.punto, m.origen),
      });
      descargar(blob, nombreHoja(p));
    } catch (err) {
      setError(`No se pudo generar la hoja: ${mensaje(err)}`);
    }
  }

  const activos = estado?.modelos.filter((m) => m.estado !== "eliminado") ?? [];
  const historial = estado?.modelos.filter((m) => m.estado === "eliminado") ?? [];

  return (
    <main style={{ padding: 16, maxWidth: 1100, fontSize: 14, color: "#1f2937", lineHeight: 1.45 }}>
      <h1 style={{ fontSize: 20, margin: "0 0 4px", color: AZUL }}>Realidad aumentada</h1>
      <p style={{ margin: "0 0 12px", color: "#4b5563" }}>
        Modelos de {projectName || "este proyecto"} preparados para verlos desde el celular a escala real. Para preparar uno, abra el modelo IFC en el visor 3D y use el
        panel <b>«Realidad aumentada»</b> de las extensiones.
      </p>

      {error && <div style={{ ...caja, borderColor: "#b3261e", background: "#fdecea", color: "#7f1d1d" }}>{error}</div>}
      {aviso && <div style={{ ...caja, borderColor: "#2e6b22", background: "#e7f4e4" }}>{aviso}</div>}
      {estado && !estado.almacenamiento && <div style={{ ...caja, borderColor: "#d4b106", background: "#fff8db" }}>El almacenamiento de archivos no está conectado: los modelos no se pueden guardar.</div>}

      {estado && (
        <section style={caja}>
          <h2 style={subtitulo}>Eliminación automática</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span>Los modelos que no se usen en</span>
            <input
              type="number"
              min={1}
              max={365}
              value={dias}
              disabled={!estado.esAdmin || guardando}
              onChange={(e) => setDias(e.target.value)}
              style={{ width: 70, padding: "4px 6px", border: "1px solid #cbd2da", borderRadius: 4 }}
            />
            <span>días se eliminan solos del almacenamiento.</span>
            {estado.esAdmin && (
              <button style={boton} disabled={guardando || dias === String(estado.config.diasSinUso)} onClick={guardarDias}>
                Guardar
              </button>
            )}
          </div>
          <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 13 }}>
            {estado.esAdmin ? "Cada vez que alguien abre un modelo en el celular, el plazo vuelve a empezar." : "Solo un administrador del proyecto cambia este plazo."}
            {estado.config.actualizadoPor && ` Último cambio: ${estado.config.actualizadoPor}, ${estado.config.actualizado ? dia(estado.config.actualizado) : ""}.`}
          </p>
        </section>
      )}

      {estado && (
        <section style={caja}>
          <h2 style={subtitulo}>Modelos preparados ({activos.length})</h2>
          {activos.length === 0 ? (
            <p style={{ margin: 0 }}>Todavía no hay modelos. Prepárelos desde el panel del visor 3D.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13.5 }}>
                <thead>
                  <tr>
                    {["Nombre", "Archivos IFC", "Elementos", "Triángulos", "Tamaño", "Preparado", "Último uso", "Se elimina el", ""].map((t) => (
                      <th key={t} style={th}>
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activos.map((m) => (
                    <tr key={m.id}>
                      <td style={td}>
                        <b>{m.nombre}</b>
                        {m.estado === "subiendo" && <div style={{ color: "#8a5a00" }}>Subida sin terminar</div>}
                      </td>
                      <td style={td}>{m.archivos.map((a) => a.nombre).join(", ")}</td>
                      <td style={tdNum}>{miles(m.elementos)}</td>
                      <td style={tdNum}>{miles(m.triangulos)}</td>
                      <td style={tdNum}>{tamanoLegible(m.bytes)}</td>
                      <td style={td}>
                        {dia(m.creado)}
                        <div style={{ color: "#6b7280" }}>{m.creadoPor}</div>
                      </td>
                      <td style={td}>{dia(m.ultimoUso)}</td>
                      <td style={td}>{dia(m.eliminaEn)}</td>
                      <td style={td}>
                        {m.puedeEliminar &&
                          (confirmar === m.id ? (
                            <span style={{ whiteSpace: "nowrap" }}>
                              ¿Eliminar?{" "}
                              <button style={{ ...botonChico, background: "#b3261e", color: "#fff", borderColor: "#b3261e" }} onClick={() => eliminar(m)}>
                                Sí
                              </button>{" "}
                              <button style={botonChico} onClick={() => setConfirmar(null)}>
                                No
                              </button>
                            </span>
                          ) : (
                            <button style={botonChico} onClick={() => setConfirmar(m.id)} title="Borra el archivo del almacenamiento ahora; el registro queda en el historial">
                              Eliminar
                            </button>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {estado && (
        <section style={caja}>
          <h2 style={subtitulo}>Puntos QR ({estado.puntos.length})</h2>
          {estado.puntos.length === 0 ? (
            <p style={{ margin: 0 }}>Todavía no hay QR. Se crean en el panel del visor 3D, pestaña «Punto QR».</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13.5 }}>
                <thead>
                  <tr>
                    {["Punto", "Modelo", "Dónde se pega", "Abre hasta", "Estado", "Escaneos", "Creado", ""].map((t) => (
                      <th key={t} style={th}>
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {estado.puntos.map((p) => (
                    <tr key={p.id} style={{ color: p.estado === "activo" ? undefined : "#6b7280" }}>
                      <td style={td}>
                        <b>{p.nombre}</b>
                        {p.elemento && <div style={{ color: "#6b7280" }}>sobre {p.elemento}</div>}
                      </td>
                      <td style={td}>{p.modeloNombre || "—"}</td>
                      <td style={td}>
                        {p.referencia}
                        {p.montaje === "piso" && <div style={{ color: "#8a5a00" }}>QR de prueba con la hoja en el piso: anúlelo y créelo de nuevo en un muro.</div>}
                      </td>
                      <td style={td}>{dia(p.vence)}</td>
                      <td style={td}>
                        <span style={{ fontWeight: 600, color: p.estado === "activo" ? "#2e6b22" : "#b3261e" }}>{TEXTO_ESTADO_QR[p.estado]}</span>
                        {p.anulado && <div>{`el ${dia(p.anulado)}${p.anuladoPor ? ` por ${p.anuladoPor}` : ""}`}</div>}
                      </td>
                      <td style={tdNum}>
                        {p.usos}
                        {p.ultimoUso && <div style={{ color: "#6b7280" }}>último {dia(p.ultimoUso)}</div>}
                      </td>
                      <td style={td}>
                        {dia(p.creado)}
                        <div style={{ color: "#6b7280" }}>{p.creadoPor}</div>
                      </td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {p.estado === "activo" && p.montaje === "muro" && (
                          <button style={botonChico} onClick={() => hoja(p)} title="La hoja para imprimir y pegar en obra">
                            Hoja PDF
                          </button>
                        )}{" "}
                        {p.puedeAnular &&
                          (anular === p.id ? (
                            <span>
                              ¿Anular?{" "}
                              <button style={{ ...botonChico, background: "#b3261e", color: "#fff", borderColor: "#b3261e" }} onClick={() => anularQr(p)}>
                                Sí
                              </button>{" "}
                              <button style={botonChico} onClick={() => setAnular(null)}>
                                No
                              </button>
                            </span>
                          ) : (
                            <button style={botonChico} onClick={() => setAnular(p.id)} title="El QR deja de abrir el modelo para siempre">
                              Anular
                            </button>
                          ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {historial.length > 0 && (
        <section style={caja}>
          <button style={{ border: "none", background: "none", color: AZUL, cursor: "pointer", padding: 0, fontWeight: 600 }} onClick={() => setVerHistorial(!verHistorial)}>
            {verHistorial ? "▾" : "▸"} Historial de modelos eliminados ({historial.length})
          </button>
          {verHistorial && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {historial.map((m) => (
                <li key={m.id}>
                  <b>{m.nombre}</b> — preparado el {dia(m.creado)} por {m.creadoPor ?? "—"}; eliminado el {dia(m.eliminado)} ({MOTIVO[m.motivoEliminacion ?? ""] ?? "—"}
                  {m.eliminadoPor ? `, por ${m.eliminadoPor}` : ""}).
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

const caja: CSSProperties = { border: "1px solid #dfe4ea", borderRadius: 8, padding: 12, marginBottom: 12, background: "#fff" };
const subtitulo: CSSProperties = { fontSize: 15, margin: "0 0 8px" };
const boton: CSSProperties = { padding: "5px 12px", background: AZUL, color: "#fff", border: "none", borderRadius: 5, fontWeight: 600, cursor: "pointer" };
const botonChico: CSSProperties = { padding: "3px 9px", background: "#fff", color: "#1f2937", border: "1px solid #cbd2da", borderRadius: 4, cursor: "pointer" };
const th: CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: "2px solid #dfe4ea", whiteSpace: "nowrap", fontWeight: 600 };
const td: CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #eef1f5", verticalAlign: "top" };
const tdNum: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };
