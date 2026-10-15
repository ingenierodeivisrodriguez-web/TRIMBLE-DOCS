import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Caller, ServiceError } from "../../propiedades/service";
import { calcularSubpresupuesto, SubpresupuestoCalculado } from "../calc";
import { documentoVacio, resolverPresupuesto } from "../doc";
import { aplicarPrograma, dividirPorUbicacion, edtDesdePresupuesto, lineaDeBalance } from "../edtProgramacion";
import { programacionVacia, programar } from "../programacion";
import type { Ctx } from "../service";
import { guardarDocumento } from "../service";
import { memoryStore, PresupuestoStore } from "../store";
import type { ItemPartida, PresupuestoDoc, Programacion } from "../types";
import type { ClienteIA, PeticionIA, RespuestaIA } from "./claude";
import { leerPrograma, leerRuta, mensajePrograma } from "./programa";
import { decidirBorradoresIA, generarProgramaIA, getEstadoIA, guardarCupoIA, listarBorradoresIA } from "./servicio";
import type { ActividadProgramaIA, BorradorProgramaIA } from "./tipos";

const admin: Caller = { id: "u1", name: "Ana", isAdmin: true };
const vendedor: Caller = { id: "v1", name: "Deivis", isAdmin: false, memberOfGroups: async () => new Set() };

function falsa(texto: string) {
  const llamadas: PeticionIA[] = [];
  const cliente: ClienteIA = {
    proveedor: "Google",
    modelo: "gemini-3.8-flash",
    async generar(p) {
      llamadas.push(p);
      return { texto, stopReason: "end_turn", modelo: "gemini-3.8-flash", tokens: [{ modelo: "gemini-3.8-flash", entrada: 2000, salida: 800, cacheEscritura: 0, cacheLectura: 0 }], rechazo: null } satisfies RespuestaIA;
    },
  };
  return { cliente, llamadas };
}

function ctx(store: PresupuestoStore, caller: Caller, cliente: ClienteIA | null = null): Ctx {
  return {
    projectId: "obra1",
    caller,
    store,
    deps: {
      callerIn: async (p) => {
        if (p === "gestor" && caller.id === "v1") return { ...caller, isAdmin: true };
        throw new ServiceError("No es miembro.", 403);
      },
      projectName: async () => "",
      ia: () => cliente,
      iaGestor: "gestor",
    },
  };
}

const act = (id: string, nombre: string): ActividadProgramaIA => ({ id, nombre, unidad: "M3", cantidad: 10, duracion: 3, ruta: "PRESUPUESTO GENERAL" });
const ACTS = [act("x1", "EXCAVACIÓN"), act("x2", "ZAPATAS"), act("x3", "COLUMNAS PISO 1")];

describe("secuencia de la programación con IA: lo que se acepta", () => {
  it("convierte los códigos, sin enlaces a sí misma, repetidos, de otro tipo ni que cierren un ciclo", () => {
    const texto = JSON.stringify({
      actividades: [
        { codigo: "A2", paquete: " cimentación ", predecesoras: [{ codigo: "A1", tipo: "FC", desfase: 0 }, { codigo: "A1", tipo: "CC", desfase: 0 }, { codigo: "A2", tipo: "FC", desfase: 0 }] },
        { codigo: "A1", paquete: "Cimentación", predecesoras: [{ codigo: "A2", tipo: "FC", desfase: 0 }] }, // would loop with A2
        { codigo: "A3", paquete: "estructura > piso 1 > a > b > c", predecesoras: [{ codigo: "A2", tipo: "FC", desfase: 500 }, { codigo: "A9", tipo: "FC", desfase: 0 }, { codigo: "A1", tipo: "CF", desfase: 0 }] },
        { codigo: "A3", paquete: "repetida", predecesoras: [] },
      ],
    });
    const r = leerPrograma(texto, ACTS);
    assert.deepEqual(r.propuestas, [
      { id: "x2", paquete: ["CIMENTACIÓN"], predecesoras: [{ id: "x1", tipo: "FC", desfase: 0 }] },
      { id: "x1", paquete: ["CIMENTACIÓN"], predecesoras: [] },
      { id: "x3", paquete: ["ESTRUCTURA", "PISO 1", "A", "B"], predecesoras: [{ id: "x2", tipo: "FC", desfase: 60 }] },
    ]);
    assert.equal(r.ciclos, 1);
    assert.deepEqual(r.faltantes, []);
    assert.deepEqual(leerRuta(" a >  > b "), ["A", "B"]);
    assert.throws(() => leerPrograma("no", ACTS), /no se pudo leer/);
    const m = mensajePrograma("Edificio de 5 pisos", ACTS);
    assert.match(m, /"codigo":"A1","actividad":"EXCAVACIÓN","unidad":"M3","cantidad":10,"dias":3/);
  });

  it("guarda la propuesta como borrador y registra la decisión", async () => {
    const store = memoryStore();
    await guardarDocumento(ctx(store, admin), { doc: documentoVacio(), version: 0 });
    await guardarCupoIA(ctx(store, vendedor), { proyecto: { habilitada: true, cupoProyectoCop: 100_000, cupoUsuarioCop: 50_000 } });
    const { cliente } = falsa(JSON.stringify({ actividades: [{ codigo: "A1", paquete: "CIMENTACIÓN", predecesoras: [] }, { codigo: "A2", paquete: "CIMENTACIÓN", predecesoras: [{ codigo: "A1", tipo: "FC", desfase: 0 }] }] }));
    const r = await generarProgramaIA(ctx(store, admin, cliente), { contexto: "", alcance: "n1", actividades: ACTS });
    assert.deepEqual(r.faltantes, ["x3"]);
    assert.equal(r.borrador.itemId, "programa:n1");
    assert.equal((await getEstadoIA(ctx(store, admin))).usos[0].tarea, "programa");
    await assert.rejects(generarProgramaIA(ctx(store, admin, cliente), { contexto: "", alcance: null, actividades: Array.from({ length: 151 }, (_, i) => act(`a${i}`, "X")) }), /Máximo 150/);
    const b = (await listarBorradoresIA(ctx(store, admin), "programa")).borradores[0] as BorradorProgramaIA;
    // Only the package of the first one and the links of the second were applied.
    const d = await decidirBorradoresIA(ctx(store, admin), {
      decisiones: [{ id: b.id, estado: "aceptado", final: { actividades: [{ id: "x1", paquete: ["CIMENTACIÓN"], predecesoras: [] }, { id: "x2", paquete: [], predecesoras: [{ id: "x1" }] }] } }],
    });
    assert.deepEqual(d.resumen.programa, { pendientes: 0, aceptadosSinCambios: 0, aceptadosEditados: 1, rechazados: 0 });
  });
});

describe("aplicar la propuesta y la línea de balance", () => {
  const partida = (id: string, metrado: number): ItemPartida => ({ id, tipo: "partida", nivel: 1, codigo: "", descripcion: id.toUpperCase(), unidad: "M3", omniclass: "", rendimiento: 1, jornada: 8, componentes: [{ tipo: "insumo", id: "cem", cuadrilla: null, cantidad: 1 }], metrado, origenId: null });
  function plan() {
    const doc: PresupuestoDoc = documentoVacio();
    doc.insumos = { cem: { codigo: "", descripcion: "CEMENTO", unidad: "BOL", precio: 10, tipo: "MT", iu: "", omniclass: "" } };
    doc.subpresupuestos[0].items = [{ id: "t1", tipo: "titulo", nivel: 0, descripcion: "OBRA" }, partida("p1", 4), partida("p2", 4), partida("p3", 2)];
    const r = resolverPresupuesto(doc);
    const calculados = new Map<string, SubpresupuestoCalculado>(doc.subpresupuestos.map((sp) => [sp.id, calcularSubpresupuesto(sp, r, () => null)]));
    const prog: Programacion = { ...programacionVacia("2026-10-05"), calendario: { horasSemana: [8, 8, 8, 8, 8, 0, 0], jornada: 8, especiales: [] }, tareas: { p3: { predecesoras: [{ id: "p1", tipo: "FC", desfase: 0 }] } } };
    return { doc, calculados, edt: edtDesdePresupuesto(doc, prog) };
  }

  it("crea los paquetes de la ruta dentro del alcance, mueve, enlaza y descarta los ciclos", () => {
    const { edt } = plan();
    const r = aplicarPrograma(
      edt,
      "t1",
      [
        { id: "p1", paquete: ["CIMENTACIÓN"], predecesoras: [{ id: "p3", tipo: "FC", desfase: 0 }] }, // p3 already follows p1: loop
        { id: "p2", paquete: ["ESTRUCTURA", "PISO 1"], predecesoras: [{ id: "p1", tipo: "FC", desfase: 2 }] },
        { id: "p3", paquete: null, predecesoras: [{ id: "p2", tipo: "CC", desfase: 0 }] },
      ],
      false
    );
    assert.deepEqual([r.movidas, r.enlaces, r.descartados], [2, 2, 1]);
    const nodos = r.prog.edt!.filter((n) => n.padre === "t1" || r.prog.edt!.some((m) => m.padre === "t1" && m.id === n.padre));
    assert.deepEqual(nodos.map((n) => n.nombre), ["CIMENTACIÓN", "ESTRUCTURA", "PISO 1"]);
    const a = new Map(r.prog.actividades!.map((x) => [x.id, x]));
    assert.equal(a.get("p3")!.nodo, "t1");
    assert.deepEqual(a.get("p3")!.predecesoras, [
      { id: "p1", tipo: "FC", desfase: 0 },
      { id: "p2", tipo: "CC", desfase: 0 },
    ]);
    // Replacing: p3 keeps only what was proposed.
    const otra = aplicarPrograma(edt, "t1", [{ id: "p3", paquete: null, predecesoras: [{ id: "p2", tipo: "FC", desfase: 0 }] }], true);
    assert.deepEqual(otra.prog.actividades!.find((x) => x.id === "p3")!.predecesoras, [{ id: "p2", tipo: "FC", desfase: 0 }]);
  });

  it("la línea de balance: cada trabajo con sus fechas en cada piso", () => {
    const { doc, calculados, edt } = plan();
    const d = dividirPorUbicacion(edt, {
      partidas: [
        { id: "p1", descripcion: "COLUMNAS" },
        { id: "p2", descripcion: "PLACA" },
      ],
      ubicaciones: [
        { valor: "PISO 1", pcts: { p1: 50, p2: 50 } },
        { valor: "PISO 2", pcts: { p1: 50, p2: 50 } },
      ],
      columna: "nivel",
      padre: "t1",
      nodoPorUbicacion: true,
      enCadaUbicacion: { desfase: 0 },
      entreUbicaciones: { desfase: 0 },
    });
    const lb = lineaDeBalance(programar(doc, calculados, d.prog));
    assert.deepEqual(lb.ubicaciones.map((u) => u.nombre), ["PISO 1", "PISO 2"]);
    assert.deepEqual(
      lb.trabajos.map((t) => [t.nombre, t.tramos.map((x) => [x.ubicacion, x.inicio, x.fin])]),
      [
        ["P1", [[0, "2026-10-05", "2026-10-06"], [1, "2026-10-07", "2026-10-08"]]],
        ["P2", [[0, "2026-10-07", "2026-10-08"], [1, "2026-10-09", "2026-10-12"]]],
      ]
    );
  });
});
