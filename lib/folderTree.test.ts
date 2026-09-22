import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTree, colorForLevel, LEVEL_COLORS, LEVEL_OVERFLOW_COLOR, normalizeForSearch } from "./folderTree";
import type { FileRecord, FolderNode } from "./types";

function file(id: string, name: string, folderId: string): FileRecord {
  return {
    id,
    name,
    ext: name.split(".").pop() ?? "",
    size: 100,
    modifiedOn: "2026-01-01T00:00:00Z",
    uploadedBy: "Alguien",
    folderPath: "",
    folderId,
    versionId: `${id}-v1`,
    version: 1,
  };
}

describe("buildTree", () => {
  const folders: FolderNode[] = [
    { id: "root", name: "Proyecto", parentId: null },
    { id: "planos", name: "Planos", parentId: "root" },
    { id: "estructura", name: "Estructura", parentId: "planos" },
    { id: "vacia", name: "Carpeta Vacia", parentId: "root" },
  ];
  const files: FileRecord[] = [
    file("f1", "a.pdf", "root"),
    file("f2", "b.rvt", "planos"),
    file("f3", "c.dwg", "estructura"),
    file("f4", "d.dwg", "estructura"),
  ];

  it("nests folders and files under the right parent", () => {
    const root = buildTree(folders, files);
    assert.equal(root.level, 0);
    assert.equal(root.fileCount, 4);

    const [vacia, planos] = root.children.filter((n) => n.kind === "folder") as any[];
    assert.equal(planos.name, "Planos");
    assert.equal(planos.level, 1);
    assert.equal(planos.fileCount, 3); // b.rvt + estructura's 2 files
    assert.equal(vacia.fileCount, 0);

    const estructura = planos.children.find((n: any) => n.kind === "folder" && n.name === "Estructura");
    assert.equal(estructura.level, 2);
    assert.equal(estructura.fileCount, 2);
  });

  it("sorts folders before files, alphabetically", () => {
    const root = buildTree(folders, files);
    const kinds = root.children.map((n) => n.kind);
    assert.deepEqual(kinds, ["folder", "folder", "file"]);
  });

  it("throws a clear error when no root folder is present", () => {
    assert.throws(() => buildTree([], []), /raiz/i);
  });
});

describe("colorForLevel", () => {
  it("returns the matching color for levels 1-6", () => {
    for (let level = 1; level <= 6; level++) {
      assert.equal(colorForLevel(level), LEVEL_COLORS[level - 1]);
    }
  });

  it("returns the overflow color for level 7 and beyond", () => {
    assert.equal(colorForLevel(7), LEVEL_OVERFLOW_COLOR);
    assert.equal(colorForLevel(20), LEVEL_OVERFLOW_COLOR);
  });
});

describe("normalizeForSearch", () => {
  it("is case- and accent-insensitive", () => {
    assert.equal(normalizeForSearch("Información"), normalizeForSearch("informacion"));
    assert.equal(normalizeForSearch("PLANO"), normalizeForSearch("plano"));
  });
});
