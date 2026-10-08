import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { agregar, actualizar, puedeLeer } from "./acceso";
import { firmaValida, mercadoPago } from "./mercadopago";
import { conciliarPendientes, iniciarCompra, leerVenta, procesarPago, UrlsPago, ventaPublica, verificarOrden } from "./pagos";
import type { Cobro, IdPasarela, Pasarela, PagoPasarela } from "./pasarelas";
import { ManualesError } from "./service";
import { memoryStore, ManualesStore, porPago } from "./store";
import { eventoValido, firmaIntegridad, problemasWompi, wompi, WompiConfig } from "./wompi";

const HOY = "2026-10-07";
const URLS = (p: IdPasarela): UrlsPago => ({ retorno: `https://app/retorno/${p}`, notificacion: p === "mercadopago" ? "https://app/webhook" : null });
const LUIS = { email: "luis@empresa.com", nombre: "Luis Gómez" };

/** A gateway that remembers the checkouts it created and answers with the payments we give it. */
function pasarelaFalsa(id: IdPasarela = "mercadopago") {
  const cobros: Cobro[] = [];
  const pagos = new Map<string, PagoPasarela>();
  let n = 0;
  const pasarela: Pasarela = {
    id,
    prueba: true,
    async crearCobro(c) {
      cobros.push(c);
      n++;
      return { id: id === "mercadopago" ? `pref-${n}` : null, url: `https://${id}/checkout/${n}` };
    },
    async pago(pagoId) {
      return pagos.get(pagoId) ?? null;
    },
    async buscarPagos(referencia) {
      return [...pagos.values()].filter((p) => p.referencia === referencia).reverse();
    },
  };
  const pagar = (pagoId: string, referencia: string, monto: number, estado = "approved", detalle = "accredited") =>
    pagos.set(pagoId, { id: pagoId, estado, detalle, referencia, monto, moneda: "COP" });
  return { pasarela, cobros, pagar, pasarelas: { [id]: pasarela } };
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

  it("solo se ofrecen a quien puede comprar, con las pasarelas configuradas", async () => {
    const store = await tienda();
    const venta = await store.getVenta();
    const ambas = [
      { id: "mercadopago" as const, prueba: true },
      { id: "wompi" as const, prueba: false },
    ];
    assert.equal(ventaPublica(venta, [], LUIS.email, null), null); // no gateway configured
    assert.equal(ventaPublica({ ...venta, habilitada: false }, ambas, LUIS.email, null), null);
    assert.deepEqual(ventaPublica(venta, ambas, LUIS.email, null)?.pasarelas, [
      { id: "mercadopago", nombre: "Mercado Pago", prueba: true },
      { id: "wompi", nombre: "Wompi", prueba: false },
    ]);
    await agregar(store, { texto: LUIS.email, licencia: { sinVencimiento: true } }, "Ana", HOY);
    assert.equal(ventaPublica(venta, ambas, LUIS.email, await store.getAutorizado(LUIS.email)), null);
  });
});

describe("compra de licencias", () => {
  it("el precio sale del plan del administrador y la licencia va al correo de quien compra", async () => {
    const store = await tienda();
    const { cobros, pasarelas } = pasarelaFalsa();
    const compra = await iniciarCompra(store, pasarelas, { email: "LUIS@empresa.com", nombre: LUIS.nombre }, { meses: 3, precio: 1 }, URLS, HOY);
    assert.match(compra.orden, /^man_[A-Za-z0-9_-]{16}$/);
    assert.deepEqual([compra.url, compra.pasarela, compra.monto, compra.moneda, compra.vence], ["https://mercadopago/checkout/1", "mercadopago", 135_000, "COP", "2027-01-07"]);
    assert.deepEqual([cobros[0].referencia, cobros[0].monto, cobros[0].email], [compra.orden, 135_000, LUIS.email]);
    assert.deepEqual([cobros[0].retorno, cobros[0].notificacion], ["https://app/retorno/mercadopago", "https://app/webhook"]);
    const orden = (await store.getOrden(compra.orden))!;
    assert.deepEqual([orden.email, orden.estado, orden.pasarela, orden.preferenciaId], [LUIS.email, "pendiente", "mercadopago", "pref-1"]);
  });

  it("el comprador elige la pasarela, y un pago solo se aplica con la pasarela de su compra", async () => {
    const store = await tienda();
    const mp = pasarelaFalsa("mercadopago");
    const w = pasarelaFalsa("wompi");
    const pasarelas = { mercadopago: mp.pasarela, wompi: w.pasarela };
    const compra = await iniciarCompra(store, pasarelas, LUIS, { meses: 1, pasarela: "wompi" }, URLS, HOY);
    assert.deepEqual([compra.pasarela, compra.url, w.cobros[0].retorno, w.cobros[0].notificacion], ["wompi", "https://wompi/checkout/1", "https://app/retorno/wompi", null]);
    assert.equal(mp.cobros.length, 0);
    const orden = (await store.getOrden(compra.orden))!;
    assert.deepEqual([orden.pasarela, orden.preferenciaId], ["wompi", null]);
    // A Mercado Pago payment claiming to be for this Wompi purchase isn't applied.
    mp.pagar("1", compra.orden, 50_000);
    assert.equal((await procesarPago(store, mp.pasarela, "1", HOY)).resultado, "ajeno");
    w.pagar("12-1610641025-49201", compra.orden, 50_000);
    assert.equal((await procesarPago(store, w.pasarela, "12-1610641025-49201", HOY)).resultado, "aplicada");
    assert.equal((await store.getAutorizado(LUIS.email))!.agregadoPor, porPago("wompi"));
    await falla(iniciarCompra(store, { mercadopago: mp.pasarela }, LUIS, { meses: 1, pasarela: "wompi" }, URLS, HOY), "pasarela");
    await falla(iniciarCompra(store, pasarelas, LUIS, { meses: 1, pasarela: "paypal" }, URLS, HOY), "parametro");
  });

  it("no vende con la venta cerrada, sin pasarelas, planes que no existen, ni a cuentas suspendidas", async () => {
    const { pasarelas } = pasarelaFalsa();
    await falla(iniciarCompra(memoryStore(), pasarelas, LUIS, { meses: 1 }, URLS, HOY), "venta-cerrada");
    const store = await tienda();
    await falla(iniciarCompra(store, {}, LUIS, { meses: 1 }, URLS, HOY), "sin-pasarela");
    await falla(iniciarCompra(store, pasarelas, LUIS, { meses: 6 }, URLS, HOY), "plan");
    await falla(iniciarCompra(store, pasarelas, { email: "", nombre: "x" }, { meses: 1 }, URLS, HOY), "sin-correo");
    await agregar(store, { texto: LUIS.email }, "Ana", HOY);
    await actualizar(store, { email: LUIS.email, suspendido: true }, HOY);
    await falla(iniciarCompra(store, pasarelas, LUIS, { meses: 1 }, URLS, HOY), "suspendida");
  });

  it("limita las compras seguidas de una persona", async () => {
    const store = await tienda();
    const { pasarelas } = pasarelaFalsa();
    for (let i = 0; i < 10; i++) await iniciarCompra(store, pasarelas, LUIS, { meses: 1 }, URLS, HOY);
    await falla(iniciarCompra(store, pasarelas, LUIS, { meses: 1 }, URLS, HOY), "demasiadas");
  });

  it("al aprobarse el pago, la persona queda autorizada por los meses comprados, una sola vez", async () => {
    const store = await tienda();
    const { pasarela, pasarelas, pagar } = pasarelaFalsa();
    const { orden } = await iniciarCompra(store, pasarelas, LUIS, { meses: 3 }, URLS, HOY);
    assert.equal((await puedeLeer(store, LUIS.email, async () => false, HOY)).autorizado, false);
    pagar("1001", orden, 135_000);
    assert.deepEqual(await procesarPago(store, pasarela, "1001", HOY), { resultado: "aplicada", orden, vence: "2027-01-07" });
    const lectura = await puedeLeer(store, LUIS.email, async () => false, HOY);
    assert.deepEqual([lectura.autorizado, lectura.licencia?.vence], [true, "2027-01-07"]);
    const a = (await store.getAutorizado(LUIS.email))!;
    assert.deepEqual([a.nombre, a.agregadoPor, a.licenciaMeses, a.inicio], [LUIS.nombre, porPago("mercadopago"), 3, HOY]);
    // The same payment notified again (webhook + return + the waiting screen) doesn't add months again.
    assert.equal((await procesarPago(store, pasarela, "1001", HOY)).resultado, "ya-aplicada");
    assert.equal((await store.getAutorizado(LUIS.email))!.vence, "2027-01-07");
    const o = (await store.getOrden(orden))!;
    assert.deepEqual([o.estado, o.pagoId, o.venceAnterior, o.venceNueva], ["aprobada", "1001", null, "2027-01-07"]);
  });

  it("renueva desde el vencimiento si la licencia sigue vigente, o desde hoy si ya venció", async () => {
    const store = await tienda();
    const { pasarela, pasarelas, pagar } = pasarelaFalsa();
    await agregar(store, { texto: LUIS.email, licencia: { meses: 1, inicio: "2026-09-20" } }, "Ana", HOY); // vence 2026-10-20
    const vigente = await iniciarCompra(store, pasarelas, LUIS, { meses: 1 }, URLS, HOY);
    assert.equal(vigente.vence, "2026-11-20");
    pagar("2001", vigente.orden, 50_000);
    await procesarPago(store, pasarela, "2001", HOY);
    assert.equal((await store.getAutorizado(LUIS.email))!.vence, "2026-11-20");
    assert.equal((await store.getOrden(vigente.orden))!.venceAnterior, "2026-10-20");

    const despues = "2026-12-01"; // expired on 2026-11-20
    const vencida = await iniciarCompra(store, pasarelas, LUIS, { meses: 12 }, URLS, despues);
    assert.equal(vencida.vence, "2027-12-01");
    pagar("2002", vencida.orden, 480_000);
    await procesarPago(store, pasarela, "2002", despues);
    const a = (await store.getAutorizado(LUIS.email))!;
    assert.deepEqual([a.inicio, a.vence, a.licenciaMeses, a.agregadoPor], [despues, "2027-12-01", 12, "Ana"]);
  });

  it("un pago rechazado deja la compra pendiente y se puede volver a pagar", async () => {
    const store = await tienda();
    const { pasarela, pasarelas, pagar } = pasarelaFalsa();
    const { orden } = await iniciarCompra(store, pasarelas, LUIS, { meses: 1 }, URLS, HOY);
    pagar("3001", orden, 50_000, "rejected", "cc_rejected_insufficient_amount");
    assert.equal((await procesarPago(store, pasarela, "3001", HOY)).resultado, "pendiente");
    const o = (await store.getOrden(orden))!;
    assert.deepEqual([o.estado, o.estadoPago, o.detallePago], ["pendiente", "rejected", "cc_rejected_insufficient_amount"]);
    assert.equal(await store.getAutorizado(LUIS.email), null);
    pagar("3002", orden, 50_000);
    assert.equal((await procesarPago(store, pasarela, "3002", HOY)).resultado, "aplicada");
  });

  it("no aplica pagos por menos del valor, ni pagos de otras ventas", async () => {
    const store = await tienda();
    const { pasarela, pasarelas, pagar } = pasarelaFalsa();
    const { orden } = await iniciarCompra(store, pasarelas, LUIS, { meses: 12 }, URLS, HOY);
    pagar("4001", orden, 1_000);
    assert.equal((await procesarPago(store, pasarela, "4001", HOY)).resultado, "revisar");
    assert.equal(await store.getAutorizado(LUIS.email), null);
    assert.match((await store.getOrden(orden))!.nota ?? "", /no se aplicó/);
    pagar("4002", "pedido-de-otra-tienda", 480_000);
    assert.equal((await procesarPago(store, pasarela, "4002", HOY)).resultado, "ajeno");
    pagar("4003", "man_AAAAAAAAAAAAAAAA", 480_000); // looks like ours, but isn't in the database
    assert.equal((await procesarPago(store, pasarela, "4003", HOY)).resultado, "ajeno");
    assert.equal((await procesarPago(store, pasarela, "999", HOY)).resultado, "ajeno");
  });

  it("un reembolso marca la compra para revisión sin tocar la licencia; un segundo pago aprobado queda anotado", async () => {
    const store = await tienda();
    const { pasarela, pasarelas, pagar } = pasarelaFalsa();
    const { orden } = await iniciarCompra(store, pasarelas, LUIS, { meses: 1 }, URLS, HOY);
    pagar("5001", orden, 50_000);
    await procesarPago(store, pasarela, "5001", HOY);
    pagar("5002", orden, 50_000);
    assert.equal((await procesarPago(store, pasarela, "5002", HOY)).resultado, "duplicado");
    assert.match((await store.getOrden(orden))!.nota ?? "", /5002.*Mercado Pago/);
    pagar("5001", orden, 50_000, "refunded", "refunded");
    assert.equal((await procesarPago(store, pasarela, "5001", HOY)).resultado, "reembolsada");
    assert.equal((await store.getOrden(orden))!.estado, "reembolsada");
    assert.equal((await store.getAutorizado(LUIS.email))!.vence, "2026-11-07");
  });

  it("si la notificación no llega, la pantalla en espera y la revisión diaria encuentran el pago", async () => {
    const store = await tienda();
    const mp = pasarelaFalsa("mercadopago");
    const w = pasarelaFalsa("wompi");
    const pasarelas = { mercadopago: mp.pasarela, wompi: w.pasarela };
    const a = await iniciarCompra(store, pasarelas, LUIS, { meses: 1 }, URLS, HOY);
    const b = await iniciarCompra(store, pasarelas, { email: "marta@empresa.com", nombre: "Marta" }, { meses: 3, pasarela: "wompi" }, URLS, HOY);
    assert.equal((await verificarOrden(store, pasarelas, (await store.getOrden(a.orden))!, HOY)).estado, "pendiente");
    mp.pagar("6001", a.orden, 50_000);
    assert.equal((await verificarOrden(store, pasarelas, (await store.getOrden(a.orden))!, HOY)).estado, "aprobada");
    w.pagar("6002", b.orden, 135_000, "pending", "PENDING");
    w.pagar("6003", b.orden, 135_000);
    assert.deepEqual(await conciliarPendientes(store, pasarelas, HOY), { revisadas: 1, aprobadas: 1, errores: 0 });
    assert.equal((await store.getAutorizado("marta@empresa.com"))!.vence, "2027-01-07");
  });
});

describe("Mercado Pago", () => {
  const cobro: Cobro = { referencia: "man_x", titulo: "Licencia", descripcion: "d", monto: 50_000, moneda: "COP", email: "a@x.com", nombre: "A", retorno: "https://app/r", notificacion: "https://app/w" };

  it("crea el checkout con nuestras credenciales y la referencia de la compra", async () => {
    const llamadas: { url: string; init: RequestInit }[] = [];
    const fetchFalso = (async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      return new Response(JSON.stringify({ id: "pref-9", init_point: "https://mp/real", sandbox_init_point: "https://mp/sandbox" }), { status: 201 });
    }) as unknown as typeof fetch;
    const real = mercadoPago({ accessToken: "APP_USR-1", webhookSecret: null, prueba: false }, fetchFalso);
    assert.deepEqual(await real.crearCobro(cobro), { id: "pref-9", url: "https://mp/real" });
    assert.equal(llamadas[0].url, "https://api.mercadopago.com/checkout/preferences");
    assert.equal((llamadas[0].init.headers as Record<string, string>).Authorization, "Bearer APP_USR-1");
    const body = JSON.parse(String(llamadas[0].init.body));
    assert.equal(body.external_reference, "man_x");
    assert.deepEqual(body.items[0], { id: "man_x", title: "Licencia", description: "d", quantity: 1, currency_id: "COP", unit_price: 50_000 });
    assert.deepEqual([body.auto_return, body.notification_url], ["approved", "https://app/w"]);
    const prueba = mercadoPago({ accessToken: "TEST-1", webhookSecret: null, prueba: true }, fetchFalso);
    assert.equal((await prueba.crearCobro({ ...cobro, retorno: "http://localhost:3000/r", notificacion: null })).url, "https://mp/sandbox");
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
    assert.deepEqual(await mp.pago("77"), { id: "77", estado: "approved", detalle: "accredited", referencia: "man_x", monto: 50000, moneda: "COP" });
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

describe("Wompi", () => {
  const CFG: WompiConfig = {
    publicKey: "pub_test_abc",
    integritySecret: "test_integrity_xyz",
    privateKey: "prv_test_123",
    eventsSecret: "test_events_456",
    prueba: true,
    api: "https://sandbox.wompi.co/v1",
  };

  it("arma el Web Checkout firmado con el secreto de integridad (el monto no se puede cambiar)", async () => {
    const { url, id } = await wompi(CFG).crearCobro({
      referencia: "man_AAAAAAAAAAAAAAAA",
      titulo: "Licencia",
      descripcion: "d",
      monto: 135_000,
      moneda: "COP",
      email: "luis@empresa.com",
      nombre: "Luis Gómez",
      retorno: "https://app/api/manuales/pagos/retorno/wompi",
      notificacion: null,
    });
    assert.equal(id, null);
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, "https://checkout.wompi.co/p/");
    const q = u.searchParams;
    assert.deepEqual(
      [q.get("public-key"), q.get("currency"), q.get("amount-in-cents"), q.get("reference"), q.get("redirect-url"), q.get("customer-data:email")],
      ["pub_test_abc", "COP", "13500000", "man_AAAAAAAAAAAAAAAA", "https://app/api/manuales/pagos/retorno/wompi", "luis@empresa.com"]
    );
    const esperada = createHash("sha256").update("man_AAAAAAAAAAAAAAAA13500000COPtest_integrity_xyz").digest("hex");
    assert.equal(q.get("signature:integrity"), esperada);
    assert.equal(firmaIntegridad("man_AAAAAAAAAAAAAAAA", 13500000, "COP", "test_integrity_xyz"), esperada);
  });

  it("lee las transacciones en el vocabulario común y en pesos, y busca por referencia con la llave privada", async () => {
    const llamadas: { url: string; init: RequestInit }[] = [];
    const tx = (id: string, status: string, reference: string) => ({ id, status, status_message: status === "DECLINED" ? "Fondos insuficientes" : null, reference, amount_in_cents: 13500000, currency: "COP" });
    const fetchFalso = (async (url: string, init: RequestInit) => {
      llamadas.push({ url, init });
      if (url.endsWith("/transactions/1-APROBADA")) return new Response(JSON.stringify({ data: tx("1-APROBADA", "APPROVED", "man_x") }));
      if (url.endsWith("/transactions/2-ANULADA")) return new Response(JSON.stringify({ data: tx("2-ANULADA", "VOIDED", "man_x") }));
      if (url.includes("/transactions?reference=")) return new Response(JSON.stringify({ data: [tx("3-RECHAZADA", "DECLINED", "man_x"), tx("4-OTRA", "APPROVED", "man_otra")] }));
      return new Response(JSON.stringify({ error: { type: "NOT_FOUND_ERROR" } }), { status: 404 });
    }) as unknown as typeof fetch;
    const w = wompi(CFG, fetchFalso);
    assert.deepEqual(await w.pago("1-APROBADA"), { id: "1-APROBADA", estado: "approved", detalle: "APPROVED", referencia: "man_x", monto: 135000, moneda: "COP" });
    assert.equal(llamadas[0].url, "https://sandbox.wompi.co/v1/transactions/1-APROBADA");
    assert.equal((await w.pago("2-ANULADA"))?.estado, "refunded");
    assert.equal(await w.pago("9-NO-EXISTE"), null);
    assert.equal(await w.pago("../x"), null);
    const pagos = await w.buscarPagos("man_x");
    assert.deepEqual(pagos.map((p) => [p.id, p.estado, p.detalle]), [["3-RECHAZADA", "rejected", "DECLINED: Fondos insuficientes"]]); // only this order's
    const busqueda = llamadas.find((l) => l.url.includes("reference="))!;
    assert.equal((busqueda.init.headers as Record<string, string>).Authorization, "Bearer prv_test_123");
  });

  it("verifica el checksum de los eventos", () => {
    const evento = {
      event: "transaction.updated",
      data: { transaction: { id: "1234-1610641025-49201", status: "APPROVED", amount_in_cents: 4490000, reference: "man_x" } },
      signature: { properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"], checksum: "" },
      timestamp: 1530291411,
    };
    evento.signature.checksum = createHash("sha256").update("1234-1610641025-49201APPROVED44900001530291411test_events_456").digest("hex");
    assert.equal(eventoValido(evento, "test_events_456"), true);
    assert.equal(eventoValido(evento, "otro_secreto"), false);
    assert.equal(eventoValido({ ...evento, timestamp: 1530291412 }, "test_events_456"), false);
    assert.equal(eventoValido({ ...evento, data: { transaction: { ...evento.data.transaction, amount_in_cents: 100 } } }, "test_events_456"), false);
    // The checksum can also come in the X-Event-Checksum header.
    assert.equal(eventoValido({ ...evento, signature: { ...evento.signature, checksum: "" } }, "test_events_456", evento.signature.checksum.toUpperCase()), true);
  });

  it("avisa si las llaves son de ambientes distintos", () => {
    assert.deepEqual(problemasWompi(CFG), []);
    const mezclada = problemasWompi({ ...CFG, integritySecret: "prod_integrity_xyz", eventsSecret: "prod_events_1" });
    assert.equal(mezclada.length, 2);
    assert.match(mezclada[0], /test_integrity_/);
  });
});
