"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ObraApi } from "../../lib/control-obra/client";
import { ESTADOS_LICENCIA, EVENTOS_LICENCIA, revisarLicencia } from "../../lib/control-obra/licencias";
import { EmpresaResumen, EmpresasResponse, EventoLicencia, GRUPOS_LICENCIA, GrupoLicencia, Licencia, NuevaLicencia } from "../../lib/control-obra/types";
import { nitConDv } from "../../lib/compras/proveedores";
import { fecha, fechaHora } from "../../lib/compras/formato";
import { isoToDisplay, parseDisplayDate } from "../../lib/propiedades/values";
import { acceptButton, baseInput, C, labelStyle, linkButton, message, Modal, Notice } from "../presupuesto/ui";
import DateField from "../propiedades/DateField";
import { botonPeligro, botonSecundario, card, etiqueta, select, td, texto, th, titulo } from "../compras/estilos";
import Bitacora from "./Bitacora";
import { itemLista } from "./Administracion";

/** The technical administrator's tab: companies, their licenses and administrators, and the bitácora of each. */
export default function EmpresasLicencias({ api }: { api: ObraApi }) {
  const [datos, setDatos] = useState<EmpresasResponse | null>(null);
  const [error, setError] = useState("");
  const [elegida, setElegida] = useState<string | "global">("global");
  const [dialogo, setDialogo] = useState<"empresa" | "nueva" | "licencia" | "admin" | null>(null);

  const cargar = useCallback(async () => {
    setError("");
    try {
      setDatos(await api.admin.getEmpresas());
    } catch (err) {
      setError(message(err));
    }
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const empresa = datos?.empresas.find((e) => e.id === elegida) ?? null;
  const fuente = useMemo(
    () => ({
      consultar: (f: Parameters<ObraApi["admin"]["getBitacora"]>[1]) => api.admin.getBitacora(empresa?.id ?? null, f),
      verificar: () => api.admin.verificarBitacora(empresa?.id ?? null),
    }),
    [api, empresa?.id]
  );

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!datos) return <p style={{ color: "var(--tc-gray-500)" }}>Cargando empresas…</p>;
  const guardado = (d: EmpresasResponse) => {
    setDatos(d);
    setDialogo(null);
  };

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, width: 280, flexShrink: 0 }}>
        <button type="button" onClick={() => setElegida("global")} style={itemLista(elegida === "global")} aria-pressed={elegida === "global"}>
          <span style={{ fontWeight: 600 }}>Administración técnica</span>
          <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>Bitácora de los intentos fuera de una empresa</span>
        </button>
        {datos.empresas.map((e) => {
          const est = ESTADOS_LICENCIA[e.estadoLicencia];
          return (
            <button key={e.id} type="button" onClick={() => setElegida(e.id)} style={itemLista(e.id === elegida)} aria-pressed={e.id === elegida}>
              <span style={{ fontWeight: 600, color: e.activa ? undefined : "var(--tc-gray-500)" }}>{e.nombre}</span>
              <span>
                <span style={etiqueta(est.color, est.fondo)}>{est.texto}</span>
                <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>
                  {" "}
                  {e.proyectos.filter((p) => p.activo).length} proyecto(s) · {e.usuariosActivos} persona(s)
                </span>
              </span>
            </button>
          );
        })}
        <button type="button" onClick={() => setDialogo("nueva")} style={{ ...itemLista(false), color: "var(--tc-blue-700)" }}>
          ＋ Nueva empresa
        </button>
      </div>

      <div style={{ flex: 1, minWidth: 340, display: "grid", gap: 12 }}>
        {empresa && <FichaEmpresa empresa={empresa} hoy={datos.hoy} api={api} onDialogo={setDialogo} />}
        {!empresa && (
          <section style={{ ...card, maxWidth: "none" }}>
            <h2 style={titulo}>Administración técnica del producto</h2>
            <p style={{ ...texto, marginBottom: 0 }}>
              Creas empresas, registras los eventos de su licencia (activación, renovación, cambio, suspensión, reactivación) y nombras a sus administradores por
              su correo de Trimble Connect. No entras a los datos de obra de las empresas. Quiénes son administradores técnicos lo decide la variable
              CONTROL_OBRA_ADMINS en Vercel.
            </p>
          </section>
        )}
        <Bitacora key={empresa?.id ?? "global"} fuente={fuente} />
      </div>

      {(dialogo === "nueva" || (dialogo === "empresa" && empresa)) && (
        <EmpresaDialog api={api} empresa={dialogo === "empresa" ? empresa : null} onClose={() => setDialogo(null)} onGuardado={(d) => {
          guardado(d);
          if (dialogo === "nueva") {
            const nueva = d.empresas.find((x) => !datos.empresas.some((y) => y.id === x.id));
            if (nueva) setElegida(nueva.id);
          }
        }} />
      )}
      {dialogo === "licencia" && empresa && <LicenciaDialog api={api} empresa={empresa} hoy={datos.hoy} onClose={() => setDialogo(null)} onGuardado={guardado} />}
      {dialogo === "admin" && empresa && <AdministradoresDialog api={api} empresa={empresa} onClose={() => setDialogo(null)} onGuardado={(d) => setDatos(d)} />}
    </div>
  );
}

function FichaEmpresa({ empresa, hoy, api, onDialogo }: { empresa: EmpresaResumen; hoy: string; api: ObraApi; onDialogo: (d: "empresa" | "licencia" | "admin") => void }) {
  const l = empresa.licencia;
  const est = ESTADOS_LICENCIA[empresa.estadoLicencia];
  const [historial, setHistorial] = useState<Licencia[] | null>(null);
  useEffect(() => setHistorial(null), [empresa.id, l?.id]);
  return (
    <section style={{ ...card, maxWidth: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ ...titulo, margin: 0 }}>{empresa.nombre}</h2>
        {empresa.nit && <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>NIT {nitConDv(empresa.nit, empresa.dv ?? undefined)}</span>}
        {!empresa.activa && <span style={etiqueta("#b3261e", "#fbe4e2")}>Desactivada</span>}
        <span style={{ flex: 1 }} />
        <button type="button" style={{ ...botonSecundario, padding: "5px 12px", fontSize: 13.5 }} onClick={() => onDialogo("empresa")}>
          Cambiar datos
        </button>
        <button type="button" style={{ ...botonSecundario, padding: "5px 12px", fontSize: 13.5 }} onClick={() => onDialogo("admin")}>
          Administradores
        </button>
        <button type="button" style={{ ...acceptButton, padding: "5px 12px", fontSize: 13.5 }} onClick={() => onDialogo("licencia")}>
          Registrar evento de licencia
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 12, fontSize: 13.5 }}>
        <div>
          <div style={labelStyle}>Licencia</div>
          <span style={etiqueta(est.color, est.fondo)}>{est.texto}</span>{" "}
          {l ? (
            <>
              {l.plan}, desde {fecha(l.desde)} {l.hasta ? `hasta ${fecha(l.hasta)}` : "sin vencimiento"}
            </>
          ) : (
            "Registra la activación para que pueda trabajar."
          )}
        </div>
        <div>
          <div style={labelStyle}>Uso del cupo</div>
          {empresa.proyectos.filter((p) => p.activo).length} de {l?.maxProyectos ?? 0} proyectos · {empresa.usuariosActivos} de {l?.maxUsuarios ?? 0} personas
        </div>
        <div>
          <div style={labelStyle}>Módulos</div>
          {l ? GRUPOS_LICENCIA.filter((g) => l.grupos.includes(g.id)).map((g) => g.nombre).join(", ") || "Solo los básicos" : "—"}
        </div>
        <div>
          <div style={labelStyle}>Administradores</div>
          {empresa.administradores.length
            ? empresa.administradores.map((a) => `${a.nombre || a.email}${a.userId ? "" : " (invitado)"}${a.adminEmpresa && !a.activo ? " (desactivado)" : ""}`).join(", ")
            : "Ninguno: nombra uno."}
        </div>
      </div>
      {l?.soporte && <p style={{ ...texto, fontSize: 13, margin: "10px 0 0" }}>Soporte contratado: {l.soporte}</p>}
      <div style={{ marginTop: 12 }}>
        {historial === null ? (
          <button type="button" style={{ ...linkButton, color: "var(--tc-blue-700)", padding: 0, fontSize: 13 }} onClick={() => api.admin.getLicencias(empresa.id).then(setHistorial, () => setHistorial([]))}>
            Ver el historial de la licencia
          </button>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Registrado</th>
                <th style={th}>Evento</th>
                <th style={th}>Plan</th>
                <th style={th}>Vigencia</th>
                <th style={th}>Límites</th>
                <th style={th}>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((h) => (
                <tr key={h.id}>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {fechaHora(h.creado)}
                    <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>{h.otorgadaPor}</div>
                  </td>
                  <td style={td}>{EVENTOS_LICENCIA[h.evento]}</td>
                  <td style={td}>{h.plan}</td>
                  <td style={td}>
                    {fecha(h.desde)} – {h.hasta ? fecha(h.hasta) : "sin fin"}
                  </td>
                  <td style={td}>
                    {h.maxProyectos} proy. · {h.maxUsuarios} pers.
                  </td>
                  <td style={{ ...td, fontSize: 12.5 }}>{h.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p style={{ fontSize: 12, color: "var(--tc-gray-500)", margin: "10px 0 0" }}>Hoy: {fecha(hoy)}. El historial de la licencia no se cambia ni se borra: cada cambio es un evento nuevo.</p>
    </section>
  );
}

function EmpresaDialog({ api, empresa, onClose, onGuardado }: { api: ObraApi; empresa: EmpresaResumen | null; onClose: () => void; onGuardado: (d: EmpresasResponse) => void }) {
  const [nombre, setNombre] = useState(empresa?.nombre ?? "");
  const [nit, setNit] = useState(empresa?.nit ? nitConDv(empresa.nit, empresa.dv ?? undefined) : "");
  const [activa, setActiva] = useState(empresa?.activa ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function guardar() {
    setBusy(true);
    setError("");
    try {
      onGuardado(await api.admin.guardarEmpresa({ ...(empresa ? { id: empresa.id } : {}), nombre: nombre.trim(), nit: nit.trim(), activa, version: empresa?.version ?? 0 }));
    } catch (err) {
      setBusy(false);
      setError(message(err));
    }
  }
  return (
    <Modal
      title={empresa ? `Cambiar ${empresa.nombre}` : "Nueva empresa"}
      width={540}
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} style={botonSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={busy || !nombre.trim()} style={{ ...acceptButton, opacity: nombre.trim() ? 1 : 0.5 }}>
            {busy ? "Guardando…" : "Guardar"}
          </button>
        </>
      }
    >
      <div style={{ padding: 16, display: "grid", gap: 14 }}>
        <div>
          <label style={labelStyle} htmlFor="emp-nombre">
            Razón social
          </label>
          <input id="emp-nombre" value={nombre} maxLength={150} onChange={(e) => setNombre(e.target.value)} style={{ ...baseInput, width: "100%" }} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="emp-nit">
            NIT con dígito de verificación (opcional)
          </label>
          <input id="emp-nit" value={nit} maxLength={30} placeholder="900.123.456-8" onChange={(e) => setNit(e.target.value)} style={{ ...baseInput, width: 220 }} />
        </div>
        {empresa && (
          <label style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={activa} onChange={(e) => setActiva(e.target.checked)} />
            Empresa activa (desactivada, nadie de la empresa trabaja; sus datos se conservan)
          </label>
        )}
        {!empresa && <p style={{ ...texto, fontSize: 13, margin: 0 }}>Se crea con los 7 roles iniciales y la plantilla de niveles de la estructura. Después registra la activación de su licencia y nombra a su administrador.</p>}
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

function LicenciaDialog({ api, empresa, hoy, onClose, onGuardado }: { api: ObraApi; empresa: EmpresaResumen; hoy: string; onClose: () => void; onGuardado: (d: EmpresasResponse) => void }) {
  const l = empresa.licencia;
  const [evento, setEvento] = useState<EventoLicencia>(!l ? "activacion" : l.suspendida ? "reactivacion" : "renovacion");
  const [plan, setPlan] = useState(l?.plan ?? "");
  const [desde, setDesde] = useState(isoToDisplay(l?.desde ?? hoy));
  const [hasta, setHasta] = useState(l?.hasta ? isoToDisplay(l.hasta) : "");
  const [maxProyectos, setMaxProyectos] = useState(String(l?.maxProyectos ?? 1));
  const [maxUsuarios, setMaxUsuarios] = useState(String(l?.maxUsuarios ?? 10));
  const [grupos, setGrupos] = useState<Set<GrupoLicencia>>(new Set(l?.grupos ?? GRUPOS_LICENCIA.map((g) => g.id)));
  const [motivo, setMotivo] = useState("");
  const [soporte, setSoporte] = useState(l?.soporte ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const desdeIso = parseDisplayDate(desde);
  const hastaIso = hasta.trim() ? parseDisplayDate(hasta) : null;
  const nueva: NuevaLicencia = {
    empresaId: empresa.id,
    evento,
    plan: plan.trim(),
    desde: desdeIso ?? "",
    hasta: hastaIso,
    maxProyectos: Number(maxProyectos),
    maxUsuarios: Number(maxUsuarios),
    grupos: GRUPOS_LICENCIA.map((g) => g.id).filter((g) => grupos.has(g)),
    suspendida: evento === "suspension",
    motivo: motivo.trim(),
    soporte: soporte.trim(),
  };
  const problema = !desdeIso ? "Escribe la fecha de inicio como DD-MM-AAAA." : hasta.trim() && !hastaIso ? "Escribe la fecha final como DD-MM-AAAA o déjala vacía." : revisarLicencia(nueva);
  async function guardar() {
    if (problema) return;
    setBusy(true);
    setError("");
    try {
      const { suspendida: _, ...envio } = nueva;
      onGuardado(await api.admin.registrarLicencia(envio));
    } catch (err) {
      setBusy(false);
      setError(message(err));
    }
  }
  return (
    <Modal
      title={`Licencia de ${empresa.nombre}`}
      width={640}
      onClose={() => !busy && onClose()}
      footer={
        <>
          {problema && <span style={{ fontSize: 13, color: "var(--tc-gray-500)", marginRight: "auto" }}>{problema}</span>}
          <button type="button" onClick={onClose} disabled={busy} style={botonSecundario}>
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={busy || !!problema} style={{ ...(evento === "suspension" ? botonPeligro : acceptButton), opacity: problema ? 0.5 : 1 }}>
            {busy ? "Registrando…" : `Registrar ${EVENTOS_LICENCIA[evento].toLowerCase()}`}
          </button>
        </>
      }
    >
      <div style={{ padding: 16, display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="lic-evento">
              Evento
            </label>
            <select id="lic-evento" value={evento} onChange={(e) => setEvento(e.target.value as EventoLicencia)} style={{ ...select, width: "100%" }}>
              {(Object.keys(EVENTOS_LICENCIA) as EventoLicencia[]).map((e) => (
                <option key={e} value={e}>
                  {EVENTOS_LICENCIA[e]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="lic-plan">
              Plan
            </label>
            <input id="lic-plan" value={plan} maxLength={80} onChange={(e) => setPlan(e.target.value)} style={{ ...baseInput, width: "100%" }} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="lic-desde">
              Desde
            </label>
            <DateField id="lic-desde" text={desde} placeholder="DD-MM-AAAA" invalid={!desdeIso} onText={setDesde} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="lic-hasta">
              Hasta, último día (vacío: sin vencimiento)
            </label>
            <DateField id="lic-hasta" text={hasta} placeholder="DD-MM-AAAA" invalid={!!hasta.trim() && !hastaIso} onText={setHasta} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="lic-proyectos">
              Proyectos
            </label>
            <input id="lic-proyectos" value={maxProyectos} inputMode="numeric" onChange={(e) => setMaxProyectos(e.target.value)} style={{ ...baseInput, width: 120 }} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="lic-personas">
              Personas activas
            </label>
            <input id="lic-personas" value={maxUsuarios} inputMode="numeric" onChange={(e) => setMaxUsuarios(e.target.value)} style={{ ...baseInput, width: 120 }} />
          </div>
        </div>
        <div>
          <span style={labelStyle}>Módulos contratados (panel, bitácora y accesos vienen siempre)</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {GRUPOS_LICENCIA.map((g) => (
              <label key={g.id} style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={grupos.has(g.id)}
                  onChange={() =>
                    setGrupos((s) => {
                      const n = new Set(s);
                      if (n.has(g.id)) n.delete(g.id);
                      else n.add(g.id);
                      return n;
                    })
                  }
                />
                {g.nombre}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label style={labelStyle} htmlFor="lic-soporte">
            Soporte contratado (opcional)
          </label>
          <input id="lic-soporte" value={soporte} maxLength={300} onChange={(e) => setSoporte(e.target.value)} style={{ ...baseInput, width: "100%" }} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="lic-motivo">
            Motivo {evento === "suspension" || evento === "reactivacion" ? "(obligatorio)" : "(opcional)"}
          </label>
          <textarea id="lic-motivo" value={motivo} rows={2} maxLength={1000} onChange={(e) => setMotivo(e.target.value)} style={{ ...baseInput, width: "100%", resize: "vertical" }} />
        </div>
        <p style={{ ...texto, fontSize: 12.5, margin: 0 }}>
          Se agrega un evento al historial (nada se sobrescribe) y queda en la bitácora de la empresa. Si baja el cupo por debajo de lo que ya usa la empresa, lo
          registrado se conserva, pero no puede agregar más hasta liberar cupo.
        </p>
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

function AdministradoresDialog({ api, empresa, onClose, onGuardado }: { api: ObraApi; empresa: EmpresaResumen; onClose: () => void; onGuardado: (d: EmpresasResponse) => void }) {
  const [email, setEmail] = useState("");
  const [nombre, setNombre] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function cambiar(correo: string, persona: string, admin: boolean) {
    setBusy(true);
    setError("");
    try {
      onGuardado(await api.admin.guardarAdministrador({ empresaId: empresa.id, email: correo, nombre: persona, admin }));
      setEmail("");
      setNombre("");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Administradores de ${empresa.nombre}`} width={600} onClose={() => !busy && onClose()}>
      <div style={{ padding: 16, display: "grid", gap: 12 }}>
        {!empresa.licencia && <Notice kind="warning">Registra primero la activación de la licencia: de ella sale el cupo de personas de la empresa.</Notice>}
        <p style={{ ...texto, fontSize: 13, margin: 0 }}>
          Los administradores de la empresa dan accesos, configuran roles y la estructura y registran proyectos. No tienen permisos de obra por serlo. Se nombran por
          su correo de Trimble Connect: la primera vez que abran Control de Obra quedan ligados a su usuario.
        </p>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <tbody>
            {empresa.administradores.map((a) => (
              <tr key={a.id}>
                <td style={td}>
                  <strong>{a.nombre || a.email}</strong>
                  <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>
                    {a.email}
                    {a.userId ? "" : " · invitado, todavía no ha entrado"}
                  </div>
                </td>
                <td style={{ ...td, textAlign: "right" }}>
                  <button type="button" disabled={busy} style={{ ...linkButton, color: C.close, fontSize: 13 }} onClick={() => cambiar(a.email, a.nombre, false)}>
                    Quitar como administrador
                  </button>
                </td>
              </tr>
            ))}
            {empresa.administradores.length === 0 && (
              <tr>
                <td style={{ ...td, color: "var(--tc-gray-500)" }}>La empresa todavía no tiene administradores.</td>
              </tr>
            )}
          </tbody>
        </table>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "end" }}>
          <div>
            <label style={labelStyle} htmlFor="adm-correo">
              Correo de Trimble Connect
            </label>
            <input id="adm-correo" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...baseInput, width: "100%" }} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="adm-nombre">
              Nombre
            </label>
            <input id="adm-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} style={{ ...baseInput, width: "100%" }} />
          </div>
          <button type="button" disabled={busy || !email.trim()} onClick={() => cambiar(email.trim(), nombre.trim(), true)} style={{ ...acceptButton, padding: "6px 14px", fontSize: 14, opacity: email.trim() ? 1 : 0.5 }}>
            Nombrar
          </button>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  );
}

