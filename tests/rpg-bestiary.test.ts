import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RPG_BESTIARY, RPG_BESTIARY_BY_ID, RPG_BESTIARY_STAGED, rpgBestiaryLevel } from "../game/src/content/rpgBestiary.js";
import { enemyCombatLevel } from "../game/src/content/index.js";
import { ALL_ITEMS } from "../game/src/content/items.js";

describe("staged RPG bestiary contracts", () => {
  it("keeps unique production IDs and withdraws rejected unreleased families", () => {
    expect(RPG_BESTIARY.length).toBeGreaterThan(0);
    expect(RPG_BESTIARY_BY_ID.size).toBe(RPG_BESTIARY.length);
    for (const id of ['minotaur', 'gnoll_hunter', 'lizardman_scout', 'harpy', 'gargoyle', 'horned_demon', 'orc_warrior']) expect(RPG_BESTIARY_BY_ID.has(id)).toBe(false);
    expect(RPG_BESTIARY_STAGED.length).toBeGreaterThan(0);
    for(const row of RPG_BESTIARY_STAGED){expect(RPG_BESTIARY_BY_ID.has(row.id)).toBe(false);expect(rpgBestiaryLevel(row.id)).toBeUndefined();}
    for (const row of RPG_BESTIARY) {
      // Tier variants and named groups share their family's body (the skeleton elites, Fire on Lava),
      // so the row only has to name a creature model the game actually ships.
      expect(existsSync(`game/public/assets/models/creature/${row.assetId}.glb`), `${row.id}: ${row.assetId}`).toBe(true);
      expect(rpgBestiaryLevel(row.id)).toBe(enemyCombatLevel(row.stats));
      expect(row.stats.name).not.toMatch(/\bT\d/);
      expect(row.acceptance).toBe("candidate");
    }
  });
  it("retains Fire stats while sharing the accepted complete Lava source", () => {
    const fire=RPG_BESTIARY_BY_ID.get('fire_golem')!,lava=RPG_BESTIARY_BY_ID.get('lava_golem')!;
    expect(fire.assetId).toBe(lava.assetId);
    expect(fire.nativeSize).toEqual(lava.nativeSize);expect(fire.nativeBase).toEqual(lava.nativeBase);
    expect(fire.source).toEqual(lava.source);
    expect(fire.stats.id).toBe('fire_golem_t20');expect(fire.stats.tier).toBe(20);
  });
  it("drops existing usable inventory items and valid currency amounts", () => {
    const ids = new Set(ALL_ITEMS.map(item => item.id));
    for (const row of RPG_BESTIARY) {
      for (const drop of row.stats.lootRolls.flatMap(roll => roll.drops)) {
        expect(ids.has(drop.itemId), `${row.id}: ${drop.itemId}`).toBe(true);
        expect(drop.chance).toBeGreaterThan(0);
        expect(drop.chance).toBeLessThanOrEqual(1);
        expect(drop.quantity[1]).toBeGreaterThanOrEqual(drop.quantity[0]);
      }
      expect(row.stats.gold![0]).toBeGreaterThan(0);
      expect(row.stats.gold![1]).toBeGreaterThanOrEqual(row.stats.gold![0]);
      expect(row.respawnMs).toBe(30000);
      expect(row.attack.recoveryMs).toBeLessThan(row.stats.attackSpeedMs);
    }
  });
  it("binds ranged and magic roles to their production stat contracts", () => {
    expect(RPG_BESTIARY_BY_ID.get("goblin_archer")?.attack.proposedMechanic).toBe("projectile");
    expect(RPG_BESTIARY_BY_ID.get("goblin_archer")?.stats.attackStyle).toBe("ranged");
    expect(RPG_BESTIARY_BY_ID.get("goblin_archer")?.stats.attackRangeM).toBe(10);
    expect(RPG_BESTIARY_BY_ID.get("skeleton_mage")?.attack.proposedMechanic).toBe("spell");
    expect(RPG_BESTIARY_BY_ID.get("skeleton_mage")?.stats.attackStyle).toBe("magic");
    expect(RPG_BESTIARY_BY_ID.get("stone_golem")?.stats.behaviour).toBe("territorial");
    expect(rpgBestiaryLevel("missing")).toBeUndefined();
  });
});
