"use client";

import { useCallback, useEffect, useState } from "react";
import type { LoinApi } from "../../lib/loin/client";
import { VALORES_BASURA_INICIALES } from "../../lib/loin/reglas";
import { TDI_INICIALES } from "../../lib/loin/semilla";
import type { EstadoResponse, GrupoTdi } from "../../lib/loin/types";
import { describeResponsables, withCurrentNames } from "../../lib/propiedades/responsables";
import type { ProjectContacts, Responsable } from "../../lib/propiedades/types";
import ResponsablesPicker from "../propiedades/ResponsablesPicker";
import { acceptButton, baseInput, message, Modal, Notice, NumInput } from "../presupuesto/ui";
import { area, ayuda, botonSecundario, campo, h3, linkBtn, parrafo } from "./estilos";

/** "https://web.connect.trimble.com/projects/AbC123/data" or "AbC123" -> "AbC123". */
function projectIdFrom(text: string): string {
  const t = text.trim();
  const m = /projects\/([A-Za-z0-9_-]{4,64})/.exec(t);
  return m ? m[1] : t;
}

/**
 * Who edits besides the administrators, which project holds the parameter
 * catalog, the TDI group names, the garbage values and the yellow threshold.
 */
export default function ConfigDialog({
  api,
  estado,
  onChanged,
  onClose,
}: {
  api: LoinApi;
  estado: EstadoResponse;
  onChanged: (estado: EstadoResponse, baseCambiada: boolean) => void;
  onClose: () => void;
}) {
  const [editores, setEditores] = useState<Responsable[]>(estado.config.editores);
  const [contacts, setContacts] = useState<ProjectContacts | null>(null);
  const [contactsError, setContactsError] = useState("");
  const [base, setBase] = useState("");
  const [grupos, setGrupos] = useState<GrupoTdi[]>(estado.tdiGrupos);
  const [basura, setBasura] = useState(estado.config.valoresBasura.join("\n"));
  const [umbral, setUmbral] = useState<number>(estado.config.umbralAmarillo);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const admin = estado.isAdmin;
  const cfg = estado.config;

  const loadContacts = useCallback(async () => {
    setContactsError("");
    try {
      setContacts(await api.getContacts());
    } catch (err) {
      setContactsError(message(err));
    }
  }, [api]);

  useEffect(() => {
    if (admin) loadContacts();
  }, [admin, loadContacts]);

  async function correr(accion: () => Promise<{ estado: EstadoResponse; baseCambiada?: boolean }>, texto: string) {
    setBusy(true);
    setError("");
    setOk("");
    try {
      const r = await accion();
      onChanged(r.estado, !!r.baseCambiada);
      setOk(texto);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const guardarConfig = (patch: Parameters<LoinApi["updateConfig"]>[0], texto: string) =>
    correr(async () => ({ estado: await api.updateConfig(patch), baseCambiada: patch.baseProjectId !== undefined }), texto);

  const libre = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").find((l) => !grupos.some((g) => g.codigo === l));

  return (
    <Modal title="Configuración de Requisitos BIM" onClose={onClose} width={860}>
      <div style={{ padding: "14px 18px 18px", display: "flex", flexDirection: "column", gap: 18 }}>
        {error && <Notice kind="error">{error}</Notice>}
        {ok && <Notice kind="info">{ok}</Notice>}

        <section>
          <h3 style={h3}>Catálogo de parámetros</h3>
          <p style={parrafo}>
            {estado.esBasePropia ? (
              <>Este proyecto usa <strong>su propio catálogo</strong>.</>
            ) : (
              <>
                Este proyecto usa el catálogo del proyecto base <strong>{cfg.baseProjectName || cfg.baseProjectId}</strong> ({cfg.baseProjectId}).
              </>
            )}{" "}
            {estado.canEditBase ? "Puedes modificarlo." : estado.baseNote}
          </p>
          <p style={{ ...parrafo, color: "var(--tc-gray-500)" }}>
            Para mantener un solo diccionario de datos para toda la empresa, crea un proyecto en Trimble Connect (p. ej. &quot;BASE REQUISITOS BIM&quot;), carga allí el catálogo y las plantillas, y en
            cada obra elige ese proyecto como base. Las disciplinas y elementos de cada obra siguen siendo suyos.
          </p>
          {admin ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="Id o enlace del proyecto base (debes ser su administrador o editor)" style={{ ...baseInput, flex: "1 1 340px", fontSize: 14, padding: "8px 10px" }} aria-label="Proyecto base" />
              <button type="button" style={acceptButton} disabled={busy || !projectIdFrom(base)} onClick={() => guardarConfig({ baseProjectId: projectIdFrom(base) }, "Listo: este proyecto ahora usa el catálogo del proyecto base.")}>
                Usar como base
              </button>
              {!estado.esBasePropia && (
                <button type="button" style={botonSecundario} disabled={busy} onClick={() => guardarConfig({ baseProjectId: null }, "Listo: este proyecto usa de nuevo su propio catálogo.")}>
                  Usar el catálogo propio
                </button>
              )}
            </div>
          ) : (
            <p style={{ ...ayuda }}>Solo los administradores del proyecto cambian la base.</p>
          )}
        </section>

        <section>
          <h3 style={h3}>Editores</h3>
          <p style={parrafo}>
            Los administradores del proyecto siempre pueden editar. Además, estas personas o grupos editan las disciplinas, los elementos y (en las fases siguientes) la matriz, las reglas y las
            auditorías{estado.esBasePropia ? ", y el catálogo de este proyecto" : ""}. El resto del equipo solo consulta.
          </p>
          {admin ? (
            <>
              <ResponsablesPicker id="loin-editores" value={withCurrentNames(editores, contacts)} onChange={setEditores} contacts={contacts} contactsError={contactsError} onRetry={loadContacts} />
              <div style={{ marginTop: 10 }}>
                <button type="button" style={acceptButton} disabled={busy} onClick={() => guardarConfig({ editores }, "Editores guardados.")}>
                  Guardar editores
                </button>
              </div>
            </>
          ) : (
            <p style={{ ...parrafo, fontSize: 13.5 }}>{cfg.editores.length ? `Editores: ${describeResponsables(cfg.editores)}.` : "No hay editores designados: solo editan los administradores."}</p>
          )}
        </section>

        <section>
          <h3 style={h3}>Grupos TDI (tipo de información)</h3>
          <p style={ayuda}>Los nombres de los grupos son del catálogo. Una letra que usa algún parámetro no se puede quitar.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {grupos.map((g, i) => (
              <div key={g.codigo} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <strong style={{ width: 52 }}>TDI-{g.codigo}</strong>
                <input
                  value={g.nombre}
                  onChange={(e) => setGrupos(grupos.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))}
                  readOnly={!estado.canEditBase}
                  maxLength={120}
                  style={{ ...campo, flex: 1, width: "auto" }}
                  aria-label={`Nombre del grupo TDI-${g.codigo}`}
                />
                {estado.canEditBase && (
                  <button type="button" style={linkBtn} onClick={() => setGrupos(grupos.filter((_, j) => j !== i))}>
                    Quitar
                  </button>
                )}
              </div>
            ))}
          </div>
          {estado.canEditBase && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {libre && (
                <button type="button" style={botonSecundario} onClick={() => setGrupos([...grupos, { codigo: libre, nombre: "" }].sort((a, b) => a.codigo.localeCompare(b.codigo)))}>
                  + Grupo TDI-{libre}
                </button>
              )}
              <button type="button" style={botonSecundario} onClick={() => setGrupos(TDI_INICIALES)}>
                Restablecer los de fábrica
              </button>
              <button
                type="button"
                style={acceptButton}
                disabled={busy || grupos.some((g) => !g.nombre.trim())}
                onClick={() => correr(async () => {
                  const tdiGrupos = await api.guardarGruposTdi(grupos);
                  return { estado: { ...estado, tdiGrupos } };
                }, "Grupos TDI guardados.")}
              >
                Guardar grupos
              </button>
            </div>
          )}
        </section>

        <section>
          <h3 style={h3}>Auditoría: valores de relleno y colores</h3>
          <p style={ayuda}>
            Valores que en un parámetro de texto o lista cuentan como &quot;sin llenar&quot; (uno por línea; no distingue mayúsculas ni tildes). En los números un 0 no es relleno: lo decide el mínimo
            de su regla.
          </p>
          <textarea value={basura} onChange={(e) => setBasura(e.target.value)} readOnly={!estado.canEdit} style={{ ...area, minHeight: 120, marginTop: 6 }} aria-label="Valores de relleno" />
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap", fontSize: 14 }}>
            <span>Verde: 100 % de los obligatorios · Amarillo: desde</span>
            <NumInput value={umbral} decimals={0} onCommit={estado.canEdit ? (v) => v !== null && setUmbral(Math.min(99, Math.round(v))) : undefined} style={{ width: 60 }} ariaLabel="Umbral del amarillo" />
            <span>% · Rojo: por debajo · Gris: sin clasificar</span>
          </div>
          {estado.canEdit && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button type="button" style={botonSecundario} onClick={() => setBasura(VALORES_BASURA_INICIALES.join("\n"))}>
                Restablecer los de fábrica
              </button>
              <button
                type="button"
                style={acceptButton}
                disabled={busy}
                onClick={() => guardarConfig({ valoresBasura: basura.split("\n").map((v) => v.trim()).filter(Boolean), umbralAmarillo: umbral }, "Valores de relleno y umbral guardados.")}
              >
                Guardar
              </button>
            </div>
          )}
        </section>

        <p style={{ ...ayuda, margin: 0 }}>
          Tu acceso: {estado.canEdit ? "puedes editar los requisitos de este proyecto" : "solo consulta"} · {estado.canEditBase ? "puedes editar el catálogo" : "catálogo en solo lectura"}.
        </p>
      </div>
    </Modal>
  );
}
