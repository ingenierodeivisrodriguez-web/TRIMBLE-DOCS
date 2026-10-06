// The budget's outline: a flat list of rows with a depth (`nivel`). A title
// contains the rows after it that are deeper; partidas contain nothing. Every
// operation moves whole blocks (a row and its contents) and returns new arrays.
import { MAX_NIVEL, type Item } from "./types";

/** End (exclusive) of the block of row `i`: the row and everything it contains. */
export function finBloque(items: Item[], i: number): number {
  let end = i + 1;
  while (end < items.length && items[end].nivel > items[i].nivel) end++;
  return end;
}

/** Index of the title that contains row `i`, or -1 at the top level. */
export function padreDe(items: Item[], i: number): number {
  for (let j = i - 1; j >= 0; j--) if (items[j].nivel < items[i].nivel) return j;
  return -1;
}

/** "1", "1.1", "1.2", "2"... for each row. */
export function numerar(items: Item[]): string[] {
  const contadores: number[] = [];
  return items.map((item) => {
    contadores.length = item.nivel + 1;
    contadores[item.nivel] = (contadores[item.nivel] ?? 0) + 1;
    for (let k = 0; k < item.nivel; k++) contadores[k] ??= 1;
    return contadores.join(".");
  });
}

/** Why the outline isn't valid, or null. */
export function validarEsquema(items: Item[]): string | null {
  for (let i = 0; i < items.length; i++) {
    const nivel = items[i].nivel;
    if (!Number.isInteger(nivel) || nivel < 0 || nivel > MAX_NIVEL) return `La fila ${i + 1} tiene un nivel no válido.`;
    if (i === 0) {
      if (nivel !== 0) return "La primera fila debe estar en el primer nivel.";
      continue;
    }
    const prev = items[i - 1];
    const max = prev.tipo === "titulo" ? prev.nivel + 1 : prev.nivel;
    if (nivel > max) return `La fila ${i + 1} quedó dentro de una partida (solo los títulos contienen filas).`;
  }
  return null;
}

/** Changes the depth of a block. */
function conNivel(bloque: Item[], delta: number): Item[] {
  return bloque.map((item) => ({ ...item, nivel: item.nivel + delta }));
}

/**
 * Where a new row (or pasted block) goes: inside a selected title (at its
 * end) when it's a partida, else right after the selected row's block, at its
 * depth. With nothing selected, at the end.
 */
function destino(items: Item[], seleccion: number | null, primero: Item): { at: number; nivel: number } {
  if (seleccion === null || seleccion < 0 || seleccion >= items.length) return { at: items.length, nivel: 0 };
  const sel = items[seleccion];
  if (sel.tipo === "titulo" && primero.tipo === "partida" && sel.nivel < MAX_NIVEL) {
    return { at: finBloque(items, seleccion), nivel: sel.nivel + 1 };
  }
  return { at: finBloque(items, seleccion), nivel: sel.nivel };
}

/** Inserts a block (its first row at depth 0 or any depth) per the rule above; returns the new list and its index. */
export function insertar(items: Item[], seleccion: number | null, bloque: Item[]): { items: Item[]; index: number } {
  if (bloque.length === 0) return { items, index: seleccion ?? -1 };
  const { at, nivel } = destino(items, seleccion, bloque[0]);
  const ajustado = conNivel(bloque, nivel - bloque[0].nivel).filter((item) => item.nivel <= MAX_NIVEL);
  return { items: [...items.slice(0, at), ...ajustado, ...items.slice(at)], index: at };
}

/** The previous row at the same depth inside the same title, or -1. */
function hermanoAnterior(items: Item[], i: number): number {
  for (let j = i - 1; j >= 0; j--) {
    if (items[j].nivel < items[i].nivel) return -1;
    if (items[j].nivel === items[i].nivel) return j;
  }
  return -1;
}

/** Puts the block inside the title above it (as its last row). Null when there is no title above at its depth. */
export function sangrar(items: Item[], i: number): Item[] | null {
  const j = hermanoAnterior(items, i);
  if (j < 0 || items[j].tipo !== "titulo") return null;
  const end = finBloque(items, i);
  const bloque = items.slice(i, end);
  if (bloque.some((item) => item.nivel + 1 > MAX_NIVEL)) return null;
  return [...items.slice(0, i), ...conNivel(bloque, 1), ...items.slice(end)];
}

/** Takes the block out of its title, right after it. Null at the top level. */
export function desangrar(items: Item[], i: number): { items: Item[]; index: number } | null {
  const p = padreDe(items, i);
  if (p < 0) return null;
  const end = finBloque(items, i);
  const finPadre = finBloque(items, p);
  const bloque = conNivel(items.slice(i, end), -1);
  const resto = [...items.slice(0, i), ...items.slice(end)];
  const at = finPadre - (end - i);
  return { items: [...resto.slice(0, at), ...bloque, ...resto.slice(at)], index: at };
}

/** Swaps the block with the previous one in the same title. */
export function subir(items: Item[], i: number): { items: Item[]; index: number } | null {
  const j = hermanoAnterior(items, i);
  if (j < 0) return null;
  const end = finBloque(items, i);
  return { items: [...items.slice(0, j), ...items.slice(i, end), ...items.slice(j, i), ...items.slice(end)], index: j };
}

/** Swaps the block with the next one in the same title. */
export function bajar(items: Item[], i: number): { items: Item[]; index: number } | null {
  const end = finBloque(items, i);
  if (end >= items.length || items[end].nivel !== items[i].nivel) return null;
  const endNext = finBloque(items, end);
  return {
    items: [...items.slice(0, i), ...items.slice(end, endNext), ...items.slice(i, end), ...items.slice(endNext)],
    index: i + (endNext - end),
  };
}

/** Removes the block of row `i`. */
export function quitar(items: Item[], i: number): Item[] {
  return [...items.slice(0, i), ...items.slice(finBloque(items, i))];
}

/** The block of row `i` (to copy or cut). */
export function bloqueDe(items: Item[], i: number): Item[] {
  return items.slice(i, finBloque(items, i));
}
