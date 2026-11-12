import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../propiedades/service";
import type { ProjectUser, RawFolderItem } from "../trimbleApi";
import { CONFIG_INICIAL } from "./configCorreo";
import { Correo, correoPrueba, guardarCorreos, MensajeCorreo } from "./correo";
import { decidir } from "./decisiones";
import { abrirEnlace, MINUTOS_CLIC, nuevoToken, tomarPendiente } from "./enlaces";
import { FlujoError } from "./errores";
import { armarRecordatorio, enviarRecordatorios, QUIEN_RECUERDA } from "./recordatorios";
import { listarArchivos } from "./revision";
import { Ctx, guardarFlujo, historial, TrimbleFlujo } from "./service";
import { memoryStore } from "./store";
import { ACCIONES } from "./trazabilidad";

const ORIGEN = "https://app.test";
const EXT = "https://web.connect.trimble.com/projects/P/extension/8e7cd6d3-3e0e-16d7-12f4-02d6a673090e/flujo_aprobacion_open";
const persona = (id: string, firstName: string, extra: Partial<ProjectUser> = {}): ProjectUser => ({ id, firstName, lastName: "Pérez", email: `${id}@obra.co`, role: "USER", status: "ACTIVE", ...extra });
const EQUIPO = [persona("ana", "Ana", { role: "ADMIN" }), persona("juan", "Juan"), persona("luz", "Luz"), persona("pepe", "Pepe"), persona("deivis", "Deivis")];
const tokenDe = (m: MensajeCorreo) => /\/api\/flujo-aprobacion\/ir\/([A-Za-z0-9_-]+)/.exec(m.texto)?.[1] ?? "";

/**
 * Two files, each in its own flow (both due 10-11-2026): «Planos torre 1» (modelo.rvt:
 * Revisa = Luz, Aprueba = Pepe) and, with `dos`, «Planos torre 2» (plano.pdf: Revisa = Luz).
 * The clock starts on 11-11-2026 13:38 in Colombia and moves with `minutos`.
 */
async function escenario(opciones: { origen?: string | null; dos?: boolean; config?: Record<string, unknown>; falla?: (m: MensajeCorreo) => unknown } = {}) {
  const store = memoryStore();
  let reloj = Date.parse("2026-11-11T18:38:00Z");
  const item = (id: string, name: string): RawFolderItem => ({ id, name, type: "FILE", createdOn: "", modifiedOn: "2026-11-01T15:00:00.000Z", modifiedBy: { id: "juan", firstName: "Juan" }, versionId: `${id}-v1`, revision: 1 });
  const items = [item("modelo", "modelo.rvt"), item("plano", "plano.pdf")];
  const tc: TrimbleFlujo = {
    carpeta: async () => {
      throw new FlujoError("No se usa.", 500);
    },
    archivo: async (id) => ({ id, ruta: `Obra / Arquitectura / ${id}`, ancestros: ["raiz", "arq"] }),
    personas: async () => EQUIPO,
    grupos: async () => [],
    miembros: async () => [],
    permisos: async () => ({ direct: { acl: {}, inheritance: true }, inherited: {} }),
    items: async (id) => (id === "arq" ? items : []),
    version: async (id) => `${id}-v1`,
    lado: { projectId: "P", servidor: "https://falso", cliente: { pedir: async () => ({ estado: 404, cuerpo: null }) } },
    crearTarea: async () => ({ estado: 201, cuerpo: { id: `todo-${Math.random()}` } }),
    actualizarTarea: async (_id, cuerpo) => ({ estado: 200, cuerpo: { status: cuerpo.status } }),
    nombreProyecto: async () => "SELVIA",
  };
  const enviados: MensajeCorreo[] = [];
  const correo: Correo = {
    desde: "avisos@gmail.com",
    async enviar(m) {
      const err = opciones.falla?.(m);
      if (err) throw err;
      enviados.push(m);
    },
  };
  const origen = opciones.origen === undefined ? ORIGEN : opciones.origen;
  const ctx = (id: string, isAdmin = false): Ctx => ({
    projectId: "P",
    caller: { id, name: EQUIPO.find((p) => p.id === id)!.firstName, isAdmin, memberOfGroups: async () => new Set() } satisfies Caller,
    store,
    tc,
    ahora: () => new Date(reloj),
    correo,
    ...(origen ? { origen } : {}),
  });
  if (opciones.config) await guardarCorreos(ctx("ana", true), { config: { ...CONFIG_INICIAL, ...opciones.config }, version: 0 });
  const flujo = (hito: string, archivo: string, pasos: { nombre: string; responsable: { tipo: "persona"; id: string } }[]) =>
    guardarFlujo(ctx("deivis"), { hito, vence: "2026-11-10", notas: "", archivos: [archivo], pasos });
  await flujo("Planos torre 1", "modelo", [
    { nombre: "Revisa", responsable: { tipo: "persona", id: "luz" } },
    { nombre: "Aprueba", responsable: { tipo: "persona", id: "pepe" } },
  ]);
  if (opciones.dos) await flujo("Planos torre 2", "plano", [{ nombre: "Revisa", responsable: { tipo: "persona", id: "luz" } }]);
  const archivo = async (fileId: string) => (await listarArchivos(ctx("deivis"))).archivos.find((a) => a.fileId === fileId)!;
  const entradas = async () => (await historial(ctx("deivis"), null, null)).entradas;
  const recordar = (ahora = new Date(reloj)) => enviarRecordatorios({ store, correo, origen, ahora });
  return { store, ctx, enviados, archivo, entradas, recordar, minutos: (n: number) => (reloj += n * 60_000), ahora: () => new Date(reloj) };
}

test("cada correo lleva el enlace propio de su persona, con el botón «Abrir el flujo FLUJO-01»", async () => {
  const e = await escenario();
  const [m] = e.enviados;
  assert.match(m.texto, /\nAbrir el flujo FLUJO-01: https:\/\/app\.test\/api\/flujo-aprobacion\/ir\/[A-Za-z0-9_-]{32}\n/);
  assert.match(m.html, />Abrir el flujo FLUJO-01<\/a>/);
  const enlace = await e.store.enlace(tokenDe(m));
  const modelo = await e.archivo("modelo");
  assert.equal(enlace?.usuarioId, "luz");
  assert.equal(enlace?.correo, "luz@obra.co");
  assert.equal(enlace?.tipo, "revision");
  assert.deepEqual(enlace?.archivos, [modelo.id]);
  assert.equal(enlace?.pasoId, modelo.pasos[0].id);
  assert.equal(enlace?.proyectoNombre, "SELVIA");
  assert.equal(enlace?.expira, "2027-01-10T18:38:00.000Z", "it works for 60 days");

  const sin = await escenario({ origen: null });
  assert.match(sin.enviados[0].texto, /\nAbrir Flujo de aprobación: https:\/\/web\.connect\.trimble\.com\/projects\/P\/extension\//, "without this app's address, the extension's");
  assert.notEqual(nuevoToken(), nuevoToken());
});

test("el clic en el botón lleva a la extensión del proyecto; un enlace que no existe o vencido no lleva a ninguna parte", async () => {
  const e = await escenario();
  const token = tokenDe(e.enviados[0]);
  assert.equal(await abrirEnlace(e.store, token, e.ahora()), EXT);
  assert.equal((await e.store.enlace(token))?.abierto, "2026-11-11T18:38:00.000Z");
  assert.equal(await abrirEnlace(e.store, "no-existe-pero-tiene-forma-123", e.ahora()), null);
  assert.equal(await abrirEnlace(e.store, "<script>", e.ahora()), null);
  assert.equal(await abrirEnlace(e.store, token, new Date(Date.parse("2027-01-11T00:00:00Z"))), null, "after 60 days");

  // The project's own extension address wins.
  await guardarCorreos(e.ctx("ana", true), { config: { ...CONFIG_INICIAL, enlace: "https://web.connect.trimble.com/projects/P/extension/otro-codigo-9/flujo_aprobacion_open" }, version: 0 });
  assert.equal(await abrirEnlace(e.store, token, e.ahora()), "https://web.connect.trimble.com/projects/P/extension/otro-codigo-9/flujo_aprobacion_open");
});

test("al abrir la extensión después del clic se abre ese flujo, una sola vez y solo para la persona del correo", async () => {
  const e = await escenario();
  const token = tokenDe(e.enviados[0]);
  assert.deepEqual(await tomarPendiente(e.ctx("luz")), { flujoId: null, porRevisar: false, mensaje: null }, "no click yet");
  await abrirEnlace(e.store, token, e.ahora());
  e.minutos(3);
  assert.deepEqual(await tomarPendiente(e.ctx("pepe")), { flujoId: null, porRevisar: false, mensaje: null }, "it isn't his e-mail");
  const modelo = await e.archivo("modelo");
  assert.deepEqual(await tomarPendiente(e.ctx("luz")), { flujoId: modelo.flujoId, porRevisar: false, mensaje: null });
  assert.deepEqual(await tomarPendiente(e.ctx("luz")), { flujoId: null, porRevisar: false, mensaje: null }, "only once per click");
  const linea = (await e.entradas()).find((x) => x.accion === "entro-desde-correo");
  assert.equal(linea?.detalle, "Entró al flujo con el botón del correo «te toca» enviado el 11-11-2026 13:38.");
  assert.equal(linea?.usuario, "Luz");
  assert.equal(ACCIONES["entro-desde-correo"], "Entró desde el correo");

  // A click more than 20 minutes before doesn't open anything.
  const otra = await escenario();
  await abrirEnlace(otra.store, tokenDe(otra.enviados[0]), otra.ahora());
  otra.minutos(MINUTOS_CLIC + 1);
  assert.equal((await tomarPendiente(otra.ctx("luz"))).flujoId, null);
});

test("el botón del correo de prueba lleva a la extensión y dice que funciona", async () => {
  const e = await escenario();
  await correoPrueba(e.ctx("ana", true));
  const m = e.enviados[e.enviados.length - 1];
  assert.match(m.texto, /\nAbrir Flujo de aprobación: https:\/\/app\.test\/api\/flujo-aprobacion\/ir\//);
  assert.equal(await abrirEnlace(e.store, tokenDe(m), e.ahora()), EXT);
  assert.deepEqual(await tomarPendiente(e.ctx("ana", true)), { flujoId: null, porRevisar: false, mensaje: "Entraste con el botón del correo de prueba: el botón funciona." });
});

// ------------------------------------------------------------ daily reminder

test("el recordatorio diario le escribe a quien espera en un flujo vencido, una vez al día, y queda en el historial", async () => {
  const e = await escenario();
  const r = await e.recordar(new Date("2026-11-12T12:00:00Z"));
  assert.deepEqual(r, { proyectos: 1, enviados: 1, fallidos: 0, mensaje: "Recordatorios del 12-11-2026: 1 enviados en 1 proyecto." });
  const m = e.enviados[e.enviados.length - 1];
  assert.equal(m.para.correo, "luz@obra.co");
  assert.equal(m.asunto, "Recordatorio: 1 archivo vencido espera tu paso — SELVIA");
  assert.match(m.texto, /Estos archivos esperan tu paso y su flujo ya venció:\n\nFLUJO-01 — Planos torre 1\nVenció el 10-11-2026 \(hace 2 días\) · paso «Revisa»\n• modelo\.rvt — versión 1: https:\/\/web\.connect\.trimble\.com\/projects\/P\/viewer\/3d/);
  assert.match(m.texto, /\nAbrir el flujo FLUJO-01: https:\/\/app\.test\/api\/flujo-aprobacion\/ir\//);
  const linea = (await e.entradas()).find((x) => x.accion === "recordatorio-enviado");
  assert.equal(linea?.detalle, "Recordatorio a Luz Pérez <luz@obra.co>: «modelo.rvt» espera «Revisa»; el flujo venció el 10-11-2026.");
  assert.equal(linea?.usuario, QUIEN_RECUERDA);
  assert.equal(ACCIONES["recordatorio-enviado"], "Recordatorio de vencido");

  // The reminder's button opens the flow too.
  await abrirEnlace(e.store, tokenDe(m), new Date("2026-11-12T12:05:00Z"));
  e.minutos(60 * 17 + 30);
  assert.equal((await tomarPendiente(e.ctx("luz"))).flujoId, (await e.archivo("modelo")).flujoId);

  assert.equal((await e.recordar(new Date("2026-11-12T20:00:00Z"))).enviados, 0, "already reminded today");
  assert.equal((await e.recordar(new Date("2026-11-13T12:00:00Z"))).enviados, 1, "again the next day");
});

test("sin vencer, ya decidido, apagado o sin cuenta no hay recordatorio; con varios flujos va uno solo con todos", async () => {
  const e = await escenario();
  assert.equal((await e.recordar(new Date("2026-11-10T15:00:00Z"))).enviados, 0, "due today: not overdue yet");

  // Luz decides: the file now waits for Pepe, who was written to as well.
  const a = await e.archivo("modelo");
  await decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId, texto: "" }, "aprobar");
  await e.recordar(new Date("2026-11-12T12:00:00Z"));
  assert.deepEqual(e.enviados.slice(-1).map((m) => m.para.correo), ["pepe@obra.co"], "only who waits now");

  assert.equal((await (await escenario({ config: { recordatorios: false } })).recordar(new Date("2026-11-12T12:00:00Z"))).enviados, 0);
  assert.equal((await (await escenario({ config: { activo: false } })).recordar(new Date("2026-11-12T12:00:00Z"))).enviados, 0);
  assert.equal((await (await escenario({ origen: null })).recordar(new Date("2026-11-12T12:00:00Z"))).enviados, 0, "notified without links (before phase 3): nobody to write to");
  const sinCuenta = await escenario();
  assert.match((await enviarRecordatorios({ store: sinCuenta.store, origen: ORIGEN, ahora: new Date("2026-11-12T12:00:00Z") })).mensaje, /No hay cuenta de Gmail/);

  const dos = await escenario({ dos: true });
  await dos.recordar(new Date("2026-11-12T12:00:00Z"));
  const m = dos.enviados[dos.enviados.length - 1];
  assert.equal(m.asunto, "Recordatorio: 2 archivos vencidos esperan tu paso — SELVIA");
  assert.match(m.texto, /FLUJO-01 — Planos torre 1[\s\S]*FLUJO-02 — Planos torre 2/);
  assert.match(m.texto, /\nAbrir Flujo de aprobación: https:\/\/app\.test\//, "several flows: the button opens the extension");
  await abrirEnlace(dos.store, tokenDe(m), new Date("2026-11-12T12:01:00Z"));
  dos.minutos(60 * 17 + 25);
  assert.deepEqual(await tomarPendiente(dos.ctx("luz")), { flujoId: null, porRevisar: true, mensaje: null }, "it shows the files waiting for her");
});

test("con la clave de Gmail mala el recordatorio se anota como no enviado", async () => {
  let fallar = false;
  const e = await escenario({ falla: () => (fallar ? Object.assign(new Error("535"), { code: "EAUTH" }) : null) });
  fallar = true;
  const r = await e.recordar(new Date("2026-11-12T12:00:00Z"));
  assert.equal(r.fallidos, 1);
  assert.match((await e.entradas()).find((x) => x.accion === "recordatorio-fallido")?.detalle ?? "", /^No se pudo enviar el recordatorio a Luz Pérez <luz@obra\.co>: Gmail no aceptó el usuario o la clave/);
});

test("el texto del recordatorio escapa lo que escribieron las personas", () => {
  const m = armarRecordatorio(
    { nombre: "Luz" },
    [{ flujo: { id: "f", codigo: 3, hito: "<b>Torre</b>", vence: "2026-11-01" }, paso: "Revisa", archivos: [{ id: "a", nombre: "x<y>.pdf", revision: 2, fileId: "x", tipo: "pdf", versionId: "v" }] }],
    { proyecto: "Obra & Cía", enlace: "https://app.test/x", alFlujo: true, hoy: "2026-11-02", enlaceArchivo: () => "https://t/x?a=1&b=2" }
  );
  assert.doesNotMatch(m.html, /<b>Torre|x<y>/);
  assert.match(m.html, /Venció el 01-11-2026 \(hace 1 día\)/);
  assert.match(m.html, /href="https:\/\/t\/x\?a=1&amp;b=2"/);
  assert.match(m.html, />Abrir el flujo FLUJO-03<\/a>/);
});
