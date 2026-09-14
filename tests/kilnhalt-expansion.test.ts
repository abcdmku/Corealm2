/**
 * Phase 2 amendment: the Kilnhalt tier-20 expansion.
 *
 * Freezes the amendment's literal claims: the 700 m wide world with an OPEN southern Kilnhalt
 * border, the complete Emberfast station set, the tier-20 formula values, the fire release, the
 * rare miniboss weapon derivation rule, miniboss placement semantics, the 25-40 s on-tier combat
 * band, and the fire-orb altar migration.
 */
import { describe, expect, it } from "vitest";
import type { ItemDef } from "../game/src/contracts.js";
import { MAGIC_ORBS } from "../game/src/content/equipment.js";
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

describe("world extension", () => {
  it("keeps Kilnhalt at its original width beneath the widened northern wilderness", () => {
    // The Deep Wilderness expansion doubled the northern band to z940 (`WILDERNESS_DEPTH.north`).
    // Crownward extends the surface east to x700; Kilnhalt retains its original bounds.
    expect(WORLD_BOUNDS).toEqual({ min: [-350, -200], max: [700, 940] });
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
    expect(inbound).toHaveLength(5);
    expect(getRegion("crownward")!.adjacency.filter(link => link.toRegionId === "kilnhalt")).toHaveLength(1);
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

describe("miniboss rewards", () => {
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
      const placement = bossGroup(id);
      expect(Math.hypot(entity!.position[0] - placement.centre[0], entity!.position[2] - placement.centre[1])).toBeLessThanOrEqual(placement.radius);
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
