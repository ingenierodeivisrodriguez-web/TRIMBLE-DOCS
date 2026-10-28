"use client";

import { useEffect, useState } from "react";
import { fechaHora } from "../../lib/compras/formato";
import { formatBytes } from "../../lib/format";
import type { PublicarApi } from "../../lib/publicar/client";
import { CARPETA_PRUEBA, PasoPrueba, ProyectoInfo, PruebaResponse } from "../../lib/publicar/types";
import { acceptButton, C, labelStyle, message, Notice } from "../presupuesto/ui";
import { card, select, td, texto, titulo } from "../compras/estilos";
import Explorador, { Elegido } from "./Explorador";

interface Linea {
  paso: string;
  ok: boolean | null;
  mensaje: string;
}

interface Conclusiones {
  lee: boolean | null;
  escribe: boolean | null;
  servidor: boolean | null;
  metodo: string | null;
  velocidad: string | null;
  maximo: number | null;
  version: boolean | null;
  protege: boolean | null;
  navegador: boolean | null;
  iguales: boolean | null;
  mismaRegion: boolean | null;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cadena = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Phase 0: copies a real file of this project to a folder of another project
 * with the user's session, through the server and from the browser, and
 * checks the new version, the protection against overwriting a change made
 * in the destination, and that what arrived is the same file.
 */
export default function PruebaCopia({ api, projectId, projectName }: { api: PublicarApi; projectId: string; projectName: string }) {
  const [archivo, setArchivo] = useState<Elegido | null>(null);
  const [proyectos, setProyectos] = useState<ProyectoInfo[] | null>(null);
  const [errorProyectos, setErrorProyectos] = useState("");
  const [destino, setDestino] = useState("");
  const [carpeta, setCarpeta] = useState<Elegido | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fin, setFin] = useState<Conclusiones | null>(null);

  useEffect(() => {
    api
      .proyectos()
      .then((r) => setProyectos(r.proyectos))
      .catch((err) => setErrorProyectos(message(err)));
  }, [api]);

  const otros = (proyectos ?? []).filter((p) => !p.actual);
  const nombreDestino = otros.find((p) => p.id === destino)?.nombre ?? "";
  const listo = !!archivo && !!destino && !!carpeta && !busy;

  const limpiar = () => {
    setLineas([]);
    setFin(null);
    setError("");
  };

  const anotar = (paso: string, ok: boolean | null, mensaje: string) => setLineas((ls) => [...ls, { paso, ok, mensaje }]);

  async function paso(nombre: string, p: PasoPrueba, datos: Record<string, string>): Promise<PruebaResponse> {
    const r = await api.prueba(p, datos);
    anotar(nombre, r.ok, r.mensaje);
    return r;
  }

  /** Waits for Trimble to confirm an upload in the destination (up to 2 minutes). */
  async function confirmar(nombre: string, uploadId: string): Promise<PruebaResponse | null> {
    for (let i = 0; i < 60; i++) {
      const r = await api.prueba("estado-subida", { destino, uploadId });
      if (r.datos.status === "DONE" || !r.ok) {
        anotar(nombre, r.datos.status === "DONE", r.mensaje);
        return r;
      }
      await esperar(2000);
    }
    anotar(nombre, false, "Trimble no confirmó la carga en 2 minutos (puede seguir procesándola).");
    return null;
  }

  /** The browser downloads the origin file and sends it to the destination's signed URL itself. */
  async function copiaNavegador(base: Record<string, string>): Promise<PruebaResponse | null> {
    const abierta = await paso("Copia desde tu navegador: abrir la subida", "abrir-copia-navegador", base);
    if (!abierta.ok) return null;
    let blob: Blob;
    try {
      const r = await fetch(cadena(abierta.datos.bajar));
      if (!r.ok) {
        anotar("Copia desde tu navegador: bajar del origen", false, `El navegador no pudo bajar el archivo (respuesta ${r.status}).`);
        return null;
      }
      blob = await r.blob();
      anotar("Copia desde tu navegador: bajar del origen", true, `El navegador bajó el archivo (${formatBytes(blob.size)}).`);
    } catch (err) {
      anotar("Copia desde tu navegador: bajar del origen", false, `El navegador no pudo bajar el archivo (${message(err)}); suele ser una restricción de seguridad del navegador (CORS).`);
      return null;
    }
    try {
      // A Blob without a type: no Content-Type header, as the signed URL expects.
      const r = await fetch(cadena(abierta.datos.subir), { method: "PUT", body: new Blob([blob]) });
      anotar("Copia desde tu navegador: subir al destino", r.ok, r.ok ? "El navegador envió el archivo directo a Trimble." : `Trimble no aceptó el envío del navegador (respuesta ${r.status}).`);
      if (!r.ok) return null;
    } catch (err) {
      anotar("Copia desde tu navegador: subir al destino", false, `El navegador no pudo enviar el archivo (${message(err)}); suele ser una restricción de seguridad del navegador (CORS).`);
      return null;
    }
    return confirmar("Copia desde tu navegador: confirmación de Trimble", cadena(abierta.datos.uploadId));
  }

  async function probar() {
    if (!archivo || !destino || !carpeta) return;
    setBusy(true);
    limpiar();
    const c: Conclusiones = { lee: null, escribe: null, servidor: null, metodo: null, velocidad: null, maximo: null, version: null, protege: null, navegador: null, iguales: null, mismaRegion: null };
    try {
      const l = await paso("Leer el archivo en este proyecto", "leer-origen", { fileId: archivo.id });
      c.lee = l.ok;
      if (!l.ok) return;
      const p = await paso("Preparar la carpeta de prueba en el destino", "preparar-destino", { destino, carpetaId: carpeta.id });
      c.escribe = p.ok;
      if (!p.ok) return;
      c.mismaRegion = p.datos.mismaRegion === true;
      const base = { fileId: archivo.id, destino, carpetaPruebaId: cadena(p.datos.carpetaPruebaId) };

      const k1 = await paso("Primera copia, por el servidor", "copiar", base);
      c.servidor = k1.ok;
      c.metodo = cadena(k1.datos.metodo) || null;
      c.velocidad = cadena(k1.datos.velocidad) || null;
      c.maximo = typeof k1.datos.maximo === "number" ? k1.datos.maximo : null;
      if (!k1.ok) return;
      const e1 = await confirmar("Primera copia: confirmación de Trimble", cadena(k1.datos.uploadId));
      if (e1?.datos.status !== "DONE") {
        c.servidor = false;
        return;
      }

      const k2 = await paso("Segunda copia con el mismo nombre", "copiar", base);
      const e2 = k2.ok ? await confirmar("Segunda copia: confirmación de Trimble", cadena(k2.datos.uploadId)) : null;
      c.version = e2?.datos.status === "DONE" && e2.datos.fileId === e1.datos.fileId && Number(e2.datos.revision) > Number(e1.datos.revision);
      anotar(
        "Versión nueva en el destino",
        c.version,
        c.version ? `El mismo nombre creó la versión ${String(e2?.datos.revision)} del mismo archivo (antes ${String(e1.datos.revision)}).` : "No se confirmó una versión nueva del mismo archivo."
      );

      if (c.version && cadena(e1.datos.versionId)) {
        const pr = await paso("Protección: subir encima de una versión vieja", "proteccion", { ...base, versionVieja: cadena(e1.datos.versionId) });
        c.protege = pr.ok;
      }

      const e3 = await copiaNavegador(base);
      c.navegador = e3?.datos.status === "DONE";

      const ultimo = (e3?.datos.status === "DONE" ? e3 : null) ?? (e2?.datos.status === "DONE" ? e2 : null) ?? e1;
      const k = await paso("Comparar lo que llegó al destino", "comprobar", { fileId: archivo.id, destino, destinoFileId: cadena(ultimo.datos.fileId) });
      c.iguales = k.ok;
    } catch (err) {
      setError(message(err));
    } finally {
      setFin(c);
      setBusy(false);
    }
  }

  const si = (v: boolean | null) => (v === null ? "no se probó" : v ? "sí" : "no");
  const conclusiones = fin
    ? [
        ["Lee el archivo en este proyecto", si(fin.lee)],
        ["Escribe en la carpeta del destino", si(fin.escribe)],
        ["Copia por el servidor", fin.servidor ? `sí (${fin.metodo === "memoria" ? "cargando el archivo entero" : "pasándolo por partes"}${fin.velocidad ? `, ${fin.velocidad}` : ""})` : si(fin.servidor)],
        ["Versión nueva con el mismo nombre", si(fin.version)],
        ["Protege los cambios hechos en el destino", si(fin.protege)],
        ["Copia desde el navegador", si(fin.navegador)],
        ["Llegó el mismo archivo", si(fin.iguales)],
        ["Misma región de Trimble", fin.mismaRegion === null ? "no se probó" : fin.mismaRegion ? "sí" : "no (regiones distintas)"],
        [
          "Archivo más pesado que aguanta una copia por el servidor",
          fin.maximo !== null ? `unos ${formatBytes(fin.maximo)} (estimado con esta velocidad)` : fin.servidor ? "sin medir: repite la prueba con un archivo de más de 5 MB" : "no se probó",
        ],
      ]
    : [];
  const resumen = fin
    ? [
        `Prueba de copia entre proyectos · ${fechaHora(new Date().toISOString())}`,
        `Origen: ${projectName} · ${archivo?.ruta ?? ""}${archivo?.tamano != null ? ` (${formatBytes(archivo.tamano)})` : ""}`,
        `Destino: ${nombreDestino} · ${carpeta?.ruta ?? ""}`,
        ...lineas.map((l) => `${l.ok === null ? "·" : l.ok ? "✔" : "✖"} ${l.paso}: ${l.mensaje}`),
        ...conclusiones.map(([k, v]) => `${k}: ${v}`),
        ...(error ? [`Error: ${error}`] : []),
      ].join("\n")
    : "";

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 900 }}>
      <section style={card}>
        <h2 style={titulo}>Prueba de copia entre proyectos</h2>
        <p style={texto}>
          Copia un archivo real de <strong>{projectName || "este proyecto"}</strong> a una carpeta de otro proyecto donde también eres miembro, con tu sesión de Trimble.
          Usa un archivo que se pueda copiar al otro proyecto (por ejemplo, un plano de prueba) y una carpeta de un proyecto de pruebas si lo tienes.
        </p>
        <ol style={{ ...texto, paddingLeft: 20 }}>
          <li>
            En la carpeta que elijas del destino busca o crea la carpeta <strong>{CARPETA_PRUEBA}</strong>.
          </li>
          <li>El servidor copia el archivo ahí (lo lee del origen y lo pasa al destino) y espera a que Trimble lo confirme.</li>
          <li>Lo copia otra vez con el mismo nombre, para comprobar que Trimble crea una versión nueva del mismo archivo.</li>
          <li>Intenta subir encima de la primera versión, para comprobar que Trimble lo rechaza porque ya no es la última.</li>
          <li>Repite la copia desde tu navegador, para saber si sirve con archivos muy pesados.</li>
          <li>Compara el tamaño y la huella del archivo que llegó con el original.</li>
        </ol>
        <p style={{ ...texto, fontSize: 13, color: "var(--tc-gray-500)" }}>
          No borra nada ni cambia este proyecto. Al terminar puedes borrar la carpeta de prueba desde Trimble Connect. Para saber cuánto aguanta, repítela con un archivo pesado
          (por ejemplo, un IFC grande).
        </p>
      </section>

      <section style={card}>
        <h2 style={titulo}>1. El archivo de este proyecto</h2>
        <Explorador
          api={api}
          proyecto={projectId}
          elegir="archivo"
          seleccionado={archivo?.id ?? null}
          onElegir={(e) => {
            setArchivo(e);
            limpiar();
          }}
        />
        <p style={{ ...texto, margin: "8px 0 0" }}>
          {archivo ? (
            <>
              Elegido: <strong>{archivo.ruta}</strong>
              {archivo.revision !== null ? ` · versión ${archivo.revision}` : ""}
              {archivo.tamano !== null ? ` · ${formatBytes(archivo.tamano)}` : ""}
            </>
          ) : (
            <span style={{ color: "var(--tc-gray-500)" }}>Abre las carpetas y haz clic en un archivo.</span>
          )}
        </p>
      </section>

      <section style={card}>
        <h2 style={titulo}>2. El proyecto destino</h2>
        {errorProyectos ? (
          <Notice kind="error">{errorProyectos}</Notice>
        ) : !proyectos ? (
          <p style={{ ...texto, color: "var(--tc-gray-500)" }}>Cargando tus proyectos…</p>
        ) : otros.length === 0 ? (
          <Notice kind="warning">No perteneces a otro proyecto de Trimble Connect: para la prueba necesitas ser miembro de un segundo proyecto.</Notice>
        ) : (
          <>
            <label style={labelStyle} htmlFor="destino">
              Proyectos donde eres miembro
            </label>
            <select
              id="destino"
              value={destino}
              onChange={(e) => {
                setDestino(e.target.value);
                setCarpeta(null);
                limpiar();
              }}
              style={{ ...select, minWidth: 320 }}
            >
              <option value="">Elige el proyecto destino…</option>
              {otros.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                  {p.region ? ` (${p.region})` : ""}
                </option>
              ))}
            </select>
          </>
        )}
      </section>

      {destino && (
        <section style={card}>
          <h2 style={titulo}>3. La carpeta del destino</h2>
          <p style={texto}>Abre la carpeta donde quieres que quede la prueba y pulsa &quot;Usar esta carpeta&quot;. Necesitas permiso para subir archivos ahí.</p>
          <Explorador
            key={destino}
            api={api}
            proyecto={destino}
            elegir="carpeta"
            seleccionado={carpeta?.id ?? null}
            onElegir={(e) => {
              setCarpeta(e);
              limpiar();
            }}
          />
          {carpeta && (
            <p style={{ ...texto, margin: "8px 0 0" }}>
              Carpeta elegida: <strong>{carpeta.ruta}</strong>
            </p>
          )}
        </section>
      )}

      <section style={card}>
        <button type="button" onClick={probar} disabled={!listo} style={{ ...acceptButton, opacity: listo ? 1 : 0.5, cursor: listo ? "pointer" : "not-allowed" }}>
          {busy ? "Probando…" : lineas.length ? "Repetir la prueba" : "Hacer la prueba"}
        </button>
        {!archivo || !destino || !carpeta ? (
          <span style={{ marginLeft: 12, fontSize: 13, color: "var(--tc-gray-500)" }}>Elige el archivo, el proyecto destino y la carpeta.</span>
        ) : null}
      </section>

      {lineas.length > 0 && (
        <section style={card}>
          <h2 style={titulo}>Resultado</h2>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td style={{ ...td, width: 28, fontSize: 16, color: l.ok ? "#2e6b22" : l.ok === false ? "#b3261e" : "var(--tc-gray-500)" }}>{l.ok === null ? "·" : l.ok ? "✔" : "✖"}</td>
                  <td style={{ ...td, fontWeight: 600, whiteSpace: "nowrap" }}>{l.paso}</td>
                  <td style={td}>{l.mensaje}</td>
                </tr>
              ))}
              {busy && (
                <tr>
                  <td style={td} />
                  <td style={{ ...td, color: "var(--tc-gray-500)" }} colSpan={2}>
                    Trabajando… (un archivo pesado puede tardar unos minutos)
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {fin && (
            <>
              <table style={{ borderCollapse: "collapse", marginTop: 12 }}>
                <tbody>
                  {conclusiones.map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ ...td, color: "var(--tc-gray-500)" }}>{k}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <label style={{ ...labelStyle, marginTop: 12 }} htmlFor="resumen-prueba">
                Para compartir el resultado, copia este texto:
              </label>
              <textarea
                id="resumen-prueba"
                readOnly
                rows={Math.min(18, resumen.split("\n").length + 1)}
                value={resumen}
                onFocus={(e) => e.target.select()}
                style={{ width: "100%", boxSizing: "border-box", fontFamily: "monospace", fontSize: 12, border: `1px solid ${C.border}`, padding: 8 }}
              />
            </>
          )}
        </section>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}
