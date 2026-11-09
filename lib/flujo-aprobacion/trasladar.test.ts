import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../propiedades/service";
import { nubeFalsa } from "../publicar/pruebas/trimbleFalso";
import type { ProjectUser, RawFolderItem } from "../trimbleApi";
import { decidir } from "./decisiones";
import { listarArchivos, revisarFlujo } from "./revision";
import { Ctx, guardarFlujo, historial, TrimbleFlujo } from "./service";
import { memoryStore } from "./store";
import { pasoTraslado } from "./trasladar";

const persona = (id: string, firstName: string, role = "USER"): ProjectUser => ({ id, firstName, lastName: "", email: `${id}@obra.co`, role, status: "ACTIVE" });
const PERSONAS = [persona("ana", "Ana", "ADMIN"), persona("juan", "Juan"), persona("pepe", "Pepe"), persona("luz", "Luz")];

/**
 * A fake Trimble project: "Arquitectura" (with "Torre 1" inside) and
 * "Aprobados". A one-step flow ("Aprueba", Pepe) with modelo.rvt and
 * detalle.dwg. By default it is a flow made before 09-11-2026 (review folder
 * Arquitectura, destination Aprobados: approved versions are copied there);
 * with `nuevo`, a flow without destination where Pepe chooses the folder.
 */
async function escenario(o: { destinoSoloLectura?: boolean; ajenoEnDestino?: boolean; nuevo?: boolean } = {}) {
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
    carpeta: async (id) => ({ ...elemento(id), permiso: nube.carpetas.get(id)!.permiso }),
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
  const creado = (await guardarFlujo(admin, { hito: "Aprobar Torre 1", archivos: [modelo, detalle], pasos: [{ nombre: "Aprueba", responsable: { tipo: "persona", id: "pepe" } }] })).flujos[0];
  const f = o.nuevo ? creado : (await store.actualizarFlujo(creado.id, creado.version, { carpetas: [elemento(arq)], destino: elemento(apr) }))!;
  const registro = async (fileId: string) => (await listarArchivos(admin)).archivos.find((a) => a.fileId === fileId)!;
  const enDestino = (carpeta = apr) => [...nube.archivos.values()].filter((x) => x.parent === carpeta);
  const texto = (b: Uint8Array) => new TextDecoder().decode(b);
  const aprobar = async (fileId: string, por = "pepe", destino?: string) => {
    const a = await registro(fileId);
    return decidir(como(por), { archivoId: a.id, versionId: a.versionId, ...(destino ? { destino } : {}) }, "aprobar");
  };
  return { nube, p, arq, t1, apr, modelo, detalle, como, admin, f, registro, enDestino, texto, aprobar };
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
  assert.equal(r.mensaje, "La versión aprobada ya está en «P / Aprobados».");
  assert.equal(e.enDestino()[0].versiones.length, 1);
});

test("flujo nuevo: el responsable aprueba y pone la versión en la carpeta que elige (versión 1 ahí, sin recrear subcarpetas), y queda quién la eligió y cuándo", async () => {
  const e = await escenario({ nuevo: true });
  const r = await e.aprobar(e.modelo, "pepe", e.apr);
  assert.equal(r.mensaje, "«modelo.rvt» queda aprobado (versión 1). Copiado a «P / Aprobados» (versión 1 ahí).");
  assert.equal(r.traslado?.estado, "hecho");
  assert.equal(r.traslado?.carpetaRuta, "P / Aprobados");
  assert.equal(e.texto(e.enDestino()[0].versiones[0].contenido), "modelo versión 1");
  const a = await e.registro(e.modelo);
  const h = (await historial(e.admin, null, a.id)).entradas;
  assert.match(h.find((x) => x.accion === "aprobado")!.detalle, /el archivo queda aprobado. Eligió ponerla en «P \/ Aprobados».$/);
  const puso = h.find((x) => x.accion === "trasladado")!;
  assert.equal(puso.usuario, "Pepe");
  assert.equal(puso.detalle, "Puso la versión 1 aprobada en «P / Aprobados», la carpeta que eligió: versión 1 ahí (copia dentro de Trimble).");
  // A file from a subfolder goes straight into the chosen folder.
  await e.aprobar(e.detalle, "pepe", e.apr);
  assert.deepEqual(
    e.enDestino().map((x) => x.name).sort(),
    ["detalle.dwg", "modelo.rvt"]
  );
});

test("flujo nuevo: sin elegir carpeta el archivo queda aprobado donde está, y después se pone en una carpeta", async () => {
  const e = await escenario({ nuevo: true });
  const r = await e.aprobar(e.modelo);
  assert.equal(r.mensaje, "«modelo.rvt» queda aprobado (versión 1).");
  assert.equal(r.traslado, null);
  const a = await e.registro(e.modelo);
  await assert.rejects(() => pasoTraslado(e.como("pepe"), { archivoId: a.id, paso: "trasladar" }), /Elige la carpeta donde poner la versión aprobada/);
  await assert.rejects(() => pasoTraslado(e.como("luz"), { archivoId: a.id, paso: "trasladar", carpetaId: e.apr }), /Solo quien lo aprobó \(Pepe\) o un administrador puede ponerlo en una carpeta/);
  const despues = await pasoTraslado(e.como("pepe"), { archivoId: a.id, paso: "trasladar", carpetaId: e.apr });
  assert.equal(despues.traslado?.estado, "hecho");
  assert.equal(e.enDestino().length, 1);
});

test("flujo nuevo: no se elige la carpeta del archivo, una de solo lectura ni una donde ese nombre va por un flujo; y entonces no se decide nada", async () => {
  const e = await escenario({ nuevo: true, destinoSoloLectura: true });
  await assert.rejects(() => e.aprobar(e.modelo, "pepe", e.arq), /«P \/ Arquitectura» es la carpeta donde está el archivo/);
  await assert.rejects(() => e.aprobar(e.modelo, "pepe", e.apr), /Solo tienes lectura en «P \/ Aprobados»/);
  const otro = e.nube.sembrarArchivo(e.t1, "modelo.rvt", "otro modelo en Torre 1");
  await guardarFlujo(e.admin, { hito: "Aprobar modelo de Torre 1", archivos: [otro], pasos: [{ nombre: "Aprueba", responsable: { tipo: "persona", id: "luz" } }] });
  await assert.rejects(() => e.aprobar(e.modelo, "pepe", e.t1), /En «P \/ Arquitectura \/ Torre 1» está «modelo.rvt», que va por el flujo «Aprobar modelo de Torre 1»/);
  const a = await e.registro(e.modelo);
  assert.equal(a.estado, "pendiente", "nothing was decided");
  assert.deepEqual(a.firmas, []);
});

test("flujo nuevo: la versión nueva aprobada en la misma carpeta queda como versión 2 del mismo archivo; en una carpeta con otro archivo de ese nombre se pregunta", async () => {
  const e = await escenario({ nuevo: true });
  await e.aprobar(e.modelo, "pepe", e.apr);
  e.nube.sembrarArchivo(e.arq, "modelo.rvt", "modelo versión 2", "trb 2");
  await revisarFlujo(e.admin, { flujoId: e.f.id });
  const r = await e.aprobar(e.modelo, "pepe", e.apr);
  assert.equal(r.traslado?.estado, "en-curso");
  const c = await pasoTraslado(e.como("pepe"), { archivoId: (await e.registro(e.modelo)).id, paso: "confirmar" });
  assert.equal(c.traslado?.destinoRevision, 2);
  assert.equal(e.enDestino().length, 1, "same file, not a second one");
  // Another folder that already has a "detalle.dwg" the flow didn't put there.
  const otra = e.nube.sembrarCarpeta(e.p.raiz, "Entregas");
  e.nube.sembrarArchivo(otra, "detalle.dwg", "subido a mano");
  const d = await e.aprobar(e.detalle, "pepe", otra);
  assert.equal(d.traslado?.estado, "diferencia");
  assert.match(d.traslado!.diferenciaTexto, /En «P \/ Entregas» ya hay un «detalle.dwg» que no llegó por este flujo/);
});

test("la trazabilidad de un archivo cuenta quién subió, quién aprobó y quién trasladó, y rechaza filtros malos", async () => {
  const e = await escenario();
  await e.aprobar(e.modelo);
  const { trazabilidad } = await import("./service");
  const r = await trazabilidad(e.admin, new URLSearchParams({ estado: "aprobado" }));
  assert.equal(r.trazas.length, 1);
  assert.deepEqual(
    r.trazas[0].eventos.filter((x) => x.accion !== "aviso-enviado").map((x) => [x.que, x.quien]),
    [
      ["Subió un archivo", "Juan"],
      ["Aprobó", "Pepe"],
      ["Trasladó al destino", "Pepe"],
    ]
  );
  assert.equal(r.hitos[e.f.id], "Aprobar Torre 1");
  const una = await trazabilidad(e.como("luz"), new URLSearchParams({ archivoId: r.trazas[0].archivo.id }));
  assert.equal(una.trazas.length, 1, "any member can read it");
  await assert.rejects(() => trazabilidad(e.admin, new URLSearchParams({ desde: "04-11-2026" })), /Las fechas no son válidas/);
  await assert.rejects(() => trazabilidad(e.admin, new URLSearchParams({ desde: "2026-11-05", hasta: "2026-11-01" })), /posterior a la final/);
  await assert.rejects(() => trazabilidad(e.admin, new URLSearchParams({ estado: "borrado" })), /El estado no es válido/);
});
