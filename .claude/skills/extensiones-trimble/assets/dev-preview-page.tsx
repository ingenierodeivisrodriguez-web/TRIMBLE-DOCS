"use client";
// TEMPORARY local preview (never commit). Copy to app/dev-preview-<tema>/page.tsx,
// adapt the budget and catalog to the case, open http://localhost:3000/dev-preview-<tema>
// with the "resumen-archivos-dev" launch configuration, and delete it (plus .next/dev) after.
import { useMemo } from "react";
import PresupuestoApp from "../../components/presupuesto/PresupuestoApp";
import type { PresupuestoApi } from "../../lib/presupuesto/client";
import { documentoVacio } from "../../lib/presupuesto/doc";
import type { Componente, Insumo, Item } from "../../lib/presupuesto/types";

declare global {
  interface Window {
    __calls: unknown[];
  }
}

const ins = (id: string, descripcion: string, unidad: string, precio: number, tipo: Insumo["tipo"]): Insumo => ({
  id, codigo: "", descripcion, unidad, precio, tipo, iu: "", omniclass: "", updatedAt: null, updatedBy: null,
});
const crew = (id: string, cuadrilla: number): Componente => ({ tipo: "insumo", id, cuadrilla, cantidad: 0 });
const qty = (id: string, cantidad: number): Componente => ({ tipo: "insumo", id, cuadrilla: null, cantidad });
const P = (id: string, nivel: number, descripcion: string, unidad: string, rendimiento: number, componentes: Componente[], metrado: number): Item => ({
  id, tipo: "partida", nivel, codigo: "", descripcion, unidad, omniclass: "", rendimiento, jornada: 8, componentes, metrado, origenId: null,
});

function fake(): PresupuestoApi {
  const catalogo = [
    ins("ofi", "OFICIAL", "HH", 12_000, "MO"),
    ins("ayu", "AYUDANTE DE OBRA", "HH", 10_000, "MO"),
    ins("her", "HERRAMIENTA MENOR", "%MO", 0, "EQ"),
  ];
  const doc = documentoVacio();
  doc.subpresupuestos[0].items = [
    { id: "t1", tipo: "titulo", nivel: 0, descripcion: "ESTRUCTURA" },
    { id: "t11", tipo: "titulo", nivel: 1, descripcion: "PISO 1" },
    P("a", 2, "MANO DE OBRA, VACIADO DE LOSA ENTREPISO E= 15 CM", "M2", 20, [crew("ofi", 3), crew("ayu", 4), qty("her", 10)], 300),
  ];
  // The budget keeps its own copy of each resource's price, by catalog id.
  for (const i of catalogo) doc.insumos[i.id] = { codigo: i.codigo, descripcion: i.descripcion, unidad: i.unidad, precio: i.precio, tipo: i.tipo, iu: "", omniclass: "" };
  const no = () => Promise.reject(new Error("no"));
  const llamar = (x: unknown) => (window.__calls ??= []).push(x);
  return {
    getEstado: async () => ({
      projectId: "d",
      config: { baseProjectId: "d", baseProjectName: "", editores: [], memoriaColumnas: [] },
      esBasePropia: true, isAdmin: true, canEdit: true, canEditBase: true, baseNote: "", user: { id: "u", name: "Ana" },
    }),
    getCatalogo: async () => ({ baseProjectId: "d", insumos: catalogo, partidas: [], omniclass: [] }),
    getDocumento: async () => ({ doc, version: 1, updatedAt: null, updatedBy: null }),
    getResumen: async () => ({ mediciones: [], resumen: [] }),
    elementosDe: async () => [],
    tomarVista: async () => null,
    getAtributos: async () => ({ atributos: [], modelo: null }),
    // Saves are recorded in window.__calls to check what would be sent.
    guardarInsumos: async (rows) => (llamar({ guardarInsumos: rows }), rows.length),
    guardarPartidas: async (rows) => (llamar({ guardarPartidas: rows }), rows.length),
    updateConfig: no, getContacts: no, eliminarInsumo: no, eliminarPartida: no, guardarOmniclass: no,
    guardarDocumento: no, guardarElementos: no, guardarMedicion: no, guardarCamposModelo: no,
  } as PresupuestoApi;
}

export default function Preview() {
  const api = useMemo(fake, []);
  return <PresupuestoApp api={api} projectId="d" projectName="Laboratorio" />;
}
