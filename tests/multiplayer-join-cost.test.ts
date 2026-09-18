import { describe, expect, it } from "vitest";
import type { SemanticEntity, WorldDescriptor } from "../game/src/contracts.js";
import { WORLD_CONTENT_VERSION, WORLD_PROTOCOL_VERSION } from "../game/src/contracts.js";
import { createMultiplayerLabWorld } from "../game/src/multiplayer/labWorld.js";
import { HeadlessWorld } from "../game/src/multiplayer/headlessWorld.js";
import { deriveHuntTargets, generateHuntOffers } from "../game/src/content/huntContracts.js";
import { ENEMY_BLOCKS } from "../game/src/content/enemies.js";

const descriptor: WorldDescriptor = {
  providerId: "reference", worldId: "yard", name: "Yard", endpoint: "ws://127.0.0.1:0/",
  protocolVersion: WORLD_PROTOCOL_VERSION, contentVersion: WORLD_CONTENT_VERSION, seed: 1337,
  population: 0, capacity: 1000, availability: "available",
};

function enemy(id: string, position: [number, number, number], enemyDefId = "reaver_t1"): SemanticEntity {
  return { id, archetype: "enemy", name: "Road Bandit", tier: 1, regionId: "fallowmarch", position,
    state: "alive", interactions: ["inspect", "attack"], meta: { enemyDefId } };
}

describe("multiplayer player join cost", () => {
  it("checks one reachable resident per target group after the first success", async () => {
    const ports = await createMultiplayerLabWorld();
    const source = ports.entities.find((entity) => entity.archetype === "enemy")!;
    const extras = Array.from({ length: 500 }, (_, index) => ({ ...source,
      id: `multiplayer:join-cost:${index}`, position: [index % 20, 0, Math.floor(index / 20)] as [number, number, number] }));
    const nav = ports.nav;
    const originalPathDistance = nav.pathDistance.bind(nav);
    let pathCalls = 0;
    nav.pathDistance = ((from, to) => { pathCalls += 1; return originalPathDistance(from, to); }) as typeof nav.pathDistance;
    const world = new HeadlessWorld(descriptor, { ...ports, entities: [...ports.entities, ...extras] });
    const sentinelCalls = pathCalls;
    world.join("join-cost");
    const joinCalls = pathCalls - sentinelCalls;
    const groupCount = new Set(world.entities.all().filter((entity) => entity.archetype === "enemy")
      .map((entity) => `${entity.regionId}:${String(entity.meta?.enemyDefId ?? "")}`)).size;
    expect(joinCalls).toBeLessThanOrEqual(groupCount);
    expect(joinCalls).toBeLessThan(extras.length);
  });

  it("keeps offers unchanged when a blocked resident precedes a reachable one", () => {
    const candidates = [enemy("blocked", [0, 0, 0]), enemy("reachable", [1, 0, 0])];
    const reachability = (entity: SemanticEntity) => entity.id === "reachable";
    const def = ENEMY_BLOCKS.find((entry) => entry.id === "reaver_t1")!;
    const exact = deriveHuntTargets(candidates, () => def,
      () => "Fallowmarch", reachability);
    const short = deriveHuntTargets(candidates, () => def,
      () => "Fallowmarch", reachability, { stopAfterReachable: true });
    const eligibility = { regions: ["fallowmarch" as const], combatLevel: 1 };
    expect(generateHuntOffers(42, 1, exact, eligibility)).toEqual(generateHuntOffers(42, 1, short, eligibility));
  });
});
