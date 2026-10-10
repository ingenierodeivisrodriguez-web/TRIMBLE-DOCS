"use client";

import { CSSProperties, useCallback, useMemo, useState } from "react";
import { calcularApu, Resolver } from "../../lib/presupuesto/calc";
import { creaCiclo, creaCicloCatalogo, importarApu, JORNADA, nuevoId, resolverCatalogo, resolverPresupuesto, snapshotInsumo } from "../../lib/presupuesto/doc";
import { fmt } from "../../lib/presupuesto/format";
import { tablaDe } from "../../lib/presupuesto/omniclass";
import type { Edt, ModoMetrado, MetradoModeloInfo } from "../../lib/presupuesto/types";
import { Apu, Insumo, InsumoPresupuesto, PartidaCatalogo, PartidaData, Subpartida } from "../../lib/presupuesto/types";
import ApuEditor, { insumoLabel, OpcionSubpartida } from "./ApuEditor";
import Picker from "./Picker";
import { acceptButton, baseInput, labelStyle, Modal, NumInput, Notice } from "./ui";
import type { Catalogo } from "./usePresupuesto";

export interface Mapas {
  insumos: Record<string, InsumoPresupuesto>;
  subpartidas: Record<string, Subpartida>;
}

export type DatosPartida = PartidaData & { metrado: number; modo?: ModoMetrado; edt?: Edt };

export function partidaVacia(): DatosPartida {
  return { codigo: "", descripcion: "", unidad: "", omniclass: "", rendimiento: 1, jornada: JORNADA, componentes: [], metrado: 0 };
}

/**
 * Creates or edits an APU: a partida or subpartida of the budget (against
 * the budget's prices and subpartidas, `mapas`), or a partida of the catalog
 * (`modo` "catalogo", against the catalog). Changes stay in the dialog until
 * Aceptar.
 */
export default function ApuDialog({
  titulo,
  modo,
  inicial,
  mapas: mapasIniciales,
  catalogo,
  propioId,
  conMetrado,
  metradoModelo,
  readOnly,
  onAccept,
  onClose,
}: {
  titulo: string;
  modo: "presupuesto" | "catalogo";
  inicial: DatosPartida;
  /** The budget's prices and subpartidas (presupuesto mode). */
  mapas?: Mapas;
  catalogo: Catalogo;
  /** The id of what is being edited, to keep it from containing itself. */
  propioId?: string;
  conMetrado?: boolean;
  /** The quantity the model's linked elements give this partida, if it measures them. */
  metradoModelo?: MetradoModeloInfo | null;
  readOnly?: boolean;
  onAccept: (data: DatosPartida, mapas: Mapas, origenId: string | null) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<DatosPartida>(inicial);
  const [mapas, setMapas] = useState<Mapas>(mapasIniciales ?? { insumos: {}, subpartidas: {} });
  const [origenId, setOrigenId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [sub, setSub] = useState<{ id: string | null; data: DatosPartida } | null>(null);
  const [copiando, setCopiando] = useState(false);
  const enPresupuesto = modo === "presupuesto";
  /** Where the metrado comes from: typed, or from the elements linked in the 3D viewer. */
  const modoMetrado: ModoMetrado = data.modo ?? (metradoModelo ? "3d" : "manual");
  const edt: Edt = data.edt ?? { descripcion: "", criterios: "", responsable: "" };
  const fuente = useMemo(() => ({ insumos: catalogo.insumoMap, partidas: catalogo.partidaMap }), [catalogo]);

  const resolver: Resolver = useMemo(
    () => (enPresupuesto ? resolverPresupuesto({ ...mapas, subpresupuestos: [], gastos: { fijos: [], variables: [] } }) : resolverCatalogo(catalogo.insumoMap, catalogo.partidaMap)),
    [enPresupuesto, mapas, catalogo]
  );

  const usarInsumo = useCallback(
    (ins: Insumo) => {
      if (enPresupuesto) setMapas((m) => (m.insumos[ins.id] ? m : { ...m, insumos: { ...m.insumos, [ins.id]: snapshotInsumo(ins) } }));
      return ins.id;
    },
    [enPresupuesto]
  );

  const opciones: OpcionSubpartida[] = useMemo(() => {
    const delCatalogo = catalogo.partidas
      .filter((p) => !(modo === "catalogo" && propioId && (p.id === propioId || creaCicloCatalogo(catalogo.partidaMap, p.id, propioId))))
      .map((p) => ({ id: p.id, descripcion: p.descripcion, unidad: p.unidad, grupo: "Catálogo" }));
    if (!enPresupuesto) return delCatalogo;
    const propias = Object.entries(mapas.subpartidas).map(([id, s]) => ({ id, descripcion: s.descripcion, unidad: s.unidad, grupo: "Presupuesto" }));
    return [...propias, ...delCatalogo];
  }, [catalogo, modo, propioId, enPresupuesto, mapas.subpartidas]);

  const usarSubpartida = useCallback(
    (id: string): string | null => {
      if (!enPresupuesto) return id;
      if (mapas.subpartidas[id]) return propioId && creaCiclo(mapas, id, propioId) ? null : id;
      // A catalog partida: copied into the budget as a subpartida (once).
      const r = importarApu({ rendimiento: 1, jornada: JORNADA, componentes: [{ tipo: "subpartida", id, cuadrilla: null, cantidad: 1 }] }, fuente, mapas);
      const nuevo = r.componentes[0]?.id;
      if (!nuevo || (propioId && creaCiclo(r, nuevo, propioId))) return null;
      setMapas({ insumos: r.insumos, subpartidas: r.subpartidas });
      return nuevo;
    },
    [enPresupuesto, mapas, propioId, fuente]
  );

  function copiarDeCatalogo(p: PartidaCatalogo) {
    const r = importarApu(p, fuente, mapas, [p.id]);
    setMapas({ insumos: r.insumos, subpartidas: r.subpartidas });
    setData((d) => ({
      ...d,
      codigo: p.codigo,
      descripcion: p.descripcion,
      unidad: p.unidad,
      omniclass: p.omniclass,
      rendimiento: p.rendimiento,
      jornada: p.jornada,
      edt: p.edt ? { ...p.edt } : undefined,
      componentes: r.componentes,
    }));
    setOrigenId(p.id);
    setCopiando(false);
  }

  function aceptar() {
    if (!data.descripcion.trim()) {
      setError("Escribe el nombre de la partida.");
      return;
    }
    if (!(data.rendimiento > 0)) {
      setError("El rendimiento debe ser mayor que 0.");
      return;
    }
    const edt = data.edt && (data.edt.descripcion.trim() || data.edt.criterios.trim() || data.edt.responsable.trim()) ? data.edt : undefined;
    onAccept({ ...data, ...(conMetrado ? { modo: modoMetrado } : {}), edt, descripcion: data.descripcion.trim(), unidad: data.unidad.trim(), codigo: data.codigo.trim(), omniclass: data.omniclass.trim() }, mapas, origenId);
  }

  const codigos22 = useMemo(() => catalogo.codigos.filter((c) => tablaDe(c.codigo) === "22"), [catalogo.codigos]);
  const listId = useMemo(() => `omniclass-${nuevoId()}`, []);
  const cu = useMemo(() => calcularApu(data, resolver).cu, [data, resolver]);

  return (
    <Modal
      title={titulo}
      onClose={onClose}
      width={1180}
      height="92vh"
      footer={
        readOnly ? (
          <button type="button" style={acceptButton} onClick={onClose}>
            Cerrar
          </button>
        ) : (
          <>
            {error && <span style={{ color: "#8a1c14", fontSize: 13.5 }}>{error}</span>}
            {conMetrado && <span style={{ fontSize: 13.5, color: "var(--tc-gray-500)" }}>Parcial: {fmt(Math.round(data.metrado * cu * 100) / 100)}</span>}
            <button type="button" style={acceptButton} onClick={aceptar}>
              Aceptar
            </button>
          </>
        )
      }
    >
      <div style={{ padding: "12px 14px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
        {enPresupuesto && !readOnly && (
          <div>
            {copiando ? (
              <Picker
                options={catalogo.partidas}
                textOf={(p) => `${p.codigo} ${p.descripcion} ${p.unidad}`}
                render={(p) => (
                  <span>
                    {insumoLabel(p)} <span style={{ color: "var(--tc-gray-500)", fontSize: 12 }}>{p.omniclass}</span>
                  </span>
                )}
                onPick={copiarDeCatalogo}
                onCancel={() => setCopiando(false)}
                placeholder="Busca la partida en el catálogo (nombre o código)..."
              />
            ) : (
              <button type="button" onClick={() => setCopiando(true)} style={smallLink} disabled={catalogo.partidas.length === 0}>
                {catalogo.partidas.length ? "Copiar desde el Catálogo de partidas..." : "El catálogo de partidas está vacío"}
              </button>
            )}
            {origenId && <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)", marginLeft: 8 }}>Copiada del catálogo: puedes ajustarla aquí sin cambiar el catálogo.</span>}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <label style={{ flex: "0 0 110px" }}>
            <span style={labelStyle}>Código</span>
            <input value={data.codigo} readOnly={readOnly} onChange={(e) => setData({ ...data, codigo: e.target.value })} maxLength={40} style={field} />
          </label>
          <label style={{ flex: "1 1 280px" }}>
            <span style={labelStyle}>Partida</span>
            <input
              value={data.descripcion}
              readOnly={readOnly}
              autoFocus={!readOnly}
              onChange={(e) => setData({ ...data, descripcion: e.target.value })}
              maxLength={300}
              style={field}
            />
          </label>
          <label style={{ flex: "0 0 100px" }}>
            <span style={labelStyle}>Unidad</span>
            <input value={data.unidad} readOnly={readOnly} onChange={(e) => setData({ ...data, unidad: e.target.value })} maxLength={20} style={field} />
          </label>
          {conMetrado && (
            <label style={{ flex: "0 0 190px" }}>
              <span style={labelStyle}>Origen del metrado</span>
              <select
                value={modoMetrado}
                disabled={readOnly}
                onChange={(e) => setData({ ...data, modo: e.target.value as ModoMetrado })}
                style={field}
                aria-label="Origen del metrado"
              >
                <option value="manual">Manual</option>
                <option value="3d">Asociado al modelo 3D</option>
              </select>
            </label>
          )}
          {conMetrado && (
            <label style={{ flex: "0 0 150px" }}>
              <span style={labelStyle}>Metrado{modoMetrado === "3d" ? " (modelo 3D)" : ""}</span>
              {modoMetrado === "3d" && metradoModelo ? (
                <NumInput value={metradoModelo.valor} decimals={2} style={{ ...field, textAlign: "right" }} ariaLabel="Metrado del modelo" readOnly />
              ) : (
                <NumInput value={data.metrado} decimals={2} onCommit={readOnly ? undefined : (v) => v !== null && setData({ ...data, metrado: v })} style={{ ...field, textAlign: "right" }} ariaLabel="Metrado" />
              )}
            </label>
          )}
        </div>
        <label>
          <span style={labelStyle}>Clasificación OmniClass (Tabla 22 · Resultados de trabajo)</span>
          <input
            value={data.omniclass}
            readOnly={readOnly}
            list={listId}
            onChange={(e) => setData({ ...data, omniclass: e.target.value.replace(/\s+[^\d\s-].*$/, "") })}
            placeholder="p. ej. 22-03 30 00"
            maxLength={60}
            style={{ ...field, maxWidth: 420 }}
          />
          <datalist id={listId}>
            {codigos22.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.titulo}
              </option>
            ))}
          </datalist>
          {data.omniclass && <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)", marginLeft: 8 }}>{catalogo.titulos.get(data.omniclass) ?? ""}</span>}
        </label>
        {conMetrado && modoMetrado === "3d" && (
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--tc-gray-500)" }}>
            {metradoModelo
              ? `El metrado es la suma de ${metradoModelo.elementos} elemento(s) del modelo (${metradoModelo.campoLabel}).`
              : "Todavía no hay elementos del modelo asociados: asócialos desde el panel Presupuesto del visor 3D. Mientras tanto se usa el metrado manual."}
          </p>
        )}
        {(conMetrado || modo === "catalogo") && (
          <fieldset style={{ border: "1px solid #dfe4ea", borderRadius: 4, padding: "8px 12px 10px", margin: 0 }}>
            <legend style={{ fontSize: 12.5, color: "var(--tc-gray-500)", padding: "0 6px" }}>Diccionario de la EDT</legend>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ gridColumn: "1 / -1" }}>
                <span style={labelStyle}>Descripción del trabajo</span>
                <textarea value={edt.descripcion} readOnly={readOnly} rows={2} maxLength={2000} onChange={(e) => setData({ ...data, edt: { ...edt, descripcion: e.target.value } })} style={{ ...field, fontSize: 14, resize: "vertical" }} />
              </label>
              <label>
                <span style={labelStyle}>Criterios de aceptación</span>
                <textarea value={edt.criterios} readOnly={readOnly} rows={2} maxLength={2000} onChange={(e) => setData({ ...data, edt: { ...edt, criterios: e.target.value } })} style={{ ...field, fontSize: 14, resize: "vertical" }} />
              </label>
              <label>
                <span style={labelStyle}>Responsable</span>
                <input value={edt.responsable} readOnly={readOnly} maxLength={120} onChange={(e) => setData({ ...data, edt: { ...edt, responsable: e.target.value } })} style={{ ...field, fontSize: 14 }} placeholder="Nombre o cargo" />
              </label>
            </div>
          </fieldset>
        )}
        {readOnly && <Notice kind="info">Solo lectura: no tienes permiso para modificar esto.</Notice>}
      </div>

      <div style={{ flex: 1, minHeight: 280, display: "flex", flexDirection: "column", margin: "0 14px", border: "1px solid #dfe4ea", background: "#fff" }}>
        <ApuEditor
          apu={data}
          resolver={resolver}
          unidad={data.unidad}
          onChange={readOnly ? undefined : (apu: Apu) => setData((d) => ({ ...d, ...apu }))}
          insumos={catalogo.insumos}
          usarInsumo={usarInsumo}
          subpartidas={opciones}
          usarSubpartida={usarSubpartida}
          onNuevaSubpartida={enPresupuesto && !readOnly ? () => setSub({ id: null, data: partidaVacia() }) : undefined}
          onAbrirSubpartida={enPresupuesto ? (id) => mapas.subpartidas[id] && setSub({ id, data: { ...mapas.subpartidas[id], metrado: 0 } }) : undefined}
          onPrecio={
            enPresupuesto && !readOnly
              ? (id, precio) => setMapas((m) => (m.insumos[id] ? { ...m, insumos: { ...m.insumos, [id]: { ...m.insumos[id], precio } } } : m))
              : undefined
          }
        />
      </div>
      {enPresupuesto && !readOnly && (
        <p style={{ margin: "6px 14px 0", fontSize: 12, color: "var(--tc-gray-500)" }}>
          El PU de un insumo es el de este presupuesto: cambiarlo aquí lo cambia en todas las partidas que lo usan.
        </p>
      )}

      {sub && (
        <ApuDialog
          titulo={sub.id ? "Sub partida" : "Nueva Sub partida"}
          modo="presupuesto"
          inicial={sub.data}
          mapas={mapas}
          catalogo={catalogo}
          propioId={sub.id ?? undefined}
          readOnly={readOnly}
          onClose={() => setSub(null)}
          onAccept={(d, m, origen) => {
            const id = sub.id ?? nuevoId();
            const { metrado: _m, ...apu } = d;
            const previa = m.subpartidas[id];
            setMapas({ insumos: m.insumos, subpartidas: { ...m.subpartidas, [id]: { ...apu, origenId: origen ?? previa?.origenId ?? null } } });
            if (!sub.id) setData((x) => ({ ...x, componentes: [...x.componentes, { tipo: "subpartida", id, cuadrilla: null, cantidad: 1 }] }));
            setSub(null);
          }}
        />
      )}
    </Modal>
  );
}

const field: CSSProperties = { ...baseInput, width: "100%", fontSize: 15, padding: "8px 10px" };
const smallLink: CSSProperties = {
  border: "1px dashed var(--tc-blue-500)",
  background: "var(--tc-white)",
  color: "var(--tc-blue-700)",
  borderRadius: 4,
  padding: "6px 10px",
  fontSize: 13.5,
  cursor: "pointer",
  fontFamily: "inherit",
};
