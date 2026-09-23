import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FileRecord } from "../types";
import { filterDuplicateGroups, findDuplicates } from "./duplicates";

function file(name: string, folderPath: string, modifiedOn = "2026-01-01T00:00:00Z"): FileRecord {
  const idx = name.lastIndexOf(".");
  return {
    id: `id-${name}-${folderPath}`,
    name,
    ext: idx <= 0 || idx === name.length - 1 ? "sin-extension" : name.slice(idx + 1).toLowerCase(),
    size: 1000,
    modifiedOn,
    uploadedBy: "Test",
    folderPath,
    folderId: `folder-${folderPath}`,
    versionId: `v-${name}-${folderPath}`,
    version: 1,
  };
}

describe("findDuplicates", () => {
  it("groups files with the same name across different folders", () => {
    const files = [
      file("Planta-01.pdf", "A"),
      file("Planta-01.pdf", "B"),
      file("Detalle.dwg", "C"),
    ];
    const { summary, groups } = findDuplicates(files);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].name, "Planta-01.pdf");
    assert.equal(groups[0].count, 2);
    assert.equal(summary.groups, 1);
    assert.equal(summary.duplicateFiles, 2);
    assert.equal(summary.totalFiles, 3);
  });

  it("matches names case-insensitively", () => {
    const files = [file("Planta-01.PDF", "A"), file("planta-01.pdf", "B")];
    const { groups } = findDuplicates(files);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].count, 2);
  });

  it("does not treat a single copy as a duplicate", () => {
    const files = [file("Unico.pdf", "A")];
    const { summary, groups } = findDuplicates(files);
    assert.equal(groups.length, 0);
    assert.equal(summary.duplicateFiles, 0);
  });

  it("does not group files that only share the base name, not the extension", () => {
    const files = [file("Planta-01.pdf", "A"), file("Planta-01.dwg", "B")];
    const { groups } = findDuplicates(files);
    assert.equal(groups.length, 0);
  });

  it("flags only the newest copy as probably current, newest first", () => {
    const files = [
      file("Planta-01.pdf", "A", "2026-01-01T00:00:00Z"),
      file("Planta-01.pdf", "B", "2026-03-01T00:00:00Z"),
      file("Planta-01.pdf", "C", "2026-02-01T00:00:00Z"),
    ];
    const { groups } = findDuplicates(files);
    const [newest, mid, oldest] = groups[0].files;
    assert.equal(newest.folderPath, "B");
    assert.equal(mid.folderPath, "C");
    assert.equal(oldest.folderPath, "A");
    assert.equal(newest.probablyCurrent, true);
    assert.equal(mid.probablyCurrent, false);
    assert.equal(oldest.probablyCurrent, false);
  });

  it("flags no copy as probably current when the newest date is tied", () => {
    const files = [
      file("Planta-01.pdf", "A", "2026-01-01T00:00:00Z"),
      file("Planta-01.pdf", "B", "2026-01-01T00:00:00Z"),
    ];
    const { groups } = findDuplicates(files);
    assert.ok(groups[0].files.every((f) => f.probablyCurrent === false));
  });

  it("summarizes duplicate counts by extension, most frequent first", () => {
    const files = [
      file("A.pdf", "1"),
      file("A.pdf", "2"),
      file("B.pdf", "1"),
      file("B.pdf", "2"),
      file("B.pdf", "3"),
      file("C.dwg", "1"),
      file("C.dwg", "2"),
    ];
    const { summary } = findDuplicates(files);
    assert.deepEqual(summary.byExt, [
      { ext: "pdf", count: 5 },
      { ext: "dwg", count: 2 },
    ]);
  });

  it("sorts groups by copy count, then name", () => {
    const files = [
      file("Zeta.pdf", "1"),
      file("Zeta.pdf", "2"),
      file("Alfa.pdf", "1"),
      file("Alfa.pdf", "2"),
      file("Alfa.pdf", "3"),
    ];
    const { groups } = findDuplicates(files);
    assert.deepEqual(
      groups.map((g) => g.name),
      ["Alfa.pdf", "Zeta.pdf"]
    );
  });
});

describe("filterDuplicateGroups", () => {
  const files = [
    file("Planta-01.pdf", "Arquitectura"),
    file("Planta-01.pdf", "Backup"),
    file("Modelo.rvt", "Estructura"),
    file("Modelo.rvt", "Backup"),
  ];
  const { groups } = findDuplicates(files);

  it("filters by extension", () => {
    assert.equal(filterDuplicateGroups(groups, { ext: "rvt" }).length, 1);
    assert.equal(filterDuplicateGroups(groups, { ext: "pdf" })[0].name, "Planta-01.pdf");
  });

  it("filters by free text across name and any copy's folder", () => {
    assert.equal(filterDuplicateGroups(groups, { q: "planta" }).length, 1);
    assert.equal(filterDuplicateGroups(groups, { q: "estructura" }).length, 1);
    assert.equal(filterDuplicateGroups(groups, { q: "backup" }).length, 2);
    assert.equal(filterDuplicateGroups(groups, { q: "no existe" }).length, 0);
  });

  it("returns every group with no filters", () => {
    assert.equal(filterDuplicateGroups(groups, {}).length, 2);
  });
});
