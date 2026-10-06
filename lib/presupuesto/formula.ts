// Formulas of the budget footer ("CD * 0.10", "CD + PGG + UTI", "ST * 18%"):
// numbers, variables, + - * / and parentheses. Evaluated by a small parser,
// never by eval.

export class FormulaError extends Error {}

const NUMBER = /^(\d+(?:[.,]\d*)?|[.,]\d+)/;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*/;

/** Variables are case-insensitive: they are looked up in upper case. */
export function evaluarFormula(text: string, variables: ReadonlyMap<string, number>): number {
  const s = text;
  let pos = 0;

  function peek(): string | undefined {
    while (pos < s.length && /\s/.test(s[pos])) pos++;
    return s[pos];
  }

  function expr(): number {
    let value = term();
    for (;;) {
      const c = peek();
      if (c === "+") {
        pos++;
        value += term();
      } else if (c === "-") {
        pos++;
        value -= term();
      } else return value;
    }
  }

  function term(): number {
    let value = factor();
    for (;;) {
      const c = peek();
      if (c === "*") {
        pos++;
        value *= factor();
      } else if (c === "/") {
        pos++;
        const divisor = factor();
        if (divisor === 0) throw new FormulaError("División entre cero.");
        value /= divisor;
      } else return value;
    }
  }

  function factor(): number {
    const c = peek();
    if (c === undefined) throw new FormulaError("La fórmula está incompleta.");
    if (c === "+") {
      pos++;
      return factor();
    }
    if (c === "-") {
      pos++;
      return -factor();
    }
    if (c === "(") {
      pos++;
      const value = expr();
      if (peek() !== ")") throw new FormulaError("Falta cerrar un paréntesis.");
      pos++;
      return value;
    }
    const number = NUMBER.exec(s.slice(pos));
    if (number) {
      pos += number[0].length;
      let value = Number(number[0].replace(",", "."));
      if (peek() === "%") {
        pos++;
        value /= 100;
      }
      return value;
    }
    const name = NAME.exec(s.slice(pos));
    if (name) {
      pos += name[0].length;
      const value = variables.get(name[0].toUpperCase());
      if (value === undefined) throw new FormulaError(`La variable ${name[0]} no existe en las filas de arriba.`);
      if (Number.isNaN(value)) throw new FormulaError(`La variable ${name[0]} tiene un error.`);
      return value;
    }
    throw new FormulaError(`Carácter no válido: "${c}".`);
  }

  if (!s.trim()) throw new FormulaError("Escribe una fórmula.");
  const value = expr();
  if (peek() !== undefined) throw new FormulaError(`Sobra "${s.slice(pos).trim()}".`);
  if (!Number.isFinite(value)) throw new FormulaError("El resultado no es un número.");
  return value;
}

export const VARIABLE_RE = /^[A-Za-z_][A-Za-z0-9_]{0,19}$/;
/** Variables every footer has: the direct cost and the general expenses factor. */
export const VARIABLES_FIJAS = ["CD", "FGG"];
