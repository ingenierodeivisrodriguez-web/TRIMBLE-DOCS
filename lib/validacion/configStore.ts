import { Redis } from "@upstash/redis";
import { defaultConfig, parseConfig } from "./config";
import type { ValidationConfig } from "./types";

/**
 * Persists each project's validation config, one JSON value per Trimble Connect
 * project id, so it survives sessions and is shared by every user of the project.
 *
 * Backends, in order of preference:
 *  1. Supabase (Postgres, through its REST API). Vercel's Supabase integration
 *     injects SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and
 *     SUPABASE_SERVICE_ROLE_KEY. The key is used server-side only and is never
 *     exposed to the browser. Needs the `validacion_config` table (see
 *     SUPABASE_TABLE_SQL / supabase/validacion_config.sql).
 *  2. Upstash Redis (KV_REST_API_URL / KV_REST_API_TOKEN, or
 *     UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).
 *  3. `next dev` only: an in-memory map, so the extension can be developed
 *     without a database. A production build never does this (it fails loudly
 *     instead of silently losing data).
 */

export class ConfigStoreError extends Error {
  status = 503;
}

export const SUPABASE_TABLE_SQL =
  "create table if not exists public.validacion_config (" +
  "project_id text primary key, config jsonb not null, updated_at timestamptz not null default now()); " +
  "alter table public.validacion_config enable row level security;";

const TABLE = "validacion_config";
const REQUEST_TIMEOUT_MS = 10_000;

interface Backend {
  get(projectId: string): Promise<unknown>;
  set(projectId: string, config: ValidationConfig): Promise<void>;
}

// ---- Supabase (PostgREST) ------------------------------------------------

function supabaseBackend(): Backend | null {
  const rawUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!rawUrl || !key) return null;

  const base = `${rawUrl.replace(/\/+$/, "")}/rest/v1/${TABLE}`;
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
  };
  // Legacy service_role keys are JWTs and go in Authorization too; the newer
  // "sb_secret_…" keys are not JWTs and must only be sent as `apikey`.
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;

  async function call(url: string, init: RequestInit): Promise<Response> {
    const res = await fetch(url, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.ok) return res;

    const body = await res.text().catch(() => "");
    if (/PGRST205|42P01|Could not find the table|does not exist/i.test(body)) {
      throw new Error(
        `Falta la tabla "${TABLE}" en Supabase. Créala en Supabase (Open in Supabase → SQL Editor) ejecutando este SQL una sola vez y vuelve a intentar:${SUPABASE_TABLE_SQL}`
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("Supabase rechazó la clave del servidor (SUPABASE_SERVICE_ROLE_KEY). Revisa la integración en Vercel.");
    }
    throw new Error(`Supabase respondió ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }

  return {
    async get(projectId) {
      const res = await call(`${base}?project_id=eq.${encodeURIComponent(projectId)}&select=config`, {
        method: "GET",
      });
      const rows = (await res.json()) as { config: unknown }[];
      return rows.length > 0 ? rows[0].config : null;
    },
    async set(projectId, config) {
      await call(`${base}?on_conflict=project_id`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ project_id: projectId, config, updated_at: config.updatedAt }),
      });
    },
  };
}

// ---- Upstash Redis -------------------------------------------------------

const redisKey = (projectId: string) => `validacion:config:${projectId}`;

function redisBackend(): Backend | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const redis = new Redis({ url, token });
  return {
    get: (projectId) => redis.get(redisKey(projectId)),
    async set(projectId, config) {
      await redis.set(redisKey(projectId), config);
    },
  };
}

// ---- Development fallback ------------------------------------------------

const devStore = new Map<string, string>();
const devBackend: Backend = {
  async get(projectId) {
    return devStore.get(projectId) ?? null;
  },
  async set(projectId, config) {
    devStore.set(projectId, JSON.stringify(config));
  },
};

// ---- Selection -----------------------------------------------------------

let backend: Backend | null | undefined;

function storage(): Backend {
  if (backend === undefined) backend = supabaseBackend() ?? redisBackend();
  if (backend) return backend;
  if (process.env.NODE_ENV === "production") {
    throw new ConfigStoreError(
      "La base de datos de configuración no está conectada. Conecta la integración de Supabase (o Upstash Redis) al proyecto en Vercel y vuelve a desplegar."
    );
  }
  return devBackend;
}

export async function loadConfig(
  projectId: string
): Promise<{ config: ValidationConfig; exists: boolean }> {
  const store = storage();

  let raw: unknown;
  try {
    raw = await store.get(projectId);
  } catch (err) {
    throw new ConfigStoreError(
      `No se pudo leer la configuración de la base de datos: ${err instanceof Error ? err.message : "error desconocido"}`
    );
  }

  if (raw === null || raw === undefined) return { config: defaultConfig(), exists: false };
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  return { config: parseConfig(value).config, exists: true };
}

export async function saveConfig(
  projectId: string,
  config: ValidationConfig
): Promise<ValidationConfig> {
  const store = storage();
  const saved: ValidationConfig = { ...config, version: 1, updatedAt: new Date().toISOString() };

  try {
    await store.set(projectId, saved);
  } catch (err) {
    throw new ConfigStoreError(
      `No se pudo guardar la configuración en la base de datos: ${err instanceof Error ? err.message : "error desconocido"}`
    );
  }
  return saved;
}
