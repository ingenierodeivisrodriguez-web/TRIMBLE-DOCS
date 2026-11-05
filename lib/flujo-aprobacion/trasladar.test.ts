import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../propiedades/service";
import { nubeFalsa } from "../publicar/pruebas/trimbleFalso";
import type { ProjectUser, RawFolderItem } from "../trimbleApi";
import { decidir } from "./decisiones";
import { listarArchivos, revisarFlujo } from "./revision";
import { agregarAsignaciones, Ctx, guardarFlujo, historial, TrimbleFlujo } from "./service";
import { memoryStore } from "./store";
import { pasoTraslado } from "./trasladar";

const persona = (id: string, firstName: string, role = "USER"): ProjectUser => ({ id, firstName, lastName: "", email: `${id}@obra.co`, role, status: "ACTIVE" });
const PERSONAS = [persona("ana", "Ana", "ADMIN"), persona("juan", "Juan"), persona("pepe", "Pepe"), persona("luz", "Luz")];

/**
 * A fake Trimble project: "Arquitectura" (review, with "Torre 1" inside) and
 * "Aprobados" (destination). A one-step flow ("Aprueba", Pepe).
 */
async function escenario(o: { destinoSoloLectura?: boolean; ajenoEnDestino?: boolean } = {}) {
  const nube = nubeFalsa();
  const p = nube.proyecto("P");
  const arq = nube.sembrarCarpeta(p.raiz, "Arquitectura");
  const t1 = nube.sembrarCarpeta(arq, "Torre 1");
  const apr = nube.sembrarCarpeta(p.raiz, "Aprobados", o.destinoSoloLectura ? "READ" : "FULL_ACCESS");
  const modelo = nube.sembrarArchivo(arq, "modelo.rvt", "modelo versión 1", "trb 1");
  const detalle = nube.sembrarArchivo(t1, "detalle.dwg", "detalle versión 1");
  if (o.ajenoEnDestino) nube.sembrarArchivo(apr, "modelo.rvt", "subido a mano al destino");
  const quien = { id: "juan", firstName: "Juan" };
  const elemento = (id: string) => {
    const c = nube.carpetas.get(id)!;
    const arriba: string[] = [];
    for (let x = c.parent ? nube.carpetas.get(c.parent) : undefined; x; x = x.parent ? nube.carpetas.get(x.parent) : undefined) arriba.unshift(x.id);
    const nombres = [...arriba.map((a) => nube.carpetas.get(a)!.name), c.name];
    return { id, ruta: nombres.join(" / "), ancestros: arriba };
  };
  const tc: TrimbleFlujo = {
    carpeta: async (id) => elemento(id),
    archivo: async (id) => {
      const a = nube.archivos.get(id)!;
      const c = elemento(a.parent);
      return { id, ruta: `${c.ruta} / ${a.name}`, ancestros: [...c.ancestros, c.id] };
    },
    personas: async () => PERSONAS,
    grupos: async () => [],
    miembros: async () => [],
    permisos: async () => ({ direct: { acl: {}, inheritance: true }, inherited: {} }),
    items: async (id) => {
      const r = await p.cliente.pedir("GET", `/folders/${id}/items`);
      return (r.cuerpo as RawFolderItem[]).map((x) => (x.type === "FILE" ? { ...x, modifiedBy: quien, modifiedOn: "2026-11-04T15:00:00Z" } : x));
    },
    version: async (id) => {
      const a = nube.archivos.get(id);
      return a ? a.versiones[a.versiones.length - 1].versionId : null;
    },
    crearTarea: async () => ({ estado: 201, cuerpo: { id: "todo" } }),
    lado: { projectId: "P", servidor: p.servidor, cliente: p.cliente },
    fetch: nube.fetchFalso,
  };
  const ctx = (id: string, isAdmin = false): Ctx => ({
    projectId: "P",
    caller: { id, name: PERSONAS.find((x) => x.id === id)!.firstName, isAdmin, memberOfGroups: async () => new Set() } satisfies Caller,
    store: memoryStore(),
    tc,
    ahora: () => new Date("2026-11-04T23:00:00Z"),
  });
  // One store for everyone.
  const store = memoryStore();
  const como = (id: string, isAdmin = false): Ctx => ({ ...ctx(id, isAdmin), store });
  const admin = como("ana", true);
  const f = (await guardarFlujo(admin, { hito: "Aprobar Torre 1", carpetas: [arq], destino: apr, pasos: [{ nombre: "Aprueba" }] })).flujos[0];
  await agregarAsignaciones(admin, { flujoId: f.id, objetivos: [{ tipo: "carpeta", id: arq }], quien: { tipo: "persona", id: "pepe" }, papel: "p1" });
  await revisarFlujo(admin, { flujoId: f.id });
  const registro = async (fileId: string) => (await listarArchivos(admin)).archivos.find((a) => a.fileId === fileId)!;
  const enDestino = (carpeta = apr) => [...nube.archivos.values()].filter((x) => x.parent === carpeta);
  const texto = (b: Uint8Array) => new TextDecoder().decode(b);
  const aprobar = async (fileId: string, por = "pepe") => {
    const a = await registro(fileId);
    return decidir(como(por), { archivoId: a.id, versionId: a.versionId }, "aprobar");
  };
  return { nube, arq, t1, apr, modelo, detalle, como, admin, f, registro, enDestino, texto, aprobar };
}

test("al aprobar el último paso la versión aprobada pasa sola a la carpeta destino como versión 1, y queda quién y cuándo", async () => {
  const e = await escenario();
  const r = await e.aprobar(e.modelo);
  assert.match(r.mensaje, /queda aprobado \(versión 1\)\. Copiado a «P \/ Aprobados» \(versión 1 en el destino\)\./);
  assert.equal(r.traslado?.estado, "hecho");
  const copia = e.enDestino()[0];
  assert.equal(copia.name, "modelo.rvt");
  assert.equal(e.texto(copia.versiones[0].contenido), "modelo versión 1");
  const a = await e.registro(e.modelo);
  assert.equal(a.traslado?.por, "Pepe");
  assert.equal(a.traslado?.destinoRevision, 1);
  const linea = (await historial(e.admin, null, a.id)).entradas.find((x) => x.accion === "trasladado")!;
  assert.equal(linea.usuario, "Pepe");
  assert.equal(linea.detalle, "Copió la versión 1 a «P / Aprobados»: versión 1 en el destino (copia dentro de Trimble).");
});

test("las subcarpetas entre la carpeta de revisión y el archivo se recrean en el destino", async () => {
  const e = await escenario();
  await e.aprobar(e.detalle);
  const torre = [...e.nube.carpetas.values()].find((c) => c.parent === e.apr && c.name === "Torre 1");
  assert.ok(torre, "Torre 1 created under Aprobados");
  assert.deepEqual(
    e.enDestino(torre!.id).map((x) => x.name),
    ["detalle.dwg"]
  );
  assert.equal((await e.registro(e.detalle)).traslado?.carpetaRuta, "P / Aprobados / Torre 1");
});

test("una versión nueva aprobada llega al destino como versión 2 encima de la copia del flujo, por una subida", async () => {
  const e = await escenario();
  await e.aprobar(e.modelo);
  e.nube.sembrarArchivo(e.arq, "modelo.rvt", "modelo versión 2", "trb 2");
  await revisarFlujo(e.admin, { flujoId: e.f.id });
  const r = await e.aprobar(e.modelo);
  assert.equal(r.traslado?.estado, "en-curso", "an upload through the server, then Trimble confirms it");
  const c = await pasoTraslado(e.como("pepe"), { archivoId: (await e.registro(e.modelo)).id, paso: "confirmar" });
  assert.equal(c.traslado?.estado, "hecho");
  assert.equal(c.traslado?.destinoRevision, 2);
  const copia = e.enDestino()[0];
  assert.equal(e.enDestino().length, 1, "same file, not a second one");
  assert.equal(copia.versiones.length, 2);
  assert.equal(e.texto(copia.versiones[1].contenido), "modelo versión 2");
});

test("un archivo con ese nombre que no llegó por el flujo no se reemplaza sin confirmar; al confirmar queda encima como versión nueva", async () => {
  const e = await escenario({ ajenoEnDestino: true });
  const r = await e.aprobar(e.modelo);
  assert.equal(r.traslado?.estado, "diferencia");
  assert.match(r.traslado!.diferenciaTexto, /En «P \/ Aprobados» ya hay un «modelo.rvt» que no llegó por este flujo \(versión 1, Ana Ruiz/);
  assert.equal(e.enDestino()[0].versiones.length, 1, "nothing replaced");
  const a = await e.registro(e.modelo);
  // Someone else (not the approver) can't confirm it.
  await assert.rejects(() => pasoTraslado(e.como("luz"), { archivoId: a.id, paso: "reemplazar", siVersion: a.traslado!.diferenciaVersionId }), /Solo quien lo aprobó \(Pepe\) o un administrador/);
  const otra = await pasoTraslado(e.como("pepe"), { archivoId: a.id, paso: "reemplazar", siVersion: a.traslado!.diferenciaVersionId });
  assert.equal(otra.traslado?.estado, "en-curso");
  const hecho = await pasoTraslado(e.como("pepe"), { archivoId: a.id, paso: "confirmar" });
  assert.equal(hecho.traslado?.estado, "hecho");
  const copia = e.enDestino()[0];
  assert.deepEqual(
    copia.versiones.map((v) => e.texto(v.contenido)),
    ["subido a mano al destino", "modelo versión 1"],
    "the other one stays as version 1 in Trimble's history"
  );
});

test("si no se pudo copiar queda el error, y un administrador lo reintenta con la versión aprobada aunque ya haya otra en revisión", async () => {
  const e = await escenario({ destinoSoloLectura: true });
  const r = await e.aprobar(e.modelo);
  assert.equal(r.traslado?.estado, "error");
  e.nube.sembrarArchivo(e.arq, "modelo.rvt", "modelo versión 2 sin revisar", "trb 2");
  await revisarFlujo(e.admin, { flujoId: e.f.id });
  const a = await e.registro(e.modelo);
  assert.equal(a.estado, "nueva-version");
  await assert.rejects(() => pasoTraslado(e.como("pepe"), { archivoId: a.id, paso: "trasladar" }), /Solo quien lo aprobó o un administrador/);
  e.nube.carpetas.get(e.apr)!.permiso = "FULL_ACCESS";
  const otra = await pasoTraslado(e.admin, { archivoId: a.id, paso: "trasladar" });
  assert.equal(otra.traslado?.estado, "hecho");
  assert.equal(e.texto(e.enDestino()[0].versiones[0].contenido), "modelo versión 1", "the approved version, not the newer one");
  assert.ok((await historial(e.admin, null, a.id)).entradas.some((x) => x.accion === "traslado-error"));
});

test("trasladar otra vez lo que ya está en el destino no hace una copia nueva", async () => {
  const e = await escenario();
  await e.aprobar(e.modelo);
  const a = await e.registro(e.modelo);
  const r = await pasoTraslado(e.como("pepe"), { archivoId: a.id, paso: "trasladar" });
  assert.equal(r.mensaje, "La versión aprobada ya está en la carpeta destino.");
  assert.equal(e.enDestino()[0].versiones.length, 1);
});
