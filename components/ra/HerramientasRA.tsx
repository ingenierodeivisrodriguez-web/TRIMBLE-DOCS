"use client";

import { CSSProperties, useState } from "react";
import { cota, EstadoHerramientas, PALETA, rangoIfc } from "../../lib/ra/herramientas";
import type { ModeloRA } from "../../lib/ra/modelo";

type Pestana = "corteH" | "corteV" | "transparencia" | "colorear";

export interface Tocado {
  nombre: string;
  clase: string;
  nivel: string;
}

const AZUL = "#2f55b0";

/**
 * The tool bar over the camera (phase 4): CORTE HORIZONTAL, CORTE VERTICAL
 * (by the model's X / Y axes), TRANSPARENCIA and COLOREAR (by hand, only in
 * this phone). It only holds choices; the scene follows `estado`.
 */
export default function HerramientasRA({
  modelo,
  estado,
  cambiar,
  tocado,
  quitarColores,
}: {
  modelo: ModeloRA;
  estado: EstadoHerramientas;
  cambiar: (e: EstadoHerramientas) => void;
  tocado: Tocado | null;
  quitarColores: () => void;
}) {
  const [pestana, setPestana] = useState<Pestana | null>(null);
  const rz = rangoIfc(modelo, "z");
  const rv = rangoIfc(modelo, estado.corteV.eje);
  const boton = (p: Pestana, texto: string, encendido: boolean) => (
    <button
      onClick={() => setPestana(pestana === p ? null : p)}
      style={{
        ...chip,
        background: pestana === p ? "#fff" : encendido ? "#ffd400" : "rgba(255,255,255,.18)",
        color: pestana === p || encendido ? "#111" : "#fff",
      }}
    >
      {texto}
    </button>
  );

  return (
    <div style={{ background: "rgba(0,0,0,.62)", color: "#fff", borderRadius: 12, padding: 10, margin: "0 10px", fontSize: 14 }}>
      {tocado && (
        <div style={{ marginBottom: 8 }}>
          <b>{tocado.nombre || tocado.clase}</b> · {tocado.clase}
          {tocado.nivel && ` · ${tocado.nivel}`}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {boton("corteH", "Corte horizontal", estado.corteH.activo)}
        {boton("corteV", "Corte vertical", estado.corteV.activo)}
        {boton("transparencia", "Transparencia", estado.transparencia > 0)}
        {boton("colorear", "Colorear", estado.colorear.activo)}
      </div>

      {pestana === "corteH" && (
        <div style={panel}>
          <Interruptor activo={estado.corteH.activo} texto="Cortar a la altura" cambiar={(v) => cambiar({ ...estado, corteH: { ...estado.corteH, activo: v } })} />
          <Deslizador
            min={rz.min}
            max={rz.max}
            valor={estado.corteH.valor}
            cambiar={(v) => cambiar({ ...estado, corteH: { ...estado.corteH, valor: v, activo: true } })}
          />
          <div style={fila}>
            <span>Cota Z = {cota(estado.corteH.valor)}</span>
            <button style={chico} onClick={() => cambiar({ ...estado, corteH: { ...estado.corteH, invertido: !estado.corteH.invertido } })}>
              Ver {estado.corteH.invertido ? "lo de abajo" : "lo de arriba"}
            </button>
          </div>
        </div>
      )}

      {pestana === "corteV" && (
        <div style={panel}>
          <Interruptor activo={estado.corteV.activo} texto="Cortar en vertical" cambiar={(v) => cambiar({ ...estado, corteV: { ...estado.corteV, activo: v } })} />
          <div style={fila}>
            <span>Eje del modelo:</span>
            {(["x", "y"] as const).map((eje) => (
              <button
                key={eje}
                style={{ ...chico, background: estado.corteV.eje === eje ? "#ffd400" : "#fff" }}
                onClick={() => {
                  const r = rangoIfc(modelo, eje);
                  cambiar({ ...estado, corteV: { ...estado.corteV, eje, valor: Math.round(((r.min + r.max) / 2) * 100) / 100, activo: true } });
                }}
              >
                {eje.toUpperCase()}
              </button>
            ))}
          </div>
          <Deslizador min={rv.min} max={rv.max} valor={estado.corteV.valor} cambiar={(v) => cambiar({ ...estado, corteV: { ...estado.corteV, valor: v, activo: true } })} />
          <div style={fila}>
            <span>
              {estado.corteV.eje.toUpperCase()} = {cota(estado.corteV.valor)}
            </span>
            <button style={chico} onClick={() => cambiar({ ...estado, corteV: { ...estado.corteV, invertido: !estado.corteV.invertido } })}>
              Ver el otro lado
            </button>
          </div>
        </div>
      )}

      {pestana === "transparencia" && (
        <div style={panel}>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={Math.round(estado.transparencia * 100)}
            onChange={(e) => cambiar({ ...estado, transparencia: Number(e.target.value) / 100 })}
            style={{ width: "100%" }}
          />
          <div>Transparencia: {Math.round(estado.transparencia * 100)} %</div>
        </div>
      )}

      {pestana === "colorear" && (
        <div style={panel}>
          <Interruptor activo={estado.colorear.activo} texto="Colorear el elemento que toque" cambiar={(v) => cambiar({ ...estado, colorear: { ...estado.colorear, activo: v } })} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0" }}>
            {PALETA.map((c, i) => (
              <button
                key={c.nombre}
                title={c.nombre}
                aria-label={c.nombre}
                onClick={() => cambiar({ ...estado, colorear: { activo: true, color: i } })}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  border: estado.colorear.color === i ? "3px solid #fff" : "2px solid rgba(255,255,255,.4)",
                  background: `rgb(${c.rgb.map((x) => Math.round(x * 255)).join(",")})`,
                }}
              />
            ))}
            <button style={{ ...chico, background: estado.colorear.color === null ? "#ffd400" : "#fff" }} onClick={() => cambiar({ ...estado, colorear: { activo: true, color: null } })}>
              Borrador
            </button>
          </div>
          <div style={fila}>
            <span style={{ fontSize: 12.5, opacity: 0.85 }}>Los colores solo quedan en este celular mientras esté en esta pantalla.</span>
            <button style={chico} onClick={quitarColores}>
              Quitar todos
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Interruptor({ activo, texto, cambiar }: { activo: boolean; texto: string; cambiar: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <input type="checkbox" checked={activo} onChange={(e) => cambiar(e.target.checked)} style={{ width: 20, height: 20 }} />
      {texto}
    </label>
  );
}

function Deslizador({ min, max, valor, cambiar }: { min: number; max: number; valor: number; cambiar: (v: number) => void }) {
  return <input type="range" min={min} max={max} step={0.05} value={Math.min(max, Math.max(min, valor))} onChange={(e) => cambiar(Math.round(Number(e.target.value) * 100) / 100)} style={{ width: "100%" }} />;
}

const chip: CSSProperties = { padding: "8px 10px", borderRadius: 18, border: "none", fontWeight: 600, fontSize: 13.5 };
const chico: CSSProperties = { padding: "5px 10px", borderRadius: 14, border: "none", background: "#fff", color: AZUL, fontWeight: 600, fontSize: 13 };
const panel: CSSProperties = { marginTop: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,.25)" };
const fila: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginTop: 4 };
