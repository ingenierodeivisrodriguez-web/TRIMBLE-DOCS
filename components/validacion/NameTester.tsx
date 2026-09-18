"use client";

import { useMemo, useState } from "react";
import Card from "../Card";
import { evaluateName, NameEvaluation } from "../../lib/validacion/analyze";
import { buildSampleBaseName } from "../../lib/validacion/config";
import {
  MatchPart,
  NameTemplate,
  TEMPLATE_KEYS,
  TEMPLATE_TITLES,
  ValidationConfig,
} from "../../lib/validacion/types";
import { inputStyle, secondaryButtonStyle } from "./ui";

const MAX_LINES = 40;

/**
 * Live tester: type or paste file names and see, as you type, which template
 * each one falls under, whether it conforms, and how it was split into fields.
 * It evaluates the config being edited (even if not saved yet), so a rule can
 * be checked before it is saved.
 */
export default function NameTester({ config }: { config: ValidationConfig }) {
  const [text, setText] = useState("");

  const lines = useMemo(
    () =>
      text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .slice(0, MAX_LINES),
    [text]
  );
  const evaluations = useMemo(
    () => lines.map((line) => ({ line, evaluation: evaluateName(line, config) })),
    [lines, config]
  );

  const insertExamples = () => {
    const examples = TEMPLATE_KEYS.filter((key) => config[key].fields.length > 0).map(
      (key) => `${buildSampleBaseName(config[key])}.${config[key].extensions[0] ?? "ext"}`
    );
    setText(examples.join("\n"));
  };

  return (
    <Card title="Probador de nombres">
      <p style={{ margin: "0 0 10px", color: "var(--tc-gray-700)", fontSize: 14, lineHeight: 1.5 }}>
        Escribe o pega nombres de archivo <strong>con su extensión</strong> (uno por línea) y verás al
        instante cómo los evaluaría la configuración de arriba, aunque todavía no la hayas guardado.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        spellCheck={false}
        placeholder={"SAT_ARQ_DetallesCarpinteriaMecanica.pdf\nSAT-ARQ-DetallesCarpinteria.pdf"}
        style={{ ...inputStyle, width: "100%", fontFamily: "Consolas, monospace", resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" style={secondaryButtonStyle} onClick={insertExamples}>
          Insertar ejemplos de mis plantillas
        </button>
        {text && (
          <button type="button" style={secondaryButtonStyle} onClick={() => setText("")}>
            Borrar
          </button>
        )}
      </div>

      {evaluations.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          {evaluations.map(({ line, evaluation }, i) => (
            <EvaluationRow key={`${i}-${line}`} fileName={line} evaluation={evaluation} config={config} />
          ))}
          {text.split(/\r?\n/).filter((l) => l.trim()).length > MAX_LINES && (
            <div style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>
              Se muestran solo las primeras {MAX_LINES} líneas.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function EvaluationRow({
  fileName,
  evaluation,
  config,
}: {
  fileName: string;
  evaluation: NameEvaluation;
  config: ValidationConfig;
}) {
  const badge =
    evaluation.kind === "conforming"
      ? { text: "CONFORME", background: "var(--tc-blue-600)", color: "var(--tc-white)" }
      : evaluation.kind === "nonconforming"
        ? { text: "NO CONFORME", background: "#d9822b", color: "var(--tc-white)" }
        : { text: "SIN CLASIFICAR", background: "var(--tc-gray-300)", color: "var(--tc-gray-700)" };

  return (
    <div
      style={{
        border: "1px solid var(--tc-gray-300)",
        borderLeft: `4px solid ${badge.background}`,
        borderRadius: 8,
        padding: "10px 12px",
        background: "var(--tc-white)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <span
          style={{
            background: badge.background,
            color: badge.color,
            borderRadius: 999,
            padding: "2px 10px",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.4,
          }}
        >
          {badge.text}
        </span>
        {evaluation.kind !== "unclassified" ? (
          <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>
            Plantilla: {TEMPLATE_TITLES[evaluation.template]}
          </span>
        ) : (
          <span style={{ fontSize: 12, color: "var(--tc-gray-500)" }}>
            {evaluation.ext === "sin-extension"
              ? "El nombre no tiene extensión."
              : `La extensión .${evaluation.ext} no está asignada a ninguna plantilla.`}
          </span>
        )}
      </div>

      {evaluation.kind === "unclassified" ? (
        <div style={{ fontFamily: "Consolas, monospace", fontSize: 15, marginTop: 8, wordBreak: "break-all" }}>
          {fileName}
        </div>
      ) : (
        <>
          <Breakdown
            base={evaluation.base}
            ext={evaluation.ext}
            template={config[evaluation.template]}
            parts={evaluation.result.parts}
          />
          {evaluation.result.issues.length > 0 && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, color: "#8a1c14" }}>
              {evaluation.result.issues.map((issue, i) => (
                <li key={i}>{issue.message}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** The name split into its fields (colored, labelled) with separators and the extension in between. */
function Breakdown({
  base,
  ext,
  template,
  parts,
}: {
  base: string;
  ext: string;
  template: NameTemplate;
  parts: MatchPart[];
}) {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let previous: MatchPart | null = null;

  parts.forEach((part, index) => {
    if (part.start > cursor) {
      const found = base.slice(cursor, part.start);
      const expected = previous ? template.separators[previous.fieldIndex] : undefined;
      nodes.push(
        <Piece key={`sep-${index}`} text={found} label="sep." tone={found === expected ? "separator" : "bad"} />
      );
    }
    nodes.push(
      <Piece
        key={`field-${index}`}
        text={base.slice(part.start, part.end) || "∅"}
        label={template.fields[part.fieldIndex]?.label || "campo"}
        tone={part.ok ? "field" : "bad"}
      />
    );
    cursor = part.end;
    previous = part;
  });
  if (cursor < base.length) {
    nodes.push(<Piece key="rest" text={base.slice(cursor)} label="sobrante" tone="bad" />);
  }
  nodes.push(<Piece key="ext" text={`.${ext}`} label="ext." tone="ext" />);

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 2, marginTop: 8 }}>
      {nodes}
    </div>
  );
}

const TONES = {
  field: { background: "var(--tc-blue-100)", color: "var(--tc-blue-900)" },
  separator: { background: "#fff1d6", color: "#7a5300" },
  bad: { background: "#fdecea", color: "#8a1c14", outline: "1px solid #e5a29c" },
  ext: { background: "transparent", color: "var(--tc-gray-500)" },
} satisfies Record<string, React.CSSProperties>;

function Piece({ text, label, tone }: { text: string; label: string; tone: keyof typeof TONES }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
      <span
        style={{
          fontFamily: "Consolas, monospace",
          fontSize: 15,
          whiteSpace: "pre",
          padding: "2px 4px",
          borderRadius: 4,
          ...TONES[tone],
        }}
      >
        {text}
      </span>
      <span style={{ fontSize: 10, color: "var(--tc-gray-500)", marginTop: 2 }}>{label}</span>
    </span>
  );
}
