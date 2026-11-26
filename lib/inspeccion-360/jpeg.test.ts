import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { esDosAUno, leerCabeceraJpeg } from "./jpeg";

/** A minimal JPEG header: SOI, EXIF (DateTimeOriginal), XMP (GPano), SOF0 and SOS. */
function jpegDePrueba(opciones: { fecha?: string; xmp?: string; ancho: number; alto: number; bigEndian?: boolean }): Uint8Array {
  const bytes: number[] = [0xff, 0xd8];
  const seg = (marca: number, cuerpo: number[]) => {
    const largo = cuerpo.length + 2;
    bytes.push(0xff, marca, largo >> 8, largo & 0xff, ...cuerpo);
  };
  const txt = (s: string) => [...s].map((c) => c.charCodeAt(0));
  if (opciones.fecha) {
    const be = opciones.bigEndian ?? false;
    const u16 = (n: number) => (be ? [n >> 8, n & 0xff] : [n & 0xff, n >> 8]);
    const u32 = (n: number) => (be ? [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff] : [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24]);
    // TIFF: header (8) + IFD0 with 1 entry (2 + 12 + 4) at 8 → Exif IFD at 26 with 1 entry (18) → text at 44
    const tiff = [
      ...txt(be ? "MM" : "II"), ...u16(42), ...u32(8),
      ...u16(1), ...u16(0x8769), ...u16(4), ...u32(1), ...u32(26), ...u32(0),
      ...u16(1), ...u16(0x9003), ...u16(2), ...u32(20), ...u32(44), ...u32(0),
      ...txt(opciones.fecha), 0,
    ];
    seg(0xe1, [...txt("Exif"), 0, 0, ...tiff]);
  }
  if (opciones.xmp) seg(0xe1, [...txt("http://ns.adobe.com/xap/1.0/"), 0, ...txt(opciones.xmp)]);
  seg(0xc0, [8, opciones.alto >> 8, opciones.alto & 0xff, opciones.ancho >> 8, opciones.ancho & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);
  return new Uint8Array(bytes);
}

describe("cabecera JPEG de una foto 360", () => {
  it("lee tamaño, fecha de toma y proyección equirrectangular", () => {
    const b = jpegDePrueba({ fecha: "2026:11:26 09:30:15", xmp: '<x:xmpmeta><rdf:Description GPano:ProjectionType="equirectangular"/></x:xmpmeta>', ancho: 11904, alto: 5952 });
    assert.deepEqual(leerCabeceraJpeg(b), { ancho: 11904, alto: 5952, fechaToma: "2026:11:26 09:30:15", proyeccion: "equirectangular" });
  });

  it("también con EXIF en orden de bytes Motorola (MM)", () => {
    const b = jpegDePrueba({ fecha: "2025:01:02 03:04:05", ancho: 7680, alto: 3840, bigEndian: true });
    assert.equal(leerCabeceraJpeg(b)?.fechaToma, "2025:01:02 03:04:05");
  });

  it("sin EXIF ni XMP: solo el tamaño", () => {
    assert.deepEqual(leerCabeceraJpeg(jpegDePrueba({ ancho: 4000, alto: 3000 })), { ancho: 4000, alto: 3000, fechaToma: null, proyeccion: null });
  });

  it("no es JPEG", () => {
    assert.equal(leerCabeceraJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
  });

  it("2:1 con ±2 px", () => {
    assert.equal(esDosAUno(11904, 5952), true);
    assert.equal(esDosAUno(5760, 2881), true);
    assert.equal(esDosAUno(4000, 3000), false);
  });
});
