import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecomputeHandler, type RecomputeHandler, type RecomputeResponse } from "../devdocs/server/handlers/recompute.js";
import { createCollectionWriteHandler } from "../devdocs/server/handlers/writeCollections.js";
import type { DevdocsJsonResponse } from "../devdocs/server/handlers/collections.js";
import { CONTENT_COLLECTIONS } from "../tools/content/collections.js";
import { contentRevision, formatContentJson } from "../tools/content/format.js";
import type { ReferencePools } from "../tools/content/references.js";
import * as atomic from "../tools/lib/atomic-replace-file.js";
import { repoRoot } from "../tools/lib/paths.js";

type Row = Record<string, any>;
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("corealm-recompute-")) throw new Error("Unexpected fixture cleanup path");
    await rm(resolved, { recursive: true, force: true });
  }
});
const seed = Promise.all(CONTENT_COLLECTIONS.map(async spec => ({ spec,
  text: await readFile(path.join(repoRoot, "game", "content", spec.file), "utf8"),
})));

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "corealm-recompute-"));
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
  const handler = createRecomputeHandler({ contentRoot: root, referencePools });
  const file = (name: string) => path.join(root, CONTENT_COLLECTIONS.find(spec => spec.name === name)!.file);
  const load = async (name: string) => {
    const text = await readFile(file(name), "utf8");
    return { text, data: JSON.parse(text) as Row, rows: JSON.parse(text) as Row[], revision: contentRevision(text) };
  };
  const write = (name: string, data: unknown) => writeFile(file(name), formatContentJson(data));
  const snapshot = async (): Promise<Record<string, string>> => Object.fromEntries(await Promise.all(CONTENT_COLLECTIONS.map(async spec => [spec.name, (await load(spec.name)).text] as const)));
  const changeXp = async () => {
    const params = await load("balance/recipes");
    params.data.gatherXp.multiplier += 1;
    await write("balance/recipes", params.data);
  };
  return { root, handler, load, write, snapshot, changeXp, referencePools };
}
function parsed<T = RecomputeResponse>(response: DevdocsJsonResponse | undefined): T {
  if (!response) throw new Error("Expected recompute response");
  return JSON.parse(response.body) as T;
}
function request(handler: RecomputeHandler, body: unknown) {
  return handler({ method: "POST", url: "/__devdocs/recompute", body });
}

describe("devdocs recompute handler", () => {
  it("previews and removes an unexpected formula-owned optional field", async () => {
    const f = await fixture();
    const items = await f.load("items");
    const sword = items.rows.find(row => row.id === "dewglass_sword")!;
    sword.tool = { skill: "mining", gatherBonus: 999 };
    await f.write("items", items.rows);
    const before = await f.snapshot();
    const preview = parsed(await request(f.handler, { operation: "preview", collection: "items", recordId: sword.id }));
    expect(preview.diffs).toHaveLength(1);
    expect(preview.diffs[0]!.before.tool).toEqual(sword.tool);
    expect(preview.diffs[0]!.after).not.toHaveProperty("tool");
    expect(await f.snapshot()).toEqual(before);
    const applied = await request(f.handler, { operation: "apply", collection: "items", recordId: sword.id, revisions: preview.revisions });
    expect(applied?.status, applied?.body).toBe(200);
    expect((await f.load("items")).rows.find(row => row.id === sword.id)).not.toHaveProperty("tool");
    expect(parsed(await request(f.handler, { operation: "preview" })).diffs).toEqual([]);
  });
  it("previews a separately saved parameter edit from disk without changing any collection bytes", async () => {
    const f = await fixture();
    const params = await f.load("balance/recipes");
    const originalRecipes = await f.load("recipes");
    params.data.gatherXp.multiplier += 1;
    const write = createCollectionWriteHandler({ contentRoot: f.root, referencePools: f.referencePools });
    const saved = await write({ method: "PUT", url: "/__devdocs/collections/balance/recipes/$collection",
      body: { revision: params.revision, record: params.data } });
    expect(saved?.status, saved?.body).toBe(200);
    expect((await f.load("recipes")).text).toBe(originalRecipes.text);
    const before = await f.snapshot();
    const response = await request(f.handler, { operation: "preview" });
    expect(response?.status, response?.body).toBe(200);
    const preview = parsed(response);
    expect(preview.diffs.length).toBeGreaterThan(100);
    expect(new Set(preview.diffs.map(diff => diff.collection))).toEqual(new Set(["recipes", "campfireFuels"]));
    const recipe = originalRecipes.rows.find(row => row.id === "smelt_grithe_bar")!;
    expect(preview.diffs.find(diff => diff.recordId === recipe.id)).toMatchObject({ collection: "recipes", before: { xp: recipe.xp }, after: { xp: 9 } });
    expect(Object.keys(preview.revisions)).toEqual(CONTENT_COLLECTIONS.map(spec => spec.name));
    for (const [name, bytes] of Object.entries(before)) expect(preview.revisions[name]).toBe(contentRevision(bytes));
    expect(await f.snapshot()).toEqual(before);
  });

  it("applies exact server-derived fields across collections and leaves untagged rows and other fields untouched", async () => {
    const f = await fixture();
    const recipes = await f.load("recipes");
    const handTuned = recipes.rows.find(row => row.derivation?.kind === "recipeXp")!;
    delete handTuned.derivation;
    handTuned.xp = 777;
    await f.write("recipes", recipes.rows);
    await f.changeXp();
    const before = await f.snapshot();
    const preview = parsed(await request(f.handler, { operation: "preview" }));
    expect(preview.diffs.some(diff => diff.recordId === handTuned.id)).toBe(false);
    const response = await request(f.handler, { operation: "apply", revisions: preview.revisions });
    expect(response?.status, response?.body).toBe(200);
    expect(parsed(response).diffs).toEqual(preview.diffs);
    const changedCollections = new Set(preview.diffs.map(diff => diff.collection));
    for (const spec of CONTENT_COLLECTIONS) {
      const actual = await f.load(spec.name);
      expect(parsed(response).revisions[spec.name]).toBe(actual.revision);
      if (!changedCollections.has(spec.name)) expect(actual.text, spec.name).toBe(before[spec.name]);
      else {
        const expected = JSON.parse(before[spec.name]!) as Row[];
        for (const diff of preview.diffs.filter(diff => diff.collection === spec.name)) {
          const index = expected.findIndex(row => String(row[spec.idKey]) === diff.recordId);
          expected[index] = { ...expected[index], ...diff.after };
        }
        expect(actual.rows, spec.name).toEqual(expected);
      }
    }
    expect((await f.load("recipes")).rows.find(row => row.id === handTuned.id)).toEqual(handTuned);
    expect(parsed(await request(f.handler, { operation: "preview" })).diffs).toEqual([]);
  });

  it("filters by kind, collection and record identity without fixing other drift", async () => {
    const f = await fixture();
    await f.changeXp();
    const before = await f.snapshot();
    const selection = { kind: "recipeXp", collection: "recipes", recordId: "smelt_grithe_bar" };
    const preview = parsed(await request(f.handler, { operation: "preview", ...selection }));
    expect(preview.diffs).toHaveLength(1);
    const response = await request(f.handler, { operation: "apply", ...selection, revisions: preview.revisions });
    expect(response?.status, response?.body).toBe(200);
    const rows = (await f.load("recipes")).rows;
    const expected = JSON.parse(before.recipes!) as Row[];
    const index = expected.findIndex(row => row.id === selection.recordId);
    expected[index] = { ...expected[index], ...preview.diffs[0]!.after };
    expect(rows).toEqual(expected);
    expect((await f.load("campfireFuels")).text).toBe(before.campfireFuels);
    expect(parsed(await request(f.handler, { operation: "preview", kind: "campfireFuel" })).diffs.length).toBeGreaterThan(0);
  });

  it("rejects stale revisions for unrelated files and parameters before writing anything", async () => {
    for (const changedCollection of ["shops", "balance/recipes"]) {
      const f = await fixture();
      await f.changeXp();
      const preview = parsed(await request(f.handler, { operation: "preview" }));
      if (changedCollection === "shops") {
        const shops = await f.load("shops");
        shops.rows[0]!.name += " changed";
        await f.write("shops", shops.rows);
      } else await f.changeXp();
      const before = await f.snapshot();
      const response = await request(f.handler, { operation: "apply", revisions: preview.revisions });
      expect(response?.status).toBe(409);
      expect(await f.snapshot()).toEqual(before);
      expect(parsed<{ revisions: Record<string, string> }>(response).revisions[changedCollection]).toBe(contentRevision(before[changedCollection]!));
    }
  });

  it("rejects unknown fields, incomplete snapshots, invalid filters and non-loopback requests", async () => {
    const f = await fixture();
    const before = await f.snapshot();
    const preview = parsed(await request(f.handler, { operation: "preview" }));
    const incomplete = { ...preview.revisions };
    delete incomplete.items;
    for (const body of [undefined, { operation: "patch" }, { operation: "preview", patches: [] },
      { operation: "apply", revisions: incomplete }, { operation: "apply", revisions: { ...preview.revisions, bogus: "0".repeat(64) } },
      { operation: "apply", revisions: preview.revisions, diffs: [] }, { operation: "preview", collection: "../items" },
      { operation: "preview", recordId: 2 }, { operation: "preview", kind: "" }]) {
      expect((await request(f.handler, body))?.status).toBe(422);
    }
    expect((await f.handler({ method: "GET", url: "/__devdocs/recompute" }))?.status).toBe(405);
    expect((await f.handler({ method: "POST", url: "/__devdocs/recompute", body: { operation: "preview" }, socket: { remoteAddress: "192.168.0.2" } }))?.status).toBe(403);
    expect((await f.handler({ method: "POST", url: "/__devdocs/recompute", body: { operation: "preview" }, headers: { origin: "https://evil.example" } }))?.status).toBe(403);
    expect(await f.handler({ method: "POST", url: "/__devdocs/../__devdocs/recompute", body: { operation: "preview" } })).toBeUndefined();
    expect(await f.snapshot()).toEqual(before);
  });

  it("validates the final overlay references before any recompute write", async () => {
    const f = await fixture();
    const params = await f.load("balance/jewelry");
    params.data.crafted.profiles[0].bar = "nonexistent_bar";
    await f.write("balance/jewelry", params.data);
    const before = await f.snapshot();
    const preview = parsed(await request(f.handler, { operation: "preview", kind: "jewelryRecipe" }));
    expect(preview.diffs).toHaveLength(2);
    const response = await request(f.handler, { operation: "apply", kind: "jewelryRecipe", revisions: preview.revisions });
    expect(response?.status, response?.body).toBe(422);
    expect(response?.body).toContain("nonexistent_bar");
    expect(await f.snapshot()).toEqual(before);
  });

  it("rolls back every attempted file if a later collection write fails", async () => {
    const f = await fixture();
    await f.changeXp();
    const preview = parsed(await request(f.handler, { operation: "preview" }));
    expect(new Set(preview.diffs.map(diff => diff.collection)).size).toBeGreaterThan(1);
    const before = await f.snapshot();
    const original = atomic.atomicReplaceFile;
    let calls = 0;
    vi.spyOn(atomic, "atomicReplaceFile").mockImplementation(async (...args) => {
      if (++calls === 2) throw new Error("Injected second collection failure");
      await original(...args);
    });
    const response = await request(f.handler, { operation: "apply", revisions: preview.revisions });
    expect(response?.status).toBe(500);
    expect(response?.body).toContain("original collections restored");
    expect(calls).toBe(4);
    expect(await f.snapshot()).toEqual(before);
    expect((await readdir(f.root)).some(name => name.endsWith(".lock"))).toBe(false);
    expect((await readdir(path.join(f.root, "data"))).some(name => /\.lock$|\.tmp$/.test(name))).toBe(false);
  });

  it("serializes independent recompute handlers using the shared root write lock", async () => {
    const f = await fixture();
    await f.changeXp();
    const preview = parsed(await request(f.handler, { operation: "preview" }));
    const sibling = createRecomputeHandler({ contentRoot: f.root, referencePools: f.referencePools });
    const responses = await Promise.all([f.handler, sibling].map(handler => request(handler, { operation: "apply", revisions: preview.revisions })));
    expect(responses.map(response => response!.status).sort()).toEqual([200, 409]);
    expect(parsed(await request(f.handler, { operation: "preview" })).diffs).toEqual([]);
  });
});
