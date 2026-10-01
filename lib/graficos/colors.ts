import { Members, mergeMembers, OTHER_KEY } from "./modelData";

/** Objects to paint one color in the 3D model, and the chart label they stand for. */
export interface ColorGroup {
  color: string;
  label: string;
  members: Members;
}

/**
 * The validated categorical palette, in its fixed order (checked for
 * color-blind separation between neighbours). There is never a 9th generated
 * hue: with more categories than colors, the palette repeats in order, so
 * every category - and every one of its objects in the model - is colored.
 */
export const CATEGORY_COLORS = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#4a3aa7",
  "#e34948",
];
export const OTHER_COLOR = "#a3a8ae";
export const COMPARE_COLORS = { A: CATEGORY_COLORS[0], B: CATEGORY_COLORS[1] } as const;

const labelCollator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/** Natural label order: "Nivel 2" before "Nivel 10". */
export const compareLabels = (a: string, b: string) => labelCollator.compare(a, b);

/**
 * One palette color per row, repeating the palette when there are more rows
 * than colors; the folded "Otros"/"Anteriores" row is gray and doesn't use up
 * a color. Up to 8 categories, each gets its own color.
 *
 * Past that, colors repeat, but never between categories that would be read
 * side by side: rows next to each other in the chart (and the last and first
 * slice of a donut, with `ring`), and - with `byLabel` - categories next to
 * each other in natural label order ("Nivel 2" before "Nivel 10"), so
 * consecutive levels, phases or axes differ in the model even though the chart
 * sorts them by value. Each category has at most 4 such neighbours and the
 * palette has 8 colors, so one is always free.
 */
export function assignColors(
  rows: { key: string; label: string }[],
  options: { byLabel?: boolean; ring?: boolean } = {}
): string[] {
  const categories = rows.filter((row) => row.key !== OTHER_KEY);
  const neighbours = new Map(categories.map((row) => [row.key, new Set<string>()]));
  const link = (a: string, b: string) => {
    if (a === b) return;
    neighbours.get(a)!.add(b);
    neighbours.get(b)!.add(a);
  };
  for (let i = 1; i < categories.length; i++) link(categories[i - 1].key, categories[i].key);
  if (options.ring && categories.length > 2) link(categories[categories.length - 1].key, categories[0].key);

  const order = options.byLabel ? [...categories].sort((a, b) => compareLabels(a.label, b.label)) : categories;
  if (options.byLabel) for (let i = 1; i < order.length; i++) link(order[i - 1].key, order[i].key);

  // In that order, each takes the next palette color; when a neighbour has it,
  // the least used free color (the nearest one on ties), so the palette stays evenly spread.
  const size = CATEGORY_COLORS.length;
  const uses = new Array<number>(size).fill(0);
  const colorOf = new Map<string, number>();
  order.forEach((row, position) => {
    const taken = new Set([...neighbours.get(row.key)!].map((key) => colorOf.get(key)));
    let best = -1;
    for (let step = 0; step < size; step++) {
      const color = (position + step) % size;
      if (!taken.has(color) && (best === -1 || uses[color] < uses[best])) best = color;
    }
    colorOf.set(row.key, best);
    uses[best]++;
  });
  return rows.map((row) => {
    const color = colorOf.get(row.key);
    return color === undefined ? OTHER_COLOR : CATEGORY_COLORS[color];
  });
}

/**
 * The groups merged by color, in order of first appearance: categories that
 * share a color are painted in one viewer call, and listed together in the
 * color key ("Nivel 1, Nivel 9").
 */
export function groupsByColor(groups: ColorGroup[]): (ColorGroup & { labels: string[] })[] {
  const byColor = new Map<string, ColorGroup[]>();
  for (const group of groups) byColor.set(group.color, [...(byColor.get(group.color) ?? []), group]);
  return [...byColor].map(([color, list]) => ({
    color,
    label: list.map((g) => g.label).join(", "),
    labels: list.map((g) => g.label),
    members: mergeMembers(list.map((g) => g.members)),
  }));
}
