import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TrimbleApiError } from "../trimbleApi";
import { completarConexion, ConexionDeps, leerRetorno } from "./conexion";
import { descifrar, OauthConfig } from "./oauth";
import type { Tc } from "./service";
import { memoryStore } from "./store";

const OAUTH: OauthConfig = { clientId: "c", secret: "s3cret", scope: "openid apibasedatos" };
const CFG = { projectId: "KU8qY2Zf234", folderId: "T3InEwS6b9g" };

function tc(conAcceso: boolean): Tc {
  return {
    baseUrl: async () => "https://tc",
    project: async () => ({ name: "MANAGER PROJECT", rootId: "R" }),
    folder: async (_b, id) => {
      if (!conAcceso) throw new TrimbleApiError("forbidden", 403);
      return { id, name: "MANUALES_CARPETA", parentId: "R", projectId: CFG.projectId, permission: "READ", path: [] };
    },
    file: async () => {
      throw new Error("no");
    },
    items: async () => [],
    downloadUrl: async () => "",
  };
}

function deps(conAcceso = true): ConexionDeps & { revocados: string[]; canjes: string[][] } {
  const revocados: string[] = [];
  const canjes: string[][] = [];
  return {
    revocados,
    canjes,
    canjear: async (_cfg, code, redirectUri, verifier) => {
      canjes.push([code, redirectUri, verifier]);
      return { accessToken: "acc", refreshToken: "ref", expiresAt: Date.now() + 3600_000 };
    },
    revocar: async (_cfg, refresh) => {
      revocados.push(refresh);
    },
    tc: () => tc(conAcceso),
    usuario: async () => ({ id: "u-tec", email: "manuales@empresa.com", firstName: "Cuenta", lastName: "Manuales" }),
    olvidar: () => undefined,
  };
}

async function iniciar(store = memoryStore()) {
  await store.crearEstado({ state: "st1", verifier: "ver1", redirectUri: "http://localhost", creadoPor: "Deivis", expira: new Date(Date.now() + 600_000).toISOString() });
  return store;
}

describe("conexión de la cuenta técnica con la dirección pegada", () => {
  it("lee el código y el estado de la dirección de localhost, aunque venga sin http", () => {
    assert.deepEqual(leerRetorno(" http://localhost/?code=abc123&state=st1 "), { code: "abc123", state: "st1", error: null });
    assert.deepEqual(leerRetorno("localhost/?state=st1&code=abc"), { code: "abc", state: "st1", error: null });
    assert.deepEqual(leerRetorno("http://localhost/?error=access_denied&error_description=Cancelado&state=st1").error, "Cancelado");
  });

  it("canjea el código con la misma dirección y el verificador del inicio, y guarda la cuenta cifrada", async () => {
    const store = await iniciar();
    const d = deps();
    const r = await completarConexion(store, OAUTH, CFG, leerRetorno("http://localhost/?code=abc&state=st1"), d);
    assert.equal(r.ok, true);
    assert.match(r.texto, /MANUALES_CARPETA.*manuales@empresa\.com/);
    assert.deepEqual(d.canjes, [["abc", "http://localhost", "ver1"]]);
    const c = (await store.getCuenta())!;
    assert.equal(c.cuentaEmail, "manuales@empresa.com");
    assert.equal(c.conectadaPor, "Deivis");
    assert.equal(descifrar(c.refreshCifrado, OAUTH.secret), "ref");
  });

  it("un enlace ya usado o vencido no conecta nada", async () => {
    const store = await iniciar();
    await completarConexion(store, OAUTH, CFG, leerRetorno("http://localhost/?code=abc&state=st1"), deps());
    const otra = await completarConexion(store, OAUTH, CFG, leerRetorno("http://localhost/?code=abc&state=st1"), deps());
    assert.equal(otra.ok, false);
    assert.equal(otra.titulo, "El enlace venció");
    const incompleto = await completarConexion(store, OAUTH, CFG, leerRetorno("http://localhost/"), deps());
    assert.equal(incompleto.titulo, "Enlace incompleto");
  });

  it("si la cuenta no puede abrir la carpeta, no se guarda y su sesión se revoca", async () => {
    const store = await iniciar();
    const d = deps(false);
    const r = await completarConexion(store, OAUTH, CFG, leerRetorno("http://localhost/?code=abc&state=st1"), d);
    assert.equal(r.ok, false);
    assert.match(r.titulo, /no tiene acceso/);
    assert.deepEqual(d.revocados, ["ref"]);
    assert.equal(await store.getCuenta(), null);
  });

  it("si Trimble devolvió un error (inicio cancelado), lo muestra", async () => {
    const r = await completarConexion(await iniciar(), OAUTH, CFG, leerRetorno("http://localhost/?error=access_denied&state=st1"), deps());
    assert.deepEqual([r.ok, r.texto], [false, "access_denied"]);
  });
});
