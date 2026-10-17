"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { tiene } from "../../lib/compras/accesos";
import type { ComprasApi } from "../../lib/compras/client";
import { numeroCotizacion, totalesCotizacion } from "../../lib/compras/cotizaciones";
import { fecha } from "../../lib/compras/formato";
import { ESTADOS_PROVEEDOR, leerNit, nitConDv } from "../../lib/compras/proveedores";
import { ESTADOS_EXPEDIENTE, expediente } from "../../lib/compras/documentos";
import { DocumentosResponse, EstadoProveedor, Permiso, Proveedor, ProveedoresResponse, TipoPersona } from "../../lib/compras/types";
import { coincide, fmt } from "../../lib/presupuesto/format";
import { TIPO_LABELS, TIPOS_INSUMO, TipoInsumo } from "../../lib/presupuesto/types";
import { ApiError } from "../../lib/propiedades/client";
import { acceptButton, baseInput, C, labelStyle, message, Modal, Notice } from "../presupuesto/ui";
import DocumentosRegistro from "./DocumentosRegistro";
import { botonPeligro, botonSecundario, etiqueta, linkBtn, select, subtitulo, td, th } from "./estilos";

/** The project's suppliers: register, correct, block or deactivate, and their quotations. */
export default function Proveedores({ api, permisos, onSinAcceso }: { api: ComprasApi; permisos: Permiso[]; onSinAcceso: (err: unknown) => void }) {
  const [datos, setDatos] = useState<ProveedoresResponse | null>(null);
  const [error, setError] = useState("");
  const [buscar, setBuscar] = useState("");
  const [estado, setEstado] = useState<EstadoProveedor | "">("");
  const [abierto, setAbierto] = useState<Proveedor | "nuevo" | null>(null);
  const [cambiarEstado, setCambiarEstado] = useState<Proveedor | null>(null);
  const [docs, setDocs] = useState<DocumentosResponse | null>(null);

  const cargarDocs = useCallback(() => {
    // The legal files are a plus: the list works without them.
    api.getDocumentos({ entidadTipo: "proveedor" }).then(setDocs, () => setDocs(null));
  }, [api]);

  const cargar = useCallback(async () => {
    setError("");
    cargarDocs();
    try {
      setDatos(await api.getProveedores());
    } catch (err) {
      setError(message(err));
      onSinAcceso(err);
    }
  }, [api, onSinAcceso, cargarDocs]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const filas = useMemo(
    () =>
      (datos?.proveedores ?? []).filter(
        (p) => (!estado || p.estado === estado) && coincide(`${p.nit} ${p.razonSocial} ${p.nombreComercial} ${p.ciudad} ${p.contacto}`, buscar)
      ),
    [datos, estado, buscar]
  );

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!datos) return <p style={{ color: "var(--tc-gray-500)" }}>Cargando proveedores…</p>;
  const cotsDe = (id: string) => datos.cotizaciones.filter((c) => c.proveedorId === id);

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
        {tiene(permisos, "proveedores", "crear") && (
          <button type="button" onClick={() => setAbierto("nuevo")} style={{ ...acceptButton, padding: "6px 14px", fontSize: 14 }}>
            ＋ Nuevo proveedor
          </button>
        )}
        <input type="search" placeholder="Buscar por NIT, nombre, ciudad o contacto" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ ...baseInput, width: 300 }} aria-label="Buscar proveedor" />
        <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoProveedor | "")} style={select} aria-label="Estado">
          <option value="">Todos los estados</option>
          {(Object.keys(ESTADOS_PROVEEDOR) as EstadoProveedor[]).map((e) => (
            <option key={e} value={e}>
              {ESTADOS_PROVEEDOR[e].texto}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>
          {filas.length} de {datos.proveedores.length}
        </span>
      </div>
      <div style={{ overflow: "auto", maxHeight: "calc(100vh - 200px)" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>NIT</th>
              <th style={th}>Razón social</th>
              <th style={th}>Ciudad</th>
              <th style={th}>Contacto</th>
              <th style={th}>Suministra</th>
              <th style={th}>IVA</th>
              <th style={th}>Estado</th>
              {docs && <th style={th}>Expediente</th>}
              <th style={{ ...th, textAlign: "right" }}>Cotizaciones</th>
              <th style={th} aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {filas.map((p) => {
              const e = ESTADOS_PROVEEDOR[p.estado];
              return (
                <tr key={p.id}>
                  <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{nitConDv(p.nit, p.dv)}</td>
                  <td style={td}>
                    <button type="button" onClick={() => setAbierto(p)} style={{ ...linkBtn, fontWeight: 600, textAlign: "left" }}>
                      {p.razonSocial}
                    </button>
                    {p.nombreComercial && <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>{p.nombreComercial}</div>}
                  </td>
                  <td style={td}>{p.ciudad}</td>
                  <td style={{ ...td, fontSize: 12.5 }}>
                    {p.contacto}
                    <div style={{ color: "var(--tc-gray-500)" }}>{[p.telefono, p.correo].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td style={{ ...td, fontSize: 12.5 }}>{p.categorias.join(", ")}</td>
                  <td style={td}>{p.responsableIva ? "Sí" : "No"}</td>
                  <td style={td} title={p.motivoEstado}>
                    <span style={etiqueta(e.color, e.fondo)}>{e.texto}</span>
                  </td>
                  {docs && <CeldaExpediente proveedorId={p.id} docs={docs} />}
                  <td style={{ ...td, textAlign: "right" }}>{cotsDe(p.id).length || "—"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                    {tiene(permisos, "proveedores", "anular") && (
                      <button type="button" onClick={() => setCambiarEstado(p)} style={{ ...linkBtn, fontSize: 13 }}>
                        {p.estado === "activo" ? "Inactivar o bloquear" : "Cambiar estado"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filas.length === 0 && (
              <tr>
                <td colSpan={10} style={{ ...td, color: "var(--tc-gray-500)" }}>
                  {datos.proveedores.length ? "Ningún proveedor coincide." : "Todavía no hay proveedores en este proyecto."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {abierto && (
        <ProveedorDialog
          api={api}
          proveedor={abierto === "nuevo" ? null : abierto}
          editable={abierto === "nuevo" ? tiene(permisos, "proveedores", "crear") : tiene(permisos, "proveedores", "editar")}
          historial={abierto === "nuevo" ? [] : cotsDe(abierto.id)}
          permisos={permisos}
          onGuardado={(d) => {
            setDatos(d);
            setAbierto(null);
          }}
          onRecargar={cargar}
          onClose={() => {
            setAbierto(null);
            cargarDocs();
          }}
        />
      )}
      {cambiarEstado && (
        <EstadoDialog
          api={api}
          proveedor={cambiarEstado}
          onGuardado={(d) => {
            setDatos(d);
            setCambiarEstado(null);
          }}
          onClose={() => setCambiarEstado(null)}
        />
      )}
    </div>
  );
}

function ProveedorDialog({
  api,
  proveedor: p,
  editable,
  historial,
  permisos,
  onGuardado,
  onRecargar,
  onClose,
}: {
  api: ComprasApi;
  proveedor: Proveedor | null;
  editable: boolean;
  historial: ProveedoresResponse["cotizaciones"];
  permisos: Permiso[];
  onGuardado: (d: ProveedoresResponse) => void;
  onRecargar: () => void;
  onClose: () => void;
}) {
  const [nit, setNit] = useState(p ? nitConDv(p.nit, p.dv) : "");
  const [tipoPersona, setTipoPersona] = useState<TipoPersona>(p?.tipoPersona ?? "juridica");
  const [campos, setCampos] = useState({
    razonSocial: p?.razonSocial ?? "",
    nombreComercial: p?.nombreComercial ?? "",
    contacto: p?.contacto ?? "",
    telefono: p?.telefono ?? "",
    correo: p?.correo ?? "",
    ciudad: p?.ciudad ?? "",
    direccion: p?.direccion ?? "",
    observaciones: p?.observaciones ?? "",
  });
  const [categorias, setCategorias] = useState<TipoInsumo[]>(p?.categorias ?? ["MT"]);
  const [responsableIva, setResponsableIva] = useState(p?.responsableIva ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [docs, setDocs] = useState<DocumentosResponse | null>(null);

  const lectura = nit.trim() ? leerNit(nit) : null;
  const problema = !lectura ? "Escribe el NIT." : "error" in lectura ? lectura.error : !campos.razonSocial.trim() ? "Escribe la razón social." : "";

  async function guardar() {
    if (problema || !lectura || "error" in lectura) return;
    setBusy(true);
    setError("");
    try {
      onGuardado(
        await api.guardarProveedor({ ...(p ? { id: p.id } : {}), nit, tipoPersona, ...campos, categorias, responsableIva, version: p?.version ?? 0 })
      );
    } catch (err) {
      setBusy(false);
      setError(message(err));
      if (err instanceof ApiError && err.code === "version-conflict") onRecargar();
    }
  }

  const campo = (k: keyof typeof campos, etiqueta: string, ancho: CSSProperties = {}) => (
    <div style={ancho}>
      <label style={labelStyle} htmlFor={`prov-${k}`}>
        {etiqueta}
      </label>
      <input id={`prov-${k}`} value={campos[k]} disabled={!editable} onChange={(e) => setCampos({ ...campos, [k]: e.target.value })} style={{ ...baseInput, width: "100%" }} />
    </div>
  );

  return (
    <Modal
      title={p ? p.razonSocial : "Nuevo proveedor"}
      width={820}
      onClose={() => !busy && onClose()}
      footer={
        editable ? (
          <>
            {problema && <span style={{ marginRight: "auto", fontSize: 13, color: "var(--tc-gray-500)" }}>{problema}</span>}
            <button type="button" onClick={onClose} disabled={busy} style={botonSecundario}>
              Cancelar
            </button>
            <button type="button" onClick={guardar} disabled={busy || !!problema} style={{ ...acceptButton, opacity: problema ? 0.5 : 1 }}>
              {busy ? "Guardando…" : "Guardar"}
            </button>
          </>
        ) : undefined
      }
    >
      <div style={{ padding: 16, display: "grid", gap: 12 }}>
        {p && p.estado !== "activo" && (
          <Notice kind="warning">
            {ESTADOS_PROVEEDOR[p.estado].texto}: {p.motivoEstado}
          </Notice>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "220px 160px 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="prov-nit">
              NIT o cédula
            </label>
            <input id="prov-nit" value={nit} disabled={!editable} onChange={(e) => setNit(e.target.value)} placeholder="890.903.938-8" style={{ ...baseInput, width: "100%" }} />
            <div style={{ fontSize: 12, marginTop: 2, color: lectura && "error" in lectura ? "#b3261e" : "var(--tc-gray-500)" }}>
              {lectura && !("error" in lectura) ? `Dígito de verificación: ${lectura.dv}` : lectura && "error" in lectura ? lectura.error : "Con o sin el dígito de verificación."}
            </div>
          </div>
          <div>
            <label style={labelStyle} htmlFor="prov-tipo">
              Persona
            </label>
            <select id="prov-tipo" value={tipoPersona} disabled={!editable} onChange={(e) => setTipoPersona(e.target.value as TipoPersona)} style={{ ...select, width: "100%" }}>
              <option value="juridica">Jurídica</option>
              <option value="natural">Natural</option>
            </select>
          </div>
          {campo("razonSocial", tipoPersona === "natural" ? "Nombre completo" : "Razón social")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {campo("nombreComercial", "Nombre comercial")}
          {campo("contacto", "Persona de contacto")}
          {campo("telefono", "Teléfono")}
          {campo("correo", "Correo")}
          {campo("ciudad", "Ciudad")}
          {campo("direccion", "Dirección")}
        </div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", fontSize: 13.5 }}>
          <span style={{ ...labelStyle, margin: 0 }}>Suministra:</span>
          {TIPOS_INSUMO.map((t) => (
            <label key={t} style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <input
                type="checkbox"
                disabled={!editable}
                checked={categorias.includes(t)}
                onChange={(e) => setCategorias((c) => (e.target.checked ? [...c, t] : c.filter((x) => x !== t)))}
                aria-label={TIPO_LABELS[t]}
              />
              {TIPO_LABELS[t]}
            </label>
          ))}
          <label style={{ display: "flex", gap: 5, alignItems: "center", marginLeft: "auto" }}>
            <input type="checkbox" disabled={!editable} checked={responsableIva} onChange={(e) => setResponsableIva(e.target.checked)} aria-label="Responsable de IVA" />
            Responsable de IVA
          </label>
        </div>
        <div>
          <label style={labelStyle} htmlFor="prov-observaciones">
            Observaciones
          </label>
          <textarea
            id="prov-observaciones"
            rows={2}
            maxLength={1000}
            disabled={!editable}
            value={campos.observaciones}
            onChange={(e) => setCampos({ ...campos, observaciones: e.target.value })}
            style={{ ...baseInput, width: "100%", resize: "vertical" }}
          />
        </div>
        {p && (
          <div>
            <span style={labelStyle}>Cotizaciones de este proveedor</span>
            {historial.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--tc-gray-500)", margin: 0 }}>Ninguna todavía.</p>
            ) : (
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <tbody>
                  {historial.map((c) => (
                    <tr key={c.id}>
                      <td style={td}>{numeroCotizacion(c.numero)}</td>
                      <td style={td}>{fecha(c.fecha)}</td>
                      <td style={td}>vigente hasta {fecha(c.vigenciaHasta)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{fmt(totalesCotizacion(c).total)}</td>
                      <td style={td}>{c.estado === "anulada" ? `Anulada: ${c.motivo}` : "Registrada"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
        {p && (
          <section>
            <h3 style={subtitulo}>Expediente legal</h3>
            {docs && <Expediente proveedorId={p.id} docs={docs} />}
            <DocumentosRegistro api={api} entidadTipo="proveedor" entidadId={p.id} permisos={permisos} alCambiar={setDocs} />
          </section>
        )}
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

function EstadoDialog({ api, proveedor: p, onGuardado, onClose }: { api: ComprasApi; proveedor: Proveedor; onGuardado: (d: ProveedoresResponse) => void; onClose: () => void }) {
  const [estado, setEstado] = useState<EstadoProveedor>(p.estado === "activo" ? "bloqueado" : "activo");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listo = estado !== p.estado && (estado === "activo" || !!motivo.trim());
  async function guardar() {
    setBusy(true);
    setError("");
    try {
      onGuardado(await api.estadoProveedor(p.id, { estado, motivo: motivo.trim(), version: p.version }));
    } catch (err) {
      setBusy(false);
      setError(message(err));
    }
  }
  return (
    <Modal
      title={`Estado de ${p.razonSocial}`}
      width={520}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} style={botonSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={busy || !listo} style={{ ...(estado === "activo" ? acceptButton : botonPeligro), opacity: listo ? 1 : 0.5 }}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      <div style={{ padding: 16, display: "grid", gap: 10, fontSize: 14 }}>
        <p style={{ margin: 0 }}>
          Ahora está <strong>{ESTADOS_PROVEEDOR[p.estado].texto.toLowerCase()}</strong>. Un proveedor inactivo o bloqueado no puede recibir cotizaciones nuevas
          ni ser elegido en un comparativo. No se borra.
        </p>
        <select value={estado} onChange={(e) => setEstado(e.target.value as EstadoProveedor)} style={{ ...select, width: 200 }} aria-label="Nuevo estado">
          {(Object.keys(ESTADOS_PROVEEDOR) as EstadoProveedor[]).map((e) => (
            <option key={e} value={e}>
              {ESTADOS_PROVEEDOR[e].texto}
            </option>
          ))}
        </select>
        {estado !== "activo" && (
          <>
            <label style={labelStyle} htmlFor="prov-motivo">
              Motivo
            </label>
            <textarea id="prov-motivo" rows={2} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ ...baseInput, width: "100%" }} placeholder="Ej.: RUT vencido, incumplió entregas" />
          </>
        )}
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

const VIGENCIA_TEXTO: Record<string, string> = {
  falta: "Falta",
  "sin-respaldo": "Cargado, sin confirmar en el CDE",
  vigente: "Vigente",
  "por-vencer": "Por vencer",
  vencido: "Vencido",
  "sin-vencimiento": "Vigente (no vence)",
};

/** The supplier's legal file in the list: its state, and what is missing in the tooltip. */
function CeldaExpediente({ proveedorId, docs }: { proveedorId: string; docs: DocumentosResponse }) {
  const exp = expediente(proveedorId, docs.documentos, docs.tipos, docs.hoy);
  const e = ESTADOS_EXPEDIENTE[exp.estado];
  const pendientes = exp.items.filter((i) => i.estado !== "vigente" && i.estado !== "sin-vencimiento" && (i.tipo.obligatorio || i.documento));
  return (
    <td style={td} title={pendientes.map((i) => `${i.tipo.nombre}: ${VIGENCIA_TEXTO[i.estado].toLowerCase()}`).join("\n") || "Todos los documentos obligatorios están vigentes y respaldados."}>
      <span style={etiqueta(e.color, e.fondo)}>{e.texto}</span>
    </td>
  );
}

/** Each kind of legal document with its latest backed-up one. */
function Expediente({ proveedorId, docs }: { proveedorId: string; docs: DocumentosResponse }) {
  const exp = expediente(proveedorId, docs.documentos, docs.tipos, docs.hoy);
  const e = ESTADOS_EXPEDIENTE[exp.estado];
  return (
    <div style={{ marginBottom: 8 }}>
      <p style={{ margin: "0 0 6px", fontSize: 13 }}>
        Estado: <span style={etiqueta(e.color, e.fondo)}>{e.texto}</span>{" "}
        <span style={{ color: "var(--tc-gray-500)" }}>(cuenta solo lo que Trimble confirmó; los marcados con * son obligatorios)</span>
      </p>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          {exp.items.map((i) => (
            <tr key={i.tipo.clave}>
              <td style={td}>
                {i.tipo.nombre}
                {i.tipo.obligatorio ? " *" : ""}
              </td>
              <td style={{ ...td, color: i.estado === "vencido" || (i.estado === "falta" && i.tipo.obligatorio) ? "#b3261e" : i.estado === "por-vencer" ? "#a35200" : undefined }}>
                {VIGENCIA_TEXTO[i.estado]}
                {i.documento?.vence && i.estado !== "falta" && i.estado !== "sin-respaldo" ? ` (vence el ${fecha(i.documento.vence)})` : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
