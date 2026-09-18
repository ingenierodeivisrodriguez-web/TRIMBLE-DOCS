import type { FieldRule, Issue, MatchPart, MatchResult, NameTemplate, TemplateField } from "./types";

/**
 * Validates a file name (without extension) against a template.
 *
 * The match is an exact, deterministic parse of the name into the template's
 * fields and separators, done as a minimum-cost search: a fully conforming
 * name has cost 0, and every deviation (wrong separator, value not allowed,
 * missing field, too long, leftover text...) adds cost and records a specific
 * issue. The cheapest parse is the one reported, so a non-conforming name gets
 * the most plausible diagnosis rather than just "does not match".
 *
 * Because a template may contain at most ONE free-text field (the only
 * variable-length field whose boundaries can't be known from its rule), the
 * search is equivalent to anchoring the exact-rule fields from both ends of
 * the name and giving whatever is left in the middle to that single text
 * field - which is what makes the result deterministic.
 *
 * Optional fields: when an optional field is omitted, the separator that
 * would follow it is omitted too (the separator between two present fields is
 * always the one configured right after the earlier field). Matching of fixed
 * codes and allowed-value lists is exact (case-sensitive).
 */

const ERROR_COST = 10;
// Slightly higher than a field error so that when a name has one bad field
// AND leftover text, the diagnosis blames the field instead of "leftover".
const TRAILING_COST = 11;

interface Solution {
  cost: number;
  issues: Issue[];
  /** How the name was split into fields along this parse (for display). */
  parts: MatchPart[];
}

const DEAD_END: Solution = { cost: Infinity, issues: [], parts: [] };

const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const ONLY_DIGITS = /^\d+$/;

/**
 * A wrong separator is only diagnosed as "wrong separator" when what we found
 * in its slot looks like a separator (punctuation, space, symbol) - otherwise
 * ("SATARQ" instead of "SAT_ARQ") the real problem is the adjacent value.
 */
function looksLikeSeparator(found: string, expected: string): boolean {
  if (found.length === 0) return false;
  return !HAS_LETTER_OR_DIGIT.test(found) || HAS_LETTER_OR_DIGIT.test(expected);
}

function isValidToken(rule: FieldRule, token: string): boolean {
  switch (rule.type) {
    case "fixed":
      return token === rule.value;
    case "list":
      return rule.values.includes(token);
    case "number":
      return token.length === rule.length && ONLY_DIGITS.test(token);
    case "text":
      return token.length >= 1 && token.length <= rule.maxLength;
  }
}

/** End positions at which a fixed/list/number rule matches exactly starting at `pos`. */
function exactEnds(rule: FieldRule, base: string, pos: number): number[] {
  switch (rule.type) {
    case "fixed":
      return rule.value.length > 0 && base.startsWith(rule.value, pos)
        ? [pos + rule.value.length]
        : [];
    case "list": {
      const ends = new Set<number>();
      for (const value of rule.values) {
        if (value.length > 0 && base.startsWith(value, pos)) ends.add(pos + value.length);
      }
      return [...ends].sort((a, b) => a - b);
    }
    case "number": {
      const end = pos + rule.length;
      return end <= base.length && ONLY_DIGITS.test(base.slice(pos, end)) ? [end] : [];
    }
    case "text":
      return [];
  }
}

function missingIssue(field: TemplateField): Issue {
  return { kind: "missing", fieldLabel: field.label, message: `Falta el campo ${field.label}` };
}

function mismatchIssue(field: TemplateField, token: string): Issue {
  const label = field.label;
  if (token.length === 0) {
    return { kind: "missing", fieldLabel: label, message: `Falta el campo ${label} (está vacío)` };
  }
  const rule = field.rule;
  if (rule.type === "fixed") {
    return {
      kind: "value",
      fieldLabel: label,
      message: `${label}: se encontró '${token}', se esperaba exactamente '${rule.value}'`,
    };
  }
  if (rule.type === "list") {
    const sameIgnoringCase = rule.values.find((v) => v.toLowerCase() === token.toLowerCase());
    const hint = sameIgnoringCase
      ? ` (se parece a '${sameIgnoringCase}', pero el código distingue mayúsculas y minúsculas)`
      : "";
    return {
      kind: "value",
      fieldLabel: label,
      message: `${label}: se encontró '${token}', no está en la lista de códigos permitidos [${rule.values.join(", ")}]${hint}`,
    };
  }
  if (rule.type === "number") {
    const problems: string[] = [];
    if (!ONLY_DIGITS.test(token)) problems.push("debe contener solo dígitos");
    if (token.length !== rule.length) {
      problems.push(`debe tener exactamente ${rule.length} dígitos (tiene ${token.length})`);
    }
    return {
      kind: "value",
      fieldLabel: label,
      message: `${label}: se encontró '${token}'; ${problems.join(" y ")}`,
    };
  }
  return {
    kind: "value",
    fieldLabel: label,
    message: `${label}: el valor '${token}' no es válido`,
  };
}

function separatorIssue(
  prevField: TemplateField,
  field: TemplateField,
  prevIndex: number,
  index: number,
  expected: string,
  found: string
): Issue {
  return {
    kind: "separator",
    fieldLabel: `Separador entre «${prevField.label}» y «${field.label}»`,
    message: `Separador incorrecto entre el campo ${prevIndex + 1} (${prevField.label}) y el campo ${index + 1} (${field.label}): se esperaba '${expected}' y se encontró '${found}'`,
  };
}

function lengthIssue(field: TemplateField, max: number, actual: number): Issue {
  return {
    kind: "length",
    fieldLabel: field.label,
    message: `${field.label}: excede la longitud máxima de ${max} caracteres (tiene ${actual})`,
  };
}

function duplicateSeparatorIssue(field: TemplateField, sep: string, where: "inicio" | "final"): Issue {
  return {
    kind: "value",
    fieldLabel: field.label,
    message: `${field.label}: el texto ${where === "inicio" ? "empieza" : "termina"} con el separador '${sep}' (separador duplicado)`,
  };
}

function trailingIssue(rest: string): Issue {
  return {
    kind: "trailing",
    fieldLabel: "Estructura del nombre",
    message: `Texto sobrante al final del nombre: '${rest}'`,
  };
}

export function matchName(base: string, template: NameTemplate): MatchResult {
  const { fields, separators } = template;
  const n = fields.length;
  const len = base.length;
  const memo = new Map<number, Solution>();

  const separatorAfter = (i: number): string | null => (i < n - 1 ? (separators[i] ?? null) : null);

  function solve(i: number, pos: number, prev: number): Solution {
    const key = (i * (len + 1) + pos) * (n + 1) + (prev + 1);
    const cached = memo.get(key);
    if (cached) return cached;
    const solution = compute(i, pos, prev);
    memo.set(key, solution);
    return solution;
  }

  // i: next field to place; pos: current position in `base`;
  // prev: index of the last field that was actually present (-1 if none yet).
  function compute(i: number, pos: number, prev: number): Solution {
    if (i === n) {
      return pos === len
        ? { cost: 0, issues: [], parts: [] }
        : { cost: TRAILING_COST, issues: [trailingIssue(base.slice(pos))], parts: [] };
    }

    const field = fields[i];
    const rule = field.rule;
    let best: Solution = DEAD_END;
    const consider = (candidate: Solution) => {
      if (candidate.cost < best.cost) best = candidate;
    };

    // The field is absent (only allowed when optional).
    if (!field.required) consider(solve(i + 1, pos, prev));

    // Nothing left in the name: a required field is missing.
    if (pos >= len) {
      if (field.required) {
        const rest = solve(i + 1, pos, prev);
        if (rest.cost !== Infinity) {
          consider({
            cost: rest.cost + ERROR_COST,
            issues: [missingIssue(field), ...rest.issues],
            parts: rest.parts,
          });
        }
      }
      return best;
    }

    // The field is present: first the separator that follows the previous present field.
    let start = pos;
    const separatorIssues: Issue[] = [];
    if (prev >= 0) {
      const expected = separators[prev];
      if (base.startsWith(expected, pos)) {
        start = pos + expected.length;
      } else {
        const found = base.slice(pos, pos + expected.length);
        if (!looksLikeSeparator(found, expected)) return best;
        separatorIssues.push(separatorIssue(fields[prev], field, prev, i, expected, found));
        start = Math.min(len, pos + expected.length);
      }
    }
    const separatorCost = separatorIssues.length * ERROR_COST;

    const continueFrom = (end: number, cost: number, issues: Issue[]) => {
      const rest = solve(i + 1, end, i);
      if (rest.cost === Infinity) return;
      consider({
        cost: separatorCost + cost + rest.cost,
        issues: [...separatorIssues, ...issues, ...rest.issues],
        parts: [{ fieldIndex: i, start, end, ok: issues.length === 0 }, ...rest.parts],
      });
    };

    // The separator consumed the rest of the name: this field is empty.
    if (start >= len) {
      if (field.required) continueFrom(start, ERROR_COST, [missingIssue(field)]);
      return best;
    }

    const after = separatorAfter(i);

    if (rule.type === "text") {
      const before = prev >= 0 ? separators[prev] : null;

      // Empty text sitting right before the next separator.
      if (field.required && after !== null && base.startsWith(after, start)) {
        continueFrom(start, ERROR_COST, [missingIssue(field)]);
      }

      for (let end = start + 1; end <= len; end++) {
        const atEnd = end === len;
        if (!atEnd) {
          if (after === null) continue;
          const isNextSeparator = base.startsWith(after, end);
          if (!isNextSeparator && !looksLikeSeparator(base.slice(end, end + after.length), after)) {
            continue;
          }
        }
        const text = base.slice(start, end);
        const issues: Issue[] = [];
        if (text.length > rule.maxLength) {
          issues.push(lengthIssue(field, rule.maxLength, text.length));
        }
        if (before && text.startsWith(before)) {
          issues.push(duplicateSeparatorIssue(field, before, "inicio"));
        }
        if (after && text.endsWith(after)) {
          issues.push(duplicateSeparatorIssue(field, after, "final"));
        }
        continueFrom(end, issues.length * ERROR_COST, issues);
      }
      return best;
    }

    for (const end of exactEnds(rule, base, start)) continueFrom(end, 0, []);

    // Alternative: treat everything up to the next separator as a wrong value.
    const nextSeparatorAt = after !== null ? base.indexOf(after, start) : -1;
    const tokenEnd = nextSeparatorAt >= 0 ? nextSeparatorAt : len;
    const token = base.slice(start, tokenEnd);
    if (!isValidToken(rule, token)) {
      continueFrom(tokenEnd, ERROR_COST, [mismatchIssue(field, token)]);
    }

    return best;
  }

  const solution = solve(0, 0, -1);
  if (solution.cost === Infinity) {
    return {
      conforming: false,
      issues: [
        {
          kind: "trailing",
          fieldLabel: "Estructura del nombre",
          message: "El nombre no coincide con la estructura configurada",
        },
      ],
      parts: [],
    };
  }
  return { conforming: solution.cost === 0, issues: solution.issues, parts: solution.parts };
}
