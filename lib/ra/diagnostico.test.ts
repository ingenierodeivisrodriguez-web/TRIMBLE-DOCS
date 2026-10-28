import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Capacidades, detectarPlataforma, veredicto } from "./diagnostico";

const UA_CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const UA_SAMSUNG = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36";
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const UA_IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const UA_CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

const android: Capacidades = { ...detectarPlataforma(UA_CHROME_ANDROID), seguro: true, webxr: true, ra: true, lectorQR: true };

describe("detectarPlataforma", () => {
  it("reconoce Chrome en Android", () => {
    assert.deepEqual(detectarPlataforma(UA_CHROME_ANDROID), { esAndroid: true, esIOS: false, navegador: "chrome" });
  });
  it("distingue el navegador de Samsung de Chrome", () => {
    assert.equal(detectarPlataforma(UA_SAMSUNG).navegador, "samsung");
  });
  it("reconoce el iPhone y el iPad que se presenta como Mac", () => {
    assert.equal(detectarPlataforma(UA_IPHONE).esIOS, true);
    assert.equal(detectarPlataforma(UA_IPAD, 5).esIOS, true);
    assert.equal(detectarPlataforma(UA_IPAD, 0).esIOS, false);
  });
  it("un computador no es Android ni iPhone", () => {
    assert.deepEqual(detectarPlataforma(UA_CHROME_WINDOWS), { esAndroid: false, esIOS: false, navegador: "chrome" });
  });
});

describe("veredicto", () => {
  it("Chrome en Android con ARCore queda listo", () => {
    const v = veredicto(android);
    assert.equal(v.listo, true);
    assert.equal(v.titulo, "Este celular sirve");
  });
  it("mientras el navegador responde, dice que está revisando", () => {
    const v = veredicto({ ...android, ra: null });
    assert.equal(v.listo, false);
    assert.equal(v.revisando, true);
  });
  it("el iPhone se rechaza aunque diga tener WebXR", () => {
    const v = veredicto({ ...android, ...detectarPlataforma(UA_IPHONE) });
    assert.equal(v.listo, false);
    assert.match(v.detalle, /Android con Google Chrome/);
  });
  it("sin https no arranca", () => {
    assert.match(veredicto({ ...android, seguro: false }).detalle, /https/);
  });
  it("sin WebXR en Android recomienda Chrome", () => {
    const v = veredicto({ ...android, ...detectarPlataforma(UA_SAMSUNG), webxr: false });
    assert.equal(v.listo, false);
    assert.match(v.detalle, /Google Chrome/);
  });
  it("en un computador pide un celular Android, tenga o no WebXR", () => {
    for (const webxr of [true, false]) {
      const v = veredicto({ ...android, ...detectarPlataforma(UA_CHROME_WINDOWS), webxr, ra: false });
      assert.equal(v.titulo, "Esta prueba es para el celular");
      assert.match(v.detalle, /celular Android/);
    }
  });
  it("con WebXR pero sin ARCore pide instalar los Servicios de Google Play para RA", () => {
    const v = veredicto({ ...android, ra: false });
    assert.equal(v.listo, false);
    assert.match(v.detalle, /ARCore/);
  });
});
