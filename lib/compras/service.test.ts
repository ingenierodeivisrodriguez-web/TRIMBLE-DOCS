import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Caller, ServiceError } from "../propiedades/service";
import type { ProjectContacts } from "../propiedades/types";
import { activar, Ctx, getAccesos, getAuditoria, getContactos, getEstado, getInsumos, guardarRol, guardarUsuario } from "./service";
import { LecturaPresupuesto, memoriaLectura } from "./presupuestoLectura";
import { ComprasStore, memoryStore } from "./store";
import { PERMISOS_VALIDOS, Rol } from "./types";

const OBRA = "obra1";
const HOY = "2026-10-16";

const ana: Caller = { id: "ana", name: "Ana Gómez (ana@obra.co)", isAdmin: true };
const jorge: Caller = { id: "jorge", name: "Jorge Ruiz", isAdmin: true };
const luis: Caller = { id: "luis", name: "Luis Pérez", isAdmin: false };
const marta: Caller = { id: "marta", name: "Marta Díaz", isAdmin: false };

const EQUIPO: ProjectContacts = {
  users: [
    { id: "ana", name: "Ana Gómez", email: "ana@obra.co", pending: false },
    { id: "jorge", name: "Jorge Ruiz", email: "jorge@obra.co", pending: false },
    { id: "luis", name: "Luis Pérez", email: "luis@obra.co", pending: false },
    { id: "marta", name: "Marta Díaz", email: "marta@obra.co", pending: false },
  ],
  groups: [{ id: "g1", name: "Obra", usersCount: 4 }],
};

function ctx(store: ComprasStore, caller: Caller, projectId = OBRA, presupuesto: LecturaPresupuesto = memoriaLectura()): Ctx {
  return { projectId, caller, store, presupuesto, hoy: HOY, deps: { contactos: async () => EQUIPO } };
}

async function rejects(promise: Promise<unknown>, status: number, code?: string) {
  await assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof ServiceError, String(err));
    assert.equal(err.status, status, err.message);
    if (code) assert.equal(err.code, code);
    return true;
  });
}

/** A project where Ana turned Compras on. */
async function activado() {
  const store = memoryStore(() => HOY);
  await activar(ctx(store, ana));
  const { roles } = await getAccesos(ctx(store, ana));
  const rol = (clave: string) => roles.find((r) => r.clave === clave) as Rol;
  const dar = (caller: Caller, userId: string, clave: string, extra = {}) =>
    guardarUsuario(ctx(store, caller), { userId, rolId: rol(clave).id, desde: HOY, hasta: null, activo: true, version: 0, ...extra });
  return { store, rol, dar };
}

describe("ingreso y activación", () => {
  it("en un proyecto sin activar nadie entra; solo un administrador de Trimble puede activarlo", async () => {
    const store = memoryStore(() => HOY);
    const e = await getEstado(ctx(store, luis));
    assert.equal(e.activo, false);
    assert.equal(e.acceso, null);
    assert.equal(e.puedeActivar, false);
    assert.equal((await getEstado(ctx(store, ana))).puedeActivar, true);
    await rejects(activar(ctx(store, luis)), 403, "no-admin-trimble");
  });

  it("quien activa queda como Administrador de plataforma con todos los permisos y nadie más entra", async () => {
    const store = memoryStore(() => HOY);
    const e = await activar(ctx(store, ana));
    assert.equal(e.activo, true);
    assert.equal(e.acceso?.rol.nombre, "Administrador de plataforma");
    assert.equal(e.acceso?.permisos.length, PERMISOS_VALIDOS.length);
    assert.deepEqual(e.administradores, ["Ana Gómez"]);
    // Being an administrator in Trimble is not enough once Compras is on.
    const j = await getEstado(ctx(store, jorge));
    assert.equal(j.acceso, null);
    assert.equal(j.puedeActivar, false);
    await rejects(activar(ctx(store, jorge)), 409, "ya-activo");
    await rejects(getAccesos(ctx(store, jorge)), 403, "sin-acceso");
  });

  it("los intentos sin acceso quedan en la auditoría", async () => {
    const store = memoryStore(() => HOY);
    await getEstado(ctx(store, luis));
    await rejects(activar(ctx(store, luis)), 403);
    await activar(ctx(store, ana));
    await rejects(getAccesos(ctx(store, luis)), 403, "sin-acceso");
    const entradas = (await getAuditoria(ctx(store, ana), new URLSearchParams())).entradas;
    assert.deepEqual(
      entradas.map((e) => [e.accion, e.actorId, e.resultado]),
      [
        ["accesos.consultar", "luis", "denegado"],
        ["proyecto.activar", "ana", "ok"],
        ["proyecto.activar", "luis", "denegado"],
        ["ingreso", "luis", "denegado"],
      ]
    );
    const soloDenegados = await getAuditoria(ctx(store, ana), new URLSearchParams({ resultado: "denegado" }));
    assert.equal(soloDenegados.entradas.length, 3);
  });
});

describe("dar, cambiar y revocar accesos", () => {
  it("el acceso dado vale de inmediato y su revocación también", async () => {
    const { store, rol, dar } = await activado();
    const r = await dar(ana, "luis", "residente");
    const asignado = r.usuarios.find((u) => u.userId === "luis")!;
    assert.equal(asignado.nombre, "Luis Pérez");
    assert.equal(asignado.email, "luis@obra.co");
    assert.equal(asignado.otorgadoPor, ana.name);
    assert.equal((await getEstado(ctx(store, luis))).acceso?.rol.nombre, "Residente");
    // A Residente doesn't see the accesses.
    await rejects(getAccesos(ctx(store, luis)), 403, "sin-permiso");

    await guardarUsuario(ctx(store, ana), { userId: "luis", rolId: rol("residente").id, desde: HOY, hasta: null, activo: false, version: 1 });
    assert.equal((await getEstado(ctx(store, luis))).acceso, null);
    await rejects(getAccesos(ctx(store, luis)), 403, "sin-acceso");
  });

  it("un acceso con fecha de inicio futura todavía no deja entrar", async () => {
    const { store, dar } = await activado();
    await dar(ana, "luis", "residente", { desde: "2026-11-01" });
    assert.equal((await getEstado(ctx(store, luis))).acceso, null);
  });

  it("solo se dan accesos a personas del equipo del proyecto", async () => {
    const { dar } = await activado();
    await rejects(dar(ana, "externo", "residente"), 400, "no-miembro");
  });

  it("nadie se cambia a sí mismo ni sube de nivel, y queda en la auditoría", async () => {
    const { store, rol, dar } = await activado();
    await rejects(dar(ana, "ana", "director", { version: 1 }), 403, "propio");
    // Marta manages accesses with a role smaller than the Director's.
    await guardarRol(ctx(store, ana), { nombre: "Gestor de accesos", descripcion: "", permisos: ["accesos.ver", "accesos.administrar", "insumos.ver"], activo: true, version: 0 });
    await dar(ana, "marta", "director");
    const gestor = (await getAccesos(ctx(store, ana))).roles.find((r) => r.nombre === "Gestor de accesos")!;
    await guardarUsuario(ctx(store, ana), { userId: "marta", rolId: gestor.id, desde: HOY, hasta: null, activo: true, version: 1 });
    await rejects(dar(marta, "luis", "director"), 403, "escalamiento");
    await rejects(guardarUsuario(ctx(store, marta), { userId: "ana", rolId: rol("residente").id, desde: HOY, hasta: null, activo: false, version: 1 }), 403, "escalamiento");
    await rejects(guardarRol(ctx(store, marta), { id: gestor.id, nombre: "Gestor de accesos", descripcion: "", permisos: [...gestor.permisos, "panel.ver"], activo: true, version: 1 }), 403);
    const denegados = (await getAuditoria(ctx(store, ana), new URLSearchParams({ resultado: "denegado" }))).entradas;
    assert.deepEqual(denegados.map((e) => e.detalle.motivo), ["propio", "escalamiento", "escalamiento", "propio"]);
  });

  it("guardar sobre un cambio de otra persona es un conflicto de versión", async () => {
    const { store, rol, dar } = await activado();
    await dar(ana, "luis", "residente");
    await rejects(guardarUsuario(ctx(store, ana), { userId: "luis", rolId: rol("compras").id, desde: HOY, hasta: null, activo: true, version: 0 }), 409, "version-conflict");
  });

  it("no se puede dejar el proyecto sin Administrador de plataforma", async () => {
    const { store, rol, dar } = await activado();
    await dar(ana, "jorge", "admin_plataforma");
    await guardarUsuario(ctx(store, jorge), { userId: "ana", rolId: rol("admin_plataforma").id, desde: HOY, hasta: null, activo: false, version: 1 });
    // Jorge is now the only one: nobody can take that away (and he can't change himself).
    await rejects(guardarUsuario(ctx(store, jorge), { userId: "jorge", rolId: rol("admin_plataforma").id, desde: HOY, hasta: HOY, activo: true, version: 1 }), 403, "propio");
  });

  it("la lista de contactos es solo para quien administra accesos y no trae grupos", async () => {
    const { store, dar } = await activado();
    await dar(ana, "luis", "director");
    await rejects(getContactos(ctx(store, luis)), 403, "sin-permiso");
    const c = await getContactos(ctx(store, ana));
    assert.equal(c.users.length, 4);
    assert.deepEqual(c.groups, []);
  });
});

describe("roles", () => {
  it("se crean roles nuevos, no se repiten nombres y la matriz del administrador no cambia", async () => {
    const { store, rol } = await activado();
    const r = await guardarRol(ctx(store, ana), { nombre: "Interventoría", descripcion: "Consulta", permisos: ["insumos.ver", "panel.ver"], activo: true, version: 0 });
    const nuevo = r.roles.find((x) => x.nombre === "Interventoría")!;
    assert.equal(nuevo.sistema, false);
    assert.match(nuevo.clave, /^personal_/);
    await rejects(guardarRol(ctx(store, ana), { nombre: "interventoría", descripcion: "", permisos: [], activo: true, version: 0 }), 409, "nombre-repetido");
    await rejects(guardarRol(ctx(store, ana), { id: rol("admin_plataforma").id, nombre: "Admin", descripcion: "", permisos: [], activo: true, version: 1 }), 403, "rol-protegido");
    await rejects(guardarRol(ctx(store, ana), { nombre: "X", descripcion: "", permisos: ["panel.borrar"], activo: true, version: 0 } as never), 400);
  });

  it("desactivar un rol creado quita el acceso a quienes lo tienen", async () => {
    const { store } = await activado();
    const r = await guardarRol(ctx(store, ana), { nombre: "Visitante", descripcion: "", permisos: ["insumos.ver"], activo: true, version: 0 });
    const visitante = r.roles.find((x) => x.nombre === "Visitante")!;
    await guardarUsuario(ctx(store, ana), { userId: "luis", rolId: visitante.id, desde: HOY, hasta: null, activo: true, version: 0 });
    assert.ok((await getEstado(ctx(store, luis))).acceso);
    await guardarRol(ctx(store, ana), { id: visitante.id, nombre: "Visitante", descripcion: "", permisos: ["insumos.ver"], activo: false, version: 1 });
    assert.equal((await getEstado(ctx(store, luis))).acceso, null);
  });
});

describe("insumos del presupuesto", () => {
  const documento = {
    data: {
      subpresupuestos: [
        {
          id: "sp1",
          nombre: "ESTRUCTURA",
          pie: [],
          items: [
            { id: "p1", tipo: "partida", nivel: 0, codigo: "", descripcion: "MURO", unidad: "M2", omniclass: "", rendimiento: 10, jornada: 8, metrado: 50, origenId: null, componentes: [{ tipo: "insumo", id: "blq", cuadrilla: null, cantidad: 12.5 }] },
          ],
        },
      ],
      insumos: { blq: { codigo: "MT-04", descripcion: "BLOQUE No. 5", unidad: "UND", precio: 2_100, tipo: "MT", iu: "", omniclass: "" } },
      subpartidas: {},
      gastos: { fijos: [], variables: [] },
    },
    version: 7,
    updatedAt: "2026-10-15T15:00:00Z",
    updatedBy: "Ana Gómez",
  };
  const lectura = memoriaLectura({ [OBRA]: { documento, mediciones: [{ itemId: "p1", campo: "Area", campoLabel: "Área", unidad: "M2" }], resumen: [{ itemId: "p1", elementos: 2, suma: 60 }] } });

  it("quien tiene Insumos: ver los consulta con el metrado del modelo y la versión del presupuesto", async () => {
    const { store, dar } = await activado();
    await dar(ana, "luis", "residente");
    const r = await getInsumos(ctx(store, luis, OBRA, lectura));
    assert.deepEqual(r.presupuesto, { version: 7, actualizado: "2026-10-15T15:00:00Z", actualizadoPor: "Ana Gómez" });
    assert.equal(r.insumos.length, 1);
    assert.equal(r.insumos[0].cantidad, 750); // 60 m2 from the model × 12.5
    assert.equal(r.insumos[0].monto, 1_575_000);
    assert.equal(r.insumos[0].via, "orden");
  });

  it("sin el permiso se niega y queda en la auditoría", async () => {
    const { store, dar } = await activado();
    await dar(ana, "luis", "juridica");
    await rejects(getInsumos(ctx(store, luis, OBRA, lectura)), 403, "sin-permiso");
    const ultima = (await getAuditoria(ctx(store, ana), new URLSearchParams())).entradas[0];
    assert.equal(ultima.accion, "insumos.consultar");
    assert.equal(ultima.resultado, "denegado");
  });

  it("un proyecto sin presupuesto guardado no tiene insumos", async () => {
    const { store } = await activado();
    const r = await getInsumos(ctx(store, ana, OBRA, memoriaLectura()));
    assert.equal(r.presupuesto, null);
    assert.deepEqual(r.insumos, []);
  });
});
