import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Caller } from "../propiedades/service";
import { abrirModelo, anularPunto, archivoModelo, confirmarSubida, crearPunto, Ctx, eliminar, estado, guardarConfig, iniciarSubida, limpiar, publico } from "./service";
import { archivosEnMemoria, memoryStore, RaStore } from "./store";

const ANA: Caller = { id: "u-ana", name: "Ana Pérez", isAdmin: false };
const LUIS: Caller = { id: "u-luis", name: "Luis Gómez", isAdmin: false };
const ADMIN: Caller = { id: "u-admin", name: "Dueño", isAdmin: true };

const nuevo = (extra: Record<string, unknown> = {}) => ({
  nombre: "Torre A - estructura",
  archivos: [{ fileId: "Abc123", versionId: "v1", nombre: "Estructura.ifc" }],
  filtros: { nivelesExcluidos: ["Cubierta"], clasesExcluidas: ["IfcSpace"] },
  bytes: 5,
  triangulos: 1200,
  elementos: 40,
  origen: [1000, 0, -2000],
  ...extra,
});

function montar() {
  const archivos = archivosEnMemoria();
  const store = memoryStore(archivos);
  let reloj = new Date("2026-10-27T12:00:00Z");
  const ctx = (caller: Caller, projectId = "proy-1"): Ctx => ({ projectId, caller, store, ahora: () => reloj });
  return { archivos, store, ctx, avanzarDias: (d: number) => (reloj = new Date(reloj.getTime() + d * 86_400_000)), reloj: () => reloj };
}

async function prepararListo(m: ReturnType<typeof montar>, caller = ANA) {
  const { modelo, urlSubida } = await iniciarSubida(m.ctx(caller), nuevo());
  m.archivos.contenido.set(urlSubida.replace("memoria://", ""), new Uint8Array([1, 2, 3, 4, 5]));
  return confirmarSubida(m.ctx(caller), modelo.id);
}

describe("preparar un modelo", () => {
  it("cualquier miembro registra el modelo y recibe dónde subir el archivo", async () => {
    const m = montar();
    const { modelo, urlSubida } = await iniciarSubida(m.ctx(ANA), nuevo());
    assert.equal(modelo.estado, "subiendo");
    assert.equal(modelo.creadoPor, "Ana Pérez");
    assert.match(urlSubida, new RegExp(`proy-1/${modelo.id}\\.raq$`));
    assert.equal("ruta" in modelo, false, "la ruta del archivo no se envía al navegador");
  });
  it("al confirmar, queda listo y se cuenta el plazo de 30 días desde hoy", async () => {
    const m = montar();
    const listo = await prepararListo(m);
    assert.equal(listo.estado, "listo");
    assert.equal(listo.eliminaEn, "2026-11-26T12:00:00.000Z");
  });
  it("si el archivo no llegó, no se confirma", async () => {
    const m = montar();
    const { modelo } = await iniciarSubida(m.ctx(ANA), nuevo());
    await assert.rejects(confirmarSubida(m.ctx(ANA), modelo.id), /no llegó/);
  });
  it("si el archivo llegó incompleto, no se confirma", async () => {
    const m = montar();
    const { modelo, urlSubida } = await iniciarSubida(m.ctx(ANA), nuevo());
    m.archivos.contenido.set(urlSubida.replace("memoria://", ""), new Uint8Array([1, 2]));
    await assert.rejects(confirmarSubida(m.ctx(ANA), modelo.id), /incompleto \(2 de 5 bytes\)/);
  });
  it("otra persona no confirma la subida ajena", async () => {
    const m = montar();
    const { modelo } = await iniciarSubida(m.ctx(ANA), nuevo());
    await assert.rejects(confirmarSubida(m.ctx(LUIS), modelo.id), /Solo quien preparó/);
  });
  it("rechaza datos inválidos: sin archivos, demasiados triángulos o más de 50 MB", async () => {
    const m = montar();
    await assert.rejects(iniciarSubida(m.ctx(ANA), nuevo({ archivos: [] })), /entre 1 y 20 archivos/);
    await assert.rejects(iniciarSubida(m.ctx(ANA), nuevo({ triangulos: 3_000_001 })), /triángulos/);
    await assert.rejects(iniciarSubida(m.ctx(ANA), nuevo({ bytes: 60 * 1024 * 1024 })), /tamaño/);
    await assert.rejects(iniciarSubida(m.ctx(ANA), nuevo({ archivos: [{ fileId: "../x", nombre: "a.ifc" }] })), /no es válido/);
  });
  it("un modelo de otro proyecto no existe para este", async () => {
    const m = montar();
    const listo = await prepararListo(m);
    await assert.rejects(eliminar(m.ctx(ADMIN, "proy-2"), listo.id), /no existe/);
  });
});

describe("eliminar", () => {
  it("quien lo preparó lo elimina: se borra el archivo y la fila queda como registro", async () => {
    const m = montar();
    const listo = await prepararListo(m);
    const quitado = await eliminar(m.ctx(ANA), listo.id);
    assert.equal(quitado.estado, "eliminado");
    assert.equal(quitado.motivoEliminacion, "manual");
    assert.equal(quitado.eliminadoPor, "Ana Pérez");
    assert.equal(m.archivos.contenido.size, 0);
    assert.equal((await estado(m.ctx(ANA))).modelos.length, 1);
  });
  it("otro miembro no puede eliminarlo, un administrador sí", async () => {
    const m = montar();
    const listo = await prepararListo(m);
    const deLuis = (await estado(m.ctx(LUIS))).modelos[0];
    assert.equal(deLuis.puedeEliminar, false);
    await assert.rejects(eliminar(m.ctx(LUIS), listo.id), /Solo quien preparó el modelo o un administrador/);
    assert.equal((await eliminar(m.ctx(ADMIN), listo.id)).estado, "eliminado");
  });
});

describe("eliminación automática por falta de uso", () => {
  it("pasados los días sin uso, al abrir la pantalla se borra el archivo", async () => {
    const m = montar();
    await prepararListo(m);
    m.avanzarDias(29);
    assert.equal((await estado(m.ctx(LUIS))).modelos[0].estado, "listo");
    m.avanzarDias(2);
    const [modelo] = (await estado(m.ctx(LUIS))).modelos;
    assert.equal(modelo.estado, "eliminado");
    assert.equal(modelo.motivoEliminacion, "vencido");
    assert.equal(m.archivos.contenido.size, 0);
  });
  it("una subida que nunca se terminó se limpia al día siguiente", async () => {
    const m = montar();
    await iniciarSubida(m.ctx(ANA), nuevo());
    m.avanzarDias(1.1);
    assert.equal(await limpiar(m.store, m.reloj()), 1);
    assert.equal((await estado(m.ctx(ANA))).modelos[0].motivoEliminacion, "subida-incompleta");
  });
  it("si el archivo no se puede borrar ahora, el modelo sigue y se reintenta después", async () => {
    const m = montar();
    await prepararListo(m);
    const store: RaStore = { ...m.store, archivos: { ...m.store.archivos, borrar: async () => { throw new Error("Storage caído"); } } };
    m.avanzarDias(40);
    const original = console.error;
    console.error = () => {};
    try {
      assert.equal(await limpiar(store, m.reloj()), 0);
    } finally {
      console.error = original;
    }
    assert.equal((await estado(m.ctx(ANA))).modelos[0].estado, "eliminado", "la siguiente limpieza sí lo borra");
  });
  it("solo un administrador cambia los días y el nuevo plazo se aplica a los modelos ya preparados", async () => {
    const m = montar();
    await prepararListo(m);
    await assert.rejects(guardarConfig(m.ctx(ANA), { diasSinUso: 7 }), /Solo un administrador/);
    await assert.rejects(guardarConfig(m.ctx(ADMIN), { diasSinUso: 0 }), /entre 1 y 365/);
    const cfg = await guardarConfig(m.ctx(ADMIN), { diasSinUso: 7 });
    assert.equal(cfg.diasSinUso, 7);
    assert.equal(cfg.actualizadoPor, "Dueño");
    const [modelo] = (await estado(m.ctx(ANA))).modelos;
    assert.equal(modelo.eliminaEn, "2026-11-03T12:00:00.000Z");
  });
  it("sin configuración guardada, el plazo es de 30 días", async () => {
    const m = montar();
    assert.equal((await estado(m.ctx(ANA))).config.diasSinUso, 30);
  });
});

describe("puntos QR", () => {
  const punto = (modeloId: string, extra: Record<string, unknown> = {}) => ({
    modeloId,
    nombre: "Acceso principal",
    referencia: "Muro del eje 3 entre B y C, cara hacia el patio",
    montaje: "muro",
    punto: [1.5, 1.4, -0.25],
    rumbo: Math.PI / 2,
    elemento: "Losa 1",
    vence: "2026-11-26",
    ...extra,
  });

  it("cualquier miembro crea un QR sobre un modelo listo; el código no se adivina y vence al final del día", async () => {
    const m = montar();
    const listo = await prepararListo(m);
    const p = await crearPunto(m.ctx(LUIS), punto(listo.id));
    assert.equal(p.estado, "activo");
    assert.equal(p.montaje, "muro");
    assert.match(p.codigo, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(p.url, `https://trimble-docs.vercel.app/ra/q/${p.codigo}`);
    assert.equal(p.vence, "2026-11-27T04:59:59.000Z");
    assert.equal(p.modeloNombre, "Torre A - estructura");
    assert.equal("creadoPorId" in p, false);
    assert.equal((await estado(m.ctx(ANA))).puntos.length, 1);
  });
  it("pide dónde se pega la hoja (en un muro) y una fecha entre hoy y un año", async () => {
    const m = montar();
    const listo = await prepararListo(m);
    await assert.rejects(crearPunto(m.ctx(ANA), punto(listo.id, { referencia: "  " })), /dónde se pega la hoja/);
    await assert.rejects(crearPunto(m.ctx(ANA), punto(listo.id, { montaje: "piso" })), /muro o columna/);
    await assert.rejects(crearPunto(m.ctx(ANA), punto(listo.id, { vence: "2026-10-26" })), /ya pasó/);
    await assert.rejects(crearPunto(m.ctx(ANA), punto(listo.id, { vence: "2027-12-01" })), /máximo 365 días/);
    await assert.rejects(crearPunto(m.ctx(ANA), punto(listo.id, { vence: "2026-02-30" })), /no es válida/);
    await assert.rejects(crearPunto(m.ctx(ANA), punto(listo.id, { punto: [1, "a", 3] })), /punto elegido/);
  });
  it("no se crea sobre un modelo eliminado ni de otro proyecto", async () => {
    const m = montar();
    const listo = await prepararListo(m);
    await assert.rejects(crearPunto(m.ctx(ADMIN, "proy-2"), punto(listo.id)), /no existe/);
    await eliminar(m.ctx(ANA), listo.id);
    await assert.rejects(crearPunto(m.ctx(ANA), punto(listo.id)), /ya no tiene archivo/);
  });
  it("el celular ve el QR activo, sin datos del proyecto, y cuenta el escaneo", async () => {
    const m = montar();
    const listo = await prepararListo(m);
    const p = await crearPunto(m.ctx(ANA), punto(listo.id));
    const r = await publico(m.store, p.codigo, m.reloj());
    assert.deepEqual(r, {
      estado: "activo",
      nombre: "Acceso principal",
      referencia: "Muro del eje 3 entre B y C, cara hacia el patio",
      vence: "2026-11-27T04:59:59.000Z",
      montaje: "muro",
      modelo: { nombre: "Torre A - estructura", elementos: 40, triangulos: 1200, bytes: 5 },
    });
    const [vista] = (await estado(m.ctx(ANA))).puntos;
    assert.equal(vista.usos, 1);
  });
  it("un código inventado o mal formado no existe", async () => {
    const m = montar();
    assert.deepEqual(await publico(m.store, "AbCdEfGhIjKlMnOpQrStUv"), { estado: "no-existe" });
    assert.deepEqual(await publico(m.store, "../x"), { estado: "no-existe" });
  });
  it("anulado o vencido: el celular solo sabe el nombre y no se cuenta", async () => {
    const m = montar();
    const listo = await prepararListo(m);
    const a = await crearPunto(m.ctx(ANA), punto(listo.id));
    const b = await crearPunto(m.ctx(ANA), punto(listo.id, { nombre: "Escalera", vence: "2026-10-28" }));
    await assert.rejects(anularPunto(m.ctx(LUIS), a.id), /Solo quien creó el QR/);
    assert.equal((await anularPunto(m.ctx(ADMIN), a.id)).estado, "anulado");
    assert.deepEqual(await publico(m.store, a.codigo, m.reloj()), { estado: "anulado", nombre: "Acceso principal" });
    m.avanzarDias(2);
    assert.deepEqual(await publico(m.store, b.codigo, m.reloj()), { estado: "vencido", nombre: "Escalera" });
    assert.ok((await estado(m.ctx(ANA))).puntos.every((p) => p.usos === 0));
  });
  it("si el modelo se elimina, sus QR dejan de abrir", async () => {
    const m = montar();
    const listo = await prepararListo(m);
    const p = await crearPunto(m.ctx(ANA), punto(listo.id));
    await eliminar(m.ctx(ANA), listo.id);
    assert.equal((await publico(m.store, p.codigo, m.reloj())).estado, "sin-modelo");
    assert.equal((await estado(m.ctx(ANA))).puntos[0].estado, "sin-modelo");
  });
  it("el panel recibe un enlace temporal al archivo del modelo listo", async () => {
    const m = montar();
    const listo = await prepararListo(m);
    assert.match((await archivoModelo(m.ctx(LUIS), listo.id)).url, /\.raq$/);
  });
});

describe("abrir el modelo en el celular", () => {
  const punto = (modeloId: string) => ({
    modeloId,
    nombre: "Acceso",
    referencia: "Muro eje 3",
    montaje: "muro",
    punto: [4.4, 1.415, 4.42],
    rumbo: -0.95,
    elemento: "Muro 1",
    vence: "2026-11-26",
  });

  it("entrega el enlace del archivo, el punto y el rumbo del muro, y el plazo de uso vuelve a empezar", async () => {
    const m = montar();
    const listo = await prepararListo(m);
    const p = await crearPunto(m.ctx(ANA), punto(listo.id));
    m.avanzarDias(10);
    const r = await abrirModelo(m.store, p.codigo, m.reloj());
    assert.equal(r.estado, "activo");
    assert.match(r.url!, /.raq$/);
    assert.deepEqual(r.punto, [4.4, 1.415, 4.42]);
    assert.equal(r.rumbo, -0.95);
    assert.equal(r.bytes, 5);
    const [modelo] = (await estado(m.ctx(ANA))).modelos;
    assert.equal(modelo.ultimoUso, "2026-11-06T12:00:00.000Z");
    assert.equal(modelo.eliminaEn, "2026-12-06T12:00:00.000Z");
  });
  it("un QR vencido, anulado o inventado no entrega el modelo", async () => {
    const m = montar();
    const listo = await prepararListo(m);
    const p = await crearPunto(m.ctx(ANA), punto(listo.id));
    assert.deepEqual(await abrirModelo(m.store, "AbCdEfGhIjKlMnOpQrStUv", m.reloj()), { estado: "no-existe" });
    await anularPunto(m.ctx(ANA), p.id);
    assert.deepEqual(await abrirModelo(m.store, p.codigo, m.reloj()), { estado: "anulado" });
  });
  it("un QR de prueba con la hoja en el piso no se abre en realidad aumentada", async () => {
    const m = montar();
    const listo = await prepararListo(m);
    const p = await crearPunto(m.ctx(ANA), punto(listo.id));
    await m.store.actualizarPunto("proy-1", p.id, { montaje: "piso" });
    assert.deepEqual(await abrirModelo(m.store, p.codigo, m.reloj()), { estado: "en-piso" });
  });
});
