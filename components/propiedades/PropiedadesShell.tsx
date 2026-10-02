"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as WorkspaceAPI from "trimble-connect-workspace-api";
import { httpApi, PropiedadesApi } from "../../lib/propiedades/client";
import type { PropiedadesViewer } from "../../lib/propiedades/selection";
import { describeToken, expiresSoon, isTokenLike, tokenFrom } from "../../lib/propiedades/token";

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
  /** The user's Trimble token for this app's other endpoints; `fresh` asks Trimble Connect for it again. */
  getAccessToken: (fresh?: boolean) => Promise<string>;
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
  const token = useRef({ value: "", source: "" });
  const workspace = useRef<WorkspaceAPI.WorkspaceAPI | null>(null);
  const listeners = useRef(new Set<ViewerEventListener>());

  /** Keeps `value` as the token if it looks like one (status words like "pending" never do). */
  function accept(value: string, source: string): boolean {
    if (!isTokenLike(value)) return false;
    token.current = { value, source };
    return true;
  }

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
            // Sent after the user consents and every time the token is renewed.
            if (event === "extension.accessToken") accept(tokenFrom(data), "evento de renovación");
            for (const listener of listeners.current) listener(event, data);
          },
          30000
        );
        if (cancelled) return;
        workspace.current = api;

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
        else if (accept(permission, "solicitud de permiso") || token.current.value) setStatus("ready");
        else setStatus("pending-consent");
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
      if (token.current.value) setStatus("ready");
    }, 500);
    return () => clearInterval(timer);
  }, [status]);

  /** Asks Trimble Connect for the token again; "" when it isn't available (yet). */
  const requestToken = useCallback(async (): Promise<string> => {
    const result = await workspace.current?.extension.requestPermission("accesstoken").catch(() => "");
    if (result === "denied") setStatus("denied");
    return accept(result ?? "", "solicitud de permiso (renovada)") ? token.current.value : "";
  }, []);

  const getAccessToken = useCallback(
    async (fresh = false): Promise<string> => {
      const current = token.current.value;
      if (!fresh && current && !expiresSoon(current)) return current;
      const renewed = await requestToken();
      if (renewed) return renewed;
      if (current) return current;
      throw new Error("Trimble Connect no ha entregado la autorización de esta app; recarga la página.");
    },
    [requestToken]
  );

  const [checking, setChecking] = useState(false);
  async function continueAfterConsent() {
    setChecking(true);
    try {
      if (await requestToken()) setStatus("ready");
    } finally {
      setChecking(false);
    }
  }

  const api = useMemo(
    () =>
      httpApi(project.id, {
        get: () => token.current.value,
        refresh: requestToken,
        describe: () => describeToken(token.current.value, token.current.source),
      }),
    [project.id, requestToken]
  );

  if (status === "ready") {
    return <>{children({ host, projectId: project.id, projectName: project.name, api, viewer, subscribe, getAccessToken })}</>;
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
        {status === "pending-consent" && (
          <button
            type="button"
            onClick={continueAfterConsent}
            disabled={checking}
            style={{
              marginTop: 16,
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              background: "var(--tc-blue-600)",
              color: "var(--tc-white)",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {checking ? "Comprobando..." : "Ya acepté, continuar"}
          </button>
        )}
      </div>
    </div>
  );
}
