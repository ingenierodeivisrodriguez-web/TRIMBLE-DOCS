"use client";

import { CSSProperties, useState } from "react";
import type { ManualesApi } from "../../lib/manuales/client";
import type { EstadoManuales } from "../../lib/manuales/types";
import Autorizados from "./Autorizados";

function fecha(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * For administrators of the manuals project: the technical account the app
 * reads the manuals with, and the people authorized to read them.
 */
export default function AdminAcceso({ api, estado, onCambio }: { api: ManualesApi; estado: EstadoManuales; onCambio: () => void }) {
  const admin = estado.admin!;
  const [enlace, setEnlace] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [confirmarDesconexion, setConfirmarDesconexion] = useState(false);
  /** The sign-in was started and its return address must be pasted here (Trimble only returns to http://localhost). */
  const [esperandoRetorno, setEsperandoRetorno] = useState(false);
  const [retorno, setRetorno] = useState("");

  async function conectar() {
    setError("");
    setAviso("");
    // Opened right away (on the click) so the browser doesn't block it; filled once the URL arrives.
    const ventana = window.open("", "_blank");
    setOcupado("Preparando el inicio de sesión...");
    try {
      const { url } = await api.conectar();
      setEnlace(url);
      if (ventana) ventana.location.href = url;
      if (admin.manual) setEsperandoRetorno(true);
      else setAviso("Inicia sesión con la cuenta técnica en la pestaña que se abrió. Al terminar, vuelve aquí y pulsa \"Ya conecté la cuenta\".");
    } catch (err) {
      ventana?.close();
      setError(message(err));
    } finally {
      setOcupado("");
    }
  }

  async function completar() {
    setOcupado("Conectando la cuenta...");
    setError("");
    setAviso("");
    try {
      const r = await api.completar(retorno);
      if (r.ok) {
        setEsperandoRetorno(false);
        setRetorno("");
        setEnlace("");
        setAviso(`${r.titulo}. ${r.texto}`);
        onCambio();
      } else setError(`${r.titulo}: ${r.texto}`);
    } catch (err) {
      setError(message(err));
    } finally {
      setOcupado("");
    }
  }

  async function desconectar() {
    setConfirmarDesconexion(false);
    setOcupado("Desconectando...");
    setError("");
    try {
      await api.desconectar();
      onCambio();
    } catch (err) {
      setError(message(err));
    } finally {
      setOcupado("");
    }
  }

  const cuenta = admin.cuenta;

  return (
    <div style={{ flex: 1, overflow: "auto", background: "#f4f6f9" }}>
      <div style={{ maxWidth: 880, margin: "0 auto", padding: "18px 16px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
        {error && <div style={{ ...nota, background: "#fdecea", border: "1px solid #e5a29c", color: "#8a1c14" }}>{error}</div>}
        {aviso && <div style={{ ...nota, background: "var(--tc-blue-100)", border: "1px solid var(--tc-blue-500)", color: "var(--tc-blue-900)" }}>{aviso}</div>}

        <section style={tarjeta}>
          <h2 style={h2}>Cuenta técnica</h2>
          <p style={p}>
            Manuales lee la carpeta con esta cuenta de Trimble Connect: así las personas autorizadas leen los manuales sin ser miembros de MANAGER
            PROJECT. Usa una cuenta dedicada (por ejemplo <em>manuales@tuempresa.com</em>), miembro solo de MANAGER PROJECT y con permiso de
            lectura sobre la carpeta de manuales.
          </p>
          {!admin.oauthConfigurado ? (
            <div style={{ ...nota, background: "#fff6e0", border: "1px solid #f0c36d", color: "#7a5300" }}>
              Falta la variable <strong>TRIMBLE_CLIENT_SECRET</strong> en Vercel (Settings → Environment Variables) con el Client Secret de la app
              &quot;apibasedatos&quot; de Trimble Developer Console. Agrégala y vuelve a desplegar.
            </div>
          ) : cuenta ? (
            <>
              <p style={{ ...p, fontSize: 15 }}>
                ✅ Conectada como <strong>{cuenta.nombre || cuenta.email}</strong> {cuenta.nombre && cuenta.email ? `(${cuenta.email})` : ""}
              </p>
              <p style={{ ...p, color: "var(--tc-gray-500)", fontSize: 13 }}>
                Desde el {fecha(cuenta.conectadaEn)}
                {cuenta.conectadaPor ? ` · la conectó ${cuenta.conectadaPor}` : ""} · sesión renovada el {fecha(cuenta.renovadaEn)} (se renueva sola cada día).
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={secundario} onClick={conectar} disabled={!!ocupado}>
                  Conectar otra cuenta
                </button>
                {confirmarDesconexion ? (
                  <>
                    <span style={{ fontSize: 13, alignSelf: "center" }}>Nadie podrá leer los manuales hasta que conectes otra. ¿Desconectar?</span>
                    <button type="button" style={{ ...secundario, color: "#8a1c14", border: "1px solid #e5a29c" }} onClick={desconectar} disabled={!!ocupado}>
                      Sí, desconectar
                    </button>
                    <button type="button" style={secundario} onClick={() => setConfirmarDesconexion(false)}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button type="button" style={{ ...secundario, color: "#8a1c14", border: "1px solid #e5a29c" }} onClick={() => setConfirmarDesconexion(true)} disabled={!!ocupado}>
                    Desconectar
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p style={{ ...p, fontWeight: 600 }}>Aún no hay cuenta conectada: nadie puede leer los manuales todavía.</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={primario} onClick={conectar} disabled={!!ocupado}>
                  Conectar cuenta técnica
                </button>
                {!admin.manual && (
                  <button type="button" style={secundario} onClick={onCambio}>
                    Ya conecté la cuenta
                  </button>
                )}
              </div>
            </>
          )}
          {esperandoRetorno && (
            <div style={{ marginTop: 14, padding: "12px 14px", border: "1px solid var(--tc-blue-500)", borderRadius: 8, background: "var(--tc-blue-50)" }}>
              <ol style={{ margin: "0 0 10px", paddingLeft: 20, fontSize: 14, lineHeight: 1.6 }}>
                <li>En la pestaña que se abrió, inicia sesión con la <strong>cuenta técnica</strong>.</li>
                <li>
                  Al terminar, esa pestaña mostrará una página que <strong>no carga</strong> (&quot;localhost rechazó la conexión&quot;). Es normal.
                </li>
                <li>
                  Copia la dirección completa de su barra (empieza por <code>http://localhost/?code=</code>) y pégala aquí. Tienes 10 minutos.
                </li>
              </ol>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  value={retorno}
                  onChange={(e) => setRetorno(e.target.value)}
                  placeholder="http://localhost/?code=...&state=..."
                  aria-label="Dirección a la que te llevó Trimble"
                  style={{ flex: "1 1 320px", border: "1px solid var(--tc-gray-300)", borderRadius: 5, padding: "7px 10px", fontSize: 13.5, fontFamily: "inherit" }}
                />
                <button type="button" style={primario} onClick={completar} disabled={!!ocupado || !retorno.trim()}>
                  Completar conexión
                </button>
              </div>
            </div>
          )}
          {enlace && (
            <p style={{ ...p, fontSize: 12.5, color: "var(--tc-gray-500)", marginTop: 10, wordBreak: "break-all" }}>
              Si no se abrió la pestaña, copia este enlace en una pestaña nueva del navegador (vale 10 minutos): {enlace}
            </p>
          )}
        </section>

        <Autorizados api={api} />
        {ocupado && <p style={{ ...p, color: "var(--tc-blue-700)" }}>{ocupado}</p>}
      </div>
    </div>
  );
}

const tarjeta: CSSProperties = { background: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(10,61,98,0.12)", padding: "16px 18px" };
const h2: CSSProperties = { margin: "0 0 8px", fontSize: 17, color: "var(--tc-blue-900)" };
const p: CSSProperties = { margin: "0 0 10px", fontSize: 14, lineHeight: 1.5 };
const nota: CSSProperties = { borderRadius: 8, padding: "10px 14px", fontSize: 13.5, lineHeight: 1.5 };
const primario: CSSProperties = {
  border: "1px solid var(--tc-blue-700)",
  background: "var(--tc-blue-600)",
  color: "#fff",
  borderRadius: 5,
  padding: "7px 14px",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
const secundario: CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  background: "#fff",
  color: "var(--tc-blue-700)",
  borderRadius: 5,
  padding: "6px 12px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};
