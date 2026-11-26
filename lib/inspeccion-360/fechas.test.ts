import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enBogota, fmtFecha, fmtFechaHora, isoDesdeExif, isoDesdeLocal, paraInputLocal } from "./fechas";

describe("fechas en hora de Bogotá", () => {
  it("la hora de la cámara (EXIF, sin zona) se lee como hora de Bogotá", () => {
    assert.equal(isoDesdeExif("2026:11:26 09:30:15"), "2026-11-26T09:30:15-05:00");
    assert.equal(isoDesdeExif("0000:00:00 00:00:00"), null);
    assert.equal(isoDesdeExif("no es fecha"), null);
    assert.equal(isoDesdeExif(null), null);
  });

  it("en pantalla siempre DD-MM-AAAA", () => {
    assert.equal(fmtFecha("2026-11-26T09:30:15-05:00"), "26-11-2026");
    assert.equal(fmtFechaHora("2026-11-26T09:30:15-05:00"), "26-11-2026 09:30");
  });

  it("una hora UTC de madrugada todavía es el día anterior en Bogotá", () => {
    assert.equal(fmtFecha("2026-11-27T03:00:00Z"), "26-11-2026");
    assert.deepEqual(enBogota("2026-11-27T03:00:00Z"), { anio: 2026, mes: 11, dia: 26, hora: 22, minuto: 0, segundo: 0 });
  });

  it("ida y vuelta con el campo de fecha y hora del formulario", () => {
    const iso = isoDesdeLocal("2026-11-26T09:30");
    assert.equal(iso, "2026-11-26T09:30:00-05:00");
    assert.equal(paraInputLocal(iso!), "2026-11-26T09:30");
  });

  it("rechaza fechas que no existen", () => {
    assert.equal(isoDesdeLocal("2026-02-31T10:00"), null);
    assert.equal(isoDesdeExif("2026:13:01 10:00:00"), null);
  });
});
