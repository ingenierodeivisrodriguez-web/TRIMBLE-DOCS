"use client";

import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ApuCalculado, calcularPie, calcularSubpresupuesto, factorGastos, listaInsumos, SubpresupuestoCalculado, totalGastos } from "../../lib/presupuesto/calc";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import { importarApu, JORNADA, nuevoId, partidaDesdeCatalogo, resolverPresupuesto, snapshotInsumo, subpresupuestoVacio } from "../../lib/presupuesto/doc";
import { clonarBloque, conItem, conPartida, conSubpresupuesto } from "../../lib/presupuesto/edit";
import { exportarExcel, nombreSeguro } from "../../lib/presupuesto/excel";
import { fecha, fmt } from "../../lib/presupuesto/format";
import { exportarPdf } from "../../lib/presupuesto/pdf";
import { tablaGastos, tablaListaInsumos, tablaPresupuesto } from "../../lib/presupuesto/reportes";
import { bajar, bloqueDe, desangrar, insertar, quitar, sangrar, subir } from "../../lib/presupuesto/tree";
import { Insumo, Item, ItemPartida, PartidaCatalogo } from "../../lib/presupuesto/types";
import ApuDialog, { DatosPartida, partidaVacia } from "./ApuDialog";
import ApuEditor from "./ApuEditor";
import BudgetGrid, { CampoEditable } from "./BudgetGrid";
import CatalogoInsumos from "./CatalogoInsumos";
import CatalogoPartidas from "./CatalogoPartidas";
import ConfigDialog from "./ConfigDialog";
import GastosGenerales from "./GastosGenerales";
import ImportarDialog from "./ImportarDialog";
import ListaInsumos from "./ListaInsumos";
import PieDialog from "./PieDialog";
import { ConfirmDialog, TextoDialog } from "./SimpleDialogs";
import { C, message, Notice } from "./ui";
import { usePresupuesto } from "./usePresupuesto";

type Dialogo =
  | { tipo: "titulo"; editar?: string }
  | { tipo: "partida"; editar?: string }
  | { tipo: "subpartida"; id: string | null; itemId: string }
  | { tipo: "eliminar"; itemId: string }
  | { tipo: "sp-nuevo" }
  | { tipo: "sp-renombrar" }
  | { tipo: "sp-eliminar" }
  | { tipo: "insumos" }
  | { tipo: "partidas" }
  | { tipo: "lista" }
  | { tipo: "gastos" }
  | { tipo: "pie" }
  | { tipo: "config" }
  | { tipo: "importar" }
  | { tipo: "descartar" };

/** The budget in the project's menu: subpresupuestos, titles and partidas with their APU, and the tools around them. */
export default function PresupuestoApp({ api, projectId, projectName }: { api: PresupuestoApi; projectId: string; projectName: string }) {
  const s = usePresupuesto(api);
  const { doc, setDoc, estado, catalogo } = s;
  const canEdit = !!estado?.canEdit;
  const spKey = `presupuesto.sp.${projectId}`;
  const [spId, setSpIdState] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(spKey);
    } catch {
      return null;
    }
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<{ items: Item[]; cut: boolean; spId: string } | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [apuVisible, setApuVisible] = useState(true);
  const [aviso, setAviso] = useState("");
  const [exportando, setExportando] = useState(false);

  const sp = doc ? doc.subpresupuestos.find((x) => x.id === spId) ?? doc.subpresupuestos[0] : null;
  const setSpId = useCallback(
    (id: string) => {
      setSpIdState(id);
      setSelectedId(null);
      try {
        sessionStorage.setItem(spKey, id);
      } catch {
        // storage unavailable
      }
    },
    [spKey]
  );

  const resolver = useMemo(() => (doc ? resolverPresupuesto(doc) : null), [doc]);
  // The quantity from the model counts unless the partida was set to manual.
  const metradoEfectivo = useMemo(() => {
    const out = new Map(s.metradoModelo);
    for (const x of doc?.subpresupuestos ?? []) for (const i of x.items) if (i.tipo === "partida" && i.modo === "manual") out.delete(i.id);
    return out;
  }, [s.metradoModelo, doc]);
  const metrado = useCallback((id: string) => metradoEfectivo.get(id) ?? null, [metradoEfectivo]);
  const crearInsumo = useMemo(
    () => (catalogo && estado ? { api, catalogo, canEdit: estado.canEditBase, onCreated: (ins: Insumo) => s.catalogoGuardado({ insumos: [ins] }) } : undefined),
    [api, catalogo, estado, s.catalogoGuardado]
  );
  const loadMemoria = useCallback((itemId: string) => api.elementosDe({ itemIds: [itemId] }), [api]);
  const calculados = useMemo(() => {
    const out = new Map<string, SubpresupuestoCalculado>();
    if (!doc || !resolver) return out;
    const cache = new Map<string, ApuCalculado>();
    for (const x of doc.subpresupuestos) out.set(x.id, calcularSubpresupuesto(x, resolver, metrado, cache));
    return out;
  }, [doc, resolver, metrado]);
  const cdTotal = useMemo(() => [...calculados.values()].reduce((sum, c) => sum + c.cd, 0), [calculados]);
  const fgg = useMemo(() => (doc ? factorGastos(totalGastos(doc.gastos).total, cdTotal) : 0), [doc, cdTotal]);
  const calc = sp ? calculados.get(sp.id) ?? null : null;
  const pie = useMemo(() => (sp && calc ? calcularPie(sp.pie, { cd: calc.cd, fgg }) : []), [sp, calc, fgg]);

  const items = sp?.items ?? [];
  const selIndex = selectedId ? items.findIndex((i) => i.id === selectedId) : -1;
  const selected = selIndex >= 0 ? items[selIndex] : null;
  const filaSel = calc && selected ? calc.filas[selIndex] : null;

  // Ctrl+S saves.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (canEdit && s.dirty && !s.saving) s.save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEdit, s]);

  const setItems = useCallback(
    (change: (items: Item[]) => Item[]) => {
      if (!sp) return;
      setDoc((d) => conSubpresupuesto(d, sp.id, (x) => ({ ...x, items: change(x.items) })));
    },
    [sp, setDoc]
  );

  function insertarBloque(bloque: Item[]) {
    if (!sp) return;
    const r = insertar(items, selIndex >= 0 ? selIndex : null, bloque);
    setItems(() => r.items);
    setSelectedId(r.items[r.index]?.id ?? null);
  }

  /** Pastes a copy, or moves what was cut (keeping its ids, so its model elements stay linked). */
  function pegar() {
    if (!clipboard || !doc || !sp) return;
    if (!clipboard.cut) {
      insertarBloque(clonarBloque(clipboard.items));
      return;
    }
    const origen = doc.subpresupuestos.find((x) => x.id === clipboard.spId);
    const desde = origen ? origen.items.findIndex((i) => i.id === clipboard.items[0].id) : -1;
    if (!origen || desde < 0) {
      // It is gone from where it was cut: paste it as a copy.
      insertarBloque(clonarBloque(clipboard.items));
      setClipboard({ ...clipboard, cut: false });
      return;
    }
    const bloque = bloqueDe(origen.items, desde);
    const ids = new Set(bloque.map((i) => i.id));
    if (selectedId && ids.has(selectedId)) {
      setAviso("No se puede pegar dentro de lo que se cortó: elige otra fila.");
      return;
    }
    setDoc((d) => {
      const sinBloque = conSubpresupuesto(d, origen.id, (x) => ({ ...x, items: quitar(x.items, x.items.findIndex((i) => i.id === bloque[0].id)) }));
      const destino = sinBloque.subpresupuestos.find((x) => x.id === sp.id)!;
      const at = selectedId ? destino.items.findIndex((i) => i.id === selectedId) : -1;
      const r = insertar(destino.items, at >= 0 ? at : null, bloque);
      return conSubpresupuesto(sinBloque, sp.id, (x) => ({ ...x, items: r.items }));
    });
    setSelectedId(bloque[0].id);
    setClipboard({ items: bloque, cut: false, spId: sp.id });
    setAviso("");
  }

  function mover(op: "izq" | "der" | "arriba" | "abajo") {
    if (selIndex < 0) return;
    if (op === "der") {
      const r = sangrar(items, selIndex);
      if (r) setItems(() => r);
      else setAviso("Para meter esta fila dentro de un título, debe haber un título justo encima, al mismo nivel.");
      return;
    }
    const r = op === "izq" ? desangrar(items, selIndex) : op === "arriba" ? subir(items, selIndex) : bajar(items, selIndex);
    if (r) setItems(() => r.items);
  }

  function editarCampo(itemId: string, field: CampoEditable, value: string | number) {
    if (!sp) return;
    setDoc((d) =>
      conItem(d, sp.id, itemId, (i) => {
        if (field === "descripcion") return { ...i, descripcion: String(value) };
        if (i.tipo !== "partida") return i;
        return field === "unidad" ? { ...i, unidad: String(value) } : { ...i, metrado: Number(value) };
      })
    );
  }

  // ---- APU of the selected partida (edited in place, like the reference tool)
  const fuente = useMemo(() => (catalogo ? { insumos: catalogo.insumoMap, partidas: catalogo.partidaMap } : null), [catalogo]);
  const usarInsumo = useCallback(
    (ins: Insumo) => {
      setDoc((d) => (d.insumos[ins.id] ? d : { ...d, insumos: { ...d.insumos, [ins.id]: snapshotInsumo(ins) } }));
      return ins.id;
    },
    [setDoc]
  );
  const usarSubpartida = useCallback(
    (id: string): string | null => {
      if (!doc) return null;
      if (doc.subpartidas[id]) return id;
      if (!fuente) return null;
      const r = importarApu({ rendimiento: 1, jornada: JORNADA, componentes: [{ tipo: "subpartida", id, cuadrilla: null, cantidad: 1 }] }, fuente, doc);
      const nuevo = r.componentes[0]?.id ?? null;
      if (nuevo) setDoc((d) => ({ ...d, insumos: { ...r.insumos, ...d.insumos }, subpartidas: { ...d.subpartidas, ...r.subpartidas } }));
      return nuevo;
    },
    [doc, fuente, setDoc]
  );
  const opcionesSub = useMemo(() => {
    if (!doc) return [];
    const propias = Object.entries(doc.subpartidas).map(([id, x]) => ({ id, descripcion: x.descripcion, unidad: x.unidad, grupo: "Presupuesto" }));
    const delCatalogo = (catalogo?.partidas ?? []).map((p) => ({ id: p.id, descripcion: p.descripcion, unidad: p.unidad, grupo: "Catálogo" }));
    return [...propias, ...delCatalogo];
  }, [doc, catalogo]);

  function agregarDesdeCatalogo(p: PartidaCatalogo) {
    if (!doc || !fuente || !sp) return;
    const r = partidaDesdeCatalogo(p, fuente, doc);
    const ins = insertar(items, selIndex >= 0 ? selIndex : null, [r.item]);
    setDoc((d) => conSubpresupuesto({ ...d, insumos: r.insumos, subpartidas: r.subpartidas }, sp.id, (x) => ({ ...x, items: ins.items })));
    setSelectedId(r.item.id);
  }

  async function exportar(tipo: "xlsx" | "pdf") {
    if (!doc || !sp || !calc || !resolver) return;
    setExportando(true);
    setAviso("");
    try {
      if (tipo === "pdf") {
        await exportarPdf(tablaPresupuesto(sp.nombre, calc, pie, false), projectName, `Presupuesto - ${sp.nombre}`);
      } else {
        const hojas = doc.subpresupuestos.map((x) => {
          const c = calculados.get(x.id)!;
          return tablaPresupuesto(x.nombre, c, calcularPie(x.pie, { cd: c.cd, fgg }), true);
        });
        const ius = Object.fromEntries(Object.entries(doc.insumos).map(([id, i]) => [id, i.iu]));
        hojas.push(tablaListaInsumos("TODOS LOS SUBPRESUPUESTOS", listaInsumos(doc.subpresupuestos, resolver, metrado), ius));
        hojas.push(tablaGastos(doc.gastos, cdTotal));
        await exportarExcel(hojas, `${nombreSeguro(`Presupuesto ${projectName}`)}.xlsx`);
      }
    } catch (err) {
      setAviso(`No se pudo exportar: ${message(err)}`);
    } finally {
      setExportando(false);
    }
  }

  // ---------------------------------------------------------------- render

  if (s.loadError) {
    return (
      <div style={{ padding: 24 }}>
        <Notice kind="error">No se pudo cargar el presupuesto: {s.loadError}</Notice>
      </div>
    );
  }
  if (!doc || !estado || !sp || !calc) {
    return <div style={{ padding: 24, color: "var(--tc-gray-500)" }}>Cargando el presupuesto...</div>;
  }

  const readOnlyBase = estado.baseNote;
  const dis = !canEdit;
  const partidaSel = selected?.tipo === "partida" ? (selected as ItemPartida) : null;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#fff", fontSize: 14 }}>
      {/* Header: title and the tools around the budget */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: C.header, color: "#fff", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 16, marginRight: 8 }}>Presupuesto</strong>
        <span style={{ fontSize: 13, opacity: 0.85, marginRight: "auto" }}>
          {projectName}
          {!estado.esBasePropia && ` · catálogo: ${estado.config.baseProjectName || estado.config.baseProjectId}`}
          {!canEdit && " · solo consulta"}
        </span>
        <HeadButton onClick={() => setDialogo({ tipo: "insumos" })} disabled={!catalogo}>
          Catálogo de insumos
        </HeadButton>
        <HeadButton onClick={() => setDialogo({ tipo: "partidas" })} disabled={!catalogo}>
          Catálogo de partidas
        </HeadButton>
        <HeadButton onClick={() => setDialogo({ tipo: "lista" })}>Lista de insumos</HeadButton>
        <HeadButton onClick={() => setDialogo({ tipo: "gastos" })}>Gastos generales</HeadButton>
        <HeadButton onClick={() => setDialogo({ tipo: "pie" })}>Pie</HeadButton>
        <HeadButton onClick={() => setDialogo({ tipo: "importar" })} disabled={!catalogo}>
          Importar Excel
        </HeadButton>
        <HeadButton onClick={() => setDialogo({ tipo: "config" })}>⚙ Configuración</HeadButton>
      </div>

      {/* Toolbar of the reference tool */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, padding: "4px 8px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap", background: "#fafbfc" }}>
        <Tb onClick={() => s.save()} disabled={dis || !s.dirty || s.saving} title="Guardar (Ctrl+S)" strong={s.dirty}>
          {s.saving ? "Guardando..." : "Guardar"}
        </Tb>
        <Sep />
        <Tb onClick={() => setDialogo({ tipo: "titulo" })} disabled={dis} title="Nuevo título">
          + Título
        </Tb>
        <Tb onClick={() => setDialogo({ tipo: "partida" })} disabled={dis || !catalogo} title="Nueva partida">
          + Partida
        </Tb>
        <Tb
          onClick={() => selected && setDialogo(selected.tipo === "titulo" ? { tipo: "titulo", editar: selected.id } : { tipo: "partida", editar: selected.id })}
          disabled={!selected || (dis && selected.tipo === "titulo") || !catalogo}
          title={dis ? "Ver" : "Editar"}
        >
          ✎
        </Tb>
        <Tb onClick={() => selected && setDialogo({ tipo: "eliminar", itemId: selected.id })} disabled={dis || !selected} title="Eliminar">
          🗑
        </Tb>
        <Sep />
        <Tb onClick={() => selected && setClipboard({ items: bloqueDe(items, selIndex), cut: false, spId: sp.id })} disabled={!selected || dis} title="Copiar">
          ⧉
        </Tb>
        <Tb
          onClick={() => {
            if (!selected) return;
            // Nothing moves until Pegar, so a cut that is never pasted loses nothing.
            setClipboard({ items: bloqueDe(items, selIndex), cut: true, spId: sp.id });
            setAviso("Cortado: elige dónde va y pulsa Pegar.");
          }}
          disabled={!selected || dis}
          title="Cortar"
        >
          ✂
        </Tb>
        <Tb
          onClick={pegar}
          disabled={!clipboard || dis}
          title={clipboard ? `Pegar (${clipboard.items.length} fila${clipboard.items.length === 1 ? "" : "s"})` : "Pegar"}
        >
          📋
        </Tb>
        <Sep />
        <Tb onClick={() => mover("izq")} disabled={dis || !selected} title="Sacar del título">
          ←
        </Tb>
        <Tb onClick={() => mover("der")} disabled={dis || !selected} title="Meter en el título de arriba">
          →
        </Tb>
        <Tb onClick={() => mover("arriba")} disabled={dis || !selected} title="Subir">
          ↑
        </Tb>
        <Tb onClick={() => mover("abajo")} disabled={dis || !selected} title="Bajar">
          ↓
        </Tb>
        <Sep />
        <strong style={{ padding: "0 6px" }}>SP:</strong>
        <select value={sp.id} onChange={(e) => setSpId(e.target.value)} style={spSelect} aria-label="Subpresupuesto">
          {doc.subpresupuestos.map((x) => (
            <option key={x.id} value={x.id}>
              {x.nombre}
            </option>
          ))}
        </select>
        <Tb onClick={() => setDialogo({ tipo: "sp-nuevo" })} disabled={dis} title="Nuevo subpresupuesto">
          +
        </Tb>
        <Tb onClick={() => setDialogo({ tipo: "sp-renombrar" })} disabled={dis} title="Renombrar subpresupuesto">
          ✎
        </Tb>
        <Tb onClick={() => setDialogo({ tipo: "sp-eliminar" })} disabled={dis || doc.subpresupuestos.length < 2} title="Eliminar subpresupuesto">
          ⌫
        </Tb>
        <strong style={{ padding: "0 10px", fontSize: 15 }}>CD: {fmt(calc.cd)}</strong>
        <Sep />
        <Tb onClick={() => exportar("xlsx")} disabled={exportando} title="Todo el presupuesto, lista de insumos y gastos generales">
          Excel
        </Tb>
        <Tb onClick={() => exportar("pdf")} disabled={exportando} title="Este subpresupuesto con su pie">
          PDF
        </Tb>
      </div>

      {/* Status */}
      {(s.saveError || aviso || s.catalogoError || s.dirty || s.meta.updatedAt) && (
        <div style={{ padding: "4px 10px", fontSize: 12.5, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: `1px solid ${C.grid}` }}>
          {s.saveError ? (
            <span style={{ color: "#8a1c14" }}>
              {s.saveError.text}{" "}
              {s.saveError.conflict && (
                <button type="button" style={linkBtn} onClick={() => setDialogo({ tipo: "descartar" })}>
                  Recargar el presupuesto guardado
                </button>
              )}
            </span>
          ) : s.dirty ? (
            <span style={{ color: "#7a5300" }}>Cambios sin guardar.</span>
          ) : s.meta.updatedAt ? (
            <span style={{ color: "var(--tc-gray-500)" }}>
              Guardado{s.meta.updatedBy ? ` por ${s.meta.updatedBy}` : ""} el {fecha(s.meta.updatedAt)}.
            </span>
          ) : null}
          {aviso && (
            <span style={{ color: "#7a5300" }}>
              {aviso}{" "}
              <button type="button" style={linkBtn} onClick={() => setAviso("")}>
                Ocultar
              </button>
            </span>
          )}
          {s.catalogoError && <span style={{ color: "#8a1c14" }}>Catálogo: {s.catalogoError}</span>}
        </div>
      )}

      <BudgetGrid
        calculado={calc}
        pie={pie}
        selectedId={selectedId}
        onSelect={setSelectedId}
        collapsed={collapsed}
        onToggle={(id) =>
          setCollapsed((c) => {
            const n = new Set(c);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
          })
        }
        editable={canEdit}
        onEdit={editarCampo}
        onOpen={(id) => {
          const it = items.find((i) => i.id === id);
          if (!it || !catalogo) return;
          if (it.tipo === "partida") setDialogo({ tipo: "partida", editar: id });
          else if (canEdit) setDialogo({ tipo: "titulo", editar: id });
        }}
        elementos={s.elementosPorItem}
        loadMemoria={loadMemoria}
      />

      {/* APU of the selected partida */}
      {partidaSel && filaSel && resolver && (
        <div style={{ flex: apuVisible ? "0 0 min(340px, 46vh)" : "0 0 auto", display: "flex", flexDirection: "column", borderTop: `2px solid ${C.border}`, minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", background: "#eef2f7", fontSize: 13.5 }}>
            <strong>
              {filaSel.numero} {partidaSel.descripcion}
            </strong>
            <span style={{ color: "var(--tc-gray-500)" }}>
              {partidaSel.unidad} · metrado {fmt(filaSel.metrado ?? 0)}
              {filaSel.metradoModelo ? ` · automático 3D (${filaSel.metradoModelo.elementos} elementos · ${filaSel.metradoModelo.campoLabel})` : " · manual"}
              {partidaSel.omniclass ? ` · OmniClass ${partidaSel.omniclass}` : ""}
            </span>
            <button type="button" style={{ ...linkBtn, marginLeft: "auto" }} onClick={() => setApuVisible((v) => !v)}>
              {apuVisible ? "Ocultar análisis" : "Ver análisis de precios unitarios"}
            </button>
          </div>
          {apuVisible && partidaSel.edt && (partidaSel.edt.responsable || partidaSel.edt.descripcion || partidaSel.edt.criterios) && (
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: "4px 10px", fontSize: 12.5, background: "#f7f9fc", borderBottom: `1px solid ${C.grid}` }}>
              {partidaSel.edt.responsable && (
                <span>
                  <strong>Responsable:</strong> {partidaSel.edt.responsable}
                </span>
              )}
              {partidaSel.edt.descripcion && (
                <span style={edtClamp} title={partidaSel.edt.descripcion}>
                  <strong>Trabajo:</strong> {partidaSel.edt.descripcion}
                </span>
              )}
              {partidaSel.edt.criterios && (
                <span style={edtClamp} title={partidaSel.edt.criterios}>
                  <strong>Aceptación:</strong> {partidaSel.edt.criterios}
                </span>
              )}
            </div>
          )}
          {apuVisible && (
            <ApuEditor
              crear={crearInsumo}
              apu={partidaSel}
              calculada={filaSel.apu ?? undefined}
              resolver={resolver}
              unidad={partidaSel.unidad}
              onChange={canEdit ? (apu) => setDoc((d) => conPartida(d, sp.id, partidaSel.id, (i) => ({ ...i, ...apu }))) : undefined}
              insumos={catalogo?.insumos ?? []}
              usarInsumo={canEdit && catalogo ? usarInsumo : undefined}
              subpartidas={opcionesSub}
              usarSubpartida={canEdit ? usarSubpartida : undefined}
              onNuevaSubpartida={canEdit && catalogo ? () => setDialogo({ tipo: "subpartida", id: null, itemId: partidaSel.id }) : undefined}
              onAbrirSubpartida={catalogo ? (id) => setDialogo({ tipo: "subpartida", id, itemId: partidaSel.id }) : undefined}
              onPrecio={canEdit ? (id, precio) => setDoc((d) => (d.insumos[id] ? { ...d, insumos: { ...d.insumos, [id]: { ...d.insumos[id], precio } } } : d)) : undefined}
            />
          )}
        </div>
      )}

      {renderDialogo()}
    </div>
  );

  function renderDialogo(): ReactNode {
    if (!dialogo || !doc || !sp || !estado) return null;
    const close = () => setDialogo(null);
    switch (dialogo.tipo) {
      case "titulo": {
        const actual = dialogo.editar ? items.find((i) => i.id === dialogo.editar) : null;
        return (
          <TextoDialog
            title={actual ? "Editar Título" : "Nuevo Título"}
            label="Título"
            initial={actual?.descripcion ?? ""}
            onClose={close}
            onAccept={(text) => {
              if (actual) setDoc((d) => conItem(d, sp.id, actual.id, (i) => ({ ...i, descripcion: text })));
              else insertarBloque([{ id: nuevoId(), tipo: "titulo", nivel: 0, descripcion: text }]);
              close();
            }}
          />
        );
      }
      case "partida": {
        if (!catalogo) return null;
        const actual = dialogo.editar ? (items.find((i) => i.id === dialogo.editar) as ItemPartida | undefined) : undefined;
        const inicial: DatosPartida = actual
          ? { codigo: actual.codigo, descripcion: actual.descripcion, unidad: actual.unidad, omniclass: actual.omniclass, rendimiento: actual.rendimiento, jornada: actual.jornada, componentes: actual.componentes, metrado: actual.metrado, modo: actual.modo, edt: actual.edt }
          : partidaVacia();
        return (
          <ApuDialog
            titulo={actual ? (canEdit ? "Editar partida" : "Partida") : "Nueva partida"}
            modo="presupuesto"
            inicial={inicial}
            mapas={{ insumos: doc.insumos, subpartidas: doc.subpartidas }}
            catalogo={catalogo}
            conMetrado
            crear={crearInsumo}
            metradoModelo={actual ? s.metradoModelo.get(actual.id) ?? null : null}
            readOnly={!canEdit}
            onClose={close}
            onAccept={(data, mapas, origenId) => {
              if (actual) {
                setDoc((d) => conPartida({ ...d, ...mapas }, sp.id, actual.id, (i) => ({ ...i, ...data, origenId: origenId ?? i.origenId })));
              } else {
                const item: ItemPartida = { id: nuevoId(), tipo: "partida", nivel: 0, ...data, origenId };
                const r = insertar(items, selIndex >= 0 ? selIndex : null, [item]);
                setDoc((d) => conSubpresupuesto({ ...d, ...mapas }, sp.id, (x) => ({ ...x, items: r.items })));
                setSelectedId(item.id);
              }
              close();
            }}
          />
        );
      }
      case "subpartida": {
        if (!catalogo) return null;
        const actual = dialogo.id ? doc.subpartidas[dialogo.id] : null;
        return (
          <ApuDialog
            titulo={actual ? "Sub partida" : "Nueva Sub partida"}
            modo="presupuesto"
            inicial={actual ? { ...actual, metrado: 0 } : partidaVacia()}
            mapas={{ insumos: doc.insumos, subpartidas: doc.subpartidas }}
            catalogo={catalogo}
            crear={crearInsumo}
            propioId={dialogo.id ?? undefined}
            readOnly={!canEdit}
            onClose={close}
            onAccept={(data, mapas, origenId) => {
              const id = dialogo.id ?? nuevoId();
              const { metrado: _m, ...apu } = data;
              setDoc((d) => {
                let next = { ...d, insumos: mapas.insumos, subpartidas: { ...mapas.subpartidas, [id]: { ...apu, origenId: origenId ?? actual?.origenId ?? null } } };
                if (!dialogo.id) {
                  next = conPartida(next, sp.id, dialogo.itemId, (i) => ({ ...i, componentes: [...i.componentes, { tipo: "subpartida", id, cuadrilla: null, cantidad: 1 }] }));
                }
                return next;
              });
              close();
            }}
          />
        );
      }
      case "eliminar": {
        const idx = items.findIndex((i) => i.id === dialogo.itemId);
        if (idx < 0) return null;
        const bloque = bloqueDe(items, idx);
        const conElementos = bloque.filter((i) => (s.elementosPorItem.get(i.id) ?? 0) > 0).length;
        return (
          <ConfirmDialog
            title="Eliminar"
            danger
            confirmLabel="Eliminar"
            onClose={close}
            onConfirm={() => {
              setItems((list) => quitar(list, idx));
              setSelectedId(null);
              close();
            }}
          >
            ¿Eliminar <strong>{items[idx].descripcion}</strong>
            {bloque.length > 1 ? ` y las ${bloque.length - 1} filas que contiene` : ""}?
            {conElementos > 0 && ` Al guardar, se quitarán también los elementos del modelo asociados a ${conElementos === 1 ? "esa partida" : `esas ${conElementos} partidas`}.`}
          </ConfirmDialog>
        );
      }
      case "sp-nuevo":
        return (
          <TextoDialog
            title="Nuevo subpresupuesto"
            label="Nombre (p. ej. ESTRUCTURAS, ARQUITECTURA, INSTALACIONES)"
            maxLength={120}
            onClose={close}
            onAccept={(nombre) => {
              const nuevo = subpresupuestoVacio(nombre);
              // The new one starts with the footer of the current one.
              nuevo.pie = sp.pie.map((f) => ({ ...f }));
              setDoc((d) => ({ ...d, subpresupuestos: [...d.subpresupuestos, nuevo] }));
              setSpId(nuevo.id);
              close();
            }}
          />
        );
      case "sp-renombrar":
        return (
          <TextoDialog
            title="Renombrar subpresupuesto"
            label="Nombre"
            initial={sp.nombre}
            maxLength={120}
            onClose={close}
            onAccept={(nombre) => {
              setDoc((d) => conSubpresupuesto(d, sp.id, (x) => ({ ...x, nombre })));
              close();
            }}
          />
        );
      case "sp-eliminar":
        return (
          <ConfirmDialog
            title="Eliminar subpresupuesto"
            danger
            confirmLabel="Eliminar"
            onClose={close}
            onConfirm={() => {
              setDoc((d) => ({ ...d, subpresupuestos: d.subpresupuestos.filter((x) => x.id !== sp.id) }));
              setSpId(doc.subpresupuestos.find((x) => x.id !== sp.id)!.id);
              close();
            }}
          >
            ¿Eliminar el subpresupuesto <strong>{sp.nombre}</strong> con sus {sp.items.length} filas? Al guardar, se quitan también los elementos del modelo
            asociados a sus partidas.
          </ConfirmDialog>
        );
      case "insumos":
        return catalogo ? (
          <CatalogoInsumos api={api} catalogo={catalogo} canEdit={estado.canEditBase} readOnlyNote={readOnlyBase} onSaved={s.catalogoGuardado} onClose={close} />
        ) : null;
      case "partidas":
        return catalogo ? (
          <CatalogoPartidas
            api={api}
            catalogo={catalogo}
            canEdit={estado.canEditBase}
            readOnlyNote={readOnlyBase}
            onSaved={s.catalogoGuardado}
            onAgregar={canEdit ? agregarDesdeCatalogo : undefined}
            onInsumoCreado={(ins) => s.catalogoGuardado({ insumos: [ins] })}
            onClose={close}
          />
        ) : null;
      case "lista":
        return <ListaInsumos doc={doc} setDoc={setDoc} spId={sp.id} catalogo={catalogo} metradoModelo={metradoEfectivo} canEdit={canEdit} proyecto={projectName} onClose={close} />;
      case "gastos":
        return <GastosGenerales doc={doc} setDoc={setDoc} cdTotal={cdTotal} canEdit={canEdit} onSave={() => s.save()} saving={s.saving} proyecto={projectName} onClose={close} />;
      case "pie":
        return <PieDialog doc={doc} setDoc={setDoc} spId={sp.id} cd={calc!.cd} fgg={fgg} canEdit={canEdit} onClose={close} />;
      case "config":
        return (
          <ConfigDialog
            api={api}
            estado={estado}
            onClose={close}
            onChanged={(next, baseCambiada) => {
              s.setEstado(next);
              if (baseCambiada) s.reloadCatalogo();
            }}
          />
        );
      case "importar":
        return catalogo ? (
          <ImportarDialog api={api} catalogo={catalogo} canEdit={estado.canEditBase} readOnlyNote={readOnlyBase} onImported={s.reloadCatalogo} onClose={close} />
        ) : null;
      case "descartar":
        return (
          <ConfirmDialog
            title="Recargar el presupuesto"
            danger
            confirmLabel="Recargar"
            onClose={close}
            onConfirm={() => {
              s.discard();
              close();
            }}
          >
            Se cargará la versión guardada por la otra persona y se perderán tus cambios sin guardar en esta pantalla. Si los necesitas, expórtalos a
            Excel antes.
          </ConfirmDialog>
        );
    }
  }
}

function HeadButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        border: "1px solid rgba(255,255,255,0.45)",
        background: "rgba(255,255,255,0.1)",
        color: "#fff",
        borderRadius: 4,
        padding: "5px 10px",
        fontSize: 13,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function Tb({ onClick, disabled, title, children, strong }: { onClick: () => void; disabled?: boolean; title: string; children: ReactNode; strong?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      style={{
        border: "none",
        background: strong && !disabled ? "#fff3cd" : "transparent",
        color: disabled ? "#b8bec7" : "var(--tc-gray-700)",
        padding: "5px 8px",
        fontSize: 16,
        cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit",
        borderRadius: 4,
        fontWeight: strong ? 700 : 400,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span style={{ width: 1, height: 22, background: C.border, margin: "0 4px" }} />;
}

const spSelect: CSSProperties = {
  border: "1px solid var(--tc-gray-300)",
  borderRadius: 4,
  padding: "5px 8px",
  fontSize: 15,
  minWidth: 220,
  fontFamily: "inherit",
};
const edtClamp: CSSProperties = { maxWidth: "38%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const linkBtn: CSSProperties = { border: "none", background: "transparent", color: "var(--tc-blue-700)", textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" };
