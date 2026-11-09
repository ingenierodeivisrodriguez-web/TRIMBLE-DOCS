import { test } from "node:test";
import assert from "node:assert/strict";
import type { RawFolderItem } from "../trimbleApi";
import { leerArchivos } from "./recorrido";
import type { CarpetaFlujo } from "./types";

const archivo = (id: string, name: string, revision: number, quien = { id: "juan", firstName: "Juan ", lastName: " Pérez" }): RawFolderItem => ({
  id,
  name,
  type: "FILE",
  createdOn: "2026-10-01T10:00:00Z",
  modifiedOn: "2026-11-03T19:20:00Z",
  createdBy: { id: "ana", firstName: "Ana", lastName: "Ruiz" },
  modifiedBy: quien,
  versionId: `${id}-v${revision}`,
  revision,
});

// Obra > Arquitectura > {modelo.rvt, fachada.pdf}, Obra > Estructura > {E-101.pdf}, Obra > Otra > {movido.dwg}
const ARBOL: Record<string, RawFolderItem[]> = {
  arq: [archivo("modelo", "modelo.rvt", 3), archivo("fachada", "fachada.pdf", 1), archivo("ajeno", "ajeno.pdf", 1)],
  est: [archivo("e101", "E-101.pdf", 2)],
  otra: [archivo("movido", "movido.dwg", 4)],
};
const el = (id: string, carpeta: string, nombre: string): CarpetaFlujo => ({ id, ruta: `Obra / ${carpeta === "arq" ? "Arquitectura" : carpeta === "est" ? "Estructura" : "Otra"} / ${nombre}`, ancestros: ["raiz", carpeta] });
const ELEGIDOS = [el("modelo", "arq", "modelo.rvt"), el("fachada", "arq", "fachada.pdf"), el("e101", "est", "E-101.pdf")];

function deps(o: { arbol?: Record<string, RawFolderItem[]>; donde?: Record<string, CarpetaFlujo>; reloj?: () => number } = {}) {
  const arbol = o.arbol ?? ARBOL;
  const leidas: string[] = [];
  return {
    leidas,
    items: async (id: string) => {
      leidas.push(id);
      return arbol[id] ? arbol[id] : Promise.reject(new Error("403"));
    },
    archivo: async (id: string) => {
      const e = o.donde?.[id];
      if (!e) throw Object.assign(new Error("No existe"), { status: 404 });
      return e;
    },
    reloj: o.reloj ?? (() => 0),
  };
}

test("lee los archivos elegidos con una sola consulta por carpeta, con quién subió la última versión", async () => {
  const d = deps();
  const r = await leerArchivos(ELEGIDOS, d);
  assert.equal(r.completo, true);
  assert.equal(r.carpetas, 2);
  assert.deepEqual(d.leidas.sort(), ["arq", "est"]);
  assert.deepEqual(
    r.vistos.map((v) => [v.ruta, v.revision, v.subidoPor, v.ancestros.join(">")]),
    [
      ["Obra / Arquitectura / modelo.rvt", 3, "Juan Pérez", "raiz>arq"],
      ["Obra / Arquitectura / fachada.pdf", 1, "Juan Pérez", "raiz>arq"],
      ["Obra / Estructura / E-101.pdf", 2, "Juan Pérez", "raiz>est"],
    ]
  );
  assert.equal(r.vistos[0].subido, "2026-11-03T19:20:00Z");
  assert.equal(r.vistos.some((v) => v.fileId === "ajeno"), false, "only the chosen ones");
});

test("un archivo que se movió se busca por sí solo y sale en su carpeta nueva", async () => {
  const d = deps({ donde: { movido: el("movido", "otra", "movido.dwg") } });
  const r = await leerArchivos([el("movido", "arq", "movido.dwg")], d);
  assert.equal(r.completo, true);
  assert.deepEqual(
    r.vistos.map((v) => [v.ruta, v.carpetaId, v.revision]),
    [["Obra / Otra / movido.dwg", "otra", 4]]
  );
});

test("Trimble dice que no existe: borrado; una carpeta que no se lee deja la lectura incompleta", async () => {
  const borrado = await leerArchivos([el("viejo", "arq", "viejo.rvt")], deps());
  assert.deepEqual(borrado.borrados, ["viejo"]);
  assert.equal(borrado.completo, true);
  // "est" can't be read and Trimble's own answer for the file isn't a 404.
  const sinPermiso = await leerArchivos(ELEGIDOS, {
    ...deps({ arbol: { arq: ARBOL.arq } }),
    archivo: async () => {
      throw Object.assign(new Error("403"), { status: 403 });
    },
  });
  assert.equal(sinPermiso.completo, false);
  assert.deepEqual(sinPermiso.fallidos, ["e101"]);
  assert.match(sinPermiso.motivo, /no se pudo leer «Obra \/ Estructura \/ E-101.pdf»/);
  assert.deepEqual(
    sinPermiso.vistos.map((v) => v.fileId),
    ["modelo", "fachada"]
  );
});

test("se detiene al acabarse el tiempo y lo que falta queda sin leer", async () => {
  let t = 0;
  const r = await leerArchivos(ELEGIDOS, deps({ reloj: () => (t += 30_000) }), { tiempoMs: 50_000, paralelo: 1 });
  assert.equal(r.completo, false);
  assert.match(r.motivo, /se acabó el tiempo/);
  assert.ok(r.fallidos.length > 0);
});
