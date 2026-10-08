import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { actualizar, agregar, CuentaDeps, infoAutorizado, leerEmails, mantenerSesion, mensajeSinAcceso, olvidarToken, puedeLeer, quitar, tokenTecnico } from "./acceso";
import { estadoLicencia, hoyIso, sumarMeses } from "./licencia";
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

  const HOY = "2026-10-07";

  it("solo lee quien está autorizado con licencia vigente, o administra el proyecto de manuales", async () => {
    const store = memoryStore();
    await agregar(store, { texto: "luis@empresa.com" }, "Ana", HOY); // 12 months by default
    const luis = await puedeLeer(store, "LUIS@empresa.com", async () => false, HOY);
    assert.equal(luis.autorizado, true);
    assert.deepEqual(luis.licencia, { estado: "activa", vence: "2027-10-07", diasRestantes: 365 });
    const marta = await puedeLeer(store, "marta@empresa.com", async () => false, HOY);
    assert.deepEqual([marta.autorizado, marta.motivo], [false, "sin-autorizacion"]);
    const admin = await puedeLeer(store, "admin@empresa.com", async () => true, HOY);
    assert.deepEqual([admin.autorizado, admin.esAdmin, admin.motivo], [false, true, null]);
    await quitar(store, "luis@empresa.com");
    assert.equal((await puedeLeer(store, "luis@empresa.com", async () => false, HOY)).autorizado, false);
    await falla(quitar(store, "luis@empresa.com"), "no-existe");
    await falla(agregar(store, { texto: "   " }, "Ana", HOY), "parametro");
  });

  it("la licencia vence al terminar su último día, y luego dice desde cuándo", async () => {
    const store = memoryStore();
    await agregar(store, { texto: "luis@empresa.com", licencia: { meses: 1, inicio: "2026-09-07" } }, "Ana", HOY);
    assert.equal((await puedeLeer(store, "luis@empresa.com", async () => false, "2026-10-07")).autorizado, true); // last day
    const despues = await puedeLeer(store, "luis@empresa.com", async () => false, "2026-10-08");
    assert.deepEqual([despues.autorizado, despues.motivo], [false, "vencida"]);
    assert.match(mensajeSinAcceso(despues), /venció el 07-10-2026/);
    // Renewed for 3 months from today.
    await actualizar(store, { email: "luis@empresa.com", licencia: { meses: 3 } }, "2026-10-08");
    const renovada = await puedeLeer(store, "luis@empresa.com", async () => false, "2026-10-08");
    assert.deepEqual([renovada.autorizado, renovada.licencia?.vence], [true, "2027-01-08"]);
  });

  it("suspender corta el acceso aunque la licencia esté vigente; reactivar lo devuelve", async () => {
    const store = memoryStore();
    await agregar(store, { texto: "luis@empresa.com", licencia: { sinVencimiento: true } }, "Ana", HOY);
    assert.equal((await puedeLeer(store, "luis@empresa.com", async () => false, HOY)).licencia?.estado, "sin-vencimiento");
    await actualizar(store, { email: "luis@empresa.com", suspendido: true }, HOY);
    const s1 = await puedeLeer(store, "luis@empresa.com", async () => false, HOY);
    assert.deepEqual([s1.autorizado, s1.motivo], [false, "suspendida"]);
    assert.match(mensajeSinAcceso(s1), /suspendido/);
    await actualizar(store, { email: "luis@empresa.com", suspendido: false }, HOY);
    assert.equal((await puedeLeer(store, "luis@empresa.com", async () => false, HOY)).autorizado, true);
  });

  it("valida la licencia: 1 a 12 meses, o una fecha que no sea anterior al inicio", async () => {
    const store = memoryStore();
    await falla(agregar(store, { texto: "a@x.com", licencia: { meses: 13 } }, "Ana", HOY), "parametro");
    await falla(agregar(store, { texto: "a@x.com", licencia: { meses: 0 } }, "Ana", HOY), "parametro");
    await falla(agregar(store, { texto: "a@x.com", licencia: { vence: "2026-02-30" } }, "Ana", HOY), "parametro");
    await falla(agregar(store, { texto: "a@x.com", licencia: { vence: "2026-10-01", inicio: "2026-10-05" } }, "Ana", HOY), "parametro");
    await agregar(store, { texto: "a@x.com", licencia: { vence: "2026-12-31" } }, "Ana", HOY);
    const a = (await store.getAutorizado("a@x.com"))!;
    assert.deepEqual([a.licenciaMeses, a.inicio, a.vence], [null, HOY, "2026-12-31"]);
    assert.equal(infoAutorizado(a, HOY).diasRestantes, 85);
    await falla(actualizar(store, { email: "nadie@x.com", suspendido: true }, HOY), "no-existe");
  });
});

describe("fechas de las licencias", () => {
  it("suma meses ajustando al último día del mes", () => {
    assert.equal(sumarMeses("2026-01-31", 1), "2026-02-28");
    assert.equal(sumarMeses("2028-01-31", 1), "2028-02-29");
    assert.equal(sumarMeses("2026-10-07", 12), "2027-10-07");
    assert.equal(sumarMeses("2026-11-15", 3), "2027-02-15");
  });

  it("marca por vencer en los últimos 15 días y usa el día de Colombia", () => {
    assert.equal(estadoLicencia({ vence: "2026-10-20", suspendido: false }, "2026-10-07").estado, "por-vencer");
    assert.equal(estadoLicencia({ vence: "2026-10-30", suspendido: false }, "2026-10-07").estado, "activa");
    // 03:00 UTC on Oct 8 is still Oct 7 in Bogotá (UTC-5).
    assert.equal(hoyIso(new Date("2026-10-08T03:00:00Z")), "2026-10-07");
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
