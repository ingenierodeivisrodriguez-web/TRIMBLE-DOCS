// Reads what Inspección 360° needs from the start of a JPEG without decoding it: size (SOF marker),
// when it was taken (EXIF DateTimeOriginal) and whether the camera marked it as a 360° photo
// (XMP GPano:ProjectionType). The first megabyte of the file is enough for all three.

export interface CabeceraJpeg {
  ancho: number;
  alto: number;
  /** EXIF text "AAAA:MM:DD HH:MM:SS" (camera local time), or null. */
  fechaToma: string | null;
  /** "equirectangular" in 360° photos that declare it, or null. */
  proyeccion: string | null;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function ascii(b: Uint8Array, desde: number, largo: number): string {
  let s = "";
  for (let i = desde; i < desde + largo && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

/** null when the bytes are not a JPEG. */
export function leerCabeceraJpeg(b: Uint8Array): CabeceraJpeg | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const r: CabeceraJpeg = { ancho: 0, alto: 0, fechaToma: null, proyeccion: null };
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return r.ancho ? r : null;
    const marca = b[i + 1];
    if (marca === 0xff) {
      i++;
      continue;
    }
    if (marca === 0xd8 || marca === 0x01 || (marca >= 0xd0 && marca <= 0xd7)) {
      i += 2;
      continue;
    }
    const largo = (b[i + 2] << 8) | b[i + 3];
    const inicio = i + 4;
    if (marca === 0xda || marca === 0xd9) break;
    if (SOF.has(marca) && inicio + 5 <= b.length) {
      r.alto = (b[inicio + 1] << 8) | b[inicio + 2];
      r.ancho = (b[inicio + 3] << 8) | b[inicio + 4];
    } else if (marca === 0xe1) {
      if (ascii(b, inicio, 6) === "Exif\0\0") r.fechaToma = r.fechaToma ?? fechaExif(b, inicio + 6, largo - 8);
      else if (ascii(b, inicio, 29) === "http://ns.adobe.com/xap/1.0/\0") {
        const xmp = ascii(b, inicio + 29, largo - 31);
        const m = /GPano:ProjectionType(?:="|>)\s*([A-Za-z]+)/.exec(xmp);
        if (m) r.proyeccion = m[1].toLowerCase();
      }
    }
    i += 2 + largo;
  }
  return r.ancho ? r : null;
}

/** DateTimeOriginal (or DateTime) from the TIFF block of an EXIF segment. */
function fechaExif(b: Uint8Array, tiff: number, largo: number): string | null {
  const fin = Math.min(b.length, tiff + largo);
  const le = ascii(b, tiff, 2) === "II";
  if (!le && ascii(b, tiff, 2) !== "MM") return null;
  const u16 = (p: number) => (p + 2 > fin ? -1 : le ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
  const u32 = (p: number) => (p + 4 > fin ? -1 : le ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0 : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0);
  if (u16(tiff + 2) !== 42) return null;
  function etiquetas(ifd: number): Map<number, number> {
    const m = new Map<number, number>();
    const n = u16(tiff + ifd);
    for (let k = 0; k < n && k < 500; k++) {
      const e = tiff + ifd + 2 + k * 12;
      if (e + 12 > fin) break;
      m.set(u16(e), e);
    }
    return m;
  }
  const texto = (entrada: number | undefined) => {
    if (entrada === undefined) return null;
    const cuenta = u32(entrada + 4);
    const desde = cuenta <= 4 ? entrada + 8 : tiff + u32(entrada + 8);
    const s = ascii(b, desde, Math.min(cuenta, 32)).replace(/\0.*$/, "");
    return /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/.test(s) ? s.slice(0, 19) : null;
  };
  const ifd0 = etiquetas(u32(tiff + 4));
  const punteroExif = ifd0.get(0x8769);
  if (punteroExif !== undefined) {
    const original = texto(etiquetas(u32(punteroExif + 8)).get(0x9003));
    if (original) return original;
  }
  return texto(ifd0.get(0x0132));
}

/** True when the size is that of an equirectangular photo (2:1, ±2 px). */
export function esDosAUno(ancho: number, alto: number): boolean {
  return ancho > 0 && alto > 0 && Math.abs(ancho - 2 * alto) <= 2;
}
