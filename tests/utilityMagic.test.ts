import { describe, expect, it } from "vitest";
import { ok, err, type SemanticEntity, type TownTeleportPad } from "../game/src/contracts.js";
import { Store } from "../game/src/state/store.js";
import { UtilityMagicSystem, utilityMagnitude, utilityPlayerSpeed } from "../game/src/systems/utilityMagic.js";
import { UTILITY_SPELLS } from "../game/src/content/utilityMagic.js";

function fixture() {
  const store = new Store(5, 0), state = store.get();
  state.skills.magic.level = 99; state.player.position = [0, 0, 0]; state.player.maxHealth = 100; state.player.health = 50;
  let now = 0, reachable = true;
  const fuel: Record<string, number> = { cosmic_essence: 100, arc_essence: 100, temporal_essence: 10 };
  const enemies: SemanticEntity[] = [{id: "frog", name: "Frog", archetype: "enemy", tier: 1, regionId: state.player.regionId,
    position: [3, 0, 0], state: "alive", interactions: [], combat: {health: 100, maxHealth: 100, level: 1, aggroRadius: 0}}];
  const pads: TownTeleportPad[] = [{id: "millfield", name: "Millfield", entityId: "pad", position: [0, 0, 0], regionId: state.player.regionId, reqLevel: 5, cost: 1}];
  const ally = new Store(6, 0).get(); ally.player.id = "ally"; ally.player.position = [0, 0, 1]; ally.player.maxHealth = 100; ally.player.health = 50;
  const system = new UtilityMagicSystem({store, now: () => now, allies: () => [state, ally], pads: () => pads,
    entities: {all: () => enemies, get: id => enemies.find(e => e.id === id)}, stop: () => {state.player.movement.mode = "idle";},
    snap: point => reachable ? point : null,
    fuel: { available: id => fuel[id] ?? 0, spend: costs => {
      if (costs.some(c => (fuel[c.itemId] ?? 0) < c.quantity)) return err("NOT_ENOUGH_ITEMS", "Missing essence");
      for (const cost of costs) fuel[cost.itemId]! -= cost.quantity; return ok({});
    }}});
  return {store, state, system, fuel, enemies, pads, ally, tick: (at: number, delta = 100) => {now = at; state.meta.playSeconds = at / 1000; system.tick(delta, at);}, unreachable: () => {reachable = false;}, setClock: (at: number) => {now = at;}};
}
describe("cosmic utility magic", () => {
  it("requires levels and complete fuel before spending, without an elemental weapon", () => {
    const f = fixture(); f.state.skills.magic.level = 1;
    expect(f.system.cast("lesser_ward").ok).toBe(false); expect(f.fuel.cosmic_essence).toBe(100);
    f.state.skills.magic.level = 99; f.fuel.arc_essence = 0;
    expect(f.system.cast("warding_circle", [0, 0, 0]).ok).toBe(false); expect(f.fuel.cosmic_essence).toBe(100);
    expect(f.system.cast("lesser_ward").ok).toBe(true); expect(f.fuel.cosmic_essence).toBe(99);
  });
  it("keeps the stronger enchantment and expires buffs at 60 seconds", () => {
    const f = fixture(); f.system.cast("greater_enchantment"); f.system.cast("enchant_weapon"); f.system.cast("haste");
    expect(utilityMagnitude(f.state.magic.utilityEffects, "accuracy", 0)).toBe(.15);
    expect(utilityPlayerSpeed(f.state, 0)).toBe(1.15); f.tick(60_000);
    expect(utilityMagnitude(f.state.magic.utilityEffects, "accuracy", 60_000)).toBe(0); expect(utilityPlayerSpeed(f.state)).toBe(1);
  });
  it("allows a lesser enchantment once the stronger one expires, before a cleanup tick", () => {
    const f = fixture(); f.system.cast("greater_enchantment"); f.setClock(60_000);
    expect(f.system.cast("enchant_weapon").ok).toBe(true);
    expect(utilityMagnitude(f.state.magic.utilityEffects, "accuracy", 60_000)).toBe(.1);
  });
  it("bosses resist both root and slow fields while ordinary enemies receive them", () => {
    const f = fixture();
    f.enemies.push({...structuredClone(f.enemies[0]!), id: "boss", archetype: "boss"});
    expect(f.system.cast("binding_field", [3, 0, 0]).ok).toBe(true);
    expect(f.system.cast("stillness", [3, 0, 0]).ok).toBe(true);
    f.tick(100);
    for (const group of ["root", "slow"] as const) {
      expect(utilityMagnitude(f.state.world.enemies.boss?.utilityEffects, group, 100)).toBe(0);
      expect(utilityMagnitude(f.state.world.enemies.frog?.utilityEffects, group, 100)).toBeGreaterThan(0);
    }
  });
  it("rejects invalid points, distant targets and bosses without charging", () => {
    const f = fixture(); f.enemies[0]!.archetype = "boss";
    expect(f.system.cast("binding_thread", "frog").ok).toBe(false);
    expect(f.system.cast("binding_field", [NaN, 0, 0]).ok).toBe(false);
    expect(f.system.cast("weaken", "missing").ok).toBe(false);
    f.enemies[0]!.position = [100, 0, 0]; expect(f.system.cast("weaken", "frog").ok).toBe(false);
    expect(f.fuel.cosmic_essence).toBe(100);
  });
  it("shares enemy effects and removes field control after leaving its radius", () => {
    const f = fixture(); expect(f.system.cast("binding_field", [3, 0, 0]).ok).toBe(true); f.tick(100);
    expect(utilityMagnitude(f.state.world.enemies.frog!.utilityEffects, "root", 100)).toBe(1);
    f.enemies[0]!.position = [10, 0, 0]; f.tick(200);
    expect(utilityMagnitude(f.state.world.enemies.frog!.utilityEffects, "root", 200)).toBe(0);
    f.enemies[0]!.position = [3, 0, 0]; expect(f.system.cast("weaken", "frog").ok).toBe(true);
    expect(f.enemies[0]!.combat!.utilityEffects).toBe(f.state.world.enemies.frog!.utilityEffects);
  });
  it("never stacks allied healing circles and heals 15 percent over their full duration", () => {
    const f = fixture(); f.system.cast("mending_circle", [0, 0, 0]);
    f.ally.magic.utilityFields = structuredClone(f.state.magic.utilityFields);
    for (let i = 1; i <= 300; i++) f.tick(i * 100);
    expect(f.state.player.health).toBeCloseTo(65, 8);
  });
  it("restores a self ward after leaving a stronger allied sanctuary", () => {
    const f = fixture(); f.system.cast("lesser_ward"); f.system.cast("sanctuary", [0, 0, 0]); f.tick(100);
    expect(utilityMagnitude(f.state.magic.utilityEffects, "ward", 100)).toBe(.2);
    f.state.player.position = [10, 0, 0]; f.tick(200);
    expect(utilityMagnitude(f.state.magic.utilityEffects, "ward", 200)).toBe(.1);
  });
  it("keeps roots and fields out of other realms and clears self effects on death", () => {
    const f = fixture(); f.enemies[0]!.regionId = "gravelmaw" as typeof f.state.player.regionId;
    expect(f.system.cast("weaken", "frog").ok).toBe(false);
    f.system.cast("binding_field", [3, 0, 0]); f.tick(100);
    expect(utilityMagnitude(f.state.world.enemies.frog?.utilityEffects, "root", 100)).toBe(0);
    f.system.cast("haste"); f.state.player.health = 0; f.tick(100);
    expect(f.state.magic.utilityEffects).toEqual([]); expect(f.state.magic.utilityFields).toEqual([]);
    expect(UTILITY_SPELLS.filter(s => s.target === "area").every(s => s.costs.some(c => c.itemId === "arc_essence"))).toBe(true);
  });
});
describe("town teleport channel", () => {
  it("requires a physical activation and consumes only on arrival", () => {
    const f = fixture(); expect(f.system.teleport("millfield").ok).toBe(false);
    f.state.player.position = [50, 0, 0]; expect(f.system.activateTeleport("millfield").ok).toBe(false);
    f.state.player.position = [0, 0, 0]; expect(f.system.activateTeleport("millfield").ok).toBe(true);
    f.state.player.position = [20, 0, 0]; expect(f.system.teleport("millfield").ok).toBe(true);
    f.tick(2900); expect(f.fuel.temporal_essence).toBe(10); f.tick(3000);
    expect(f.state.player.position).toEqual([0, 0, 0]); expect(f.fuel.temporal_essence).toBe(9);
    expect(f.state.magic.unlockedTeleports.millfield).toBe(true);
  });
  it("cancels on movement, damage or a failed landing without consuming", () => {
    for (const reason of ["movement", "damage", "landing"]) {
      const f = fixture(); f.system.activateTeleport("millfield"); f.system.teleport("millfield");
      if (reason === "movement") f.state.player.position = [1, 0, 0];
      if (reason === "damage") f.state.player.health--;
      if (reason === "landing") f.unreachable();
      f.tick(3000); expect(f.state.magic.teleportCast).toBeNull(); expect(f.fuel.temporal_essence).toBe(10);
    }
  });
});
