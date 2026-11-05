import { test } from "node:test";
import assert from "node:assert/strict";
import type { RawFolderItem } from "../trimbleApi";
import { recorrer } from "./recorrido";

const carpeta = (id: string, name: string): RawFolderItem => ({ id, name, type: "FOLDER", createdOn: "", modifiedOn: "" });
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

// arq > {modelo.rvt, Torre 1 > {detalle.dwg}, Otra revisión (another flow) > {ajeno.pdf}}
const ARBOL: Record<string, RawFolderItem[]> = {
  arq: [archivo("modelo", "modelo.rvt", 3), carpeta("t1", "Torre 1"), carpeta("otra", "Otra revisión")],
  t1: [archivo("detalle", "detalle.dwg", 1)],
  otra: [archivo("ajeno", "ajeno.pdf", 1)],
};
const INICIO = [{ id: "arq", ruta: "Obra / Arquitectura", ancestros: ["raiz"] }];
const deps = (arbol = ARBOL, reloj = () => 0) => ({ items: async (id: string) => (arbol[id] ? arbol[id] : Promise.reject(new Error("403"))), reloj });

test("recorre las subcarpetas, con quién subió la última versión, y deja las carpetas de otro flujo", async () => {
  const r = await recorrer(INICIO, new Set(["arq", "otra"]), deps());
  assert.equal(r.completo, true);
  assert.equal(r.carpetas, 2);
  assert.deepEqual(
    r.vistos.map((v) => [v.ruta, v.revision, v.subidoPor, v.ancestros.join(">")]),
    [
      ["Obra / Arquitectura / modelo.rvt", 3, "Juan Pérez", "raiz>arq"],
      ["Obra / Arquitectura / Torre 1 / detalle.dwg", 1, "Juan Pérez", "raiz>arq>t1"],
    ]
  );
  assert.equal(r.vistos[0].subido, "2026-11-03T19:20:00Z");
});

test("una carpeta que no se puede leer deja la revisión incompleta, sin perder lo demás", async () => {
  const r = await recorrer(INICIO, new Set(["arq"]), deps({ arq: ARBOL.arq, otra: ARBOL.otra }));
  assert.equal(r.completo, false);
  assert.match(r.motivo, /no se pudo leer «Obra \/ Arquitectura \/ Torre 1»/);
  assert.deepEqual(
    r.vistos.map((v) => v.fileId),
    ["modelo", "ajeno"]
  );
});

test("se detiene al acabarse el tiempo o al pasar el límite de archivos", async () => {
  let t = 0;
  const lento = await recorrer(INICIO, new Set(["arq"]), deps(ARBOL, () => (t += 30_000)), { tiempoMs: 50_000, maxCarpetas: 100, maxArchivos: 100, paralelo: 1 });
  assert.equal(lento.completo, false);
  assert.match(lento.motivo, /se acabó el tiempo/);
  const muchos = await recorrer(INICIO, new Set(["arq"]), deps(), { tiempoMs: 50_000, maxCarpetas: 100, maxArchivos: 1, paralelo: 1 });
  assert.equal(muchos.completo, false);
  assert.match(muchos.motivo, /más de 1 archivos/);
});
