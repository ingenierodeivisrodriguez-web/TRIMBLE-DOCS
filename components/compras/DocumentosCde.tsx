"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { tiene } from "../../lib/compras/accesos";
import type { ComprasApi } from "../../lib/compras/client";
import { ESTADOS_DOCUMENTO, ESTADOS_EXPEDIENTE, expediente, MODULO_DE, nombreSeguro, revisarTipos } from "../../lib/compras/documentos";
import { fecha, fechaHora } from "../../lib/compras/formato";
import { nitConDv } from "../../lib/compras/proveedores";
import { abrirEnPestana, reintentarSubida } from "../../lib/compras/subida";
import type { Documento, DocumentosResponse, EstadoCarpetas, Permiso, Proveedor, SyncEntrada, TipoDocumentoLegal } from "../../lib/compras/types";
import { coincide } from "../../lib/presupuesto/format";
import { ApiError } from "../../lib/propiedades/client";
import { acceptButton, baseInput, C, message, Modal, Notice, NumInput } from "../presupuesto/ui";
import { elegirArchivo } from "./DocumentosRegistro";
import { botonSecundario, card, etiqueta, linkBtn, td, texto, th, titulo } from "./estilos";
import PruebaCde from "./PruebaCde";

const ENTIDAD_TEXTO: Record<Documento["entidadTipo"], string> = {
  requisicion: "Requisición",
  cotizacion: "Cotización",
  orden: "Orden de compra",
  contrato: "Contrato",
  proveedor: "Proveedor",
  recepcion: "Recepción",
};

/**
 * "Documentos (CDE)": the folders of Compras in the project's Trimble
 * Connect, what is still waiting for Trimble's confirmation, the suppliers'
 * legal files, every document, and the kinds of legal documents.
 */
export default function DocumentosCde({ api, permisos, onSinAcceso }: { api: ComprasApi; permisos: Permiso[]; onSinAcceso: (err: unknown) => void }) {
  const [datos, setDatos] = useState<DocumentosResponse | null>(null);
  const [proveedores, setProveedores] = useState<Proveedor[] | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [avance, setAvance] = useState("");
  const [busy, setBusy] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [historial, setHistorial] = useState<{ id: string; filas: SyncEntrada[] } | null>(null);
  const administra = tiene(permisos, "documentos", "administrar");

  const cargar = useCallback(async () => {
    setError("");
    try {
      setDatos(await api.getDocumentos());
    } catch (err) {
      setError(message(err));
      onSinAcceso(err);
    }
    if (tiene(permisos, "proveedores", "ver")) api.getProveedores().then((p) => setProveedores(p.proveedores), () => setProveedores(null));
  }, [api, permisos, onSinAcceso]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const todos = useMemo(
    () => (datos?.documentos ?? []).filter((d) => coincide(`${d.titulo} ${d.nombreArchivo} ${d.ruta} ${d.subidoPor}`, buscar)).sort((a, b) => b.creado.localeCompare(a.creado)),
    [datos, buscar]
  );

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!datos) return <p style={{ color: "var(--tc-gray-500)" }}>Cargando documentos…</p>;

  const pendientes = datos.documentos.filter((d) => d.estado === "pendiente" || d.estado === "error");
  const sinCompletar = (proveedores ?? [])
    .filter((p) => p.estado === "activo")
    .map((p) => ({ p, exp: expediente(p.id, datos.documentos, datos.tipos, datos.hoy) }))
    .filter((x) => x.exp.estado !== "completo");
  const puedeCon = (d: Documento) => tiene(permisos, MODULO_DE[d.entidadTipo], "documentos");

  async function reintentar(d: Documento) {
    setBusy(true);
    setAviso("");
    try {
      const r = await reintentarSubida(api, d, elegirArchivo, setAvance);
      setAviso(r.estado === "respaldado" ? `"${r.titulo}" quedó respaldado en el CDE.` : r.estado === "error" ? `No se pudo: ${r.ultimoError}` : "Trimble aún no confirma; vuelve a intentarlo en un momento.");
    } catch (err) {
      setAviso(message(err));
    } finally {
      setAvance("");
      setBusy(false);
      await cargar();
    }
  }

  const verHistorial = async (id: string) => setHistorial(historial?.id === id ? null : { id, filas: await api.historialDocumento(id) });

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 1100 }}>
      {administra && <Carpetas api={api} datos={datos} onCambio={cargar} />}
      {!administra && datos.carpetas.length === 0 && (
        <Notice kind="warning">Las carpetas de Compras en el CDE de este proyecto aún no están preparadas: lo hace un administrador de Compras desde esta pestaña.</Notice>
      )}

      <section style={{ ...card, maxWidth: "none" }}>
        <h2 style={titulo}>Pendientes de respaldo ({pendientes.length})</h2>
        <p style={texto}>
          Un documento solo cuenta como respaldado cuando Trimble Connect confirma la carga. Estos aún no: reintenta (si el archivo ya llegó, solo se confirma; si no, se vuelve a enviar sin duplicarlo). Si
          este navegador no guardó una copia, te pedirá el archivo original.
        </p>
        {pendientes.length === 0 ? (
          <p style={{ ...texto, margin: 0 }}>Nada pendiente.</p>
        ) : (
          <TablaDocumentos
            documentos={pendientes}
            hoy={datos.hoy}
            acciones={(d) => (
              <>
                {puedeCon(d) && (
                  <button type="button" style={accion} disabled={busy} onClick={() => reintentar(d)}>
                    Reintentar
                  </button>
                )}
                <button type="button" style={accion} onClick={() => verHistorial(d.id)}>
                  Historial
                </button>
              </>
            )}
            historial={historial}
          />
        )}
        {avance && <p style={{ fontSize: 13, color: "var(--tc-blue-700)" }}>{avance}</p>}
        {aviso && <Notice kind="info" style={{ marginTop: 8 }}>{aviso}</Notice>}
      </section>

      {proveedores && (
        <section style={{ ...card, maxWidth: "none" }}>
          <h2 style={titulo}>Expedientes de proveedores por completar ({sinCompletar.length})</h2>
          {sinCompletar.length === 0 ? (
            <p style={{ ...texto, margin: 0 }}>Todos los proveedores activos tienen su expediente completo y vigente.</p>
          ) : (
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>Proveedor</th>
                  <th style={th}>Expediente</th>
                  <th style={th}>Qué falta o vence</th>
                </tr>
              </thead>
              <tbody>
                {sinCompletar.map(({ p, exp }) => {
                  const e = ESTADOS_EXPEDIENTE[exp.estado];
                  const notas = exp.items
                    .filter((i) => (i.tipo.obligatorio && (i.estado === "falta" || i.estado === "sin-respaldo" || i.estado === "vencido")) || i.estado === "por-vencer")
                    .map((i) =>
                      i.estado === "falta"
                        ? `${i.tipo.nombre}: falta`
                        : i.estado === "sin-respaldo"
                          ? `${i.tipo.nombre}: sin confirmar en el CDE`
                          : `${i.tipo.nombre}: ${i.estado === "vencido" ? "venció" : "vence"} el ${fecha(i.documento!.vence!)}`
                    );
                  return (
                    <tr key={p.id}>
                      <td style={td}>
                        <strong>{p.razonSocial}</strong>
                        <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>NIT {nitConDv(p.nit, p.dv)}</div>
                      </td>
                      <td style={td}>
                        <span style={etiqueta(e.color, e.fondo)}>{e.texto}</span>
                      </td>
                      <td style={{ ...td, fontSize: 12.5 }}>{notas.join(" · ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p style={{ ...texto, margin: "8px 0 0", fontSize: 12.5 }}>Los documentos se cargan desde la ficha de cada proveedor, en la pestaña Proveedores.</p>
        </section>
      )}

      <section style={{ ...card, maxWidth: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
          <h2 style={{ ...titulo, margin: 0 }}>Todos los documentos ({datos.documentos.length})</h2>
          <input type="search" placeholder="Buscar por título, archivo, carpeta o quién lo cargó" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ ...baseInput, width: 340 }} aria-label="Buscar documento" />
        </div>
        {todos.length === 0 ? (
          <p style={{ ...texto, margin: 0 }}>{datos.documentos.length ? "Ninguno coincide." : "Todavía no hay documentos: se cargan desde cada requisición, cotización, orden, contrato o proveedor."}</p>
        ) : (
          <TablaDocumentos
            documentos={todos.slice(0, 200)}
            hoy={datos.hoy}
            acciones={(d) => (
              <>
                {puedeCon(d) && d.estado === "respaldado" && (
                  <button type="button" style={accion} onClick={() => abrirEnPestana(api, d.id).catch((err) => setAviso(message(err)))}>
                    Abrir
                  </button>
                )}
                <button type="button" style={accion} onClick={() => verHistorial(d.id)}>
                  Historial
                </button>
              </>
            )}
            historial={historial}
          />
        )}
        {todos.length > 200 && <p style={{ ...texto, margin: "8px 0 0", fontSize: 12.5 }}>Se muestran los 200 más recientes: usa la búsqueda.</p>}
      </section>

      {administra && <TiposLegales api={api} datos={datos} onGuardado={setDatos} onRecargar={cargar} />}

      {administra && (
        <details>
          <summary style={{ cursor: "pointer", fontSize: 14, color: "var(--tc-blue-800)" }}>Prueba de escritura en el CDE</summary>
          <div style={{ marginTop: 8 }}>
            <PruebaCde api={api} administra={administra} />
          </div>
        </details>
      )}
    </div>
  );
}

function TablaDocumentos({
  documentos,
  hoy,
  acciones,
  historial,
}: {
  documentos: Documento[];
  hoy: string;
  acciones: (d: Documento) => React.ReactNode;
  historial: { id: string; filas: SyncEntrada[] } | null;
}) {
  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead>
        <tr>
          <th style={th}>Documento</th>
          <th style={th}>Registro</th>
          <th style={th}>Estado</th>
          <th style={th}>Cargado</th>
          <th style={th} aria-label="Acciones" />
        </tr>
      </thead>
      <tbody>
        {documentos.map((d) => {
          const e = ESTADOS_DOCUMENTO[d.estado];
          return [
            <tr key={d.id}>
              <td style={td}>
                <div style={{ fontWeight: 600 }}>{d.titulo}</div>
                <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>
                  {d.ruta} / {d.nombreArchivo}
                </div>
                {d.ultimoError && d.estado !== "respaldado" && <div style={{ fontSize: 12, color: "#b3261e" }}>{d.ultimoError}</div>}
              </td>
              <td style={{ ...td, fontSize: 12.5 }}>{ENTIDAD_TEXTO[d.entidadTipo]}</td>
              <td style={td}>
                <span style={etiqueta(e.color, e.fondo)}>{e.texto}</span>
                {d.estado === "anulado" && <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>{d.motivoAnulacion}</div>}
                {d.vence && d.estado !== "anulado" && <div style={{ fontSize: 12, color: d.vence < hoy ? "#b3261e" : "var(--tc-gray-500)" }}>vence el {fecha(d.vence)}</div>}
                {d.intentos > 1 && <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>{d.intentos} intentos</div>}
              </td>
              <td style={{ ...td, fontSize: 12.5 }}>
                {fechaHora(d.creado)}
                <div style={{ color: "var(--tc-gray-500)" }}>{d.subidoPor}</div>
              </td>
              <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>{acciones(d)}</td>
            </tr>,
            historial?.id === d.id && (
              <tr key={`${d.id}-h`}>
                <td colSpan={5} style={{ ...td, background: "#f7f9fc", fontSize: 12.5 }}>
                  {historial.filas.length === 0
                    ? "Sin movimientos."
                    : historial.filas.map((h, i) => <div key={i}>{`${fechaHora(h.creado)} · ${h.por} · ${h.accion}: ${h.resultado === "ok" ? "✔" : "✖"} ${h.detalle}`}</div>)}
                </td>
              </tr>
            ),
          ];
        })}
      </tbody>
    </table>
  );
}

/** The folders of Compras in the CDE: first look (creates nothing), then prepare with confirmation. */
function Carpetas({ api, datos, onCambio }: { api: ComprasApi; datos: DocumentosResponse; onCambio: () => void }) {
  const [estado, setEstado] = useState<EstadoCarpetas | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listas = datos.carpetas.length > 0;

  async function correr(trabajo: () => Promise<EstadoCarpetas>) {
    setBusy(true);
    setError("");
    try {
      setEstado(await trabajo());
      return true;
    } catch (err) {
      setError(message(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const faltan = estado?.carpetas.filter((c) => !c.folderId) ?? [];
  const sinGuardar = estado?.carpetas.filter((c) => c.folderId && !c.guardada) ?? [];

  return (
    <section style={{ ...card, maxWidth: "none" }}>
      <h2 style={titulo}>Carpetas de Compras en el CDE</h2>
      <p style={texto}>
        Los documentos se guardan en Trimble Connect, en la carpeta <strong>Compras y Contrataciones</strong> de la raíz del proyecto, con una subcarpeta por tipo de registro (y una por proveedor
        dentro de “Documentación legal de proveedores”). Aquí no se guarda ningún archivo: solo la referencia de Trimble.
      </p>
      {listas && !estado && (
        <p style={{ ...texto, color: "#2e6b22" }}>
          ✔ Preparadas: {datos.carpetas.length} carpetas registradas{datos.carpetas[0]?.creada ? `, la primera el ${fechaHora(datos.carpetas[0].creada)}` : ""}.
        </p>
      )}
      {estado && (
        <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 8 }}>
          <thead>
            <tr>
              <th style={th}>Carpeta</th>
              <th style={th}>En Trimble</th>
              <th style={th}>Registrada en Compras</th>
            </tr>
          </thead>
          <tbody>
            {estado.carpetas.map((c) => (
              <tr key={c.clave}>
                <td style={td}>{c.ruta}</td>
                <td style={td}>{c.existe ? "✔ Existe" : c.folderId ? "✔ Creada ahora" : "Falta (se creará)"}</td>
                <td style={td}>{c.guardada ? "✔" : c.existe ? "Se registrará (se usa la existente)" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={botonSecundario} disabled={busy} onClick={() => correr(() => api.inspeccionarCarpetas())}>
          {busy && !confirmar ? "Revisando…" : "Revisar en Trimble"}
        </button>
        {estado && (faltan.length > 0 || sinGuardar.length > 0) && (
          <button type="button" style={acceptButton} disabled={busy} onClick={() => setConfirmar(true)}>
            Preparar carpetas
          </button>
        )}
      </div>
      {error && <Notice kind="error" style={{ marginTop: 8 }}>{error}</Notice>}

      {confirmar && estado && (
        <Modal
          title="Preparar las carpetas de Compras"
          width={600}
          onClose={() => !busy && setConfirmar(false)}
          footer={
            <>
              <button type="button" onClick={() => setConfirmar(false)} disabled={busy} style={botonSecundario}>
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy}
                style={acceptButton}
                onClick={async () => {
                  if (await correr(() => api.prepararCarpetas())) {
                    setConfirmar(false);
                    onCambio();
                  }
                }}
              >
                {busy ? "Preparando…" : "Preparar"}
              </button>
            </>
          }
        >
          <div style={{ padding: 16, fontSize: 14, lineHeight: 1.5 }}>
            {faltan.length > 0 && (
              <>
                <p style={{ marginTop: 0 }}>Se crearán en Trimble Connect, con tu usuario:</p>
                <ul style={{ paddingLeft: 20 }}>
                  {faltan.map((c) => (
                    <li key={c.clave}>{c.ruta}</li>
                  ))}
                </ul>
              </>
            )}
            {sinGuardar.length > 0 && <p>Se usarán las que ya existen con ese nombre: {sinGuardar.map((c) => c.nombre).join(", ")}.</p>}
            <p style={{ marginBottom: 0 }}>No se borra ni se mueve nada de lo que ya hay en el proyecto. Queda en la auditoría.</p>
          </div>
        </Modal>
      )}
    </section>
  );
}

/** The kinds of legal documents of a supplier: adjusted or deactivated, never removed. */
function TiposLegales({ api, datos, onGuardado, onRecargar }: { api: ComprasApi; datos: DocumentosResponse; onGuardado: (d: DocumentosResponse) => void; onRecargar: () => void }) {
  const [tipos, setTipos] = useState<TipoDocumentoLegal[]>(datos.tipos);
  const [nuevo, setNuevo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  useEffect(() => setTipos(datos.tipos), [datos.tipos]);

  const cambiado = JSON.stringify(tipos) !== JSON.stringify(datos.tipos);
  const problema = revisarTipos(tipos, datos.tipos);
  const cambiar = (clave: string, c: Partial<TipoDocumentoLegal>) => {
    setOk(false);
    setTipos((ts) => ts.map((t) => (t.clave === clave ? { ...t, ...c } : t)));
  };

  function agregar() {
    const nombre = nuevo.trim();
    if (!nombre) return;
    const base =
      nombreSeguro(nombre)
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "")
        .slice(0, 30) || "tipo";
    let clave = base;
    for (let i = 2; tipos.some((t) => t.clave === clave); i++) clave = `${base}_${i}`;
    setTipos((ts) => [...ts, { clave, nombre, obligatorio: false, vigenciaDias: null, activo: true }]);
    setNuevo("");
  }

  async function guardar() {
    setBusy(true);
    setError("");
    try {
      onGuardado(await api.guardarTiposDocumento(tipos, datos.versionConfig));
      setOk(true);
    } catch (err) {
      setError(message(err));
      if (err instanceof ApiError && err.code === "version-conflict") onRecargar();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ ...card, maxWidth: "none" }}>
      <h2 style={titulo}>Documentos legales que se piden a los proveedores</h2>
      <p style={texto}>
        Los obligatorios cuentan para que el expediente esté completo. La vigencia sugiere el vencimiento al cargar (desde hoy); quien carga puede cambiarlo. Un tipo no se quita: se desactiva.
      </p>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={th}>Documento</th>
            <th style={th}>Obligatorio</th>
            <th style={th}>Vigencia (días)</th>
            <th style={th}>Activo</th>
          </tr>
        </thead>
        <tbody>
          {tipos.map((t) => (
            <tr key={t.clave} style={{ opacity: t.activo ? 1 : 0.55 }}>
              <td style={td}>
                <input value={t.nombre} maxLength={120} onChange={(e) => cambiar(t.clave, { nombre: e.target.value })} style={{ ...baseInput, width: "100%" }} aria-label={`Nombre de ${t.clave}`} />
              </td>
              <td style={td}>
                <input type="checkbox" checked={t.obligatorio} onChange={(e) => cambiar(t.clave, { obligatorio: e.target.checked })} aria-label={`${t.nombre} obligatorio`} />
              </td>
              <td style={td}>
                <NumInput value={t.vigenciaDias} decimals={0} allowEmpty onCommit={(v) => cambiar(t.clave, { vigenciaDias: v === null ? null : Math.round(v) })} ariaLabel={`Vigencia de ${t.nombre}`} style={{ width: 90, textAlign: "right" }} />
              </td>
              <td style={td}>
                <input type="checkbox" checked={t.activo} onChange={(e) => cambiar(t.clave, { activo: e.target.checked })} aria-label={`${t.nombre} activo`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input placeholder="Otro tipo de documento" value={nuevo} maxLength={120} onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} style={{ ...baseInput, width: 280 }} aria-label="Nuevo tipo de documento" />
        <button type="button" style={botonSecundario} onClick={agregar} disabled={!nuevo.trim()}>
          Agregar
        </button>
        <span style={{ flex: 1 }} />
        {cambiado && problema && <span style={{ fontSize: 13, color: "#b3261e" }}>{problema}</span>}
        {cambiado && (
          <button type="button" style={botonSecundario} onClick={() => setTipos(datos.tipos)} disabled={busy}>
            Descartar
          </button>
        )}
        <button type="button" style={{ ...acceptButton, opacity: !cambiado || problema ? 0.5 : 1 }} disabled={!cambiado || !!problema || busy} onClick={guardar}>
          {busy ? "Guardando…" : "Guardar"}
        </button>
      </div>
      {ok && !cambiado && <p style={{ ...texto, color: "#2e6b22", margin: "8px 0 0" }}>Guardado.</p>}
      {error && <Notice kind="error" style={{ marginTop: 8 }}>{error}</Notice>}
    </section>
  );
}

const accion = { ...linkBtn, fontSize: 12.5, marginLeft: 8 };
