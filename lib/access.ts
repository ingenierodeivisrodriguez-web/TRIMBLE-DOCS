import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { resolveProjectBaseUrl } from "./trimbleApi";

export function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer (.+)$/i);
  return match ? match[1] : null;
}

/** Trimble Connect project ids look like "_VFf6OdilsY". */
export function isValidProjectId(projectId: string): boolean {
  return /^[A-Za-z0-9_-]{4,64}$/.test(projectId);
}

const ACCESS_TTL_MS = 60 * 1000;
const verified = new Map<string, number>();

/**
 * Confirms that the caller's Trimble access token belongs to a member of the
 * project (via GET /projects/me), so nobody can read or overwrite a project's
 * validation config or results just by knowing its id. Successful checks are
 * remembered for a minute to avoid repeating the call on every page/poll.
 * Throws a TrimbleApiError (401/404) otherwise.
 */
export async function assertProjectAccess(accessToken: string, projectId: string): Promise<void> {
  const tokenHash = createHash("sha256").update(accessToken).digest("hex").slice(0, 32);
  const key = `${tokenHash}:${projectId}`;
  const now = Date.now();

  const expiresAt = verified.get(key);
  if (expiresAt && expiresAt > now) return;

  await resolveProjectBaseUrl(accessToken, projectId);

  if (verified.size > 500) {
    for (const [k, exp] of verified) if (exp <= now) verified.delete(k);
  }
  verified.set(key, now + ACCESS_TTL_MS);
}
