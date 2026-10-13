"use client";

import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import { fecha } from "../../lib/presupuesto/format";
import {
  AtributoPropiedad,
  CampoModelo,
  CamposModelo,
  ColumnaMemoria,
  DEFAULT_COLUMNAS_MEMORIA,
  EstadoResponse,
  MAX_COLUMNAS_MEMORIA,
} from "../../lib/presupuesto/types";
import { leerCamposModelos, Visor } from "../../lib/presupuesto/viewerMap";
import Picker from "./Picker";
import { acceptButton, baseInput, message } from "./ui";

function nuevoIdColumna(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const KIND: Record<CampoModelo["kind"], string> = { number: "número", text: "texto", date: "fecha" };

/**
 * Which data the memoria de cantidades shows for each linked element: model
 * properties (chosen from those found in the models loaded in the viewer),
 * attributes of the Propiedades app, or the element's IFCGUID. In the viewer
 * (`visor`), it can also read the models' properties.
 */
export default function ColumnasMemoria({
  columnas,
  api,
  puedeEditar,
  visor,
  onActualizarMemoria,
  onSaved,
  onError,
}: {
  columnas: ColumnaMemoria[];
  api: PresupuestoApi;
  puedeEditar: boolean;
  /** Present when this runs in the 3D viewer: the models' properties can be read from it. */
  visor?: Visor;
  /** Updates the memoria de cantidades of every partida with the models linked to the budget. */
  onActualizarMemoria?: () => Promise<void>;
  onSaved: (estado: EstadoResponse) => void;
  onError: (text: string) => void;
}) {
  const [lista, setLista] = useState<ColumnaMemoria[]>(columnas);
  const [atributos, setAtributos] = useState<AtributoPropiedad[] | null>(null);
  const [modelo, setModelo] = useState<CamposModelo | null>(null);
  const [fuente, setFuente] = useState<ColumnaMemoria["fuente"]>("modelo");
  const [atributo, setAtributo] = useState("");
  const [busy, setBusy] = useState(false);
  const [claveSelector, setClaveSelector] = useState(0);
  const [completo, setCompleto] = useState(false);
  const [leyendo, setLeyendo] = useState("");
  const cancelar = useRef(false);
  const [actualizando, setActualizando] = useState(false);
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    try {
      const r = await api.getAtributos();
      setAtributos(r.atributos);
      setModelo(r.modelo);
    } catch {
      setAtributos([]);
    }
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const lleno = lista.length >= MAX_COLUMNAS_MEMORIA;
  const cambio = JSON.stringify(lista) !== JSON.stringify(columnas);
  const campos = modelo?.campos ?? [];

  function agregarModelo(clave: string, label: string) {
    if (lleno || !clave.trim()) return;
    setLista((l) => [...l, { id: nuevoIdColumna(), label: label.trim().slice(0, 40) || clave.trim().slice(0, 40), fuente: "modelo", clave: clave.trim() }]);
    setClaveSelector((k) => k + 1);
  }

  function agregar() {
    if (lleno) return;
    if (fuente === "propiedad") {
      const a = atributos?.find((x) => x.id === atributo);
      if (!a) return;
      setLista([...lista, { id: nuevoIdColumna(), label: a.title, fuente, clave: a.id }]);
      setAtributo("");
    } else if (fuente === "ifcguid") {
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

  async function leer() {
    if (!visor) return;
    cancelar.current = false;
    setLeyendo("Preparando la lectura...");
    onError("");
    try {
      const r = await leerCamposModelos(visor, { completo, onProgress: setLeyendo, cancelado: () => cancelar.current });
      if (!r) return;
      setLeyendo("Guardando...");
      await api.guardarCamposModelo(r);
      await cargar();
    } catch (err) {
      onError(message(err));
    } finally {
      setLeyendo("");
    }
  }

  async function actualizarTodas() {
    if (!onActualizarMemoria) return;
    setActualizando(true);
    setAviso("");
    onError("");
    try {
      await onActualizarMemoria();
      setAviso(visor ? "" : "Abriendo el visor 3D: abre el panel Presupuesto y la actualización empieza sola.");
    } catch (err) {
      onError(message(err));
    } finally {
      setActualizando(false);
    }
  }

  const origen = (c: ColumnaMemoria) => (c.fuente === "modelo" ? `Modelo: ${c.clave}` : c.fuente === "propiedad" ? "App Propiedades" : "IFCGUID del elemento");

  return (
    <section>
      <h3 style={h3}>Columnas de la memoria de cantidades</h3>
      <p style={p}>
        Los datos que se ven de cada elemento al desplegar la memoria de una partida (hasta {MAX_COLUMNAS_MEMORIA}). Pueden salir de las propiedades del
        modelo, de los atributos de la app Propiedades o ser el ID del elemento. Los datos del modelo se leen cuando los elementos se asocian en el
        visor; tras cambiar las columnas, usa &quot;Actualizar los datos de la memoria desde el modelo&quot; en cada partida. Los de Propiedades se ven
        siempre al día.
      </p>

      <ol style={{ margin: "0 0 10px", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
        {lista.map((c, i) => (
          <li key={c.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ width: 20, color: "var(--tc-gray-500)", textAlign: "right" }}>{i + 1}</span>
            <input
              value={c.label}
              maxLength={40}
              readOnly={!puedeEditar}
              onChange={(e) => setLista(lista.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)))}
              style={{ ...baseInput, width: 190, fontSize: 14 }}
              aria-label={`Título de la columna ${i + 1}`}
            />
            <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)", flex: "1 1 160px" }}>{origen(c)}</span>
            {puedeEditar && (
              <>
                <button type="button" style={miniBtn} onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir la columna">
                  ↑
                </button>
                <button type="button" style={miniBtn} onClick={() => mover(i, 1)} disabled={i === lista.length - 1} aria-label="Bajar la columna">
                  ↓
                </button>
                <button type="button" style={{ ...miniBtn, color: "#8a1c14" }} onClick={() => setLista(lista.filter((x) => x.id !== c.id))} aria-label="Quitar la columna">
                  ✕
                </button>
              </>
            )}
          </li>
        ))}
        {lista.length === 0 && <li style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>Sin columnas: la memoria solo mostrará la cantidad y el valor.</li>}
      </ol>

      {puedeEditar && (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
            <select value={fuente} onChange={(e) => setFuente(e.target.value as ColumnaMemoria["fuente"])} style={{ ...baseInput, fontSize: 14 }} aria-label="Origen de la nueva columna">
              <option value="modelo">Propiedad del modelo</option>
              <option value="propiedad">Atributo de la app Propiedades</option>
              <option value="ifcguid">ID del elemento (IFCGUID)</option>
            </select>
            {fuente === "modelo" && (
              <Picker<CampoModelo>
                key={claveSelector}
                options={campos}
                textOf={(c) => `${c.label} ${c.group} ${c.key}`}
                keepOpen
                autoFocus={false}
                placeholder={campos.length ? `Busca entre ${campos.length.toLocaleString("es")} propiedades de los modelos...` : "Escribe el nombre de la propiedad (p. ej. Nivel)"}
                style={{ width: 360 }}
                render={(c) => (
                  <span style={{ display: "inline-flex", gap: 8, alignItems: "baseline" }}>
                    <strong style={{ fontWeight: 600 }}>{c.label}</strong>
                    <span style={{ color: "var(--tc-gray-500)", fontSize: 12 }}>
                      {c.group} · {KIND[c.kind]} · {c.count.toLocaleString("es")}
                    </span>
                  </span>
                )}
                onPick={(c) => agregarModelo(c.key, c.label)}
                noMatch={{
                  onEnter: (q) => agregarModelo(q, q),
                  render: (q) => (
                    <div style={floating}>
                      <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>«{q}» no está en la lista leída.</span>
                      <button
                        type="button"
                        style={floatingBtn}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          agregarModelo(q, q);
                        }}
                      >
                        Usar «{q}» por su nombre
                      </button>
                    </div>
                  ),
                }}
              />
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
            {fuente !== "modelo" && (
              <button type="button" style={secondary} onClick={agregar} disabled={lleno || (fuente === "propiedad" && !atributo)}>
                + Agregar columna
              </button>
            )}
            {lleno && <span style={{ fontSize: 12.5, color: "#7a5300", alignSelf: "center" }}>Máximo {MAX_COLUMNAS_MEMORIA} columnas.</span>}
          </div>

          {fuente === "modelo" && (
            <div style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--tc-gray-500)", lineHeight: 1.5 }}>
              {modelo ? (
                <>
                  {campos.length.toLocaleString("es")} propiedades leídas de {modelo.modelos.join(", ") || "los modelos"} el {fecha(modelo.leido)}
                  {modelo.leidoPor ? ` por ${modelo.leidoPor}` : ""}.
                </>
              ) : (
                <>Todavía no se leyeron las propiedades de los modelos.</>
              )}{" "}
              {visor ? (
                <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
                  <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                    <input type="checkbox" checked={completo} disabled={!!leyendo} onChange={(e) => setCompleto(e.target.checked)} />
                    Leer todos los elementos (más lento; la lectura rápida usa una muestra y puede no ver propiedades poco comunes)
                  </label>
                  {leyendo ? (
                    <>
                      <span>{leyendo}</span>
                      <button type="button" style={secondary} onClick={() => (cancelar.current = true)}>
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button type="button" style={secondary} onClick={leer}>
                      Leer las propiedades de los modelos cargados
                    </button>
                  )}
                </span>
              ) : (
                <>Para verlas aquí, abre el panel Presupuesto del visor 3D con los modelos cargados y pulsa «Columnas» → «Leer las propiedades de los modelos cargados».</>
              )}
            </div>
          )}

          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={acceptButton} disabled={busy || !cambio} onClick={() => guardar(lista)}>
              Guardar columnas
            </button>
            <button type="button" style={secondary} disabled={busy} onClick={() => setLista(DEFAULT_COLUMNAS_MEMORIA)}>
              Restablecer las de fábrica
            </button>
            {onActualizarMemoria && (
              <button
                type="button"
                style={{ ...secondary, borderColor: "var(--tc-blue-700)", fontWeight: 600 }}
                disabled={busy || actualizando || cambio}
                onClick={actualizarTodas}
                title={cambio ? "Guarda las columnas primero" : "Lee del modelo los datos de las columnas en todas las partidas que ya tienen elementos asociados"}
              >
                {actualizando ? "Preparando..." : "Actualizar la memoria de todas las partidas"}
              </button>
            )}
          </div>
          {onActualizarMemoria && (
            <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--tc-gray-500)", lineHeight: 1.5 }}>
              {visor
                ? "Lee los modelos asociados al presupuesto (carga los que falten y los descarga al terminar) y guarda los datos de las columnas en cada elemento."
                : "Los modelos solo se pueden leer en el visor 3D: esto lo abre, y su panel Presupuesto lee todos los modelos asociados al presupuesto (carga los que falten y los descarga al terminar). Guarda el presupuesto antes."}
            </p>
          )}
          {aviso && <p style={{ margin: "6px 0 0", fontSize: 13, color: "var(--tc-blue-800)" }}>{aviso}</p>}
        </>
      )}
    </section>
  );
}

const secondary: CSSProperties = {
  border: "1px solid var(--tc-blue-500)",
  background: "var(--tc-white)",
  color: "var(--tc-blue-700)",
  borderRadius: 4,
  padding: "6px 12px",
  fontSize: 13.5,
  cursor: "pointer",
  fontFamily: "inherit",
};
const miniBtn: CSSProperties = { border: "1px solid var(--tc-gray-300)", background: "#fff", borderRadius: 4, width: 30, height: 30, cursor: "pointer", fontFamily: "inherit" };
const h3: CSSProperties = { margin: "0 0 6px", fontSize: 15.5, color: "var(--tc-blue-900)" };
const p: CSSProperties = { margin: "0 0 8px", fontSize: 14, lineHeight: 1.5 };
const floating: CSSProperties = { display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #8899b3", boxShadow: "0 6px 18px rgba(0,0,0,0.2)", padding: "6px 8px", whiteSpace: "nowrap" };
const floatingBtn: CSSProperties = { border: "1px solid #444", background: "#f0f0f0", borderRadius: 3, padding: "4px 10px", fontSize: 13.5, cursor: "pointer", fontFamily: "inherit" };
