"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import type { ModelSpec, ViewerAPI } from "trimble-connect-workspace-api";
import { fechaHora } from "../../lib/compras/formato";
import type { RaApi } from "../../lib/ra/client";
import { comprimir, empaquetar } from "../../lib/ra/formato";
import { IFC_AVISO_BYTES, revisarTamano, tamanoLegible } from "../../lib/ra/limites";
import { ArchivoLeido, armarModelo, CLASES_EXCLUIDAS_INICIALES, Conteo, inventario, ModeloRA, triangulosCon } from "../../lib/ra/modelo";
import type { ArchivoFuente, ModeloVista } from "../../lib/ra/types";
import { leerIfc } from "./motorIfc";
import VistaPrevia from "./VistaPrevia";

export type VisorRA = Pick<ViewerAPI, "getModels">;

type Paso =
  | { tipo: "elegir" }
  | { tipo: "leyendo"; texto: string; avance: number | null }
  | { tipo: "filtrar" }
  | { tipo: "armando" }
  | { tipo: "revisar"; modelo: ModeloRA; bytes: Uint8Array }
  | { tipo: "subiendo"; modelo: ModeloRA; avance: number | null }
  | { tipo: "listo"; guardado: ModeloVista };

const AZUL = "#2f55b0";
const esIfc = (m: ModelSpec) => /\.ifc$/i.test(m.name) || /^ifc$/i.test(m.type ?? "");
const miles = (n: number) => n.toLocaleString("en-US");
const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Panel of the 3D viewer: turns the IFC models open in the viewer into the
 * light file the phone shows. Read → choose levels and classes → look →
 * save. The conversion runs in this browser; only the result is uploaded.
 */
export default function PanelPreparar({ api, viewer, subscribe }: { api: RaApi; viewer: VisorRA; subscribe: (l: (event: string, data: unknown) => void) => () => void }) {
  const [modelos, setModelos] = useState<ModelSpec[]>([]);
  const [elegidos, setElegidos] = useState<Set<string>>(new Set());
  const [nombre, setNombre] = useState("");
  const [paso, setPaso] = useState<Paso>({ tipo: "elegir" });
  const [error, setError] = useState("");
  const [leidos, setLeidos] = useState<{ archivos: ArchivoFuente[]; datos: ArchivoLeido[] } | null>(null);
  const [nivelesFuera, setNivelesFuera] = useState<Set<string>>(new Set());
  const [clasesFuera, setClasesFuera] = useState<Set<string>>(new Set());

  const refrescar = useCallback(async () => {
    const m = ((await viewer.getModels("loaded").catch(() => [])) ?? []) as ModelSpec[];
    const ifc = m.filter(esIfc);
    setModelos(ifc);
    setElegidos((antes) => (antes.size ? new Set([...antes].filter((id) => ifc.some((x) => x.id === id))) : new Set(ifc.map((x) => x.id))));
    setNombre((n) => n || ifc.map((x) => x.name.replace(/\.ifc$/i, "")).join(" + ").slice(0, 120));
  }, [viewer]);

  useEffect(() => {
    refrescar();
    return subscribe((event) => {
      if (/model/i.test(event)) refrescar();
    });
  }, [refrescar, subscribe]);

  const inv = useMemo(() => (leidos ? inventario(leidos.datos) : null), [leidos]);
  const filtros = useMemo(() => ({ nivelesExcluidos: [...nivelesFuera], clasesExcluidas: [...clasesFuera] }), [nivelesFuera, clasesFuera]);
  const triangulos = useMemo(() => (leidos ? triangulosCon(leidos.datos, filtros) : 0), [leidos, filtros]);

  async function leer() {
    setError("");
    const elegidosSpec = modelos.filter((m) => elegidos.has(m.id));
    if (!elegidosSpec.length) return setError("Marque al menos un modelo IFC.");
    const archivos: ArchivoFuente[] = elegidosSpec.map((m) => ({ fileId: m.id, versionId: m.versionId ?? "", nombre: m.name }));
    const datos: ArchivoLeido[] = [];
    try {
      for (const [i, a] of archivos.entries()) {
        const rotulo = archivos.length > 1 ? ` (${i + 1} de ${archivos.length})` : "";
        setPaso({ tipo: "leyendo", texto: `Descargando ${a.nombre}${rotulo}…`, avance: null });
        const bytes = await api.descargarIfc(a, (c, t) =>
          setPaso({ tipo: "leyendo", texto: `Descargando ${a.nombre}${rotulo}: ${tamanoLegible(c)}${t ? ` de ${tamanoLegible(t)}` : ""}`, avance: t ? c / t : null })
        );
        setPaso({
          tipo: "leyendo",
          texto: `Convirtiendo ${a.nombre}${rotulo}… ${bytes.length > IFC_AVISO_BYTES ? "Es un archivo grande: puede tardar varios minutos y la pantalla quedarse quieta." : "La pantalla puede quedarse quieta unos segundos."}`,
          avance: null,
        });
        // Let the message paint before the conversion takes the browser.
        await new Promise((r) => setTimeout(r, 50));
        datos.push(await leerIfc(bytes, i, datos[0]?.origen));
      }
    } catch (e) {
      setPaso({ tipo: "elegir" });
      return setError(`No se pudo leer el modelo: ${mensaje(e)}`);
    }
    const inicial = inventario(datos);
    setLeidos({ archivos, datos });
    setNivelesFuera(new Set());
    setClasesFuera(new Set(inicial.clases.map((c) => c.nombre).filter((c) => CLASES_EXCLUIDAS_INICIALES.includes(c))));
    setPaso({ tipo: "filtrar" });
  }

  async function armar() {
    if (!leidos) return;
    setError("");
    setPaso({ tipo: "armando" });
    await new Promise((r) => setTimeout(r, 30));
    try {
      const modelo = armarModelo(leidos.datos, filtros);
      const bytes = await comprimir(empaquetar(modelo));
      const r = revisarTamano(modelo.triangulos, bytes.length);
      if (!r.puede) {
        setPaso({ tipo: "filtrar" });
        return setError(r.aviso ?? "El modelo no se puede enviar.");
      }
      setPaso({ tipo: "revisar", modelo, bytes });
    } catch (e) {
      setPaso({ tipo: "filtrar" });
      setError(`No se pudo armar el modelo: ${mensaje(e)}`);
    }
  }

  async function guardar() {
    if (!leidos || paso.tipo !== "revisar") return;
    const { modelo, bytes } = paso;
    setError("");
    setPaso({ tipo: "subiendo", modelo, avance: 0 });
    try {
      const guardado = await api.subirModelo(
        {
          nombre: nombre.trim() || "Modelo",
          archivos: leidos.archivos,
          filtros,
          bytes: bytes.length,
          triangulos: modelo.triangulos,
          elementos: modelo.elementos.length,
          origen: modelo.origen,
        },
        bytes,
        (c, t) => setPaso({ tipo: "subiendo", modelo, avance: t ? c / t : null })
      );
      setPaso({ tipo: "listo", guardado });
    } catch (e) {
      setPaso({ tipo: "revisar", modelo, bytes });
      setError(`No se pudo guardar: ${mensaje(e)}`);
    }
  }

  function reiniciar() {
    setLeidos(null);
    setPaso({ tipo: "elegir" });
    setError("");
  }

  const ocupado = paso.tipo === "leyendo" || paso.tipo === "armando" || paso.tipo === "subiendo";
  const revision = revisarTamano(triangulos, null);

  return (
    <div style={{ padding: 12, fontSize: 13.5, color: "#1f2937", lineHeight: 1.45 }}>
      <h2 style={{ fontSize: 16, margin: "0 0 4px", color: AZUL }}>Preparar modelo para el celular</h2>
      <p style={{ margin: "0 0 10px", color: "#4b5563" }}>Convierte los modelos IFC abiertos en este visor en un archivo liviano para verlos a escala real desde el celular.</p>

      {error && <div style={{ ...caja, borderColor: "#b3261e", background: "#fdecea", color: "#7f1d1d" }}>{error}</div>}

      {(paso.tipo === "elegir" || paso.tipo === "leyendo") && (
        <section style={caja}>
          <h3 style={subtitulo}>1 · Modelos</h3>
          {modelos.length === 0 ? (
            <p style={{ margin: 0 }}>No hay modelos IFC abiertos. Abra en el visor el modelo que quiere llevar al celular (puede abrir varios, por ejemplo arquitectura y estructura).</p>
          ) : (
            <>
              {modelos.map((m) => (
                <label key={m.id} style={{ display: "flex", gap: 6, alignItems: "center", padding: "2px 0" }}>
                  <input
                    type="checkbox"
                    disabled={ocupado}
                    checked={elegidos.has(m.id)}
                    onChange={(e) => {
                      const s = new Set(elegidos);
                      if (e.target.checked) s.add(m.id);
                      else s.delete(m.id);
                      setElegidos(s);
                    }}
                  />
                  {m.name}
                </label>
              ))}
              <label style={{ display: "block", marginTop: 8 }}>
                Nombre para el celular
                <input value={nombre} disabled={ocupado} maxLength={120} onChange={(e) => setNombre(e.target.value)} style={entrada} />
              </label>
              <button style={boton} disabled={ocupado || !elegidos.size} onClick={leer}>
                Leer modelos
              </button>
            </>
          )}
          {paso.tipo === "leyendo" && <Avance texto={paso.texto} avance={paso.avance} />}
        </section>
      )}

      {leidos && inv && (paso.tipo === "filtrar" || paso.tipo === "armando") && (
        <section style={caja}>
          <h3 style={subtitulo}>2 · Qué se lleva al celular</h3>
          <p style={{ margin: "0 0 6px", color: "#4b5563" }}>Quite lo que no necesita ver en obra: así el celular va más fluido.</p>
          <Lista titulo="Niveles" items={inv.niveles} fuera={nivelesFuera} cambiar={setNivelesFuera} deshabilitado={ocupado} />
          <Lista titulo="Clases IFC" items={inv.clases} fuera={clasesFuera} cambiar={setClasesFuera} deshabilitado={ocupado} />
          <p style={{ margin: "8px 0 0" }}>
            Quedan <b>{miles(triangulos)}</b> triángulos.
          </p>
          {revision.aviso && <p style={{ margin: "4px 0 0", color: revision.puede ? "#8a5a00" : "#b3261e" }}>{revision.aviso}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button style={boton} disabled={ocupado || !revision.puede} onClick={armar}>
              {paso.tipo === "armando" ? "Armando…" : "Ver vista previa"}
            </button>
            <button style={botonSecundario} disabled={ocupado} onClick={reiniciar}>
              Volver
            </button>
          </div>
        </section>
      )}

      {(paso.tipo === "revisar" || paso.tipo === "subiendo") && (
        <section style={caja}>
          <h3 style={subtitulo}>3 · Vista previa</h3>
          <VistaPrevia modelo={paso.modelo} />
          {paso.tipo === "revisar" && (
            <>
              <p style={{ margin: "8px 0 0" }}>
                {miles(paso.modelo.elementos.length)} elementos · {miles(paso.modelo.triangulos)} triángulos · archivo de {tamanoLegible(paso.bytes.length)}.
              </p>
              {revisarTamano(paso.modelo.triangulos, paso.bytes.length).aviso && <p style={{ margin: "4px 0 0", color: "#8a5a00" }}>{revisarTamano(paso.modelo.triangulos, paso.bytes.length).aviso}</p>}
              <div style={{ display: "flex", gap: 8 }}>
                <button style={boton} onClick={guardar}>
                  Guardar para el celular
                </button>
                <button style={botonSecundario} onClick={() => setPaso({ tipo: "filtrar" })}>
                  Cambiar lo elegido
                </button>
              </div>
            </>
          )}
          {paso.tipo === "subiendo" && <Avance texto="Enviando el archivo al almacenamiento…" avance={paso.avance} />}
        </section>
      )}

      {paso.tipo === "listo" && (
        <section style={{ ...caja, borderColor: "#2e6b22", background: "#e7f4e4" }}>
          <b>Modelo «{paso.guardado.nombre}» guardado.</b>
          <p style={{ margin: "4px 0 0" }}>
            {miles(paso.guardado.elementos)} elementos, {tamanoLegible(paso.guardado.bytes)}.{" "}
            {paso.guardado.eliminaEn && <>Si nadie lo usa, se elimina solo el {fechaHora(paso.guardado.eliminaEn).slice(0, 10)}.</>} En la siguiente fase se elige aquí mismo el punto del QR.
          </p>
          <button style={boton} onClick={reiniciar}>
            Preparar otro
          </button>
        </section>
      )}
    </div>
  );
}

function Lista({ titulo, items, fuera, cambiar, deshabilitado }: { titulo: string; items: Conteo[]; fuera: Set<string>; cambiar: (s: Set<string>) => void; deshabilitado: boolean }) {
  const todos = items.every((i) => !fuera.has(i.nombre));
  return (
    <fieldset style={{ border: "1px solid #dfe4ea", borderRadius: 6, margin: "6px 0", padding: "4px 8px", maxHeight: 180, overflowY: "auto" }}>
      <legend style={{ fontWeight: 600 }}>
        {titulo}{" "}
        <button
          style={{ border: "none", background: "none", color: AZUL, cursor: "pointer", fontSize: 12.5, padding: 0 }}
          disabled={deshabilitado}
          onClick={() => cambiar(todos ? new Set(items.map((i) => i.nombre)) : new Set())}
        >
          ({todos ? "quitar todos" : "marcar todos"})
        </button>
      </legend>
      {items.map((i) => (
        <label key={i.nombre} style={{ display: "flex", gap: 6, alignItems: "center" }} title={`${miles(i.triangulos)} triángulos`}>
          <input
            type="checkbox"
            disabled={deshabilitado}
            checked={!fuera.has(i.nombre)}
            onChange={(e) => {
              const s = new Set(fuera);
              if (e.target.checked) s.delete(i.nombre);
              else s.add(i.nombre);
              cambiar(s);
            }}
          />
          <span style={{ flex: 1 }}>{i.nombre}</span>
          <span style={{ color: "#6b7280" }}>{miles(i.elementos)}</span>
        </label>
      ))}
    </fieldset>
  );
}

function Avance({ texto, avance }: { texto: string; avance: number | null }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ marginBottom: 4 }}>{texto}</div>
      <div style={{ height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", width: avance === null ? "35%" : `${Math.round(avance * 100)}%`, background: AZUL, transition: "width .2s" }} />
      </div>
    </div>
  );
}

const caja: CSSProperties = { border: "1px solid #dfe4ea", borderRadius: 8, padding: 10, marginBottom: 10, background: "#fff" };
const subtitulo: CSSProperties = { fontSize: 14, margin: "0 0 6px" };
const entrada: CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", marginTop: 2, padding: "5px 8px", border: "1px solid #cbd2da", borderRadius: 4, fontSize: 13.5 };
const boton: CSSProperties = { marginTop: 10, padding: "7px 14px", background: AZUL, color: "#fff", border: "none", borderRadius: 5, fontWeight: 600, cursor: "pointer" };
const botonSecundario: CSSProperties = { ...boton, background: "#fff", color: AZUL, border: `1px solid ${AZUL}` };
