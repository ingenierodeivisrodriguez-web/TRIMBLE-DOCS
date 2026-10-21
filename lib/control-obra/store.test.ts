import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { esAdminTecnico } from "./routes";
import { Alcance, ObraStore, supabaseStore } from "./store";

const E = "11111111-1111-4111-8111-111111111111";
const P = "proyA_001";
const A: Alcance = { empresaId: E, projectId: P };
const actor = { id: "ana", nombre: "Ana" };

interface Llamada {
  url: string;
  body: Record<string, unknown> | null;
}

describe("aislamiento en cada consulta a Supabase", () => {
  let llamadas: Llamada[] = [];
  const original = globalThis.fetch;
  const env = { ...process.env };
  let store: ObraStore;

  beforeEach(() => {
    process.env.SUPABASE_URL = "https://ejemplo.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-de-prueba";
    llamadas = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = decodeURIComponent(String(input));
      llamadas.push({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
      const cuerpo = url.includes("/rpc/") ? (url.includes("verificar") ? [{ filas: 0, rota_en: null }] : 1) : [];
      return new Response(JSON.stringify(cuerpo), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    store = supabaseStore()!;
  });

  afterEach(() => {
    globalThis.fetch = original;
    process.env = { ...env };
  });

  const ultima = () => llamadas[llamadas.length - 1];

  it("toda lectura de un proyecto filtra por empresa y proyecto", async () => {
    const lecturas: [string, () => Promise<unknown>][] = [
      ["listAsignaciones", () => store.listAsignaciones(A)],
      ["getConfig", () => store.getConfig(A)],
      ["listNivelesProyecto", () => store.listNivelesProyecto(A)],
      ["listNodos", () => store.listNodos(A)],
      ["listFlujos", () => store.listFlujos(A)],
    ];
    for (const [nombre, leer] of lecturas) {
      await leer();
      assert.match(ultima().url, new RegExp(`empresa_id=eq\\.${E}`), nombre);
      assert.match(ultima().url, new RegExp(`project_id=eq\\.${P}`), nombre);
    }
  });

  it("toda lectura de la empresa filtra por su id", async () => {
    const lecturas: [string, () => Promise<unknown>][] = [
      ["listLicencias", () => store.listLicencias(E)],
      ["listRoles", () => store.listRoles(E)],
      ["listUsuarios", () => store.listUsuarios(E)],
      ["listProyectos", () => store.listProyectos(E)],
      ["asignacionesDe", () => store.asignacionesDe(E, "ana")],
      ["listPlantilla", () => store.listPlantilla(E)],
      ["getEmpresa", () => store.getEmpresa(E)],
    ];
    for (const [nombre, leer] of lecturas) {
      await leer();
      assert.ok(ultima().url.includes(`empresa_id=eq.${E}`) || ultima().url.includes(`id=eq.${E}`), `${nombre}: ${ultima().url}`);
    }
  });

  it("la bitácora se lee por la cadena de la empresa (y el proyecto cuando se pide)", async () => {
    await store.listBitacora(E, P, {});
    assert.match(ultima().url, new RegExp(`cadena=eq\\.${E}`));
    assert.match(ultima().url, new RegExp(`empresa_id=eq\\.${E}`));
    assert.match(ultima().url, new RegExp(`project_id=eq\\.${P}`));
    await store.listBitacora(null, null, {});
    assert.match(ultima().url, /cadena=eq\.global/);
  });

  it("todo cambio de un proyecto lleva la empresa y el proyecto a la función de la base de datos", async () => {
    const cambios: [string, () => Promise<unknown>][] = [
      ["guardarAsignacion", () => store.guardarAsignacion(A, actor, { nombre: "Luis", email: "luis@obra.co" }, { userId: "luis", rolId: E, adminProyecto: false, desde: "2026-01-01", hasta: null, activo: true, version: 0 })],
      ["guardarConfig", () => store.guardarConfig(A, actor, { responsableTecnicoId: null, responsableTecnicoNombre: "", toleranciaVerificacionPct: 0, permiteAceptadoConObservaciones: false }, 0)],
      ["guardarNodo", () => store.guardarNodo(A, actor, { id: E, nivelClave: "torre", valor: "T1", padreId: null, responsableId: null, responsableNombre: "", inicio: null, fin: null, estado: "activo", nota: "", version: 0 })],
      ["desvincularProyecto", () => store.desvincularProyecto(A, actor, "fin")],
      ["guardarFlujo", () => store.guardarFlujo(A, actor, { tipo: "acta_cliente", pasos: [{ nombre: "Elabora", rolId: E }, { nombre: "Aprueba", rolId: E }], version: 0 })],
    ];
    for (const [nombre, cambiar] of cambios) {
      await cambiar();
      assert.equal(ultima().body?.p_empresa_id, E, nombre);
      assert.equal(ultima().body?.p_project_id, P, nombre);
      assert.equal(ultima().body?.p_actor_id, "ana", `${nombre}: quién lo hace lo decide el servidor`);
    }
    for (const [nombre, cambiar] of [
      ["guardarRol", () => store.guardarRol(E, actor, { id: E, nombre: "X", descripcion: "", permisos: [], activo: true, version: 0 })],
      ["guardarUsuario", () => store.guardarUsuario(E, actor, E, false, 1)],
      ["guardarNivel", () => store.guardarNivel(E, null, actor, { id: E, projectId: null, clave: "bloque", nombre: "Bloque", orden: 1, padreClave: null, fuente: "manual", claveFuente: "", activo: true, version: 0 })],
    ] as const) {
      await cambiar();
      assert.equal(ultima().body?.p_empresa_id, E, nombre);
    }
  });

  it("al agregar a la bitácora, la posición y los hashes los pone la base de datos", async () => {
    await store.registrar({ empresaId: E, projectId: P, actorId: "ana", actorNombre: "Ana", accion: "ingreso", modulo: "accesos", objetoTipo: "", objetoId: "", cambios: {}, motivo: "", resultado: "denegado", origen: "menu" });
    assert.equal(ultima().body?.hash, "");
    assert.equal(ultima().body?.n, undefined);
  });
});

describe("administradores técnicos", () => {
  it("se leen de CONTROL_OBRA_ADMINS separados por coma o espacio", () => {
    assert.equal(esAdminTecnico("abc-1", "abc-1, def-2"), true);
    assert.equal(esAdminTecnico("def-2", "abc-1 def-2"), true);
    assert.equal(esAdminTecnico("abc", "abc-1,def-2"), false);
    assert.equal(esAdminTecnico("abc-1", ""), false);
  });
});
