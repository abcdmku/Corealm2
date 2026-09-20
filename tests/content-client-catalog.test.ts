import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { compileCatalog } from "../game/src/content/compiler/catalog.js";
import { CLIENT_TABLES, clientCatalog, parseClientCatalog, serializeClientCatalog, type ClientCatalog } from "../game/src/content/clientCatalog.js";
import { overlayClientCatalog, type OverlayRegistry } from "../game/src/content/clientCatalogOverlay.js";
import type { ContentTables } from "../game/src/content/index.js";
import { formulaSourceRevision, readContentSources } from "../tools/content/compile.js";

const sources = Object.fromEntries(await readContentSources());
const fromDisk = compileCatalog(sources, { formulaRevision: formulaSourceRevision() });
if (!fromDisk.ok) throw new Error(JSON.stringify(fromDisk.problems));

describe("compile outputs", () => {
  it("gives the same revision and the same client bytes whether the formula revision was hashed from disk or baked into a catalog", () => {
    // A bundled server has no source tree: it compiles with the `formulaRevision` its catalog carries.
    const baked = compileCatalog(structuredClone(sources), { formulaRevision: fromDisk.catalog.formulaRevision });
    if (!baked.ok) throw new Error("compile failed");
    expect(baked.catalog.revision).toBe(fromDisk.catalog.revision);
    expect(serializeClientCatalog(baked.client)).toBe(serializeClientCatalog(fromDisk.client));
    expect(baked.client.revision).toBe(fromDisk.catalog.revision);
  });
  it("changes the revision when the formulas change, and refuses a formula revision that is not a digest", () => {
    const other = compileCatalog(sources, { formulaRevision: "0".repeat(64) });
    expect(other.ok && other.catalog.revision).not.toBe(fromDisk.catalog.revision);
    expect(other.ok && other.catalog.formulaRevision).toBe("0".repeat(64));
    expect(() => compileCatalog(sources, { formulaRevision: "HEAD" })).toThrow("sha256");
  });
  it("reports problems instead of catalogs when the sources do not compile", () => {
    const broken = compileCatalog({ ...sources, items: [{ id: "only_an_id" }] }, { formulaRevision: "0".repeat(64) });
    expect(broken.ok).toBe(false);
    expect(broken).not.toHaveProperty("catalog");
    expect(broken.problems[0]).toMatchObject({ path: "items", severity: "error" });
  });
});

describe("client catalog", () => {
  const client = fromDisk.client, text = serializeClientCatalog(client);
  it("holds presentation and player-visible tables and nothing the server keeps", () => {
    expect(Object.keys(client.tables)).toEqual([...CLIENT_TABLES, "regions", "creatures", "enemies"]);
    for (const secret of ["lootRolls", "lootTables", "habitats", "groupsByRegion", "creatureByGroup", "placements", "encounters", "sourceMap",
      "aggroRadius", "maxHit", "attackLevel", "maxHealth", "\"stats\"", "\"loot\"", "inheritedFields", "respawnMs"]) expect(text.includes(secret), secret).toBe(false);
    expect(client.tables).not.toHaveProperty("quests");
    expect(client.tables).not.toHaveProperty("dialogue");
    expect(Object.keys(client.tables.enemies.find(enemy => enemy.id === "redbrush_fox_t1")!)).toEqual(["id", "name", "family", "tier"]);
    expect(client.tables.enemies.find(enemy => enemy.id === "redbrush_fox_t1")).toEqual({ id: "redbrush_fox_t1", name: "Red Fox", family: "redbrush_fox", tier: 1 });
    expect(client.tables.creatures.find(creature => creature.id === "redbrush_fox")).toEqual({ id: "redbrush_fox", assetId: "creature_redbrush_fox", scale: 1,
      regionId: "fallowmarch", activity: "forage", description: "A narrow hedge hunter with a broad brush tail. Forages near cover and bites only when provoked.",
      name: "Red Fox", family: "redbrush_fox", tier: 1 });
    expect(client.tables.items).toBe(fromDisk.catalog.tables.items);
  });
  it("is a fraction of the server catalog", () => {
    const server = JSON.stringify(fromDisk.catalog);
    const sizes = { client: text.length, clientGzip: gzipSync(text, { level: 9 }).length, server: server.length, serverGzip: gzipSync(server, { level: 9 }).length };
    console.log(JSON.stringify({ event: "catalog-sizes", ...sizes }));
    expect(sizes.client).toBeLessThan(sizes.server / 4);
    expect(sizes.clientGzip).toBeLessThan(150_000);
  });
  it("parses what it serialised and refuses another revision, another version and a table without ids", () => {
    const revision = client.revision;
    expect(parseClientCatalog(JSON.parse(text), revision)).toEqual(client);
    expect(() => parseClientCatalog(JSON.parse(text), "f".repeat(64))).toThrow("Invalid client catalog");
    expect(() => parseClientCatalog({ ...client, version: 2 }, revision)).toThrow("Invalid client catalog");
    expect(() => parseClientCatalog({ ...client, tables: { ...client.tables, items: [{ name: "No id" }] } }, revision)).toThrow("table items");
    expect(() => parseClientCatalog({ ...client, tables: { ...client.tables, enemies: [{ id: "wolf", name: "Wolf" }] } }, revision)).toThrow("table enemies");
  });
});

describe("client catalog overlay", () => {
  const enemy = { id: "wolf", name: "Wolf", family: "wolf", tier: 3, maxHealth: 40, attackLevel: 5, defenceLevel: 4, accuracy: 6, armour: 2, magicArmour: 1, maxHit: 7,
    attackSpeedMs: 2400, aggroRadius: 9, behaviour: "aggressive" as const, lootRolls: [{ id: "items", name: "Items", count: 1, drops: [] }], gold: [1, 5] as [number, number] };
  const item = (id: string, name: string, value: number) => ({ id, name, value, tier: 1, description: "", stackable: false, category: "misc" }) as unknown as ContentTables["items"][number];
  function registry(tables: ContentTables): OverlayRegistry & { tables: ContentTables } {
    const held = { tables, register(next: Partial<ContentTables>) { held.tables = { ...held.tables, ...next }; },
      allItems: () => held.tables.items, allResources: () => held.tables.resources, allRecipes: () => held.tables.recipes,
      allSpells: () => held.tables.spells, allEnemies: () => held.tables.enemies, allShops: () => held.tables.shops };
    return held;
  }
  const catalog = (tables: Partial<ClientCatalog["tables"]>): ClientCatalog => ({ version: 1, revision: "a".repeat(64),
    tables: { items: [], recipes: [], resources: [], spells: [], shops: [], enemies: [], regions: [], creatures: [], ...tables } as ClientCatalog["tables"] });

  it("merges server presentation into full definitions, appends what only the server has, and undoes all of it", () => {
    const base: ContentTables = { items: [item("sword", "Sword", 10), item("local_only", "Local only", 1)], resources: [], recipes: [], spells: [], enemies: [enemy], shops: [] };
    const held = registry(base);
    const undo = overlayClientCatalog(held, catalog({
      items: [item("sword", "Server sword", 25), item("server_only", "Server only", 7)],
      enemies: [{ id: "wolf", name: "Dire wolf", family: "wolf", tier: 8 }, { id: "server_beast", name: "Server beast", family: "beast", tier: 12 }],
      spells: [{ id: "kindle", name: "Kindle", catalog: "SPELLS" }] as unknown[],
    }));
    expect(held.tables.items).toEqual([item("sword", "Server sword", 25), item("local_only", "Local only", 1), item("server_only", "Server only", 7)]);
    // The projected enemy carries no combat block: the full definition keeps its own.
    expect(held.tables.enemies[0]).toEqual({ ...enemy, name: "Dire wolf", tier: 8 });
    expect(held.tables.enemies[1]).toEqual({ id: "server_beast", name: "Server beast", family: "beast", tier: 12, maxHealth: 1, attackLevel: 1, defenceLevel: 1,
      accuracy: 0, armour: 0, magicArmour: 0, maxHit: 0, attackSpeedMs: 2400, aggroRadius: 0, behaviour: "passive", lootRolls: [] });
    expect(held.tables.spells).toEqual([{ id: "kindle", name: "Kindle" }]);
    expect(base.items[0]).toEqual(item("sword", "Sword", 10));
    undo();
    expect(held.tables).toEqual(base);
    expect(held.tables.enemies).toBe(base.enemies);
  });
});
