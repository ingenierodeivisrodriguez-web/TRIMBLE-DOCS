import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../propiedades/service";
import type { ProjectUser, RawFolderItem } from "../trimbleApi";
import type { Correo, MensajeCorreo } from "./correo";
import { decidir } from "./decisiones";
import { FlujoError } from "./errores";
import { reactivarFlujo } from "./reactivar";
import { listarArchivos, revisarFlujo } from "./revision";
import { cambiarEstado, Ctx, estado, guardarFlujo, historial, TrimbleFlujo } from "./service";
import { memoryStore } from "./store";

const persona = (id: string, firstName: string, role = "USER"): ProjectUser => ({ id, firstName, lastName: "", email: `${id}@obra.co`, role, status: "ACTIVE" });
const PERSONAS = [persona("ana", "Ana", "ADMIN"), persona("juan", "Juan"), persona("luz", "Luz"), persona("pepe", "Pepe"), persona("deivis", "Deivis")];

/** modelo.rvt uploaded by Juan; a flow made by Deivis (not an administrator): Revisa = Luz, Aprueba = Pepe. */
async function escenario() {
  const store = memoryStore();
  const arbol: Record<string, RawFolderItem[]> = {};
  const archivo = (revision: number, quien = "juan"): RawFolderItem => ({
    id: "modelo",
    name: "modelo.rvt",
    type: "FILE",
    createdOn: "",
    modifiedOn: `2026-11-0${revision}T15:00:00.000Z`,
    modifiedBy: { id: quien, firstName: PERSONAS.find((p) => p.id === quien)!.firstName },
    versionId: `modelo-v${revision}`,
    revision,
  });
  arbol.arq = [archivo(1)];
  const correos: MensajeCorreo[] = [];
  const correo: Correo = { desde: "avisos@gmail.com", enviar: async (m) => void correos.push(m) };
  const tc: TrimbleFlujo = {
    carpeta: async () => {
      throw new FlujoError("No se usa.", 500);
    },
    archivo: async (id) => ({ id, ruta: `Obra / Arquitectura / ${id}`, ancestros: ["raiz", "arq"] }),
    personas: async () => PERSONAS,
    grupos: async () => [],
    miembros: async () => [],
    permisos: async () => ({ direct: { acl: {}, inheritance: true }, inherited: {} }),
    items: async (id) => arbol[id] ?? [],
    version: async () => arbol.arq[0].versionId ?? null,
    lado: { projectId: "P", servidor: "https://falso", cliente: { pedir: async () => ({ estado: 404, cuerpo: null }) } },
  };
  const ctx = (id: string, isAdmin = false): Ctx => ({
    projectId: "P",
    caller: { id, name: PERSONAS.find((p) => p.id === id)!.firstName, isAdmin, memberOfGroups: async () => new Set() } satisfies Caller,
    store,
    tc,
    correo,
    ahora: () => new Date("2026-11-10T22:00:00Z"),
  });
  const creador = ctx("deivis");
  const f = (
    await guardarFlujo(creador, {
      hito: "aprobar torre 2",
      archivos: ["modelo"],
      pasos: [
        { nombre: "Revisa", responsable: { tipo: "persona", id: "luz" } },
        { nombre: "Aprueba", responsable: { tipo: "persona", id: "pepe" } },
      ],
    })
  ).flujos[0];
  const modelo = async () => (await listarArchivos(creador)).archivos.find((a) => a.fileId === "modelo")!;
  const decide = async (quien: string, d: "aprobar" | "rechazar", texto = "") => {
    const a = await modelo();
    return decidir(ctx(quien), { archivoId: a.id, versionId: a.versionId, texto }, d);
  };
  const subir = async (revision: number) => {
    arbol.arq = [archivo(revision, "pepe")];
    await revisarFlujo(creador, { flujoId: f.id });
  };
  const flujo = async () => (await estado(creador)).flujos[0];
  return { store, correos, ctx, creador, f, modelo, decide, subir, flujo };
}

test("decidir no crea ni cierra tareas en Trimble: cada aviso es un correo y queda en el historial", async () => {
  const e = await escenario();
  assert.deepEqual((await e.modelo()).tareas ?? [], [], "no ToDo noted on the file");
  await e.decide("luz", "aprobar");
  await e.decide("pepe", "rechazar", "Faltan los ejes");
  assert.deepEqual(
    e.correos.map((m) => [m.para.correo, m.asunto]),
    [
      ["luz@obra.co", "FLUJO-01 · Te toca «Revisa»: aprobar torre 2"],
      ["pepe@obra.co", "FLUJO-01 · Te toca «Aprueba»: aprobar torre 2"],
      ["juan@obra.co", "FLUJO-01 · Rechazado: corrige «modelo.rvt» — aprobar torre 2"],
    ]
  );
  const acciones = (await historial(e.creador, e.f.id)).entradas.map((x) => x.accion);
  for (const accion of ["aviso-enviado", "aviso-fallido", "tarea-cerrada", "tarea-no-cerrada"]) assert.equal(acciones.includes(accion), false, `no «${accion}»`);
  assert.equal(acciones.filter((x) => x === "correo-enviado").length, 3);
});

test("reactivar: solo con una versión nueva, por quien creó el flujo; entra la nueva desde el primer paso, el flujo se vuelve a abrir y queda todo en el historial", async () => {
  const e = await escenario();
  await e.decide("luz", "aprobar");
  await e.decide("pepe", "aprobar", "Cumple");
  let f = await e.flujo();
  assert.equal((await estado(e.creador)).cierres[f.id]?.quien, "Pepe", "approved: closed");
  await assert.rejects(() => reactivarFlujo(e.creador, { id: f.id, version: f.version }), (err: unknown) => err instanceof FlujoError && err.code === "sin-version-nueva");
  await e.subir(2);
  assert.equal((await e.modelo()).estado, "aprobado", "a newer version is only noted");
  f = await e.flujo();
  await assert.rejects(() => reactivarFlujo(e.ctx("luz"), { id: f.id, version: f.version }), /Solo quien creó este flujo \(Deivis\) o un administrador del proyecto en Trimble puede reactivarlo/);
  const correosAntes = e.correos.length;
  const r = await reactivarFlujo(e.creador, { id: f.id, version: f.version });
  assert.match(r.mensaje!, /^Se reactivó «aprobar torre 2»: «modelo.rvt» versión 2 entra a revisión desde el primer paso\. Se avisó con 1 correo\.$/);
  const a = await e.modelo();
  assert.equal(a.estado, "nueva-version");
  assert.equal(a.revision, 2);
  assert.equal(a.subidoPor, "Pepe");
  assert.equal(a.pasoNombre, "Revisa");
  assert.deepEqual(a.firmas, [], "a new review of version 2");
  assert.equal(a.revisionAprobada, 1, "version 1 stays as the approved one");
  assert.equal(a.versionNueva ?? null, null);
  assert.equal(e.correos.length, correosAntes + 1);
  assert.equal(e.correos[e.correos.length - 1].para.correo, "luz@obra.co", "Luz gets the e-mail for version 2");
  const h = (await historial(e.creador, f.id)).entradas;
  assert.match(h.find((x) => x.accion === "flujo-reactivado")!.detalle, /^Reactivó «aprobar torre 2»: entra «modelo.rvt» versión 2\. Se revisan desde el primer paso; lo decidido antes queda en el historial\.$/);
  assert.match(h.find((x) => x.accion === "version-reactivada")!.detalle, /^Entra la versión 2 \(subida por Pepe el .+\) al reactivar el flujo «aprobar torre 2»: se revisa desde el primer paso; la versión 1 quedó aprobada\.$/);
  for (const accion of ["aprobado-paso", "aprobado", "version-nueva-vista"]) assert.ok(h.some((x) => x.accion === accion), `the history keeps «${accion}»`);
  // Open again (version 2 waits for its decisions): its creator could change it, and it closes again with the last approval.
  const abierto = await e.flujo();
  assert.deepEqual((await estado(e.creador)).cierres, {});
  await e.decide("luz", "aprobar");
  assert.equal((await e.modelo()).pasoNombre, "Aprueba");
  await e.decide("pepe", "aprobar");
  const otra = await e.flujo();
  assert.equal(otra.id, abierto.id);
  await assert.rejects(() => cambiarEstado(e.creador, { id: otra.id, version: otra.version, activo: false }), (err: unknown) => err instanceof FlujoError && err.code === "flujo-cerrado");
});

test("reactivar un rechazado: entra la versión corregida y quien subió la anterior recibió su correo de corrección", async () => {
  const e = await escenario();
  await e.decide("luz", "rechazar", "Faltan los ejes");
  assert.equal(e.correos[e.correos.length - 1].para.correo, "juan@obra.co");
  await e.subir(2);
  const f = await e.flujo();
  await reactivarFlujo(e.creador, { id: f.id, version: f.version });
  const a = await e.modelo();
  assert.equal(a.estado, "nueva-version");
  assert.match((await historial(e.creador, null, a.id)).entradas.find((x) => x.accion === "version-reactivada")!.detalle, /la versión 1 quedó rechazada\.$/);
});

test("reactivar un flujo desactivado lo deja activo; lo que esperaba decisión pasa a la versión nueva", async () => {
  const e = await escenario();
  await e.subir(2);
  let f = await e.flujo();
  await cambiarEstado(e.creador, { id: f.id, version: f.version, activo: false });
  f = await e.flujo();
  const r = await reactivarFlujo(e.ctx("ana", true), { id: f.id, version: f.version });
  assert.match(r.mensaje!, /\(estaba desactivado: queda activo\)/);
  assert.equal((await e.flujo()).activo, true);
  const a = await e.modelo();
  assert.equal(a.revision, 2);
  assert.match((await historial(e.creador, null, a.id)).entradas.find((x) => x.accion === "version-reactivada")!.detalle, /la versión 1 no se decidió\.$/);
});
