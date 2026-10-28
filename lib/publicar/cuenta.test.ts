import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { OauthConfig, Tokens } from "../manuales/oauth";
import { completarConexion, DepsCuenta, desconectar, estadoCuenta, iniciarConexion, leerAdministradores, mantenerSesion, olvidarToken, tokenTecnico } from "./cuenta";
import { memoryStore } from "./store";

const OAUTH: OauthConfig = { clientId: "cliente", secret: "secreto-de-prueba", scope: "openid app" };
const YO = { id: "u-deivis", name: "Deivis Rodriguez" };
const OTRO = { id: "u-otro", name: "Otra persona" };

function escenario(opciones: { administradores?: string[]; oauth?: OauthConfig | null } = {}) {
  const store = memoryStore();
  const llamadas: string[] = [];
  let reloj = Date.now();
  let n = 0;
  const tokens = (refresh: string): Tokens => ({ accessToken: `acceso-${++n}`, refreshToken: refresh, expiresAt: reloj + 3600_000 });
  const deps: DepsCuenta = {
    oauth: opciones.oauth === undefined ? OAUTH : opciones.oauth,
    canjear: async (_c, code) => {
      llamadas.push(`canjear ${code}`);
      return tokens("refresco-1");
    },
    renovar: async (_c, refresh) => {
      llamadas.push(`renovar ${refresh}`);
      return tokens(`refresco-${n + 2}`);
    },
    revocar: async (_c, refresh) => {
      llamadas.push(`revocar ${refresh}`);
    },
    usuario: async () => ({ id: "u-bot", email: "publicaciones@dyco.co", firstName: "Publicaciones", lastName: "DYCO" }),
    redirectUri: "http://localhost",
    administradores: opciones.administradores ?? [YO.id],
    esperar: async () => undefined,
    ahora: () => reloj,
  };
  const avanzar = (ms: number) => (reloj += ms);
  /** Connects the account as the flow does: sign-in address, then the address Trimble sent the browser to. */
  async function conectar() {
    const { url } = await iniciarConexion(store, deps, YO);
    const state = new URL(url).searchParams.get("state")!;
    return completarConexion(store, deps, YO, `http://localhost/?code=codigo-1&state=${state}`);
  }
  return { store, deps, llamadas, avanzar, conectar };
}

beforeEach(() => olvidarToken());

test("la lista de PUBLICAR_ADMINS se lee con comas, punto y coma o espacios", () => {
  assert.deepEqual(leerAdministradores(" a1, b2;c3  d4 "), ["a1", "b2", "c3", "d4"]);
  assert.deepEqual(leerAdministradores(undefined), []);
});

test("solo quien está en PUBLICAR_ADMINS conecta la cuenta, y la pantalla le muestra su id", async () => {
  const sinLista = escenario({ administradores: [] });
  const estado = await estadoCuenta(sinLista.store, sinLista.deps, OTRO);
  assert.equal(estado.administra, false);
  assert.equal(estado.miId, "u-otro");
  assert.match(estado.faltan.join(" "), /PUBLICAR_ADMINS/);
  await assert.rejects(() => iniciarConexion(sinLista.store, sinLista.deps, OTRO), /Tu id de Trimble es u-otro/);
  const sinSecreto = escenario({ oauth: null });
  assert.match((await estadoCuenta(sinSecreto.store, sinSecreto.deps, YO)).faltan.join(" "), /TRIMBLE_CLIENT_SECRET/);
  await assert.rejects(() => iniciarConexion(sinSecreto.store, sinSecreto.deps, YO), /TRIMBLE_CLIENT_SECRET/);
});

test("conectar guarda la cuenta con la sesión cifrada, y desconectar la revoca y la borra", async () => {
  const e = escenario();
  const r = await e.conectar();
  assert.equal(r.ok, true, r.texto);
  assert.match(r.texto, /publicaciones@dyco\.co/);
  const c = await e.store.getCuenta();
  assert.equal(c?.cuentaEmail, "publicaciones@dyco.co");
  assert.equal(c?.conectadaPor, "Deivis Rodriguez");
  assert.ok(c && !c.refreshCifrado.includes("refresco-1"), "nunca en claro");
  assert.equal(await tokenTecnico(e.store, e.deps), "acceso-1");
  const visto = await estadoCuenta(e.store, e.deps, OTRO);
  assert.equal(visto.conectada, true);
  assert.equal(visto.administra, false);
  await assert.rejects(() => desconectar(e.store, e.deps, OTRO), /PUBLICAR_ADMINS/);
  await desconectar(e.store, e.deps, YO);
  assert.ok(e.llamadas.includes("revocar refresco-1"));
  assert.equal(await e.store.getCuenta(), null);
  assert.equal(await tokenTecnico(e.store, e.deps), null);
});

test("un enlace ya usado, vencido o sin código no conecta", async () => {
  const e = escenario();
  const { url } = await iniciarConexion(e.store, e.deps, YO);
  const state = new URL(url).searchParams.get("state")!;
  assert.equal((await completarConexion(e.store, e.deps, YO, "http://localhost/?state=x")).titulo, "Dirección incompleta");
  assert.equal((await completarConexion(e.store, e.deps, YO, `http://localhost/?code=c&state=${state}`)).ok, true);
  assert.equal((await completarConexion(e.store, e.deps, YO, `http://localhost/?code=c&state=${state}`)).titulo, "El enlace venció");
  assert.equal((await completarConexion(e.store, e.deps, YO, "http://localhost/?error=access_denied")).ok, false);
});

test("la sesión se renueva sola al vencerse y el refresh token nuevo reemplaza al anterior", async () => {
  const e = escenario();
  await e.conectar();
  e.avanzar(58 * 60_000); // less than 5 minutes left
  olvidarToken();
  const nuevo = await tokenTecnico(e.store, e.deps);
  assert.equal(nuevo, "acceso-2");
  assert.ok(e.llamadas.includes("renovar refresco-1"));
  olvidarToken();
  e.avanzar(58 * 60_000);
  await tokenTecnico(e.store, e.deps);
  assert.equal(e.llamadas.filter((l) => l.startsWith("renovar")).length, 2);
  assert.notEqual(e.llamadas.at(-1), "renovar refresco-1", "cada renovación usa el último refresh token");
});

test("el mantenimiento diario renueva solo cuando la última renovación es vieja", async () => {
  const e = escenario();
  assert.equal(await mantenerSesion(e.store, e.deps), "sin-cuenta");
  await e.conectar();
  assert.equal(await mantenerSesion(e.store, e.deps), "al-dia");
});
