import { test } from "node:test";
import assert from "node:assert/strict";
import { gruposDeFlujos, idsVisibles, veFlujo, type Quien } from "./visibilidad";
import type { Firma, PasoFlujo, Traslado } from "./types";

const pasos: PasoFlujo[] = [
  { id: "p1", nombre: "Revisa", responsable: { tipo: "grupo", id: "g-arq", nombre: "Arquitectura" } },
  { id: "p2", nombre: "Aprueba", responsable: { tipo: "persona", id: "pepe", nombre: "Pepe" } },
];
const flujo = { id: "f1", pasos, creadoPorId: "ana" };
const archivo = (extra: Record<string, unknown> = {}) => ({ flujoId: "f1", pasos, subidoPorId: "juan", firmas: [] as Firma[], traslado: null as Traslado | null, versionNueva: null, ...extra });
const quien = (id: string, grupos: string[] = [], esAdmin = false): Quien => ({ id, esAdmin, grupos: new Set(grupos) });

test("ven el flujo quien lo creó, los responsables, quienes subieron sus archivos y los administradores", () => {
  const a = [archivo()];
  assert.equal(veFlujo(flujo, a, quien("ana")), true, "creator («Realiza»)");
  assert.equal(veFlujo(flujo, a, quien("pepe")), true, "responsible person");
  assert.equal(veFlujo(flujo, a, quien("luz", ["g-arq"])), true, "member of the responsible group");
  assert.equal(veFlujo(flujo, a, quien("juan")), true, "uploaded one of its files");
  assert.equal(veFlujo(flujo, a, quien("admin", [], true)), true, "a project administrator sees every flow");
  assert.equal(veFlujo(flujo, a, quien("luz")), false, "not involved");
  assert.equal(veFlujo(flujo, a, quien("")), false);
});

test("también quien firmó, copió la versión aprobada o subió una versión más nueva", () => {
  const firma = { pasoId: "p1", paso: "Revisa", decision: "aprobado", quien: "Mar", quienId: "mar", comoAdmin: false, fecha: "2026-11-20T10:00:00Z", revision: 1, versionId: "v1", comentario: "" } as Firma;
  assert.equal(veFlujo(flujo, [archivo({ firmas: [firma] })], quien("mar")), true);
  assert.equal(veFlujo(flujo, [archivo({ traslado: { porId: "teo" } as Traslado })], quien("teo")), true);
  assert.equal(veFlujo(flujo, [archivo({ versionNueva: { subidoPorId: "rui" } })], quien("rui")), true);
  // A responsible kept in a file's own steps (the flow's steps changed later).
  const cambiado = { ...flujo, pasos: [{ id: "p1", nombre: "Revisa", responsable: null }] };
  assert.equal(veFlujo(cambiado, [archivo()], quien("pepe")), true);
  assert.equal(veFlujo(cambiado, [], quien("pepe")), false);
});

test("los grupos se preguntan una vez y cada persona ve solo sus flujos", () => {
  const otro = { id: "f2", pasos: [{ id: "p1", nombre: "Revisa", responsable: { tipo: "grupo" as const, id: "g-est", nombre: "Estructuras" } }], creadoPorId: "luz" };
  const archivos = [archivo(), archivo({ flujoId: "f2", pasos: otro.pasos, subidoPorId: "mar" })];
  assert.deepEqual(gruposDeFlujos([flujo, otro], archivos).sort(), ["g-arq", "g-est"]);
  assert.deepEqual([...idsVisibles([flujo, otro], archivos, quien("luz"))], ["f2"]);
  assert.deepEqual([...idsVisibles([flujo, otro], archivos, quien("luz", ["g-arq"]))], ["f1", "f2"]);
  assert.deepEqual([...idsVisibles([flujo, otro], archivos, quien("mar"))], ["f2"]);
  assert.deepEqual([...idsVisibles([flujo, otro], archivos, quien("x", [], true))], ["f1", "f2"]);
});
