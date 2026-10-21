"use client";

import { useCallback, useEffect, useState } from "react";
import type { ObraApi } from "../../lib/control-obra/client";
import { avisosFlujo, describirFlujo, papelDePaso, permisoDePaso, revisarPasos, tipoFlujo } from "../../lib/control-obra/flujos";
import { fechaHora } from "../../lib/compras/formato";
import { Flujo, FlujosResponse, MAX_PASOS, PasoFlujo } from "../../lib/control-obra/types";
import { ApiError } from "../../lib/propiedades/client";
import { acceptButton, baseInput, C, message, Notice } from "../presupuesto/ui";
import { botonSecundario, card, etiqueta, linkBtn, select, texto, titulo } from "../compras/estilos";

/** The project's approval flows: one per kind of document, its steps and the role that takes each one. */
export default function Flujos({ api, onSinAcceso }: { api: ObraApi; onSinAcceso: (err: unknown) => void }) {
  const [datos, setDatos] = useState<FlujosResponse | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setError("");
    try {
      setDatos(await api.getFlujos());
    } catch (err) {
      setError(message(err));
      onSinAcceso(err);
    }
  }, [api, onSinAcceso]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  if (error && !datos) return <Notice kind="error">{error}</Notice>;
  if (!datos) return <p style={{ color: "var(--tc-gray-500)" }}>Cargando flujos de aprobación…</p>;

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 980 }}>
      <section style={{ ...card, maxWidth: "none" }}>
        <h2 style={titulo}>Flujos de aprobación del proyecto</h2>
        <p style={{ ...texto, marginBottom: 6 }}>
          Cada tipo de documento pasa por estos pasos antes de quedar aprobado. El primer paso elabora y envía; los siguientes aprueban, el último en firme.
        </p>
        <ul style={{ ...texto, margin: 0, paddingLeft: 20 }}>
          <li>Quien elabora un documento no lo aprueba, y una misma persona firma un solo paso del mismo documento.</li>
          <li>Devolver exige escribir el motivo y regresa el documento al paso anterior (no al principio).</li>
          <li>Un documento ya enviado sigue el flujo con que se envió, aunque aquí se cambie después.</li>
          <li>Todo queda en la bitácora.</li>
        </ul>
        {!datos.puedeEditar && <p style={{ ...texto, margin: "8px 0 0", fontSize: 13 }}>Solo consulta: los flujos los configuran los administradores de la empresa o del proyecto.</p>}
      </section>
      {datos.flujos.map((f) => (
        <TarjetaFlujo key={`${f.tipo}:${f.version}`} api={api} datos={datos} flujo={f} onDatos={setDatos} onRecargar={cargar} onSinAcceso={onSinAcceso} />
      ))}
    </div>
  );
}

function TarjetaFlujo({
  api,
  datos,
  flujo,
  onDatos,
  onRecargar,
  onSinAcceso,
}: {
  api: ObraApi;
  datos: FlujosResponse;
  flujo: Flujo;
  onDatos: (d: FlujosResponse) => void;
  onRecargar: () => void;
  onSinAcceso: (err: unknown) => void;
}) {
  const t = tipoFlujo(flujo.tipo);
  const [editando, setEditando] = useState<PasoFlujo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nombreRol = (id: string) => datos.roles.find((r) => r.id === id)?.nombre ?? "(rol que ya no existe)";
  const avisos = avisosFlujo(flujo.tipo, flujo.pasos, datos.roles, datos.personasPorRol);
  const sugerido = datos.sugeridos[flujo.tipo];

  async function guardar() {
    if (!editando) return;
    setBusy(true);
    setError("");
    try {
      onDatos(await api.guardarFlujo({ tipo: flujo.tipo, pasos: editando.map((p) => ({ nombre: p.nombre.trim(), rolId: p.rolId })), version: flujo.version }));
    } catch (err) {
      setBusy(false);
      setError(message(err));
      if (err instanceof ApiError && err.code === "version-conflict") onRecargar();
      else onSinAcceso(err);
    }
  }

  return (
    <section style={{ ...card, maxWidth: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ ...titulo, margin: 0 }}>{t.nombre}</h3>
        {!flujo.pasos.length && <span style={etiqueta("#7a5a00", "#fff4d1")}>Sin configurar</span>}
        <span style={{ flex: 1 }} />
        {datos.puedeEditar && !editando && (
          <button type="button" style={botonSecundario} onClick={() => setEditando(flujo.pasos.length ? flujo.pasos.map((p) => ({ ...p })) : sugerido ? sugerido.map((p) => ({ ...p })) : [vacio(), vacio()])}>
            {flujo.pasos.length ? "Cambiar" : "Configurar"}
          </button>
        )}
      </div>
      <p style={{ ...texto, fontSize: 13, margin: "4px 0 10px" }}>{t.ayuda}</p>

      {!editando && flujo.pasos.length > 0 && (
        <>
          <Pasos pasos={flujo.pasos} nombreRol={nombreRol} personas={datos.personasPorRol} />
          {flujo.actualizado && (
            <p style={{ fontSize: 12, color: "var(--tc-gray-500)", margin: "8px 0 0" }}>
              Última modificación: {fechaHora(flujo.actualizado)}
              {flujo.actualizadoPor ? `, ${flujo.actualizadoPor}` : ""}.
            </p>
          )}
        </>
      )}
      {!editando && !flujo.pasos.length && (
        <p style={{ ...texto, marginBottom: 0 }}>
          Mientras no se configure, estos documentos no se pueden enviar a aprobación.
          {sugerido && ` Sugerido: ${describirFlujo(sugerido)}.`}
        </p>
      )}
      {!editando && avisos.map((a) => (
        <Notice key={a} kind="warning" style={{ marginTop: 8 }}>
          {a}
        </Notice>
      ))}

      {editando && (
        <Editor
          tipo={flujo.tipo}
          pasos={editando}
          datos={datos}
          sugerido={sugerido ?? null}
          busy={busy}
          error={error}
          onCambiar={setEditando}
          onGuardar={guardar}
          onCancelar={() => {
            setEditando(null);
            setError("");
          }}
        />
      )}
    </section>
  );
}

const vacio = (): PasoFlujo => ({ nombre: "", rolId: "" });

/** The steps in a row: role, what it does and who has that role today. */
function Pasos({ pasos, nombreRol, personas }: { pasos: PasoFlujo[]; nombreRol: (id: string) => string; personas: Record<string, string[]> }) {
  return (
    <ol style={{ display: "flex", flexWrap: "wrap", gap: 8, listStyle: "none", padding: 0, margin: 0, alignItems: "stretch" }}>
      {pasos.map((p, i) => (
        <li key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", background: i === pasos.length - 1 ? "#e3f3de" : "#f7f9fc", minWidth: 150 }}>
            <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>
              Paso {i + 1} · {p.nombre}
            </div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{nombreRol(p.rolId)}</div>
            <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }} title="Quiénes tienen hoy ese rol en el proyecto">
              {personas[p.rolId]?.join(", ") || "Nadie con este rol hoy"}
            </div>
          </div>
          {i < pasos.length - 1 && <span aria-hidden style={{ color: "var(--tc-gray-500)", fontSize: 18 }}>→</span>}
        </li>
      ))}
    </ol>
  );
}

function Editor({
  tipo,
  pasos,
  datos,
  sugerido,
  busy,
  error,
  onCambiar,
  onGuardar,
  onCancelar,
}: {
  tipo: Flujo["tipo"];
  pasos: PasoFlujo[];
  datos: FlujosResponse;
  sugerido: PasoFlujo[] | null;
  busy: boolean;
  error: string;
  onCambiar: (p: PasoFlujo[]) => void;
  onGuardar: () => void;
  onCancelar: () => void;
}) {
  const problema = pasos.some((p) => !p.rolId) ? "Elige el rol de cada paso." : revisarPasos(tipo, pasos, datos.roles);
  const cambiar = (i: number, cambio: Partial<PasoFlujo>) => onCambiar(pasos.map((p, j) => (j === i ? { ...p, ...cambio, rolNombre: undefined } : p)));
  const mover = (i: number, d: -1 | 1) => {
    const l = [...pasos];
    [l[i], l[i + d]] = [l[i + d], l[i]];
    onCambiar(l);
  };
  const activos = datos.roles.filter((r) => r.activo);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ fontSize: 12.5, color: "var(--tc-gray-500)", textAlign: "left" }}>
            <th style={{ padding: 4, width: 50 }}>Paso</th>
            <th style={{ padding: 4 }}>Nombre del paso</th>
            <th style={{ padding: 4 }}>Rol que lo atiende</th>
            <th style={{ padding: 4 }}>Quiénes lo tienen hoy</th>
            <th style={{ padding: 4 }} aria-label="Ordenar o quitar" />
          </tr>
        </thead>
        <tbody>
          {pasos.map((p, i) => {
            const permiso = permisoDePaso(tipo, i);
            return (
              <tr key={i} style={{ borderTop: `1px solid ${C.grid}` }}>
                <td style={{ padding: 4, fontSize: 13 }}>
                  {i + 1}
                  <div style={{ fontSize: 11.5, color: "var(--tc-gray-500)" }}>{papelDePaso(i, pasos.length)}</div>
                </td>
                <td style={{ padding: 4 }}>
                  <input
                    value={p.nombre}
                    maxLength={40}
                    placeholder={i === 0 ? "Elabora" : i === pasos.length - 1 ? "Aprueba" : "Preaprueba"}
                    onChange={(e) => cambiar(i, { nombre: e.target.value })}
                    aria-label={`Nombre del paso ${i + 1}`}
                    style={{ ...baseInput, width: "100%" }}
                  />
                </td>
                <td style={{ padding: 4 }}>
                  <select value={p.rolId} onChange={(e) => cambiar(i, { rolId: e.target.value })} aria-label={`Rol del paso ${i + 1}`} style={{ ...select, width: "100%" }}>
                    <option value="">Elige un rol…</option>
                    {activos.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.nombre}
                        {r.permisos.includes(permiso) ? "" : " (sin permiso para este paso)"}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: 4, fontSize: 12.5, color: "var(--tc-gray-500)" }}>{(p.rolId && datos.personasPorRol[p.rolId]?.join(", ")) || "—"}</td>
                <td style={{ padding: 4, whiteSpace: "nowrap" }}>
                  <button type="button" style={linkBtn} disabled={i === 0} onClick={() => mover(i, -1)} title="Subir" aria-label={`Subir el paso ${i + 1}`}>
                    ↑
                  </button>{" "}
                  <button type="button" style={linkBtn} disabled={i === pasos.length - 1} onClick={() => mover(i, 1)} title="Bajar" aria-label={`Bajar el paso ${i + 1}`}>
                    ↓
                  </button>{" "}
                  <button type="button" style={linkBtn} disabled={pasos.length <= 2} onClick={() => onCambiar(pasos.filter((_, j) => j !== i))} title="Quitar" aria-label={`Quitar el paso ${i + 1}`}>
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button type="button" style={linkBtn} disabled={pasos.length >= MAX_PASOS} onClick={() => onCambiar([...pasos.slice(0, -1), vacio(), pasos[pasos.length - 1]])}>
          ＋ Agregar un paso antes de la aprobación final
        </button>
        {sugerido && (
          <button type="button" style={linkBtn} onClick={() => onCambiar(sugerido.map((p) => ({ ...p })))} title={describirFlujo(sugerido)}>
            Usar el flujo sugerido
          </button>
        )}
      </div>
      {!problema && <p style={{ ...texto, margin: 0, fontSize: 13 }}>Quedará así: {describirFlujo(pasos, (id) => datos.roles.find((r) => r.id === id)?.nombre ?? "")}.</p>}
      {problema && <Notice kind="warning">{problema}</Notice>}
      {!problema &&
        avisosFlujo(tipo, pasos, datos.roles, datos.personasPorRol).map((a) => (
          <Notice key={a} kind="warning">
            {a}
          </Notice>
        ))}
      {error && <Notice kind="error">{error}</Notice>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button type="button" onClick={onCancelar} disabled={busy} style={botonSecundario}>
          Cancelar
        </button>
        <button type="button" onClick={onGuardar} disabled={busy || !!problema} style={{ ...acceptButton, opacity: problema ? 0.5 : 1 }}>
          {busy ? "Guardando…" : "Guardar flujo"}
        </button>
      </div>
    </div>
  );
}
