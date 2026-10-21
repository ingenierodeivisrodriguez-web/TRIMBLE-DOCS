import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aGuardar, auditar, comparar, desdeGuardado, EntradaAuditoria, estadoDe, porcentaje } from "./auditoria";
import { clasificar, ModeloLeido, ObjetoModelo, valorDelVisor } from "./clasificacion";
import { agruparLotes } from "./client";
import { indiceCeldas, SIN_REQUERIMIENTO } from "./matriz";
import { VALORES_BASURA_INICIALES } from "./reglas";
import type { Alias, CeldaMatriz, Disciplina, Elemento, Etapa, Parametro, ReglaAsociacion } from "./types";
import { REGLA_VACIA } from "./types";

const alias = (texto: string): Alias => (texto.startsWith("@") ? { grupo: "@", propiedad: texto.slice(1), sugerida: false } : { grupo: texto.split(".")[0], propiedad: texto.split(".").slice(1).join("."), sugerida: false });
const parametro = (id: string, extra: Partial<Parametro>): Parametro => ({
  id, codigo: id.toUpperCase(), numero: null, nombre: id, descripcion: "", tdi: "B", ndi: 1, origen: "a_ingresar", tipoDato: "texto", unidad: "", valoresPermitidos: [],
  regla: REGLA_VACIA, alias: [], idsUri: "", activo: true, version: 1, actualizado: "", actualizadoPor: null, ...extra,
});
const catalogo = [
  parametro("ancho", { nombre: "Ancho", origen: "automatica", tipoDato: "numero", unidad: "m", alias: [alias("*.Ancho")] }),
  parametro("carga", { nombre: "Capacidad de carga", tipoDato: "booleano", alias: [alias("*.Capacidad de carga")] }),
  parametro("descr", { nombre: "Descripción", ndi: 2, alias: [alias("@Description")] }),
  parametro("grosor", { nombre: "Grosor", origen: "automatica", tipoDato: "numero", unidad: "m", alias: [alias("Qto_SlabBaseQuantities.Width")] }),
  parametro("material", { nombre: "Material", alias: [alias("*.Material")] }),
];
const porId = new Map(catalogo.map((p) => [p.id, p]));
const regla = (clase: string): ReglaAsociacion => ({ modo: "todas", condiciones: [{ campo: "@clase", operador: "igual", valor: clase }] });
const exigido = (id: string, obligatorio = true, extra = {}) => ({ parametroId: id, obligatorio, ndi: null, regla: null, ...extra });
const elemento = (id: string, clase: string, parametros: Elemento["parametros"]): Elemento => ({
  id, disciplinaId: "arq", codigo: id.toUpperCase(), nombre: id, claseIfc: clase, tipoPredefinido: "", clasificacionSistema: "", clasificacionCodigo: "", notas: "",
  parametros, regla: regla(clase), orden: 0, activo: true, version: 1, actualizado: "", actualizadoPor: null,
});
const elementos = [
  elemento("muro", "IfcWall", [exigido("ancho"), exigido("carga"), exigido("descr"), exigido("material", false)]),
  elemento("losa", "IfcSlab", [exigido("grosor", true, { regla: { min: 0.08, max: 0.5, patron: "" } })]),
  elemento("puerta", "IfcDoor", [exigido("ancho")]),
];
const disciplinas: Disciplina[] = [{ id: "arq", codigo: "ARQ", nombre: "Arquitectura", color: "#2a78d6", orden: 1, activo: true, version: 1, actualizado: "", actualizadoPor: null }];
const etapa: Etapa = { id: "pro", codigo: "PRO", nombre: "Proyecto", fecha: "2027-03-15", orden: 1, activo: true, version: 1, actualizado: "", actualizadoPor: null };
const celda = (elementoId: string, r: Partial<CeldaMatriz>): CeldaMatriz => ({ ...SIN_REQUERIMIENTO, id: elementoId, elementoId, etapaId: "pro", version: 1, actualizado: "", actualizadoPor: null, ...r });
const celdas = indiceCeldas([celda("muro", { lod: 300, ndi: 2 }), celda("losa", { lod: 300, ndi: 1 }), celda("puerta", { lod: 200, ndi: null })]);

const objeto = (runtimeId: number, clase: string, props: Record<string, Record<string, unknown>>, descripcion = ""): ObjetoModelo => ({
  runtimeId,
  ifcGuid: `${runtimeId}aaaaaaaaaaaaaaaaaaaaa`,
  clase,
  nombre: `${clase} ${runtimeId}`,
  tipo: "",
  descripcion,
  props: { grupos: Object.entries(props).map(([nombre, ps]) => ({ nombre, propiedades: Object.entries(ps).map(([n, valor]) => ({ nombre: n, valor })) })), atributos: { Description: descripcion } },
});
const modelo: ModeloLeido = {
  fileId: "f1",
  nombre: "ARQ.ifc",
  viewerModelId: "v1",
  objetos: [
    objeto(1, "IfcWall", { Cotas: { Ancho: 0.15 }, "Datos de identidad": { "Capacidad de carga": true, Material: "Bloque" } }, "Muro de bloque"),
    objeto(2, "IfcWall", { "Datos de identidad": { "Capacidad de carga": "N/A" } }, ""),
    objeto(3, "IfcWall", { Cotas: { Ancho: 0.2 }, "Datos de identidad": { "Capacidad de carga": "quizás" } }, "Muro"),
    objeto(4, "IfcSlab", { Qto_SlabBaseQuantities: { Width: 0.6 } }),
    objeto(5, "IfcDoor", { Cotas: { Ancho: 0.9 } }),
    objeto(6, "IfcFurniture", {}),
  ],
};

function entrada(extra: Partial<EntradaAuditoria> = {}): EntradaAuditoria {
  return {
    proyecto: "Torre Norte",
    etapa,
    modelos: [modelo],
    versiones: new Map([["f1", "v-7"]]),
    clasificacion: clasificar([modelo], new Map([["f1", ["arq"]]]), disciplinas, elementos, new Map()),
    disciplinas,
    elementos,
    catalogo: porId,
    celdas,
    valoresBasura: VALORES_BASURA_INICIALES,
    umbralAmarillo: 50,
    excepciones: new Set(["4aaaaaaaaaaaaaaaaaaaaa|grosor"]),
    disciplinaIds: null,
    ...extra,
  };
}

describe("auditoría de cumplimiento", () => {
  it("revisa presencia, contenido, regla y origen de cada parámetro obligatorio", () => {
    const { informe, detalle } = auditar(entrada());
    const estado = (rt: number) => detalle.get(`f1:${rt}`);
    // A full wall; the optional Material doesn't change the %.
    assert.deepEqual([estado(1)?.pct, estado(1)?.estado], [100, "cumple"]);
    // Automatic width missing = modeling problem; "N/A" and an empty description = not filled in.
    const m2 = estado(2)!;
    assert.deepEqual(m2.revisiones.map((r) => [r.codigo, r.estado]), [["ANCHO", "modelado"], ["CARGA", "sin_llenar"], ["DESCR", "sin_llenar"], ["MATERIAL", "falta"]]);
    assert.deepEqual([m2.pct, m2.estado], [0, "no_cumple"]);
    // "quizás" is not a yes/no: 2 of 3 = 66.7 % -> partial (threshold 50).
    assert.equal(estado(3)?.revisiones.find((r) => r.codigo === "CARGA")?.estado, "valor");
    assert.deepEqual([estado(3)?.pct, estado(3)?.estado], [66.7, "parcial"]);
    // The slab breaks its own rule (0.6 > 0.5 m) but that failure was accepted.
    assert.deepEqual([estado(4)?.revisiones[0].estado, estado(4)?.estado], ["aceptado", "cumple"]);
    assert.equal(estado(4)?.revisiones[0].ruta, "Qto_SlabBaseQuantities.Width");
    // The door's element asks no information at this stage.
    assert.equal(estado(5), undefined);

    assert.deepEqual(informe.total, { objetos: 4, cumple: 2, parcial: 1, noCumple: 1, exigidos: 10, cumplidos: 6, pct: 60 });
    assert.deepEqual(informe.porMotivo, { falta: 0, modelado: 1, sin_llenar: 2, valor: 1 });
    assert.deepEqual([informe.aceptados, informe.sinExigencia, informe.sinClasificar], [1, 1, 1]);
    assert.equal(informe.masIncumplidos[0].codigo, "CARGA");
    assert.deepEqual(informe.modelos, [{ fileId: "f1", nombre: "ARQ.ifc", versionId: "v-7" }]);
    assert.deepEqual(informe.elementos.map((e) => [e.codigo, e.ndi, e.totales.objetos]), [["LOSA", 1, 1], ["MURO", 2, 3]]);
    assert.deepEqual(informe.disciplinas.map((d) => [d.codigo, d.totales.pct]), [["ARQ", 60]]);
    assert.equal(informe.objetosSinClasificar[0].clase, "IfcFurniture");
  });

  it("sin la excepción la losa no cumple, y un elemento exigido sin objetos se avisa", () => {
    const sinLosas = { ...modelo, objetos: modelo.objetos.filter((o) => o.clase !== "IfcSlab") };
    const conExcepcion = auditar(entrada({ excepciones: new Set() }));
    assert.equal(conExcepcion.detalle.get("f1:4")?.estado, "no_cumple");
    const r = auditar(entrada({ modelos: [sinLosas], clasificacion: clasificar([sinLosas], new Map([["f1", ["arq"]]]), disciplinas, elementos, new Map()) }));
    assert.deepEqual(r.informe.elementosSinObjetos, ["LOSA · losa"]);
  });

  it("el porcentaje y el color siguen el umbral del proyecto", () => {
    assert.equal(porcentaje(2, 3), 66.7);
    assert.equal(porcentaje(0, 0), 100);
    assert.equal(estadoDe(100, 50), "cumple");
    assert.equal(estadoDe(50, 50), "parcial");
    assert.equal(estadoDe(49.9, 50), "no_cumple");
  });

  it("se guarda por partes y se lee igual, y dos auditorías se comparan por disciplina", () => {
    const { informe } = auditar(entrada());
    const { resumen, lotes } = aGuardar(informe, 2);
    assert.deepEqual(lotes.map((l) => [l.parte, l.elementoId, l.objetos.length]), [[1, "muro", 2], [2, "muro", 1], [3, "losa", 1], [4, null, 1]]);
    assert.equal("objetos" in resumen, false);
    const leido = desdeGuardado(JSON.parse(JSON.stringify(resumen)), JSON.parse(JSON.stringify(lotes)));
    assert.deepEqual(leido.objetos, informe.objetos);
    assert.deepEqual(leido.objetosSinClasificar, informe.objetosSinClasificar);

    const despues = { ...resumen, disciplinas: resumen.disciplinas.map((d) => ({ ...d, totales: { ...d.totales, pct: 75 } })), total: { ...resumen.total, pct: 75 } };
    assert.deepEqual(comparar(resumen, despues), [
      { nombre: "ARQ · Arquitectura", antes: 60, despues: 75, cambio: 15 },
      { nombre: "Total", antes: 60, despues: 75, cambio: 15 },
    ]);
  });

  it("las partes se mandan en grupos que no pasan del tamaño ni del número por envío", () => {
    const lote = (parte: number, n: number) => ({ parte, elementoId: "e", objetos: Array.from({ length: n }, () => "x".repeat(100)) });
    const grupos = agruparLotes([lote(1, 10), lote(2, 10), lote(3, 10)], 2500, 20);
    assert.deepEqual(grupos.map((g) => g.map((l) => l.parte)), [[1, 2], [3]]);
    assert.deepEqual(agruparLotes([lote(1, 1), lote(2, 1), lote(3, 1)], 1e9, 2).map((g) => g.length), [2, 1]);
  });

  it("los valores del visor quedan en unidades SI: largos de mm a m y fechas a AAAA-MM-DD", () => {
    assert.equal(valorDelVisor(0, 150), 0.15);
    assert.equal(valorDelVisor(8, 1793404800), "2026-10-31");
    assert.equal(valorDelVisor(2, 1.5), 1.5);
    assert.equal(valorDelVisor(5, "texto"), "texto");
  });
});
