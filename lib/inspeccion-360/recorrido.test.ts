import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { azimutEntre, capturaMasCercana, normalizar360, rumboDesdeCalibracion, vecinos, yawEquivalente, yawHacia } from "./recorrido";
import type { CapturaVista, PuntoVista } from "./types";

const G = Math.PI / 180;
const cerca = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);

function punto(id: string, numero: number, x: number, y: number, extra: Partial<PuntoVista> = {}): PuntoVista {
  return {
    id, projectId: "p", codigo: `LAB-TR1-P5-ALC-C${String(numero).padStart(2, "0")}`, torre: "TR1", piso: "P5", unidad: "ALC", numero,
    espacio: `Espacio ${numero}`, zona: "", referenciaFisica: "", modelId: "m", versionId: null,
    x, y, z: 101.5, alturaM: 1.5, rumboGrados: null, estado: "activo", motivo: "", version: 1,
    creado: "", creadoPor: "", creadoPorNombre: "", actualizado: "", actualizadoPor: null, capturas: 2, ultimaCaptura: null,
    ...extra,
  };
}

describe("rumbo de un punto (clic en la foto y en el modelo)", () => {
  it("azimut en el modelo, antihorario desde +X", () => {
    assert.equal(azimutEntre({ x: 0, y: 0 }, { x: 5, y: 0 }), 0);
    assert.equal(azimutEntre({ x: 0, y: 0 }, { x: 0, y: 5 }), 90);
    assert.equal(azimutEntre({ x: 0, y: 0 }, { x: -5, y: 0 }), 180);
    assert.equal(azimutEntre({ x: 0, y: 0 }, { x: 0, y: -5 }), 270);
  });

  it("la puerta en el centro de la foto y a 90° en el modelo: rumbo 90°", () => {
    assert.equal(rumboDesdeCalibracion(0, 90), 90);
  });

  it("la puerta 30° a la derecha en la foto y a 90° en el modelo: el centro de la foto mira a 120°", () => {
    assert.equal(rumboDesdeCalibracion(30 * G, 90), 120);
    // And back: in that photo, the door is drawn 30° to the right.
    cerca(yawHacia(120, 90), 30 * G);
  });

  it("los grados quedan entre 0 y 360", () => {
    assert.equal(rumboDesdeCalibracion(-100 * G, 45), 305);
    assert.equal(normalizar360(360), 0);
    assert.equal(normalizar360(-0.04), 0);
    assert.equal(normalizar360(725.25), 5.3);
  });
});

describe("puntos vecinos en la foto", () => {
  const a = punto("a", 1, 0, 0, { rumboGrados: 0 });
  const lista = [
    a,
    punto("b", 2, 4, 0), // straight ahead (+X)
    punto("c", 3, 0, 3), // +Y: to the left when facing +X
    punto("d", 4, 30, 0), // too far
    punto("e", 5, 2, 2, { piso: "P6" }), // another floor
    punto("f", 6, -2, 0, { capturas: 0 }), // no photos yet
    punto("g", 7, 0, -2, { estado: "inactivo" }),
  ];

  it("sin rumbo calibrado no se muestra ninguno", () => {
    assert.deepEqual(vecinos({ ...a, rumboGrados: null }, lista), []);
  });

  it("solo los del mismo piso, activos, con fotos y a menos de 20 m, del más cercano al más lejano", () => {
    assert.deepEqual(vecinos(a, lista).map((v) => v.etiqueta), ["C03", "C02"]);
  });

  it("al frente queda en yaw 0; a la izquierda en −90°; sobre el piso donde estuvo su trípode", () => {
    const [c, b] = vecinos(a, lista);
    cerca(b.yaw, 0);
    cerca(c.yaw, -90 * G);
    cerca(b.pitch, Math.atan2(-1.5, 4));
    assert.equal(b.distancia, 4);
    assert.equal(b.codigo, "LAB-TR1-P5-ALC-C02");
  });

  it("con otro rumbo el mismo vecino se corre en la foto", () => {
    const [, b] = vecinos({ ...a, rumboGrados: 30 }, lista);
    cerca(b.yaw, 30 * G);
  });
});

describe("pasar de un punto a otro", () => {
  it("se sigue mirando hacia el mismo lado del modelo", () => {
    // Looking 20° right in A (rumbo 0 → azimuth 340°); B has rumbo 90 → yaw 110° shows azimuth 340°.
    cerca(yawEquivalente(20 * G, 0, 90), 110 * G);
    cerca(yawEquivalente(20 * G, null, 90), 20 * G);
  });

  it("se abre la fecha más cercana a la de la foto de donde viene, sin las anuladas", () => {
    const c = (id: string, tomadaEn: string, estado: CapturaVista["estado"] = "lista") =>
      ({ id, tomadaEn, estado, foto: { estado: "en_cde" } }) as unknown as CapturaVista;
    const capturas = [c("nov20", "2026-11-20T10:00:00-05:00"), c("nov26", "2026-11-26T10:00:00-05:00"), c("nov24", "2026-11-24T10:00:00-05:00", "anulada")];
    assert.equal(capturaMasCercana(capturas, "2026-11-25T09:00:00-05:00")?.id, "nov26");
    assert.equal(capturaMasCercana(capturas, "2026-11-21T09:00:00-05:00")?.id, "nov20");
    assert.equal(capturaMasCercana([], "2026-11-21T09:00:00-05:00"), null);
  });
});
