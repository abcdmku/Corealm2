/**
 * Phase 2 amendment: the Kilnhalt tier-20 expansion.
 *
 * Freezes the amendment's literal claims: the 700 m wide world with an OPEN southern Kilnhalt
 * border, the complete Emberfast station set, the tier-20 formula values, the fire release, the
 * rare miniboss weapon derivation rule, miniboss placement semantics, the 25-40 s on-tier combat
 * band, and the fire-orb altar migration.
 */
import { describe, expect, it } from "vitest";
import type { EquipmentBonuses, ItemDef } from "../game/src/contracts.js";
import { EQUIPMENT, KITS, MAGIC_ORBS, RARE_MINIBOSS_WEAPONS } from "../game/src/content/equipment.js";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { ENEMY_BLOCKS } from "../game/src/content/enemies.js";
import { REGIONAL_BOSS_BODIES } from "../game/src/content/regionalBossBodies.js";
import {
  gatherXp, healAmount, respawnSeconds, toolBonus, yieldRange,
} from "../game/src/content/index.js";
import { CAMPFIRE_FUELS, GATHERING_PRODUCTION_TIERS } from "../game/src/content/gatheringProductionTiers.js";
import { REGIONS, REGIONAL_ESSENCE_ALTARS, WORLD_BOUNDS, getRegion } from "../game/src/content/regions.js";
import { SHOPS } from "../game/src/content/shops.js";
import {
  ESSENCE_BY_ELEMENT, ORB_BY_ELEMENT, RELEASED_MAGIC_ELEMENTS,
} from "../game/src/systems/essence.js";
import { migrate } from "../game/src/persistence/migrate.js";
import { SAVE_VERSION, Store } from "../game/src/state/store.js";
import { buildWorld } from "../game/src/world/regionBuilder.js";
import { tierSilhouetteScale } from "../game/src/core/math.js";

const ITEM_BY_ID = new Map<string, ItemDef>(ALL_ITEMS.map((item) => [item.id, item]));

function item(id: string): ItemDef {
  const found = ITEM_BY_ID.get(id);
  if (!found) throw new Error(`Missing item ${id}`);
  return found;
}

function kitTotals(kit: readonly string[]): EquipmentBonuses {
  const totals: EquipmentBonuses = {
    accuracy: 0, power: 0, armour: 0, magicAccuracy: 0, magicPower: 0, magicArmour: 0, vitality: 0,
  };
  for (const id of kit) {
    const bonuses = item(id).equip?.bonuses;
    if (!bonuses) throw new Error(`${id} is not equipment`);
    for (const key of Object.keys(totals) as (keyof EquipmentBonuses)[]) {
      totals[key] += bonuses[key];
    }
  }
  return totals;
}

describe("world extension", () => {
  it("keeps Kilnhalt across the full width beneath the northern wilderness", () => {
    // The Deep Wilderness expansion doubled the northern band to z940 (`WILDERNESS_DEPTH.north`).
    // Kilnhalt's own bounds are unchanged: it still sits beneath the wilderness, full width.
    expect(WORLD_BOUNDS).toEqual({ min: [-350, -200], max: [350, 940] });
    const kilnhalt = getRegion("kilnhalt")!;
    expect(kilnhalt.tier).toBe(20);
    expect(kilnhalt.bounds).toEqual({ min: [-350, 200], max: [350, 460] });
  });

  it("keeps the entire southern border open: no gates, only route links", () => {
    const kilnhalt = getRegion("kilnhalt")!;
    expect(kilnhalt.gates).toEqual([]);
    // Multiple semantic route connections across the old northern edge, both directions.
    expect(kilnhalt.adjacency.map((link) => link.toRegionId).sort())
      .toEqual(["fallowmarch", "vellenwood", "vellenwood", "wilderness"]);
    const inbound = REGIONS.flatMap((region) => region.adjacency)
      .filter((link) => link.toRegionId === "kilnhalt");
    expect(inbound).toHaveLength(4);
  });

  it("tiles the four surface regions without gaps along the z = 200 seam", () => {
    const fallowmarch = getRegion("fallowmarch")!;
    const vellenwood = getRegion("vellenwood")!;
    const kilnhalt = getRegion("kilnhalt")!;
    expect(fallowmarch.bounds.max[1]).toBe(200);
    expect(vellenwood.bounds.max[1]).toBe(200);
    expect(kilnhalt.bounds.min[1]).toBe(200);
    // The seam spans the full width on the Kilnhalt side.
    expect(kilnhalt.bounds.min[0]).toBe(-350);
    expect(kilnhalt.bounds.max[0]).toBe(350);
  });
});

describe("Emberfast", () => {
  it("ships the complete production station set inside one settlement", () => {
    const settlement = getRegion("kilnhalt")!.settlement!;
    expect(settlement.id).toBe("emberfast");
    const kinds = settlement.stations.map((station) => station.kind).sort();
    expect(kinds).toEqual(["anvil", "crafting_table", "fletching_bench", "furnace", "range"]);
    expect(settlement.bank.id).toBe("emberfast_bank_counter");
    expect(settlement.shops.map((shop) => shop.shopKind).sort()).toEqual(["general", "smith"]);
  });

  it("stocks Fire Essence locally like the other elements at their region stores", () => {
    const general = SHOPS.find((shop) => shop.id === "emberfast_general")!;
    expect(general.stock.some((row) => row.itemId === "fire_essence")).toBe(true);
    const smith = SHOPS.find((shop) => shop.id === "emberfast_smith")!;
    expect(smith.stock.some((row) => row.itemId === "emberite_bar")).toBe(true);
  });
});

describe("tier-20 formulas", () => {
  it("derives the amendment's literal numbers from the frozen formulas", () => {
    expect(gatherXp(20)).toBe(52);
    expect(yieldRange(20)).toEqual([7, 14]);
    expect(respawnSeconds(20)).toBe(65);
    expect(healAmount(20)).toBe(19);
    expect(toolBonus(20)).toBe(17);
  });

  it("burns a Cinderpine campfire for 300 seconds at 10 XP per skill", () => {
    const fuel = CAMPFIRE_FUELS.find((row) => row.logItemId === "cinderpine_log")!;
    expect(fuel.tier).toBe(20);
    expect(fuel.lifetimeMs).toBe(300_000);
    expect(fuel.buildXp).toEqual({ fletching: 10, crafting: 10 });
  });

  it("smelts an Emberite bar from 3 ore and 2 Kilnstone", () => {
    const tier = GATHERING_PRODUCTION_TIERS.find((row) => row.tier === 20)!;
    expect(tier.items.flux).toBe("kilnstone");
    expect(tier.smelting).toEqual({ orePerBar: 3, fluxPerBar: 2 });
  });
});

describe("fire release", () => {
  it("releases fire alongside the other three elements", () => {
    expect(RELEASED_MAGIC_ELEMENTS).toEqual(["wind", "earth", "water", "fire"]);
    expect(ESSENCE_BY_ELEMENT.fire).toBe("fire_essence");
    expect(ORB_BY_ELEMENT.fire).toBe("fire_orb");
    expect(MAGIC_ORBS.find((orb) => orb.id === "fire_orb")?.orb)
      .toEqual({ element: "fire", released: true });
  });

  it("issues charged fire weapons from the Cinderpine bases at the standard charge spec", () => {
    for (const id of ["fire_wand", "fire_staff"] as const) {
      const charge = item(id).magicWeapon?.charge;
      expect(charge, id).toMatchObject({
        element: "fire", capacity: 1000, initialCharges: 1000,
        rechargeItemId: "fire_essence", rechargeCost: 100, orbItemId: "fire_orb", released: true,
      });
    }
  });

  it("authors the Kilnhalt fire altar at the Fire Essence Cache", () => {
    const altar = REGIONAL_ESSENCE_ALTARS.kilnhalt;
    expect(altar.id).toBe("kilnhalt_fire_altar");
    expect(altar.essenceElement).toBe("fire");
    expect([...altar.recipeIds].sort()).toEqual(["craft_fire_staff", "craft_fire_wand"]);
    const region = getRegion("kilnhalt")!;
    const cache = region.clusters.find((cluster) => cluster.essenceElement === "fire")!;
    expect(cache.count).toBe(5);
    expect(cache.centre).toEqual(altar.position);
  });

  it("awakens the Kilnhalt altar during migration when a save already consumed the Fire Orb", () => {
    const raw = JSON.parse(JSON.stringify(new Store(7, 0).get())) as Record<string, unknown>;
    (raw as { meta: { saveVersion: number } }).meta.saveVersion = SAVE_VERSION;
    (raw as { magic: { consumedOrbs: Record<string, boolean> } }).magic.consumedOrbs = { fire_orb: true };
    const outcome = migrate(raw);
    expect(outcome.ok).toBe(true);
    expect(outcome.state?.magic.awakenedAltars["kilnhalt_fire_altar"]).toBe(true);
  });
});

describe("rare miniboss weapons", () => {
  const RULE: readonly [rareId: string, baseId: string, boosted: readonly (keyof EquipmentBonuses)[]][] = [
    ["galeskin_sword", "grithe_sword", ["accuracy", "power"]],
    ["galeskin_staff", "palewood_staff", ["magicAccuracy", "magicPower"]],
    ["mossbound_sword", "corven_sword", ["accuracy", "power"]],
    ["mossbound_staff", "duskoak_staff", ["magicAccuracy", "magicPower"]],
    ["tideworn_sword", "kaldite_sword", ["accuracy", "power"]],
    ["tideworn_staff", "cairnpine_staff", ["magicAccuracy", "magicPower"]],
    ["cinderwake_sword", "emberite_sword", ["accuracy", "power"]],
    ["cinderwake_staff", "cinderpine_staff", ["magicAccuracy", "magicPower"]],
  ];

  it("copies the local craftable weapon and applies ceil(base x 1.10) to its offensive stats", () => {
    expect(RARE_MINIBOSS_WEAPONS).toHaveLength(8);
    for (const [rareId, baseId, boosted] of RULE) {
      const rare = item(rareId);
      const base = item(baseId);
      const rareBonuses = rare.equip!.bonuses;
      const baseBonuses = base.equip!.bonuses;
      for (const key of Object.keys(rareBonuses) as (keyof EquipmentBonuses)[]) {
        const expected = boosted.includes(key)
          ? Math.ceil(baseBonuses[key] * 1.10)
          : baseBonuses[key];
        expect(rareBonuses[key], `${rareId}.${key}`).toBe(expected);
      }
      // Drops match the host region's requirement tier: the rare copies the base's requirements.
      expect(rare.equip!.requires, rareId).toEqual(base.equip!.requires);
      expect(rare.tier, rareId).toBe(base.tier);
    }
  });

  it("keeps the rare staves uncharged so they never bypass altar progression", () => {
    for (const [rareId] of RULE) {
      const rare = item(rareId);
      if (rare.magicWeapon) {
        expect(rare.magicWeapon.charge, rareId).toBeUndefined();
        expect(rare.magicWeapon.kind, rareId).toBe("staff");
      }
    }
  });

  it("rolls each named weapon at exactly 10% on its miniboss, independently authored", () => {
    for (const [family, sword, staff] of [
      ["galeskin", "galeskin_sword", "galeskin_staff"],
      ["mossbound", "mossbound_sword", "mossbound_staff"],
      ["tideworn", "tideworn_sword", "tideworn_staff"],
      ["cinderwake", "cinderwake_sword", "cinderwake_staff"],
    ] as const) {
      const block = ENEMY_BLOCKS.find((row) => row.family === family)!;
      const swordRow = block.drops.find((drop) => drop.itemId === sword)!;
      const staffRow = block.drops.find((drop) => drop.itemId === staff)!;
      expect(swordRow.chance, family).toBe(0.10);
      expect(staffRow.chance, family).toBe(0.10);
    }
  });

  it("guarantees Cinderwake's singleton Fire Orb", () => {
    const block = ENEMY_BLOCKS.find((row) => row.family === "cinderwake")!;
    expect(block.drops.find((drop) => drop.itemId === "fire_orb")?.chance).toBe(1.0);
  });
});

describe("miniboss placements", () => {
  /** The registered group an authored boss is built from, wherever it is placed. */
  function bossGroup(id: string) {
    const group = REGIONS
      .flatMap((region) => [...region.enemyGroups, ...region.dungeon?.enemyGroups ?? []])
      .find((row) => row.id === id);
    if (!group) throw new Error(`Missing registered boss group ${id}`);
    return group;
  }

  it("places the four minibosses at their authored spots with the miniboss rank and 1.3x scale", () => {
    const world = buildWorld(1337, () => 0);
    const expectations = [
      ["galeskin", "fallowmarch", 1, [-300, 145]],
      ["mossbound", "vellenwood", 5, [318, 72]],
      ["tideworn", "karrowmoor", 10, [18, -164]],
      ["cinderwake", "kilnhalt", 20, [286, 420]],
    ] as const;
    for (const [id, regionId, tier, [x, z]] of expectations) {
      const entity = world.entities.find((candidate) => candidate.id === id);
      expect(entity, id).toBeDefined();
      expect(entity).toMatchObject({
        archetype: "boss",
        regionId,
        tier,
        meta: expect.objectContaining({ rank: "miniboss", family: id }),
      });
      expect(entity!.position[0], `${id} x`).toBe(x);
      expect(entity!.position[2], `${id} z`).toBe(z);
      // The expansion replaced the borrowed ordinary bodies with a dedicated hero asset per boss.
      expect(entity!.view?.assetId, id).toBe(REGIONAL_BOSS_BODIES[id].assetId);
      // 1.3x authored group scale, against a major boss's 1.6x: `world/regionBuilder.ts` still
      // applies the rank multiplier, so a miniboss that silently got the boss rule fails here.
      expect(entity!.view?.scale, id).toBeCloseTo(bossGroup(id).scale * 1.3, 10);
      // The dedicated body is modelled at final world size, so `content/fantasyEncounters.ts`
      // divides the rank multiplier and the tier silhouette back out: it draws at scale 1.0.
      expect(entity!.view!.scale! * tierSilhouetteScale(tier), id)
        .toBeCloseTo(REGIONAL_BOSS_BODIES[id].scale, 10);
    }
  });

  it("preserves the three Orb bosses and their major rank with accepted fantasy bodies", () => {
    const world = buildWorld(1337, () => 0);
    for (const id of ["tempest_roc", "rootheart", "ordrun"] as const) {
      const entity = world.entities.find((candidate) => candidate.id === id)!;
      expect(entity.archetype, id).toBe("boss");
      expect(entity.meta?.rank, id).toBe("boss");
      expect(entity.view?.assetId, id).toBe(REGIONAL_BOSS_BODIES[id].assetId);
      expect(entity.view?.scale, id).toBeCloseTo(bossGroup(id).scale * 1.6, 10);
      expect(entity.view!.scale! * tierSilhouetteScale(entity.tier!), id)
        .toBeCloseTo(REGIONAL_BOSS_BODIES[id].scale, 10);
    }
  });
});

describe("tier-20 combat bands", () => {
  // The amendment's 25-40 s on-tier band, computed with the PRD 2.4 formulas against the
  // authored tier-20 kits. A change to either side of the balance moves these numbers.
  const meleeKit = () => kitTotals(KITS["melee_t20"]!);
  const magicKit = () => kitTotals(KITS["magic_t20"]!);

  function meleeTtk(block: { maxHealth: number; defenceLevel: number; armour: number }): number {
    const kit = meleeKit();
    const attackRoll = (20 + 9) * (1 + kit.accuracy / 100);
    const defenceRoll = (block.defenceLevel + 9) * (1 + block.armour / 100);
    const hitChance = Math.min(0.95, Math.max(0.05, attackRoll / (attackRoll + defenceRoll)));
    const maxHit = Math.floor(2 + (20 + kit.power) / 4.2);
    const dps = (hitChance * (1 + maxHit)) / 2 / 2.4;
    return block.maxHealth / dps;
  }

  function magicTtk(block: { maxHealth: number; defenceLevel: number; magicArmour: number }): number {
    const kit = magicKit();
    // Emberlash: baseMax 9, divisor 6, staff cadence 3.0 s, style factor 1.15.
    const attackRoll = (20 + 9) * 1.15 * (1 + kit.magicAccuracy / 100);
    const defenceRoll = (block.defenceLevel + 9) * (1 + block.magicArmour / 100);
    const hitChance = Math.min(0.95, Math.max(0.05, attackRoll / (attackRoll + defenceRoll)));
    const maxHit = Math.floor(9 + (20 + kit.magicPower) / 6);
    const dps = (hitChance * (1 + maxHit)) / 2 / 3.0;
    return block.maxHealth / dps;
  }

  it("authors the tier-20 kits at the amendment's solved totals", () => {
    const melee = meleeKit();
    expect(melee.accuracy).toBe(75);
    expect(melee.armour).toBe(95);
    expect(item("emberite_sword").equip!.bonuses.power).toBe(45);
    // PRD 2.4's own tier-20 checkpoint: level 20 with +45 gearPower reads maxHit 17.
    expect(Math.floor(2 + (20 + melee.power) / 4.2)).toBe(17);
    const magic = magicKit();
    // The kit wears the charged Fire Staff, as every tier's magic kit wears its element's staff:
    // 75/50 from the Charhide pieces and uncharged staff, plus the Fire Staff's +9/+6.
    expect(magic.magicAccuracy).toBe(84);
    expect(magic.magicPower).toBe(56);
  });

  it("lands every ordinary tier-20 encounter in the 25-40 s on-tier band", () => {
    for (const family of ["bear", "boar", "ibex", "viper", "reaver"] as const) {
      const block = ENEMY_BLOCKS.find((row) => row.family === family && row.tier === 20)!;
      const best = Math.min(meleeTtk(block), magicTtk(block));
      expect(best, `${family}_t20 best-style TTK ${best.toFixed(1)}s`).toBeGreaterThanOrEqual(25);
      expect(best, `${family}_t20 best-style TTK ${best.toFixed(1)}s`).toBeLessThanOrEqual(40);
    }
  });

  it("keeps the physical-versus-magic answers meaningful at tier 20", () => {
    const bear = ENEMY_BLOCKS.find((row) => row.family === "bear" && row.tier === 20)!;
    const boar = ENEMY_BLOCKS.find((row) => row.family === "boar" && row.tier === 20)!;
    // The Ashback answers to a staff; the Cinder Boar answers to a sword. Each style must win
    // its block by a real margin, not a rounding error.
    expect(magicTtk(bear)).toBeLessThan(meleeTtk(bear) * 0.85);
    expect(meleeTtk(boar)).toBeLessThan(magicTtk(boar) * 0.90);
  });
});

describe("kilnhalt saves", () => {
  it("round-trips a Kilnhalt position through migration at the current save version", () => {
    const store = new Store(7, 0);
    const state = store.get();
    state.player.position = [0, 6, 330];
    state.player.regionId = "kilnhalt";
    const raw = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    const outcome = migrate(raw);
    expect(outcome.ok).toBe(true);
    expect(outcome.state?.player.regionId).toBe("kilnhalt");
    expect(outcome.state?.meta.saveVersion).toBe(SAVE_VERSION);
  });
});
