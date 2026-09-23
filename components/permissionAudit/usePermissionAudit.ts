"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithProgress } from "../../lib/apiClient";
import type { FolderAuditResult } from "../../lib/permissionAudit";

interface AuditProgress {
  checked: number;
  total: number;
}

interface AuditResponse {
  results: FolderAuditResult[];
}

export type PermissionAuditState =
  | { status: "idle" }
  | { status: "running"; progress: AuditProgress | null }
  | {
      status: "done";
      results: FolderAuditResult[];
      /** Total folders checked, when known (0 if the audit finished before ever reporting progress). */
      totalFolders: number;
      auditedAt: number;
      runId: number;
    }
  | { status: "error"; message: string };

/**
 * Drives the on-demand permission audit. Nothing runs until `runAudit()` is
 * called (from the "Ejecutar auditoria" button) - checking every folder's
 * permissions is a real cost (one Trimble API call each), so unlike the
 * "Resumen" tab this never runs automatically on mount. Mirrors
 * components/validacion/useAnalysis.ts.
 */
export function usePermissionAudit(projectId: string, accessToken: string) {
  const [state, setState] = useState<PermissionAuditState>({ status: "idle" });
  const currentRun = useRef(0);
  const latestTotal = useRef(0);

  useEffect(
    () => () => {
      currentRun.current += 1; // invalidate any run still in flight on unmount
    },
    []
  );

  const runAudit = useCallback(() => {
    const runId = ++currentRun.current;
    const isCurrent = () => currentRun.current === runId;
    const url = `/api/permissions-audit?projectId=${encodeURIComponent(projectId)}`;
    latestTotal.current = 0;

    setState({ status: "running", progress: null });
    fetchWithProgress<AuditResponse, AuditProgress>(
      url,
      accessToken,
      (progress) => {
        latestTotal.current = progress.total;
        if (isCurrent()) setState({ status: "running", progress });
      },
      () => !isCurrent(),
      `${url}&refresh=1`
    )
      .then((response) => {
        if (response && isCurrent()) {
          setState({
            status: "done",
            results: response.results,
            totalFolders: latestTotal.current,
            auditedAt: Date.now(),
            runId,
          });
        }
      })
      .catch((err: unknown) => {
        if (isCurrent()) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "No se pudo completar la auditoria.",
          });
        }
      });
  }, [projectId, accessToken]);

  return { state, runAudit };
}
