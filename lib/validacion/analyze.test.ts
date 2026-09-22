import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FileRecord } from "../types";
import { analyzeFiles, evaluateName, splitFileName } from "./analyze";
import { filterNonConforming, filterUnclassified } from "./filter";
import { buildSampleBaseName, defaultConfig, isConfigured, parseConfig, validateConfig } from "./config";
import { matchName } from "./matcher";
import type { FieldRule, ValidationConfig } from "./types";

function field(label: string, rule: FieldRule, required = true) {
  return { id: label, label, rule, required };
}

function file(name: string, folderPath = "Raíz"): FileRecord {
  const idx = name.lastIndexOf(".");
  return {
    id: `id-${name}`,
    name,
    ext: idx <= 0 || idx === name.length - 1 ? "sin-extension" : name.slice(idx + 1).toLowerCase(),
    size: 1,
    modifiedOn: "2026-01-01T00:00:00Z",
    uploadedBy: "Test",
    folderPath,
    folderId: "root",
    versionId: `v-${name}`,
    version: 1,
  };
}

const config: ValidationConfig = {
  version: 1,
  updatedAt: "2026-09-18T00:00:00Z",
  nonGraphic: {
    extensions: ["docx", "xlsx", "pdf"],
    fields: [
      field("Proyecto", { type: "list", values: ["SAT", "ODR", "NDB"] }),
      field("Disciplina", { type: "list", values: ["ARQ", "EST", "INS", "MEC"] }),
      field("Descripción", { type: "text", maxLength: 40 }),
    ],
    separators: ["_", "_"],
  },
  graphic: {
    extensions: ["rvt", "dwg"],
    fields: [
      field("Proyecto", { type: "fixed", value: "ODR" }),
      field("Número", { type: "number", length: 3 }),
    ],
    separators: ["-"],
  },
};

describe("analyzeFiles", () => {
  const files = [
    file("SAT_ARQ_DetallesCarpinteriaMecanica.pdf", "A"),
    file("SAT-ARQ-DetallesCarpinteria.pdf", "A"),
    file("SAT_XYZ_Detalles.PDF", "B"),
    file("ODR-001.rvt", "C"),
    file("ODR-01.rvt", "C"),
    file("bitacora.json", "D"),
    file("LEEME", "D"),
    file("plano.v2.dwg", "E"),
  ];
  const result = analyzeFiles(files, config);

  it("clasifica por extensión sin distinguir mayúsculas", () => {
    assert.equal(result.summary.templates.nonGraphic.total, 3);
    assert.equal(result.summary.templates.graphic.total, 3);
  });

  it("cuenta conformes y no conformes por plantilla", () => {
    assert.equal(result.summary.templates.nonGraphic.conforming, 1);
    assert.equal(result.summary.templates.nonGraphic.nonConforming, 2);
    assert.equal(result.summary.templates.graphic.conforming, 1);
    assert.equal(result.summary.templates.graphic.nonConforming, 2);
    assert.equal(result.summary.totals.conforming, 2);
    assert.equal(result.summary.totals.classified, 6);
  });

  it("las extensiones sin plantilla (y los archivos sin extensión) quedan sin clasificar", () => {
    assert.equal(result.summary.totals.unclassified, 2);
    assert.deepEqual(
      result.unclassified.map((f) => f.name),
      ["bitacora.json", "LEEME"]
    );
    assert.deepEqual(
      result.summary.unclassifiedByExt.map((e) => e.ext).sort(),
      ["json", "sin-extension"]
    );
  });

  it("valida el nombre sin la extensión (aunque el nombre tenga otros puntos)", () => {
    const row = result.nonConforming.find((r) => r.name === "plano.v2.dwg");
    assert.ok(row);
    assert.equal(row.template, "graphic");
    assert.equal(row.issues[0].fieldLabel, "Proyecto");
  });

  it("lista los no conformes ordenados por carpeta y nombre", () => {
    assert.deepEqual(
      result.nonConforming.map((r) => r.name),
      ["SAT-ARQ-DetallesCarpinteria.pdf", "SAT_XYZ_Detalles.PDF", "ODR-01.rvt", "plano.v2.dwg"]
    );
  });

  it("una extensión repetida en ambas plantillas se resuelve a la Gráfica sin fallar", () => {
    const both: ValidationConfig = {
      ...config,
      nonGraphic: { ...config.nonGraphic, extensions: ["rvt", "pdf"] },
    };
    assert.doesNotThrow(() => analyzeFiles(files, both));
  });
});

describe("configuración", () => {
  it("la configuración vacía no está lista para analizar", () => {
    assert.equal(isConfigured(defaultConfig()), false);
    assert.equal(isConfigured(config), true);
  });

  it("rechaza un segundo campo de texto libre y explica por qué", () => {
    const twoTexts: ValidationConfig = structuredClone(config);
    twoTexts.nonGraphic.fields[1] = field("Otro", { type: "text", maxLength: 10 });
    const errors = validateConfig(twoTexts);
    assert.ok(errors.some((e) => /Solo se permite un campo de texto libre/.test(e)));
  });

  it("rechaza extensiones repetidas entre plantillas", () => {
    const overlap: ValidationConfig = structuredClone(config);
    overlap.graphic.extensions.push("pdf");
    assert.ok(validateConfig(overlap).some((e) => /ambas plantillas/.test(e)));
  });

  it("exige un separador entre cada par de campos y que ninguno esté vacío", () => {
    const bad: ValidationConfig = structuredClone(config);
    bad.nonGraphic.separators = ["_"];
    assert.ok(validateConfig(bad).some((e) => /exactamente un separador/.test(e)));
    bad.nonGraphic.separators = ["_", ""];
    assert.ok(validateConfig(bad).some((e) => /entre 1 y/.test(e)));
  });

  it("exige valores en las reglas", () => {
    const bad: ValidationConfig = structuredClone(config);
    bad.nonGraphic.fields[0] = field("Proyecto", { type: "list", values: [] });
    bad.graphic.fields[0] = field("Proyecto", { type: "fixed", value: "" });
    bad.graphic.fields[1] = field("Número", { type: "number", length: 0 });
    const errors = validateConfig(bad);
    assert.ok(errors.some((e) => /al menos un valor permitido/.test(e)));
    assert.ok(errors.some((e) => /código fijo/.test(e)));
    assert.ok(errors.some((e) => /dígitos/.test(e)));
  });

  it("parseConfig normaliza extensiones y descarta basura", () => {
    const { config: parsed, errors } = parseConfig({
      graphic: { extensions: [" .RVT ", "rvt", 5], fields: [], separators: [] },
      nonGraphic: {
        extensions: ["pdf"],
        fields: [{ id: "a", label: " Proyecto ", rule: { type: "list", values: [" SAT ", "SAT", ""] } }],
        separators: [],
      },
      updatedAt: 123,
    });
    assert.deepEqual(parsed.graphic.extensions, ["rvt"]);
    assert.deepEqual(parsed.nonGraphic.fields[0].rule, { type: "list", values: ["SAT"] });
    assert.equal(parsed.nonGraphic.fields[0].label, "Proyecto");
    assert.equal(parsed.nonGraphic.fields[0].required, true);
    assert.equal(parsed.updatedAt, null);
    // "rvt" was assigned but the Gráfica template has no fields yet.
    assert.ok(errors.some((e) => /define al menos un campo/.test(e)));
  });

  it("parseConfig informa reglas desconocidas", () => {
    const { errors } = parseConfig({
      graphic: { extensions: [], fields: [{ label: "X", rule: { type: "regex" } }], separators: [] },
    });
    assert.ok(errors.some((e) => /tipo de regla desconocido/.test(e)));
  });
});

describe("vista previa", () => {
  it("el nombre de ejemplo generado siempre cumple la propia plantilla", () => {
    for (const key of ["graphic", "nonGraphic"] as const) {
      const base = buildSampleBaseName(config[key]);
      assert.equal(matchName(base, config[key]).conforming, true, `${key}: ${base}`);
    }
    assert.equal(buildSampleBaseName(config.nonGraphic), "SAT_ARQ_DescripcionDelArchivo");
    assert.equal(buildSampleBaseName(config.graphic), "ODR-001");
  });
});

describe("filtros y motivos frecuentes", () => {
  const files = [
    file("SAT-ARQ-Detalles.pdf", "A"),
    file("SAT_XYZ_Detalles.pdf", "A"),
    file("SAT_XYZ_Otros.docx", "B"),
    file("ODR-01.rvt", "C"),
    file("bitacora.json", "D"),
    file("datos.json", "D"),
    file("LEEME", "E"),
  ];
  const result = analyzeFiles(files, config);

  it("cuenta en cuántos archivos falla cada campo", () => {
    const counts = Object.fromEntries(result.summary.issueCounts.map((c) => [c.fieldLabel, c.count]));
    assert.equal(counts["Disciplina"], 2);
    assert.equal(counts["Número"], 1);
    assert.equal(counts["Separador entre «Proyecto» y «Disciplina»"], 1);
    assert.equal(result.summary.issueCounts[0].fieldLabel, "Disciplina");
  });

  it("filtra los no conformes por plantilla, campo y texto", () => {
    assert.equal(filterNonConforming(result.nonConforming, { template: "graphic" }).length, 1);
    assert.equal(filterNonConforming(result.nonConforming, { template: "nonGraphic" }).length, 3);
    assert.equal(filterNonConforming(result.nonConforming, { field: "Disciplina" }).length, 2);
    assert.equal(filterNonConforming(result.nonConforming, { q: "otros" }).length, 1);
    assert.equal(filterNonConforming(result.nonConforming, { q: "LISTA DE CÓDIGOS" }).length, 2);
    assert.equal(filterNonConforming(result.nonConforming, {}).length, 4);
  });

  it("filtra los sin clasificar por extensión y texto", () => {
    assert.equal(filterUnclassified(result.unclassified, { ext: "json" }).length, 2);
    assert.equal(filterUnclassified(result.unclassified, { ext: "sin-extension" }).length, 1);
    assert.equal(filterUnclassified(result.unclassified, { q: "bit" }).length, 1);
  });
});

describe("evaluateName (probador en vivo)", () => {
  it("separa nombre y extensión como el recorrido de carpetas", () => {
    assert.deepEqual(splitFileName("a.b.PDF"), { base: "a.b", ext: "pdf" });
    assert.deepEqual(splitFileName("LEEME"), { base: "LEEME", ext: "sin-extension" });
    assert.deepEqual(splitFileName(".gitignore"), { base: ".gitignore", ext: "sin-extension" });
    assert.deepEqual(splitFileName("archivo."), { base: "archivo.", ext: "sin-extension" });
  });

  it("evalúa con la plantilla de la extensión", () => {
    const ok = evaluateName("SAT_ARQ_Detalles.pdf", config);
    assert.equal(ok.kind, "conforming");
    const bad = evaluateName("SAT_XYZ_Detalles.PDF", config);
    assert.equal(bad.kind, "nonconforming");
    assert.equal(bad.kind === "nonconforming" && bad.template, "nonGraphic");
    assert.equal(evaluateName("ODR-001.rvt", config).kind, "conforming");
  });

  it("sin plantilla para la extensión queda sin clasificar", () => {
    assert.deepEqual(evaluateName("bitacora.json", config), { kind: "unclassified", ext: "json" });
    assert.deepEqual(evaluateName("LEEME", config), { kind: "unclassified", ext: "sin-extension" });
  });
});
