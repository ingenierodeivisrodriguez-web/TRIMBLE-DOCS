import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FileDetails, FolderDetails, RawFolderItem } from "../trimbleApi";
import { TrimbleApiError } from "../trimbleApi";
import { parseCarpeta } from "./config";
import { abrirBiblioteca, archivo, buscar, listarCarpeta, ManualesError, Tc } from "./service";
import { vistaDe } from "./tipos";

// MANAGER PROJECT: root R > MANUALES (M) > Seguridad (S) > Equipos (E); R > Contratos (X) outside.
const P = "managerProj";
const folders: Record<string, { name: string; parentId: string | null }> = {
  R: { name: "MANAGER PROJECT", parentId: null },
  M: { name: "MANUALES", parentId: "R" },
  S: { name: "Seguridad", parentId: "M" },
  E: { name: "Equipos", parentId: "S" },
  X: { name: "Contratos", parentId: "R" },
};
const files: Record<string, { name: string; parentId: string }> = {
  f1: { name: "Manual de calidad.pdf", parentId: "M" },
  f2: { name: "Manual de seguridad en altura.pdf", parentId: "S" },
  f3: { name: "Contrato marco.pdf", parentId: "X" },
  f4: { name: "Grúa torre - manual.docx", parentId: "E" },
};

function pathTo(id: string | null): { id: string; name: string }[] {
  const out: { id: string; name: string }[] = [];
  for (let f = id; f; f = folders[f].parentId) out.unshift({ id: f, name: folders[f].name });
  return out;
}

/** Trimble as seen by a user who is (or not) a member, without access to some folders. */
function fakeTc({ miembro = true, sinAcceso = [] as string[] } = {}): Tc & { llamadas: string[] } {
  const llamadas: string[] = [];
  const denegar = (id: string) => {
    if (sinAcceso.includes(id)) throw new TrimbleApiError("forbidden", 403);
  };
  return {
    llamadas,
    async baseUrl(projectId) {
      if (!miembro || projectId !== P) throw new TrimbleApiError("El proyecto no fue encontrado", 404);
      return "https://tc";
    },
    async project() {
      return { name: "MANAGER PROJECT", rootId: "R" };
    },
    async folder(_b, id): Promise<FolderDetails> {
      llamadas.push(`folder:${id}`);
      denegar(id);
      if (!folders[id]) throw new TrimbleApiError("not found", 404);
      return { id, name: folders[id].name, parentId: folders[id].parentId, projectId: P, permission: "READ", path: pathTo(folders[id].parentId) };
    },
    async file(_b, id): Promise<FileDetails> {
      if (!files[id]) throw new TrimbleApiError("not found", 404);
      return { id, name: files[id].name, parentId: files[id].parentId, versionId: `${id}v`, size: 1000, path: pathTo(files[id].parentId) };
    },
    async items(_b, id): Promise<RawFolderItem[]> {
      llamadas.push(`items:${id}`);
      denegar(id);
      const sub = Object.entries(folders)
        .filter(([, f]) => f.parentId === id)
        .map(([fid, f]) => ({ id: fid, name: f.name, type: "FOLDER" as const, createdOn: "", modifiedOn: "2026-10-01T10:00:00Z" }));
      const fs = Object.entries(files)
        .filter(([, f]) => f.parentId === id)
        .map(([fid, f]) => ({ id: fid, name: f.name, type: "FILE" as const, size: 2048, createdOn: "", modifiedOn: "2026-10-02T10:00:00Z", versionId: `${fid}v`, revision: 3, modifiedBy: { firstName: "Ana", lastName: "Pérez" } }));
      return [...fs, ...sub];
    },
    async downloadUrl(_b, id, options) {
      return `https://storage/${id}?v=${options.versionId}${options.format ? `&f=${options.format}` : ""}`;
    },
  };
}

const CFG = { projectId: P, folderId: "M" };

async function sinAcceso(promise: Promise<unknown>, code = "sin-acceso") {
  await assert.rejects(promise, (err: unknown) => err instanceof ManualesError && err.code === code);
}

describe("acceso a los manuales", () => {
  it("quien no es miembro del proyecto de manuales no tiene acceso", async () => {
    await sinAcceso(abrirBiblioteca(fakeTc({ miembro: false }), CFG));
  });

  it("quien no tiene permiso sobre la carpeta no tiene acceso", async () => {
    await sinAcceso(abrirBiblioteca(fakeTc({ sinAcceso: ["M"] }), CFG));
  });

  it("con permiso abre la carpeta: carpetas primero, luego archivos", async () => {
    const tc = fakeTc();
    const abierta = await abrirBiblioteca(tc, CFG);
    assert.deepEqual(abierta.biblioteca, { projectId: P, projectName: "MANAGER PROJECT", carpetaId: "M", carpetaNombre: "MANUALES", permiso: "READ" });
    const r = await listarCarpeta(tc, abierta);
    assert.deepEqual(r.items.map((i) => [i.tipo, i.nombre]), [
      ["carpeta", "Seguridad"],
      ["archivo", "Manual de calidad.pdf"],
    ]);
    assert.equal(r.items[1].ext, "pdf");
    assert.equal(r.items[1].modificadoPor, "Ana Pérez");
    assert.deepEqual(r.carpeta.ruta.map((x) => x.nombre), ["MANUALES"]);
  });

  it("entra a subcarpetas con su ruta, pero nunca fuera de la carpeta de manuales", async () => {
    const tc = fakeTc();
    const abierta = await abrirBiblioteca(tc, CFG);
    const e = await listarCarpeta(tc, abierta, "E");
    assert.deepEqual(e.carpeta.ruta.map((x) => x.nombre), ["MANUALES", "Seguridad", "Equipos"]);
    assert.deepEqual(e.items.map((i) => i.nombre), ["Grúa torre - manual.docx"]);
    await sinAcceso(listarCarpeta(tc, abierta, "X"), "fuera");
    await sinAcceso(listarCarpeta(tc, abierta, "R"), "fuera");
  });

  it("una subcarpeta sin permiso dice que no tiene acceso", async () => {
    const tc = fakeTc({ sinAcceso: ["S"] });
    const abierta = await abrirBiblioteca(tc, CFG);
    await sinAcceso(listarCarpeta(tc, abierta, "S"));
  });

  it("entrega el enlace de un archivo de los manuales, y de ninguno de fuera", async () => {
    const tc = fakeTc();
    const abierta = await abrirBiblioteca(tc, CFG);
    const a = await archivo(tc, abierta, "f2");
    assert.equal(a.url, "https://storage/f2?v=f2v");
    assert.equal(a.ext, "pdf");
    assert.equal(a.enTrimble, `https://web.connect.trimble.com/projects/${P}/viewer/2D?id=f2&version=f2v`);
    assert.equal((await archivo(tc, abierta, "f4", true)).url, "https://storage/f4?v=f4v&f=PDF");
    await sinAcceso(archivo(tc, abierta, "f3"), "fuera");
    await sinAcceso(archivo(tc, abierta, "nada"));
  });

  it("sin carpeta configurada usa todo el proyecto", async () => {
    const tc = fakeTc();
    const abierta = await abrirBiblioteca(tc, { projectId: P, folderId: null });
    assert.equal(abierta.biblioteca.carpetaNombre, "MANAGER PROJECT");
    assert.equal((await archivo(tc, abierta, "f3")).nombre, "Contrato marco.pdf");
  });
});

describe("búsqueda", () => {
  it("busca en todas las subcarpetas por palabras, sin tildes ni mayúsculas, y salta las que no se pueden abrir", async () => {
    const tc = fakeTc();
    const abierta = await abrirBiblioteca(tc, CFG);
    const r = await buscar(tc, abierta, "MANUAL grua");
    assert.deepEqual(r.resultados.map((x) => [x.nombre, x.ruta]), [["Grúa torre - manual.docx", "Seguridad / Equipos"]]);
    assert.equal(r.completa, true);
    const todos = await buscar(tc, abierta, "manual");
    assert.equal(todos.resultados.length, 3);
    assert.ok(!tc.llamadas.includes("items:X"));
    const sinSeguridad = await buscar(fakeTc({ sinAcceso: ["S"] }), abierta, "manual");
    assert.deepEqual(sinSeguridad.resultados.map((x) => x.nombre), ["Manual de calidad.pdf"]);
  });
});

describe("configuración y tipos", () => {
  it("lee el enlace de la carpeta copiado de Trimble Connect", () => {
    assert.deepEqual(parseCarpeta("https://web.connect.trimble.com/projects/AbC_123-x/data/folder/Fold3r_99"), { projectId: "AbC_123-x", folderId: "Fold3r_99" });
    assert.deepEqual(parseCarpeta("https://web.connect.trimble.com/projects/AbC_123-x/data"), { projectId: "AbC_123-x", folderId: null });
    assert.deepEqual(parseCarpeta("https://web.connect.trimble.com/projects/AbC1/data?folderId=F0lder"), { projectId: "AbC1", folderId: "F0lder" });
    assert.deepEqual(parseCarpeta(" AbC1/F0lder "), { projectId: "AbC1", folderId: "F0lder" });
    assert.equal(parseCarpeta(""), null);
    assert.equal(parseCarpeta("no es un enlace"), null);
  });

  it("decide cómo mostrar cada archivo", () => {
    assert.equal(vistaDe("pdf"), "pdf");
    assert.equal(vistaDe("jpg"), "imagen");
    assert.equal(vistaDe("mp4"), "video");
    assert.equal(vistaDe("docx"), "convertir");
    assert.equal(vistaDe("zip"), "ninguna");
  });
});
