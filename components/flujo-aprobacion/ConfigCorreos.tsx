"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import { advertenciasCorreo, ConfigCorreo, DATOS_TEXTO, idDeExtension, MAX_COPIA, separarCorreos, TEXTOS_INICIALES, TextoCorreo } from "../../lib/flujo-aprobacion/configCorreo";
import { armarCorreo, datosEjemplo, enlaceExtension, EstadoCorreos, ID_EXTENSION } from "../../lib/flujo-aprobacion/correo";
import { baseInput, labelStyle, message, Modal, Notice } from "../presupuesto/ui";

type Tipo = "revision" | "correccion";

/** What the window edits: the settings, with the copy and the extension's address as typed. */
interface Formulario {
  activo: boolean;
  tareasTrimble: boolean;
  eventos: ConfigCorreo["eventos"];
  recordatorios: boolean;
  textos: ConfigCorreo["textos"];
  copia: string;
  enlace: string;
}

const deEstado = (e: EstadoCorreos): Formulario => ({
  activo: e.config.activo,
  tareasTrimble: e.config.tareasTrimble,
  eventos: { ...e.config.eventos },
  recordatorios: e.config.recordatorios,
  textos: { revision: { ...e.config.textos.revision }, correccion: { ...e.config.textos.correccion } },
  copia: e.config.copia.join(", "),
  enlace: e.config.idExtension ? e.enlace : "",
});

const NOMBRES: Record<Tipo, string> = { revision: "Te toca un paso", correccion: "Archivo rechazado" };
const AZUL = "#2f4f8f";

const seccion: CSSProperties = { background: "#fff", border: "1px solid #dfe4ea", borderRadius: 4, padding: "12px 14px", display: "grid", gap: 8 };
const titulo: CSSProperties = { margin: 0, fontSize: 14, fontWeight: 600, color: "var(--tc-gray-700)" };
const ayuda: CSSProperties = { fontSize: 12.5, color: "var(--tc-gray-500)", margin: 0, lineHeight: 1.45 };
const boton = (principal: boolean, apagado = false): CSSProperties => ({
  border: principal ? "none" : `1px solid ${AZUL}`,
  background: principal ? AZUL : "#fff",
  color: principal ? "#fff" : AZUL,
  borderRadius: 3,
  padding: "8px 18px",
  fontSize: 14,
  fontWeight: 600,
  cursor: apagado ? "default" : "pointer",
  opacity: apagado ? 0.5 : 1,
  fontFamily: "inherit",
});

function Casilla({ marcada, onCambio, children, nota }: { marcada: boolean; onCambio: (v: boolean) => void; children: ReactNode; nota?: string }) {
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5, color: "var(--tc-gray-700)", cursor: "pointer" }}>
      <input type="checkbox" checked={marcada} onChange={(e) => onCambio(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        {children}
        {nota && <span style={{ ...ayuda, display: "block", marginTop: 2 }}>{nota}</span>}
      </span>
    </label>
  );
}

/**
 * «Correos de aviso» (administrators, phase 2 of the e-mails, 11-11-2026): what
 * goes, when, its texts with data in braces, the copy and the extension's
 * address in this project, with a preview of the e-mail as it is typed.
 */
export default function ConfigCorreos({ api, projectId, projectName, onClose }: { api: FlujoApi; projectId: string; projectName: string; onClose: () => void }) {
  const [estado, setEstado] = useState<EstadoCorreos | null>(null);
  const [form, setForm] = useState<Formulario | null>(null);
  const [tipo, setTipo] = useState<Tipo>("revision");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState<{ kind: "info" | "error"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<"" | "guardar" | "prueba">("");
  const [cerrando, setCerrando] = useState(false);
  const campo = useRef<"asunto" | "intro">("intro");

  useEffect(() => {
    api
      .correos()
      .then((e) => {
        setEstado(e);
        setForm(deEstado(e));
      })
      .catch((err) => setError(message(err)));
  }, [api]);

  const inicial = useMemo(() => (estado ? JSON.stringify(deEstado(estado)) : ""), [estado]);
  const cambiado = !!form && JSON.stringify(form) !== inicial;
  const config: ConfigCorreo | null = form
    ? { ...form, copia: separarCorreos(form.copia), idExtension: idDeExtension(form.enlace, projectId).id }
    : null;
  const advertencias = config && estado ? advertenciasCorreo(config, estado.configurado) : [];
  // The button's address: the one pasted; empty, the server's default (estado.enlace while nothing was saved).
  const enlaceBoton =
    !config || !estado ? "" : config.idExtension ? enlaceExtension(projectId, config.idExtension) : estado.config.idExtension ? enlaceExtension(projectId, ID_EXTENSION) : estado.enlace;
  const errorEnlace = form ? idDeExtension(form.enlace, projectId).error : null;
  const copias = form ? separarCorreos(form.copia) : [];

  const vista = useMemo(() => {
    if (!form) return null;
    const d = { ...datosEjemplo(projectId, new Date(), tipo), prueba: false };
    return armarCorreo(d, { nombre: "Juan Pérez" }, { proyecto: projectName, enlace: enlaceBoton }, form.textos[tipo]);
  }, [form, tipo, projectId, projectName, enlaceBoton]);

  function cambiar(c: Partial<Formulario>) {
    setForm((f) => (f ? { ...f, ...c } : f));
    setAviso(null);
    setCerrando(false);
  }
  function cambiarTexto(c: Partial<TextoCorreo>) {
    if (!form) return;
    cambiar({ textos: { ...form.textos, [tipo]: { ...form.textos[tipo], ...c } } });
  }
  function poner(clave: string) {
    if (!form) return;
    const actual = form.textos[tipo][campo.current];
    cambiarTexto({ [campo.current]: `${actual}${actual && !/\s$/.test(actual) ? " " : ""}{${clave}}` });
  }

  async function guardar() {
    if (!form || !estado) return;
    setOcupado("guardar");
    setAviso(null);
    try {
      const r = await api.guardarCorreos({ ...form }, estado.version);
      setEstado(r);
      setForm(deEstado(r));
      setAviso({ kind: "info", texto: r.mensaje });
    } catch (err) {
      setAviso({ kind: "error", texto: message(err) });
    } finally {
      setOcupado("");
    }
  }
  async function probar() {
    setOcupado("prueba");
    setAviso({ kind: "info", texto: "Enviando el correo de prueba…" });
    try {
      setAviso({ kind: "info", texto: (await api.correoPrueba()).mensaje });
    } catch (err) {
      setAviso({ kind: "error", texto: message(err) });
    } finally {
      setOcupado("");
    }
  }
  const cerrar = () => (cambiado && !cerrando ? setCerrando(true) : onClose());

  const pie = (
    <>
      <button
        type="button"
        onClick={() => void probar()}
        disabled={!!ocupado || cambiado || !estado?.configurado}
        style={{ ...boton(false, !!ocupado || cambiado || !estado?.configurado), marginRight: "auto" }}
        title={!estado?.configurado ? "Falta la cuenta de Gmail en Vercel." : cambiado ? "Guarda primero los cambios: la prueba usa lo guardado." : "Te manda un ejemplo a tu correo con los textos guardados."}
      >
        {ocupado === "prueba" ? "Enviando…" : "Enviar correo de prueba"}
      </button>
      <button type="button" onClick={cerrar} style={boton(false)}>
        {cambiado ? "Cancelar" : "Cerrar"}
      </button>
      <button type="button" onClick={() => void guardar()} disabled={!cambiado || !!ocupado || !!errorEnlace} style={boton(true, !cambiado || !!ocupado || !!errorEnlace)}>
        {ocupado === "guardar" ? "Guardando…" : "Guardar"}
      </button>
    </>
  );

  return (
    <Modal title="Correos de aviso" onClose={cerrar} width={1080} footer={form ? pie : undefined}>
      <div style={{ padding: 14, display: "grid", gap: 12 }}>
        {error && <Notice kind="error">{error}</Notice>}
        {!form && !error && <p style={{ fontSize: 13.5, color: "var(--tc-gray-500)" }}>Cargando…</p>}
        {cerrando && (
          <Notice kind="warning">
            Tienes cambios sin guardar.{" "}
            <button type="button" onClick={onClose} style={{ border: "none", background: "none", color: "#b3261e", fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 13.5 }}>
              Cerrar sin guardar
            </button>{" "}
            <button type="button" onClick={() => setCerrando(false)} style={{ border: "none", background: "none", color: AZUL, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", fontSize: 13.5 }}>
              Seguir editando
            </button>
          </Notice>
        )}
        {aviso && <Notice kind={aviso.kind}>{aviso.texto}</Notice>}
        {form && estado && (
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={seccion}>
                <h3 style={titulo}>Qué se envía</h3>
                <p style={ayuda}>
                  {estado.configurado ? (
                    <>
                      Los correos salen desde <b>{estado.desde}</b>.
                    </>
                  ) : (
                    <span style={{ color: "#b3261e" }}>No hay cuenta de Gmail en Vercel: los correos no saldrán hasta ponerla.</span>
                  )}
                </p>
                <Casilla marcada={form.activo} onCambio={(activo) => cambiar({ activo })}>
                  Enviar los correos de la extensión
                </Casilla>
                <Casilla
                  marcada={form.tareasTrimble}
                  onCambio={(tareasTrimble) => cambiar({ tareasTrimble })}
                  nota="Trimble manda su propio correo con cada tarea. Si lo quitas, solo llega el correo de la extensión y no se crean tareas en Trimble."
                >
                  Crear también la tarea de Trimble
                </Casilla>
              </div>

              <div style={seccion}>
                <h3 style={titulo}>Cuándo</h3>
                <Casilla marcada={form.eventos.revision} onCambio={(revision) => cambiar({ eventos: { ...form.eventos, revision } })}>
                  Cuando a alguien le toca un paso (al entrar el archivo, al pasar al paso siguiente o al reactivar el flujo)
                </Casilla>
                <Casilla marcada={form.eventos.correccion} onCambio={(correccion) => cambiar({ eventos: { ...form.eventos, correccion } })}>
                  Cuando rechazan un archivo (a quien subió la versión)
                </Casilla>
                <Casilla
                  marcada={form.recordatorios}
                  onCambio={(recordatorios) => cambiar({ recordatorios })}
                  nota="A las 7:00, a quien tenga archivos esperando su paso en un flujo vencido: un correo por persona con todos sus vencidos."
                >
                  Recordatorio diario de vencidos
                </Casilla>
              </div>

              <div style={seccion}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <h3 style={titulo}>Textos</h3>
                  <div role="tablist" style={{ display: "flex", gap: 4 }}>
                    {(["revision", "correccion"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="tab"
                        aria-selected={tipo === t}
                        onClick={() => setTipo(t)}
                        style={{ border: `1px solid ${tipo === t ? AZUL : "#cfd6df"}`, background: tipo === t ? "#e8eef9" : "#fff", color: tipo === t ? AZUL : "var(--tc-gray-600)", borderRadius: 14, padding: "3px 12px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
                      >
                        {NOMBRES[t]}
                      </button>
                    ))}
                  </div>
                </div>
                <label>
                  <span style={labelStyle}>Asunto</span>
                  <input
                    value={form.textos[tipo].asunto}
                    onChange={(e) => cambiarTexto({ asunto: e.target.value })}
                    onFocus={() => (campo.current = "asunto")}
                    maxLength={160}
                    style={{ ...baseInput, width: "100%" }}
                  />
                </label>
                <label>
                  <span style={labelStyle}>Texto del comienzo</span>
                  <textarea
                    value={form.textos[tipo].intro}
                    onChange={(e) => cambiarTexto({ intro: e.target.value })}
                    onFocus={() => (campo.current = "intro")}
                    maxLength={600}
                    rows={3}
                    style={{ ...baseInput, width: "100%", resize: "vertical" }}
                  />
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                  <span style={{ ...ayuda, marginRight: 2 }}>Poner un dato:</span>
                  {DATOS_TEXTO.map((d) => (
                    <button
                      key={d.clave}
                      type="button"
                      title={d.que}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => poner(d.clave)}
                      style={{ border: "1px solid #d6dce4", background: "#f4f6f9", borderRadius: 3, padding: "1px 6px", fontSize: 12, color: "var(--tc-gray-600)", cursor: "pointer", fontFamily: "ui-monospace, Consolas, monospace" }}
                    >
                      {`{${d.clave}}`}
                    </button>
                  ))}
                </div>
                <p style={ayuda}>
                  El resto del correo (descripción, vencimiento, archivos, motivo y el botón) siempre va.{" "}
                  {JSON.stringify(form.textos[tipo]) !== JSON.stringify(TEXTOS_INICIALES[tipo]) && (
                    <button type="button" onClick={() => cambiarTexto(TEXTOS_INICIALES[tipo])} style={{ border: "none", background: "none", color: AZUL, padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, textDecoration: "underline" }}>
                      Volver a los textos de antes
                    </button>
                  )}
                </p>
              </div>

              <div style={seccion}>
                <label>
                  <span style={{ ...titulo, display: "block", marginBottom: 6 }}>Enviar copia a</span>
                  <input value={form.copia} onChange={(e) => cambiar({ copia: e.target.value })} placeholder="correo@empresa.com, otro@empresa.com" style={{ ...baseInput, width: "100%" }} />
                </label>
                <p style={ayuda}>
                  Recibe una copia de cada aviso (hasta {MAX_COPIA} correos).{copias.length > MAX_COPIA ? <span style={{ color: "#b3261e" }}> Hay {copias.length}.</span> : null}
                </p>
                <label>
                  <span style={{ ...titulo, display: "block", margin: "6px 0" }}>Dirección de la extensión en este proyecto</span>
                  <input
                    value={form.enlace}
                    onChange={(e) => cambiar({ enlace: e.target.value })}
                    placeholder="Déjala vacía, o pega la dirección del navegador con la extensión abierta"
                    style={{ ...baseInput, width: "100%", ...(errorEnlace ? { border: "1px solid #b3261e" } : {}) }}
                  />
                </label>
                <p style={{ ...ayuda, color: errorEnlace ? "#b3261e" : ayuda.color }}>
                  {errorEnlace ?? (
                    <>
                      El botón del correo abre:{" "}
                      <a href={enlaceBoton} target="_blank" rel="noopener noreferrer" style={{ color: AZUL, wordBreak: "break-all" }}>
                        {enlaceBoton}
                      </a>
                    </>
                  )}
                </p>
              </div>

              {advertencias.length > 0 && (
                <Notice kind="warning">
                  {advertencias.map((a) => (
                    <div key={a}>{a}</div>
                  ))}
                </Notice>
              )}
              {estado.actualizado && (
                <p style={ayuda}>
                  Guardado por {estado.actualizadoPor ?? "—"} el {fechaHora(estado.actualizado)}.
                </p>
              )}
            </div>

            <div style={{ ...seccion, position: "sticky", top: 0, gap: 6 }}>
              <h3 style={titulo}>Vista previa: «{NOMBRES[tipo]}»</h3>
              <p style={ayuda}>Con datos de ejemplo, como lo recibe Juan Pérez.</p>
              {vista && (
                <>
                  <div style={{ fontSize: 13, color: "var(--tc-gray-700)", borderBottom: "1px solid #eef1f5", paddingBottom: 6 }}>
                    <b>Asunto:</b> {vista.asunto}
                    {form.tareasTrimble ? null : <span style={{ ...ayuda, display: "block" }}>Sin tarea de Trimble: este es el único aviso que llega.</span>}
                    {!form.activo || !form.eventos[tipo] ? <span style={{ display: "block", color: "#b3261e", fontSize: 12.5 }}>Este correo no se envía con lo marcado.</span> : null}
                  </div>
                  <iframe title="Vista previa del correo" sandbox="" srcDoc={vista.html} style={{ width: "100%", height: 560, border: "none", background: "#f4f6f9" }} />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
