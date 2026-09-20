import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CONTENT_COLLECTIONS } from "../game/src/content/compiler/collections.js";
import type { CollectionResponse, CollectionSummary } from "../devdocs/shared/contracts.js";
import { createCollectionsHandler } from "../devdocs/server/handlers/collections.js";
import { devdocsPlugin } from "../devdocs/server/plugin.js";

async function tempShops(): Promise<{ root: string; file: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "corealm-devdocs-collections-"));
  const data = path.join(root, "data");
  await mkdir(data, { recursive: true });
  const file = path.join(data, "shops.json");
  await writeFile(file, JSON.stringify([
    { id: "test-shop", name: "Test Shop", buyMultiplier: 1, sellMultiplier: 0.5, stock: [] },
  ], null, 2) + "\n", "utf8");
  return { root, file };
}

function body<T>(response: { body: string } | undefined): T {
  if (!response) throw new Error("Expected a response");
  return JSON.parse(response.body) as T;
}

describe("devdocs collections GET API", () => {
  it("lists registered collections and reads a validated collection from a temporary content root", async () => {
    const list = await createCollectionsHandler()({ method: "GET", url: "/__devdocs/collections" });
    expect(list?.status).toBe(200);
    const summaries = body<CollectionSummary[]>(list);
    expect(summaries.map((summary) => summary.name)).toEqual(CONTENT_COLLECTIONS.map((spec) => spec.name));
    expect(summaries.find((summary) => summary.name === "shops")).toMatchObject({
      name: "shops", idKey: "id", shape: "array", editable: false,
    });

    const fixture = await tempShops();
    try {
      const response = await createCollectionsHandler({ contentRoot: fixture.root })({
        method: "GET", url: "/__devdocs/collections/shops",
      });
      expect(response?.status).toBe(200);
      const result = body<CollectionResponse>(response);
      expect(result.collection).toMatchObject({ name: "shops", count: 1, shape: "array" });
      expect(result.data).toEqual([{ id: "test-shop", name: "Test Shop", buyMultiplier: 1, sellMultiplier: 0.5, stock: [] }]);
      expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("uses exact file bytes for a stable revision and changes it when content changes", async () => {
    const fixture = await tempShops();
    try {
      const handler = createCollectionsHandler({ contentRoot: fixture.root });
      const first = body<CollectionResponse>(await handler({ method: "GET", url: "/__devdocs/collections/shops" }));
      const same = body<CollectionResponse>(await handler({ method: "GET", url: "/__devdocs/collections/shops" }));
      expect(same.revision).toBe(first.revision);

      const source = await readFile(fixture.file, "utf8");
      await writeFile(fixture.file, source.replace("Test Shop", "Changed Shop"), "utf8");
      const changed = body<CollectionResponse>(await handler({ method: "GET", url: "/__devdocs/collections/shops" }));
      expect(changed.revision).not.toBe(first.revision);
      expect(changed.data).toEqual([{ id: "test-shop", name: "Changed Shop", buyMultiplier: 1, sellMultiplier: 0.5, stock: [] }]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("supports encoded and two-segment balance names without allowing arbitrary paths", async () => {
    const encoded = await createCollectionsHandler()({ method: "GET", url: "/__devdocs/collections/balance%2Fformation" });
    const split = await createCollectionsHandler()({ method: "GET", url: "/__devdocs/collections/balance/formation" });
    expect(encoded?.status).toBe(200);
    expect(split?.status).toBe(200);
    expect(body<CollectionResponse>(encoded).collection.name).toBe("balance/formation");
    expect(body<CollectionResponse>(split).collection.name).toBe("balance/formation");

    const handler = createCollectionsHandler();
    expect((await handler({ method: "GET", url: "/__devdocs/collections/not-registered" }))?.status).toBe(404);
    expect((await handler({ method: "GET", url: "/__devdocs/collections/../shops" }))?.status).toBe(400);
    expect((await handler({ method: "GET", url: "/__devdocs/collections/%2e%2e/shops" }))?.status).toBe(400);
    expect((await handler({ method: "GET", url: "/__devdocs/collections/%2Fetc%2Fpasswd" }))?.status).toBe(400);
  });

  it("is GET-only and refuses hostile network metadata", async () => {
    const handler = createCollectionsHandler();
    expect((await handler({ method: "POST", url: "/__devdocs/collections/shops" }))?.status).toBe(405);
    expect((await handler({ method: "PUT", url: "/__devdocs/collections" }))?.status).toBe(405);
    expect((await handler({ method: "GET", url: "/__devdocs/collections/shops", socket: { remoteAddress: "192.0.2.10" } }))?.status).toBe(403);
    expect((await handler({ method: "GET", url: "/__devdocs/collections/shops", headers: { host: "evil.example" } }))?.status).toBe(403);
    expect((await handler({ method: "GET", url: "/__devdocs/collections/shops", headers: { origin: "https://evil.example" } }))?.status).toBe(403);
  });

  it("is installed by Vite for serve only", () => {
    const plugin = devdocsPlugin();
    expect(plugin.apply).toBe("serve");
    expect(plugin.configureServer).toEqual(expect.any(Function));
    expect(plugin.configurePreviewServer).toBeUndefined();
  });
});
