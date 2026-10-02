"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as WorkspaceAPI from "trimble-connect-workspace-api";
import { httpApi, PropiedadesApi } from "../../lib/propiedades/client";
import type { PropiedadesViewer } from "../../lib/propiedades/selection";

type Status = "connecting" | "pending-consent" | "denied" | "not-embedded" | "error" | "ready";
export type Host = "project" | "3dviewer";

export type ViewerEventListener = (event: string, data: unknown) => void;

export interface PropiedadesContext {
  host: Host;
  projectId: string;
  projectName: string;
  api: PropiedadesApi;
  /** Only in the 3D viewer. */
  viewer: PropiedadesViewer | null;
  subscribe: (listener: ViewerEventListener) => () => void;
}

/**
 * Connects "Propiedades" to Trimble Connect. The same page runs in two places
 * (one manifest declares both): the project's left menu, where it shows the
 * attribute catalog, and the 3D viewer, where it assigns values to the
 * selected elements. extension.getHost() says which one this is. Both need the
 * user's access token, since both call this app's data service.
 */
export default function PropiedadesShell({
  forceHost,
  children,
}: {
  /** For the viewer-only manifest, which always opens in the 3D viewer. */
  forceHost?: Host;
  children: (context: PropiedadesContext) => React.ReactNode;
}) {
  const [status, setStatus] = useState<Status>("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const [host, setHost] = useState<Host>(forceHost ?? "project");
  const [project, setProject] = useState({ id: "", name: "" });
  const [viewer, setViewer] = useState<PropiedadesViewer | null>(null);
  const token = useRef("");
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
          (event: string, data: unknown) => {
            if (event === "extension.accessToken") {
              // Typed as { data: token }; older hosts send the string or { accessToken }.
              const d = data as { data?: unknown; accessToken?: unknown } | string;
              const fresh = typeof d === "string" ? d : (d?.data ?? d?.accessToken);
              if (typeof fresh === "string" && fresh) token.current = fresh;
            }
            for (const listener of listeners.current) listener(event, data);
          },
          30000
        );
        if (cancelled) return;

        const detected = forceHost ?? ((await api.extension.getHost().catch(() => null))?.name === "3dviewer" ? "3dviewer" : "project");
        if (cancelled) return;
        setHost(detected);

        if (detected === "project") {
          // The manifest registers the extension; setMenu is what adds its
          // entry to the project's left navigation.
          await api.ui.setMenu({
            title: "Propiedades",
            icon: `${window.location.origin}/icon-propiedades.svg`,
            command: "propiedades_open",
          });
        } else {
          setViewer(api.viewer);
        }

        const current = await api.project.getProject();
        if (cancelled) return;
        setProject({ id: current.id, name: current.name ?? "" });

        const permission = await api.extension.requestPermission("accesstoken");
        if (cancelled) return;
        if (permission === "pending") setStatus("pending-consent");
        else if (permission === "denied") setStatus("denied");
        else {
          token.current = permission;
          setStatus("ready");
        }
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
  }, [forceHost]);

  // A token granted after the consent prompt arrives as an event.
  useEffect(() => {
    if (status !== "pending-consent") return;
    const timer = setInterval(() => {
      if (token.current) setStatus("ready");
    }, 500);
    return () => clearInterval(timer);
  }, [status]);

  const api = useMemo(() => httpApi(project.id, () => token.current), [project.id]);

  if (status === "ready") {
    return <>{children({ host, projectId: project.id, projectName: project.name, api, viewer, subscribe })}</>;
  }

  const screens: Record<Exclude<Status, "ready">, { title: string; body: string }> = {
    connecting: { title: "Conectando con Trimble Connect...", body: "Un momento por favor." },
    "not-embedded": {
      title: "Herramienta de Trimble Connect",
      body: "Esta página debe abrirse dentro de un proyecto de Trimble Connect: el catálogo desde el menú lateral \"Propiedades\" y la asignación desde el panel de extensiones del visor 3D.",
    },
    "pending-consent": {
      title: "Esperando autorización",
      body: "Trimble Connect está pidiendo tu autorización para que Propiedades pueda identificarte y guardar valores. Acepta el mensaje para continuar.",
    },
    denied: {
      title: "Permiso denegado",
      body: "No se concedió el permiso. Puedes restablecer la autorización desde Configuración del proyecto → Apps & Capabilities.",
    },
    error: { title: "Ocurrió un error", body: errorMessage },
  };
  const screen = screens[status];

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
