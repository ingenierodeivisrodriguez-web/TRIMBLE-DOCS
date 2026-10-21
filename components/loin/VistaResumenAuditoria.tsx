"use client";

import { CSSProperties } from "react";
import { ESTADOS, estadoDe, MOTIVOS_FALLA } from "../../lib/loin/auditoria";
import type { EstadoObjeto, MotivoFalla, ResumenAuditoria } from "../../lib/loin/types";
import { C } from "../presupuesto/ui";
import { ayuda } from "./estilos";

const MOTIVOS: MotivoFalla[] = ["falta", "modelado", "sin_llenar", "valor"];
const n = (x: number) => x.toLocaleString("es");

/** A status chip: color plus icon plus name, never color alone. */
export function ChipEstado({ estado, cantidad }: { estado: EstadoObjeto | "sin_clasificar"; cantidad?: number }) {
  const e = ESTADOS[estado];
  return (
    <span style={{ ...chip, background: e.color, color: estado === "parcial" ? "#0b0b0b" : "#fff" }}>
      {e.icono} {cantidad !== undefined ? `${n(cantidad)} ` : ""}
      {e.nombre.toLowerCase()}
    </span>
  );
}

/** A thin horizontal bar of a %, colored by its state (the value is written beside it). */
export function BarraPct({ pct, umbral, ancho = "100%" }: { pct: number; umbral: number; ancho?: string | number }) {
  const e = estadoDe(pct, umbral);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, width: ancho }}>
      <span style={{ flex: 1, height: 8, background: "#eceff3", borderRadius: 4, overflow: "hidden", minWidth: 40 }}>
        <span style={{ display: "block", width: `${Math.min(100, pct)}%`, height: "100%", background: ESTADOS[e].color, borderRadius: 4 }} />
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 46, textAlign: "right" }}>{pct.toLocaleString("es")} %</span>
    </span>
  );
}

/** What an audit says: the total, the states, each discipline and element, and what fails most. */
export default function VistaResumenAuditoria({ resumen, compacto = false }: { resumen: ResumenAuditoria; compacto?: boolean }) {
  const umbral = resumen.umbralAmarillo;
  const elementos = [...resumen.elementos].filter((e) => e.totales.objetos > 0).sort((a, b) => a.totales.pct - b.totales.pct);
  const codigoDisciplina = new Map(resumen.disciplinas.map((d) => [d.id, d.codigo]));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: compacto ? 26 : 32, fontWeight: 700, color: "var(--tc-gray-800, #1f2328)" }}>{resumen.total.pct.toLocaleString("es")} %</span>
        <span style={{ fontSize: 12.5, color: "var(--tc-gray-500)" }}>
          de los parámetros obligatorios cumplidos ({n(resumen.total.cumplidos)} de {n(resumen.total.exigidos)}) en {n(resumen.total.objetos)} objeto(s)
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <ChipEstado estado="cumple" cantidad={resumen.total.cumple} />
        <ChipEstado estado="parcial" cantidad={resumen.total.parcial} />
        <ChipEstado estado="no_cumple" cantidad={resumen.total.noCumple} />
        <ChipEstado estado="sin_clasificar" cantidad={resumen.sinClasificar} />
      </div>
      <p style={{ ...ayuda, margin: 0 }}>
        Incumplimientos obligatorios: {MOTIVOS.map((m) => `${MOTIVOS_FALLA[m].toLowerCase()} ${n(resumen.porMotivo[m])}`).join(" · ")}. Aceptados por excepción: {n(resumen.aceptados)}.
        {resumen.sinExigencia > 0 && ` ${n(resumen.sinExigencia)} objeto(s) son de elementos sin exigencia de información en esta etapa.`}
        {resumen.sinGuid > 0 && ` ${n(resumen.sinGuid)} objeto(s) sin IFCGUID.`}
      </p>

      <section>
        <strong style={sub}>Por disciplina</strong>
        {resumen.disciplinas.map((d) => (
          <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
            <span style={{ width: compacto ? 110 : 220, fontSize: 13, display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.nombre}>
                {d.codigo} · {d.nombre}
              </span>
            </span>
            <BarraPct pct={d.totales.pct} umbral={umbral} ancho="auto" />
            <span style={{ fontSize: 12, color: "var(--tc-gray-500)", whiteSpace: "nowrap" }}>{n(d.totales.objetos)} obj.</span>
          </div>
        ))}
      </section>

      <section>
        <strong style={sub}>Por elemento (los de menor cumplimiento primero)</strong>
        <div style={{ maxHeight: compacto ? 220 : 360, overflow: "auto", border: `1px solid ${C.border}`, borderRadius: 4, background: "#fff" }}>
          {elementos.map((e) => (
            <div key={e.id} style={{ display: "grid", gridTemplateColumns: compacto ? "1fr 120px" : "1fr 80px 70px 70px 70px 200px", gap: 6, alignItems: "center", padding: "4px 8px", borderBottom: `1px solid ${C.grid}`, fontSize: 12.5 }}>
              <span title={`NDI-${e.ndi}${e.lod ? ` · LOD ${e.lod}` : ""}`}>
                {codigoDisciplina.get(e.disciplinaId)} · {e.nombre}
              </span>
              {!compacto && (
                <>
                  <span>{n(e.totales.objetos)} obj.</span>
                  <span style={{ color: ESTADOS.cumple.color }}>✓ {n(e.totales.cumple)}</span>
                  <span style={{ color: "#8a6100" }}>◐ {n(e.totales.parcial)}</span>
                  <span style={{ color: ESTADOS.no_cumple.color }}>✗ {n(e.totales.noCumple)}</span>
                </>
              )}
              <BarraPct pct={e.totales.pct} umbral={umbral} />
            </div>
          ))}
          {elementos.length === 0 && <p style={{ ...ayuda, padding: 8 }}>Ningún objeto auditado.</p>}
        </div>
        {resumen.elementosSinObjetos.length > 0 && <p style={{ ...ayuda, color: "#b3261e" }}>Exigidos en la etapa sin objetos en los modelos: {resumen.elementosSinObjetos.join(", ")}.</p>}
      </section>

      {resumen.masIncumplidos.length > 0 && (
        <section>
          <strong style={sub}>Parámetros más incumplidos</strong>
          {resumen.masIncumplidos.slice(0, compacto ? 6 : 12).map((p) => (
            <div key={p.codigo} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "2px 0" }}>
              <span>
                {p.codigo} · {p.nombre}
              </span>
              <span style={{ color: "var(--tc-gray-500)", whiteSpace: "nowrap" }} title={MOTIVOS.filter((m) => p.porMotivo[m]).map((m) => `${MOTIVOS_FALLA[m]}: ${p.porMotivo[m]}`).join(" · ")}>
                {n(p.fallas)} objeto(s)
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

const chip: CSSProperties = { borderRadius: 10, padding: "2px 9px", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" };
const sub: CSSProperties = { display: "block", fontSize: 13, color: "var(--tc-blue-800)", margin: "2px 0 4px" };
