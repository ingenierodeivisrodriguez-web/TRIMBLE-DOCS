import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actualizar, agregar, infoAutorizado } from "./acceso";
import { estadoDeCuenta, sinPagoRegistrado } from "./contabilidad";
import { anularPago, leerPago, registrarPagoManual } from "./pagoManual";
import { ManualesError } from "./service";
import { memoryStore } from "./store";

const HOY = "2026-10-09";

async function falla(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (err: unknown) => err instanceof ManualesError && err.code === code);
}

describe("pagos manuales", () => {
  it("valida el pago: valor en pesos, medio, fecha no futura; la cortesía vale 0", () => {
    assert.deepEqual(leerPago({ tipo: "pago", valor: 480000, medio: "transferencia", fecha: "2026-10-08", referencia: " TRF-991 " }, HOY), {
      monto: 480000,
      medio: "transferencia",
      fecha: "2026-10-08",
      referencia: "TRF-991",
      soporte: null,
    });
    assert.deepEqual(leerPago({ tipo: "cortesia", soporte: "Aliado" }, HOY), { monto: 0, medio: "cortesia", fecha: HOY, referencia: null, soporte: "Aliado" });
    assert.throws(() => leerPago({ tipo: "pago", valor: 0, medio: "efectivo" }, HOY), /valor pagado/);
    assert.throws(() => leerPago({ tipo: "pago", valor: 1.5, medio: "efectivo" }, HOY), /valor pagado/);
    assert.throws(() => leerPago({ tipo: "pago", valor: 1000, medio: "bitcoin" }, HOY), /medio de pago/);
    assert.throws(() => leerPago({ tipo: "pago", valor: 1000, medio: "efectivo", fecha: "2026-10-10" }, HOY), /futura/);
    assert.throws(() => leerPago({ tipo: "regalo" }, HOY), /pago recibido o una cortesía/);
  });

  it("respalda la licencia en los estados de cuenta, y se puede anular dejando el reverso", async () => {
    const store = memoryStore();
    await agregar(store, { texto: "luis@x.com, ana@x.com, pepe@x.com", licencia: { meses: 12, inicio: "2026-10-08" } }, "Admin", HOY);
    const lista = async () => (await store.listarAutorizados()).map((a) => infoAutorizado(a, HOY));
    const ordenes = () => store.listarOrdenes({ pagadas: true, limite: 100 });
    assert.deepEqual(sinPagoRegistrado(await lista(), await ordenes()).map((a) => a.email), ["ana@x.com", "luis@x.com", "pepe@x.com"]);

    const luis = (await store.getAutorizado("luis@x.com"))!;
    const id = await registrarPagoManual(store, luis, leerPago({ tipo: "pago", valor: 480000, medio: "transferencia", fecha: "2026-10-08", referencia: "TRF-991" }, HOY), "Admin");
    await registrarPagoManual(store, (await store.getAutorizado("ana@x.com"))!, leerPago({ tipo: "cortesia" }, HOY), "Admin");
    assert.deepEqual(sinPagoRegistrado(await lista(), await ordenes()).map((a) => a.email), ["pepe@x.com"]);

    const o = (await store.getOrden(id))!;
    assert.deepEqual([o.pasarela, o.estado, o.medio, o.referencia, o.registradoPor, o.venceAnterior, o.venceNueva], [
      "manual",
      "aprobada",
      "transferencia",
      "TRF-991",
      "Admin",
      "2026-10-08",
      "2027-10-08",
    ]);
    const oct = estadoDeCuenta(await ordenes(), "2026-10-01", "2026-10-31");
    assert.deepEqual([oct.ventas, oct.bruto, oct.cortesias], [1, 480000, 1]);
    assert.deepEqual(oct.porPasarela.map((p) => p.pasarela), ["manual"]);
    assert.equal(oct.movimientos.find((m) => m.tipo === "venta")?.pagoId, "TRF-991");
    // Devengado from 08-10 (the license's start), 23 of its 365 days in October.
    assert.ok(Math.abs(oct.devengado - (480000 * 23) / 365) < 0.01);

    // Renewing by hand without registering a payment leaves it unbacked again.
    await actualizar(store, { email: "luis@x.com", licencia: { meses: 3, inicio: "2027-10-08" } }, HOY);
    assert.ok(sinPagoRegistrado(await lista(), await ordenes()).some((a) => a.email === "luis@x.com"));

    await falla(anularPago(store, { orden: id }, "Admin", HOY), "parametro");
    await anularPago(store, { orden: id, motivo: "Transferencia devuelta" }, "Admin", HOY);
    const anulada = (await store.getOrden(id))!;
    assert.equal(anulada.estado, "reembolsada");
    assert.match(anulada.nota ?? "", /Anulado el 09-10-2026 por Admin: Transferencia devuelta/);
    await falla(anularPago(store, { orden: id, motivo: "otra vez" }, "Admin", HOY), "no-anulable");
    const despues = estadoDeCuenta(await ordenes(), "2026-10-01", "2026-10-31");
    assert.deepEqual([despues.bruto, despues.reembolsos, despues.neto, despues.devengado], [480000, 480000, 0, 0]);
  });
});
