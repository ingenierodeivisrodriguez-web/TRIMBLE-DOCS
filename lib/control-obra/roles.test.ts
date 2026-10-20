import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { esPermisoValido, ordenar, ROLES_INICIALES } from "./roles";
import { GRUPOS_LICENCIA, MODULOS, MODULOS_BASE, PERMISOS_VALIDOS } from "./types";

const sql = fs.readFileSync(path.join(__dirname, "../../supabase/control-obra.sql"), "utf8");

describe("roles iniciales y permisos", () => {
  it("hay 7 roles iniciales: los 5 del documento más responsable técnico y laboratorio", () => {
    assert.deepEqual(
      ROLES_INICIALES.map((r) => r.nombre),
      ["Director de proyecto", "Residente de obra", "Profesional de costos", "Inspector de calidad", "Auditor", "Responsable técnico de calidad", "Laboratorio"]
    );
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
    // Operational roles never administer accesses: that belongs to the administrators.
    assert.ok(ROLES_INICIALES.every((r) => !r.permisos.some((p) => p.startsWith("accesos.") && p !== "accesos.ver")));
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
