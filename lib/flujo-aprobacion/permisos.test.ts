import { test } from "node:test";
import assert from "node:assert/strict";
import { accesoDe, aclEfectiva, Equipo, gruposQueImportan, revisarPermisos } from "./permisos";
import type { Asignacion, CarpetaFlujo } from "./types";

const ARQ: CarpetaFlujo = { id: "arq", ruta: "Obra / Arquitectura", ancestros: ["raiz"] };
const APR: CarpetaFlujo = { id: "apr", ruta: "Obra / Aprobados", ancestros: ["raiz"] };
const FLUJO = {
  pasos: [
    { id: "p1", nombre: "Revisa" },
    { id: "p2", nombre: "Aprueba" },
  ],
  carpetas: [ARQ],
  destino: APR,
};

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

let n = 0;
const asig = (papel: string, quienTipo: "persona" | "grupo", quienId: string, quienNombre: string, objetivo = ARQ): Asignacion => ({
  id: `a${++n}`,
  flujoId: "f1",
  proyecto: "P",
  objetivoTipo: "carpeta",
  objetivoId: objetivo.id,
  objetivoRuta: objetivo.ruta,
  objetivoAncestros: objetivo.ancestros,
  papel,
  quienTipo,
  quienId,
  quienNombre,
  activa: true,
  creado: "",
  creadoPor: null,
});

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

test("avisa quién puede subir directo al destino y qué aprobador no podría copiar", () => {
  const asignaciones = [asig("p2", "grupo", "g-dir", "Dirección"), asig("p2", "persona", "luz", "Luz Mora"), asig("p1", "persona", "juan", "Juan Pérez")];
  const destino = { FULL_ACCESS: ["tc-groups:*", "users:juan", "users:ana", "tc-groups:g-dir"] as string[] };
  const r = revisarPermisos(FLUJO, asignaciones, { destino, carpetas: new Map([["arq", { FULL_ACCESS: ["tc-groups:*"] }]]) }, equipo);
  assert.deepEqual(
    r.avisos.map((a) => a.texto),
    [
      "En la carpeta destino «Obra / Aprobados» todos los miembros del proyecto tienen acceso completo: cualquiera puede subir archivos sin pasar por el flujo.",
      "En la carpeta destino también tiene acceso completo Juan Pérez: puede subir archivos sin pasar por el flujo.",
    ]
  );
  // Without "everyone", Luz (approver) has nothing there.
  const cerrado = revisarPermisos(FLUJO, asignaciones, { destino: { FULL_ACCESS: ["tc-groups:g-dir"], READ: ["users:luz"] }, carpetas: new Map() }, equipo);
  assert.deepEqual(
    cerrado.avisos.map((a) => [a.tipo, a.texto]),
    [["falla", "Luz Mora aprueba («Aprueba») pero no aparece con acceso completo a la carpeta destino: la copia con su usuario fallaría y la tendría que hacer un administrador."]]
  );
  assert.deepEqual(cerrado.carpetas[0], { ruta: "Obra / Aprobados", papel: "destino", completo: ["Dirección (grupo)"], lectura: ["Luz Mora"], sinAcceso: [] });
});

test("en una carpeta de revisión avisa a quien no puede abrir y a quien realiza con solo lectura", () => {
  const asignaciones = [asig("realiza", "grupo", "g-arq", "Arquitectura"), asig("p1", "persona", "pepe", "Pepe Gómez"), asig("p2", "persona", "ana", "Ana Ruiz")];
  const r = revisarPermisos(FLUJO, asignaciones, { destino: { FULL_ACCESS: ["users:ana"] }, carpetas: new Map([["arq", { READ: ["tc-groups:g-arq"], NO_ACCESS: ["users:pepe"] }]]) }, equipo);
  assert.deepEqual(
    r.avisos.map((a) => a.texto),
    ["En «Obra / Arquitectura», Arquitectura (grupo) realiza pero solo tiene lectura: no podrá subir archivos.", "En «Obra / Arquitectura», Pepe Gómez no aparece con acceso: no podrá abrir los archivos."]
  );
});

test("sin permisos listados en el destino lo dice, sin inventar fallas", () => {
  const r = revisarPermisos(FLUJO, [asig("p2", "persona", "luz", "Luz Mora")], { destino: {}, carpetas: new Map() }, equipo);
  assert.deepEqual(
    r.avisos.map((a) => a.tipo),
    ["info"]
  );
});

test("los grupos que importan salen de los permisos y de las asignaciones", () => {
  assert.deepEqual(gruposQueImportan([{ FULL_ACCESS: ["tc-groups:*", "tc-groups:g1", "users:x"] }, { READ: ["tc-groups:g2"] }], [asig("p1", "grupo", "g3", "G3")]), ["g1", "g2", "g3"]);
});
