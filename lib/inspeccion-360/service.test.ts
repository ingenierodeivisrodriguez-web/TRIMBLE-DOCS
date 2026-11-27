import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ClienteTrimble, Respuesta } from "../compras/cde";
import type { Caller } from "../propiedades/service";
import { alinearCaptura, anularCaptura, archivoFoto, confirmarSubida, crearPunto, Ctx, editarPunto, estado, guardarConfig, iniciarSubida, listarCapturas, listarPuntos } from "./service";
import { archivosEnMemoria, memoryStore } from "./store";

const P = "BUJGfcZ3AEI";
const ADMIN: Caller = { id: "admin1", name: "Ana Admin", isAdmin: true };
const LUIS: Caller = { id: "luis2", name: "Luis Inspector", isAdmin: false };
const MARTA: Caller = { id: "marta3", name: "Marta Lectora", isAdmin: false };
const AHORA = new Date("2026-11-26T15:00:00Z");
const MINI = "data:image/jpeg;base64,QUJD";

/** A minimal JPEG (SOI + SOF0 2048 × 1024 + SOS) padded to `tamano` bytes. */
function jpeg(tamano = 4096): Uint8Array {
  const cabeza = [0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x04, 0x00, 0x08, 0x00, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xda, 0, 12, 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0];
  const b = new Uint8Array(tamano);
  b.set(cabeza);
  return b;
}

/** A fake Trimble project: folders by name, uploads that finish when the content arrives. */
function trimbleFalso() {
  const carpetas = new Map<string, { id: string; name: string; padre: string | null }>([["raiz", { id: "raiz", name: "Laboratorio", padre: null }]]);
  const archivos = new Map<string, { id: string; versionId: string; name: string; carpeta: string; bytes: number }>();
  const subidas = new Map<string, { carpeta: string; name: string; recibido: number | null }>();
  let n = 0;
  const r = (estado: number, cuerpo: unknown): Respuesta => ({ estado, cuerpo });
  const cliente: ClienteTrimble = {
    async pedir(metodo, ruta, opciones = {}) {
      const u = new URL(`https://tc.test${ruta}`);
      let m: RegExpExecArray | null;
      if (metodo === "GET" && (m = /^\/folders\/([^/]+)$/.exec(u.pathname))) {
        const c = carpetas.get(decodeURIComponent(m[1]));
        return c ? r(200, { id: c.id, versionId: c.id, name: c.name, permission: "FULL_ACCESS" }) : r(404, null);
      }
      if (metodo === "GET" && (m = /^\/folders\/([^/]+)\/item$/.exec(u.pathname))) {
        const padre = decodeURIComponent(m[1]);
        const nombre = u.searchParams.get("name");
        if (u.searchParams.get("type") === "FOLDER") {
          const c = [...carpetas.values()].find((x) => x.padre === padre && x.name === nombre);
          return c ? r(200, { id: c.id, versionId: c.id }) : r(404, null);
        }
        const a = [...archivos.values()].find((x) => x.carpeta === padre && x.name === nombre);
        return a ? r(200, { id: a.id, versionId: a.versionId }) : r(404, null);
      }
      if (metodo === "POST" && u.pathname === "/folders") {
        const { name, parentId } = opciones.cuerpo as { name: string; parentId: string };
        const id = `c${++n}`;
        carpetas.set(id, { id, name, padre: parentId });
        return r(201, { id, versionId: id, name });
      }
      if (metodo === "POST" && u.pathname === "/files/fs/upload") {
        const nombre = (opciones.cuerpo as { name: string }).name;
        const carpeta = u.searchParams.get("parentId")!;
        if (opciones.encabezados?.["If-None-Match"] === "*" && [...archivos.values()].some((a) => a.carpeta === carpeta && a.name === nombre)) return r(412, null);
        const uploadId = `u${++n}`;
        subidas.set(uploadId, { carpeta, name: nombre, recibido: null });
        return r(200, { uploadId, status: "UPLOADABLE", contents: [{ url: `https://s3.test/${uploadId}` }] });
      }
      if (metodo === "GET" && u.pathname === "/files/fs/upload") {
        const id = u.searchParams.get("uploadId")!;
        const s = subidas.get(id)!;
        if (s.recibido === null) return r(200, { uploadId: id, status: "UPLOADABLE" });
        let a = [...archivos.values()].find((x) => x.carpeta === s.carpeta && x.name === s.name);
        if (!a) {
          a = { id: `f${++n}`, versionId: `v${++n}`, name: s.name, carpeta: s.carpeta, bytes: s.recibido };
          archivos.set(a.id, a);
        }
        return r(200, { uploadId: id, status: "DONE", fileId: a.id, versionId: a.versionId, revision: 1 });
      }
      return r(404, null);
    },
  };
  const enviar = async (url: string, datos: Uint8Array) => {
    const s = subidas.get(url.split("/").pop()!);
    if (!s) return 403;
    s.recibido = datos.length;
    // Trimble registers the file as soon as the content arrives.
    if (![...archivos.values()].some((x) => x.carpeta === s.carpeta && x.name === s.name)) {
      const id = `f${++n}`;
      archivos.set(id, { id, versionId: `v${++n}`, name: s.name, carpeta: s.carpeta, bytes: datos.length });
    }
    return 200;
  };
  const rutaDe = (id: string): string[] => {
    const c = carpetas.get(id)!;
    return c.padre ? [...rutaDe(c.padre), c.name] : [];
  };
  return { cliente, enviar, carpetas, archivos, rutaDe };
}

function entorno() {
  const archivos = archivosEnMemoria();
  const store = memoryStore(archivos);
  const tc = trimbleFalso();
  const ctx = (caller: Caller): Ctx => ({
    projectId: P,
    caller,
    store,
    ahora: () => AHORA,
    deps: { cde: async () => ({ cliente: tc.cliente, rootId: "raiz" }), enviar: tc.enviar, esperar: async () => {} },
  });
  return { store, archivos, tc, ctx };
}

const nuevoPunto = { torre: "TR1", piso: "P05", unidad: "APT501", espacio: "Sala-comedor", zona: "Zona social", modelId: "h_Bb7AOsKlg", versionId: "L9JWT4xNrAM", piso3d: [-2, 0.24, 0.05] };

async function conCodigo(e: ReturnType<typeof entorno>, editores: string[] = []) {
  await guardarConfig(e.ctx(ADMIN), { codigoProyecto: "mal", editores, version: 0 });
}

describe("configuración y permisos", () => {
  it("solo un administrador fija el código del proyecto; queda en mayúsculas", async () => {
    const e = entorno();
    await assert.rejects(guardarConfig(e.ctx(LUIS), { codigoProyecto: "MAL", version: 0 }), /administradores/);
    const c = await guardarConfig(e.ctx(ADMIN), { codigoProyecto: "mal", editores: ["luis2"], version: 0 });
    assert.equal(c.codigoProyecto, "MAL");
    assert.deepEqual((await estado(e.ctx(LUIS))).puedeEditar, true);
    assert.deepEqual((await estado(e.ctx(MARTA))).puedeEditar, false);
  });

  it("una configuración guardada con versión vieja no pisa la de otra persona", async () => {
    const e = entorno();
    await conCodigo(e);
    await assert.rejects(guardarConfig(e.ctx(ADMIN), { codigoProyecto: "MAL", editores: ["x"], version: 0 }), (err: unknown) => (err as { constructor: { name: string } }).constructor.name === "ConflictoVersion");
  });

  it("el código del proyecto no cambia cuando ya hay puntos", async () => {
    const e = entorno();
    await conCodigo(e);
    await crearPunto(e.ctx(ADMIN), nuevoPunto);
    await assert.rejects(guardarConfig(e.ctx(ADMIN), { codigoProyecto: "OTR", version: 1 }), /no se puede cambiar/);
  });
});

describe("puntos de captura", () => {
  it("sin código de proyecto no se crean puntos", async () => {
    const e = entorno();
    await assert.rejects(crearPunto(e.ctx(ADMIN), nuevoPunto), /código del proyecto/);
  });

  it("crea el punto con el siguiente número de la unidad y suma la altura del trípode", async () => {
    const e = entorno();
    await conCodigo(e);
    const p1 = await crearPunto(e.ctx(ADMIN), nuevoPunto);
    const p2 = await crearPunto(e.ctx(ADMIN), { ...nuevoPunto, espacio: "Alcoba 1", alturaM: 1.4 });
    assert.equal(p1.codigo, "MAL-TR1-P05-APT501-C01");
    assert.equal(p2.codigo, "MAL-TR1-P05-APT501-C02");
    assert.ok(Math.abs(p1.z - 1.55) < 1e-9);
    assert.ok(Math.abs(p2.z - 1.45) < 1e-9);
    assert.equal(p1.zona, "Zona social");
  });

  it("normaliza lo escrito: 'tr 1', 'p05', 'apt-501'", async () => {
    const e = entorno();
    await conCodigo(e);
    const p = await crearPunto(e.ctx(ADMIN), { ...nuevoPunto, torre: "tr 1", piso: "p05", unidad: "apt-501" });
    assert.equal(p.codigo, "MAL-TR1-P05-APT501-C01");
  });

  it("un miembro que no es editor no crea puntos", async () => {
    const e = entorno();
    await conCodigo(e);
    await assert.rejects(crearPunto(e.ctx(MARTA), nuevoPunto), /administradores del proyecto y los editores/);
  });

  it("desactivar pide motivo y no se reutiliza el código", async () => {
    const e = entorno();
    await conCodigo(e);
    const p = await crearPunto(e.ctx(ADMIN), nuevoPunto);
    await assert.rejects(editarPunto(e.ctx(ADMIN), p.id, { version: p.version, estado: "inactivo" }), /motivo/);
    const inactivo = await editarPunto(e.ctx(ADMIN), p.id, { version: p.version, estado: "inactivo", motivo: "Se movió por un acopio" });
    assert.equal(inactivo.estado, "inactivo");
    const otro = await crearPunto(e.ctx(ADMIN), nuevoPunto);
    assert.equal(otro.codigo, "MAL-TR1-P05-APT501-C02");
    await assert.rejects(crearPunto(e.ctx(ADMIN), { ...nuevoPunto, numero: 1 }), /no se reutilizan/);
  });

  it("cambiar la altura conserva el piso tocado", async () => {
    const e = entorno();
    await conCodigo(e);
    const p = await crearPunto(e.ctx(ADMIN), nuevoPunto);
    const q = await editarPunto(e.ctx(ADMIN), p.id, { version: p.version, alturaM: 1.2 });
    assert.ok(Math.abs(q.z - 1.25) < 1e-9);
  });
});

describe("fotos por fecha", () => {
  async function subir(e: ReturnType<typeof entorno>, caller: Caller, puntoId: string, tomadaEn: string, bytes = jpeg()) {
    const s = await iniciarSubida(e.ctx(caller), { puntoId, tomadaEn, nombreOriginal: "IMG_001.jpg", tamano: bytes.length, ancho: 2048, alto: 1024, miniatura: MINI, observaciones: "Pañete en curso" });
    // The browser PUTs to the signed URL; in memory, store the bytes where it points.
    e.archivos.contenido.set(`${P}/${s.captura.foto!.id}.jpg`, bytes);
    return s;
  }

  it("sube la foto al CDE en Inspección 360/TR1/P05/APT501/C01 con nombre fijo y borra la copia temporal", async () => {
    const e = entorno();
    await conCodigo(e, ["luis2"]);
    const p = await crearPunto(e.ctx(ADMIN), nuevoPunto);
    const s = await subir(e, LUIS, p.id, "2026-11-26T09:30:00-05:00");
    assert.equal(s.captura.estado, "subiendo");
    assert.equal(s.captura.foto?.nombreArchivo, "MAL-TR1-P05-APT501-C01_20261126-0930_360.jpg");
    const lista = await confirmarSubida(e.ctx(LUIS), s.captura.foto!.id);
    assert.equal(lista.estado, "lista");
    assert.equal(lista.foto?.estado, "en_cde");
    const archivo = [...e.tc.archivos.values()][0];
    assert.deepEqual(e.tc.rutaDe(archivo.carpeta), ["Inspección 360", "TR1", "P05", "APT501", "C01"]);
    assert.equal(archivo.name, "MAL-TR1-P05-APT501-C01_20261126-0930_360.jpg");
    assert.equal(e.archivos.contenido.size, 0);
    assert.deepEqual(await archivoFoto(e.ctx(MARTA), lista.foto!.id), { fileId: archivo.id, versionId: archivo.versionId, nombre: archivo.name });
  });

  it("lista las capturas del punto de la más nueva a la más vieja, y el punto cuenta solo las listas", async () => {
    const e = entorno();
    await conCodigo(e);
    const p = await crearPunto(e.ctx(ADMIN), nuevoPunto);
    for (const fecha of ["2026-11-15T09:00:00-05:00", "2026-11-25T10:00:00-05:00"]) {
      const s = await subir(e, ADMIN, p.id, fecha);
      await confirmarSubida(e.ctx(ADMIN), s.captura.foto!.id);
    }
    await subir(e, ADMIN, p.id, "2026-11-26T08:00:00-05:00"); // still uploading
    const capturas = await listarCapturas(e.ctx(MARTA), p.id);
    assert.deepEqual(capturas.map((c) => c.tomadaEn), ["2026-11-26T08:00:00-05:00", "2026-11-25T10:00:00-05:00", "2026-11-15T09:00:00-05:00"]);
    assert.equal(capturas[0].puedeAnular, false); // Marta only reads
    const [punto] = await listarPuntos(e.ctx(MARTA));
    assert.equal(punto.capturas, 2);
    assert.equal(punto.ultimaCaptura, "2026-11-25T10:00:00-05:00");
  });

  it("dos fotos del mismo punto en el mismo minuto no chocan de nombre", async () => {
    const e = entorno();
    await conCodigo(e);
    const p = await crearPunto(e.ctx(ADMIN), nuevoPunto);
    const a = await subir(e, ADMIN, p.id, "2026-11-26T09:30:10-05:00");
    const b = await subir(e, ADMIN, p.id, "2026-11-26T09:30:50-05:00");
    assert.equal(b.captura.foto?.nombreArchivo, "MAL-TR1-P05-APT501-C01_20261126-0930_360-2.jpg");
    assert.notEqual(a.captura.foto?.nombreArchivo, b.captura.foto?.nombreArchivo);
  });

  it("reintentar después de un fallo no crea un segundo archivo en Trimble", async () => {
    const e = entorno();
    await conCodigo(e);
    const p = await crearPunto(e.ctx(ADMIN), nuevoPunto);
    const s = await subir(e, ADMIN, p.id, "2026-11-26T09:30:00-05:00");
    let falla = true;
    const ctx = e.ctx(ADMIN);
    const enviarOriginal = ctx.deps.enviar!;
    ctx.deps.enviar = async (url, datos) => {
      const http = await enviarOriginal(url, datos);
      if (falla) throw new Error("se cortó la conexión");
      return http;
    };
    await assert.rejects(confirmarSubida(ctx, s.captura.foto!.id), /no pasó a Trimble Connect: se cortó la conexión/);
    assert.equal((await e.store.obtenerFoto(P, s.captura.foto!.id))?.estado, "error");
    falla = false;
    // Trimble did get the file before the error: the retry confirms it instead of uploading again.
    const lista = await confirmarSubida(ctx, s.captura.foto!.id);
    assert.equal(lista.foto?.estado, "en_cde");
    assert.equal(e.tc.archivos.size, 1);
  });

  it("una foto incompleta o que no es JPG se rechaza antes de ir al CDE", async () => {
    const e = entorno();
    await conCodigo(e);
    const p = await crearPunto(e.ctx(ADMIN), nuevoPunto);
    const s = await subir(e, ADMIN, p.id, "2026-11-26T09:30:00-05:00");
    e.archivos.contenido.set(`${P}/${s.captura.foto!.id}.jpg`, jpeg(100));
    await assert.rejects(confirmarSubida(e.ctx(ADMIN), s.captura.foto!.id), /incompleta/);
    e.archivos.contenido.set(`${P}/${s.captura.foto!.id}.jpg`, new Uint8Array(4096));
    await assert.rejects(confirmarSubida(e.ctx(ADMIN), s.captura.foto!.id), /no es una imagen JPG/);
    assert.equal(e.tc.archivos.size, 0);
  });

  it("no se suben fotos a un punto inactivo ni con fecha imposible", async () => {
    const e = entorno();
    await conCodigo(e);
    const p = await crearPunto(e.ctx(ADMIN), nuevoPunto);
    await assert.rejects(subir(e, ADMIN, p.id, "2030-01-01T00:00:00-05:00"), /fuera de rango/);
    await editarPunto(e.ctx(ADMIN), p.id, { version: p.version, estado: "inactivo", motivo: "obra" });
    await assert.rejects(subir(e, ADMIN, p.id, "2026-11-26T09:30:00-05:00"), /inactivo/);
  });

  it("anular pide motivo; la captura anulada queda en la lista", async () => {
    const e = entorno();
    await conCodigo(e);
    const p = await crearPunto(e.ctx(ADMIN), nuevoPunto);
    const s = await subir(e, ADMIN, p.id, "2026-11-26T09:30:00-05:00");
    await confirmarSubida(e.ctx(ADMIN), s.captura.foto!.id);
    await assert.rejects(anularCaptura(e.ctx(ADMIN), s.captura.id, {}), /motivo/);
    await assert.rejects(anularCaptura(e.ctx(MARTA), s.captura.id, { motivo: "x" }), /editores/);
    const a = await anularCaptura(e.ctx(ADMIN), s.captura.id, { motivo: "Foto del punto equivocado" });
    assert.equal(a.estado, "anulada");
    assert.equal((await listarCapturas(e.ctx(ADMIN), p.id))[0].estado, "anulada");
  });
});

describe("alineación de las fotos (giro guardado para todos)", () => {
  async function fotoLista(e: ReturnType<typeof entorno>) {
    await conCodigo(e, ["luis2"]);
    const p = await crearPunto(e.ctx(ADMIN), nuevoPunto);
    const bytes = jpeg();
    const s = await iniciarSubida(e.ctx(LUIS), { puntoId: p.id, tomadaEn: "2026-11-26T09:30:00-05:00", nombreOriginal: "IMG_001.jpg", tamano: bytes.length, ancho: 2048, alto: 1024, miniatura: MINI });
    e.archivos.contenido.set(`${P}/${s.captura.foto!.id}.jpg`, bytes);
    await confirmarSubida(e.ctx(LUIS), s.captura.foto!.id);
    return { p, id: s.captura.id };
  }

  it("una foto nueva sale sin giro; un editor lo guarda y cualquier persona lo ve con quién y cuándo", async () => {
    const e = entorno();
    const { p, id } = await fotoLista(e);
    assert.equal((await listarCapturas(e.ctx(MARTA), p.id))[0].giroGrados, 0);
    const a = await alinearCaptura(e.ctx(LUIS), id, { giro: 30.46, anterior: 0 });
    assert.equal(a.giroGrados, 30.5);
    assert.equal(a.foto?.estado, "en_cde");
    const [vista] = await listarCapturas(e.ctx(MARTA), p.id);
    assert.equal(vista.giroGrados, 30.5);
    assert.equal(vista.giroPor, "Luis Inspector");
    assert.ok(vista.giroEn);
  });

  it("el giro queda entre −180° y 180°; un valor que no es número se rechaza", async () => {
    const e = entorno();
    const { id } = await fotoLista(e);
    assert.equal((await alinearCaptura(e.ctx(ADMIN), id, { giro: 200, anterior: 0 })).giroGrados, -160);
    await assert.rejects(alinearCaptura(e.ctx(ADMIN), id, { giro: "30", anterior: -160 }), /grados/);
    await assert.rejects(alinearCaptura(e.ctx(ADMIN), id, { giro: 1000, anterior: -160 }), /grados/);
  });

  it("quien solo mira no puede guardar el giro", async () => {
    const e = entorno();
    const { id } = await fotoLista(e);
    await assert.rejects(alinearCaptura(e.ctx(MARTA), id, { giro: 10, anterior: 0 }), /editores/);
  });

  it("no pisa en silencio el giro que otra persona guardó mientras tanto", async () => {
    const e = entorno();
    const { p, id } = await fotoLista(e);
    await alinearCaptura(e.ctx(ADMIN), id, { giro: 25, anterior: 0 });
    // Luis was still looking at 0°.
    await assert.rejects(alinearCaptura(e.ctx(LUIS), id, { giro: 40, anterior: 0 }), (err: Error & { status?: number; code?: string }) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, "giro-conflicto");
      assert.match(err.message, /25°/);
      assert.match(err.message, /Ana Admin/);
      return true;
    });
    assert.equal((await listarCapturas(e.ctx(MARTA), p.id))[0].giroGrados, 25);
    // Same value as the saved one: nothing to do, no conflict.
    assert.equal((await alinearCaptura(e.ctx(LUIS), id, { giro: 25, anterior: 0 })).giroGrados, 25);
    assert.equal((await alinearCaptura(e.ctx(LUIS), id, { giro: 40, anterior: 25 })).giroGrados, 40);
  });

  it("una captura anulada no se alinea", async () => {
    const e = entorno();
    const { id } = await fotoLista(e);
    await anularCaptura(e.ctx(ADMIN), id, { motivo: "Foto del punto equivocado" });
    await assert.rejects(alinearCaptura(e.ctx(ADMIN), id, { giro: 10, anterior: 0 }), /anulada/);
  });
});
