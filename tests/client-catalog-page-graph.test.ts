import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { chainTo, evaluationOrder, pageGraph, staticClosure, tablesReadBy, type PageModule } from "../tools/lib/page-graph.js";
import { clientCatalog, serializeClientCatalog } from "../game/src/content/clientCatalog.js";
import { pageCatalogKind } from "../game/src/content/catalogEntry.js";
import { repoRoot } from "../tools/lib/paths.js";

/**
 * The game page runs on the client catalog and nothing else. This holds it to that:
 *
 *  - the entry's static imports evaluate no content, so the catalog can be installed first;
 *  - the bundled catalog is nowhere in the page's module graph;
 *  - every content module the page can load evaluates against a CLIENT-ONLY catalog, and a read of a
 *    table the projection does not carry fails with the module, the table and the import chain;
 *  - the projection holds nothing a player must not read.
 *
 * When this fails after a page module starts reading a new table: decide whether a player may see
 * it. If so, add its presentation fields to `content/clientCatalog.ts`. If not, the read belongs on
 * the host, not on the page.
 */
const src = path.join(repoRoot, "game/src");
const entry = path.join(src, "main.ts");
const rel = (file: string): string => path.relative(src, file).replaceAll("\\", "/");
/** Authoring tables the production page has always run without: modules read them into constants nothing on the page uses. */
const TOLERATED_MISSING = new Set(["equipmentFamilies", "recipeTemplates", "creatureDefinitions", "creatureProfiles"]);
/** Server-only knowledge, by the key it is spelled with in the compiled catalog. */
const FORBIDDEN_KEYS = ["lootRolls", "lootTables", "aggroRadius", "attackSpeedMs", "attackLevel", "defenceLevel", "maxHit", "respawnSeconds", "respawnMs",
  "leashRadius", "roamRadius", "anchors", "creatureDefinitions", "encounterId", "habitats", "groupsByRegion", "creatureByGroup", "placements", "encounters"];

let graph: Map<string, PageModule>;
const compiled = JSON.parse(readFileSync(path.join(repoRoot, "game/content/compiled/catalog.json"), "utf8")) as { revision: string; tables: Record<string, unknown> };
beforeAll(async () => {
  graph = await pageGraph(entry, { define: { "import.meta.env.DEV": "false", "import.meta.env.PROD": "true" } });
}, 120_000);

describe("the game page's catalog", () => {
  it("installs before anything that reads content is evaluated", () => {
    const early = [...staticClosure(graph, entry)];
    expect(early.map(rel)).not.toContain("content/bundledCatalog.ts");
    expect(early.filter(file => tablesReadBy(file).length > 0 || rel(file) === "content/resolvedCatalog.ts").map(rel)).toEqual([]);
    expect([...graph.keys()].map(rel)).not.toContain("content/bundledCatalog.ts");
  });

  it("chooses the full catalog only for the authoring surfaces", () => {
    expect(pageCatalogKind("")).toBe("client");
    expect(pageCatalogKind("?play=local")).toBe("client");
    expect(pageCatalogKind("?play=host/world&local=memory")).toBe("client");
    for (const search of ["?mode=combat", "?mode=building&play=local", "?world-bake=1", "?world-map-capture=1", "?navmesh-bake=1"]) expect(pageCatalogKind(search)).toBe("full");
  });

  it("carries nothing a player must not read", () => {
    const client = clientCatalog(compiled), text = serializeClientCatalog(client);
    // Item and resource rows keep what their tooltips show (a weapon's speed, a node's respawn). Everything about creatures and the world is held to the list.
    for (const table of ["regions", "compiledCreatures", "species", "creatures", "enemies", "quests", "npcs", "shops"] as const) {
      const part = JSON.stringify(client.tables[table]);
      for (const key of FORBIDDEN_KEYS) expect(part.includes(`"${key}"`), `the client catalog's ${table} table spells "${key}"`).toBe(false);
    }
    expect(text.includes('"lootRolls"') || text.includes('"lootTables"')).toBe(false);
    // A quest's completion predicate is the answer to the puzzle it sets, and its rewards and hints
    // are the rest of the walkthrough. The journal is the name, the region, the giver and the prose.
    const quests = client.tables.quests as Record<string, unknown>[];
    expect(quests.length).toBe((compiled.tables.quests as unknown[]).length);
    expect(Object.keys(quests[0]!)).toEqual(["id", "name", "regionId", "giverNpcId", "requirements", "prerequisiteQuestIds", "stages"]);
    expect(Object.keys((quests[0]!.stages as Record<string, unknown>[])[0]!)).toEqual(["index", "objective", "refs"]);
    // `kind` is not here: an objective ref is `{ kind: "item", id }`, and the key lists above already fix both shapes.
    for (const key of ["completion", "hint", "grants", "onFlag", "onStart", "rewards", "summary"]) {
      expect(JSON.stringify(quests).includes(`"${key}"`), `the client catalog's quests spell "${key}"`).toBe(false);
    }
    for (const name of ["world", "lootTables", "encounters", "placements", "habitats"]) expect(client.tables).not.toHaveProperty(name);
    expect(client.tables.dialogue).toEqual([]);
    // Reported so a growing projection is noticed in review. The full catalog is about 4 MB.
    console.info(`client catalog: ${(text.length / 1e6).toFixed(2)} MB, ${(gzipSync(text).byteLength / 1e6).toFixed(2)} MB gzip`);
    expect(text.length).toBeLessThan(2_000_000);
  });

  it("evaluates every content module the page can load against a client-only catalog", async () => {
    vi.resetModules();
    const reads: { table: string; missing: boolean }[] = [];
    const client = clientCatalog(compiled);
    const tables = new Proxy(client.tables as Record<string, unknown>, { get(target, key, receiver) {
      if (typeof key === "string") reads.push({ table: key, missing: !(key in target) });
      return Reflect.get(target, key, receiver);
    } });
    // A fresh slot: the suite's setup installed the bundled catalog in this one.
    const slotKey = Symbol.for("corealm.catalog"), previous = (globalThis as Record<symbol, unknown>)[slotKey];
    (globalThis as Record<symbol, unknown>)[slotKey] = { taken: false, catalog: { version: 1, revision: client.revision, formulaRevision: "", tables } };
    const failures: string[] = [];
    try {
      const content = evaluationOrder(graph).filter(file => rel(file).startsWith("content/") && rel(file) !== "content/bundledCatalog.ts");
      expect(content.length).toBeGreaterThan(60);
      for (const file of content) {
        const before = reads.length;
        try { await import(/* @vite-ignore */ pathToFileURL(file).href); }
        catch (error) {
          failures.push(`${rel(file)} does not evaluate on the client catalog: ${String((error as Error).message).split("\n")[0]}\n    reached through ${chainTo(graph, file, src).join(" > ")}`);
        }
        for (const read of reads.slice(before)) if (read.missing && !TOLERATED_MISSING.has(read.table)) {
          failures.push(`${rel(file)} reads the table "${read.table}", which the client catalog does not carry\n    reached through ${chainTo(graph, file, src).join(" > ")}`);
        }
      }
    } finally {
      (globalThis as Record<symbol, unknown>)[slotKey] = previous;
      vi.resetModules();
    }
    expect(failures, failures.join("\n")).toEqual([]);
  }, 120_000);
});
