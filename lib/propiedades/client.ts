import {
  AttributeDefinition,
  CatalogResponse,
  DefinitionInput,
  MAX_ELEMENTS_PER_REQUEST,
  StoredValue,
  TargetElement,
  ValueChange,
} from "./types";
import { expiresSoon } from "./token";

/** What the catalog screen and the viewer panel need from the data service. */
export interface PropiedadesApi {
  getCatalog(): Promise<CatalogResponse>;
  createDefinition(input: Partial<DefinitionInput> & { title: string }): Promise<AttributeDefinition>;
  updateDefinition(id: string, patch: Partial<DefinitionInput> & { active?: boolean }): Promise<AttributeDefinition>;
  deleteDefinition(id: string): Promise<void>;
  queryValues(ifcGuids: string[]): Promise<StoredValue[]>;
  saveValues(elements: TargetElement[], changes: ValueChange[]): Promise<void>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
  }
}

export interface TokenSource {
  /** The current access token. */
  get(): string;
  /** Asks Trimble Connect for the token again; "" when none can be had right now. */
  refresh?(): Promise<string>;
  /** A safe description of the current token (never the token), for error messages. */
  describe?(): string;
}

/** The HTTP client for /api/propiedades, authenticated with the user's Trimble token. */
export function httpApi(projectId: string, auth: TokenSource): PropiedadesApi {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const sep = path.includes("?") ? "&" : "?";
    const send = (token: string) =>
      fetch(`/api/propiedades${path}${sep}projectId=${encodeURIComponent(projectId)}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });

    let token = auth.get();
    if (auth.refresh && (!token || expiresSoon(token))) token = (await auth.refresh()) || token;
    let res = await send(token);
    // Trimble Connect rejected the token (expired or stale): ask for it again, once.
    if (res.status === 401 && auth.refresh) {
      const fresh = await auth.refresh();
      if (fresh) res = await send(fresh);
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      let text: string = body.error ?? `Error ${res.status}`;
      if (res.status === 401 && auth.describe) text += ` (Diagnóstico: ${auth.describe()}.)`;
      throw new ApiError(text, res.status, body.code);
    }
    return body as T;
  }

  return {
    getCatalog: () => request<CatalogResponse>("/definiciones"),
    createDefinition: (input) => request("/definiciones", { method: "POST", body: JSON.stringify(input) }),
    updateDefinition: (id, patch) =>
      request(`/definiciones/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
    async deleteDefinition(id) {
      await request(`/definiciones/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async queryValues(ifcGuids) {
      const out: StoredValue[] = [];
      for (let i = 0; i < ifcGuids.length; i += MAX_ELEMENTS_PER_REQUEST) {
        const batch = ifcGuids.slice(i, i + MAX_ELEMENTS_PER_REQUEST);
        const { values } = await request<{ values: StoredValue[] }>("/valores/consulta", {
          method: "POST",
          body: JSON.stringify({ ifcGuids: batch }),
        });
        out.push(...values);
      }
      return out;
    },
    async saveValues(elements, changes) {
      // Each batch is all-or-nothing on the server; selections over the limit take several.
      for (let i = 0; i < elements.length; i += MAX_ELEMENTS_PER_REQUEST) {
        await request("/valores", {
          method: "PUT",
          body: JSON.stringify({ elements: elements.slice(i, i + MAX_ELEMENTS_PER_REQUEST), changes }),
        });
      }
    },
  };
}
