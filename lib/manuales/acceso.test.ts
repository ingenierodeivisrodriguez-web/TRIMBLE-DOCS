import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { agregar, CuentaDeps, leerEmails, mantenerSesion, olvidarToken, puedeLeer, quitar, tokenTecnico } from "./acceso";
import { authorizeUrl, cifrar, descifrar, nuevoPkce, OauthConfig, TokenError, Tokens } from "./oauth";
import { ManualesError } from "./service";
import { memoryStore, ManualesStore } from "./store";

const OAUTH: OauthConfig = { clientId: "client", secret: "s3cret", scope: "openid apibasedatos" };
const HORA = 3600_000;

function deps(over: Partial<CuentaDeps> & { renovaciones?: string[] } = {}): CuentaDeps & { renovaciones: string[] } {
  const renovaciones = over.renovaciones ?? [];
  let n = 0;
  return {
    oauth: OAUTH,
    ahora: () => Date.now(),
    esperar: async () => undefined,
    async renovar(_cfg, refresh): Promise<Tokens> {
      renovaciones.push(refresh);
      n++;
      return { accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresAt: Date.now() + HORA };
    },
    ...over,
    renovaciones,
  };
}

async function conectar(store: ManualesStore, accessExpira: number, refresh = "refresh-0") {
  await store.guardarCuenta({
    refreshCifrado: cifrar(refresh, OAUTH.secret),
    accessCifrado: cifrar("access-0", OAUTH.secret),
    accessExpira: new Date(accessExpira).toISOString(),
    cuentaId: "u",
    cuentaNombre: "Manuales",
    cuentaEmail: "manuales@empresa.com",
    conectadaPor: "Ana",
  });
}

async function falla(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (err: unknown) => err instanceof ManualesError && err.code === code);
}

describe("sesión de la cuenta técnica", () => {
  beforeEach(() => olvidarToken());

  it("sin cuenta o sin Client Secret no hay manuales", async () => {
    await falla(tokenTecnico(memoryStore(), deps()), "sin-cuenta");
    await falla(tokenTecnico(memoryStore(), deps({ oauth: null })), "sin-oauth");
  });

  it("usa el token vigente sin renovar", async () => {
    const store = memoryStore();
    await conectar(store, Date.now() + HORA);
    const d = deps();
    assert.equal(await tokenTecnico(store, d), "access-0");
    assert.deepEqual(d.renovaciones, []);
  });

  it("renueva cuando está por vencer y guarda el nuevo refresh token (son de un solo uso)", async () => {
    const store = memoryStore();
    await conectar(store, Date.now() + 60_000);
    const d = deps();
    assert.equal(await tokenTecnico(store, d), "access-1");
    assert.deepEqual(d.renovaciones, ["refresh-0"]);
    const c = (await store.getCuenta())!;
    assert.equal(descifrar(c.refreshCifrado, OAUTH.secret), "refresh-1");
    olvidarToken();
    assert.equal(await tokenTecnico(store, d), "access-1"); // stored, not renewed again
    assert.equal(d.renovaciones.length, 1);
  });

  it("si otro servidor está renovando, espera su resultado en vez de gastar el mismo refresh token", async () => {
    const store = memoryStore();
    await conectar(store, Date.now() + 60_000);
    assert.equal(await store.tomarTurno(30), true); // another instance renewing
    const d = deps({
      esperar: async () => {
        // ...which finishes meanwhile.
        await store.guardarTokens({ refreshCifrado: cifrar("refresh-9", OAUTH.secret), accessCifrado: cifrar("access-9", OAUTH.secret), accessExpira: new Date(Date.now() + HORA).toISOString() });
      },
    });
    assert.equal(await tokenTecnico(store, d), "access-9");
    assert.deepEqual(d.renovaciones, []);
  });

  it("una sesión vencida pide reconectar y suelta el turno", async () => {
    const store = memoryStore();
    await conectar(store, Date.now() - 1);
    const d = deps({
      renovar: async () => {
        throw new TokenError("invalid_grant", true);
      },
    });
    await falla(tokenTecnico(store, d), "cuenta-vencida");
    assert.equal(await store.tomarTurno(1), true);
  });

  it("si cambia el Client Secret, los tokens guardados no se pueden leer: hay que reconectar", async () => {
    const store = memoryStore();
    await conectar(store, Date.now() + HORA);
    await falla(tokenTecnico(store, deps({ oauth: { ...OAUTH, secret: "otro" } })), "cuenta-vencida");
  });

  it("la tarea diaria renueva solo si la última renovación es antigua", async () => {
    const store = memoryStore();
    assert.equal(await mantenerSesion(store, deps()), "sin-cuenta");
    await conectar(store, Date.now() + HORA);
    const d = deps();
    assert.equal(await mantenerSesion(store, d), "al-dia");
    const manana = deps({ ahora: () => Date.now() + 21 * HORA });
    assert.equal(await mantenerSesion(store, manana), "renovada");
    assert.deepEqual(manana.renovaciones, ["refresh-0"]);
  });
});

describe("personas autorizadas", () => {
  it("lee correos separados por comas, punto y coma o líneas, con nombre opcional", () => {
    const r = leerEmails("Ana@Empresa.com, Luis Gómez <luis@empresa.com>;\n no-es-correo \n ana@empresa.com");
    assert.deepEqual(r.emails, [
      { email: "ana@empresa.com", nombre: "" },
      { email: "luis@empresa.com", nombre: "Luis Gómez" },
    ]);
    assert.deepEqual(r.invalidos, ["no-es-correo"]);
  });

  it("solo lee quien está autorizado o administra el proyecto de manuales", async () => {
    const store = memoryStore();
    await agregar(store, "luis@empresa.com", "Ana");
    assert.deepEqual(await puedeLeer(store, "LUIS@empresa.com", async () => false), { autorizado: true, esAdmin: false });
    assert.deepEqual(await puedeLeer(store, "marta@empresa.com", async () => false), { autorizado: false, esAdmin: false });
    assert.deepEqual(await puedeLeer(store, "admin@empresa.com", async () => true), { autorizado: false, esAdmin: true });
    await quitar(store, "luis@empresa.com");
    assert.equal((await puedeLeer(store, "luis@empresa.com", async () => false)).autorizado, false);
    await falla(quitar(store, "luis@empresa.com"), "no-existe");
    await falla(agregar(store, "   ", "Ana"), "parametro");
  });
});

describe("conexión con Trimble Identity", () => {
  it("arma el inicio de sesión con PKCE y el alcance de la app", () => {
    const { verifier, challenge, state } = nuevoPkce();
    assert.ok(verifier.length >= 43 && challenge.length === 43 && state.length > 20);
    const url = new URL(authorizeUrl(OAUTH, "https://app/cb", state, challenge));
    assert.equal(url.origin + url.pathname, "https://id.trimble.com/oauth/authorize");
    assert.equal(url.searchParams.get("scope"), "openid apibasedatos");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("redirect_uri"), "https://app/cb");
  });

  it("cifra los tokens guardados", () => {
    const c = cifrar("token-secreto", "clave");
    assert.ok(!c.includes("token-secreto"));
    assert.equal(descifrar(c, "clave"), "token-secreto");
    assert.throws(() => descifrar(c, "otra"));
  });
});
