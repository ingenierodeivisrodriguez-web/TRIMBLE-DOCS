import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asignacionesAfectadas,
  avisosCobertura,
  cambiosFlujo,
  claveHito,
  conflictos,
  describirPasos,
  flujoDe,
  idsDePasos,
  nombrePapel,
  responsablesDe,
  revisarDatos,
} from "./flujos";
import type { Asignacion, CarpetaFlujo, Flujo } from "./types";

// Project tree: raíz > Diseño > {Arquitectura > Torre 1, Estructura}, raíz > Aprobados
const RAIZ: CarpetaFlujo = { id: "raiz", ruta: "Obra", ancestros: [] };
const DISENO: CarpetaFlujo = { id: "dis", ruta: "Obra / Diseño", ancestros: ["raiz"] };
const ARQ: CarpetaFlujo = { id: "arq", ruta: "Obra / Diseño / Arquitectura", ancestros: ["raiz", "dis"] };
const TORRE1: CarpetaFlujo = { id: "t1", ruta: "Obra / Diseño / Arquitectura / Torre 1", ancestros: ["raiz", "dis", "arq"] };
const EST: CarpetaFlujo = { id: "est", ruta: "Obra / Diseño / Estructura", ancestros: ["raiz", "dis"] };
const APROBADOS: CarpetaFlujo = { id: "apr", ruta: "Obra / Aprobados", ancestros: ["raiz"] };
const APR_ARQ: CarpetaFlujo = { id: "apr-arq", ruta: "Obra / Aprobados / Arquitectura", ancestros: ["raiz", "apr"] };

function flujo(id: string, hito: string, carpetas: CarpetaFlujo[], destino: CarpetaFlujo, activo = true): Flujo {
  return {
    id,
    proyecto: "P",
    hito,
    hitoClave: claveHito(hito),
    pasos: [
      { id: "p1", nombre: "Revisa" },
      { id: "p2", nombre: "Aprueba" },
    ],
    carpetas,
    destino,
    activo,
    version: 1,
    creado: "2026-11-04T10:00:00Z",
    creadoPor: "Ana",
    actualizado: "2026-11-04T10:00:00Z",
    actualizadoPor: "Ana",
  };
}

let n = 0;
function asignacion(objetivo: CarpetaFlujo | { id: string; ruta: string; ancestros: string[] }, papel: string, quien: string, extra: Partial<Asignacion> = {}): Asignacion {
  return {
    id: `a${++n}`,
    flujoId: "f1",
    proyecto: "P",
    objetivoTipo: "carpeta",
    objetivoId: objetivo.id,
    objetivoRuta: objetivo.ruta,
    objetivoAncestros: objetivo.ancestros,
    papel,
    quienTipo: "persona",
    quienId: quien,
    quienNombre: quien,
    activa: true,
    creado: "2026-11-04T10:00:00Z",
    creadoPor: "Ana",
    ...extra,
  };
}

const datos = (cambios: Partial<Parameters<typeof revisarDatos>[0]> = {}) => ({
  hito: "Aprobar diseño arquitectónico Torre 1",
  carpetas: ["arq"],
  destino: "apr",
  pasos: [{ nombre: "Revisa" }, { nombre: "Aprueba" }],
  ...cambios,
});

test("el hito se compara sin tildes, mayúsculas ni espacios dobles", () => {
  assert.equal(claveHito("  Aprobar  DISEÑO arquitectónico   Torre 1 "), "aprobar diseno arquitectonico torre 1");
});

test("un flujo necesita hito, carpetas de revisión, destino fuera de ellas y de 1 a 5 pasos con nombres distintos", () => {
  assert.equal(revisarDatos(datos()), null);
  assert.match(revisarDatos(datos({ hito: "  A " }))!, /título o hito/);
  assert.match(revisarDatos(datos({ carpetas: [] }))!, /al menos una carpeta de revisión/);
  assert.match(revisarDatos(datos({ destino: "" }))!, /Elige la carpeta destino/);
  assert.match(revisarDatos(datos({ destino: "arq" }))!, /no puede ser también una carpeta de revisión/);
  assert.match(revisarDatos(datos({ pasos: [] }))!, /de 1 a 5 pasos/);
  assert.match(revisarDatos(datos({ pasos: Array.from({ length: 6 }, (_, i) => ({ nombre: `Paso ${i}` })) }))!, /de 1 a 5 pasos/);
  assert.match(revisarDatos(datos({ pasos: [{ nombre: "Revisa" }, { nombre: " " }] }))!, /Paso 3: escribe su nombre/);
  assert.match(revisarDatos(datos({ pasos: [{ nombre: "realiza" }] }))!, /Paso 2: «Realiza» y «Consulta» ya existen/);
  assert.match(revisarDatos(datos({ pasos: [{ nombre: "Revisa" }, { nombre: "REVISA" }] }))!, /Dos pasos se llaman «REVISA»/);
});

test("los pasos que ya existían conservan su id y los nuevos toman el siguiente libre", () => {
  const antes = [
    { id: "p1", nombre: "Revisa" },
    { id: "p3", nombre: "Aprueba" },
  ];
  assert.deepEqual(idsDePasos([{ id: "p3", nombre: " Aprueba  final " }, { nombre: "Visto bueno" }, { id: "p9", nombre: "Inventado" }], antes), [
    { id: "p3", nombre: "Aprueba final" },
    { id: "p4", nombre: "Visto bueno" },
    { id: "p5", nombre: "Inventado" },
  ]);
  assert.deepEqual(idsDePasos([{ nombre: "Revisa" }], []), [{ id: "p1", nombre: "Revisa" }]);
});

test("una carpeta solo puede estar en un flujo activo", () => {
  const otro = flujo("f2", "Aprobar estructura", [ARQ], APR_ARQ);
  assert.match(conflictos({ carpetas: [ARQ], destino: APROBADOS }, [otro]).join(" "), /«Obra \/ Diseño \/ Arquitectura» ya es carpeta de revisión del flujo «Aprobar estructura»/);
  // Inactive flows and the flow itself don't count.
  assert.deepEqual(conflictos({ carpetas: [ARQ], destino: APROBADOS }, [{ ...otro, activo: false }]), []);
  assert.deepEqual(conflictos({ id: "f2", carpetas: [ARQ], destino: APR_ARQ }, [otro]), []);
  // Nested folders are allowed: the closest flow wins.
  assert.deepEqual(conflictos({ carpetas: [TORRE1], destino: APROBADOS }, [otro]), []);
});

test("la carpeta destino no puede estar dentro de una carpeta de revisión, ni al revés", () => {
  assert.match(conflictos({ carpetas: [DISENO], destino: ARQ }, []).join(" "), /La carpeta destino «Obra \/ Diseño \/ Arquitectura» de este flujo está dentro de «Obra \/ Diseño», carpeta de revisión de este flujo/);
  assert.match(conflictos({ carpetas: [APR_ARQ], destino: APROBADOS }, []).join(" "), /La carpeta de revisión «Obra \/ Aprobados \/ Arquitectura» de este flujo está dentro de «Obra \/ Aprobados», carpeta destino de este flujo/);
  // Against another flow, both ways.
  const otro = flujo("f2", "Aprobar estructura", [EST], APROBADOS);
  assert.match(conflictos({ carpetas: [ARQ], destino: EST }, [otro]).join(" "), /carpeta destino «Obra \/ Diseño \/ Estructura» de este flujo está dentro de «Obra \/ Diseño \/ Estructura», carpeta de revisión del flujo «Aprobar estructura»/);
  assert.match(conflictos({ carpetas: [APR_ARQ], destino: TORRE1 }, [otro]).join(" "), /carpeta de revisión «Obra \/ Aprobados \/ Arquitectura» de este flujo está dentro de «Obra \/ Aprobados», carpeta destino del flujo «Aprobar estructura»/);
  assert.deepEqual(conflictos({ carpetas: [ARQ], destino: APR_ARQ }, [otro]), [], "two destinations nested is fine");
});

test("un archivo pertenece al flujo de su carpeta de revisión más cercana", () => {
  const general = flujo("f1", "Aprobar diseño", [DISENO], APROBADOS);
  const torre = flujo("f2", "Aprobar Torre 1", [TORRE1], APR_ARQ);
  const archivo = { id: "x", ancestros: ["raiz", "dis", "arq", "t1"] };
  assert.equal(flujoDe(archivo, [general, torre])?.flujo.id, "f2");
  assert.equal(flujoDe({ id: "y", ancestros: ["raiz", "dis", "est"] }, [general, torre])?.flujo.id, "f1");
  assert.equal(flujoDe(archivo, [general, { ...torre, activo: false }])?.flujo.id, "f1");
  assert.equal(flujoDe({ id: "z", ancestros: ["raiz", "apr"] }, [general, torre]), null);
});

test("manda la asignación del archivo, luego la de la carpeta más cercana", () => {
  const archivo = { id: "modelo", ruta: "Torre 1 / modelo.rvt", ancestros: ["raiz", "dis", "arq", "t1"] };
  const enArq = asignacion(ARQ, "p1", "juan");
  const enTorre = asignacion(TORRE1, "p1", "pepe");
  const enArchivo = asignacion(archivo, "p1", "luz", { objetivoTipo: "archivo" });
  const aprueba = asignacion(ARQ, "p2", "ana");
  assert.deepEqual(
    responsablesDe(archivo, "p1", [enArq, enTorre, enArchivo, aprueba]).map((a) => a.quienId),
    ["luz"]
  );
  assert.deepEqual(
    responsablesDe(archivo, "p1", [enArq, enTorre, aprueba]).map((a) => a.quienId),
    ["pepe"]
  );
  assert.deepEqual(
    responsablesDe(archivo, "p2", [enArq, enTorre, aprueba]).map((a) => a.quienId),
    ["ana"]
  );
  assert.deepEqual(responsablesDe(archivo, "p1", [{ ...enTorre, activa: false }, enArq]).map((a) => a.quienId), ["juan"]);
});

test("avisa los pasos sin nadie en una carpeta de revisión completa", () => {
  const f = flujo("f1", "Aprobar diseño", [ARQ, EST], APROBADOS);
  const avisos = avisosCobertura(f, [asignacion(ARQ, "p1", "juan"), asignacion(ARQ, "p2", "ana"), asignacion(EST, "p1", "pepe"), asignacion(TORRE1, "p2", "luz")]);
  assert.deepEqual(avisos, ["En «Obra / Diseño / Estructura» nadie tiene el paso «Aprueba»: donde no haya a quién asignado, solo los administradores podrán hacerlo."]);
});

test("quitar un paso o una carpeta deja sin sentido sus asignaciones", () => {
  const f = flujo("f1", "Aprobar diseño", [ARQ, EST], APROBADOS);
  const a1 = asignacion(ARQ, "p1", "juan");
  const a2 = asignacion(EST, "p2", "ana");
  const a3 = asignacion(TORRE1, "realiza", "pepe");
  const a4 = asignacion(EST, "consulta", "luz", { activa: false });
  assert.deepEqual(
    asignacionesAfectadas([a1, a2, a3, a4], [{ id: "p2", nombre: "Aprueba" }], f.carpetas).map((a) => a.quienId),
    ["juan"]
  );
  assert.deepEqual(
    asignacionesAfectadas([a1, a2, a3, a4], f.pasos, [ARQ]).map((a) => a.quienId),
    ["ana"]
  );
});

test("los papeles y los cambios del flujo se dicen en palabras", () => {
  const f = flujo("f1", "Aprobar diseño", [ARQ], APROBADOS);
  assert.equal(nombrePapel("realiza", f.pasos), "Realiza");
  assert.equal(nombrePapel("consulta", f.pasos), "Consulta");
  assert.equal(nombrePapel("p2", f.pasos), "Aprueba");
  assert.equal(nombrePapel("p7", f.pasos), "(paso quitado)");
  assert.equal(describirPasos(f.pasos), "Realiza → Revisa → Aprueba");
  assert.equal(
    cambiosFlujo(f, { hito: "Aprobar diseño arquitectónico Torre 1", pasos: [{ id: "p2", nombre: "Aprueba" }], carpetas: [ARQ, EST], destino: APR_ARQ }),
    "Hito: «Aprobar diseño arquitectónico Torre 1» (antes «Aprobar diseño»). Pasos: Realiza → Aprueba (antes Realiza → Revisa → Aprueba). Carpetas de revisión agregadas: Obra / Diseño / Estructura. Carpeta destino: Obra / Aprobados / Arquitectura (antes Obra / Aprobados)."
  );
  assert.equal(cambiosFlujo(f, f), "Sin cambios.");
});

void RAIZ;
