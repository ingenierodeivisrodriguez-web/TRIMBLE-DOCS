"use client";

// The Inspección 360° panel of the 3D viewer: the capture points as icons at the tripod's position,
// a click on an icon (or on the list) opens the point with its photos by date, and editors create
// points by clicking the floor where the tripod goes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as WorkspaceAPI from "trimble-connect-workspace-api";
import { camaraTrimble, esCaraDePiso } from "../../lib/inspeccion-360/camara";
import { type I360Api, i360Api } from "../../lib/inspeccion-360/client";
import { fmtFecha } from "../../lib/inspeccion-360/fechas";
import type { EstadoResponse, PuntoVista } from "../../lib/inspeccion-360/types";
import { leerToque } from "../../lib/ra/anclaje";
import type { ShellContext } from "../trimble/ExtensionShell";
import { C, linkButton, message, Notice } from "../presupuesto/ui";
import ConfigInspeccion from "./ConfigInspeccion";
import FichaPunto from "./FichaPunto";
import { ICONOS } from "./iconos";
import NuevoPunto, { type Toque } from "./NuevoPunto";

type Modo = "lista" | "tomando" | "nuevo" | "config";
const boton: React.CSSProperties = { ...linkButton, border: "1px solid var(--tc-gray-300)", fontSize: 12, padding: "4px 8px" };

export default function PanelInspeccion({
  viewer,
  subscribe,
  projectId,
  projectName,
  tokenSource,
  apiPrueba,
}: ShellContext & { viewer: WorkspaceAPI.ViewerAPI; /** Only for local previews with a fake API. */ apiPrueba?: I360Api }) {
  const api = useMemo(() => apiPrueba ?? i360Api(projectId, tokenSource), [apiPrueba, projectId, tokenSource]);
  const [estado, setEstado] = useState<EstadoResponse | null>(null);
  const [puntos, setPuntos] = useState<PuntoVista[] | null>(null);
  const [cargados, setCargados] = useState<{ id: string; versionId: string | null }[]>([]);
  const [elegidoId, setElegidoId] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>("lista");
  const [toque, setToque] = useState<Toque | null>(null);
  const [verInactivos, setVerInactivos] = useState(false);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const iconos = useRef(new Map<number, string>());
  const modoRef = useRef<Modo>("lista");
  modoRef.current = modo;

  const recargar = useCallback(async () => {
    try {
      const [e, p] = await Promise.all([api.estado(), api.puntos()]);
      setEstado(e);
      setPuntos(p);
    } catch (err) {
      setError(message(err));
    }
  }, [api]);

  const leerModelos = useCallback(async () => {
    const modelos = (await viewer.getModels("loaded").catch(() => [])) as { id: string; versionId?: string }[];
    setCargados(modelos.map((m) => ({ id: m.id, versionId: m.versionId ?? null })));
  }, [viewer]);

  useEffect(() => {
    recargar();
    leerModelos();
  }, [recargar, leerModelos]);

  // The icons: one per active point whose model is loaded, at the tripod's position.
  useEffect(() => {
    if (!puntos) return;
    let cancelado = false;
    (async () => {
      const actuales = await viewer.getIcon().catch(() => [] as WorkspaceAPI.PointIcon[]);
      // removeIcon() without arguments fails in the viewer (Fase 0): pass the list back.
      if (actuales.length) await viewer.removeIcon(actuales).catch(() => {});
      if (cancelado) return;
      const modelos = new Set(cargados.map((m) => m.id));
      const mapa = new Map<number, string>();
      const lista: WorkspaceAPI.PointIcon[] = [];
      for (const p of puntos) {
        if (p.estado !== "activo" || !modelos.has(p.modelId)) continue;
        const id = lista.length + 1;
        mapa.set(id, p.id);
        const elegido = p.id === elegidoId;
        lista.push({ id, iconPath: elegido ? ICONOS.elegido : p.capturas ? ICONOS.normal : ICONOS.sinFotos, position: { x: p.x, y: p.y, z: p.z }, size: elegido ? 42 : 30 });
      }
      iconos.current = mapa;
      if (lista.length) await viewer.addIcon(lista).catch((err) => setAviso(`El visor no mostró los íconos: ${message(err)}`));
    })();
    return () => {
      cancelado = true;
    };
  }, [viewer, puntos, cargados, elegidoId]);

  // Leaving the panel takes the icons away.
  useEffect(
    () => () => {
      viewer.getIcon().then((l) => (l.length ? viewer.removeIcon(l) : undefined)).catch(() => {});
    },
    [viewer],
  );

  useEffect(
    () =>
      subscribe((evento, datos) => {
        if (evento === "viewer.onModelStateChanged") leerModelos();
        if (evento === "viewer.onIconPicked") {
          const lista = ((datos as { data?: unknown } | null)?.data ?? datos) as { providedId?: number; id?: number }[] | undefined;
          const primero = Array.isArray(lista) ? lista[0] : undefined;
          const puntoId = iconos.current.get(primero?.providedId ?? primero?.id ?? -1);
          if (puntoId) {
            setElegidoId(puntoId);
            setModo("lista");
          }
        }
        if (evento === "viewer.onPicked" && modoRef.current === "tomando") {
          const t = leerToque(datos);
          if (!t) return setError("Haga clic sobre el piso del modelo (no en el vacío).");
          if (!esCaraDePiso(t.normal)) return setError("Ese clic no fue sobre un piso (la cara no mira hacia arriba). Haga clic en la losa o el piso donde va el trípode.");
          setError("");
          viewer.activateTool("reset").catch(() => {});
          setToque({ piso3d: t.posicion, modelId: t.modelId, versionId: cargados.find((m) => m.id === t.modelId)?.versionId ?? null });
          setModo("nuevo");
        }
      }),
    [subscribe, viewer, leerModelos, cargados],
  );

  async function empezarPunto() {
    setError("");
    setToque(null);
    setModo("tomando");
    try {
      await viewer.activateTool("picking", { instruction: { title: "Nuevo punto 360", text: "Haga clic en el piso donde va el trípode." } });
    } catch (err) {
      setModo("lista");
      setError(`No se pudo activar el clic en el modelo: ${message(err)}`);
    }
  }

  function cancelarPunto() {
    viewer.activateTool("reset").catch(() => {});
    setToque(null);
    setModo("lista");
  }

  async function irAlPunto(p: PuntoVista) {
    try {
      await viewer.setCamera({ position: { x: p.x, y: p.y, z: p.z }, ...camaraTrimble(p.rumboGrados ?? 0) }, { animationTime: 600 });
    } catch (err) {
      setError(`No se pudo mover la cámara: ${message(err)}`);
    }
  }

  const elegido = puntos?.find((p) => p.id === elegidoId) ?? null;
  const modelos = new Set(cargados.map((m) => m.id));
  const visibles = (puntos ?? []).filter((p) => verInactivos || p.estado === "activo");
  const grupos = new Map<string, PuntoVista[]>();
  for (const p of visibles) {
    const k = `${p.torre} · ${p.piso} · ${p.unidad}`;
    grupos.set(k, [...(grupos.get(k) ?? []), p]);
  }
  const inactivos = (puntos ?? []).filter((p) => p.estado === "inactivo").length;
  const sinCodigo = estado && !estado.config.codigoProyecto;
  const sugerencia = elegido ? { torre: elegido.torre, piso: elegido.piso, unidad: elegido.unidad } : null;

  return (
    <main style={{ fontFamily: "inherit", padding: 10, fontSize: 13, color: "var(--tc-gray-700)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 15, margin: 0, color: C.header }}>Inspección 360°</h1>
          <div style={{ fontSize: 11.5, color: "var(--tc-gray-500)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{projectName}</div>
        </div>
        {estado?.esAdmin && modo !== "config" && (
          <button style={boton} onClick={() => setModo("config")} title="Configuración (administradores)">⚙</button>
        )}
      </div>

      {error && <Notice kind="error" style={{ marginTop: 8 }}>{error}</Notice>}
      {aviso && <Notice kind="warning" style={{ marginTop: 8 }}>{aviso}</Notice>}
      {estado && !estado.almacenamiento && <Notice kind="warning" style={{ marginTop: 8 }}>El servidor no tiene la base de datos conectada: lo que se cree se pierde al reiniciar.</Notice>}
      {sinCodigo && modo !== "config" && (
        <Notice kind="info" style={{ marginTop: 8 }}>
          {estado?.esAdmin ? "Antes de crear puntos, fije el código del proyecto (por ejemplo MAL) en ⚙." : "Un administrador del proyecto debe configurar Inspección 360° (código del proyecto) antes de crear puntos."}
        </Notice>
      )}

      {modo === "config" && estado && (
        <ConfigInspeccion
          api={api}
          config={estado.config}
          hayPuntos={(puntos?.length ?? 0) > 0}
          alCerrar={() => setModo("lista")}
          alGuardar={() => {
            setModo("lista");
            recargar();
          }}
        />
      )}

      {modo === "tomando" && (
        <div style={{ marginTop: 8 }}>
          <Notice kind="info">Haga clic en el piso del modelo donde va el trípode.</Notice>
          <button style={{ ...boton, marginTop: 6 }} onClick={cancelarPunto}>Cancelar</button>
        </div>
      )}

      {modo === "nuevo" && toque && estado?.config.codigoProyecto && (
        <NuevoPunto
          api={api}
          codigoProyecto={estado.config.codigoProyecto}
          toque={toque}
          puntos={puntos ?? []}
          sugerencia={sugerencia}
          alCancelar={cancelarPunto}
          alGuardar={async (p) => {
            setToque(null);
            setModo("lista");
            await recargar();
            setElegidoId(p.id);
          }}
        />
      )}

      {modo === "lista" && elegido && (
        <div style={{ marginTop: 8 }}>
          <FichaPunto
            key={elegido.id}
            api={api}
            punto={elegido}
            puedeEditar={Boolean(estado?.puedeEditar)}
            modeloCargado={modelos.has(elegido.modelId)}
            alVolver={() => setElegidoId(null)}
            alIrAlPunto={() => irAlPunto(elegido)}
            alCambiar={recargar}
          />
        </div>
      )}

      {modo === "lista" && !elegido && (
        <div style={{ marginTop: 8 }}>
          {estado?.puedeEditar && estado.config.codigoProyecto && (
            <button style={{ ...boton, borderColor: C.accept, color: C.accept }} onClick={empezarPunto}>+ Nuevo punto (clic en el piso)</button>
          )}
          {puntos === null && <p style={{ fontSize: 12 }}>Cargando puntos…</p>}
          {puntos?.length === 0 && <p style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>Todavía no hay puntos de captura en este proyecto.</p>}
          {cargados.length === 0 && (puntos?.length ?? 0) > 0 && <Notice kind="info" style={{ marginTop: 8 }}>Cargue un modelo en el visor para ver los puntos como íconos.</Notice>}
          {[...grupos.entries()].map(([grupo, lista]) => (
            <div key={grupo} style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--tc-gray-600)" }}>{grupo}</div>
              {lista.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setElegidoId(p.id)}
                  style={{ display: "flex", width: "100%", gap: 6, alignItems: "center", textAlign: "left", border: "none", borderBottom: "1px solid var(--tc-gray-100)", background: "transparent", padding: "5px 2px", cursor: "pointer", fontFamily: "inherit", opacity: p.estado === "inactivo" ? 0.55 : 1 }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: 5, background: p.estado === "inactivo" ? "#bdbdbd" : p.capturas ? "#1565C0" : "#78909C", flex: "0 0 auto" }} />
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                    <b>C{String(p.numero).padStart(2, "0")}</b> {p.espacio}
                    <span style={{ display: "block", fontSize: 11, color: "var(--tc-gray-500)" }}>
                      {p.capturas ? `${p.capturas} foto${p.capturas === 1 ? "" : "s"} · última ${fmtFecha(p.ultimaCaptura!)}` : "sin fotos"}
                      {!modelos.has(p.modelId) ? " · modelo no cargado" : ""}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ))}
          {inactivos > 0 && (
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, marginTop: 10 }}>
              <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Ver puntos inactivos ({inactivos})
            </label>
          )}
        </div>
      )}
    </main>
  );
}
