import { test } from "node:test";
import assert from "node:assert/strict";
import { armarTrazas, describirFiltro, diaColombia, resumenTraza } from "./trazabilidad";
import type { ArchivoRegistro, EntradaHistorial } from "./types";

const archivo = (id: string, extra: Partial<ArchivoRegistro> = {}): ArchivoRegistro => ({
  id,
  proyecto: "P",
  flujoId: "f1",
  fileId: `file-${id}`,
  nombre: `${id}.rvt`,
  ruta: `Obra / Arquitectura / ${id}.rvt`,
  carpetaId: "arq",
  ancestros: ["raiz", "arq"],
  tipo: "rvt",
  estado: "aprobado",
  pasos: [{ id: "p1", nombre: "Aprueba" }],
  pasoActual: 0,
  versionId: `${id}-v2`,
  revision: 2,
  subido: "2026-11-02T15:00:00Z",
  subidoPor: "Juan",
  subidoPorId: "juan",
  versionAprobadaId: `${id}-v2`,
  revisionAprobada: 2,
  firmas: [],
  traslado: null,
  detectado: "2026-11-01T16:00:00Z",
  actualizado: "2026-11-02T16:00:00Z",
  ...extra,
});
let n = 0;
const linea = (archivoId: string | null, accion: string, ocurrido: string, extra: Partial<EntradaHistorial> = {}): EntradaHistorial => ({
  id: ++n,
  creado: "2026-11-05T01:00:00Z",
  proyecto: "P",
  flujoId: "f1",
  accion,
  usuario: "Juan",
  usuarioId: "juan",
  detalle: accion,
  archivoId,
  fileId: null,
  version: 1,
  ocurrido,
  ...extra,
});

const HITOS = new Map([
  ["f1", "Aprobar Torre 1"],
  ["f2", "Aprobar estructura"],
]);
const ARCHIVOS = [archivo("modelo"), archivo("plano", { flujoId: "f2", estado: "rechazado", ruta: "Obra / Estructura / plano.pdf", nombre: "plano.pdf" })];
const ENTRADAS = [
  linea("modelo", "trasladado", "2026-11-03T23:30:00Z", { usuario: "Pepe", version: 2 }),
  linea("modelo", "archivo-detectado", "2026-11-01T15:00:00Z"),
  linea("modelo", "aprobado", "2026-11-03T23:00:00Z", { usuario: "Pepe", version: 2 }),
  linea("modelo", "version-reemplazada", "2026-11-02T15:00:00Z", { version: 2 }),
  linea("plano", "rechazado", "2026-11-04T14:00:00Z", { usuario: "Luz" }),
  linea(null, "flujo-creado", "2026-11-01T10:00:00Z"),
];

test("cada archivo trae lo que le pasó en orden: subidas, decisiones y traslado", () => {
  const t = armarTrazas(ARCHIVOS, ENTRADAS, HITOS);
  assert.deepEqual(
    t.map((x) => x.archivo.hito),
    ["Aprobar estructura", "Aprobar Torre 1"],
    "by flow, then by path"
  );
  const modelo = t.find((x) => x.archivo.id === "modelo")!;
  assert.deepEqual(
    modelo.eventos.map((e) => [e.que, e.quien]),
    [
      ["Subió un archivo", "Juan"],
      ["Subió otra versión", "Juan"],
      ["Aprobó", "Pepe"],
      ["Trasladó al destino", "Pepe"],
    ]
  );
  assert.equal(modelo.archivo.hito, "Aprobar Torre 1");
});

test("filtra por flujo, estado, texto y días de Colombia (una noche colombiana es otro día en UTC)", () => {
  assert.deepEqual(
    armarTrazas(ARCHIVOS, ENTRADAS, HITOS, { flujoId: "f2" }).map((t) => t.archivo.id),
    ["plano"]
  );
  assert.deepEqual(
    armarTrazas(ARCHIVOS, ENTRADAS, HITOS, { estado: "aprobado" }).map((t) => t.archivo.id),
    ["modelo"]
  );
  assert.deepEqual(
    armarTrazas(ARCHIVOS, ENTRADAS, HITOS, { texto: "ESTRUCTURA" }).map((t) => t.archivo.id),
    ["plano"]
  );
  // 2026-11-03T23:30Z is 03-11-2026 18:30 in Colombia.
  assert.equal(diaColombia("2026-11-04T03:30:00Z"), "2026-11-03");
  const del3 = armarTrazas(ARCHIVOS, ENTRADAS, HITOS, { desde: "2026-11-03", hasta: "2026-11-03" });
  assert.deepEqual(
    del3.map((t) => [t.archivo.id, t.eventos.map((e) => e.accion)]),
    [["modelo", ["aprobado", "trasladado"]]],
    "files without events in those days are left out"
  );
});

test("el resumen dice estado, última subida, última decisión y traslado; el filtro se describe en palabras", () => {
  const [t] = armarTrazas([archivo("modelo", { traslado: { estado: "hecho", mensaje: "", versionId: "v2", revision: 2, carpetaId: "apr", carpetaRuta: "Obra / Aprobados", uploadId: null, destinoFileId: "d", destinoVersionId: "d1", destinoRevision: 1, por: "Pepe", porId: "pepe", fecha: "2026-11-03T23:30:00Z", diferenciaVersionId: null, diferenciaTexto: "" } })], ENTRADAS, HITOS);
  const r = Object.fromEntries(resumenTraza(t).map((x) => [x.etiqueta, x.valor]));
  assert.equal(r["Estado"], "Aprobado · versión 2 · aprobada: 2");
  assert.equal(r["Última subida"], "Juan, 02-11-2026 10:00 (versión 2)");
  assert.equal(r["Última decisión"], "Aprobó: Pepe, 03-11-2026 18:00 (versión 2)");
  assert.equal(r["Traslado"], "En «Obra / Aprobados»: versión 1 (03-11-2026 18:30, Pepe) · Pepe, 03-11-2026 18:30 (versión 2)");
  assert.equal(describirFiltro({ flujoId: "f1", estado: "aprobado", desde: "2026-11-01", hasta: "2026-11-04", texto: " torre " }, HITOS), "Flujo: Aprobar Torre 1 · Estado: Aprobado · Del 01-11-2026 al 04-11-2026 · Texto: «torre»");
  assert.equal(describirFiltro({}, HITOS), "Todos los flujos");
});
