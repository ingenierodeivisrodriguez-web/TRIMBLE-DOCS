"use client";

import { useState } from "react";
import { CARPETA_PRUEBA, ARCHIVO_PRUEBA } from "../../lib/compras/cde";
import type { ComprasApi } from "../../lib/compras/client";
import { fechaHora } from "../../lib/compras/formato";
import type { PasoPruebaCde, PruebaCdeResponse } from "../../lib/compras/types";
import { acceptButton, C, message, Notice } from "../presupuesto/ui";
import { card, td, texto, titulo } from "./estilos";

interface Linea {
  paso: string;
  ok: boolean | null;
  mensaje: string;
}

interface Conclusiones {
  carpeta: boolean | null;
  directa: boolean | null;
  servidor: boolean | null;
  confirmada: boolean | null;
  version: boolean | null;
  duplicado: boolean | null;
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * "Documentos (CDE)": for now, the test that checks the extension can write
 * to this project's Trimble Connect folders with the user's session.
 */
export default function PruebaCde({ api, administra }: { api: ComprasApi; administra: boolean }) {
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fin, setFin] = useState<Conclusiones | null>(null);

  const anotar = (paso: string, ok: boolean | null, mensaje: string) => setLineas((ls) => [...ls, { paso, ok, mensaje }]);

  async function paso(nombre: string, p: PasoPruebaCde, datos?: { carpetaId?: string; uploadId?: string }): Promise<PruebaCdeResponse> {
    const r = await api.pruebaCde(p, datos);
    anotar(nombre, r.ok, r.mensaje);
    return r;
  }

  /** Waits for Trimble to confirm an upload (up to about 30 s). */
  async function confirmar(nombre: string, uploadId: string): Promise<PruebaCdeResponse | null> {
    for (let i = 0; i < 20; i++) {
      const r = await api.pruebaCde("estado-subida", { uploadId });
      if (r.datos.status === "DONE" || r.datos.status === "ERROR" || !r.ok) {
        anotar(nombre, r.datos.status === "DONE", r.mensaje);
        return r;
      }
      await esperar(1500);
    }
    anotar(nombre, false, "Trimble no confirmó la carga en 30 segundos (puede seguir procesándola).");
    return null;
  }

  /** One upload: the browser sends the content to the signed URL; if it can't, the server does. */
  async function subir(nombre: string, carpetaId: string, c: Conclusiones): Promise<PruebaCdeResponse | null> {
    let uploadId: string | null = null;
    if (c.directa !== false) {
      const abierta = await paso(`${nombre}: abrir la subida`, "iniciar-subida", { carpetaId });
      if (!abierta.ok) return null;
      try {
        // A Blob without a type: no Content-Type header, as the signed URL expects.
        const res = await fetch(abierta.datos.url as string, { method: "PUT", body: new Blob([abierta.datos.contenido as string]) });
        c.directa = res.ok;
        anotar(`${nombre}: enviar desde el navegador`, res.ok, res.ok ? "El navegador envió el archivo directo a Trimble." : `El navegador no pudo enviarlo (respuesta ${res.status}).`);
      } catch (err) {
        c.directa = false;
        anotar(`${nombre}: enviar desde el navegador`, false, `El navegador no pudo enviarlo (${message(err)}); suele ser una restricción de seguridad del navegador (CORS).`);
      }
      if (c.directa) uploadId = abierta.datos.uploadId as string;
    }
    if (!uploadId) {
      const s = await paso(`${nombre}: enviar desde el servidor`, "subir-desde-servidor", { carpetaId });
      c.servidor = s.ok;
      if (!s.ok) return null;
      uploadId = s.datos.uploadId as string;
    }
    return confirmar(`${nombre}: confirmación de Trimble`, uploadId);
  }

  async function probar() {
    setBusy(true);
    setError("");
    setLineas([]);
    setFin(null);
    const c: Conclusiones = { carpeta: null, directa: null, servidor: null, confirmada: null, version: null, duplicado: null };
    try {
      const i = await paso("Leer la carpeta raíz", "inspeccionar");
      if (!i.ok) return;
      const k = await paso("Crear la carpeta de prueba", "crear-carpeta");
      c.carpeta = k.ok;
      if (!k.ok) return;
      const carpetaId = k.datos.carpetaId as string;
      const primera = await subir("Subir el archivo", carpetaId, c);
      c.confirmada = primera?.datos.status === "DONE";
      if (!c.confirmada) return;
      const segunda = await subir("Subirlo otra vez", carpetaId, c);
      c.version = segunda?.datos.status === "DONE" && Number(segunda.datos.revision) > Number(primera?.datos.revision);
      anotar("Versión nueva", c.version, c.version ? `El mismo nombre creó la revisión ${String(segunda?.datos.revision)} (antes ${String(primera?.datos.revision)}).` : "No se confirmó una versión nueva.");
      const d = await paso("Rechazo de duplicados", "duplicado", { carpetaId });
      c.duplicado = d.ok;
    } catch (err) {
      setError(message(err));
    } finally {
      setFin(c);
      setBusy(false);
    }
  }

  const si = (v: boolean | null) => (v === null ? "no se probó" : v ? "sí" : "no");
  const resumen = fin
    ? [
        `Prueba de escritura en el CDE · ${fechaHora(new Date().toISOString())}`,
        ...lineas.map((l) => `${l.ok === null ? "·" : l.ok ? "✔" : "✖"} ${l.paso}: ${l.mensaje}`),
        `Crea carpetas: ${si(fin.carpeta)} · Subida directa desde el navegador: ${si(fin.directa)} · Subida desde el servidor: ${si(fin.servidor)} · Trimble confirma la carga: ${si(fin.confirmada)} · Versiones: ${si(fin.version)} · Rechaza duplicados: ${si(fin.duplicado)}`,
      ].join("\n")
    : "";

  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 900 }}>
      <section style={card}>
        <h2 style={titulo}>Prueba de escritura en el CDE</h2>
        <p style={texto}>
          Antes de guardar requisiciones, cotizaciones y órdenes en las carpetas del proyecto, esta prueba confirma que la extensión puede escribir en
          Trimble Connect con tu sesión. Hazla en un <strong>proyecto de pruebas</strong>.
        </p>
        <ol style={{ ...texto, paddingLeft: 20 }}>
          <li>
            Busca o crea en la raíz del proyecto la carpeta <strong>{CARPETA_PRUEBA}</strong> (si ya existe no crea otra).
          </li>
          <li>
            Sube el archivo de texto <strong>{ARCHIVO_PRUEBA}</strong> (unas líneas que dicen quién hizo la prueba y cuándo): primero desde tu navegador y, si
            el navegador no puede, desde el servidor.
          </li>
          <li>Espera a que Trimble confirme la carga.</li>
          <li>Lo sube otra vez con el mismo nombre para comprobar que se crea una versión nueva.</li>
          <li>Pide abrir un duplicado con el mismo nombre marcando que no se permita, para comprobar que Trimble lo rechaza.</li>
        </ol>
        <p style={{ ...texto, fontSize: 13, color: "var(--tc-gray-500)" }}>
          No borra nada. Al terminar puedes borrar la carpeta desde Trimble Connect. Cada paso queda en la auditoría.
        </p>
        {administra ? (
          <button type="button" onClick={probar} disabled={busy} style={{ ...acceptButton, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Probando…" : lineas.length ? "Repetir la prueba" : "Hacer la prueba"}
          </button>
        ) : (
          <Notice kind="info">La hace quien tenga el permiso Documentos (CDE): administrar.</Notice>
        )}
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
                    Trabajando…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {fin && (
            <>
              <p style={{ ...texto, marginTop: 12 }}>
                Crea carpetas: <strong>{si(fin.carpeta)}</strong> · Subida directa desde el navegador: <strong>{si(fin.directa)}</strong> · Subida desde el
                servidor: <strong>{si(fin.servidor)}</strong> · Trimble confirma la carga: <strong>{si(fin.confirmada)}</strong> · Versiones:{" "}
                <strong>{si(fin.version)}</strong> · Rechaza duplicados: <strong>{si(fin.duplicado)}</strong>
              </p>
              <label style={{ fontSize: 13, color: "var(--tc-gray-500)" }} htmlFor="resumen-cde">
                Para compartir el resultado, copia este texto:
              </label>
              <textarea id="resumen-cde" readOnly rows={Math.min(14, resumen.split("\n").length + 1)} value={resumen} onFocus={(e) => e.target.select()} style={{ width: "100%", fontFamily: "monospace", fontSize: 12, border: `1px solid ${C.border}`, padding: 8 }} />
            </>
          )}
        </section>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </div>
  );
}
