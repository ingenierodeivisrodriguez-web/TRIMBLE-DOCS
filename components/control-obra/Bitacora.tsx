"use client";

import { useCallback, useEffect, useState } from "react";
import { detalleEntrada, MODULOS_BITACORA, nombreAccion, sobreQue } from "../../lib/control-obra/formato";
import { EntradaBitacora, FiltroBitacora, MAX_BITACORA, ResultadoBitacora, VerificacionBitacora } from "../../lib/control-obra/types";
import { fechaHora } from "../../lib/compras/formato";
import { parseDisplayDate } from "../../lib/propiedades/values";
import { C, labelStyle, message, Notice } from "../presupuesto/ui";
import DateField from "../propiedades/DateField";
import { botonSecundario, etiqueta, select, td, th } from "../compras/estilos";

const RESULTADOS: Record<ResultadoBitacora, { texto: string; color: string; fondo: string }> = {
  ok: { texto: "Hecho", color: "#2e6b22", fondo: "#e3f3de" },
  denegado: { texto: "Negado", color: "#b3261e", fondo: "#fbe4e2" },
  error: { texto: "Error", color: "#7a5a00", fondo: "#fff4d1" },
};

/** Where the rows come from: this project's API, or the technical administrator's for a company (or its own chain). */
export interface FuenteBitacora {
  consultar(f: FiltroBitacora): Promise<EntradaBitacora[]>;
  verificar(): Promise<VerificacionBitacora>;
}

/** The bitácora: read only, newest first, with the check of its chain. */
export default function Bitacora({
  api,
  fuente,
  todaLaEmpresa,
  onSinAcceso,
}: {
  api?: { getBitacora(f: FiltroBitacora): Promise<{ entradas: EntradaBitacora[] }>; verificarBitacora(): Promise<VerificacionBitacora> };
  fuente?: FuenteBitacora;
  /** The company administrator may choose between the whole company and this project. */
  todaLaEmpresa?: boolean;
  onSinAcceso?: (err: unknown) => void;
}) {
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [resultado, setResultado] = useState<ResultadoBitacora | "">("");
  const [modulo, setModulo] = useState("");
  const [soloProyecto, setSoloProyecto] = useState(false);
  const [entradas, setEntradas] = useState<EntradaBitacora[] | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verificacion, setVerificacion] = useState<VerificacionBitacora | null>(null);

  const desdeIso = desde.trim() ? parseDisplayDate(desde) : null;
  const hastaIso = hasta.trim() ? parseDisplayDate(hasta) : null;
  const fechasMal = (desde.trim() && !desdeIso) || (hasta.trim() && !hastaIso);
  const origen: FuenteBitacora | null = fuente ?? (api ? { consultar: (f) => api.getBitacora(f).then((r) => r.entradas), verificar: () => api.verificarBitacora() } : null);

  const consultar = useCallback(
    async (antesDe?: number) => {
      if (fechasMal || !origen) return;
      setBusy(true);
      setError("");
      const filtro: FiltroBitacora = {
        ...(desdeIso ? { desde: desdeIso } : {}),
        ...(hastaIso ? { hasta: hastaIso } : {}),
        ...(resultado ? { resultado } : {}),
        ...(modulo ? { modulo } : {}),
        ...(soloProyecto ? { soloProyecto } : {}),
        ...(antesDe ? { antesDe } : {}),
        limite: MAX_BITACORA,
      };
      try {
        const nuevas = await origen.consultar(filtro);
        setEntradas((prev) => (antesDe && prev ? [...prev, ...nuevas] : nuevas));
        setHayMas(nuevas.length === MAX_BITACORA);
      } catch (err) {
        setError(message(err));
        onSinAcceso?.(err);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, fuente, desdeIso, hastaIso, resultado, modulo, soloProyecto, fechasMal, onSinAcceso]
  );

  useEffect(() => {
    consultar();
    // Only on opening (or when the source changes); afterwards with the "Consultar" button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, fuente]);

  async function verificar() {
    if (!origen) return;
    setError("");
    try {
      setVerificacion(await origen.verificar());
      consultar();
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <div style={{ background: "#fff", border: `1px solid ${C.border}`, borderRadius: 6 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end", padding: "10px 12px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
        <div style={{ width: 160 }}>
          <label style={labelStyle} htmlFor="bit-desde">
            Desde
          </label>
          <DateField id="bit-desde" text={desde} placeholder="DD-MM-AAAA" invalid={!!desde.trim() && !desdeIso} onText={setDesde} />
        </div>
        <div style={{ width: 160 }}>
          <label style={labelStyle} htmlFor="bit-hasta">
            Hasta
          </label>
          <DateField id="bit-hasta" text={hasta} placeholder="DD-MM-AAAA" invalid={!!hasta.trim() && !hastaIso} onText={setHasta} />
        </div>
        <div>
          <label style={labelStyle} htmlFor="bit-resultado">
            Resultado
          </label>
          <select id="bit-resultado" value={resultado} onChange={(e) => setResultado(e.target.value as ResultadoBitacora | "")} style={select}>
            <option value="">Todos</option>
            <option value="ok">Hecho</option>
            <option value="denegado">Negado</option>
            <option value="error">Error</option>
          </select>
        </div>
        <div>
          <label style={labelStyle} htmlFor="bit-modulo">
            Módulo
          </label>
          <select id="bit-modulo" value={modulo} onChange={(e) => setModulo(e.target.value)} style={select}>
            <option value="">Todos</option>
            {MODULOS_BITACORA.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </div>
        {todaLaEmpresa && (
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center", paddingBottom: 6 }}>
            <input type="checkbox" checked={soloProyecto} onChange={(e) => setSoloProyecto(e.target.checked)} />
            Solo este proyecto
          </label>
        )}
        <button type="button" onClick={() => consultar()} disabled={busy || !!fechasMal} style={{ ...botonSecundario, padding: "6px 14px", fontSize: 14 }}>
          {busy ? "Consultando…" : "Consultar"}
        </button>
        <button
          type="button"
          onClick={verificar}
          style={{ ...botonSecundario, padding: "6px 14px", fontSize: 14 }}
          title="Recalcula la cadena de huellas (SHA-256) de toda la bitácora de la empresa: si alguien cambió o borró una fila por fuera de la app, dice en cuál."
        >
          Verificar integridad
        </button>
      </div>
      <div style={{ padding: "8px 12px 0", fontSize: 12.5, color: "var(--tc-gray-500)" }}>
        Solo lectura: nadie puede cambiar ni borrar estas filas. Cada fila guarda la huella de la anterior, así un cambio hecho por fuera queda en evidencia. Los
        intentos sin permiso también quedan.
      </div>
      {verificacion && (
        <Notice kind={verificacion.integra ? "info" : "error"} style={{ margin: "8px 12px 0" }}>
          {verificacion.integra
            ? `La bitácora está íntegra: ${verificacion.filas} filas, cada una sigue a la anterior y su huella cuadra.`
            : `La bitácora no cuadra desde la fila ${verificacion.rotaEn} (de ${verificacion.filas}): alguien la cambió por fuera de la app. Avisa al administrador técnico.`}
        </Notice>
      )}
      {error && <Notice kind="error" style={{ margin: 12 }}>{error}</Notice>}
      <div style={{ overflow: "auto", maxHeight: "calc(100vh - 260px)", marginTop: 8 }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={th}>N.º</th>
              <th style={th}>Fecha y hora</th>
              <th style={th}>Quién</th>
              <th style={th}>Qué</th>
              <th style={th}>Sobre qué</th>
              <th style={th}>Resultado</th>
              <th style={th}>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {(entradas ?? []).map((e) => {
              const r = RESULTADOS[e.resultado];
              return (
                <tr key={`${e.cadena}:${e.n}`}>
                  <td style={{ ...td, color: "var(--tc-gray-500)", fontVariantNumeric: "tabular-nums" }} title={`Huella ${e.hash.slice(0, 12)}…`}>
                    {e.n}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fechaHora(e.creado)}</td>
                  <td style={td}>{e.actorNombre || e.actorId}</td>
                  <td style={td}>{nombreAccion(e.accion)}</td>
                  <td style={{ ...td, fontSize: 12.5 }}>{sobreQue(e)}</td>
                  <td style={td}>
                    <span style={etiqueta(r.color, r.fondo)}>{r.texto}</span>
                  </td>
                  <td style={{ ...td, fontSize: 12.5, color: "var(--tc-gray-500)" }}>{detalleEntrada(e)}</td>
                </tr>
              );
            })}
            {entradas && entradas.length === 0 && (
              <tr>
                <td style={{ ...td, color: "var(--tc-gray-500)" }} colSpan={7}>
                  No hay registros con estos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {hayMas && entradas && (
        <div style={{ padding: 10, textAlign: "center" }}>
          <button type="button" onClick={() => consultar(entradas[entradas.length - 1].n)} disabled={busy} style={botonSecundario}>
            Ver más antiguos
          </button>
        </div>
      )}
    </div>
  );
}
