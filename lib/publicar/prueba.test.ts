import { test } from "node:test";
import assert from "node:assert/strict";
import { CARPETA_PRUEBA, DepsPrueba, pasoPrueba } from "./prueba";
import { nubeFalsa } from "./pruebas/trimbleFalso";

/** Origin "OBRA1" with a drawing; destination "OBRA2" with a reception folder. */
function escenario(opciones: { rechazarFlujo?: boolean; soloLectura?: boolean } = {}) {
  const nube = nubeFalsa({ rechazarFlujo: opciones.rechazarFlujo });
  const origen = nube.proyecto("OBRA1");
  const destino = nube.proyecto("OBRA2");
  const planos = nube.sembrarCarpeta(origen.raiz, "Planos");
  const fileId = nube.sembrarArchivo(planos, "EST-001 Cimentación.pdf", "contenido del plano de cimentación");
  const recepcion = nube.sembrarCarpeta(destino.raiz, "Recibidos de OBRA1", opciones.soloLectura ? "READ" : "FULL_ACCESS");
  const deps: DepsPrueba = {
    origen: { projectId: "OBRA1", ...origen },
    destino: async (id) => {
      if (id !== "OBRA2") throw new Error("El proyecto no fue encontrado, o el usuario actual no tiene acceso a el.");
      return { projectId: "OBRA2", ...destino };
    },
    fetch: nube.fetchFalso,
  };
  const paso = (p: string, datos: Record<string, unknown> = {}) => pasoPrueba(deps, { paso: p, ...datos });
  return { nube, deps, paso, fileId, recepcion };
}

test("la prueba completa copia el archivo, crea la versión nueva y compara lo que llegó", async () => {
  const { nube, paso, fileId, recepcion } = escenario();
  const leido = await paso("leer-origen", { fileId });
  assert.equal(leido.ok, true);
  assert.match(leido.mensaje, /EST-001 Cimentación\.pdf/);

  const preparado = await paso("preparar-destino", { destino: "OBRA2", carpetaId: recepcion });
  assert.equal(preparado.ok, true);
  assert.equal(preparado.datos.creada, true);
  assert.equal(preparado.datos.mismaRegion, false);
  const carpetaPruebaId = preparado.datos.carpetaPruebaId as string;
  assert.equal(nube.carpetas.get(carpetaPruebaId)?.name, CARPETA_PRUEBA);

  const primera = await paso("copiar", { fileId, destino: "OBRA2", carpetaPruebaId });
  assert.equal(primera.ok, true, primera.mensaje);
  assert.equal(primera.datos.metodo, "flujo");
  assert.equal(primera.datos.nuevaVersion, false);
  const e1 = await paso("estado-subida", { destino: "OBRA2", uploadId: primera.datos.uploadId });
  assert.equal(e1.datos.status, "DONE");
  assert.equal(e1.datos.revision, 1);

  const segunda = await paso("copiar", { fileId, destino: "OBRA2", carpetaPruebaId });
  assert.equal(segunda.datos.nuevaVersion, true);
  const e2 = await paso("estado-subida", { destino: "OBRA2", uploadId: segunda.datos.uploadId });
  assert.equal(e2.datos.revision, 2);
  assert.equal(e2.datos.fileId, e1.datos.fileId, "el mismo archivo, con otra versión");

  const proteccion = await paso("proteccion", { fileId, destino: "OBRA2", carpetaPruebaId, versionVieja: e1.datos.versionId });
  assert.equal(proteccion.ok, true);
  assert.equal(proteccion.datos.protege, true);

  const comprobado = await paso("comprobar", { fileId, destino: "OBRA2", destinoFileId: e2.datos.fileId });
  assert.equal(comprobado.ok, true, comprobado.mensaje);
  assert.equal(comprobado.datos.mismoTamano, true);
  assert.equal(comprobado.datos.mismaHuella, true);
  assert.deepEqual(comprobado.datos.versiones, [1, 2]);
  assert.equal(nube.archivos.get(fileId)?.versiones.length, 1, "el origen no cambia");
});

test("la copia desde el navegador entrega el enlace de bajada y el de subida", async () => {
  const { paso, fileId, recepcion } = escenario();
  const { datos } = await paso("preparar-destino", { destino: "OBRA2", carpetaId: recepcion });
  const r = await paso("abrir-copia-navegador", { fileId, destino: "OBRA2", carpetaPruebaId: datos.carpetaPruebaId });
  assert.equal(r.ok, true);
  assert.match(String(r.datos.bajar), /^https:\/\/s3\.falso\/bajar\//);
  assert.match(String(r.datos.subir), /^https:\/\/s3\.falso\/subir\//);
});

test("si no se puede pasar por partes, la copia carga el archivo entero y lo dice", async () => {
  const { paso, fileId, recepcion } = escenario({ rechazarFlujo: true });
  const { datos } = await paso("preparar-destino", { destino: "OBRA2", carpetaId: recepcion });
  const r = await paso("copiar", { fileId, destino: "OBRA2", carpetaPruebaId: datos.carpetaPruebaId });
  assert.equal(r.ok, true);
  assert.equal(r.datos.metodo, "memoria");
});

test("una segunda prueba encuentra la carpeta de prueba y sube el archivo como versión nueva", async () => {
  const { nube, paso, fileId, recepcion } = escenario();
  const a = await paso("preparar-destino", { destino: "OBRA2", carpetaId: recepcion });
  const c = await paso("copiar", { fileId, destino: "OBRA2", carpetaPruebaId: a.datos.carpetaPruebaId });
  await paso("estado-subida", { destino: "OBRA2", uploadId: c.datos.uploadId });
  const b = await paso("preparar-destino", { destino: "OBRA2", carpetaId: recepcion });
  assert.equal(b.datos.creada, false);
  assert.equal(b.datos.carpetaPruebaId, a.datos.carpetaPruebaId);
  assert.equal([...nube.carpetas.values()].filter((x) => x.name === CARPETA_PRUEBA).length, 1);
  const otra = await paso("copiar", { fileId, destino: "OBRA2", carpetaPruebaId: b.datos.carpetaPruebaId });
  assert.equal(otra.datos.nuevaVersion, true);
});

test("con solo lectura en la carpeta del destino lo dice y no crea nada", async () => {
  const { nube, paso, recepcion } = escenario({ soloLectura: true });
  const r = await paso("preparar-destino", { destino: "OBRA2", carpetaId: recepcion });
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /Solo tienes lectura/);
  assert.equal([...nube.carpetas.values()].some((x) => x.name === CARPETA_PRUEBA), false);
});

test("no deja usar este mismo proyecto como destino", async () => {
  const { paso, recepcion } = escenario();
  const r = await paso("preparar-destino", { destino: "OBRA1", carpetaId: recepcion });
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /Elige otro proyecto/);
});

test("si el proyecto destino no se puede abrir, explica por qué", async () => {
  const { paso, recepcion } = escenario();
  const r = await paso("preparar-destino", { destino: "OBRA9", carpetaId: recepcion });
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /No se pudo abrir el proyecto destino: El proyecto no fue encontrado/);
});

test("si el archivo del origen no existe, lo dice sin tocar el destino", async () => {
  const { nube, paso, recepcion } = escenario();
  const { datos } = await paso("preparar-destino", { destino: "OBRA2", carpetaId: recepcion });
  const antes = nube.llamadas.length;
  const r = await paso("copiar", { fileId: "noexiste", destino: "OBRA2", carpetaPruebaId: datos.carpetaPruebaId });
  assert.equal(r.ok, false);
  assert.match(r.mensaje, /No se pudo leer el archivo/);
  assert.equal(nube.llamadas.slice(antes).some((l) => l.includes("/files/fs/upload")), false);
});

test("un paso desconocido o un id mal escrito se rechazan", async () => {
  const { paso } = escenario();
  await assert.rejects(() => paso("borrar-todo"), /Paso no válido/);
  await assert.rejects(() => paso("leer-origen", { fileId: "../otra/ruta" }), /Falta fileId/);
  await assert.rejects(() => paso("preparar-destino", { carpetaId: "x" }), /Falta destino/);
});
