import { filterNonConforming, filterUnclassified } from "./filter";
import type { AnalysisResult, NonConformingRow, ResultsTab, UnclassifiedRow } from "./types";

export type Selection =
  | { tab: "nonconforming"; rows: NonConformingRow[] }
  | { tab: "unclassified"; rows: UnclassifiedRow[] };

/** The rows of one results tab with the query-string filters applied (template, field, ext, q). */
export function selectRows(tab: ResultsTab, result: AnalysisResult, params: URLSearchParams): Selection {
  const q = params.get("q") ?? undefined;
  if (tab === "nonconforming") {
    const template = params.get("template");
    return {
      tab,
      rows: filterNonConforming(result.nonConforming, {
        template: template === "graphic" || template === "nonGraphic" ? template : undefined,
        field: params.get("field") ?? undefined,
        q,
      }),
    };
  }
  return {
    tab,
    rows: filterUnclassified(result.unclassified, { ext: params.get("ext") ?? undefined, q }),
  };
}
