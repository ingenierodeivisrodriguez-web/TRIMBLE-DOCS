import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coordenadasIfc } from "./anclaje";
import { hojaPdf, nombreHoja } from "./hoja";

describe("hoja para imprimir", () => {
  const datos = {
    nombre: "Acceso principal",
    referencia: "hacia el eje B, paralela a la fachada",
    url: "https://trimble-docs.vercel.app/ra/q/AbCdEfGhIjKlMnOpQrStUv",
    codigo: "AbCdEfGhIjKlMnOpQrStUv",
    vence: "26-11-2026",
    proyecto: "Torre A",
    modelo: "Estructura",
    elemento: "Losa 2",
    coordenadas: [1002.5, 2001.25, 3.2] as [number, number, number],
  };
  it("genera un PDF de una página tamaño carta", async () => {
    const blob = await hojaPdf(datos);
    const texto = Buffer.from(await blob.arrayBuffer()).toString("latin1");
    assert.ok(texto.startsWith("%PDF"));
    assert.equal((texto.match(/\/Type \/Page\b/g) ?? []).length, 1);
    assert.ok(blob.size > 2000, "lleva la imagen del QR");
  });
  it("el nombre del archivo no lleva caracteres prohibidos", () => {
    assert.equal(nombreHoja({ nombre: "Piso 1 / acceso: norte" }), "QR Piso 1 - acceso- norte.pdf");
  });
  it("las coordenadas IFC salen del punto del modelo y su origen", () => {
    // Model frame y-up: (x, y, z) = (2.5, 3.2, -1.25) with origin (1000, 0, -2000) → IFC (1002.5, 2001.25, 3.2).
    assert.deepEqual(coordenadasIfc([2.5, 3.2, -1.25], [1000, 0, -2000]), [1002.5, 2001.25, 3.2]);
  });
});
