import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { agregar, actualizar, puedeLeer } from "./acceso";
import { firmaValida, mercadoPago, Mp, NuevaPreferencia, PagoMp } from "./mercadopago";
import { conciliarPendientes, iniciarCompra, leerVenta, procesarPago, ventaPublica, verificarOrden } from "./pagos";
import { ManualesError } from "./service";
import { memoryStore, ManualesStore, POR_PAGO } from "./store";

const HOY = "2026-10-07";
const URLS = { retorno: "https://app/api/manuales/pagos/retorno", notificacion: "https://app/api/manuales/pagos/webhook" };
const LUIS = { email: "luis@empresa.com", nombre: "Luis Gómez" };

/** A Mercado Pago that remembers the checkouts it created and answers with the payments we give it. */
function mpFalso() {
  const preferencias: NuevaPreferencia[] = [];
  const pagos = new Map<string, PagoMp>();
  let n = 0;
  const mp: Mp = {
    async cuenta() {
      return { id: "1", nombre: "TESTUSER1", email: "", prueba: true };
    },
    async crearPreferencia(p) {
      preferencias.push(p);
      return { id: `pref-${++n}`, url: `https://mp/checkout/${n}` };
    },
    async pago(id) {
      return pagos.get(id) ?? null;
    },
    async buscarPagos(referencia) {
      return [...pagos.values()].filter((p) => p.referencia === referencia).reverse();
    },
  };
  const pagar = (id: string, referencia: string, monto: number, estado = "approved", detalle = "accredited") =>
    pagos.set(id, { id, estado, detalle, referencia, monto, moneda: "COP", aprobado: estado === "approved" ? "2026-10-07T15:00:00Z" : null });
  return { mp, preferencias, pagar };
}

async function tienda(planes = [{ meses: 1, precio: 50_000 }, { meses: 3, precio: 135_000 }, { meses: 12, precio: 480_000 }]): Promise<ManualesStore> {
  const store = memoryStore();
  await store.guardarVenta({ habilitada: true, planes }, "Ana");
  return store;
}

async function falla(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (err: unknown) => err instanceof ManualesError && err.code === code);
}

describe("planes a la venta", () => {
  it("valida los planes y los ordena por meses", () => {
    assert.deepEqual(leerVenta({ habilitada: true, planes: [{ meses: 12, precio: 480000 }, { meses: 1, precio: 50000 }] }).planes, [
      { meses: 1, precio: 50000 },
      { meses: 12, precio: 480000 },
    ]);
    assert.throws(() => leerVenta({ habilitada: true, planes: [] }), /al menos un plan/);
    assert.throws(() => leerVenta({ habilitada: true, planes: [{ meses: 13, precio: 1 }] }), /1 a 12 meses/);
    assert.throws(() => leerVenta({ habilitada: true, planes: [{ meses: 3, precio: 1.5 }] }), /sin decimales/);
    assert.throws(() => leerVenta({ habilitada: true, planes: [{ meses: 3, precio: 9 }, { meses: 3, precio: 8 }] }), /dos planes de 3 meses/);
    assert.deepEqual(leerVenta({ habilitada: false, planes: [] }), { habilitada: false, planes: [] });
  });

  it("solo se ofrecen a quien puede comprar", async () => {
    const store = await tienda();
    const venta = await store.getVenta();
    assert.equal(ventaPublica(venta, null, LUIS.email, null), null); // without Mercado Pago credentials
    assert.equal(ventaPublica({ ...venta, habilitada: false }, { prueba: false }, LUIS.email, null), null);
    assert.equal(ventaPublica(venta, { prueba: false }, LUIS.email, null)?.planes.length, 3);
    await agregar(store, { texto: LUIS.email, licencia: { sinVencimiento: true } }, "Ana", HOY);
    assert.equal(ventaPublica(venta, { prueba: false }, LUIS.email, await store.getAutorizado(LUIS.email)), null);
  });
});

describe("compra de licencias con Mercado Pago", () => {
  it("el precio sale del plan del administrador y la licencia va al correo de quien compra", async () => {
    const store = await tienda();
    const { mp, preferencias } = mpFalso();
    const compra = await iniciarCompra(store, mp, { email: "LUIS@empresa.com", nombre: LUIS.nombre }, { meses: 3, precio: 1 }, URLS, HOY);
    assert.match(compra.orden, /^man_[A-Za-z0-9_-]{16}$/);
    assert.deepEqual([compra.url, compra.monto, compra.moneda, compra.vence], ["https://mp/checkout/1", 135_000, "COP", "2027-01-07"]);
    assert.equal(preferencias[0].referencia, compra.orden);
    assert.equal(preferencias[0].monto, 135_000);
    assert.equal(preferencias[0].notificacion, URLS.notificacion);
    const orden = (await store.getOrden(compra.orden))!;
    assert.deepEqual([orden.email, orden.estado, orden.preferenciaId], [LUIS.email, "pendiente", "pref-1"]);
  });

  it("no vende con la venta cerrada, planes que no existen, ni a cuentas suspendidas", async () => {
    const { mp } = mpFalso();
    await falla(iniciarCompra(memoryStore(), mp, LUIS, { meses: 1 }, URLS, HOY), "venta-cerrada");
    const store = await tienda();
    await falla(iniciarCompra(store, null, LUIS, { meses: 1 }, URLS, HOY), "sin-mercadopago");
    await falla(iniciarCompra(store, mp, LUIS, { meses: 6 }, URLS, HOY), "plan");
    await falla(iniciarCompra(store, mp, { email: "", nombre: "x" }, { meses: 1 }, URLS, HOY), "sin-correo");
    await agregar(store, { texto: LUIS.email }, "Ana", HOY);
    await actualizar(store, { email: LUIS.email, suspendido: true }, HOY);
    await falla(iniciarCompra(store, mp, LUIS, { meses: 1 }, URLS, HOY), "suspendida");
  });

  it("limita las compras seguidas de una persona", async () => {
    const store = await tienda();
    const { mp } = mpFalso();
    for (let i = 0; i < 10; i++) await iniciarCompra(store, mp, LUIS, { meses: 1 }, URLS, HOY);
    await falla(iniciarCompra(store, mp, LUIS, { meses: 1 }, URLS, HOY), "demasiadas");
  });

  it("al aprobarse el pago, la persona queda autorizada por los meses comprados, una sola vez", async () => {
    const store = await tienda();
    const { mp, pagar } = mpFalso();
    const { orden } = await iniciarCompra(store, mp, LUIS, { meses: 3 }, URLS, HOY);
    assert.equal((await puedeLeer(store, LUIS.email, async () => false, HOY)).autorizado, false);
    pagar("1001", orden, 135_000);
    assert.deepEqual(await procesarPago(store, mp, "1001", HOY), { resultado: "aplicada", orden, vence: "2027-01-07" });
    const lectura = await puedeLeer(store, LUIS.email, async () => false, HOY);
    assert.deepEqual([lectura.autorizado, lectura.licencia?.vence], [true, "2027-01-07"]);
    const a = (await store.getAutorizado(LUIS.email))!;
    assert.deepEqual([a.nombre, a.agregadoPor, a.licenciaMeses, a.inicio], [LUIS.nombre, POR_PAGO, 3, HOY]);
    // The same payment notified again (webhook + return + the waiting screen) doesn't add months again.
    assert.equal((await procesarPago(store, mp, "1001", HOY)).resultado, "ya-aplicada");
    assert.equal((await store.getAutorizado(LUIS.email))!.vence, "2027-01-07");
    const o = (await store.getOrden(orden))!;
    assert.deepEqual([o.estado, o.pagoId, o.venceAnterior, o.venceNueva], ["aprobada", "1001", null, "2027-01-07"]);
  });

  it("renueva desde el vencimiento si la licencia sigue vigente, o desde hoy si ya venció", async () => {
    const store = await tienda();
    const { mp, pagar } = mpFalso();
    await agregar(store, { texto: LUIS.email, licencia: { meses: 1, inicio: "2026-09-20" } }, "Ana", HOY); // vence 2026-10-20
    const vigente = await iniciarCompra(store, mp, LUIS, { meses: 1 }, URLS, HOY);
    assert.equal(vigente.vence, "2026-11-20");
    pagar("2001", vigente.orden, 50_000);
    await procesarPago(store, mp, "2001", HOY);
    assert.equal((await store.getAutorizado(LUIS.email))!.vence, "2026-11-20");
    assert.equal((await store.getOrden(vigente.orden))!.venceAnterior, "2026-10-20");

    const despues = "2026-12-01"; // expired on 2026-11-20
    const vencida = await iniciarCompra(store, mp, LUIS, { meses: 12 }, URLS, despues);
    assert.equal(vencida.vence, "2027-12-01");
    pagar("2002", vencida.orden, 480_000);
    await procesarPago(store, mp, "2002", despues);
    const a = (await store.getAutorizado(LUIS.email))!;
    assert.deepEqual([a.inicio, a.vence, a.licenciaMeses, a.agregadoPor], [despues, "2027-12-01", 12, "Ana"]);
  });

  it("un pago rechazado deja la compra pendiente y se puede volver a pagar", async () => {
    const store = await tienda();
    const { mp, pagar } = mpFalso();
    const { orden } = await iniciarCompra(store, mp, LUIS, { meses: 1 }, URLS, HOY);
    pagar("3001", orden, 50_000, "rejected", "cc_rejected_insufficient_amount");
    assert.equal((await procesarPago(store, mp, "3001", HOY)).resultado, "pendiente");
    const o = (await store.getOrden(orden))!;
    assert.deepEqual([o.estado, o.estadoMp, o.detalleMp], ["pendiente", "rejected", "cc_rejected_insufficient_amount"]);
    assert.equal(await store.getAutorizado(LUIS.email), null);
    pagar("3002", orden, 50_000);
    assert.equal((await procesarPago(store, mp, "3002", HOY)).resultado, "aplicada");
  });

  it("no aplica pagos por menos del valor, ni pagos de otras ventas", async () => {
    const store = await tienda();
    const { mp, pagar } = mpFalso();
    const { orden } = await iniciarCompra(store, mp, LUIS, { meses: 12 }, URLS, HOY);
    pagar("4001", orden, 1_000);
    assert.equal((await procesarPago(store, mp, "4001", HOY)).resultado, "revisar");
    assert.equal(await store.getAutorizado(LUIS.email), null);
    assert.match((await store.getOrden(orden))!.nota ?? "", /no se aplicó/);
    pagar("4002", "pedido-de-otra-tienda", 480_000);
    assert.equal((await procesarPago(store, mp, "4002", HOY)).resultado, "ajeno");
    pagar("4003", "man_AAAAAAAAAAAAAAAA", 480_000); // looks like ours, but isn't in the database
    assert.equal((await procesarPago(store, mp, "4003", HOY)).resultado, "ajeno");
    assert.equal((await procesarPago(store, mp, "999", HOY)).resultado, "ajeno");
  });

  it("un reembolso marca la compra para revisión sin tocar la licencia; un segundo pago aprobado queda anotado", async () => {
    const store = await tienda();
    const { mp, pagar } = mpFalso();
    const { orden } = await iniciarCompra(store, mp, LUIS, { meses: 1 }, URLS, HOY);
    pagar("5001", orden, 50_000);
    await procesarPago(store, mp, "5001", HOY);
    pagar("5002", orden, 50_000);
    assert.equal((await procesarPago(store, mp, "5002", HOY)).resultado, "duplicado");
    assert.match((await store.getOrden(orden))!.nota ?? "", /5002/);
    pagar("5001", orden, 50_000, "refunded", "refunded");
    assert.equal((await procesarPago(store, mp, "5001", HOY)).resultado, "reembolsada");
    assert.equal((await store.getOrden(orden))!.estado, "reembolsada");
    assert.equal((await store.getAutorizado(LUIS.email))!.vence, "2026-11-07");
  });

  it("si la notificación no llega, la pantalla en espera y la revisión diaria encuentran el pago", async () => {
    const store = await tienda();
    const { mp, pagar } = mpFalso();
    const a = await iniciarCompra(store, mp, LUIS, { meses: 1 }, URLS, HOY);
    const b = await iniciarCompra(store, mp, { email: "marta@empresa.com", nombre: "Marta" }, { meses: 3 }, URLS, HOY);
    assert.equal((await verificarOrden(store, mp, (await store.getOrden(a.orden))!, HOY)).estado, "pendiente");
    pagar("6001", a.orden, 50_000);
    assert.equal((await verificarOrden(store, mp, (await store.getOrden(a.orden))!, HOY)).estado, "aprobada");
    pagar("6002", b.orden, 135_000, "in_process", "pending_contingency");
    pagar("6003", b.orden, 135_000);
    assert.deepEqual(await conciliarPendientes(store, mp, HOY), { revisadas: 1, aprobadas: 1 });
    assert.equal((await store.getAutorizado("marta@empresa.com"))!.vence, "2027-01-07");
  });
});

describe("Mercado Pago", () => {
  it("crea el checkout con nuestras credenciales y la referencia de la compra", async () => {
    const llamadas: { url: string; init: RequestInit }[] = [];
    const fetchFalso = (async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      return new Response(JSON.stringify({ id: "pref-9", init_point: "https://mp/real", sandbox_init_point: "https://mp/sandbox" }), { status: 201 });
    }) as unknown as typeof fetch;
    const real = mercadoPago({ accessToken: "APP_USR-1", webhookSecret: null, prueba: false }, fetchFalso);
    const pref = { referencia: "man_x", titulo: "Licencia", descripcion: "d", monto: 50_000, moneda: "COP", retorno: "https://app/r", notificacion: "https://app/w" };
    assert.deepEqual(await real.crearPreferencia(pref), { id: "pref-9", url: "https://mp/real" });
    assert.equal(llamadas[0].url, "https://api.mercadopago.com/checkout/preferences");
    assert.equal((llamadas[0].init.headers as Record<string, string>).Authorization, "Bearer APP_USR-1");
    const body = JSON.parse(String(llamadas[0].init.body));
    assert.equal(body.external_reference, "man_x");
    assert.deepEqual(body.items[0], { id: "man_x", title: "Licencia", description: "d", quantity: 1, currency_id: "COP", unit_price: 50_000 });
    assert.deepEqual([body.auto_return, body.notification_url], ["approved", "https://app/w"]);
    const prueba = mercadoPago({ accessToken: "TEST-1", webhookSecret: null, prueba: true }, fetchFalso);
    assert.equal((await prueba.crearPreferencia({ ...pref, retorno: "http://localhost:3000/r", notificacion: null })).url, "https://mp/sandbox");
    const local = JSON.parse(String(llamadas[1].init.body));
    assert.deepEqual([local.auto_return, local.notification_url], [undefined, undefined]);
  });

  it("reconoce las cuentas de prueba, cuyas credenciales empiezan por APP_USR como las reales", async () => {
    const usuario = (tags: string[]) =>
      (async () => new Response(JSON.stringify({ id: 99, nickname: "TESTUSER99", email: "test_user_99@testuser.com", tags }))) as unknown as typeof fetch;
    const prueba = await mercadoPago({ accessToken: "APP_USR-1", webhookSecret: null, prueba: false }, usuario(["normal", "test_user"])).cuenta();
    assert.deepEqual(prueba, { id: "99", nombre: "TESTUSER99", email: "test_user_99@testuser.com", prueba: true });
    assert.equal((await mercadoPago({ accessToken: "APP_USR-1", webhookSecret: null, prueba: false }, usuario(["normal"])).cuenta()).prueba, false);
  });

  it("lee los pagos y avisa si rechaza las credenciales", async () => {
    const fetchFalso = (async (url: string) => {
      if (url.endsWith("/v1/payments/77")) {
        return new Response(JSON.stringify({ id: 77, status: "approved", status_detail: "accredited", external_reference: "man_x", transaction_amount: 50000, currency_id: "COP" }));
      }
      if (url.includes("/v1/payments/88")) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ message: "invalid access token" }), { status: 401 });
    }) as unknown as typeof fetch;
    const mp = mercadoPago({ accessToken: "x", webhookSecret: null, prueba: false }, fetchFalso);
    assert.deepEqual(await mp.pago("77"), { id: "77", estado: "approved", detalle: "accredited", referencia: "man_x", monto: 50000, moneda: "COP", aprobado: null });
    assert.equal(await mp.pago("88"), null);
    assert.equal(await mp.pago("../otra-cosa"), null);
    await falla(mp.buscarPagos("man_x"), "mercadopago-credenciales");
  });

  it("verifica la firma de las notificaciones", () => {
    const secreto = "clave-del-webhook";
    const v1 = createHmac("sha256", secreto).update("id:123456;request-id:req-1;ts:1704908010;").digest("hex");
    assert.equal(firmaValida(secreto, `ts=1704908010,v1=${v1}`, "req-1", "123456"), true);
    assert.equal(firmaValida(secreto, `ts=1704908011,v1=${v1}`, "req-1", "123456"), false);
    assert.equal(firmaValida(secreto, `ts=1704908010,v1=${v1}`, "req-1", "999"), false);
    assert.equal(firmaValida("otra", `ts=1704908010,v1=${v1}`, "req-1", "123456"), false);
    assert.equal(firmaValida(secreto, null, "req-1", "123456"), false);
    assert.equal(firmaValida(secreto, `ts=1704908010,v1=${v1}0`, "req-1", "123456"), false); // a trailing digit hex decoding would drop
    // Missing parts are left out of the signed text.
    const sinRequest = createHmac("sha256", secreto).update("id:abc;ts:5;").digest("hex");
    assert.equal(firmaValida(secreto, `ts=5,v1=${sinRequest}`, null, "ABC"), true);
  });
});
