import { test } from "node:test";
import assert from "node:assert/strict";
import { filtrarActividad, proyectoDeEnlace, textoConteo, versiones } from "./formato";
import type { ArchivoSeguido, EntradaActividad } from "./types";

const entrada = (x: Partial<EntradaActividad>): EntradaActividad => ({
  id: 1,
  creado: "2026-10-28T15:00:00.000Z",
  origenProyecto: "O",
  destinoProyecto: "D",
  origenNombre: "Selvia",
  destinoNombre: "Laboratorio",
  publicacionId: null,
  accion: "publicar",
  usuario: "Ana Ruiz",
  usuarioId: "u1",
  nombre: "EST-001 Cimentación.pdf",
  versionOrigen: null,
  versionDestino: null,
  nota: "",
  resultado: "ok",
  ...x,
});

test("el enlace de un proyecto de Trimble o su id dan el id; otro texto no", () => {
  assert.equal(proyectoDeEnlace("https://web.connect.trimble.com/projects/BUJGfcZ3AEI/data/folder/x"), "BUJGfcZ3AEI");
  assert.equal(proyectoDeEnlace("  BUJGfcZ3AEI "), "BUJGfcZ3AEI");
  assert.equal(proyectoDeEnlace("Laboratorio de pruebas"), null);
});

test("la actividad se filtra por acción y por texto, sin importar tildes ni mayúsculas", () => {
  const lista = [entrada({ id: 1 }), entrada({ id: 2, accion: "actualizar", usuario: "Luis Pérez", nota: "Actualización automática – versión 2 del origen." })];
  assert.deepEqual(filtrarActividad(lista, { accion: "actualizar" }).map((e) => e.id), [2]);
  assert.deepEqual(filtrarActividad(lista, { texto: "perez" }).map((e) => e.id), [2]);
  assert.deepEqual(filtrarActividad(lista, { texto: "cimentacion" }).map((e) => e.id), [1, 2]);
  assert.deepEqual(filtrarActividad(lista, { texto: "laboratorio", accion: "publicar" }).map((e) => e.id), [1]);
});

test("el conteo de archivos y las versiones se escriben en palabras", () => {
  const a = (estado: ArchivoSeguido["estado"]) => ({ estado }) as ArchivoSeguido;
  assert.equal(textoConteo([a("al-dia"), a("al-dia"), a("diferencia")]), "2 al día · 1 distinto en el destino");
  assert.equal(textoConteo([]), "");
  assert.equal(versiones(14, 3), "v14 → v3");
  assert.equal(versiones(null, null), "");
});
