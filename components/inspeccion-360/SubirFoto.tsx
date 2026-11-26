"use client";

// Uploading a 360° photo of a point: reads its header (size, date taken), makes the thumbnail,
// lets the person confirm the date and notes, puts it in the temporary storage and has the
// server move it to the CDE with its fixed name.

import { useState } from "react";
import type { I360Api } from "../../lib/inspeccion-360/client";
import { isoDesdeExif, isoDesdeLocal, paraInputLocal } from "../../lib/inspeccion-360/fechas";
import { esDosAUno } from "../../lib/inspeccion-360/jpeg";
import { MAX_BYTES_FOTO, type CapturaVista, type PuntoVista } from "../../lib/inspeccion-360/types";
import { acceptButton, baseInput, labelStyle, linkButton, message, Notice } from "../presupuesto/ui";
import { cabeceraDeArchivo, megas, miniatura } from "./imagen";

interface Elegida {
  archivo: File;
  ancho: number;
  alto: number;
  mini: string;
  fechaDeCamara: boolean;
}

export default function SubirFoto({ api, punto, alTerminar, alCancelar }: { api: I360Api; punto: PuntoVista; alTerminar: (c: CapturaVista) => void; alCancelar: () => void }) {
  const [elegida, setElegida] = useState<Elegida | null>(null);
  const [fecha, setFecha] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [aviso, setAviso] = useState("");
  const [error, setError] = useState("");
  const [paso, setPaso] = useState<"elegir" | "leyendo" | "listo" | "subiendo" | "cde">("elegir");
  const [avance, setAvance] = useState(0);

  async function elegir(archivo: File | undefined) {
    setError("");
    setAviso("");
    setElegida(null);
    if (!archivo) return;
    if (!/\.jpe?g$/i.test(archivo.name) && archivo.type !== "image/jpeg") return setError("La foto debe ser JPG (exporte la foto 360 desde la app de la cámara; los archivos .insp no sirven).");
    if (archivo.size > MAX_BYTES_FOTO) return setError(`La foto pesa ${megas(archivo.size)}; el máximo es 60 MB.`);
    setPaso("leyendo");
    try {
      const cab = await cabeceraDeArchivo(archivo);
      if (!cab) throw new Error("El archivo no es una imagen JPG válida.");
      if (!esDosAUno(cab.ancho, cab.alto)) throw new Error(`La foto mide ${cab.ancho} × ${cab.alto} px: una foto 360 equirrectangular mide el doble de ancho que de alto (por ejemplo 11904 × 5952).`);
      const iso = isoDesdeExif(cab.fechaToma);
      setFecha(paraInputLocal(iso ?? new Date(archivo.lastModified).toISOString()));
      if (!iso) setAviso("La foto no trae la fecha de la cámara: se propone la fecha del archivo. Revísela.");
      else if (cab.ancho < 5760) setAviso(`Resolución baja (${cab.ancho} px de ancho): se recomienda 72 MP (11904 px).`);
      setElegida({ archivo, ancho: cab.ancho, alto: cab.alto, mini: await miniatura(archivo), fechaDeCamara: Boolean(iso) });
      setPaso("listo");
    } catch (err) {
      setError(message(err));
      setPaso("elegir");
    }
  }

  async function subir() {
    if (!elegida) return;
    const tomadaEn = isoDesdeLocal(fecha);
    if (!tomadaEn) return setError("Revise la fecha y hora de la foto.");
    setError("");
    setPaso("subiendo");
    setAvance(0);
    try {
      const captura = await api.subirFoto(
        { puntoId: punto.id, tomadaEn, observaciones, nombreOriginal: elegida.archivo.name, tamano: elegida.archivo.size, ancho: elegida.ancho, alto: elegida.alto, miniatura: elegida.mini },
        elegida.archivo,
        (c, t) => setAvance(t ? Math.round((100 * c) / t) : 0),
        () => setPaso("cde"),
      );
      alTerminar(captura);
    } catch (err) {
      setError(message(err));
      setPaso("listo");
    }
  }

  const ocupado = paso === "leyendo" || paso === "subiendo" || paso === "cde";
  return (
    <div style={{ border: "1px solid var(--tc-gray-300)", borderRadius: 6, padding: 10, marginTop: 8, background: "#fbfcfe" }}>
      <b style={{ fontSize: 13 }}>Subir foto 360 de {punto.codigo}</b>
      <div style={{ marginTop: 8 }}>
        <input type="file" accept="image/jpeg,.jpg,.jpeg" disabled={ocupado} onChange={(e) => elegir(e.target.files?.[0])} style={{ fontSize: 12, maxWidth: "100%" }} />
      </div>
      {paso === "leyendo" && <p style={{ fontSize: 12, margin: "6px 0" }}>Leyendo la foto…</p>}
      {elegida && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={elegida.mini} alt="Vista previa" style={{ width: "100%", borderRadius: 4, marginTop: 8 }} />
          <p style={{ fontSize: 11.5, color: "var(--tc-gray-500)", margin: "4px 0" }}>
            {elegida.ancho} × {elegida.alto} px · {megas(elegida.archivo.size)} · {elegida.fechaDeCamara ? "fecha de la cámara" : "fecha del archivo"}
          </p>
          <label style={{ ...labelStyle, marginTop: 6 }}>Fecha y hora de la toma (hora de Colombia)</label>
          <input type="datetime-local" value={fecha} onChange={(e) => setFecha(e.target.value)} disabled={ocupado} style={{ ...baseInput, width: "100%" }} />
          <label style={{ ...labelStyle, marginTop: 6 }}>Observaciones del inspector</label>
          <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} maxLength={4000} rows={3} disabled={ocupado} placeholder="Qué se ve que no está en el modelo, qué no se pudo ver, condiciones…" style={{ ...baseInput, width: "100%", resize: "vertical" }} />
        </>
      )}
      {aviso && <Notice kind="warning" style={{ marginTop: 8 }}>{aviso}</Notice>}
      {error && <Notice kind="error" style={{ marginTop: 8 }}>{error}</Notice>}
      {paso === "subiendo" && <p style={{ fontSize: 12, margin: "6px 0" }}>Subiendo… {avance} %</p>}
      {paso === "cde" && <p style={{ fontSize: 12, margin: "6px 0" }}>Guardando en Trimble Connect (carpeta {punto.torre} / {punto.piso} / {punto.unidad})…</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
        <button style={linkButton} onClick={alCancelar} disabled={ocupado}>Cancelar</button>
        <button style={{ ...acceptButton, padding: "6px 14px", fontSize: 13, opacity: elegida && !ocupado ? 1 : 0.5 }} onClick={subir} disabled={!elegida || ocupado}>
          Subir
        </button>
      </div>
    </div>
  );
}
