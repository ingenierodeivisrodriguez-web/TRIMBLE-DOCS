import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Actuante,
  administradoresDe,
  asignacionVigente,
  esCorreo,
  estadoAsignacion,
  permisosVigentes,
  puedeCambiarAsignacion,
  revisarAsignacion,
  revisarRol,
  revisarUsuarioEmpresa,
  superaCupoUsuarios,
} from "./accesos";
import { Asignacion, CambioAsignacion, Rol, UsuarioEmpresa } from "./types";

const HOY = "2026-10-20";
const rol = (id: string, extra: Partial<Rol> = {}): Rol => ({ id, clave: id, nombre: id, descripcion: "", sistema: true, activo: true, permisos: ["panel.ver"], version: 1, ...extra });
const persona = (userId: string, extra: Partial<UsuarioEmpresa> = {}): UsuarioEmpresa => ({
  id: `u-${userId}`,
  userId,
  email: `${userId}@obra.co`,
  nombre: userId,
  adminEmpresa: false,
  activo: true,
  version: 1,
  otorgadoPor: "x",
  ...extra,
});
const acceso = (userId: string, extra: Partial<Asignacion> = {}): Asignacion => ({
  projectId: "p1",
  userId,
  nombre: userId,
  email: `${userId}@obra.co`,
  rolId: "residente",
  adminProyecto: false,
  desde: "2026-01-01",
  hasta: null,
  activo: true,
  version: 1,
  otorgadoPor: "x",
  ...extra,
});

const roles = [rol("director", { permisos: ["panel.ver", "cantidades.aprobar"] }), rol("residente"), rol("viejo", { activo: false, sistema: false })];
const usuarios = [persona("ana", { adminEmpresa: true }), persona("luis"), persona("marta"), persona("pedro", { activo: false })];
const asignaciones = [acceso("luis", { adminProyecto: true }), acceso("marta"), acceso("pedro")];
const datos = { roles, usuarios, asignaciones };
const ana: Actuante = { actorId: "ana", adminEmpresa: true, adminProyecto: false, hoy: HOY };
const luis: Actuante = { actorId: "luis", adminEmpresa: false, adminProyecto: true, hoy: HOY };
const marta: Actuante = { actorId: "marta", adminEmpresa: false, adminProyecto: false, hoy: HOY };
const cambio = (extra: Partial<CambioAsignacion>): CambioAsignacion => ({ userId: "sofia", rolId: "residente", adminProyecto: false, desde: HOY, hasta: null, activo: true, version: 0, ...extra });

describe("estado de un acceso", () => {
  it("vigente entre sus fechas, programada antes, vencida después, revocada si no está activo", () => {
    assert.equal(estadoAsignacion(acceso("a"), HOY), "vigente");
    assert.equal(estadoAsignacion(acceso("a", { desde: "2026-11-01" }), HOY), "programada");
    assert.equal(estadoAsignacion(acceso("a", { hasta: "2026-10-19" }), HOY), "vencida");
    assert.equal(estadoAsignacion(acceso("a", { hasta: HOY }), HOY), "vigente", "el último día sirve");
    assert.equal(estadoAsignacion(acceso("a", { activo: false }), HOY), "revocada");
  });

  it("una persona desactivada en la empresa no tiene acceso aunque su asignación siga vigente", () => {
    assert.equal(asignacionVigente("pedro", asignaciones, usuarios, HOY), null);
    assert.deepEqual(permisosVigentes("pedro", asignaciones, usuarios, roles, HOY), []);
    assert.deepEqual(permisosVigentes("marta", asignaciones, usuarios, roles, HOY), ["panel.ver"]);
  });

  it("un rol desactivado deja sin permisos", () => {
    assert.deepEqual(permisosVigentes("marta", [acceso("marta", { rolId: "viejo" })], usuarios, roles, HOY), []);
  });
});

describe("dar, cambiar y revocar accesos", () => {
  it("solo los administradores de la empresa o del proyecto dan accesos", () => {
    assert.equal(revisarAsignacion(marta, datos, cambio({})), "no-admin");
    assert.equal(revisarAsignacion(ana, datos, cambio({})), null);
    assert.equal(revisarAsignacion(luis, datos, cambio({})), null);
  });

  it("nadie cambia su propio acceso", () => {
    assert.equal(revisarAsignacion(ana, datos, cambio({ userId: "ana" })), "propio");
    assert.equal(revisarAsignacion(luis, datos, cambio({ userId: "luis", version: 1 })), "propio");
  });

  it("el administrador de proyecto no nombra administradores ni cambia a otro administrador de proyecto", () => {
    assert.equal(revisarAsignacion(luis, datos, cambio({ adminProyecto: true })), "solo-admin-empresa");
    const conOtroAdmin = { ...datos, asignaciones: [...asignaciones, acceso("raul", { adminProyecto: true })] };
    assert.equal(revisarAsignacion(luis, conOtroAdmin, cambio({ userId: "raul", version: 1 })), "es-administrador");
  });

  it("pero sí le da un rol operativo a la administradora de la empresa (ella no se lo da a sí misma)", () => {
    assert.equal(revisarAsignacion(luis, datos, cambio({ userId: "ana", rolId: "director" })), null);
    assert.equal(puedeCambiarAsignacion(luis, acceso("ana")), true);
    assert.equal(puedeCambiarAsignacion(luis, acceso("raul", { adminProyecto: true })), false);
    assert.equal(puedeCambiarAsignacion(ana, acceso("ana")), false);
  });

  it("rol desactivado, persona desactivada, fechas al revés y versión vieja se rechazan", () => {
    assert.equal(revisarAsignacion(ana, datos, cambio({ rolId: "viejo" })), "rol-no-valido");
    assert.equal(revisarAsignacion(ana, datos, cambio({ rolId: "otro" })), "rol-no-valido");
    assert.equal(revisarAsignacion(ana, datos, cambio({ userId: "pedro", version: 1 })), "usuario-inactivo");
    assert.equal(revisarAsignacion(ana, datos, cambio({ hasta: "2026-01-01" })), "datos");
    assert.equal(revisarAsignacion(ana, datos, cambio({ userId: "marta", version: 0 })), "version-conflict");
  });

  it("el cupo de personas de la licencia cuenta solo a las activas", () => {
    assert.equal(superaCupoUsuarios(usuarios, "sofia", 3), true);
    assert.equal(superaCupoUsuarios(usuarios, "sofia", 4), false);
    assert.equal(superaCupoUsuarios(usuarios, "marta", 3), false, "quien ya está activa no suma");
  });
});

describe("roles y personas de la empresa", () => {
  it("solo la administración de la empresa crea o cambia roles", () => {
    const nuevo = { nombre: "Topógrafo", descripcion: "", permisos: ["panel.ver" as const], activo: true, version: 0 };
    assert.equal(revisarRol(luis, roles, new Set(), nuevo), "solo-admin-empresa");
    assert.equal(revisarRol(ana, roles, new Set(), nuevo), null);
  });

  it("nadie cambia el rol que tiene asignado, ni desactiva uno inicial, ni repite nombre", () => {
    const director = { id: "director", nombre: "director", descripcion: "", permisos: ["panel.ver" as const], activo: true, version: 1 };
    assert.equal(revisarRol(ana, roles, new Set(["director"]), director), "propio");
    assert.equal(revisarRol(ana, roles, new Set(), { ...director, activo: false }), "rol-protegido");
    assert.equal(revisarRol(ana, roles, new Set(), { nombre: "RESIDENTE", descripcion: "", permisos: [], activo: true, version: 0 }), "nombre-repetido");
    assert.equal(revisarRol(ana, roles, new Set(), { nombre: "X", descripcion: "", permisos: ["panel.borrar" as never], activo: true, version: 0 }), "datos");
  });

  it("desactivar personas: no a sí mismo ni a un administrador de la empresa", () => {
    assert.equal(revisarUsuarioEmpresa(ana, usuarios, "u-marta", false, 1), null);
    assert.equal(revisarUsuarioEmpresa(ana, usuarios, "u-ana", false, 1), "propio");
    assert.equal(revisarUsuarioEmpresa(ana, [...usuarios, persona("eva", { adminEmpresa: true })], "u-eva", false, 1), "es-administrador");
    assert.equal(revisarUsuarioEmpresa(luis, usuarios, "u-marta", false, 1), "solo-admin-empresa");
    assert.equal(revisarUsuarioEmpresa(ana, usuarios, "u-marta", false, 7), "version-conflict");
  });

  it("a quién pedir acceso: administradores de la empresa y del proyecto vigentes", () => {
    assert.deepEqual(administradoresDe(usuarios, asignaciones, HOY), ["ana", "luis"]);
  });

  it("correo válido", () => {
    assert.ok(esCorreo("ana@obra.co"));
    assert.ok(!esCorreo("ana@obra"));
    assert.ok(!esCorreo("ana obra.co"));
  });
});
