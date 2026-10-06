"use client";

import { CSSProperties, useCallback, useEffect, useState } from "react";
import { describeResponsables, withCurrentNames } from "../../lib/propiedades/responsables";
import type { ProjectContacts, Responsable } from "../../lib/propiedades/types";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import type { EstadoResponse } from "../../lib/presupuesto/types";
import ResponsablesPicker from "../propiedades/ResponsablesPicker";
import { acceptButton, baseInput, message, Modal, Notice } from "./ui";

/** "https://web.connect.trimble.com/projects/AbC123/data" or "AbC123" -> "AbC123". */
export function projectIdFrom(text: string): string {
  const t = text.trim();
  const m = /projects\/([A-Za-z0-9_-]{4,64})/.exec(t);
  return m ? m[1] : t;
}

/**
 * Who edits the budget besides the administrators, and which project holds
 * the catalogs (the project itself, or a shared base project).
 */
export default function ConfigDialog({
  api,
  estado,
  onChanged,
  onClose,
}: {
  api: PresupuestoApi;
  estado: EstadoResponse;
  onChanged: (estado: EstadoResponse, baseCambiada: boolean) => void;
  onClose: () => void;
}) {
  const [editores, setEditores] = useState<Responsable[]>(estado.config.editores);
  const [contacts, setContacts] = useState<ProjectContacts | null>(null);
  const [contactsError, setContactsError] = useState("");
  const [base, setBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const admin = estado.isAdmin;

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

  async function guardar(patch: { baseProjectId?: string | null; editores?: Responsable[] }, texto: string) {
    setBusy(true);
    setError("");
    setOk("");
    try {
      const next = await api.updateConfig(patch);
      onChanged(next, patch.baseProjectId !== undefined);
      setOk(texto);
      setBase("");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const cfg = estado.config;
  return (
    <Modal title="Configuración del presupuesto" onClose={onClose} width={820}>
      <div style={{ padding: "14px 18px 18px", display: "flex", flexDirection: "column", gap: 18 }}>
        {error && <Notice kind="error">{error}</Notice>}
        {ok && <Notice kind="info">{ok}</Notice>}

        <section>
          <h3 style={h3}>Base de datos de catálogos (insumos y partidas)</h3>
          <p style={p}>
            {estado.esBasePropia ? (
              <>Este proyecto usa <strong>su propio catálogo</strong>.</>
            ) : (
              <>
                Este proyecto usa el catálogo del proyecto base <strong>{cfg.baseProjectName || cfg.baseProjectId}</strong> ({cfg.baseProjectId}).
              </>
            )}{" "}
            {estado.canEditBase ? "Puedes modificarlo." : estado.baseNote}
          </p>
          <p style={{ ...p, color: "var(--tc-gray-500)" }}>
            Para tener una sola base para toda la empresa, crea un proyecto en Trimble Connect (p. ej. &quot;BASE DE DATOS PRESUPUESTOS&quot;), carga allí los
            catálogos y, en cada obra, elige ese proyecto como base. Sus administradores y editores mantienen la base; las obras la usan en solo lectura y
            cada presupuesto conserva sus propios precios.
          </p>
          {admin ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                value={base}
                onChange={(e) => setBase(e.target.value)}
                placeholder="Id o enlace del proyecto base (debes ser su administrador o editor)"
                style={{ ...baseInput, flex: "1 1 340px", fontSize: 14, padding: "8px 10px" }}
                aria-label="Proyecto base"
              />
              <button
                type="button"
                style={acceptButton}
                disabled={busy || !projectIdFrom(base)}
                onClick={() => guardar({ baseProjectId: projectIdFrom(base) }, "Listo: este proyecto ahora usa el catálogo del proyecto base.")}
              >
                Usar como base
              </button>
              {!estado.esBasePropia && (
                <button type="button" style={{ ...acceptButton, background: "#e6e9ee", color: "var(--tc-gray-700)" }} disabled={busy} onClick={() => guardar({ baseProjectId: null }, "Listo: este proyecto usa de nuevo su propio catálogo.")}>
                  Usar el catálogo propio
                </button>
              )}
            </div>
          ) : (
            <p style={{ ...p, fontSize: 13, color: "var(--tc-gray-500)" }}>Solo los administradores del proyecto cambian la base.</p>
          )}
        </section>

        <section>
          <h3 style={h3}>Editores</h3>
          <p style={p}>
            Los administradores del proyecto siempre pueden editar. Además, estas personas o grupos pueden modificar el presupuesto y asociar elementos en el
            visor 3D{estado.esBasePropia ? ", y modificar los catálogos de este proyecto" : ""}. El resto del equipo solo consulta.
          </p>
          {admin ? (
            <>
              <ResponsablesPicker id="presupuesto-editores" value={withCurrentNames(editores, contacts)} onChange={setEditores} contacts={contacts} contactsError={contactsError} onRetry={loadContacts} />
              <div style={{ marginTop: 10 }}>
                <button type="button" style={acceptButton} disabled={busy} onClick={() => guardar({ editores }, "Editores guardados.")}>
                  Guardar editores
                </button>
              </div>
            </>
          ) : (
            <p style={{ ...p, fontSize: 13.5 }}>{cfg.editores.length ? `Editores: ${describeResponsables(cfg.editores)}.` : "No hay editores designados: solo editan los administradores."}</p>
          )}
        </section>
        <p style={{ ...p, fontSize: 13, color: "var(--tc-gray-500)", margin: 0 }}>
          Tu acceso: {estado.canEdit ? "puedes editar el presupuesto" : "solo consulta"} · {estado.canEditBase ? "puedes editar los catálogos" : "catálogos en solo lectura"}.
        </p>
      </div>
    </Modal>
  );
}

const h3: CSSProperties = { margin: "0 0 6px", fontSize: 15.5, color: "var(--tc-blue-900)" };
const p: CSSProperties = { margin: "0 0 8px", fontSize: 14, lineHeight: 1.5 };
