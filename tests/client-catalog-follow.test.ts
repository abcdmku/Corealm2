import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { clientCatalog, type ClientCatalog } from "../game/src/content/clientCatalog.js";
import type { ContentTables } from "../game/src/content/index.js";
import type { OverlayRegistry } from "../game/src/content/clientCatalogOverlay.js";
import type { SessionCatalog } from "../game/src/contracts.js";
import { repoRoot } from "../tools/lib/paths.js";

/**
 * A game page that joins a server shows that server's content, all of it that is not world geometry,
 * and shows the build's again when it leaves. The page runs on the CLIENT projection, so this file
 * evaluates the page's content modules on one, in a fresh module graph, the way the entry installs it.
 */
type Row = Record<string, unknown>;
const compiled = JSON.parse(readFileSync(path.join(repoRoot, "game/content/compiled/catalog.json"), "utf8")) as { revision: string; tables: Record<string, unknown> };
const BUILD = "a".repeat(64), SERVER = "b".repeat(64), OTHER = "c".repeat(64);
const pristine = { ...clientCatalog(compiled), revision: BUILD };

/** What an admin publishes: a renamed person, quest, spell, set and item, a new skin worn by a creature variant only the server has, a new sound, and a terrain edit. */
function published(revision: string, suffix: string): ClientCatalog {
  const next = structuredClone(pristine);
  next.revision = revision;
  const t = next.tables as unknown as Record<"npcs" | "quests" | "spells" | "elementalSpells" | "equipmentSets" | "items" | "creatureSkins" | "compiledCreatures" | "worldTerrain", Row[]>
    & { audio: { cues: Record<string, { variants: unknown[] }> } };
  t.npcs[0]!.name = `Luma ${suffix}`;
  t.quests[0]!.name = `Cold iron ${suffix}`;
  (t.quests[0]!.stages as Row[])[0]!.objective = `Server objective ${suffix}`;
  t.spells.find(spell => spell.id === "voltrend")!.name = `Voltrend ${suffix}`;
  t.elementalSpells[0]!.name = `Breeze ${suffix}`;
  t.equipmentSets[0]!.name = `Dewglass ${suffix}`;
  t.items[0]!.name = `Item ${suffix}`;
  t.creatureSkins.push({ id: "deer_frost", assetId: "animal_deer", name: `Frost ${suffix}`, kind: "upload", maps: { Deer: "skins/animal_deer/deer_frost/Deer.png" }, createdAt: "2026-09-27" });
  const deer = t.compiledCreatures.find(row => row.id === "deer_t5")!;
  t.compiledCreatures.push({ ...structuredClone(deer), id: "deer_t5_frost", presentation: { ...(deer.presentation as Row), skinId: "deer_frost", variation: { scale: [0.9, 1.1] } } });
  t.audio.cues["ui.click"]!.variants = [`audio/sfx/server-${suffix.toLowerCase()}.ogg`];
  t.worldTerrain[0] = { ...t.worldTerrain[0]!, id: `terrain-${suffix}` };
  return next;
}

function registry(tables: ContentTables): OverlayRegistry & { tables: ContentTables } {
  const held = { tables, register(next: Partial<ContentTables>) { held.tables = { ...held.tables, ...next }; },
    allItems: () => held.tables.items, allResources: () => held.tables.resources, allRecipes: () => held.tables.recipes,
    allSpells: () => held.tables.spells, allEnemies: () => held.tables.enemies, allShops: () => held.tables.shops };
  return held;
}

type Page = Awaited<ReturnType<typeof loadPage>>;
async function loadPage() {
  const [swap, fetch, resolved, npcs, quests, spells, elemental, sets, skins, creatures, audio, world, runtime] = await Promise.all([
    import("../game/src/multiplayer/clientContentSwap.js"), import("../game/src/multiplayer/clientCatalogFetch.js"),
    import("../game/src/content/resolvedCatalog.js"), import("../game/src/content/npcs.js"), import("../game/src/content/quests.js"),
    import("../game/src/content/spells.js"), import("../game/src/content/elementalSpells.js"), import("../game/src/content/equipmentSets.js"),
    import("../game/src/content/creatureSkins.js"), import("../game/src/content/creatureRuntime.js"), import("../game/src/audio/corealmCatalog.js"),
    import("../game/src/content/worldData.js"), import("../game/src/content/runtimeCatalog.js"),
  ]);
  const held = registry(runtime.runtimeTables());
  /** What a player can read off the page, in one value, so before and after compare whole. */
  const shown = () => ({
    revision: resolved.RESOLVED_CATALOG.revision,
    npc: npcs.npcName("npc_fey_lantern_keeper"), npcRow: npcs.NPCS[0]!.name,
    quest: quests.quest("cold_iron")!.name, objective: quests.stageOf("cold_iron", quests.QUESTS[0]!.stages[0]!.index)!.objective, journal: quests.QUESTS[0]!.name,
    spell: spells.SPELLS_BY_RUNG.lash.find(spell => spell.id === "voltrend")?.name, allSpells: spells.ALL_SPELLS.find(spell => spell.id === "voltrend")?.name,
    elemental: elemental.elementalSpell("breeze-puff").name, set: sets.EQUIPMENT_SETS[0]!.name,
    skin: skins.creatureSkinById("deer_frost")?.name ?? null,
    variant: (creatures.CREATURE_CATALOG.byCreatureId.get("deer_t5_frost")?.presentation as Row | undefined)?.skinId ?? null,
    creatures: creatures.CREATURE_CATALOG.creatures.length,
    click: audio.COREALM_AUDIO_CATALOG.cues["ui.click"].variants[0],
    terrain: world.WORLD_TERRAIN[0]!.id,
    item: held.tables.items[0]!.name, registryItems: held.tables.items.length,
  });
  return { swap, fetch, resolved, held, shown };
}

let page: Page;
const slotKey = Symbol.for("corealm.catalog");
let previousSlot: unknown;
beforeAll(async () => {
  vi.resetModules();
  previousSlot = (globalThis as Record<symbol, unknown>)[slotKey];
  // The entry's install: the build's client projection, and nothing else.
  (globalThis as Record<symbol, unknown>)[slotKey] = { taken: false, catalog: { version: 1, revision: BUILD, formulaRevision: "", tables: structuredClone(pristine.tables) } };
  page = await loadPage();
}, 120_000);
afterAll(() => { (globalThis as Record<symbol, unknown>)[slotKey] = previousSlot; vi.resetModules(); });

const BUILD_SHOWN = {
  revision: BUILD, npc: "Luma", npcRow: "Luma", quest: (pristine.tables.quests[0] as Row).name, objective: ((pristine.tables.quests[0] as Row).stages as Row[])[0]!.objective,
  journal: (pristine.tables.quests[0] as Row).name, spell: (pristine.tables.spells as Row[]).find(row => row.id === "voltrend")!.name,
  allSpells: (pristine.tables.spells as Row[]).find(row => row.id === "voltrend")!.name, elemental: (pristine.tables.elementalSpells as Row[])[0]!.name,
  set: (pristine.tables.equipmentSets as Row[])[0]!.name, skin: null, variant: null, creatures: pristine.tables.compiledCreatures.length,
  click: (pristine.tables.audio as { cues: Record<string, { variants: unknown[] }> }).cues["ui.click"]!.variants[0], terrain: (pristine.tables.worldTerrain as Row[])[0]!.id,
  item: (pristine.tables.items as Row[])[0]!.name, registryItems: (pristine.tables.items as Row[]).length,
};
const serverShown = (revision: string, suffix: string) => ({ ...BUILD_SHOWN, revision, npc: `Luma ${suffix}`, npcRow: `Luma ${suffix}`, quest: `Cold iron ${suffix}`,
  objective: `Server objective ${suffix}`, journal: `Cold iron ${suffix}`, spell: `Voltrend ${suffix}`, allSpells: `Voltrend ${suffix}`, elemental: `Breeze ${suffix}`,
  set: `Dewglass ${suffix}`, skin: `Frost ${suffix}`, variant: "deer_frost", creatures: pristine.tables.compiledCreatures.length + 1,
  click: `audio/sfx/server-${suffix.toLowerCase()}.ogg`, item: `Item ${suffix}` });

describe("a page following a server's client catalog", () => {
  it("names what every table of the client catalog does on a page", () => {
    expect(Object.keys(page.swap.CLIENT_TABLE_FOLLOWS).sort()).toEqual(Object.keys(pristine.tables).sort());
    expect(Object.entries(page.swap.CLIENT_TABLE_FOLLOWS).filter(([, follows]) => follows === "rebake").map(([name]) => name).sort()).toEqual(["regions", "worldResources", "worldTerrain"]);
  });

  it("shows every followed table from the server, reports the geometry it cannot, and restores the build exactly on leave", () => {
    expect(page.shown()).toEqual(BUILD_SHOWN);
    const server = published(SERVER, "S");
    expect(page.swap.unfollowedChanges(server)).toEqual(["worldTerrain"]);
    const undo = page.swap.followClientCatalog(page.held, server);
    expect(page.shown()).toEqual(serverShown(SERVER, "S"));
    undo();
    expect(page.shown()).toEqual(BUILD_SHOWN);
    // The installed tables are the build's rows again, down to the last field, in the same array objects.
    expect(page.resolved.RESOLVED_TABLES).toEqual(pristine.tables);
  });

  it("follows each publish without passing through the build's rows, ignores a repeat, and leaves onto the build", async () => {
    const catalogs = new Map([[SERVER, published(SERVER, "S")], [OTHER, published(OTHER, "T")]]);
    const loads: string[] = [];
    const source = (revision: string): SessionCatalog => ({ revision, load: async () => { loads.push(revision); return catalogs.get(revision)!; } });
    const seen: unknown[] = [];
    const overlay = page.fetch.createServerCatalogOverlay(catalog => { seen.push(page.shown().npc); return page.swap.followClientCatalog(page.held, catalog); });
    await overlay.enter(source(SERVER));
    const first = page.shown();
    expect(first).toEqual(serverShown(SERVER, "S"));
    await overlay.enter(source(SERVER));
    expect(loads).toEqual([SERVER]);
    await overlay.enter(source(OTHER));
    expect(page.shown()).toEqual(serverShown(OTHER, "T"));
    await overlay.enter(source(SERVER));
    expect(page.shown()).toEqual(first);
    // Each apply started from the build's rows, because the previous one was undone first, and only once the new catalog had loaded.
    expect(seen).toEqual(["Luma", "Luma", "Luma"]);
    overlay.leave();
    expect([overlay.revision, page.shown()]).toEqual([null, BUILD_SHOWN]);
    expect(page.resolved.RESOLVED_TABLES).toEqual(pristine.tables);
  });

  it("refuses a catalog a module cannot parse and keeps the page on the build's content", () => {
    const broken = published(SERVER, "S");
    (broken.tables.npcs as Row[])[1] = { id: "npc_without_a_name" };
    expect(() => page.swap.followClientCatalog(page.held, broken)).toThrow(/npcs/);
    expect(page.shown()).toEqual(BUILD_SHOWN);
    expect(page.resolved.RESOLVED_TABLES).toEqual(pristine.tables);
  });
});

describe("laying tables", () => {
  it("refills arrays and objects in place, replaces the rest, and undoes to the same objects", async () => {
    const { layTables } = await import("../game/src/multiplayer/clientContentSwap.js");
    const rows = [{ id: "a" }], settings = { x: 1, y: 2 };
    const target: Record<string, unknown> = { rows, settings, flag: true };
    const undo = layTables(target, { rows: [{ id: "b" }, { id: "c" }], settings: { x: 3 }, flag: false, fresh: [1], skipped: [2] }, ["rows", "settings", "flag", "fresh", "missing"]);
    expect(target).toEqual({ rows: [{ id: "b" }, { id: "c" }], settings: { x: 3 }, flag: false, fresh: [1] });
    expect([target.rows === rows, target.settings === settings]).toEqual([true, true]);
    undo();
    expect(target).toEqual({ rows: [{ id: "a" }], settings: { x: 1, y: 2 }, flag: true });
    expect([target.rows === rows, target.settings === settings]).toEqual([true, true]);
  });
});
