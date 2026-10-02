import {
  AttributeDefinition,
  CatalogResponse,
  DefinitionInput,
  MAX_ELEMENTS_PER_REQUEST,
  StoredValue,
  TargetElement,
  ValueChange,
} from "./types";

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

/** The HTTP client for /api/propiedades, authenticated with the user's Trimble token. */
export function httpApi(projectId: string, getToken: () => string): PropiedadesApi {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`/api/propiedades${path}${sep}projectId=${encodeURIComponent(projectId)}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${getToken()}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(body.error ?? `Error ${res.status}`, res.status, body.code);
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
