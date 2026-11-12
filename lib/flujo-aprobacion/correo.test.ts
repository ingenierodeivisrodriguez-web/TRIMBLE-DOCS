import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../propiedades/service";
import type { ProjectUser, RawFolderItem } from "../trimbleApi";
import {
  armarCorreo,
  asuntoCorreo,
  Correo,
  correoPrueba,
  DatosCorreo,
  destinatarios,
  enlaceExtension,
  enviarCorreos,
  guardarCorreos,
  ID_EXTENSION,
  leerCorreos,
  MAX_DESTINATARIOS,
  MensajeCorreo,
  mensajeErrorCorreo,
} from "./correo";
import { CONFIG_INICIAL, TEXTOS_INICIALES } from "./configCorreo";
import { decidir, resumenAvisos } from "./decisiones";
import { FlujoError } from "./errores";
import { listarArchivos } from "./revision";
import { Ctx, guardarFlujo, historial, TrimbleFlujo } from "./service";
import { correoDesdeEntorno } from "./smtp";
import { memoryStore } from "./store";
import { ACCIONES } from "./trazabilidad";

const persona = (id: string, firstName: string, extra: Partial<ProjectUser> = {}): ProjectUser => ({ id, firstName, lastName: "Pérez", email: `${id}@obra.co`, role: "USER", status: "ACTIVE", ...extra });

const revision: DatosCorreo = {
  tipo: "revision",
  codigo: "FLUJO-07",
  hito: "Planos torre 1",
  notas: "Revisar ejes y niveles",
  vence: "2026-11-20",
  paso: "Revisa",
  archivos: [
    { nombre: "A-101.pdf", revision: 2, enlace: "https://web.connect.trimble.com/projects/P/viewer/2D?id=f1&version=v2", nueva: true },
    { nombre: "A-102.pdf", revision: 1, enlace: "https://web.connect.trimble.com/projects/P/viewer/2D?id=f2&version=v1", nueva: false },
  ],
  mas: 0,
};
const comun = { proyecto: "SELVIA", enlace: enlaceExtension("BUJGfcZ3AEI") };

/** A fake sending account: keeps what it sent; `falla` decides who can't receive. */
function correoFalso(falla: (m: MensajeCorreo) => unknown = () => null) {
  const enviados: MensajeCorreo[] = [];
  const correo: Correo = {
    desde: "avisos@gmail.com",
    async enviar(m) {
      const err = falla(m);
      if (err) throw err;
      enviados.push(m);
    },
  };
  return { correo, enviados };
}

test("el enlace abre la extensión en el proyecto, con el id de la dirección que copió el dueño o el de Vercel", () => {
  assert.equal(enlaceExtension("BUJGfcZ3AEI"), "https://web.connect.trimble.com/projects/BUJGfcZ3AEI/extension/8e7cd6d3-3e0e-16d7-12f4-02d6a673090e/flujo_aprobacion_open");
  assert.equal(ID_EXTENSION, "8e7cd6d3-3e0e-16d7-12f4-02d6a673090e");
  assert.equal(enlaceExtension("Otro1", "abc"), "https://web.connect.trimble.com/projects/Otro1/extension/abc/flujo_aprobacion_open");
});

test("el correo «te toca» lleva el código, el paso, la descripción, el vencimiento DD-MM-AAAA, los archivos y el botón", () => {
  const c = armarCorreo(revision, { nombre: "Luz" }, comun);
  assert.equal(c.asunto, "FLUJO-07 · Te toca «Revisa»: Planos torre 1");
  assert.match(c.texto, /^Hola Luz,\n\nTe toca el paso «Revisa» del flujo:\nFLUJO-07 — Planos torre 1\nProyecto: SELVIA\n\nRevisar ejes y niveles\nVence: 20-11-2026\n/);
  assert.match(c.texto, /• A-101\.pdf — versión 2 \(versión nueva\): https:\/\/web\.connect\.trimble\.com\/projects\/P\/viewer\/2D\?id=f1&version=v2/);
  assert.match(c.texto, /En la extensión: flujo FLUJO-07 «Planos torre 1» → Archivos → Me toca → Decidir\./);
  assert.match(c.texto, /Abrir Flujo de aprobación: https:\/\/web\.connect\.trimble\.com\/projects\/BUJGfcZ3AEI\/extension\//);
  assert.match(c.html, /Te toca el paso «Revisa» del flujo:/);
  assert.match(c.html, /Vence: <b>20-11-2026<\/b>/);
  assert.match(c.html, /<a href="https:\/\/web\.connect\.trimble\.com\/projects\/P\/viewer\/2D\?id=f1&amp;version=v2"[^>]*>A-101\.pdf<\/a> — versión 2 \(versión nueva\)/);
  assert.match(c.html, />Abrir Flujo de aprobación<\/a>/);
  assert.doesNotMatch(c.html, /Abrir el archivo/, "only the rejection has the file's button");
});

test("lo que escriben las personas no se vuelve código en el correo, y el asunto queda en una línea", () => {
  const malo: DatosCorreo = { ...revision, hito: "Planos <script>alert(1)</script>\nOtra línea", notas: "<img src=x onerror=alert(1)>" };
  const c = armarCorreo(malo, { nombre: "<b>Luz</b>" }, { ...comun, proyecto: "Obra & Cía" });
  assert.doesNotMatch(c.html, /<script|<img|<b>Luz/);
  assert.match(c.html, /&lt;script&gt;/);
  assert.match(c.html, /Obra &amp; Cía/);
  assert.equal(c.asunto, "FLUJO-07 · Te toca «Revisa»: Planos <script>alert(1)</script> Otra línea");
  assert.equal(asuntoCorreo({ ...revision, hito: "x".repeat(300) }).length, 160);
});

test("el correo del rechazo dice quién, el motivo, dónde subir la corrección y trae el botón del archivo", () => {
  const d: DatosCorreo = {
    ...revision,
    tipo: "correccion",
    notas: "",
    vence: null,
    archivos: [revision.archivos[0]],
    rechazo: { quien: "Pepe Gómez", motivo: "Faltan los ejes", carpeta: "Obra / Arquitectura" },
  };
  const c = armarCorreo(d, { nombre: "Juan" }, comun);
  assert.equal(c.asunto, "FLUJO-07 · Rechazado: corrige «A-101.pdf» — Planos torre 1");
  assert.match(c.texto, /Pepe Gómez rechazó la versión 2 de «A-101\.pdf» en el paso «Revisa» del flujo:/);
  assert.match(c.texto, /Motivo: Faltan los ejes/);
  assert.match(c.texto, /Corrige el archivo y sube la versión nueva con el mismo nombre en la misma carpeta \(Obra \/ Arquitectura\)\./);
  assert.doesNotMatch(c.texto, /Vence:/);
  assert.match(c.html, />Abrir el archivo<\/a>/);
});

test("los destinatarios: cada persona y los miembros de cada grupo una sola vez, sin los retirados del proyecto", async () => {
  const equipo = [persona("luz", "Luz"), persona("pepe", "Pepe", { email: "no-es-correo" }), persona("ana", "Ana")];
  const miembros: Record<string, ProjectUser[]> = {
    g1: [persona("luz", "Luz"), persona("eva", "Eva"), persona("ido", "Ido", { status: "REMOVED" })],
  };
  const gente = await destinatarios(
    [
      { tipo: "persona", id: "luz", nombre: "Luz" },
      { tipo: "persona", id: "pepe", nombre: "Pepe" },
      { tipo: "persona", id: "fantasma", nombre: "Alguien que salió" },
      { tipo: "grupo", id: "g1", nombre: "Arquitectura" },
    ],
    async () => equipo,
    async (g) => miembros[g] ?? []
  );
  assert.deepEqual(gente, [
    { id: "luz", nombre: "Luz Pérez", correo: "luz@obra.co" },
    { id: "pepe", nombre: "Pepe Pérez", correo: null },
    { id: "fantasma", nombre: "Alguien que salió", correo: null },
    { id: "eva", nombre: "Eva Pérez", correo: "eva@obra.co" },
  ]);
});

test("se envía un correo a cada persona con su nombre, y el historial dice a quién y qué faltó", async () => {
  const { correo, enviados } = correoFalso();
  const r = await enviarCorreos(
    correo,
    revision,
    [
      { id: "luz", nombre: "Luz Pérez", correo: "luz@obra.co" },
      { id: "eva", nombre: "Eva Pérez", correo: "eva@obra.co" },
      { id: "pepe", nombre: "Pepe Pérez", correo: null },
    ],
    comun
  );
  assert.deepEqual(
    enviados.map((m) => [m.para.correo, m.texto.split("\n")[0]]),
    [
      ["luz@obra.co", "Hola Luz Pérez,"],
      ["eva@obra.co", "Hola Eva Pérez,"],
    ]
  );
  assert.equal(r.ok, true);
  assert.equal(r.enviados, 2);
  assert.equal(r.mensaje, "Correo a Luz Pérez <luz@obra.co>, Eva Pérez <eva@obra.co>: «FLUJO-07 · Te toca «Revisa»: Planos torre 1»; sin correo en Trimble: Pepe Pérez.");

  const nadie = await enviarCorreos(correo, revision, [{ id: "pepe", nombre: "Pepe Pérez", correo: null }], comun);
  assert.equal(nadie.ok, false);
  assert.equal(nadie.mensaje, "No se envió el correo «FLUJO-07 · Te toca «Revisa»: Planos torre 1»: sin correo en Trimble: Pepe Pérez.");
});

test("si Gmail rechaza a uno se dice; con la clave mala no se sigue intentando con los demás", async () => {
  const rechazo = Object.assign(new Error("550 No such user"), { code: "EENVELOPE", responseCode: 550 });
  const uno = correoFalso((m) => (m.para.correo === "eva@obra.co" ? rechazo : null));
  const gente = [
    { id: "luz", nombre: "Luz", correo: "luz@obra.co" },
    { id: "eva", nombre: "Eva", correo: "eva@obra.co" },
    { id: "ana", nombre: "Ana", correo: "ana@obra.co" },
  ];
  const r = await enviarCorreos(uno.correo, revision, gente, comun);
  assert.equal(r.ok, false);
  assert.equal(r.enviados, 2);
  assert.equal(r.mensaje, "Correo a Luz <luz@obra.co>, Ana <ana@obra.co>: «FLUJO-07 · Te toca «Revisa»: Planos torre 1»; no se pudo enviar a Eva <eva@obra.co>: Gmail rechazó la dirección del destinatario.");

  const clave = Object.assign(new Error("Invalid login: 535-5.7.8"), { code: "EAUTH", responseCode: 535 });
  let intentos = 0;
  const mala = correoFalso(() => (intentos++, clave));
  const m = await enviarCorreos(mala.correo, revision, gente, comun);
  assert.equal(intentos, 1);
  assert.equal(m.enviados, 0);
  assert.match(m.mensaje, /^No se pudo enviar el correo «FLUJO-07 · Te toca «Revisa»: Planos torre 1» a Luz <luz@obra\.co>, Eva <eva@obra\.co>, Ana <ana@obra\.co>: Gmail no aceptó el usuario o la clave/);
});

test("un grupo enorme no inunda la cuenta: hasta 25 personas por aviso", async () => {
  const { correo, enviados } = correoFalso();
  const gente = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, nombre: `P${i}`, correo: `p${i}@obra.co` }));
  const r = await enviarCorreos(correo, revision, gente, comun);
  assert.equal(enviados.length, MAX_DESTINATARIOS);
  assert.match(r.mensaje, /no se escribió a 5 más \(límite de 25 por aviso\)\.$/);
});

test("los errores de Gmail se dicen en palabras", () => {
  assert.match(mensajeErrorCorreo({ code: "EAUTH" }), /contraseña de aplicación de 16 letras/);
  assert.match(mensajeErrorCorreo({ code: "ETIMEDOUT" }), /no se pudo conectar con Gmail/);
  assert.match(mensajeErrorCorreo({ responseCode: 421 }), /límite diario/);
  assert.equal(mensajeErrorCorreo(new Error("algo\nraro")), "algo raro");
});

test("sin las variables de Vercel no hay correo; la clave se toma sin espacios", () => {
  assert.equal(correoDesdeEntorno({}), undefined);
  assert.equal(correoDesdeEntorno({ FLUJO_CORREO_USUARIO: "avisos@gmail.com" }), undefined);
  const c = correoDesdeEntorno({ FLUJO_CORREO_USUARIO: " avisos@gmail.com ", FLUJO_CORREO_CLAVE: "abcd efgh ijkl mnop", FLUJO_EXTENSION_ID: "otro-id" });
  assert.equal(c?.desde, "avisos@gmail.com");
  assert.equal(c?.idExtension, "otro-id");
});

// ------------------------------------------------------------ with the flow

const EQUIPO = [persona("ana", "Ana", { role: "ADMIN" }), persona("juan", "Juan"), persona("luz", "Luz"), persona("pepe", "Pepe", { email: "" }), persona("deivis", "Deivis")];

/** modelo.rvt uploaded by Juan; a flow «Planos torre 1»: Revisa = Luz, Aprueba = Pepe (no e-mail in Trimble). */
async function escenario(conCorreo = true, tareas = true, config?: Record<string, unknown>) {
  const store = memoryStore();
  let tareasCreadas = 0;
  const archivo: RawFolderItem = { id: "modelo", name: "modelo.rvt", type: "FILE", createdOn: "", modifiedOn: "2026-11-01T15:00:00.000Z", modifiedBy: { id: "juan", firstName: "Juan" }, versionId: "modelo-v1", revision: 1 };
  const tc: TrimbleFlujo = {
    carpeta: async () => {
      throw new FlujoError("No se usa.", 500);
    },
    archivo: async (id) => ({ id, ruta: `Obra / Arquitectura / ${id}`, ancestros: ["raiz", "arq"] }),
    personas: async () => EQUIPO,
    grupos: async () => [],
    miembros: async () => [],
    permisos: async () => ({ direct: { acl: {}, inheritance: true }, inherited: {} }),
    items: async (id) => (id === "arq" ? [archivo] : []),
    version: async () => "modelo-v1",
    lado: { projectId: "P", servidor: "https://falso", cliente: { pedir: async () => ({ estado: 404, cuerpo: null }) } },
    crearTarea: async () => (tareasCreadas++, tareas ? { estado: 201, cuerpo: { id: `todo${tareasCreadas}` } } : { estado: 403, cuerpo: { message: "Forbidden" } }),
    actualizarTarea: async (_id, cuerpo) => ({ estado: 200, cuerpo: { status: cuerpo.status } }),
    nombreProyecto: async () => "SELVIA",
  };
  const { correo, enviados } = correoFalso();
  const ctx = (id: string, isAdmin = false): Ctx => ({
    projectId: "P",
    caller: { id, name: EQUIPO.find((p) => p.id === id)!.firstName, isAdmin, memberOfGroups: async () => new Set() } satisfies Caller,
    store,
    tc,
    ahora: () => new Date("2026-11-11T18:38:00Z"),
    ...(conCorreo ? { correo } : {}),
  });
  if (config) await guardarCorreos(ctx("ana", true), { config: { ...CONFIG_INICIAL, ...config }, version: 0 });
  await guardarFlujo(ctx("deivis"), {
    hito: "Planos torre 1",
    notas: "Revisar ejes",
    vence: "2026-11-20",
    archivos: ["modelo"],
    pasos: [
      { nombre: "Revisa", responsable: { tipo: "persona", id: "luz" } },
      { nombre: "Aprueba", responsable: { tipo: "persona", id: "pepe" } },
    ],
  });
  const modelo = async () => (await listarArchivos(ctx("deivis"))).archivos.find((a) => a.fileId === "modelo")!;
  const lineas = async () => (await historial(ctx("deivis"), null, null)).entradas.filter((e) => e.accion.startsWith("correo-"));
  const todas = async () => (await historial(ctx("deivis"), null, null)).entradas;
  return { ctx, enviados, modelo, lineas, todas, tareas: () => tareasCreadas };
}

test("al entrar el archivo al flujo, la responsable recibe el correo además de la tarea, y queda en el historial", async () => {
  const e = await escenario();
  assert.equal(e.enviados.length, 1);
  const [m] = e.enviados;
  assert.equal(m.para.correo, "luz@obra.co");
  assert.equal(m.asunto, "FLUJO-01 · Te toca «Revisa»: Planos torre 1");
  assert.match(m.texto, /Proyecto: SELVIA/);
  assert.match(m.texto, /Vence: 20-11-2026/);
  assert.match(m.texto, /• modelo\.rvt — versión 1: https:\/\/web\.connect\.trimble\.com\/projects\/P\/viewer\/3d/);
  assert.match(m.texto, /Abrir Flujo de aprobación: https:\/\/web\.connect\.trimble\.com\/projects\/P\/extension\/8e7cd6d3-3e0e-16d7-12f4-02d6a673090e\/flujo_aprobacion_open/);
  const [linea] = await e.lineas();
  assert.equal(linea.accion, "correo-enviado");
  assert.equal(linea.detalle, "Correo a Luz Pérez <luz@obra.co>: «FLUJO-01 · Te toca «Revisa»: Planos torre 1».");
  assert.equal(ACCIONES["correo-enviado"], "Envió el correo de aviso");
});

test("al aprobar, el siguiente responsable sin correo en Trimble queda anotado como no enviado; al rechazar, quien subió recibe el suyo", async () => {
  const e = await escenario();
  const a = await e.modelo();
  const r = await decidir(e.ctx("luz"), { archivoId: a.id, versionId: a.versionId, texto: "" }, "aprobar");
  assert.match(r.aviso ?? "", /No se envió el correo «FLUJO-01 · Te toca «Aprueba»: Planos torre 1»: sin correo en Trimble: Pepe Pérez\.$/);
  assert.equal((await e.lineas()).filter((l) => l.accion === "correo-fallido").length, 1);

  const b = await e.modelo();
  await decidir(e.ctx("pepe"), { archivoId: b.id, versionId: b.versionId, texto: "Faltan los ejes" }, "rechazar");
  const ultimo = e.enviados[e.enviados.length - 1];
  assert.equal(ultimo.para.correo, "juan@obra.co");
  assert.equal(ultimo.asunto, "FLUJO-01 · Rechazado: corrige «modelo.rvt» — Planos torre 1");
  assert.match(ultimo.texto, /Pepe rechazó la versión 1 de «modelo\.rvt» en el paso «Aprueba» del flujo:/);
  assert.match(ultimo.texto, /Motivo: Faltan los ejes/);
});

test("el correo sale aunque Trimble no cree la tarea; sin la cuenta en Vercel no sale nada ni se anota", async () => {
  const sinTarea = await escenario(true, false);
  assert.equal(sinTarea.enviados.length, 1);
  assert.equal((await sinTarea.lineas())[0].accion, "correo-enviado");

  const sinCuenta = await escenario(false);
  assert.equal(sinCuenta.enviados.length, 0);
  assert.deepEqual(await sinCuenta.lineas(), []);
});

test("el correo de prueba: solo administradores, a su propio correo, y dice qué falta si no está configurado", async () => {
  const e = await escenario();
  await assert.rejects(() => correoPrueba(e.ctx("luz")), /Solo un administrador/);
  const r = await correoPrueba(e.ctx("ana", true));
  assert.equal(r.mensaje, "Te envié un correo de prueba a ana@obra.co, desde avisos@gmail.com. Revísalo (mira también la carpeta de spam la primera vez) y prueba su botón «Abrir Flujo de aprobación».");
  const m = e.enviados[e.enviados.length - 1];
  assert.equal(m.asunto, "Prueba · FLUJO-00 · Te toca «Revisa»: Ejemplo: aprobar planos de arquitectura");
  assert.match(m.html, /Correo de prueba de Flujo de aprobación: así llegará el aviso/);
  assert.match(m.texto, /Vence: 18-11-2026/, "the sample is due a week later");
  assert.match(m.html, /\/projects\/P\/extension\/8e7cd6d3-3e0e-16d7-12f4-02d6a673090e\/flujo_aprobacion_open/);

  const sin = await escenario(false);
  await assert.rejects(() => correoPrueba(sin.ctx("ana", true)), /faltan las variables FLUJO_CORREO_USUARIO y FLUJO_CORREO_CLAVE/);
});

// ------------------------------------------------------- «Correos de aviso»

test("sin la tarea de Trimble: solo sale el correo, con los textos del proyecto, la copia y la dirección de la extensión de este proyecto", async () => {
  const e = await escenario(true, true, {
    tareasTrimble: false,
    copia: "jefe@obra.co",
    textos: { ...TEXTOS_INICIALES, revision: { asunto: "[{codigo}] Revisar {archivo} — vence {vence}", intro: "{persona}, el flujo te espera en «{paso}»." } },
    enlace: "https://web.connect.trimble.com/projects/P/extension/otro-id-1234/flujo_aprobacion_open",
  });
  assert.equal(e.tareas(), 0, "no ToDo was created");
  assert.equal(e.enviados.length, 1);
  const [m] = e.enviados;
  assert.equal(m.asunto, "[FLUJO-01] Revisar modelo.rvt — vence 20-11-2026");
  assert.match(m.texto, /\n\nLuz Pérez, el flujo te espera en «Revisa»\.\n/);
  assert.deepEqual(m.copia, ["jefe@obra.co"]);
  assert.match(m.texto, /Abrir Flujo de aprobación: https:\/\/web\.connect\.trimble\.com\/projects\/P\/extension\/otro-id-1234\/flujo_aprobacion_open/);
  const entradas = await e.todas();
  assert.equal(entradas.filter((x) => x.accion === "aviso-enviado").length, 0, "no ToDo line");
  assert.equal(entradas.find((x) => x.accion === "correo-enviado")?.detalle, "Correo a Luz Pérez <luz@obra.co>: «[FLUJO-01] Revisar modelo.rvt — vence 20-11-2026»; copia a jefe@obra.co.");
});

test("un aviso apagado no manda correo; sin tarea ni correo queda anotado que no se avisó a nadie", async () => {
  const e = await escenario(true, true, { eventos: { revision: false, correccion: true } });
  assert.equal(e.enviados.length, 0);
  assert.equal(e.tareas(), 1, "the ToDo still goes");

  const nada = await escenario(true, true, { tareasTrimble: false, eventos: { revision: false, correccion: true } });
  assert.equal(nada.tareas(), 0);
  assert.equal(nada.enviados.length, 0);
  const fallo = (await nada.todas()).find((x) => x.accion === "aviso-fallido");
  assert.equal(fallo?.detalle, "No se avisó a Luz Pérez («Revisar: modelo.rvt (Revisa) — Planos torre 1»): en «Correos de aviso» están apagados la tarea de Trimble y el correo de este aviso.");
  // The rejection's e-mail is still on.
  const a = await nada.modelo();
  const r = await decidir(nada.ctx("luz"), { archivoId: a.id, versionId: a.versionId, texto: "Faltan los ejes" }, "rechazar");
  assert.match(r.aviso ?? "", /^Correo a Juan Pérez <juan@obra\.co>: «FLUJO-01 · Rechazado: corrige «modelo\.rvt» — Planos torre 1»\.$/);
});

test("los correos apagados no salen aunque haya cuenta; la tarea de Trimble sí", async () => {
  const e = await escenario(true, true, { activo: false });
  assert.equal(e.enviados.length, 0);
  assert.equal(e.tareas(), 1);
  assert.deepEqual(await e.lineas(), []);
});

test("«Correos de aviso»: solo administradores, se guarda con versión, el historial dice qué cambió y no se apagan las tareas sin cuenta de Gmail", async () => {
  const e = await escenario();
  await assert.rejects(() => leerCorreos(e.ctx("luz")), /Solo un administrador del proyecto en Trimble ve los correos de aviso/);
  const antes = await leerCorreos(e.ctx("ana", true));
  assert.equal(antes.version, 0);
  assert.equal(antes.configurado, true);
  assert.equal(antes.desde, "avisos@gmail.com");
  assert.equal(antes.enlace, "https://web.connect.trimble.com/projects/P/extension/8e7cd6d3-3e0e-16d7-12f4-02d6a673090e/flujo_aprobacion_open");
  assert.deepEqual(antes.config, CONFIG_INICIAL);

  const r = await guardarCorreos(e.ctx("ana", true), { config: { ...CONFIG_INICIAL, tareasTrimble: false }, version: 0 });
  assert.equal(r.version, 1);
  assert.equal(r.actualizadoPor, "Ana");
  assert.equal(r.config.tareasTrimble, false);
  assert.match(r.mensaje, /Se guardaron los correos de aviso/);
  const linea = (await e.todas()).find((x) => x.accion === "correos-config");
  assert.equal(linea?.detalle, "Cambió los correos de aviso: Crear también la tarea de Trimble: no.");
  assert.equal(linea?.flujoId, null);
  assert.equal(ACCIONES["correos-config"], "Cambió los correos de aviso");

  // Two administrators at once: the second, with the old version, is refused and keeps what they wrote.
  await assert.rejects(() => guardarCorreos(e.ctx("ana", true), { config: { ...CONFIG_INICIAL, activo: false }, version: 0 }), /Otro administrador cambió los correos de aviso/);
  assert.match((await guardarCorreos(e.ctx("ana", true), { config: { ...CONFIG_INICIAL, tareasTrimble: false }, version: 1 })).mensaje, /No había cambios/);
  await assert.rejects(() => guardarCorreos(e.ctx("luz"), { config: CONFIG_INICIAL, version: 1 }), /Solo un administrador/);

  const sin = await escenario(false);
  await assert.rejects(() => guardarCorreos(sin.ctx("ana", true), { config: { ...CONFIG_INICIAL, tareasTrimble: false }, version: 0 }), /mientras no haya cuenta de Gmail en Vercel/);
});

test("el correo de prueba usa los textos guardados del proyecto", async () => {
  const e = await escenario(true, true, { textos: { ...TEXTOS_INICIALES, revision: { asunto: "Revisar {flujo}", intro: "Hola {persona}: te toca «{paso}»." } } });
  await correoPrueba(e.ctx("ana", true));
  const m = e.enviados[e.enviados.length - 1];
  assert.equal(m.asunto, "Prueba · Revisar Ejemplo: aprobar planos de arquitectura");
  assert.match(m.texto, /Hola Ana Pérez: te toca «Revisa»\./);
});

test("el resumen de los avisos cuenta tareas y correos", () => {
  assert.equal(resumenAvisos({ enviados: 1, fallidos: 0, correos: 2 }, "a los revisores"), " Se avisó a los revisores con 1 tarea de Trimble y 2 correos.");
  assert.equal(resumenAvisos({ enviados: 0, fallidos: 1, correos: 1 }), " Se avisó con 1 correo. 1 aviso no se pudo enviar (ver Historial).");
  assert.equal(resumenAvisos({ enviados: 0, fallidos: 0 }), "");
});
