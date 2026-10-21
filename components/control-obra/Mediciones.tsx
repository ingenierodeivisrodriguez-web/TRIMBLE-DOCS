"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import type { ObraApi } from "../../lib/control-obra/client";
import { ESTADOS_MEDICION } from "../../lib/control-obra/formato";
import { cantidadElemento, cantidadLinea, contratosDePartida, numeroMedicion, revisarUbicacion } from "../../lib/control-obra/mediciones";
import { CambioMedicion, MedicionesResponse, MedicionObra, PartidaMedible, Ubicacion } from "../../lib/control-obra/types";
import { fecha } from "../../lib/compras/formato";
import { redondear } from "../../lib/presupuesto/calc";
import { coincide, fmt } from "../../lib/presupuesto/format";
import { ApiError } from "../../lib/propiedades/client";
import { isoToDisplay, parseDisplayDate, parseNumberInput } from "../../lib/propiedades/values";
import { acceptButton, baseInput, C, celdaActiva, labelStyle, message, Modal, Notice } from "../presupuesto/ui";
import DateField from "../propiedades/DateField";
import { botonPeligro, botonSecundario, etiqueta, linkBtn, select, td, texto, th } from "../compras/estilos";
import { segmento } from "./ControlObraApp";
import UbicacionSelector from "./UbicacionSelector";

type AbrirVisor = (params: { modelId?: string; versionId?: string }) => Promise<boolean>;
type Vista = "lista" | "partidas";

/** What was built, partida by partida: measurements from the model (made in the 3D viewer) or by hand, with their location and contract. */
export default function Mediciones({ api, abrirVisor, onSinAcceso }: { api: ObraApi; abrirVisor?: AbrirVisor; onSinAcceso: (err: unknown) => void }) {
  const [datos, setDatos] = useState<MedicionesResponse | null>(null);
  const [error, setError] = useState("");
  const [vista, setVista] = useState<Vista>("lista");
  const [buscar, setBuscar] = useState("");
  const [verAnuladas, setVerAnuladas] = useState(false);
  const [editar, setEditar] = useState<MedicionObra | "nueva" | null>(null);
  const [anular, setAnular] = useState<MedicionObra | null>(null);
  const [aviso, setAviso] = useState("");

  const cargar = useCallback(async () => {
    setError("");
    try {
      setDatos(await api.getMediciones());
    } catch (err) {
      setError(message(err));
      onSinAcceso(err);
    }
  }, [api, onSinAcceso]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const filas = useMemo(
    () =>
      (datos?.mediciones ?? []).filter(
        (m) =>
          (verAnuladas || m.estado !== "anulada") &&
          (!buscar.trim() || coincide(`${numeroMedicion(m.numero)} ${m.partidaNumero} ${m.partidaDescripcion} ${m.ubicacionTexto} ${m.proveedor} ${m.elaboradoPor}`, buscar))
      ),
    [datos, buscar, verAnuladas]
  );

  if (error && !datos) return <Notice kind="error">{error}</Notice>;
  if (!datos) return <p style={{ color: "var(--tc-gray-500)" }}>Cargando mediciones…</p>;

  async function verEn3D(m: MedicionObra) {
    if (!abrirVisor || !m.elementos.length) return;
    setAviso("");
    try {
      await api.pedirVista({ partidaId: m.partidaId, elementos: m.elementos.map((e) => ({ modelId: e.modelId, ifcGuid: e.ifcGuid })) });
      const ok = await abrirVisor({ modelId: m.elementos[0].modelId });
      if (!ok) setAviso("No se pudo abrir el visor 3D desde aquí. Ábrelo en Trimble Connect y entra al panel Control de Obra: los elementos se seleccionan solos.");
    } catch (err) {
      setAviso(`No se pudo preparar la vista 3D: ${message(err)}`);
    }
  }

  const anuladas = datos.mediciones.filter((m) => m.estado === "anulada").length;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {!datos.presupuesto && <Notice kind="warning">Este proyecto todavía no tiene un presupuesto guardado en Presupuesto: no hay partidas que medir.</Notice>}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" style={segmento(vista === "lista")} onClick={() => setVista("lista")}>
          Mediciones
        </button>
        <button type="button" style={segmento(vista === "partidas")} onClick={() => setVista("partidas")}>
          Por partida
        </button>
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar partida, ubicación, contrato…" aria-label="Buscar" style={{ ...baseInput, width: 260, marginLeft: 8 }} />
        <label style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={verAnuladas} onChange={(e) => setVerAnuladas(e.target.checked)} />
          Mostrar anuladas{anuladas ? ` (${anuladas})` : ""}
        </label>
        <span style={{ flex: 1 }} />
        {datos.puede.crear && datos.presupuesto && (
          <button type="button" onClick={() => setEditar("nueva")} style={{ ...acceptButton, padding: "6px 14px", fontSize: 14 }} title="Para lo que no está modelado: memoria de cantidades">
            ＋ Medición a mano
          </button>
        )}
      </div>
      {datos.puede.crear && (
        <p style={{ ...texto, fontSize: 13, margin: 0 }}>
          Lo modelado se mide en el visor 3D: abre el modelo, entra al panel <strong>Control de Obra</strong>, elige la partida y selecciona los elementos. La cantidad
          sale del modelo con la misma regla de metrado de Presupuesto; un elemento puede medirse por partes, sin pasar del 100 % en cada partida.
        </p>
      )}
      {aviso && <Notice kind="info">{aviso}</Notice>}
      {vista === "lista" ? (
        <Lista filas={filas} datos={datos} onEditar={setEditar} onAnular={setAnular} onVer3D={abrirVisor ? verEn3D : undefined} />
      ) : (
        <PorPartida datos={datos} buscar={buscar} />
      )}
      {editar && (
        <MedicionDialog
          api={api}
          datos={datos}
          medicion={editar === "nueva" ? null : editar}
          onCerrar={() => setEditar(null)}
          onGuardado={(d) => {
            setDatos(d);
            setEditar(null);
          }}
          onRecargar={cargar}
        />
      )}
      {anular && (
        <AnularDialog
          medicion={anular}
          onCerrar={() => setAnular(null)}
          onAnular={async (motivo) => {
            setDatos(await api.anularMedicion({ id: anular.id, motivo, version: anular.version }));
            setAnular(null);
          }}
        />
      )}
    </div>
  );
}

const derecha: CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };

function Lista({
  filas,
  datos,
  onEditar,
  onAnular,
  onVer3D,
}: {
  filas: MedicionObra[];
  datos: MedicionesResponse;
  onEditar: (m: MedicionObra) => void;
  onAnular: (m: MedicionObra) => void;
  onVer3D?: (m: MedicionObra) => void;
}) {
  if (!filas.length) return <p style={{ color: "var(--tc-gray-500)" }}>No hay mediciones{datos.mediciones.length ? " con ese filtro" : " todavía"}.</p>;
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, overflow: "auto", maxHeight: "70vh" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={th}>N.º</th>
            <th style={th}>Fecha</th>
            <th style={th}>Partida</th>
            <th style={th}>Ubicación</th>
            <th style={th}>Ejecutó</th>
            <th style={th}>Origen</th>
            <th style={{ ...th, textAlign: "right" }}>Cantidad</th>
            <th style={th}>Estado</th>
            <th style={th}>Registró</th>
            <th style={th} aria-label="Acciones" />
          </tr>
        </thead>
        <tbody>
          {filas.map((m) => {
            const e = ESTADOS_MEDICION[m.estado];
            const editable = m.estado === "registrada";
            return (
              <tr key={m.id} style={{ color: m.estado === "anulada" ? "var(--tc-gray-500)" : undefined }}>
                <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 600 }}>{numeroMedicion(m.numero)}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{fecha(m.fecha)}</td>
                <td style={td}>
                  {m.partidaNumero} {m.partidaDescripcion}
                </td>
                <td style={td}>{m.ubicacionTexto}</td>
                <td style={td}>{m.contratoId ? `CT-${String(m.contratoNumero).padStart(4, "0")} ${m.proveedor}` : "Obra propia"}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{m.origen === "modelo" ? `Modelo (${m.elementos.length})` : "A mano"}</td>
                <td style={derecha} title={m.origen === "modelo" ? "Suma de los elementos: % medido × cantidad del modelo" : "Suma de la memoria: veces × largo × ancho × alto"}>
                  {fmt(m.cantidad, 4)} {m.partidaUnidad}
                </td>
                <td style={td} title={m.estado === "anulada" ? `Motivo: ${m.motivo}` : undefined}>
                  <span style={etiqueta(e.color, e.fondo)}>{e.texto}</span>
                </td>
                <td style={td}>{m.elaboradoPor}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <button type="button" style={linkBtn} onClick={() => onEditar(m)}>
                    {editable && datos.puede.editar ? "Ver / cambiar" : "Ver"}
                  </button>
                  {onVer3D && m.elementos.length > 0 && (
                    <>
                      {" · "}
                      <button type="button" style={linkBtn} onClick={() => onVer3D(m)}>
                        Ver en 3D
                      </button>
                    </>
                  )}
                  {editable && datos.puede.anular && (
                    <>
                      {" · "}
                      <button type="button" style={linkBtn} onClick={() => onAnular(m)}>
                        Anular
                      </button>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Contracted (the budget's metrado) against what was measured, partida by partida. */
function PorPartida({ datos, buscar }: { datos: MedicionesResponse; buscar: string }) {
  const medido = new Map<string, { cantidad: number; n: number }>();
  for (const m of datos.mediciones) {
    if (m.estado === "anulada") continue;
    const x = medido.get(m.partidaId) ?? { cantidad: 0, n: 0 };
    medido.set(m.partidaId, { cantidad: redondear(x.cantidad + m.cantidad, 4), n: x.n + 1 });
  }
  const filas = datos.partidas.filter((p) => (medido.has(p.id) || !buscar.trim()) && (!buscar.trim() || coincide(`${p.numero} ${p.descripcion} ${p.capitulo}`, buscar)));
  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6, overflow: "auto", maxHeight: "70vh" }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={th}>Partida</th>
            <th style={th}>Capítulo</th>
            <th style={th}>Unidad</th>
            <th style={{ ...th, textAlign: "right" }}>Contratado</th>
            <th style={{ ...th, textAlign: "right" }}>Medido</th>
            <th style={{ ...th, textAlign: "right" }}>%</th>
            <th style={{ ...th, textAlign: "right" }}>Mediciones</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((p) => {
            const m = medido.get(p.id);
            const pct = m && p.metrado > 0 ? (m.cantidad / p.metrado) * 100 : null;
            return (
              <tr key={p.id} style={{ color: p.inactiva ? "var(--tc-gray-500)" : undefined }}>
                <td style={td}>
                  {p.numero} {p.descripcion}
                  {p.inactiva && " (desactivada)"}
                </td>
                <td style={{ ...td, color: "var(--tc-gray-500)" }}>{p.capitulo || p.subpresupuesto}</td>
                <td style={td}>{p.unidad}</td>
                <td style={derecha}>{fmt(p.metrado, 4)}</td>
                <td style={derecha}>{m ? fmt(m.cantidad, 4) : "—"}</td>
                <td style={{ ...derecha, color: pct !== null && pct > 100 ? C.close : undefined }} title={pct !== null && pct > 100 ? "Medido por encima de lo contratado: mayor cantidad" : "Medido ÷ contratado"}>
                  {pct === null ? "—" : `${fmt(pct, 2)} %`}
                </td>
                <td style={derecha}>{m?.n ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ ...texto, fontSize: 12, margin: 8 }}>Medido = todas las mediciones sin anular (registradas, en acta y aprobadas).</p>
    </div>
  );
}

// ---------------------------------------------------------------- one measurement

interface LineaEditable {
  descripcion: string;
  veces: string;
  largo: string;
  ancho: string;
  alto: string;
}

const aTexto = (n: number | null) => (n === null ? "" : String(n));
const leerNumero = (t: string): number | null => (t.trim() === "" ? null : parseNumberInput(t.replace(/\s/g, "")));

/** A number cell that also takes negatives (a deduction: veces −1), yellow while it is being written. */
function Celda({ value, onChange, ariaLabel, width = 80, disabled }: { value: string; onChange: (v: string) => void; ariaLabel: string; width?: number; disabled?: boolean }) {
  const [foco, setFoco] = useState(false);
  const malo = value.trim() !== "" && leerNumero(value) === null;
  return (
    <input
      value={value}
      inputMode="decimal"
      aria-label={ariaLabel}
      disabled={disabled}
      onFocus={() => setFoco(true)}
      onBlur={() => setFoco(false)}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...baseInput, width, textAlign: "right", ...(foco ? celdaActiva : {}), ...(malo ? { borderColor: C.close } : {}) }}
    />
  );
}

function MedicionDialog({
  api,
  datos,
  medicion,
  onCerrar,
  onGuardado,
  onRecargar,
}: {
  api: ObraApi;
  datos: MedicionesResponse;
  medicion: MedicionObra | null;
  onCerrar: () => void;
  onGuardado: (d: MedicionesResponse) => void;
  onRecargar: () => void;
}) {
  const editable = medicion ? medicion.estado === "registrada" && datos.puede.editar : datos.puede.crear;
  const origen = medicion?.origen ?? "manual";
  const [partidaId, setPartidaId] = useState(medicion?.partidaId ?? "");
  const [buscar, setBuscar] = useState("");
  const [contratoId, setContratoId] = useState(medicion?.contratoId ?? "");
  const [ubicacion, setUbicacion] = useState<Ubicacion>(medicion?.ubicacion ?? {});
  const [fechaTexto, setFechaTexto] = useState(isoToDisplay(medicion?.fecha ?? datos.hoy));
  const [observaciones, setObservaciones] = useState(medicion?.observaciones ?? "");
  const [lineas, setLineas] = useState<LineaEditable[]>(
    medicion?.lineas.map((l) => ({ descripcion: l.descripcion, veces: aTexto(l.veces), largo: aTexto(l.largo), ancho: aTexto(l.ancho), alto: aTexto(l.alto) })) ?? [
      { descripcion: "", veces: "1", largo: "", ancho: "", alto: "" },
    ]
  );
  const [elementos, setElementos] = useState(medicion?.elementos.map((e) => ({ ...e, pct: String(e.porcentaje) })) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const partida: PartidaMedible | undefined = datos.partidas.find((p) => p.id === partidaId);
  const contratos = partida ? contratosDePartida(partida, datos.contratos) : [];
  const iso = parseDisplayDate(fechaTexto);
  const lineasLeidas = lineas.map((l) => ({ descripcion: l.descripcion, veces: leerNumero(l.veces), largo: leerNumero(l.largo), ancho: leerNumero(l.ancho), alto: leerNumero(l.alto) }));
  const lineaMala = lineas.some((l, i) => lineasLeidas[i].veces === null || [l.largo, l.ancho, l.alto].some((x) => x.trim() !== "" && leerNumero(x) === null));
  const cantidades = lineasLeidas.map((l) => (l.veces === null ? 0 : cantidadLinea({ veces: l.veces, largo: l.largo, ancho: l.ancho, alto: l.alto })));
  const elementosLeidos = elementos.map((e) => ({ ...e, porcentaje: leerNumero(e.pct) ?? NaN }));
  const total =
    origen === "manual"
      ? redondear(cantidades.reduce((a, b) => a + b, 0), 4)
      : redondear(elementosLeidos.reduce((a, e) => a + (Number.isFinite(e.porcentaje) ? cantidadElemento(e.porcentaje, e.cantidadModelo) : 0), 0), 4);
  const ubicacionMala = revisarUbicacion(ubicacion, datos.niveles, datos.nodos, datos.ubicacionObligatoria);
  const problema = !partida
    ? "Elige la partida."
    : partida.inactiva
      ? "La partida está desactivada en Presupuesto."
      : ubicacionMala ??
        (!iso
          ? "Escribe la fecha (DD-MM-AAAA)."
          : iso > datos.hoy
            ? "La fecha no puede ser futura."
            : origen === "manual" && lineaMala
              ? "Revisa los números de la memoria."
              : origen === "modelo" && elementosLeidos.some((e) => !(e.porcentaje > 0 && e.porcentaje <= 100))
                ? "Cada elemento lleva un porcentaje mayor que 0 y hasta 100."
                : !(total > 0)
                  ? "La cantidad medida debe ser mayor que cero."
                  : null);
  const candidatas = useMemo(
    () => datos.partidas.filter((p) => !buscar.trim() || coincide(`${p.numero} ${p.descripcion} ${p.capitulo} ${p.subpresupuesto}`, buscar)).slice(0, 300),
    [datos.partidas, buscar]
  );

  async function guardar() {
    if (problema || !partida || !iso) return;
    setBusy(true);
    setError("");
    const cambio: CambioMedicion = {
      ...(medicion ? { id: medicion.id } : {}),
      partidaId: partida.id,
      contratoId: contratoId || null,
      ubicacion,
      fecha: iso,
      origen,
      observaciones,
      elementos: origen === "modelo" ? elementosLeidos.map((e) => ({ modelId: e.modelId, versionId: e.versionId, ifcGuid: e.ifcGuid, nombre: e.nombre, porcentaje: e.porcentaje })) : [],
      lineas: origen === "manual" ? lineasLeidas.map((l) => ({ descripcion: l.descripcion.trim(), veces: l.veces!, largo: l.largo, ancho: l.ancho, alto: l.alto })) : [],
      version: medicion?.version ?? 0,
    };
    try {
      onGuardado(await api.guardarMedicion(cambio));
    } catch (err) {
      setBusy(false);
      setError(message(err));
      if (err instanceof ApiError && err.code === "version-conflict") onRecargar();
    }
  }

  const titulo = medicion ? `${numeroMedicion(medicion.numero)} · ${origen === "modelo" ? "desde el modelo" : "a mano"}` : "Nueva medición a mano";
  return (
    <Modal
      title={titulo}
      width={980}
      onClose={() => !busy && onCerrar()}
      footer={
        <>
          <span style={{ marginRight: "auto", fontSize: 14 }} title={origen === "manual" ? "Suma de las líneas de la memoria" : "Suma de los elementos: % × cantidad del modelo"}>
            Cantidad medida: <strong>{fmt(total, 4)}</strong> {partida?.unidad}
          </span>
          <button type="button" onClick={onCerrar} disabled={busy} style={botonSecundario}>
            {editable ? "Cancelar" : "Cerrar"}
          </button>
          {editable && (
            <button type="button" onClick={guardar} disabled={busy || !!problema} style={{ ...acceptButton, opacity: problema ? 0.5 : 1 }} title={problema ?? undefined}>
              {busy ? "Guardando…" : medicion ? "Guardar cambios" : "Registrar medición"}
            </button>
          )}
        </>
      }
    >
      <div style={{ padding: 16, display: "grid", gap: 14 }}>
        {medicion && medicion.estado !== "registrada" && (
          <Notice kind="info">
            {medicion.estado === "anulada" ? `Anulada. Motivo: ${medicion.motivo}` : `Está ${ESTADOS_MEDICION[medicion.estado].texto.toLowerCase()}: ya no se cambia.`}
          </Notice>
        )}
        <div>
          <span style={labelStyle}>Partida</span>
          {editable && origen === "manual" ? (
            <div style={{ display: "grid", gap: 6 }}>
              <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por número, descripción o capítulo" aria-label="Buscar partida" style={{ ...baseInput, width: "100%" }} />
              <select
                size={6}
                value={partidaId}
                onChange={(e) => {
                  setPartidaId(e.target.value);
                  setContratoId("");
                }}
                aria-label="Partida"
                style={{ ...select, width: "100%" }}
              >
                {candidatas.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.inactiva}>
                    {p.numero} {p.descripcion} ({p.unidad}) — {p.capitulo || p.subpresupuesto}
                    {p.inactiva ? " — desactivada" : ""}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p style={{ margin: 0, fontWeight: 600 }}>
              {partida ? `${partida.numero} ${partida.descripcion} (${partida.unidad})` : `${medicion?.partidaNumero} ${medicion?.partidaDescripcion} (ya no está en el presupuesto)`}
            </p>
          )}
          {partida && <p style={{ fontSize: 12.5, color: "var(--tc-gray-500)", margin: "4px 0 0" }}>Contratado en el presupuesto: {fmt(partida.metrado, 4)} {partida.unidad}</p>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
          <div>
            <label style={labelStyle} htmlFor="med-contrato">
              Quién la ejecutó
            </label>
            <select id="med-contrato" value={contratoId} disabled={!editable || !partida} onChange={(e) => setContratoId(e.target.value)} style={{ ...select, width: "100%" }}>
              <option value="">Obra propia (sin subcontrato)</option>
              {contratos.map((c) => (
                <option key={c.id} value={c.id}>
                  CT-{String(c.numero).padStart(4, "0")} {c.proveedor}
                  {c.revision ? ` (otrosí ${c.revision})` : ""}
                </option>
              ))}
              {medicion?.contratoId && !contratos.some((c) => c.id === medicion.contratoId) && (
                <option value={medicion.contratoId}>CT-{String(medicion.contratoNumero).padStart(4, "0")} {medicion.proveedor} (ya no aplica)</option>
              )}
            </select>
            {partida && !contratos.length && (
              <p style={{ fontSize: 12, color: "var(--tc-gray-500)", margin: "4px 0 0" }}>No hay contratos aprobados en Compras con un insumo de subcontrato o mano de obra de esta partida.</p>
            )}
          </div>
          <div>
            <label style={labelStyle} htmlFor="med-fecha">
              Fecha de ejecución
            </label>
            {editable ? <DateField id="med-fecha" text={fechaTexto} placeholder="DD-MM-AAAA" invalid={!iso || iso > datos.hoy} onText={setFechaTexto} /> : <p style={{ margin: 0 }}>{fechaTexto}</p>}
          </div>
        </div>
        <div>
          <span style={labelStyle}>Ubicación</span>
          <UbicacionSelector niveles={datos.niveles} nodos={datos.nodos} obligatorios={datos.ubicacionObligatoria} value={ubicacion} onChange={setUbicacion} disabled={!editable} idBase="med-ubic" />
        </div>

        {origen === "manual" ? (
          <div>
            <span style={labelStyle}>Memoria de cantidades</span>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>Descripción</th>
                  <th style={{ ...th, textAlign: "right" }}>Veces</th>
                  <th style={{ ...th, textAlign: "right" }}>Largo</th>
                  <th style={{ ...th, textAlign: "right" }}>Ancho</th>
                  <th style={{ ...th, textAlign: "right" }}>Alto</th>
                  <th style={{ ...th, textAlign: "right" }}>Cantidad</th>
                  <th style={th} aria-label="Quitar" />
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => {
                  const set = (k: keyof LineaEditable, v: string) => setLineas((x) => x.map((y, j) => (j === i ? { ...y, [k]: v } : y)));
                  return (
                    <tr key={i}>
                      <td style={td}>
                        <input value={l.descripcion} maxLength={200} disabled={!editable} onChange={(e) => set("descripcion", e.target.value)} aria-label={`Línea ${i + 1}: descripción`} style={{ ...baseInput, width: "100%" }} />
                      </td>
                      {(["veces", "largo", "ancho", "alto"] as const).map((k) => (
                        <td key={k} style={{ ...td, textAlign: "right" }}>
                          <Celda value={l[k]} onChange={(v) => set(k, v)} ariaLabel={`Línea ${i + 1}: ${k}`} disabled={!editable} />
                        </td>
                      ))}
                      <td style={derecha} title="Veces × largo × ancho × alto (las vacías no cuentan)">
                        {fmt(cantidades[i], 4)}
                      </td>
                      <td style={td}>
                        {editable && lineas.length > 1 && (
                          <button type="button" style={linkBtn} onClick={() => setLineas((x) => x.filter((_, j) => j !== i))} aria-label={`Quitar la línea ${i + 1}`}>
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {editable && (
              <button type="button" style={{ ...linkBtn, marginTop: 6 }} onClick={() => setLineas((x) => [...x, { descripcion: "", veces: "1", largo: "", ancho: "", alto: "" }])}>
                ＋ Agregar línea
              </button>
            )}
            <p style={{ fontSize: 12, color: "var(--tc-gray-500)", margin: "4px 0 0" }}>
              Cantidad = veces × las dimensiones escritas (las vacías no cuentan). Para descontar un vano, escribe veces negativo.
            </p>
          </div>
        ) : (
          <div>
            <span style={labelStyle}>Elementos del modelo ({elementos.length})</span>
            <div style={{ maxHeight: 260, overflow: "auto", border: `1px solid ${C.border}`, borderRadius: 4 }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={th}>Elemento</th>
                    <th style={{ ...th, textAlign: "right" }}>Del modelo</th>
                    <th style={{ ...th, textAlign: "right" }}>% medido</th>
                    <th style={{ ...th, textAlign: "right" }}>Cantidad</th>
                    <th style={th} aria-label="Quitar" />
                  </tr>
                </thead>
                <tbody>
                  {elementosLeidos.map((e, i) => (
                    <tr key={e.ifcGuid}>
                      <td style={td} title={`IFCGUID ${e.ifcGuid}`}>
                        {e.nombre || e.ifcGuid}
                      </td>
                      <td style={derecha}>{fmt(e.cantidadModelo, 4)}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        <Celda value={elementos[i].pct} onChange={(v) => setElementos((x) => x.map((y, j) => (j === i ? { ...y, pct: v } : y)))} ariaLabel={`${e.nombre}: % medido`} width={70} disabled={!editable} />
                      </td>
                      <td style={derecha}>{Number.isFinite(e.porcentaje) ? fmt(cantidadElemento(e.porcentaje, e.cantidadModelo), 4) : "—"}</td>
                      <td style={td}>
                        {editable && elementos.length > 1 && (
                          <button type="button" style={linkBtn} onClick={() => setElementos((x) => x.filter((_, j) => j !== i))} aria-label={`Quitar ${e.nombre}`}>
                            ✕
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 12, color: "var(--tc-gray-500)", margin: "4px 0 0" }}>
              Para agregar elementos, mide desde el visor 3D. La cantidad de cada elemento es la que tiene en Presupuesto para esta partida.
            </p>
          </div>
        )}
        <div>
          <label style={labelStyle} htmlFor="med-obs">
            Observaciones
          </label>
          <textarea id="med-obs" value={observaciones} maxLength={2000} disabled={!editable} onChange={(e) => setObservaciones(e.target.value)} rows={2} style={{ ...baseInput, width: "100%", resize: "vertical" }} />
        </div>
        {editable && problema && <Notice kind="warning">{problema}</Notice>}
        {error && <Notice kind="error">{error}</Notice>}
        {medicion && (
          <p style={{ fontSize: 12, color: "var(--tc-gray-500)", margin: 0 }}>
            Registró {medicion.elaboradoPor}. {medicion.actualizadoPor ? `Último cambio: ${medicion.actualizadoPor}.` : ""}
          </p>
        )}
      </div>
    </Modal>
  );
}

function AnularDialog({ medicion, onCerrar, onAnular }: { medicion: MedicionObra; onCerrar: () => void; onAnular: (motivo: string) => Promise<void> }) {
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title={`Anular ${numeroMedicion(medicion.numero)}`}
      width={520}
      onClose={() => !busy && onCerrar()}
      footer={
        <>
          <button type="button" onClick={onCerrar} disabled={busy} style={botonSecundario}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !motivo.trim()}
            style={{ ...botonPeligro, opacity: motivo.trim() ? 1 : 0.5 }}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onAnular(motivo.trim());
              } catch (err) {
                setBusy(false);
                setError(message(err));
              }
            }}
          >
            {busy ? "Anulando…" : "Anular"}
          </button>
        </>
      }
    >
      <div style={{ padding: 16, display: "grid", gap: 10, fontSize: 14 }}>
        <p style={{ margin: 0 }}>
          {medicion.partidaNumero} {medicion.partidaDescripcion} · {medicion.ubicacionTexto} · {fmt(medicion.cantidad, 4)} {medicion.partidaUnidad}
        </p>
        <p style={{ margin: 0, color: "var(--tc-gray-500)" }}>No se borra: queda anulada con el motivo, y sus elementos vuelven a quedar disponibles para medir.</p>
        <label style={labelStyle} htmlFor="med-motivo">
          Motivo
        </label>
        <textarea id="med-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={2000} style={{ ...baseInput, width: "100%" }} />
        {error && <Notice kind="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
