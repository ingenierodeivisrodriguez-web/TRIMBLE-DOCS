"use client";

import { Nivel, Nodo, Ubicacion } from "../../lib/control-obra/types";
import { labelStyle } from "../presupuesto/ui";
import { select } from "../compras/estilos";

/**
 * One list per level of the structure, in order. A level inside another
 * (Nivel inside Torre) only offers the values of the one chosen above it;
 * changing the one above clears the ones below that no longer belong to it.
 */
export default function UbicacionSelector({
  niveles,
  nodos,
  obligatorios,
  value,
  onChange,
  disabled,
  idBase = "ubic",
}: {
  niveles: Nivel[];
  nodos: Nodo[];
  obligatorios: string[];
  value: Ubicacion;
  onChange: (u: Ubicacion) => void;
  disabled?: boolean;
  idBase?: string;
}) {
  // Levels without values are left out (unless required: then the person sees what is missing).
  const ordenados = [...niveles]
    .filter((n) => n.activo && (obligatorios.includes(n.clave) || value[n.clave] || nodos.some((x) => x.nivelClave === n.clave && x.estado !== "inactivo")))
    .sort((a, b) => a.orden - b.orden);
  const opciones = (n: Nivel) => {
    const padre = n.padreClave ? value[n.padreClave] : undefined;
    return nodos
      .filter((x) => x.nivelClave === n.clave && (x.estado !== "inactivo" || x.id === value[n.clave]) && (!padre || !x.padreId || x.padreId === padre))
      .sort((a, b) => a.valor.localeCompare(b.valor, "es", { numeric: true }));
  };

  function cambiar(clave: string, id: string) {
    const u: Ubicacion = { ...value };
    if (id) u[clave] = id;
    else delete u[clave];
    // Values below that belonged to another value above are cleared.
    for (const n of ordenados) {
      if (!n.padreClave || !u[n.clave]) continue;
      const nodo = nodos.find((x) => x.id === u[n.clave]);
      if (nodo?.padreId && u[n.padreClave] && nodo.padreId !== u[n.padreClave]) delete u[n.clave];
    }
    onChange(u);
  }

  if (!ordenados.length) {
    return <p style={{ fontSize: 13, color: "var(--tc-gray-500)", margin: 0 }}>La estructura de obra de este proyecto no tiene valores: créalos en «Proyecto y estructura de obra».</p>;
  }
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {ordenados.map((n) => {
        const lista = opciones(n);
        return (
          <div key={n.clave} style={{ minWidth: 140 }}>
            <label style={labelStyle} htmlFor={`${idBase}-${n.clave}`}>
              {n.nombre}
              {obligatorios.includes(n.clave) ? " *" : ""}
            </label>
            <select id={`${idBase}-${n.clave}`} value={value[n.clave] ?? ""} disabled={disabled || !lista.length} onChange={(e) => cambiar(n.clave, e.target.value)} style={{ ...select, width: "100%" }}>
              <option value="">{lista.length ? "—" : "(sin valores)"}</option>
              {lista.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.valor}
                  {x.estado === "cerrado" ? " (cerrado)" : ""}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}
