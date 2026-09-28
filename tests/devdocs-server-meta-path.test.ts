import { describe, expect, it } from "vitest";
import { createServerBackend } from "../devdocs/src/api/serverBackend.js";

const SERVER = "https://server.test";
const SESSION = { server: SERVER, audience: SERVER, token: "adm_test", expiresAt: Date.now() + 3_600_000, accountId: "acc_test_account_test_xx", name: "Test", role: "owner" as const };
const DESCRIPTOR = { name: "Test", endpoint: "wss://server.test/", assetBaseUrl: "https://cdn.test/pack/", identityUrl: null } as never;

describe("server-mode metadata paths", () => {
  it("encodes a digest path once, whether or not the caller already encoded it", async () => {
    const urls: string[] = [];
    const fetch = (async (url: string) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ collection: "creatureDefinitions", revision: "r", records: {} }), text: async () => "{}" } as unknown as Response;
    }) as unknown as typeof globalThis.fetch;
    const backend = createServerBackend({ session: SESSION, descriptor: DESCRIPTOR, fetch });
    await backend.get("meta/creatureDefinitions/%24all");
    await backend.get("meta/balance/sets/%24all");
    await backend.get("meta/items/iron%20sword");
    // The first read also probes what the server offers; those requests are not under test here.
    expect(urls.filter(url => url.includes("/admin/meta/") && !url.endsWith("/items/$all"))).toEqual([
      `${SERVER}/admin/meta/creatureDefinitions/%24all`,
      `${SERVER}/admin/meta/balance/sets/%24all`,
      `${SERVER}/admin/meta/items/iron%20sword`,
    ]);
  });
});
