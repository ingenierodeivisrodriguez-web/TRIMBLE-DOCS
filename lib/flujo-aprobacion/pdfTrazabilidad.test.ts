import { test } from "node:test";
import assert from "node:assert/strict";
import { nombrePdfTrazabilidad, pdfTrazabilidad } from "./pdfTrazabilidad";
import type { Traza } from "./trazabilidad";
import type { ArchivoRegistro } from "./types";

const archivo = (id: string): ArchivoRegistro & { hito: string } => ({
  id,
  proyecto: "P",
  flujoId: "f1",
  fileId: id,
  nombre: `${id}.rvt`,
  ruta: `Obra / Arquitectura / ${id}.rvt`,
  carpetaId: "arq",
  ancestros: ["raiz", "arq"],
  tipo: "rvt",
  estado: "aprobado",
  pasos: [{ id: "p1", nombre: "Aprueba" }],
  pasoActual: 0,
  versionId: "v1",
  revision: 1,
  subido: "2026-11-02T15:00:00Z",
  subidoPor: "Juan",
  subidoPorId: "juan",
  versionAprobadaId: "v1",
  revisionAprobada: 1,
  firmas: [],
  traslado: null,
  detectado: "2026-11-02T16:00:00Z",
  actualizado: "2026-11-02T16:00:00Z",
  hito: "Aprobar diseño arquitectónico Torre 1",
});
const evento = (i: number) => ({
  fecha: `2026-11-0${1 + (i % 4)}T15:00:00Z`,
  quien: "Pepe Gómez",
  que: "Aprobó",
  accion: "aprobado",
  version: 1,
  detalle: `Aprobó «Aprueba» de la versión 1: el archivo queda aprobado. Comentario: revisado contra la lista de chequeo del contrato, punto ${i}.`,
});

const base = { filtro: {}, hitos: new Map([["f1", "Aprobar diseño arquitectónico Torre 1"]]), proyecto: "Torre Central", generado: "2026-11-04T23:00:00Z", por: "Deivis Rodríguez" };

test("el PDF de trazabilidad sale con una página por lo que quepa y pasa a otra con muchos movimientos", async () => {
  const corto = new Uint8Array(await (await pdfTrazabilidad({ ...base, trazas: [{ archivo: archivo("modelo"), eventos: [evento(1), evento(2)] }] as Traza[] })).arrayBuffer());
  assert.equal(new TextDecoder().decode(corto.slice(0, 5)), "%PDF-");
  const paginas = (b: Uint8Array) => (new TextDecoder("latin1").decode(b).match(/\/Type \/Page\b/g) ?? []).length;
  assert.equal(paginas(corto), 1);
  const largo = new Uint8Array(await (await pdfTrazabilidad({ ...base, trazas: [{ archivo: archivo("modelo"), eventos: Array.from({ length: 60 }, (_, i) => evento(i)) }] as Traza[] })).arrayBuffer());
  assert.ok(paginas(largo) >= 3, `${paginas(largo)} pages`);
});

test("sin archivos también sale el PDF, y el nombre lleva el proyecto o el archivo y la fecha", async () => {
  const vacio = new Uint8Array(await (await pdfTrazabilidad({ ...base, trazas: [] })).arrayBuffer());
  assert.ok(vacio.length > 500);
  assert.equal(nombrePdfTrazabilidad("Torre Central", "2026-11-04T23:00:00Z"), "Trazabilidad - Torre Central - 04-11-2026.pdf");
  assert.equal(nombrePdfTrazabilidad("Torre Central", "2026-11-05T02:00:00Z", "A/101: planta.pdf"), "Trazabilidad - A-101- planta.pdf - 04-11-2026.pdf");
});
