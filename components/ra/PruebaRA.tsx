"use client";

import { CSSProperties, useEffect, useRef, useState } from "react";
import { Capacidades, detectarPlataforma, veredicto } from "../../lib/ra/diagnostico";
import { dentroEnPlanta, distanciaEnPlanta, esHorizontal, giroHaciaPersona, metros, VOLUMEN_PRUEBA } from "../../lib/ra/volumen";
import { construirMira, construirVolumen, liberar } from "./escena";

type Estado = { colocado: boolean; distancia: number | null; dentro: boolean; piso: boolean };

const AZUL = "#2f55b0";
const m = VOLUMEN_PRUEBA;

/**
 * Phase 0 of the AR extension: checks whether this phone can do WebXR AR and lets
 * the person place a 2 × 2 × 3 m volume at 1:1 on the floor and walk around and into it.
 * Public page, outside Trimble Connect: nothing is read or saved.
 */
export default function PruebaRA() {
  const [cap, setCap] = useState<Capacidades | null>(null);
  const [enRA, setEnRA] = useState(false);
  const [error, setError] = useState("");
  const [estado, setEstado] = useState<Estado>({ colocado: false, distancia: null, dentro: false, piso: false });
  const overlayRef = useRef<HTMLDivElement>(null);
  const botonesRef = useRef<HTMLDivElement>(null);
  const lienzoRef = useRef<HTMLDivElement>(null);
  const vistaRef = useRef<HTMLDivElement>(null);
  const sesionRef = useRef<XRSession | null>(null);
  const reubicarRef = useRef<() => void>(() => {});

  useEffect(() => {
    const base = detectarPlataforma(navigator.userAgent, navigator.maxTouchPoints);
    const xr = navigator.xr;
    const inicial: Capacidades = { ...base, seguro: window.isSecureContext, webxr: !!xr, ra: xr ? null : false, lectorQR: "BarcodeDetector" in window };
    setCap(inicial);
    if (xr) {
      xr.isSessionSupported("immersive-ar")
        .then((ok) => setCap((c) => (c ? { ...c, ra: ok } : c)))
        .catch(() => setCap((c) => (c ? { ...c, ra: false } : c)));
    }
  }, []);

  // Taps on the overlay buttons must not also place the volume.
  useEffect(() => {
    const el = botonesRef.current;
    if (!el) return;
    const parar = (e: Event) => e.preventDefault();
    el.addEventListener("beforexrselect", parar);
    return () => el.removeEventListener("beforexrselect", parar);
  }, []);

  // Still preview of the volume, so one knows what to look for before going outside.
  useEffect(() => {
    let cancelado = false;
    let limpiar = () => {};
    (async () => {
      const THREE = await import("three");
      const caja = vistaRef.current;
      if (cancelado || !caja) return;
      const ancho = caja.clientWidth || 320;
      const alto = 220;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(ancho, alto);
      caja.appendChild(renderer.domElement);
      const escena = new THREE.Scene();
      escena.background = new THREE.Color(0x3a3f47);
      const camara = new THREE.PerspectiveCamera(50, ancho / alto, 0.1, 100);
      camara.position.set(3.2, 2.6, 4.6);
      camara.lookAt(0, 1.2, 0);
      const volumen = construirVolumen(THREE, m);
      escena.add(volumen);
      const piso = new THREE.GridHelper(8, 8, 0x8a929e, 0x5a616b);
      escena.add(piso);
      renderer.render(escena, camara);
      limpiar = () => {
        liberar(escena);
        renderer.dispose();
        renderer.domElement.remove();
      };
    })();
    return () => {
      cancelado = true;
      limpiar();
    };
  }, []);

  async function iniciar() {
    setError("");
    const xr = navigator.xr;
    if (!xr || !overlayRef.current || !lienzoRef.current) return;
    let session: XRSession;
    try {
      session = await xr.requestSession("immersive-ar", {
        requiredFeatures: ["hit-test"],
        optionalFeatures: ["dom-overlay"],
        domOverlay: { root: overlayRef.current },
      });
    } catch (e) {
      setError(`No se pudo abrir la cámara en realidad aumentada. Revise que le dio permiso a Chrome para usar la cámara. (${e instanceof Error ? e.message : String(e)})`);
      return;
    }
    sesionRef.current = session;
    setEnRA(true);
    setEstado({ colocado: false, distancia: null, dentro: false, piso: false });

    const THREE = await import("three");
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType("local");
    lienzoRef.current.appendChild(renderer.domElement);

    const escena = new THREE.Scene();
    const camara = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 200);
    const mira = construirMira(THREE);
    escena.add(mira);
    const volumen = construirVolumen(THREE, m);
    volumen.visible = false;
    escena.add(volumen);

    await renderer.xr.setSession(session);
    const espacioVisor = await session.requestReferenceSpace("viewer");
    const fuente = await session.requestHitTestSource?.({ space: espacioVisor });

    let colocado = false;
    let pisoVisto = false;
    let ultimoAviso = 0;
    const camPos = new THREE.Vector3();
    const puntoMira = new THREE.Vector3();

    reubicarRef.current = () => {
      colocado = false;
      volumen.visible = false;
      setEstado({ colocado: false, distancia: null, dentro: false, piso: pisoVisto });
    };

    session.addEventListener("select", () => {
      if (colocado || !mira.visible) return;
      puntoMira.setFromMatrixPosition(mira.matrix);
      renderer.xr.getCamera().getWorldPosition(camPos);
      volumen.position.copy(puntoMira);
      volumen.rotation.set(0, giroHaciaPersona(puntoMira, camPos), 0);
      volumen.visible = true;
      mira.visible = false;
      colocado = true;
      setEstado({ colocado: true, distancia: distanciaEnPlanta(camPos, puntoMira), dentro: false, piso: true });
    });

    renderer.setAnimationLoop((t: number, frame?: XRFrame) => {
      const ref = renderer.xr.getReferenceSpace();
      if (frame && ref && fuente && !colocado) {
        const pose = frame.getHitTestResults(fuente)[0]?.getPose(ref);
        const sirve = !!pose && esHorizontal(pose.transform.matrix);
        mira.visible = sirve;
        if (pose && sirve) mira.matrix.fromArray(pose.transform.matrix);
        if (sirve !== pisoVisto) {
          pisoVisto = sirve;
          setEstado((s) => ({ ...s, piso: sirve }));
        }
      }
      if (colocado && t - ultimoAviso > 400) {
        ultimoAviso = t;
        renderer.xr.getCamera().getWorldPosition(camPos);
        const local = volumen.worldToLocal(camPos.clone());
        setEstado((s) => ({ ...s, distancia: distanciaEnPlanta(camPos, volumen.position), dentro: dentroEnPlanta(local, m) }));
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
      reubicarRef.current = () => {};
      setEnRA(false);
    });
  }

  const v = cap ? veredicto(cap) : null;

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif", color: "#1f2937", lineHeight: 1.45 }}>
      <div ref={lienzoRef} />

      {/* Shown over the camera during AR (dom-overlay); hidden otherwise. */}
      <div ref={overlayRef} style={{ display: enRA ? "block" : "none", position: "fixed", inset: 0, pointerEvents: "none", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ margin: 12, padding: "10px 12px", borderRadius: 8, background: "rgba(0,0,0,.6)", color: "#fff", fontSize: 15 }}>
          {!estado.colocado ? (
            estado.piso ? (
              <>Toque la pantalla para poner el volumen donde está el círculo amarillo.</>
            ) : (
              <>Mueva el celular despacio, apuntando al piso, hasta que aparezca un círculo amarillo.</>
            )
          ) : (
            <>
              <b>Volumen de {m.ancho} × {m.largo} × {m.alto} m colocado.</b>
              <br />
              Está a {estado.distancia === null ? "—" : metros(estado.distancia)} del centro · {estado.dentro ? "dentro del volumen" : "fuera del volumen"}
            </>
          )}
        </div>
        <div ref={botonesRef} style={{ position: "absolute", left: 0, right: 0, bottom: 24, display: "flex", gap: 12, justifyContent: "center", pointerEvents: "auto" }}>
          {estado.colocado && (
            <button style={botonRA} onClick={() => reubicarRef.current()}>
              Reubicar
            </button>
          )}
          <button style={{ ...botonRA, background: "#b3261e" }} onClick={() => sesionRef.current?.end()}>
            Salir
          </button>
        </div>
      </div>

      <h1 style={{ fontSize: 22, margin: "4px 0 4px", color: AZUL }}>Prueba de realidad aumentada</h1>
      <p style={{ margin: "0 0 14px", color: "#4b5563" }}>
        Fase 0: comprobar si este celular puede mostrar un modelo a escala real (1:1) fijo en el piso, antes de cargar modelos BIM.
      </p>
      <a href="/ra/escanear" style={{ ...botonPrincipal, display: "block", textAlign: "center", textDecoration: "none", boxSizing: "border-box", margin: "0 0 14px" }}>
        Escanear QR
      </a>
      <p style={{ margin: "-6px 0 14px", textAlign: "center" }}>
        <a href="/ra/guia" style={{ color: AZUL, fontWeight: 600 }}>
          Guía de uso
        </a>
      </p>

      <section style={tarjeta}>
        <h2 style={subtitulo}>1 · Revisión del celular</h2>
        {cap && (
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px", fontSize: 14 }}>
            <Fila ok={cap.esAndroid} texto={cap.esAndroid ? "Celular Android" : cap.esIOS ? "iPhone o iPad (todavía no compatible)" : "No es un celular Android"} />
            <Fila ok={cap.navegador === "chrome"} texto={`Navegador: ${nombreNavegador(cap.navegador)}`} />
            <Fila ok={cap.seguro} texto="Conexión segura (https)" />
            <Fila ok={cap.webxr} texto="El navegador tiene realidad aumentada (WebXR)" />
            <Fila ok={cap.ra} texto="El celular tiene ARCore (Servicios de Google Play para RA)" />
            <Fila ok={cap.lectorQR ? true : null} texto={cap.lectorQR ? "Lee códigos QR por sí mismo" : "No lee QR por sí mismo (se usará un lector incluido en la fase 3)"} />
          </ul>
        )}
        {v && (
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 6,
              background: v.listo ? "#e7f4e4" : v.revisando ? "#f3f4f6" : "#fdecea",
              border: `1px solid ${v.listo ? "#2e6b22" : v.revisando ? "#d1d5db" : "#b3261e"}`,
            }}
          >
            <b>{v.titulo}</b>
            {v.detalle && <div style={{ fontSize: 14 }}>{v.detalle}</div>}
          </div>
        )}
        <button
          style={{ ...botonPrincipal, opacity: v?.listo ? 1 : 0.45, cursor: v?.listo ? "pointer" : "not-allowed" }}
          disabled={!v?.listo || enRA}
          onClick={iniciar}
        >
          Iniciar realidad aumentada
        </button>
        {error && <p style={{ color: "#b3261e", fontSize: 14, margin: "8px 0 0" }}>{error}</p>}
      </section>

      <section style={tarjeta}>
        <h2 style={subtitulo}>2 · Lo que va a ver</h2>
        <div ref={vistaRef} style={{ width: "100%", borderRadius: 6, overflow: "hidden" }} />
        <p style={{ fontSize: 14, margin: "8px 0 0" }}>
          Un volumen de <b>{m.ancho} m × {m.largo} m en planta y {m.alto} m de alto</b>: aristas amarillas, caras azules transparentes, una línea en el piso
          cada metro, una cruz naranja en el punto donde se pone y una flecha naranja que marca el frente (queda mirando hacia usted).
        </p>
      </section>

      <section style={tarjeta}>
        <h2 style={subtitulo}>3 · Cómo probarlo</h2>
        <ol style={{ paddingLeft: 20, margin: 0, fontSize: 14 }}>
          <li>Busque un espacio despejado de al menos 4 × 4 m, con buena luz y un piso con algo de textura (un piso blanco liso cuesta más).</li>
          <li>Marque un punto en el piso con tiza o cinta y párese a unos 2 m.</li>
          <li>Pulse «Iniciar realidad aumentada», acepte el permiso de la cámara y apunte al punto marcado hasta ver el círculo amarillo encima.</li>
          <li>Toque la pantalla: el volumen queda con su cruz sobre la marca.</li>
          <li>Camine alrededor y entre al volumen. Con un flexómetro, mida en el piso un lado de la base: debe dar 2 m.</li>
          <li>Vuelva a la marca después de caminar y mire cuánto se corrió la cruz.</li>
        </ol>
        <p style={{ fontSize: 14, margin: "10px 0 0" }}>
          <b>Cuénteme:</b> la marca y el modelo del celular, si quedó fijo al caminar, cuánto midió el lado y cuántos centímetros se corrió la cruz al volver.
        </p>
      </section>
    </main>
  );
}

function Fila({ ok, texto }: { ok: boolean | null; texto: string }) {
  const icono = ok === null ? "…" : ok ? "✔" : "✖";
  const color = ok === null ? "#6b7280" : ok ? "#2e6b22" : "#b3261e";
  return (
    <li style={{ display: "flex", gap: 8, padding: "3px 0" }}>
      <span style={{ color, width: 16, textAlign: "center", fontWeight: 700 }}>{icono}</span>
      <span>{texto}</span>
    </li>
  );
}

function nombreNavegador(n: Capacidades["navegador"]): string {
  return { chrome: "Google Chrome", samsung: "Samsung Internet", firefox: "Firefox", edge: "Microsoft Edge", safari: "Safari", otro: "otro" }[n];
}

const tarjeta: CSSProperties = { border: "1px solid #dfe4ea", borderRadius: 8, padding: 14, marginBottom: 14, background: "#fff" };
const subtitulo: CSSProperties = { fontSize: 16, margin: "0 0 8px" };
const botonPrincipal: CSSProperties = {
  marginTop: 12,
  width: "100%",
  padding: "14px 16px",
  fontSize: 17,
  fontWeight: 600,
  color: "#fff",
  background: AZUL,
  border: "none",
  borderRadius: 8,
};
const botonRA: CSSProperties = { padding: "12px 22px", fontSize: 16, fontWeight: 600, color: "#fff", background: AZUL, border: "none", borderRadius: 24 };
