import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cuerpoPuntoDeVista, resumenProyecto } from "./datos";

describe("resumenProyecto (sin datos personales)", () => {
  it("deja tamaño, región y la licencia, y quita nombres, correos y cuentas", () => {
    const r = resumenProyecto({
      name: "Laboratorio",
      location: "northAmerica",
      size: 6400253047,
      rootId: "raiz1",
      createdBy: { email: "alguien@empresa.co", firstName: "Ana" },
      license: { type: "TRIAL", maxStorage: 10737418240, usedStorage: 6283220439, orgName: "Persona", ownerId: "x", accounts: [{ accountId: "1" }] },
    });
    assert.deepEqual(r, {
      location: "northAmerica",
      size: 6400253047,
      rootId: "raiz1",
      licencia: { type: "TRIAL", maxStorage: 10737418240, usedStorage: 6283220439 },
    });
    assert.ok(!JSON.stringify(r).includes("@"));
  });
});

describe("cuerpoPuntoDeVista", () => {
  it("elemento por IFCGUID, cámara normalizada e imagen PNG en BCF 3.0", () => {
    const c = cuerpoPuntoDeVista({
      version: "3.0",
      guid: "1y3VJSon91eO9nTpQ_7PT9",
      camara: { position: { x: 0, y: 0, z: 1.5 }, lookAt: { x: 0, y: 2, z: 1.5 }, upDirection: { x: 0, y: 0, z: 1 }, fieldOfView: 60 },
      imagen: "data:image/png;base64,QUJD",
    });
    assert.deepEqual(c.components, { selection: [{ ifc_guid: "1y3VJSon91eO9nTpQ_7PT9" }], visibility: { default_visibility: true } });
    assert.deepEqual((c.perspective_camera as { camera_direction: unknown }).camera_direction, { x: 0, y: 1, z: 0 });
    assert.equal((c.perspective_camera as { aspect_ratio?: number }).aspect_ratio, 1.6);
    assert.deepEqual(c.snapshot, { snapshot_type: "png", snapshot_data: "QUJD" });
  });
  it("en BCF 2.1 no lleva aspect_ratio y sin cámara ni imagen solo lleva el elemento", () => {
    const c = cuerpoPuntoDeVista({ version: "2.1", guid: "1y3VJSon91eO9nTpQ_7PT9" });
    assert.deepEqual(Object.keys(c), ["components"]);
  });
});
