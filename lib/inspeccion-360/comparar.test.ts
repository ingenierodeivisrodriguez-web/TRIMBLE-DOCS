import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  capturasComparables,
  claveGiro,
  divisionConTecla,
  divisionDesdePuntero,
  giroEnRadianes,
  giroInicial,
  borrarGiroLocal,
  leerGiroLocal,
  motivoFechaNo,
  normalizarGiro,
  opcionesFecha,
  opcionesFechaDe,
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
    giroGrados: 0,
    giroPor: null,
    giroEn: null,
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

describe("fechas para elegir en pantalla completa", () => {
  const MINI = "data:image/jpeg;base64,/9j/4AAQ";

  it("ofrece las fechas comparables con su fecha DD-MM-AAAA HH:MM, inspector y miniatura, de la más nueva a la más vieja", () => {
    const conMini = lista.map((c) => (c.id === "c2" && c.foto ? { ...c, foto: { ...c.foto, miniatura: MINI } } : c));
    const o = opcionesFecha(conMini);
    assert.deepEqual(o.map((x) => x.id), ["c3", "c2", "c1"]);
    assert.deepEqual(o[1], { id: "c2", fecha: "23-11-2026 09:30", tomadaEn: "2026-11-23T09:30:00-05:00", inspector: "Inspector", miniatura: MINI, anulada: false });
    assert.equal(o[0].miniatura, "");
  });

  it("agrega la foto que está en pantalla aunque esté anulada, marcada; nunca una que no está en el CDE", () => {
    const o = opcionesFecha(lista, ["anulada", "subiendo", "no-existe"]);
    assert.deepEqual(o.map((x) => x.id), ["anulada", "c3", "c2", "c1"]);
    assert.equal(o[0].anulada, true);
    assert.deepEqual(opcionesFecha(lista, ["c2"]).map((x) => x.id), ["c3", "c2", "c1"]);
  });

  it("de lo que llega del panel descarta lo mal formado y miniaturas que no son JPEG", () => {
    const o = opcionesFechaDe([
      { id: "a", fecha: "20-11-2026 23:01", tomadaEn: "2026-11-20T23:01:00-05:00", inspector: "Ana", miniatura: MINI, anulada: false },
      { id: "b", fecha: "21-11-2026 10:00", tomadaEn: "2026-11-21T10:00:00-05:00", miniatura: "javascript:alert(1)" },
      { id: "c", fecha: "x", tomadaEn: "no es fecha" },
      { id: 4, fecha: "x", tomadaEn: "2026-11-21T10:00:00-05:00" },
      null,
    ]);
    assert.deepEqual(o.map((x) => x.id), ["a", "b"]);
    assert.equal(o[0].miniatura, MINI);
    assert.equal(o[1].miniatura, "");
    assert.equal(o[1].inspector, "");
    assert.deepEqual(opcionesFechaDe("nada"), []);
  });

  it("dice por qué una fecha no puede ser «antes» o «después»", () => {
    const o = opcionesFecha(lista);
    const [c3, c2, c1] = o;
    const pareja = { antesId: "c2", despuesId: "c3" };
    assert.equal(motivoFechaNo("antes", c1, pareja, o), null);
    assert.equal(motivoFechaNo("antes", c2, pareja, o), null);
    assert.equal(motivoFechaNo("antes", c3, pareja, o), "Es la foto «después»");
    assert.equal(motivoFechaNo("despues", c1, pareja, o), "Es anterior a la foto «antes»");
    assert.equal(motivoFechaNo("despues", c2, pareja, o), "Es la foto «antes»");
    assert.equal(motivoFechaNo("antes", c3, { antesId: "c1", despuesId: "c2" }, o), "Es posterior a la foto «después»");
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

  it("el giro que quedó en el navegador (primera versión) se lee y se olvida; sin almacenamiento vale 0", () => {
    const datos = new Map<string, string>([[claveGiro("c1"), "37.5"]]);
    const almacen = {
      getItem: (k: string) => datos.get(k) ?? null,
      setItem: (k: string, v: string) => void datos.set(k, v),
      removeItem: (k: string) => void datos.delete(k),
    };
    assert.equal(leerGiroLocal("c1", almacen), 37.5);
    assert.equal(leerGiroLocal("c2", almacen), 0);
    borrarGiroLocal("c1", almacen);
    assert.equal(datos.has(claveGiro("c1")), false);
    assert.equal(leerGiroLocal("c1", null), 0);
    const roto = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => {}, removeItem: () => { throw new Error("bloqueado"); } };
    assert.equal(leerGiroLocal("c1", roto), 0);
    assert.doesNotThrow(() => borrarGiroLocal("c1", roto));
  });

  it("manda el giro guardado; si no hay ninguno, un editor recibe el del navegador para guardarlo", () => {
    assert.equal(giroInicial(25, 37.5, true), 25);
    assert.equal(giroInicial(0, 37.5, true), 37.5);
    assert.equal(giroInicial(0, 37.5, false), 0);
    assert.equal(giroInicial(0, 0, true), 0);
  });
});
