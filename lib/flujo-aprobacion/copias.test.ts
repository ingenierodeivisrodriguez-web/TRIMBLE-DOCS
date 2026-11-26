import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../propiedades/client";
import { copiarUnoPorUno, esperaCarpeta, textoCopias, type Copia } from "./copias";
import { trasladoInicial } from "./traslado";
import type { Traslado } from "./types";

const traslado = (estado: Traslado["estado"], versionId = "v5"): Traslado => ({ ...trasladoInicial({ versionAprobadaId: versionId, revisionAprobada: 5, traslado: null }), estado, carpetaId: "aprob", carpetaRuta: "Obra / Aprobados" });
const lista: Copia[] = ["A-101.pdf", "A-102.pdf", "A-103.pdf", "A-104.pdf"].map((nombre, i) => ({ archivoId: `a${i + 1}`, nombre, carpetaId: "aprob" }));

test("espera carpeta la versión aprobada que no se ha copiado, o cuya copia falló", () => {
  const aprobado = { destino: null, versionAprobadaId: "v5", estado: "aprobado" as const, traslado: null };
  assert.equal(esperaCarpeta(aprobado), true);
  assert.equal(esperaCarpeta({ ...aprobado, traslado: traslado("error") }), true);
  assert.equal(esperaCarpeta({ ...aprobado, traslado: traslado("diferencia") }), true, "a file with that name there: it can go elsewhere");
  assert.equal(esperaCarpeta({ ...aprobado, traslado: traslado("hecho") }), false);
  assert.equal(esperaCarpeta({ ...aprobado, traslado: traslado("en-curso") }), false);
  assert.equal(esperaCarpeta({ ...aprobado, traslado: traslado("hecho", "v4") }), true, "a newer approved version hasn't gone yet");
  assert.equal(esperaCarpeta({ ...aprobado, versionAprobadaId: null }), false);
  assert.equal(esperaCarpeta({ ...aprobado, estado: "retirado" }), false);
  assert.equal(esperaCarpeta({ ...aprobado, destino: "Obra / Entregas" }), false, "older flows copy to their destination by themselves");
});

test("copia uno por uno con el avance, y uno que no va no frena a los demás", async () => {
  const avance: string[] = [];
  const r = await copiarUnoPorUno(
    lista,
    async (c) => {
      if (c.archivoId === "a2") return { traslado: traslado("diferencia"), mensaje: "En «Obra / Aprobados» ya hay un «A-102.pdf» que no llegó por este flujo." };
      if (c.archivoId === "a3") throw new ApiError("Otra persona está copiando este archivo en este momento.", 409, "ocupado");
      return { traslado: traslado(c.archivoId === "a4" ? "en-curso" : "hecho"), mensaje: "Copiado" };
    },
    (n, de, nombre) => avance.push(`${n}/${de} ${nombre}`)
  );
  assert.deepEqual(avance, ["1/4 A-101.pdf", "2/4 A-102.pdf", "3/4 A-103.pdf", "4/4 A-104.pdf"]);
  assert.equal(r.hechas, 2, "one copied and one that Trimble is receiving");
  assert.deepEqual(r.problemas, ["A-102.pdf: En «Obra / Aprobados» ya hay un «A-102.pdf» que no llegó por este flujo.", "A-103.pdf: Otra persona está copiando este archivo en este momento."]);
  assert.equal(r.detenido, null);
  assert.equal(textoCopias(r, "Obra / Aprobados"), "Se copiaron 2 de 4 a «Obra / Aprobados».");
});

test("si la carpeta es de solo lectura no se intenta con los demás", async () => {
  const pedidos: string[] = [];
  const r = await copiarUnoPorUno(lista, async (c) => {
    pedidos.push(c.archivoId);
    throw new ApiError("Solo tienes lectura en «Obra / Aprobados»: elige una carpeta donde Trimble te deje subir archivos.", 403, "sin-acceso");
  });
  assert.deepEqual(pedidos, ["a1"]);
  assert.equal(r.hechas, 0);
  assert.deepEqual(r.problemas, []);
  assert.match(r.detenido!, /Solo tienes lectura/);
  assert.equal(textoCopias(r, "Obra / Aprobados"), "No se copió ninguno a «Obra / Aprobados». Solo tienes lectura en «Obra / Aprobados»: elige una carpeta donde Trimble te deje subir archivos.");
  // The session ended halfway: what was copied stays and the rest isn't tried.
  const s = await copiarUnoPorUno(lista, async (c) => {
    if (c.archivoId === "a3") throw new ApiError("La sesión de Trimble venció: recarga la página.", 401);
    return { traslado: traslado("hecho"), mensaje: "Copiado" };
  });
  assert.equal(s.hechas, 2);
  assert.equal(textoCopias(s), "Se copiaron 2 de 4 a la carpeta. La sesión de Trimble venció: recarga la página.");
});

test("el resumen de las copias en palabras", () => {
  assert.equal(textoCopias({ hechas: 0, total: 0, problemas: [], detenido: null }), "");
  assert.equal(textoCopias({ hechas: 1, total: 1, problemas: [], detenido: null }, "Obra / Aprobados"), "Se copió 1 de 1 a «Obra / Aprobados».");
  assert.equal(textoCopias({ hechas: 0, total: 3, problemas: ["x", "y", "z"], detenido: null }), "No se copió ninguno a la carpeta.");
});
