import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { armarCodigo, leerCodigo, nombreArchivo, normalizarSegmento, rutaCarpetas, siguienteNumero } from "./codigos";

describe("códigos de punto", () => {
  it("arma el código del ejemplo del plan", () => {
    assert.equal(armarCodigo({ proyecto: "MAL", torre: "TR1", piso: "P05", unidad: "APT501", numero: 1 }), "MAL-TR1-P05-APT501-C01");
  });

  it("lee un código y rechaza los mal formados", () => {
    assert.deepEqual(leerCodigo("MAL-TR1-P05-APT501-C07"), { proyecto: "MAL", torre: "TR1", piso: "P05", unidad: "APT501", numero: 7 });
    assert.equal(leerCodigo("MAL-TR1-P05-APT501-C1"), null);
    assert.equal(leerCodigo("mal-TR1-P05-APT501-C01"), null);
    assert.equal(leerCodigo("MAL-TR1-P05-APT501-C00"), null);
    assert.equal(leerCodigo("MAL-TR1-P05-APT501-EXTRA-C01"), null);
  });

  it("no arma códigos con partes inválidas y dice por qué", () => {
    assert.throws(() => armarCodigo({ proyecto: "M", torre: "TR1", piso: "P05", unidad: "APT501", numero: 1 }), /proyecto/);
    assert.throws(() => armarCodigo({ proyecto: "MAL", torre: "TR1", piso: "P05", unidad: "APT501", numero: 100 }), /1 a 99/);
  });

  it("normaliza lo que se escribe: sin tildes, espacios ni guiones, en mayúsculas", () => {
    assert.equal(normalizarSegmento("Torre 1"), "TORRE1");
    assert.equal(normalizarSegmento("apt-501"), "APT501");
    assert.equal(normalizarSegmento("Cubierta técnica"), "CUBIERTATECNICA");
  });

  it("el siguiente número nunca reutiliza uno usado, aunque el punto esté inactivo", () => {
    const puntos = [
      { torre: "TR1", piso: "P05", unidad: "APT501", numero: 1 },
      { torre: "TR1", piso: "P05", unidad: "APT501", numero: 4 },
      { torre: "TR1", piso: "P05", unidad: "APT502", numero: 9 },
    ];
    assert.equal(siguienteNumero(puntos, "TR1", "P05", "APT501"), 5);
    assert.equal(siguienteNumero(puntos, "TR1", "P06", "APT601"), 1);
  });
});

describe("nombres y carpetas en el CDE", () => {
  it("nombre con la fecha AAAAMMDD-HHMM y sufijo si se repite el minuto", () => {
    const l = { anio: 2026, mes: 11, dia: 26, hora: 9, minuto: 30 };
    assert.equal(nombreArchivo("MAL-TR1-P05-APT501-C01", l), "MAL-TR1-P05-APT501-C01_20261126-0930_360.jpg");
    assert.equal(nombreArchivo("MAL-TR1-P05-APT501-C01", l, 2), "MAL-TR1-P05-APT501-C01_20261126-0930_360-2.jpg");
  });

  it("carpetas Inspección 360 / torre / piso / unidad / punto", () => {
    assert.deepEqual(rutaCarpetas("Inspección 360", { torre: "TR1", piso: "P05", unidad: "APT501", numero: 3 }), ["Inspección 360", "TR1", "P05", "APT501", "C03"]);
  });
});
