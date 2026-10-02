import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValuesChanged, VALUES_CHANGED } from "./messages";

describe("mensajes entre las extensiones del visor", () => {
  it("reconoce el aviso de valores cambiados, envuelto o no", () => {
    assert.equal(isValuesChanged({ type: VALUES_CHANGED }), true);
    assert.equal(isValuesChanged({ data: { type: VALUES_CHANGED } }), true);
    assert.equal(isValuesChanged(VALUES_CHANGED), true);
    assert.equal(isValuesChanged({ data: VALUES_CHANGED }), true);
  });

  it("ignora los mensajes de otras extensiones", () => {
    for (const other of [null, undefined, "hola", { type: "otra-cosa" }, { data: { type: "otra" } }, 42]) {
      assert.equal(isValuesChanged(other), false, JSON.stringify(other));
    }
  });
});
