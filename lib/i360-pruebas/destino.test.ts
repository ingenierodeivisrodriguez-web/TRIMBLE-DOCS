import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { candidatosBcf, destinoPermitido } from "./destino";

describe("destinoPermitido (relevo temporal de la Fase 0)", () => {
  it("acepta servicios de Trimble Connect por https", () => {
    assert.ok(destinoPermitido("https://app.connect.trimble.com/tc/api/2.0/regions"));
    assert.ok(destinoPermitido("https://app21.connect.trimble.com/tc/api/2.0/projects/me"));
  });

  it("rechaza otros dominios, http, puertos y usuarios en la dirección", () => {
    assert.equal(destinoPermitido("https://evil.com/?x=connect.trimble.com"), null);
    assert.equal(destinoPermitido("https://connect.trimble.com.evil.com/"), null);
    assert.equal(destinoPermitido("http://app.connect.trimble.com/"), null);
    assert.equal(destinoPermitido("https://app.connect.trimble.com:8443/"), null);
    assert.equal(destinoPermitido("https://a:b@app.connect.trimble.com/"), null);
    assert.equal(destinoPermitido("no es una url"), null);
  });
});

describe("candidatosBcf", () => {
  it("toma solo las claves de la región que hablan de BCF o temas, sin la ruta de versión", () => {
    const region = {
      location: "northAmerica",
      "tc-api": "https://app.connect.trimble.com/tc/api/2.0/",
      "bcf-api": "https://bcf.connect.trimble.com/bcf/2.1/",
      "topics-api": "https://topics.connect.trimble.com/",
      "otro-bcf": "https://evil.com/bcf",
    };
    assert.deepEqual(candidatosBcf(region), [
      { clave: "bcf-api", base: "https://bcf.connect.trimble.com" },
      { clave: "topics-api", base: "https://topics.connect.trimble.com" },
    ]);
  });

  it("devuelve lista vacía si la región no publica nada de BCF", () => {
    assert.deepEqual(candidatosBcf({ "tc-api": "https://app.connect.trimble.com/tc/api/2.0/" }), []);
  });
});
