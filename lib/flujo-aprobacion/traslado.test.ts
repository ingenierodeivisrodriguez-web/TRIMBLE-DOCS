import { test } from "node:test";
import assert from "node:assert/strict";
import { aprobador, carpetaDeRevision, puedeTrasladar, situacionDestino, subcarpetas, textoTraslado, trasladoInicial } from "./traslado";
import type { Firma, Traslado } from "./types";

const ARQ = { id: "arq", ruta: "Obra / Arquitectura", ancestros: ["raiz"] };
const T1 = { id: "t1", ruta: "Obra / Arquitectura / Torre 1", ancestros: ["raiz", "arq"] };
const firma = (quienId: string, quien: string, decision: Firma["decision"] = "aprobado"): Firma => ({
  pasoId: "p1",
  paso: "Revisa",
  decision,
  quien,
  quienId,
  comoAdmin: false,
  fecha: "2026-11-04T23:00:00Z",
  revision: 5,
  versionId: "v5",
  comentario: "",
});

test("se recrean bajo el destino las subcarpetas entre la carpeta de revisión y el archivo", () => {
  const a = { fileId: "f", ancestros: ["raiz", "arq", "t1", "planos"], ruta: "Obra / Arquitectura / Torre 1 / Planos / A-101.pdf" };
  assert.deepEqual(subcarpetas(a, ARQ), ["Torre 1", "Planos"]);
  assert.deepEqual(subcarpetas({ ancestros: ["raiz", "arq"], ruta: "Obra / Arquitectura / modelo.rvt" }, ARQ), []);
  assert.deepEqual(subcarpetas(a, { id: "otra" }), []);
  // The closest review folder of the flow counts.
  assert.equal(carpetaDeRevision(a, { carpetas: [ARQ, T1] })?.id, "t1");
  assert.deepEqual(subcarpetas(a, carpetaDeRevision(a, { carpetas: [ARQ, T1] })!), ["Planos"]);
});

test("traslada quien aprobó el último paso o un administrador, y solo un archivo aprobado", () => {
  const aprobado = { estado: "aprobado" as const, versionAprobadaId: "v5", firmas: [firma("luz", "Luz"), { ...firma("pepe", "Pepe"), paso: "Aprueba" }] };
  assert.deepEqual(aprobador(aprobado), { id: "pepe", nombre: "Pepe" });
  assert.equal(puedeTrasladar(aprobado, { id: "pepe", esAdmin: false }), null);
  assert.equal(puedeTrasladar(aprobado, { id: "ana", esAdmin: true }), null);
  assert.equal(puedeTrasladar(aprobado, { id: "luz", esAdmin: false }), "Solo quien lo aprobó (Pepe) o un administrador puede trasladarlo.");
  assert.match(puedeTrasladar({ ...aprobado, versionAprobadaId: null }, { id: "ana", esAdmin: true })!, /Solo se traslada una versión aprobada/);
  assert.match(puedeTrasladar({ ...aprobado, estado: "retirado" }, { id: "ana", esAdmin: true })!, /Solo se traslada una versión aprobada/);
  // A newer version waits for review: the approved one can still go (its approver's signature is gone).
  assert.equal(puedeTrasladar({ estado: "nueva-version", versionAprobadaId: "v5", firmas: [] }, { id: "ana", esAdmin: true }), null);
  assert.match(puedeTrasladar({ estado: "nueva-version", versionAprobadaId: "v5", firmas: [] }, { id: "pepe", esAdmin: false })!, /Solo quien lo aprobó o un administrador/);
});

test("lo que ya está en el destino: nada, la última copia del flujo, o algo ajeno que se pregunta", () => {
  assert.equal(situacionDestino(null, null, null), "nuevo");
  assert.equal(situacionDestino({ destinoVersionId: "d1" }, { versionId: "d1" }, null), "version-nueva");
  assert.equal(situacionDestino({ destinoVersionId: "d1" }, { versionId: "d2" }, null), "diferencia", "someone uploaded over the flow's copy");
  assert.equal(situacionDestino(null, { versionId: "x9" }, null), "diferencia", "a file the flow didn't put there");
  assert.equal(situacionDestino(null, { versionId: "x9" }, "x9"), "version-nueva", "the person confirmed replacing that version");
  assert.equal(situacionDestino(null, { versionId: "x9" }, "x8"), "diferencia", "it changed after they looked");
});

test("un traslado nuevo conserva lo que el flujo copió antes y se dice en palabras", () => {
  const antes: Traslado = { ...trasladoInicial({ versionAprobadaId: "v5", revisionAprobada: 5, traslado: null }), estado: "hecho", destinoFileId: "d", destinoVersionId: "d1", destinoRevision: 1, por: "Pepe", fecha: "2026-11-04T23:20:00Z" };
  const t = trasladoInicial({ versionAprobadaId: "v6", revisionAprobada: 6, traslado: antes });
  assert.equal(t.estado, "pendiente");
  assert.equal(t.revision, 6);
  assert.equal(t.destinoVersionId, "d1");
  assert.equal(textoTraslado(antes, (iso) => iso.slice(0, 10)), "En destino: versión 1 (2026-11-04, Pepe)");
  assert.equal(textoTraslado({ ...antes, estado: "diferencia" }, (s) => s), "En destino hay otro archivo con ese nombre");
});
