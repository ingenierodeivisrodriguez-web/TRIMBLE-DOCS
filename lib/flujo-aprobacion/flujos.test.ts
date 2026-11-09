import { test } from "node:test";
import assert from "node:assert/strict";
import { cambiosFlujo, claveHito, conflictosArchivos, describirPasos, describirResponsables, idsDePasos, nombreDeRuta, puedeCambiar, revisarDatos } from "./flujos";
import type { ArchivoFlujo, Flujo, PasoFlujo } from "./types";

const MODELO: ArchivoFlujo = { id: "modelo", ruta: "Obra / Diseño / Arquitectura / modelo.rvt", ancestros: ["raiz", "dis", "arq"] };
const PLANO: ArchivoFlujo = { id: "plano", ruta: "Obra / Diseño / Estructura / E-101.pdf", ancestros: ["raiz", "dis", "est"] };
const ANA = { tipo: "persona" as const, id: "ana", nombre: "Ana Ruiz" };
const ARQ = { tipo: "grupo" as const, id: "g-arq", nombre: "Arquitectura" };
const PASOS: PasoFlujo[] = [
  { id: "p1", nombre: "Revisa", responsable: ARQ },
  { id: "p2", nombre: "Aprueba", responsable: ANA },
];

function flujo(id: string, hito: string, archivos: ArchivoFlujo[], activo = true): Flujo {
  return {
    id,
    proyecto: "P",
    hito,
    hitoClave: claveHito(hito),
    pasos: PASOS,
    archivos,
    carpetas: [],
    destino: null,
    activo,
    version: 1,
    creado: "2026-11-09T10:00:00Z",
    creadoPor: "Juan",
    creadoPorId: "juan",
    actualizado: "2026-11-09T10:00:00Z",
    actualizadoPor: "Juan",
  };
}

const datos = (cambios: Partial<Parameters<typeof revisarDatos>[0]> = {}) => ({
  hito: "Aprobar diseño arquitectónico Torre 1",
  archivos: ["modelo"],
  pasos: [
    { nombre: "Revisa", responsable: { tipo: "grupo" as const, id: "g-arq" } },
    { nombre: "Aprueba", responsable: { tipo: "persona" as const, id: "ana" } },
  ],
  ...cambios,
});

test("el hito se compara sin tildes, mayúsculas ni espacios dobles", () => {
  assert.equal(claveHito("  Aprobar  DISEÑO arquitectónico   Torre 1 "), "aprobar diseno arquitectonico torre 1");
});

test("un flujo necesita hito, al menos un archivo y de 1 a 5 pasos con nombres distintos, cada uno con su responsable", () => {
  assert.equal(revisarDatos(datos()), null);
  assert.match(revisarDatos(datos({ hito: "  A " }))!, /título o hito/);
  assert.match(revisarDatos(datos({ archivos: [] }))!, /Marca al menos un archivo del flujo/);
  assert.match(revisarDatos(datos({ archivos: Array.from({ length: 101 }, (_, i) => `a${i}`) }))!, /hasta 100 archivos/);
  assert.match(revisarDatos(datos({ pasos: [] }))!, /de 1 a 5 pasos/);
  const conResp = (nombre: string) => ({ nombre, responsable: ANA });
  assert.match(revisarDatos(datos({ pasos: Array.from({ length: 6 }, (_, i) => conResp(`Paso ${i}`)) }))!, /de 1 a 5 pasos/);
  assert.match(revisarDatos(datos({ pasos: [conResp("Revisa"), conResp(" ")] }))!, /Paso 3: escribe su nombre/);
  assert.match(revisarDatos(datos({ pasos: [conResp("realiza")] }))!, /Paso 2: «Realiza» ya es el primer paso/);
  assert.match(revisarDatos(datos({ pasos: [conResp("Revisa"), conResp("REVISA")] }))!, /Dos pasos se llaman «REVISA»/);
  assert.match(revisarDatos(datos({ pasos: [conResp("Revisa"), { nombre: "Aprueba", responsable: null }] }))!, /Paso 3 \(«Aprueba»\): elige su responsable/);
});

test("los pasos que ya existían conservan su id y los nuevos toman el siguiente libre; el responsable pasa igual", () => {
  const antes = [
    { id: "p1", nombre: "Revisa" },
    { id: "p3", nombre: "Aprueba" },
  ];
  assert.deepEqual(idsDePasos([{ id: "p3", nombre: " Aprueba  final " }, { nombre: "Visto bueno" }, { id: "p9", nombre: "Inventado" }], antes), [
    { id: "p3", nombre: "Aprueba final" },
    { id: "p4", nombre: "Visto bueno" },
    { id: "p5", nombre: "Inventado" },
  ]);
  assert.deepEqual(idsDePasos([{ nombre: "Revisa", responsable: { tipo: "persona", id: "ana" } }], []), [{ id: "p1", nombre: "Revisa", responsable: { tipo: "persona", id: "ana" } }]);
});

test("un archivo solo puede estar en un flujo activo", () => {
  const otro = flujo("f2", "Aprobar estructura", [PLANO]);
  assert.deepEqual(conflictosArchivos({ archivos: [MODELO, PLANO] }, [otro]), [
    "«Obra / Diseño / Estructura / E-101.pdf» ya está en el flujo activo «Aprobar estructura»: un archivo solo puede estar en un flujo activo.",
  ]);
  // Inactive flows and the flow itself don't count.
  assert.deepEqual(conflictosArchivos({ archivos: [PLANO] }, [{ ...otro, activo: false }]), []);
  assert.deepEqual(conflictosArchivos({ id: "f2", archivos: [PLANO] }, [otro]), []);
});

test("los pasos, sus responsables y los cambios del flujo se dicen en palabras", () => {
  const f = flujo("f1", "Aprobar diseño", [MODELO]);
  assert.equal(describirPasos(f.pasos), "Realiza → Revisa → Aprueba");
  assert.equal(describirResponsables(f.pasos), "Revisa: Arquitectura (grupo); Aprueba: Ana Ruiz");
  assert.equal(nombreDeRuta(MODELO.ruta), "modelo.rvt");
  assert.equal(nombreDeRuta("Laboratorio"), "Laboratorio", "the project's root folder");
  assert.equal(
    cambiosFlujo(f, {
      hito: "Aprobar diseño arquitectónico Torre 1",
      pasos: [
        { id: "p2", nombre: "Aprueba", responsable: { tipo: "persona", id: "luz", nombre: "Luz Gómez" } },
        { id: "p3", nombre: "Visto bueno", responsable: ANA },
      ],
      archivos: [PLANO],
    }),
    "Hito: «Aprobar diseño arquitectónico Torre 1» (antes «Aprobar diseño»). Pasos: Realiza → Aprueba → Visto bueno (antes Realiza → Revisa → Aprueba). Responsable de «Aprueba»: Luz Gómez (antes Ana Ruiz). Responsables de los pasos nuevos: Visto bueno: Ana Ruiz. Archivos agregados: E-101.pdf. Archivos quitados: modelo.rvt."
  );
  assert.equal(cambiosFlujo(f, f), "Sin cambios.");
});

test("cambia el flujo quien lo creó o un administrador del proyecto", () => {
  const f = flujo("f1", "Aprobar diseño", [MODELO]);
  assert.equal(puedeCambiar(f, { id: "juan", esAdmin: false }), true);
  assert.equal(puedeCambiar(f, { id: "pepe", esAdmin: false }), false);
  assert.equal(puedeCambiar(f, { id: "pepe", esAdmin: true }), true);
  // A flow from before (no creator id): only administrators.
  assert.equal(puedeCambiar({ creadoPorId: null }, { id: "juan", esAdmin: false }), false);
});
