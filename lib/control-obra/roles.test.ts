import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { esPermisoValido, MODULOS_NUEVOS, ordenar, permisosSugeridos, ROLES_INICIALES } from "./roles";
import { GRUPOS_LICENCIA, MODULOS, MODULOS_BASE, Permiso, PERMISOS_VALIDOS, TIPOS_FLUJO } from "./types";

const sql = fs.readFileSync(path.join(__dirname, "../../supabase/control-obra.sql"), "utf8");

describe("roles iniciales y permisos", () => {
  it("hay 9 roles iniciales: los 5 del documento, responsable técnico, laboratorio, interventoría y almacenista", () => {
    assert.deepEqual(ROLES_INICIALES.map((r) => r.nombre), [
      "Director de proyecto",
      "Residente de obra",
      "Profesional de costos",
      "Inspector de calidad",
      "Auditor",
      "Responsable técnico de calidad",
      "Laboratorio",
      "Interventoría",
      "Almacenista",
    ]);
    for (const r of ROLES_INICIALES) {
      assert.ok(r.permisos.every(esPermisoValido), r.clave);
      assert.equal(new Set(r.permisos).size, r.permisos.length, `${r.clave} repite permisos`);
    }
  });

  it("la matriz sigue la aprobada en el diseño", () => {
    const de = (clave: string) => new Set(ROLES_INICIALES.find((r) => r.clave === clave)!.permisos);
    assert.ok(de("director").has("cantidades.aprobar"));
    assert.ok(de("residente").has("cantidades.crear"));
    assert.ok(!de("residente").has("cantidades.verificar"), "quien reporta no verifica");
    assert.ok(de("inspector").has("cantidades.verificar"));
    assert.ok(de("responsable_tecnico").has("criterios.aprobar"), "los criterios los aprueba el responsable técnico");
    assert.ok(!de("director").has("criterios.aprobar"));
    assert.ok(!de("laboratorio").has("costos.ver"));
    assert.ok(de("auditor").has("bitacora.exportar"));
    // The client's side approves the actas al cliente, but sees neither subcontracts, costs nor the warehouse.
    assert.ok(de("interventoria").has("actas_cliente.aprobar"));
    assert.ok(!de("interventoria").has("actas_cliente.crear"), "la interventoría aprueba, no elabora");
    assert.ok(![...de("interventoria")].some((p) => /^(actas_sub|costos|almacen)\./.test(p)));
    assert.ok(de("almacenista").has("almacen.crear"));
    assert.ok(!de("almacenista").has("almacen.aprobar"), "quien hace el vale no lo aprueba");
    assert.ok(de("residente").has("almacen.aprobar"));
    assert.ok(de("residente").has("actas_cliente.crear") && !de("residente").has("actas_cliente.aprobar"));
    assert.ok(de("director").has("actas_cliente.aprobar") && de("director").has("actas_sub.aprobar"));
    // Operational roles never administer accesses: that belongs to the administrators.
    assert.ok(ROLES_INICIALES.every((r) => !r.permisos.some((p) => p.startsWith("accesos.") && p !== "accesos.ver")));
  });

  it("a los roles iniciales que ya existían solo se les sugieren los permisos de los módulos nuevos", () => {
    const residente = ROLES_INICIALES.find((r) => r.clave === "residente")!;
    // A company created before the actas plan: without the new modules, and with one permission taken away by its administrator.
    const viejo = residente.permisos.filter((p) => !MODULOS_NUEVOS.includes(p.split(".")[0] as never));
    const sugeridos = permisosSugeridos({ clave: "residente", sistema: true, permisos: viejo.filter((p) => p !== "lotes.anular") });
    assert.deepEqual(ordenar(sugeridos), ordenar(residente.permisos.filter((p) => MODULOS_NUEVOS.includes(p.split(".")[0] as never))));
    assert.ok(!sugeridos.includes("lotes.anular" as Permiso), "lo que un administrador quitó no vuelve solo");
    assert.deepEqual(permisosSugeridos({ clave: "residente", sistema: true, permisos: residente.permisos }), []);
    assert.deepEqual(permisosSugeridos({ clave: "personal_x", sistema: false, permisos: [] }), []);
  });

  it("los roles nuevos que el SQL crea en las empresas existentes son los mismos de la app", () => {
    const bloque = /x\(clave, nombre, descripcion, permisos\)/.exec(sql);
    assert.ok(bloque, "no se encontró el bloque de roles nuevos en el SQL");
    const valores = sql.slice(sql.lastIndexOf("select * from (values", bloque.index), bloque.index);
    const filas = [...valores.matchAll(/\('([a-z_]+)', '([^']+)', '([^']+)',\s*array\[([^\]]*)\]\)/g)];
    assert.deepEqual(filas.map((f) => f[1]), ["interventoria", "almacenista"]);
    for (const f of filas) {
      const r = ROLES_INICIALES.find((x) => x.clave === f[1])!;
      assert.equal(f[2], r.nombre);
      assert.equal(f[3], r.descripcion);
      assert.deepEqual([...f[4].matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]), ordenar(r.permisos));
    }
  });

  it("los tipos de documento con flujo, su módulo y su acción inicial son los mismos en el SQL", () => {
    const tipos = /obra_tipos_flujo\(\)[\s\S]*?array\[([\s\S]*?)\]::text\[\]/.exec(sql);
    assert.ok(tipos);
    assert.deepEqual([...tipos[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), TIPOS_FLUJO.map((t) => t.id));
    const modulos = /obra_modulo_de_flujo\(p_tipo text\)[\s\S]*?select case p_tipo([\s\S]*?)end\s*\$\$/.exec(sql);
    assert.ok(modulos);
    const enSql = new Map([...modulos[1].matchAll(/when '([a-z_]+)' then '([a-z_]+)'/g)].map((m) => [m[1], m[2]]));
    for (const t of TIPOS_FLUJO) assert.equal(enSql.get(t.id), t.modulo, t.id);
    const inicial = /obra_accion_inicial_flujo\(p_tipo text\)[\s\S]*?select case p_tipo when '([a-z_]+)' then '([a-z]+)' else '([a-z]+)' end/.exec(sql);
    assert.ok(inicial);
    for (const t of TIPOS_FLUJO) assert.equal(t.accionInicial, t.id === inicial[1] ? inicial[2] : inicial[3], t.id);
  });

  it("ordenar deja los permisos en el orden de la matriz y sin repetidos", () => {
    assert.deepEqual(ordenar(["bitacora.ver", "panel.ver", "panel.ver", "inventado.x"]), ["panel.ver", "bitacora.ver"]);
  });

  it("la lista de permisos de supabase/control-obra.sql es la misma de la app", () => {
    const bloque = /obra_permisos_validos\(\)[\s\S]*?array\[([\s\S]*?)\]::text\[\]/.exec(sql);
    assert.ok(bloque, "no se encontró la lista en el SQL");
    assert.deepEqual([...bloque[1].matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]), PERMISOS_VALIDOS);
  });

  it("los grupos de la licencia y sus módulos son los mismos en el SQL", () => {
    const grupos = /obra_grupos_validos\(\)[\s\S]*?array\[([\s\S]*?)\]::text\[\]/.exec(sql);
    assert.ok(grupos);
    assert.deepEqual([...grupos[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]), GRUPOS_LICENCIA.map((g) => g.id));
    const caso = /obra_grupo_de_modulo\(p_modulo text\)[\s\S]*?select case([\s\S]*?)end\s*\$\$/.exec(sql);
    assert.ok(caso);
    const enSql = new Map<string, string>();
    for (const m of caso[1].matchAll(/when p_modulo (?:in \(([^)]*)\)|= '([a-z_]+)') then '([a-z_]+)'/g)) {
      const modulos = m[1] ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : [m[2]];
      for (const mod of modulos) enSql.set(mod, m[3]);
    }
    for (const m of MODULOS) {
      const grupo = GRUPOS_LICENCIA.find((g) => g.modulos.includes(m.id))?.id;
      assert.equal(enSql.get(m.id), grupo, m.id);
      if (!grupo) assert.ok(MODULOS_BASE.includes(m.id), `${m.id} debe venir con toda licencia`);
    }
  });
});
