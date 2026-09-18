"use client";

import { useEffect, useState } from "react";
import Card from "../Card";
import {
  buildSampleSegments,
  DEFAULT_SEPARATOR,
  defaultRule,
  hasTextField,
  isValidExtension,
  MAX_FIELDS,
  MAX_NUMBER_LENGTH,
  MAX_SEPARATOR_LENGTH,
  MAX_TEXT_LENGTH,
  newFieldId,
  normalizeExtension,
  PDF_GRAPHIC_WARNING,
  TEXT_FIELD_LIMIT_EXPLANATION,
} from "../../lib/validacion/config";
import {
  FieldRuleType,
  NameTemplate,
  TEMPLATE_TITLES,
  TemplateField,
  TemplateKey,
} from "../../lib/validacion/types";
import {
  iconButtonStyle,
  inputStyle,
  noticeBase,
  noticeStyles,
  secondaryButtonStyle,
  smallLabelStyle,
} from "./ui";

const RULE_LABELS: Record<FieldRuleType, string> = {
  fixed: "Código fijo",
  list: "Lista de valores permitidos",
  text: "Texto libre (longitud máxima)",
  number: "Número (longitud fija)",
};

function parseList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,;\n]+/)
        .map((v) => v.trim())
        .filter((v) => v.length > 0)
    ),
  ];
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Comma-separated list input that keeps what the user is typing (commas, trailing spaces). */
function ListValuesInput({
  values,
  onChange,
}: {
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [text, setText] = useState(values.join(", "));

  useEffect(() => {
    setText((current) => (sameList(parseList(current), values) ? current : values.join(", ")));
  }, [values]);

  return (
    <input
      type="text"
      value={text}
      placeholder="Ej.: ARQ, EST, INS, MEC"
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseList(e.target.value));
      }}
      style={{ ...inputStyle, width: "100%" }}
    />
  );
}

function IntegerInput({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={Number.isFinite(value) ? value : ""}
      onChange={(e) => onChange(e.target.value === "" ? NaN : Math.trunc(Number(e.target.value)))}
      style={{ ...inputStyle, width: 110 }}
    />
  );
}

export default function TemplateEditor({
  templateKey,
  template,
  otherTemplate,
  onChange,
  onMoveFromOther,
}: {
  templateKey: TemplateKey;
  template: NameTemplate;
  otherTemplate: NameTemplate;
  onChange: (template: NameTemplate) => void;
  /** Moves an extension from the other template into this one. */
  onMoveFromOther: (ext: string) => void;
}) {
  const title = TEMPLATE_TITLES[templateKey];
  const otherTitle = TEMPLATE_TITLES[templateKey === "graphic" ? "nonGraphic" : "graphic"];
  const [extensionText, setExtensionText] = useState("");
  const [extensionMessage, setExtensionMessage] = useState("");
  // Extensions the admin tried to add that currently belong to the other template.
  const [pendingMoves, setPendingMoves] = useState<string[]>([]);
  const [showTextLimit, setShowTextLimit] = useState(false);

  const update = (patch: Partial<NameTemplate>) => onChange({ ...template, ...patch });

  // ---- extensions --------------------------------------------------------

  function addExtensions(raw: string) {
    const parts = raw.split(/[\s,;]+/).map(normalizeExtension).filter((e) => e.length > 0);
    // Blur + click can both fire for one action; an empty call must not wipe the messages.
    if (parts.length === 0) return;

    const next = [...template.extensions];
    const messages: string[] = [];
    const moves: string[] = [];
    for (const ext of parts) {
      if (!isValidExtension(ext)) {
        messages.push(`'${ext}' no es una extensión válida (solo letras, números, guion y guion bajo).`);
      } else if (next.includes(ext)) {
        continue;
      } else if (otherTemplate.extensions.includes(ext)) {
        moves.push(ext);
      } else {
        next.push(ext);
      }
    }
    if (next.length !== template.extensions.length) update({ extensions: next });
    setExtensionMessage(messages.join(" "));
    setPendingMoves(moves);
    setExtensionText("");
  }

  const removeExtension = (ext: string) =>
    update({ extensions: template.extensions.filter((e) => e !== ext) });

  // ---- fields --------------------------------------------------------------

  const setField = (index: number, patch: Partial<TemplateField>) =>
    update({ fields: template.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)) });

  function changeType(index: number, type: FieldRuleType) {
    const field = template.fields[index];
    if (type === "text" && hasTextField(template, field.id)) {
      setShowTextLimit(true);
      return;
    }
    setShowTextLimit(false);
    setField(index, { rule: defaultRule(type) });
  }

  function addField() {
    if (template.fields.length >= MAX_FIELDS) return;
    const n = template.fields.length;
    update({
      fields: [
        ...template.fields,
        { id: newFieldId(), label: `Campo ${n + 1}`, rule: defaultRule("list"), required: true },
      ],
      separators: n > 0 ? [...template.separators, DEFAULT_SEPARATOR] : [],
    });
  }

  function removeField(index: number) {
    const fields = template.fields.filter((_, i) => i !== index);
    // Drop the separator that followed the field (or the one before it, if it was the last).
    const dropped = index < template.separators.length ? index : index - 1;
    update({
      fields,
      separators: fields.length > 1 ? template.separators.filter((_, i) => i !== dropped) : [],
    });
    setShowTextLimit(false);
  }

  function moveField(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= template.fields.length) return;
    const fields = [...template.fields];
    [fields[index], fields[target]] = [fields[target], fields[index]];
    update({ fields });
  }

  const setSeparator = (index: number, value: string) =>
    update({ separators: template.separators.map((s, i) => (i === index ? value : s)) });

  const pdfInGraphic = templateKey === "graphic" && template.extensions.includes("pdf");
  const sample = buildSampleSegments(template);

  return (
    <Card title={title}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/* Extensions */}
        <section>
          <label style={smallLabelStyle}>Extensiones de archivo asignadas</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {template.extensions.length === 0 && (
              <span style={{ color: "var(--tc-gray-500)", fontSize: 13 }}>
                Ninguna extensión asignada todavía.
              </span>
            )}
            {template.extensions.map((ext) => (
              <span key={ext} style={chipStyle}>
                .{ext}
                <button
                  type="button"
                  aria-label={`Quitar ${ext}`}
                  onClick={() => removeExtension(ext)}
                  style={chipRemoveStyle}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              value={extensionText}
              placeholder="Ej.: rvt, dwg, ifc"
              onChange={(e) => setExtensionText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addExtensions(extensionText);
                }
              }}
              onBlur={() => extensionText.trim() && addExtensions(extensionText)}
              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            />
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => addExtensions(extensionText)}
            >
              Agregar
            </button>
          </div>
          {extensionMessage && (
            <div style={{ ...noticeBase, ...noticeStyles.info, marginTop: 8 }}>{extensionMessage}</div>
          )}
          {pendingMoves
            .filter((ext) => otherTemplate.extensions.includes(ext))
            .map((ext) => (
              <div key={ext} style={{ ...noticeBase, ...noticeStyles.info, marginTop: 8 }}>
                <strong>.{ext}</strong> ya está asignada a «{otherTitle}». Una extensión solo puede
                pertenecer a una plantilla.{" "}
                <button
                  type="button"
                  style={{ ...secondaryButtonStyle, padding: "3px 10px", marginLeft: 4 }}
                  onClick={() => {
                    onMoveFromOther(ext);
                    setPendingMoves((moves) => moves.filter((m) => m !== ext));
                  }}
                >
                  Moverla a «{title}»
                </button>
              </div>
            ))}
          {pdfInGraphic && (
            <div style={{ ...noticeBase, ...noticeStyles.warning, marginTop: 8 }}>
              <strong>Advertencia: PDF en «Información Gráfica».</strong> {PDF_GRAPHIC_WARNING}{" "}
              <button
                type="button"
                style={{ ...secondaryButtonStyle, padding: "3px 10px", marginLeft: 4 }}
                onClick={() => removeExtension("pdf")}
              >
                Quitar pdf
              </button>
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--tc-gray-500)", marginTop: 6 }}>
            Los archivos con una extensión que no esté en ninguna de las dos plantillas se listan como
            «Sin clasificar / Requiere revisión».
          </div>
        </section>

        {/* Fields */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <label style={smallLabelStyle}>Campos del nombre (sin la extensión), en orden</label>
            <span
              style={{ fontSize: 12, color: "var(--tc-gray-500)" }}
              title={TEXT_FIELD_LIMIT_EXPLANATION}
            >
              Máx. 1 campo de texto libre
            </span>
          </div>

          {showTextLimit && (
            <div style={{ ...noticeBase, ...noticeStyles.warning, marginBottom: 10 }}>
              <strong>No se puede agregar un segundo campo de texto libre.</strong>{" "}
              {TEXT_FIELD_LIMIT_EXPLANATION}{" "}
              <button
                type="button"
                style={{ ...secondaryButtonStyle, padding: "3px 10px" }}
                onClick={() => setShowTextLimit(false)}
              >
                Entendido
              </button>
            </div>
          )}

          {template.fields.length === 0 && (
            <div style={{ color: "var(--tc-gray-500)", fontSize: 13, margin: "6px 0 10px" }}>
              Aún no hay campos. Agrega el primero para definir cómo se arma el nombre.
            </div>
          )}

          {template.fields.map((field, index) => (
            <div key={field.id}>
              {index > 0 && (
                <div style={separatorRowStyle}>
                  <span>
                    Separador entre el campo {index} y el campo {index + 1}
                  </span>
                  <input
                    type="text"
                    value={template.separators[index - 1] ?? ""}
                    maxLength={MAX_SEPARATOR_LENGTH}
                    onChange={(e) => setSeparator(index - 1, e.target.value)}
                    aria-label={`Separador entre el campo ${index} y el campo ${index + 1}`}
                    style={{
                      ...inputStyle,
                      width: 64,
                      textAlign: "center",
                      fontFamily: "Consolas, monospace",
                    }}
                  />
                </div>
              )}
              <div style={fieldRowStyle}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
                  <span style={indexBadgeStyle}>{index + 1}</span>
                  <div style={{ flex: "1 1 150px" }}>
                    <label style={smallLabelStyle}>Nombre del campo</label>
                    <input
                      type="text"
                      value={field.label}
                      placeholder="Ej.: Proyecto"
                      onChange={(e) => setField(index, { label: e.target.value })}
                      style={{ ...inputStyle, width: "100%" }}
                    />
                  </div>
                  <div style={{ flex: "1 1 190px" }}>
                    <label style={smallLabelStyle}>Tipo de regla</label>
                    <select
                      value={field.rule.type}
                      onChange={(e) => changeType(index, e.target.value as FieldRuleType)}
                      style={{ ...inputStyle, width: "100%" }}
                    >
                      {(Object.keys(RULE_LABELS) as FieldRuleType[]).map((type) => (
                        <option key={type} value={type}>
                          {RULE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={smallLabelStyle}>Presencia</label>
                    <select
                      value={field.required ? "required" : "optional"}
                      onChange={(e) => setField(index, { required: e.target.value === "required" })}
                      style={inputStyle}
                    >
                      <option value="required">Obligatorio</option>
                      <option value="optional">Opcional</option>
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      type="button"
                      title="Subir"
                      aria-label="Subir campo"
                      disabled={index === 0}
                      onClick={() => moveField(index, -1)}
                      style={{ ...iconButtonStyle, opacity: index === 0 ? 0.4 : 1 }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      title="Bajar"
                      aria-label="Bajar campo"
                      disabled={index === template.fields.length - 1}
                      onClick={() => moveField(index, 1)}
                      style={{
                        ...iconButtonStyle,
                        opacity: index === template.fields.length - 1 ? 0.4 : 1,
                      }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      title="Quitar campo"
                      aria-label="Quitar campo"
                      onClick={() => removeField(index)}
                      style={{ ...iconButtonStyle, color: "#b3261e" }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 10 }}>
                  {field.rule.type === "fixed" && (
                    <>
                      <label style={smallLabelStyle}>El campo debe ser exactamente</label>
                      <input
                        type="text"
                        value={field.rule.value}
                        placeholder="Ej.: ODR"
                        onChange={(e) => setField(index, { rule: { type: "fixed", value: e.target.value } })}
                        style={{ ...inputStyle, width: 220 }}
                      />
                    </>
                  )}
                  {field.rule.type === "list" && (
                    <>
                      <label style={smallLabelStyle}>Códigos permitidos (separados por coma)</label>
                      <ListValuesInput
                        values={field.rule.values}
                        onChange={(values) => setField(index, { rule: { type: "list", values } })}
                      />
                    </>
                  )}
                  {field.rule.type === "text" && (
                    <>
                      <label style={smallLabelStyle}>Longitud máxima (caracteres)</label>
                      <IntegerInput
                        value={field.rule.maxLength}
                        min={1}
                        max={MAX_TEXT_LENGTH}
                        onChange={(maxLength) => setField(index, { rule: { type: "text", maxLength } })}
                      />
                    </>
                  )}
                  {field.rule.type === "number" && (
                    <>
                      <label style={smallLabelStyle}>Cantidad exacta de dígitos</label>
                      <IntegerInput
                        value={field.rule.length}
                        min={1}
                        max={MAX_NUMBER_LENGTH}
                        onChange={(length) => setField(index, { rule: { type: "number", length } })}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            style={{ ...secondaryButtonStyle, marginTop: 12, opacity: template.fields.length >= MAX_FIELDS ? 0.5 : 1 }}
            disabled={template.fields.length >= MAX_FIELDS}
            onClick={addField}
          >
            + Agregar campo
          </button>
        </section>

        {/* Live preview */}
        <section>
          <label style={smallLabelStyle}>Vista previa del nombre de archivo</label>
          <div style={previewBoxStyle}>
            {template.fields.length === 0 ? (
              <span style={{ color: "var(--tc-gray-500)", fontSize: 13 }}>
                Agrega campos para ver cómo quedaría el nombre.
              </span>
            ) : (
              sample.map((segment, i) => (
                <span key={i} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
                  <span
                    style={{
                      fontFamily: "Consolas, monospace",
                      fontSize: 16,
                      whiteSpace: "pre",
                      padding: "2px 4px",
                      borderRadius: 4,
                      ...(segment.kind === "field"
                        ? {
                            background: "var(--tc-blue-100)",
                            color: "var(--tc-blue-900)",
                            border: segment.optional
                              ? "1px dashed var(--tc-blue-600)"
                              : "1px solid transparent",
                          }
                        : segment.kind === "separator"
                          ? { background: "#fff1d6", color: "#7a5300", fontWeight: 700 }
                          : { color: "var(--tc-gray-500)" }),
                    }}
                  >
                    {segment.text || "∅"}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--tc-gray-500)", marginTop: 2 }}>
                    {segment.kind === "field"
                      ? `${segment.label || "sin nombre"}${segment.optional ? " (opc.)" : ""}`
                      : segment.kind === "separator"
                        ? "sep."
                        : "ext."}
                  </span>
                </span>
              ))
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--tc-gray-500)", marginTop: 6 }}>
            Ejemplo armado con el primer valor de cada lista. Los campos opcionales tienen borde
            punteado; si se omiten en un nombre, también se omite el separador que los sigue.
          </div>
        </section>
      </div>
    </Card>
  );
}

const chipStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "var(--tc-blue-100)",
  color: "var(--tc-blue-800)",
  border: "1px solid var(--tc-blue-500)",
  borderRadius: 999,
  padding: "3px 6px 3px 12px",
  fontSize: 13,
  fontWeight: 600,
  fontFamily: "Consolas, monospace",
};

const chipRemoveStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--tc-blue-700)",
  cursor: "pointer",
  fontSize: 11,
  width: 18,
  height: 18,
  borderRadius: 999,
  padding: 0,
};

const fieldRowStyle: React.CSSProperties = {
  border: "1px solid var(--tc-gray-300)",
  background: "var(--tc-blue-50)",
  borderRadius: 8,
  padding: 12,
  marginTop: 8,
};

const separatorRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  margin: "6px 0 0 14px",
  padding: "4px 10px",
  borderLeft: "3px solid #f0c36d",
  fontSize: 12,
  color: "#7a5300",
};

const indexBadgeStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 999,
  background: "var(--tc-blue-700)",
  color: "var(--tc-white)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 13,
  fontWeight: 700,
  marginBottom: 2,
};

const previewBoxStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-start",
  gap: 2,
  border: "1px dashed var(--tc-blue-500)",
  background: "var(--tc-white)",
  borderRadius: 8,
  padding: "12px 14px",
  minHeight: 54,
};
