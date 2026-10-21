"use client";

import { CSSProperties, useState } from "react";
import { leerAlias, normalizarNombre, textoAlias } from "../../lib/loin/alias";
import type { LoinApi } from "../../lib/loin/client";
import { errorPatron, MOTIVOS, revisarValor } from "../../lib/loin/reglas";
import { codigoDyco } from "../../lib/loin/semilla";
import { Alias, CamposModelo, EstadoResponse, GrupoTdi, NDIS, Ndi, ORIGENES, OrigenDato, Parametro, ParametroData, REGLA_VACIA, TIPOS_DATO, TipoDato } from "../../lib/loin/types";
import { coincide, fecha } from "../../lib/presupuesto/format";
import { acceptButton, labelStyle, message, Modal, Notice, NumInput } from "../presupuesto/ui";
import { area, ayuda, botonSecundario, campo, h3, linkBtn, select, sugerida } from "./estilos";

function nuevoParametro(parametros: Parametro[], tdi: string): ParametroData {
  const numero = Math.max(0, ...parametros.map((p) => p.numero ?? 0)) + 1;
  return {
    codigo: codigoDyco(numero),
    numero,
    nombre: "",
    descripcion: "",
    tdi,
    ndi: 1,
    origen: "a_ingresar",
    tipoDato: "texto",
    unidad: "",
    valoresPermitidos: [],
    regla: { ...REGLA_VACIA },
    alias: [],
    idsUri: "",
    activo: true,
  };
}

/** One parameter of the catalog: what it is, its type and rule, and where to read it in the models. */
export default function ParametroDialog({
  api,
  estado,
  tdiGrupos,
  parametros,
  parametro,
  puedeEditar,
  camposModelo,
  onGuardado,
  onClose,
}: {
  api: LoinApi;
  estado: EstadoResponse;
  tdiGrupos: GrupoTdi[];
  parametros: Parametro[];
  parametro: Parametro | null;
  puedeEditar: boolean;
  /** Property names read from the models in the 3D viewer (null: not read yet). */
  camposModelo: CamposModelo | null;
  onGuardado: (p: Parametro) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<ParametroData>(() => (parametro ? structuredClone(parametro) : nuevoParametro(parametros, tdiGrupos[0]?.codigo ?? "A")));
  const [valoresTexto, setValoresTexto] = useState(() => d.valoresPermitidos.join("\n"));
  const [nuevoAlias, setNuevoAlias] = useState("");
  const [prueba, setPrueba] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ro = !puedeEditar;
  const set = (patch: Partial<ParametroData>) => setD((x) => ({ ...x, ...patch }));
  const setAlias = (alias: Alias[]) => set({ alias });
  const errorDelPatron = errorPatron(d.regla.patron);
  const valores = valoresTexto.split("\n").map((v) => v.trim()).filter(Boolean);

  function agregarAlias() {
    const a = leerAlias(nuevoAlias);
    if (!a) {
      setError("Escribe la equivalencia como Grupo.Propiedad, *.Propiedad (cualquier grupo) o @Atributo (atributo IFC).");
      return;
    }
    setError("");
    setAlias([...d.alias, { ...a, sugerida: false }]);
    setNuevoAlias("");
  }

  function mover(i: number, delta: number) {
    const lista = [...d.alias];
    const j = i + delta;
    if (j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    setAlias(lista);
  }

  async function guardar() {
    setError("");
    if (!d.nombre.trim()) return setError("Falta el nombre del parámetro.");
    if (!d.codigo.trim()) return setError("Falta el código interno.");
    if (errorDelPatron) return setError(errorDelPatron);
    setBusy(true);
    try {
      const fila = { ...d, valoresPermitidos: d.tipoDato === "lista" ? valores : d.valoresPermitidos, id: parametro?.id ?? crypto.randomUUID(), version: parametro?.version ?? 0 };
      const [guardado] = await api.guardarParametros([fila]);
      onGuardado(guardado);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  const resultado = prueba.trim() ? revisarValor({ tipoDato: d.tipoDato, valoresPermitidos: valores, unidad: d.unidad }, d.regla, prueba, estado.config.valoresBasura) : null;

  return (
    <Modal
      title={parametro ? `Parámetro ${parametro.codigo} · ${parametro.nombre}` : "Nuevo parámetro"}
      onClose={onClose}
      width={900}
      footer={
        <>
          {parametro && (
            <span style={{ marginRight: "auto", fontSize: 12.5, color: "var(--tc-gray-500)" }}>
              Versión {parametro.version} · {fecha(parametro.actualizado)}
              {parametro.actualizadoPor ? ` · ${parametro.actualizadoPor}` : ""}
            </span>
          )}
          <button type="button" style={botonSecundario} onClick={onClose} disabled={busy}>
            {ro ? "Cerrar" : "Cancelar"}
          </button>
          {!ro && (
            <button type="button" style={acceptButton} onClick={guardar} disabled={busy}>
              {busy ? "Guardando…" : "Guardar"}
            </button>
          )}
        </>
      }
    >
      <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <Notice kind="error">{error}</Notice>}
        {ro && <Notice kind="info">{estado.baseNote}</Notice>}

        <div style={grid}>
          <Campo etiqueta="Código interno" ancho={1}>
            <input value={d.codigo} onChange={(e) => set({ codigo: e.target.value })} readOnly={ro} maxLength={40} style={campo} aria-label="Código interno" />
          </Campo>
          <Campo etiqueta="N° del listado" ancho={1}>
            <NumInput value={d.numero} decimals={0} allowEmpty onCommit={ro ? undefined : (v) => set({ numero: v === null ? null : Math.round(v) })} style={{ width: "100%", textAlign: "left" }} ariaLabel="N° del listado" />
          </Campo>
          <Campo etiqueta="Nombre del parámetro" ancho={4}>
            <input value={d.nombre} onChange={(e) => set({ nombre: e.target.value })} readOnly={ro} maxLength={200} style={campo} aria-label="Nombre del parámetro" />
          </Campo>
          <Campo etiqueta="Descripción" ancho={6}>
            <textarea value={d.descripcion} onChange={(e) => set({ descripcion: e.target.value })} readOnly={ro} maxLength={4000} style={area} aria-label="Descripción" />
          </Campo>
          <Campo etiqueta="TDI (tipo de información)" ancho={2}>
            <select value={d.tdi} onChange={(e) => set({ tdi: e.target.value })} disabled={ro} style={{ ...select, width: "100%" }} aria-label="TDI">
              {!tdiGrupos.some((g) => g.codigo === d.tdi) && <option value={d.tdi}>TDI-{d.tdi} (grupo sin nombre)</option>}
              {tdiGrupos.map((g) => (
                <option key={g.codigo} value={g.codigo}>
                  TDI-{g.codigo} · {g.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="NDI (nivel de información)" ancho={2} ayudaTexto="Acumulativo: un elemento exigido en NDI-2 debe tener sus parámetros NDI-1 y NDI-2.">
            <select value={d.ndi} onChange={(e) => set({ ndi: Number(e.target.value) as Ndi })} disabled={ro} style={{ ...select, width: "100%" }} aria-label="NDI">
              {NDIS.map((n) => (
                <option key={n} value={n}>
                  NDI-{n}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Origen del dato" ancho={2} ayudaTexto="Automática: sale de la geometría o del software (si falta es un problema de modelado). A ingresar: lo escribe el modelador.">
            <select value={d.origen} onChange={(e) => set({ origen: e.target.value as OrigenDato })} disabled={ro} style={{ ...select, width: "100%" }} aria-label="Origen del dato">
              {(Object.entries(ORIGENES) as [OrigenDato, string][]).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Tipo de dato" ancho={2}>
            <select value={d.tipoDato} onChange={(e) => set({ tipoDato: e.target.value as TipoDato })} disabled={ro} style={{ ...select, width: "100%" }} aria-label="Tipo de dato">
              {(Object.entries(TIPOS_DATO) as [TipoDato, string][]).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Unidad" ancho={1}>
            <input value={d.unidad} onChange={(e) => set({ unidad: e.target.value })} readOnly={ro} maxLength={20} placeholder="m, m², kg…" style={campo} aria-label="Unidad" />
          </Campo>
          <Campo etiqueta="URI IDS / bSDD (opcional)" ancho={3}>
            <input value={d.idsUri} onChange={(e) => set({ idsUri: e.target.value })} readOnly={ro} maxLength={500} placeholder="https://identifier.buildingsmart.org/…" style={campo} aria-label="URI IDS / bSDD" />
          </Campo>
        </div>

        <section>
          <h3 style={h3}>Regla de valor</h3>
          <p style={ayuda}>
            Siempre se exige que no esté vacío. Los valores de relleno ({estado.config.valoresBasura.slice(0, 6).join(", ")}…) solo cuentan como vacíos en parámetros de texto o lista: un 0 en un número es
            válido salvo que el mínimo lo impida.
          </p>
          <div style={{ ...grid, marginTop: 8 }}>
            {d.tipoDato === "numero" && (
              <>
                <Campo etiqueta={`Mínimo${d.unidad ? ` (${d.unidad})` : ""}`} ancho={2}>
                  <NumInput value={d.regla.min} decimals={4} allowEmpty onCommit={ro ? undefined : (v) => set({ regla: { ...d.regla, min: v } })} style={{ width: "100%" }} ariaLabel="Mínimo" />
                </Campo>
                <Campo etiqueta={`Máximo${d.unidad ? ` (${d.unidad})` : ""}`} ancho={2}>
                  <NumInput value={d.regla.max} decimals={4} allowEmpty onCommit={ro ? undefined : (v) => set({ regla: { ...d.regla, max: v } })} style={{ width: "100%" }} ariaLabel="Máximo" />
                </Campo>
              </>
            )}
            {(d.tipoDato === "texto" || d.tipoDato === "lista") && (
              <Campo etiqueta="Patrón (expresión regular, opcional)" ancho={3} ayudaTexto="Se aplica al valor completo. Ej.: [A-ZÑ0-9_ ]+ = mayúsculas sin tildes.">
                <input value={d.regla.patron} onChange={(e) => set({ regla: { ...d.regla, patron: e.target.value } })} readOnly={ro} maxLength={300} style={{ ...campo, fontFamily: "monospace" }} aria-label="Patrón" />
                {errorDelPatron && <p style={{ ...ayuda, color: "#b3261e" }}>{errorDelPatron}</p>}
              </Campo>
            )}
            {d.tipoDato === "lista" && (
              <Campo etiqueta="Valores permitidos (uno por línea)" ancho={3} ayudaTexto="Se comparan sin distinguir mayúsculas ni tildes.">
                <textarea value={valoresTexto} onChange={(e) => setValoresTexto(e.target.value)} readOnly={ro} style={{ ...area, minHeight: 110 }} aria-label="Valores permitidos" />
              </Campo>
            )}
            <Campo etiqueta="Probar un valor" ancho={d.tipoDato === "lista" ? 6 : 3}>
              <input value={prueba} onChange={(e) => setPrueba(e.target.value)} placeholder="Escribe un valor como vendría del modelo" style={campo} aria-label="Probar un valor" />
              {resultado && (
                <p style={{ ...ayuda, color: resultado.ok ? "#2e6b22" : "#b3261e", fontWeight: 600 }}>
                  {resultado.ok ? "✓ Cumple" : `✗ ${MOTIVOS[resultado.motivo]}: ${resultado.detalle}`}
                </p>
              )}
            </Campo>
          </div>
        </section>

        <section>
          <h3 style={h3}>Equivalencias de lectura</h3>
          <p style={ayuda}>
            Dónde se busca este parámetro en los modelos, en orden de preferencia: se usa la primera que tenga valor. Grupo.Propiedad (p. ej. Pset_WallCommon.LoadBearing o Datos de identidad.Capacidad de
            carga), *.Propiedad para cualquier grupo, Qto_*BaseQuantities.NetVolume con comodín, o @Name para un atributo IFC. Los nombres no distinguen mayúsculas ni tildes. Las marcadas &quot;sugerida&quot;
            las propuso la app: confírmalas o quítalas.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
            <tbody>
              {d.alias.map((a, i) => (
                <tr key={`${textoAlias(a)}-${i}`}>
                  <td style={celdaAlias}>{i + 1}.</td>
                  <td style={{ ...celdaAlias, width: "100%", fontFamily: "monospace", fontSize: 13 }}>
                    {textoAlias(a)} {a.sugerida && <span style={sugerida}>sugerida</span>}
                  </td>
                  {!ro && (
                    <td style={{ ...celdaAlias, whiteSpace: "nowrap" }}>
                      {a.sugerida && (
                        <button type="button" style={linkBtn} onClick={() => setAlias(d.alias.map((x, j) => (j === i ? { ...x, sugerida: false } : x)))}>
                          Confirmar
                        </button>
                      )}{" "}
                      <button type="button" style={mini} onClick={() => mover(i, -1)} aria-label="Subir" disabled={i === 0}>
                        ↑
                      </button>
                      <button type="button" style={mini} onClick={() => mover(i, 1)} aria-label="Bajar" disabled={i === d.alias.length - 1}>
                        ↓
                      </button>
                      <button type="button" style={mini} onClick={() => setAlias(d.alias.filter((_, j) => j !== i))} aria-label="Quitar">
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {d.alias.length === 0 && <p style={ayuda}>Sin equivalencias: la auditoría no sabría dónde leerlo.</p>}
          {!ro && (
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <input
                value={nuevoAlias}
                onChange={(e) => setNuevoAlias(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && agregarAlias()}
                placeholder="Grupo.Propiedad"
                style={{ ...campo, flex: "1 1 300px", width: "auto", fontFamily: "monospace" }}
                aria-label="Nueva equivalencia"
              />
              <button type="button" style={botonSecundario} onClick={agregarAlias}>
                Agregar equivalencia
              </button>
              {d.alias.some((a) => a.sugerida) && (
                <button type="button" style={botonSecundario} onClick={() => setAlias(d.alias.map((a) => ({ ...a, sugerida: false })))}>
                  Confirmar todas
                </button>
              )}
            </div>
          )}
          {!ro && <LeidosDelModelo camposModelo={camposModelo} nombre={d.nombre} onAgregar={(a) => setAlias([...d.alias, a])} yaEstan={d.alias} />}
        </section>

        <label style={{ fontSize: 14, display: "flex", gap: 6, alignItems: "flex-start" }}>
          <input type="checkbox" checked={d.activo} onChange={(e) => set({ activo: e.target.checked })} disabled={ro} />
          <span>
            Activo
            <span style={{ ...ayuda, display: "block", margin: 0 }}>Los parámetros no se borran: uno inactivo deja de exigirse en los elementos, pero se conserva para el historial.</span>
          </span>
        </label>
      </div>
    </Modal>
  );
}

/** The real group / property names of the models (read in the 3D viewer), to add as aliases with one click. */
function LeidosDelModelo({ camposModelo, nombre, yaEstan, onAgregar }: { camposModelo: CamposModelo | null; nombre: string; yaEstan: Alias[]; onAgregar: (a: Alias) => void }) {
  const [busqueda, setBusqueda] = useState("");
  if (!camposModelo) {
    return (
      <p style={ayuda}>
        Para elegir entre los nombres reales de los modelos: en el visor 3D abre el panel Requisitos BIM, pestaña Modelos, y pulsa &quot;Guardar nombres de propiedades&quot;.
      </p>
    );
  }
  const q = busqueda.trim() || nombre;
  const esta = (grupo: string, propiedad: string) => yaEstan.some((a) => normalizarNombre(a.grupo) === normalizarNombre(grupo) && normalizarNombre(a.propiedad) === normalizarNombre(propiedad));
  const encontrados = camposModelo.campos.filter((c) => coincide(`${c.grupo} ${c.propiedad}`, q)).slice(0, 25);
  return (
    <div style={{ marginTop: 10, border: "1px solid #e1e5ea", borderRadius: 4, padding: 8, background: "#fff" }}>
      <span style={labelStyle}>
        Nombres leídos de los modelos ({camposModelo.modelos.join(", ")}; {fecha(camposModelo.leido).slice(0, 10)})
      </span>
      <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder={`Buscar (por defecto: "${nombre}")`} style={{ ...campo, marginBottom: 6 }} aria-label="Buscar en los nombres leídos" />
      {encontrados.length === 0 && <p style={{ ...ayuda, margin: 0 }}>Ningún nombre leído coincide.</p>}
      {encontrados.map((c) => (
        <div key={`${c.grupo}|${c.propiedad}`} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "2px 0" }}>
          <span style={{ flex: 1, fontFamily: "monospace", fontSize: 12.5, wordBreak: "break-word" }}>
            {c.grupo}.{c.propiedad}
          </span>
          <span style={{ color: "var(--tc-gray-500)", fontSize: 12, whiteSpace: "nowrap" }}>{c.cuenta.toLocaleString("es")} obj.</span>
          {esta(c.grupo, c.propiedad) ? (
            <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>ya está</span>
          ) : (
            <button type="button" style={linkBtn} onClick={() => onAgregar({ grupo: c.grupo, propiedad: c.propiedad, sugerida: false })}>
              Agregar
            </button>
          )}
          {!esta("*", c.propiedad) && (
            <button type="button" style={linkBtn} onClick={() => onAgregar({ grupo: "*", propiedad: c.propiedad, sugerida: false })} title="En cualquier grupo">
              *.{c.propiedad.length > 14 ? "…" : c.propiedad}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Campo({ etiqueta, ancho, ayudaTexto, children }: { etiqueta: string; ancho: number; ayudaTexto?: string; children: React.ReactNode }) {
  return (
    <div style={{ gridColumn: `span ${ancho}`, minWidth: 0 }}>
      <span style={labelStyle}>{etiqueta}</span>
      {children}
      {ayudaTexto && <p style={ayuda}>{ayudaTexto}</p>}
    </div>
  );
}

const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: "10px 12px" };
const celdaAlias: CSSProperties = { padding: "4px 6px", borderBottom: "1px solid #eef1f4", fontSize: 13.5, verticalAlign: "middle" };
const mini: CSSProperties = { border: "1px solid #d6dbe1", background: "#fff", borderRadius: 3, padding: "1px 7px", marginLeft: 3, cursor: "pointer", fontFamily: "inherit", fontSize: 13 };
