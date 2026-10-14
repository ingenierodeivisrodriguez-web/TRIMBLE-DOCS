// Google's Gemini (AI Studio) as the assistant's model, behind the same
// interface as Claude. The key lives in Vercel (GEMINI_API_KEY), never in the
// repository.
import { ApiError, FinishReason, GoogleGenAI, ThinkingLevel } from "@google/genai";
import { ServiceError } from "../../propiedades/service";
import type { ClienteIA, RespuestaIA } from "./claude";

/** Has a free tier in AI Studio; good for a pilot. */
export const MODELO_GEMINI_POR_DEFECTO = "gemini-3.8-flash";

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

export function clienteGemini(apiKey: string, modelo: string = MODELO_GEMINI_POR_DEFECTO): ClienteIA {
  // Each call is a small batch and must end within the server function (60 s): no retries
  // here (the SDK would retry up to 5 times); the browser retries a failed batch once.
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 55_000, retryOptions: { attempts: 1 } } });
  return {
    proveedor: "Google",
    modelo,
    async generar(p) {
      let r;
      try {
        r = await ai.models.generateContent({
          model: modelo,
          contents: p.usuario,
          config: {
            systemInstruction: p.sistema,
            responseMimeType: "application/json",
            responseJsonSchema: p.esquema,
            maxOutputTokens: p.maxTokens,
            thinkingConfig: { thinkingLevel: NIVEL[p.esfuerzo] },
          },
        });
      } catch (err) {
        throw errorDeGemini(err);
      }
      return leerRespuestaGemini(r, modelo);
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

/** Errors of the API as messages a person can act on. */
export function errorDeGemini(err: unknown): ServiceError {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      return new ServiceError("La clave GEMINI_API_KEY de Vercel no es válida o no tiene permiso: el administrador de la plataforma debe revisarla.", 503, "ia-clave");
    }
    if (err.status === 429) {
      return new ServiceError("Se alcanzó el límite de solicitudes de Google AI Studio (el nivel gratuito tiene límites por minuto y por día). Espera y continúa.", 429, "ia-limite");
    }
    if (err.status === 400 || err.status === 404) {
      return new ServiceError(`Google no aceptó la solicitud: ${err.message}`, 502, "ia-solicitud");
    }
    if (err.status >= 500) return new ServiceError("El servicio de IA de Google está ocupado o falló. Intenta de nuevo en unos minutos.", 503, "ia-servicio");
    return new ServiceError(`El servicio de IA de Google respondió con un error (${err.status}).`, 502, "ia-error");
  }
  if (err instanceof Error && /abort|timeout/i.test(`${err.name} ${err.message}`)) {
    return new ServiceError("El servicio de IA tardó demasiado en responder. Intenta con menos partidas por lote.", 504, "ia-tiempo");
  }
  return new ServiceError(err instanceof Error ? err.message : "Error desconocido del servicio de IA.", 502, "ia-error");
}
