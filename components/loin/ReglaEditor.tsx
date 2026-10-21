"use client";

import { CSSProperties, useId } from "react";
import { CAMPOS_FIJOS, OPERADORES, reglaDesdeClase } from "../../lib/loin/clasificacion";
import { CondicionRegla, MAX_CONDICIONES, OperadorRegla, ReglaAsociacion } from "../../lib/loin/types";
import { baseInput } from "../presupuesto/ui";
import { ayuda, linkBtn, select } from "./estilos";

const PROPIEDAD = "__propiedad__";

/**
 * Conditions on the IFC class, name, type, description, level or any
 * property ("Grupo.Propiedad", wildcards allowed), combined with Y or O.
 */
export default function ReglaEditor({
  regla,
  onChange,
  ro,
  claseIfc,
  campos,
  valores,
}: {
  regla: ReglaAsociacion | null;
  onChange: (r: ReglaAsociacion | null) => void;
  ro: boolean;
  /** The element's IFC class, to suggest the first condition. */
  claseIfc: string;
  /** "Grupo.Propiedad" names read from the models. */
  campos: string[];
  /** Common values of a field in the models read. */
  valores: (campo: string) => string[];
}) {
  const id = useId();
  const r = regla ?? { modo: "todas" as const, condiciones: [] };
  const set = (patch: Partial<ReglaAsociacion>) => onChange({ ...r, ...patch });
  const cambiar = (i: number, patch: Partial<CondicionRegla>) => set({ condiciones: r.condiciones.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
        <span>Un objeto es este elemento si cumple</span>
        <select value={r.modo} onChange={(e) => set({ modo: e.target.value as ReglaAsociacion["modo"] })} disabled={ro} style={select} aria-label="Cómo se combinan las condiciones">
          <option value="todas">todas las condiciones (Y)</option>
          <option value="alguna">alguna condición (O)</option>
        </select>
      </div>
      {r.condiciones.length === 0 && <p style={{ ...ayuda, margin: 0 }}>Sin condiciones: la regla no toma ningún objeto.</p>}
      {r.condiciones.map((c, i) => {
        const fijo = CAMPOS_FIJOS.some((f) => f.campo === c.campo);
        const sinValor = c.operador === "existe" || c.operador === "no_existe";
        return (
          <div key={i} style={fila}>
            <select
              value={fijo ? c.campo : PROPIEDAD}
              onChange={(e) => cambiar(i, { campo: e.target.value === PROPIEDAD ? "*." : e.target.value })}
              disabled={ro}
              style={{ ...select, flex: "1 1 110px" }}
              aria-label={`Campo de la condición ${i + 1}`}
            >
              {CAMPOS_FIJOS.map((f) => (
                <option key={f.campo} value={f.campo}>
                  {f.nombre}
                </option>
              ))}
              <option value={PROPIEDAD}>Propiedad…</option>
            </select>
            {!fijo && (
              <>
                <input
                  value={c.campo}
                  onChange={(e) => cambiar(i, { campo: e.target.value })}
                  readOnly={ro}
                  list={`${id}-campos`}
                  placeholder="Grupo.Propiedad o *.Propiedad"
                  style={{ ...baseInput, flex: "2 1 180px", fontFamily: "monospace", fontSize: 12.5 }}
                  aria-label={`Propiedad de la condición ${i + 1}`}
                />
              </>
            )}
            <select value={c.operador} onChange={(e) => cambiar(i, { operador: e.target.value as OperadorRegla })} disabled={ro} style={{ ...select, flex: "1 1 100px" }} aria-label={`Operador de la condición ${i + 1}`}>
              {(Object.entries(OPERADORES) as [OperadorRegla, string][]).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {!sinValor && (
              <>
                <input
                  value={c.valor}
                  onChange={(e) => cambiar(i, { valor: e.target.value })}
                  readOnly={ro}
                  list={`${id}-valores-${i}`}
                  placeholder="Valor"
                  style={{ ...baseInput, flex: "2 1 120px" }}
                  aria-label={`Valor de la condición ${i + 1}`}
                />
                <datalist id={`${id}-valores-${i}`}>
                  {valores(c.campo).map((v) => (
                    <option key={v} value={v} />
                  ))}
                </datalist>
              </>
            )}
            {!ro && (
              <button type="button" style={quitar} onClick={() => set({ condiciones: r.condiciones.filter((_, j) => j !== i) })} aria-label={`Quitar la condición ${i + 1}`}>
                ✕
              </button>
            )}
          </div>
        );
      })}
      <datalist id={`${id}-campos`}>
        {campos.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      {!ro && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            style={linkBtn}
            disabled={r.condiciones.length >= MAX_CONDICIONES}
            onClick={() => set({ condiciones: [...r.condiciones, { campo: "@tipo", operador: "contiene", valor: "" }] })}
          >
            + Condición
          </button>
          {claseIfc && (
            <button type="button" style={linkBtn} onClick={() => onChange(reglaDesdeClase(claseIfc))} title="Reemplaza la regla por: Clase IFC es la del elemento">
              Usar la clase IFC del elemento ({claseIfc})
            </button>
          )}
          {regla && (
            <button type="button" style={linkBtn} onClick={() => onChange(null)}>
              Sin regla
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const fila: CSSProperties = { display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", background: "#fff", border: "1px solid #e1e5ea", borderRadius: 4, padding: 4 };
const quitar: CSSProperties = { border: "1px solid #d6dbe1", background: "#fff", borderRadius: 3, padding: "2px 7px", cursor: "pointer", fontFamily: "inherit" };
