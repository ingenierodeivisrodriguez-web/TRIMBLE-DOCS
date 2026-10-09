import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estadoDeCuenta, movimientosDe, porMes, rango } from "./contabilidad";
import type { Orden } from "./types";

function orden(id: string, o: Partial<Orden>): Orden {
  return {
    id,
    email: `${id}@x.com`,
    nombre: id,
    meses: 1,
    monto: 50_000,
    moneda: "COP",
    pasarela: "mercadopago",
    medio: null,
    referencia: null,
    soporte: null,
    registradoPor: null,
    estado: "aprobada",
    preferenciaId: null,
    pagoId: `p-${id}`,
    estadoPago: "approved",
    detallePago: null,
    creada: "2026-10-01T12:00:00Z",
    pagada: "2026-10-01T12:00:00Z",
    actualizada: "2026-10-01T12:00:00Z",
    venceAnterior: null,
    venceNueva: "2026-11-01",
    nota: null,
    ...o,
  };
}

const ORDENES: Orden[] = [
  // 3 months paid on 07-10: term (07-10, 07-01] = 92 days, 24 of them in October.
  orden("a", { meses: 3, monto: 135_000, pagada: "2026-10-07T15:00:00Z", venceNueva: "2027-01-07" }),
  // Paid on 10-10 and refunded on 02-11: cash in and out, never revenue.
  orden("b", { estado: "reembolsada", pasarela: "wompi", pagada: "2026-10-10T15:00:00Z", actualizada: "2026-11-02T15:00:00Z", venceNueva: "2026-11-10" }),
  // Renewal paid on 15-10 of a license in force until 20-10: its month runs (20-10, 20-11], 11 days in October.
  orden("c", { pasarela: "wompi", pagada: "2026-10-15T15:00:00Z", venceAnterior: "2026-10-20", venceNueva: "2026-11-20" }),
  // 03:00 UTC on 01-11 is still 31-10 in Colombia.
  orden("e", { pagada: "2026-11-01T03:00:00Z", venceNueva: "2026-11-30" }),
  // Paid for less than the price: to review, outside the statements.
  orden("d", { estado: "revisar", pagada: "2026-10-20T15:00:00Z", venceNueva: null }),
  // Not paid.
  orden("f", { estado: "pendiente", pagada: null, venceNueva: null }),
];

describe("estados de cuenta", () => {
  it("cuenta el recaudo y los reembolsos en el día en que ocurrieron (hora de Colombia)", () => {
    const oct = estadoDeCuenta(ORDENES, "2026-10-01", "2026-10-31");
    assert.deepEqual([oct.ventas, oct.bruto, oct.reembolsosCantidad, oct.reembolsos, oct.neto], [4, 285_000, 0, 0, 285_000]);
    assert.equal(oct.ticketPromedio, 71_250);
    assert.deepEqual(oct.porPasarela, [
      { pasarela: "mercadopago", ventas: 2, bruto: 185_000, reembolsos: 0, neto: 185_000 },
      { pasarela: "wompi", ventas: 2, bruto: 100_000, reembolsos: 0, neto: 100_000 },
    ]);
    assert.deepEqual(oct.porRevisar.map((o) => o.id), ["d"]);
    const nov = estadoDeCuenta(ORDENES, "2026-11-01", "2026-11-30");
    assert.deepEqual([nov.ventas, nov.reembolsosCantidad, nov.reembolsos, nov.neto], [0, 1, 50_000, -50_000]);
    assert.deepEqual(
      movimientosDe(ORDENES).map((m) => [m.fecha, m.tipo, m.valor]),
      [
        ["2026-10-07", "venta", 135_000],
        ["2026-10-10", "venta", 50_000],
        ["2026-10-15", "venta", 50_000],
        ["2026-10-31", "venta", 50_000],
        ["2026-11-02", "reembolso", -50_000],
      ]
    );
  });

  it("reconoce el ingreso a lo largo del término de cada licencia, y concilia el diferido", () => {
    const oct = estadoDeCuenta(ORDENES, "2026-10-01", "2026-10-31");
    // a: 135.000 × 24/92; c: 50.000 × 11/31; e: paid on 31-10, its term starts on 01-11.
    const esperado = (135_000 * 24) / 92 + (50_000 * 11) / 31;
    assert.ok(Math.abs(oct.devengado - esperado) < 0.01);
    assert.equal(oct.diferidoInicial, 0);
    assert.equal(oct.recaudoNoReembolsado, 235_000);
    for (const [desde, hasta] of [
      ["2026-10-01", "2026-10-31"],
      ["2026-11-01", "2026-11-30"],
      ["2026-12-01", "2026-12-31"],
    ]) {
      const e = estadoDeCuenta(ORDENES, desde, hasta);
      assert.ok(Math.abs(e.diferidoInicial + e.recaudoNoReembolsado - e.devengado - e.diferidoFinal) < 0.05, `${desde}: el diferido no concilia`);
    }
    // When every term has ended, everything collected (and not refunded) has been recognized.
    const total = estadoDeCuenta(ORDENES, "2026-01-01", "2027-12-31");
    assert.ok(Math.abs(total.devengado - 235_000) < 0.01);
    assert.equal(total.diferidoFinal, 0);
  });

  it("arma los meses del año hasta hoy y los rangos de un mes o un año", () => {
    assert.deepEqual(rango("2026-02"), { desde: "2026-02-01", hasta: "2026-02-28" });
    assert.deepEqual(rango("2026"), { desde: "2026-01-01", hasta: "2026-12-31" });
    const meses = porMes(ORDENES, 2026, "2026-11-15");
    assert.equal(meses.length, 11);
    assert.deepEqual(
      meses.slice(9).map((m) => [m.mes, m.ventas, m.neto]),
      [
        ["2026-10", 4, 285_000],
        ["2026-11", 0, -50_000],
      ]
    );
    assert.equal(meses[9].diferido, meses[10].diferido + meses[10].devengado);
  });
});
