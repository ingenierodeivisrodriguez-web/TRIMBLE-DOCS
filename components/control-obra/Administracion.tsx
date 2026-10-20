"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { estadoAsignacion, puedeCambiarAsignacion } from "../../lib/control-obra/accesos";
import type { ObraApi } from "../../lib/control-obra/client";
import { AccesosResponse, ACCIONES, ACCIONES_POR_MODULO, Asignacion, EstadoResponse, Permiso, MODULOS, Rol, UsuarioEmpresa } from "../../lib/control-obra/types";
import { ESTADO_ASIGNACION, fecha, fechaHora } from "../../lib/compras/formato";
import { ApiError } from "../../lib/propiedades/client";
import type { ProjectContacts } from "../../lib/propiedades/types";
import { isoToDisplay, parseDisplayDate } from "../../lib/propiedades/values";
import { acceptButton, baseInput, C, labelStyle, linkButton, message, Modal, Notice } from "../presupuesto/ui";
import DateField from "../propiedades/DateField";
import { botonPeligro, botonSecundario, card, etiqueta, select, td, texto, th, titulo } from "../compras/estilos";
import { segmento } from "./ControlObraApp";

type Vista = "personas" | "roles" | "empresa" | "proyecto";

/** People with an access in this project, the company's roles, its people and the project's registration. */
export default function Administracion({
  api,
  estado,
  projectName,
  onEstado,
  onSinAcceso,
}: {
  api: ObraApi;
  estado: EstadoResponse;
  projectName: string;
  onEstado: (e: EstadoResponse) => void;
  onSinAcceso: (err: unknown) => void;
}) {
  const [datos, setDatos] = useState<AccesosResponse | null>(null);
  const [error, setError] = useState("");
  const [vista, setVista] = useState<Vista>("personas");

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

  const vistas: { id: Vista; nombre: string }[] = [
    { id: "personas", nombre: "Personas del proyecto" },
    { id: "roles", nombre: "Roles y permisos" },
    ...(datos.adminEmpresa ? [{ id: "empresa" as const, nombre: "Personas de la empresa" }, { id: "proyecto" as const, nombre: "Proyectos de la empresa" }] : []),
  ];
  const props = { api, datos, yo: estado.user.id, onDatos: setDatos, onRecargar: cargar, onSinAcceso };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div role="tablist" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {vistas.map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={vista === v.id} onClick={() => setVista(v.id)} style={segmento(vista === v.id)}>
            {v.nombre}
          </button>
        ))}
        {datos.licencia && (
          <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)", marginLeft: 8 }} title="Lo que permite la licencia de la empresa.">
            Licencia: {datos.licencia.usuariosActivos} de {datos.licencia.maxUsuarios} personas activas
            {datos.adminEmpresa ? ` · ${datos.licencia.proyectosActivos} de ${datos.licencia.maxProyectos} proyectos` : ""}
          </span>
        )}
      </div>
      {vista === "personas" && <Personas {...props} />}
      {vista === "roles" && <Roles {...props} />}
      {vista === "empresa" && <PersonasEmpresa {...props} />}
      {vista === "proyecto" && <Proyectos api={api} datos={datos} estado={estado} projectName={projectName} onEstado={onEstado} />}
    </div>
  );
}

interface VistaProps {
  api: ObraApi;
  datos: AccesosResponse;
  yo: string;
  onDatos: (d: AccesosResponse) => void;
  onRecargar: () => void;
  onSinAcceso: (err: unknown) => void;
}

// ---------------------------------------------------------------- people of the project

const ORDEN_ESTADO = { vigente: 0, programada: 1, vencida: 2, revocada: 3 };

function Personas({ api, datos, yo, onDatos, onRecargar, onSinAcceso }: VistaProps) {
  const [todos, setTodos] = useState(false);
  const [editar, setEditar] = useState<{ asignacion: Asignacion | null; reactivar?: boolean } | null>(null);
  const [revocar, setRevocar] = useState<Asignacion | null>(null);
  const administra = datos.adminEmpresa || datos.adminProyecto;
  const quien = { actorId: yo, adminEmpresa: datos.adminEmpresa, adminProyecto: datos.adminProyecto, hoy: datos.hoy };
  const rolDe = (id: string) => datos.roles.find((r) => r.id === id);
  const personaDe = (userId: string) => datos.usuarios.find((u) => u.userId === userId);

  const filas = datos.asignaciones
    .map((a) => ({ a, estado: personaDe(a.userId)?.activo === false ? ("revocada" as const) : estadoAsignacion(a, datos.hoy) }))
    .filter((f) => todos || f.estado === "vigente" || f.estado === "programada")
    .sort((x, y) => ORDEN_ESTADO[x.estado] - ORDEN_ESTADO[y.estado] || x.a.nombre.localeCompare(y.a.nombre, "es"));
  const ocultas = datos.asignaciones.length - filas.length;

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
        {administra && (
          <button type="button" onClick={() => setEditar({ asignacion: null })} style={{ ...acceptButton, padding: "6px 14px", fontSize: 14 }}>
            ＋ Dar acceso
          </button>
        )}
        <label style={{ fontSize: 13.5, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
          Mostrar también revocados y vencidos{!todos && ocultas > 0 ? ` (${ocultas})` : ""}
        </label>
        {!administra && <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>Solo consulta: los accesos los dan los administradores.</span>}
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
            {filas.map(({ a, estado }) => {
              const e = ESTADO_ASIGNACION[estado];
              const cambiable = administra && puedeCambiarAsignacion(quien, a);
              const desactivada = personaDe(a.userId)?.activo === false;
              return (
                <tr key={a.userId}>
                  <td style={td}>
                    <div style={{ fontWeight: 600 }}>
                      {a.nombre || a.userId}
                      {a.userId === yo && <span style={{ fontWeight: 400, color: "var(--tc-gray-500)" }}> (tú)</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>{a.email}</div>
                  </td>
                  <td style={td}>
                    {rolDe(a.rolId)?.nombre ?? "—"}
                    {a.adminProyecto && <div style={{ fontSize: 12, color: "var(--tc-blue-700)" }}>Administra el proyecto</div>}
                    {personaDe(a.userId)?.adminEmpresa && <div style={{ fontSize: 12, color: "var(--tc-blue-700)" }}>Administra la empresa</div>}
                  </td>
                  <td style={td}>{fecha(a.desde)}</td>
                  <td style={td}>{a.hasta ? fecha(a.hasta) : "Sin fecha final"}</td>
                  <td style={td}>
                    <span style={etiqueta(e.color, e.fondo)} title={desactivada ? "La persona está desactivada en la empresa." : undefined}>
                      {desactivada ? "Desactivada en la empresa" : e.texto}
                    </span>
                  </td>
                  <td style={{ ...td, fontSize: 12.5, color: "var(--tc-gray-500)" }}>{a.otorgadoPor}</td>
                  <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                    {cambiable && a.activo && (
                      <>
                        <button type="button" style={accion} onClick={() => setEditar({ asignacion: a })}>
                          Cambiar
                        </button>
                        <button type="button" style={{ ...accion, color: C.close }} onClick={() => setRevocar(a)}>
                          Revocar
                        </button>
                      </>
                    )}
                    {cambiable && !a.activo && (
                      <button type="button" style={accion} onClick={() => setEditar({ asignacion: a, reactivar: true })}>
                        Reactivar
                      </button>
                    )}
                    {!cambiable && administra && a.userId !== yo && (
                      <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }} title="Administra el proyecto: lo cambia la administración de la empresa.">
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
                  Nadie tiene acceso vigente en este proyecto.
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
        <Confirmar
          titulo="Revocar acceso"
          boton="Revocar"
          peligro
          onClose={() => setRevocar(null)}
          accion={async () => {
            const { userId, rolId, adminProyecto, desde, hasta, version } = revocar;
            onDatos(await api.guardarAsignacion({ userId, rolId, adminProyecto, desde, hasta, activo: false, version }));
            setRevocar(null);
          }}
          onSinAcceso={onSinAcceso}
        >
          <p style={{ marginTop: 0 }}>
            <strong>{revocar.nombre}</strong> ({rolDe(revocar.rolId)?.nombre}) deja de entrar a Control de Obra en este proyecto desde su próxima acción, aunque
            tenga la página abierta.
          </p>
          <p style={{ marginBottom: 0, color: "var(--tc-gray-500)" }}>El registro no se borra: puedes reactivarlo después y todo queda en la bitácora.</p>
        </Confirmar>
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
  api: ObraApi;
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
  const [persona, setPersona] = useState(asignacion?.userId ?? "");
  const [rolId, setRolId] = useState(asignacion?.rolId ?? "");
  const [adminProyecto, setAdminProyecto] = useState(asignacion?.adminProyecto ?? false);
  const [desde, setDesde] = useState(asignacion && !reactivar ? isoToDisplay(asignacion.desde) : isoToDisplay(datos.hoy));
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

  const conAcceso = useMemo(() => new Set(datos.asignaciones.map((a) => a.userId)), [datos.asignaciones]);
  const candidatos = useMemo(() => {
    const q = buscar.trim().toLowerCase();
    return (contactos?.users ?? []).filter((u) => u.id !== yo && !conAcceso.has(u.id) && (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)));
  }, [contactos, buscar, yo, conAcceso]);

  const desdeIso = parseDisplayDate(desde);
  const hastaIso = hasta.trim() ? parseDisplayDate(hasta) : null;
  const rol = datos.roles.find((r) => r.id === rolId);
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
      onGuardado(await api.guardarAsignacion({ userId: persona, rolId, adminProyecto, desde: desdeIso, hasta: hastaIso, activo: true, version: asignacion?.version ?? 0 }));
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

  const tituloDialogo = nuevo ? "Dar acceso a Control de Obra" : reactivar ? `Reactivar el acceso de ${asignacion.nombre}` : `Cambiar el acceso de ${asignacion.nombre}`;
  return (
    <Modal
      title={tituloDialogo}
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
                <input type="search" placeholder="Buscar por nombre o correo" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ ...baseInput, width: "100%", marginBottom: 6 }} aria-label="Buscar persona" />
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
                <p style={{ fontSize: 12, color: "var(--tc-gray-500)", margin: "4px 0 0" }}>No apareces tú ni quienes ya tienen un acceso en este proyecto (cámbialo desde su fila).</p>
              </>
            )}
          </div>
        ) : (
          <p style={{ ...texto, margin: 0 }}>
            <strong>{asignacion.nombre}</strong> <span style={{ color: "var(--tc-gray-500)" }}>{asignacion.email}</span>
          </p>
        )}

        <div>
          <label style={labelStyle} htmlFor="obra-rol">
            Rol
          </label>
          <select id="obra-rol" value={rolId} onChange={(e) => setRolId(e.target.value)} style={{ ...select, width: "100%" }}>
            <option value="">Elige un rol…</option>
            {datos.roles
              .filter((r) => r.activo)
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombre}
                </option>
              ))}
          </select>
          {rol && <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: "4px 0 0" }}>{rol.descripcion || `${rol.permisos.length} permisos.`}</p>}
        </div>

        {datos.adminEmpresa && (
          <label style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "flex-start" }}>
            <input type="checkbox" checked={adminProyecto} onChange={(e) => setAdminProyecto(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              Administra este proyecto
              <span style={{ display: "block", fontSize: 12, color: "var(--tc-gray-500)" }}>Da accesos y configura la estructura de este proyecto (no nombra otros administradores).</span>
            </span>
          </label>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="obra-desde">
              Desde
            </label>
            <DateField id="obra-desde" text={desde} placeholder="DD-MM-AAAA" invalid={!!desde && !desdeIso} onText={setDesde} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="obra-hasta">
              Hasta (vacío: sin fecha final)
            </label>
            <DateField id="obra-hasta" text={hasta} placeholder="DD-MM-AAAA" invalid={!!hasta.trim() && !hastaIso} onText={setHasta} />
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: 0 }}>
          El acceso vale desde el primer día hasta el último, ambos incluidos. Si la persona es nueva en la empresa, ocupa uno de los cupos de la licencia. Queda
          en la bitácora con tu nombre.
        </p>
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

/** A confirmation window that runs `accion` and shows its error. */
function Confirmar({
  titulo: tituloVentana,
  boton,
  peligro,
  accion,
  onClose,
  onSinAcceso,
  children,
}: {
  titulo: string;
  boton: string;
  peligro?: boolean;
  accion: () => Promise<void>;
  onClose: () => void;
  onSinAcceso: (err: unknown) => void;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function hacer() {
    setBusy(true);
    setError("");
    try {
      await accion();
    } catch (err) {
      setBusy(false);
      setError(message(err));
      onSinAcceso(err);
    }
  }
  return (
    <Modal
      title={tituloVentana}
      width={520}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} style={botonSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={hacer} disabled={busy} style={peligro ? botonPeligro : acceptButton}>
            {busy ? "Guardando…" : boton}
          </button>
        </>
      }
    >
      <div style={{ padding: 16, fontSize: 14, lineHeight: 1.5 }}>
        {children}
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
  const [elegido, setElegido] = useState<string>(datos.roles[0]?.id ?? "");
  const miRol = datos.asignaciones.find((a) => a.userId === yo && a.activo)?.rolId;
  const personas = (rolId: string) => datos.asignaciones.filter((a) => a.rolId === rolId && estadoAsignacion(a, datos.hoy) === "vigente").length;
  const rol = elegido === "nuevo" ? null : datos.roles.find((r) => r.id === elegido) ?? null;
  const motivo = !datos.adminEmpresa ? "Solo consulta: los roles los configura la administración de la empresa." : rol && rol.id === miRol ? "Es el rol que tienes asignado: lo cambia otro administrador." : "";

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, width: 260, flexShrink: 0 }}>
        {datos.roles.map((r) => (
          <button key={r.id} type="button" onClick={() => setElegido(r.id)} style={itemLista(r.id === elegido)} aria-pressed={r.id === elegido}>
            <span style={{ fontWeight: 600, color: r.activo ? undefined : "var(--tc-gray-500)" }}>
              {r.nombre}
              {!r.activo && " (desactivado)"}
            </span>
            <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>
              {r.permisos.length} permisos · {personas(r.id)} persona(s) en este proyecto
            </span>
          </button>
        ))}
        {datos.adminEmpresa && (
          <button type="button" onClick={() => setElegido("nuevo")} style={{ ...itemLista(elegido === "nuevo"), color: "var(--tc-blue-700)" }}>
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
          editableMotivo={motivo}
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

function EditorRol({
  api,
  datos,
  rol,
  editableMotivo,
  onGuardado,
  onRecargar,
  onSinAcceso,
}: {
  api: ObraApi;
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
      const d = await api.guardarRol({ ...(b.id ? { id: b.id } : {}), nombre: b.nombre.trim(), descripcion: b.descripcion.trim(), permisos: [...b.permisos], activo: b.activo, version: b.version });
      onGuardado(d, b.id ?? d.roles.find((r) => r.nombre.trim().toLowerCase() === b.nombre.trim().toLowerCase())?.id);
    } catch (err) {
      setBusy(false);
      setError(message(err));
      if (err instanceof ApiError && err.code === "version-conflict") onRecargar();
      else onSinAcceso(err);
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
      <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: 0 }}>
        La licencia puede no incluir todos los módulos: un permiso de un módulo no contratado no se usa aunque esté marcado. Los módulos de fases siguientes ya
        aparecen para dejar los roles listos.
      </p>
      <div style={{ overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Módulo</th>
              {ACCIONES.map((a) => (
                <th key={a.id} style={{ ...th, textAlign: "center", whiteSpace: "normal", minWidth: 64 }} title={a.ayuda}>
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
                  const marcado = b.permisos.has(p);
                  const cambiado = marcado !== inicial.permisos.has(p);
                  return (
                    <td key={a.id} style={{ ...td, textAlign: "center", background: cambiado ? "#fff7a8" : undefined }}>
                      <input type="checkbox" checked={marcado} disabled={!editable} onChange={() => alternar(p)} aria-label={`${m.nombre}: ${a.nombre}`} />
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

// ---------------------------------------------------------------- people of the company

function PersonasEmpresa({ api, datos, yo, onDatos, onSinAcceso }: VistaProps) {
  const [cambiar, setCambiar] = useState<UsuarioEmpresa | null>(null);
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6 }}>
      <p style={{ ...texto, padding: "10px 12px 0", fontSize: 13 }}>
        Todas las personas de la empresa en Control de Obra. Desactivar a una persona corta sus accesos en todos los proyectos de la empresa al instante y libera su
        cupo de la licencia; no se borra. Los administradores de la empresa los nombra y los quita el administrador técnico del producto.
      </p>
      <div style={{ overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Persona</th>
              <th style={th}>Correo</th>
              <th style={th}>Estado</th>
              <th style={th}>Agregada por</th>
              <th style={th} aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {datos.usuarios.map((u) => (
              <tr key={u.id}>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>
                    {u.nombre || u.email}
                    {u.userId === yo && <span style={{ fontWeight: 400, color: "var(--tc-gray-500)" }}> (tú)</span>}
                  </div>
                  {u.adminEmpresa && <div style={{ fontSize: 12, color: "var(--tc-blue-700)" }}>Administra la empresa</div>}
                  {!u.userId && <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>Invitada: todavía no ha entrado</div>}
                </td>
                <td style={td}>{u.email}</td>
                <td style={td}>{u.activo ? <span style={etiqueta("#2e6b22", "#e3f3de")}>Activa</span> : <span style={etiqueta("#b3261e", "#fbe4e2")}>Desactivada</span>}</td>
                <td style={{ ...td, fontSize: 12.5, color: "var(--tc-gray-500)" }}>{u.otorgadoPor}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  {u.userId !== yo && !u.adminEmpresa && (
                    <button type="button" style={{ ...accion, color: u.activo ? C.close : "var(--tc-blue-700)" }} onClick={() => setCambiar(u)}>
                      {u.activo ? "Desactivar" : "Reactivar"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cambiar && (
        <Confirmar
          titulo={cambiar.activo ? "Desactivar persona" : "Reactivar persona"}
          boton={cambiar.activo ? "Desactivar" : "Reactivar"}
          peligro={cambiar.activo}
          onClose={() => setCambiar(null)}
          accion={async () => {
            onDatos(await api.guardarUsuario({ id: cambiar.id, activo: !cambiar.activo, version: cambiar.version }));
            setCambiar(null);
          }}
          onSinAcceso={onSinAcceso}
        >
          <p style={{ margin: 0 }}>
            {cambiar.activo ? (
              <>
                <strong>{cambiar.nombre || cambiar.email}</strong> deja de entrar a todos los proyectos de la empresa desde su próxima acción. Sus accesos quedan
                guardados para reactivarla después.
              </>
            ) : (
              <>
                <strong>{cambiar.nombre || cambiar.email}</strong> vuelve a entrar con los accesos vigentes que tenía. Ocupa un cupo de la licencia.
              </>
            )}
          </p>
        </Confirmar>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- projects of the company

function Proyectos({ api, datos, estado, projectName, onEstado }: { api: ObraApi; datos: AccesosResponse; estado: EstadoResponse; projectName: string; onEstado: (e: EstadoResponse) => void }) {
  const [retirar, setRetirar] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function hacer() {
    setBusy(true);
    setError("");
    try {
      onEstado(await api.desvincular(motivo.trim()));
    } catch (err) {
      setBusy(false);
      setError(message(err));
    }
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Proyecto de Trimble Connect</th>
              <th style={th}>Registrado por</th>
              <th style={th}>Desde</th>
              <th style={th}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {datos.proyectos.map((p) => (
              <tr key={p.projectId}>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{p.projectName || p.projectId}</div>
                  {p.projectId === estado.projectId && <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>Este proyecto</div>}
                </td>
                <td style={td}>{p.vinculadoPor}</td>
                <td style={td}>{fechaHora(p.vinculado)}</td>
                <td style={td} title={p.motivo || undefined}>
                  {p.activo ? <span style={etiqueta("#2e6b22", "#e3f3de")}>Registrado</span> : <span style={etiqueta("#6b7684", "#eef1f4")}>Retirado</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section style={card}>
        <h2 style={titulo}>Retirar este proyecto de la empresa</h2>
        <p style={texto}>
          Libera un cupo de la licencia. Nadie vuelve a entrar a Control de Obra en <strong>{projectName || estado.projectId}</strong> hasta registrarlo de nuevo;
          sus datos, accesos y bitácora se conservan. Lo hace un administrador de la empresa que sea también administrador del proyecto en Trimble Connect.
        </p>
        <button type="button" onClick={() => setRetirar(true)} style={botonPeligro} disabled={!estado.esAdminTrimble} title={estado.esAdminTrimble ? undefined : "Necesitas ser administrador del proyecto en Trimble Connect."}>
          Retirar el proyecto…
        </button>
      </section>
      {retirar && (
        <Modal
          title="Retirar el proyecto de la empresa"
          width={520}
          onClose={() => !busy && setRetirar(false)}
          footer={
            <>
              <button type="button" onClick={() => setRetirar(false)} disabled={busy} style={botonSecundario}>
                Cancelar
              </button>
              <button type="button" onClick={hacer} disabled={busy || !motivo.trim()} style={{ ...botonPeligro, opacity: motivo.trim() ? 1 : 0.5 }}>
                {busy ? "Retirando…" : "Retirar"}
              </button>
            </>
          }
        >
          <div style={{ padding: 16, display: "grid", gap: 8 }}>
            <label style={labelStyle} htmlFor="obra-motivo-retiro">
              Motivo (queda en la bitácora)
            </label>
            <textarea id="obra-motivo-retiro" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={1000} style={{ ...baseInput, width: "100%", resize: "vertical" }} />
            {error && <Notice kind="error">{error}</Notice>}
          </div>
        </Modal>
      )}
    </div>
  );
}

export function itemLista(activo: boolean): CSSProperties {
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
