import { createHash } from "node:crypto";
import { getCurrentUser, listProjectGroups, listProjectUsers, resolveProjectBaseUrl } from "../trimbleApi";
import type { Caller } from "./service";
import type { ProjectContacts } from "./types";

const CALLER_TTL_MS = 2 * 60 * 1000;
const cache = new Map<string, { caller: Caller; baseUrl: string; expiresAt: number }>();
const groupCache = new Map<string, { member: boolean; expiresAt: number }>();

function prune<T extends { expiresAt: number }>(map: Map<string, T>, now: number) {
  if (map.size > 500) for (const [k, v] of map) if (v.expiresAt <= now) map.delete(k);
}

/**
 * Resolves who is calling from their Trimble Connect token: confirms they are a
 * member of the project (resolveProjectBaseUrl fails otherwise), and reads
 * their name (GET /users/me) and project role (GET /projects/{id}/users), so
 * values record who changed them and only administrators edit the catalog.
 * Group membership (for attributes assigned to a group) is checked only when
 * needed, group by group. Cached for a couple of minutes per token and project.
 */
export async function resolveCaller(accessToken: string, projectId: string): Promise<Caller> {
  return (await context(accessToken, projectId)).caller;
}

async function context(accessToken: string, projectId: string) {
  const tokenHash = createHash("sha256").update(accessToken).digest("hex").slice(0, 32);
  const key = `${tokenHash}:${projectId}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit;

  const baseUrl = await resolveProjectBaseUrl(accessToken, projectId);
  const [me, users] = await Promise.all([
    getCurrentUser(baseUrl, accessToken),
    listProjectUsers(baseUrl, accessToken, projectId),
  ]);
  const member = users.find((u) => u.id === me.id);
  const name = [me.firstName, me.lastName].filter(Boolean).join(" ").trim();

  async function memberOfGroups(groupIds: string[]): Promise<Set<string>> {
    const mine = new Set<string>();
    await Promise.all(
      groupIds.map(async (groupId) => {
        const gKey = `${tokenHash}:${projectId}:${groupId}`;
        const cached = groupCache.get(gKey);
        let isMember = cached && cached.expiresAt > Date.now() ? cached.member : null;
        if (isMember === null) {
          // A group that no longer exists (or can't be read) simply grants nothing.
          const people = await listProjectUsers(baseUrl, accessToken, projectId, { groupId }).catch(() => []);
          isMember = people.some((u) => u.id === me.id);
          prune(groupCache, Date.now());
          groupCache.set(gKey, { member: isMember, expiresAt: Date.now() + CALLER_TTL_MS });
        }
        if (isMember) mine.add(groupId);
      })
    );
    return mine;
  }

  const entry = {
    caller: {
      id: me.id,
      name: name && me.email ? `${name} (${me.email})` : name || me.email || me.id,
      isAdmin: member?.role === "ADMIN",
      memberOfGroups,
    } satisfies Caller,
    baseUrl,
    expiresAt: now + CALLER_TTL_MS,
  };
  prune(cache, now);
  cache.set(key, entry);
  return entry;
}

/** The project's team (people and groups), as in Trimble Connect's team list. */
export async function projectContacts(accessToken: string, projectId: string): Promise<ProjectContacts> {
  const { baseUrl } = await context(accessToken, projectId);
  const [users, groups] = await Promise.all([
    listProjectUsers(baseUrl, accessToken, projectId),
    listProjectGroups(baseUrl, accessToken, projectId),
  ]);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  return {
    users: users
      .filter((u) => u.status !== "REMOVED")
      .map((u) => ({
        id: u.id,
        name: [u.firstName, u.lastName].filter(Boolean).join(" ").trim() || u.email || u.id,
        email: u.email ?? "",
        pending: u.status === "PENDING",
      }))
      .sort(byName),
    groups: groups
      .map((g) => ({ id: g.id, name: g.name, usersCount: typeof g.usersCount === "number" ? g.usersCount : null }))
      .sort(byName),
  };
}
