"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import type { ManualesApi } from "../../lib/manuales/client";
import type { AutorizadoInfo, EstadoManuales } from "../../lib/manuales/types";

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
  const [lista, setLista] = useState<AutorizadoInfo[] | null>(null);
  const [texto, setTexto] = useState("");
  const [filtro, setFiltro] = useState("");
  const [quitando, setQuitando] = useState<string | null>(null);
  const [confirmarDesconexion, setConfirmarDesconexion] = useState(false);

  const cargarLista = useCallback(async () => {
    try {
      setLista(await api.autorizados());
    } catch (err) {
      setError(message(err));
    }
  }, [api]);

  useEffect(() => {
    cargarLista();
  }, [cargarLista]);

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
      setAviso("Inicia sesión con la cuenta técnica en la pestaña que se abrió. Al terminar, vuelve aquí y pulsa \"Ya conecté la cuenta\".");
    } catch (err) {
      ventana?.close();
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

  async function autorizar() {
    setOcupado("Autorizando...");
    setError("");
    setAviso("");
    try {
      const r = await api.autorizar(texto);
      setAviso(`${r.agregados} persona(s) autorizada(s).${r.invalidos.length ? ` No son correos válidos: ${r.invalidos.join(", ")}.` : ""}`);
      setTexto(r.invalidos.join("\n"));
      await cargarLista();
    } catch (err) {
      setError(message(err));
    } finally {
      setOcupado("");
    }
  }

  async function quitar(email: string) {
    setQuitando(null);
    setError("");
    try {
      await api.quitarAutorizado(email);
      setLista((l) => (l ? l.filter((a) => a.email !== email) : l));
    } catch (err) {
      setError(message(err));
    }
  }

  const visibles = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return (lista ?? []).filter((a) => !f || a.email.includes(f) || a.nombre.toLowerCase().includes(f));
  }, [lista, filtro]);
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
                    <button type="button" style={{ ...secundario, color: "#8a1c14", borderColor: "#e5a29c" }} onClick={desconectar} disabled={!!ocupado}>
                      Sí, desconectar
                    </button>
                    <button type="button" style={secundario} onClick={() => setConfirmarDesconexion(false)}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button type="button" style={{ ...secundario, color: "#8a1c14", borderColor: "#e5a29c" }} onClick={() => setConfirmarDesconexion(true)} disabled={!!ocupado}>
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
                <button type="button" style={secundario} onClick={onCambio}>
                  Ya conecté la cuenta
                </button>
              </div>
            </>
          )}
          {enlace && (
            <p style={{ ...p, fontSize: 12.5, color: "var(--tc-gray-500)", marginTop: 10, wordBreak: "break-all" }}>
              Si no se abrió la pestaña, copia este enlace en el navegador (vale 10 minutos): {enlace}
            </p>
          )}
          <details style={{ marginTop: 12, fontSize: 13, color: "var(--tc-gray-700)" }}>
            <summary style={{ cursor: "pointer" }}>Requisito en Trimble Developer Console</summary>
            <p style={{ ...p, fontSize: 13, marginTop: 8 }}>
              En la app &quot;apibasedatos&quot;, agrega esta URL a sus <strong>Callback URLs</strong> (una sola vez):
            </p>
            <code style={{ display: "block", background: "#fff", border: "1px solid #dfe4ea", padding: "6px 8px", borderRadius: 4, wordBreak: "break-all" }}>
              {admin.redirectUri}
            </code>
          </details>
        </section>

        <section style={tarjeta}>
          <h2 style={h2}>Personas autorizadas</h2>
          <p style={p}>
            Pueden leer los manuales desde cualquier proyecto donde esté instalada la app, iniciando sesión en Trimble Connect con ese correo. Los
            administradores de MANAGER PROJECT siempre pueden.
          </p>
          <label style={{ display: "block", fontSize: 13, color: "var(--tc-gray-500)", marginBottom: 4 }} htmlFor="manuales-correos">
            Correos (separados por coma, punto y coma o en líneas; admite &quot;Nombre &lt;correo&gt;&quot;)
          </label>
          <textarea
            id="manuales-correos"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={3}
            placeholder="ana@tuempresa.com, Luis Gómez <luis@contratista.com>"
            style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--tc-gray-300)", borderRadius: 6, padding: 8, fontSize: 14, fontFamily: "inherit" }}
          />
          <div style={{ marginTop: 8 }}>
            <button type="button" style={primario} onClick={autorizar} disabled={!!ocupado || !texto.trim()}>
              Autorizar
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 18, marginBottom: 6 }}>
            <strong style={{ flex: 1 }}>{lista ? `${lista.length} persona(s) autorizada(s)` : "Cargando..."}</strong>
            <input
              type="search"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              placeholder="Filtrar"
              aria-label="Filtrar personas"
              style={{ border: "1px solid var(--tc-gray-300)", borderRadius: 4, padding: "5px 8px", fontSize: 13, fontFamily: "inherit" }}
            />
          </div>
          <div style={{ border: "1px solid #dfe4ea", borderRadius: 6, overflow: "hidden", background: "#fff" }}>
            {visibles.map((a) => (
              <div key={a.email} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderBottom: "1px solid #eef1f5", fontSize: 14 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {a.nombre ? `${a.nombre} · ` : ""}
                    {a.email}
                  </span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--tc-gray-500)" }}>
                    Autorizado el {fecha(a.agregadoEn)}
                    {a.agregadoPor ? ` por ${a.agregadoPor}` : ""}
                  </span>
                </span>
                {quitando === a.email ? (
                  <>
                    <button type="button" style={{ ...secundario, color: "#8a1c14", borderColor: "#e5a29c" }} onClick={() => quitar(a.email)}>
                      Quitar acceso
                    </button>
                    <button type="button" style={secundario} onClick={() => setQuitando(null)}>
                      Cancelar
                    </button>
                  </>
                ) : (
                  <button type="button" style={secundario} onClick={() => setQuitando(a.email)}>
                    Quitar
                  </button>
                )}
              </div>
            ))}
            {lista && visibles.length === 0 && <p style={{ ...p, padding: 12, color: "var(--tc-gray-500)" }}>{lista.length ? "Nadie coincide con el filtro." : "Todavía no hay personas autorizadas."}</p>}
          </div>
        </section>
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
