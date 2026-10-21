import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Caller, ServiceError } from "../propiedades/service";
import type { ProjectContacts } from "../propiedades/types";
import {
  Ctx,
  desvincular,
  getAccesos,
  getBitacora,
  getBitacoraAdmin,
  getContactos,
  getEmpresas,
  getEstado,
  getEstructura,
  guardarAdminEmpresa,
  guardarAsignacion,
  guardarConfig,
  guardarEmpresa,
  guardarNivel,
  guardarNodo,
  guardarRol,
  guardarUsuario,
  registrarLicencia,
  verificarBitacora,
  vincular,
} from "./service";
import { memoriaCompras } from "../lecturas/compras";
import { memoriaLectura } from "../lecturas/presupuesto";
import { memoryStore, ObraStore } from "./store";
import { GrupoLicencia } from "./types";

const HOY = "2026-10-20";
const P1 = "proyA_001";
const PB = "proyB_001";

const persona = (id: string, isAdmin = false): Caller => ({ id, name: `${id[0].toUpperCase()}${id.slice(1)} (${id}@obra.co)`, isAdmin });
const tec = persona("tec");
const ana = persona("ana", true);
const luis = persona("luis");
const marta = persona("marta");
const beto = persona("beto", true);

const equipo = (...ids: string[]): ProjectContacts => ({
  users: ids.map((id) => ({ id, name: `${id[0].toUpperCase()}${id.slice(1)}`, email: `${id}@obra.co`, pending: false })),
  groups: [],
});
const EQUIPOS: Record<string, ProjectContacts> = { [P1]: equipo("tec", "ana", "luis", "marta", "pedro", "sofia"), [PB]: equipo("beto", "marta") };

function ctx(store: ObraStore, caller: Caller, projectId = P1): Ctx {
  return {
    projectId,
    caller,
    esAdminTecnico: caller.id === "tec",
    store,
    lecturas: { presupuesto: memoriaLectura(), compras: memoriaCompras() },
    hoy: HOY,
    deps: { contactos: async () => EQUIPOS[projectId] ?? equipo(), projectName: async () => (projectId === P1 ? "Torres del Parque" : "Bodega") },
  };
}

async function rechaza(promesa: Promise<unknown>, status: number, code?: string) {
  await assert.rejects(promesa, (err: unknown) => {
    assert.ok(err instanceof ServiceError, String(err));
    assert.equal(err.status, status, err.message);
    if (code) assert.equal(err.code, code);
    return true;
  });
}

const TODOS: GrupoLicencia[] = ["bim", "cantidades", "costos", "calidad", "documentos", "reportes"];

/** Two companies with their licenses and administrators; Ana registered project 1 in A, Beto his project in B. */
async function montado() {
  const store = memoryStore(() => HOY);
  const t = ctx(store, tec);
  await guardarEmpresa(t, { nombre: "Constructora A", nit: "900123456-8", activa: true, version: 0 });
  let r = await guardarEmpresa(t, { nombre: "Constructora B", nit: "", activa: true, version: 0 });
  const A = r.empresas.find((e) => e.nombre === "Constructora A")!.id;
  const B = r.empresas.find((e) => e.nombre === "Constructora B")!.id;
  const licencia = (empresaId: string, grupos: GrupoLicencia[] = TODOS, extra = {}) =>
    registrarLicencia(t, { empresaId, evento: "activacion", plan: "Obra", desde: "2026-01-01", hasta: null, maxProyectos: 3, maxUsuarios: 6, grupos, motivo: "", soporte: "", ...extra });
  await licencia(A);
  await licencia(B);
  await guardarAdminEmpresa(t, { empresaId: A, email: "ana@obra.co", nombre: "Ana", admin: true });
  r = await guardarAdminEmpresa(t, { empresaId: B, email: "beto@obra.co", nombre: "Beto", admin: true });
  await getEstado(ctx(store, ana));
  await vincular(ctx(store, ana), { empresaId: A });
  await getEstado(ctx(store, beto, PB));
  await vincular(ctx(store, beto, PB), { empresaId: B });
  const roles = (await getAccesos(ctx(store, ana))).roles;
  const rol = (clave: string) => roles.find((x) => x.clave === clave)!.id;
  const dar = (quien: Caller, userId: string, clave: string, extra = {}) =>
    guardarAsignacion(ctx(store, quien), { userId, rolId: rol(clave), adminProyecto: false, desde: "2026-01-01", hasta: null, activo: true, version: 0, ...extra });
  return { store, A, B, licencia, rol, dar };
}

describe("administrador técnico", () => {
  it("solo los IDs de CONTROL_OBRA_ADMINS crean empresas y licencias; el intento queda en su bitácora", async () => {
    const store = memoryStore(() => HOY);
    await rechaza(guardarEmpresa(ctx(store, ana), { nombre: "X", nit: "", activa: true, version: 0 }), 403, "solo-admin-tecnico");
    await rechaza(getEmpresas(ctx(store, ana)), 403, "solo-admin-tecnico");
    const global = await getBitacoraAdmin(ctx(store, tec), new URLSearchParams());
    assert.deepEqual(
      global.entradas.map((e) => [e.actorId, e.accion, e.resultado]),
      [
        ["ana", "admin.consultar", "denegado"],
        ["ana", "empresa.guardar", "denegado"],
      ]
    );
  });

  it("una empresa nueva trae los 9 roles y la plantilla de niveles; el NIT se valida con su dígito", async () => {
    const { store, A } = await montado();
    const e = (await getEmpresas(ctx(store, tec))).empresas.find((x) => x.id === A)!;
    assert.equal(e.nit, "900123456");
    assert.equal(e.dv, 8);
    assert.equal(e.estadoLicencia, "sin-vencimiento");
    assert.deepEqual(e.administradores.map((u) => [u.email, u.userId]), [["ana@obra.co", "ana"]], "Ana quedó ligada al entrar");
    assert.equal((await getAccesos(ctx(store, ana))).roles.length, 9);
    await rechaza(guardarEmpresa(ctx(store, tec), { nombre: "Y", nit: "900123456-1", activa: true, version: 0 }), 400, "datos");
    await rechaza(guardarEmpresa(ctx(store, tec), { nombre: "Z", nit: "900123456-8", activa: true, version: 0 }), 409, "nit-repetido");
  });
});

describe("registro del proyecto en una empresa", () => {
  it("lo ofrece solo a quien administra una empresa y es ADMIN del proyecto en Trimble", async () => {
    const store = memoryStore(() => HOY);
    const t = ctx(store, tec);
    const A = (await guardarEmpresa(t, { nombre: "A", nit: "", activa: true, version: 0 })).empresas[0].id;
    await registrarLicencia(t, { empresaId: A, evento: "activacion", plan: "Obra", desde: "2026-01-01", hasta: null, maxProyectos: 1, maxUsuarios: 5, grupos: TODOS, motivo: "", soporte: "" });
    await guardarAdminEmpresa(t, { empresaId: A, email: "luis@obra.co", nombre: "Luis", admin: true });
    // Luis administers the company but isn't ADMIN of the project in Trimble.
    const e = await getEstado(ctx(store, luis));
    assert.deepEqual(e.puedeVincularA, []);
    await rechaza(vincular(ctx(store, luis), { empresaId: A }), 403, "no-admin-trimble");
    // Ana is ADMIN in Trimble, but not of the company.
    await rechaza(vincular(ctx(store, ana), { empresaId: A }), 403, "solo-admin-empresa");
    const conAdminTrimble = { ...luis, isAdmin: true };
    assert.deepEqual((await getEstado(ctx(store, conAdminTrimble))).puedeVincularA, [{ id: A, nombre: "A" }]);
    const hecho = await vincular(ctx(store, conAdminTrimble), { empresaId: A });
    assert.equal(hecho.empresa?.nombre, "A");
    assert.equal(hecho.adminEmpresa, true);
    // One project per company license: the second goes over the quota.
    await rechaza(vincular(ctx(store, { ...conAdminTrimble }, PB), { empresaId: A }), 409, "cupo-proyectos");
  });

  it("un proyecto ya registrado no se registra en otra empresa", async () => {
    const { store, B } = await montado();
    await rechaza(vincular(ctx(store, beto), { empresaId: B }), 409, "ya-vinculado");
  });

  it("retirarlo pide motivo y lo hace un administrador de la empresa que es ADMIN en Trimble", async () => {
    const { store, rol, dar } = await montado();
    await dar(ana, "luis", "residente", { adminProyecto: true });
    await rechaza(desvincular(ctx(store, ana), { motivo: "" }), 400, "motivo-requerido");
    await rechaza(desvincular(ctx(store, luis), { motivo: "x" }), 403, "solo-admin-empresa");
    const e = await desvincular(ctx(store, ana), { motivo: "Proyecto terminado" });
    assert.equal(e.empresa, null);
    assert.ok(rol("director"));
  });
});

describe("accesos", () => {
  it("sin acceso nadie entra (ser miembro en Trimble no basta) y el intento queda en la bitácora", async () => {
    const { store } = await montado();
    const e = await getEstado(ctx(store, luis));
    assert.equal(e.empresa?.nombre, "Constructora A");
    assert.equal(e.acceso, null);
    assert.deepEqual(e.administradores, ["Ana"]);
    await rechaza(getAccesos(ctx(store, luis)), 403, "sin-acceso");
    await rechaza(getEstructura(ctx(store, luis)), 403, "sin-acceso");
    const b = await getBitacora(ctx(store, ana), new URLSearchParams());
    assert.ok(b.entradas.some((x) => x.actorId === "luis" && x.accion === "ingreso" && x.resultado === "denegado"));
  });

  it("la administradora da accesos; nadie se da uno a sí mismo; el de proyecto le da su rol a ella", async () => {
    const { store, dar, rol } = await montado();
    await dar(ana, "luis", "residente", { adminProyecto: true });
    await rechaza(dar(ana, "ana", "director"), 403, "propio");
    await dar(luis, "ana", "director");
    const e = await getEstado(ctx(store, ana));
    assert.equal(e.acceso?.rol.nombre, "Director de proyecto");
    assert.ok(e.acceso?.permisos.includes("cantidades.aprobar"));
    await rechaza(dar(luis, "marta", "residente", { adminProyecto: true }), 403, "solo-admin-empresa");
    await rechaza(dar(luis, "noesmiembro", "residente"), 400, "no-miembro");
    await rechaza(guardarRol(ctx(store, ana), { id: rol("director"), nombre: "Director de proyecto", descripcion: "", permisos: ["panel.ver"], activo: true, version: 1 }), 403, "propio");
  });

  it("el cupo de personas de la licencia se respeta", async () => {
    const { dar } = await montado();
    // Ana (invited) counts; 6 allowed.
    for (const u of ["luis", "marta", "pedro", "sofia", "tec"]) await dar(ana, u, "residente");
    const { store, licencia, A } = await montado();
    await licencia(A, TODOS, { evento: "cambio", maxUsuarios: 2 });
    await guardarAsignacion(ctx(store, ana), { userId: "luis", rolId: (await getAccesos(ctx(store, ana))).roles[0].id, adminProyecto: false, desde: HOY, hasta: null, activo: true, version: 0 });
    await rechaza(
      guardarAsignacion(ctx(store, ana), { userId: "marta", rolId: (await getAccesos(ctx(store, ana))).roles[0].id, adminProyecto: false, desde: HOY, hasta: null, activo: true, version: 0 }),
      409,
      "cupo-usuarios"
    );
  });

  it("desactivar a una persona en la empresa corta su acceso en la siguiente petición", async () => {
    const { store, dar } = await montado();
    await dar(ana, "marta", "residente");
    assert.ok((await getEstado(ctx(store, marta))).acceso);
    const u = (await getAccesos(ctx(store, ana))).usuarios.find((x) => x.userId === "marta")!;
    await guardarUsuario(ctx(store, ana), { id: u.id, activo: false, version: u.version });
    assert.equal((await getEstado(ctx(store, marta))).acceso, null);
    await rechaza(getEstructura(ctx(store, marta)), 403, "sin-acceso");
  });
});

describe("acceso cruzado entre empresas", () => {
  it("una persona de la empresa A no lee, crea ni cambia nada de la empresa B", async () => {
    const { store, dar, rol } = await montado();
    await dar(ana, "marta", "residente");
    // Marta also belongs to B's project in Trimble, but has no access there.
    const enB = ctx(store, marta, PB);
    assert.equal((await getEstado(enB)).acceso, null);
    await rechaza(getAccesos(enB), 403, "sin-acceso");
    await rechaza(getEstructura(enB), 403, "sin-acceso");
    await rechaza(getBitacora(enB, new URLSearchParams()), 403, "sin-acceso");
    await rechaza(guardarNodo(enB, { nivelClave: "torre", valor: "Torre X", padreId: null, responsableId: null, responsableNombre: "", inicio: null, fin: null, estado: "activo", nota: "", version: 0 }), 403, "no-admin");
    // Not even with a role id of A sent straight to the API in B's project.
    await rechaza(guardarAsignacion(enB, { userId: "marta", rolId: rol("director"), adminProyecto: false, desde: HOY, hasta: null, activo: true, version: 0 }), 403, "no-admin");
  });

  it("la administradora de A no administra B ni registra en A el proyecto de B", async () => {
    const { store, rol, A } = await montado();
    const anaEnB = ctx(store, ana, PB);
    await rechaza(guardarAsignacion(anaEnB, { userId: "beto", rolId: rol("director"), adminProyecto: false, desde: HOY, hasta: null, activo: true, version: 0 }), 403, "no-admin");
    await rechaza(guardarRol(anaEnB, { nombre: "Intruso", descripcion: "", permisos: [], activo: true, version: 0 }), 403, "no-admin");
    await rechaza(vincular(anaEnB, { empresaId: A }), 409, "ya-vinculado");
    const deB = (await getAccesos(ctx(store, beto, PB))).roles;
    assert.ok(deB.every((r) => r.id !== rol("director")), "B tiene sus propios roles");
  });

  it("nadie cambia su licencia, su rol ni se nombra administrador llamando la API", async () => {
    const { store, A, dar } = await montado();
    await dar(ana, "marta", "residente");
    const m = ctx(store, marta);
    await rechaza(registrarLicencia(m, { empresaId: A, evento: "renovacion", plan: "Gratis", desde: HOY, hasta: null, maxProyectos: 99, maxUsuarios: 99, grupos: TODOS, motivo: "", soporte: "" }), 403, "solo-admin-tecnico");
    await rechaza(guardarAdminEmpresa(m, { empresaId: A, email: "marta@obra.co", nombre: "Marta", admin: true }), 403, "solo-admin-tecnico");
    await rechaza(guardarAsignacion(m, { userId: "marta", rolId: (await getAccesos(ctx(store, ana))).roles[0].id, adminProyecto: true, desde: HOY, hasta: null, activo: true, version: 1 }), 403, "no-admin");
    await rechaza(registrarLicencia(ctx(store, ana), { empresaId: A, evento: "renovacion", plan: "Gratis", desde: HOY, hasta: null, maxProyectos: 99, maxUsuarios: 99, grupos: TODOS, motivo: "", soporte: "" }), 403, "solo-admin-tecnico");
    const intentos = (await getBitacora(ctx(store, ana), new URLSearchParams("resultado=denegado"))).entradas.map((e) => e.accion);
    assert.ok(intentos.includes("accesos.guardar"), "el intento de Marta quedó en la bitácora de A");
  });
});

describe("licencia", () => {
  it("suspendida: nadie trabaja, ni la administradora; al reactivarla vuelve el acceso", async () => {
    const { store, licencia, A, dar } = await montado();
    await dar(ana, "luis", "residente", { adminProyecto: true });
    await licencia(A, TODOS, { evento: "suspension", motivo: "Mora" });
    const e = await getEstado(ctx(store, luis));
    assert.equal(e.licencia?.estado, "suspendida");
    assert.equal(e.adminProyecto, false);
    assert.equal(e.acceso, null);
    await rechaza(getAccesos(ctx(store, ana)), 403, "licencia-no-vigente");
    await licencia(A, TODOS, { evento: "reactivacion", motivo: "Pagó" });
    assert.ok((await getEstado(ctx(store, luis))).acceso);
  });

  it("un módulo que no vende la licencia no se abre, aunque el rol lo tenga", async () => {
    const { store, licencia, A, dar } = await montado();
    await dar(ana, "marta", "residente");
    await licencia(A, ["calidad"], { evento: "cambio" });
    const e = await getEstado(ctx(store, marta));
    assert.ok(!e.acceso?.permisos.some((p) => p.startsWith("estructura.") || p.startsWith("cantidades.")));
    assert.ok(e.acceso?.permisos.includes("lotes.crear"));
    await rechaza(getEstructura(ctx(store, marta)), 403, "modulo-no-contratado");
  });
});

describe("estructura de obra y configuración", () => {
  it("el administrador del proyecto crea valores con responsable; un residente solo consulta", async () => {
    const { store, dar } = await montado();
    await dar(ana, "luis", "residente", { adminProyecto: true });
    await dar(ana, "marta", "residente");
    const l = ctx(store, luis);
    let e = await guardarNodo(l, { nivelClave: "torre", valor: "Torre 1", padreId: null, responsableId: "marta", responsableNombre: "Marta", inicio: "2026-11-01", fin: "2027-06-30", estado: "activo", nota: "", version: 0 });
    const t1 = e.nodos.find((n) => n.valor === "Torre 1")!;
    e = await guardarNodo(l, { nivelClave: "nivel", valor: "Piso 5", padreId: t1.id, responsableId: null, responsableNombre: "", inicio: null, fin: null, estado: "activo", nota: "", version: 0 });
    assert.equal(e.nodos.length, 2);
    await rechaza(guardarNodo(l, { nivelClave: "torre", valor: "torre 1", padreId: null, responsableId: null, responsableNombre: "", inicio: null, fin: null, estado: "activo", nota: "", version: 0 }), 409, "valor-repetido");
    await rechaza(guardarNodo(l, { nivelClave: "torre", valor: "Torre 2", padreId: null, responsableId: "intruso", responsableNombre: "X", inicio: null, fin: null, estado: "activo", nota: "", version: 0 }), 400, "no-miembro");
    const m = ctx(store, marta);
    assert.equal((await getEstructura(m)).nodos.length, 2);
    await rechaza(guardarNodo(m, { nivelClave: "torre", valor: "Torre 3", padreId: null, responsableId: null, responsableNombre: "", inicio: null, fin: null, estado: "activo", nota: "", version: 0 }), 403, "no-admin");
  });

  it("la plantilla la cambia solo la administración de la empresa; el proyecto la reemplaza con su propio nivel", async () => {
    const { store, dar } = await montado();
    await dar(ana, "luis", "residente", { adminProyecto: true });
    const nivelNuevo = { clave: "bloque", nombre: "Bloque", orden: 8, padreClave: null, fuente: "manual" as const, claveFuente: "", activo: true, version: 0 };
    await rechaza(guardarNivel(ctx(store, luis), { ...nivelNuevo, plantilla: true }), 403, "solo-admin-empresa");
    const e = await guardarNivel(ctx(store, luis), { ...nivelNuevo, clave: "nivel", nombre: "Piso", orden: 5, padreClave: "torre", fuente: "propiedad", claveFuente: "attr-piso", plantilla: false });
    const piso = e.niveles.find((n) => n.clave === "nivel")!;
    assert.equal(piso.nombre, "Piso");
    assert.equal(piso.heredado, false);
    assert.equal(e.plantilla.find((n) => n.clave === "nivel")?.nombre, "Nivel", "la plantilla no cambió");
    await guardarNivel(ctx(store, ana), { ...nivelNuevo, plantilla: true });
    assert.ok((await getEstructura(ctx(store, ana))).niveles.some((n) => n.clave === "bloque" && n.heredado));
  });

  it("la configuración del proyecto lleva versión y su responsable técnico debe ser del proyecto", async () => {
    const { store } = await montado();
    const a = ctx(store, ana);
    const e = await guardarConfig(a, { responsableTecnicoId: "luis", responsableTecnicoNombre: "Luis", toleranciaVerificacionPct: 2.5, permiteAceptadoConObservaciones: false, version: 0 });
    assert.equal(e.config.version, 1);
    await rechaza(guardarConfig(a, { responsableTecnicoId: null, responsableTecnicoNombre: "", toleranciaVerificacionPct: 0, permiteAceptadoConObservaciones: true, version: 0 }), 409, "version-conflict");
    await rechaza(guardarConfig(a, { responsableTecnicoId: "beto", responsableTecnicoNombre: "Beto", toleranciaVerificacionPct: 0, permiteAceptadoConObservaciones: true, version: 1 }), 400, "no-miembro");
  });
});

describe("bitácora", () => {
  it("la administradora ve la de toda la empresa; con permiso de bitácora, solo la del proyecto; la cadena está íntegra", async () => {
    const { store, dar } = await montado();
    await dar(ana, "luis", "residente", { adminProyecto: true });
    await dar(luis, "ana", "director");
    await dar(ana, "marta", "auditor");
    const deAna = await getBitacora(ctx(store, ana), new URLSearchParams());
    assert.equal(deAna.todaLaEmpresa, true);
    assert.ok(deAna.entradas.some((e) => e.accion === "empresa.crear"), "incluye lo de la empresa (sin proyecto)");
    const deMarta = await getBitacora(ctx(store, marta), new URLSearchParams());
    assert.equal(deMarta.todaLaEmpresa, false);
    assert.ok(deMarta.entradas.every((e) => e.projectId === P1));
    await rechaza(getBitacora(ctx(store, luis), new URLSearchParams()), 403, "sin-permiso");
    const v = await verificarBitacora(ctx(store, marta));
    assert.equal(v.integra, true);
    assert.ok(v.filas > 8);
  });

  it("no guarda tokens ni secretos: solo quién, qué, sobre qué y el resultado", async () => {
    const { store, dar } = await montado();
    await dar(ana, "marta", "residente");
    const todo = JSON.stringify((await getBitacora(ctx(store, ana), new URLSearchParams())).entradas);
    assert.ok(!/token|bearer|secret|password/i.test(todo));
  });

  it("los contactos del proyecto los ven solo los administradores", async () => {
    const { store, dar } = await montado();
    await dar(ana, "marta", "residente");
    await rechaza(getContactos(ctx(store, marta)), 403, "no-admin");
    assert.equal((await getContactos(ctx(store, ana))).users.length, 6);
  });
});

describe("orden de la puesta en marcha", () => {
  it("nombrar un administrador pide antes la licencia (de ella sale el cupo de personas)", async () => {
    const store = memoryStore(() => HOY);
    const t = ctx(store, tec);
    const A = (await guardarEmpresa(t, { nombre: "A", nit: "", activa: true, version: 0 })).empresas[0].id;
    await rechaza(guardarAdminEmpresa(t, { empresaId: A, email: "ana@obra.co", nombre: "Ana", admin: true }), 403, "licencia-no-vigente");
  });
});
