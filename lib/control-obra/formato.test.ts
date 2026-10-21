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
    assert.equal(nombrePermiso("cantidades.verificar"), "Mediciones de obra: Verificar");
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

  it("un cambio de flujo dice los pasos con sus roles, antes y ahora", () => {
    const e = fila({
      accion: "flujos.cambiar",
      modulo: "actas_cliente",
      objetoTipo: "flujo",
      objetoId: "acta_cliente",
      cambios: {
        tipo: "acta_cliente",
        antes: [{ nombre: "Elabora", rol: "Residente de obra" }, { nombre: "Aprueba", rol: "Director de proyecto" }],
        despues: [{ nombre: "Elabora", rol: "Residente de obra" }, { nombre: "Preaprueba", rol: "Director de proyecto" }, { nombre: "Aprueba", rol: "Interventoría" }],
      },
    });
    assert.equal(nombreAccion(e.accion), "Cambiar un flujo de aprobación");
    assert.equal(sobreQue(e), "Flujo de actas al cliente");
    assert.equal(
      detalleEntrada(e),
      "Actas al cliente: antes Elabora: Residente de obra → Aprueba: Director de proyecto; ahora Elabora: Residente de obra → Preaprueba: Director de proyecto → Aprueba: Interventoría"
    );
  });

  it("una devolución en el flujo dice el paso, cómo queda y el motivo", () => {
    const e = fila({ accion: "flujo.devolver", objetoTipo: "acta_cliente", objetoId: "4f1c2a9e-…", cambios: { paso: "Aprueba", desde: 2, hasta: 1, estado: "en_tramite" }, motivo: "Revisar el Piso 2" });
    assert.equal(nombreAccion(e.accion), "Devolver al paso anterior");
    assert.equal(detalleEntrada(e), "Paso Aprueba: queda en aprobación. Motivo: Revisar el Piso 2");
    assert.equal(sobreQue(e), "Actas al cliente: 4f1c2a9e");
  });

  it("una medición dice partida, cantidad, ubicación, origen y contrato", () => {
    const e = fila({
      accion: "mediciones.crear",
      modulo: "cantidades",
      objetoTipo: "medicion",
      cambios: { numero: 1, partida: "1.1 Muro en bloque No. 5", ubicacion: "Torre 1 · Piso 2", cantidad: 80, unidad: "M2", origen: "modelo", elementos: 12, contrato: "CT-0001 Pedro Pérez" },
    });
    assert.equal(sobreQue(e), "MED-0001 1.1 Muro en bloque No. 5");
    assert.equal(detalleEntrada(e), "80.0000 M2; Torre 1 · Piso 2; 12 elemento(s) del modelo; CT-0001 Pedro Pérez");
    const anulada = fila({ ...e, accion: "mediciones.anular", cambios: { ...e.cambios, origen: undefined }, motivo: "Duplicada" });
    assert.equal(detalleEntrada(anulada), "80.0000 M2; Torre 1 · Piso 2. Motivo: Duplicada");
    const config = fila({ accion: "config.cambiar", cambios: { ubicacionObligatoria: [[], ["torre", "nivel"]] } });
    assert.equal(detalleEntrada(config), "Niveles obligatorios de la ubicación: ninguno → torre, nivel");
  });
});
