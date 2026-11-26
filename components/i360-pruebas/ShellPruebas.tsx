"use client";

// TEMPORARY (Inspección 360°, Fase 0): minimal connection to Trimble Connect for the spikes.
// Unlike components/trimble/ExtensionShell it hands over the whole Workspace API (ui, embed,
// extension), which the spikes need. Remove when Fase 0 closes.

import { useCallback, useEffect, useRef, useState } from "react";
import * as WorkspaceAPI from "trimble-connect-workspace-api";
import { isTokenLike, tokenFrom } from "../../lib/propiedades/token";

export type Oyente = (evento: string, datos: unknown) => void;
export type Anfitrion = "project" | "3dviewer";

export interface ContextoPruebas {
  api: WorkspaceAPI.WorkspaceAPI;
  host: Anfitrion;
  projectId: string;
  projectName: string;
  /** The user's token, asked again to Trimble Connect when `nuevo`. */
  token: (nuevo?: boolean) => Promise<string>;
  escuchar: (oyente: Oyente) => () => void;
}

type Estado = "conectando" | "consentimiento" | "negado" | "fuera" | "error" | "listo";

export default function ShellPruebas({
  forceHost,
  children,
}: {
  forceHost?: Anfitrion;
  children: (ctx: ContextoPruebas) => React.ReactNode;
}) {
  const [estado, setEstado] = useState<Estado>("conectando");
  const [error, setError] = useState("");
  const [host, setHost] = useState<Anfitrion>(forceHost ?? "project");
  const [proyecto, setProyecto] = useState({ id: "", name: "" });
  const api = useRef<WorkspaceAPI.WorkspaceAPI | null>(null);
  const valor = useRef("");
  const oyentes = useRef(new Set<Oyente>());

  const escuchar = useCallback((oyente: Oyente) => {
    oyentes.current.add(oyente);
    return () => {
      oyentes.current.delete(oyente);
    };
  }, []);

  useEffect(() => {
    let cancelado = false;
    async function iniciar() {
      if (window.parent === window) return setEstado("fuera");
      try {
        const conexion = await WorkspaceAPI.connect(
          window.parent,
          (evento: string, datos: unknown) => {
            if (evento === "extension.accessToken") {
              const t = tokenFrom(datos);
              if (isTokenLike(t)) valor.current = t;
            }
            for (const o of oyentes.current) o(evento, datos);
          },
          30000,
        );
        if (cancelado) return;
        api.current = conexion;
        const detectado: Anfitrion =
          forceHost ?? ((await conexion.extension.getHost().catch(() => null))?.name === "3dviewer" ? "3dviewer" : "project");
        setHost(detectado);
        if (detectado === "project") {
          await conexion.ui.setMenu({
            title: "Inspección 360 (pruebas)",
            icon: `${window.location.origin}/icon-i360-pruebas.svg`,
            command: "i360_pruebas",
          });
        }
        const actual = await conexion.project.getProject();
        if (cancelado) return;
        setProyecto({ id: actual.id, name: actual.name ?? "" });
        const permiso = await conexion.extension.requestPermission("accesstoken");
        if (cancelado) return;
        if (permiso === "denied") setEstado("negado");
        else if (isTokenLike(permiso)) {
          valor.current = permiso;
          setEstado("listo");
        } else setEstado("consentimiento");
      } catch (err) {
        if (!cancelado) {
          setError(err instanceof Error ? err.message : String(err));
          setEstado("error");
        }
      }
    }
    iniciar();
    return () => {
      cancelado = true;
    };
  }, [forceHost]);

  useEffect(() => {
    if (estado !== "consentimiento") return;
    const t = setInterval(() => {
      if (valor.current) setEstado("listo");
    }, 500);
    return () => clearInterval(t);
  }, [estado]);

  const token = useCallback(async (nuevo = false) => {
    if (nuevo || !valor.current) {
      const r = await api.current?.extension.requestPermission("accesstoken").catch(() => "");
      if (r && isTokenLike(r)) valor.current = r;
    }
    if (!valor.current) throw new Error("Trimble Connect no entregó el token; recargue la página.");
    return valor.current;
  }, []);

  if (estado === "listo" && api.current) {
    return <>{children({ api: api.current, host, projectId: proyecto.id, projectName: proyecto.name, token, escuchar })}</>;
  }
  const textos: Record<Estado, string> = {
    conectando: "Conectando con Trimble Connect…",
    consentimiento: "Acepte el permiso que pide Trimble Connect para continuar.",
    negado: "Sin el permiso de Trimble Connect las pruebas no pueden leer el proyecto.",
    fuera: "Esta página de pruebas solo funciona dentro de Trimble Connect (instale el manifiesto de pruebas en un proyecto de prueba).",
    error: `No se pudo conectar con Trimble Connect: ${error}`,
    listo: "",
  };
  return <p style={{ fontFamily: "system-ui, sans-serif", padding: 16, fontSize: 14 }}>{textos[estado]}</p>;
}
