import { test } from "node:test";
import assert from "node:assert/strict";
import { cambiosFlujo, claveHito, codigoFlujo, describirCierre, primerasDecisiones, revisarDatos, textoCerrado } from "./flujos";
import { memoryStore } from "./store";
import { estadoDocumento, estadoDocumentos, estaVencido, filasFlujos, filtrarFilas, opcionesFiltro, responsablesFlujo, resumenTablero, sumarDias } from "./lista";
import type { EstadoArchivo, Flujo, PasoFlujo, Responsable } from "./types";

const HOY = "2026-11-06";

test("cada flujo tiene un código por proyecto en orden de creación: FLUJO-01, FLUJO-02…; se busca por código", async () => {
  assert.equal(codigoFlujo(1), "FLUJO-01");
  assert.equal(codigoFlujo(12), "FLUJO-12");
  assert.equal(codigoFlujo(105), "FLUJO-105");
  assert.equal(codigoFlujo(null), "");
  const store = memoryStore();
  const nuevo = (proyecto: string, hito: string) =>
    store.crearFlujo({ proyecto, hito, hitoClave: hito, pasos: [], archivos: [], carpetas: [], destino: null, activo: true, creado: "", creadoPor: null, actualizado: "", actualizadoPor: null });
  assert.deepEqual([(await nuevo("A", "uno")).codigo, (await nuevo("A", "dos")).codigo, (await nuevo("B", "otro")).codigo], [1, 2, 1]);
  const filas = filasFlujos(await store.flujos("A"), [], HOY);
  for (const q of ["FLUJO-02", "flujo 02", "flujo02"]) assert.deepEqual(filtrarFilas(filas, { texto: q }, HOY).map((f) => f.flujo.hito), ["dos"], q);
  assert.deepEqual(filtrarFilas(filas, { texto: "uno" }, HOY).map((f) => f.flujo.hito), ["uno"]);
});
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
const DOS_PASOS = pasos(null, null);
/** A registered file waiting at step `pasoActual` of a two-step flow (Revisa, Aprueba). */
const archivo = (flujoId: string, estado: EstadoArchivo, meToca = false, pasoActual = 0, conPasos: PasoFlujo[] = DOS_PASOS) => ({ flujoId, estado, meToca, pasos: conPasos, pasoActual });

const TORRE = flujo("f1", "Aprobar Torre 1", { codigo: 2, vence: "2026-11-05", pasos: pasos({ tipo: "grupo", id: "g-arq", nombre: "Arquitectura" }, persona("pepe", "Pepe Gómez")) });
const ESTRUCTURA = flujo("f2", "Aprobar estructura", { codigo: 3, vence: "2026-11-10", creadoPor: "Deivis", pasos: pasos(persona("luz", "Luz Mora"), persona("luz", "Luz Mora")) });
const VIEJO = flujo("f3", "Aprobar anteproyecto", { codigo: 1, activo: false });
const ARCHIVOS = [archivo("f1", "pendiente", true), archivo("f1", "nueva-version", false, 1), archivo("f1", "aprobado"), archivo("f2", "aprobado")];

test("el tablero cuenta los flujos por su estado y sus archivos en ese estado, de todos los flujos", () => {
  const filas = filasFlujos([VIEJO, ESTRUCTURA, TORRE], ARCHIVOS, HOY);
  assert.deepEqual(resumenTablero(filas, ARCHIVOS), {
    flujos: 3,
    activos: 2,
    porRevisar: { flujos: 1, archivos: 1 },
    porAprobar: { flujos: 0, archivos: 1 },
    aprobados: { flujos: 1, archivos: 2 },
    rechazados: { flujos: 0, archivos: 0 },
  });
  // Files of another project's flow (or a flow not listed) don't count.
  assert.equal(resumenTablero(filas, [...ARCHIVOS, archivo("otro", "aprobado")]).aprobados.archivos, 2);
  assert.deepEqual(resumenTablero([], []).porAprobar, { flujos: 0, archivos: 0 });
});

test("los flujos salen del más nuevo al más viejo según su código; los que aún no tienen código, al final", () => {
  const sinCodigo = flujo("f9", "Sin número");
  const nuevoDesactivado = flujo("f4", "Nuevo desactivado", { codigo: 4, activo: false });
  assert.deepEqual(
    filasFlujos([VIEJO, sinCodigo, TORRE, nuevoDesactivado, ESTRUCTURA], [], HOY).map((f) => f.flujo.codigo ?? null),
    [4, 3, 2, 1, null],
    "only by code: a deactivated flow keeps its place"
  );
});

test("cada fila trae archivos, pendientes, lo que me toca, responsables por paso, estado del documento y vencimiento", () => {
  const filas = filasFlujos([VIEJO, ESTRUCTURA, TORRE], ARCHIVOS, HOY);
  assert.deepEqual(
    filas.map((f) => [f.flujo.hito, f.archivos, f.pendientes, f.porRevisar, f.estado, f.detalleEstado, f.vencido, f.cierre]),
    [
      ["Aprobar estructura", 1, 0, 0, "aprobado", "1 aprobado", false, null],
      ["Aprobar Torre 1", 3, 2, 1, "por-revisar", "1 por revisar, 1 por aprobar, 1 aprobado", true, null],
      ["Aprobar anteproyecto", 0, 0, 0, "sin-archivos", "Ningún archivo registrado todavía", false, null],
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
  assert.deepEqual(hitos({ estado: "aprobado" }), ["Aprobar estructura"]);
  assert.deepEqual(hitos({ estado: "por-revisar" }), ["Aprobar Torre 1"]);
  assert.deepEqual(hitos({ estado: "rechazado" }), []);
  assert.deepEqual(hitos({ vence: "vencidos" }), ["Aprobar Torre 1"]);
  assert.deepEqual(hitos({ vence: "7dias" }), ["Aprobar estructura"]);
  assert.deepEqual(hitos({ vence: "sin-fecha" }), ["Aprobar anteproyecto"]);
  assert.deepEqual(hitos({ porRevisar: true }), ["Aprobar Torre 1"]);
  assert.deepEqual(hitos({ texto: "TORRE" }), ["Aprobar Torre 1"]);
  const o = opcionesFiltro(filas);
  assert.deepEqual(o.propietarios, ["Ana Ruiz", "Deivis"]);
  assert.equal("grupos" in o, false, "no Grupos filter");
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
  assert.equal(cambiosFlujo({ ...f, vence: null, notas: "" }, { ...f, vence: "2026-11-25", notas: "Nueva" }), "Vencimiento: 25-11-2026 (antes sin fecha). Cambió la descripción.");
});

test("estado del documento: espera un paso que no es el último (por revisar), el último (por aprobar), aprobado o rechazado", () => {
  assert.equal(estadoDocumento(archivo("f", "pendiente", false, 0)), "por-revisar");
  assert.equal(estadoDocumento(archivo("f", "nueva-version", false, 1)), "por-aprobar");
  assert.equal(estadoDocumento(archivo("f", "pendiente", false, 0, [{ id: "p1", nombre: "Aprueba", responsable: null }])), "por-aprobar", "a single step is the approval");
  assert.equal(estadoDocumento(archivo("f", "aprobado")), "aprobado");
  assert.equal(estadoDocumento(archivo("f", "rechazado")), "rechazado");
  assert.equal(estadoDocumento(archivo("f", "retirado")), null, "a retired file doesn't count");
});

test("con varios archivos: rechazado si alguno lo está, luego lo que espera, y aprobado solo cuando todos lo están", () => {
  assert.deepEqual(estadoDocumentos([archivo("f", "pendiente", false, 1), archivo("f", "rechazado"), archivo("f", "pendiente", false, 1)]), { estado: "rechazado", detalle: "1 rechazado, 2 por aprobar" });
  assert.deepEqual(estadoDocumentos([archivo("f", "aprobado"), archivo("f", "pendiente", false, 1)]), { estado: "por-aprobar", detalle: "1 por aprobar, 1 aprobado" });
  assert.deepEqual(estadoDocumentos([archivo("f", "aprobado"), archivo("f", "aprobado"), archivo("f", "retirado")]), { estado: "aprobado", detalle: "2 aprobados" });
  assert.deepEqual(estadoDocumentos([archivo("f", "retirado")]), { estado: "sin-archivos", detalle: "Ningún archivo registrado todavía" });
});

test("el flujo queda cerrado desde su primera decisión: cuándo y de quién, en DD-MM-AAAA", () => {
  const cierres = primerasDecisiones([
    { id: 9, flujoId: "f1", accion: "aprobado", creado: "2026-11-09T21:00:00.000Z", usuario: "Pepe Gómez" },
    { id: 3, flujoId: "f1", accion: "aprobado-paso", creado: "2026-11-09T19:30:00.000Z", usuario: "Luz Mora" },
    { id: 1, flujoId: "f1", accion: "flujo-creado", creado: "2026-11-08T12:00:00.000Z", usuario: "Ana Ruiz" },
    { id: 2, flujoId: null, accion: "rechazado", creado: "2026-11-08T13:00:00.000Z", usuario: "Otro" },
    { id: 5, flujoId: "f2", accion: "rechazado", creado: "2026-11-10T04:30:00.000Z", usuario: null },
  ]);
  assert.deepEqual(cierres, { f1: { fecha: "2026-11-09T19:30:00.000Z", quien: "Luz Mora" }, f2: { fecha: "2026-11-10T04:30:00.000Z", quien: "" } });
  assert.equal(describirCierre(cierres.f1), "09-11-2026, de Luz Mora");
  assert.equal(describirCierre(cierres.f2), "09-11-2026, de alguien", "Colombian calendar day");
  assert.match(textoCerrado("Aprobar Torre 1", cierres.f1), /«Aprobar Torre 1» ya tiene decisiones \(la primera el 09-11-2026, de Luz Mora\): el flujo quedó cerrado y no se puede editar, activar ni desactivar/);
  const filas = filasFlujos([TORRE, ESTRUCTURA], ARCHIVOS, HOY, cierres);
  assert.deepEqual(
    filas.map((f) => [f.flujo.id, f.cierre?.quien ?? null]),
    [
      ["f2", ""],
      ["f1", "Luz Mora"],
    ]
  );
});

test("la fila cuenta los archivos con una versión más nueva en Trimble (sin los retirados)", () => {
  const vn = { versionId: "m-v5", revision: 5, nombre: "m.rvt", subido: null, subidoPor: "Pepe", subidoPorId: "pepe", visto: HOY };
  const filas = filasFlujos([TORRE], [{ ...archivo("f1", "aprobado"), versionNueva: vn }, { ...archivo("f1", "retirado"), versionNueva: vn }, archivo("f1", "pendiente")], HOY);
  assert.equal(filas[0].conVersionNueva, 1);
  assert.equal(filas[0].estado, "por-revisar", "the state is about the flow's own versions");
});
