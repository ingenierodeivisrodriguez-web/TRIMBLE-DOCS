import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assignColors, CATEGORY_COLORS, OTHER_COLOR } from "./colors";
import { OTHER_KEY } from "./modelData";
import { pdfSafe } from "./pdfReport";
import { DEFAULT_REPORT_TITLE, parseReportSettings } from "./reportSettings";
import { addView, MAX_SAVED_VIEWS, parseViews, SavedView } from "./savedViews";

describe("assignColors", () => {
  it("gives categories the palette in order and 'Otros' gray", () => {
    const colors = assignColors([{ key: "a" }, { key: "b" }, { key: OTHER_KEY }]);
    assert.deepEqual(colors, [CATEGORY_COLORS[0], CATEGORY_COLORS[1], OTHER_COLOR]);
  });

  it("never repeats a hue: rows past the palette are gray", () => {
    const rows = Array.from({ length: CATEGORY_COLORS.length + 2 }, (_, i) => ({ key: `r${i}` }));
    const colors = assignColors(rows);
    assert.equal(new Set(colors.slice(0, CATEGORY_COLORS.length)).size, CATEGORY_COLORS.length);
    assert.deepEqual(colors.slice(CATEGORY_COLORS.length), [OTHER_COLOR, OTHER_COLOR]);
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
