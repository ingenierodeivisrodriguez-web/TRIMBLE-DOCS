import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  capturasComparables,
  claveGiro,
  divisionConTecla,
  divisionDesdePuntero,
  giroEnRadianes,
  guardarGiro,
  leerGiro,
  normalizarGiro,
  parejaInicial,
  puedeSer,
} from "./comparar";
import type { CapturaVista, EstadoCaptura, EstadoFoto } from "./types";

function captura(id: string, tomadaEn: string, estado: EstadoCaptura = "lista", foto: EstadoFoto | null = "en_cde"): CapturaVista {
  return {
    id,
    projectId: "p1",
    puntoId: "pt1",
    tomadaEn,
    observaciones: "",
    estado,
    motivo: "",
    inspectorId: "u1",
    inspectorNombre: "Inspector",
    creado: tomadaEn,
    actualizado: tomadaEn,
    actualizadoPor: null,
    foto: foto === null ? null : ({ id: `f-${id}`, estado: foto, ancho: 8192 } as CapturaVista["foto"]),
    puedeAnular: false,
  };
}

const lista = [
  captura("c1", "2026-11-20T23:01:00-05:00"),
  captura("c3", "2026-11-26T15:46:00-05:00"),
  captura("c2", "2026-11-23T09:30:00-05:00"),
  captura("anulada", "2026-11-27T08:00:00-05:00", "anulada"),
  captura("subiendo", "2026-11-28T08:00:00-05:00", "subiendo", "subiendo"),
  captura("error", "2026-11-29T08:00:00-05:00", "error", "error"),
];

describe("fechas que se pueden comparar", () => {
  it("solo las fotos que ya están en el CDE y no están anuladas, de la más nueva a la más vieja", () => {
    assert.deepEqual(capturasComparables(lista).map((c) => c.id), ["c3", "c2", "c1"]);
  });

  it("la pareja inicial: después la más nueva, antes la anterior", () => {
    assert.deepEqual(parejaInicial(lista), { antesId: "c2", despuesId: "c3" });
  });

  it("con una sola foto no hay comparación", () => {
    assert.equal(parejaInicial([captura("c1", "2026-11-20T23:01:00-05:00"), captura("x", "2026-11-21T10:00:00-05:00", "anulada")]), null);
  });

  it("«antes» no puede ser más nueva que «después», ni la misma foto", () => {
    const pareja = { antesId: "c1", despuesId: "c2" };
    const [c1, c3, c2] = lista;
    assert.equal(puedeSer("antes", c1, pareja, lista), true);
    assert.equal(puedeSer("antes", c3, pareja, lista), false);
    assert.equal(puedeSer("antes", c2, pareja, lista), false);
    assert.equal(puedeSer("despues", c3, pareja, lista), true);
    assert.equal(puedeSer("despues", c1, pareja, lista), false);
  });
});

describe("barra de comparación", () => {
  it("la posición sale del puntero, en % del ancho y sin salirse de 0–100", () => {
    assert.equal(divisionDesdePuntero(250, 50, 400), 50);
    assert.equal(divisionDesdePuntero(10, 50, 400), 0);
    assert.equal(divisionDesdePuntero(900, 50, 400), 100);
    assert.equal(divisionDesdePuntero(100, 0, 0), 50);
  });

  it("flechas 2 %, con Mayús 10 %, Inicio y Fin a los bordes; otras teclas no la mueven", () => {
    assert.equal(divisionConTecla(50, "ArrowLeft", false), 48);
    assert.equal(divisionConTecla(50, "ArrowRight", true), 60);
    assert.equal(divisionConTecla(95, "ArrowRight", true), 100);
    assert.equal(divisionConTecla(40, "Home", false), 0);
    assert.equal(divisionConTecla(40, "End", false), 100);
    assert.equal(divisionConTecla(40, "a", false), null);
  });
});

describe("giro de una foto para alinearla con la otra", () => {
  it("queda entre −180° y 180°, redondeado a la décima", () => {
    assert.equal(normalizarGiro(190), -170);
    assert.equal(normalizarGiro(-190), 170);
    assert.equal(normalizarGiro(180), 180);
    assert.equal(normalizarGiro(-180), 180);
    assert.equal(normalizarGiro(720.04), 0);
    assert.equal(normalizarGiro(12.345), 12.3);
    assert.equal(normalizarGiro(Number.NaN), 0);
    assert.ok(Math.abs(giroEnRadianes(90) - Math.PI / 2) < 1e-12);
  });

  it("se guarda por foto en el navegador; 0° borra la marca y sin almacenamiento vale 0", () => {
    const datos = new Map<string, string>();
    const almacen = {
      getItem: (k: string) => datos.get(k) ?? null,
      setItem: (k: string, v: string) => void datos.set(k, v),
      removeItem: (k: string) => void datos.delete(k),
    };
    assert.equal(leerGiro("c1", almacen), 0);
    guardarGiro("c1", 37.5, almacen);
    assert.equal(datos.get(claveGiro("c1")), "37.5");
    assert.equal(leerGiro("c1", almacen), 37.5);
    guardarGiro("c1", 360, almacen);
    assert.equal(datos.has(claveGiro("c1")), false);
    assert.equal(leerGiro("c1", null), 0);
    const roto = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("lleno"); }, removeItem: () => {} };
    assert.equal(leerGiro("c1", roto), 0);
    assert.doesNotThrow(() => guardarGiro("c1", 10, roto));
  });
});
