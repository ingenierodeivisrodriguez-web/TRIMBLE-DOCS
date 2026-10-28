"use client";

import { useCallback, useEffect, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import type { PublicarApi } from "../../lib/publicar/client";
import type { Comprobacion, CuentaInfo } from "../../lib/publicar/types";
import { acceptButton, baseInput, C, labelStyle, message, Notice } from "../presupuesto/ui";
import { botonPeligro, botonSecundario, card, td, texto, titulo } from "../compras/estilos";

/**
 * "Usuario en ambos proyectos": the Trimble user who belongs to both
 * projects, connected so copies don't wait for them to open the extension.
 * Everyone sees whether it's connected, what permissions it needs and what
 * it can do in this project; the people in PUBLICAR_ADMINS connect or
 * disconnect it.
 */
export default function CuentaTab({ api }: { api: PublicarApi }) {
  const [cuenta, setCuenta] = useState<CuentaInfo | null>(null);
  const [comprobaciones, setComprobaciones] = useState<Comprobacion[] | null>(null);
  const [url, setUrl] = useState("");
  const [enlace, setEnlace] = useState("");
  const [resultado, setResultado] = useState<{ ok: boolean; titulo: string; texto: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    api
      .cuenta()
      .then(setCuenta)
      .catch((err) => setError(message(err)));
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function hacer(accion: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await accion();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const correo = cuenta?.email || "el usuario que pertenece a los dos proyectos";

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 900 }}>
      <section style={card}>
        <h2 style={titulo}>Usuario en ambos proyectos</h2>
        <p style={texto}>
          Las copias las hace un usuario que pertenece a los dos proyectos (por ejemplo, quien publica, invitado también como usuario en el proyecto que recibe). Los
          demás siguen entrando solo a su proyecto. Si esa persona abre la extensión, copia con su sesión. Si conecta aquí su cuenta, las versiones nuevas llegan
          cuando cualquiera abre la extensión en cualquiera de los dos proyectos, aunque ella no la abra.
        </p>
        {!cuenta ? (
          <p style={{ ...texto, color: "var(--tc-gray-500)" }}>Cargando…</p>
        ) : cuenta.conectada ? (
          <Notice kind="info">
            Conectada: <strong>{cuenta.nombre ? `${cuenta.nombre} (${cuenta.email})` : cuenta.email}</strong>
            {cuenta.conectadaEn ? ` · desde el ${fechaHora(cuenta.conectadaEn)}` : ""}
            {cuenta.conectadaPor ? ` por ${cuenta.conectadaPor}` : ""}
            {cuenta.renovadaEn ? ` · sesión renovada el ${fechaHora(cuenta.renovadaEn)}` : ""}.
          </Notice>
        ) : (
          <Notice kind="warning">No hay una cuenta conectada: las versiones nuevas llegan solo cuando la persona que pertenece a los dos proyectos abre la extensión.</Notice>
        )}
        {cuenta && cuenta.faltan.length > 0 && (
          <Notice kind="warning" style={{ marginTop: 8 }}>
            Falta configurar en Vercel: {cuenta.faltan.join("; ")}.
          </Notice>
        )}
      </section>

      <section style={card}>
        <h2 style={titulo}>Qué necesita en este proyecto</h2>
        <ol style={{ ...texto, paddingLeft: 20 }}>
          <li>
            Que <strong>{correo}</strong> sea miembro de este proyecto (si no lo es: Equipo → Invitar; basta como usuario).
          </li>
          <li>
            Si este proyecto <strong>publica</strong>: dale permiso de <strong>lectura</strong> en las carpetas que se publican.
          </li>
          <li>
            Si este proyecto <strong>recibe</strong>: dale <strong>acceso completo</strong> en la carpeta de recepción (para que pueda subir los archivos).
          </li>
          <li>Pulsa &quot;Revisar el acceso en este proyecto&quot; para confirmar que quedó bien.</li>
        </ol>
        <button type="button" disabled={busy} onClick={() => hacer(async () => setComprobaciones((await api.revisarCuenta()).comprobaciones))} style={{ ...botonSecundario, padding: "6px 14px", fontSize: 14 }}>
          {busy ? "Revisando…" : "Revisar el acceso en este proyecto"}
        </button>
        {comprobaciones && (
          <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 10 }}>
            <tbody>
              {comprobaciones.map((c, i) => (
                <tr key={i}>
                  <td style={{ ...td, width: 24, fontSize: 16, color: c.ok ? "#2e6b22" : "#b3261e" }}>{c.ok ? "✔" : "✖"}</td>
                  <td style={{ ...td, fontWeight: 600, whiteSpace: "nowrap" }}>{c.que}</td>
                  <td style={td}>{c.mensaje}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {cuenta && (
        <section style={card}>
          <h2 style={titulo}>Conectar la cuenta</h2>
          {!cuenta.administra ? (
            <p style={{ ...texto, marginBottom: 0 }}>
              La conecta una persona autorizada en la variable <code>PUBLICAR_ADMINS</code> de Vercel. Tu id de Trimble es <code>{cuenta.miId}</code>.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              <ol style={{ ...texto, paddingLeft: 20, marginBottom: 0 }}>
                <li>Pulsa &quot;Conectar&quot; y abre el inicio de sesión de Trimble.</li>
                <li>
                  Entra con el usuario que <strong>pertenece a los dos proyectos</strong> (puede ser el tuyo).
                </li>
                <li>
                  Al terminar, el navegador va a una página que no carga (<code>http://localhost/?code=…</code>): copia esa dirección completa y pégala aquí.
                </li>
              </ol>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" disabled={busy} onClick={() => hacer(async () => setUrl((await api.conectarCuenta()).url))} style={{ ...acceptButton, padding: "6px 14px", fontSize: 14 }}>
                  {cuenta.conectada ? "Conectar otra vez" : "Conectar"}
                </button>
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 14, fontWeight: 600, color: "var(--tc-blue-700)" }}>
                    Abrir el inicio de sesión de Trimble (vale 10 minutos)
                  </a>
                )}
              </div>
              {url && (
                <div>
                  <label style={labelStyle} htmlFor="enlace-cuenta">
                    Dirección a la que te llevó Trimble
                  </label>
                  <textarea id="enlace-cuenta" rows={2} value={enlace} onChange={(e) => setEnlace(e.target.value)} placeholder="http://localhost/?code=…&state=…" style={{ ...baseInput, width: "100%", fontFamily: "monospace" }} />
                  <button
                    type="button"
                    disabled={busy || !enlace.trim()}
                    onClick={() =>
                      hacer(async () => {
                        const r = await api.completarCuenta(enlace);
                        setResultado(r);
                        if (r.ok) {
                          setUrl("");
                          setEnlace("");
                          cargar();
                        }
                      })
                    }
                    style={{ ...acceptButton, padding: "6px 14px", fontSize: 14, marginTop: 6, opacity: enlace.trim() ? 1 : 0.5 }}
                  >
                    Terminar la conexión
                  </button>
                </div>
              )}
              {resultado && (
                <Notice kind={resultado.ok ? "info" : "error"}>
                  <strong>{resultado.titulo}.</strong> {resultado.texto}
                </Notice>
              )}
              {cuenta.conectada && (
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("¿Desconectar la cuenta? Las versiones nuevas llegarán solo cuando la persona que pertenece a los dos proyectos abra la extensión.")) {
                        hacer(async () => setCuenta(await api.desconectarCuenta()));
                      }
                    }}
                    style={{ ...botonPeligro, padding: "6px 14px", fontSize: 14 }}
                  >
                    Desconectar
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}
