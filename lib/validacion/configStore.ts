import { Redis } from "@upstash/redis";
import { defaultConfig, parseConfig } from "./config";
import type { ValidationConfig } from "./types";

/**
 * Persists each project's validation config in Upstash Redis (the Redis
 * integration from the Vercel Marketplace, which replaced Vercel KV), one JSON
 * value per Trimble Connect project id, so it survives sessions and is shared
 * by every user of the project.
 *
 * Vercel injects KV_REST_API_URL / KV_REST_API_TOKEN when the integration is
 * connected to the project; UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
 * are accepted too. With neither set, `next dev` falls back to an in-memory
 * map so the extension can be developed without a database; a production
 * build never does this (it fails loudly instead of silently losing data).
 */

export class ConfigStoreError extends Error {
  status = 503;
}

const keyFor = (projectId: string) => `validacion:config:${projectId}`;

let client: Redis | null | undefined;

function getRedis(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

const devStore = new Map<string, string>();

function storage(): { redis: Redis | null } {
  const redis = getRedis();
  if (!redis && process.env.NODE_ENV === "production") {
    throw new ConfigStoreError(
      "La base de datos de configuración no está conectada. Agrega la integración Upstash Redis al proyecto en Vercel (variables KV_REST_API_URL y KV_REST_API_TOKEN) y vuelve a desplegar."
    );
  }
  return { redis };
}

export async function loadConfig(
  projectId: string
): Promise<{ config: ValidationConfig; exists: boolean }> {
  const { redis } = storage();
  const key = keyFor(projectId);

  let raw: unknown;
  try {
    raw = redis ? await redis.get(key) : (devStore.get(key) ?? null);
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
  const { redis } = storage();
  const key = keyFor(projectId);
  const saved: ValidationConfig = { ...config, version: 1, updatedAt: new Date().toISOString() };

  try {
    if (redis) await redis.set(key, saved);
    else devStore.set(key, JSON.stringify(saved));
  } catch (err) {
    throw new ConfigStoreError(
      `No se pudo guardar la configuración en la base de datos: ${err instanceof Error ? err.message : "error desconocido"}`
    );
  }
  return saved;
}
