import { test } from "node:test";
import assert from "node:assert/strict";
import { copiarContenido, duracion, maximoEstimado, TIEMPO_COPIA_MS, velocidad } from "./copia";

const MB = 1024 * 1024;

/** A fetch that serves `contenido` at "origen" and records the PUTs to "destino". */
function red(contenido: Uint8Array, o: { conLargo?: boolean; estadoOrigen?: number; estadoDestino?: number; fallaFlujo?: boolean } = {}) {
  const puts: { headers: Headers; bytes: number; flujo: boolean }[] = [];
  let bajadas = 0;
  const fetchFn = (async (u: string | URL | Request, init?: RequestInit) => {
    if (String(u) === "https://origen") {
      bajadas++;
      if (o.estadoOrigen) return new Response(null, { status: o.estadoOrigen });
      return new Response(contenido.slice(), { status: 200, headers: o.conLargo === false ? {} : { "content-length": String(contenido.byteLength) } });
    }
    const flujo = init?.body instanceof ReadableStream;
    if (flujo && o.fallaFlujo) throw new TypeError("fetch failed");
    const bytes = (await new Response(init?.body).arrayBuffer()).byteLength;
    puts.push({ headers: new Headers(init?.headers), bytes, flujo });
    return new Response(null, { status: o.estadoDestino ?? 200 });
  }) as typeof fetch;
  return { fetchFn, puts, bajadas: () => bajadas };
}

test("pasa el archivo por partes con su tamaño cuando el origen lo informa", async () => {
  const r = red(new Uint8Array(3000).fill(5));
  const c = await copiarContenido("https://origen", "https://destino", r.fetchFn);
  assert.equal(c.ok, true);
  assert.equal(c.metodo, "flujo");
  assert.equal(c.bytes, 3000);
  assert.equal(r.puts.length, 1);
  assert.equal(r.puts[0].flujo, true);
  assert.equal(r.puts[0].bytes, 3000);
  assert.equal(r.puts[0].headers.get("content-length"), "3000");
  assert.equal(r.puts[0].headers.get("content-type"), null);
});

test("si no se puede pasar por partes, lo baja otra vez y lo envía entero", async () => {
  const r = red(new Uint8Array(2000).fill(1), { fallaFlujo: true });
  const c = await copiarContenido("https://origen", "https://destino", r.fetchFn);
  assert.equal(c.ok, true);
  assert.equal(c.metodo, "memoria");
  assert.equal(r.bajadas(), 2);
  assert.equal(r.puts.length, 1);
  assert.equal(r.puts[0].flujo, false);
  assert.equal(r.puts[0].bytes, 2000);
  assert.match(c.mensaje, /No se pudo pasar por partes/);
});

test("sin tamaño informado lo carga entero y lo envía de una vez", async () => {
  const r = red(new Uint8Array(1500).fill(2), { conLargo: false });
  const c = await copiarContenido("https://origen", "https://destino", r.fetchFn);
  assert.equal(c.ok, true);
  assert.equal(c.metodo, "memoria");
  assert.equal(r.bajadas(), 1);
  assert.equal(r.puts[0].bytes, 1500);
});

test("si el origen no entrega el archivo, no intenta subir nada", async () => {
  const r = red(new Uint8Array(10), { estadoOrigen: 403 });
  const c = await copiarContenido("https://origen", "https://destino", r.fetchFn);
  assert.equal(c.ok, false);
  assert.equal(c.http, 403);
  assert.equal(r.puts.length, 0);
  assert.match(c.mensaje, /no entregó el archivo del origen/);
});

test("si el destino rechaza el archivo, lo dice con la respuesta de Trimble", async () => {
  const r = red(new Uint8Array(10), { estadoDestino: 403 });
  const c = await copiarContenido("https://origen", "https://destino", r.fetchFn);
  assert.equal(c.ok, false);
  assert.equal(c.http, 403);
  assert.equal(c.metodo, "flujo");
  assert.match(c.mensaje, /respuesta 403/);
});

test("mide el tiempo con el reloj que recibe", async () => {
  const marcas = [1000, 5200];
  const c = await copiarContenido("https://origen", "https://destino", red(new Uint8Array(10)).fetchFn, () => marcas.shift() ?? 5200);
  assert.equal(c.ms, 4200);
});

test("velocidad, máximo estimado y duración se escriben para leerlos en obra", () => {
  assert.equal(velocidad(10 * MB, 1000), "10.0 MB/s");
  assert.equal(velocidad(1 * MB, 1000), null, "muy pequeño para medir");
  assert.equal(maximoEstimado(10 * MB, 1000), Math.floor(10 * MB * (TIEMPO_COPIA_MS / 1000)));
  assert.equal(maximoEstimado(1000, 1000), null);
  assert.equal(duracion(4200), "4.2 s");
  assert.equal(duracion(65_000), "1 min 05 s");
});
