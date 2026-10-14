import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDataset } from "../graficos/modelData";
import { Caller, ServiceError } from "../propiedades/service";
import { memoryStore as propiedadesStore } from "../propiedades/store";
import { documentoVacio } from "./doc";
import { memoriaDe, memoriaLimpia, memoriaParaGuardar, ordenarMemoria, porUbicacion, siguienteOrden } from "./memoria";
import { consultarElementos, Ctx, getAtributos, getDocumento, getEstado, guardarDocumento, guardarElementos, updateConfig } from "./service";
import { memoryStore } from "./store";
import type { ColumnaMemoria, Memoria } from "./types";

const ventana = (id: number, props: Record<string, string | number>) => ({
  id,
  class: "IfcWindow",
  properties: [{ name: "Ubicación", properties: Object.entries(props).map(([name, value]) => ({ name, value, type: typeof value === "number" ? 7 : 5 })) }],
});

describe("memoria de cantidades", () => {
  const ds = buildDataset("m", "Arq", [
    ventana(1, { Bloque: "Etapa 1", Conjunto: "Torre 1", Zona: "Residencial", "Nombre de Zona": "xx01", Espacio: "Alcoba", Otro: "x" }),
    ventana(2, { bloque: "Etapa 1", Espacio: 12 }),
    ventana(3, { Otro: "x" }),
  ]);

  it("lee bloque, conjunto, zona, nombre de zona y espacio de las propiedades del modelo", () => {
    assert.deepEqual(memoriaDe(ds, ds.records[0]), { bloque: "Etapa 1", conjunto: "Torre 1", zona: "Residencial", nombreZona: "xx01", espacio: "Alcoba" });
    assert.deepEqual(memoriaDe(ds, ds.records[1]), { bloque: "Etapa 1", conjunto: "", zona: "", nombreZona: "", espacio: "12" });
    assert.equal(memoriaDe(ds, ds.records[2]), null);
  });

  it("ordena por ubicación con los números en su orden natural", () => {
    const m = (espacio: string): { memoria: Memoria } => ({ memoria: { bloque: "B", conjunto: "", zona: "", nombreZona: "", espacio } });
    assert.deepEqual(porUbicacion([m("10"), m("2"), m("1")]).map((e) => e.memoria.espacio), ["1", "2", "10"]);
    assert.deepEqual(memoriaLimpia({ bloque: " A ", extra: 1, "mal id!": "x" }), { bloque: "A", extra: "1" });
    assert.equal(memoriaLimpia({}), null);
  });

  it("lee las columnas que elige el usuario: nombre, nivel, propiedad con su set; las de Propiedades e ID no se leen del modelo", () => {
    const ds2 = buildDataset("m", "Arq", [
      {
        id: 1,
        class: "IfcWall",
        product: { name: "Muro M-1" },
        properties: [
          { name: "Ubicación", properties: [{ name: "Nivel", value: "Piso 3", type: 5 }, { name: "Torre", value: "T1", type: 5 }] },
          { name: "Otro", properties: [{ name: "Torre", value: "OTRA", type: 5 }] },
        ],
      },
    ]);
    const cols: ColumnaMemoria[] = [
      { id: "n", label: "Nombre", fuente: "modelo", clave: "Nombre" },
      { id: "l", label: "Nivel", fuente: "modelo", clave: "nivel" },
      { id: "t", label: "Torre", fuente: "modelo", clave: "Otro · Torre" },
      { id: "p", label: "Estado", fuente: "propiedad", clave: "11111111-1111-4111-8111-111111111111" },
      { id: "g", label: "ID", fuente: "ifcguid", clave: "" },
    ];
    assert.deepEqual(memoriaDe(ds2, ds2.records[0], cols), { n: "Muro M-1", l: "Piso 3", t: "OTRA" });
  });

  it("guarda solo las columnas del modelo y conserva lo anterior donde la lectura nueva no encontró dato", () => {
    const cols: ColumnaMemoria[] = [
      { id: "a", label: "A", fuente: "modelo", clave: "A" },
      { id: "b", label: "B", fuente: "modelo", clave: "B" },
      { id: "p", label: "P", fuente: "propiedad", clave: "11111111-1111-4111-8111-111111111111" },
    ];
    assert.deepEqual(memoriaParaGuardar(cols, { a: "viejo", b: "B1", p: "Aprobado" }, { a: "nuevo", b: "" }), { a: "nuevo", b: "B1" });
    assert.equal(memoriaParaGuardar(cols, null, null), null);
  });
});

describe("modo del metrado y diccionario EDT", () => {
  const admin: Caller = { id: "u1", name: "Ana", isAdmin: true };
  const G1 = "3CqVfw$t15ihB2vPgB1wri";
  const ctx = (store = memoryStore()): Ctx => ({ projectId: "obra1", caller: admin, store, deps: { callerIn: async () => admin, projectName: async () => "" } });

  it("guarda el modo, la EDT y la memoria de los elementos", async () => {
    const c = ctx();
    const doc = documentoVacio();
    doc.subpresupuestos[0].items = [
      { id: "p1", tipo: "partida", nivel: 0, codigo: "", descripcion: "ZAPATAS", unidad: "UN", omniclass: "", rendimiento: 1, jornada: 8, componentes: [], metrado: 3, origenId: null, modo: "manual", edt: { descripcion: "Zapatas de concreto", criterios: "f'c 210", responsable: "Ing. Pérez" } },
    ];
    await guardarDocumento(c, { doc, version: 0 });
    const guardado = (await getDocumento(c)).doc.subpresupuestos[0].items[0] as { modo?: string; edt?: { responsable: string } };
    assert.equal(guardado.modo, "manual");
    assert.equal(guardado.edt?.responsable, "Ing. Pérez");

    const memoria = { bloque: "Etapa 1", conjunto: "Torre 1", zona: "Residencial", nombreZona: "xx01", espacio: "Alcoba" };
    await guardarElementos(c, { itemId: "p1", upsert: [{ ifcGuid: G1, modelId: "m", cantidad: 1, memoria }] });
    assert.deepEqual((await consultarElementos(c, { itemIds: ["p1"] })).elementos[0].memoria, memoria);
  });

  it("descarta un modo desconocido y una EDT vacía", async () => {
    const c = ctx();
    const doc = documentoVacio();
    doc.subpresupuestos[0].items = [
      { id: "p1", tipo: "partida", nivel: 0, codigo: "", descripcion: "X", unidad: "", omniclass: "", rendimiento: 1, jornada: 8, componentes: [], metrado: 0, origenId: null, modo: "raro" as never, edt: { descripcion: "", criterios: "", responsable: "" } },
    ];
    await guardarDocumento(c, { doc, version: 0 });
    const it = (await getDocumento(c)).doc.subpresupuestos[0].items[0] as { modo?: string; edt?: unknown };
    assert.equal(it.modo, undefined);
    assert.equal(it.edt, undefined);
  });
});

describe("columnas configurables de la memoria", () => {
  const admin: Caller = { id: "u1", name: "Ana", isAdmin: true };
  const editor: Caller = { id: "u2", name: "Luis", isAdmin: false, memberOfGroups: async () => new Set() };
  const lector: Caller = { id: "u3", name: "Marta", isAdmin: false, memberOfGroups: async () => new Set() };
  const G1 = "3CqVfw$t15ihB2vPgB1wri";
  const G2 = "0000000000000000000000";
  const forbidden = (e: unknown) => e instanceof ServiceError && e.status === 403;
  const invalid = (e: unknown) => e instanceof ServiceError && e.status === 400;

  async function entorno() {
    const store = memoryStore();
    const props = propiedadesStore();
    const def = await props.insertDefinition("obra1", { title: "Estado", dataType: "text", group: "General", sortOrder: 0 }, "x");
    const fecha = await props.insertDefinition("obra1", { title: "Fecha de instalación", dataType: "date", group: "General", sortOrder: 1 }, "x");
    await props.saveValues("obra1", [{ ifcGuid: G1, modelId: "m" }], [{ attributeId: def.id, value: "Aprobado" }, { attributeId: fecha.id, value: "2026-03-09" }], "x");
    const ctx = (caller: Caller): Ctx => ({ projectId: "obra1", caller, store, deps: { propiedades: () => props, callerIn: async () => caller, projectName: async () => "" } });
    const doc = documentoVacio();
    doc.subpresupuestos[0].items = [
      { id: "p1", tipo: "partida", nivel: 0, codigo: "", descripcion: "MURO", unidad: "M2", omniclass: "", rendimiento: 1, jornada: 8, componentes: [], metrado: 1, origenId: null },
    ];
    await guardarDocumento(ctx(admin), { doc, version: 0 });
    return { ctx, def, fecha };
  }

  it("empieza con las columnas de fábrica y los editores (no solo los administradores) las cambian", async () => {
    const { ctx, def } = await entorno();
    assert.deepEqual((await getEstado(ctx(lector))).config.memoriaColumnas.map((c) => c.id), ["bloque", "conjunto", "zona", "nombreZona", "espacio"]);
    const columnas = [
      { id: "nivel", label: "Nivel", fuente: "modelo", clave: "Nivel" },
      { id: "estado", label: "Estado", fuente: "propiedad", clave: def.id },
      { id: "guid", label: "ID", fuente: "ifcguid", clave: "" },
    ];
    await assert.rejects(updateConfig(ctx(lector), { memoriaColumnas: columnas }), forbidden);
    await updateConfig(ctx(admin), { editores: [{ type: "user", id: "u2", name: "Luis" }] });
    const estado = await updateConfig(ctx(editor), { memoriaColumnas: columnas });
    assert.deepEqual(estado.config.memoriaColumnas.map((c) => c.id), ["nivel", "estado", "guid"]);
    // but only an administrator changes the editors
    await assert.rejects(updateConfig(ctx(editor), { editores: [] }), forbidden);
  });

  it("rechaza columnas mal formadas o de más", async () => {
    const { ctx } = await entorno();
    const mala = (c: unknown) => assert.rejects(updateConfig(ctx(admin), { memoriaColumnas: c }), invalid);
    await mala([{ id: "a", label: "A", fuente: "otra", clave: "x" }]);
    await mala([{ id: "a", label: "A", fuente: "propiedad", clave: "no-es-uuid" }]);
    await mala([{ id: "a", label: "A", fuente: "modelo", clave: "X" }, { id: "a", label: "B", fuente: "modelo", clave: "Y" }]);
    await mala(Array.from({ length: 7 }, (_, i) => ({ id: "c" + i, label: "C", fuente: "modelo", clave: "X" })));
  });

  it("une al listado los valores actuales de la app Propiedades, ya formateados", async () => {
    const { ctx, def, fecha } = await entorno();
    await updateConfig(ctx(admin), {
      memoriaColumnas: [
        { id: "estado", label: "Estado", fuente: "propiedad", clave: def.id },
        { id: "fecha", label: "Fecha", fuente: "propiedad", clave: fecha.id },
        { id: "nivel", label: "Nivel", fuente: "modelo", clave: "Nivel" },
      ],
    });
    await guardarElementos(ctx(admin), {
      itemId: "p1",
      upsert: [
        { ifcGuid: G1, modelId: "m", cantidad: 2, memoria: { nivel: "Piso 2" } },
        { ifcGuid: G2, modelId: "m", cantidad: 3, memoria: { nivel: "Piso 3" } },
      ],
    });
    const { elementos } = await consultarElementos(ctx(lector), { itemIds: ["p1"] });
    const por = new Map(elementos.map((e) => [e.ifcGuid, e.memoria]));
    assert.deepEqual(por.get(G1), { nivel: "Piso 2", estado: "Aprobado", fecha: "09-03-2026" });
    assert.deepEqual(por.get(G2), { nivel: "Piso 3", estado: "", fecha: "" });
    assert.deepEqual((await getAtributos(ctx(lector))).atributos.map((a) => a.title), ["Estado", "Fecha de instalación"]);
  });
});

describe("ordenar la lista de la memoria por una columna", () => {
  const columnas: ColumnaMemoria[] = [
    { id: "nivel", label: "Nivel", fuente: "modelo", clave: "Ubicación · Nivel" },
    { id: "guid", label: "ID", fuente: "ifcguid", clave: "" },
  ];
  const el = (ifcGuid: string, nivel: string | null, cantidad: number | null) => ({ ifcGuid, cantidad, memoria: nivel === null ? null : { nivel } });
  const lista = [el("c", "NIVEL 10", 5), el("a", "NIVEL 2", 20), el("b", null, 7), el("d", "NIVEL 1", null), el("e", "NIVEL 2", 3)];
  const ids = (l: { ifcGuid: string }[]) => l.map((e) => e.ifcGuid).join("");

  it("texto en orden natural, ascendente y descendente, con los vacíos siempre al final", () => {
    assert.equal(ids(ordenarMemoria(lista, columnas, { por: "nivel", dir: "asc" })), "daecb"); // NIVEL 1, 2, 2, 10, (none)
    assert.equal(ids(ordenarMemoria(lista, columnas, { por: "nivel", dir: "desc" })), "caedb");
  });

  it("los iguales conservan el orden que traían", () => {
    assert.equal(ids(ordenarMemoria(lista, columnas, { por: "nivel", dir: "asc" }).slice(1, 3)), "ae");
    assert.equal(ids(ordenarMemoria(lista, columnas, { por: "nivel", dir: "desc" }).slice(1, 3)), "ae");
  });

  it("números por valor (no por texto) y los elementos sin cantidad al final", () => {
    assert.equal(ids(ordenarMemoria(lista, columnas, { por: "@cantidad", dir: "asc" })), "ecbad");
    assert.equal(ids(ordenarMemoria(lista, columnas, { por: "@cantidad", dir: "desc" })), "abced");
    assert.equal(ids(ordenarMemoria(lista, columnas, { por: "@valor", dir: "asc" })), "ecbad");
  });

  it("también ordena por el IFCGUID, no cambia la lista original y sin orden la deja igual", () => {
    assert.equal(ids(ordenarMemoria(lista, columnas, { por: "guid", dir: "desc" })), "edcba");
    assert.equal(ids(lista), "cabde");
    assert.equal(ordenarMemoria(lista, columnas, null), lista);
    assert.equal(ordenarMemoria(lista, columnas, { por: "ya-no-existe", dir: "asc" }), lista);
  });

  it("clic sucesivo en el encabezado: ascendente, descendente, y vuelve al orden de siempre", () => {
    const a = siguienteOrden(null, "nivel");
    assert.deepEqual(a, { por: "nivel", dir: "asc" });
    const b = siguienteOrden(a, "nivel");
    assert.deepEqual(b, { por: "nivel", dir: "desc" });
    assert.equal(siguienteOrden(b, "nivel"), null);
    assert.deepEqual(siguienteOrden(b, "@cantidad"), { por: "@cantidad", dir: "asc" }); // another column starts ascending
  });
});
