import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lavaClearanceAt } from "../game/src/content/wildernessLava.js";

const dataDir = fileURLToPath(new URL("../game/content/data/", import.meta.url));
const read = <T>(name: string): T => JSON.parse(readFileSync(`${dataDir}${name}.json`, "utf8")) as T;

type Stock = { itemId: string; quantity: number };
type Shop = { id: string; name: string; stock: Stock[] };
type NpcProfile = { id: string; settlementId: string; assetId: string; dialogueRootId: string };
type DialogueNode = { id: string };
type Stall = { id: string; shopKind: string; assetId: string; position: [number, number]; rotationY: number };
type Settlement = {
  id: string;
  centre: [number, number];
  padShape?: { halfX: number; halfZ: number };
  tier: number;
  bankLocationId: string;
  respawnPointId: string;
  buildings: { id: string; prefab: string; model?: { assetId: string } }[];
  stations: { id: string; kind: string }[];
  npcs: { id: string; assetId: string; dialogueRootId: string; questIds: string[] }[];
  shops: Stall[];
};
type Region = {
  id: string;
  tier: number;
  locations: { id: string; kind: string }[];
  roads: { from: string; to: string }[];
  settlements: Settlement[];
};
type Item = {
  id: string;
  tier: number;
  value: number;
  category: string;
  stackable: boolean;
  potion?: { kind: string; strength: number; durationMs: number };
};

const regions = read<Region[]>("worldRegions");
const shops = read<Shop[]>("shops");
const items = read<Item[]>("items");
const npcProfiles = read<NpcProfile[]>("npcs");
const dialogueIds = new Set(read<DialogueNode[]>("dialogue").map((node) => node.id));
const npcById = new Map(npcProfiles.map((npc) => [npc.id, npc]));
const stockById = new Map(shops.map((shop) => [shop.id, new Set(shop.stock.map((row) => row.itemId))]));
const settlements = regions.flatMap((region) => region.settlements.map((settlement) => ({ ...settlement, region })));
const stalls = settlements.flatMap((settlement) => settlement.shops.map((stall) => ({ ...stall, settlement })));

describe("authored market stalls", () => {
  it("keeps both Wilderness town foundations clear of lava and its carved banks", () => {
    for (const town of settlements.filter((town) => town.region.id === "wilderness")) {
      const pad = town.padShape!;
      for (let x = -pad.halfX; x <= pad.halfX; x += 2) {
        for (let z = -pad.halfZ; z <= pad.halfZ; z += 2) {
          expect(lavaClearanceAt(town.centre[0] + x, town.centre[1] + z), `${town.id} at ${x}, ${z}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("places one stock definition per stall and gives every settlement arms and cosmic goods", () => {
    expect(stalls.map((stall) => stall.id).sort()).toEqual(shops.map((shop) => shop.id).sort());
    expect(new Set(stalls.map((stall) => stall.id)).size).toBe(stalls.length);
    for (const settlement of settlements) {
      const kinds = settlement.shops.map((shop) => shop.shopKind);
      expect(kinds, settlement.id).toContain("smith");
      expect(kinds, settlement.id).toContain("cosmic");
      expect(settlement.region.locations.map((location) => location.id)).toContain(settlement.bankLocationId);
    }
    for (const shop of shops) {
      expect(new Set(shop.stock.map((row) => row.itemId)).size, shop.id).toBe(shop.stock.length);
      expect(shop.stock.every((row) => row.quantity > 0), shop.id).toBe(true);
    }
  });

  it("uses the imported stall for each trade and removes constructed market rows", () => {
    const assetForKind: Record<string, string> = {
      smith: "arms", cosmic: "cosmic", potion: "potion", cloth: "cloth", fish: "fish", meat: "meat",
    };
    for (const stall of stalls) {
      const suffix = stall.settlement.id === "lastlight" ? "_t50" : stall.settlement.id === "starhaven" ? "_t70" : "";
      expect(stall.assetId, stall.id).toBe(`market_stall_${assetForKind[stall.shopKind]}${suffix}`);
      expect(Number.isFinite(stall.position[0]) && Number.isFinite(stall.position[1]), stall.id).toBe(true);
    }
    for (const settlement of settlements) {
      expect(settlement.buildings.some((building) =>
        building.id.includes("market") || building.id.includes("trade_row") || building.prefab === "market_row"), settlement.id).toBe(false);
    }
  });

  it("keeps fish and meat in the starter and tier 40 towns, with better fish at tier 40", () => {
    for (const kind of ["fish", "meat"]) {
      expect(stalls.filter((stall) => stall.shopKind === kind).map((stall) => stall.settlement.tier).sort()).toEqual([1, 40]);
    }
    expect(stockById.get("coldbrace_general")).toContain("seared_minnow");
    expect([...stockById.get("crownward_fish")!]).toEqual(expect.arrayContaining(["cooked_crown_trout", "cooked_crown_tuna"]));
    expect(stalls.filter((stall) => stall.shopKind === "cloth").map((stall) => stall.settlement.tier)).toEqual([40]);
    expect(stockById.get("crownward_cloth")).toContain("crownhide_thread");
  });

  it("defines twelve five minute potions and sells only unlocked ranks", () => {
    const ranks = [
      { rank: 1, tier: 10, strength: 5, value: 1500 },
      { rank: 2, tier: 30, strength: 10, value: 6000 },
      { rank: 3, tier: 50, strength: 15, value: 18000 },
      { rank: 4, tier: 70, strength: 20, value: 45000 },
    ];
    for (const kind of ["melee", "magic", "defence"]) for (const spec of ranks) {
      const potion = items.find((item) => item.id === `${kind}_potion_t${spec.rank}`);
      expect(potion).toMatchObject({
        tier: spec.tier, value: spec.value, category: "potion", stackable: true,
        potion: { kind, strength: spec.strength, durationMs: 300_000 },
      });
    }
    for (const stall of stalls.filter((row) => row.shopKind === "potion")) {
      const rank = stall.settlement.tier < 30 ? 1 : stall.settlement.tier < 50 ? 2 : stall.settlement.tier < 70 ? 3 : 4;
      for (const kind of ["melee", "magic", "defence"]) {
        expect(stockById.get(stall.id), stall.id).toContain(`${kind}_potion_t${rank}`);
      }
      if (stall.settlement.tier < 70) {
        expect([...stockById.get(stall.id)!].filter((id) => /_potion_t4$/.test(id)), stall.id).toEqual([]);
      }
      if (stall.settlement.tier < 50) {
        expect([...stockById.get(stall.id)!].filter((id) => /_potion_t3$/.test(id)), stall.id).toEqual([]);
      }
    }
  });

  it("places the tier 50 and 70 towns with imported buildings, services and friendly residents", () => {
    const wilderness = regions.find((region) => region.id === "wilderness")!;
    const towns = wilderness.settlements;
    expect(wilderness.tier).toBe(50);
    expect(towns.map((town) => [town.id, town.tier])).toEqual([["lastlight", 50], ["starhaven", 70]]);
    for (const town of towns) {
      const modelPrefix = `town_t${town.tier}_`;
      expect(town.buildings.length, town.id).toBeGreaterThanOrEqual(8);
      expect(town.buildings.every((building) => building.model?.assetId.startsWith(modelPrefix)), town.id).toBe(true);
      expect(new Set(town.buildings.map((building) => building.model?.assetId)).size, town.id).toBeGreaterThanOrEqual(8);
      expect(town.stations.map((station) => station.kind).sort(), town.id).toEqual(["anvil", "crafting_table", "fletching_bench", "range"]);
      expect(town.stations.map((station) => station.id).sort(), town.id).toEqual(
        ["anvil", "crafting", "fletching", "range"].map((kind) => `${town.id}_${kind}`).sort(),
      );
      expect(town.npcs.length, town.id).toBe(5);
      expect(town.npcs.every((npc) => npc.id.startsWith(`npc_${town.id}_`) && npc.assetId.startsWith("creature_")
        && npc.questIds.length === 0 && dialogueIds.has(npc.dialogueRootId)
        && npcById.get(npc.id)?.settlementId === town.id
        && npcById.get(npc.id)?.assetId === npc.assetId
        && npcById.get(npc.id)?.dialogueRootId === npc.dialogueRootId), town.id).toBe(true);
      expect(town.shops.map((shop) => shop.shopKind).sort()).toEqual(["cosmic", "potion", "smith"]);
      expect(wilderness.roads.some((road) => road.to === town.respawnPointId)).toBe(true);
    }
    expect(stockById.get("lastlight_potion")).toContain("melee_potion_t3");
    expect(stockById.get("starhaven_potion")).toContain("melee_potion_t4");
  });
});
