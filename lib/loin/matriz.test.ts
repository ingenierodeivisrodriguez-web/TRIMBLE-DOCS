import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  avisosElemento,
  colorCelda,
  COLOR_LOD,
  etapasOrdenadas,
  fechaCorta,
  gruposMatriz,
  indiceCeldas,
  parametrosExigidos,
  planAplicar,
  planCopiarEtapa,
  planDisciplina,
  SIN_REQUERIMIENTO,
  textoCelda,
} from "./matriz";
import { CeldaMatriz, Disciplina, Elemento, Etapa, LODS, Parametro, REGLA_VACIA, Requerimiento } from "./types";

const etapa = (id: string, orden: number, extra: Partial<Etapa> = {}): Etapa => ({ id, codigo: id.toUpperCase(), nombre: `Etapa ${id}`, fecha: null, orden, activo: true, version: 1, actualizado: "", actualizadoPor: null, ...extra });
const elemento = (id: string, disciplinaId: string, extra: Partial<Elemento> = {}): Elemento => ({
  id, disciplinaId, codigo: id.toUpperCase(), nombre: id, claseIfc: "IfcWall", tipoPredefinido: "", clasificacionSistema: "", clasificacionCodigo: "", notas: "",
  parametros: [], regla: null, orden: 0, activo: true, version: 1, actualizado: "", actualizadoPor: null, ...extra,
});
const celda = (elementoId: string, etapaId: string, r: Partial<Requerimiento>, version = 1): CeldaMatriz => ({
  ...SIN_REQUERIMIENTO, ...r, id: `${elementoId}-${etapaId}`, elementoId, etapaId, version, actualizado: "", actualizadoPor: null,
});
const parametro = (id: string, ndi: 1 | 2 | 3): Parametro => ({
  id, codigo: id, numero: null, nombre: id, descripcion: "", tdi: "B", ndi, origen: "automatica", tipoDato: "numero", unidad: "", valoresPermitidos: [],
  regla: REGLA_VACIA, alias: [], idsUri: "", activo: true, version: 1, actualizado: "", actualizadoPor: null,
});
let n = 0;
const id = () => `nuevo-${++n}`;

describe("matriz LOIN", () => {
  it("la celda se lee \"LOD 300 · NDI-2\" y su color sigue el LOD de claro a oscuro", () => {
    assert.equal(textoCelda({ lod: 300, ndi: 2 }), "LOD 300 · NDI-2");
    assert.equal(textoCelda({ lod: null, ndi: 1 }), "NDI-1");
    assert.equal(textoCelda({ lod: null, ndi: null }), "");
    assert.equal(colorCelda({ lod: null, ndi: null }), null);
    assert.equal(colorCelda({ lod: 350, ndi: null })?.fondo, COLOR_LOD[350].fondo);
    // One hue getting darker: each step has less luminance than the one before.
    const luz = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    const luces = LODS.map((l) => luz(COLOR_LOD[l].fondo));
    assert.ok(luces.every((v, i) => i === 0 || v < luces[i - 1]));
  });

  it("las etapas van en su orden (luego por fecha) y la fecha se ve DD-MM-AAAA", () => {
    const etapas = [etapa("c", 2), etapa("a", 1, { fecha: "2026-12-01" }), etapa("b", 1, { fecha: "2026-03-01" }), etapa("x", 0, { activo: false })];
    assert.deepEqual(etapasOrdenadas(etapas).map((e) => e.id), ["b", "a", "c"]);
    assert.equal(etapasOrdenadas(etapas, true)[0].id, "x");
    assert.equal(fechaCorta("2026-03-01"), "01-03-2026");
    assert.equal(fechaCorta(null), "");
  });

  it("asignar a varias celdas llena las vacías y no pisa las que dicen otra cosa, salvo que se pida", () => {
    const celdas = indiceCeldas([celda("m", "e1", { lod: 200, ndi: 1 }), celda("l", "e1", { lod: 300, ndi: 2 }), celda("v", "e1", {})]);
    const valores = { ...SIN_REQUERIMIENTO, lod: 300 as const, ndi: 2 as const };
    const destinos = ["m", "l", "v", "p"].map((e) => ({ elementoId: e, etapaId: "e1", valores }));
    const plan = planAplicar(destinos, celdas, false, id);
    assert.deepEqual([plan.nuevas, plan.distintas, plan.iguales], [2, 1, 1]);
    assert.deepEqual(plan.guardar.map((g) => [g.elementoId, g.version]), [["v", 1], ["p", 0]]);
    const forzado = planAplicar(destinos, celdas, true, id);
    assert.deepEqual(forzado.guardar.map((g) => g.elementoId).sort(), ["m", "p", "v"]);
    assert.equal(forzado.guardar.find((g) => g.elementoId === "m")?.version, 1);
  });

  it("asignar a una disciplina toca solo sus elementos activos", () => {
    const elementos = [elemento("m", "arq"), elemento("p", "arq", { activo: false }), elemento("c", "est")];
    const plan = planDisciplina(elementos, "arq", "e1", { ...SIN_REQUERIMIENTO, lod: 200 }, new Map(), false, id);
    assert.deepEqual(plan.guardar.map((g) => g.elementoId), ["m"]);
  });

  it("copiar de la etapa anterior lleva lo que cada elemento pedía allí", () => {
    const elementos = [elemento("m", "arq"), elemento("l", "est"), elemento("v", "arq")];
    const celdas = indiceCeldas([
      celda("m", "e1", { lod: 200, ndi: 1, propositos: ["Coordinación"], actor: "Arquitecto" }),
      celda("l", "e1", { lod: 300, ndi: 1 }),
      celda("l", "e2", { lod: 350, ndi: 2 }),
    ]);
    const plan = planCopiarEtapa(elementos, "e1", "e2", celdas, false, id);
    assert.deepEqual([plan.nuevas, plan.distintas], [1, 1]);
    assert.deepEqual(plan.guardar.map((g) => [g.elementoId, g.etapaId, g.lod, g.actor]), [["m", "e2", 200, "Arquitecto"]]);
    assert.equal(planCopiarEtapa(elementos, "e1", "e2", celdas, false, id, "est").guardar.length, 0);
  });

  it("avisa cuando el LOD o el NDI bajan de una etapa a otra, o cuando un NDI no tiene parámetros", () => {
    const catalogo = new Map([parametro("a", 1), parametro("b", 2)].map((p) => [p.id, p]));
    const m = elemento("m", "arq", { parametros: [{ parametroId: "b", obligatorio: true, ndi: null, regla: null }] });
    const etapas = [etapa("e1", 1), etapa("e2", 2), etapa("e3", 3)];
    const celdas = indiceCeldas([celda("m", "e1", { lod: 300, ndi: 2 }), celda("m", "e2", { lod: 200, ndi: 1 }), celda("m", "e3", { lod: 400, ndi: 3 })]);
    const avisos = avisosElemento(m, etapas, celdas, catalogo);
    assert.equal(avisos.get("e1"), undefined);
    assert.deepEqual(avisos.get("e2"), [
      "El LOD baja: en Etapa e1 se pide LOD 300.",
      "El NDI baja: en Etapa e1 se pide NDI-2.",
      "Pide NDI-1, pero el elemento no tiene parámetros exigidos de ese nivel o menor.",
    ]);
    assert.equal(avisos.get("e3"), undefined);
    assert.deepEqual(parametrosExigidos(m, 3, catalogo), { obligatorios: 1, opcionales: 0 });
    assert.deepEqual(parametrosExigidos(m, null, catalogo), { obligatorios: 0, opcionales: 0 });
  });

  it("agrupa por disciplina en su orden, sin disciplinas ni elementos inactivos", () => {
    const disc = (id: string, orden: number, activo = true): Disciplina => ({ id, codigo: id.toUpperCase(), nombre: id, color: "#000000", orden, activo, version: 1, actualizado: "", actualizadoPor: null });
    const grupos = gruposMatriz(
      [disc("est", 2), disc("arq", 1), disc("vieja", 0, false), disc("vacia", 3)],
      [elemento("c", "est"), elemento("m", "arq", { orden: 2 }), elemento("p", "arq", { orden: 1 }), elemento("x", "vieja"), elemento("z", "arq", { activo: false })]
    );
    assert.deepEqual(grupos.map((g) => [g.disciplina.id, g.elementos.map((e) => e.id)]), [["arq", ["p", "m"]], ["est", ["c"]]]);
  });
});
