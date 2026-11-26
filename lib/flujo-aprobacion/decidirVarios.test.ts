import { test } from "node:test";
import assert from "node:assert/strict";
import type { Caller } from "../propiedades/service";
import type { ProjectUser, RawFolderItem } from "../trimbleApi";
import type { Correo, MensajeCorreo } from "./correo";
import { decidir, decidirVarios, mensajeVarios } from "./decisiones";
import { FlujoError } from "./errores";
import { listarArchivos } from "./revision";
import { Ctx, guardarFlujo, historial, TrimbleFlujo } from "./service";
import { memoryStore } from "./store";

const persona = (id: string, firstName: string, role = "USER"): ProjectUser => ({ id, firstName, lastName: "", email: `${id}@obra.co`, role, status: "ACTIVE" });
const PERSONAS = [persona("ana", "Ana", "ADMIN"), persona("juan", "Juan"), persona("luz", "Luz"), persona("pepe", "Pepe"), persona("eva", "Eva")];
const CARPETAS: Record<string, { ruta: string; permiso: "READ" | "FULL_ACCESS" }> = {
  arq: { ruta: "Obra / Arquitectura", permiso: "FULL_ACCESS" },
  entrega: { ruta: "Obra / Entrega", permiso: "FULL_ACCESS" },
  lectura: { ruta: "Obra / Solo lectura", permiso: "READ" },
};

/** A-01 and A-02 uploaded by Juan, A-03 by Ana; Revisa = group Arquitectura (Luz, Eva), Aprueba = Pepe. */
async function escenario() {
  const store = memoryStore();
  const plano = (id: string, quien: string): RawFolderItem => ({
    id,
    name: `${id}.pdf`,
    type: "FILE",
    createdOn: "",
    modifiedOn: "2026-11-20T15:00:00.000Z",
    modifiedBy: { id: quien, firstName: PERSONAS.find((p) => p.id === quien)!.firstName },
    versionId: `${id}-v1`,
    revision: 1,
  });
  const arbol: Record<string, RawFolderItem[]> = { arq: [plano("A-01", "juan"), plano("A-02", "juan"), plano("A-03", "ana")] };
  const correos: MensajeCorreo[] = [];
  const correo: Correo = { desde: "avisos@gmail.com", enviar: async (m) => void correos.push(m) };
  const tc: TrimbleFlujo = {
    carpeta: async (id) => {
      const c = CARPETAS[id];
      if (!c) throw new FlujoError("No existe.", 404);
      return { id, ruta: c.ruta, ancestros: ["raiz"], permiso: c.permiso };
    },
    archivo: async (id) => ({ id, ruta: `Obra / Arquitectura / ${id}.pdf`, ancestros: ["raiz", "arq"] }),
    personas: async () => PERSONAS,
    grupos: async () => [{ id: "g-arq", name: "Arquitectura" }],
    miembros: async (g) => (g === "g-arq" ? [PERSONAS[2], PERSONAS[4]] : []),
    permisos: async () => ({ direct: { acl: {}, inheritance: true }, inherited: {} }),
    items: async (id) => arbol[id] ?? [],
    version: async (id) => arbol.arq.find((x) => x.id === id)?.versionId ?? null,
    lado: { projectId: "P", servidor: "https://falso", cliente: { pedir: async () => ({ estado: 404, cuerpo: null }) } },
  };
  const ctx = (id: string, isAdmin = false): Ctx => ({
    projectId: "P",
    caller: { id, name: PERSONAS.find((p) => p.id === id)!.firstName, isAdmin, memberOfGroups: async (ids) => new Set(ids.filter((g) => g === "g-arq" && (id === "luz" || id === "eva"))) } satisfies Caller,
    store,
    tc,
    correo,
    ahora: () => new Date("2026-11-26T15:00:00Z"),
  });
  const admin = ctx("ana", true);
  const f = (
    await guardarFlujo(admin, {
      hito: "Planos PDF",
      archivos: ["A-01", "A-02", "A-03"],
      pasos: [
        { nombre: "Revisa", responsable: { tipo: "grupo", id: "g-arq" } },
        { nombre: "Aprueba", responsable: { tipo: "persona", id: "pepe" } },
      ],
    })
  ).flujos[0];
  const archivos = async () => (await listarArchivos(admin)).archivos.filter((a) => a.flujoId === f.id).sort((p, q) => p.nombre.localeCompare(q.nombre));
  const elegir = async (nombres: string[]) => (await archivos()).filter((a) => nombres.includes(a.nombre)).map((a) => ({ archivoId: a.id, versionId: a.versionId }));
  return { store, correos, ctx, admin, f, archivos, elegir };
}

test("Luz aprueba tres planos a la vez: pasan a «Aprueba» y Pepe recibe un solo correo con la lista", async () => {
  const e = await escenario();
  const antes = e.correos.length;
  const r = await decidirVarios(e.ctx("luz"), { flujoId: e.f.id, archivos: await e.elegir(["A-01.pdf", "A-02.pdf", "A-03.pdf"]), texto: "Revisados" }, "aprobar");
  assert.equal(r.mensaje, "3 archivos pasan al paso siguiente.");
  assert.deepEqual(
    r.resultados.map((x) => [x.nombre, x.ok, x.texto]),
    [
      ["A-01.pdf", true, "Pasa a «Aprueba»."],
      ["A-02.pdf", true, "Pasa a «Aprueba»."],
      ["A-03.pdf", true, "Pasa a «Aprueba»."],
    ]
  );
  assert.deepEqual(r.copiar, []);
  const nuevos = e.correos.slice(antes);
  assert.equal(nuevos.length, 1, "one e-mail, not one per file");
  assert.equal(nuevos[0].para.correo, "pepe@obra.co");
  assert.equal(nuevos[0].asunto, "FLUJO-01 · Te toca «Aprueba»: Planos PDF");
  for (const n of ["A-01.pdf", "A-02.pdf", "A-03.pdf"]) assert.match(nuevos[0].texto, new RegExp(n.replace(".", "\\.")));
  assert.deepEqual(r.avisos, ["Correo a Pepe <pepe@obra.co>: «FLUJO-01 · Te toca «Aprueba»: Planos PDF»."]);
  for (const a of await e.archivos()) {
    assert.equal(a.pasoNombre, "Aprueba");
    assert.deepEqual(
      a.firmas.map((x) => [x.paso, x.quien, x.comentario]),
      [["Revisa", "Luz", "Revisados"]]
    );
  }
  const h = (await historial(e.admin, e.f.id)).entradas;
  assert.equal(h.filter((x) => x.accion === "aprobado-paso").length, 3);
});

test("rechazar varios exige motivo; cada persona que los subió recibe un correo con los suyos y el motivo", async () => {
  const e = await escenario();
  const elegidos = await e.elegir(["A-01.pdf", "A-02.pdf", "A-03.pdf"]);
  await assert.rejects(() => decidirVarios(e.ctx("luz"), { flujoId: e.f.id, archivos: elegidos, texto: "" }, "rechazar"), /Escribe el motivo del rechazo/);
  const antes = e.correos.length;
  const r = await decidirVarios(e.ctx("luz"), { flujoId: e.f.id, archivos: elegidos, texto: "Faltan los ejes" }, "rechazar");
  assert.equal(r.mensaje, "3 archivos quedan rechazados.");
  const nuevos = e.correos.slice(antes).sort((p, q) => p.para.correo!.localeCompare(q.para.correo!));
  assert.deepEqual(
    nuevos.map((m) => [m.para.correo, m.asunto]),
    [
      ["ana@obra.co", "FLUJO-01 · Rechazado: corrige «A-03.pdf» — Planos PDF"],
      ["juan@obra.co", "FLUJO-01 · Rechazado: corrige «A-01.pdf y 1 más» — Planos PDF"],
    ]
  );
  assert.match(nuevos[1].texto, /Motivo: Faltan los ejes/);
  assert.match(nuevos[1].texto, /A-01\.pdf[\s\S]*A-02\.pdf/);
  assert.match(nuevos[1].texto, /en la misma carpeta \(Obra \/ Arquitectura\)/);
  for (const a of await e.archivos()) assert.equal(a.estado, "rechazado");
});

test("uno que no se puede decidir no frena a los demás: cada uno dice por qué", async () => {
  const e = await escenario();
  // A-03 already went on to «Aprueba» (Luz alone).
  const a3 = (await e.archivos()).find((a) => a.nombre === "A-03.pdf")!;
  await decidir(e.ctx("luz"), { archivoId: a3.id, versionId: a3.versionId, texto: "" }, "aprobar");
  const elegidos = await e.elegir(["A-01.pdf", "A-02.pdf", "A-03.pdf"]);
  elegidos[1] = { ...elegidos[1], versionId: "otra" };
  const r = await decidirVarios(e.ctx("luz"), { flujoId: e.f.id, archivos: elegidos, texto: "" }, "aprobar");
  assert.equal(r.mensaje, "1 archivo pasa al paso siguiente. 2 archivos no se pudieron decidir (abajo el motivo).");
  assert.deepEqual(
    r.resultados.map((x) => [x.nombre, x.ok]),
    [
      ["A-01.pdf", true],
      ["A-02.pdf", false],
      ["A-03.pdf", false],
    ]
  );
  assert.match(r.resultados[1].texto, /^Llegó la versión 1 después de que lo abriste/);
  assert.match(r.resultados[2].texto, /El paso «Aprueba» de este archivo no es tuyo: lo decide Pepe/);
  // Someone else's flow, or nothing chosen.
  await assert.rejects(() => decidirVarios(e.ctx("luz"), { flujoId: e.f.id, archivos: [], texto: "" }, "aprobar"), /Elige los archivos/);
});

test("último paso: la carpeta se elige una vez para todos y la pantalla pide copiar cada aprobado", async () => {
  const e = await escenario();
  await decidirVarios(e.ctx("luz"), { flujoId: e.f.id, archivos: await e.elegir(["A-01.pdf", "A-02.pdf", "A-03.pdf"]), texto: "" }, "aprobar");
  const elegidos = await e.elegir(["A-01.pdf", "A-02.pdf", "A-03.pdf"]);
  await assert.rejects(() => decidirVarios(e.ctx("pepe"), { flujoId: e.f.id, archivos: elegidos, texto: "No sirve", destino: "entrega" }, "rechazar"), /La carpeta se elige al aprobar el último paso/);
  await assert.rejects(() => decidirVarios(e.ctx("pepe"), { flujoId: e.f.id, archivos: elegidos, texto: "", destino: "lectura" }, "aprobar"), /Solo tienes lectura en «Obra \/ Solo lectura»/);
  // Their own folder: the copy would come back to review, so none is decided.
  const propia = await decidirVarios(e.ctx("pepe"), { flujoId: e.f.id, archivos: elegidos, texto: "", destino: "arq" }, "aprobar");
  assert.equal(propia.resultados.filter((x) => x.ok).length, 0);

  const r = await decidirVarios(e.ctx("pepe"), { flujoId: e.f.id, archivos: elegidos, texto: "Cumple", destino: "entrega" }, "aprobar");
  assert.equal(r.mensaje, "3 archivos quedan aprobados.");
  assert.deepEqual(
    r.copiar.map((x) => [x.nombre, x.carpetaId]),
    [
      ["A-01.pdf", "entrega"],
      ["A-02.pdf", "entrega"],
      ["A-03.pdf", "entrega"],
    ]
  );
  for (const a of await e.archivos()) assert.equal(a.estado, "aprobado");
  const h = (await historial(e.admin, e.f.id)).entradas.filter((x) => x.accion === "aprobado");
  assert.equal(h.length, 3);
  assert.ok(h.every((x) => x.detalle.endsWith("Eligió ponerla en «Obra / Entrega».")));
});

test("el resumen de lo decidido", () => {
  assert.equal(mensajeVarios("aprobar", ["aprobado-paso", "aprobado-paso", "aprobado"], 0), "2 archivos pasan al paso siguiente, 1 archivo queda aprobado.");
  assert.equal(mensajeVarios("rechazar", ["rechazado"], 1), "1 archivo queda rechazado. 1 archivo no se pudo decidir (abajo el motivo).");
  assert.equal(mensajeVarios("aprobar", [], 2), "No se decidió ningún archivo. 2 archivos no se pudieron decidir (abajo el motivo).");
});
