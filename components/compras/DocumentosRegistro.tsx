"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { tiene } from "../../lib/compras/accesos";
import type { ComprasApi } from "../../lib/compras/client";
import { CARPETA_DE, ESTADOS_DOCUMENTO, MAX_RELEVO, MAX_TAMANO, MODULO_DE, rutaCarpeta, sugerirVence, tiposDe, vigencia } from "../../lib/compras/documentos";
import { fecha, fechaHora } from "../../lib/compras/formato";
import { abrirEnPestana, reintentarSubida, subirDocumento } from "../../lib/compras/subida";
import type { Documento, DocumentosResponse, EntidadDocumento, Permiso, SyncEntrada } from "../../lib/compras/types";
import { isoToDisplay, parseDisplayDate } from "../../lib/propiedades/values";
import { acceptButton, C, labelStyle, message, Notice } from "../presupuesto/ui";
import DateField from "../propiedades/DateField";
import { botonSecundario, etiqueta, linkBtn, select, td, th } from "./estilos";

const MB = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB`);

/** Asks the person for a file (for a retry with no copy in this browser). */
export function elegirArchivo(): Promise<Blob | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * The documents of one record in the project's CDE: upload (with
 * confirmation of where it goes), state until Trimble confirms, retry, open
 * and cancel. A generated PDF can be saved too.
 */
export default function DocumentosRegistro({
  api,
  entidadTipo,
  entidadId,
  permisos,
  generar,
  alCambiar,
}: {
  api: ComprasApi;
  entidadTipo: EntidadDocumento;
  entidadId: string;
  permisos: Permiso[];
  /** A document the app builds (the PDF of an order): what to call the button and how to make the file. */
  generar?: { etiqueta: string; tipoDoc: string; crear: () => Promise<{ archivo: Blob; nombre: string }> };
  /** After each load (to refresh what depends on these documents). */
  alCambiar?: (datos: DocumentosResponse) => void;
}) {
  const [datos, setDatos] = useState<DocumentosResponse | null>(null);
  const [error, setError] = useState("");
  const [tipoDoc, setTipoDoc] = useState("");
  const [venceTexto, setVenceTexto] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [avance, setAvance] = useState("");
  const [busy, setBusy] = useState(false);
  const [historial, setHistorial] = useState<{ id: string; filas: SyncEntrada[] } | null>(null);
  const [anular, setAnular] = useState<{ id: string; motivo: string } | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const avisar = useRef(alCambiar);
  avisar.current = alCambiar;
  const modulo = MODULO_DE[entidadTipo];
  const puede = tiene(permisos, modulo, "documentos");

  const cargar = useCallback(async () => {
    try {
      const d = await api.getDocumentos({ entidadTipo, entidadId });
      setDatos(d);
      avisar.current?.(d);
    } catch (err) {
      setError(message(err));
    }
  }, [api, entidadTipo, entidadId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (!datos) return error ? <Notice kind="error">{error}</Notice> : <p style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>Cargando documentos…</p>;

  const tipos = tiposDe(entidadTipo, datos.tipos);
  const tipo = tipos.find((t) => t.clave === tipoDoc);
  const legal = entidadTipo === "proveedor" ? datos.tipos.find((t) => t.clave === tipoDoc) : undefined;
  const preparadas = datos.carpetas.some((c) => c.clave === CARPETA_DE[entidadTipo]);
  const venceIso = venceTexto.trim() ? parseDisplayDate(venceTexto) : null;
  const problema = !tipo ? "Elige el tipo de documento." : !archivo ? "Elige el archivo." : archivo.size > MAX_TAMANO ? `El archivo pesa ${MB(archivo.size)}; el máximo es ${MB(MAX_TAMANO)}.` : venceTexto.trim() && !venceIso ? "Escribe el vencimiento como DD-MM-AAAA." : "";
  const destino = entidadTipo === "proveedor" ? `${rutaCarpeta(CARPETA_DE[entidadTipo])} / (carpeta del proveedor)` : rutaCarpeta(CARPETA_DE[entidadTipo]);

  async function ejecutar(trabajo: () => Promise<Documento | void>) {
    setBusy(true);
    setError("");
    try {
      const d = await trabajo();
      if (d && d.estado === "pendiente") setError("Trimble aún no confirma la carga: queda pendiente y se puede reintentar desde aquí o desde la pestaña Documentos (CDE).");
      if (d && d.estado === "error") setError(`No se pudo respaldar: ${d.ultimoError}`);
    } catch (err) {
      setError(message(err));
    } finally {
      setAvance("");
      setBusy(false);
      await cargar();
    }
  }

  const cargarArchivo = () =>
    ejecutar(async () => {
      const d = await subirDocumento(api, { entidadTipo, entidadId, tipoDoc, nombreOriginal: archivo!.name, origen: "cargado", vence: venceIso }, archivo!, setAvance);
      setArchivo(null);
      setTipoDoc("");
      setVenceTexto("");
      if (entrada.current) entrada.current.value = "";
      return d;
    });

  const vigentes = datos.documentos.filter((d) => d.estado !== "anulado");
  const anulados = datos.documentos.length - vigentes.length;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {!preparadas && <Notice kind="warning">Las carpetas de Compras en el CDE no están preparadas: un administrador debe prepararlas en la pestaña Documentos (CDE).</Notice>}
      {vigentes.length > 0 ? (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Documento</th>
              <th style={th}>Estado</th>
              {entidadTipo === "proveedor" && <th style={th}>Vence</th>}
              <th style={th}>Cargado</th>
              <th style={th} aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {vigentes.map((d) => {
              const e = ESTADOS_DOCUMENTO[d.estado];
              const v = vigencia(d.vence, datos.hoy);
              return (
                <tr key={d.id}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>{d.titulo}</div>
                    <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }} title={`${d.ruta} / ${d.nombreArchivo}`}>
                      {d.nombreArchivo}
                    </div>
                    {d.ultimoError && d.estado !== "respaldado" && <div style={{ fontSize: 12, color: "#b3261e" }}>{d.ultimoError}</div>}
                  </td>
                  <td style={td}>
                    <span style={etiqueta(e.color, e.fondo)}>{e.texto}</span>
                    {d.revision ? <div style={{ fontSize: 11.5, color: "var(--tc-gray-500)" }}>revisión {d.revision} en Trimble</div> : null}
                  </td>
                  {entidadTipo === "proveedor" && (
                    <td style={{ ...td, whiteSpace: "nowrap", color: v === "vencido" ? "#b3261e" : v === "por-vencer" ? "#a35200" : undefined }}>{d.vence ? fecha(d.vence) : "—"}</td>
                  )}
                  <td style={{ ...td, fontSize: 12.5 }}>
                    {fechaHora(d.creado)}
                    <div style={{ color: "var(--tc-gray-500)" }}>{d.subidoPor}</div>
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                    {puede && d.estado === "respaldado" && (
                      <button type="button" style={accion} disabled={busy} onClick={() => abrirEnPestana(api, d.id).catch((err) => setError(message(err)))}>
                        Abrir
                      </button>
                    )}
                    {puede && (d.estado === "pendiente" || d.estado === "error") && (
                      <button
                        type="button"
                        style={accion}
                        disabled={busy}
                        onClick={() =>
                          ejecutar(() =>
                            reintentarSubida(api, d, generar && d.origen === "generado" ? async () => (await generar.crear()).archivo : elegirArchivo, setAvance)
                          )
                        }
                      >
                        Reintentar
                      </button>
                    )}
                    <button
                      type="button"
                      style={accion}
                      onClick={async () => setHistorial(historial?.id === d.id ? null : { id: d.id, filas: await api.historialDocumento(d.id) })}
                    >
                      Historial
                    </button>
                    {puede && (
                      <button type="button" style={{ ...accion, color: C.close }} disabled={busy} onClick={() => setAnular({ id: d.id, motivo: "" })}>
                        Anular
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p style={{ fontSize: 13, color: "var(--tc-gray-500)", margin: 0 }}>Sin documentos.{anulados ? ` (${anulados} anulado(s))` : ""}</p>
      )}

      {historial && (
        <div style={{ background: "#f7f9fc", border: `1px solid ${C.border}`, padding: 8, fontSize: 12.5 }}>
          {historial.filas.length === 0 ? "Sin movimientos." : historial.filas.map((h, i) => <div key={i}>{`${fechaHora(h.creado)} · ${h.por} · ${h.accion}: ${h.resultado === "ok" ? "✔" : "✖"} ${h.detalle}`}</div>)}
        </div>
      )}

      {anular && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            autoFocus
            placeholder="Motivo de la anulación (el archivo sigue en Trimble)"
            value={anular.motivo}
            onChange={(e) => setAnular({ ...anular, motivo: e.target.value })}
            style={{ ...select, flex: 1 }}
            aria-label="Motivo de la anulación"
          />
          <button type="button" style={botonSecundario} onClick={() => setAnular(null)}>
            Cancelar
          </button>
          <button
            type="button"
            style={{ ...acceptButton, background: C.close, opacity: anular.motivo.trim() ? 1 : 0.5 }}
            disabled={!anular.motivo.trim() || busy}
            onClick={() =>
              ejecutar(async () => {
                await api.anularDocumento(anular.id, anular.motivo.trim());
                setAnular(null);
              })
            }
          >
            Anular
          </button>
        </div>
      )}

      {puede && preparadas && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", borderTop: `1px solid ${C.grid}`, paddingTop: 8 }}>
          <div>
            <span style={labelStyle}>Tipo</span>
            <select
              value={tipoDoc}
              onChange={(e) => {
                setTipoDoc(e.target.value);
                const t = datos.tipos.find((x) => x.clave === e.target.value);
                if (entidadTipo === "proveedor" && t) setVenceTexto(sugerirVence(t, datos.hoy) ? isoToDisplay(sugerirVence(t, datos.hoy)!) : "");
              }}
              style={select}
              aria-label="Tipo de documento"
            >
              <option value="">Elige…</option>
              {tipos.map((t) => (
                <option key={t.clave} value={t.clave}>
                  {t.nombre}
                </option>
              ))}
            </select>
          </div>
          {entidadTipo === "proveedor" && (
            <div style={{ width: 170 }}>
              <span style={labelStyle} title={legal?.vigenciaDias ? `Sugerido: ${legal.vigenciaDias} días desde hoy` : "Vacío: no vence"}>
                Vence
              </span>
              <DateField id={`vence-${entidadId}`} text={venceTexto} placeholder="DD-MM-AAAA" invalid={!!venceTexto.trim() && !venceIso} onText={setVenceTexto} />
            </div>
          )}
          <div>
            <input ref={entrada} type="file" style={{ display: "none" }} onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} aria-label="Archivo" />
            <button type="button" style={botonSecundario} onClick={() => entrada.current?.click()} disabled={busy}>
              {archivo ? `${archivo.name} (${MB(archivo.size)})` : "Elegir archivo"}
            </button>
          </div>
          <button type="button" style={{ ...acceptButton, opacity: problema ? 0.5 : 1 }} disabled={!!problema || busy} onClick={cargarArchivo} title={problema || `Se guardará en "${destino}" del CDE de este proyecto`}>
            Cargar al CDE
          </button>
          {generar && (
            <button
              type="button"
              style={botonSecundario}
              disabled={busy}
              onClick={() =>
                ejecutar(async () => {
                  setAvance("Generando el PDF…");
                  const { archivo: pdf, nombre } = await generar.crear();
                  return subirDocumento(api, { entidadTipo, entidadId, tipoDoc: generar.tipoDoc, nombreOriginal: nombre, origen: "generado", vence: null }, pdf, setAvance);
                })
              }
            >
              {generar.etiqueta}
            </button>
          )}
          {archivo && !problema && (
            <span style={{ fontSize: 12, color: "var(--tc-gray-500)", flexBasis: "100%" }}>
              Se guardará en <strong>{destino}</strong> del CDE de este proyecto, con el nombre del registro y el tipo.
              {archivo.size > MAX_RELEVO ? " Pesa más de 4 MB: lo envía tu navegador directo a Trimble." : ""}
            </span>
          )}
        </div>
      )}
      {avance && <p style={{ fontSize: 13, color: "var(--tc-blue-700)", margin: 0 }}>{avance}</p>}
      {error && <Notice kind="warning">{error}</Notice>}
    </div>
  );
}

const accion = { ...linkBtn, fontSize: 12.5, marginLeft: 8 };
