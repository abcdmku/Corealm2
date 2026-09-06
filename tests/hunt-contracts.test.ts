import { describe, expect, it } from "vitest";
import type { SemanticEntity } from "../game/src/contracts.js";
import { EventBus } from "../game/src/core/events.js";
import { generateHuntOffers, type HuntTarget } from "../game/src/content/huntContracts.js";
import { createInitialHuntContracts, normalizeHuntContracts, HuntContractsSystem } from "../game/src/systems/huntContracts.js";
const target: HuntTarget = { id: "fallowmarch:reaver_t1", name: "Road Bandit", regionId: "fallowmarch",
  regionName: "Fallowmarch", enemyDefIds: ["reaver_t1"], level: 1, residents: 8, reachable: true };
function fixture() {
  let state = createInitialHuntContracts(42);
  let xp = 0;
  const events = new EventBus();
  const entity: SemanticEntity = { id: "enemy1", archetype: "enemy", name: "Road Bandit", tier: 1,
    regionId: "fallowmarch", state: "dead", position: [0, 0, 0], interactions: [], meta: { enemyDefId: "reaver_t1" } };
  const system = new HuntContractsSystem({ state: () => state, markDirty() {}, events,
    playerId: () => "player", targets: () => [target], eligibility: () => ({ combatLevel: 1, regions: ["fallowmarch"] }),
    entity: () => entity, awardXp: (_skill, amount) => { xp += amount; } });
  const kill = (data = {}, serial = ++state.killSerial) => { events.emit("combat.ended", {
    reason: "killed", enemyId: entity.id, creditedPlayerId: "player", killSerial: serial, ...data }); events.flush(); };
  const start = () => { system.refreshOffers(); system.accept(state.offers[0]!.id); };
  return { system, start, kill, entity, events, get state() { return state; }, get xp() { return xp; },
    reload: () => { state = normalizeHuntContracts(JSON.parse(JSON.stringify(state))); } };
}
describe("repeatable hunt contracts", () => {
  it("rolls deterministic feasible offers without depending on source order", () => {
    const locked = { ...target, id: "locked", regionId: "gravelmaw" as const };
    const unreachable = { ...target, id: "unreachable", reachable: false };
    const high = { ...target, id: "high", level: 50 };
    const eligibility = { regions: ["fallowmarch" as const], combatLevel: 1 };
    const offers = generateHuntOffers(42, 1, [target, locked, high, unreachable], eligibility);
    expect(offers).toEqual(generateHuntOffers(42, 1, [unreachable, high, locked, target], eligibility));
    expect(offers).toHaveLength(1);
    expect(offers[0]!.requiredKills).toBeGreaterThanOrEqual(4);
    expect(offers[0]!.requiredKills).toBeLessThanOrEqual(8);
  });
  it("rejects uncredited, unrelated, alive, other-region and duplicate kills", () => {
    const f = fixture(); f.start();
    f.kill({ creditedPlayerId: null });
    f.entity.state = "alive"; f.kill(); f.entity.state = "dead";
    f.entity.regionId = "gravelmaw"; f.kill(); f.entity.regionId = "fallowmarch";
    f.entity.meta!.enemyDefId = "rat_t1"; f.kill(); f.entity.meta!.enemyDefId = "reaver_t1";
    expect(f.state.active!.kills).toBe(0);
    f.kill(); f.kill({}, f.state.killSerial);
    expect(f.state.active!.kills).toBe(1);
  });
  it("rejects kills queued before acceptance and before an abandoned hunt replacement", () => {
    const f = fixture(); f.state.killSerial = 1; f.start(); f.kill({}, 1);
    expect(f.state.active!.kills).toBe(0);
    f.kill(); f.system.abandon(); f.system.accept(f.state.offers[0]!.id); f.kill({}, f.state.killSerial);
    expect(f.state.active!.kills).toBe(0);
  });
  it("persists offers, progress, claimed status and prevents duplicate XP through reload", () => {
    const f = fixture(); f.start(); f.kill(); f.reload(); f.kill({}, f.state.killSerial);
    expect(f.state.active!.kills).toBe(1);
    const required = f.state.active!.offer.requiredKills;
    for (let i = 1; i < required; i++) f.kill();
    expect(f.state.active!.status).toBe("ready"); expect(f.xp).toBe(0);
    const reward = f.state.active!.offer.rewardXp;
    expect(f.system.claim().ok).toBe(true); f.reload();
    expect(f.system.claim().ok).toBe(false); expect(f.xp).toBe(reward);
    expect(f.state.completedCount).toBe(1);
    expect(f.state.offers).toHaveLength(1);
    expect(f.system.accept(f.state.offers[0]!.id).ok).toBe(true);
    expect(f.state.active!.kills).toBe(0);
  });
  it("does not reroll or replace an active contract", () => {
    const f = fixture(); f.start(); const id = f.state.active!.offer.id;
    expect(f.system.refreshOffers().ok).toBe(false);
    expect(f.system.accept(id).ok).toBe(true);
    expect(f.state.active!.offer.id).toBe(id);
  });
  it("migrates old saves and rejects malformed progress or invented rewards", () => {
    expect(normalizeHuntContracts(undefined, 25)).toEqual(createInitialHuntContracts(25));
    const f = fixture(); f.start(); f.state.active!.offer.rewardXp = 999999;
    expect(() => normalizeHuntContracts(f.state)).toThrow();
    expect(() => normalizeHuntContracts(null)).toThrow();
  });
});

// Construction checks cover the fixture's production bindings, not gameplay acceptance.
describe("hunt target catalogue", () => {
  it("uses registered, reachable ordinary enemies and keeps their real stat levels", async () => {
    const { deriveHuntTargets } = await import("../game/src/content/huntContracts.js");
    const { ENEMY_BLOCKS } = await import("../game/src/content/enemies.js");
    const { enemyCombatLevel } = await import("../game/src/content/index.js");
    const f = fixture();
    const enemies = [f.entity, { ...f.entity, id: "other" }, { ...f.entity, id: "boss", archetype: "boss" as const }];
    const def = ENEMY_BLOCKS.find((entry) => entry.id === "reaver_t1")!;
    const targets = deriveHuntTargets(enemies, (id) => id === def.id ? def : undefined, () => "Fallowmarch", () => true);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.residents).toBe(2);
    expect(targets[0]!.level).toBe(enemyCombatLevel(def));
    expect(deriveHuntTargets(enemies, () => def, () => "Fallowmarch", () => false)).toEqual([]);
  });
  it("rechecks feasibility when accepting a saved offer", () => {
    const f = fixture(); f.system.refreshOffers();
    const offer = f.state.offers[0]!;
    offer.enemyDefIds = ["removed_enemy"];
    expect(f.system.accept(offer.id).ok).toBe(false);
    expect(f.state.active).toBeNull();
  });
});

describe("hunt event boundaries", () => {
  it("ignores missing and future credit serials, then accepts the next real kill", () => {
    const f = fixture(); f.start();
    f.kill({ killSerial: undefined });
    f.kill({ killSerial: 5000 });
    expect(f.state.active!.kills).toBe(0);
    f.kill();
    expect(f.state.active!.kills).toBe(1);
  });
  it("does not pay XP when abandoning a completed unclaimed hunt", () => {
    const f = fixture(); f.start();
    const required = f.state.active!.offer.requiredKills;
    for (let i = 0; i < required; i++) f.kill();
    expect(f.state.active!.status).toBe("ready");
    expect(f.system.abandon().ok).toBe(true);
    expect(f.system.claim().ok).toBe(false);
    expect(f.xp).toBe(0);
    expect(f.state.completedCount).toBe(0);
  });
});
