"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { contenido, estadoAsignacion, puedeCambiar, tiene } from "../../lib/compras/accesos";
import type { ComprasApi } from "../../lib/compras/client";
import { ESTADO_ASIGNACION, fecha } from "../../lib/compras/formato";
import { AccesosResponse, ACCIONES, ACCIONES_POR_MODULO, Asignacion, MODULOS, Permiso, Rol, ROL_ADMIN } from "../../lib/compras/types";
import { ApiError } from "../../lib/propiedades/client";
import type { ProjectContacts } from "../../lib/propiedades/types";
import { isoToDisplay, parseDisplayDate } from "../../lib/propiedades/values";
import { acceptButton, baseInput, C, labelStyle, linkButton, message, Modal, Notice } from "../presupuesto/ui";
import DateField from "../propiedades/DateField";
import { botonPeligro, botonSecundario, etiqueta, select, td, texto, th } from "./estilos";

/** People with an access to Compras in this project, and the roles with their permissions. */
export default function Accesos({ api, yo, onSinAcceso }: { api: ComprasApi; yo: string; onSinAcceso: (err: unknown) => void }) {
  const [datos, setDatos] = useState<AccesosResponse | null>(null);
  const [error, setError] = useState("");
  const [vista, setVista] = useState<"personas" | "roles">("personas");

  const cargar = useCallback(async () => {
    setError("");
    try {
      setDatos(await api.getAccesos());
    } catch (err) {
      setError(message(err));
      onSinAcceso(err);
    }
  }, [api, onSinAcceso]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!datos) return <p style={{ color: "var(--tc-gray-500)" }}>Cargando accesos…</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div role="tablist" style={{ display: "flex", gap: 6 }}>
        {(["personas", "roles"] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={vista === v} onClick={() => setVista(v)} style={segmento(vista === v)}>
            {v === "personas" ? "Personas" : "Roles y permisos"}
          </button>
        ))}
      </div>
      {vista === "personas" ? (
        <Personas api={api} datos={datos} yo={yo} onDatos={setDatos} onRecargar={cargar} onSinAcceso={onSinAcceso} />
      ) : (
        <Roles api={api} datos={datos} yo={yo} onDatos={setDatos} onRecargar={cargar} onSinAcceso={onSinAcceso} />
      )}
    </div>
  );
}

interface VistaProps {
  api: ComprasApi;
  datos: AccesosResponse;
  yo: string;
  onDatos: (d: AccesosResponse) => void;
  onRecargar: () => void;
  onSinAcceso: (err: unknown) => void;
}

// ---------------------------------------------------------------- people

const ORDEN_ESTADO = { vigente: 0, programada: 1, vencida: 2, revocada: 3 };

function Personas({ api, datos, yo, onDatos, onRecargar, onSinAcceso }: VistaProps) {
  const [todos, setTodos] = useState(false);
  const [editar, setEditar] = useState<{ asignacion: Asignacion | null; reactivar?: boolean } | null>(null);
  const [revocar, setRevocar] = useState<Asignacion | null>(null);
  const administra = tiene(datos.misPermisos, "accesos", "administrar");
  const ctx = { actorId: yo, misPermisos: datos.misPermisos, roles: datos.roles };
  const rolDe = (id: string) => datos.roles.find((r) => r.id === id);

  const filas = datos.usuarios
    .map((u) => ({ u, estado: estadoAsignacion(u, datos.hoy) }))
    .filter((f) => todos || f.estado === "vigente" || f.estado === "programada")
    .sort((a, b) => ORDEN_ESTADO[a.estado] - ORDEN_ESTADO[b.estado] || a.u.nombre.localeCompare(b.u.nombre, "es"));
  const ocultas = datos.usuarios.length - filas.length;

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
        {administra && (
          <button type="button" onClick={() => setEditar({ asignacion: null })} style={{ ...acceptButton, padding: "6px 14px", fontSize: 14 }}>
            ＋ Dar acceso
          </button>
        )}
        <label style={{ fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} aria-label="Mostrar también revocados y vencidos" />
          Mostrar también revocados y vencidos{!todos && ocultas > 0 ? ` (${ocultas})` : ""}
        </label>
        {!administra && <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>Solo consulta: tu rol no administra accesos.</span>}
      </div>
      <div style={{ overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Persona</th>
              <th style={th}>Rol</th>
              <th style={th}>Desde</th>
              <th style={th}>Hasta</th>
              <th style={th}>Estado</th>
              <th style={th}>Dado por</th>
              <th style={th} aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {filas.map(({ u, estado }) => {
              const e = ESTADO_ASIGNACION[estado];
              const cambiable = puedeCambiar(ctx, u);
              return (
                <tr key={u.userId}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>
                      {u.nombre || u.userId}
                      {u.userId === yo && <span style={{ fontWeight: 400, color: "var(--tc-gray-500)" }}> (tú)</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>{u.email}</div>
                  </td>
                  <td style={td}>{rolDe(u.rolId)?.nombre ?? "—"}</td>
                  <td style={td}>{fecha(u.desde)}</td>
                  <td style={td}>{u.hasta ? fecha(u.hasta) : "Sin fecha final"}</td>
                  <td style={td}>
                    <span style={etiqueta(e.color, e.fondo)}>{e.texto}</span>
                  </td>
                  <td style={{ ...td, fontSize: 12.5, color: "var(--tc-gray-500)" }}>{u.otorgadoPor}</td>
                  <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                    {cambiable && u.activo && (
                      <>
                        <button type="button" style={accion} onClick={() => setEditar({ asignacion: u })}>
                          Cambiar
                        </button>
                        <button type="button" style={{ ...accion, color: C.close }} onClick={() => setRevocar(u)}>
                          Revocar
                        </button>
                      </>
                    )}
                    {cambiable && !u.activo && (
                      <button type="button" style={accion} onClick={() => setEditar({ asignacion: u, reactivar: true })}>
                        Reactivar
                      </button>
                    )}
                    {!cambiable && administra && u.userId !== yo && (
                      <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }} title="Su rol tiene permisos que tú no tienes.">
                        No editable
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filas.length === 0 && (
              <tr>
                <td style={{ ...td, color: "var(--tc-gray-500)" }} colSpan={7}>
                  Nadie tiene acceso vigente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editar && (
        <AsignacionDialog
          api={api}
          datos={datos}
          yo={yo}
          asignacion={editar.asignacion}
          reactivar={!!editar.reactivar}
          onGuardado={(d) => {
            onDatos(d);
            setEditar(null);
          }}
          onConflicto={() => {
            onRecargar();
            setEditar(null);
          }}
          onSinAcceso={onSinAcceso}
          onClose={() => setEditar(null)}
        />
      )}
      {revocar && (
        <RevocarDialog
          api={api}
          asignacion={revocar}
          rol={rolDe(revocar.rolId)?.nombre ?? ""}
          onGuardado={(d) => {
            onDatos(d);
            setRevocar(null);
          }}
          onSinAcceso={onSinAcceso}
          onClose={() => setRevocar(null)}
        />
      )}
    </div>
  );
}

function AsignacionDialog({
  api,
  datos,
  yo,
  asignacion,
  reactivar,
  onGuardado,
  onConflicto,
  onSinAcceso,
  onClose,
}: {
  api: ComprasApi;
  datos: AccesosResponse;
  yo: string;
  asignacion: Asignacion | null;
  reactivar: boolean;
  onGuardado: (d: AccesosResponse) => void;
  onConflicto: () => void;
  onSinAcceso: (err: unknown) => void;
  onClose: () => void;
}) {
  const nuevo = !asignacion;
  const [contactos, setContactos] = useState<ProjectContacts | null>(null);
  const [errorContactos, setErrorContactos] = useState("");
  const [buscar, setBuscar] = useState("");
  const [persona, setPersona] = useState<string>(asignacion?.userId ?? "");
  const activos = datos.roles.filter((r) => r.activo);
  const [rolId, setRolId] = useState(asignacion?.rolId ?? "");
  const hoyTexto = isoToDisplay(datos.hoy);
  const [desde, setDesde] = useState(asignacion && !reactivar ? isoToDisplay(asignacion.desde) : hoyTexto);
  const [hasta, setHasta] = useState(asignacion?.hasta && !reactivar ? isoToDisplay(asignacion.hasta) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!nuevo) return;
    api.getContactos().then(setContactos, (err) => {
      setErrorContactos(message(err));
      onSinAcceso(err);
    });
  }, [api, nuevo, onSinAcceso]);

  const conAcceso = useMemo(() => new Set(datos.usuarios.map((u) => u.userId)), [datos.usuarios]);
  const candidatos = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (contactos?.users ?? []).filter(
      (u) => u.id !== yo && !conAcceso.has(u.id) && (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    );
  }, [contactos, buscar, yo, conAcceso]);
  const yaTienen = (contactos?.users ?? []).filter((u) => u.id !== yo && conAcceso.has(u.id)).length;

  const desdeIso = parseDisplayDate(desde);
  const hastaIso = hasta.trim() ? parseDisplayDate(hasta) : null;
  const rol = datos.roles.find((r) => r.id === rolId);
  const asignable = (r: Rol) => contenido(r.permisos, datos.misPermisos);
  const problema = !persona
    ? "Elige a la persona."
    : !rol
      ? "Elige el rol."
      : !desdeIso
        ? "Escribe la fecha de inicio como DD-MM-AAAA."
        : hasta.trim() && !hastaIso
          ? "Escribe la fecha final como DD-MM-AAAA o déjala vacía."
          : hastaIso && hastaIso < desdeIso
            ? "La fecha final no puede ser anterior a la inicial."
            : "";

  async function guardar() {
    if (problema || !desdeIso) return;
    setBusy(true);
    setError("");
    try {
      onGuardado(await api.guardarUsuario({ userId: persona, rolId, desde: desdeIso, hasta: hastaIso, activo: true, version: asignacion?.version ?? 0 }));
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === "version-conflict") {
        onConflicto();
        return;
      }
      setError(message(err));
      onSinAcceso(err);
    }
  }

  const titulo = nuevo ? "Dar acceso a Compras" : reactivar ? `Reactivar el acceso de ${asignacion.nombre}` : `Cambiar el acceso de ${asignacion.nombre}`;
  return (
    <Modal
      title={titulo}
      width={620}
      onClose={() => !busy && onClose()}
      footer={
        <>
          {problema && <span style={{ fontSize: 13, color: "var(--tc-gray-500)", marginRight: "auto" }}>{problema}</span>}
          <button type="button" onClick={onClose} disabled={busy} style={botonSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={busy || !!problema} style={{ ...acceptButton, opacity: problema ? 0.5 : 1 }}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      <div style={{ padding: 16, display: "grid", gap: 14 }}>
        {nuevo ? (
          <div>
            <span style={labelStyle}>Persona del equipo del proyecto</span>
            {errorContactos && <Notice kind="error">{errorContactos}</Notice>}
            {!contactos && !errorContactos && <p style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>Cargando el equipo del proyecto…</p>}
            {contactos && (
              <>
                <input
                  type="search"
                  placeholder="Buscar por nombre o correo"
                  value={buscar}
                  onChange={(e) => setBuscar(e.target.value)}
                  style={{ ...baseInput, width: "100%", marginBottom: 6 }}
                  aria-label="Buscar persona"
                />
                <div role="radiogroup" aria-label="Persona" style={{ maxHeight: 210, overflow: "auto", border: `1px solid ${C.border}`, borderRadius: 4, background: "#fff" }}>
                  {candidatos.map((u) => (
                    <label key={u.id} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "6px 10px", borderBottom: `1px solid ${C.grid}`, cursor: "pointer", background: persona === u.id ? C.rowSelected : undefined }}>
                      <input type="radio" name="persona" checked={persona === u.id} onChange={() => setPersona(u.id)} aria-label={u.name} />
                      <span style={{ fontSize: 13.5 }}>
                        {u.name}
                        <span style={{ color: "var(--tc-gray-500)", fontSize: 12 }}>
                          {" "}
                          {u.email}
                          {u.pending ? " · invitación pendiente" : ""}
                        </span>
                      </span>
                    </label>
                  ))}
                  {candidatos.length === 0 && <p style={{ fontSize: 13, color: "var(--tc-gray-500)", padding: "6px 10px", margin: 0 }}>No hay personas que coincidan.</p>}
                </div>
                {yaTienen > 0 && (
                  <p style={{ fontSize: 12, color: "var(--tc-gray-500)", margin: "4px 0 0" }}>
                    No aparecen las {yaTienen} persona(s) que ya tienen un acceso (vigente, vencido o revocado): cámbialo desde su fila.
                  </p>
                )}
              </>
            )}
          </div>
        ) : (
          <p style={{ ...texto, margin: 0 }}>
            <strong>{asignacion.nombre}</strong> <span style={{ color: "var(--tc-gray-500)" }}>{asignacion.email}</span>
          </p>
        )}

        <div>
          <label style={labelStyle} htmlFor="compras-rol">
            Rol
          </label>
          <select id="compras-rol" value={rolId} onChange={(e) => setRolId(e.target.value)} style={{ ...select, width: "100%" }}>
            <option value="">Elige un rol…</option>
            {activos.map((r) => (
              <option key={r.id} value={r.id} disabled={!asignable(r)}>
                {r.nombre}
                {asignable(r) ? "" : " — tiene permisos que tú no tienes"}
              </option>
            ))}
          </select>
          {rol && <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: "4px 0 0" }}>{rol.descripcion || `${rol.permisos.length} permisos.`}</p>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="compras-desde">
              Desde
            </label>
            <DateField id="compras-desde" text={desde} placeholder="DD-MM-AAAA" invalid={!!desde && !desdeIso} onText={setDesde} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="compras-hasta">
              Hasta (vacío: sin fecha final)
            </label>
            <DateField id="compras-hasta" text={hasta} placeholder="DD-MM-AAAA" invalid={!!hasta.trim() && !hastaIso} onText={setHasta} />
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: 0 }}>
          El acceso vale desde el primer día hasta el último, ambos incluidos. Queda registrado en la auditoría con tu nombre.
        </p>
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

function RevocarDialog({
  api,
  asignacion,
  rol,
  onGuardado,
  onSinAcceso,
  onClose,
}: {
  api: ComprasApi;
  asignacion: Asignacion;
  rol: string;
  onGuardado: (d: AccesosResponse) => void;
  onSinAcceso: (err: unknown) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function revocar() {
    setBusy(true);
    setError("");
    try {
      const { userId, rolId, desde, hasta, version } = asignacion;
      onGuardado(await api.guardarUsuario({ userId, rolId, desde, hasta, activo: false, version }));
    } catch (err) {
      setBusy(false);
      setError(message(err));
      onSinAcceso(err);
    }
  }
  return (
    <Modal
      title="Revocar acceso"
      width={520}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} style={botonSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={revocar} disabled={busy} style={botonPeligro}>
            {busy ? "Revocando…" : "Revocar"}
          </button>
        </>
      }
    >
      <div style={{ padding: 16, fontSize: 14, lineHeight: 1.5 }}>
        <p style={{ marginTop: 0 }}>
          <strong>{asignacion.nombre}</strong> ({rol}) deja de entrar a Compras en este proyecto desde su próxima acción, aunque tenga la página abierta.
        </p>
        <p style={{ marginBottom: 0, color: "var(--tc-gray-500)" }}>El registro no se borra: puedes reactivarlo después y todo queda en la auditoría.</p>
        {error && <Notice kind="error" style={{ marginTop: 12 }}>{error}</Notice>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- roles and permissions

interface Borrador {
  id?: string;
  nombre: string;
  descripcion: string;
  permisos: Set<Permiso>;
  activo: boolean;
  version: number;
}

const borradorDe = (r: Rol): Borrador => ({ id: r.id, nombre: r.nombre, descripcion: r.descripcion, permisos: new Set(r.permisos), activo: r.activo, version: r.version });

function Roles({ api, datos, yo, onDatos, onRecargar, onSinAcceso }: VistaProps) {
  const [elegido, setElegido] = useState<string | "nuevo">(datos.roles[0]?.id ?? "");
  const administra = tiene(datos.misPermisos, "accesos", "administrar");
  const miRol = datos.usuarios.find((u) => u.userId === yo)?.rolId;
  const personas = (rolId: string) => datos.usuarios.filter((u) => u.rolId === rolId && estadoAsignacion(u, datos.hoy) === "vigente").length;
  const rol = elegido === "nuevo" ? null : datos.roles.find((r) => r.id === elegido) ?? null;

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, width: 260, flexShrink: 0 }}>
        {datos.roles.map((r) => (
          <button key={r.id} type="button" onClick={() => setElegido(r.id)} style={itemRol(r.id === elegido)} aria-pressed={r.id === elegido}>
            <span style={{ fontWeight: 600, color: r.activo ? undefined : "var(--tc-gray-500)" }}>
              {r.nombre}
              {!r.activo && " (desactivado)"}
            </span>
            <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>
              {r.permisos.length} permisos · {personas(r.id)} persona(s) vigente(s)
            </span>
          </button>
        ))}
        {administra && (
          <button type="button" onClick={() => setElegido("nuevo")} style={{ ...itemRol(elegido === "nuevo"), color: "var(--tc-blue-700)" }}>
            ＋ Nuevo rol
          </button>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 320 }}>
        <EditorRol
          key={`${elegido}:${rol?.version ?? 0}`}
          api={api}
          datos={datos}
          rol={rol}
          editableMotivo={motivoNoEditable(rol, administra, miRol, datos.misPermisos)}
          onGuardado={(d, id) => {
            onDatos(d);
            setElegido(id ?? elegido);
          }}
          onRecargar={onRecargar}
          onSinAcceso={onSinAcceso}
        />
      </div>
    </div>
  );
}

/** Why the selected role can't be changed by the caller ("" when it can). */
function motivoNoEditable(rol: Rol | null, administra: boolean, miRol: string | undefined, mios: Permiso[]): string {
  if (!administra) return "Solo consulta: tu rol no administra accesos.";
  if (!rol) return "";
  if (rol.clave === ROL_ADMIN) return "El Administrador de plataforma siempre tiene todos los permisos: su matriz no se cambia.";
  if (rol.id === miRol) return "Es tu propio rol: lo cambia otro administrador.";
  if (!contenido(rol.permisos, mios)) return "Este rol tiene permisos que tú no tienes: no puedes cambiarlo.";
  return "";
}

function EditorRol({
  api,
  datos,
  rol,
  editableMotivo,
  onGuardado,
  onRecargar,
  onSinAcceso,
}: {
  api: ComprasApi;
  datos: AccesosResponse;
  rol: Rol | null;
  editableMotivo: string;
  onGuardado: (d: AccesosResponse, id?: string) => void;
  onRecargar: () => void;
  onSinAcceso: (err: unknown) => void;
}) {
  const inicial = useMemo<Borrador>(() => (rol ? borradorDe(rol) : { nombre: "", descripcion: "", permisos: new Set(), activo: true, version: 0 }), [rol]);
  const [b, setB] = useState(inicial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editable = !editableMotivo;
  const mios = new Set(datos.misPermisos);

  const cambios =
    (b.nombre.trim() !== inicial.nombre ? 1 : 0) +
    (b.descripcion.trim() !== inicial.descripcion ? 1 : 0) +
    (b.activo !== inicial.activo ? 1 : 0) +
    [...b.permisos].filter((p) => !inicial.permisos.has(p)).length +
    [...inicial.permisos].filter((p) => !b.permisos.has(p)).length;

  function alternar(p: Permiso) {
    setB((x) => {
      const permisos = new Set(x.permisos);
      if (permisos.has(p)) permisos.delete(p);
      else permisos.add(p);
      return { ...x, permisos };
    });
  }

  async function guardar() {
    setBusy(true);
    setError("");
    try {
      const d = await api.guardarRol({
        ...(b.id ? { id: b.id } : {}),
        nombre: b.nombre.trim(),
        descripcion: b.descripcion.trim(),
        permisos: [...b.permisos],
        activo: b.activo,
        version: b.version,
      });
      const id = b.id ?? d.roles.find((r) => r.nombre.trim().toLowerCase() === b.nombre.trim().toLowerCase())?.id;
      onGuardado(d, id);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.code === "version-conflict") {
        setError(message(err));
        onRecargar();
        return;
      }
      setError(message(err));
      onSinAcceso(err);
    }
  }

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, padding: 14, display: "grid", gap: 12 }}>
      {editableMotivo && <Notice kind="info">{editableMotivo}</Notice>}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 1fr) 2fr", gap: 12 }}>
        <div>
          <label style={labelStyle} htmlFor="rol-nombre">
            Nombre
          </label>
          <input id="rol-nombre" value={b.nombre} maxLength={80} disabled={!editable} onChange={(e) => setB({ ...b, nombre: e.target.value })} style={{ ...baseInput, width: "100%" }} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="rol-descripcion">
            Descripción
          </label>
          <input id="rol-descripcion" value={b.descripcion} maxLength={300} disabled={!editable} onChange={(e) => setB({ ...b, descripcion: e.target.value })} style={{ ...baseInput, width: "100%" }} />
        </div>
      </div>
      {rol && !rol.sistema && (
        <label style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={b.activo} disabled={!editable} onChange={(e) => setB({ ...b, activo: e.target.checked })} />
          Rol activo (si lo desactivas, quienes lo tienen dejan de entrar)
        </label>
      )}

      <div style={{ overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Módulo</th>
              {ACCIONES.map((a) => (
                <th key={a.id} style={{ ...th, textAlign: "center", whiteSpace: "normal", minWidth: 70 }} title={a.ayuda}>
                  {a.nombre}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULOS.map((m) => (
              <tr key={m.id}>
                <td style={{ ...td, fontWeight: 600 }} title={m.ayuda}>
                  {m.nombre}
                </td>
                {ACCIONES.map((a) => {
                  if (!ACCIONES_POR_MODULO[m.id].includes(a.id)) return <td key={a.id} style={{ ...td, background: "#fafbfc" }} />;
                  const p = `${m.id}.${a.id}` as Permiso;
                  const propio = mios.has(p);
                  const marcado = b.permisos.has(p);
                  const cambiado = marcado !== inicial.permisos.has(p);
                  return (
                    <td key={a.id} style={{ ...td, textAlign: "center", background: cambiado ? "#fff7a8" : undefined }}>
                      <input
                        type="checkbox"
                        checked={marcado}
                        disabled={!editable || !propio}
                        onChange={() => alternar(p)}
                        aria-label={`${m.nombre}: ${a.nombre}`}
                        title={editable && !propio ? "No puedes dar un permiso que tú no tienes." : undefined}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <Notice kind="error">{error}</Notice>}
      {editable && (
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
          {cambios > 0 && <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>{cambios} cambio(s) sin guardar</span>}
          <button type="button" onClick={() => setB(inicial)} disabled={busy || cambios === 0} style={{ ...botonSecundario, opacity: cambios ? 1 : 0.5 }}>
            Descartar
          </button>
          <button type="button" onClick={guardar} disabled={busy || cambios === 0 || !b.nombre.trim()} style={{ ...acceptButton, opacity: cambios && b.nombre.trim() ? 1 : 0.5 }}>
            {busy ? "Guardando…" : rol ? "Guardar cambios" : "Crear rol"}
          </button>
        </div>
      )}
    </div>
  );
}

function segmento(activo: boolean): CSSProperties {
  return {
    border: `1px solid ${activo ? C.header : C.border}`,
    background: activo ? C.header : "#fff",
    color: activo ? "#fff" : "var(--tc-gray-700)",
    borderRadius: 4,
    padding: "6px 14px",
    fontSize: 13.5,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

function itemRol(activo: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
    width: "100%",
    textAlign: "left",
    border: "none",
    borderBottom: `1px solid ${C.grid}`,
    background: activo ? C.rowSelected : "transparent",
    padding: "8px 12px",
    fontSize: 13.5,
    cursor: "pointer",
    fontFamily: "inherit",
    color: "var(--tc-gray-700)",
  };
}

const accion: CSSProperties = { ...linkButton, color: "var(--tc-blue-700)", fontSize: 13, padding: "2px 6px" };
