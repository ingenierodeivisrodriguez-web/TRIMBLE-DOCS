import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContratoCompras, memoriaCompras } from "../lecturas/compras";
import { ElementoPresupuesto, memoriaLectura } from "../lecturas/presupuesto";
import { Caller, ServiceError } from "../propiedades/service";
import type { ProjectContacts } from "../propiedades/types";
import {
  anularMedicion,
  Ctx,
  elementosMedibles,
  getAccesos,
  getBitacora,
  getEstado,
  getEstructura,
  getMediciones,
  guardarAdminEmpresa,
  guardarAsignacion,
  guardarConfig,
  guardarEmpresa,
  guardarMedicion,
  guardarNodo,
  pedirVista,
  propuestasUbicacion,
  registrarLicencia,
  tomarVista,
  vincular,
} from "./service";
import { memoryStore, ObraStore } from "./store";
import { CambioMedicion, GRUPOS_LICENCIA } from "./types";

const HOY = "2026-10-21";
const P = "proyA_001";
const persona = (id: string, isAdmin = false): Caller => ({ id, name: `${id[0].toUpperCase()}${id.slice(1)}`, isAdmin });
const EQUIPO: ProjectContacts = {
  users: ["tec", "ana", "rosa", "dario", "ines", "sofia"].map((id) => ({ id, name: `${id[0].toUpperCase()}${id.slice(1)}`, email: `${id}@obra.co`, pending: false })),
  groups: [],
};

// ---- the acceptance test's budget: 1.1 Muro en bloque No. 5, 500 m2, with SC-03 and the block
const DOC = {
  subpresupuestos: [
    {
      id: "sp1",
      nombre: "TORRE 1",
      pie: [],
      items: [
        { id: "t1", tipo: "titulo", nivel: 0, descripcion: "MAMPOSTERÍA" },
        { id: "p11", tipo: "partida", nivel: 1, codigo: "", descripcion: "Muro en bloque No. 5", unidad: "M2", omniclass: "", rendimiento: 12, jornada: 8, metrado: 500, origenId: null,
          componentes: [{ tipo: "insumo", id: "sc03", cuadrilla: null, cantidad: 1 }, { tipo: "insumo", id: "blq", cuadrilla: null, cantidad: 12.5 }] },
        { id: "p12", tipo: "partida", nivel: 1, codigo: "", descripcion: "Pañete", unidad: "M2", omniclass: "", rendimiento: 20, jornada: 8, metrado: 900, origenId: null,
          componentes: [{ tipo: "insumo", id: "blq", cuadrilla: null, cantidad: 1 }] },
      ],
    },
  ],
  insumos: {
    sc03: { codigo: "SC-03", descripcion: "Mano de obra muro", unidad: "M2", precio: 28000, tipo: "SC", iu: "", omniclass: "" },
    blq: { codigo: "MT-04", descripcion: "Bloque No. 5", unidad: "UND", precio: 2100, tipo: "MT", iu: "", omniclass: "" },
  },
  subpartidas: {},
  gastos: { fijos: [], variables: [] },
};
const guid = (i: number) => `0${String(i).padStart(2, "0")}MUROAAAAAAAAAAAAAAAAA`.slice(0, 22);
// 12 walls in Piso 2: eleven of 7 m2 and one of 6 m2.
const MUROS: ElementoPresupuesto[] = Array.from({ length: 12 }, (_, i) => ({ ifcGuid: guid(i + 1), modelId: "modA", cantidad: i < 11 ? 7 : 6, memoria: { niv: "Piso 2", tor: "Torre 1" } }));
const SUELTO: ElementoPresupuesto = { ifcGuid: guid(40), modelId: "modA", cantidad: 9, memoria: { niv: "Piso 3" } };
const CT1: ContratoCompras = {
  id: "c0000000-0000-4000-8000-000000000001", numero: 1, revision: 0, proveedorId: "pv1", proveedor: "Pedro Pérez", nit: "79123456-3", anticipoPct: 20, retencionGarantiaPct: 5, aprobada: null,
  lineas: [{ requisicionLineaId: "rl1", insumoId: "sc03", codigo: "SC-03", descripcion: "Mano de obra muro", unidad: "M2", tipo: "SC", cantidad: 500, precioUnitario: 28000, descuentoPct: 0, ivaPct: 0, partidaItemId: "p11" }],
};
const CT2: ContratoCompras = { ...CT1, id: "c0000000-0000-4000-8000-000000000002", numero: 2, proveedor: "Bloques SA", lineas: [{ ...CT1.lineas[0], insumoId: "blq", tipo: "MT", partidaItemId: null }] };

const lecturas = {
  presupuesto: memoriaLectura({
    [P]: {
      documento: { data: DOC, version: 7, updatedAt: "2026-10-01T12:00:00Z", updatedBy: "Ana" },
      elementos: { p11: [...MUROS, SUELTO] },
      columnas: [{ id: "niv", label: "Nivel", fuente: "modelo", clave: "Nivel" }, { id: "tor", label: "Torre", fuente: "modelo", clave: "Torre" }],
      programacion: { data: { edt: [{ id: "e1", padre: null, nombre: "Piso 3", responsable: "", ubicacion: [{ columna: "niv", valor: "Piso 3" }] }] }, version: 1 },
    },
  }),
  compras: memoriaCompras({ [P]: [CT1, CT2] }),
};

function ctx(store: ObraStore, id: string): Ctx {
  return { projectId: P, caller: persona(id, id === "ana"), esAdminTecnico: id === "tec", store, lecturas, hoy: HOY, deps: { contactos: async () => EQUIPO, projectName: async () => "Torres" } };
}

async function rechaza(promesa: Promise<unknown>, status: number, code: string, mensaje?: RegExp) {
  await assert.rejects(promesa, (err: unknown) => {
    assert.ok(err instanceof ServiceError, String(err));
    assert.equal(err.code, code, err.message);
    assert.equal(err.status, status, err.message);
    if (mensaje) assert.match(err.message, mensaje);
    return true;
  });
}

/** The project with its structure (Torre 1 › Piso 2, Torre 2 › Piso 2), tower and floor required, and people. */
async function montado() {
  const store = memoryStore(() => HOY);
  const t = ctx(store, "tec");
  const A = (await guardarEmpresa(t, { nombre: "Constructora A", nit: "", activa: true, version: 0 })).empresas[0].id;
  await registrarLicencia(t, { empresaId: A, evento: "activacion", plan: "Obra", desde: "2026-01-01", hasta: null, maxProyectos: 3, maxUsuarios: 10, grupos: GRUPOS_LICENCIA.map((g) => g.id), motivo: "", soporte: "" });
  await guardarAdminEmpresa(t, { empresaId: A, email: "ana@obra.co", nombre: "Ana", admin: true });
  await getEstado(ctx(store, "ana"));
  await vincular(ctx(store, "ana"), { empresaId: A });
  const roles = (await getAccesos(ctx(store, "ana"))).roles;
  for (const [userId, clave] of [["rosa", "residente"], ["dario", "director"], ["ines", "interventoria"]]) {
    await guardarAsignacion(ctx(store, "ana"), { userId, rolId: roles.find((r) => r.clave === clave)!.id, adminProyecto: false, desde: "2026-01-01", hasta: null, activo: true, version: 0 });
  }
  const nodo = async (nivelClave: string, valor: string, padreId: string | null = null) => {
    const r = await guardarNodo(ctx(store, "ana"), { nivelClave, valor, padreId, responsableId: null, responsableNombre: "", inicio: null, fin: null, estado: "activo", nota: "", version: 0 });
    return r.nodos.find((n) => n.nivelClave === nivelClave && n.valor === valor && n.padreId === padreId)!.id;
  };
  const T1 = await nodo("torre", "Torre 1");
  const T2 = await nodo("torre", "Torre 2");
  const T1P2 = await nodo("nivel", "Piso 2", T1);
  const T2P2 = await nodo("nivel", "Piso 2", T2);
  const config = (await getEstructura(ctx(store, "ana"))).config;
  await guardarConfig(ctx(store, "ana"), { ...config, ubicacionObligatoria: ["torre", "nivel"] });
  const ubic = { torre: T1, nivel: T1P2 };
  const delModelo = (extra: Partial<CambioMedicion> = {}, porcentajes: Record<number, number> = {}): CambioMedicion => ({
    partidaId: "p11",
    contratoId: CT1.id,
    ubicacion: ubic,
    fecha: "2026-10-15",
    origen: "modelo",
    observaciones: "",
    elementos: MUROS.map((m, i) => ({ modelId: m.modelId, versionId: "v3", ifcGuid: m.ifcGuid, nombre: `Muro ${i + 1}`, porcentaje: porcentajes[i + 1] ?? 100 })),
    lineas: [],
    version: 0,
    ...extra,
  });
  return { store, c: (id: string) => ctx(store, id), T1, T2, T1P2, T2P2, ubic, delModelo };
}

describe("mediciones de obra (servicio)", () => {
  it("el residente mide 80 m2 del Piso 2 desde el modelo (12 muros, uno al 50 %) con el contrato de Pedro Pérez", async () => {
    const { c, delModelo } = await montado();
    const r = await guardarMedicion(c("rosa"), delModelo({}, { 12: 50 }));
    const m = r.mediciones[0];
    assert.deepEqual([m.numero, m.partidaNumero, m.partidaDescripcion, m.cantidad, m.ubicacionTexto, m.contratoNumero, m.proveedor, m.estado], [1, "1.1", "Muro en bloque No. 5", 80, "Torre 1 · Piso 2", 1, "Pedro Pérez", "registrada"]);
    assert.deepEqual(m.elementos[11], { modelId: "modA", versionId: "v3", ifcGuid: guid(12), nombre: "Muro 12", porcentaje: 50, cantidadModelo: 6, cantidad: 3 });
    assert.deepEqual(r.contratos.map((x) => x.numero), [1, 2]);
    const b = (await getBitacora(c("ana"), new URLSearchParams())).entradas.find((e) => e.accion === "mediciones.crear")!;
    assert.deepEqual([b.objetoTipo, b.cambios.cantidad, b.cambios.contrato], ["medicion", 80, "CT-0001 Pedro Pérez"]);
  });

  it("y 15 m2 a mano de un antepecho no modelado, con memoria de cantidades", async () => {
    const { c, ubic } = await montado();
    const r = await guardarMedicion(c("rosa"), {
      partidaId: "p11", contratoId: CT1.id, ubicacion: ubic, fecha: "2026-10-15", origen: "manual", observaciones: "Antepecho fachada",
      elementos: [], lineas: [{ descripcion: "Antepecho", veces: 1, largo: 10, ancho: null, alto: 1.5 }], version: 0,
    });
    assert.deepEqual([r.mediciones[0].cantidad, r.mediciones[0].lineas[0].cantidad], [15, 15]);
  });

  it("el muro al 50 % se completa con otra medición, pero no pasa del 100 %; anulada, deja de contar", async () => {
    const { c, delModelo } = await montado();
    await guardarMedicion(c("rosa"), delModelo({}, { 12: 50 }));
    const resto = delModelo();
    resto.elementos = [{ ...resto.elementos[11], porcentaje: 50 }];
    const r = await guardarMedicion(c("rosa"), resto);
    const segunda = r.mediciones[0];
    assert.equal(segunda.cantidad, 3);
    const otraVez = { ...resto, elementos: [{ ...resto.elementos[0], porcentaje: 10 }] };
    await rechaza(guardarMedicion(c("rosa"), otraVez), 409, "supera-100", /Muro 12 \(110 %\)/);
    // The resident can't cancel (the director can), and a reason is required.
    await rechaza(anularMedicion(c("rosa"), { id: segunda.id, motivo: "Duplicada", version: 1 }), 403, "sin-permiso");
    await rechaza(anularMedicion(c("dario"), { id: segunda.id, motivo: " ", version: 1 }), 400, "motivo-requerido");
    await anularMedicion(c("dario"), { id: segunda.id, motivo: "Duplicada", version: 1 });
    await guardarMedicion(c("rosa"), otraVez);
  });

  it("solo mide desde el modelo lo asociado a la partida en Presupuesto, y la cantidad sale de allá, no del navegador", async () => {
    const { c, delModelo } = await montado();
    const ajeno = delModelo();
    ajeno.elementos = [{ modelId: "modA", versionId: null, ifcGuid: "3zzzzzzzzzzzzzzzzzzzzz", nombre: "Columna C3", porcentaje: 100 }];
    await rechaza(guardarMedicion(c("rosa"), ajeno), 400, "elemento-no-asociado", /Columna C3/);
    await rechaza(guardarMedicion(c("rosa"), delModelo({ partidaId: "p12", contratoId: null })), 400, "elemento-no-asociado");
  });

  it("revisa la partida, el contrato y la ubicación (niveles obligatorios y piso de esa torre)", async () => {
    const { c, delModelo, T1, T2 } = await montado();
    await rechaza(guardarMedicion(c("rosa"), delModelo({ partidaId: "no-existe" })), 400, "partida-no-valida");
    await rechaza(guardarMedicion(c("rosa"), delModelo({ contratoId: CT2.id })), 400, "contrato-no-valido");
    await rechaza(guardarMedicion(c("rosa"), delModelo({ ubicacion: { torre: T1 } })), 400, "ubicacion-no-valida", /debe indicar: Nivel/);
    const { T1P2 } = await montado();
    await rechaza(guardarMedicion(c("rosa"), delModelo({ ubicacion: { torre: T2, nivel: T1P2 } })), 400, "ubicacion-no-valida");
    await rechaza(guardarMedicion(c("rosa"), delModelo({ fecha: "2026-10-22" })), 400, "datos", /futura/);
    // Without a contract it is own crews' work.
    const r = await guardarMedicion(c("rosa"), delModelo({ contratoId: null }));
    assert.equal(r.mediciones[0].contratoId, null);
  });

  it("se edita mientras está registrada, con versión; la interventoría solo consulta y sin rol no se entra", async () => {
    const { c, delModelo } = await montado();
    const m = (await guardarMedicion(c("rosa"), delModelo({}, { 12: 50 }))).mediciones[0];
    const r = await guardarMedicion(c("rosa"), { ...delModelo({ fecha: "2026-10-14", observaciones: "Corregida" }, { 12: 100 }), id: m.id, version: 1 });
    assert.deepEqual([r.mediciones[0].cantidad, r.mediciones[0].version, r.mediciones[0].numero], [83, 2, 1]);
    await rechaza(guardarMedicion(c("rosa"), { ...delModelo(), id: m.id, version: 1 }), 409, "version-conflict");
    assert.equal((await getMediciones(c("ines"))).mediciones.length, 1);
    assert.equal((await getMediciones(c("ines"))).puede.crear, false);
    await rechaza(guardarMedicion(c("ines"), delModelo()), 403, "sin-permiso");
    await rechaza(getMediciones(c("sofia")), 403, "sin-acceso");
  });

  it("el visor sabe qué elementos se pueden medir, cuánto llevan y la ubicación que sugiere su memoria", async () => {
    const { c, delModelo, T1, T1P2 } = await montado();
    await guardarMedicion(c("rosa"), delModelo({}, { 12: 50 }));
    const r = await elementosMedibles(c("rosa"), { partidaId: "p11", ifcGuids: [guid(1), guid(12), "3zzzzzzzzzzzzzzzzzzzzz"] });
    assert.deepEqual(r.elementos.map((e) => [e.asociado, e.cantidadModelo, e.medido]), [[true, 7, 100], [true, 6, 50], [false, null, 0]]);
    assert.deepEqual(r.ubicacionComun, { torre: T1, nivel: T1P2 }, "las columnas Torre y Nivel de la memoria llevan a la estructura (Piso 2 de la Torre 1, no de la 2)");
    const mezcla = await elementosMedibles(c("rosa"), { partidaId: "p11", ifcGuids: [guid(1), guid(40)] });
    assert.equal(mezcla.ubicacionComun, null);
    assert.deepEqual(mezcla.ubicaciones, [{ texto: "Torre 1 · Piso 2", elementos: 1 }, { texto: "(sin ubicación en el modelo)", elementos: 1 }]);
  });

  it("la vista pedida desde el menú se toma una sola vez en el visor", async () => {
    const { c } = await montado();
    await pedirVista(c("rosa"), { partidaId: "p11", elementos: [{ modelId: "modA", ifcGuid: guid(1) }] });
    assert.deepEqual(await tomarVista(c("rosa")), { vista: { partidaId: "p11", elementos: [{ modelId: "modA", ifcGuid: guid(1) }] } });
    assert.deepEqual(await tomarVista(c("rosa")), { vista: null });
  });

  it("la EDT de la programación propone los valores de la estructura que faltan", async () => {
    const { c } = await montado();
    const r = await propuestasUbicacion(c("ana"));
    assert.deepEqual(r.propuestas.map((p) => [p.nivelClave, p.valor, p.existe]), [["nivel", "Piso 3", false]]);
    assert.equal(r.hayEdt, true);
    await rechaza(propuestasUbicacion(c("rosa")), 403, "no-admin");
  });
});
