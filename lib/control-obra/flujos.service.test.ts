import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Caller, ServiceError } from "../propiedades/service";
import type { ProjectContacts } from "../propiedades/types";
import { describirFlujo } from "./flujos";
import { Ctx, getAccesos, getBitacora, getEstado, getFlujos, guardarAdminEmpresa, guardarAsignacion, guardarEmpresa, guardarFlujo, registrarLicencia, vincular } from "./service";
import { memoryStore, ObraStore } from "./store";
import { GrupoLicencia, GRUPOS_LICENCIA } from "./types";

const HOY = "2026-10-21";
const P1 = "proyA_001";
const persona = (id: string, isAdmin = false): Caller => ({ id, name: `${id[0].toUpperCase()}${id.slice(1)}`, isAdmin });
const tec = persona("tec");
const ana = persona("ana", true);
const EQUIPO: ProjectContacts = {
  users: ["ana", "rosa", "dario", "ines", "alba", "sofia"].map((id) => ({ id, name: `${id[0].toUpperCase()}${id.slice(1)}`, email: `${id}@obra.co`, pending: false })),
  groups: [],
};

function ctx(store: ObraStore, caller: Caller): Ctx {
  return { projectId: P1, caller, esAdminTecnico: caller.id === "tec", store, hoy: HOY, deps: { contactos: async () => EQUIPO, projectName: async () => "Torres del Parque" } };
}

async function rechaza(promesa: Promise<unknown>, status: number, code: string) {
  await assert.rejects(promesa, (err: unknown) => {
    assert.ok(err instanceof ServiceError, String(err));
    assert.equal(err.code, code, err.message);
    assert.equal(err.status, status, err.message);
    return true;
  });
}

/** A company with its license, Ana as its administrator and the project registered; Rosa resident, Darío director, Inés inspection firm, Alba warehouse. */
async function montado(grupos: GrupoLicencia[] = GRUPOS_LICENCIA.map((g) => g.id)) {
  const store = memoryStore(() => HOY);
  const t = ctx(store, tec);
  const A = (await guardarEmpresa(t, { nombre: "Constructora A", nit: "", activa: true, version: 0 })).empresas[0].id;
  await registrarLicencia(t, { empresaId: A, evento: "activacion", plan: "Obra", desde: "2026-01-01", hasta: null, maxProyectos: 3, maxUsuarios: 10, grupos, motivo: "", soporte: "" });
  await guardarAdminEmpresa(t, { empresaId: A, email: "ana@obra.co", nombre: "Ana", admin: true });
  await getEstado(ctx(store, ana));
  await vincular(ctx(store, ana), { empresaId: A });
  const roles = (await getAccesos(ctx(store, ana))).roles;
  const rol = (clave: string) => roles.find((r) => r.clave === clave)!.id;
  for (const [userId, clave] of [["rosa", "residente"], ["dario", "director"], ["ines", "interventoria"], ["alba", "almacenista"]]) {
    await guardarAsignacion(ctx(store, ana), { userId, rolId: rol(clave), adminProyecto: false, desde: "2026-01-01", hasta: null, activo: true, version: 0 });
  }
  return { store, rol, c: (id: string) => ctx(store, persona(id)) };
}

describe("flujos de aprobación (servicio)", () => {
  it("una empresa nueva trae los roles de interventoría y almacenista", async () => {
    const { store } = await montado();
    const roles = (await getAccesos(ctx(store, ana))).roles;
    assert.equal(roles.length, 9);
    assert.ok(roles.some((r) => r.nombre === "Interventoría" && r.sistema));
    assert.ok(roles.some((r) => r.nombre === "Almacenista" && r.sistema));
  });

  it("el administrador ve un flujo por tipo de documento, sin configurar, con los sugeridos y quién tiene cada rol", async () => {
    const { store, rol } = await montado();
    const r = await getFlujos(ctx(store, ana));
    assert.deepEqual(r.flujos.map((f) => [f.tipo, f.pasos.length]), [["acta_cliente", 0], ["acta_subcontrato", 0], ["inspeccion", 0], ["cierre_nc", 0], ["vale_salida", 0]]);
    assert.equal(describirFlujo(r.sugeridos.acta_cliente!), "Residente de obra (elabora) → Director de proyecto (preaprueba) → Interventoría (aprueba)");
    assert.deepEqual(r.personasPorRol[rol("interventoria")], ["Ines"]);
    assert.equal(r.puedeEditar, true);
  });

  it("guarda el flujo residente → director → interventoría, con versión, y queda en la bitácora", async () => {
    const { store, rol } = await montado();
    const pasos = [{ nombre: "Elabora", rolId: rol("residente") }, { nombre: "Preaprueba", rolId: rol("director") }, { nombre: "Aprueba", rolId: rol("interventoria") }];
    const r = await guardarFlujo(ctx(store, ana), { tipo: "acta_cliente", pasos, version: 0 });
    const f = r.flujos.find((x) => x.tipo === "acta_cliente")!;
    assert.equal(f.version, 1);
    assert.deepEqual(f.pasos.map((p) => p.nombre), ["Elabora", "Preaprueba", "Aprueba"]);
    await rechaza(guardarFlujo(ctx(store, ana), { tipo: "acta_cliente", pasos, version: 0 }), 409, "version-conflict");
    const b = await getBitacora(ctx(store, ana), new URLSearchParams());
    assert.ok(b.entradas.some((e) => e.accion === "flujos.cambiar" && e.modulo === "actas_cliente" && e.resultado === "ok"));
  });

  it("rechaza un paso cuyo rol no tiene el permiso del módulo, con un mensaje que dice cuál", async () => {
    const { store, rol } = await montado();
    await assert.rejects(
      guardarFlujo(ctx(store, ana), { tipo: "acta_cliente", pasos: [{ nombre: "Elabora", rolId: rol("residente") }, { nombre: "Aprueba", rolId: rol("almacenista") }], version: 0 }),
      (err: unknown) => err instanceof ServiceError && err.code === "flujo-no-valido" && /Almacenista no tiene permiso de aprobar en actas al cliente/.test(err.message)
    );
  });

  it("solo los administradores configuran; el director consulta y la interventoría no ve esta pestaña", async () => {
    const { store, rol, c } = await montado();
    const pasos = [{ nombre: "Elabora", rolId: rol("residente") }, { nombre: "Aprueba", rolId: rol("director") }];
    await rechaza(guardarFlujo(c("dario"), { tipo: "acta_subcontrato", pasos, version: 0 }), 403, "no-admin");
    assert.equal((await getFlujos(c("dario"))).puedeEditar, false, "el director tiene accesos.ver");
    await rechaza(getFlujos(c("ines")), 403, "sin-permiso");
    const negados = (await getBitacora(ctx(store, ana), new URLSearchParams())).entradas.filter((e) => e.resultado === "denegado").map((e) => [e.actorId, e.accion]);
    assert.deepEqual(negados, [["ines", "flujos.consultar"], ["dario", "flujos.guardar"]]);
  });

  it("una persona del proyecto sin rol en Control de Obra recibe 403", async () => {
    const { c } = await montado();
    await rechaza(getFlujos(c("sofia")), 403, "sin-acceso");
    const e = await getEstado(c("sofia"));
    assert.equal(e.acceso, null);
  });

  it("sin el almacén en la licencia no aparece su flujo ni se puede guardar", async () => {
    const { store, rol } = await montado(["bim", "cantidades", "costos", "calidad", "documentos", "reportes"]);
    assert.ok(!(await getFlujos(ctx(store, ana))).flujos.some((f) => f.tipo === "vale_salida"));
    await rechaza(
      guardarFlujo(ctx(store, ana), { tipo: "vale_salida", pasos: [{ nombre: "Elabora", rolId: rol("almacenista") }, { nombre: "Aprueba", rolId: rol("residente") }], version: 0 }),
      403,
      "modulo-no-contratado"
    );
  });
});
