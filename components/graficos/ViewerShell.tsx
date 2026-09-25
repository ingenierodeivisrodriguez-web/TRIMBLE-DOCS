"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as WorkspaceAPI from "trimble-connect-workspace-api";
import type { ViewerLike } from "../../lib/graficos/viewerReader";

type Status = "connecting" | "not-embedded" | "not-viewer" | "error" | "ready";

export type ViewerEventListener = (event: string) => void;

export interface ViewerProject {
  id: string;
  name: string;
  /** Signed-in user's name, used as the report's default "Elaborado por". */
  userName: string;
}

export interface ViewerContext {
  viewer: ViewerLike;
  /** Subscribes to Workspace API events; returns the unsubscribe function. */
  subscribe: (listener: ViewerEventListener) => () => void;
  project: ViewerProject;
}

/**
 * Connects a Trimble Connect *3D Viewer* extension to its host. Unlike
 * ExtensionShell (project extensions) it needs no access token and no
 * left-menu entry: everything it reads comes from the models loaded in the
 * viewer, through the Workspace API's viewer namespace.
 */
export default function ViewerShell({ children }: { children: (context: ViewerContext) => React.ReactNode }) {
  const [status, setStatus] = useState<Status>("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const [viewer, setViewer] = useState<ViewerLike | null>(null);
  const [project, setProject] = useState<ViewerProject>({ id: "", name: "", userName: "" });
  const listeners = useRef(new Set<ViewerEventListener>());

  const subscribe = useCallback((listener: ViewerEventListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (typeof window === "undefined" || window.parent === window) {
        setStatus("not-embedded");
        return;
      }
      try {
        const api = await WorkspaceAPI.connect(
          window.parent,
          (event: string) => {
            for (const listener of listeners.current) listener(event);
          },
          30000
        );
        if (cancelled) return;

        const host = await api.extension.getHost().catch(() => null);
        if (cancelled) return;
        if (host && host.name !== "3dviewer") {
          setStatus("not-viewer");
          return;
        }
        // Only used to label the PDF and to keep saved views per project.
        const [current, user] = await Promise.all([
          api.project.getProject().catch(() => null),
          api.user.getUser().catch(() => null),
        ]);
        if (cancelled) return;
        const userName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.email || "";
        setProject({ id: current?.id ?? "", name: current?.name ?? "", userName });
        setViewer(api.viewer);
        setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : "Error desconocido.");
          setStatus("error");
        }
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "ready" && viewer) {
    return <>{children({ viewer, subscribe, project })}</>;
  }

  const screens: Record<Exclude<Status, "ready">, { title: string; body: string }> = {
    connecting: { title: "Conectando con el visor 3D...", body: "Un momento por favor." },
    "not-embedded": {
      title: "Extensión del visor 3D de Trimble Connect",
      body: "Esta página debe abrirse dentro del visor 3D de un proyecto de Trimble Connect, desde el panel de extensiones.",
    },
    "not-viewer": {
      title: "Abre esta extensión en el visor 3D",
      body: "Los gráficos se construyen con los modelos cargados en el visor 3D. Abre un modelo y elige esta extensión en el panel de extensiones del visor.",
    },
    error: { title: "Ocurrió un error", body: errorMessage },
  };
  const screen = screens[status === "ready" ? "connecting" : status];

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div
        style={{
          maxWidth: 420,
          textAlign: "center",
          background: "var(--tc-white)",
          borderRadius: "var(--tc-radius)",
          boxShadow: "var(--tc-shadow)",
          padding: 28,
        }}
      >
        <h2 style={{ color: "var(--tc-blue-800)", marginTop: 0, fontSize: 18 }}>{screen.title}</h2>
        <p style={{ color: "var(--tc-gray-500)", fontSize: 14, marginBottom: 0 }}>{screen.body}</p>
      </div>
    </div>
  );
}
