"use client";

import { ReactNode, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import type { GrupoEquipo, IntentoTrimble, PasoPrueba, PersonaEquipo, PruebaResponse, VersionTrimble } from "../../lib/flujo-aprobacion/types";
import { botonSecundario, card, linkBtn, select, td, texto, th, titulo } from "../compras/estilos";
import Explorador, { Elegido } from "../publicar/Explorador";
import { acceptButton, C, labelStyle, message, Notice } from "../presupuesto/ui";

interface Linea {
  paso: string;
  ok: boolean;
  mensaje: string;
}

type Respuesta = "" | "sí" | "no" | "no sé";

const PREGUNTAS = {
  enlace: "¿El enlace abrió el archivo en Trimble?",
  visor: "¿La copia se ve en el visor sin «Conversión en curso»?",
  tarea: "¿La tarea aparece en ToDo de Trimble, con el archivo?",
  correo: "¿A la persona o al grupo le llegó el correo de Trimble?",
} as const;
type Pregunta = keyof typeof PREGUNTAS;

interface InfoArchivo {
  nombre: string;
  revision: number | null;
  enlaces: { visor: string; carpeta: string | null };
  versiones: VersionTrimble[];
  ruta: string | null;
  intentos: IntentoTrimble[];
}

const contar = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** "3 personas en el proyecto (1 administrador, 1 invitada sin entrar aún)." */
function resumenPersonas(personas: PersonaEquipo[]): string {
  const admins = personas.filter((p) => p.admin).length;
  const pendientes = personas.filter((p) => p.pendiente).length;
  return `${contar(personas.length, "persona", "personas")} en el proyecto (${contar(admins, "administrador", "administradores")}${pendientes ? `, ${contar(pendientes, "invitada sin entrar aún", "invitadas sin entrar aún")}` : ""}).`;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cadena = (v: unknown) => (typeof v === "string" ? v : "");
const boton = (activo: boolean) => ({ ...acceptButton, padding: "6px 14px", fontSize: 14, opacity: activo ? 1 : 0.5, cursor: activo ? "pointer" : "not-allowed" });

function Paso({ n, nombre, children }: { n: number; nombre: string; children: ReactNode }) {
  return (
    <section style={card}>
      <h2 style={titulo}>
        {n}. {nombre}
      </h2>
      {children}
    </section>
  );
}

function Contestar({ pregunta, valor, onCambio }: { pregunta: Pregunta; valor: Respuesta; onCambio: (v: Respuesta) => void }) {
  return (
    <fieldset style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: "6px 12px", margin: "10px 0 0", fontSize: 14 }}>
      <legend style={{ fontSize: 13.5, color: "var(--tc-gray-700)" }}>{PREGUNTAS[pregunta]}</legend>
      {(["sí", "no", "no sé"] as const).map((v) => (
        <label key={v} style={{ marginRight: 16, cursor: "pointer" }}>
          <input type="radio" name={pregunta} checked={valor === v} onChange={() => onCambio(v)} /> {v}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Phase 0: with the user's own session, reads the team (people, groups and
 * their members), a file's versions and its direct link, copies its latest
 * version to another folder of this project and creates a test ToDo assigned
 * to a person or a group. The person answers what only they can see in
 * Trimble, and copies the summary back.
 */
export default function PruebaFase0({ api, projectId, projectName }: { api: FlujoApi; projectId: string; projectName: string }) {
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [equipo, setEquipo] = useState<{ personas: PersonaEquipo[]; grupos: GrupoEquipo[] } | null>(null);
  const [archivo, setArchivo] = useState<Elegido | null>(null);
  const [info, setInfo] = useState<InfoArchivo | null>(null);
  const [carpeta, setCarpeta] = useState<Elegido | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [copiaId, setCopiaId] = useState<string | null>(null);
  const [recargaDestino, setRecargaDestino] = useState(0);
  const [asignado, setAsignado] = useState("");
  const [tarea, setTarea] = useState<Record<string, unknown> | null>(null);
  const [respuestas, setRespuestas] = useState<Record<Pregunta, Respuesta>>({ enlace: "", visor: "", tarea: "", correo: "" });
  const [copiado, setCopiado] = useState(false);

  const anotar = (paso: string, ok: boolean, mensaje: string) => setLineas((ls) => [...ls, { paso, ok, mensaje }]);
  const responder = (p: Pregunta) => (v: Respuesta) => setRespuestas((r) => ({ ...r, [p]: v }));

  /** Runs one step and writes its line; an error of the request is a failed line. */
  async function correr(nombre: string, paso: PasoPrueba, datos: Record<string, string>): Promise<PruebaResponse | null> {
    try {
      const r = await api.prueba(paso, datos);
      anotar(nombre, r.ok, r.mensaje);
      return r;
    } catch (err) {
      anotar(nombre, false, message(err));
      return null;
    }
  }

  async function con(clave: string, f: () => Promise<void>) {
    setOcupado(clave);
    try {
      await f();
    } finally {
      setOcupado(null);
    }
  }

  const leerEquipo = () =>
    con("equipo", async () => {
      const r = await correr("Personas y grupos", "equipo", {});
      if (!r) return;
      const personas = (r.datos.personas as PersonaEquipo[]) ?? [];
      setEquipo({ personas, grupos: (r.datos.grupos as GrupoEquipo[]) ?? [] });
      const yo = cadena(r.datos.yo);
      if (!asignado && personas.some((p) => p.id === yo)) setAsignado(`persona:${yo}`);
    });

  const leerArchivo = () =>
    con("archivo", async () => {
      if (!archivo) return;
      const r = await correr("Versiones y enlace del archivo", "archivo", { fileId: archivo.id });
      if (r?.datos.enlaces) setInfo(r.datos as unknown as InfoArchivo);
    });

  /** Waits for Trimble to confirm a copy made through the server (up to 2 minutes); the copy's file id. */
  async function confirmarSubida(uploadId: string): Promise<string | null> {
    for (let i = 0; i < 60; i++) {
      const r = await api.prueba("estado-subida", { uploadId }).catch(() => null);
      if (r && (r.datos.status === "DONE" || !r.ok)) {
        anotar("Confirmación de la carga", r.datos.status === "DONE", r.mensaje);
        return r.datos.status === "DONE" ? cadena(r.datos.fileId) || null : null;
      }
      await esperar(2000);
    }
    anotar("Confirmación de la carga", false, "Trimble no confirmó la carga en 2 minutos (puede seguir procesándola).");
    return null;
  }

  const verVisor = (fileId: string) => correr("Visor de la copia", "estado-visor", { fileId });

  const copiar = (siVersion?: string) =>
    con("copiar", async () => {
      if (!archivo || !carpeta) return;
      setConfirmar(null);
      const datos: Record<string, string> = { fileId: archivo.id, carpetaId: carpeta.id, ...(siVersion ? { siVersion } : {}) };
      let r = await correr(siVersion ? "Copia como versión nueva" : "Copia a la carpeta destino", "copiar", datos);
      if (r?.datos.reintentarSinModelo) r = await correr("Copia otra vez, sin el modelo convertido", "copiar", { ...datos, sinModelo: "1" });
      if (!r) return;
      if (r.datos.confirmar) {
        setConfirmar(cadena(r.datos.versionId) || null);
        return;
      }
      if (!r.ok) return;
      const fileId = r.datos.metodo === "servidor" ? await confirmarSubida(cadena(r.datos.uploadId)) : cadena(r.datos.fileId) || null;
      setCopiaId(fileId);
      setRecargaDestino((n) => n + 1);
      if (fileId) await verVisor(fileId);
    });

  const crearTarea = () =>
    con("tarea", async () => {
      if (!archivo || !asignado) return;
      const [tipo, id] = asignado.split(":");
      const nombre = tipo === "grupo" ? equipo?.grupos.find((g) => g.id === id)?.nombre : equipo?.personas.find((p) => p.id === id)?.nombre;
      const r = await correr("Tarea (ToDo) en Trimble", "tarea", { fileId: archivo.id, asignadoTipo: tipo, asignadoId: id, asignadoNombre: nombre ?? "" });
      if (r) setTarea(r.datos);
    });

  const resumen = [
    `Flujos documentales – fase 0 – ${projectName || projectId} – ${fechaHora(new Date().toISOString())}`,
    ...lineas.map((l) => `${l.ok ? "✓" : "✗"} ${l.paso}: ${l.mensaje}`),
    ...(equipo ? [`Grupos: ${equipo.grupos.map((g) => `${g.nombre} (${g.miembros === null ? "sin miembros leídos" : contar(g.miembros.length, "miembro leído", "miembros leídos")}${g.total !== null ? `, Trimble dice ${g.total}` : ""})`).join("; ") || "ninguno"}`] : []),
    ...(info
      ? [
          `Versiones (${info.ruta ?? "sin lista"}): ${info.versiones.map((v) => `v${v.revision ?? "?"} ${v.fecha ? fechaHora(v.fecha) : "sin fecha"} ${v.subio || "sin nombre"}${v.creo ? ` (creó: ${v.creo})` : ""}`).join("; ") || "ninguna"}`,
          ...info.intentos.filter((i) => i.detalle).map((i) => `  ${i.formato}: ${i.http} ${i.detalle}`),
        ]
      : []),
    ...(tarea
      ? [
          `Tarea: tipos ${Array.isArray(tarea.tipos) ? (tarea.tipos as string[]).join(", ") || "ninguno" : `sin lista (${String(tarea.tiposHttp)})`}; formato aceptado: ${cadena(tarea.formato) || "ninguno"}; adjunto: ${cadena(tarea.adjunto) || "no"}; asignados leídos: ${cadena(tarea.asignados) || "sin dato"}; cerrar: ${cadena(tarea.cierre) || "no se probó"}${tarea.estadoCerrada ? ` (estado leído después: ${cadena(tarea.estadoCerrada)})` : ""}`,
          ...[...((tarea.intentos as IntentoTrimble[]) ?? []), ...((tarea.intentosAdjunto as IntentoTrimble[]) ?? [])].map((i) => `  ${i.formato}: ${i.http}${i.detalle ? ` ${i.detalle}` : ""}`),
        ]
      : []),
    ...(Object.keys(PREGUNTAS) as Pregunta[]).filter((p) => respuestas[p]).map((p) => `${PREGUNTAS[p]} ${respuestas[p]}`),
  ].join("\n");

  async function copiarResumen() {
    try {
      await navigator.clipboard.writeText(resumen);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // The textarea stays selectable to copy by hand.
    }
  }

  const libre = ocupado === null;

  return (
    <>
      <Notice kind="info" style={{ maxWidth: 900 }}>
        <strong>Fase 0: prueba en Trimble real.</strong> Comprueba, con tu usuario, lo que el flujo necesita de Trimble: el equipo y sus grupos, quién subió cada versión, el
        enlace directo, la copia a la carpeta destino y la tarea (ToDo) que le avisa al revisor. No guarda nada en la base de datos ni borra nada: deja una copia en la carpeta
        que elijas y una tarea de prueba que puedes borrar después. Al final, copia el resumen y pégamelo.
      </Notice>

      <Paso n={1} nombre="Equipo del proyecto">
        <p style={texto}>Las personas y los grupos de Trimble de los que el administrador elegirá a quién revisa y aprueba en cada flujo.</p>
        <button type="button" disabled={!libre} onClick={leerEquipo} style={boton(libre)}>
          {ocupado === "equipo" ? "Leyendo…" : "Leer personas y grupos"}
        </button>
        {equipo && (
          <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 10 }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>Grupo</th>
                  <th style={th}>Miembros</th>
                </tr>
              </thead>
              <tbody>
                {equipo.grupos.length === 0 && (
                  <tr>
                    <td style={td} colSpan={2}>
                      El proyecto no tiene grupos.
                    </td>
                  </tr>
                )}
                {equipo.grupos.map((g) => (
                  <tr key={g.id}>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{g.nombre}</td>
                    <td style={td}>{g.miembros === null ? <em>Trimble no dio los miembros</em> : g.miembros.join(", ") || <em>sin miembros</em>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ ...texto, margin: "8px 0 0", fontSize: 13 }}>{resumenPersonas(equipo.personas)}</p>
          </div>
        )}
      </Paso>

      <Paso n={2} nombre="Archivo a revisar">
        <p style={texto}>Elige un archivo con varias versiones (un modelo .rvt, un plano .pdf o .dwg): se leen sus versiones, quién subió cada una y su enlace directo.</p>
        <Explorador api={api} proyecto={projectId} elegir="archivo" seleccionados={archivo ? [archivo.id] : []} onElegir={(e) => {
          setArchivo((a) => (a?.id === e.id ? null : e));
          setInfo(null);
          setConfirmar(null);
          setCopiaId(null);
        }} />
        <div style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" disabled={!libre || !archivo} onClick={leerArchivo} style={boton(libre && !!archivo)}>
            {ocupado === "archivo" ? "Leyendo…" : "Leer versiones y enlace"}
          </button>
          <span style={{ fontSize: 13.5, color: "var(--tc-gray-500)" }}>{archivo ? archivo.ruta : "Ningún archivo elegido."}</span>
        </div>
        {info && (
          <>
            {info.versiones.length > 0 && (
              <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 10 }}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={th}>Versión</th>
                      <th style={th}>Fecha</th>
                      <th style={th}>Subió</th>
                    </tr>
                  </thead>
                  <tbody>
                    {info.versiones.map((v) => (
                      <tr key={v.versionId}>
                        <td style={td}>v{v.revision ?? "?"}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{v.fecha ? fechaHora(v.fecha) : ""}</td>
                        <td style={td}>
                          {v.subio || <em>sin dato</em>}
                          {v.creo && <span style={{ color: "var(--tc-gray-500)" }}> (creó el archivo: {v.creo})</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p style={{ ...texto, margin: "10px 0 0" }}>
              <a href={info.enlaces.visor} target="_blank" rel="noopener noreferrer" style={linkBtn}>
                Abrir el archivo en Trimble
              </a>
              {info.enlaces.carpeta && (
                <>
                  {" · "}
                  <a href={info.enlaces.carpeta} target="_blank" rel="noopener noreferrer" style={linkBtn}>
                    Abrir su carpeta
                  </a>
                </>
              )}{" "}
              (se abren en otra pestaña)
            </p>
            <Contestar pregunta="enlace" valor={respuestas.enlace} onCambio={responder("enlace")} />
          </>
        )}
      </Paso>

      <Paso n={3} nombre="Copia a la carpeta destino">
        <p style={texto}>
          Copia la última versión del archivo a otra carpeta de este proyecto, con el mismo nombre, como hará el flujo al aprobar. Si la carpeta ya tiene un archivo con ese
          nombre, se pide confirmación y debe llegar como versión nueva.
        </p>
        <Explorador api={api} proyecto={projectId} elegir="carpeta" recarga={recargaDestino} seleccionados={carpeta ? [carpeta.id] : []} onElegir={(e) => {
          setCarpeta(e);
          setConfirmar(null);
        }} />
        <div style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" disabled={!libre || !archivo || !carpeta} onClick={() => copiar()} style={boton(libre && !!archivo && !!carpeta)}>
            {ocupado === "copiar" ? "Copiando…" : "Copiar la última versión"}
          </button>
          {confirmar && (
            <button type="button" disabled={!libre} onClick={() => copiar(confirmar)} style={{ ...botonSecundario, padding: "6px 14px", fontSize: 14 }}>
              Copiar como versión nueva
            </button>
          )}
          {copiaId && (
            <button type="button" disabled={!libre} onClick={() => con("visor", async () => void (await verVisor(copiaId)))} style={{ ...botonSecundario, padding: "6px 14px", fontSize: 14 }}>
              Ver otra vez el estado del visor
            </button>
          )}
          <span style={{ fontSize: 13.5, color: "var(--tc-gray-500)" }}>{!archivo ? "Primero elige el archivo (paso 2)." : carpeta ? `Destino: ${carpeta.ruta}` : "Abre la carpeta destino y pulsa «Usar esta carpeta»."}</span>
        </div>
        {copiaId && <Contestar pregunta="visor" valor={respuestas.visor} onCambio={responder("visor")} />}
      </Paso>

      <Paso n={4} nombre="Tarea (ToDo) para el revisor">
        <p style={texto}>
          Crea en Trimble una tarea de prueba asignada a una persona o a un grupo, con el archivo adjunto: es el aviso que recibirá el revisor. Trimble puede mandarle un correo:
          elígete a ti o a alguien que sepa de la prueba.
        </p>
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <label style={{ fontSize: 14 }}>
            <span style={labelStyle}>Asignar a</span>
            <select value={asignado} onChange={(e) => setAsignado(e.target.value)} style={{ ...select, minWidth: 260 }} disabled={!equipo}>
              <option value="">{equipo ? "Elige…" : "Primero lee el equipo (paso 1)"}</option>
              {equipo && equipo.personas.length > 0 && (
                <optgroup label="Personas">
                  {equipo.personas.map((p) => (
                    <option key={p.id} value={`persona:${p.id}`}>
                      {p.nombre}
                      {p.email && p.email !== p.nombre ? ` (${p.email})` : ""}
                    </option>
                  ))}
                </optgroup>
              )}
              {equipo && equipo.grupos.length > 0 && (
                <optgroup label="Grupos">
                  {equipo.grupos.map((g) => (
                    <option key={g.id} value={`grupo:${g.id}`}>
                      {g.nombre}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <button type="button" disabled={!libre || !archivo || !asignado} onClick={crearTarea} style={boton(libre && !!archivo && !!asignado)}>
            {ocupado === "tarea" ? "Creando…" : "Crear tarea de prueba"}
          </button>
        </div>
        {tarea && (
          <>
            <Contestar pregunta="tarea" valor={respuestas.tarea} onCambio={responder("tarea")} />
            <Contestar pregunta="correo" valor={respuestas.correo} onCambio={responder("correo")} />
          </>
        )}
      </Paso>

      <section style={card}>
        <h2 style={titulo}>Resultado</h2>
        {lineas.length === 0 ? (
          <p style={{ ...texto, margin: 0 }}>Todavía no has corrido ningún paso.</p>
        ) : (
          <>
            <ul style={{ margin: "0 0 12px", paddingLeft: 0, listStyle: "none", display: "grid", gap: 6 }}>
              {lineas.map((l, i) => (
                <li key={i} style={{ fontSize: 14, lineHeight: 1.45 }}>
                  <span style={{ color: l.ok ? "#1e7b34" : "#b42318", fontWeight: 700, marginRight: 6 }}>{l.ok ? "✓" : "✗"}</span>
                  <strong>{l.paso}:</strong> {l.mensaje}
                </li>
              ))}
            </ul>
            <label style={labelStyle} htmlFor="resumen-fase0">
              Resumen para pegarle a Claude
            </label>
            <textarea id="resumen-fase0" readOnly value={resumen} rows={Math.min(16, resumen.split("\n").length + 1)} style={{ width: "100%", boxSizing: "border-box", fontFamily: "Consolas, monospace", fontSize: 12.5, border: `1px solid ${C.border}`, borderRadius: 4, padding: 8 }} onFocus={(e) => e.target.select()} />
            <button type="button" onClick={copiarResumen} style={{ ...botonSecundario, padding: "6px 14px", fontSize: 14, marginTop: 8 }}>
              {copiado ? "Copiado ✓" : "Copiar resumen"}
            </button>
          </>
        )}
      </section>
    </>
  );
}
