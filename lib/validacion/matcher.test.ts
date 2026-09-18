import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchName } from "./matcher";
import type { FieldRule, NameTemplate } from "./types";

function field(label: string, rule: FieldRule, required = true) {
  return { id: label, label, rule, required };
}

// The illustrative "Información No Gráfica" configuration from the spec.
const noGrafica: NameTemplate = {
  extensions: ["docx", "xlsx", "pdf"],
  fields: [
    field("Proyecto", { type: "list", values: ["SAT", "ODR", "NDB"] }),
    field("Disciplina", { type: "list", values: ["ARQ", "EST", "INS", "MEC"] }),
    field("Descripción", { type: "text", maxLength: 40 }),
  ],
  separators: ["_", "_"],
};

const codificado: NameTemplate = {
  extensions: ["rvt"],
  fields: [
    field("Proyecto", { type: "fixed", value: "ODR" }),
    field("Tipo", { type: "list", values: ["ARQ", "EST"] }),
    field("Número", { type: "number", length: 4 }),
    field("Descripción", { type: "text", maxLength: 30 }),
  ],
  separators: ["-", "-", "_"],
};

const textoAlMedio: NameTemplate = {
  extensions: ["pdf"],
  fields: [
    field("Proyecto", { type: "list", values: ["SAT"] }),
    field("Título", { type: "text", maxLength: 50 }),
    field("Revisión", { type: "number", length: 2 }),
  ],
  separators: ["_", "_"],
};

const conOpcional: NameTemplate = {
  extensions: ["pdf"],
  fields: [
    field("Proyecto", { type: "list", values: ["SAT", "ODR"] }),
    field("Fase", { type: "list", values: ["E1", "E2"] }, false),
    field("Descripción", { type: "text", maxLength: 40 }),
  ],
  separators: ["_", "_"],
};

const messages = (base: string, template: NameTemplate) =>
  matchName(base, template).issues.map((i) => i.message);

describe("ejemplos del enunciado", () => {
  it("SAT_ARQ_DetallesCarpinteriaMecanica es CONFORME", () => {
    const result = matchName("SAT_ARQ_DetallesCarpinteriaMecanica", noGrafica);
    assert.equal(result.conforming, true);
    assert.deepEqual(result.issues, []);
  });

  it("SAT-ARQ-DetallesCarpinteria es NO CONFORME por separador (se esperaba '_' y se usó '-')", () => {
    const result = matchName("SAT-ARQ-DetallesCarpinteria", noGrafica);
    assert.equal(result.conforming, false);
    assert.equal(result.issues.length, 2);
    assert.ok(result.issues.every((i) => i.kind === "separator"));
    assert.match(result.issues[0].message, /se esperaba '_' y se encontró '-'/);
    assert.match(result.issues[0].message, /campo 1 \(Proyecto\) y el campo 2 \(Disciplina\)/);
    assert.match(result.issues[1].message, /campo 2 \(Disciplina\) y el campo 3 \(Descripción\)/);
  });

  it("SAT_XYZ_Detalles es NO CONFORME solo en Disciplina", () => {
    const result = matchName("SAT_XYZ_Detalles", noGrafica);
    assert.equal(result.conforming, false);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].fieldLabel, "Disciplina");
    assert.equal(
      result.issues[0].message,
      "Disciplina: se encontró 'XYZ', no está en la lista de códigos permitidos [ARQ, EST, INS, MEC]"
    );
  });
});

describe("campos faltantes", () => {
  it("falta el último campo", () => {
    assert.deepEqual(messages("SAT_ARQ", noGrafica), ["Falta el campo Descripción"]);
  });

  it("separador final sin campo", () => {
    assert.deepEqual(messages("SAT_ARQ_", noGrafica), ["Falta el campo Descripción"]);
  });

  it("nombre vacío: faltan todos los campos requeridos", () => {
    assert.deepEqual(messages("", noGrafica), [
      "Falta el campo Proyecto",
      "Falta el campo Disciplina",
      "Falta el campo Descripción",
    ]);
  });

  it("campo vacío entre dos separadores", () => {
    const result = matchName("SAT__Detalles", noGrafica);
    assert.equal(result.conforming, false);
    assert.equal(result.issues[0].kind, "missing");
    assert.equal(result.issues[0].fieldLabel, "Disciplina");
  });
});

describe("longitudes y valores", () => {
  it("texto libre: exactamente el máximo es válido, uno más no", () => {
    assert.equal(matchName(`SAT_ARQ_${"x".repeat(40)}`, noGrafica).conforming, true);
    const tooLong = matchName(`SAT_ARQ_${"x".repeat(41)}`, noGrafica);
    assert.equal(tooLong.conforming, false);
    assert.equal(tooLong.issues[0].kind, "length");
    assert.match(tooLong.issues[0].message, /máxima de 40 caracteres \(tiene 41\)/);
  });

  it("el texto libre puede contener el separador", () => {
    assert.equal(matchName("SAT_ARQ_Detalles_de_carpinteria_mecanica", noGrafica).conforming, true);
  });

  it("las listas distinguen mayúsculas y lo indican", () => {
    const result = matchName("SAT_arq_Detalles", noGrafica);
    assert.equal(result.conforming, false);
    assert.match(result.issues[0].message, /se parece a 'ARQ'/);
  });

  it("código fijo incorrecto", () => {
    assert.deepEqual(messages("XXX-ARQ-0001_Planta", codificado), [
      "Proyecto: se encontró 'XXX', se esperaba exactamente 'ODR'",
    ]);
  });

  it("número con longitud fija: correcto, corto y con letras", () => {
    assert.equal(matchName("ODR-ARQ-0001_Planta baja", codificado).conforming, true);
    assert.deepEqual(messages("ODR-ARQ-001_Planta", codificado), [
      "Número: se encontró '001'; debe tener exactamente 4 dígitos (tiene 3)",
    ]);
    assert.deepEqual(messages("ODR-ARQ-00A1_Planta", codificado), [
      "Número: se encontró '00A1'; debe contener solo dígitos",
    ]);
    assert.deepEqual(messages("ODR-ARQ-00012_Planta", codificado), [
      "Número: se encontró '00012'; debe tener exactamente 4 dígitos (tiene 5)",
    ]);
  });

  it("separador duplicado antes del texto", () => {
    const result = matchName("ODR-ARQ-0001__Planta", codificado);
    assert.equal(result.conforming, false);
    assert.match(result.issues[0].message, /empieza con el separador '_'/);
  });

  it("sin separador se culpa al valor, no al separador", () => {
    const result = matchName("SATARQ_Detalles", noGrafica);
    assert.equal(result.conforming, false);
    assert.equal(result.issues[0].fieldLabel, "Proyecto");
    assert.ok(result.issues.every((i) => i.kind !== "separator"));
  });
});

describe("texto libre en el medio (anclaje por ambos extremos)", () => {
  it("el texto ocupa lo que queda entre los campos exactos", () => {
    assert.equal(matchName("SAT_Plano de cimentacion_01", textoAlMedio).conforming, true);
    assert.equal(matchName("SAT_Plano_de_cimentacion_01", textoAlMedio).conforming, true);
  });

  it("falla el campo del extremo derecho", () => {
    const result = matchName("SAT_Plano_1A", textoAlMedio);
    assert.equal(result.conforming, false);
    assert.equal(result.issues[0].fieldLabel, "Revisión");
  });

  it("falta el campo del extremo derecho", () => {
    assert.equal(matchName("SAT_Plano", textoAlMedio).conforming, false);
  });
});

describe("campos opcionales", () => {
  it("con y sin el campo opcional", () => {
    assert.equal(matchName("SAT_E1_Detalles", conOpcional).conforming, true);
    assert.equal(matchName("SAT_Detalles", conOpcional).conforming, true);
  });

  it("un valor no listado en el opcional cae en el texto libre (queda conforme)", () => {
    assert.equal(matchName("SAT_E3_Detalles", conOpcional).conforming, true);
  });

  it("los campos requeridos siguen siendo obligatorios", () => {
    assert.equal(matchName("XYZ_E1_Detalles", conOpcional).conforming, false);
  });
});

describe("texto sobrante", () => {
  it("nombre más largo que la estructura sin campo de texto", () => {
    const soloCodigos: NameTemplate = {
      extensions: ["pdf"],
      fields: [
        field("Proyecto", { type: "fixed", value: "ODR" }),
        field("Número", { type: "number", length: 3 }),
      ],
      separators: ["-"],
    };
    assert.equal(matchName("ODR-123", soloCodigos).conforming, true);
    assert.equal(matchName("ODR-1234", soloCodigos).conforming, false);
    assert.equal(matchName("ODR-123-x", soloCodigos).conforming, false);
  });
});

describe("partes del análisis", () => {
  const slices = (base: string, template: NameTemplate) =>
    matchName(base, template).parts.map((p) => base.slice(p.start, p.end));

  it("divide un nombre conforme en sus campos", () => {
    const { parts } = matchName("SAT_ARQ_Detalles", noGrafica);
    assert.deepEqual(slices("SAT_ARQ_Detalles", noGrafica), ["SAT", "ARQ", "Detalles"]);
    assert.ok(parts.every((p) => p.ok));
  });

  it("marca el campo que falla", () => {
    const { parts } = matchName("SAT_XYZ_Detalles", noGrafica);
    assert.deepEqual(slices("SAT_XYZ_Detalles", noGrafica), ["SAT", "XYZ", "Detalles"]);
    assert.deepEqual(parts.map((p) => p.ok), [true, false, true]);
  });

  it("omite los campos opcionales ausentes", () => {
    const { parts } = matchName("SAT_Detalles", conOpcional);
    assert.deepEqual(parts.map((p) => p.fieldIndex), [0, 2]);
  });

  it("el texto del medio queda entre los campos anclados", () => {
    assert.deepEqual(slices("SAT_Plano de cimentacion_01", textoAlMedio), ["SAT", "Plano de cimentacion", "01"]);
  });
});
