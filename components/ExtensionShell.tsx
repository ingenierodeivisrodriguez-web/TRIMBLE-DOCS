"use client";

import { useEffect, useState } from "react";
import * as WorkspaceAPI from "trimble-connect-workspace-api";

type Status = "connecting" | "pending-consent" | "denied" | "not-embedded" | "error" | "ready";

export interface ExtensionContext {
  projectId: string;
  projectName: string;
  accessToken: string;
}

/**
 * Connects an embedded Trimble Connect project extension to the host: registers
 * its entry in the left navigation menu, reads the active project, and obtains
 * the user's access token via extension.requestPermission("accesstoken").
 * Renders `children` once everything is ready, and friendly status screens
 * otherwise. Shared by every extension in this app.
 */
export default function ExtensionShell({
  title,
  iconPath,
  menuCommand,
  children,
}: {
  /** Name shown in Trimble Connect's left navigation menu. */
  title: string;
  /** Path (on this site) of the menu icon, e.g. "/icon.svg". */
  iconPath: string;
  menuCommand: string;
  children: (context: ExtensionContext) => React.ReactNode;
}) {
  const [status, setStatus] = useState<Status>("connecting");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [projectName, setProjectName] = useState<string>("");
  const [accessToken, setAccessToken] = useState<string>("");

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
            if (event === "extension.accessToken" && !cancelled) {
              const token =
                typeof data === "string" ? data : (data as { accessToken?: string })?.accessToken;
              if (token) setAccessToken(token);
            }
          },
          15000
        );
        if (cancelled) return;

        // The manifest only registers the extension under Apps & Capabilities;
        // it must also call setMenu so Trimble Connect actually adds an icon
        // for it in the project's left navigation panel.
        await api.ui.setMenu({
          title,
          icon: `${window.location.origin}${iconPath}`,
          command: menuCommand,
        });

        const project = await api.project.getProject();
        if (cancelled) return;
        setProjectId(project.id);
        setProjectName(project.name ?? "");

        const permission = await api.extension.requestPermission("accesstoken");
        if (cancelled) return;

        if (permission === "pending") {
          setStatus("pending-consent");
        } else if (permission === "denied") {
          setStatus("denied");
        } else {
          // A resolved, non-status string is the access token itself.
          setAccessToken(permission);
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
  }, [title, iconPath, menuCommand]);

  useEffect(() => {
    if (accessToken && status !== "ready") {
      setStatus("ready");
    }
  }, [accessToken, status]);

  if (status === "not-embedded") {
    return (
      <StatusScreen title="Extension de Trimble Connect">
        Esta pagina debe abrirse embebida dentro de un proyecto de Trimble Connect, desde el menu
        lateral "{title}".
      </StatusScreen>
    );
  }

  if (status === "connecting") {
    return <StatusScreen title="Conectando con Trimble Connect...">Un momento por favor.</StatusScreen>;
  }

  if (status === "pending-consent") {
    return (
      <StatusScreen title="Esperando autorizacion">
        Trimble Connect esta solicitando tu autorizacion para que esta extension pueda leer los
        documentos del proyecto. Acepta el mensaje de consentimiento para continuar.
      </StatusScreen>
    );
  }

  if (status === "denied") {
    return (
      <StatusScreen title="Permiso denegado">
        No se concedio permiso para leer el proyecto. Puedes restablecer el consentimiento desde
        la configuracion de la extension en Trimble Connect.
      </StatusScreen>
    );
  }

  if (status === "error") {
    return <StatusScreen title="Ocurrio un error">{errorMessage}</StatusScreen>;
  }

  return <>{children({ projectId, projectName, accessToken })}</>;
}

function StatusScreen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
      }}
    >
      <div
        style={{
          maxWidth: 420,
          textAlign: "center",
          background: "var(--tc-white)",
          borderRadius: "var(--tc-radius)",
          boxShadow: "var(--tc-shadow)",
          padding: 32,
        }}
      >
        <h2 style={{ color: "var(--tc-blue-800)", marginTop: 0 }}>{title}</h2>
        <p style={{ color: "var(--tc-gray-500)" }}>{children}</p>
      </div>
    </div>
  );
}
