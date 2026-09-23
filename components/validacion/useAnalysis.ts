"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CrawlProgress, fetchWithProgress } from "../../lib/apiClient";
import type { AnalysisOverview } from "../../lib/validacion/types";

export type AnalysisState =
  | { status: "idle" }
  | { status: "running"; progress: CrawlProgress | null }
  | { status: "done"; summary: AnalysisOverview; runId: number }
  | { status: "error"; message: string };

/**
 * Drives the on-demand analysis (name-validation results and duplicate-name
 * groups, computed from a single crawl). Nothing runs until `analyze()` is
 * called (from the "Analizar" button); the first request asks the server to
 * discard its cached folder walk (`refresh=1`) so the result reflects the
 * project as it is right now, then the hook polls until the server reports
 * it is done.
 */
export function useAnalysis(projectId: string, accessToken: string) {
  const [state, setState] = useState<AnalysisState>({ status: "idle" });
  const currentRun = useRef(0);

  useEffect(
    () => () => {
      currentRun.current += 1; // invalidate any run still in flight on unmount
    },
    []
  );

  const analyze = useCallback(() => {
    const runId = ++currentRun.current;
    const isCurrent = () => currentRun.current === runId;
    const url = `/api/validacion/analyze?projectId=${encodeURIComponent(projectId)}`;

    setState({ status: "running", progress: null });
    fetchWithProgress<AnalysisOverview>(
      url,
      accessToken,
      (progress) => {
        if (isCurrent()) setState({ status: "running", progress });
      },
      () => !isCurrent(),
      `${url}&refresh=1`
    )
      .then((summary) => {
        if (summary && isCurrent()) setState({ status: "done", summary, runId });
      })
      .catch((err: unknown) => {
        if (isCurrent()) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "No se pudo completar el análisis.",
          });
        }
      });
  }, [projectId, accessToken]);

  return { state, analyze };
}
