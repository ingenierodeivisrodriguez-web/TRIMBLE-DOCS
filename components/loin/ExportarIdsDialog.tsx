"use client";

import { useMemo, useState } from "react";
import { descargarIds, generarIds, ResultadoIds, VERSIONES_IFC, VersionIfc } from "../../lib/loin/ids";
import { clave, fechaCorta } from "../../lib/loin/matriz";
import type { CeldaMatriz, Disciplina, Elemento, Etapa, Parametro } from "../../lib/loin/types";
import { acceptButton, C, labelStyle, message, Modal, Notice } from "../presupuesto/ui";
import { ayuda, botonSecundario, select } from "./estilos";

const hoyIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * The stage's requirements as an IDS file (buildingSMART), for the designer
 * to check the IFC in their own software before uploading it. Shows before
 * downloading what goes in and what an IDS can't carry.
 */
export default function ExportarIdsDialog({
  proyecto,
  etapas,
  disciplinas,
  elementos,
  celdas,
  catalogo,
  onClose,
}: {
  proyecto: string;
  etapas: Etapa[];
  disciplinas: Disciplina[];
  elementos: Elemento[];
  celdas: Map<string, CeldaMatriz>;
  catalogo: Map<string, Parametro>;
  onClose: () => void;
}) {
  const conNdi = (et: Etapa) => elementos.some((e) => e.activo && celdas.get(clave(e.id, et.id))?.ndi != null);
  const [etapaId, setEtapaId] = useState(() => (etapas.find(conNdi) ?? etapas[0])?.id ?? "");
  const activas = useMemo(() => disciplinas.filter((d) => d.activo).sort((a, b) => a.orden - b.orden || a.codigo.localeCompare(b.codigo)), [disciplinas]);
  const [elegidas, setElegidas] = useState(() => new Set(activas.map((d) => d.id)));
  const [versiones, setVersiones] = useState<Set<VersionIfc>>(() => new Set(["IFC2X3", "IFC4"]));
  const [preferirIfc, setPreferirIfc] = useState(false);
  const [error, setError] = useState("");
  const etapa = etapas.find((e) => e.id === etapaId) ?? null;

  const datos = useMemo(
    () =>
      etapa
        ? {
            proyecto,
            etapa,
            disciplinas: activas.filter((d) => elegidas.has(d.id)),
            elementos,
            celdas,
            catalogo,
            versiones: VERSIONES_IFC.filter((v) => versiones.has(v)),
            fecha: hoyIso(),
            preferirIfc,
          }
        : null,
    [etapa, activas, elegidas, versiones, preferirIfc, proyecto, elementos, celdas, catalogo]
  );
  const vista = useMemo((): { r: ResultadoIds | null; error: string } => {
    if (!datos) return { r: null, error: "No hay etapas." };
    try {
      return { r: generarIds(datos), error: "" };
    } catch (err) {
      return { r: null, error: message(err) };
    }
  }, [datos]);

  const alternar = <T,>(set: Set<T>, x: T, si: boolean) => {
    const n = new Set(set);
    if (si) n.add(x);
    else n.delete(x);
    return n;
  };

  function descargar() {
    if (!datos) return;
    setError("");
    try {
      descargarIds(datos);
    } catch (err) {
      setError(message(err));
    }
  }

  const r = vista.r;
  return (
    <Modal
      title="Exportar los requisitos a IDS"
      onClose={onClose}
      width={860}
      height="86vh"
      footer={
        <>
          <button type="button" style={botonSecundario} onClick={onClose}>
            Cerrar
          </button>
          <button type="button" style={acceptButton} onClick={descargar} disabled={!r}>
            Descargar IDS
          </button>
        </>
      }
    >
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12, overflow: "auto" }}>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
          Un archivo <strong>IDS</strong> (buildingSMART) con lo que pide la etapa: una especificación por elemento, que aplica a su clase IFC (y tipo predefinido) y exige
          los parámetros de su NDI donde los busca la auditoría, obligatorios u opcionales, con su regla cuando el IDS la puede llevar. El diseñador lo carga en su
          programa o en un revisor IFC para autoverificar el modelo antes de subirlo.
        </p>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={labelStyle}>
            Etapa
            <select value={etapaId} onChange={(e) => setEtapaId(e.target.value)} style={{ ...select, display: "block", marginTop: 4, minWidth: 260 }}>
              {etapas.map((et) => (
                <option key={et.id} value={et.id}>
                  {et.nombre}
                  {et.fecha ? ` (${fechaCorta(et.fecha)})` : ""}
                  {conNdi(et) ? "" : " · sin NDI"}
                </option>
              ))}
            </select>
          </label>
          <fieldset style={grupo}>
            <legend style={leyenda}>Versiones de IFC de los modelos</legend>
            {VERSIONES_IFC.map((v) => (
              <label key={v} style={opcion}>
                <input type="checkbox" checked={versiones.has(v)} onChange={(e) => setVersiones((s) => alternar(s, v, e.target.checked))} /> {v}
              </label>
            ))}
          </fieldset>
        </div>
        <p style={{ ...ayuda, marginTop: -6 }}>
          Los revisores solo aplican las especificaciones a modelos de las versiones marcadas: incluye la que exportan los diseñadores (Revit suele usar IFC2X3 o IFC4).
        </p>

        <fieldset style={grupo}>
          <legend style={leyenda}>Disciplinas</legend>
          {activas.map((d) => (
            <label key={d.id} style={opcion}>
              <input type="checkbox" checked={elegidas.has(d.id)} onChange={(e) => setElegidas((s) => alternar(s, d.id, e.target.checked))} />
              <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color, display: "inline-block" }} /> {d.codigo} · {d.nombre}
            </label>
          ))}
        </fieldset>

        <label style={{ ...opcion, fontSize: 13.5 }}>
          <input type="checkbox" checked={preferirIfc} onChange={(e) => setPreferirIfc(e.target.checked)} />
          Pedir cada parámetro en su equivalencia IFC estándar (Pset_, Qto_ o atributo) cuando la tenga, en vez de la primera equivalencia
        </label>
        <p style={{ ...ayuda, marginTop: -8 }}>
          Sin marcar, el IDS pide cada parámetro donde la auditoría lo busca primero (por ejemplo, "Ancho" en cualquier grupo, como lo exporta Revit con parámetros
          compartidos). Marcado, pide el nombre IFC estándar (por ejemplo, Qto_WallBaseQuantities.Width).
        </p>

        {vista.error && <Notice kind="warning">{vista.error}</Notice>}
        {error && <Notice kind="error">{error}</Notice>}
        {r && (
          <>
            <Notice kind="info">
              <strong>{r.especificaciones}</strong> especificación(es) con <strong>{r.requisitos}</strong> requisito(s).
              {r.sinExigencia > 0 && ` ${r.sinExigencia} elemento(s) no piden información (NDI) en esta etapa y no van.`}
            </Notice>
            {r.omitidos.length > 0 && (
              <Notice kind="warning">
                No van en el IDS:
                <ul style={lista}>
                  {r.omitidos.map((o) => (
                    <li key={o.elemento}>
                      {o.elemento}: {o.motivo}.
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            {r.compartidas.length > 0 && (
              <Notice kind="warning">
                Estos elementos comparten clase IFC sin un tipo predefinido que los distinga; en el IDS cada uno exige sus parámetros a todos los objetos de esa clase.
                Dales un tipo predefinido en su ficha si deben distinguirse:
                <ul style={lista}>
                  {r.compartidas.map((g) => (
                    <li key={g.join()}>{g.join(", ")}</li>
                  ))}
                </ul>
              </Notice>
            )}
            {r.avisos.length > 0 && (
              <details style={{ fontSize: 13.5, background: "#fff", border: `1px solid ${C.border}`, borderRadius: 4, padding: "6px 10px" }}>
                <summary style={{ cursor: "pointer" }}>Lo que el IDS no puede llevar ({r.avisos.length})</summary>
                <ul style={lista}>
                  {r.avisos.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        <p style={ayuda}>
          Ten en cuenta: el LOD no va en el IDS (no se puede revisar en el modelo); los valores de relleno ("N/A", "-") no se pueden expresar; en el IDS las listas de
          valores distinguen mayúsculas y tildes, y las medidas van en unidades SI (metros, radianes, segundos). Archivo IDS 1.0, para {VERSIONES_IFC.filter((v) => versiones.has(v)).join(", ") || "ninguna versión de IFC"}.
        </p>
      </div>
    </Modal>
  );
}

const grupo = { border: `1px solid ${C.border}`, borderRadius: 4, padding: "6px 10px 8px", margin: 0, display: "flex", gap: 12, flexWrap: "wrap" as const };
const leyenda = { fontSize: 12.5, color: "var(--tc-gray-500)", padding: "0 4px" };
const opcion = { display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13.5 };
const lista = { margin: "4px 0 0", paddingLeft: 18, maxHeight: 160, overflow: "auto" as const };
