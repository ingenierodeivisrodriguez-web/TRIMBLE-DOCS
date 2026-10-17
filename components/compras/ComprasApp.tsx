"use client";

import { CSSProperties, useCallback, useEffect, useState } from "react";
import type { ComprasApi } from "../../lib/compras/client";
import { fecha } from "../../lib/compras/formato";
import { ACCIONES, ACCIONES_POR_MODULO, EstadoResponse, Modulo, MODULOS, Permiso } from "../../lib/compras/types";
import { ApiError } from "../../lib/propiedades/client";
import { acceptButton, C, message, Modal, Notice } from "../presupuesto/ui";
import Accesos from "./Accesos";
import Auditoria from "./Auditoria";
import Insumos from "./Insumos";
import Requisiciones from "./Requisiciones";
import Proveedores from "./Proveedores";
import Cotizaciones from "./Cotizaciones";
import Ordenes from "./Ordenes";
import Recepciones from "./Recepciones";
import Panel from "./Panel";
import DocumentosCde from "./DocumentosCde";
import { botonSecundario, card, linkBtn, texto, titulo } from "./estilos";

type Pestana = "inicio" | "insumos" | "requisiciones" | "proveedores" | "cotizaciones" | "ordenes" | "recepciones" | "documentos" | "panel" | "accesos" | "auditoria";

/** "Compras y Contratación" in the project menu: who you are, your access, and what your role lets you open. */
export default function ComprasApp({ api, projectId, projectName }: { api: ComprasApi; projectId: string; projectName: string }) {
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

  /** An access revoked while the page is open: back to the state screen. */
  const onSinAcceso = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.code === "sin-acceso") cargar();
    },
    [cargar]
  );

  const permisos = estado?.acceso?.permisos ?? [];
  const puede = (p: Permiso) => permisos.includes(p);
  const pestanas: { id: Pestana; nombre: string }[] = [
    { id: "inicio", nombre: "Inicio" },
    ...(puede("panel.ver") ? [{ id: "panel" as const, nombre: "Panel" }] : []),
    ...(puede("insumos.ver") ? [{ id: "insumos" as const, nombre: "Insumos del presupuesto" }] : []),
    ...(puede("requisiciones.ver") ? [{ id: "requisiciones" as const, nombre: "Requisiciones" }] : []),
    ...(puede("cotizaciones.ver") ? [{ id: "cotizaciones" as const, nombre: "Cotizaciones" }] : []),
    ...(puede("ordenes.ver") || puede("contratos.ver") ? [{ id: "ordenes" as const, nombre: "Órdenes y contratos" }] : []),
    ...(puede("recepciones.ver") ? [{ id: "recepciones" as const, nombre: "Recepción en obra" }] : []),
    ...(puede("proveedores.ver") ? [{ id: "proveedores" as const, nombre: "Proveedores" }] : []),
    ...(puede("documentos.ver") ? [{ id: "documentos" as const, nombre: "Documentos (CDE)" }] : []),
    ...(puede("accesos.ver") ? [{ id: "accesos" as const, nombre: "Accesos y roles" }] : []),
    ...(puede("auditoria.ver") ? [{ id: "auditoria" as const, nombre: "Auditoría" }] : []),
  ];
  const actual = pestanas.some((p) => p.id === pestana) ? pestana : "inicio";

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#f7f8fa" }}>
      <header style={{ background: C.header, color: "#fff", display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Compras y Contratación</h1>
        <span style={{ opacity: 0.85, fontSize: 14 }}>{projectName || projectId}</span>
        <span style={{ flex: 1 }} />
        {estado && (
          <span style={{ fontSize: 13 }}>
            {estado.user.name}
            {estado.acceso && <span style={chip}>{estado.acceso.rol.nombre}</span>}
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

      {estado && !estado.acceso && <SinAcceso api={api} estado={estado} projectName={projectName} onActivado={setEstado} />}

      {estado?.acceso && (
        <>
          <nav style={{ display: "flex", gap: 2, padding: "0 12px", borderBottom: `1px solid ${C.border}`, background: "#fff" }} aria-label="Secciones">
            {pestanas.map((p) => (
              <button key={p.id} type="button" onClick={() => setPestana(p.id)} style={tab(p.id === actual)} aria-current={p.id === actual ? "page" : undefined}>
                {p.nombre}
              </button>
            ))}
          </nav>
          <main style={{ flex: 1, minHeight: 0, padding: 16 }}>
            {actual === "inicio" && <Inicio estado={estado} />}
            {actual === "panel" && <Panel api={api} permisos={permisos} proyecto={projectName || projectId} onSinAcceso={onSinAcceso} />}
            {actual === "insumos" && <Insumos api={api} onSinAcceso={onSinAcceso} />}
            {actual === "requisiciones" && <Requisiciones api={api} yo={estado.user.id} permisos={permisos} onSinAcceso={onSinAcceso} />}
            {actual === "cotizaciones" && <Cotizaciones api={api} yo={estado.user.id} permisos={permisos} onSinAcceso={onSinAcceso} />}
            {actual === "proveedores" && <Proveedores api={api} permisos={permisos} onSinAcceso={onSinAcceso} />}
            {actual === "ordenes" && <Ordenes api={api} yo={estado.user.id} permisos={permisos} proyecto={projectName || projectId} onSinAcceso={onSinAcceso} />}
            {actual === "recepciones" && <Recepciones api={api} yo={estado.user.id} permisos={permisos} proyecto={projectName || projectId} onSinAcceso={onSinAcceso} />}
            {actual === "documentos" && <DocumentosCde api={api} permisos={permisos} onSinAcceso={onSinAcceso} />}
            {actual === "accesos" && <Accesos api={api} yo={estado.user.id} onSinAcceso={onSinAcceso} />}
            {actual === "auditoria" && <Auditoria api={api} onSinAcceso={onSinAcceso} />}
          </main>
        </>
      )}
    </div>
  );
}

/** Without an access: who to ask, or how to turn Compras on. */
function SinAcceso({ api, estado, projectName, onActivado }: { api: ComprasApi; estado: EstadoResponse; projectName: string; onActivado: (e: EstadoResponse) => void }) {
  const [confirmar, setConfirmar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function activar() {
    setBusy(true);
    setError("");
    try {
      onActivado(await api.activar());
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
      <div style={card}>
        {estado.activo ? (
          <>
            <h2 style={titulo}>No tienes acceso a Compras en este proyecto</h2>
            <p style={texto}>
              Ser miembro del proyecto en Trimble Connect no basta: el acceso a Compras lo da un administrador de Compras, con un rol y unas fechas.
            </p>
            {estado.administradores.length > 0 && (
              <p style={texto}>
                Pídeselo a: <strong>{estado.administradores.join(", ")}</strong>.
              </p>
            )}
          </>
        ) : (
          <>
            <h2 style={titulo}>Compras no está activado en este proyecto</h2>
            {estado.puedeActivar ? (
              <>
                <p style={texto}>
                  Como administrador del proyecto en Trimble Connect, puedes activarlo. Quedarás como <strong>Administrador de plataforma</strong> de Compras y
                  desde ahí darás el acceso a cada persona.
                </p>
                <button type="button" onClick={() => setConfirmar(true)} style={acceptButton}>
                  Activar Compras en este proyecto
                </button>
              </>
            ) : (
              <p style={texto}>Lo activa un administrador del proyecto en Trimble Connect, que luego da el acceso a cada persona.</p>
            )}
          </>
        )}
        {error && <Notice kind="error" style={{ marginTop: 12 }}>{error}</Notice>}
      </div>

      {confirmar && (
        <Modal
          title="Activar Compras y Contratación"
          width={560}
          onClose={() => !busy && setConfirmar(false)}
          footer={
            <>
              <button type="button" onClick={() => setConfirmar(false)} disabled={busy} style={botonSecundario}>
                Cancelar
              </button>
              <button type="button" onClick={activar} disabled={busy} style={acceptButton}>
                {busy ? "Activando…" : "Activar"}
              </button>
            </>
          }
        >
          <div style={{ padding: 16, fontSize: 14, lineHeight: 1.5 }}>
            <p style={{ marginTop: 0 }}>
              Se activará Compras en <strong>{projectName || estado.projectId}</strong>:
            </p>
            <ul style={{ paddingLeft: 20 }}>
              <li>
                Tú quedas como <strong>Administrador de plataforma</strong> (todos los permisos), desde hoy y sin fecha final.
              </li>
              <li>Se crean los 9 roles iniciales, con una matriz de permisos que luego puedes ajustar.</li>
              <li>Nadie más entra hasta que le des acceso, ni siquiera los demás administradores del proyecto en Trimble.</li>
              <li>Queda registrado en la auditoría.</li>
            </ul>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** The caller's access and what it lets them do, module by module. */
function Inicio({ estado }: { estado: EstadoResponse }) {
  const acceso = estado.acceso!;
  const set = new Set(acceso.permisos);
  const modulos = MODULOS.filter((m) => ACCIONES_POR_MODULO[m.id].some((a) => set.has(`${m.id}.${a}` as Permiso)));
  const acciones = (m: Modulo) =>
    ACCIONES.filter((a) => set.has(`${m}.${a.id}` as Permiso))
      .map((a) => a.nombre.toLowerCase())
      .join(", ");
  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 900 }}>
      <section style={card}>
        <h2 style={titulo}>Tu acceso</h2>
        <p style={texto}>
          Rol <strong>{acceso.rol.nombre}</strong>, desde el {fecha(acceso.desde)} {acceso.hasta ? `hasta el ${fecha(acceso.hasta)}` : "sin fecha final"}.
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
      <section style={card}>
        <h2 style={titulo}>El recorrido de una compra</h2>
        <p style={texto}>
          Insumo del presupuesto → requisición (se pide y se aprueba) → cotizaciones y comparativo (se elige proveedor) → orden de compra o contrato (se
          emite) → recepción en obra (se recibe, acepta o rechaza). Cada paso lo aprueba otra persona, deja sus documentos en el CDE del proyecto y queda en
          la auditoría. El Panel muestra el avance de cada insumo y su ruta completa.
        </p>
      </section>
    </div>
  );
}

const chip: CSSProperties = { marginLeft: 8, background: "rgba(255,255,255,0.18)", borderRadius: 10, padding: "2px 9px", fontSize: 12 };

function tab(activa: boolean): CSSProperties {
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
