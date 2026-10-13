"use client";

import { CSSProperties, useCallback, useEffect, useState } from "react";
import { describeResponsables, withCurrentNames } from "../../lib/propiedades/responsables";
import type { ProjectContacts, Responsable } from "../../lib/propiedades/types";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import { AtributoPropiedad, ColumnaMemoria, DEFAULT_COLUMNAS_MEMORIA, EstadoResponse, MAX_COLUMNAS_MEMORIA } from "../../lib/presupuesto/types";
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
        {estado.canEdit && (
          <ColumnasMemoria
            columnas={cfg.memoriaColumnas}
            api={api}
            onSaved={(next) => {
              onChanged(next, false);
              setOk("Columnas de la memoria de cantidades guardadas.");
            }}
            onError={setError}
          />
        )}
        <p style={{ ...p, fontSize: 13, color: "var(--tc-gray-500)", margin: 0 }}>
          Tu acceso: {estado.canEdit ? "puedes editar el presupuesto" : "solo consulta"} · {estado.canEditBase ? "puedes editar los catálogos" : "catálogos en solo lectura"}.
        </p>
      </div>
    </Modal>
  );
}

const SUGERIDAS = ["Bloque", "Conjunto", "Zona", "Nombre de zona", "Espacio", "Nombre", "Nivel", "Piso", "Torre", "Clase", "Tipo", "Marca", "Material", "Código"];

function nuevoIdColumna(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Which data the memoria de cantidades shows for each linked element: model
 * properties, attributes of the Propiedades app, or the element's IFCGUID.
 */
function ColumnasMemoria({
  columnas,
  api,
  onSaved,
  onError,
}: {
  columnas: ColumnaMemoria[];
  api: PresupuestoApi;
  onSaved: (estado: EstadoResponse) => void;
  onError: (text: string) => void;
}) {
  const [lista, setLista] = useState<ColumnaMemoria[]>(columnas);
  const [atributos, setAtributos] = useState<AtributoPropiedad[] | null>(null);
  const [fuente, setFuente] = useState<ColumnaMemoria["fuente"]>("modelo");
  const [nombre, setNombre] = useState("");
  const [atributo, setAtributo] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getAtributos().then(setAtributos, () => setAtributos([]));
  }, [api]);

  const lleno = lista.length >= MAX_COLUMNAS_MEMORIA;
  const cambio = JSON.stringify(lista) !== JSON.stringify(columnas);

  function agregar() {
    if (lleno) return;
    if (fuente === "modelo") {
      const clave = nombre.trim();
      if (!clave) return;
      setLista([...lista, { id: nuevoIdColumna(), label: clave, fuente, clave }]);
      setNombre("");
    } else if (fuente === "propiedad") {
      const a = atributos?.find((x) => x.id === atributo);
      if (!a) return;
      setLista([...lista, { id: nuevoIdColumna(), label: a.title, fuente, clave: a.id }]);
      setAtributo("");
    } else {
      setLista([...lista, { id: nuevoIdColumna(), label: "ID (IFCGUID)", fuente, clave: "" }]);
    }
  }

  function mover(i: number, d: number) {
    const j = i + d;
    if (j < 0 || j >= lista.length) return;
    const copia = [...lista];
    [copia[i], copia[j]] = [copia[j], copia[i]];
    setLista(copia);
  }

  async function guardar(valor: ColumnaMemoria[]) {
    setBusy(true);
    onError("");
    try {
      onSaved(await api.updateConfig({ memoriaColumnas: valor }));
    } catch (err) {
      onError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const origen = (c: ColumnaMemoria) =>
    c.fuente === "modelo" ? `Modelo: ${c.clave}` : c.fuente === "propiedad" ? "App Propiedades" : "IFCGUID del elemento";

  return (
    <section>
      <h3 style={h3}>Columnas de la memoria de cantidades</h3>
      <p style={p}>
        Los datos que se ven de cada elemento al desplegar la memoria de una partida (hasta {MAX_COLUMNAS_MEMORIA}). Pueden salir de las propiedades del
        modelo (por su nombre: Bloque, Zona, Nivel, Nombre...) o de los atributos de la app Propiedades. Los del modelo se leen cuando los elementos se
        asocian en el visor; tras cambiar las columnas, usa "Actualizar los datos de la memoria desde el modelo" en cada partida. Los de Propiedades se
        ven siempre al día.
      </p>
      <ol style={{ margin: "0 0 10px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
        {lista.map((c, i) => (
          <li key={c.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ width: 20, color: "var(--tc-gray-500)", textAlign: "right" }}>{i + 1}</span>
            <input
              value={c.label}
              maxLength={40}
              onChange={(e) => setLista(lista.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)))}
              style={{ ...baseInput, width: 190, fontSize: 14 }}
              aria-label={`Título de la columna ${i + 1}`}
            />
            <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)", flex: "1 1 160px" }}>{origen(c)}</span>
            <button type="button" style={miniBtn} onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir la columna">
              ↑
            </button>
            <button type="button" style={miniBtn} onClick={() => mover(i, 1)} disabled={i === lista.length - 1} aria-label="Bajar la columna">
              ↓
            </button>
            <button type="button" style={{ ...miniBtn, color: "#8a1c14" }} onClick={() => setLista(lista.filter((x) => x.id !== c.id))} aria-label="Quitar la columna">
              ✕
            </button>
          </li>
        ))}
        {lista.length === 0 && <li style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>Sin columnas: la memoria solo mostrará la cantidad y el valor.</li>}
      </ol>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <select value={fuente} onChange={(e) => setFuente(e.target.value as ColumnaMemoria["fuente"])} style={{ ...baseInput, fontSize: 14 }} aria-label="Origen de la nueva columna">
          <option value="modelo">Propiedad del modelo</option>
          <option value="propiedad">Atributo de la app Propiedades</option>
          <option value="ifcguid">ID del elemento (IFCGUID)</option>
        </select>
        {fuente === "modelo" && (
          <>
            <input
              value={nombre}
              list="presupuesto-props-modelo"
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && agregar()}
              placeholder="Nombre de la propiedad (p. ej. Nivel)"
              style={{ ...baseInput, width: 260, fontSize: 14 }}
              aria-label="Nombre de la propiedad del modelo"
            />
            <datalist id="presupuesto-props-modelo">
              {SUGERIDAS.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </>
        )}
        {fuente === "propiedad" && (
          <select value={atributo} onChange={(e) => setAtributo(e.target.value)} style={{ ...baseInput, fontSize: 14, minWidth: 220 }} aria-label="Atributo de Propiedades">
            <option value="">{atributos === null ? "Cargando..." : atributos.length ? "Elige un atributo..." : "No hay atributos en Propiedades"}</option>
            {(atributos ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        )}
        <button type="button" style={secondary} onClick={agregar} disabled={lleno || (fuente === "modelo" && !nombre.trim()) || (fuente === "propiedad" && !atributo)}>
          + Agregar columna
        </button>
        {lleno && <span style={{ fontSize: 12.5, color: "#7a5300" }}>Máximo {MAX_COLUMNAS_MEMORIA} columnas.</span>}
      </div>
      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" style={acceptButton} disabled={busy || !cambio} onClick={() => guardar(lista)}>
          Guardar columnas
        </button>
        <button type="button" style={secondary} disabled={busy} onClick={() => setLista(DEFAULT_COLUMNAS_MEMORIA)}>
          Restablecer las de fábrica
        </button>
      </div>
    </section>
  );
}

const secondary: CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  background: "var(--tc-white)",
  color: "var(--tc-blue-700)",
  borderRadius: 4,
  padding: "6px 12px",
  fontSize: 14,
  cursor: "pointer",
  fontFamily: "inherit",
};
const miniBtn: CSSProperties = { border: "1px solid var(--tc-gray-300)", background: "#fff", borderRadius: 4, width: 30, height: 30, cursor: "pointer", fontFamily: "inherit" };
const h3: CSSProperties = { margin: "0 0 6px", fontSize: 15.5, color: "var(--tc-blue-900)" };
const p: CSSProperties = { margin: "0 0 8px", fontSize: 14, lineHeight: 1.5 };
