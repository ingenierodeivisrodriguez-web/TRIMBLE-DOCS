"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";
import {
  AccionAlCatalogo,
  cuEnCatalogo,
  FilaAlCatalogo,
  guardadoAlCatalogo,
  planAlCatalogo,
  vincularAlCatalogo,
} from "../../lib/presupuesto/alCatalogo";
import type { SubpresupuestoCalculado } from "../../lib/presupuesto/calc";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import { fmt } from "../../lib/presupuesto/format";
import { bloqueDe } from "../../lib/presupuesto/tree";
import type { Insumo, ItemPartida, PartidaCatalogo, PresupuestoDoc } from "../../lib/presupuesto/types";
import { acceptButton, baseInput, C, message, Modal, Notice } from "./ui";
import type { Catalogo } from "./usePresupuesto";

type Alcance = "fila" | "sp" | "todo";

/**
 * Saves partidas of the budget into the catalog of partidas, with their unit
 * cost analysis: the elegida, a title's, a subpresupuesto's or all. New ones
 * are created; one the catalog already has and differs stays as it is unless
 * the person chooses to update it or to add it as another one.
 */
export default function AlCatalogoDialog({
  api,
  doc,
  setDoc,
  calculados,
  catalogo,
  spId,
  itemId,
  canEdit,
  readOnlyNote,
  catalogoDe,
  usuario,
  onGuardado,
  onClose,
}: {
  api: Pick<PresupuestoApi, "guardarInsumos" | "guardarPartidas">;
  doc: PresupuestoDoc;
  setDoc: (change: (doc: PresupuestoDoc) => PresupuestoDoc) => void;
  calculados: Map<string, SubpresupuestoCalculado>;
  catalogo: Catalogo;
  spId: string;
  /** The row chosen in the budget (a partida or a title), if any. */
  itemId: string | null;
  /** May change the catalog. */
  canEdit: boolean;
  readOnlyNote: string;
  /** The project whose catalog it is, when not this one. */
  catalogoDe: string;
  usuario: string;
  onGuardado: (cambios: { insumos?: Insumo[]; partidas?: PartidaCatalogo[] }) => void;
  onClose: () => void;
}) {
  const sp = doc.subpresupuestos.find((x) => x.id === spId) ?? doc.subpresupuestos[0];
  const index = itemId ? sp.items.findIndex((i) => i.id === itemId) : -1;
  const elegida = index >= 0 ? sp.items[index] : null;
  const [alcance, setAlcance] = useState<Alcance>(elegida ? "fila" : "sp");
  const [acciones, setAcciones] = useState<Map<string, AccionAlCatalogo>>(new Map());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<{ texto: string; avisos: string[] } | null>(null);

  /** Number and unit cost of each budget row. */
  const filasPresupuesto = useMemo(() => {
    const out = new Map<string, { numero: string; cu: number | null; sp: string }>();
    for (const x of doc.subpresupuestos) for (const f of calculados.get(x.id)?.filas ?? []) out.set(f.item.id, { numero: f.numero, cu: f.cu, sp: x.nombre });
    return out;
  }, [doc.subpresupuestos, calculados]);

  const items = useMemo((): ItemPartida[] => {
    const partidas = (lista: PresupuestoDoc["subpresupuestos"][number]["items"]) => lista.filter((i): i is ItemPartida => i.tipo === "partida");
    if (alcance === "todo") return doc.subpresupuestos.flatMap((x) => partidas(x.items));
    if (alcance === "sp") return partidas(sp.items);
    return index >= 0 ? partidas(bloqueDe(sp.items, index)) : [];
  }, [alcance, doc.subpresupuestos, sp, index]);

  const cat = useMemo(() => ({ insumos: catalogo.insumoMap, partidas: catalogo.partidaMap }), [catalogo]);
  const plan = useMemo(() => planAlCatalogo(doc, items, cat), [doc, items, cat]);

  // New partidas go by default; one that differs from the catalog's stays as it is until chosen.
  useEffect(() => {
    setAcciones(new Map(plan.filas.map((f) => [f.clave, f.estado === "nueva" ? "crear" : f.estado === "igual" ? "actualizar" : "omitir"])));
  }, [plan]);

  const cuCatalogo = useMemo(() => new Map(plan.filas.map((f) => [f.clave, cuEnCatalogo(plan, f.datos, cat).cu])), [plan, cat]);
  const pendientes = plan.filas.filter((f) => f.estado !== "igual" && (acciones.get(f.clave) ?? "omitir") !== "omitir");
  const previo = useMemo(() => guardadoAlCatalogo(plan, acciones, cat, () => ""), [plan, acciones, cat]);

  async function guardar() {
    const g = guardadoAlCatalogo(plan, acciones, cat);
    setGuardando(true);
    setError("");
    try {
      const ahora = new Date().toISOString();
      const sello = { updatedAt: ahora, updatedBy: usuario };
      if (g.insumos.length) {
        await api.guardarInsumos(g.insumos);
        // Known right away, so trying again after a failure doesn't create them twice.
        onGuardado({ insumos: g.insumos.map((i) => ({ ...i, ...sello })) });
      }
      if (g.partidas.length) {
        await api.guardarPartidas(g.partidas);
        onGuardado({ partidas: g.partidas.map((p) => ({ ...p, ...sello })) });
      }
      setDoc((d) => vincularAlCatalogo(d, g));
      const partes = [
        g.creadas ? `${g.creadas} partida(s) nueva(s)` : "",
        g.actualizadas ? `${g.actualizadas} actualizada(s)` : "",
        g.partidas.length - g.creadas - g.actualizadas ? `${g.partidas.length - g.creadas - g.actualizadas} subpartida(s)` : "",
        g.insumos.length ? `${g.insumos.length} insumo(s) nuevo(s) con el precio de este presupuesto` : "",
      ].filter(Boolean);
      setResultado({
        texto: `Listo en el catálogo: ${partes.join(", ") || "nada que cambiar"}. Sus filas del presupuesto quedan enlazadas a esas partidas del catálogo: guarda el presupuesto para conservar el enlace.`,
        avisos: g.avisos,
      });
    } catch (err) {
      setError(message(err));
    } finally {
      setGuardando(false);
    }
  }

  const opcionesAlcance: [Alcance, string][] = [
    ...(elegida
      ? ([["fila", elegida.tipo === "partida" ? `La partida elegida (${filasPresupuesto.get(elegida.id)?.numero ?? ""})` : `Las partidas del título ${filasPresupuesto.get(elegida.id)?.numero ?? ""} ${elegida.descripcion}`]] as [Alcance, string][])
      : []),
    ["sp", `Las del subpresupuesto ${sp.nombre}`],
    ...(doc.subpresupuestos.length > 1 ? ([["todo", "Todo el presupuesto"]] as [Alcance, string][]) : []),
  ];

  return (
    <Modal
      title="Guardar en el catálogo de partidas"
      width={1150}
      height="88vh"
      onClose={onClose}
      toolbar={
        <>
          <strong style={{ fontSize: 14 }}>Qué partidas:</strong>
          <select value={alcance} onChange={(e) => setAlcance(e.target.value as Alcance)} style={{ ...baseInput, fontSize: 14, maxWidth: 520 }} aria-label="Qué partidas guardar">
            {opcionesAlcance.map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </>
      }
      footer={
        <>
          <span style={{ fontSize: 13.5, color: "var(--tc-gray-500)", marginRight: "auto" }}>
            {pendientes.length > 0
              ? `Se ${pendientes.length === 1 ? "guarda 1 partida" : `guardan ${pendientes.length} partidas`}${previo.insumos.length ? `, ${previo.insumos.length} insumo(s) que faltan` : ""}${previo.subpartidas.size ? ` y ${previo.subpartidas.size} subpartida(s)` : ""}.`
              : "Nada por guardar."}
          </span>
          <button type="button" onClick={onClose} style={{ ...baseInput, cursor: "pointer", fontSize: 14 }}>
            Cerrar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={!canEdit || guardando || pendientes.length === 0}
            style={{ ...acceptButton, ...(!canEdit || guardando || pendientes.length === 0 ? { opacity: 0.5, cursor: "default" } : {}) }}
          >
            {guardando ? "Guardando..." : `Guardar en el catálogo (${pendientes.length})`}
          </button>
        </>
      }
    >
      <p style={{ margin: "8px 12px", fontSize: 13.5, color: "var(--tc-gray-700)" }}>
        Cada partida va con su análisis de precios unitarios, para usarla en otros proyectos{catalogoDe ? ` (catálogo de ${catalogoDe})` : ""}. Los insumos que el
        catálogo no tiene se crean con el precio de este presupuesto; los que ya tiene conservan el precio del catálogo, por eso su costo unitario allá puede ser
        otro. La misma partida repetida (por ejemplo en cada piso) se guarda una vez. Nada del catálogo se cambia sin que lo elijas.
      </p>
      {!canEdit && (
        <Notice kind="info" style={{ margin: "0 12px 8px" }}>
          {readOnlyNote || "No puedes modificar el catálogo de este proyecto: lo hace un administrador o editor de la base."}
        </Notice>
      )}
      {error && (
        <Notice kind="error" style={{ margin: "0 12px 8px" }}>
          {error}
        </Notice>
      )}
      {resultado && (
        <Notice kind="info" style={{ margin: "0 12px 8px" }}>
          {resultado.texto}
          {resultado.avisos.length > 0 && (
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {resultado.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#fff" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 960, fontSize: 14 }}>
          <thead>
            <tr style={{ position: "sticky", top: 0, background: "#f3f4f6", zIndex: 1 }}>
              <th style={{ ...th, width: 70 }}>Ítem</th>
              <th style={th}>Partida</th>
              <th style={{ ...th, width: 64 }}>Unidad</th>
              <th style={{ ...th, width: 120 }}>CU presupuesto</th>
              <th style={{ ...th, width: 120 }}>CU en el catálogo</th>
              <th style={{ ...th, width: 300 }}>En el catálogo</th>
            </tr>
          </thead>
          <tbody>
            {plan.filas.map((f) => (
              <Fila
                key={f.clave}
                f={f}
                numero={filasPresupuesto.get(f.itemIds[0])?.numero ?? ""}
                cu={filasPresupuesto.get(f.itemIds[0])?.cu ?? null}
                cuCatalogo={cuCatalogo.get(f.clave) ?? 0}
                codigoCatalogo={f.catalogoId ? catalogo.partidaMap.get(f.catalogoId)?.codigo ?? "" : ""}
                accion={acciones.get(f.clave) ?? "omitir"}
                onAccion={canEdit ? (a) => setAcciones((m) => new Map(m).set(f.clave, a)) : undefined}
              />
            ))}
            {plan.filas.length === 0 && (
              <tr>
                <td colSpan={6} style={{ ...td, color: "var(--tc-gray-500)", padding: 18 }}>
                  {alcance === "fila" ? "La fila elegida no tiene partidas." : "No hay partidas aquí."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function Fila({
  f,
  numero,
  cu,
  cuCatalogo,
  codigoCatalogo,
  accion,
  onAccion,
}: {
  f: FilaAlCatalogo;
  numero: string;
  cu: number | null;
  cuCatalogo: number;
  codigoCatalogo: string;
  accion: AccionAlCatalogo;
  onAccion?: (a: AccionAlCatalogo) => void;
}) {
  const notas = [
    f.itemIds.length > 1 ? `Está en ${f.itemIds.length} filas del presupuesto: se guarda una vez.` : "",
    f.distintasEnGrupo ? `${f.distintasEnGrupo} de esas filas tienen otro análisis: se guarda el de la fila ${numero}.` : "",
    f.lineasSinOrigen ? `${f.lineasSinOrigen} línea(s) de su análisis ya no tienen insumo: no se guardan.` : "",
    f.datos.componentes.length === 0 ? "Sin análisis de precios: se guarda solo la partida." : "",
  ].filter(Boolean);
  return (
    <tr>
      <td style={{ ...td, textAlign: "center" }}>{numero}</td>
      <td style={td}>
        {f.descripcion}
        {notas.map((n) => (
          <div key={n} style={{ fontSize: 12, color: "#7a5300" }}>
            {n}
          </div>
        ))}
      </td>
      <td style={{ ...td, textAlign: "center" }}>{f.unidad}</td>
      <td style={tdNum}>{cu === null ? "" : fmt(cu)}</td>
      <td style={{ ...tdNum, color: cu !== null && Math.abs(cu - cuCatalogo) > 0.005 ? "#7a5300" : undefined }} title="Con los precios del catálogo de insumos">
        {fmt(cuCatalogo)}
      </td>
      <td style={td}>
        {f.estado === "igual" ? (
          <span style={{ color: "var(--tc-gray-500)" }}>Ya está igual{codigoCatalogo ? ` (${codigoCatalogo})` : ""}</span>
        ) : f.estado === "nueva" ? (
          <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: onAccion ? "pointer" : "default" }}>
            <input type="checkbox" checked={accion === "crear"} disabled={!onAccion} onChange={(e) => onAccion?.(e.target.checked ? "crear" : "omitir")} />
            <span style={{ color: "#1e6b2e", fontWeight: 600 }}>Nueva</span>
          </label>
        ) : (
          <div>
            <div style={{ fontSize: 12.5, color: "#7a5300", marginBottom: 2 }}>Distinta de la del catálogo{codigoCatalogo ? ` (${codigoCatalogo})` : ""}</div>
            <select value={accion} disabled={!onAccion} onChange={(e) => onAccion?.(e.target.value as AccionAlCatalogo)} style={{ ...baseInput, fontSize: 13, width: "100%" }} aria-label={`Qué hacer con ${f.descripcion}`}>
              <option value="omitir">Dejar la del catálogo como está</option>
              <option value="actualizar">Actualizar la del catálogo con esta</option>
              <option value="crear">Guardarla como otra partida</option>
            </select>
          </div>
        )}
      </td>
    </tr>
  );
}

const th: CSSProperties = { padding: "8px", fontWeight: 600, borderBottom: `1px solid ${C.border}`, borderRight: `1px solid ${C.grid}` };
const td: CSSProperties = { padding: "6px 8px", borderBottom: `1px solid ${C.grid}`, borderRight: `1px solid ${C.grid}`, verticalAlign: "top" };
const tdNum: CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };
