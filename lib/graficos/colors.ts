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
 * One palette color per row, cycling when there are more rows than colors;
 * the folded "Otros"/"Anteriores" row is gray and doesn't use up a color.
 *
 * `order: "rows"` hands colors out in row order - what a donut needs, so
 * neighbouring slices differ. `order: "labels"` hands them out in natural
 * label order ("Nivel 2" before "Nivel 10"), so consecutive levels, phases or
 * axes get different colors in the model even when the bars are sorted by value.
 */
export function assignColors(rows: { key: string; label: string }[], order: "rows" | "labels" = "rows"): string[] {
  const categories = rows.filter((row) => row.key !== OTHER_KEY);
  if (order === "labels") categories.sort((a, b) => compareLabels(a.label, b.label));
  const position = new Map(categories.map((row, i) => [row.key, i]));
  return rows.map((row) => {
    const i = position.get(row.key);
    return i === undefined ? OTHER_COLOR : CATEGORY_COLORS[i % CATEGORY_COLORS.length];
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
