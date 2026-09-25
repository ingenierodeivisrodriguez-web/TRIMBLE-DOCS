import { Members, OTHER_KEY } from "./modelData";

/** Objects to paint one color in the 3D model, and the chart label they stand for. */
export interface ColorGroup {
  color: string;
  label: string;
  members: Members;
}

/**
 * The validated categorical palette, in its fixed order (checked for
 * color-blind separation between neighbours). Categories get these in order;
 * there is never a 9th generated hue - extra categories fold into "Otros".
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

/** Rows needed to color every category distinctly: the palette plus one gray "Otros". */
export const MAX_COLORED_ROWS = CATEGORY_COLORS.length + 1;

/** Palette colors in row order; the folded "Otros"/"Anteriores" row is gray and doesn't use up a color. */
export function assignColors(rows: { key: string }[]): string[] {
  let next = 0;
  return rows.map((row) => (row.key === OTHER_KEY ? OTHER_COLOR : CATEGORY_COLORS[next++] ?? OTHER_COLOR));
}
