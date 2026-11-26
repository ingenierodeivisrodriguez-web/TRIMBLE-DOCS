"use client";

// The selected capture point: its data (code, tower, floor, unit, space, zone, coordinates…),
// its photos by date (newest first) and the 360° viewer of the chosen date.

import { useEffect, useRef, useState } from "react";
import type { I360Api } from "../../lib/inspeccion-360/client";
import { fmtFecha, fmtFechaHora } from "../../lib/inspeccion-360/fechas";
import type { CapturaVista, PuntoVista } from "../../lib/inspeccion-360/types";
import { acceptButton, baseInput, C, labelStyle, linkButton, message, Notice } from "../presupuesto/ui";
import { megas, urlParaVisor } from "./imagen";
import SubirFoto from "./SubirFoto";
import Visor360 from "./Visor360";

interface Vista {
  capturaId: string;
  url: string;
  blob: Blob;
  ancho: number | null;
  titulo: string;
}

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
  const [vista, setVista] = useState<Vista | null>(null);
  const [cargando, setCargando] = useState<{ id: string; texto: string } | null>(null);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const vistaRef = useRef<Vista | null>(null);
  vistaRef.current = vista;

  async function recargar() {
    try {
      setCapturas(await api.capturas(punto.id));
    } catch (err) {
      setError(message(err));
    }
  }

  useEffect(() => {
    setCapturas(null);
    setVista(null);
    setError("");
    recargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [punto.id]);

  useEffect(() => () => {
    if (vistaRef.current) URL.revokeObjectURL(vistaRef.current.url);
  }, []);

  async function ver(c: CapturaVista) {
    if (!c.foto || c.foto.estado !== "en_cde" || cargando) return;
    setError("");
    setCargando({ id: c.id, texto: "Descargando…" });
    try {
      const blob = await api.foto(c.foto.id, (n, t) => setCargando({ id: c.id, texto: t ? `Descargando ${Math.round((100 * n) / t)} % de ${megas(t)}…` : `Descargando ${megas(n)}…` }));
      setCargando({ id: c.id, texto: "Preparando la foto…" });
      const url = await urlParaVisor(blob, c.foto.ancho);
      if (vistaRef.current) URL.revokeObjectURL(vistaRef.current.url);
      setVista({ capturaId: c.id, url, blob, ancho: c.foto.ancho, titulo: `${punto.codigo} · ${fmtFechaHora(c.tomadaEn)}` });
    } catch (err) {
      setError(message(err));
    } finally {
      setCargando(null);
    }
  }

  /** Opens the photo in a tab of its own and hands it over (the tab has no Trimble session). */
  function pantallaCompleta() {
    if (!vista) return;
    const ventana = window.open("/inspeccion-360/pantalla", "_blank");
    if (!ventana) return setError("El navegador bloqueó la ventana nueva: permita ventanas emergentes para trimble-docs.vercel.app.");
    const datos = { tipo: "i360-foto", blob: vista.blob, ancho: vista.ancho, titulo: vista.titulo };
    const alMensaje = (ev: MessageEvent) => {
      if (ev.source !== ventana || ev.origin !== window.location.origin || (ev.data as { tipo?: string })?.tipo !== "i360-listo") return;
      ventana.postMessage(datos, window.location.origin);
      window.removeEventListener("message", alMensaje);
    };
    window.addEventListener("message", alMensaje);
    setTimeout(() => window.removeEventListener("message", alMensaje), 60_000);
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

      {vista && (
        <div style={{ marginTop: 10 }}>
          <Visor360 url={vista.url} titulo={vista.titulo} />
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <button style={boton} onClick={pantallaCompleta}>Pantalla completa ↗</button>
            <button style={boton} onClick={() => { URL.revokeObjectURL(vista.url); setVista(null); }}>Cerrar foto</button>
          </div>
        </div>
      )}

      <h3 style={{ fontSize: 13, margin: "12px 0 4px" }}>Fotos por fecha</h3>
      {error && <Notice kind="error" style={{ marginBottom: 6 }}>{error}</Notice>}
      {capturas === null && <p style={{ fontSize: 12 }}>Cargando…</p>}
      {capturas?.length === 0 && <p style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>Este punto todavía no tiene fotos.</p>}
      {capturas?.map((c) => {
        const elegida = vista?.capturaId === c.id;
        const lista = c.foto?.estado === "en_cde" && c.estado !== "subiendo";
        return (
          <div key={c.id} style={{ border: `1px solid ${elegida ? "#EF6C00" : "var(--tc-gray-200)"}`, borderRadius: 6, padding: 6, marginBottom: 6, background: c.estado === "anulada" ? "#f5f5f5" : "#fff" }}>
            <button onClick={() => ver(c)} disabled={!lista} title={lista ? "Ver la foto 360" : undefined} style={{ display: "flex", gap: 8, width: "100%", border: "none", background: "transparent", padding: 0, cursor: lista ? "pointer" : "default", textAlign: "left", fontFamily: "inherit" }}>
              {c.foto?.miniatura ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.foto.miniatura} alt="" style={{ width: 96, height: 48, objectFit: "cover", borderRadius: 3, opacity: c.estado === "anulada" ? 0.5 : 1 }} />
              ) : (
                <div style={{ width: 96, height: 48, background: "var(--tc-gray-100)", borderRadius: 3 }} />
              )}
              <div style={{ fontSize: 12, minWidth: 0 }}>
                <b style={{ fontSize: 13 }}>{fmtFechaHora(c.tomadaEn)}</b>
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
