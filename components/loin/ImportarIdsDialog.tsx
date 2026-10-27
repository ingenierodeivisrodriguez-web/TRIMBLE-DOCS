"use client";

import { CSSProperties, useMemo, useState } from "react";
import type { LoinApi } from "../../lib/loin/client";
import { claseBase, nombreClaseIfc } from "../../lib/loin/clasificacion";
import { aplicarFilas, elementoDesdeEspecificacion, FilaPlan, filasEspecificacion, IdsLeido, leerIds, planIds } from "../../lib/loin/importarIds";
import { nivelesCon, nombreNdi } from "../../lib/loin/ndi";
import { Elemento, ElementosResponse, EstadoResponse, GrupoTdi, Ndi, Parametro, TIPOS_DATO } from "../../lib/loin/types";
import { acceptButton, C, labelStyle, message, Modal, Notice } from "../presupuesto/ui";
import { ayuda, botonSecundario, etiqueta, select, td, th } from "./estilos";

const MAX_BYTES = 5 * 1024 * 1024;
const NO_IMPORTAR = "";
const NUEVO = "nuevo";

/**
 * Reads an IDS (the client's requirements, another tool's, or one exported
 * here) and shows, specification by specification, which element it goes to
 * and what it adds. New requirements come checked; what would change an
 * existing requirement comes unchecked with its difference; new catalog
 * parameters are created only for the rows that use them.
 */
export default function ImportarIdsDialog({
  api,
  estado,
  parametros,
  tdiGrupos,
  datos,
  onParametros,
  onListo,
  onClose,
}: {
  api: LoinApi;
  estado: EstadoResponse;
  parametros: Parametro[];
  tdiGrupos: GrupoTdi[];
  datos: ElementosResponse;
  onParametros: (p: Parametro[]) => void;
  onListo: (mensaje: string) => void;
  onClose: () => void;
}) {
  const [ids, setIds] = useState<IdsLeido | null>(null);
  const [archivo, setArchivo] = useState("");
  const [tdi, setTdi] = useState(() => (tdiGrupos.find((g) => g.codigo === "D") ?? tdiGrupos[0])?.codigo ?? "A");
  const [ndi, setNdi] = useState<Ndi>(estado.ndiNiveles[0]?.numero ?? 1);
  const disciplinas = useMemo(() => datos.disciplinas.filter((d) => d.activo).sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo)), [datos.disciplinas]);
  const [disciplinaNueva, setDisciplinaNueva] = useState(() => disciplinas[0]?.id ?? "");
  const [eleccion, setEleccion] = useState<string[]>([]);
  const [marcas, setMarcas] = useState<Set<number>[]>([]);
  const [equivMarcadas, setEquivMarcadas] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const puedeCatalogo = estado.canEditBase;
  const activos = useMemo(() => datos.elementos.filter((e) => e.activo), [datos.elementos]);
  const porId = useMemo(() => new Map(parametros.map((p) => [p.id, p])), [parametros]);
  const deLaClase = (clase: string) => (clase ? activos.filter((x) => x.claseIfc && claseBase(x.claseIfc) === claseBase(clase)).length : 0);

  const plan = useMemo(
    () =>
      ids
        ? planIds(ids, {
            catalogo: parametros,
            elementos: datos.elementos,
            disciplinas: datos.disciplinas,
            tdi,
            tdiCantidades: tdiGrupos.some((g) => g.codigo === "B") ? "B" : null,
            ndi,
          })
        : null,
    [ids, parametros, datos, tdi, tdiGrupos, ndi]
  );
  const nuevoPorCodigo = useMemo(() => new Map([...(plan?.nuevos.values() ?? [])].map((n) => [n.datos.codigo, n])), [plan]);
  const filas = useMemo((): FilaPlan[][] => {
    if (!plan) return [];
    return plan.especificaciones.map((e, i) => {
      const elegido = eleccion[i] ?? NO_IMPORTAR;
      if (elegido === NO_IMPORTAR) return [];
      const el = elegido === NUEVO ? null : (activos.find((x) => x.id === elegido) ?? null);
      return filasEspecificacion(e.leida, el, parametros, plan);
    });
  }, [plan, eleccion, activos, parametros]);

  // A row that needs a new catalog parameter can't go without permission on the catalog.
  const bloqueada = (f: FilaPlan) => !!f.nuevo && !puedeCatalogo;
  const marcable = (f: FilaPlan) => (f.accion === "agregar" || f.accion === "cambiar") && !bloqueada(f);
  const marcasIniciales = (lista: FilaPlan[]) => new Set(lista.flatMap((f, j) => (f.accion === "agregar" && !bloqueada(f) ? [j] : [])));

  async function leer(file: File) {
    setError("");
    if (file.size > MAX_BYTES) {
      setError("El archivo pesa más de 5 MB; un IDS normal pesa unos pocos KB.");
      return;
    }
    try {
      const leido = leerIds(await file.text());
      const p = planIds(leido, { catalogo: parametros, elementos: datos.elementos, disciplinas: datos.disciplinas, tdi, tdiCantidades: tdiGrupos.some((g) => g.codigo === "B") ? "B" : null, ndi });
      // Without a clear match: a new element only when no element has that class; otherwise the person chooses.
      const elegidos = p.especificaciones.map((e) => e.elementoId ?? (deLaClase(e.leida.clase) > 0 || !disciplinas.length ? NO_IMPORTAR : NUEVO));
      setIds(leido);
      setArchivo(file.name);
      setEleccion(elegidos);
      setMarcas(
        p.especificaciones.map((e, i) => {
          const el = elegidos[i] === NUEVO ? null : (activos.find((x) => x.id === elegidos[i]) ?? null);
          return elegidos[i] === NO_IMPORTAR ? new Set<number>() : marcasIniciales(filasEspecificacion(e.leida, el, parametros, p));
        })
      );
      setEquivMarcadas(new Set());
    } catch (err) {
      setError(message(err));
    }
  }

  function elegir(i: number, valor: string) {
    if (!plan) return;
    setEleccion((ant) => ant.map((v, k) => (k === i ? valor : v)));
    const el = valor === NUEVO ? null : (activos.find((x) => x.id === valor) ?? null);
    const nuevas = valor === NO_IMPORTAR ? new Set<number>() : marcasIniciales(filasEspecificacion(plan.especificaciones[i].leida, el, parametros, plan));
    setMarcas((ant) => ant.map((s, k) => (k === i ? nuevas : s)));
  }

  function marcar(i: number, j: number, si: boolean) {
    setMarcas((ant) =>
      ant.map((s, k) => {
        if (k !== i) return s;
        const n = new Set(s);
        if (si) n.add(j);
        else n.delete(j);
        return n;
      })
    );
  }

  const nuevosUsados = useMemo(() => {
    const out = new Set<string>();
    filas.forEach((lista, i) => lista.forEach((f, j) => f.nuevo && marcas[i]?.has(j) && out.add(f.nuevo)));
    return out;
  }, [filas, marcas]);
  const totalMarcadas = marcas.reduce((s, m, i) => s + ((eleccion[i] ?? NO_IMPORTAR) === NO_IMPORTAR ? 0 : m.size), 0);
  const elementosNuevos = eleccion.filter((v) => v === NUEVO).length;
  const faltaDisciplina = elementosNuevos > 0 && !disciplinaNueva;
  const algo = totalMarcadas + elementosNuevos + equivMarcadas.size > 0;

  async function importar() {
    if (!plan || !ids) return;
    setError("");
    const hechos: string[] = [];
    try {
      // 1. The catalog: new parameters used by a ticked row, and the ticked aliases.
      const nuevos = [...plan.nuevos.values()].filter((n) => nuevosUsados.has(n.datos.codigo));
      const conAlias = new Map<string, Parametro>();
      plan.equivalencias.forEach((e, k) => {
        if (!equivMarcadas.has(k)) return;
        const p = conAlias.get(e.parametro.id) ?? e.parametro;
        conAlias.set(p.id, { ...p, alias: [...p.alias, e.alias] });
      });
      const filasCatalogo = [...nuevos.map((n) => ({ ...n.datos, id: crypto.randomUUID(), version: 0 })), ...conAlias.values()];
      const idDeNuevo = new Map<string, string>();
      if (filasCatalogo.length) {
        setBusy("Guardando en el catálogo…");
        const guardados = await api.guardarParametros(filasCatalogo, (n) => setBusy(`Guardando en el catálogo ${n} de ${filasCatalogo.length}…`));
        onParametros(guardados);
        for (const p of guardados) idDeNuevo.set(p.codigo, p.id);
        if (nuevos.length) hechos.push(`${nuevos.length} parámetro(s) nuevo(s) en el catálogo`);
        if (conAlias.size) hechos.push(`${plan.equivalencias.filter((_, k) => equivMarcadas.has(k)).length} equivalencia(s)`);
      }

      // 2. The elements, one by one (several specifications may land on the same one).
      const actual = new Map<string, Elemento>(datos.elementos.map((e) => [e.id, e]));
      const disciplina = disciplinas.find((d) => d.id === disciplinaNueva) ?? null;
      let creados = 0;
      let cambiados = 0;
      for (let i = 0; i < plan.especificaciones.length; i++) {
        const elegido = eleccion[i] ?? NO_IMPORTAR;
        if (elegido === NO_IMPORTAR) continue;
        setBusy(`Guardando elementos ${i + 1} de ${plan.especificaciones.length}…`);
        if (elegido === NUEVO) {
          if (!disciplina) continue;
          const deLaDisciplina = [...actual.values()].filter((e) => e.disciplinaId === disciplina.id);
          const base = elementoDesdeEspecificacion(plan.especificaciones[i].leida, disciplina, deLaDisciplina.map((e) => e.codigo), deLaDisciplina.reduce((m, e) => Math.max(m, e.orden), 0) + 1);
          const guardado = await api.guardarElemento({ ...base, parametros: aplicarFilas([], filas[i], marcas[i], idDeNuevo), id: crypto.randomUUID(), version: 0 });
          actual.set(guardado.id, guardado);
          creados++;
        } else {
          const el = actual.get(elegido);
          if (!el) continue;
          const parametrosNuevos = aplicarFilas(el.parametros, filas[i], marcas[i], idDeNuevo);
          if (JSON.stringify(parametrosNuevos) === JSON.stringify(el.parametros)) continue;
          const guardado = await api.guardarElemento({ ...el, parametros: parametrosNuevos });
          actual.set(guardado.id, guardado);
          cambiados++;
        }
      }
      if (creados) hechos.push(`${creados} elemento(s) nuevo(s) en ${disciplina?.codigo}`);
      if (cambiados) hechos.push(`${cambiados} elemento(s) con parámetros exigidos agregados o cambiados`);
      onListo(hechos.length ? `IDS importado: ${hechos.join(", ")}.` : "El IDS no cambió nada: el proyecto ya lo tenía.");
      onClose();
    } catch (err) {
      setError(`${message(err)}${hechos.length ? ` Alcanzó a guardarse: ${hechos.join(", ")}. Puedes volver a importar el archivo: lo ya guardado se reconoce y no se duplica.` : ""}`);
      setBusy("");
      if (hechos.length) onListo("");
    }
  }

  const nombreParametro = (f: FilaPlan) => {
    if (f.parametroId) {
      const p = porId.get(f.parametroId);
      return p ? `${p.codigo} · ${p.nombre}` : f.parametroId;
    }
    const n = f.nuevo ? nuevoPorCodigo.get(f.nuevo) : undefined;
    return n ? `${n.datos.codigo} · ${n.datos.nombre}` : f.requisito.nombre;
  };

  return (
    <Modal
      title={archivo ? `Importar IDS: ${archivo}` : "Importar IDS"}
      onClose={() => !busy && onClose()}
      width={1120}
      height="90vh"
      footer={
        <>
          <span style={{ marginRight: "auto", fontSize: 13, color: "var(--tc-gray-500)" }}>{busy}</span>
          <button type="button" style={botonSecundario} onClick={onClose} disabled={!!busy}>
            Cancelar
          </button>
          {ids && (
            <button type="button" style={acceptButton} onClick={importar} disabled={!!busy || !algo || faltaDisciplina}>
              Importar
            </button>
          )}
        </>
      }
    >
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>
        {!ids && (
          <>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
              Carga un archivo <strong>IDS</strong> (buildingSMART, versión 1.0): los requisitos del cliente, de otra herramienta o uno exportado desde la matriz. Antes de
              guardar nada verás, especificación por especificación, a qué elemento va y qué agrega. Lo nuevo viene marcado; lo que cambiaría algo existente viene sin
              marcar.
            </p>
            <input type="file" accept=".ids,.xml" onChange={(e) => e.target.files?.[0] && leer(e.target.files[0])} aria-label="Archivo IDS" />
          </>
        )}
        {error && <Notice kind="error">{error}</Notice>}

        {ids && plan && (
          <>
            <p style={{ margin: 0, fontSize: 14 }}>
              <strong>{ids.titulo || "(sin título)"}</strong>
              {ids.hito && ` · Hito: ${ids.hito}`}
              {ids.proposito && ` · Propósito: ${ids.proposito}`} · {ids.especificaciones.length} especificación(es)
            </p>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={labelStyle}>
                Grupo TDI de los parámetros nuevos
                <select value={tdi} onChange={(e) => setTdi(e.target.value)} style={{ ...select, display: "block", marginTop: 4 }} disabled={!puedeCatalogo}>
                  {tdiGrupos.map((g) => (
                    <option key={g.codigo} value={g.codigo}>
                      TDI-{g.codigo} · {g.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                NDI de los parámetros nuevos
                <select value={ndi} onChange={(e) => setNdi(Number(e.target.value))} style={{ ...select, display: "block", marginTop: 4 }} disabled={!puedeCatalogo}>
                  {nivelesCon(estado.ndiNiveles, ndi).map((n) => (
                    <option key={n} value={n}>
                      {nombreNdi(n, estado.ndiNiveles)}
                    </option>
                  ))}
                </select>
              </label>
              <label style={labelStyle}>
                Disciplina de los elementos nuevos
                <select value={disciplinaNueva} onChange={(e) => setDisciplinaNueva(e.target.value)} style={{ ...select, display: "block", marginTop: 4 }}>
                  {disciplinas.length === 0 && <option value="">(crea antes una disciplina)</option>}
                  {disciplinas.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.codigo} · {d.nombre}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p style={{ ...ayuda, marginTop: -6 }}>
              Las cantidades (Qto_) nuevas van al grupo TDI-B cuando existe. El IDS no trae NDI ni grupo TDI: ajústalos después en la ficha de cada parámetro si hace
              falta.
            </p>

            {!puedeCatalogo && plan.nuevos.size > 0 && (
              <Notice kind="warning">
                Tu usuario no edita el catálogo de parámetros ({estado.baseNote || "lo editan los editores del proyecto base"}): los requisitos que necesitan un parámetro
                nuevo no se pueden importar. Pide a un editor del catálogo que importe este IDS primero.
              </Notice>
            )}

            {plan.nuevos.size > 0 && (
              <details style={caja}>
                <summary style={{ cursor: "pointer", fontSize: 14 }}>
                  Parámetros que el catálogo no tiene ({plan.nuevos.size}; se crean solo los que uses: {nuevosUsados.size})
                </summary>
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
                  <thead>
                    <tr>
                      <th style={th}>Código</th>
                      <th style={th}>Nombre</th>
                      <th style={th}>Tipo</th>
                      <th style={th}>Dónde se lee</th>
                      <th style={th}>Regla</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...plan.nuevos.values()].map((n) => (
                      <tr key={n.datos.codigo} style={{ opacity: nuevosUsados.has(n.datos.codigo) ? 1 : 0.55 }}>
                        <td style={td}>{n.datos.codigo}</td>
                        <td style={td}>{n.datos.nombre}</td>
                        <td style={td}>
                          {TIPOS_DATO[n.datos.tipoDato]}
                          {n.datos.unidad && ` (${n.datos.unidad})`}
                        </td>
                        <td style={td}>{n.datos.alias.map((a) => (a.grupo === "@" ? `@${a.propiedad}` : `${a.grupo}.${a.propiedad}`)).join("; ")}</td>
                        <td style={{ ...td, fontSize: 12.5 }}>
                          {[
                            n.datos.regla.min !== null ? `mín. ${n.datos.regla.min}` : "",
                            n.datos.regla.max !== null ? `máx. ${n.datos.regla.max}` : "",
                            n.datos.regla.patron ? `patrón ${n.datos.regla.patron}` : "",
                            n.datos.valoresPermitidos.length ? n.datos.valoresPermitidos.join(", ") : "",
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                          {n.avisos.length > 0 && <div style={{ color: "#7a4d00" }}>{n.avisos.join("; ")}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}

            {plan.equivalencias.length > 0 && (
              <div style={caja}>
                <strong style={{ fontSize: 14 }}>Equivalencias que faltan en el catálogo</strong>
                <p style={ayuda}>Estos parámetros se reconocieron por su nombre o su URI, pero el IDS los lee en otro lugar. Agregar la equivalencia no cambia nada más.</p>
                {plan.equivalencias.map((e, k) => (
                  <label key={k} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13.5, marginTop: 4 }}>
                    <input
                      type="checkbox"
                      disabled={!puedeCatalogo}
                      checked={equivMarcadas.has(k)}
                      onChange={(ev) =>
                        setEquivMarcadas((s) => {
                          const n = new Set(s);
                          if (ev.target.checked) n.add(k);
                          else n.delete(k);
                          return n;
                        })
                      }
                    />
                    Agregar <code>{e.alias.grupo}.{e.alias.propiedad}</code> a {e.parametro.codigo} · {e.parametro.nombre}
                  </label>
                ))}
              </div>
            )}

            {plan.especificaciones.map((e, i) => {
              const elegido = eleccion[i] ?? NO_IMPORTAR;
              const lista = filas[i] ?? [];
              return (
                <section key={i} style={{ ...caja, opacity: elegido === NO_IMPORTAR ? 0.7 : 1 }} aria-label={`Especificación ${e.leida.nombre}`}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <strong style={{ fontSize: 14.5 }}>{e.leida.nombre}</strong>
                    <span style={{ fontSize: 13, color: "var(--tc-gray-500)" }}>
                      {e.leida.clase ? nombreClaseIfc(e.leida.clase) : "sin clase IFC"}
                      {e.leida.tipoPredefinido && ` · ${e.leida.tipoPredefinido}`} · {e.leida.requisitos.length} requisito(s)
                    </span>
                    <span style={{ flex: 1 }} />
                    <label style={{ fontSize: 13.5 }}>
                      Elemento:{" "}
                      <select value={elegido} onChange={(ev) => elegir(i, ev.target.value)} style={select} aria-label={`Elemento para ${e.leida.nombre}`}>
                        <option value={NO_IMPORTAR}>No importar</option>
                        <option value={NUEVO} disabled={disciplinas.length === 0}>
                          Crear elemento nuevo
                        </option>
                        {disciplinas.map((d) => (
                          <optgroup key={d.id} label={`${d.codigo} · ${d.nombre}`}>
                            {activos
                              .filter((x) => x.disciplinaId === d.id)
                              .map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.codigo} · {x.nombre}
                                  {x.claseIfc ? ` (${x.claseIfc})` : ""}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                  </div>
                  {e.elementoId && elegido === e.elementoId && <p style={ayuda}>Reconocido por su código, nombre o clase IFC.</p>}
                  {!e.elementoId && elegido === NO_IMPORTAR && deLaClase(e.leida.clase) > 0 && (
                    <p style={{ ...ayuda, color: "#7a4d00" }}>
                      Hay {deLaClase(e.leida.clase)} elementos con la clase {nombreClaseIfc(e.leida.clase)}: elige a cuál va, o crea uno nuevo.
                    </p>
                  )}
                  {e.leida.avisos.length > 0 && (
                    <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5, color: "#7a4d00" }}>
                      {e.leida.avisos.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  )}
                  {lista.length > 0 && (
                    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
                      <thead>
                        <tr>
                          <th style={{ ...th, width: 28 }} />
                          <th style={th}>Parámetro</th>
                          <th style={th}>En el IDS</th>
                          <th style={th}>Qué pasa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lista.map((f, j) => (
                          <tr key={j} style={{ background: marcas[i]?.has(j) ? "#f3f8ff" : undefined }}>
                            <td style={td}>
                              <input
                                type="checkbox"
                                checked={!!marcas[i]?.has(j)}
                                disabled={!marcable(f)}
                                onChange={(ev) => marcar(i, j, ev.target.checked)}
                                aria-label={`Importar ${f.requisito.nombre}`}
                              />
                            </td>
                            <td style={td}>
                              {f.nuevo && <span style={{ ...etiqueta("#2e6b22", "#e4f3df"), marginRight: 4 }}>Nuevo</span>}
                              {nombreParametro(f)}
                            </td>
                            <td style={{ ...td, fontSize: 12.5 }}>
                              {f.requisito.grupo === "@" ? `@${f.requisito.nombre}` : `${f.requisito.grupo}.${f.requisito.nombre}`}
                              {f.requisito.tipoIfc && <span style={{ color: "var(--tc-gray-500)" }}> ({f.requisito.tipoIfc})</span>}
                              <span style={{ color: "var(--tc-gray-500)" }}> · {f.requisito.cardinalidad === "required" ? "obligatorio" : f.requisito.cardinalidad === "optional" ? "opcional" : "prohibido"}</span>
                            </td>
                            <td style={{ ...td, fontSize: 12.5 }}>
                              <span style={ETIQUETAS[f.accion]}>{NOMBRES[f.accion]}</span> {bloqueada(f) ? "Necesita un parámetro nuevo en el catálogo." : f.detalle}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {elegido !== NO_IMPORTAR && lista.length === 0 && <p style={ayuda}>No trae requisitos que se puedan importar.</p>}
                </section>
              );
            })}
            {faltaDisciplina && <Notice kind="warning">Para crear elementos nuevos crea antes una disciplina, o elige &quot;No importar&quot; en esas especificaciones.</Notice>}
          </>
        )}
      </div>
    </Modal>
  );
}

const caja: CSSProperties = { background: "#fff", border: `1px solid ${C.border}`, borderRadius: 4, padding: "8px 12px" };
const NOMBRES: Record<FilaPlan["accion"], string> = { agregar: "Agrega", cambiar: "Cambia", igual: "Igual", omitir: "No se importa" };
const ETIQUETAS: Record<FilaPlan["accion"], CSSProperties> = {
  agregar: etiqueta("#2e6b22", "#e4f3df"),
  cambiar: etiqueta("#7a4d00", "#fcefd6"),
  igual: etiqueta("#6b7280", "#eceef1"),
  omitir: etiqueta("#6b7280", "#eceef1"),
};
