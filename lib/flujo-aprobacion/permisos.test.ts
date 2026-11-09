import { test } from "node:test";
import assert from "node:assert/strict";
import { accesoDe, aclEfectiva, Equipo, gruposQueImportan, revisarPermisos } from "./permisos";
import type { CarpetaFlujo, PasoFlujo } from "./types";

const ARQ: CarpetaFlujo = { id: "arq", ruta: "Obra / Arquitectura", ancestros: ["raiz"] };
const EST: CarpetaFlujo = { id: "est", ruta: "Obra / Estructura", ancestros: ["raiz"] };
const APR: CarpetaFlujo = { id: "apr", ruta: "Obra / Aprobados", ancestros: ["raiz"] };
const pasos = (revisa: PasoFlujo["responsable"], aprueba: PasoFlujo["responsable"]): PasoFlujo[] => [
  { id: "p1", nombre: "Revisa", responsable: revisa },
  { id: "p2", nombre: "Aprueba", responsable: aprueba },
];
const PEPE = { tipo: "persona" as const, id: "pepe", nombre: "Pepe Gómez" };
const LUZ = { tipo: "persona" as const, id: "luz", nombre: "Luz Mora" };
const DIR = { tipo: "grupo" as const, id: "g-dir", nombre: "Dirección" };

const equipo: Equipo = {
  personas: new Map([
    ["ana", { nombre: "Ana Ruiz", admin: true }],
    ["juan", { nombre: "Juan Pérez", admin: false }],
    ["pepe", { nombre: "Pepe Gómez", admin: false }],
    ["luz", { nombre: "Luz Mora", admin: false }],
  ]),
  grupos: new Map([
    ["g-arq", "Arquitectura"],
    ["g-dir", "Dirección"],
  ]),
  miembros: new Map([
    ["g-arq", new Set(["juan", "luz"])],
    ["g-dir", new Set(["pepe"])],
  ]),
};

test("los permisos que aplican son los propios más los heredados, salvo que la herencia esté apagada", () => {
  const p = { direct: { acl: { READ: ["users:juan"] }, inheritance: true }, inherited: { FULL_ACCESS: ["tc-groups:*"], READ: ["users:juan"] } };
  assert.deepEqual(aclEfectiva(p), { FULL_ACCESS: ["tc-groups:*"], READ: ["users:juan"] });
  assert.deepEqual(aclEfectiva({ ...p, direct: { ...p.direct, inheritance: false } }), { READ: ["users:juan"] });
});

test("el acceso de una persona: lo suyo manda; si no, lo mejor de sus grupos; los administradores ven todo", () => {
  const acl = { FULL_ACCESS: ["tc-groups:g-arq"], READ: ["users:luz", "tc-groups:*"], NO_ACCESS: ["users:pepe"] };
  assert.equal(accesoDe(acl, { tipo: "persona", id: "juan" }, equipo), "FULL_ACCESS");
  assert.equal(accesoDe(acl, { tipo: "persona", id: "luz" }, equipo), "READ");
  assert.equal(accesoDe(acl, { tipo: "persona", id: "pepe" }, equipo), "NO_ACCESS");
  assert.equal(accesoDe(acl, { tipo: "persona", id: "ana" }, equipo), "FULL_ACCESS");
  assert.equal(accesoDe(acl, { tipo: "grupo", id: "g-dir" }, equipo), "READ");
  assert.equal(accesoDe({}, { tipo: "persona", id: "juan" }, equipo), null);
});

test("en las carpetas con archivos del flujo avisa al responsable que no puede abrirlos, y al paso sin responsable", () => {
  const r = revisarPermisos(
    { pasos: [...pasos(PEPE, LUZ), { id: "p3", nombre: "Visto bueno", responsable: null }], destino: null },
    [
      { carpeta: ARQ, acl: { READ: ["tc-groups:g-arq"], NO_ACCESS: ["users:pepe"] } },
      { carpeta: EST, acl: {} },
    ],
    null,
    equipo
  );
  assert.deepEqual(
    r.avisos.map((a) => [a.tipo, a.texto]),
    [
      ["falla", "«Visto bueno» no tiene responsable: solo un administrador podrá decidirlo. Edita el flujo y elígelo."],
      ["falla", "En «Obra / Arquitectura», Pepe Gómez («Revisa») no aparece con acceso: no podrá abrir los archivos del flujo."],
    ]
  );
  assert.deepEqual(
    r.carpetas.map((c) => [c.ruta, c.papel, c.lectura]),
    [
      ["Obra / Arquitectura", "revision", ["Arquitectura (grupo)"]],
      ["Obra / Estructura", "revision", []],
    ]
  );
});

test("un responsable de dos pasos sale una sola vez, con los dos pasos", () => {
  const r = revisarPermisos({ pasos: pasos(PEPE, PEPE), destino: null }, [{ carpeta: ARQ, acl: { READ: ["users:juan"] } }], null, equipo);
  assert.deepEqual(
    r.avisos.map((a) => a.texto),
    ["En «Obra / Arquitectura», Pepe Gómez («Revisa», «Aprueba») no aparece con acceso: no podrá abrir los archivos del flujo."]
  );
});

test("en un flujo de antes con carpeta destino avisa quién puede subir directo ahí y si el aprobador no podría copiar", () => {
  const abierto = revisarPermisos({ pasos: pasos(PEPE, DIR), destino: APR }, [], { FULL_ACCESS: ["tc-groups:*", "users:juan", "users:ana", "tc-groups:g-dir"] }, equipo);
  assert.deepEqual(
    abierto.avisos.map((a) => a.texto),
    [
      "En la carpeta destino «Obra / Aprobados» todos los miembros del proyecto tienen acceso completo: cualquiera puede subir archivos sin pasar por el flujo.",
      "En la carpeta destino también tiene acceso completo Juan Pérez: puede subir archivos sin pasar por el flujo.",
    ]
  );
  const cerrado = revisarPermisos({ pasos: pasos(PEPE, LUZ), destino: APR }, [], { FULL_ACCESS: ["tc-groups:g-dir"], READ: ["users:luz"] }, equipo);
  assert.deepEqual(
    cerrado.avisos.map((a) => [a.tipo, a.texto]),
    [
      ["riesgo", "En la carpeta destino también tiene acceso completo Dirección (grupo): puede subir archivos sin pasar por el flujo."],
      ["falla", "Luz Mora aprueba («Aprueba») pero no aparece con acceso completo a la carpeta destino: la copia con su usuario fallaría y la tendría que hacer un administrador."],
    ]
  );
  assert.deepEqual(cerrado.carpetas[0], { ruta: "Obra / Aprobados", papel: "destino", completo: ["Dirección (grupo)"], lectura: ["Luz Mora"], sinAcceso: [] });
  // Without permissions listed there, it says so without inventing failures.
  assert.deepEqual(
    revisarPermisos({ pasos: pasos(PEPE, LUZ), destino: APR }, [], {}, equipo).avisos.map((a) => a.tipo),
    ["info"]
  );
});

test("los grupos que importan salen de los permisos y de los responsables", () => {
  assert.deepEqual(gruposQueImportan([{ FULL_ACCESS: ["tc-groups:*", "tc-groups:g1", "users:x"] }, { READ: ["tc-groups:g2"] }], [{ tipo: "grupo", id: "g3" }, PEPE]), ["g1", "g2", "g3"]);
});
