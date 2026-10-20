import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estadoLicencia, licenciaPermiteTrabajar, licenciaVigente, modulosHabilitados, permisosContratados, revisarLicencia } from "./licencias";
import { Licencia, NuevaLicencia } from "./types";

const base: Licencia = {
  id: "l1",
  empresaId: "e1",
  evento: "activacion",
  plan: "Obra",
  desde: "2026-01-01",
  hasta: "2026-12-31",
  maxProyectos: 3,
  maxUsuarios: 20,
  grupos: ["bim", "calidad"],
  suspendida: false,
  motivo: "",
  soporte: "",
  otorgadaPor: "Técnico",
  creado: "2026-01-01T10:00:00Z",
};

describe("estado de la licencia", () => {
  it("activa, por vencer (15 días), vencida (después del último día) y sin vencimiento", () => {
    assert.equal(estadoLicencia(base, true, "2026-06-01").estado, "activa");
    assert.deepEqual(estadoLicencia(base, true, "2026-12-20"), { estado: "por-vencer", diasRestantes: 11 });
    assert.equal(estadoLicencia(base, true, "2026-12-31").estado, "por-vencer", "el último día todavía sirve");
    assert.equal(estadoLicencia(base, true, "2027-01-01").estado, "vencida");
    assert.equal(estadoLicencia({ ...base, hasta: null }, true, "2030-01-01").estado, "sin-vencimiento");
  });

  it("suspendida, programada, sin licencia y empresa desactivada no dejan trabajar", () => {
    for (const [l, activa, esperado] of [
      [{ ...base, suspendida: true, evento: "suspension" as const }, true, "suspendida"],
      [{ ...base, desde: "2026-07-01" }, true, "programada"],
      [null, true, "sin-licencia"],
      [base, false, "empresa-inactiva"],
    ] as const) {
      const { estado } = estadoLicencia(l, activa, "2026-06-01");
      assert.equal(estado, esperado);
      assert.equal(licenciaPermiteTrabajar(estado), false, esperado);
    }
  });

  it("la vigente es el evento más reciente", () => {
    const renovada = { ...base, id: "l2", evento: "renovacion" as const, hasta: "2027-12-31", creado: "2026-12-01T10:00:00Z" };
    assert.equal(licenciaVigente([renovada, base])?.id, "l2");
    assert.equal(licenciaVigente([]), null);
  });

  it("los permisos se recortan a los módulos que vende la licencia; panel, bitácora y accesos siempre vienen", () => {
    assert.deepEqual(permisosContratados(["panel.ver", "cantidades.crear", "lotes.crear", "bitacora.ver", "costos.ver"], ["calidad"]), ["panel.ver", "lotes.crear", "bitacora.ver"]);
    const m = modulosHabilitados([]);
    assert.deepEqual([...m].sort(), ["accesos", "bitacora", "panel"]);
  });
});

describe("revisar un evento de licencia", () => {
  const nueva: NuevaLicencia = { empresaId: "e1", evento: "activacion", plan: "Obra", desde: "2026-01-01", hasta: null, maxProyectos: 1, maxUsuarios: 5, grupos: [], suspendida: false, motivo: "", soporte: "" };
  it("acepta una activación sin fin y rechaza fechas al revés o límites fuera de rango", () => {
    assert.equal(revisarLicencia(nueva), null);
    assert.match(revisarLicencia({ ...nueva, hasta: "2025-12-31" }) ?? "", /fecha final/);
    assert.match(revisarLicencia({ ...nueva, maxProyectos: 0 }) ?? "", /proyectos/);
    assert.match(revisarLicencia({ ...nueva, maxUsuarios: 2.5 }) ?? "", /personas/);
  });
  it("suspender y reactivar piden motivo", () => {
    assert.match(revisarLicencia({ ...nueva, evento: "suspension", suspendida: true }) ?? "", /motivo/);
    assert.equal(revisarLicencia({ ...nueva, evento: "suspension", suspendida: true, motivo: "Mora" }), null);
    assert.match(revisarLicencia({ ...nueva, evento: "reactivacion" }) ?? "", /motivo/);
  });
});
