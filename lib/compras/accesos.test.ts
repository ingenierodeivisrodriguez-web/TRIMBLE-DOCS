import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { contenido, estadoAsignacion, permisosVigentes, puedeCambiar, quedaAdmin, revisarAsignacion, revisarRol, rolesAsignables } from "./accesos";
import { esPermisoValido, ROLES_INICIALES } from "./roles";
import { Asignacion, Permiso, PERMISOS_VALIDOS, Rol, ROL_ADMIN } from "./types";

const HOY = "2026-10-16";

function rol(id: string, clave: string, permisos: Permiso[], extra: Partial<Rol> = {}): Rol {
  return { id, clave, nombre: clave, descripcion: "", sistema: true, activo: true, permisos, version: 1, actualizado: null, actualizadoPor: null, ...extra };
}
function asig(userId: string, rolId: string, extra: Partial<Asignacion> = {}): Asignacion {
  return { userId, nombre: userId, email: "", rolId, desde: "2026-01-01", hasta: null, activo: true, version: 1, otorgadoPor: "", actualizado: null, actualizadoPor: null, ...extra };
}

const ADMIN = rol("r-admin", ROL_ADMIN, PERMISOS_VALIDOS);
const GESTOR = rol("r-gestor", "personal_gestor", ["accesos.ver", "accesos.administrar", "insumos.ver"], { sistema: false });
const RESIDENTE = rol("r-res", "residente", ["insumos.ver", "requisiciones.ver", "requisiciones.crear"]);
const LECTOR = rol("r-lector", "personal_lector", ["insumos.ver"], { sistema: false });
const VIEJO = rol("r-viejo", "personal_viejo", ["insumos.ver"], { sistema: false, activo: false });
const ROLES = [ADMIN, GESTOR, RESIDENTE, LECTOR, VIEJO];

const USUARIOS = [asig("ana", "r-admin"), asig("pedro", "r-gestor"), asig("luis", "r-res"), asig("marta", "r-lector")];

const ctxDe = (actorId: string, usuarios = USUARIOS) => ({
  actorId,
  misPermisos: permisosVigentes(actorId, usuarios, ROLES, HOY),
  roles: ROLES,
  usuarios,
  hoy: HOY,
});

describe("estado y permisos vigentes", () => {
  it("una asignación es vigente entre sus fechas, programada antes, vencida después y revocada si se desactivó", () => {
    assert.equal(estadoAsignacion({ activo: true, desde: "2026-10-16", hasta: "2026-10-16" }, HOY), "vigente");
    assert.equal(estadoAsignacion({ activo: true, desde: "2026-10-17", hasta: null }, HOY), "programada");
    assert.equal(estadoAsignacion({ activo: true, desde: "2026-01-01", hasta: "2026-10-15" }, HOY), "vencida");
    assert.equal(estadoAsignacion({ activo: false, desde: "2026-01-01", hasta: null }, HOY), "revocada");
  });

  it("se niega por defecto: sin asignación, revocada, vencida, programada o con rol desactivado no hay permisos", () => {
    assert.deepEqual(permisosVigentes("nadie", USUARIOS, ROLES, HOY), []);
    assert.deepEqual(permisosVigentes("x", [asig("x", "r-res", { activo: false })], ROLES, HOY), []);
    assert.deepEqual(permisosVigentes("x", [asig("x", "r-res", { hasta: "2026-10-01" })], ROLES, HOY), []);
    assert.deepEqual(permisosVigentes("x", [asig("x", "r-res", { desde: "2026-11-01" })], ROLES, HOY), []);
    assert.deepEqual(permisosVigentes("x", [asig("x", "r-viejo")], ROLES, HOY), []);
    assert.deepEqual(permisosVigentes("luis", USUARIOS, ROLES, HOY), RESIDENTE.permisos);
  });

  it("solo se pueden dar los roles activos con permisos que uno tiene", () => {
    const mios = permisosVigentes("pedro", USUARIOS, ROLES, HOY);
    assert.deepEqual(rolesAsignables(mios, ROLES).map((r) => r.id), ["r-gestor", "r-lector"]);
    assert.equal(rolesAsignables(PERMISOS_VALIDOS, ROLES).length, 4);
  });
});

describe("dar, cambiar y revocar accesos", () => {
  const cambio = (userId: string, rolId: string, extra = {}) => ({ userId, rolId, desde: HOY, hasta: null, activo: true, version: 0, ...extra });

  it("el administrador da un acceso nuevo", () => {
    assert.equal(revisarAsignacion(ctxDe("ana"), cambio("sofia", "r-res")), null);
  });

  it("quien no administra accesos no puede darlos", () => {
    assert.equal(revisarAsignacion(ctxDe("luis"), cambio("sofia", "r-res")), "sin-permiso");
  });

  it("nadie cambia su propio acceso", () => {
    assert.equal(revisarAsignacion(ctxDe("ana"), cambio("ana", "r-admin", { version: 1 })), "propio");
  });

  it("nadie da un rol con permisos que no tiene ni cambia a alguien con más permisos", () => {
    assert.equal(revisarAsignacion(ctxDe("pedro"), cambio("sofia", "r-res")), "escalamiento");
    assert.equal(revisarAsignacion(ctxDe("pedro"), cambio("ana", "r-lector", { activo: false, version: 1 })), "escalamiento");
    assert.equal(revisarAsignacion(ctxDe("pedro"), cambio("marta", "r-gestor", { version: 1 })), null);
  });

  it("no se da un rol desactivado, pero sí se puede revocar a quien lo tiene", () => {
    assert.equal(revisarAsignacion(ctxDe("ana"), cambio("sofia", "r-viejo")), "rol-no-valido");
    const usuarios = [...USUARIOS, asig("sofia", "r-viejo")];
    assert.equal(revisarAsignacion(ctxDe("ana", usuarios), cambio("sofia", "r-viejo", { activo: false, version: 1 })), null);
  });

  it("las fechas deben ser reales y la final no puede ir antes de la inicial", () => {
    assert.equal(revisarAsignacion(ctxDe("ana"), cambio("sofia", "r-res", { desde: "16-10-2026" })), "datos");
    assert.equal(revisarAsignacion(ctxDe("ana"), cambio("sofia", "r-res", { hasta: "2026-10-01" })), "datos");
  });

  it("guardar con una versión vieja es un conflicto", () => {
    assert.equal(revisarAsignacion(ctxDe("ana"), cambio("luis", "r-lector", { version: 0 })), "version-conflict");
    assert.equal(revisarAsignacion(ctxDe("ana"), cambio("sofia", "r-res", { version: 3 })), "version-conflict");
  });

  it("siempre queda un Administrador de plataforma vigente y sin fecha final", () => {
    const dos = [...USUARIOS, asig("jorge", "r-admin")];
    assert.equal(revisarAsignacion(ctxDe("ana", dos), cambio("jorge", "r-admin", { activo: false, version: 1 })), null);
    // Jorge can't revoke Ana if that leaves only a Jorge with an end date.
    const conFin = [asig("ana", "r-admin"), asig("jorge", "r-admin", { hasta: "2027-01-01" })];
    assert.equal(revisarAsignacion(ctxDe("jorge", conFin), cambio("ana", "r-admin", { activo: false, version: 1 })), "ultimo-admin");
    assert.equal(revisarAsignacion(ctxDe("jorge", conFin), cambio("ana", "r-admin", { hasta: "2027-01-01", version: 1 })), "ultimo-admin");
    assert.equal(quedaAdmin(USUARIOS, ROLES, HOY), true);
  });

  it("la pantalla solo ofrece cambiar a quien se puede", () => {
    const ctx = ctxDe("pedro");
    assert.equal(puedeCambiar(ctx, USUARIOS[0]), false); // Ana: more than Pedro
    assert.equal(puedeCambiar(ctx, USUARIOS[1]), false); // himself
    assert.equal(puedeCambiar(ctx, USUARIOS[3]), true); // Marta: lector
    assert.equal(puedeCambiar(ctxDe("luis"), USUARIOS[3]), false); // Luis doesn't administer
  });
});

describe("crear y cambiar roles", () => {
  const cambio = (extra = {}) => ({ nombre: "Interventoría", descripcion: "", permisos: ["insumos.ver"] as Permiso[], activo: true, version: 0, ...extra });

  it("el administrador crea un rol con permisos válidos", () => {
    assert.equal(revisarRol(ctxDe("ana"), cambio()), null);
    assert.equal(revisarRol(ctxDe("ana"), cambio({ permisos: ["panel.borrar"] })), "datos");
    assert.equal(revisarRol(ctxDe("ana"), cambio({ nombre: "  " })), "datos");
  });

  it("la matriz del administrador no se toca y los roles iniciales no se desactivan", () => {
    assert.equal(revisarRol(ctxDe("pedro"), cambio({ id: "r-admin", permisos: [], version: 1 })), "rol-protegido");
    assert.equal(revisarRol(ctxDe("ana"), cambio({ id: "r-res", activo: false, version: 1 })), "rol-protegido");
    assert.equal(revisarRol(ctxDe("ana"), cambio({ id: "r-res", permisos: ["insumos.ver"], version: 1 })), null);
  });

  it("nadie cambia el rol que tiene asignado ni da permisos que no tiene", () => {
    assert.equal(revisarRol(ctxDe("pedro"), cambio({ id: "r-gestor", permisos: ["accesos.ver"], version: 1 })), "propio");
    assert.equal(revisarRol(ctxDe("pedro"), cambio({ permisos: ["panel.ver"] })), "escalamiento");
    assert.equal(revisarRol(ctxDe("pedro"), cambio({ id: "r-res", permisos: ["insumos.ver"], version: 1 })), "escalamiento");
    assert.equal(revisarRol(ctxDe("pedro"), cambio({ id: "r-lector", permisos: [], version: 1 })), null);
  });
});

describe("roles iniciales y lista de permisos", () => {
  it("los nueve roles iniciales solo usan permisos válidos y el administrador los tiene todos", () => {
    assert.equal(ROLES_INICIALES.length, 9);
    for (const r of ROLES_INICIALES) {
      assert.ok(r.permisos.every(esPermisoValido), r.clave);
      assert.equal(new Set(r.permisos).size, r.permisos.length, `${r.clave} repite permisos`);
    }
    const admin = ROLES_INICIALES.find((r) => r.clave === ROL_ADMIN)!;
    assert.ok(contenido(PERMISOS_VALIDOS, admin.permisos));
    // Nobody but the administrator manages accesses at the start.
    assert.deepEqual(ROLES_INICIALES.filter((r) => r.permisos.includes("accesos.administrar")).map((r) => r.clave), [ROL_ADMIN]);
  });

  it("la lista de permisos de supabase/compras.sql es la misma de la app", () => {
    const sql = fs.readFileSync(path.join(__dirname, "../../supabase/compras.sql"), "utf8");
    const bloque = /compras_permisos_validos\(\)[\s\S]*?array\[([\s\S]*?)\]::text\[\]/.exec(sql);
    assert.ok(bloque, "no se encontró la lista en el SQL");
    const enSql = [...bloque[1].matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(enSql, PERMISOS_VALIDOS);
  });
});
