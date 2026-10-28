import { test } from "node:test";
import assert from "node:assert/strict";
import { DepsCopia, leerEstadoVisor, pasoCopia } from "./copiar";
import { nubeFalsa } from "./pruebas/trimbleFalso";

/** Origin "OBRA1" with a model and a drawing; destination "OBRA2" with a reception folder. */
function escenario(opciones: { rechazarFlujo?: boolean; sinCopiaTrimble?: boolean; rechazarModelo?: boolean; soloLectura?: boolean } = {}) {
  const nube = nubeFalsa(opciones);
  const origen = nube.proyecto("OBRA1");
  const destino = nube.proyecto("OBRA2");
  const modelos = nube.sembrarCarpeta(origen.raiz, "Modelos 3D");
  const modelo = nube.sembrarArchivo(modelos, "SEL-DIS-TR1-M3D-ARI.rvt", "contenido del modelo de arquitectura", "modelo convertido TRB");
  const plano = nube.sembrarArchivo(modelos, "EST-001 Cimentación.pdf", "contenido del plano");
  const carpetaId = nube.sembrarCarpeta(destino.raiz, "Recibidos de diseño", opciones.soloLectura ? "READ" : "FULL_ACCESS");
  const deps: DepsCopia = {
    origen: { projectId: "OBRA1", ...origen },
    destino: async (id) => {
      if (id !== "OBRA2") throw new Error("El proyecto no fue encontrado, o el usuario actual no tiene acceso a el.");
      return { projectId: "OBRA2", ...destino };
    },
    fetch: nube.fetchFalso,
  };
  const paso = (p: string, datos: Record<string, unknown> = {}) => pasoCopia(deps, { paso: p, destino: "OBRA2", carpetaId, ...datos });
  const enDestino = () => [...nube.archivos.values()].filter((a) => a.parent === carpetaId);
  /** Copies through the server and follows the upload until Trimble confirms it. */
  async function copiarYConfirmar(fileId: string, extra: Record<string, unknown> = {}) {
    const c = await paso("copiar", { fileId, ...extra });
    if (!c.ok || c.datos.metodo !== "servidor") return { copia: c, estado: null };
    return { copia: c, estado: await paso("estado-subida", { uploadId: c.datos.uploadId }) };
  }
  return { nube, paso, modelo, plano, carpetaId, enDestino, copiarYConfirmar };
}

test("un archivo que no está en el destino se copia dentro de Trimble, con su modelo convertido y sin carpeta nueva", async () => {
  const { nube, paso, modelo, carpetaId, enDestino } = escenario();
  const r = await paso("revisar", { fileId: modelo });
  assert.equal(r.ok, true);
  assert.equal(r.datos.situacion, "nuevo");
  const c = await paso("copiar", { fileId: modelo });
  assert.equal(c.ok, true, c.mensaje);
  assert.equal(c.datos.metodo, "trimble");
  assert.equal(c.datos.revision, 1);
  assert.equal(nube.llamadas.some((l) => l.includes("s3.falso")), false, "no pasa por el servidor");
  const copiados = enDestino();
  assert.equal(copiados.length, 1);
  assert.equal(copiados[0].versiones.length, 1, "solo la última versión");
  assert.equal(nube.carpetas.size, 4, "no crea carpetas");
  assert.equal([...nube.carpetas.values()].filter((x) => x.parent === carpetaId).length, 0);
  const v = await paso("estado-visor", { fileId: c.datos.fileId });
  assert.equal(v.datos.listo, true);
  assert.match(v.mensaje, /listo para ver/);
});

test("si Trimble no copia entre proyectos, el servidor pasa el archivo junto con su modelo convertido", async () => {
  const { modelo, enDestino, copiarYConfirmar, paso } = escenario({ sinCopiaTrimble: true });
  const { copia, estado } = await copiarYConfirmar(modelo);
  assert.equal(copia.ok, true, copia.mensaje);
  assert.equal(copia.datos.metodo, "servidor");
  assert.equal(copia.datos.modelo, "copiado");
  assert.match(copia.mensaje, /Con el modelo ya convertido/);
  assert.match(copia.mensaje, /La copia dentro de Trimble no se pudo/);
  assert.equal(estado?.datos.status, "DONE");
  const [a] = enDestino();
  assert.equal(new TextDecoder().decode(a.versiones[0].modelo!), "modelo convertido TRB");
  const v = await paso("estado-visor", { fileId: a.id });
  assert.equal(v.datos.listo, true);
});

test("si Trimble no acepta el modelo convertido, copia solo el archivo y lo dice", async () => {
  const { modelo, enDestino, copiarYConfirmar } = escenario({ sinCopiaTrimble: true, rechazarModelo: true });
  const { copia, estado } = await copiarYConfirmar(modelo);
  assert.equal(copia.ok, true, copia.mensaje);
  assert.equal(copia.datos.modelo, "rechazado");
  assert.match(copia.mensaje, /lo convertirá en el destino/);
  assert.equal(estado?.datos.status, "DONE");
  assert.equal(enDestino()[0].versiones[0].modelo, null);
});

test("un archivo sin modelo convertido en el origen se copia solo", async () => {
  const { plano, copiarYConfirmar } = escenario({ sinCopiaTrimble: true });
  const { copia, estado } = await copiarYConfirmar(plano);
  assert.equal(copia.datos.modelo, "sin-modelo");
  assert.equal(estado?.datos.revision, 1);
});

test("con un reintento sin modelo no se pide el modelo convertido", async () => {
  const { nube, modelo, copiarYConfirmar } = escenario({ sinCopiaTrimble: true });
  const { copia } = await copiarYConfirmar(modelo, { sinModelo: "1" });
  assert.equal(copia.datos.modelo, "omitido");
  assert.equal(nube.llamadas.some((l) => l.includes("format=TRB")), false);
});

test("si no se puede pasar por partes, el servidor carga el archivo entero", async () => {
  const { plano, copiarYConfirmar } = escenario({ sinCopiaTrimble: true, rechazarFlujo: true });
  const { copia, estado } = await copiarYConfirmar(plano);
  assert.equal(copia.datos.envio, "memoria");
  assert.equal(estado?.datos.status, "DONE");
});

test("un archivo igual en el destino queda al día y no se vuelve a copiar", async () => {
  const { paso, plano, enDestino } = escenario();
  await paso("copiar", { fileId: plano });
  const r = await paso("revisar", { fileId: plano });
  assert.equal(r.datos.situacion, "al-dia");
  assert.match(r.mensaje, /Ya está al día/);
  assert.equal(enDestino()[0].versiones.length, 1);
});

test("un archivo distinto en el destino no se reemplaza sin confirmación; confirmado, queda como versión nueva", async () => {
  const { nube, paso, plano, carpetaId, enDestino } = escenario();
  nube.sembrarArchivo(carpetaId, "EST-001 Cimentación.pdf", "otro contenido subido en la obra");
  const r = await paso("revisar", { fileId: plano });
  assert.equal(r.datos.situacion, "distinto");
  assert.match(r.mensaje, /Ana Ruiz/);
  assert.match(r.mensaje, /No se reemplaza sin tu confirmación/);
  const sinConfirmar = await paso("copiar", { fileId: plano });
  assert.equal(sinConfirmar.ok, false);
  assert.equal(enDestino()[0].versiones.length, 1, "no tocó el destino");
  const destino = r.datos.destino as { versionId: string };
  const confirmada = await paso("copiar", { fileId: plano, siVersion: destino.versionId });
  assert.equal(confirmada.ok, true, confirmada.mensaje);
  assert.equal(confirmada.datos.revision, 2);
});

test("si el archivo cambió en el destino después de revisarlo, no se pisa", async () => {
  const { nube, paso, plano, carpetaId, enDestino, copiarYConfirmar } = escenario({ sinCopiaTrimble: true });
  nube.sembrarArchivo(carpetaId, "EST-001 Cimentación.pdf", "versión de la obra");
  const r = await paso("revisar", { fileId: plano });
  const visto = (r.datos.destino as { versionId: string }).versionId;
  nube.sembrarArchivo(carpetaId, "EST-001 Cimentación.pdf", "otra versión subida mientras tanto");
  const { copia } = await copiarYConfirmar(plano, { siVersion: visto });
  assert.equal(copia.ok, false);
  assert.equal(copia.datos.cambio, true);
  assert.equal(enDestino()[0].versiones.length, 2, "quedan solo las dos versiones de la obra");
});

test("con solo lectura en la carpeta del destino lo dice al revisar", async () => {
  const { paso, plano } = escenario({ soloLectura: true });
  const r = await paso("revisar", { fileId: plano });
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /Solo tienes lectura/);
});

test("no deja copiar al mismo proyecto ni a uno que no se puede abrir", async () => {
  const { paso, plano } = escenario();
  assert.match((await paso("revisar", { fileId: plano, destino: "OBRA1" })).mensaje, /Elige otro proyecto/);
  assert.match((await paso("revisar", { fileId: plano, destino: "OBRA9" })).mensaje, /No se pudo abrir el proyecto destino/);
});

test("un paso desconocido o un id mal escrito se rechazan", async () => {
  const { paso, plano } = escenario();
  await assert.rejects(() => paso("borrar-todo"), /Paso no válido/);
  await assert.rejects(() => paso("revisar", { fileId: "../otra/ruta" }), /Falta fileId/);
  await assert.rejects(() => paso("copiar", { fileId: plano, siVersion: "a b" }), /Falta siVersion/);
});

test("el estado del visor se lee en las formas en que Trimble puede darlo", () => {
  assert.deepEqual(leerEstadoVisor({ status: "PROCESSED" }), { texto: "PROCESSED", listo: true });
  assert.deepEqual(leerEstadoVisor({ status: "PROCESSING" }), { texto: "PROCESSING", listo: null });
  assert.deepEqual(leerEstadoVisor([{ format: "TRB", status: "FAILED" }]), { texto: "TRB: FAILED", listo: false });
  assert.equal(leerEstadoVisor(null).texto, "sin dato");
  assert.equal(leerEstadoVisor({ otra: 1 }).texto, '{"otra":1}');
});
