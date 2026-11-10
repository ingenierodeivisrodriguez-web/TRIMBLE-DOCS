import { test } from "node:test";
import assert from "node:assert/strict";
import { cerrarTarea } from "./avisos";
import { sigueEsperando, tareasPorCerrar } from "./tareas";
import type { ArchivoRegistro, TareaTrimble } from "./types";

const PASOS = [
  { id: "p1", nombre: "Revisa" },
  { id: "p2", nombre: "Aprueba" },
];
const tarea = (id: string, extra: Partial<TareaTrimble> = {}): TareaTrimble => ({ id, tipo: "revision", pasoId: "p1", versionId: "v1", titulo: `Revisar (${id})`, creada: "2026-11-10T15:00:00Z", ...extra });
const fila = (id: string, extra: Partial<ArchivoRegistro> = {}): ArchivoRegistro => ({
  id,
  proyecto: "P",
  flujoId: "f1",
  fileId: `file-${id}`,
  nombre: `${id}.rvt`,
  ruta: `Obra / ${id}.rvt`,
  carpetaId: "c",
  ancestros: ["c"],
  tipo: "rvt",
  estado: "pendiente",
  pasos: PASOS,
  pasoActual: 0,
  versionId: "v1",
  revision: 1,
  subido: null,
  subidoPor: "Juan",
  subidoPorId: "juan",
  versionAprobadaId: null,
  revisionAprobada: null,
  firmas: [],
  traslado: null,
  detectado: "",
  actualizado: "",
  ...extra,
});

test("una tarea de revisión sigue abierta mientras el archivo espera ese paso con esa versión; la de corrección, mientras sigue rechazado", () => {
  assert.equal(sigueEsperando(tarea("t"), fila("a")), true);
  assert.equal(sigueEsperando(tarea("t"), fila("a", { pasoActual: 1 })), false, "the step was decided");
  assert.equal(sigueEsperando(tarea("t"), fila("a", { estado: "aprobado" })), false);
  assert.equal(sigueEsperando(tarea("t"), fila("a", { versionId: "v2" })), false, "another version entered");
  const correccion = tarea("c", { tipo: "correccion", pasoId: null });
  assert.equal(sigueEsperando(correccion, fila("a", { estado: "rechazado" })), true);
  assert.equal(sigueEsperando(correccion, fila("a", { estado: "nueva-version", versionId: "v2" })), false, "the corrected version entered");
});

test("se cierra la tarea que ya no necesita ningún archivo; una tarea de varios archivos espera a que se decidan todos", () => {
  const t1 = tarea("t1");
  const t2 = tarea("t2", { pasoId: "p2" });
  const a = fila("a", { pasoActual: 1, tareas: [t1, t2] });
  const b = fila("b", { tareas: [t1] });
  // a passed «Revisa» but b still waits for it: t1 stays open; t2 (a's next step) too.
  assert.deepEqual(tareasPorCerrar([a], [a, b]), []);
  const bDecidido = { ...b, estado: "rechazado" as const };
  const r = tareasPorCerrar([bDecidido], [a, bDecidido]);
  assert.deepEqual(
    r.map((x) => [x.tarea.id, x.archivos.map((f) => f.id)]),
    [["t1", ["a", "b"]]]
  );
  assert.deepEqual(tareasPorCerrar([a], [{ ...a, tareas: [{ ...t1, cerrada: "2026-11-10" }, t2] }]), [], "a closed one isn't closed again");
});

test("cerrar una tarea prueba «CLOSED» y luego «DONE»; sin permiso no insiste; una respuesta con otro estado no cuenta", async () => {
  const pedidos: unknown[] = [];
  const conDone = await cerrarTarea(async (cuerpo) => {
    pedidos.push(cuerpo);
    return cuerpo.status === "DONE" ? { estado: 200, cuerpo: { status: "DONE" } } : { estado: 400, cuerpo: { message: "status inválido" } };
  });
  assert.deepEqual(pedidos, [{ status: "CLOSED" }, { status: "DONE" }]);
  assert.deepEqual(conDone, { ok: true, estado: "DONE", mensaje: "Trimble la dejó en estado DONE." });
  assert.equal((await cerrarTarea(async () => ({ estado: 200, cuerpo: { status: "CLOSED" } }))).estado, "CLOSED");
  let veces = 0;
  const sinPermiso = await cerrarTarea(async () => {
    veces++;
    return { estado: 403, cuerpo: "Forbidden" };
  });
  assert.equal(sinPermiso.ok, false);
  assert.equal(veces, 1);
  assert.match(sinPermiso.mensaje, /Trimble no la cerró \(403\)/);
  const ignora = await cerrarTarea(async () => ({ estado: 200, cuerpo: { status: "NEW" } }));
  assert.equal(ignora.ok, false, "Trimble answered but the ToDo is still new");
  assert.equal((await cerrarTarea(async () => Promise.reject(new Error("sin red")))).mensaje, "No se pudo cerrar: sin red");
});
