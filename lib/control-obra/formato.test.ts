import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detalleEntrada, nombreAccion, nombrePermiso, sobreQue } from "./formato";
import { EntradaBitacora } from "./types";

const fila = (extra: Partial<EntradaBitacora>): EntradaBitacora => ({
  n: 1,
  cadena: "e1",
  creado: "2026-10-20T15:00:00Z",
  empresaId: "e1",
  projectId: "p1",
  actorId: "ana",
  actorNombre: "Ana",
  accion: "accesos.asignar",
  modulo: "accesos",
  objetoTipo: "usuario",
  objetoId: "luis",
  cambios: {},
  motivo: "",
  resultado: "ok",
  origen: "menu",
  hashAnterior: "0",
  hash: "1",
  ...extra,
});

describe("cómo se lee la bitácora", () => {
  it("cada acción y permiso tiene su texto", () => {
    assert.equal(nombreAccion("licencias.registrar"), "Registrar licencia");
    assert.equal(nombreAccion("algo.nuevo"), "algo.nuevo");
    assert.equal(nombrePermiso("cantidades.verificar"), "Cantidades: Verificar");
  });

  it("un acceso dice la persona, el rol y la vigencia antes y después", () => {
    const e = fila({
      accion: "accesos.cambiar",
      cambios: { persona: "Luis Pérez", antes: { rol: "Residente de obra", desde: "2026-01-01", hasta: null, activo: true }, despues: { rol: "Director de proyecto", adminProyecto: true, desde: "2026-02-01", hasta: "2026-12-31", activo: true } },
    });
    assert.equal(detalleEntrada(e), "Luis Pérez: Residente de obra, desde 01-01-2026, sin fecha final → Director de proyecto, administra el proyecto, desde 01-02-2026, hasta 31-12-2026");
    assert.equal(sobreQue(e), "Luis Pérez");
  });

  it("un intento negado dice por qué y con qué permiso", () => {
    const e = fila({ resultado: "denegado", accion: "estructura.consultar", cambios: { motivo: "sin-permiso", permiso: "estructura.ver" } });
    assert.equal(detalleEntrada(e), "Tu rol no permite hacer esto. (permiso: Estructura de obra: Ver)");
  });

  it("una licencia dice evento, vigencia, límites y módulos, con fechas DD-MM-AAAA", () => {
    const e = fila({
      accion: "licencias.registrar",
      objetoTipo: "licencia",
      cambios: { evento: "suspension", plan: "Obra", desde: "2026-01-01", hasta: null, maxProyectos: 3, maxUsuarios: 20, grupos: ["bim"] },
      motivo: "Mora",
    });
    assert.equal(detalleEntrada(e), "Suspensión: Obra, desde 01-01-2026, sin vencimiento, 3 proyecto(s), 20 persona(s); módulos: Estructura de obra y modelos 3D. Motivo: Mora");
    assert.equal(sobreQue(e), "La licencia");
  });

  it("los cambios de configuración usan nombres de obra, no los del código", () => {
    const e = fila({ accion: "config.cambiar", objetoTipo: "proyecto", cambios: { toleranciaVerificacionPct: [0, 2], permiteAceptadoConObservaciones: [false, true] } });
    assert.equal(detalleEntrada(e), "Tolerancia (%): 0 → 2; Aceptado con observaciones: no → sí");
    assert.equal(sobreQue(e), "El proyecto");
  });

  it("un valor de la estructura se nombra por su valor, no por su identificador", () => {
    const e = fila({ accion: "estructura.nodo.crear", objetoTipo: "nodo", objetoId: "4f1c-…", cambios: { nivel: "nivel", valor: "Piso 5", estado: "activo" } });
    assert.equal(sobreQue(e), "Piso 5");
    assert.equal(detalleEntrada(e), "nivel: Piso 5, activo");
  });
});
