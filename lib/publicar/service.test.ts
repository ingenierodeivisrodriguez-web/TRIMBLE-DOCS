import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../propiedades/service";
import { nubeFalsa } from "./pruebas/trimbleFalso";
import { cambiarEstado, Ctx, getActividad, getPublicaciones, getRecepciones, guardarRecepcion, desactivarRecepcion, PasoArchivo, publicar, recepcionHacia, revisarAcceso, sincronizar } from "./service";
import { memoryStore } from "./store";
import type { PlanSincronizacion } from "./types";

const ADMIN_LAB: Caller = { id: "u-admin", name: "Admin Laboratorio", isAdmin: true };
const ANA: Caller = { id: "u-ana", name: "Ana Ruiz", isAdmin: false };
const LUIS: Caller = { id: "u-luis", name: "Luis Pérez", isAdmin: false };
const NOMBRES: Record<string, string> = { SELVIA: "Selvia", LAB: "Laboratorio" };

/** Origin SELVIA (Planos/EST-001.pdf and Planos/Detalles/DET-01.pdf); destination LAB with a "Recibidos" folder. */
function escenario(opciones: { sinCopiaTrimble?: boolean } = {}) {
  const nube = nubeFalsa(opciones);
  const proyectos = { SELVIA: nube.proyecto("SELVIA"), LAB: nube.proyecto("LAB") };
  const lado = (id: string) => ({ projectId: id, ...proyectos[id as keyof typeof proyectos] });
  const store = memoryStore();
  const planos = nube.sembrarCarpeta(proyectos.SELVIA.raiz, "Planos");
  const plano = nube.sembrarArchivo(planos, "EST-001.pdf", "plano versión 1");
  const detalles = nube.sembrarCarpeta(planos, "Detalles");
  nube.sembrarArchivo(detalles, "DET-01.pdf", "detalle 1");
  const recibidos = nube.sembrarCarpeta(proyectos.LAB.raiz, "Recibidos");
  const sinAcceso = () => new Error("El proyecto no fue encontrado, o el usuario actual no tiene acceso a el.");
  /** `tecnica`: the projects the technical account was invited to (none: not connected). */
  const ctx = (projectId: string, caller: Caller, miembroDe = ["SELVIA", "LAB"], tecnica: string[] | null = null): Ctx => ({
    projectId,
    caller,
    store,
    deps: {
      aqui: lado(projectId),
      abrir: async (id) => {
        if (!miembroDe.includes(id) || !(id in proyectos)) throw sinAcceso();
        return lado(id);
      },
      nombreProyecto: async (id) => {
        if (!miembroDe.includes(id)) throw new Error("sin acceso");
        return NOMBRES[id] ?? id;
      },
      tecnico: {
        cuenta: async () => (tecnica ? { email: "publicaciones@dyco.co" } : null),
        abrir: async (id) => {
          if (!tecnica?.includes(id)) throw sinAcceso();
          return lado(id);
        },
        nombreProyecto: async (id) => {
          if (!tecnica?.includes(id)) throw sinAcceso();
          return NOMBRES[id] ?? id;
        },
      },
      fetch: nube.fetchFalso,
    },
  });
  /** Reviews and copies everything pending, as the screen does when it opens. */
  async function alDia(c: Ctx): Promise<{ plan: PlanSincronizacion; pasos: PasoArchivo[] }> {
    const plan = (await sincronizar(c, { paso: "plan" })) as PlanSincronizacion;
    const pasos: PasoArchivo[] = [];
    for (const t of plan.tareas) {
      let r = (await sincronizar(c, { paso: "copiar", archivoId: t.archivoId })) as PasoArchivo;
      for (let i = 0; r.ok && !r.listo && i < 5; i++) r = (await sincronizar(c, { paso: "confirmar", archivoId: t.archivoId })) as PasoArchivo;
      pasos.push(r);
    }
    return { plan, pasos };
  }
  const enCarpeta = (carpeta: string) => [...nube.archivos.values()].filter((a) => a.parent === carpeta);
  const subcarpeta = (padre: string, nombre: string) => [...nube.carpetas.values()].find((c) => c.parent === padre && c.name === nombre);
  return { nube, store, ctx, alDia, plano, planos, detalles, recibidos, enCarpeta, subcarpeta };
}

const recibir = (e: ReturnType<typeof escenario>) => guardarRecepcion(e.ctx("LAB", ADMIN_LAB), { origen: "SELVIA", carpetaId: e.recibidos });

test("solo un administrador del destino define la carpeta de recepción, y queda en la actividad", async () => {
  const e = escenario();
  await assert.rejects(() => guardarRecepcion(e.ctx("LAB", ANA), { origen: "SELVIA", carpetaId: e.recibidos }), /Solo un administrador/);
  const r = await recibir(e);
  assert.equal(r.recepciones.length, 1);
  assert.equal(r.recepciones[0].carpetaRuta, "Laboratorio / Recibidos");
  assert.equal(r.recepciones[0].origenNombre, "Selvia");
  const { entradas } = await getActividad(e.ctx("LAB", ANA), {});
  assert.equal(entradas[0].accion, "recepcion");
  assert.match(entradas[0].nota, /Laboratorio \/ Recibidos/);
});

test("publicar un archivo lo copia directo en la carpeta de recepción, con la nota en la actividad", async () => {
  const e = escenario();
  await recibir(e);
  const desde = await recepcionHacia(e.ctx("SELVIA", ANA), "LAB");
  assert.equal(desde.recepcion?.carpetaRuta, "Laboratorio / Recibidos");
  const r = await publicar(e.ctx("SELVIA", ANA), { destino: "LAB", items: [{ tipo: "archivo", id: e.plano }], nota: "Para coordinación de estructura" });
  assert.equal(r.publicadas.length, 1);
  const { plan, pasos } = await e.alDia(e.ctx("SELVIA", ANA));
  assert.equal(plan.tareas.length, 1);
  assert.equal(pasos[0].ok, true, pasos[0].mensaje);
  const copiados = e.enCarpeta(e.recibidos);
  assert.equal(copiados.length, 1);
  assert.equal(copiados[0].name, "EST-001.pdf");
  assert.equal(copiados[0].versiones.length, 1);
  const { entradas } = await getActividad(e.ctx("LAB", ADMIN_LAB), {});
  const [copia, publicada] = entradas;
  assert.equal(publicada.accion, "publicar");
  assert.equal(publicada.nota, "Para coordinación de estructura");
  assert.equal(publicada.usuario, "Ana Ruiz");
  assert.equal(copia.accion, "copiar");
  assert.equal(copia.versionOrigen, 1);
  assert.equal(copia.versionDestino, 1);
  const pubs = await getPublicaciones(e.ctx("LAB", ADMIN_LAB));
  assert.equal(pubs.publicaciones[0].archivos[0].estado, "al-dia");
});

test("una versión nueva en el origen llega como versión nueva del mismo archivo en el destino", async () => {
  const e = escenario();
  await recibir(e);
  await publicar(e.ctx("SELVIA", ANA), { destino: "LAB", items: [{ tipo: "archivo", id: e.plano }], nota: "" });
  await e.alDia(e.ctx("SELVIA", ANA));
  e.nube.sembrarArchivo(e.planos, "EST-001.pdf", "plano versión 2");
  // Opened from the destination by someone who belongs to both projects.
  const { plan, pasos } = await e.alDia(e.ctx("LAB", ADMIN_LAB));
  assert.equal(plan.tareas[0].motivo, "version");
  assert.equal(pasos[0].ok, true, pasos[0].mensaje);
  const [a] = e.enCarpeta(e.recibidos);
  assert.equal(a.versiones.length, 2);
  assert.equal(new TextDecoder().decode(a.versiones[1].contenido), "plano versión 2");
  const { entradas } = await getActividad(e.ctx("SELVIA", ANA), {});
  assert.equal(entradas[0].accion, "actualizar");
  assert.equal(entradas[0].nota, "Actualización automática – versión 2 del origen.");
  assert.equal(entradas[0].usuario, "Admin Laboratorio");
  const otra = await e.alDia(e.ctx("SELVIA", ANA));
  assert.equal(otra.plan.tareas.length, 0, "al día: no hay nada que copiar");
});

test("sin carpeta de recepción la publicación espera, y se copia cuando el administrador la define", async () => {
  const e = escenario();
  await publicar(e.ctx("SELVIA", ANA), { destino: "LAB", items: [{ tipo: "archivo", id: e.plano }], nota: "" });
  const antes = await e.alDia(e.ctx("SELVIA", ANA));
  assert.equal(antes.plan.tareas.length, 0);
  assert.match(antes.plan.avisos[0], /espera que un administrador de Laboratorio defina la carpeta de recepción/);
  await recibir(e);
  const despues = await e.alDia(e.ctx("SELVIA", ANA));
  assert.equal(despues.pasos[0].ok, true);
  assert.equal(e.enCarpeta(e.recibidos).length, 1);
});

test("una carpeta publicada llega como carpeta en la recepción, con sus subcarpetas y los archivos nuevos", async () => {
  const e = escenario();
  await recibir(e);
  await publicar(e.ctx("SELVIA", ANA), { destino: "LAB", items: [{ tipo: "carpeta", id: e.planos }], nota: "Carpeta de planos" });
  const { pasos } = await e.alDia(e.ctx("SELVIA", ANA));
  assert.equal(pasos.length, 2);
  assert.ok(pasos.every((p) => p.ok));
  const planosDestino = e.subcarpeta(e.recibidos, "Planos")!;
  assert.ok(planosDestino);
  assert.deepEqual(e.enCarpeta(planosDestino.id).map((a) => a.name), ["EST-001.pdf"]);
  const detallesDestino = e.subcarpeta(planosDestino.id, "Detalles")!;
  assert.deepEqual(e.enCarpeta(detallesDestino.id).map((a) => a.name), ["DET-01.pdf"]);
  e.nube.sembrarArchivo(e.detalles, "DET-02.pdf", "detalle 2");
  const otra = await e.alDia(e.ctx("SELVIA", ANA));
  assert.equal(otra.plan.tareas.length, 1);
  assert.equal(otra.plan.tareas[0].subcarpeta, "Detalles");
  assert.deepEqual(e.enCarpeta(detallesDestino.id).map((a) => a.name).sort(), ["DET-01.pdf", "DET-02.pdf"]);
  assert.equal([...e.nube.carpetas.values()].filter((c) => c.name === "Planos").length, 2, "una en el origen y una en el destino");
});

test("un cambio hecho en el destino no se pisa: queda como diferencia hasta que alguien lo reemplace", async () => {
  const e = escenario();
  await recibir(e);
  await publicar(e.ctx("SELVIA", ANA), { destino: "LAB", items: [{ tipo: "archivo", id: e.plano }], nota: "" });
  await e.alDia(e.ctx("SELVIA", ANA));
  e.nube.sembrarArchivo(e.recibidos, "EST-001.pdf", "cambio hecho en la obra");
  e.nube.sembrarArchivo(e.planos, "EST-001.pdf", "plano versión 2");
  const { pasos } = await e.alDia(e.ctx("SELVIA", ANA));
  assert.equal(pasos[0].ok, false);
  assert.equal(pasos[0].diferencia, true);
  assert.match(pasos[0].mensaje, /No se reemplaza sin confirmación/);
  const [a] = e.enCarpeta(e.recibidos);
  assert.equal(a.versiones.length, 2, "quedó el cambio de la obra");
  const otra = await e.alDia(e.ctx("SELVIA", ANA));
  assert.equal(otra.plan.tareas.length, 0);
  assert.equal(otra.plan.diferencias, 1);
  const [seguido] = (await getPublicaciones(e.ctx("LAB", ADMIN_LAB))).publicaciones[0].archivos;
  assert.equal(seguido.estado, "diferencia");
  const vieja = (await sincronizar(e.ctx("LAB", ADMIN_LAB), { paso: "reemplazar", archivoId: seguido.id, siVersion: "archivo-v1" })) as PasoArchivo;
  assert.equal(vieja.ok, false, "solo con la versión que se vio");
  const r = (await sincronizar(e.ctx("LAB", ADMIN_LAB), { paso: "reemplazar", archivoId: seguido.id, siVersion: `${a.id}-v2` })) as PasoArchivo;
  assert.equal(r.ok, true, r.mensaje);
  assert.equal(e.enCarpeta(e.recibidos)[0].versiones.length, 3);
  const { entradas } = await getActividad(e.ctx("LAB", ADMIN_LAB), {});
  assert.deepEqual(entradas.slice(0, 2).map((x) => x.accion), ["reemplazar", "diferencia"]);
});

test("un archivo borrado en el origen queda retirado y no se borra en el destino", async () => {
  const e = escenario();
  await recibir(e);
  await publicar(e.ctx("SELVIA", ANA), { destino: "LAB", items: [{ tipo: "archivo", id: e.plano }], nota: "" });
  await e.alDia(e.ctx("SELVIA", ANA));
  e.nube.quitarArchivo(e.plano);
  const { plan } = await e.alDia(e.ctx("SELVIA", ANA));
  assert.match(plan.avisos[0], /ya no está en el origen/);
  assert.equal(e.enCarpeta(e.recibidos).length, 1);
  const [p] = (await getPublicaciones(e.ctx("SELVIA", ANA))).publicaciones;
  assert.equal(p.estado, "retirada");
  assert.equal((await getActividad(e.ctx("LAB", ADMIN_LAB), {})).entradas[0].accion, "retirado");
});

test("detener deja de actualizar y reanudar vuelve; solo quien publicó o un administrador", async () => {
  const e = escenario();
  await recibir(e);
  const { publicadas } = await publicar(e.ctx("SELVIA", ANA), { destino: "LAB", items: [{ tipo: "archivo", id: e.plano }], nota: "" });
  await e.alDia(e.ctx("SELVIA", ANA));
  await assert.rejects(() => cambiarEstado(e.ctx("SELVIA", LUIS), { id: publicadas[0], accion: "detener" }), /Solo quien la publicó/);
  await cambiarEstado(e.ctx("SELVIA", ANA), { id: publicadas[0], accion: "detener" });
  e.nube.sembrarArchivo(e.planos, "EST-001.pdf", "plano versión 2");
  assert.equal((await e.alDia(e.ctx("SELVIA", ANA))).plan.tareas.length, 0);
  await cambiarEstado(e.ctx("LAB", ADMIN_LAB), { id: publicadas[0], accion: "reanudar" });
  assert.equal((await e.alDia(e.ctx("SELVIA", ANA))).plan.tareas.length, 1);
});

test("dos personas no copian el mismo archivo a la vez", async () => {
  const e = escenario();
  await recibir(e);
  await publicar(e.ctx("SELVIA", ANA), { destino: "LAB", items: [{ tipo: "archivo", id: e.plano }], nota: "" });
  const plan = (await sincronizar(e.ctx("SELVIA", ANA), { paso: "plan" })) as PlanSincronizacion;
  const id = plan.tareas[0].archivoId;
  assert.equal(await e.store.tomarArchivo(id, new Date(Date.now() + 600_000).toISOString(), new Date().toISOString()), true);
  const r = (await sincronizar(e.ctx("LAB", ADMIN_LAB), { paso: "copiar", archivoId: id })) as PasoArchivo;
  assert.equal(r.ocupado, true);
  assert.equal(e.enCarpeta(e.recibidos).length, 0);
});

test("sin ser miembro del destino solo se publica si definió la carpeta de recepción; sin nadie en los dos ni cuenta técnica, el plan avisa", async () => {
  const e = escenario();
  const luis = () => e.ctx("SELVIA", LUIS, ["SELVIA"]);
  await assert.rejects(() => publicar(luis(), { destino: "LAB", items: [{ tipo: "archivo", id: e.plano }], nota: "" }), /no ha definido una carpeta de recepción/);
  await assert.rejects(() => recepcionHacia(luis(), "LAB"), /no ha definido una carpeta de recepción/);
  await recibir(e);
  const r = await publicar(luis(), { destino: "LAB", items: [{ tipo: "archivo", id: e.plano }], nota: "" });
  assert.equal(r.publicadas.length, 1);
  const { plan } = await e.alDia(e.ctx("LAB", ADMIN_LAB, ["LAB"]));
  assert.equal(plan.tareas.length, 0);
  assert.match(plan.avisos[0], /miembro de los dos proyectos, o la cuenta técnica/);
  assert.equal((await getActividad(e.ctx("OTRO", LUIS, ["OTRO"]), {})).entradas.length, 0, "otro proyecto no ve esta actividad");
});

test("con la cuenta técnica invitada a los dos proyectos se copia aunque nadie sea miembro de ambos", async () => {
  const e = escenario();
  const ambos = ["SELVIA", "LAB"];
  // The destination's administrator isn't a member of SELVIA: its name comes through the technical account.
  const r = await guardarRecepcion(e.ctx("LAB", ADMIN_LAB, ["LAB"], ambos), { origen: "SELVIA", carpetaId: e.recibidos });
  assert.equal(r.recepciones[0].origenNombre, "Selvia");
  assert.equal(r.recepciones[0].destinoNombre, "Laboratorio");
  await publicar(e.ctx("SELVIA", LUIS, ["SELVIA"], ambos), { destino: "LAB", items: [{ tipo: "archivo", id: e.plano }], nota: "Emisión" });
  const { pasos } = await e.alDia(e.ctx("SELVIA", LUIS, ["SELVIA"], ambos));
  assert.equal(pasos[0]?.ok, true, pasos[0]?.mensaje);
  assert.equal(e.enCarpeta(e.recibidos).length, 1);
  const { entradas } = await getActividad(e.ctx("LAB", ADMIN_LAB, ["LAB"]), {});
  assert.equal(entradas[0].accion, "copiar");
  assert.match(entradas[0].nota, /Copiado con la cuenta técnica/);
  assert.equal(entradas[0].usuario, "Luis Pérez", "queda quien tenía la extensión abierta");
  // A new version, reviewed from the destination by someone who only belongs there.
  e.nube.sembrarArchivo(e.planos, "EST-001.pdf", "plano versión 2");
  const otra = await e.alDia(e.ctx("LAB", ADMIN_LAB, ["LAB"], ambos));
  assert.equal(otra.pasos[0]?.ok, true);
  assert.equal(e.enCarpeta(e.recibidos)[0].versiones.length, 2);
});

test("si la cuenta técnica no está invitada a uno de los proyectos, el aviso lo dice", async () => {
  const e = escenario();
  await recibir(e);
  await publicar(e.ctx("SELVIA", ANA), { destino: "LAB", items: [{ tipo: "archivo", id: e.plano }], nota: "" });
  const { plan } = await e.alDia(e.ctx("LAB", ADMIN_LAB, ["LAB"], ["LAB"]));
  assert.equal(plan.tareas.length, 0);
  assert.match(plan.avisos[0], /publicaciones@dyco\.co\) aún no es miembro de los dos proyectos/);
});

test("quien publica sin ver el destino le da su nombre real al proyecto origen en la recepción", async () => {
  const e = escenario();
  await guardarRecepcion(e.ctx("LAB", ADMIN_LAB, ["LAB"]), { origen: "SELVIA", carpetaId: e.recibidos });
  assert.equal((await recepcionHacia(e.ctx("SELVIA", LUIS, ["SELVIA"]), "LAB")).recepcion?.origenNombre, "SELVIA", "el administrador no lo ve: queda el id");
  await publicar(e.ctx("SELVIA", LUIS, ["SELVIA"]), { destino: "LAB", items: [{ tipo: "archivo", id: e.plano }], nota: "" });
  const [rec] = (await getRecepciones(e.ctx("LAB", ADMIN_LAB, ["LAB"]))).recepciones;
  assert.equal(rec.origenNombre, "Selvia");
});

test("la revisión de acceso dice qué le falta a la cuenta técnica en cada carpeta", async () => {
  const e = escenario();
  assert.match((await revisarAcceso(e.ctx("LAB", ADMIN_LAB))).comprobaciones[0].mensaje, /no está conectada/);
  assert.match((await revisarAcceso(e.ctx("LAB", ADMIN_LAB, ["LAB"], ["SELVIA"]))).comprobaciones[1].mensaje, /Invita a publicaciones@dyco\.co a este proyecto/);
  await recibir(e);
  e.nube.carpetas.get(e.recibidos)!.permiso = "READ";
  const { comprobaciones } = await revisarAcceso(e.ctx("LAB", ADMIN_LAB, ["LAB"], ["LAB", "SELVIA"]));
  const rec = comprobaciones.find((c) => c.que.startsWith("Recepción de"))!;
  assert.equal(rec.ok, false);
  assert.match(rec.mensaje, /Solo puede leer «Laboratorio \/ Recibidos»/);
  await publicar(e.ctx("SELVIA", ANA), { destino: "LAB", items: [{ tipo: "carpeta", id: e.planos }], nota: "" });
  const desdeOrigen = (await revisarAcceso(e.ctx("SELVIA", ANA, ["SELVIA", "LAB"], ["LAB", "SELVIA"]))).comprobaciones;
  assert.equal(desdeOrigen.find((c) => c.que === "Publicado: Planos")?.ok, true);
});

test("si Trimble no copia entre proyectos, el servidor sube el archivo y la copia se registra al confirmarse", async () => {
  const e = escenario({ sinCopiaTrimble: true });
  await recibir(e);
  await publicar(e.ctx("SELVIA", ANA), { destino: "LAB", items: [{ tipo: "archivo", id: e.plano }], nota: "" });
  const plan = (await sincronizar(e.ctx("SELVIA", ANA), { paso: "plan" })) as PlanSincronizacion;
  const c = (await sincronizar(e.ctx("SELVIA", ANA), { paso: "copiar", archivoId: plan.tareas[0].archivoId })) as PasoArchivo;
  assert.equal(c.listo, false);
  assert.ok(c.uploadId);
  const f = (await sincronizar(e.ctx("SELVIA", ANA), { paso: "confirmar", archivoId: plan.tareas[0].archivoId })) as PasoArchivo;
  assert.equal(f.listo, true, f.mensaje);
  assert.equal((await getActividad(e.ctx("SELVIA", ANA), {})).entradas[0].accion, "copiar");
});

test("publicar dos veces lo mismo avisa y no lo duplica; una carpeta de recepción desactivada no recibe lo nuevo", async () => {
  const e = escenario();
  await recibir(e);
  await publicar(e.ctx("SELVIA", ANA), { destino: "LAB", items: [{ tipo: "archivo", id: e.plano }], nota: "" });
  const otra = await publicar(e.ctx("SELVIA", ANA), { destino: "LAB", items: [{ tipo: "archivo", id: e.plano }], nota: "" });
  assert.equal(otra.publicadas.length, 0);
  assert.match(otra.avisos[0], /ya está publicado en Laboratorio/);
  await desactivarRecepcion(e.ctx("LAB", ADMIN_LAB), { origen: "SELVIA" });
  assert.equal((await recepcionHacia(e.ctx("SELVIA", ANA), "LAB")).recepcion, null);
  assert.equal((await e.alDia(e.ctx("SELVIA", ANA))).plan.tareas.length, 0);
});

test("la actividad se filtra por días y rechaza fechas mal escritas", async () => {
  const e = escenario();
  await recibir(e);
  assert.equal((await getActividad(e.ctx("LAB", ANA), { desde: "2999-01-01" })).entradas.length, 0);
  assert.equal((await getActividad(e.ctx("LAB", ANA), { hasta: "2000-01-01" })).entradas.length, 0);
  assert.equal((await getActividad(e.ctx("LAB", ANA), {})).entradas.length, 1);
  await assert.rejects(() => getActividad(e.ctx("LAB", ANA), { desde: "28-10-2026" }), /fecha no es válida/);
});
