// Google's Gemini (AI Studio) as the assistant's model, behind the same
// interface as Claude. The key lives in Vercel (GEMINI_API_KEY), never in the
// repository.
import { ApiError, FinishReason, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { ServiceError } from "../../propiedades/service";
import type { ClienteIA, RespuestaIA } from "./claude";

/** Has a free tier in AI Studio; good for a pilot. */
export const MODELO_GEMINI_POR_DEFECTO = "gemini-3.8-flash";
/** Tried when the main model keeps failing on Google's side (500/503). */
export const MODELO_GEMINI_RESPALDO = "gemini-3.5-flash-lite";

type PeticionGemini = Parameters<GoogleGenAI["models"]["generateContent"]>[0];
type RespuestaGemini = Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>;
/** The part of the SDK used (tests pass a fake). */
export interface ModelosGemini {
  generateContent(p: PeticionGemini): Promise<RespuestaGemini>;
}

const NIVEL: Record<"low" | "medium" | "high", ThinkingLevel> = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH };

/** Answers the model withholds for safety or policy reasons. */
const BLOQUEOS = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.LANGUAGE,
]);

/**
 * @param respaldo Model tried once if the main one fails on Google's side (null: none). That
 * request is simpler: JSON mode with the schema written in the instructions instead of
 * Google's schema option (the answer is validated the same way afterwards).
 */
export function clienteGemini(
  apiKey: string,
  modelo: string = MODELO_GEMINI_POR_DEFECTO,
  respaldo: string | null = MODELO_GEMINI_RESPALDO,
  modelos?: ModelosGemini
): ClienteIA {
  // Each call is a small batch and must end within the server function (60 s). A busy or failing
  // server (500/503) answers fast, so it is retried twice after 1.5 and 3 s; limits (429) are not.
  const sdk =
    modelos ??
    new GoogleGenAI({
      apiKey,
      httpOptions: { timeout: 45_000, retryOptions: { attempts: 3, initialDelay: 1.5, maxDelay: 4, httpStatusCodes: [500, 502, 503, 504] } },
    }).models;
  const pedir = (m: string, p: Parameters<ClienteIA["generar"]>[0], conEsquema: boolean) =>
    sdk.generateContent({
      model: m,
      contents: p.usuario,
      config: {
        systemInstruction:
          (p.datosFijos ? `${p.sistema}\n\n${p.datosFijos}` : p.sistema) +
          (conEsquema ? "" : `\n\nResponde solo con un objeto JSON que cumpla este esquema (JSON Schema):\n${JSON.stringify(p.esquema)}`),
        responseMimeType: "application/json",
        ...(conEsquema ? { responseJsonSchema: p.esquema } : {}),
        maxOutputTokens: p.maxTokens,
        thinkingConfig: { thinkingLevel: NIVEL[p.esfuerzo] },
      },
    });
  return {
    proveedor: "Google",
    modelo,
    async generar(p) {
      try {
        return leerRespuestaGemini(await pedir(modelo, p, true), modelo);
      } catch (err) {
        const fallaDeGoogle = err instanceof ApiError && err.status >= 500;
        if (!fallaDeGoogle || !respaldo || respaldo === modelo) throw errorDeGemini(err);
        console.error(`[presupuesto-ia] ${modelo} falló en Google (${(err as ApiError).status}: ${mensajeGoogle((err as ApiError).message)}); se intenta con ${respaldo}.`);
        try {
          return leerRespuestaGemini(await pedir(respaldo, p, false), respaldo);
        } catch (err2) {
          throw errorDeGemini(err2);
        }
      }
    },
  };
}

/** What Gemini answered, in the shape the assistant uses (tokens to price it, refusals, truncation). */
export function leerRespuestaGemini(
  r: {
    text?: string | undefined;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
    promptFeedback?: { blockReason?: string };
    candidates?: { finishReason?: string }[];
  },
  modelo: string
): RespuestaIA {
  const u = r.usageMetadata ?? {};
  const cache = u.cachedContentTokenCount ?? 0;
  const tokens = [
    {
      modelo,
      entrada: Math.max((u.promptTokenCount ?? 0) - cache, 0),
      // Thinking is billed as output.
      salida: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
      cacheEscritura: 0,
      cacheLectura: cache,
    },
  ];
  const bloqueo = r.promptFeedback?.blockReason ?? null;
  const fin = r.candidates?.[0]?.finishReason ?? null;
  if (bloqueo || (fin && BLOQUEOS.has(fin))) {
    return { texto: null, stopReason: "refusal", modelo, tokens, rechazo: String(bloqueo ?? fin) };
  }
  return { texto: r.text ?? null, stopReason: fin === FinishReason.MAX_TOKENS ? "max_tokens" : "end_turn", modelo, tokens, rechazo: null };
}

/** Google's own words in an error: its JSON "message", or the text as it came. */
export function mensajeGoogle(raw: string): string {
  const inicio = raw.indexOf("{");
  if (inicio >= 0) {
    try {
      const o = JSON.parse(raw.slice(inicio)) as { error?: { message?: string; status?: string } };
      if (o.error?.message) return `${o.error.status ? `${o.error.status}: ` : ""}${o.error.message}`.slice(0, 300);
    } catch {
      // not JSON
    }
  }
  return raw.slice(0, 300);
}

/** Errors of the API as messages a person can act on, with what Google said (also in the server's log). */
export function errorDeGemini(err: unknown): ServiceError {
  if (err instanceof ApiError) {
    const dijo = mensajeGoogle(err.message);
    console.error(`[presupuesto-ia] Google respondió ${err.status}: ${dijo}`);
    if (err.status === 401 || err.status === 403) {
      return new ServiceError(`La clave GEMINI_API_KEY de Vercel no es válida o no tiene permiso (Google: ${dijo}).`, 503, "ia-clave");
    }
    if (err.status === 429) {
      return new ServiceError(`Se alcanzó el límite de solicitudes de Google AI Studio (el nivel gratuito tiene límites por minuto y por día). Espera y continúa. (Google: ${dijo})`, 429, "ia-limite");
    }
    if (err.status === 400 || err.status === 404) {
      return new ServiceError(`Google no aceptó la solicitud (${err.status}): ${dijo}`, 502, "ia-solicitud");
    }
    if (err.status >= 500) return new ServiceError(`El servicio de IA de Google falló después de reintentar (${err.status}: ${dijo}).`, 503, "ia-servicio");
    return new ServiceError(`El servicio de IA de Google respondió con un error (${err.status}: ${dijo}).`, 502, "ia-error");
  }
  console.error("[presupuesto-ia] Error al llamar a Google:", err);
  if (err instanceof Error && /abort|timeout/i.test(`${err.name} ${err.message}`)) {
    return new ServiceError("El servicio de IA tardó demasiado en responder. Intenta con menos partidas por lote.", 504, "ia-tiempo");
  }
  return new ServiceError(err instanceof Error ? err.message : "Error desconocido del servicio de IA.", 502, "ia-error");
}
