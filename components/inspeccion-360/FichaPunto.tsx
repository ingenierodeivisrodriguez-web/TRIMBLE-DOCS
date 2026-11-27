"use client";

// The selected capture point: its data (code, tower, floor, unit, space, zone, coordinates…),
// its photos by date (newest first), the 360° viewer of the chosen date and the before/after
// comparison of two dates.

import { useEffect, useMemo, useRef, useState } from "react";
import type { I360Api } from "../../lib/inspeccion-360/client";
import { capturasComparables, type Pareja, parejaInicial, puedeSer } from "../../lib/inspeccion-360/comparar";
import { fmtFecha, fmtFechaHora } from "../../lib/inspeccion-360/fechas";
import type { CapturaVista, PuntoVista } from "../../lib/inspeccion-360/types";
import { acceptButton, baseInput, C, labelStyle, linkButton, message, Notice } from "../presupuesto/ui";
import Comparador360, { type VistaCamara } from "./Comparador360";
import { megas, urlParaVisor } from "./imagen";
import SubirFoto from "./SubirFoto";
import Visor360 from "./Visor360";

/** A downloaded photo, ready for the viewer (kept for a while so switching dates does not download again). */
interface FotoLista {
  capturaId: string;
  url: string;
  blob: Blob;
  ancho: number | null;
  /** DD-MM-AAAA HH:MM */
  fecha: string;
  titulo: string;
}

/** Downloaded photos kept in memory at most (each can weigh up to 60 MB). */
const MAX_EN_MEMORIA = 3;
const COLOR_ANTES = "#455a64";
const COLOR_DESPUES = "#EF6C00";

const boton: React.CSSProperties = { ...linkButton, border: "1px solid var(--tc-gray-300)", fontSize: 12, padding: "4px 8px" };
const fila: React.CSSProperties = { display: "flex", gap: 6, fontSize: 12, padding: "2px 0", borderBottom: "1px solid var(--tc-gray-100)" };

export default function FichaPunto({
  api,
  punto,
  puedeEditar,
  modeloCargado,
  alVolver,
  alIrAlPunto,
  alCambiar,
}: {
  api: I360Api;
  punto: PuntoVista;
  puedeEditar: boolean;
  modeloCargado: boolean;
  alVolver: () => void;
  alIrAlPunto: () => void;
  /** The point or its photos changed: reload the list of points. */
  alCambiar: () => void;
}) {
  const [capturas, setCapturas] = useState<CapturaVista[] | null>(null);
  const [error, setError] = useState("");
  const [subiendo, setSubiendo] = useState(false);
  const [editando, setEditando] = useState(false);
  const [vista, setVista] = useState<FotoLista | null>(null);
  const [cargando, setCargando] = useState<{ id: string; texto: string } | null>(null);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [pareja, setPareja] = useState<Pareja | null>(null);
  const [comparadas, setComparadas] = useState<{ antes: FotoLista; despues: FotoLista } | null>(null);
  const [progreso, setProgreso] = useState("");
  const enMemoria = useRef(new Map<string, FotoLista>());
  const activas = useRef<string[]>([]);
  activas.current = [vista?.capturaId, comparadas?.antes.capturaId, comparadas?.despues.capturaId, pareja?.antesId, pareja?.despuesId].filter((x): x is string => !!x);
  const division = useRef(50);
  const camara = useRef<VistaCamara | undefined>(undefined);
  // The turn each photo shows right now (saved or not yet), to open full screen as it is.
  const girosVistos = useRef<Record<string, number>>({});

  const comparables = useMemo(() => capturasComparables(capturas ?? []), [capturas]);
  const capturaDe = (id: string) => capturas?.find((c) => c.id === id);
  const giroGuardado = (id: string) => capturaDe(id)?.giroGrados ?? 0;
  const paraComparar = (f: FotoLista) => {
    const c = capturaDe(f.capturaId);
    return { id: f.capturaId, url: f.url, fecha: f.fecha, giro: c?.giroGrados ?? 0, giroPor: c?.giroPor ?? null, giroEn: c?.giroEn ?? null };
  };

  async function recargar() {
    try {
      setCapturas(await api.capturas(punto.id));
    } catch (err) {
      setError(message(err));
    }
  }

  function soltarMemoria() {
    for (const f of enMemoria.current.values()) URL.revokeObjectURL(f.url);
    enMemoria.current.clear();
  }

  useEffect(() => {
    setCapturas(null);
    setVista(null);
    setPareja(null);
    setComparadas(null);
    setError("");
    soltarMemoria();
    recargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [punto.id]);

  useEffect(() => soltarMemoria, []);

  /** The photo of a capture, from memory or downloaded from the CDE (through the server). */
  async function obtener(c: CapturaVista, avisar: (texto: string) => void): Promise<FotoLista> {
    const guardada = enMemoria.current.get(c.id);
    if (guardada) {
      enMemoria.current.delete(c.id);
      enMemoria.current.set(c.id, guardada);
      return guardada;
    }
    if (!c.foto || c.foto.estado !== "en_cde") throw new Error("La foto todavía no está en Trimble Connect.");
    avisar("Descargando…");
    const blob = await api.foto(c.foto.id, (n, t) => avisar(t ? `Descargando ${Math.round((100 * n) / t)} % de ${megas(t)}…` : `Descargando ${megas(n)}…`));
    avisar("Preparando la foto…");
    const url = await urlParaVisor(blob, c.foto.ancho);
    const fecha = fmtFechaHora(c.tomadaEn);
    const foto: FotoLista = { capturaId: c.id, url, blob, ancho: c.foto.ancho, fecha, titulo: `${punto.codigo} · ${fecha}` };
    enMemoria.current.set(c.id, foto);
    // Drop the oldest photos nobody is looking at.
    for (const [id, f] of enMemoria.current) {
      if (enMemoria.current.size <= MAX_EN_MEMORIA) break;
      if (id === c.id || activas.current.includes(id)) continue;
      URL.revokeObjectURL(f.url);
      enMemoria.current.delete(id);
    }
    return foto;
  }

  async function ver(c: CapturaVista) {
    if (!c.foto || c.foto.estado !== "en_cde" || cargando) return;
    setError("");
    setPareja(null);
    setComparadas(null);
    setCargando({ id: c.id, texto: "Descargando…" });
    try {
      const foto = await obtener(c, (texto) => setCargando({ id: c.id, texto }));
      setVista(foto);
    } catch (err) {
      setError(message(err));
    } finally {
      setCargando(null);
    }
  }

  // The two photos of the comparison, each time the pair changes.
  useEffect(() => {
    if (!pareja || !capturas) return;
    const a = capturas.find((c) => c.id === pareja.antesId);
    const d = capturas.find((c) => c.id === pareja.despuesId);
    if (!a || !d) return;
    let cancelado = false;
    setError("");
    (async () => {
      try {
        const antes = await obtener(a, (t) => !cancelado && setProgreso(`Foto «antes»: ${t}`));
        const despues = await obtener(d, (t) => !cancelado && setProgreso(`Foto «después»: ${t}`));
        if (!cancelado) setComparadas({ antes, despues });
      } catch (err) {
        if (!cancelado) setError(message(err));
      } finally {
        if (!cancelado) setProgreso("");
      }
    })();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pareja?.antesId, pareja?.despuesId]);

  function comparar() {
    const p = capturas ? parejaInicial(capturas) : null;
    if (!p) return;
    setVista(null);
    division.current = 50;
    camara.current = undefined;
    setPareja(p);
  }

  function cerrarComparacion() {
    setPareja(null);
    setComparadas(null);
    setProgreso("");
  }

  /** Opens a tab of its own and hands it the photos already downloaded (the tab has no Trimble session). */
  function abrirPantalla(datos: Record<string, unknown>) {
    const ventana = window.open("/inspeccion-360/pantalla", "_blank");
    if (!ventana) return setError("El navegador bloqueó la ventana nueva: permita ventanas emergentes para trimble-docs.vercel.app.");
    const alMensaje = (ev: MessageEvent) => {
      if (ev.source !== ventana || ev.origin !== window.location.origin || (ev.data as { tipo?: string })?.tipo !== "i360-listo") return;
      ventana.postMessage(datos, window.location.origin);
      window.removeEventListener("message", alMensaje);
    };
    window.addEventListener("message", alMensaje);
    setTimeout(() => window.removeEventListener("message", alMensaje), 60_000);
  }

  function pantallaCompleta() {
    if (vista) abrirPantalla({ tipo: "i360-foto", blob: vista.blob, ancho: vista.ancho, titulo: vista.titulo, giro: giroGuardado(vista.capturaId) });
  }

  function pantallaCompletaComparar() {
    if (!comparadas) return;
    const lado = (f: FotoLista) => ({ id: f.capturaId, blob: f.blob, ancho: f.ancho, fecha: f.fecha, giro: girosVistos.current[f.capturaId] ?? giroGuardado(f.capturaId) });
    abrirPantalla({
      tipo: "i360-comparar",
      titulo: `${punto.codigo} · ${comparadas.antes.fecha} → ${comparadas.despues.fecha}`,
      antes: lado(comparadas.antes),
      despues: lado(comparadas.despues),
      division: division.current,
      vista: camara.current,
    });
  }

  /** Saves a photo's turn for everyone and reloads the dates (also after a refusal, to show the saved turn). */
  async function guardarGiro(capturaId: string, giro: number, anterior: number) {
    try {
      await api.alinear(capturaId, giro, anterior);
    } finally {
      await recargar();
    }
  }

  async function reintentar(c: CapturaVista) {
    if (!c.foto) return;
    setCargando({ id: c.id, texto: "Reintentando el paso a Trimble Connect…" });
    try {
      await api.confirmar(c.foto.id);
      await recargar();
      alCambiar();
    } catch (err) {
      setError(message(err));
    } finally {
      setCargando(null);
    }
  }

  async function anular(c: CapturaVista) {
    try {
      await api.anular(c.id, motivo);
      setAnulando(null);
      setMotivo("");
      if (pareja && (pareja.antesId === c.id || pareja.despuesId === c.id)) cerrarComparacion();
      await recargar();
      alCambiar();
    } catch (err) {
      setError(message(err));
    }
  }

  const dato = (etiqueta: string, valor: string) => (
    <div style={fila}>
      <span style={{ color: "var(--tc-gray-500)", minWidth: 92 }}>{etiqueta}</span>
      <span style={{ wordBreak: "break-word" }}>{valor || "—"}</span>
    </div>
  );

  const elegir = (lado: "antes" | "despues") => (
    <label style={{ flex: "1 1 140px", fontSize: 12 }}>
      <span style={{ display: "block", fontWeight: 600, color: lado === "antes" ? COLOR_ANTES : COLOR_DESPUES, marginBottom: 2 }}>{lado === "antes" ? "Antes" : "Después"}</span>
      <select
        value={pareja ? (lado === "antes" ? pareja.antesId : pareja.despuesId) : ""}
        onChange={(e) => pareja && setPareja(lado === "antes" ? { ...pareja, antesId: e.target.value } : { ...pareja, despuesId: e.target.value })}
        style={{ ...baseInput, width: "100%", fontSize: 12 }}
      >
        {comparables.map((c) => {
          const actual = pareja && (lado === "antes" ? pareja.antesId : pareja.despuesId) === c.id;
          return (
            <option key={c.id} value={c.id} disabled={!actual && !!pareja && !puedeSer(lado, c, pareja, comparables)}>
              {fmtFechaHora(c.tomadaEn)}
            </option>
          );
        })}
      </select>
    </label>
  );

  return (
    <div>
      <button style={{ ...linkButton, padding: "4px 0", fontSize: 12 }} onClick={alVolver}>← Todos los puntos</button>
      <h2 style={{ fontSize: 15, margin: "2px 0 6px", color: C.header }}>{punto.codigo}</h2>
      {punto.estado === "inactivo" && <Notice kind="warning" style={{ marginBottom: 6 }}>Punto inactivo: {punto.motivo}</Notice>}
      {!modeloCargado && <Notice kind="info" style={{ marginBottom: 6 }}>El modelo de este punto no está cargado en el visor: cárguelo para ver el ícono.</Notice>}

      {!editando ? (
        <div>
          {dato("Torre / piso", `${punto.torre} · ${punto.piso}`)}
          {dato("Unidad", punto.unidad)}
          {dato("Espacio", punto.espacio)}
          {dato("Zona", punto.zona)}
          {dato("Referencia", punto.referenciaFisica)}
          {dato("Coordenadas", `x ${punto.x.toFixed(3)} · y ${punto.y.toFixed(3)} · z ${punto.z.toFixed(3)} m`)}
          {dato("Altura trípode", `${punto.alturaM.toFixed(2)} m`)}
          {dato("Rumbo", punto.rumboGrados === null ? "sin calibrar" : `${punto.rumboGrados.toFixed(1)}°`)}
          {dato("Creado", `${fmtFecha(punto.creado)} por ${punto.creadoPorNombre || punto.creadoPor}`)}
        </div>
      ) : (
        <EditarPunto api={api} punto={punto} alGuardar={() => { setEditando(false); alCambiar(); }} alCancelar={() => setEditando(false)} />
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        <button style={boton} onClick={alIrAlPunto} title="Pone la cámara del visor en el punto, a la altura del trípode">Ir al punto</button>
        {puedeEditar && punto.estado === "activo" && !subiendo && <button style={{ ...boton, borderColor: C.accept, color: C.accept }} onClick={() => setSubiendo(true)}>Subir foto 360</button>}
        {puedeEditar && !editando && <button style={boton} onClick={() => setEditando(true)}>Editar</button>}
      </div>

      {subiendo && (
        <SubirFoto
          api={api}
          punto={punto}
          alCancelar={() => setSubiendo(false)}
          alTerminar={async () => {
            setSubiendo(false);
            await recargar();
            alCambiar();
          }}
        />
      )}

      {vista && !pareja && (
        <div style={{ marginTop: 10 }}>
          <Visor360 url={vista.url} titulo={vista.titulo} giro={giroGuardado(vista.capturaId)} />
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button style={boton} onClick={pantallaCompleta}>Pantalla completa ↗</button>
            <button style={boton} onClick={() => setVista(null)}>Cerrar foto</button>
          </div>
        </div>
      )}

      {pareja && (
        <div style={{ marginTop: 10, border: "1px solid var(--tc-gray-200)", borderRadius: 6, padding: 6, background: "#fbfcfe" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            {elegir("antes")}
            {elegir("despues")}
          </div>
          {comparadas ? (
            <Comparador360
              antes={paraComparar(comparadas.antes)}
              despues={paraComparar(comparadas.despues)}
              puedeAlinear={puedeEditar}
              alGuardarGiro={guardarGiro}
              alCambiarGiro={(id, g) => (girosVistos.current[id] = g)}
              division={division.current}
              alCambiarDivision={(v) => (division.current = v)}
              alMoverCamara={(v) => (camara.current = v)}
            />
          ) : (
            <div style={{ height: 300, background: "#111", color: "#fff", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, padding: 12, textAlign: "center" }}>
              {progreso || "Preparando la comparación…"}
            </div>
          )}
          {comparadas && progreso && <p style={{ fontSize: 11.5, margin: "4px 0 0" }}>{progreso}</p>}
          <p style={{ fontSize: 11.5, margin: "6px 0 0", color: "var(--tc-gray-600)" }}>
            Arrastre la barra blanca hacia los lados para ver antes y después. Al mover una foto, la otra gira con ella.
            {puedeEditar
              ? " Si no miran hacia el mismo lado, gire una con «Alinear» y pulse «Guardar alineación»: todas las personas del proyecto las verán alineadas."
              : " Las fotos se ven con la alineación que guardó un editor."}
          </p>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <button style={boton} onClick={pantallaCompletaComparar} disabled={!comparadas}>Pantalla completa ↗</button>
            <button style={boton} onClick={cerrarComparacion}>Cerrar comparación</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "12px 0 4px" }}>
        <h3 style={{ fontSize: 13, margin: 0, flex: 1 }}>Fotos por fecha</h3>
        {comparables.length >= 2 && !pareja && (
          <button style={{ ...boton, borderColor: COLOR_DESPUES, color: COLOR_DESPUES }} onClick={comparar} title="Comparar dos fechas con una barra que se mueve hacia los lados">
            Comparar fechas ⇆
          </button>
        )}
      </div>
      {error && <Notice kind="error" style={{ marginBottom: 6 }}>{error}</Notice>}
      {capturas === null && <p style={{ fontSize: 12 }}>Cargando…</p>}
      {capturas?.length === 0 && <p style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>Este punto todavía no tiene fotos.</p>}
      {capturas?.map((c) => {
        const lado = pareja?.antesId === c.id ? "antes" : pareja?.despuesId === c.id ? "despues" : null;
        const elegida = !pareja && vista?.capturaId === c.id;
        const borde = lado === "antes" ? COLOR_ANTES : lado === "despues" ? COLOR_DESPUES : elegida ? "#EF6C00" : "var(--tc-gray-200)";
        const lista = c.foto?.estado === "en_cde" && c.estado !== "subiendo";
        return (
          <div key={c.id} style={{ border: `${lado ? 2 : 1}px solid ${borde}`, borderRadius: 6, padding: 6, marginBottom: 6, background: c.estado === "anulada" ? "#f5f5f5" : "#fff" }}>
            <button onClick={() => ver(c)} disabled={!lista} title={lista ? "Ver la foto 360" : undefined} style={{ display: "flex", gap: 8, width: "100%", border: "none", background: "transparent", padding: 0, cursor: lista ? "pointer" : "default", textAlign: "left", fontFamily: "inherit" }}>
              {c.foto?.miniatura ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.foto.miniatura} alt="" style={{ width: 96, height: 48, objectFit: "cover", borderRadius: 3, opacity: c.estado === "anulada" ? 0.5 : 1 }} />
              ) : (
                <div style={{ width: 96, height: 48, background: "var(--tc-gray-100)", borderRadius: 3 }} />
              )}
              <div style={{ fontSize: 12, minWidth: 0 }}>
                <b style={{ fontSize: 13 }}>{fmtFechaHora(c.tomadaEn)}</b>
                {lado && (
                  <span style={{ marginLeft: 6, background: lado === "antes" ? COLOR_ANTES : COLOR_DESPUES, color: "#fff", fontSize: 10.5, fontWeight: 600, padding: "1px 6px", borderRadius: 3 }}>
                    {lado === "antes" ? "Antes" : "Después"}
                  </span>
                )}
                <div style={{ color: "var(--tc-gray-500)" }}>{c.inspectorNombre}</div>
                {c.estado === "subiendo" && <div style={{ color: "#8a6d00" }}>Subiendo…</div>}
                {c.estado === "error" && <div style={{ color: "#b3261e" }}>No pasó a Trimble Connect{c.foto?.error ? `: ${c.foto.error}` : ""}</div>}
                {c.estado === "anulada" && <div style={{ color: "#b3261e" }}>Anulada: {c.motivo}</div>}
              </div>
            </button>
            {c.observaciones && <p style={{ fontSize: 11.5, margin: "4px 0 0", color: "var(--tc-gray-600)" }}>{c.observaciones}</p>}
            {cargando?.id === c.id && <p style={{ fontSize: 11.5, margin: "4px 0 0" }}>{cargando.texto}</p>}
            {c.puedeAnular && (
              <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                {c.estado === "error" && <button style={boton} onClick={() => reintentar(c)}>Reintentar</button>}
                {anulando === c.id ? (
                  <>
                    <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo para anular" style={{ ...baseInput, flex: "1 1 140px", fontSize: 12 }} />
                    <button style={boton} onClick={() => anular(c)} disabled={!motivo.trim()}>Anular</button>
                    <button style={boton} onClick={() => setAnulando(null)}>No</button>
                  </>
                ) : (
                  <button style={{ ...boton, color: "#b3261e" }} onClick={() => { setAnulando(c.id); setMotivo(""); }}>Anular…</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EditarPunto({ api, punto, alGuardar, alCancelar }: { api: I360Api; punto: PuntoVista; alGuardar: () => void; alCancelar: () => void }) {
  const [espacio, setEspacio] = useState(punto.espacio);
  const [zona, setZona] = useState(punto.zona);
  const [referencia, setReferencia] = useState(punto.referenciaFisica);
  const [altura, setAltura] = useState(punto.alturaM.toFixed(2));
  const [rumbo, setRumbo] = useState(punto.rumboGrados === null ? "" : String(punto.rumboGrados));
  const [desactivar, setDesactivar] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");

  async function guardar(estado?: "activo" | "inactivo") {
    const h = Number(altura.replace(",", "."));
    const r = rumbo.trim() === "" ? null : Number(rumbo.replace(",", "."));
    if (!Number.isFinite(h) || h < 0.5 || h > 2.5) return setError("La altura del trípode va de 0,50 a 2,50 m.");
    if (r !== null && (!Number.isFinite(r) || r < 0 || r >= 360)) return setError("El rumbo va de 0 a 359,9°.");
    try {
      await api.editarPunto(punto.id, { version: punto.version, espacio, zona, referenciaFisica: referencia, alturaM: h, rumboGrados: r, ...(estado ? { estado, motivo } : {}) });
      alGuardar();
    } catch (err) {
      setError(message(err));
    }
  }

  const campo = (etiqueta: string, valor: string, cambiar: (v: string) => void) => (
    <div style={{ marginTop: 6 }}>
      <label style={{ ...labelStyle, fontSize: 12, marginBottom: 2 }}>{etiqueta}</label>
      <input value={valor} onChange={(e) => cambiar(e.target.value)} style={{ ...baseInput, width: "100%" }} />
    </div>
  );

  return (
    <div style={{ border: "1px solid var(--tc-gray-300)", borderRadius: 6, padding: 8, background: "#fbfcfe" }}>
      {campo("Espacio", espacio, setEspacio)}
      {campo("Zona", zona, setZona)}
      {campo("Referencia física", referencia, setReferencia)}
      {campo("Altura trípode (m)", altura, setAltura)}
      {campo("Rumbo (°, antihorario desde el eje X; vacío si no se ha calibrado)", rumbo, setRumbo)}
      {error && <Notice kind="error" style={{ marginTop: 6 }}>{error}</Notice>}
      {desactivar && (
        <div style={{ marginTop: 6 }}>
          <label style={{ ...labelStyle, fontSize: 12 }}>Motivo para desactivar (el código no se vuelve a usar)</label>
          <input value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ ...baseInput, width: "100%" }} />
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {punto.estado === "activo" ? (
          desactivar ? (
            <button style={{ ...boton, color: "#b3261e" }} onClick={() => guardar("inactivo")} disabled={!motivo.trim()}>Desactivar</button>
          ) : (
            <button style={{ ...boton, color: "#b3261e" }} onClick={() => setDesactivar(true)}>Desactivar…</button>
          )
        ) : (
          <button style={boton} onClick={() => guardar("activo")}>Activar</button>
        )}
        <button style={linkButton} onClick={alCancelar}>Cancelar</button>
        <button style={{ ...acceptButton, padding: "5px 12px", fontSize: 13 }} onClick={() => guardar()}>Guardar</button>
      </div>
    </div>
  );
}
