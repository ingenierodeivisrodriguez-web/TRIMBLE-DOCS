import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HASH_INICIAL, hashDe, jsonCanonico, sha256Hex, verificarCadena } from "./bitacora";
import { EntradaBitacora } from "./types";

async function cadena(n: number): Promise<EntradaBitacora[]> {
  const filas: EntradaBitacora[] = [];
  let anterior = HASH_INICIAL;
  for (let i = 1; i <= n; i++) {
    const fila = {
      n: i,
      cadena: "e1",
      creado: `2026-10-20T10:00:0${i}.000Z`,
      empresaId: "e1",
      projectId: "p1",
      actorId: "ana",
      actorNombre: "Ana",
      accion: "accesos.asignar",
      modulo: "accesos",
      objetoTipo: "usuario",
      objetoId: `u${i}`,
      cambios: { despues: { rol: "Residente", activo: true } },
      motivo: "",
      resultado: "ok" as const,
      origen: "menu" as const,
    };
    const hash = await hashDe(anterior, fila);
    filas.push({ ...fila, hashAnterior: anterior, hash });
    anterior = hash;
  }
  return filas;
}

describe("bitácora encadenada", () => {
  it("el JSON canónico no depende del orden de las claves", () => {
    assert.equal(jsonCanonico({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), jsonCanonico({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
  });

  it("SHA-256 conocido", async () => {
    assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("una cadena sin tocar está íntegra", async () => {
    assert.deepEqual(await verificarCadena("e1", await cadena(5)), { cadena: "e1", filas: 5, integra: true, rotaEn: null });
  });

  it("cambiar una fila a mano, borrarla o reordenarlas queda en evidencia", async () => {
    const cambiada = await cadena(5);
    cambiada[2] = { ...cambiada[2], actorNombre: "Otra persona" };
    assert.equal((await verificarCadena("e1", cambiada)).rotaEn, 3);

    const sinUna = (await cadena(5)).filter((f) => f.n !== 2);
    assert.equal((await verificarCadena("e1", sinUna)).rotaEn, 3);

    const recalculada = await cadena(5);
    recalculada[1] = { ...recalculada[1], motivo: "x", hash: await hashDe(recalculada[1].hashAnterior, { ...recalculada[1], motivo: "x" }) };
    assert.equal((await verificarCadena("e1", recalculada)).rotaEn, 3, "aunque se recalcule el hash de la fila, la siguiente ya no la sigue");
  });
});
