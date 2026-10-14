// The assistant's model behind one interface, and Claude (Anthropic) as one
// of its providers (proveedor.ts chooses; gemini.ts is the other). The key
// lives in Vercel (ANTHROPIC_API_KEY), never in the repository.
import Anthropic from "@anthropic-ai/sdk";
import { ServiceError } from "../../propiedades/service";
import type { TokensIA } from "./cupo";

export const MODELO_POR_DEFECTO = "claude-opus-5-5";

export interface PeticionIA {
  /** Fixed instructions (cached between calls). */
  sistema: string;
  /** The data of this call. */
  usuario: string;
  /** JSON Schema the answer must follow. */
  esquema: Record<string, unknown>;
  maxTokens: number;
  esfuerzo: "low" | "medium" | "high";
}

export interface RespuestaIA {
  /** The JSON text of the answer (null when the model refused). */
  texto: string | null;
  stopReason: string | null;
  /** The model that answered (another one if the first declined and the fallback ran). */
  modelo: string;
  /** Tokens per model that ran, to price them. */
  tokens: TokensIA[];
  /** Why it refused, when it did. */
  rechazo: string | null;
}

export interface ClienteIA {
  /** Who answers: "Anthropic" or "Google". */
  proveedor: string;
  modelo: string;
  generar(p: PeticionIA): Promise<RespuestaIA>;
}

export function clienteClaude(apiKey: string, modelo: string = MODELO_POR_DEFECTO): ClienteIA {
  // Each call is a small batch and must end within the server function (60 s): no retries
  // here; the browser retries a failed batch once.
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 55_000 });

  return {
    proveedor: "Anthropic",
    modelo,
    async generar(p) {
      let r: Anthropic.Beta.BetaMessage;
      try {
        r = await client.beta.messages.create({
          model: modelo,
          max_tokens: p.maxTokens,
          // If a safety classifier declines, Anthropic re-runs the request on its recommended model.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: [{ type: "text", text: p.sistema, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: p.usuario }],
          output_config: { effort: p.esfuerzo, format: { type: "json_schema", schema: p.esquema } },
        });
      } catch (err) {
        throw errorDeIA(err);
      }
      const texto = r.stop_reason === "refusal" ? null : (r.content.find((b) => b.type === "text") as Anthropic.Beta.BetaTextBlock | undefined)?.text ?? null;
      const iteraciones = (r.usage.iterations ?? []).filter((i) => i.type === "message" || i.type === "fallback_message") as {
        model?: string | null;
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens: number;
        cache_read_input_tokens: number;
      }[];
      const tokens: TokensIA[] = iteraciones.length
        ? iteraciones.map((i) => ({
            modelo: i.model ?? modelo,
            entrada: i.input_tokens,
            salida: i.output_tokens,
            cacheEscritura: i.cache_creation_input_tokens ?? 0,
            cacheLectura: i.cache_read_input_tokens ?? 0,
          }))
        : [
            {
              modelo: r.model,
              entrada: r.usage.input_tokens,
              salida: r.usage.output_tokens,
              cacheEscritura: r.usage.cache_creation_input_tokens ?? 0,
              cacheLectura: r.usage.cache_read_input_tokens ?? 0,
            },
          ];
      return {
        texto,
        stopReason: r.stop_reason,
        modelo: r.model,
        tokens,
        rechazo: r.stop_reason === "refusal" ? r.stop_details?.category ?? "sin categoría" : null,
      };
    },
  };
}

/** Errors of the API as messages a person can act on (nothing was charged for these). */
export function errorDeIA(err: unknown): ServiceError {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new ServiceError("La clave ANTHROPIC_API_KEY de Vercel no es válida o no tiene permiso: el administrador de la plataforma debe revisarla.", 503, "ia-clave");
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ServiceError("El servicio de IA está recibiendo demasiadas solicitudes. Espera un minuto y continúa.", 429, "ia-limite");
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new ServiceError(`El servicio de IA no aceptó la solicitud: ${err.message}`, 502, "ia-solicitud");
  }
  if (err instanceof Anthropic.InternalServerError) {
    return new ServiceError("El servicio de IA está ocupado o falló. Intenta de nuevo en unos minutos.", 503, "ia-servicio");
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new ServiceError("El servicio de IA tardó demasiado en responder. Intenta con menos partidas por lote.", 504, "ia-tiempo");
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new ServiceError("No se pudo conectar con el servicio de IA. Revisa la conexión e intenta de nuevo.", 502, "ia-conexion");
  }
  if (err instanceof Anthropic.APIError) {
    return new ServiceError(`El servicio de IA respondió con un error (${err.status ?? "sin código"}).`, 502, "ia-error");
  }
  return new ServiceError(err instanceof Error ? err.message : "Error desconocido del servicio de IA.", 500, "ia-error");
}
