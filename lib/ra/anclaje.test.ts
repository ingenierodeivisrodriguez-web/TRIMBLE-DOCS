import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import * as WebIFC from "web-ifc";
import { aYArriba, alinear, aZArriba, cajaElemento, Caja, concuerdan, DISTANCIA_MIN_FLECHA, puntoEnModelo, rumbo } from "./anclaje";
import { esCodigo, estadoQr, fechaMasDias, finDelDia, generarCodigo, urlQr } from "./codigo";
import { armarModelo, leerArchivo, ModeloRA, Vec3 } from "./modelo";
import { IFC_PRUEBA } from "./pruebas/ifcPrueba";

let modelo: ModeloRA;

before(async () => {
  const api = new WebIFC.IfcAPI();
  await api.Init();
  const id = api.OpenModel(new TextEncoder().encode(IFC_PRUEBA), { COORDINATE_TO_ORIGIN: false });
  modelo = armarModelo([leerArchivo(api, id, 0)], { nivelesExcluidos: [], clasesExcluidas: [] });
  api.CloseModel(id);
});

const cerca = (a: Vec3, b: Vec3, tol = 0.002) => a.every((x, i) => Math.abs(x - b[i]) <= tol);
// The wall in IFC metres (z up): x 1000..1004, y 2000..2000.2, z 0..3.
const MURO_IFC: Caja = { min: [1000, 2000, 0], max: [1004, 2000.2, 3] };
const enMm = (c: Caja): Caja => ({ min: c.min.map((x) => x * 1000) as Vec3, max: c.max.map((x) => x * 1000) as Vec3 });
const mover = (c: Caja, d: Vec3): Caja => ({ min: c.min.map((x, i) => x + d[i]) as Vec3, max: c.max.map((x, i) => x + d[i]) as Vec3 });
/** A point given in IFC metres, in the prepared model's frame. */
const ifcAModelo = (p: Vec3): Vec3 => aYArriba([p[0] - modelo.origen[0], p[1] + modelo.origen[2], p[2] - modelo.origen[1]]);

describe("caja de un elemento en el modelo preparado", () => {
  it("el muro mide 4 × 3 × 0.2 m (y arriba)", () => {
    const c = cajaElemento(modelo, "8YvctVUKr0kugbFTf53O9L")!;
    assert.ok(cerca([c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2]], [4, 3, 0.2]));
  });
  it("un IFCGUID que no está en el modelo no tiene caja", () => {
    assert.equal(cajaElemento(modelo, "NoExiste000000000000ZZ"), null);
  });
  it("pasar de y arriba a z arriba y volver deja el punto igual", () => {
    assert.deepEqual(aYArriba(aZArriba([1, 2, 3])), [1, 2, 3]);
  });
});

describe("alinear el visor con el modelo preparado", () => {
  const muro = () => cajaElemento(modelo, "8YvctVUKr0kugbFTf53O9L")!;

  it("visor en metros con las mismas coordenadas del IFC: el punto cae donde debe", () => {
    const r = alinear(MURO_IFC, muro());
    assert.ok(r.ok);
    assert.equal(r.alineacion.escala, 1);
    // Corner of the wall at floor level.
    assert.ok(cerca(puntoEnModelo([1000, 2000, 0], r.alineacion), ifcAModelo([1000, 2000, 0])));
  });
  it("visor en milímetros: se detecta la escala", () => {
    const r = alinear(enMm(MURO_IFC), muro());
    assert.ok(r.ok);
    assert.equal(r.alineacion.escala, 0.001);
    assert.ok(cerca(puntoEnModelo([1002000, 2000100, 3000], r.alineacion), ifcAModelo([1002, 2000.1, 3])));
  });
  it("visor con el modelo corrido a otro origen (como hace Trimble con coordenadas grandes): se compensa", () => {
    const corrido = mover(MURO_IFC, [-1000, -2000, 0]);
    const r = alinear(corrido, muro());
    assert.ok(r.ok);
    assert.ok(cerca(puntoEnModelo([2, 0.1, 0], r.alineacion), ifcAModelo([1002, 2000.1, 0])));
  });
  it("si el elemento está girado 90° en el visor, no se acepta", () => {
    const girado: Caja = { min: [1000, 2000, 0], max: [1000.2, 2004, 3] };
    const r = alinear(girado, muro());
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.motivo : "", /misma forma/);
  });
  it("dos toques sobre elementos distintos dan el mismo corrimiento", () => {
    const losaIfc: Caja = { min: [1000, 2000, 3], max: [1004, 2003, 3.2] };
    const a = alinear(mover(MURO_IFC, [-1000, -2000, 0]), muro());
    const b = alinear(mover(losaIfc, [-1000, -2000, 0]), cajaElemento(modelo, "AYvctVUKr0kugbFTf53O9L")!);
    assert.ok(a.ok && b.ok && concuerdan(a.alineacion, b.alineacion));
  });
  it("si dos toques no concuerdan (el visor movió un modelo y no el otro), se detecta", () => {
    const losaIfc: Caja = { min: [1000, 2000, 3], max: [1004, 2003, 3.2] };
    const a = alinear(MURO_IFC, muro());
    const b = alinear(mover(losaIfc, [0.5, 0, 0]), cajaElemento(modelo, "AYvctVUKr0kugbFTf53O9L")!);
    assert.ok(a.ok && b.ok && !concuerdan(a.alineacion, b.alineacion));
  });
});

describe("dirección de la flecha", () => {
  it("hacia +z es 0°, hacia +x es 90°, hacia -z es 180°", () => {
    assert.equal(rumbo([0, 0, 0], [0, 0, 5]), 0);
    assert.equal(rumbo([0, 0, 0], [3, 0, 0]), Math.PI / 2);
    assert.equal(Math.abs(rumbo([1, 0, 1], [1, 0, -4])), Math.PI);
  });
  it("la altura no cuenta", () => {
    assert.equal(rumbo([0, 0, 0], [3, 10, 0]), Math.PI / 2);
  });
  it("hacia el norte del IFC (+y) es -z en el modelo: 180°", () => {
    const desde = ifcAModelo([1000, 2000, 0]);
    const hacia = ifcAModelo([1000, 2005, 0]);
    assert.equal(Math.abs(rumbo(desde, hacia)), Math.PI);
    assert.ok(DISTANCIA_MIN_FLECHA <= 1);
  });
});

describe("código del QR", () => {
  it("tiene 22 caracteres seguros para una dirección web y no se repite", () => {
    const a = generarCodigo();
    const b = generarCodigo();
    assert.ok(esCodigo(a) && esCodigo(b));
    assert.notEqual(a, b);
  });
  it("rechaza códigos con otros caracteres o de otro largo", () => {
    assert.equal(esCodigo("../../etc/passwd000000"), false);
    assert.equal(esCodigo("corto"), false);
  });
  it("el QR lleva a la página del celular", () => {
    assert.equal(urlQr("AbCdEfGhIjKlMnOpQrStUv"), "https://trimble-docs.vercel.app/ra/q/AbCdEfGhIjKlMnOpQrStUv");
  });
});

describe("estado del QR", () => {
  const ahora = new Date("2026-10-27T15:00:00Z");
  const listo = { estado: "listo" as const };
  it("activo mientras no venza, no se anule y el modelo exista", () => {
    assert.equal(estadoQr({ anulado: null, vence: finDelDia("2026-11-26") }, listo, ahora), "activo");
  });
  it("vale todo el día de vencimiento (hora de Colombia) y no el siguiente", () => {
    const vence = finDelDia("2026-10-27");
    assert.equal(estadoQr({ anulado: null, vence }, listo, new Date("2026-10-28T04:00:00Z")), "activo");
    assert.equal(estadoQr({ anulado: null, vence }, listo, new Date("2026-10-28T05:00:00Z")), "vencido");
  });
  it("anulado gana sobre todo lo demás", () => {
    assert.equal(estadoQr({ anulado: "2026-10-20T00:00:00Z", vence: finDelDia("2026-11-26") }, listo, ahora), "anulado");
  });
  it("si el modelo se eliminó, el QR no abre", () => {
    assert.equal(estadoQr({ anulado: null, vence: finDelDia("2026-11-26") }, { estado: "eliminado" }, ahora), "sin-modelo");
    assert.equal(estadoQr({ anulado: null, vence: finDelDia("2026-11-26") }, null, ahora), "sin-modelo");
  });
  it("la fecha inicial del formulario es hoy + 30 días en Colombia", () => {
    assert.equal(fechaMasDias(new Date("2026-10-27T15:00:00Z"), 30), "2026-11-26");
    // 10 p. m. in Bogotá is already the next day in UTC; the date stays Colombian.
    assert.equal(fechaMasDias(new Date("2026-10-28T03:00:00Z"), 0), "2026-10-27");
  });
});

describe("toque en el visor", () => {
  it("lee el evento tal cual o envuelto en { data }", async () => {
    const { leerToque } = await import("./anclaje");
    const detalle = { position: { x: 1, y: 2, z: 3 }, normal: { x: 0, y: 0, z: 1 }, modelId: "M1", objectRuntimeId: 42 };
    const esperado = { posicion: [1, 2, 3], modelId: "M1", runtimeId: 42 };
    assert.deepEqual(leerToque(detalle), esperado);
    assert.deepEqual(leerToque({ data: detalle }), esperado);
  });
  it("un clic en el vacío (sin objeto) no cuenta", async () => {
    const { leerToque } = await import("./anclaje");
    assert.equal(leerToque({ position: { x: 1, y: 2, z: 3 } }), null);
    assert.equal(leerToque(null), null);
  });
});
