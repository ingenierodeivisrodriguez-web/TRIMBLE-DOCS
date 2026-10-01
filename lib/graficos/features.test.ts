import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignColors, CATEGORY_COLORS, groupsByColor, OTHER_COLOR } from "./colors";
import { OTHER_KEY } from "./modelData";
import { pdfSafe } from "./pdfReport";
import { DEFAULT_REPORT_TITLE, parseReportSettings } from "./reportSettings";
import { addView, MAX_SAVED_VIEWS, parseViews, SavedView } from "./savedViews";

describe("assignColors", () => {
  it("gives categories the palette in order and 'Otros' gray", () => {
    const colors = assignColors([
      { key: "a", label: "a" },
      { key: "b", label: "b" },
      { key: OTHER_KEY, label: "Otros" },
    ]);
    assert.deepEqual(colors, [CATEGORY_COLORS[0], CATEGORY_COLORS[1], OTHER_COLOR]);
  });

  it("repeats the palette when there are more categories than colors: none is left gray", () => {
    const rows = Array.from({ length: CATEGORY_COLORS.length * 2 + 3 }, (_, i) => ({ key: `r${i}`, label: `r${i}` }));
    const colors = assignColors(rows);
    assert.ok(!colors.includes(OTHER_COLOR));
    colors.forEach((color, i) => assert.equal(color, CATEGORY_COLORS[i % CATEGORY_COLORS.length]));
  });

  it("by label, consecutive levels get different colors even when sorted by value", () => {
    // Bars sorted by value: the levels come out of order.
    const levels = [7, 1, 12, 3, 10, 2, 9, 4, 11, 5, 8, 6].map((n) => ({ key: `L${n}`, label: `Nivel ${n}` }));
    const colors = assignColors(levels, "labels");
    const colorOf = new Map(levels.map((l, i) => [l.label, colors[i]]));
    assert.equal(colorOf.get("Nivel 1"), CATEGORY_COLORS[0]);
    assert.equal(colorOf.get("Nivel 2"), CATEGORY_COLORS[1]);
    assert.equal(colorOf.get("Nivel 9"), CATEGORY_COLORS[0]);
    for (let n = 1; n < 12; n++) assert.notEqual(colorOf.get(`Nivel ${n}`), colorOf.get(`Nivel ${n + 1}`));
  });
});

describe("groupsByColor", () => {
  it("merges the categories that share a color, objects included", () => {
    const merged = groupsByColor([
      { color: "#111111", label: "Nivel 1", members: { m1: [1, 2] } },
      { color: "#222222", label: "Nivel 2", members: { m1: [3] } },
      { color: "#111111", label: "Nivel 9", members: { m1: [4], m2: [5] } },
    ]);
    assert.deepEqual(
      merged.map((g) => [g.color, g.labels]),
      [
        ["#111111", ["Nivel 1", "Nivel 9"]],
        ["#222222", ["Nivel 2"]],
      ]
    );
    assert.deepEqual(merged[0].members, { m1: [1, 2, 4], m2: [5] });
  });
});

function view(id: string, overrides: Partial<SavedView> = {}): SavedView {
  return {
    id,
    name: `Vista ${id}`,
    savedAt: "2026-09-25T10:00:00.000Z",
    models: [{ id: "m1", name: "Estructura.ifc" }],
    charts: [
      { type: "column", category: "@objectType", value: "Tekla · Weight", compareBy: null, periodA: null, periodB: null },
    ],
    slicers: [{ field: "Estado · CS Status", kind: "text", selected: ["Montado"] }],
    ...overrides,
  };
}

describe("saved views", () => {
  it("round-trips through JSON", () => {
    const views = [view("a"), view("b")];
    assert.deepEqual(parseViews(JSON.stringify(views)), views);
  });

  it("ignores missing, broken or foreign storage content", () => {
    assert.deepEqual(parseViews(null), []);
    assert.deepEqual(parseViews("{not json"), []);
    assert.deepEqual(parseViews(JSON.stringify({ hello: 1 })), []);
  });

  it("drops entries that don't look like views, keeping the good ones", () => {
    const json = JSON.stringify([view("a"), { id: 3 }, view("c", { charts: [{ type: "radar" }] as never })]);
    assert.deepEqual(
      parseViews(json).map((v) => v.id),
      ["a"]
    );
  });

  it("adds new views first and caps the history", () => {
    let views: SavedView[] = [];
    for (let i = 0; i < MAX_SAVED_VIEWS + 5; i++) views = addView(views, view(`v${i}`));
    assert.equal(views.length, MAX_SAVED_VIEWS);
    assert.equal(views[0].id, `v${MAX_SAVED_VIEWS + 4}`);
  });

  it("replaces a view saved again under the same id", () => {
    const views = addView([view("a"), view("b")], view("a", { name: "Nuevo nombre" }));
    assert.deepEqual(
      views.map((v) => [v.id, v.name]),
      [
        ["a", "Nuevo nombre"],
        ["b", "Vista b"],
      ]
    );
  });
});

describe("report settings", () => {
  it("falls back to defaults, with the signed-in user as author", () => {
    assert.deepEqual(parseReportSettings(null, "Ana Pérez"), {
      title: DEFAULT_REPORT_TITLE,
      company: "",
      preparedBy: "Ana Pérez",
      logo: null,
    });
    assert.equal(parseReportSettings("{broken", "Ana").preparedBy, "Ana");
  });

  it("keeps saved values and a valid logo", () => {
    const logo = { dataUrl: "data:image/png;base64,AAAA", width: 120, height: 40 };
    const saved = JSON.stringify({ title: "Informe mensual", company: "Constructora", preparedBy: "Luis", logo });
    assert.deepEqual(parseReportSettings(saved, "Ana"), {
      title: "Informe mensual",
      company: "Constructora",
      preparedBy: "Luis",
      logo,
    });
  });

  it("drops a logo that isn't an embedded PNG/JPEG image", () => {
    const saved = JSON.stringify({ logo: { dataUrl: "https://example.com/logo.svg", width: 1, height: 1 } });
    assert.equal(parseReportSettings(saved).logo, null);
  });
});

describe("pdfSafe", () => {
  it("keeps Spanish text and units, and swaps characters the PDF fonts lack", () => {
    assert.equal(pdfSafe("Volumen (m³) · Área (m²) — año"), "Volumen (m³) · Área (m²) - año");
    assert.equal(pdfSafe("Diferencia (B − A)…"), "Diferencia (B - A)...");
    assert.equal(pdfSafe("📅 Fecha"), " Fecha");
  });
});
