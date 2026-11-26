"use client";

// TEMPORARY (Inspección 360°, Fase 0): spikes T0.4 (embedded 3D viewer), T0.5 (custom file action)
// and T0.6 (BCF Topics discovery) plus project data for checklist T0.1, in the project menu page.
// Remove when Fase 0 closes.

import { useEffect, useRef, useState } from "react";
import * as WorkspaceAPI from "trimble-connect-workspace-api";
import { candidatosBcf } from "../../lib/i360-pruebas/destino";
import { pickRegion, type RegionInfo } from "../../lib/trimbleApi";
import type { ContextoPruebas } from "./ShellPruebas";
import { bloque, boton, conTiempo, PanelRegistro, useRegistro } from "./Registro";

const MAESTRO = "https://app.connect.trimble.com/tc/api/2.0";
const VISOR_EMBEBIDO = "https://web.connect.trimble.com/?isEmbedded=true";

interface Relevo {
  estado: number;
  cuerpo?: unknown;
  error?: string;
  ubicacion?: string;
  ms?: number;
}

interface BcfListo {
  base: string;
  version: string;
  tipos: string[];
  estados: string[];
}

export default function MenuPruebas({ api, projectId, projectName, token, escuchar }: ContextoPruebas) {
  const { lineas, anotar, limpiar } = useRegistro();
  const [modelo, setModelo] = useState("");
  const [embebido, setEmbebido] = useState(false);
  const marco = useRef<HTMLIFrameElement>(null);
  const visorEmbebido = useRef<WorkspaceAPI.WorkspaceAPI | null>(null);
  const [archivo, setArchivo] = useState("");
  const [baseManual, setBaseManual] = useState("");
  const [bcf, setBcf] = useState<BcfListo | null>(null);
  const [guid, setGuid] = useState("");
  const tcApi = useRef<string>("");

  useEffect(
    () =>
      escuchar((evento, datos) => {
        if (evento !== "extension.accessToken") anotar("Eventos de Trimble", "info", { evento, datos });
      }),
    [escuchar, anotar],
  );

  async function relevo(metodo: "GET" | "POST", url: string, cuerpo?: unknown): Promise<Relevo> {
    const res = await fetch("/api/i360-pruebas/trimble", {
      method: "POST",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ metodo, url, cuerpo }),
    });
    return (await res.json()) as Relevo;
  }

  async function regionDelProyecto(): Promise<RegionInfo | null> {
    const regiones = await relevo("GET", `${MAESTRO}/regions`);
    const proyectos = await relevo("GET", `${MAESTRO}/projects/me?fullyLoaded=false`);
    if (regiones.estado !== 200 || !Array.isArray(regiones.cuerpo)) {
      anotar("Región", "falla", regiones);
      return null;
    }
    const lista = Array.isArray(proyectos.cuerpo) ? (proyectos.cuerpo as { id: string; location?: string }[]) : [];
    const ubicacion = lista.find((p) => p.id === projectId)?.location;
    const region = pickRegion(regiones.cuerpo as RegionInfo[], ubicacion) ?? null;
    if (region) tcApi.current = String(region["tc-api"] ?? MAESTRO).replace(/\/+$/, "");
    anotar("Región", region ? "ok" : "falla", { ubicacion, claves: region ? Object.keys(region) : [], region });
    return region;
  }

  // ---------------------------------------------------------------- T0.1 project data

  async function datosProyecto() {
    try {
      if (!tcApi.current) await regionDelProyecto();
      const p = await relevo("GET", `${tcApi.current}/projects/${projectId}`);
      const cuerpo = (p.cuerpo ?? {}) as Record<string, unknown>;
      const utiles = Object.fromEntries(
        Object.entries(cuerpo).filter(([k]) => /size|quota|storage|licen|tier|location|type|access|created|modified/i.test(k)),
      );
      anotar("T0.1 Proyecto", p.estado === 200 ? "ok" : "falla", { estado: p.estado, claves: Object.keys(cuerpo), utiles });
      const u = await relevo("GET", `${MAESTRO}/users/me`);
      const cu = (u.cuerpo ?? {}) as Record<string, unknown>;
      const sinDatosPersonales = Object.fromEntries(Object.entries(cu).filter(([k]) => /licen|tier|type|status|role|subscription/i.test(k)));
      anotar("T0.1 Usuario (sin datos personales)", u.estado === 200 ? "ok" : "falla", { estado: u.estado, claves: Object.keys(cu), sinDatosPersonales });
    } catch (err) {
      anotar("T0.1", "falla", err);
    }
  }

  // ---------------------------------------------------------------- T0.4 embedded viewer

  async function alCargarMarco() {
    const el = marco.current;
    if (!el) return;
    try {
      const emb = await WorkspaceAPI.connect(
        el,
        (evento: string, datos: unknown) => anotar("T0.4 Evento del visor embebido", "info", { evento, datos }),
        30000,
      );
      visorEmbebido.current = emb;
      anotar("T0.4 connect", "ok", "Conectado al iframe del visor.");
      const tokens = await conTiempo(emb.embed.setTokens({ accessToken: await token(true) }), 20000);
      anotar("T0.4 setTokens", tokens ? "ok" : "falla", { respuesta: tokens });
      const ini = await conTiempo(emb.embed.init3DViewer({ projectId, ...(modelo.trim() ? { modelId: modelo.trim() } : {}) }), 30000);
      anotar("T0.4 init3DViewer", ini ? "ok" : "falla", { respuesta: ini, modelo: modelo.trim() || "(ninguno: el visor abre el proyecto)" });
    } catch (err) {
      anotar("T0.4 Visor embebido", "falla", err);
    }
  }

  async function controlarEmbebido() {
    const emb = visorEmbebido.current;
    if (!emb) return anotar("T0.4", "falla", "Primero cargue el visor embebido.");
    const modelos = await conTiempo(emb.viewer.getModels("loaded")).catch((e) => e as Error);
    anotar("T0.4 getModels (embebido)", modelos instanceof Error ? "falla" : "ok", modelos);
    const camara = await conTiempo(emb.viewer.getCamera()).catch((e) => e as Error);
    anotar("T0.4 getCamera (embebido)", camara instanceof Error ? "falla" : "ok", camara);
  }

  // ---------------------------------------------------------------- T0.5 custom file action

  async function accionArchivo() {
    const fileId = archivo.trim();
    if (!fileId) return anotar("T0.5 Acción sobre archivo", "falla", "Escriba el id de un archivo del proyecto (por ejemplo una foto JPG).");
    try {
      const r = await conTiempo(
        api.ui.addCustomFileAction([
          {
            fileId,
            actionButton: {
              button: { label: "Abrir en Inspección 360°", onClick: "i360-abrir" },
              message: { text: "Prueba de Inspección 360° (Fase 0)", type: "info" },
            },
            actionDropdown: ["Abrir en Inspección 360°"],
          },
        ]),
      );
      anotar("T0.5 addCustomFileAction", r ? "ok" : "falla", { respuesta: r, nota: "Abra la carpeta del archivo en Datos, selecciónelo y busque el botón; los clics deben aparecer como eventos aquí." });
    } catch (err) {
      anotar("T0.5 addCustomFileAction", "falla", err);
    }
  }

  // ---------------------------------------------------------------- T0.6 BCF Topics

  async function probarBase(base: string, origen: string) {
    const versiones = await relevo("GET", `${base}/bcf/versions`);
    anotar(`T0.6 ${origen}: ${base}/bcf/versions`, versiones.estado === 200 ? "ok" : "falla", versiones);
    if (versiones.estado !== 200) return false;
    for (const version of ["3.0", "2.1"]) {
      const proyecto = await relevo("GET", `${base}/bcf/${version}/projects/${projectId}`);
      anotar(`T0.6 proyecto BCF ${version}`, proyecto.estado === 200 ? "ok" : "falla", { estado: proyecto.estado, cuerpo: proyecto.cuerpo });
      if (proyecto.estado !== 200) continue;
      const ext = await relevo("GET", `${base}/bcf/${version}/projects/${projectId}/extensions`);
      const e = (ext.cuerpo ?? {}) as Record<string, unknown>;
      const lista = (k: string) => (Array.isArray(e[k]) ? (e[k] as unknown[]).map(String) : []);
      anotar(`T0.6 extensiones BCF ${version}`, ext.estado === 200 ? "ok" : "falla", { estado: ext.estado, topic_type: lista("topic_type"), topic_status: lista("topic_status") });
      setBcf({ base, version, tipos: lista("topic_type"), estados: lista("topic_status") });
      return true;
    }
    return false;
  }

  async function descubrirBcf() {
    try {
      const region = await regionDelProyecto();
      if (!region) return;
      const candidatos = candidatosBcf(region as unknown as Record<string, unknown>);
      if (candidatos.length === 0) anotar("T0.6 BCF", "falla", "La región del proyecto no publica ninguna dirección con 'bcf' o 'topic'. Pegue abajo la dirección base si Trimble se la entrega.");
      for (const c of candidatos) if (await probarBase(c.base, `región (${c.clave})`)) return;
    } catch (err) {
      anotar("T0.6 BCF", "falla", err);
    }
  }

  async function probarBaseManual() {
    const base = baseManual.trim().replace(/\/+$/, "").replace(/\/bcf(\/[\d.]+)?$/i, "");
    if (!/^https:\/\/[^/]+\.connect\.trimble\.com/.test(base)) return anotar("T0.6", "falla", "La dirección debe ser https://….connect.trimble.com");
    await probarBase(base, "manual").catch((e) => anotar("T0.6", "falla", e));
  }

  async function crearTema() {
    if (!bcf) return;
    const raiz = `${bcf.base}/bcf/${bcf.version}/projects/${projectId}`;
    const tema = await relevo("POST", `${raiz}/topics`, {
      title: "Prueba Inspección 360° (se puede borrar)",
      description: "Creado por la extensión de pruebas de la Fase 0 de Inspección 360°.",
      ...(bcf.tipos[0] ? { topic_type: bcf.tipos[0] } : {}),
      ...(bcf.estados[0] ? { topic_status: bcf.estados[0] } : {}),
    });
    anotar("T0.6 Crear tema", tema.estado >= 200 && tema.estado < 300 ? "ok" : "falla", tema);
    const temaGuid = (tema.cuerpo as { guid?: string } | undefined)?.guid;
    if (!temaGuid) return;
    const comentario = await relevo("POST", `${raiz}/topics/${temaGuid}/comments`, { comment: "Comentario de prueba (Fase 0)." });
    anotar("T0.6 Comentario", comentario.estado >= 200 && comentario.estado < 300 ? "ok" : "falla", comentario);
    if (guid.trim()) {
      const vp = await relevo("POST", `${raiz}/topics/${temaGuid}/viewpoints`, { components: { selection: [{ ifc_guid: guid.trim() }] } });
      anotar("T0.6 Punto de vista con IFCGUID", vp.estado >= 200 && vp.estado < 300 ? "ok" : "falla", vp);
    }
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16, fontSize: 13, maxWidth: 1100 }}>
      <h1 style={{ fontSize: 17, margin: "0 0 4px" }}>Inspección 360 — pruebas de la Fase 0</h1>
      <p style={{ margin: 0, color: "#546E7A" }}>
        {projectName}. Página temporal: solo prueba funciones de Trimble Connect y no guarda nada en la app. Las pruebas del visor (íconos, cámara, panorama, ventana nueva) están en el panel <b>Inspección 360 (pruebas)</b> del visor 3D.
      </p>

      <div style={bloque}>
        <b>T0.1 Datos del proyecto y la licencia</b>
        <p style={{ margin: "4px 0" }}>Lee lo que la API dice del proyecto (tamaño, cuota, región) y de su licencia, sin datos personales.</p>
        <button style={boton} onClick={datosProyecto}>Leer datos</button>
      </div>

      <div style={bloque}>
        <b>T0.4 Visor 3D de Trimble dentro de esta página</b>
        <p style={{ margin: "4px 0" }}>Id del modelo (opcional; se ve en la dirección del navegador al abrir el modelo en el visor):</p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="id del archivo IFC" style={{ flex: "1 1 260px", padding: 6 }} />
          <button style={boton} onClick={() => setEmbebido(true)} disabled={embebido}>Cargar visor embebido</button>
          <button style={boton} onClick={controlarEmbebido} disabled={!embebido}>Probar control del visor</button>
        </div>
        {embebido && (
          <iframe ref={marco} src={VISOR_EMBEBIDO} onLoad={alCargarMarco} title="Visor 3D embebido" style={{ width: "100%", height: 480, border: "1px solid #B0BEC5", marginTop: 8 }} />
        )}
      </div>

      <div style={bloque}>
        <b>T0.5 Botón propio sobre un archivo del explorador</b>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          <input value={archivo} onChange={(e) => setArchivo(e.target.value)} placeholder="id de un archivo (foto JPG del proyecto)" style={{ flex: "1 1 260px", padding: 6 }} />
          <button style={boton} onClick={accionArchivo}>Agregar botón</button>
        </div>
      </div>

      <div style={bloque}>
        <b>T0.6 Servicio BCF (temas)</b>
        <p style={{ margin: "4px 0" }}>Busca la dirección del servicio en la información de regiones de Trimble (no está publicada en la documentación abierta).</p>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button style={boton} onClick={descubrirBcf}>Descubrir servicio BCF</button>
          <input value={baseManual} onChange={(e) => setBaseManual(e.target.value)} placeholder="o pegue la dirección base https://….connect.trimble.com" style={{ flex: "1 1 260px", padding: 6 }} />
          <button style={boton} onClick={probarBaseManual}>Probar dirección</button>
        </div>
        {bcf && (
          <div style={{ marginTop: 8 }}>
            <p style={{ margin: "4px 0" }}>Servicio encontrado: {bcf.base} (BCF {bcf.version}). Crear un tema de prueba en <b>este</b> proyecto:</p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input value={guid} onChange={(e) => setGuid(e.target.value)} placeholder="IFCGUID opcional para el punto de vista" style={{ flex: "1 1 260px", padding: 6 }} />
              <button style={boton} onClick={crearTema}>Crear tema de prueba</button>
            </div>
          </div>
        )}
      </div>

      <PanelRegistro titulo="pruebas del menú" lineas={lineas} limpiar={limpiar} />
    </main>
  );
}
