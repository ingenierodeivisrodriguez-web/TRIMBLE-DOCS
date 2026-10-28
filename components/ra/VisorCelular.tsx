"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import { aModelo, calibrar, Colocacion, deMatriz, esMuroAR } from "../../lib/ra/calibracion";
import { Capacidades, detectarPlataforma, veredicto } from "../../lib/ra/diagnostico";
import { descomprimir, desempaquetar } from "../../lib/ra/formato";
import { tamanoLegible } from "../../lib/ra/limites";
import type { ModeloRA, Vec3 } from "../../lib/ra/modelo";
import type { AperturaResponse } from "../../lib/ra/types";
import { metros } from "../../lib/ra/volumen";
import { construirMira, liberar } from "./escena";
import { construirMallas } from "./mallas";

const AZUL = "#2f55b0";
const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Carga = { fase: "nada" } | { fase: "bajando"; cargados: number; total: number | null } | { fase: "listo"; modelo: ModeloRA; punto: Vec3; rumbo: number };
type EnRA = { apuntando: "nada" | "muro" | "otro"; calibrado: boolean; distancia: number | null };

const NO_ABRE: Record<string, string> = {
  "no-existe": "Este QR no existe.",
  vencido: "Este QR ya venció.",
  anulado: "Este QR fue anulado.",
  "sin-modelo": "El modelo de este QR ya no está.",
  "en-piso": "Este es un QR de prueba con la hoja en el piso: pida uno nuevo pegado en un muro.",
};

/**
 * The model of a QR at 1:1 on site (phase 3): downloads it, checks the phone,
 * and in AR the person taps the sheet's cross on the wall; the point and the
 * wall's direction place the model, which then stays put while they walk.
 */
export default function VisorCelular({ codigo, bytes }: { codigo: string; bytes: number }) {
  const [carga, setCarga] = useState<Carga>({ fase: "nada" });
  const [cap, setCap] = useState<Capacidades | null>(null);
  const [error, setError] = useState("");
  const [enRA, setEnRA] = useState<EnRA | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const botonesRef = useRef<HTMLDivElement>(null);
  const lienzoRef = useRef<HTMLDivElement>(null);
  const sesionRef = useRef<XRSession | null>(null);
  const recalibrarRef = useRef<() => void>(() => {});

  useEffect(() => {
    const base = detectarPlataforma(navigator.userAgent, navigator.maxTouchPoints);
    const xr = navigator.xr;
    setCap({ ...base, seguro: window.isSecureContext, webxr: !!xr, ra: xr ? null : false, lectorQR: "BarcodeDetector" in window });
    xr?.isSessionSupported("immersive-ar")
      .then((ok) => setCap((c) => (c ? { ...c, ra: ok } : c)))
      .catch(() => setCap((c) => (c ? { ...c, ra: false } : c)));
  }, []);

  // Taps on the overlay buttons must not also count as a tap in AR.
  useEffect(() => {
    const el = botonesRef.current;
    if (!el) return;
    const parar = (e: Event) => e.preventDefault();
    el.addEventListener("beforexrselect", parar);
    return () => el.removeEventListener("beforexrselect", parar);
  }, []);

  async function bajar() {
    setError("");
    setCarga({ fase: "bajando", cargados: 0, total: bytes || null });
    try {
      const res = await fetch(`/api/ra/publico/${encodeURIComponent(codigo)}/modelo`, { cache: "no-store" });
      const a = (await res.json().catch(() => ({}))) as AperturaResponse & { error?: string };
      if (!res.ok) throw new Error(a.error ?? `Error ${res.status}`);
      if (a.estado !== "activo" || !a.url || !a.punto || a.rumbo === undefined) throw new Error(NO_ABRE[a.estado] ?? "El QR no abre.");
      const archivo = await fetch(a.url);
      if (!archivo.ok || !archivo.body) throw new Error(`No se pudo descargar el modelo (HTTP ${archivo.status}).`);
      const total = Number(archivo.headers.get("content-length")) || a.bytes || null;
      const lector = archivo.body.getReader();
      const partes: Uint8Array[] = [];
      let cargados = 0;
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        partes.push(value);
        cargados += value.length;
        setCarga({ fase: "bajando", cargados, total });
      }
      const todo = new Uint8Array(cargados);
      let p = 0;
      for (const x of partes) {
        todo.set(x, p);
        p += x.length;
      }
      setCarga({ fase: "listo", modelo: desempaquetar(await descomprimir(todo)), punto: a.punto, rumbo: a.rumbo });
    } catch (e) {
      setCarga({ fase: "nada" });
      setError(mensaje(e));
    }
  }

  async function iniciar() {
    if (carga.fase !== "listo") return;
    const { modelo, punto, rumbo } = carga;
    setError("");
    const xr = navigator.xr;
    if (!xr || !overlayRef.current || !lienzoRef.current) return;
    let session: XRSession;
    try {
      session = await xr.requestSession("immersive-ar", { requiredFeatures: ["hit-test"], optionalFeatures: ["dom-overlay"], domOverlay: { root: overlayRef.current } });
    } catch (e) {
      setError(`No se pudo abrir la cámara en realidad aumentada. Revise que le dio permiso a Chrome para usar la cámara. (${mensaje(e)})`);
      return;
    }
    sesionRef.current = session;
    setEnRA({ apuntando: "nada", calibrado: false, distancia: null });

    const THREE = await import("three");
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType("local");
    lienzoRef.current.appendChild(renderer.domElement);

    const escena = new THREE.Scene();
    escena.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.2));
    const sol = new THREE.DirectionalLight(0xffffff, 1.2);
    sol.position.set(1, 3, 2);
    escena.add(sol);
    const camara = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 500);
    const mira = construirMira(THREE);
    escena.add(mira);
    const raiz = new THREE.Group();
    raiz.add(construirMallas(THREE, modelo));
    raiz.visible = false;
    escena.add(raiz);

    await renderer.xr.setSession(session);
    const espacioVisor = await session.requestReferenceSpace("viewer");
    const fuente = await session.requestHitTestSource?.({ space: espacioVisor });

    let colocacion: Colocacion | null = null;
    let apuntando: EnRA["apuntando"] = "nada";
    let ultimo: { punto: Vec3; normal: Vec3 } | null = null;
    let ultimoAviso = 0;
    const cam = new THREE.Vector3();

    recalibrarRef.current = () => {
      colocacion = null;
      raiz.visible = false;
      setEnRA({ apuntando, calibrado: false, distancia: null });
    };

    session.addEventListener("select", () => {
      if (colocacion || apuntando !== "muro" || !ultimo) return;
      colocacion = calibrar(punto, rumbo, ultimo.punto, ultimo.normal);
      raiz.rotation.set(0, colocacion.giro, 0);
      raiz.position.set(...colocacion.traslado);
      raiz.visible = true;
      mira.visible = false;
      setEnRA((s) => (s ? { ...s, calibrado: true } : s));
    });

    renderer.setAnimationLoop((t: number, frame?: XRFrame) => {
      const ref = renderer.xr.getReferenceSpace();
      if (!colocacion && frame && ref && fuente) {
        const pose = frame.getHitTestResults(fuente)[0]?.getPose(ref);
        let ahora: EnRA["apuntando"] = "nada";
        if (pose) {
          const d = deMatriz(pose.transform.matrix);
          ahora = esMuroAR(d.normal) ? "muro" : "otro";
          ultimo = d;
          mira.matrix.fromArray(pose.transform.matrix);
        }
        mira.visible = ahora === "muro";
        if (ahora !== apuntando) {
          apuntando = ahora;
          setEnRA((s) => (s ? { ...s, apuntando: ahora } : s));
        }
      }
      if (colocacion && t - ultimoAviso > 500) {
        ultimoAviso = t;
        renderer.xr.getCamera().getWorldPosition(cam);
        const enModelo = aModelo([cam.x, cam.y, cam.z], colocacion);
        setEnRA((s) => (s ? { ...s, distancia: Math.hypot(enModelo[0] - punto[0], enModelo[2] - punto[2]) } : s));
      }
      renderer.render(escena, camara);
    });

    session.addEventListener("end", () => {
      renderer.setAnimationLoop(null);
      fuente?.cancel();
      liberar(escena);
      renderer.dispose();
      renderer.domElement.remove();
      sesionRef.current = null;
      recalibrarRef.current = () => {};
      setEnRA(null);
    });
  }

  const v = cap ? veredicto(cap) : null;

  return (
    <div>
      <div ref={lienzoRef} />
      {/* Over the camera during AR (dom-overlay). */}
      <div ref={overlayRef} style={{ display: enRA ? "block" : "none", position: "fixed", inset: 0, pointerEvents: "none", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ margin: 12, padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 15 }}>
          {enRA && !enRA.calibrado && (
            <>
              {enRA.apuntando === "muro" ? (
                <b>Ponga el círculo amarillo sobre la cruz de la hoja y toque la pantalla.</b>
              ) : enRA.apuntando === "otro" ? (
                <>Eso no es un muro. Apunte a la hoja del QR pegada en el muro.</>
              ) : (
                <>Párese a 1 o 2 m de la hoja y mueva el celular despacio frente al muro hasta que aparezca un círculo amarillo.</>
              )}
            </>
          )}
          {enRA?.calibrado && (
            <>
              <b>Modelo ubicado.</b> Camine con calma; si lo ve corrido, vuelva a la hoja y toque «Recalibrar».
              {enRA.distancia !== null && <div style={{ fontSize: 13.5, opacity: 0.9 }}>A {metros(enRA.distancia)} de la hoja (en planta).</div>}
            </>
          )}
        </div>
        <div ref={botonesRef} style={{ position: "absolute", left: 0, right: 0, bottom: 24, display: "flex", gap: 12, justifyContent: "center", pointerEvents: "auto" }}>
          {enRA?.calibrado && (
            <button style={botonRA} onClick={() => recalibrarRef.current()}>
              Recalibrar
            </button>
          )}
          <button style={{ ...botonRA, background: "#b3261e" }} onClick={() => sesionRef.current?.end()}>
            Salir
          </button>
        </div>
      </div>

      {error && <div style={{ ...caja, borderColor: "#b3261e", background: "#fdecea" }}>{error}</div>}

      {carga.fase === "nada" && (
        <button style={botonPrincipal} onClick={bajar}>
          Descargar el modelo ({tamanoLegible(bytes)})
        </button>
      )}
      {carga.fase === "bajando" && (
        <div style={caja}>
          Descargando el modelo… {tamanoLegible(carga.cargados)}
          {carga.total ? ` de ${tamanoLegible(carga.total)}` : ""}
          <div style={{ height: 6, background: "#e5e7eb", borderRadius: 3, overflow: "hidden", marginTop: 6 }}>
            <div style={{ height: "100%", width: carga.total ? `${Math.min(100, Math.round((carga.cargados / carga.total) * 100))}%` : "35%", background: AZUL }} />
          </div>
        </div>
      )}
      {carga.fase === "listo" && (
        <>
          <div style={{ ...caja, borderColor: "#2e6b22", background: "#e7f4e4" }}>
            Modelo listo: {carga.modelo.elementos.length.toLocaleString("en-US")} elementos.
          </div>
          {v && !v.listo && (
            <div style={{ ...caja, borderColor: v.revisando ? "#d1d5db" : "#b3261e", background: v.revisando ? "#f3f4f6" : "#fdecea" }}>
              <b>{v.titulo}</b>
              {v.detalle && <div style={{ fontSize: 14 }}>{v.detalle}</div>}
            </div>
          )}
          <button style={{ ...botonPrincipal, opacity: v?.listo ? 1 : 0.45 }} disabled={!v?.listo || !!enRA} onClick={iniciar}>
            Ver en realidad aumentada
          </button>
          <ol style={{ fontSize: 14, paddingLeft: 20, color: "#374151" }}>
            <li>Párese frente a la hoja del QR, a 1 o 2 metros.</li>
            <li>Pulse «Ver en realidad aumentada» y acepte el permiso de la cámara.</li>
            <li>Mueva el celular despacio frente al muro hasta ver el círculo amarillo; póngalo sobre la cruz y toque la pantalla.</li>
            <li>Camine dentro del modelo. Si se corre, vuelva a la hoja y toque «Recalibrar».</li>
          </ol>
        </>
      )}
    </div>
  );
}

const caja: CSSProperties = { border: "1px solid #dfe4ea", borderRadius: 8, padding: 12, margin: "10px 0", background: "#fff" };
const botonPrincipal: CSSProperties = { width: "100%", padding: "14px 16px", fontSize: 17, fontWeight: 600, color: "#fff", background: AZUL, border: "none", borderRadius: 8, margin: "10px 0" };
const botonRA: CSSProperties = { padding: "12px 22px", fontSize: 16, fontWeight: 600, color: "#fff", background: AZUL, border: "none", borderRadius: 24 };
