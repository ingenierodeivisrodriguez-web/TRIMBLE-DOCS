import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTree } from "./folderTree";
import { allFolderIds, flattenTree, searchTree } from "./folderTreeClient";
import type { FileRecord, FolderNode } from "./types";

function file(id: string, name: string, folderId: string): FileRecord {
  return {
    id,
    name,
    ext: name.split(".").pop() ?? "",
    size: 10,
    modifiedOn: "2026-01-01T00:00:00Z",
    uploadedBy: "Alguien",
    folderPath: "",
    folderId,
    versionId: `${id}-v1`,
    version: 1,
  };
}

const folders: FolderNode[] = [
  { id: "root", name: "Proyecto Demo", parentId: null },
  { id: "planos", name: "Planos", parentId: "root" },
  { id: "estructura", name: "Estructura", parentId: "planos" },
  { id: "contratos", name: "Contratos", parentId: "root" },
];
const files: FileRecord[] = [
  file("f1", "portada.pdf", "root"),
  file("f2", "vista-general.rvt", "planos"),
  file("f3", "detalle-columna.dwg", "estructura"),
];
const root = buildTree(folders, files);

describe("flattenTree", () => {
  it("shows only root's direct children when nothing is expanded", () => {
    const rows = flattenTree(root, new Set());
    assert.deepEqual(
      rows.map((r) => r.node.name),
      ["Contratos", "Planos", "portada.pdf"]
    );
    assert.equal(rows[0].depth, 1);
  });

  it("reveals a folder's own children once it is expanded", () => {
    const rows = flattenTree(root, new Set(["planos"]));
    const names = rows.map((r) => r.node.name);
    assert.ok(names.includes("Estructura"));
    assert.ok(names.includes("vista-general.rvt"));
    assert.ok(!names.includes("detalle-columna.dwg")); // "estructura" itself not expanded
  });

  it("carries the project root as the first ancestor for top-level nodes", () => {
    const rows = flattenTree(root, new Set());
    const contratos = rows.find((r) => r.node.name === "Contratos")!;
    assert.deepEqual(contratos.ancestors, [{ id: "root", name: "Proyecto Demo" }]);
  });
});

describe("allFolderIds", () => {
  it("lists every folder id regardless of nesting", () => {
    assert.deepEqual(new Set(allFolderIds(root)), new Set(["planos", "estructura", "contratos"]));
  });
});

describe("searchTree", () => {
  it("finds matches case- and accent-insensitively", () => {
    const matches = searchTree(root, "ESTRUCTURA");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].kind, "folder");
    assert.deepEqual(matches[0].pathIds, ["planos"]);
  });

  it("finds files too, wherever they are nested", () => {
    const matches = searchTree(root, "columna");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].name, "detalle-columna.dwg");
    assert.deepEqual(matches[0].pathIds, ["planos", "estructura"]);
  });

  it("returns nothing for a blank query", () => {
    assert.deepEqual(searchTree(root, "   "), []);
  });
});
