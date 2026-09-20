import type { CollectionResponse, CollectionSummary } from "../../shared/contracts.js";
import type { DevdocsBackend } from "./backend.js";

/** The player guide: one prebuilt bundle of request paths, no server of any kind behind it. */
export function createPlayerBackend(): DevdocsBackend {
  let bundle: Promise<{ requests: Record<string, unknown> }> | undefined;
  const read = async <T>(path: string): Promise<T> => {
    bundle ??= fetch(`${import.meta.env.BASE_URL}content-bundle.json`).then(async response => {
      if (!response.ok) throw new Error(`Unable to load guide content (${response.status})`);
      return response.json();
    });
    const loaded = await bundle;
    const value = loaded.requests[path] ?? loaded.requests[decodeURIComponent(path)];
    if (value === undefined) throw new Error("This content is unavailable in the player guide");
    return value as T;
  };
  return {
    kind: "player", label: "Player guide", assetBaseUrl: "",
    capabilities: { write: false, meta: false, requests: false, git: false, bulk: false, assets: false, formulas: false, publish: false },
    get: read,
    collections: () => read<CollectionSummary[]>("collections"),
    collection: name => read<CollectionResponse>(`collections/${encodeURIComponent(name)}`),
    transact: () => Promise.resolve({ ok: false as const, status: 405, body: { error: "The player guide reads only." } }),
    admin: () => Promise.reject(new Error("The player guide reads only.")),
  };
}
