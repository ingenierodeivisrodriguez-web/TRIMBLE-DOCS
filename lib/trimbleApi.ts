import { TrimbleUserRef } from "./types";

/**
 * Master (US) region endpoint. Used only for the two identity-level calls
 * that are region-independent: /regions and /projects/me. See:
 * https://developer.trimble.com/docs/connect/tools/api/core (OpenAPI definition)
 */
const MASTER_BASE_URL = "https://app.connect.trimble.com/tc/api/2.0";

const FOLDER_PAGE_SIZE = 200;

export class TrimbleApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function authHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

async function trimbleFetch(url: string, accessToken: string, extraHeaders?: HeadersInit) {
  const res = await fetch(url, {
    headers: { ...authHeaders(accessToken), ...extraHeaders },
    cache: "no-store",
  });
  if (!res.ok && res.status !== 206) {
    const body = await res.text().catch(() => "");
    throw new TrimbleApiError(
      `Trimble Connect API error (${res.status}) calling ${url}: ${body.slice(0, 300)}`,
      res.status
    );
  }
  return res.json();
}

interface RegionInfo {
  location: string;
  "tc-api": string;
}

let regionsCache: { data: RegionInfo[]; expiresAt: number } | null = null;
const REGIONS_TTL_MS = 24 * 60 * 60 * 1000; // regions rarely change, cache for a day

async function getRegions(accessToken: string): Promise<RegionInfo[]> {
  if (regionsCache && regionsCache.expiresAt > Date.now()) {
    return regionsCache.data;
  }
  const data = (await trimbleFetch(`${MASTER_BASE_URL}/regions`, accessToken)) as RegionInfo[];
  regionsCache = { data, expiresAt: Date.now() + REGIONS_TTL_MS };
  return data;
}

interface ProjectMinimal {
  id: string;
  name: string;
  location: string;
}

/**
 * Every Trimble Connect project lives in exactly one region, and its data can
 * only be read through that region's API host. We resolve the right base URL
 * by cross-referencing /projects/me (which lists the project's `location`)
 * against /regions (which maps `location` -> the region's API host).
 */
export async function resolveProjectBaseUrl(
  accessToken: string,
  projectId: string
): Promise<string> {
  const [regions, projects] = await Promise.all([
    getRegions(accessToken),
    trimbleFetch(`${MASTER_BASE_URL}/projects/me?fullyLoaded=false`, accessToken) as Promise<
      ProjectMinimal[]
    >,
  ]);

  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    throw new TrimbleApiError(
      "El proyecto no fue encontrado, o el usuario actual no tiene acceso a el.",
      404
    );
  }

  const region = regions.find((r) => r.location === project.location);
  const baseUrl = region?.["tc-api"] ?? MASTER_BASE_URL;
  return baseUrl.replace(/\/$/, "");
}

export interface ProjectDetails {
  id: string;
  name: string;
  rootId: string;
  createdOn: string;
}

export async function getProjectDetails(
  baseUrl: string,
  accessToken: string,
  projectId: string
): Promise<ProjectDetails> {
  const data = await trimbleFetch(
    `${baseUrl}/projects/${encodeURIComponent(projectId)}?fullyLoaded=false`,
    accessToken
  );
  return {
    id: data.id,
    name: data.name,
    rootId: data.rootId,
    createdOn: data.createdOn,
  };
}

export interface RawFolderItem {
  id: string;
  name: string;
  type: "FOLDER" | "FILE";
  size?: number;
  createdOn: string;
  modifiedOn: string;
  createdBy?: TrimbleUserRef;
  modifiedBy?: TrimbleUserRef;
  /** Version id of the item's latest version; used to deep-link into the TC web viewer. */
  versionId?: string;
  /** Revision number of the latest version, shown to the user as "v{revision}". */
  revision?: number;
}

/**
 * Lists all items (files and sub-folders) directly inside a folder,
 * transparently paginating through the API's Range-header pagination
 * (see the "Paginated Responses" section of the Core API OpenAPI spec).
 */
export async function listFolderItems(
  baseUrl: string,
  accessToken: string,
  folderId: string
): Promise<RawFolderItem[]> {
  const all: RawFolderItem[] = [];
  let start = 0;
  for (;;) {
    const end = start + FOLDER_PAGE_SIZE - 1;
    const url = `${baseUrl}/folders/${encodeURIComponent(folderId)}/items`;
    const batch = (await trimbleFetch(url, accessToken, {
      Range: `items=${start}-${end}`,
    })) as RawFolderItem[];
    all.push(...batch);
    if (batch.length < FOLDER_PAGE_SIZE) break;
    start += FOLDER_PAGE_SIZE;
  }
  return all;
}

export type AccessLevel = "READ" | "FULL_ACCESS" | "NO_ACCESS";

export interface FolderPermissions {
  /** Entries set directly on this folder. */
  direct: {
    acl: Partial<Record<AccessLevel, string[]>>;
    /** Whether this folder inherits permissions from its parent at all. */
    inheritance: boolean;
  };
  /** Entries this folder inherits from its ancestors, already resolved by Trimble. */
  inherited: Partial<Record<AccessLevel, string[]>>;
}

/**
 * GET /folders/fs/{folderId}/permissions?fields=inherited - the folder's
 * access control list. Principals are strings like "users:{id}",
 * "tc-groups:{id}", or the special "tc-groups:*" (all project members).
 *
 * The response nests direct and inherited entries separately (confirmed via
 * a raw API call - see the "Estructura de Carpetas" permissions section of
 * the README): `{ directPermissions: { acl, inheritance }, inheritedPermissions: { acl } }`.
 * A single call with `fields=inherited` returns both, so there's no need for
 * a second direct-only request or for diffing two ACLs ourselves.
 * https://developer.trimble.com/docs/connect/tools/api/core (Folders -> Get Folder Permissions)
 */
export async function getFolderPermissions(
  baseUrl: string,
  accessToken: string,
  folderId: string
): Promise<FolderPermissions> {
  const url = `${baseUrl}/folders/fs/${encodeURIComponent(folderId)}/permissions?fields=inherited`;
  const data = await trimbleFetch(url, accessToken);
  return {
    direct: {
      acl: data.directPermissions?.acl ?? {},
      inheritance: Boolean(data.directPermissions?.inheritance),
    },
    inherited: data.inheritedPermissions?.acl ?? {},
  };
}

export interface ProjectUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/** GET /projects/{projectId}/users, paginated the same way as folder items. */
export async function listProjectUsers(
  baseUrl: string,
  accessToken: string,
  projectId: string
): Promise<ProjectUser[]> {
  const all: ProjectUser[] = [];
  let start = 0;
  for (;;) {
    const end = start + FOLDER_PAGE_SIZE - 1;
    const url = `${baseUrl}/projects/${encodeURIComponent(projectId)}/users`;
    const batch = (await trimbleFetch(url, accessToken, {
      Range: `items=${start}-${end}`,
    })) as ProjectUser[];
    all.push(...batch);
    if (batch.length < FOLDER_PAGE_SIZE) break;
    start += FOLDER_PAGE_SIZE;
  }
  return all;
}

export interface ProjectGroup {
  id: string;
  name: string;
}

/** GET /groups?projectId={projectId} - the project's user groups. */
export async function listProjectGroups(
  baseUrl: string,
  accessToken: string,
  projectId: string
): Promise<ProjectGroup[]> {
  const url = `${baseUrl}/groups?projectId=${encodeURIComponent(projectId)}`;
  return (await trimbleFetch(url, accessToken)) as ProjectGroup[];
}
