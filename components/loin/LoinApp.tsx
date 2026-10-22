"use client";

import { CSSProperties, useCallback, useEffect, useState } from "react";
import type { LoinApi } from "../../lib/loin/client";
import type { CamposModelo, CatalogoResponse, EstadoResponse, Parametro } from "../../lib/loin/types";
import { C, message, Notice } from "../presupuesto/ui";
import Auditorias from "./Auditorias";
import Catalogo from "./Catalogo";
import ConfigDialog from "./ConfigDialog";
import Disciplinas from "./Disciplinas";
import { linkBtn } from "./estilos";
import Matriz from "./Matriz";

type Pestana = "catalogo" | "elementos" | "matriz" | "auditorias";

/** "Requisitos BIM (LOIN)" in the project menu: the parameter catalog and the elements each discipline models. */
export default function LoinApp({ api, projectId, projectName }: { api: LoinApi; projectId: string; projectName: string }) {
  const [estado, setEstado] = useState<EstadoResponse | null>(null);
  const [catalogo, setCatalogo] = useState<CatalogoResponse | null>(null);
  const [error, setError] = useState("");
  const [pestana, setPestana] = useState<Pestana>("catalogo");
  const [config, setConfig] = useState(false);
  const [camposModelo, setCamposModelo] = useState<CamposModelo | null>(null);

  const cargar = useCallback(async () => {
    setError("");
    try {
      const [e, c] = await Promise.all([api.getEstado(), api.getCatalogo()]);
      setEstado(e);
      setCatalogo(c);
    } catch (err) {
      setError(message(err));
    }
    // Optional: the property names read in the 3D viewer (to pick aliases and rule fields).
    api.getCamposModelo().then(setCamposModelo, () => setCamposModelo(null));
  }, [api]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  /** Saved parameters replace theirs (or are added) without reading the whole catalog again. */
  const alGuardar = useCallback((guardados: Parametro[]) => {
    setCatalogo((c) => {
      if (!c) return c;
      const porId = new Map(c.parametros.map((p) => [p.id, p]));
      for (const p of guardados) porId.set(p.id, p);
      return { ...c, parametros: [...porId.values()] };
    });
  }, []);

  const pestanas: { id: Pestana; nombre: string }[] = [
    { id: "catalogo", nombre: "Catálogo de parámetros" },
    { id: "elementos", nombre: "Disciplinas y elementos" },
    { id: "matriz", nombre: "Matriz LOIN" },
    { id: "auditorias", nombre: "Auditorías" },
  ];

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#f7f8fa" }}>
      <header style={{ background: C.header, color: "#fff", display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Requisitos BIM (LOIN)</h1>
        <span style={{ opacity: 0.85, fontSize: 14 }}>{projectName || projectId}</span>
        <span style={{ flex: 1 }} />
        {estado && (
          <span style={{ fontSize: 13 }}>
            {estado.user.name}
            <span style={chip}>{estado.canEdit ? (estado.isAdmin ? "Administrador" : "Editor") : "Consulta"}</span>
          </span>
        )}
        {estado && (
          <button type="button" onClick={() => setConfig(true)} style={botonHeader} title="Editores, proyecto base del catálogo, grupos TDI, valores de relleno y umbral">
            ⚙ Configuración
          </button>
        )}
      </header>

      {error && (
        <div style={{ padding: 16 }}>
          <Notice kind="error">
            {error}{" "}
            <button type="button" onClick={cargar} style={linkBtn}>
              Reintentar
            </button>
          </Notice>
        </div>
      )}
      {!estado && !error && <p style={{ padding: 16, color: "var(--tc-gray-500)" }}>Cargando los requisitos del proyecto…</p>}

      {estado && catalogo && (
        <>
          <nav style={{ display: "flex", gap: 2, padding: "0 12px", borderBottom: `1px solid ${C.border}`, background: "#fff" }} aria-label="Secciones">
            {pestanas.map((p) => (
              <button key={p.id} type="button" onClick={() => setPestana(p.id)} style={tab(p.id === pestana)} aria-current={p.id === pestana ? "page" : undefined}>
                {p.nombre}
              </button>
            ))}
          </nav>
          <main style={{ flex: 1, minHeight: 0, padding: 16, display: "flex", flexDirection: "column" }}>
            {pestana === "catalogo" && <Catalogo api={api} estado={estado} catalogo={catalogo} proyecto={projectName || projectId} camposModelo={camposModelo} onGuardados={alGuardar} />}
            {pestana === "elementos" && <Disciplinas api={api} estado={estado} parametros={catalogo.parametros} tdiGrupos={catalogo.tdiGrupos} camposModelo={camposModelo} onParametros={alGuardar} />}
            {pestana === "matriz" && <Matriz api={api} estado={estado} parametros={catalogo.parametros} proyecto={projectName || projectId} />}
            {pestana === "auditorias" && <Auditorias api={api} estado={estado} parametros={catalogo.parametros} />}
          </main>
        </>
      )}

      {config && estado && (
        <ConfigDialog
          api={api}
          estado={estado}
          onChanged={(next, baseCambiada) => {
            setEstado(next);
            if (baseCambiada) api.getCatalogo().then(setCatalogo, (err) => setError(message(err)));
            else setCatalogo((c) => (c ? { ...c, tdiGrupos: next.tdiGrupos } : c));
          }}
          onClose={() => setConfig(false)}
        />
      )}
    </div>
  );
}

const chip: CSSProperties = { marginLeft: 8, background: "rgba(255,255,255,0.18)", borderRadius: 10, padding: "2px 9px", fontSize: 12 };
const botonHeader: CSSProperties = { border: "1px solid rgba(255,255,255,0.5)", background: "transparent", color: "#fff", borderRadius: 4, padding: "5px 10px", fontSize: 13, cursor: "pointer", fontFamily: "inherit" };

function tab(activa: boolean): CSSProperties {
  return {
    border: "none",
    borderBottom: `3px solid ${activa ? C.header : "transparent"}`,
    background: "transparent",
    padding: "10px 14px 8px",
    fontSize: 14,
    fontWeight: activa ? 600 : 400,
    color: activa ? C.header : "var(--tc-gray-700)",
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
