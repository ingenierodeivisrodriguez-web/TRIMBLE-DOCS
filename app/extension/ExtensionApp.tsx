"use client";

import { useEffect, useRef, useState } from "react";
import * as WorkspaceAPI from "trimble-connect-workspace-api";
import Dashboard from "../../components/Dashboard";

type Status = "connecting" | "pending-consent" | "denied" | "not-embedded" | "error" | "ready";

export default function ExtensionApp() {
  const [status, setStatus] = useState<Status>("connecting");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [projectName, setProjectName] = useState<string>("");
  const [accessToken, setAccessToken] = useState<string>("");
  const apiRef = useRef<WorkspaceAPI.WorkspaceAPI | null>(null);

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
              const token = typeof data === "string" ? data : (data as { accessToken?: string })?.accessToken;
              if (token) setAccessToken(token);
            }
          },
          15000
        );
        if (cancelled) return;
        apiRef.current = api;

        // The manifest only registers the extension under Apps & Capabilities;
        // it must also call setMenu so Trimble Connect actually adds an icon
        // for it in the project's left navigation panel.
        await api.ui.setMenu({
          title: "Resumen Archivos",
          icon: `${window.location.origin}/icon.svg`,
          command: "resumen_archivos_open",
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
  }, []);

  useEffect(() => {
    if (accessToken && status !== "ready") {
      setStatus("ready");
    }
  }, [accessToken, status]);

  if (status === "not-embedded") {
    return (
      <StatusScreen title="Extension de Trimble Connect">
        Esta pagina debe abrirse embebida dentro de un proyecto de Trimble Connect, desde el menu
        lateral "Resumen Archivos".
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

  return <Dashboard projectId={projectId} projectName={projectName} accessToken={accessToken} />;
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
