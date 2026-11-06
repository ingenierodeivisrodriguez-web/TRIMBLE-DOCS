"use client";

import { useMemo, useState } from "react";
import type { FlujoApi } from "../../lib/flujo-aprobacion/client";
import { avisosCobertura, nombrePapel, PAPEL_CONSULTA, PAPEL_REALIZA } from "../../lib/flujo-aprobacion/flujos";
import type { Asignacion, Equipo, EstadoFlujos, Flujo } from "../../lib/flujo-aprobacion/types";
import { botonSecundario, linkBtn, select, subtitulo, td, texto, th } from "../compras/estilos";
import Explorador, { Elegido } from "../publicar/Explorador";
import { acceptButton, C, labelStyle, message, Notice } from "../presupuesto/ui";

const porRuta = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/**
 * Who does what in a flow: on folders or files (several at a time), a person
 * or a group from Trimble's team, and a role (Realiza, each step, Consulta).
 * A file's own assignment wins over its folder's, and the closest folder over
 * the ones above. Warns about steps nobody has on a whole review folder.
 */
export default function Asignaciones({
  api,
  projectId,
  flujo,
  esAdmin,
  equipo,
  onCambio,
}: {
  api: FlujoApi;
  projectId: string;
  flujo: Flujo & { asignaciones: Asignacion[] };
  esAdmin: boolean;
  equipo: Equipo | null;
  onCambio: (e: EstadoFlujos) => void;
}) {
  const [objetivos, setObjetivos] = useState<Elegido[]>([]);
  const [quien, setQuien] = useState("");
  const [papel, setPapel] = useState(flujo.pasos[0]?.id ?? PAPEL_REALIZA);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ kind: "info" | "error"; texto: string } | null>(null);
  const [agregando, setAgregando] = useState(false);

  const papeles = [
    { id: PAPEL_REALIZA, texto: "Realiza (sube y corrige)" },
    ...flujo.pasos.map((p, i) => ({ id: p.id, texto: `${p.nombre}${i === flujo.pasos.length - 1 ? " (aprueba y pasa a destino)" : ""}` })),
    { id: PAPEL_CONSULTA, texto: "Consulta (solo ve)" },
  ];
  const orden = (p: string) => papeles.findIndex((x) => x.id === p);
  const filas = useMemo(
    () => [...flujo.asignaciones].sort((a, b) => porRuta.compare(a.objetivoRuta, b.objetivoRuta) || orden(a.papel) - orden(b.papel) || porRuta.compare(a.quienNombre, b.quienNombre)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flujo]
  );
  const cobertura = flujo.activo ? avisosCobertura(flujo, flujo.asignaciones) : [];

  async function asignar() {
    const [tipo, id] = quien.split(":");
    if (!objetivos.length || !id) return;
    setOcupado(true);
    setAviso(null);
    try {
      const r = await api.asignar({ flujoId: flujo.id, objetivos: objetivos.map((o) => ({ tipo: o.tipo, id: o.id })), quien: { tipo: tipo as "persona" | "grupo", id }, papel });
      setAviso({ kind: "info", texto: r.mensaje });
      setObjetivos([]);
      onCambio(r);
    } catch (err) {
      setAviso({ kind: "error", texto: message(err) });
    } finally {
      setOcupado(false);
    }
  }

  async function quitar(a: Asignacion) {
    setOcupado(true);
    setAviso(null);
    try {
      onCambio(await api.quitarAsignacion(a.id));
    } catch (err) {
      setAviso({ kind: "error", texto: message(err) });
    } finally {
      setOcupado(false);
    }
  }

  const listo = objetivos.length > 0 && !!quien && !ocupado;

  return (
    <div>
      {cobertura.map((t) => (
        <Notice key={t} kind="warning" style={{ marginBottom: 6 }}>
          {t}
        </Notice>
      ))}
      {filas.length === 0 ? (
        <p style={{ ...texto, fontSize: 13.5 }}>Todavía no hay a nadie asignado en este flujo.</p>
      ) : (
        <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 4 }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Carpeta o archivo</th>
                <th style={th}>Papel</th>
                <th style={th}>Quién</th>
                {esAdmin && <th style={th} />}
              </tr>
            </thead>
            <tbody>
              {filas.map((a) => (
                <tr key={a.id}>
                  <td style={td}>
                    {a.objetivoTipo === "archivo" ? "📄 " : "📁 "}
                    {a.objetivoRuta}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{nombrePapel(a.papel, flujo.pasos)}</td>
                  <td style={td}>
                    {a.quienNombre}
                    {a.quienTipo === "grupo" && <span style={{ color: "var(--tc-gray-500)" }}> (grupo)</span>}
                  </td>
                  {esAdmin && (
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <button type="button" style={linkBtn} disabled={ocupado} onClick={() => quitar(a)} title="Quitar este papel (queda en el historial)">
                        Quitar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {aviso && (
        <Notice kind={aviso.kind} style={{ marginTop: 8 }}>
          {aviso.texto}
        </Notice>
      )}

      {esAdmin && !agregando && (
        <button type="button" style={{ ...botonSecundario, padding: "5px 12px", fontSize: 13.5, marginTop: 8 }} onClick={() => setAgregando(true)}>
          + Asignar
        </button>
      )}
      {esAdmin && agregando && (
        <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
          <div>
            <span style={labelStyle}>1. Carpetas o archivos (puedes marcar varios, dentro de las carpetas de revisión)</span>
            <Explorador
              api={api}
              proyecto={projectId}
              elegir="archivo"
              conCarpetas
              seleccionados={objetivos.map((o) => o.id)}
              onElegir={(e) => setObjetivos((os) => (os.some((x) => x.id === e.id) ? os.filter((x) => x.id !== e.id) : [...os, e]))}
            />
            <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>
              {objetivos.length ? `Marcados: ${objetivos.map((o) => o.nombre).join(", ")}` : "Marca la casilla de una carpeta (la carpeta completa) o de los archivos."}
            </span>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
            <label>
              <span style={labelStyle}>2. Quién (equipo de Trimble)</span>
              <select value={quien} onChange={(e) => setQuien(e.target.value)} style={{ ...select, minWidth: 240 }} disabled={!equipo}>
                <option value="">{equipo ? "Elige…" : "Cargando el equipo…"}</option>
                {equipo && equipo.grupos.length > 0 && (
                  <optgroup label="Grupos">
                    {equipo.grupos.map((g) => (
                      <option key={g.id} value={`grupo:${g.id}`}>
                        {g.nombre}
                      </option>
                    ))}
                  </optgroup>
                )}
                {equipo && (
                  <optgroup label="Personas">
                    {equipo.personas.map((p) => (
                      <option key={p.id} value={`persona:${p.id}`}>
                        {p.nombre}
                        {p.email && p.email !== p.nombre ? ` (${p.email})` : ""}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <label>
              <span style={labelStyle}>3. Papel</span>
              <select value={papel} onChange={(e) => setPapel(e.target.value)} style={{ ...select, minWidth: 220 }}>
                {papeles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.texto}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={asignar} disabled={!listo} style={{ ...acceptButton, padding: "6px 14px", fontSize: 14, opacity: listo ? 1 : 0.5, cursor: listo ? "pointer" : "not-allowed" }}>
              {ocupado ? "Asignando…" : "Asignar"}
            </button>
            <button
              type="button"
              onClick={() => {
                setAgregando(false);
                setObjetivos([]);
              }}
              style={{ ...botonSecundario, padding: "6px 14px", fontSize: 14 }}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
