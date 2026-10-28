import { test } from "node:test";
import assert from "node:assert/strict";
import type { FolderDetails, RawFolderItem } from "../trimbleApi";
import { listarProyectos, ordenarItems, TcExplorar, verCarpeta } from "./explorar";

const item = (id: string, name: string, type: "FOLDER" | "FILE", extra: Partial<RawFolderItem> = {}): RawFolderItem => ({ id, name, type, createdOn: "2026-10-01", modifiedOn: "2026-10-02", ...extra });

function tcFalso(carpetas: Record<string, FolderDetails>, items: Record<string, RawFolderItem[]>): TcExplorar {
  return {
    proyectos: async () => [
      { id: "P2", name: "Torre Norte", location: "northAmerica" },
      { id: "P1", name: "Edificio Centro", location: "europe" },
      { id: "P3", name: "Bodega 10", location: "northAmerica" },
    ],
    baseUrl: async () => "https://app.falso",
    proyecto: async (_b, id) => ({ id, name: "Edificio Centro", rootId: "raiz", createdOn: "" }),
    carpeta: async (_b, id) => carpetas[id],
    items: async (_b, id) => items[id] ?? [],
  };
}

test("muestra primero las carpetas y luego los archivos, cada grupo por nombre", () => {
  const r = ordenarItems([
    item("a2", "Plano 10.pdf", "FILE", { size: 2048, revision: 3 }),
    item("c1", "Modelos", "FOLDER"),
    item("a1", "Plano 2.pdf", "FILE", { size: 100, revision: 1 }),
    item("c0", "Actas", "FOLDER"),
  ]);
  assert.deepEqual(r.map((x) => x.nombre), ["Actas", "Modelos", "Plano 2.pdf", "Plano 10.pdf"]);
  assert.deepEqual(r[3], { id: "a2", nombre: "Plano 10.pdf", tipo: "archivo", tamano: 2048, revision: 3, modificado: "2026-10-02" });
  assert.equal(r[0].tamano, null);
});

test("la lista de proyectos pone primero el actual y luego los demás por nombre", async () => {
  const r = await listarProyectos(tcFalso({}, {}), "P2");
  assert.deepEqual(r.map((p) => p.nombre), ["Torre Norte", "Bodega 10", "Edificio Centro"]);
  assert.equal(r[0].actual, true);
  assert.equal(r[2].region, "europe");
});

test("la raíz se ve con el nombre del proyecto y la ruta baja hasta la carpeta abierta", async () => {
  const tc = tcFalso(
    {
      raiz: { id: "raiz", name: "P1-root", parentId: null, projectId: "P1", permission: "FULL_ACCESS", path: [] },
      planos: { id: "planos", name: "Planos", parentId: "raiz", projectId: "P1", permission: "READ", path: [{ id: "raiz", name: "P1-root" }] },
    },
    { planos: [item("a1", "EST-001.pdf", "FILE", { size: 10, revision: 2 })] }
  );
  const raiz = await verCarpeta(tc, "P1", null);
  assert.deepEqual(raiz.carpeta.ruta, [{ id: "raiz", nombre: "Edificio Centro" }]);
  assert.equal(raiz.carpeta.nombre, "Edificio Centro");
  const planos = await verCarpeta(tc, "P1", "planos");
  assert.deepEqual(planos.carpeta.ruta.map((p) => p.nombre), ["Edificio Centro", "Planos"]);
  assert.equal(planos.carpeta.permiso, "READ");
  assert.equal(planos.items.length, 1);
});

test("una carpeta de otro proyecto o un id mal escrito se rechazan", async () => {
  const tc = tcFalso({ ajena: { id: "ajena", name: "X", parentId: null, projectId: "P9", permission: "FULL_ACCESS", path: [] } }, {});
  await assert.rejects(() => verCarpeta(tc, "P1", "ajena"), /no es de este proyecto/);
  await assert.rejects(() => verCarpeta(tc, "P1", "../x"), /carpeta no es válida/);
});
