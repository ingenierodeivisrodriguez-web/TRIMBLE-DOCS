import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClienteTrimble, Respuesta } from "../compras/cde";
import { nubeFalsa } from "../publicar/pruebas/trimbleFalso";
import type { ProjectGroup, ProjectUser } from "../trimbleApi";
import { DepsPrueba, formatosTarea, pasoPrueba, versionesDe } from "./prueba";

const persona = (id: string, firstName: string, lastName: string, extra: Partial<ProjectUser> = {}): ProjectUser => ({ id, firstName, lastName, email: `${id}@obra.co`, role: "USER", status: "ACTIVE", ...extra });

const PERSONAS = [
  persona("u1", "Ana", "Ruiz", { role: "ADMIN" }),
  persona("u2", "Juan", "Pérez"),
  persona("u3", "Pepe", "Gómez"),
  persona("u4", "Luz", "Mora", { status: "REMOVED" }),
];
const GRUPOS: ProjectGroup[] = [
  { id: "g1", name: "Arquitectura", usersCount: 2 },
  { id: "g2", name: "Estructura", usersCount: 1 },
];
const MIEMBROS: Record<string, ProjectUser[]> = { g1: [PERSONAS[0], PERSONAS[1]], g2: [PERSONAS[2]] };

type Extra = (metodo: string, ruta: string, cuerpo: unknown) => Respuesta | null;

/**
 * Project "OBRA1" of the fake Trimble with a model in "Revisión" (3 versions)
 * and an empty "Aprobados" folder; `extra` answers the calls the fake cloud
 * doesn't know (versions, ToDos) before it.
 */
function escenario(o: { extra?: Extra; grupos?: () => Promise<ProjectGroup[]>; miembros?: (g: string) => ProjectUser[]; deps?: Partial<DepsPrueba> } = {}) {
  const nube = nubeFalsa();
  const p = nube.proyecto("OBRA1");
  const revision = nube.sembrarCarpeta(p.raiz, "Revisión");
  const aprobados = nube.sembrarCarpeta(p.raiz, "Aprobados");
  const modelo = nube.sembrarArchivo(revision, "SEL-ARQ-TR1.rvt", "versión 1", "modelo 1");
  nube.sembrarArchivo(revision, "SEL-ARQ-TR1.rvt", "versión 2", "modelo 2");
  nube.sembrarArchivo(revision, "SEL-ARQ-TR1.rvt", "versión 3", "modelo 3");
  const llamadas: { metodo: string; ruta: string; cuerpo: unknown }[] = [];
  const cliente: ClienteTrimble = {
    async pedir(metodo, ruta, opciones = {}) {
      llamadas.push({ metodo, ruta, cuerpo: opciones.cuerpo });
      return o.extra?.(metodo, ruta, opciones.cuerpo) ?? p.cliente.pedir(metodo, ruta, opciones);
    },
  };
  const deps: DepsPrueba = {
    projectId: "OBRA1",
    lado: { projectId: "OBRA1", servidor: p.servidor, cliente },
    yo: "u1",
    personas: async (g) => (g ? (o.miembros?.(g) ?? MIEMBROS[g] ?? []) : PERSONAS),
    grupos: o.grupos ?? (async () => GRUPOS),
    fetch: nube.fetchFalso,
    ...o.deps,
  };
  const paso = (nombre: string, datos: Record<string, unknown> = {}) => pasoPrueba(deps, { paso: nombre, ...datos });
  const en = (carpeta: string) => [...nube.archivos.values()].filter((a) => a.parent === carpeta);
  return { nube, paso, modelo, revision, aprobados, en, llamadas };
}

test("el equipo trae las personas activas, los administradores y los miembros de cada grupo", async () => {
  const { paso } = escenario();
  const r = await paso("equipo");
  assert.equal(r.ok, true, r.mensaje);
  assert.match(r.mensaje, /3 personas \(1 administrador\) y 2 grupos; se leyeron los miembros de 2 de 2/);
  const personas = r.datos.personas as { nombre: string; admin: boolean }[];
  assert.deepEqual(
    personas.map((x) => x.nombre),
    ["Ana Ruiz", "Juan Pérez", "Pepe Gómez"]
  );
  assert.deepEqual(r.datos.grupos, [
    { id: "g1", nombre: "Arquitectura", miembros: ["Ana Ruiz", "Juan Pérez"], total: 2 },
    { id: "g2", nombre: "Estructura", miembros: ["Pepe Gómez"], total: 1 },
  ]);
  assert.equal(r.datos.yo, "u1");
});

test("avisa si cada grupo trae a todo el proyecto (Trimble no filtró por grupo)", async () => {
  const { paso } = escenario({ miembros: () => PERSONAS });
  const r = await paso("equipo");
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /puede que Trimble no esté filtrando por grupo/);
});

test("sin la lista de grupos lo dice, pero entrega las personas", async () => {
  const { paso } = escenario({
    grupos: async () => {
      throw new Error("Trimble respondió 403");
    },
  });
  const r = await paso("equipo");
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /3 personas .* pero no la lista de grupos \(Trimble respondió 403\)/);
  assert.equal((r.datos.personas as unknown[]).length, 3);
});

test("las versiones dicen quién subió cada una y el archivo trae su enlace directo al visor", async () => {
  const { paso, modelo } = escenario({
    extra: (metodo, ruta) => {
      if (ruta.startsWith("/files/fs/") && ruta.endsWith("/versions")) return { estado: 404, cuerpo: { message: "not found" } };
      if (ruta.endsWith("/versions"))
        return {
          estado: 200,
          cuerpo: [
            { versionId: "v3", revision: 3, modifiedBy: { firstName: "Juan", lastName: "Pérez" }, createdBy: { firstName: "Ana", lastName: "Ruiz" }, modifiedOn: "2026-11-03T15:00:00Z" },
            { versionId: "v1", revision: 1, createdBy: { firstName: "Ana", lastName: "Ruiz" }, createdOn: "2026-11-01T15:00:00Z" },
          ],
        };
      return null;
    },
  });
  const r = await paso("archivo", { fileId: modelo });
  assert.equal(r.ok, true, r.mensaje);
  assert.match(r.mensaje, /“SEL-ARQ-TR1.rvt”: 2 versiones \(la última es la 3\)\. Trimble dice quién subió cada versión\./);
  assert.equal(r.datos.ruta, "GET /files/{id}/versions");
  const versiones = r.datos.versiones as { revision: number; subio: string; creo: string }[];
  assert.deepEqual(
    versiones.map((v) => [v.revision, v.subio, v.creo]),
    [
      [1, "Ana Ruiz", ""],
      [3, "Juan Pérez", "Ana Ruiz"],
    ]
  );
  const enlaces = r.datos.enlaces as { visor: string; carpeta: string };
  assert.match(enlaces.visor, /^https:\/\/web\.connect\.trimble\.com\/projects\/OBRA1\/viewer\/3d\?modelId=/);
  assert.match(enlaces.carpeta, /\/projects\/OBRA1\/data\/folder\/carpeta\d+$/);
});

test("una lista de versiones dentro de items también se lee", () => {
  assert.deepEqual(versionesDe({ items: [{ id: "v9", revision: 9, modifiedBy: { email: "pepe@obra.co" } }] }), [
    { versionId: "v9", revision: 9, subio: "pepe@obra.co", creo: "", fecha: null, tamano: null },
  ]);
  assert.equal(versionesDe({ message: "error" }), null);
});

test("aprobar la versión 3 deja la versión 1 en la carpeta destino, y la siguiente copia llega como versión 2 solo con confirmación", async () => {
  const { paso, modelo, aprobados, en, nube, revision } = escenario();
  const primera = await paso("copiar", { fileId: modelo, carpetaId: aprobados });
  assert.equal(primera.ok, true, primera.mensaje);
  assert.equal(primera.datos.metodo, "trimble");
  assert.equal(primera.datos.revision, 1);
  assert.equal(primera.datos.origen, 3);
  assert.match(primera.mensaje, /No estaba en la carpeta destino/);
  assert.equal(en(aprobados).length, 1);

  // A fourth version in review, then copied again: Trimble keeps the same file with a new version.
  nube.sembrarArchivo(revision, "SEL-ARQ-TR1.rvt", "versión 4", "modelo 4");
  const aviso = await paso("copiar", { fileId: modelo, carpetaId: aprobados });
  assert.equal(aviso.ok, true);
  assert.equal(aviso.datos.confirmar, true);
  assert.match(aviso.mensaje, /ya hay un “SEL-ARQ-TR1.rvt” \(versión 1/);
  assert.equal(en(aprobados)[0].versiones.length, 1, "nothing replaced without confirmation");

  const segunda = await paso("copiar", { fileId: modelo, carpetaId: aprobados, siVersion: aviso.datos.versionId });
  assert.equal(segunda.ok, true, segunda.mensaje);
  assert.equal(segunda.datos.revision, 2);
  assert.match(segunda.mensaje, /Antes había la versión 1/);
  assert.equal(en(aprobados).length, 1);
  assert.equal(new TextDecoder().decode(en(aprobados)[0].versiones[1].contenido), "versión 4");
});

test("si el archivo destino cambió después de verlo, no se copia", async () => {
  const { paso, modelo, aprobados, nube } = escenario();
  await paso("copiar", { fileId: modelo, carpetaId: aprobados });
  const aviso = await paso("copiar", { fileId: modelo, carpetaId: aprobados });
  nube.sembrarArchivo(aprobados, "SEL-ARQ-TR1.rvt", "subido a mano", "x");
  const r = await paso("copiar", { fileId: modelo, carpetaId: aprobados, siVersion: aviso.datos.versionId });
  assert.equal(r.ok, false);
  assert.equal(r.datos.cambio, true);
});

test("no copia a la misma carpeta del archivo ni a una carpeta de solo lectura", async () => {
  const { paso, modelo, revision, nube } = escenario();
  const misma = await paso("copiar", { fileId: modelo, carpetaId: revision });
  assert.equal(misma.ok, false);
  assert.match(misma.mensaje, /distinta de la carpeta donde está el archivo/);
  const lectura = nube.sembrarCarpeta([...nube.carpetas.values()].find((c) => c.parent === null)!.id, "Solo ver", "READ");
  const r = await paso("copiar", { fileId: modelo, carpetaId: lectura });
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /Solo tienes lectura en “Solo ver”/);
});

test("la tarea prueba formatos hasta que Trimble la acepta, adjunta el archivo y confirma a quién quedó asignada", async () => {
  const recibidas: unknown[] = [];
  const { paso, modelo } = escenario({
    extra: (metodo, ruta, cuerpo) => {
      if (ruta.startsWith("/todos/types")) return { estado: 200, cuerpo: [{ name: "Revisión" }, { name: "Observación" }] };
      if (metodo === "POST" && ruta === "/todos") {
        recibidas.push(cuerpo);
        const c = cuerpo as { type?: string; assignees: unknown[] };
        // Refuses the type «Flujo de aprobación» (not in its list), accepts «Request».
        return c.type === "Flujo de aprobación" ? { estado: 400, cuerpo: { message: "Invalid type" } } : { estado: 201, cuerpo: { id: "todo1", ...c } };
      }
      if (metodo === "POST" && ruta === "/todos/todo1/attachments") return { estado: 200, cuerpo: {} };
      if (metodo === "GET" && ruta === "/todos/todo1") return { estado: 200, cuerpo: { id: "todo1", assignees: [{ id: "g1", type: "GROUP" }] } };
      return null;
    },
  });
  const r = await paso("tarea", { fileId: modelo, asignadoTipo: "grupo", asignadoId: "g1", asignadoNombre: "Arquitectura" });
  assert.equal(r.ok, true, r.mensaje);
  assert.equal(recibidas.length, 2);
  assert.equal(r.datos.formato, "código + título + tipo «Solicitud» + vencimiento");
  assert.match(String((recibidas[1] as { label: string }).label), /^PRUEBA-\d{6}$/);
  assert.match(r.mensaje, /No aceptó el tipo «Flujo de aprobación»/);
  assert.equal(r.datos.adjunto, "attachments [fileId]");
  assert.equal(r.datos.confirmado, true);
  assert.deepEqual(r.datos.tipos, ["Revisión", "Observación"]);
  assert.match(r.mensaje, /Trimble creó la tarea «Prueba Flujo de aprobación: revisar SEL-ARQ-TR1.rvt» para Arquitectura \(grupo\)/);
  assert.match(r.mensaje, /El archivo quedó adjunto/);
  const intentos = r.datos.intentos as { http: number; detalle: string }[];
  assert.deepEqual(
    intentos.map((i) => i.http),
    [400, 201]
  );
  assert.match(intentos[0].detalle, /Invalid type/);
});

test("después de cerrar la tarea de prueba espera unos segundos antes de leerla otra vez (Trimble tarda en mostrar CLOSED)", async () => {
  let estado = "NEW";
  const esperas: number[] = [];
  const { paso, modelo } = escenario({
    extra: (metodo, ruta) => {
      if (metodo === "POST" && ruta === "/todos") return { estado: 201, cuerpo: { id: "t5" } };
      if (ruta.startsWith("/todos/t5/attachments")) return { estado: 400, cuerpo: "no" };
      if (metodo === "GET" && ruta === "/todos/t5") return { estado: 200, cuerpo: { id: "t5", status: estado, assignees: [{ id: "u2" }] } };
      if (ruta.startsWith("/todos/types")) return { estado: 200, cuerpo: [] };
      return null;
    },
    deps: {
      actualizarTarea: async (_id, cuerpo) => ({ estado: 200, cuerpo: { status: cuerpo.status } }),
      esperar: async (ms) => {
        esperas.push(ms);
        estado = "CLOSED";
      },
    },
  });
  const r = await paso("tarea", { fileId: modelo, asignadoTipo: "persona", asignadoId: "u2", asignadoNombre: "Juan Pérez" });
  assert.deepEqual(esperas, [4000]);
  assert.equal(r.datos.estadoCerrada, "CLOSED");
  assert.match(r.mensaje, /Al leerla otra vez, su estado es CLOSED \(antes NEW\)/);
  assert.match(r.mensaje, /Aceptó el código arriba, el tipo «Flujo de aprobación» y la fecha de vencimiento/);
});

test("si Trimble rechaza todos los formatos de tarea, lo dice con cada respuesta", async () => {
  const { paso, modelo } = escenario({
    extra: (metodo, ruta) => (ruta.startsWith("/todos") ? { estado: metodo === "POST" ? 400 : 404, cuerpo: { message: "bad request" } } : null),
  });
  const r = await paso("tarea", { fileId: modelo, asignadoTipo: "persona", asignadoId: "u2", asignadoNombre: "Juan Pérez" });
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /ninguno de los 7 formatos/);
  assert.equal((r.datos.intentos as unknown[]).length, 7);
  assert.equal(r.datos.tipos, null);
});

test("si la tarea queda sin la persona asignada, avisa", async () => {
  const { paso, modelo } = escenario({
    extra: (metodo, ruta) => {
      if (metodo === "POST" && ruta === "/todos") return { estado: 201, cuerpo: { id: "t9" } };
      if (ruta.startsWith("/todos/t9/attachments")) return { estado: 400, cuerpo: "no" };
      if (metodo === "GET" && ruta === "/todos/t9") return { estado: 200, cuerpo: { id: "t9", assignees: [] } };
      if (ruta.startsWith("/todos/types")) return { estado: 404, cuerpo: null };
      return null;
    },
  });
  const r = await paso("tarea", { fileId: modelo, asignadoTipo: "persona", asignadoId: "u2", asignadoNombre: "Juan Pérez" });
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /no muestra a Juan Pérez como asignado/);
  assert.match(r.mensaje, /No se pudo adjuntar el archivo/);
});

test("los formatos de tarea usan USER o GROUP según a quién va", () => {
  const f = formatosTarea({ projectId: "P", titulo: "T", descripcion: "D", asignadoId: "g1", tipo: "GROUP", etiqueta: "PRUEBA-195600", vence: "2026-11-12" });
  assert.deepEqual(f[0].cuerpo, { projectId: "P", label: "PRUEBA-195600", title: "T", description: "D", assignees: [{ id: "g1", type: "GROUP" }], dueDate: "2026-11-12T17:00:00+0000", type: "Flujo de aprobación" });
  assert.equal(f[1].cuerpo.type, "Request");
  assert.deepEqual(f.find((x) => x.formato === "label + assignees [id]")!.cuerpo.assignees, ["g1"]);
});

test("un paso desconocido o sin archivo se rechaza", async () => {
  const { paso } = escenario();
  await assert.rejects(() => paso("borrar"), /Paso no válido/);
  await assert.rejects(() => paso("archivo", { fileId: "../x" }), /Falta fileId/);
});
