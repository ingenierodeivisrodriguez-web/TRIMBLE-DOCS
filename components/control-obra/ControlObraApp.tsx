"use client";

import { CSSProperties, useCallback, useEffect, useState } from "react";
import type { ObraApi } from "../../lib/control-obra/client";
import { fecha } from "../../lib/compras/formato";
import { ESTADOS_LICENCIA, licenciaPermiteTrabajar } from "../../lib/control-obra/licencias";
import { ACCIONES, ACCIONES_POR_MODULO, EstadoResponse, GRUPOS_LICENCIA, Modulo, MODULOS, Permiso } from "../../lib/control-obra/types";
import { ApiError } from "../../lib/propiedades/client";
import { acceptButton, C, message, Modal, Notice } from "../presupuesto/ui";
import { botonSecundario, card, etiqueta, linkBtn, texto, titulo } from "../compras/estilos";
import Administracion from "./Administracion";
import Bitacora from "./Bitacora";
import EmpresasLicencias from "./EmpresasLicencias";
import Estructura from "./Estructura";
import Flujos from "./Flujos";

type Pestana = "inicio" | "estructura" | "flujos" | "bitacora" | "administracion" | "empresas";

/** "Control de Obra" in the project menu: who you are, the company and its license, and what you may open. */
export default function ControlObraApp({ api, projectId, projectName }: { api: ObraApi; projectId: string; projectName: string }) {
  const [estado, setEstado] = useState<EstadoResponse | null>(null);
  const [error, setError] = useState("");
  const [pestana, setPestana] = useState<Pestana>("inicio");

  const cargar = useCallback(async () => {
    setError("");
    try {
      setEstado(await api.getEstado());
    } catch (err) {
      setError(message(err));
    }
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /** An access revoked (or a license suspended) while the page is open: back to the state screen. */
  const onSinAcceso = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && ["sin-acceso", "licencia-no-vigente", "sin-empresa", "no-admin"].includes(err.code ?? "")) cargar();
    },
    [cargar]
  );

  const permisos = estado?.acceso?.permisos ?? [];
  const puede = (p: Permiso) => permisos.includes(p);
  const admin = !!estado && (estado.adminEmpresa || estado.adminProyecto);
  const conBim = !!estado?.licencia?.grupos.includes("bim");
  const pestanas: { id: Pestana; nombre: string }[] = [
    { id: "inicio", nombre: "Inicio" },
    ...((puede("estructura.ver") || admin) && conBim ? [{ id: "estructura" as const, nombre: "Proyecto y estructura de obra" }] : []),
    ...(admin || puede("accesos.ver") ? [{ id: "flujos" as const, nombre: "Flujos de aprobación" }] : []),
    ...(puede("bitacora.ver") || estado?.adminEmpresa ? [{ id: "bitacora" as const, nombre: "Bitácora" }] : []),
    ...(admin || puede("accesos.ver") ? [{ id: "administracion" as const, nombre: "Administración" }] : []),
    ...(estado?.esAdminTecnico ? [{ id: "empresas" as const, nombre: "Empresas y licencias" }] : []),
  ];
  const actual = pestanas.some((p) => p.id === pestana) ? pestana : "inicio";
  const entra = !!estado && (!!estado.acceso || admin || estado.esAdminTecnico);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#f7f8fa" }}>
      <header style={{ background: C.header, color: "#fff", display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Control de Obra</h1>
        <span style={{ opacity: 0.85, fontSize: 14 }}>{projectName || projectId}</span>
        {estado?.empresa && <span style={chip}>{estado.empresa.nombre}</span>}
        <span style={{ flex: 1 }} />
        {estado && (
          <span style={{ fontSize: 13 }}>
            {estado.user.name}
            {estado.acceso && <span style={chip}>{estado.acceso.rol.nombre}</span>}
            {estado.adminEmpresa && <span style={chip}>Administración de la empresa</span>}
            {!estado.adminEmpresa && estado.adminProyecto && <span style={chip}>Administración del proyecto</span>}
            {estado.esAdminTecnico && <span style={chip}>Administración técnica</span>}
          </span>
        )}
      </header>

      {error && (
        <div style={{ padding: 16 }}>
          <Notice kind="error">
            {error}{" "}
            <button type="button" onClick={cargar} style={linkBtn}>
              Reintentar
            </button>
          </Notice>
        </div>
      )}
      {!estado && !error && <p style={{ padding: 16, color: "var(--tc-gray-500)" }}>Revisando tu acceso…</p>}

      {estado && !entra && <SinAcceso api={api} estado={estado} projectName={projectName} onEstado={setEstado} />}

      {estado && entra && (
        <>
          <nav style={{ display: "flex", gap: 2, padding: "0 12px", borderBottom: `1px solid ${C.border}`, background: "#fff", flexWrap: "wrap" }} aria-label="Secciones">
            {pestanas.map((p) => (
              <button key={p.id} type="button" onClick={() => setPestana(p.id)} style={tab(p.id === actual)} aria-current={p.id === actual ? "page" : undefined}>
                {p.nombre}
              </button>
            ))}
          </nav>
          <main style={{ flex: 1, minHeight: 0, padding: 16 }}>
            {actual === "inicio" && <Inicio api={api} estado={estado} projectName={projectName} onEstado={setEstado} />}
            {actual === "estructura" && <Estructura api={api} onSinAcceso={onSinAcceso} />}
            {actual === "flujos" && <Flujos api={api} onSinAcceso={onSinAcceso} />}
            {actual === "bitacora" && <Bitacora api={api} todaLaEmpresa={estado.adminEmpresa} onSinAcceso={onSinAcceso} />}
            {actual === "administracion" && <Administracion api={api} estado={estado} projectName={projectName} onEstado={setEstado} onSinAcceso={onSinAcceso} />}
            {actual === "empresas" && <EmpresasLicencias api={api} />}
          </main>
        </>
      )}
    </div>
  );
}

/** The caller's Trimble user id, to send to the product's administrator. */
function TuId({ id }: { id: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <p style={{ ...texto, fontSize: 13 }}>
      Tu ID de usuario de Trimble Connect: <code style={{ background: "#eef1f4", padding: "1px 6px", borderRadius: 3 }}>{id}</code>{" "}
      <button
        type="button"
        style={linkBtn}
        onClick={() =>
          navigator.clipboard?.writeText(id).then(
            () => setCopiado(true),
            () => setCopiado(false)
          )
        }
      >
        {copiado ? "Copiado" : "Copiar"}
      </button>
    </p>
  );
}

const MENSAJE_LICENCIA: Partial<Record<string, string>> = {
  "sin-licencia": "La empresa todavía no tiene licencia.",
  programada: "La licencia de la empresa empieza más adelante.",
  vencida: "La licencia de la empresa venció.",
  suspendida: "La licencia de la empresa está suspendida.",
  "empresa-inactiva": "La empresa está desactivada en Control de Obra.",
};

/** Without an access: register the project, ask for an access, or why the company can't work. */
function SinAcceso({ api, estado, projectName, onEstado }: { api: ObraApi; estado: EstadoResponse; projectName: string; onEstado: (e: EstadoResponse) => void }) {
  const [empresa, setEmpresa] = useState<{ id: string; nombre: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function vincular() {
    if (!empresa) return;
    setBusy(true);
    setError("");
    try {
      onEstado(await api.vincular(empresa.id));
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  const licencia = estado.licencia;
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
      <div style={card}>
        {!estado.empresa && estado.puedeVincularA.length > 0 && (
          <>
            <h2 style={titulo}>Este proyecto no está registrado en Control de Obra</h2>
            <p style={texto}>Administras una empresa en Control de Obra y eres administrador de este proyecto en Trimble Connect: puedes registrarlo.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {estado.puedeVincularA.map((e) => (
                <button key={e.id} type="button" onClick={() => setEmpresa(e)} style={acceptButton}>
                  Registrar en {e.nombre}
                </button>
              ))}
            </div>
          </>
        )}
        {!estado.empresa && estado.puedeVincularA.length === 0 && (
          <>
            <h2 style={titulo}>Este proyecto no está registrado en Control de Obra</h2>
            <p style={texto}>
              Control de Obra se usa por empresa, con licencia. Lo registra un administrador de la empresa que sea también administrador del proyecto en Trimble
              Connect. Si tu empresa ya tiene licencia, pídeselo a su administrador.
            </p>
          </>
        )}
        {estado.empresa && licencia && !licenciaPermiteTrabajar(licencia.estado) && (
          <>
            <h2 style={titulo}>{MENSAJE_LICENCIA[licencia.estado] ?? "La licencia de la empresa no está vigente."}</h2>
            <p style={texto}>
              Mientras tanto nadie de <strong>{estado.empresa.nombre}</strong> trabaja en Control de Obra; los datos se conservan. Comunícate con el administrador
              técnico del producto.
            </p>
          </>
        )}
        {estado.empresa && licencia && licenciaPermiteTrabajar(licencia.estado) && (
          <>
            <h2 style={titulo}>No tienes acceso a Control de Obra en este proyecto</h2>
            <p style={texto}>Ser miembro del proyecto en Trimble Connect no basta: el acceso lo da un administrador, con un rol y unas fechas.</p>
            {estado.administradores.length > 0 && (
              <p style={texto}>
                Pídeselo a: <strong>{estado.administradores.join(", ")}</strong>.
              </p>
            )}
          </>
        )}
        <TuId id={estado.user.id} />
        {error && <Notice kind="error" style={{ marginTop: 12 }}>{error}</Notice>}
      </div>

      {empresa && (
        <Modal
          title="Registrar el proyecto"
          width={560}
          onClose={() => !busy && setEmpresa(null)}
          footer={
            <>
              <button type="button" onClick={() => setEmpresa(null)} disabled={busy} style={botonSecundario}>
                Cancelar
              </button>
              <button type="button" onClick={vincular} disabled={busy} style={acceptButton}>
                {busy ? "Registrando…" : "Registrar"}
              </button>
            </>
          }
        >
          <div style={{ padding: 16, fontSize: 14, lineHeight: 1.5 }}>
            <p style={{ marginTop: 0 }}>
              <strong>{projectName || estado.projectId}</strong> quedará registrado en <strong>{empresa.nombre}</strong>:
            </p>
            <ul style={{ paddingLeft: 20 }}>
              <li>Ocupa uno de los proyectos que permite la licencia.</li>
              <li>Un proyecto pertenece a una sola empresa.</li>
              <li>Nadie entra hasta que le des un rol en la pestaña Administración (tampoco tú: otro administrador te lo da).</li>
              <li>Queda registrado en la bitácora.</li>
            </ul>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** The caller's access, the company's license and what comes in the next phases. */
function Inicio({ api, estado, projectName, onEstado }: { api: ObraApi; estado: EstadoResponse; projectName: string; onEstado: (e: EstadoResponse) => void }) {
  const set = new Set(estado.acceso?.permisos ?? []);
  const modulos = MODULOS.filter((m) => ACCIONES_POR_MODULO[m.id].some((a) => set.has(`${m.id}.${a}` as Permiso)));
  const acciones = (m: Modulo) =>
    ACCIONES.filter((a) => set.has(`${m}.${a.id}` as Permiso))
      .map((a) => a.nombre.toLowerCase())
      .join(", ");
  const lic = estado.licencia;
  const e = lic ? ESTADOS_LICENCIA[lic.estado] : null;
  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 900 }}>
      {!estado.acceso && !estado.adminEmpresa && !estado.adminProyecto && estado.esAdminTecnico && (
        <SinAcceso api={api} estado={estado} projectName={projectName} onEstado={onEstado} />
      )}
      {lic && e && (
        <section style={card}>
          <h2 style={titulo}>Licencia de {estado.empresa?.nombre}</h2>
          <p style={texto}>
            <span style={etiqueta(e.color, e.fondo)}>{e.texto}</span> Plan <strong>{lic.plan || "—"}</strong>
            {lic.hasta ? `, hasta el ${fecha(lic.hasta)}` : ", sin fecha final"}
            {lic.estado === "por-vencer" && lic.diasRestantes !== null ? ` (quedan ${lic.diasRestantes} día(s))` : ""}.
          </p>
          <p style={{ ...texto, marginBottom: 0 }}>
            Módulos contratados: {GRUPOS_LICENCIA.filter((g) => lic.grupos.includes(g.id)).map((g) => g.nombre).join(", ") || "solo los básicos (panel, bitácora y accesos)"}.
          </p>
        </section>
      )}
      {estado.acceso && (
        <section style={card}>
          <h2 style={titulo}>Tu acceso</h2>
          <p style={texto}>
            Rol <strong>{estado.acceso.rol.nombre}</strong>, desde el {fecha(estado.acceso.desde)} {estado.acceso.hasta ? `hasta el ${fecha(estado.acceso.hasta)}` : "sin fecha final"}.
          </p>
          <table style={{ borderCollapse: "collapse", fontSize: 13.5, width: "100%" }}>
            <tbody>
              {modulos.map((m) => (
                <tr key={m.id} style={{ borderTop: `1px solid ${C.grid}` }}>
                  <td style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }} title={m.ayuda}>
                    {m.nombre}
                  </td>
                  <td style={{ padding: "6px 8px", color: "var(--tc-gray-500)" }}>{acciones(m.id)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {(estado.adminEmpresa || estado.adminProyecto) && !estado.acceso && (
        <section style={card}>
          <h2 style={titulo}>Administras {estado.adminEmpresa ? "la empresa" : "este proyecto"}</h2>
          <p style={{ ...texto, marginBottom: 0 }}>
            Administrar no da permisos de obra: para reportar, verificar o aprobar necesitas un rol en este proyecto, que te da otro administrador (nadie se lo
            da a sí mismo).
          </p>
        </section>
      )}
      <section style={card}>
        <h2 style={titulo}>Qué viene</h2>
        <p style={{ ...texto, marginBottom: 0 }}>
          Ya está la base: empresas, licencias, personas, roles, la estructura de obra, la bitácora y los flujos de aprobación. Siguen, por fases: las
          mediciones de obra (desde el modelo en el visor 3D o a mano, por ubicación y contrato), la calidad (listas de chequeo, inspecciones y no
          conformidades), las actas al cliente y a los subcontratistas, el avance que lee Presupuesto, el almacén, el costo real y el panel.
        </p>
      </section>
    </div>
  );
}

const chip: CSSProperties = { marginLeft: 8, background: "rgba(255,255,255,0.18)", borderRadius: 10, padding: "2px 9px", fontSize: 12 };

export function tab(activa: boolean): CSSProperties {
  return {
    border: "none",
    borderBottom: `3px solid ${activa ? C.header : "transparent"}`,
    background: "transparent",
    padding: "10px 14px 8px",
    fontSize: 14,
    fontWeight: activa ? 600 : 400,
    color: activa ? C.header : "var(--tc-gray-700)",
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

export function segmento(activo: boolean): CSSProperties {
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
