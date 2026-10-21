// Reference images are reduced in the browser before they are sent: at most
// 1600 px on the longest side, as WebP (JPEG where the browser can't write
// WebP), so a phone photo of several MB ends up at a few hundred KB.
import { MAX_LADO_IMAGEN } from "./types";

export const TIPOS_ACEPTADOS = ["image/png", "image/jpeg", "image/webp"];
/** What the person may pick before reducing it. */
export const MAX_BYTES_ORIGINAL = 25_000_000;

export interface ImagenReducida {
  blob: Blob;
  nombre: string;
  ancho: number;
  alto: number;
}

/** The size a picture gets so its longest side is at most `max`. */
export function medidasReducidas(ancho: number, alto: number, max = MAX_LADO_IMAGEN): { ancho: number; alto: number } {
  const escala = Math.min(1, max / Math.max(ancho, alto));
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) };
}

function aBlob(canvas: HTMLCanvasElement, tipo: string, calidad: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, tipo, calidad));
}

export async function reducirImagen(archivo: File): Promise<ImagenReducida> {
  if (!TIPOS_ACEPTADOS.includes(archivo.type)) throw new Error(`"${archivo.name}" no es PNG, JPG ni WebP.`);
  if (archivo.size > MAX_BYTES_ORIGINAL) throw new Error(`"${archivo.name}" pesa más de 25 MB.`);
  const bitmap = await createImageBitmap(archivo).catch(() => {
    throw new Error(`No se pudo leer la imagen "${archivo.name}".`);
  });
  const { ancho, alto } = medidasReducidas(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("El navegador no permite reducir la imagen.");
  g.fillStyle = "#ffffff"; // transparent PNGs get a white background, as on paper
  g.fillRect(0, 0, ancho, alto);
  g.drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close();
  let blob = await aBlob(canvas, "image/webp", 0.85);
  if (!blob || blob.type !== "image/webp") blob = await aBlob(canvas, "image/jpeg", 0.85);
  if (!blob) throw new Error("No se pudo reducir la imagen.");
  const base = archivo.name.replace(/\.[^.]+$/, "");
  return { blob, nombre: `${base}.${blob.type === "image/webp" ? "webp" : "jpg"}`, ancho, alto };
}
