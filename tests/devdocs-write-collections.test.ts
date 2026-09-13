import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCollectionWriteHandler, type CollectionWriteHandler, type CollectionWriteResponse } from "../devdocs/server/handlers/writeCollections.js";
import type { DevdocsJsonResponse } from "../devdocs/server/handlers/collections.js";
import { CONTENT_COLLECTIONS } from "../tools/content/collections.js";
import { contentRevision } from "../tools/content/format.js";
import type { ReferencePools } from "../tools/content/references.js";
import { repoRoot } from "../tools/lib/paths.js";

type Row = Record<string, any>;
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => {
  if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('corealm-write-collections-')) throw new Error('Unexpected fixture cleanup path');
  return rm(root, { recursive: true, force: true });
})); });
// Files are the fixture source. Importing gameplay loaders here would hide stale-cache regressions.
const seed = Promise.all(CONTENT_COLLECTIONS.map(async spec => ({ spec,
  text: await readFile(path.join(repoRoot, "game", "content", spec.file), "utf8"),
})));
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "corealm-write-collections-"));
  roots.push(root);
  const original = await seed;
  await Promise.all(original.map(async ({ spec, text }) => {
    const file = path.join(root, spec.file);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text);
  }));
  const strings = new Set<string>();
  const collect = (value: unknown): void => {
    if (typeof value === "string") strings.add(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value !== null && typeof value === "object") Object.entries(value).forEach(([key, entry]) => { strings.add(key); collect(entry); });
  };
  original.forEach(({ text }) => collect(JSON.parse(text)));
  const external: ReferencePools = { asset: strings, entity: strings, location: strings, settlement: strings,
    enemyFamily: strings, region: strings, enemy: strings, species: strings, campfireFuel: strings };
  const referencePools = async () => external;
  const handler = createCollectionWriteHandler({ contentRoot: root, referencePools });
  const load = async (name: string): Promise<{ rows: Row[]; data: Row; revision: string; text: string }> => {
    const spec = CONTENT_COLLECTIONS.find(row => row.name === name)!;
    const text = await readFile(path.join(root, spec.file), "utf8");
    return { rows: JSON.parse(text) as Row[], data: JSON.parse(text) as Row, revision: contentRevision(text), text };
  };
  return { root, handler, load, referencePools, external };
}
function parsed<T>(response: DevdocsJsonResponse | undefined): T {
  if (!response) throw new Error("Expected response");
  return JSON.parse(response.body) as T;
}
const recordUrl = (collection: string, id: string) => `/__devdocs/collections/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`;
function put(handler: CollectionWriteHandler, collection: string, id: string, revision: string, record: unknown) {
  return handler({ method: "PUT", url: recordUrl(collection, id), body: { revision, record } });
}
function diagnostics(response: DevdocsJsonResponse | undefined): string {
  return JSON.stringify(parsed<{ diagnostics: unknown }>(response).diagnostics);
}

describe("devdocs collection writes", () => {
  it('keeps dependency rows available when one formula cannot run', async () => {
    const { root, handler, load } = await fixture();
    const items = await load('items');
    const broken = items.rows.find(row => row.derivation?.kind === 'gear')!;
    broken.derivation.baselineId = items.rows.find(row => row.category === 'resource')!.id;
    await writeFile(path.join(root, 'data/items.json'), JSON.stringify(items.rows, null, 2) + '\n');
    const shops = await load('shops');
    const shop: Row = { ...shops.rows[0]!, name: 'Still editable' };
    const result = await put(handler, 'shops', shop.id, shops.revision, shop);
    expect(result?.status, result?.body).toBe(200);
    const issues = parsed<{ diagnostics: { path: string; message: string }[] }>(result).diagnostics;
    expect(issues.filter(issue => issue.message.startsWith('Cannot derive')).map(issue => issue.path)).toEqual([`items.${broken.id}`]);
  });
  it("updates a validated existing row in file order and writes no other collection", async () => {
    const { root, handler, load } = await fixture();
    const before = await load("shops");
    const record: Row = { ...before.rows[0]!, name: "Updated supplies" };
    const result = await put(handler, "shops", record.id, before.revision, record);
    expect(result?.status, result?.body).toBe(200);
    const response = parsed<CollectionWriteResponse>(result);
    expect(response.collection).toMatchObject({ name: "shops", editable: true, count: before.rows.length });
    expect((response.data as Row[]).map(row => row.id)).toEqual(before.rows.map(row => row.id));
    expect((response.data as Row[])[0]).toEqual(record);
    expect(response.revision).toBe((await load("shops")).revision);
    for (const source of await seed) {
      if (source.spec.name !== "shops") expect(await readFile(path.join(root, source.spec.file), "utf8"), source.spec.name).toBe(source.text);
    }
    expect((await readdir(root)).some(file => file.includes("lock"))).toBe(false);
    expect((await load("shops")).text.endsWith("\n")).toBe(true);
  });

  it("serializes same-file writes from independent handlers and rejects the stale revision", async () => {
    const { root, handler, referencePools, load } = await fixture();
    const sibling = createCollectionWriteHandler({ contentRoot: root, referencePools });
    const before = await load("shops");
    const row = before.rows[0]!;
    const responses = await Promise.all([
      put(handler, "shops", row.id, before.revision, { ...row, name: "First writer" }),
      put(sibling, "shops", row.id, before.revision, { ...row, name: "Second writer" }),
    ]);
    expect(responses.map(response => response!.status).sort()).toEqual([200, 409]);
    const conflict = responses.find(response => response!.status === 409)!;
    expect(parsed<{ revision: string }>(conflict).revision).toBe((await load("shops")).revision);
    expect((await readdir(path.join(root, "data"))).some(file => /\.lock$|\.tmp$/.test(file))).toBe(false);
  });

  it("holds a common validation lock for simultaneous writes to different collections", async () => {
    const { root, load, external } = await fixture();
    let active = 0, maximum = 0;
    const pools = async () => {
      active++; maximum = Math.max(maximum, active);
      await new Promise(resolve => setTimeout(resolve, 20));
      active--;
      return external;
    };
    const handlers = [createCollectionWriteHandler({ contentRoot: root, referencePools: pools }), createCollectionWriteHandler({ contentRoot: root, referencePools: pools })];
    const [shops, npcs] = await Promise.all([load("shops"), load("npcs")]);
    const results = await Promise.all([
      put(handlers[0]!, "shops", shops.rows[0]!.id, shops.revision, { ...shops.rows[0], name: "New shop" }),
      put(handlers[1]!, "npcs", npcs.rows[0]!.id, npcs.revision, { ...npcs.rows[0], name: "New NPC" }),
    ]);
    expect(results.map(result => result!.status), JSON.stringify(results.map(result => result!.body))).toEqual([200, 200]);
    expect(maximum).toBe(1);
  });

  it("rejects schemas, foreign keys, external asset references and read-only identities before writing", async () => {
    const { root, load, handler, external } = await fixture();
    const shops = await load("shops"), row = shops.rows[0]!;
    for (const changed of [{ ...row, name: 42 }, { ...row, surprise: true }, { ...row, stock: [{ itemId: "unknown-item", quantity: 1 }] }, { ...row, id: "new-identity" }]) {
      expect((await put(handler, "shops", row.id, shops.revision, changed))?.status).toBe(422);
      expect((await load("shops")).text).toBe(shops.text);
    }
    const stalePools = createCollectionWriteHandler({ contentRoot: root, referencePools: async () => ({ ...external, item: new Set(["unknown-item"]) }) });
    const invalid = await put(stalePools, "shops", row.id, shops.revision, { ...row, stock: [{ itemId: "unknown-item", quantity: 1 }] });
    expect(invalid?.status).toBe(422);
    expect(diagnostics(invalid)).toContain("unknown item reference");
    const resources = await load("resources"), resource = structuredClone(resources.rows[0]!);
    resource.presentation.availableAssetIds = ["missing-external-model"];
    const asset = await put(handler, "resources", resource.id, resources.revision, resource);
    expect(asset?.status).toBe(422);
    expect(diagnostics(asset)).toContain("unknown asset reference");
    const quests = await load("quests"), quest = structuredClone(quests.rows[0]!);
    quest.stages[0].index = 999;
    const identity = await put(handler, "quests", quest.id, quests.revision, quest);
    expect(identity?.status).toBe(422);
    expect(diagnostics(identity)).toContain("identity");
    expect((await load("quests")).text).toBe(quests.text);
    const dialogue = await load("dialogue"), node = structuredClone(dialogue.rows[0]!);
    node.options[0].id += "-changed";
    expect((await put(handler, "dialogue", node.id, dialogue.revision, node))?.status).toBe(422);
  });

  it("checks cross-references in other files against the actual temp-root JSON", async () => {
    const { root, load, handler } = await fixture();
    const shops = await load("shops");
    const broken = structuredClone(shops.rows);
    broken[1]!.stock = [{ itemId: "broken-in-another-file", quantity: 1 }];
    await writeFile(path.join(root, "data", "shops.json"), JSON.stringify(broken));
    const npcs = await load("npcs");
    const npc: Row = { ...npcs.rows[0], name: "Would be valid alone" };
    const result = await put(handler, "npcs", String(npc.id), npcs.revision, npc);
    expect(result?.status).toBe(422);
    expect(diagnostics(result)).toContain("broken-in-another-file");
    expect((await load("npcs")).text).toBe(npcs.text);
  });

  it("requires removing a derivation tag before hand-tuning locked recipe fields", async () => {
    const { handler, load } = await fixture();
    const recipes = await load("recipes"), row = recipes.rows.find(row => row.derivation?.kind === "recipeXp")!;
    const tuned: Row = { ...row, xp: row.xp + 9 };
    const blocked = await put(handler, "recipes", row.id, recipes.revision, tuned);
    expect(blocked?.status).toBe(422);
    expect(diagnostics(blocked)).toContain("Drifted from recipeXp");
    expect((await load("recipes")).text).toBe(recipes.text);
    delete tuned.derivation;
    const allowed = await put(handler, "recipes", row.id, recipes.revision, tuned);
    expect(allowed?.status, allowed?.body).toBe(200);
    expect((await load("recipes")).rows.find(candidate => candidate.id === row.id)!.xp).toBe(tuned.xp);
  });

  it("allows balance changes with drift warnings and never rewrites derived records", async () => {
    const { handler, load } = await fixture();
    const recipes = await load("recipes"), params = await load("balance/recipes");
    const changed = structuredClone(params.data);
    changed.gatherXp.multiplier += 1;
    const response = await handler({ method: "PUT", url: "/__devdocs/collections/balance/recipes/$collection", body: { revision: params.revision, record: changed } });
    expect(response?.status, response?.body).toBe(200);
    const output = parsed<CollectionWriteResponse>(response);
    expect(output.diagnostics?.some(issue => issue.path.startsWith("recipes.") && issue.severity === "warning")).toBe(true);
    expect((await load("recipes")).text).toBe(recipes.text);
    expect((await load("balance/recipes")).data).toEqual(changed);
    const shops = await load("shops");
    const unrelated = await put(handler, "shops", shops.rows[0]!.id, shops.revision, { ...shops.rows[0], name: "Allowed despite drift" });
    expect(unrelated?.status, unrelated?.body).toBe(200);
    expect(parsed<CollectionWriteResponse>(unrelated).diagnostics?.every(issue => issue.severity === "warning")).toBe(true);
  });

  it("rejects deletion, unknown IDs, malformed routes, extra body fields and remote requests", async () => {
    const { handler, load } = await fixture();
    const shops = await load("shops"), row = shops.rows[0]!, url = recordUrl("shops", row.id);
    const removed = await handler({ method: "DELETE", url, body: { revision: shops.revision } });
    expect(removed?.status).toBe(422);
    expect(diagnostics(removed)).toContain("remove an existing save identity");
    expect((await put(handler, "shops", "missing", shops.revision, row))?.status).toBe(404);
    expect((await put(handler, "unknown", "missing", shops.revision, row))?.status).toBe(404);
    expect((await handler({ method: "PUT", url, body: { revision: shops.revision, record: row, force: true } }))?.status).toBe(422);
    expect((await handler({ method: "POST", url }))?.status).toBe(405);
    expect((await handler({ method: "PUT", url, headers: { origin: "https://evil.example" } }))?.status).toBe(403);
    expect((await handler({ method: "PUT", url, socket: { remoteAddress: "192.0.2.3" } }))?.status).toBe(403);
    for (const badUrl of ["/__devdocs/collections/../shops/x", "/__devdocs/collections/shops/%2e%2e", "/__devdocs/collections/shops/x%2Fy", "/__devdocs/collections/shops/%00", "/__devdocs/collections/balance%2F..%2Fsets/$collection"]) {
      expect((await handler({ method: "PUT", url: badUrl }))?.status, badUrl).toBe(400);
    }
    expect(await handler({ method: "PUT", url: "/unrelated" })).toBeUndefined();
    expect((await load("shops")).text).toBe(shops.text);
  });
});
