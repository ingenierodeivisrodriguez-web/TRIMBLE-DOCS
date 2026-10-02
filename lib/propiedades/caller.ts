import { createHash } from "node:crypto";
import { getCurrentUser, listProjectUsers, resolveProjectBaseUrl } from "../trimbleApi";
import type { Caller } from "./service";

const CALLER_TTL_MS = 2 * 60 * 1000;
const cache = new Map<string, { caller: Caller; expiresAt: number }>();

/**
 * Resolves who is calling from their Trimble Connect token: confirms they are a
 * member of the project (resolveProjectBaseUrl fails otherwise), and reads
 * their name (GET /users/me) and project role (GET /projects/{id}/users), so
 * values record who changed them and only administrators edit the catalog.
 * Cached for a couple of minutes per token and project.
 */
export async function resolveCaller(accessToken: string, projectId: string): Promise<Caller> {
  const key = `${createHash("sha256").update(accessToken).digest("hex").slice(0, 32)}:${projectId}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.caller;

  const baseUrl = await resolveProjectBaseUrl(accessToken, projectId);
  const [me, users] = await Promise.all([
    getCurrentUser(baseUrl, accessToken),
    listProjectUsers(baseUrl, accessToken, projectId),
  ]);
  const member = users.find((u) => u.id === me.id);
  const name = [me.firstName, me.lastName].filter(Boolean).join(" ").trim();
  const caller: Caller = {
    id: me.id,
    name: name && me.email ? `${name} (${me.email})` : name || me.email || me.id,
    isAdmin: member?.role === "ADMIN",
  };

  if (cache.size > 500) for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k);
  cache.set(key, { caller, expiresAt: now + CALLER_TTL_MS });
  return caller;
}
