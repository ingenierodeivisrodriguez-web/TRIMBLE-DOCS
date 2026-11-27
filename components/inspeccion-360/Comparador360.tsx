"use client";

// Before/after comparison of two 360° photos of the same point: both photos stacked, the "después"
// one cut at a vertical bar the person drags sideways, and both cameras turning and zooming
// together. A photo taken with the camera facing another way is lined up by turning it; an editor
// saves the turn in the database so everyone sees the photos aligned.

import "@photo-sphere-viewer/core/index.css";
import type { Viewer as VisorPSV } from "@photo-sphere-viewer/core";
import { useEffect, useRef, useState } from "react";
import { borrarGiroLocal, divisionConTecla, divisionDesdePuntero, giroEnRadianes, giroInicial, leerGiroLocal, normalizarGiro } from "../../lib/inspeccion-360/comparar";
import { fmtFecha } from "../../lib/inspeccion-360/fechas";
import { LANG } from "./Visor360";

export interface FotoComparada {
  /** The capture's id: the turn is saved under it. */
  id: string;
  url: string;
  /** Date and time shown on the photo (DD-MM-AAAA HH:MM). */
  fecha: string;
  /** The turn saved in the database (degrees). */
  giro: number;
  giroPor?: string | null;
  giroEn?: string | null;
}

export interface VistaCamara {
  yaw: number;
  pitch: number;
  zoom: number;
}

type Lado = "antes" | "despues";

const COLOR: Record<Lado, string> = { antes: "#455a64", despues: "#EF6C00" };
const NOMBRE: Record<Lado, string> = { antes: "«antes»", despues: "«después»" };

const boton: React.CSSProperties = { border: "1px solid var(--tc-gray-300, #c9ced6)", background: "#fff", borderRadius: 4, fontSize: 12, padding: "3px 7px", cursor: "pointer", fontFamily: "inherit" };

function etiqueta(color: string, lado: "left" | "right"): React.CSSProperties {
  return { position: "absolute", top: 8, [lado]: 8, background: color, color: "#fff", fontSize: 11.5, fontWeight: 600, padding: "3px 8px", borderRadius: 3, whiteSpace: "nowrap", boxShadow: "0 1px 3px rgba(0,0,0,.4)" };
}

const grados = (g: number) => `${g.toLocaleString("es-CO")}°`;

export default function Comparador360({
  antes,
  despues,
  alto = 300,
  llenar = false,
  division: divisionInicial = 50,
  vista,
  puedeAlinear = false,
  girosIniciales,
  alGuardarGiro,
  alCambiarGiro,
  alCambiarDivision,
  alMoverCamara,
}: {
  antes: FotoComparada;
  despues: FotoComparada;
  alto?: number | string;
  /** Fill the parent's height (full screen): the photos take what the controls leave. */
  llenar?: boolean;
  /** Where the bar starts (0–100 %). */
  division?: number;
  /** Where the cameras start looking (from another comparison, for full screen). */
  vista?: VistaCamara;
  /** Editors turn the photos and save the turn; everyone else sees them as saved. */
  puedeAlinear?: boolean;
  /** Turns not saved yet, by capture (brought from the panel to full screen). */
  girosIniciales?: Record<string, number>;
  /** Saves a photo's turn; `anterior` is the saved turn on screen. Rejects with the server's message (code "giro-conflicto" when another person saved first). */
  alGuardarGiro?: (capturaId: string, giro: number, anterior: number) => Promise<void>;
  /** The turn shown for a photo changed (saved or not), e.g. to open full screen as it is. */
  alCambiarGiro?: (capturaId: string, giro: number) => void;
  alCambiarDivision?: (division: number) => void;
  alMoverCamara?: (vista: VistaCamara) => void;
}) {
  const marco = useRef<HTMLDivElement>(null);
  const capaAntes = useRef<HTMLDivElement>(null);
  const capaDespues = useRef<HTMLDivElement>(null);
  const visorAntes = useRef<VisorPSV | null>(null);
  const visorDespues = useRef<VisorPSV | null>(null);
  const cargadas = useRef({ antes: "", despues: "" });
  const [division, setDivision] = useState(divisionInicial);
  const [arrastrando, setArrastrando] = useState(false);
  const [error, setError] = useState("");
  // Turns on screen that differ from the saved ones, by capture.
  const [giros, setGiros] = useState<Record<string, number>>(() => girosIniciales ?? {});
  const [lado, setLado] = useState<Lado>("antes");
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ error: boolean; texto: string } | null>(null);

  const local = (f: FotoComparada) => leerGiroLocal(f.id);
  const valor = (f: FotoComparada) => giros[f.id] ?? giroInicial(f.giro, local(f), puedeAlinear);
  const gA = valor(antes);
  const gD = valor(despues);
  const foto: Record<Lado, FotoComparada> = { antes, despues };
  const pendiente = (f: FotoComparada) => valor(f) !== f.giro;
  const hayPendiente = puedeAlinear && (pendiente(antes) || pendiente(despues));
  const delNavegador = (f: FotoComparada) => puedeAlinear && f.giro === 0 && giros[f.id] === undefined && local(f) !== 0;

  const props = useRef({ antes, despues, vista, alMoverCamara, gA, gD });
  props.current = { antes, despues, vista, alMoverCamara, gA, gD };

  // Both viewers, created once; then each photo change only swaps the panorama (the camera stays).
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const { Viewer } = await import("@photo-sphere-viewer/core");
        if (cancelado || !capaAntes.current || !capaDespues.current) return;
        const { antes: a, despues: d, vista: v, gA: ga, gD: gd } = props.current;
        const crear = (contenedor: HTMLDivElement, url: string, giroGrados: number) =>
          new Viewer({
            container: contenedor,
            panorama: url,
            navbar: false,
            loadingTxt: "Cargando foto 360…",
            defaultZoomLvl: v ? v.zoom : 0,
            defaultYaw: v ? v.yaw : 0,
            defaultPitch: v ? v.pitch : 0,
            sphereCorrection: { pan: giroEnRadianes(giroGrados) },
            touchmoveTwoFingers: false,
            mousewheelCtrlKey: false,
            lang: LANG,
          });
        visorAntes.current = crear(capaAntes.current, a.url, ga);
        visorDespues.current = crear(capaDespues.current, d.url, gd);
        cargadas.current = { antes: a.url, despues: d.url };

        // Moving either photo moves the other. PSV fires the event synchronously inside rotate()/zoom(),
        // so a flag set around the call is enough to stop the echo.
        let siguiendo = false;
        const seguir = (de: VisorPSV, a2: VisorPSV) => {
          de.addEventListener("position-updated", ({ position }) => {
            if (siguiendo) return;
            siguiendo = true;
            try {
              a2.rotate(position);
            } finally {
              siguiendo = false;
            }
            props.current.alMoverCamara?.({ yaw: position.yaw, pitch: position.pitch, zoom: de.getZoomLevel() });
          });
          de.addEventListener("zoom-updated", ({ zoomLevel }) => {
            if (siguiendo) return;
            siguiendo = true;
            try {
              a2.zoom(zoomLevel);
            } finally {
              siguiendo = false;
            }
            const p = de.getPosition();
            props.current.alMoverCamara?.({ yaw: p.yaw, pitch: p.pitch, zoom: zoomLevel });
          });
        };
        seguir(visorAntes.current, visorDespues.current);
        seguir(visorDespues.current, visorAntes.current);
      } catch (err) {
        if (!cancelado) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelado = true;
      visorAntes.current?.destroy();
      visorDespues.current?.destroy();
      visorAntes.current = null;
      visorDespues.current = null;
    };
  }, []);

  // Another date: the panorama changes and takes its own turn with it.
  useEffect(() => {
    const v = visorAntes.current;
    if (!v || cargadas.current.antes === antes.url) return;
    cargadas.current.antes = antes.url;
    v.setPanorama(antes.url, { transition: false, sphereCorrection: { pan: giroEnRadianes(props.current.gA) } }).catch((err) => setError(String(err)));
  }, [antes.url]);

  useEffect(() => {
    const v = visorDespues.current;
    if (!v || cargadas.current.despues === despues.url) return;
    cargadas.current.despues = despues.url;
    v.setPanorama(despues.url, { transition: false, sphereCorrection: { pan: giroEnRadianes(props.current.gD) } }).catch((err) => setError(String(err)));
  }, [despues.url]);

  // The saved turn changed (saved here, in full screen or by another person): a turn on screen that
  // was just the old saved one follows the new one; a turn the person moved and did not save stays.
  const guardadosPrevios = useRef<Record<string, number>>({});
  useEffect(() => {
    const seguir: string[] = [];
    for (const f of [antes, despues]) {
      const previo = guardadosPrevios.current[f.id];
      if (previo !== undefined && previo !== f.giro && giros[f.id] === previo) seguir.push(f.id);
      guardadosPrevios.current[f.id] = f.giro;
    }
    if (seguir.length)
      setGiros((x) => {
        const y = { ...x };
        for (const id of seguir) delete y[id];
        return y;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [antes.id, antes.giro, despues.id, despues.giro]);

  // The turn on screen goes to the viewer (and to whoever opens full screen).
  useEffect(() => {
    visorAntes.current?.setOption("sphereCorrection", { pan: giroEnRadianes(gA) });
    alCambiarGiro?.(antes.id, gA);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gA, antes.id]);

  useEffect(() => {
    visorDespues.current?.setOption("sphereCorrection", { pan: giroEnRadianes(gD) });
    alCambiarGiro?.(despues.id, gD);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gD, despues.id]);

  function moverBarra(v: number) {
    setDivision(v);
    alCambiarDivision?.(v);
  }

  /** Turns the chosen photo from its latest turn (two quick clicks add up). */
  function girar(nuevo: (actual: number) => number) {
    const f = foto[lado];
    setAviso(null);
    setGiros((x) => ({ ...x, [f.id]: normalizarGiro(nuevo(x[f.id] ?? giroInicial(f.giro, local(f), puedeAlinear))) }));
  }

  async function guardar() {
    if (!alGuardarGiro) return;
    setGuardando(true);
    setAviso(null);
    const guardadas: string[] = [];
    try {
      for (const f of [antes, despues]) {
        if (!pendiente(f)) continue;
        const g = valor(f);
        try {
          await alGuardarGiro(f.id, g, f.giro);
        } catch (err) {
          // Another person saved another turn: show theirs. Any other failure keeps this one unsaved, to retry.
          if ((err as { code?: string } | null)?.code === "giro-conflicto") {
            setGiros((x) => {
              const { [f.id]: _quitar, ...resto } = x;
              return resto;
            });
            borrarGiroLocal(f.id);
          }
          throw err;
        }
        borrarGiroLocal(f.id);
        setGiros((x) => ({ ...x, [f.id]: g }));
        guardadas.push(f === antes ? NOMBRE.antes : NOMBRE.despues);
      }
      setAviso({ error: false, texto: `Alineación guardada (${guardadas.join(" y ")}): todas las personas del proyecto verán estas fotos así.` });
    } catch (err) {
      setAviso({ error: true, texto: err instanceof Error ? err.message : String(err) });
    } finally {
      setGuardando(false);
    }
  }

  function deshacer() {
    for (const f of [antes, despues]) borrarGiroLocal(f.id);
    setGiros((x) => ({ ...x, [antes.id]: antes.giro, [despues.id]: despues.giro }));
    setAviso(null);
  }

  function alPuntero(ev: React.PointerEvent) {
    const r = marco.current?.getBoundingClientRect();
    if (r) moverBarra(divisionDesdePuntero(ev.clientX, r.left, r.width));
  }

  const elegida = foto[lado];
  const resto = 100 - division;
  const guardadoPor = (f: FotoComparada) => (f.giro !== 0 && f.giroPor ? `${grados(f.giro)}, guardado por ${f.giroPor}${f.giroEn ? ` el ${fmtFecha(f.giroEn)}` : ""}` : null);

  return (
    <div style={llenar ? { display: "flex", flexDirection: "column", height: "100%" } : undefined}>
      <div
        ref={marco}
        style={{ position: "relative", width: "100%", ...(llenar ? { flex: "1 1 auto", minHeight: 0 } : { height: alto }), background: "#111", borderRadius: 4, overflow: "hidden", userSelect: "none" }}
      >
        <div ref={capaAntes} style={{ position: "absolute", inset: 0 }} />
        <div ref={capaDespues} style={{ position: "absolute", inset: 0, clipPath: `inset(0 0 0 ${division}%)` }} />

        {/* Each date's label lives in its own side of the bar. */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", clipPath: `inset(0 ${resto}% 0 0)`, zIndex: 5 }}>
          <span style={etiqueta(COLOR.antes, "left")}>Antes · {antes.fecha}</span>
        </div>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", clipPath: `inset(0 0 0 ${division}%)`, zIndex: 5 }}>
          <span style={etiqueta(COLOR.despues, "right")}>Después · {despues.fecha}</span>
        </div>

        <div
          role="slider"
          tabIndex={0}
          aria-label="Barra de comparación antes / después"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(division)}
          title="Arrastre para comparar antes y después"
          onPointerDown={(ev) => {
            ev.currentTarget.setPointerCapture(ev.pointerId);
            setArrastrando(true);
            alPuntero(ev);
          }}
          onPointerMove={(ev) => arrastrando && alPuntero(ev)}
          onPointerUp={() => setArrastrando(false)}
          onPointerCancel={() => setArrastrando(false)}
          onKeyDown={(ev) => {
            const v = divisionConTecla(division, ev.key, ev.shiftKey);
            if (v === null) return;
            ev.preventDefault();
            moverBarra(v);
          }}
          style={{ position: "absolute", top: 0, bottom: 0, left: `${division}%`, width: 28, marginLeft: -14, cursor: "ew-resize", zIndex: 6, touchAction: "none", outline: "none" }}
        >
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 13, width: 2, background: "#fff", boxShadow: "0 0 4px rgba(0,0,0,.6)" }} />
          <div
            style={{ position: "absolute", top: "50%", left: 14, transform: "translate(-50%, -50%)", width: 40, height: 40, borderRadius: "50%", background: "rgba(0,0,0,.35)", border: "2px solid #fff", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 6px rgba(0,0,0,.5)" }}
          >
            <svg width="26" height="14" viewBox="0 0 26 14" aria-hidden="true">
              <path d="M8 1 L1 7 L8 13 Z M18 1 L25 7 L18 13 Z" fill="#fff" />
            </svg>
          </div>
        </div>

        {error && <div style={{ position: "absolute", inset: 0, color: "#fff", padding: 12, fontSize: 13, zIndex: 7, background: "rgba(0,0,0,.6)" }}>No se pudo mostrar la comparación: {error}</div>}
      </div>

      {puedeAlinear ? (
        <div style={{ marginTop: 6, fontSize: 12, ...(llenar ? { width: "100%", maxWidth: 760, alignSelf: "center" } : {}) }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
            <span style={{ color: "var(--tc-gray-600, #555)", marginRight: 2 }} title="Si las dos fotos no miran hacia el mismo lado, gire una hasta que coincidan">
              Alinear:
            </span>
            {(["antes", "despues"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLado(l)}
                aria-pressed={lado === l}
                style={{ ...boton, borderColor: COLOR[l], background: lado === l ? COLOR[l] : "#fff", color: lado === l ? "#fff" : COLOR[l], fontWeight: 600 }}
              >
                {l === "antes" ? "Antes" : "Después"}
                {pendiente(foto[l]) ? " •" : ""}
              </button>
            ))}
            <b style={{ marginLeft: "auto" }}>{grados(valor(elegida))}</b>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 4 }}>
            <button style={boton} onClick={() => girar((g) => g - 5)} title={`Girar la foto ${NOMBRE[lado]} −5°`}>−5°</button>
            <button style={boton} onClick={() => girar((g) => g - 1)} title={`Girar la foto ${NOMBRE[lado]} −1°`}>−1°</button>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={valor(elegida)}
              onChange={(e) => {
                const v = Number(e.target.value);
                girar(() => v);
              }}
              aria-label={`Giro de la foto ${NOMBRE[lado]} en grados`}
              style={{ flex: "1 1 90px", minWidth: 70 }}
            />
            <button style={boton} onClick={() => girar((g) => g + 1)} title={`Girar la foto ${NOMBRE[lado]} +1°`}>+1°</button>
            <button style={boton} onClick={() => girar((g) => g + 5)} title={`Girar la foto ${NOMBRE[lado]} +5°`}>+5°</button>
          </div>
          {(delNavegador(antes) || delNavegador(despues)) && (
            <div style={{ marginTop: 4, color: "#8a6d00" }}>Se cargó el giro que había quedado guardado solo en este navegador: guárdelo para que todos lo vean.</div>
          )}
          {hayPendiente && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 6, padding: 6, background: "#fff7e0", border: "1px solid #e6c65c", borderRadius: 4 }}>
              <span style={{ flex: "1 1 120px" }}>Alineación sin guardar.</span>
              <button style={{ ...boton, borderColor: "#2e6b22", background: "#2e6b22", color: "#fff", fontWeight: 600 }} onClick={guardar} disabled={guardando}>
                {guardando ? "Guardando…" : "Guardar alineación"}
              </button>
              <button style={boton} onClick={deshacer} disabled={guardando}>Deshacer</button>
            </div>
          )}
          {aviso && <div style={{ marginTop: 4, color: aviso.error ? "#b3261e" : "#2e6b22" }}>{aviso.texto}</div>}
          {!hayPendiente && guardadoPor(elegida) && <div style={{ marginTop: 4, color: "var(--tc-gray-500, #777)" }}>Giro {NOMBRE[lado]}: {guardadoPor(elegida)}.</div>}
        </div>
      ) : (
        (guardadoPor(antes) || guardadoPor(despues)) && (
          <div style={{ marginTop: 6, fontSize: 12, color: "var(--tc-gray-500, #777)" }}>
            Fotos alineadas{guardadoPor(antes) ? ` · «antes» ${guardadoPor(antes)}` : ""}
            {guardadoPor(despues) ? ` · «después» ${guardadoPor(despues)}` : ""}.
          </div>
        )
      )}
    </div>
  );
}
