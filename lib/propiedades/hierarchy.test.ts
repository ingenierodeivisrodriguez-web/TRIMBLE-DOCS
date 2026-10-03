import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ancestorsOf, withoutProtected } from "./hierarchy";

// Project 900 > building 901 > level 902 > elements 1..5; element 6 is a curtain
// wall (assembly) with panels 7 and 8. Only the default tree and assemblies exist.
const parentsOf: Record<number, number[]> = {
  1: [902, 901, 900],
  2: [902, 901, 900],
  6: [902, 901, 900],
  7: [6, 902, 901, 900],
  8: [6, 902, 901, 900],
};

const calls: string[] = [];
const viewer = {
  getHierarchyParents: async (modelId: string, ids: number[], kind?: number, recursive?: boolean) => {
    calls.push(`${modelId}:${kind ?? "default"}:${ids.length}:${recursive}`);
    if (kind === 2) throw new Error("no containment tree");
    const parents = new Set<number>();
    for (const id of ids) for (const p of parentsOf[id] ?? []) if (kind === undefined || p === 6 || kind === 4) parents.add(p);
    return [...parents].map((id) => ({ id, fileId: "f", name: `n${id}` }));
  },
};

describe("contenedores del modelo", () => {
  it("reúne los ancestros de los elementos en los árboles que tenga el modelo", async () => {
    const found = await ancestorsOf(viewer as never, { est: [1, 2, 7] }, { est: "m-est" });
    assert.deepEqual([...found.get("est")!].sort((a, b) => a - b), [6, 900, 901, 902]);
    // recursive, through the viewer's model id, and a failing tree is skipped
    assert.ok(calls.every((c) => c.startsWith("m-est:") && c.endsWith(":true")));
  });

  it("no consulta modelos sin id del visor ni listas vacías", async () => {
    const before = calls.length;
    const found = await ancestorsOf(viewer as never, { otro: [1], vacio: [] }, { vacio: "m" });
    assert.equal(found.size, 0);
    assert.equal(calls.length, before);
  });

  it("quita de una lista los objetos protegidos", () => {
    const protectedIds = new Map([["est", new Set([900, 901, 902])]]);
    assert.deepEqual(withoutProtected({ est: [900, 3, 902, 4], arq: [1] }, protectedIds), { est: [3, 4], arq: [1] });
    assert.deepEqual(withoutProtected({ est: [900, 901] }, protectedIds), {});
  });
});
