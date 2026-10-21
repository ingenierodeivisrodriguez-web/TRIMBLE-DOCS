import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { supabaseCompras } from "./compras";
import { supabaseLectura } from "./presupuesto";

interface Llamada {
  url: string;
  method: string;
}

describe("lecturas de Presupuesto y Compras (solo GET)", () => {
  const original = { fetch: globalThis.fetch, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  let llamadas: Llamada[] = [];
  let responder: (url: string) => Response;

  beforeEach(() => {
    process.env.SUPABASE_URL = "https://ejemplo.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_prueba";
    llamadas = [];
    responder = () => new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      llamadas.push({ url: decodeURIComponent(String(url)), method: init.method ?? "GET" });
      return responder(String(url));
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = original.fetch;
    process.env.SUPABASE_URL = original.url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = original.key;
  });

  it("Presupuesto: elementos de una partida, columnas de la memoria y programación se leen con GET y filtran por proyecto", async () => {
    const l = supabaseLectura()!;
    assert.deepEqual(await l.elementosDePartida("obra1", "p1"), []);
    assert.equal(await l.columnasMemoria("obra1"), null);
    assert.equal(await l.programacion("obra1"), null);
    assert.equal(llamadas.length, 3);
    for (const c of llamadas) {
      assert.equal(c.method, "GET");
      assert.match(c.url, /\/rest\/v1\/presupuesto_(elementos|config|programacion)\?project_id=eq\.obra1&/);
    }
    assert.match(llamadas[0].url, /item_id=eq\.p1/);
  });

  it("Compras: los contratos aprobados con sus líneas, su partida y su proveedor, solo con GET", async () => {
    responder = (url) => {
      const fila = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("/compras_ordenes?")) return fila([{ id: "ct1", numero: 1, revision: 0, proveedor_id: "pv1", anticipo_pct: "20", retencion_garantia_pct: 5, aprobada: "2026-10-01T10:00:00Z" }]);
      if (url.includes("/compras_orden_lineas?"))
        return fila([{ orden_id: "ct1", requisicion_linea_id: "rl1", insumo_id: "sc03", codigo: "SC-03", descripcion: "Mano de obra muro", unidad: "M2", tipo: "SC", cantidad: "500", precio_unitario: "28000", descuento_pct: 0, iva_pct: 0 }]);
      if (url.includes("/compras_requisicion_lineas?")) return fila([{ id: "rl1", partida_item_id: "p11" }]);
      if (url.includes("/compras_proveedores?")) return fila([{ id: "pv1", nit: "79123456", dv: 3, razon_social: "Pedro Pérez" }]);
      return fila([]);
    };
    const [c] = await supabaseCompras()!.contratos("obra1");
    assert.deepEqual(
      { numero: c.numero, proveedor: c.proveedor, nit: c.nit, anticipo: c.anticipoPct, retencion: c.retencionGarantiaPct },
      { numero: 1, proveedor: "Pedro Pérez", nit: "79123456-3", anticipo: 20, retencion: 5 }
    );
    assert.deepEqual(c.lineas.map((x) => [x.insumoId, x.cantidad, x.precioUnitario, x.partidaItemId]), [["sc03", 500, 28000, "p11"]]);
    assert.ok(llamadas.every((x) => x.method === "GET"));
    assert.ok(llamadas.every((x) => /\/rest\/v1\/compras_[a-z_]+\?project_id=eq\.obra1&/.test(x.url)), "todo filtra por proyecto");
    assert.match(llamadas[0].url, /tipo=eq\.contrato&estado=eq\.aprobada/);
  });

  it("sin las tablas de Compras no hay contratos (la obra puede ser por administración directa)", async () => {
    responder = () => new Response(JSON.stringify({ code: "42P01", message: 'relation "public.compras_ordenes" does not exist' }), { status: 404 });
    assert.deepEqual(await supabaseCompras()!.contratos("obra1"), []);
  });
});
