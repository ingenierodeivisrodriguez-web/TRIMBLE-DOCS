"use client";

import { CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { ModelSpec, ViewerAPI } from "trimble-connect-workspace-api";
import { Alineacion, alinear, cajaElemento, concuerdan, coordenadasIfc, DISTANCIA_MIN_FLECHA, leerToque, nombreElemento, puntoEnModelo, rumbo } from "../../lib/ra/anclaje";
import type { RaApi } from "../../lib/ra/client";
import { DIAS_QR_INICIAL, DIAS_QR_MAX, fechaMasDias } from "../../lib/ra/codigo";
import { hojaPdf, nombreHoja } from "../../lib/ra/hoja";
import type { ModeloRA, Vec3 } from "../../lib/ra/modelo";
import { distanciaEnPlanta, metros } from "../../lib/ra/volumen";
import type { ModeloVista, PuntoVista } from "../../lib/ra/types";
import { descargar } from "../../lib/presupuesto/excel";
import { fechaHora } from "../../lib/compras/formato";

export type VisorPunto = Pick<ViewerAPI, "getModels" | "activateTool" | "convertToObjectIds" | "getObjectBoundingBoxes">;

type Tomado = { punto: Vec3; alineacion: Alineacion; elemento: string };
type Paso = "elegir" | "punto" | "flecha" | "datos" | "creado";

const AZUL = "#2f55b0";
const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));
const dia = (ts: string) => fechaHora(ts).slice(0, 10);

/**
 * Panel of the 3D viewer, second tab: where the QR goes. Two clicks in the
 * viewer (the point on the floor and where its arrow points), a name and an
 * expiry date; then the QR and its printable sheet.
 */
export default function PanelPunto({ api, viewer, subscribe, projectName }: { api: RaApi; viewer: VisorPunto; subscribe: (l: (event: string, data: unknown) => void) => () => void; projectName: string }) {
  const [modelos, setModelos] = useState<ModeloVista[]>([]);
  const [modeloId, setModeloId] = useState("");
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  const [modelo, setModelo] = useState<{ id: string; datos: ModeloRA } | null>(null);
  const [paso, setPaso] = useState<Paso>("elegir");
  const [punto, setPunto] = useState<Tomado | null>(null);
  const [flecha, setFlecha] = useState<Tomado | null>(null);
  const [nombre, setNombre] = useState("");
  const [referencia, setReferencia] = useState("");
  const [vence, setVence] = useState(() => fechaMasDias(new Date(), DIAS_QR_INICIAL));
  const [creado, setCreado] = useState<PuntoVista | null>(null);
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState("");
  const pasoRef = useRef(paso);
  pasoRef.current = paso;

  const cargar = useCallback(async () => {
    try {
      const [e, cargados] = await Promise.all([api.getEstado(), viewer.getModels("loaded").catch(() => [] as ModelSpec[])]);
      const listos = e.modelos.filter((m) => m.estado === "listo");
      setModelos(listos);
      setAbiertos(new Set((cargados ?? []).map((m) => m.id)));
      setModeloId((id) => id || listos[0]?.id || "");
    } catch (err) {
      setError(mensaje(err));
    }
  }, [api, viewer]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const elegido = modelos.find((m) => m.id === modeloId);
  const faltanAbiertos = elegido ? elegido.archivos.filter((a) => !abiertos.has(a.fileId)) : [];

  async function asegurarModelo(): Promise<ModeloRA> {
    if (modelo?.id === modeloId) return modelo.datos;
    setOcupado("Leyendo el modelo preparado…");
    try {
      const datos = await api.leerModelo(modeloId);
      setModelo({ id: modeloId, datos });
      return datos;
    } finally {
      setOcupado("");
    }
  }

  async function empezar() {
    setError("");
    try {
      await asegurarModelo();
      setPunto(null);
      setFlecha(null);
      setPaso("punto");
      await viewer.activateTool("picking", { instruction: { title: "Punto del QR", text: "Haga clic sobre el piso, en el punto exacto donde irá la cruz de la hoja." } });
    } catch (err) {
      setError(`No se pudo empezar: ${mensaje(err)}`);
      setPaso("elegir");
    }
  }

  // Each click in the viewer while choosing the point or the arrow.
  useEffect(() => {
    return subscribe(async (event, data) => {
      if (event !== "viewer.onPicked") return;
      const actual = pasoRef.current;
      if (actual !== "punto" && actual !== "flecha") return;
      const toque = leerToque(data);
      if (!toque) return setError("Haga clic sobre un elemento del modelo (no en el vacío).");
      setError("");
      try {
        const m = modelo?.datos ?? (await asegurarModelo());
        const [guid] = (await viewer.convertToObjectIds(toque.modelId, [toque.runtimeId])) ?? [];
        const [caja] = (await viewer.getObjectBoundingBoxes(toque.modelId, [toque.runtimeId])) ?? [];
        if (!guid || !caja) return setError("El visor no entregó el IFCGUID o el tamaño del elemento tocado. Toque otro elemento.");
        const cajaM = cajaElemento(m, guid);
        if (!cajaM) return setError("Ese elemento no está en el modelo preparado (quizá se quitó con los filtros). Toque otro, por ejemplo una losa.");
        const b = caja.boundingBox;
        const r = alinear({ min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] }, cajaM);
        if (!r.ok) return setError(r.motivo);
        const tomado: Tomado = { punto: puntoEnModelo(toque.posicion, r.alineacion), alineacion: r.alineacion, elemento: nombreElemento(m, guid) };
        if (actual === "punto") {
          setPunto(tomado);
          setPaso("flecha");
          await viewer.activateTool("picking", { instruction: { title: "Dirección de la flecha", text: "Haga clic en un punto hacia donde apuntará la flecha de la hoja (a más de medio metro)." } });
          return;
        }
        if (!punto) return;
        if (!concuerdan(punto.alineacion, r.alineacion)) return setError("Los dos clics no cuadran entre sí (el visor tiene un modelo movido respecto al otro). Toque un elemento del mismo modelo que el punto.");
        const d = distanciaEnPlanta({ x: punto.punto[0], z: punto.punto[2] }, { x: tomado.punto[0], z: tomado.punto[2] });
        if (d < DISTANCIA_MIN_FLECHA) return setError(`Ese clic está a ${metros(d)} del punto; elija uno a más de ${metros(DISTANCIA_MIN_FLECHA)} para que la dirección sea confiable.`);
        setFlecha(tomado);
        setReferencia((x) => x || (tomado.elemento ? `hacia ${tomado.elemento}` : ""));
        setNombre((x) => x || (punto.elemento ? `Punto en ${punto.elemento}` : "Punto QR"));
        setPaso("datos");
        await viewer.activateTool("reset");
      } catch (err) {
        setError(`No se pudo tomar el punto: ${mensaje(err)}`);
      }
    });
  });

  async function cancelar() {
    setPaso("elegir");
    setError("");
    await viewer.activateTool("reset").catch(() => {});
  }

  async function crear() {
    if (!punto || !flecha) return;
    setError("");
    setOcupado("Creando el QR…");
    try {
      const p = await api.crearPunto({ modeloId, nombre: nombre.trim(), referencia: referencia.trim(), punto: punto.punto, rumbo: rumbo(punto.punto, flecha.punto), elemento: punto.elemento, vence });
      const QR = await import("qrcode");
      setQr(await QR.toDataURL(p.url, { errorCorrectionLevel: "M", margin: 2, scale: 6 }));
      setCreado(p);
      setPaso("creado");
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setOcupado("");
    }
  }

  async function bajarHoja() {
    if (!creado || !elegido || !punto) return;
    const blob = await hojaPdf({
      nombre: creado.nombre,
      referencia: creado.referencia,
      url: creado.url,
      codigo: creado.codigo,
      vence: dia(creado.vence),
      proyecto: projectName,
      modelo: elegido.nombre,
      elemento: creado.elemento,
      coordenadas: coordenadasIfc(creado.punto, elegido.origen),
    });
    descargar(blob, nombreHoja(creado));
  }

  function otro() {
    setCreado(null);
    setPunto(null);
    setFlecha(null);
    setNombre("");
    setReferencia("");
    setPaso("elegir");
  }

  const coords = (p: Vec3) => (elegido ? coordenadasIfc(p, elegido.origen).map((x) => x.toFixed(2)).join(", ") : "");

  return (
    <div style={{ padding: 12, fontSize: 13.5, color: "#1f2937", lineHeight: 1.45 }}>
      <h2 style={{ fontSize: 16, margin: "0 0 4px", color: AZUL }}>Punto del QR</h2>
      <p style={{ margin: "0 0 10px", color: "#4b5563" }}>Elija en el visor dónde irá la hoja con el QR en la obra y hacia dónde apunta su flecha.</p>

      {error && <div style={{ ...caja, borderColor: "#b3261e", background: "#fdecea", color: "#7f1d1d" }}>{error}</div>}
      {ocupado && <div style={{ ...caja, background: "#f3f4f6" }}>{ocupado}</div>}

      {paso !== "creado" && (
        <section style={caja}>
          <h3 style={subtitulo}>1 · Modelo preparado</h3>
          {modelos.length === 0 ? (
            <p style={{ margin: 0 }}>No hay modelos preparados. Prepare uno en la pestaña «Preparar».</p>
          ) : (
            <>
              <select value={modeloId} disabled={paso !== "elegir"} onChange={(e) => setModeloId(e.target.value)} style={entrada}>
                {modelos.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre} ({dia(m.creado)})
                  </option>
                ))}
              </select>
              {faltanAbiertos.length > 0 && (
                <p style={{ margin: "6px 0 0", color: "#8a5a00" }}>Abra en el visor {faltanAbiertos.map((a) => a.nombre).join(", ")}: el punto se toma sobre esos modelos.</p>
              )}
              {paso === "elegir" && (
                <button style={boton} disabled={!modeloId || !!ocupado || faltanAbiertos.length > 0} onClick={empezar}>
                  Elegir el punto en el visor
                </button>
              )}
            </>
          )}
        </section>
      )}

      {(paso === "punto" || paso === "flecha" || paso === "datos") && (
        <section style={caja}>
          <h3 style={subtitulo}>2 · Punto y flecha</h3>
          <Linea hecho={!!punto} activo={paso === "punto"} texto={punto ? `Punto: sobre ${punto.elemento || "el elemento"} (X, Y, Z = ${coords(punto.punto)} m)` : "Haga clic en el visor sobre el piso, donde irá la cruz de la hoja."} />
          <Linea
            hecho={!!flecha}
            activo={paso === "flecha"}
            texto={flecha && punto ? `Flecha: hacia ${flecha.elemento || "el punto elegido"}, a ${metros(distanciaEnPlanta({ x: punto.punto[0], z: punto.punto[2] }, { x: flecha.punto[0], z: flecha.punto[2] }))}` : "Luego haga clic hacia donde apuntará la flecha."}
          />
          {paso !== "datos" && (
            <button style={botonSecundario} onClick={cancelar}>
              Cancelar
            </button>
          )}
        </section>
      )}

      {paso === "datos" && (
        <section style={caja}>
          <h3 style={subtitulo}>3 · Datos del QR</h3>
          <label style={etiqueta}>
            Nombre del punto
            <input value={nombre} maxLength={120} onChange={(e) => setNombre(e.target.value)} style={entrada} />
          </label>
          <label style={etiqueta}>
            La flecha debe apuntar…
            <input value={referencia} maxLength={200} placeholder="hacia el eje B, paralela a la fachada" onChange={(e) => setReferencia(e.target.value)} style={entrada} />
            <span style={{ color: "#6b7280", fontSize: 12.5 }}>Va impreso en la hoja para quien la pega en obra.</span>
          </label>
          <label style={etiqueta}>
            Abre hasta el día (incluido)
            <input type="date" value={vence} min={fechaMasDias(new Date(), 0)} max={fechaMasDias(new Date(), DIAS_QR_MAX)} onChange={(e) => setVence(e.target.value)} style={entrada} />
            <span style={{ color: "#6b7280", fontSize: 12.5 }}>
              {vence ? `${vence.split("-").reverse().join("-")}. ` : ""}Cualquiera con el QR ve el modelo hasta esa fecha (sin iniciar sesión).
            </span>
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={boton} disabled={!!ocupado || !nombre.trim() || !referencia.trim() || !vence} onClick={crear}>
              Crear QR
            </button>
            <button style={botonSecundario} onClick={empezar}>
              Volver a elegir
            </button>
          </div>
        </section>
      )}

      {paso === "creado" && creado && (
        <section style={{ ...caja, borderColor: "#2e6b22" }}>
          <b>QR «{creado.nombre}» creado.</b>
          {qr && <img src={qr} alt="Código QR" style={{ display: "block", width: 180, height: 180, margin: "8px auto" }} />}
          <p style={{ margin: "0 0 4px" }}>Abre hasta el {dia(creado.vence)}. La flecha debe apuntar {creado.referencia}.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={boton} onClick={bajarHoja}>
              Descargar hoja para imprimir (PDF)
            </button>
            <button style={botonSecundario} onClick={otro}>
              Crear otro
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Linea({ hecho, activo, texto }: { hecho: boolean; activo: boolean; texto: string }) {
  return (
    <div style={{ display: "flex", gap: 6, padding: "3px 0", fontWeight: activo ? 600 : 400 }}>
      <span style={{ width: 16, color: hecho ? "#2e6b22" : activo ? AZUL : "#9ca3af" }}>{hecho ? "✔" : activo ? "▶" : "•"}</span>
      <span>{texto}</span>
    </div>
  );
}

const caja: CSSProperties = { border: "1px solid #dfe4ea", borderRadius: 8, padding: 10, marginBottom: 10, background: "#fff" };
const subtitulo: CSSProperties = { fontSize: 14, margin: "0 0 6px" };
const etiqueta: CSSProperties = { display: "block", marginBottom: 8 };
const entrada: CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", marginTop: 2, padding: "5px 8px", border: "1px solid #cbd2da", borderRadius: 4, fontSize: 13.5 };
const boton: CSSProperties = { marginTop: 8, padding: "7px 14px", background: AZUL, color: "#fff", border: "none", borderRadius: 5, fontWeight: 600, cursor: "pointer" };
const botonSecundario: CSSProperties = { ...boton, background: "#fff", color: AZUL, border: `1px solid ${AZUL}` };
