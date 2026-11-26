"use client";

// TEMPORARY (Inspección 360°, Fase 0): spikes T0.2 (addIcon + onIconPicked), T0.3 (addPanorama),
// T0.5 (full screen from the panel) plus the camera-from-the-point snapshot, in the 3D viewer panel.
// Remove when Fase 0 closes.

import { useEffect, useRef, useState } from "react";
import type * as WorkspaceAPI from "trimble-connect-workspace-api";
import { IMAGENES } from "../../lib/i360-pruebas/imagenes";
import { aMetros, camaraTrimble, diferenciaAngular, direccionCamara, unidadProbable, type Vec3 } from "../../lib/i360-pruebas/unidades";
import { leerToque, superficie } from "../../lib/ra/anclaje";
import type { ContextoPruebas } from "./ShellPruebas";
import { bloque, boton, conTiempo, PanelRegistro, useRegistro } from "./Registro";

interface Punto {
  posicion: Vec3;
  normal: Vec3 | null;
  modelId: string;
  runtimeId: number;
  guid: string;
  caja: { min: Vec3; max: Vec3 } | null;
}

type CameraMode = Parameters<WorkspaceAPI.ViewerAPI["setCameraMode"]>[0];
type Jerarquia = Parameters<WorkspaceAPI.ViewerAPI["getHierarchyParents"]>[2];
const v3 = (p: Vec3): WorkspaceAPI.Vector3 => ({ x: p[0], y: p[1], z: p[2] });
const ALTURA_TRIPODE_M = 1.5;
const PANORAMA_ID = "i360-prueba";

export default function PanelPruebas({ api, projectName, escuchar }: ContextoPruebas) {
  const viewer = api.viewer;
  const { lineas, anotar, limpiar } = useRegistro();
  const [punto, setPunto] = useState<Punto | null>(null);
  const [unidad, setUnidad] = useState<"m" | "mm">("m");
  const [esperando, setEsperando] = useState(false);
  const [vistas, setVistas] = useState<{ yaw: number; imagen: string }[]>([]);
  const esperandoRef = useRef(false);
  esperandoRef.current = esperando;

  useEffect(
    () =>
      escuchar(async (evento, datos) => {
        if (evento === "viewer.onIconPicked") anotar("T0.2 Íconos", "ok", { evento, datos });
        if (evento.startsWith("extension.") && evento !== "extension.accessToken") anotar("Eventos", "info", { evento, datos });
        if (evento !== "viewer.onPicked" || !esperandoRef.current) return;
        setEsperando(false);
        const toque = leerToque(datos);
        if (!toque) return anotar("Punto", "falla", "Clic en el vacío: haga clic sobre la losa.");
        try {
          const [guid] = (await conTiempo(viewer.convertToObjectIds(toque.modelId, [toque.runtimeId]))) ?? [];
          const [cajaV] = (await conTiempo(viewer.getObjectBoundingBoxes(toque.modelId, [toque.runtimeId]))) ?? [];
          const b = cajaV?.boundingBox;
          const caja = b ? { min: [b.min.x, b.min.y, b.min.z] as Vec3, max: [b.max.x, b.max.y, b.max.z] as Vec3 } : null;
          const nuevo: Punto = { posicion: toque.posicion, normal: toque.normal, modelId: toque.modelId, runtimeId: toque.runtimeId, guid: guid ?? "", caja };
          setPunto(nuevo);
          if (caja) setUnidad(unidadProbable(caja));
          anotar("Punto", "ok", {
            posicion: toque.posicion,
            normal: toque.normal,
            superficie: toque.normal ? superficie(toque.normal) : "sin normal",
            guid,
            caja,
            unidadProbable: caja ? unidadProbable(caja) : "?",
          });
          const props = await conTiempo(viewer.getObjectProperties(toque.modelId, [toque.runtimeId])).catch((e) => e as Error);
          if (props instanceof Error) anotar("Propiedades", "falla", props);
          else
            anotar("Propiedades", "ok", {
              clase: props[0]?.class,
              nombre: props[0]?.product?.name,
              psets: (props[0]?.properties ?? []).map((s) => s.name).slice(0, 15),
            });
          // 1 = SpatialHierarchy, 2 = SpatialContainment (const enum values of the SDK).
          for (const [tipo, nombre] of [[1, "jerarquía espacial"], [2, "contención espacial"]] as const) {
            const padres = await conTiempo(
              viewer.getHierarchyParents(toque.modelId, [toque.runtimeId], tipo as Jerarquia, true),
            ).catch((e) => e as Error);
            anotar(`Padres (${nombre})`, padres instanceof Error ? "falla" : "ok", padres instanceof Error ? padres : padres.map((p) => p.name));
          }
        } catch (err) {
          anotar("Punto", "falla", err);
        } finally {
          await viewer.activateTool("reset").catch(() => {});
        }
      }),
    [escuchar, anotar, viewer],
  );

  async function tomarPunto() {
    setEsperando(true);
    try {
      await conTiempo(
        viewer.activateTool("picking", {
          instruction: { title: "Punto de captura", text: "Haga clic en la losa donde iría el trípode." },
        }),
      );
    } catch (err) {
      setEsperando(false);
      anotar("Punto", "falla", err);
    }
  }

  const enMetros = punto ? aMetros(punto.posicion, unidad) : null;
  const ojo = enMetros ? ([enMetros[0], enMetros[1], enMetros[2] + ALTURA_TRIPODE_M] as Vec3) : null;

  async function probarIconos() {
    if (!punto || !enMetros) return;
    const origen = window.location.origin;
    const iconos: WorkspaceAPI.PointIcon[] = [
      { id: 1, iconPath: `${origen}/api/i360-pruebas/imagen/icono/verde.png`, position: v3(enMetros), size: 32 },
      { id: 2, iconPath: `${origen}/api/i360-pruebas/imagen/icono/rojo.png`, position: v3(punto.posicion), size: 32 },
      {
        id: 3,
        iconPath: `data:image/png;base64,${IMAGENES.icono_azul}`,
        position: v3([enMetros[0], enMetros[1], enMetros[2] + 0.5]),
        size: 48,
      },
    ];
    try {
      await conTiempo(viewer.addIcon(iconos));
      anotar("T0.2 Íconos", "ok", `addIcon respondió. Verde = posición convertida a metros (${unidad}); rojo = posición tal como la da el clic; azul = imagen embebida 0,5 m arriba. Diga cuál ve sobre el punto y haga clic en un ícono.`);
      const guardados = await conTiempo(viewer.getIcon()).catch((e) => e as Error);
      anotar("T0.2 getIcon", guardados instanceof Error ? "falla" : "ok", guardados);
    } catch (err) {
      anotar("T0.2 Íconos", "falla", err);
    }
  }

  // removeIcon() without arguments failed in the viewer ("reading 'id'"): pass the icons back.
  async function quitarIconos() {
    try {
      const actuales = await conTiempo(viewer.getIcon());
      if (!actuales.length) return anotar("T0.2 Quitar íconos", "info", "No hay íconos.");
      await conTiempo(viewer.removeIcon(actuales));
      const quedan = await conTiempo(viewer.getIcon());
      anotar("T0.2 Quitar íconos (con la lista de getIcon)", quedan.length === 0 ? "ok" : "falla", { antes: actuales.length, quedan: quedan.length });
      if (quedan.length) {
        await conTiempo(viewer.removeIcon(quedan.map((i) => ({ ...i, id: i.id }))));
        anotar("T0.2 Quitar íconos (segundo intento)", "info", { quedan: (await conTiempo(viewer.getIcon())).length });
      }
    } catch (e) {
      anotar("T0.2 Quitar íconos", "falla", e);
    }
  }

  async function vistasDesdeElPunto() {
    if (!ojo) return;
    setVistas([]);
    try {
      const antes = await conTiempo(viewer.getCamera());
      anotar("Cámara", "info", { camaraAntes: antes });
      // First run showed the viewer's convention: pitch 0 looks straight down (π/2 is level) and
      // the view direction is yaw + 90° counter-clockwise from +X. Here the azimuth (counter-clockwise
      // from +X, as the plan's rumbo) is converted and each result is checked against getCamera.
      for (const azimut of [0, 90, 180, 270]) {
        await conTiempo(viewer.setCamera({ position: v3(ojo), ...camaraTrimble(azimut) }, { animationTime: 0 }));
        await new Promise((r) => setTimeout(r, 1500));
        const cam = await conTiempo(viewer.getCamera());
        const imagen = await conTiempo(viewer.getSnapshot(), 15000);
        setVistas((v) => [...v, { yaw: azimut, imagen }]);
        if (cam.position && cam.lookAt) {
          const d = direccionCamara(cam.position, cam.lookAt);
          anotar(`Cámara azimut ${azimut}°`, diferenciaAngular(d.azimut, azimut) < 1 && Math.abs(d.elevacion) < 1 ? "ok" : "falla", {
            azimutObtenido: Number(d.azimut.toFixed(2)),
            elevacion: Number(d.elevacion.toFixed(2)),
            yaw: cam.yaw,
            pitch: cam.pitch,
          });
        } else anotar(`Cámara azimut ${azimut}°`, "info", { cam });
      }
    } catch (err) {
      anotar("Cámara desde el punto", "falla", err);
    }
  }

  async function probarPanorama() {
    if (!ojo) return;
    const origen = window.location.origin;
    const meta: WorkspaceAPI.PanoramaMetadata = {
      id: PANORAMA_ID,
      tilesUrl: `${origen}/api/i360-pruebas/imagen/tesela/l{level}_z{z}_x{x}_y{y}_c{col}_r{row}_f{face}_lod{lod}.jpg`,
      tileHeight: 256,
      tileWidth: 256,
      isLowerLeftOrigin: false,
      maxWidth: 2048,
      maxHeight: 1024,
      sphereRadius: 1,
      position: v3(ojo),
      headingInDegrees: 0,
      // The viewer answered "Quaternion must be provided" without it (optional in the SDK types).
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      fovLeft: -180,
      fovRight: 180,
      fovTop: 90,
      fovBottom: -90,
      minLodLevel: 0,
    };
    try {
      const ok = await conTiempo(viewer.addPanorama(meta), 20000);
      anotar("T0.3 addPanorama", ok ? "ok" : "falla", { respuesta: ok, tilesUrl: meta.tilesUrl });
      await conTiempo(viewer.setCamera({ position: v3(ojo), yaw: 0, pitch: 0 }, { animationTime: 0 })).catch(() => {});
      const modo = await conTiempo(viewer.setCameraMode("panorama" as CameraMode, v3(ojo))).catch((e) => e as Error);
      anotar("T0.3 Modo de cámara panorama", modo instanceof Error ? "falla" : "info", modo instanceof Error ? modo : { respuesta: modo });
      const nubes = await conTiempo(viewer.getPointClouds()).catch((e) => e as Error);
      anotar("T0.3 getPointClouds", nubes instanceof Error ? "falla" : "info", nubes);
      anotar("T0.3", "info", "¿Se ve una esfera de cuadros de colores alrededor del punto? Las teselas pedidas quedan en los registros de Vercel (i360prueba: tesela).");
    } catch (err) {
      anotar("T0.3 addPanorama", "falla", err);
    }
  }

  async function quitarPanorama() {
    await conTiempo(viewer.setCameraMode("rotate" as CameraMode)).catch(() => {});
    await conTiempo(viewer.removeModel(PANORAMA_ID)).then(
      (r) => anotar("T0.3", "info", { removeModel: r }),
      (e) => anotar("T0.3", "falla", e),
    );
  }

  async function pantallaCompleta() {
    const ventana = window.open(`${window.location.origin}/i360-pruebas/pantalla?desde=panel`, "_blank");
    anotar("T0.5 Ventana nueva desde el panel", ventana ? "ok" : "falla", ventana ? "window.open devolvió una ventana: ¿se abrió la pestaña?" : "El navegador o Trimble Connect bloqueó la ventana.");
    const pestanas = await conTiempo(api.ui.getUITabIds()).catch((e) => e as Error);
    anotar("T0.5 getUITabIds", pestanas instanceof Error ? "falla" : "info", pestanas);
  }

  const respuesta = (texto: string) => anotar("T0.2 Lo que ve el usuario", "info", texto);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 10, fontSize: 13 }}>
      <h1 style={{ fontSize: 15, margin: "0 0 4px" }}>Inspección 360 — pruebas del visor (Fase 0)</h1>
      <p style={{ margin: 0, color: "#546E7A" }}>{projectName}. Página temporal: no guarda nada.</p>

      <div style={bloque}>
        <b>1. Tomar un punto</b>
        <p style={{ margin: "4px 0" }}>Cargue un modelo y haga clic en la losa donde iría el trípode.</p>
        <button style={boton} onClick={tomarPunto} disabled={esperando}>{esperando ? "Esperando el clic…" : "Tomar punto en la losa"}</button>
        {punto && (
          <p style={{ margin: "6px 0 0" }}>
            GUID {punto.guid || "?"} · unidad del visor:{" "}
            <select value={unidad} onChange={(e) => setUnidad(e.target.value as "m" | "mm")}>
              <option value="m">metros</option>
              <option value="mm">milímetros</option>
            </select>
          </p>
        )}
      </div>

      <div style={bloque}>
        <b>2. Íconos en el 3D (T0.2)</b>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          <button style={boton} onClick={probarIconos} disabled={!punto}>Poner 3 íconos</button>
          <button style={boton} onClick={quitarIconos}>Quitar íconos</button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {["Veo el VERDE sobre el punto", "Veo el ROJO sobre el punto", "Veo el AZUL arriba del punto", "No veo ningún ícono", "Al hacer clic en un ícono no pasó nada"].map((t) => (
            <button key={t} style={{ ...boton, fontSize: 11 }} onClick={() => respuesta(t)}>{t}</button>
          ))}
        </div>
      </div>

      <div style={bloque}>
        <b>3. Modelo visto desde el punto</b>
        <p style={{ margin: "4px 0" }}>Pone la cámara a 1,50 m sobre el punto, mirando horizontal, y toma 4 imágenes (azimut 0°, 90°, 180°, 270° desde el eje X del modelo); el registro comprueba la dirección.</p>
        <button style={boton} onClick={vistasDesdeElPunto} disabled={!punto}>Tomar 4 vistas</button>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginTop: 6 }}>
          {vistas.map((v) => (
            <figure key={v.yaw} style={{ margin: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.imagen} alt={`Vista ${v.yaw}°`} style={{ width: "100%" }} />
              <figcaption style={{ fontSize: 11 }}>azimut {v.yaw}°</figcaption>
            </figure>
          ))}
        </div>
      </div>

      <div style={bloque}>
        <b>4. Panorama dentro del visor (T0.3)</b>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          <button style={boton} onClick={probarPanorama} disabled={!punto}>Probar addPanorama</button>
          <button style={boton} onClick={quitarPanorama}>Quitar panorama</button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {["Veo la esfera de colores", "No veo nada nuevo", "El visor se dañó o quedó negro"].map((t) => (
            <button key={t} style={{ ...boton, fontSize: 11 }} onClick={() => anotar("T0.3 Lo que ve el usuario", "info", t)}>{t}</button>
          ))}
        </div>
      </div>

      <div style={bloque}>
        <b>5. Abrir a pantalla completa (T0.5)</b>
        <div style={{ marginTop: 6 }}>
          <button style={boton} onClick={pantallaCompleta}>Abrir ventana nueva</button>
        </div>
      </div>

      <PanelRegistro titulo="pruebas del visor" lineas={lineas} limpiar={limpiar} />
    </main>
  );
}
