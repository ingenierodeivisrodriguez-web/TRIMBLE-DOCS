"use client";

// Browser-only image helpers of Inspección 360°: read the photo's header, make its thumbnail and
// a copy the 360° viewer can always show (GPUs cap textures at 8192–16384 px; a 72 MP photo is
// 11904 px wide).

import { type CabeceraJpeg, leerCabeceraJpeg } from "../../lib/inspeccion-360/jpeg";

/** The header from the first megabyte of the file (size, date taken, 360° projection). */
export async function cabeceraDeArchivo(archivo: Blob): Promise<CabeceraJpeg | null> {
  const bytes = new Uint8Array(await archivo.slice(0, 1 << 20).arrayBuffer());
  return leerCabeceraJpeg(bytes);
}

async function redimensionar(archivo: Blob, ancho: number, alto: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(archivo, { resizeWidth: ancho, resizeHeight: alto, resizeQuality: "medium" });
  const canvas = document.createElement("canvas");
  canvas.width = ancho;
  canvas.height = alto;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, ancho, alto);
  bitmap.close();
  return canvas;
}

/** 512 × 256 JPEG as a data URL (≈ 20–40 kB), kept with the capture to list dates without downloading photos. */
export async function miniatura(archivo: Blob): Promise<string> {
  return (await redimensionar(archivo, 512, 256)).toDataURL("image/jpeg", 0.72);
}

/** The largest texture this browser's GPU takes (8192 when it cannot be asked). */
export function maxTextura(): number {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const n = gl ? Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) : 0;
    return n >= 4096 ? Math.min(n, 16384) : 8192;
  } catch {
    return 8192;
  }
}

/** An object URL of the photo, reduced to at most `maxAncho` px wide when it is larger. */
export async function urlParaVisor(foto: Blob, ancho: number | null, maxAncho = 8192): Promise<string> {
  if (!ancho || ancho <= maxAncho) return URL.createObjectURL(foto);
  const canvas = await redimensionar(foto, maxAncho, maxAncho / 2);
  const reducida = await new Promise<Blob>((ok, mal) => canvas.toBlob((b) => (b ? ok(b) : mal(new Error("No se pudo preparar la foto."))), "image/jpeg", 0.9));
  return URL.createObjectURL(reducida);
}

export function megas(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
