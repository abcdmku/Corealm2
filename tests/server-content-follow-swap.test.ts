import "../game/src/content/bundledCatalog.js";
import { describe, expect, it } from "vitest";
import type { InstalledCatalog } from "../game/src/content/catalogInstall.js";
import { campfireFuelByLog } from "../game/src/content/campfireData.js";
import { dialogueNode } from "../game/src/content/dialogue.js";
import { getEquipmentSetBonuses } from "../game/src/content/equipmentSets.js";
import { gatheringProductionTier } from "../game/src/content/gatheringProductionTiers.js";
import { content, gatherXp } from "../game/src/content/index.js";
import { npcName } from "../game/src/content/npcs.js";
import { quest, questRules } from "../game/src/content/quests.js";
import { RESOLVED_CATALOG, RESOLVED_TABLES } from "../game/src/content/resolvedCatalog.js";
import { runtimeTables } from "../game/src/content/runtimeCatalog.js";
import { SPELL_RUNES } from "../game/src/content/spells.js";
import type { SemanticEntity } from "../game/src/contracts.js";
import { swapCatalog } from "../game/src/multiplayer/contentSwap.js";
import type { HeadlessWorld } from "../game/src/multiplayer/headlessWorld.js";

/**
 * A publish reaches the running server's own rules, not only the players' pages: the next line an NPC
 * speaks, the next quest event, cast, set bonus, gather and campfire read the published rows.
 */
type Row = Record<string, unknown>;
const NEXT = "f".repeat(64);

function published(): InstalledCatalog {
  const next = structuredClone({ ...RESOLVED_CATALOG, tables: RESOLVED_TABLES }) as unknown as InstalledCatalog;
  next.revision = NEXT;
  const t = next.tables as unknown as Record<"npcs" | "dialogue" | "quests" | "spells" | "spellRunes" | "equipmentSets" | "campfireFuels" | "progression", Row[]>
    & { "balance/recipes": { gatherXp: { multiplier: number } } };
  t.npcs.find(row => row.id === "npc_smith_harrow")!.name = "Harrow the Published";
  t.dialogue.find(row => row.id === "fey_seed_keeper_root")!.text = "Published line.";
  const coldIron = t.quests.find(row => row.id === "cold_iron")!;
  coldIron.name = "Colder Iron";
  coldIron.giverNpcId = "npc_pitmaster_dorn";
  t.spells.find(row => row.id === "voltrend")!.baseMax = 30;
  t.spellRunes.find(row => row.itemId === "mind_rune")!.name = "Published Rune";
  ((t.equipmentSets.find(row => row.id === "dewglass")!.thresholds as Row[])[0]!.bonuses as Row).defence = 70;
  t.campfireFuels.find(row => row.logItemId === "palewood_log")!.buildTimeMs = 1234;
  (t.progression.find(row => row.tier === 1)!.presentation as Row).metalName = "Published Copper";
  t["balance/recipes"].gatherXp.multiplier *= 2;
  return next;
}

function npcEntity(id: string, questIds: string[]): SemanticEntity {
  return { id, archetype: "npc", name: id, tier: 1, regionId: "fallowmarch", position: { x: 0, y: 0, z: 0 }, state: "idle", interactions: ["talk"],
    npc: { dialogueRootId: `${id}_root`, questIds } } as unknown as SemanticEntity;
}

describe("a publish on a running server", () => {
  it("moves people, dialogue, quests, spells, sets, fuels, tiers and recipe balance onto the new rows", () => {
    content.register(runtimeTables());
    const harrow = npcEntity("npc_smith_harrow", ["cold_iron"]);
    const dorn = npcEntity("npc_pitmaster_dorn", ["dorns_tally"]);
    const authored = npcEntity("npc_carter_bel", ["an_authored_quest"]);
    let invalidated = 0;
    const world = { entities: { all: () => [harrow, dorn, authored] }, descriptor: { worldId: "w", catalogRevision: RESOLVED_CATALOG.revision },
      ports: {}, invalidateDefinitions: () => { invalidated++; } } as unknown as HeadlessWorld;
    const dewglass = { head: { itemId: "dewglass_helm", quantity: 1 }, body: { itemId: "dewglass_plate", quantity: 1 } };
    const read = () => ({
      npc: npcName("npc_smith_harrow"),
      line: dialogueNode("fey_seed_keeper_root")?.text,
      quest: quest("cold_iron")?.name,
      giver: questRules("cold_iron")?.giverNpcId,
      spell: content.spell("voltrend")?.baseMax,
      rune: SPELL_RUNES.find(rune => rune.itemId === "mind_rune")?.name,
      setDefence: getEquipmentSetBonuses(dewglass as never).defence,
      fuel: campfireFuelByLog("palewood_log").buildTimeMs,
      tierFuel: gatheringProductionTier(1)?.campfire.buildTimeMs,
      metal: gatheringProductionTier(1)?.metalName,
      gatherXp: gatherXp(1),
      questIds: [harrow.npc!.questIds, dorn.npc!.questIds, authored.npc!.questIds],
      revision: world.descriptor.catalogRevision,
    });
    const before = read();
    expect(before).toMatchObject({ npc: "Harrow the Smith", quest: "Cold Iron", giver: "npc_smith_harrow", spell: 3, rune: "Mind Rune", setDefence: 7, fuel: 3000, tierFuel: 3000, metal: "Copper",
      questIds: [["cold_iron"], ["dorns_tally"], ["an_authored_quest"]] });

    swapCatalog(published(), [world]);

    expect(read()).toEqual({
      npc: "Harrow the Published", line: "Published line.", quest: "Colder Iron", giver: "npc_pitmaster_dorn", spell: 30, rune: "Published Rune",
      setDefence: 70, fuel: 1234, tierFuel: 1234, metal: "Published Copper", gatherXp: before.gatherXp * 2,
      // Derived lists follow the table; a list that was not the derivation is left alone.
      questIds: [[], ["cold_iron", "dorns_tally"], ["an_authored_quest"]],
      revision: NEXT,
    });
    expect(invalidated).toBe(1);
  });
});
