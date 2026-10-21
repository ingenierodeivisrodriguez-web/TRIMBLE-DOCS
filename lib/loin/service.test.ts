import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Caller } from "../propiedades/service";
import { entradasDyco, planificarImportacion } from "./importar";
import {
  aplicarPlantilla,
  cambiarPlantilla,
  cargarEtapasSugeridas,
  cargarSugeridas,
  crearPlantilla,
  getMatriz,
  guardarEtapa,
  guardarMatriz,
  Ctx,
  eliminarImagen,
  getCatalogo,
  getElementos,
  getEstado,
  guardarDisciplina,
  guardarElemento,
  guardarGruposTdi,
  guardarParametros,
  subirImagen,
  updateConfig,
} from "./service";
import { TDI_INICIALES } from "./semilla";
import { LoinStore, memoryStore } from "./store";

const ADMIN: Caller = { id: "ana", name: "Ana", isAdmin: true };
const MIEMBRO: Caller = { id: "luis", name: "Luis", isAdmin: false };

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

/** `miembros`: who belongs to which other project, and as what. */
function ctx(store: LoinStore, caller: Caller, projectId = "OBRA1", miembros: Record<string, Caller> = {}): Ctx {
  return {
    projectId,
    caller,
    store,
    deps: {
      callerIn: async (otro) => {
        const c = miembros[otro];
        if (!c) throw new Error("no es miembro");
        return c;
      },
      projectName: async (otro) => `Proyecto ${otro}`,
      nuevoId: uuid,
    },
  };
}

async function rechaza(p: Promise<unknown>, status: number, code?: string) {
  await assert.rejects(p, (err: { status?: number; code?: string }) => {
    assert.equal(err.status, status);
    if (code) assert.equal(err.code, code);
    return true;
  });
}

/** The DYCO list saved in P1's catalog. */
async function conDyco(store: LoinStore) {
  const filas = planificarImportacion(entradasDyco(), []).filas.map((f) => ({ ...f.datos, id: uuid(), version: 0 }));
  await guardarParametros(ctx(store, ADMIN), { parametros: filas });
  return (await getCatalogo(ctx(store, ADMIN))).parametros;
}

// A tiny valid WebP header (RIFF....WEBP) followed by filler.
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 1, 2, 3]);

describe("servicio de Requisitos BIM", () => {
  it("cualquier miembro consulta; solo administradores y editores modifican", async () => {
    const store = memoryStore();
    const estado = await getEstado(ctx(store, MIEMBRO));
    assert.equal(estado.canEdit, false);
    assert.equal(estado.esBasePropia, true);
    assert.deepEqual(estado.tdiGrupos, TDI_INICIALES);
    assert.equal(estado.config.umbralAmarillo, 50);
    await rechaza(guardarDisciplina(ctx(store, MIEMBRO), { id: uuid(), version: 0, codigo: "ARQ", nombre: "Arquitectura", color: "#2a78d6" }), 403, "not-editor");
    await rechaza(updateConfig(ctx(store, MIEMBRO), { editores: [] }), 403, "not-admin");

    await updateConfig(ctx(store, ADMIN), { editores: [{ type: "user", id: "luis", name: "Luis" }] });
    assert.equal((await getEstado(ctx(store, MIEMBRO))).canEdit, true);
    const conCambios = await updateConfig(ctx(store, MIEMBRO), { valoresBasura: ["N/A", "n/a", "-"], umbralAmarillo: 70 });
    assert.deepEqual(conCambios.config.valoresBasura, ["N/A", "-"]);
    assert.equal(conCambios.config.umbralAmarillo, 70);
  });

  it("el listado DYCO entra completo y un guardado con versión vieja se rechaza", async () => {
    const store = memoryStore();
    const parametros = await conDyco(store);
    assert.equal(parametros.length, 89);
    const p = parametros.find((x) => x.codigo === "DYCO-018")!;
    const [cambiado] = (await guardarParametros(ctx(store, ADMIN), { parametros: [{ ...p, alias: p.alias.map((a) => ({ ...a, sugerida: false })) }] })).parametros;
    assert.equal(cambiado.version, 2);
    assert.ok(cambiado.alias.every((a) => !a.sugerida));
    await rechaza(guardarParametros(ctx(store, ADMIN), { parametros: [{ ...p, nombre: "Otra" }] }), 409, "version-conflict");
    await rechaza(guardarParametros(ctx(store, ADMIN), { parametros: [{ ...p, id: uuid(), version: 0 }] }), 409, "duplicate-code");
    // Deactivated, never deleted.
    const [inactivo] = (await guardarParametros(ctx(store, ADMIN), { parametros: [{ ...cambiado, activo: false }] })).parametros;
    assert.equal(inactivo.activo, false);
    assert.equal((await getCatalogo(ctx(store, MIEMBRO))).parametros.length, 89);
  });

  it("los grupos TDI son editables, pero no se quita una letra que usa algún parámetro", async () => {
    const store = memoryStore();
    await conDyco(store);
    const grupos = TDI_INICIALES.map((g) => (g.codigo === "A" ? { ...g, nombre: "Administrativo" } : g));
    assert.equal((await guardarGruposTdi(ctx(store, ADMIN), { grupos })).tdiGrupos[0].nombre, "Administrativo");
    await rechaza(guardarGruposTdi(ctx(store, ADMIN), { grupos: grupos.filter((g) => g.codigo !== "L") }), 400);
    const nuevo = { codigo: "X-1", nombre: "Sin grupo", descripcion: "", tdi: "F", ndi: 1, origen: "a_ingresar", tipoDato: "texto", id: uuid(), version: 0 };
    await rechaza(guardarParametros(ctx(store, ADMIN), { parametros: [nuevo] }), 400);
  });

  it("un proyecto que usa otra base lee su catálogo; lo modifican solo quienes la mantienen", async () => {
    const store = memoryStore();
    await conDyco(store);
    // P2's administrator is only a member (not an editor) of P1.
    const p2 = ctx(store, ADMIN, "OBRA2", { OBRA1: MIEMBRO });
    await rechaza(updateConfig(ctx(store, ADMIN, "OBRA2"), { baseProjectId: "OBRA1" }), 403, "not-base-member");
    await rechaza(updateConfig(p2, { baseProjectId: "OBRA1" }), 403, "not-base-editor");

    const editorEnP1 = ctx(store, ADMIN, "OBRA2", { OBRA1: ADMIN });
    const estado = await updateConfig(editorEnP1, { baseProjectId: "OBRA1" });
    assert.equal(estado.esBasePropia, false);
    assert.equal(estado.config.baseProjectName, "Proyecto OBRA1");
    assert.equal((await getCatalogo(p2)).parametros.length, 89);
    const estadoP2 = await getEstado(p2);
    assert.equal(estadoP2.canEdit, true);
    assert.equal(estadoP2.canEditBase, false);
    const p = (await getCatalogo(p2)).parametros[0];
    await rechaza(guardarParametros(p2, { parametros: [p] }), 403, "not-base-editor");
  });

  it("los elementos exigen parámetros del catálogo y no repiten código en su disciplina", async () => {
    const store = memoryStore();
    const parametros = await conDyco(store);
    const { disciplina } = await guardarDisciplina(ctx(store, ADMIN), { id: uuid(), version: 0, codigo: "EST", nombre: "Estructura", color: "#EB6834" });
    assert.equal(disciplina.color, "#eb6834");
    const losa = {
      id: uuid(), version: 0, disciplinaId: disciplina.id, codigo: "LOS", nombre: "Losa", claseIfc: "ifcslab", tipoPredefinido: "floor",
      parametros: [{ parametroId: parametros.find((p) => p.codigo === "DYCO-021")!.id, obligatorio: true, ndi: null, regla: { min: 0.08, max: 0.5, patron: "" } }],
    };
    const { elemento } = await guardarElemento(ctx(store, ADMIN), losa);
    assert.equal(elemento.claseIfc, "Ifcslab");
    assert.equal(elemento.tipoPredefinido, "FLOOR");
    assert.equal(elemento.parametros[0].regla?.max, 0.5);
    await rechaza(guardarElemento(ctx(store, ADMIN), { ...losa, id: uuid(), parametros: [{ parametroId: uuid(), obligatorio: true }] }), 400);
    await rechaza(guardarElemento(ctx(store, ADMIN), { ...losa, id: uuid(), codigo: "los" }), 409, "duplicate-code");
    await rechaza(guardarElemento(ctx(store, ADMIN), { ...losa, claseIfc: "Losa" }), 400);
    await rechaza(guardarElemento(ctx(store, ADMIN, "OBRA9"), { ...losa, id: uuid(), parametros: [] }), 400, "disciplina-ajena");
    await rechaza(guardarElemento(ctx(store, ADMIN), { ...losa, nombre: "Losa 2" }), 409, "version-conflict");
  });

  it("las disciplinas sugeridas se cargan una vez y el proyecto exige los datos TDI-A solo al objeto Proyecto", async () => {
    const store = memoryStore();
    await conDyco(store);
    const r = await cargarSugeridas(ctx(store, ADMIN));
    assert.equal(r.disciplinas, 10);
    assert.ok(r.elementos > 40);
    const { disciplinas, elementos } = await getElementos(ctx(store, MIEMBRO));
    const gen = disciplinas.find((d) => d.codigo === "GEN")!;
    const proyecto = elementos.find((e) => e.disciplinaId === gen.id)!;
    assert.equal(proyecto.claseIfc, "IfcProject");
    assert.equal(proyecto.parametros.length, 14);
    assert.deepEqual(await cargarSugeridas(ctx(store, ADMIN)), { disciplinas: 0, elementos: 0, yaExistian: disciplinas.map((d) => d.codigo) });
  });

  it("las imágenes se revisan (tipo real, tamaño, cantidad) y se pueden quitar", async () => {
    const store = memoryStore();
    const { disciplina } = await guardarDisciplina(ctx(store, ADMIN), { id: uuid(), version: 0, codigo: "ARQ", nombre: "Arquitectura", color: "#2a78d6" });
    const { elemento } = await guardarElemento(ctx(store, ADMIN), { id: uuid(), version: 0, disciplinaId: disciplina.id, codigo: "MUR", nombre: "Muro" });
    const datos = { elementoId: elemento.id, nombre: "muro.webp", ancho: "800", alto: "600", tipo: "image/webp" };
    const { imagen } = await subirImagen(ctx(store, ADMIN), datos, WEBP);
    assert.match(imagen.url, /^data:image\/webp;base64,/);
    await rechaza(subirImagen(ctx(store, ADMIN), { ...datos, tipo: "image/png" }, WEBP), 400);
    await rechaza(subirImagen(ctx(store, ADMIN), { ...datos, tipo: "application/pdf" }, WEBP), 400);
    await rechaza(subirImagen(ctx(store, ADMIN), { ...datos, ancho: "4000" }, WEBP), 400);
    await rechaza(subirImagen(ctx(store, MIEMBRO), datos, WEBP), 403);
    for (let i = 0; i < 5; i++) await subirImagen(ctx(store, ADMIN), datos, WEBP);
    await rechaza(subirImagen(ctx(store, ADMIN), datos, WEBP), 400);

    await eliminarImagen(ctx(store, ADMIN), imagen.id);
    const { imagenes } = await getElementos(ctx(store, ADMIN));
    assert.equal(imagenes.length, 5);
    await rechaza(eliminarImagen(ctx(store, ADMIN), imagen.id), 404);
  });

  it("las etapas se crean con fecha válida, no repiten código y las sugeridas se cargan una vez", async () => {
    const store = memoryStore();
    await rechaza(guardarEtapa(ctx(store, MIEMBRO), { id: uuid(), version: 0, codigo: "ANT", nombre: "Anteproyecto" }), 403, "not-editor");
    const { etapa } = await guardarEtapa(ctx(store, ADMIN), { id: uuid(), version: 0, codigo: "ANT", nombre: "Anteproyecto", fecha: "2026-11-30", orden: 1 });
    assert.equal(etapa.fecha, "2026-11-30");
    await rechaza(guardarEtapa(ctx(store, ADMIN), { id: uuid(), version: 0, codigo: "X", nombre: "Mala", fecha: "2026-02-30" }), 400);
    await rechaza(guardarEtapa(ctx(store, ADMIN), { id: uuid(), version: 0, codigo: "ant", nombre: "Otra" }), 409, "duplicate-code");
    const r = await cargarEtapasSugeridas(ctx(store, ADMIN));
    assert.deepEqual([r.etapas, r.yaExistian], [4, ["ANT"]]);
    const { etapas } = await getMatriz(ctx(store, MIEMBRO));
    assert.deepEqual(etapas.map((e) => e.codigo), ["ANT", "PRO", "LIC", "CON", "ASB"]);
  });

  it("la matriz guarda celdas con versión, todas o ninguna, solo de elementos y etapas del proyecto", async () => {
    const store = memoryStore();
    const { disciplina } = await guardarDisciplina(ctx(store, ADMIN), { id: uuid(), version: 0, codigo: "ARQ", nombre: "Arquitectura", color: "#2a78d6" });
    const { elemento } = await guardarElemento(ctx(store, ADMIN), { id: uuid(), version: 0, disciplinaId: disciplina.id, codigo: "MUR", nombre: "Muro" });
    const { etapa } = await guardarEtapa(ctx(store, ADMIN), { id: uuid(), version: 0, codigo: "PRO", nombre: "Proyecto" });
    const celda = { id: uuid(), version: 0, elementoId: elemento.id, etapaId: etapa.id, lod: 300, ndi: 2, propositos: ["Coordinación", "coordinacion", "Cantidades"], actor: "Arquitecto" };
    const [guardada] = (await guardarMatriz(ctx(store, ADMIN), { celdas: [celda] })).celdas;
    assert.deepEqual([guardada.lod, guardada.ndi, guardada.propositos, guardada.version], [300, 2, ["Coordinación", "Cantidades"], 1]);
    await rechaza(guardarMatriz(ctx(store, MIEMBRO), { celdas: [{ ...celda, version: 1 }] }), 403, "not-editor");
    await rechaza(guardarMatriz(ctx(store, ADMIN), { celdas: [{ ...celda, version: 1, lod: 250 }] }), 400);
    await rechaza(guardarMatriz(ctx(store, ADMIN), { celdas: [{ ...celda, id: uuid() }] }), 409, "version-conflict");
    await rechaza(guardarMatriz(ctx(store, ADMIN, "OBRA2"), { celdas: [{ ...celda, id: uuid() }] }), 400, "disciplina-ajena");
    await rechaza(guardarMatriz(ctx(store, ADMIN), { celdas: [{ ...celda, version: 1 }, { ...celda, version: 1 }] }), 400);
    // A batch with a stale cell saves nothing.
    const otra = (await guardarEtapa(ctx(store, ADMIN), { id: uuid(), version: 0, codigo: "CON", nombre: "Construcción" })).etapa;
    await rechaza(guardarMatriz(ctx(store, ADMIN), { celdas: [{ ...celda, id: uuid(), etapaId: otra.id }, { ...celda, version: 7 }] }), 409, "version-conflict");
    assert.equal((await getMatriz(ctx(store, ADMIN))).celdas.length, 1);
    // "Not required" is a cell without levels, never a deletion.
    const [vacia] = (await guardarMatriz(ctx(store, ADMIN), { celdas: [{ ...celda, version: 1, lod: null, ndi: null }] })).celdas;
    assert.deepEqual([vacia.lod, vacia.ndi, vacia.version], [null, null, 2]);
  });

  it("una disciplina guardada como plantilla se copia a otro proyecto con la misma base, con sus imágenes", async () => {
    const store = memoryStore();
    const parametros = await conDyco(store);
    const { disciplina } = await guardarDisciplina(ctx(store, ADMIN), { id: uuid(), version: 0, codigo: "ARQ", nombre: "Arquitectura", color: "#2a78d6" });
    const { elemento } = await guardarElemento(ctx(store, ADMIN), {
      id: uuid(), version: 0, disciplinaId: disciplina.id, codigo: "MUR", nombre: "Muro", claseIfc: "IfcWall", notas: "Por capas",
      parametros: [{ parametroId: parametros[0].id, obligatorio: true }],
    });
    await subirImagen(ctx(store, ADMIN), { elementoId: elemento.id, nombre: "muro.webp", ancho: "800", alto: "600", tipo: "image/webp" }, WEBP);
    const { plantilla, imagenesOmitidas } = await crearPlantilla(ctx(store, ADMIN), { disciplinaId: disciplina.id, nombre: "Arquitectura DYCO", descripcion: "" });
    assert.equal(imagenesOmitidas, 0);
    assert.equal(plantilla.contenido.elementos[0].imagenes.length, 1);

    // P2 uses P1 as its base: it sees the template and copies it.
    const p2 = ctx(store, ADMIN, "OBRA2", { OBRA1: ADMIN });
    await updateConfig(p2, { baseProjectId: "OBRA1" });
    await guardarDisciplina(p2, { id: uuid(), version: 0, codigo: "ARQ", nombre: "Ya había una", color: "#000000" });
    const r = await aplicarPlantilla(p2, { plantillaId: plantilla.id });
    assert.equal(r.disciplina.codigo, "ARQ-2");
    assert.deepEqual([r.elementos, r.parametrosQuitados, r.imagenesOmitidas], [1, 0, 0]);
    const copia = await getElementos(p2);
    const muro = copia.elementos.find((e) => e.disciplinaId === r.disciplina.id)!;
    assert.equal(muro.notas, "Por capas");
    assert.equal(copia.imagenes.filter((i) => i.elementoId === muro.id).length, 1);

    // Templates are deactivated, not deleted; a deactivated one can't be applied.
    const desactivada = await cambiarPlantilla(ctx(store, ADMIN), { id: plantilla.id, version: plantilla.version, activo: false });
    assert.equal(desactivada.plantilla.activo, false);
    await rechaza(aplicarPlantilla(p2, { plantillaId: plantilla.id }), 404);
  });
});
