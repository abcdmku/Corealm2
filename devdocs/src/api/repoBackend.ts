import type { ApiError, CollectionResponse, CollectionSummary, ContentTransactionRequest } from "../../shared/contracts.js";
import { BackendUnavailable, type BackendTransaction, type DevdocsBackend, type TransactionRefusal, type TransactionSuccess } from "./backend.js";

/**
 * The repository checkout, through the Vite middleware at `/__devdocs/`. This is the development
 * workflow and it is unchanged: every surface the editor has ever had is here, because everything it
 * touches — content, authoring notes, the request queue, git, assets, formula source — is a file.
 */

const PREFIX = "/__devdocs/";

async function read<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${PREFIX}${path}`, init);
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as Partial<ApiError>;
    throw new Error(error.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function createRepoBackend(): DevdocsBackend {
  return {
    kind: "repo",
    label: "Local editor",
    assetBaseUrl: "",
    capabilities: { write: true, meta: true, requests: true, git: true, bulk: true, assets: true, formulas: true, publish: false },
    get: read,
    collections: () => read<CollectionSummary[]>("collections"),
    collection: name => read<CollectionResponse>(`collections/${encodeURIComponent(name)}`),
    async transact(request: ContentTransactionRequest): Promise<BackendTransaction> {
      const response = await fetch(`${PREFIX}transaction`, {
        method: "POST", headers: { "content-type": "application/json", Accept: "application/json" }, body: JSON.stringify(request),
      });
      const text = await response.text();
      let body: unknown;
      try { body = text ? JSON.parse(text) as unknown : undefined; } catch { body = undefined; }
      if (response.ok) return { ok: true, body: (body ?? {}) as TransactionSuccess };
      return { ok: false, status: response.status, body: (body ?? { error: `Save failed (${response.status}). Your draft is still here.` }) as TransactionRefusal };
    },
    admin: () => Promise.reject(new BackendUnavailable("Server administration")),
  };
}
