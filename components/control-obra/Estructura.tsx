"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import type { ObraApi } from "../../lib/control-obra/client";
import { claveDe, ESTADOS_NODO, FUENTES_NIVEL, rutaNodo } from "../../lib/control-obra/estructura";
import { CambioNivel, ConfigProyecto, EstadoNodo, EstructuraResponse, FuenteNivel, Nivel, NIVELES_PRESUPUESTO, Nodo } from "../../lib/control-obra/types";
import { fecha } from "../../lib/compras/formato";
import { ApiError } from "../../lib/propiedades/client";
import type { ProjectContacts } from "../../lib/propiedades/types";
import { isoToDisplay, parseDisplayDate } from "../../lib/propiedades/values";
import { acceptButton, baseInput, C, labelStyle, linkButton, message, Modal, Notice } from "../presupuesto/ui";
import DateField from "../propiedades/DateField";
import { botonSecundario, card, etiqueta, select, td, texto, th, titulo } from "../compras/estilos";

/** The project's settings and its structure of work: levels (from the company's template or its own) and their values. */
export default function Estructura({ api, onSinAcceso }: { api: ObraApi; onSinAcceso: (err: unknown) => void }) {
  const [datos, setDatos] = useState<EstructuraResponse | null>(null);
  const [contactos, setContactos] = useState<ProjectContacts | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setError("");
    try {
      const d = await api.getEstructura();
      setDatos(d);
      if (d.puedeEditarProyecto) api.getContactos().then(setContactos, () => setContactos({ users: [], groups: [] }));
    } catch (err) {
      setError(message(err));
      onSinAcceso(err);
    }
  }, [api, onSinAcceso]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!datos) return <p style={{ color: "var(--tc-gray-500)" }}>Cargando la estructura de obra…</p>;

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 1100 }}>
      <ConfigProyectoSeccion api={api} datos={datos} contactos={contactos} onDatos={setDatos} onRecargar={cargar} onSinAcceso={onSinAcceso} />
      <Niveles api={api} datos={datos} onDatos={setDatos} onRecargar={cargar} onSinAcceso={onSinAcceso} />
      <Valores api={api} datos={datos} contactos={contactos} onDatos={setDatos} onRecargar={cargar} onSinAcceso={onSinAcceso} />
    </div>
  );
}

interface SeccionProps {
  api: ObraApi;
  datos: EstructuraResponse;
  onDatos: (d: EstructuraResponse) => void;
  onRecargar: () => void;
  onSinAcceso: (err: unknown) => void;
}

/** Runs a save; a version conflict reloads, other errors are shown. */
function useGuardar(onRecargar: () => void, onSinAcceso: (err: unknown) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const guardar = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError("");
      try {
        await fn();
        setBusy(false);
        return true;
      } catch (err) {
        setBusy(false);
        setError(message(err));
        if (err instanceof ApiError && err.code === "version-conflict") onRecargar();
        else onSinAcceso(err);
        return false;
      }
    },
    [onRecargar, onSinAcceso]
  );
  return { busy, error, guardar };
}

// ---------------------------------------------------------------- settings

function ConfigProyectoSeccion({ api, datos, contactos, onDatos, onRecargar, onSinAcceso }: SeccionProps & { contactos: ProjectContacts | null }) {
  const c = datos.config;
  const [responsable, setResponsable] = useState(c.responsableTecnicoId ?? "");
  const [tolerancia, setTolerancia] = useState(String(c.toleranciaVerificacionPct));
  const [conObs, setConObs] = useState(c.permiteAceptadoConObservaciones);
  const { busy, error, guardar } = useGuardar(onRecargar, onSinAcceso);
  useEffect(() => {
    setResponsable(c.responsableTecnicoId ?? "");
    setTolerancia(String(c.toleranciaVerificacionPct));
    setConObs(c.permiteAceptadoConObservaciones);
  }, [c]);
  const tol = Number(tolerancia.replace(",", "."));
  const tolMal = !Number.isFinite(tol) || tol < 0 || tol > 100;
  const cambio = (responsable || null) !== c.responsableTecnicoId || tol !== c.toleranciaVerificacionPct || conObs !== c.permiteAceptadoConObservaciones;
  const nombreDe = (id: string) => contactos?.users.find((u) => u.id === id)?.name ?? (id === c.responsableTecnicoId ? c.responsableTecnicoNombre : id);
  const editable = datos.puedeEditarProyecto;

  return (
    <section style={card}>
      <h2 style={titulo}>Configuración del proyecto</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
        <div>
          <label style={labelStyle} htmlFor="obra-responsable">
            Responsable técnico de calidad
          </label>
          {editable ? (
            <select id="obra-responsable" value={responsable} onChange={(e) => setResponsable(e.target.value)} style={{ ...select, width: "100%" }}>
              <option value="">Sin asignar</option>
              {c.responsableTecnicoId && !contactos?.users.some((u) => u.id === c.responsableTecnicoId) && <option value={c.responsableTecnicoId}>{c.responsableTecnicoNombre}</option>}
              {(contactos?.users ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          ) : (
            <p style={{ ...texto, margin: 0 }}>{c.responsableTecnicoNombre || "Sin asignar"}</p>
          )}
          <p style={{ fontSize: 12, color: "var(--tc-gray-500)", margin: "4px 0 0" }}>Aprueba los criterios de aceptación de concreto, acero y demás materiales del proyecto.</p>
        </div>
        <div>
          <label style={labelStyle} htmlFor="obra-tolerancia">
            Tolerancia entre reportado y verificado (%)
          </label>
          <input id="obra-tolerancia" value={tolerancia} disabled={!editable} onChange={(e) => setTolerancia(e.target.value)} inputMode="decimal" style={{ ...baseInput, width: 120, ...(tolMal ? { borderColor: C.close } : {}) }} />
          <p style={{ fontSize: 12, color: "var(--tc-gray-500)", margin: "4px 0 0" }} title="Diferencia = |verificada − reportada| ÷ reportada × 100">
            Si la cantidad verificada se aparta más que esto de la reportada, se pide el motivo. 0 % = siempre que difieran.
          </p>
        </div>
        <div>
          <span style={labelStyle}>Inspecciones</span>
          <label style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "flex-start" }}>
            <input type="checkbox" checked={conObs} disabled={!editable} onChange={(e) => setConObs(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              Permitir “aceptado con observaciones”
              <span style={{ display: "block", fontSize: 12, color: "var(--tc-gray-500)" }}>Solo si el procedimiento del proyecto lo permite. Apagado por defecto.</span>
            </span>
          </label>
        </div>
      </div>
      {error && <Notice kind="error" style={{ marginTop: 12 }}>{error}</Notice>}
      {editable && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button
            type="button"
            disabled={busy || !cambio || tolMal}
            style={{ ...acceptButton, opacity: cambio && !tolMal ? 1 : 0.5 }}
            onClick={() =>
              guardar(async () => {
                const nuevo: ConfigProyecto = {
                  responsableTecnicoId: responsable || null,
                  responsableTecnicoNombre: responsable ? nombreDe(responsable) : "",
                  toleranciaVerificacionPct: tol,
                  permiteAceptadoConObservaciones: conObs,
                  version: c.version,
                };
                onDatos(await api.guardarConfig(nuevo));
              })
            }
          >
            {busy ? "Guardando…" : "Guardar configuración"}
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- levels

type EditNivel = { nivel: Nivel | null; plantilla: boolean; base?: Nivel };

function Niveles({ api, datos, onDatos, onRecargar, onSinAcceso }: SeccionProps) {
  const [editar, setEditar] = useState<EditNivel | null>(null);
  const [desactivados, setDesactivados] = useState(false);
  const nombreDe = (clave: string | null) => (clave ? datos.niveles.find((n) => n.clave === clave)?.nombre ?? clave : "—");
  const propios = new Map(datos.niveles.filter((n) => !n.heredado).map((n) => [n.clave, n]));
  // Deactivated levels, to bring them back: the template's (company administrators) and this project's own.
  const inactivos = [
    ...(datos.puedeEditarPlantilla ? datos.plantilla.filter((n) => !n.activo && !propios.has(n.clave)).map((n) => ({ nivel: n, plantilla: true })) : []),
    ...(datos.puedeEditarProyecto ? datos.propios.filter((n) => !n.activo).map((n) => ({ nivel: n, plantilla: false })) : []),
  ];

  return (
    <section style={{ ...card, maxWidth: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <h2 style={{ ...titulo, margin: 0 }}>Niveles de la estructura</h2>
        <span style={{ flex: 1 }} />
        {datos.puedeEditarProyecto && (
          <button type="button" onClick={() => setEditar({ nivel: null, plantilla: false })} style={{ ...acceptButton, padding: "6px 14px", fontSize: 14 }}>
            ＋ Nivel de este proyecto
          </button>
        )}
        {datos.puedeEditarPlantilla && (
          <button type="button" onClick={() => setEditar({ nivel: null, plantilla: true })} style={{ ...botonSecundario, padding: "6px 14px", fontSize: 14 }}>
            ＋ Nivel de la plantilla de la empresa
          </button>
        )}
      </div>
      <p style={{ ...texto, fontSize: 13 }}>
        Los proyectos heredan la plantilla de la empresa. Un nivel propio del proyecto con la misma clave reemplaza al de la plantilla solo aquí. Del modelo solo se
        lee: los valores se toman de la propiedad del modelo o del atributo de Propiedades al leer cada versión (fase siguiente); nada se escribe en el modelo.
      </p>
      <div style={{ overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>Nivel</th>
              <th style={th}>Dentro de</th>
              <th style={th}>De dónde sale el valor</th>
              <th style={th}>Origen</th>
              <th style={th} aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {NIVELES_PRESUPUESTO.map((n) => (
              <tr key={n.clave} style={{ color: "var(--tc-gray-500)" }}>
                <td style={td}>{n.nombre}</td>
                <td style={td}>—</td>
                <td style={td}>{n.origen}</td>
                <td style={td}>
                  <span style={etiqueta("#2f55b0", "#e6edfa")}>Presupuesto</span>
                </td>
                <td style={{ ...td, fontSize: 12 }}>Solo lectura: no se duplica</td>
              </tr>
            ))}
            {datos.niveles.map((n) => (
              <tr key={n.id}>
                <td style={td}>
                  <div style={{ fontWeight: 600 }}>{n.nombre}</div>
                  <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>clave {n.clave}</div>
                </td>
                <td style={td}>{nombreDe(n.padreClave)}</td>
                <td style={td} title={FUENTES_NIVEL[n.fuente].ayuda}>
                  {FUENTES_NIVEL[n.fuente].texto}
                  {n.claveFuente && <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>{n.claveFuente}</div>}
                </td>
                <td style={td}>{n.heredado ? <span style={etiqueta("#6b7684", "#eef1f4")}>Plantilla de la empresa</span> : <span style={etiqueta("#2e6b22", "#e3f3de")}>Este proyecto</span>}</td>
                <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                  {datos.puedeEditarProyecto && (
                    <button type="button" style={accion} onClick={() => setEditar(n.heredado ? { nivel: null, plantilla: false, base: n } : { nivel: propios.get(n.clave) ?? n, plantilla: false })}>
                      {n.heredado ? "Cambiar en este proyecto" : "Cambiar"}
                    </button>
                  )}
                  {datos.puedeEditarPlantilla && n.heredado && (
                    <button type="button" style={accion} onClick={() => setEditar({ nivel: datos.plantilla.find((p) => p.clave === n.clave) ?? n, plantilla: true })}>
                      Cambiar en la plantilla
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {inactivos.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={desactivados} onChange={(e) => setDesactivados(e.target.checked)} />
            Ver los niveles desactivados ({inactivos.length})
          </label>
          {desactivados && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 13 }}>
              {inactivos.map(({ nivel, plantilla }) => (
                <li key={nivel.id}>
                  {nivel.nombre} ({plantilla ? "plantilla de la empresa" : "este proyecto"}){" "}
                  <button type="button" style={accion} onClick={() => setEditar({ nivel, plantilla })}>
                    Reactivar o cambiar
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {editar && (
        <NivelDialog
          api={api}
          datos={datos}
          editar={editar}
          onClose={() => setEditar(null)}
          onGuardado={(d) => {
            onDatos(d);
            setEditar(null);
          }}
          onRecargar={onRecargar}
          onSinAcceso={onSinAcceso}
        />
      )}
    </section>
  );
}

function NivelDialog({
  api,
  datos,
  editar,
  onClose,
  onGuardado,
  onRecargar,
  onSinAcceso,
}: {
  api: ObraApi;
  datos: EstructuraResponse;
  editar: EditNivel;
  onClose: () => void;
  onGuardado: (d: EstructuraResponse) => void;
  onRecargar: () => void;
  onSinAcceso: (err: unknown) => void;
}) {
  const inicial = editar.nivel ?? editar.base;
  const [nombre, setNombre] = useState(inicial?.nombre ?? "");
  const [clave, setClave] = useState(inicial?.clave ?? "");
  const [claveTocada, setClaveTocada] = useState(!!inicial);
  const [orden, setOrden] = useState(String(inicial?.orden ?? (Math.max(0, ...datos.niveles.map((n) => n.orden)) + 1)));
  const [padre, setPadre] = useState(inicial?.padreClave ?? "");
  const [fuente, setFuente] = useState<FuenteNivel>(inicial?.fuente ?? "manual");
  const [claveFuente, setClaveFuente] = useState(inicial?.claveFuente ?? "");
  const [activo, setActivo] = useState(inicial?.activo ?? true);
  const { busy, error, guardar } = useGuardar(onRecargar, onSinAcceso);
  const claveFinal = claveTocada ? clave : claveDe(nombre);
  const ordenN = Number(orden);
  const candidatosPadre = (editar.plantilla ? datos.plantilla.filter((n) => n.activo) : datos.niveles).filter((n) => n.clave !== claveFinal);
  const problema = !nombre.trim()
    ? "Escribe el nombre del nivel."
    : !/^[a-z][a-z0-9_]{1,39}$/.test(claveFinal)
      ? "La clave va en minúsculas, sin tildes ni espacios (p. ej. nombre_de_zona)."
      : !Number.isInteger(ordenN) || ordenN < 0 || ordenN > 999
        ? "El orden es un entero de 0 a 999."
        : fuente !== "manual" && !claveFuente.trim()
          ? fuente === "modelo"
            ? "Escribe la propiedad del modelo."
            : "Escribe el atributo de Propiedades."
          : "";
  const titulo2 = editar.nivel ? `Cambiar el nivel ${editar.nivel.nombre}${editar.plantilla ? " (plantilla de la empresa)" : ""}` : editar.base ? `${editar.base.nombre}: versión propia de este proyecto` : editar.plantilla ? "Nuevo nivel de la plantilla de la empresa" : "Nuevo nivel de este proyecto";

  return (
    <Modal
      title={titulo2}
      width={600}
      onClose={() => !busy && onClose()}
      footer={
        <>
          {problema && <span style={{ fontSize: 13, color: "var(--tc-gray-500)", marginRight: "auto" }}>{problema}</span>}
          <button type="button" onClick={onClose} disabled={busy} style={botonSecundario}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !!problema}
            style={{ ...acceptButton, opacity: problema ? 0.5 : 1 }}
            onClick={() =>
              guardar(async () => {
                const cambio: Omit<CambioNivel, "projectId"> & { plantilla: boolean } = {
                  ...(editar.nivel ? { id: editar.nivel.id } : {}),
                  plantilla: editar.plantilla,
                  clave: claveFinal,
                  nombre: nombre.trim(),
                  orden: ordenN,
                  padreClave: padre || null,
                  fuente,
                  claveFuente: fuente === "manual" ? "" : claveFuente.trim(),
                  activo,
                  version: editar.nivel?.version ?? 0,
                };
                onGuardado(await api.guardarNivel(cambio));
              })
            }
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      <div style={{ padding: 16, display: "grid", gap: 14 }}>
        {editar.base && <Notice kind="info">Se crea una versión de este nivel solo para este proyecto. La plantilla de la empresa no cambia.</Notice>}
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 90px", gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="nivel-nombre">
              Nombre
            </label>
            <input id="nivel-nombre" value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} style={{ ...baseInput, width: "100%" }} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="nivel-clave">
              Clave
            </label>
            <input
              id="nivel-clave"
              value={claveFinal}
              maxLength={40}
              disabled={!!inicial}
              title={inicial ? "La clave no cambia: los registros se ligan a ella." : "Se forma del nombre; puedes cambiarla antes de guardar."}
              onChange={(e) => {
                setClave(e.target.value);
                setClaveTocada(true);
              }}
              style={{ ...baseInput, width: "100%" }}
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="nivel-orden">
              Orden
            </label>
            <input id="nivel-orden" value={orden} onChange={(e) => setOrden(e.target.value)} inputMode="numeric" style={{ ...baseInput, width: "100%" }} />
          </div>
        </div>
        <div>
          <label style={labelStyle} htmlFor="nivel-padre">
            Dentro de (nivel superior)
          </label>
          <select id="nivel-padre" value={padre} onChange={(e) => setPadre(e.target.value)} style={{ ...select, width: "100%" }}>
            <option value="">Ninguno (nivel superior)</option>
            {candidatosPadre.map((n) => (
              <option key={n.clave} value={n.clave}>
                {n.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span style={labelStyle}>De dónde sale el valor de cada elemento</span>
          <div style={{ display: "grid", gap: 6 }}>
            {(Object.keys(FUENTES_NIVEL) as FuenteNivel[]).map((f) => (
              <label key={f} style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "flex-start" }}>
                <input type="radio" name="fuente" checked={fuente === f} onChange={() => setFuente(f)} style={{ marginTop: 3 }} />
                <span>
                  {FUENTES_NIVEL[f].texto}
                  <span style={{ display: "block", fontSize: 12, color: "var(--tc-gray-500)" }}>{FUENTES_NIVEL[f].ayuda}</span>
                </span>
              </label>
            ))}
          </div>
          {fuente !== "manual" && (
            <input
              aria-label={fuente === "modelo" ? "Propiedad del modelo" : "Atributo de Propiedades"}
              placeholder={fuente === "modelo" ? "Nombre de la propiedad, o «Conjunto · Propiedad»" : "Identificador del atributo en Propiedades"}
              value={claveFuente}
              maxLength={200}
              onChange={(e) => setClaveFuente(e.target.value)}
              style={{ ...baseInput, width: "100%", marginTop: 8 }}
            />
          )}
        </div>
        {(editar.nivel || editar.base) && (
          <label style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Nivel activo {editar.base || !editar.plantilla ? "en este proyecto" : "en la plantilla"} (desactivarlo no borra sus valores)
          </label>
        )}
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- values of the levels

function Valores({ api, datos, contactos, onDatos, onRecargar, onSinAcceso }: SeccionProps & { contactos: ProjectContacts | null }) {
  const [nivelClave, setNivelClave] = useState(datos.niveles[0]?.clave ?? "");
  const [editar, setEditar] = useState<{ nodo: Nodo | null } | null>(null);
  const nivel = datos.niveles.find((n) => n.clave === nivelClave) ?? datos.niveles[0];
  const nodos = useMemo(
    () => datos.nodos.filter((n) => n.nivelClave === nivel?.clave).sort((a, b) => rutaNodo(a, datos.nodos).localeCompare(rutaNodo(b, datos.nodos), "es", { numeric: true })),
    [datos.nodos, nivel]
  );
  if (!nivel) return null;
  return (
    <section style={{ ...card, maxWidth: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <h2 style={{ ...titulo, margin: 0 }}>Valores de</h2>
        <select value={nivel.clave} onChange={(e) => setNivelClave(e.target.value)} style={select} aria-label="Nivel">
          {datos.niveles.map((n) => (
            <option key={n.clave} value={n.clave}>
              {n.nombre} ({datos.nodos.filter((x) => x.nivelClave === n.clave).length})
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        {datos.puedeEditarProyecto && (
          <button type="button" onClick={() => setEditar({ nodo: null })} style={{ ...acceptButton, padding: "6px 14px", fontSize: 14 }}>
            ＋ {nivel.nombre}
          </button>
        )}
      </div>
      <p style={{ ...texto, fontSize: 13 }}>
        {nivel.fuente === "manual"
          ? "Valores que se asignan a mano a los elementos."
          : "Los valores que aparezcan en el modelo se agregan solos al leer cada versión (fase siguiente); aquí se les da responsable, fechas y estado."}{" "}
        Un valor no se borra: se deja inactivo.
      </p>
      <div style={{ overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>{nivel.nombre}</th>
              <th style={th}>Responsable</th>
              <th style={th}>Inicio</th>
              <th style={th}>Fin</th>
              <th style={th}>Estado</th>
              <th style={th}>Nota</th>
              <th style={th} aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {nodos.map((n) => {
              const e = ESTADOS_NODO[n.estado];
              return (
                <tr key={n.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{rutaNodo(n, datos.nodos)}</td>
                  <td style={td}>{n.responsableNombre || "—"}</td>
                  <td style={td}>{fecha(n.inicio) || "—"}</td>
                  <td style={td}>{fecha(n.fin) || "—"}</td>
                  <td style={td}>
                    <span style={etiqueta(e.color, e.fondo)}>{e.texto}</span>
                  </td>
                  <td style={{ ...td, fontSize: 12.5, color: "var(--tc-gray-500)" }}>{n.nota}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {datos.puedeEditarProyecto && (
                      <button type="button" style={accion} onClick={() => setEditar({ nodo: n })}>
                        Cambiar
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {nodos.length === 0 && (
              <tr>
                <td style={{ ...td, color: "var(--tc-gray-500)" }} colSpan={7}>
                  Todavía no hay valores de {nivel.nombre.toLowerCase()}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editar && (
        <NodoDialog
          key={editar.nodo?.id ?? "nuevo"}
          api={api}
          datos={datos}
          nivel={nivel}
          nodo={editar.nodo}
          contactos={contactos}
          onClose={() => setEditar(null)}
          onGuardado={(d) => {
            onDatos(d);
            setEditar(null);
          }}
          onRecargar={onRecargar}
          onSinAcceso={onSinAcceso}
        />
      )}
    </section>
  );
}

function NodoDialog({
  api,
  datos,
  nivel,
  nodo,
  contactos,
  onClose,
  onGuardado,
  onRecargar,
  onSinAcceso,
}: {
  api: ObraApi;
  datos: EstructuraResponse;
  nivel: Nivel;
  nodo: Nodo | null;
  contactos: ProjectContacts | null;
  onClose: () => void;
  onGuardado: (d: EstructuraResponse) => void;
  onRecargar: () => void;
  onSinAcceso: (err: unknown) => void;
}) {
  const [valor, setValor] = useState(nodo?.valor ?? "");
  const [padreId, setPadreId] = useState(nodo?.padreId ?? "");
  const [responsable, setResponsable] = useState(nodo?.responsableId ?? "");
  const [inicio, setInicio] = useState(nodo?.inicio ? isoToDisplay(nodo.inicio) : "");
  const [fin, setFin] = useState(nodo?.fin ? isoToDisplay(nodo.fin) : "");
  const [estado, setEstado] = useState<EstadoNodo>(nodo?.estado ?? "activo");
  const [nota, setNota] = useState(nodo?.nota ?? "");
  const { busy, error, guardar } = useGuardar(onRecargar, onSinAcceso);
  const padres = nivel.padreClave ? datos.nodos.filter((n) => n.nivelClave === nivel.padreClave && n.estado !== "inactivo") : [];
  const nombrePadre = nivel.padreClave ? datos.niveles.find((n) => n.clave === nivel.padreClave)?.nombre ?? nivel.padreClave : "";
  const inicioIso = inicio.trim() ? parseDisplayDate(inicio) : null;
  const finIso = fin.trim() ? parseDisplayDate(fin) : null;
  const problema = !valor.trim()
    ? "Escribe el valor."
    : (inicio.trim() && !inicioIso) || (fin.trim() && !finIso)
      ? "Escribe las fechas como DD-MM-AAAA o déjalas vacías."
      : inicioIso && finIso && finIso < inicioIso
        ? "La fecha final no puede ser anterior a la inicial."
        : "";
  const nombreResponsable = (id: string) => contactos?.users.find((u) => u.id === id)?.name ?? (id === nodo?.responsableId ? nodo.responsableNombre : id);

  return (
    <Modal
      title={nodo ? `Cambiar ${nodo.valor}` : `Nuevo valor de ${nivel.nombre.toLowerCase()}`}
      width={600}
      onClose={() => !busy && onClose()}
      footer={
        <>
          {problema && <span style={{ fontSize: 13, color: "var(--tc-gray-500)", marginRight: "auto" }}>{problema}</span>}
          <button type="button" onClick={onClose} disabled={busy} style={botonSecundario}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !!problema}
            style={{ ...acceptButton, opacity: problema ? 0.5 : 1 }}
            onClick={() =>
              guardar(async () => {
                onGuardado(
                  await api.guardarNodo({
                    ...(nodo ? { id: nodo.id } : {}),
                    nivelClave: nivel.clave,
                    valor: valor.trim(),
                    padreId: padreId || null,
                    responsableId: responsable || null,
                    responsableNombre: responsable ? nombreResponsable(responsable) : "",
                    inicio: inicioIso,
                    fin: finIso,
                    estado,
                    nota: nota.trim(),
                    version: nodo?.version ?? 0,
                  })
                );
              })
            }
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      <div style={{ padding: 16, display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: nivel.padreClave ? "1fr 1fr" : "1fr", gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="nodo-valor">
              {nivel.nombre}
            </label>
            <input id="nodo-valor" value={valor} maxLength={120} onChange={(e) => setValor(e.target.value)} placeholder={nivel.clave === "torre" ? "Torre 1" : nivel.clave === "nivel" ? "Piso 5" : ""} style={{ ...baseInput, width: "100%" }} />
          </div>
          {nivel.padreClave && (
            <div>
              <label style={labelStyle} htmlFor="nodo-padre">
                Dentro de ({nombrePadre})
              </label>
              <select id="nodo-padre" value={padreId} onChange={(e) => setPadreId(e.target.value)} style={{ ...select, width: "100%" }}>
                <option value="">Sin indicar</option>
                {padres.map((p) => (
                  <option key={p.id} value={p.id}>
                    {rutaNodo(p, datos.nodos)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div>
          <label style={labelStyle} htmlFor="nodo-responsable">
            Responsable
          </label>
          <select id="nodo-responsable" value={responsable} onChange={(e) => setResponsable(e.target.value)} style={{ ...select, width: "100%" }}>
            <option value="">Sin asignar</option>
            {nodo?.responsableId && !contactos?.users.some((u) => u.id === nodo.responsableId) && <option value={nodo.responsableId}>{nodo.responsableNombre}</option>}
            {(contactos?.users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="nodo-inicio">
              Inicio
            </label>
            <DateField id="nodo-inicio" text={inicio} placeholder="DD-MM-AAAA" invalid={!!inicio.trim() && !inicioIso} onText={setInicio} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="nodo-fin">
              Fin
            </label>
            <DateField id="nodo-fin" text={fin} placeholder="DD-MM-AAAA" invalid={!!fin.trim() && !finIso} onText={setFin} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="nodo-estado">
              Estado
            </label>
            <select id="nodo-estado" value={estado} onChange={(e) => setEstado(e.target.value as EstadoNodo)} style={{ ...select, width: "100%" }}>
              {(Object.keys(ESTADOS_NODO) as EstadoNodo[]).map((e) => (
                <option key={e} value={e}>
                  {ESTADOS_NODO[e].texto}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label style={labelStyle} htmlFor="nodo-nota">
            Nota
          </label>
          <input id="nodo-nota" value={nota} maxLength={500} onChange={(e) => setNota(e.target.value)} style={{ ...baseInput, width: "100%" }} />
        </div>
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

const accion: CSSProperties = { ...linkButton, color: "var(--tc-blue-700)", fontSize: 13, padding: "2px 6px" };
