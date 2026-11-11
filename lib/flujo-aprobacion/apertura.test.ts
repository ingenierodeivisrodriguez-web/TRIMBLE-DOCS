import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../propiedades/service";
import type { ProjectUser, RawFolderItem } from "../trimbleApi";
import { lapso, planApertura, registrarApertura } from "./apertura";
import { decidir } from "./decisiones";
import { FlujoError } from "./errores";
import { listarArchivos } from "./revision";
import { Ctx, guardarFlujo, historial, TrimbleFlujo } from "./service";
import { memoryStore } from "./store";
import { ACCIONES } from "./trazabilidad";
import type { ArchivoRegistro } from "./types";

const persona = (id: string, firstName: string, role = "USER"): ProjectUser => ({ id, firstName, lastName: "", email: `${id}@obra.co`, role, status: "ACTIVE" });
const PERSONAS = [persona("ana", "Ana", "ADMIN"), persona("juan", "Juan"), persona("luz", "Luz"), persona("pepe", "Pepe"), persona("deivis", "Deivis")];

/** modelo.rvt uploaded by Juan; a flow: Revisa = Luz, Aprueba = Pepe. The clock moves on with `minutos`. */
async function escenario() {
  const store = memoryStore();
  let reloj = Date.parse("2026-11-11T18:38:00Z");
  const archivo: RawFolderItem = { id: "modelo", name: "modelo.rvt", type: "FILE", createdOn: "", modifiedOn: "2026-11-01T15:00:00.000Z", modifiedBy: { id: "juan", firstName: "Juan" }, versionId: "modelo-v1", revision: 1 };
  const tc: TrimbleFlujo = {
    carpeta: async () => {
      throw new FlujoError("No se usa.", 500);
    },
    archivo: async (id) => ({ id, ruta: `Obra / Arquitectura / ${id}`, ancestros: ["raiz", "arq"] }),
    personas: async () => PERSONAS,
    grupos: async () => [],
    miembros: async () => [],
    permisos: async () => ({ direct: { acl: {}, inheritance: true }, inherited: {} }),
    items: async (id) => (id === "arq" ? [archivo] : []),
    version: async () => "modelo-v1",
    lado: { projectId: "P", servidor: "https://falso", cliente: { pedir: async () => ({ estado: 404, cuerpo: null }) } },
    crearTarea: async () => ({ estado: 201, cuerpo: { id: "todo1" } }),
    actualizarTarea: async (_id, cuerpo) => ({ estado: 200, cuerpo: { status: cuerpo.status } }),
  };
  const ctx = (id: string, isAdmin = false): Ctx => ({
    projectId: "P",
    caller: { id, name: PERSONAS.find((p) => p.id === id)!.firstName, isAdmin, memberOfGroups: async () => new Set() } satisfies Caller,
    store,
    tc,
    ahora: () => new Date(reloj),
  });
  const creador = ctx("deivis");
  await guardarFlujo(creador, {
    hito: "actualizacion de planos",
    archivos: ["modelo"],
    pasos: [
      { nombre: "Revisa", responsable: { tipo: "persona", id: "luz" } },
      { nombre: "Aprueba", responsable: { tipo: "persona", id: "pepe" } },
    ],
  });
  const modelo = async () => (await listarArchivos(creador)).archivos.find((a) => a.fileId === "modelo")!;
  const abre = async (quien: string, isAdmin = false) => (await registrarApertura(ctx(quien, isAdmin), { archivoId: (await modelo()).id })).anotado;
  const aperturas = async () => (await historial(creador, null, (await modelo()).id)).entradas.filter((e) => e.accion === "archivo-abierto");
  return { ctx, modelo, abre, aperturas, minutos: (n: number) => (reloj += n * 60_000) };
}

test("cuando el responsable avisado abre el archivo desde la extensión queda en el historial, una vez por versión", async () => {
  const e = await escenario();
  e.minutos(2);
  assert.equal(await e.abre("luz"), true);
  const [linea] = await e.aperturas();
  assert.equal(linea.usuario, "Luz");
  assert.equal(linea.version, 1);
  assert.equal(linea.detalle, "Abrió la versión 1 de «modelo.rvt» como responsable de «Revisa»; lo avisó la tarea de Trimble FLUJO-01 del 11-11-2026 13:38 (2 minutos antes).");
  assert.equal(ACCIONES["archivo-abierto"], "Abrió el archivo");
  // Opening it again doesn't repeat it.
  e.minutos(30);
  assert.equal(await e.abre("luz"), false);
  assert.equal((await e.aperturas()).length, 1);
});

test("no se anota a quien no recibió el aviso: el del paso siguiente, quien subió la versión o un administrador", async () => {
  const e = await escenario();
  assert.equal(await e.abre("pepe"), false, "his step hasn't come yet");
  assert.equal(await e.abre("juan"), false, "he uploaded it and nothing was rejected");
  assert.equal(await e.abre("ana", true), false, "an administrator isn't notified");
  assert.deepEqual(await e.aperturas(), []);
  // Luz approves: now Pepe was notified, and his opening is noted.
  const a = await e.modelo();
  await decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId, texto: "" }, "aprobar");
  e.minutos(60 * 3);
  assert.equal(await e.abre("pepe"), true);
  assert.match((await e.aperturas())[0].detalle, /^Abrió la versión 1 de «modelo.rvt» como responsable de «Aprueba»; lo avisó la tarea de Trimble FLUJO-01 del .+ \(3 horas antes\)\.$/);
});

test("quien subió una versión rechazada queda anotado cuando la abre para corregirla", async () => {
  const e = await escenario();
  const a = await e.modelo();
  await decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId, texto: "Faltan los ejes" }, "rechazar");
  e.minutos(60 * 24 * 2);
  assert.equal(await e.abre("luz"), false, "it no longer waits for her");
  assert.equal(await e.abre("juan"), true);
  assert.match((await e.aperturas())[0].detalle, /^Abrió la versión 1 de «modelo.rvt», que le rechazaron, para corregirla; lo avisó la tarea de Trimble FLUJO-01 del .+ \(2 días antes\)\.$/);
});

test("un miembro del grupo responsable cuenta como avisado; una versión nueva se anota otra vez; un archivo que no existe se rechaza", async () => {
  const base = {
    id: "a1",
    proyecto: "P",
    flujoId: "f1",
    fileId: "file1",
    nombre: "plano.pdf",
    estado: "pendiente",
    pasos: [{ id: "p1", nombre: "Revisa", responsable: { tipo: "grupo", id: "g-arq", nombre: "Arquitectura" } }],
    pasoActual: 0,
    versionId: "v2",
    revision: 2,
    subidoPorId: "juan",
    tareas: [],
  } as unknown as ArchivoRegistro;
  const eva = { id: "eva", nombre: "Eva", grupos: new Set(["g-arq"]) };
  const linea = planApertura(base, null, eva, [], "2026-11-11T18:40:00Z");
  assert.equal(linea?.detalle, "Abrió la versión 2 de «plano.pdf» como responsable de «Revisa».", "without a ToDo noted, it says no notice");
  assert.equal(planApertura(base, null, eva, [{ accion: "archivo-abierto", archivoId: "a1", usuarioId: "eva", version: 1 }], "2026-11-11T18:40:00Z")?.version, 2, "version 1 was opened, version 2 wasn't");
  assert.equal(planApertura(base, null, eva, [{ accion: "archivo-abierto", archivoId: "a1", usuarioId: "eva", version: 2 }], "2026-11-11T18:40:00Z"), null);
  assert.equal(planApertura(base, null, { ...eva, grupos: new Set() }, [], "2026-11-11T18:40:00Z"), null);
  const e = await escenario();
  await assert.rejects(() => registrarApertura(e.ctx("luz"), { archivoId: "x" }), /El archivo no es válido/);
  await assert.rejects(() => registrarApertura(e.ctx("luz"), { archivoId: "00000000-0000-0000-0000-000000000000" }), /no está registrado/);
});

test("el lapso se dice en minutos, horas o días", () => {
  assert.equal(lapso("2026-11-11T13:38:00Z", "2026-11-11T13:38:20Z"), "menos de un minuto");
  assert.equal(lapso("2026-11-11T13:38:00Z", "2026-11-11T13:39:00Z"), "1 minuto");
  assert.equal(lapso("2026-11-11T13:38:00Z", "2026-11-11T14:45:00Z"), "1 hora");
  assert.equal(lapso("2026-11-10T13:38:00Z", "2026-11-11T14:45:00Z"), "1 día");
});
