import type { InstalledCatalog } from "../content/catalogInstall.js";
import { reindexBossArmor } from "../content/bossArmor.js";
import { reindexCampfireFuels } from "../content/campfireData.js";
import { reindexCraftingTiers } from "../content/craftingTierData.js";
import { reindexCreatures } from "../content/creatureRuntime.js";
import { reindexDialogue } from "../content/dialogue.js";
import { reindexElementalSpells } from "../content/elementalSpells.js";
import { reindexFairyNpcs } from "../content/fairyNpcs.js";
import { reindexGatheringTiers } from "../content/gatheringProductionTiers.js";
import { content, reindexRecipeBalance } from "../content/index.js";
import { reindexNpcs } from "../content/npcs.js";
import { questsGivenBy, reindexQuests } from "../content/quests.js";
import { adoptCatalog, RESOLVED_TABLES } from "../content/resolvedCatalog.js";
import { reindexResources } from "../content/resourceData.js";
import { reindexRuntimeTables, runtimeTables } from "../content/runtimeCatalog.js";
import { reindexEquipmentSets } from "../content/setData.js";
import { reindexShops } from "../content/shops.js";
import { reindexSpells } from "../content/spells.js";
import { reindexWorldContent } from "../content/worldData.js";
import { reindexHabitats } from "../content/worldHabitats.js";
import type { SemanticEntity } from "../contracts.js";
import type { HeadlessWorld } from "./headlessWorld.js";

/**
 * The arrays `content/compiler/runtime.ts` took from the catalog at import (`COMPILED_PROGRESSION`).
 * `adoptCatalog` points the catalog at the new arrays; these three are refilled in place instead, so
 * the resource index, the gathering tiers and the crafting tiers re-derive from the new rows.
 */
const HELD_AT_IMPORT = ["resources", "progression", "materials"] as const;

/**
 * The modules that parsed or indexed a table at import, in dependency order. They are the page's
 * refreshers (`clientContentSwap.ts`) less the page-only ones (skins, audio), plus dialogue, which a
 * page never holds. Each re-reads the catalog the way it did at import; the publish compiled and
 * validated the same rows first.
 */
const REFRESHERS: readonly (() => void)[] = [
  reindexFairyNpcs, reindexNpcs, reindexDialogue, reindexQuests, reindexSpells, reindexShops,
  reindexEquipmentSets, reindexBossArmor, reindexElementalSpells,
  reindexCampfireFuels, reindexResources, reindexGatheringTiers, reindexCraftingTiers, reindexRecipeBalance,
];

const questIdsOf = (npcId: string): string[] => questsGivenBy(npcId).map(quest => quest.id);
const sameIds = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((id, index) => id === right[index]);

/**
 * Moves a running process onto a newly published catalog. What this reaches, table by table, is
 * declared by `CATALOG_TABLE_APPLIES` in `catalogHost.ts`, which loads no content so a publish can
 * read it before any world starts. A change here that reaches another table changes that map too.
 *
 * Assignments and map refills only. The caller has compiled and validated `next`, planned every
 * world's spawns and activated the revision in the database, so nothing here may throw. It runs
 * between ticks. Spawn plans are applied by the caller, world by world, right after.
 */
export function swapCatalog(next: InstalledCatalog, worlds: readonly HeadlessWorld[]): void {
  // An NPC entity's quest list is derived from the quest table when its region is built. The ones still equal to that derivation follow the new table.
  const givers = worlds.flatMap(world => world.entities.all())
    .filter((entity): entity is SemanticEntity & { npc: NonNullable<SemanticEntity["npc"]> } => entity.archetype === "npc" && entity.npc !== undefined)
    .filter(entity => sameIds(entity.npc.questIds, questIdsOf(entity.id)));

  const held = HELD_AT_IMPORT.map(name => [name, RESOLVED_TABLES[name]] as const);
  adoptCatalog(next);
  for (const [name, array] of held) {
    const rows = RESOLVED_TABLES[name];
    if (!Array.isArray(array) || !Array.isArray(rows) || array === rows) continue;
    array.splice(0, array.length, ...rows);
    RESOLVED_TABLES[name] = array;
  }

  reindexCreatures(); reindexWorldContent(); reindexHabitats();
  for (const step of REFRESHERS) step();
  reindexRuntimeTables();
  // One registry serves every world of the process. A lab world adds lab-only creatures, and a fixture may bring its own.
  // Registering again also re-indexes the resources and spells the runtime tables hold, which the refreshers refilled in place.
  const tables = runtimeTables(worlds.some(world => world.descriptor.fixture === "lab"));
  const enemies = new Map([...tables.enemies, ...worlds.flatMap(world => world.ports.enemies ?? [])].map(enemy => [enemy.id, enemy]));
  content.register({ items: tables.items, recipes: tables.recipes, shops: tables.shops, enemies: [...enemies.values()] });

  for (const entity of givers) entity.npc = { ...entity.npc, questIds: questIdsOf(entity.id) };
  for (const world of worlds) {
    world.invalidateDefinitions();
    // What `/worlds`, the join reply and every save from now on carry.
    world.descriptor.catalogRevision = next.revision;
  }
}
