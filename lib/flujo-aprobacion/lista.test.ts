import { test } from "node:test";
import assert from "node:assert/strict";
import { cambiosFlujo, claveHito, revisarDatos } from "./flujos";
import { estaVencido, filasFlujos, filtrarFilas, opcionesFiltro, responsablesFlujo, sumarDias } from "./lista";
import type { EstadoArchivo, Flujo, PasoFlujo, Responsable } from "./types";

const HOY = "2026-11-06";
const persona = (id: string, nombre: string): Responsable => ({ tipo: "persona", id, nombre });
const pasos = (revisa: Responsable | null, aprueba: Responsable | null): PasoFlujo[] => [
  { id: "p1", nombre: "Revisa", responsable: revisa },
  { id: "p2", nombre: "Aprueba", responsable: aprueba },
];
const flujo = (id: string, hito: string, extra: Partial<Flujo> = {}): Flujo => ({
  id,
  proyecto: "P",
  hito,
  hitoClave: claveHito(hito),
  pasos: pasos(null, null),
  archivos: [],
  carpetas: [],
  destino: null,
  activo: true,
  version: 1,
  creado: "",
  creadoPor: "Ana Ruiz",
  actualizado: "",
  actualizadoPor: null,
  ...extra,
});
const archivo = (flujoId: string, estado: EstadoArchivo, meToca = false) => ({ flujoId, estado, meToca });

const TORRE = flujo("f1", "Aprobar Torre 1", { vence: "2026-11-05", pasos: pasos({ tipo: "grupo", id: "g-arq", nombre: "Arquitectura" }, persona("pepe", "Pepe Gómez")) });
const ESTRUCTURA = flujo("f2", "Aprobar estructura", { vence: "2026-11-10", creadoPor: "Deivis", pasos: pasos(persona("luz", "Luz Mora"), persona("luz", "Luz Mora")) });
const VIEJO = flujo("f3", "Aprobar anteproyecto", { activo: false });
const ARCHIVOS = [archivo("f1", "pendiente", true), archivo("f1", "nueva-version"), archivo("f1", "aprobado"), archivo("f2", "aprobado")];

test("cada fila trae archivos, pendientes, lo que me toca, responsables por paso y estado", () => {
  const filas = filasFlujos([VIEJO, ESTRUCTURA, TORRE], ARCHIVOS, HOY);
  assert.deepEqual(
    filas.map((f) => [f.flujo.hito, f.archivos, f.pendientes, f.porRevisar, f.estado]),
    [
      ["Aprobar estructura", 1, 0, 0, "activo"],
      ["Aprobar Torre 1", 3, 2, 1, "vencido"],
      ["Aprobar anteproyecto", 0, 0, 0, "desactivado"],
    ]
  );
  assert.deepEqual(responsablesFlujo(TORRE), ["Arquitectura (grupo)", "Pepe Gómez"], "step order");
  assert.deepEqual(responsablesFlujo(ESTRUCTURA), ["Luz Mora"], "without repeats");
  assert.deepEqual(responsablesFlujo(VIEJO), [], "steps without responsible");
});

test("un flujo está vencido solo si pasó la fecha, está activo y tiene archivos esperando", () => {
  assert.equal(estaVencido({ activo: true, vence: "2026-11-05" }, 2, HOY), true);
  assert.equal(estaVencido({ activo: true, vence: "2026-11-05" }, 0, HOY), false, "nothing waiting");
  assert.equal(estaVencido({ activo: true, vence: "2026-11-06" }, 2, HOY), false, "today is still in time");
  assert.equal(estaVencido({ activo: false, vence: "2026-11-01" }, 2, HOY), false);
  assert.equal(estaVencido({ activo: true, vence: null }, 2, HOY), false);
  assert.equal(sumarDias("2026-12-28", 7), "2027-01-04");
});

test("los filtros: propietario, persona o grupo asignado, estado, vencimiento, tengo por revisar y texto", () => {
  const filas = filasFlujos([VIEJO, ESTRUCTURA, TORRE], ARCHIVOS, HOY);
  const hitos = (f: Parameters<typeof filtrarFilas>[1]) => filtrarFilas(filas, f, HOY).map((x) => x.flujo.hito);
  assert.deepEqual(hitos({ propietario: "Deivis" }), ["Aprobar estructura"]);
  assert.deepEqual(hitos({ quien: "grupo:g-arq" }), ["Aprobar Torre 1"]);
  assert.deepEqual(hitos({ quien: "persona:luz" }), ["Aprobar estructura"]);
  assert.deepEqual(hitos({ quien: "persona:pepe" }), ["Aprobar Torre 1"]);
  assert.deepEqual(hitos({ estado: "desactivado" }), ["Aprobar anteproyecto"]);
  assert.deepEqual(hitos({ vence: "vencidos" }), ["Aprobar Torre 1"]);
  assert.deepEqual(hitos({ vence: "7dias" }), ["Aprobar estructura"]);
  assert.deepEqual(hitos({ vence: "sin-fecha" }), ["Aprobar anteproyecto"]);
  assert.deepEqual(hitos({ porRevisar: true }), ["Aprobar Torre 1"]);
  assert.deepEqual(hitos({ texto: "TORRE" }), ["Aprobar Torre 1"]);
  const o = opcionesFiltro(filas);
  assert.deepEqual(o.propietarios, ["Ana Ruiz", "Deivis"]);
  assert.deepEqual(
    o.grupos.map((g) => g.nombre),
    ["Arquitectura"]
  );
  assert.deepEqual(
    o.personas.map((p) => p.nombre),
    ["Luz Mora", "Pepe Gómez"]
  );
});

test("vencimiento y notas se validan y quedan en los cambios del flujo", () => {
  const base = { hito: "Aprobar Torre 1", archivos: ["modelo"], pasos: [{ nombre: "Aprueba", responsable: { tipo: "persona" as const, id: "pepe" } }] };
  assert.equal(revisarDatos({ ...base, vence: "2026-11-25", notas: "Entrega del diseñador" }), null);
  assert.match(revisarDatos({ ...base, vence: "2026-02-30" })!, /fecha de vencimiento no es válida/);
  assert.match(revisarDatos({ ...base, notas: "x".repeat(2001) })!, /hasta 2000/);
  const f = { hito: "A", pasos: [], archivos: [] };
  assert.equal(cambiosFlujo({ ...f, vence: null, notas: "" }, { ...f, vence: "2026-11-25", notas: "Nueva" }), "Vencimiento: 25-11-2026 (antes sin fecha). Cambió las notas.");
});
