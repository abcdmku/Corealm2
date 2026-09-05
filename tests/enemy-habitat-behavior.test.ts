import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EquipmentBonuses, SemanticEntity, SkillId, Vec3 } from "../game/src/contracts.js";
import { SKILL_IDS, ok } from "../game/src/contracts.js";
import { EventBus } from "../game/src/core/events.js";
import { Rng, RngStreams } from "../game/src/core/rng.js";
import * as habitats from "../game/src/content/worldHabitats.js";
import type { HabitatDef } from "../game/src/content/worldHabitats.js";
import { Store } from "../game/src/state/store.js";
import { CombatSystem } from "../game/src/systems/combat.js";
import { EnemyAiSystem, type EnemyNavPort } from "../game/src/systems/enemyAI.js";
import { InteractionDispatcher } from "../game/src/world/interactions.js";

const NO_GEAR: EquipmentBonuses = {
  accuracy: 0, power: 0, armour: 0,
  magicAccuracy: 0, magicPower: 0, magicArmour: 0, vitality: 0,
};
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const point = ([x, z]: readonly [number, number]): Vec3 => [x, 0, z];

function enemy(habitat: HabitatDef, id: string, position = point(habitat.anchors[0]!)): SemanticEntity {
  return {
    id, archetype: "enemy", name: id, tier: 1, regionId: habitat.regionId,
    position, state: "alive", interactions: ["attack"],
    combat: {
      health: 100, maxHealth: 100, level: 1, aggroRadius: 0,
      bodyRadius: 0, walkSpeedMps: 1, moveSpeedMps: 3,
    },
    view: { assetId: "animal_goat", rotationY: 0 },
    meta: { groupId: habitat.groupId },
  };
}

function fixture(entities: SemanticEntity[], nav?: EnemyNavPort) {
  const store = new Store(7, 0);
  const state = store.get();
  state.player.position = [...entities[0]!.position];
  const entityPort = {
    get: (id: string) => entities.find((entity) => entity.id === id),
    all: () => entities,
  };
  const events = new EventBus();
  const combat = new CombatSystem({
    store, events, entities: entityPort, rng: new RngStreams(7),
    equipment: { totals: () => NO_GEAR, slots: () => state.equipment },
    inventory: {
      addItem: (_id, quantity) => ok(quantity), removeItem: (_id, quantity) => ok(quantity),
      countItem: () => 0, freeSlots: () => 28, hasRoomFor: () => true,
    },
    dispatcher: new InteractionDispatcher({
      get: entityPort.get,
      playerPosition: () => state.player.position,
      skillLevels: () => Object.fromEntries(SKILL_IDS.map((id) => [id, state.skills[id].level])) as Record<SkillId, number>,
    }),
  });
  for (const entity of entities) combat.setEnemyOverride(entity.id, { behaviour: "passive", aggroRadius: 0 });
  const ai = new EnemyAiSystem({ store, events, entities: entityPort, combat, nav });
  let now = 0;
  return {
    state,
    advance(durationMs: number, observe?: () => void) {
      const until = now + durationMs;
      while (now < until) {
        ai.tick(100, now);
        combat.tick(100, now);
        observe?.();
        now += 100;
      }
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("authored enemy habitat behavior", () => {
  it.each([
    {
      group: "open_march_goats", digest: "b5ccee01eeb85ebd34e7dce0da744cc58176c02051734a117e9f6f932f542e5b",
      reference: { regionId: "fallowmarch", centre: [-250, 30], radius: 14, activity: "graze",
        anchors: [[-259, 24], [-250, 21], [-240, 30], [-250, 40], [-259, 33]] },
    },
    {
      group: "bramble_hogs", digest: "b64b5e64e91cad9aa4ad06bb85dd16ef9d2091bf3faecad697486429bdfb9ff6",
      reference: { regionId: "vellenwood", centre: [141, 132], radius: 10, activity: "forage",
        anchors: [[135, 126], [143, 125], [149, 132], [144, 140], [136, 138]] },
    },
    {
      group: "palewood_adders", digest: "73deb4134ab7684f2bd218778af5a54bc53fa325b4d2bb568f3e5d68101d6100",
      reference: { regionId: "fallowmarch", centre: [-318, -94], radius: 11, activity: "prowl",
        anchors: [[-326, -91], [-320, -87], [-310, -92], [-316, -101]] },
    },
    {
      group: "march_road_reavers", digest: "b23f65b310dc607a68b4ac4f2f4758d7c6ae27e8d6e562bb3f5a9ac6a72d0e8e",
      reference: { regionId: "fallowmarch", centre: [-245, -21], radius: 15, activity: "patrol",
        anchors: [[-250, -24], [-242, -18], [-235, -25], [-239, -31], [-246, -12]] },
    },
  ] as const)("preserves every movement, nav request and RNG draw in the $group reference run", ({ group, digest, reference }) => {
    // Freeze the input scene as well as the trace so later world authoring does not change it.
    const habitat: HabitatDef = { id: group, groupId: group, dressing: [], ...reference };
    vi.spyOn(habitats, "habitatForGroup").mockReturnValue(habitat);
    const actor = enemy(habitat, `${group}:parity`, point(habitat.anchors[1]!));
    const draws: number[][] = [];
    const original = Rng.prototype.int;
    vi.spyOn(Rng.prototype, "int").mockImplementation(function (this: Rng, min, max) {
      const value = original.call(this, min, max);
      draws.push([min, max, value]);
      return value;
    });
    const requests: Vec3[] = [];
    const sim = fixture([actor], {
      nearestWalkable(wanted) { requests.push([...wanted]); return [...wanted]; },
    });
    const positions: Vec3[] = [];
    sim.advance(120_000, () => positions.push([...actor.position]));
    expect(requests.length).toBeGreaterThan(10);
    expect(draws.length).toBeGreaterThan(3);
    // Captured from the real AI before extracting its target calculations. This detects changed
    // random consumption and circuit order without maintaining a second implementation here.
    const actual = createHash("sha256").update(JSON.stringify({ positions, requests, draws })).digest("hex");
    expect(actual).toBe(digest);
  });

  it.each([
    { group: "march_road_reavers", activity: "patrol", order: [2, 3, 4, 0, 1, 2, 3] },
    { group: "palewood_adders", activity: "prowl", order: [2, 3, 0, 1, 2, 3] },
  ])("follows the authored $activity circuit from the anchor nearest its spawn", ({ group, order }) => {
    const habitat = habitats.habitatForGroup(group)!;
    const actor = enemy(habitat, `${group}:2`, point(habitat.anchors[2]!));
    const sim = fixture([actor]);
    const visited: number[] = [];
    sim.advance(180_000, () => {
      const at = habitat.anchors.findIndex((anchor) => distance(actor.position, point(anchor)) < 1);
      if (at >= 0 && visited.at(-1) !== at) visited.push(at);
      expect(distance(actor.position, point(habitat.centre))).toBeLessThanOrEqual(habitat.radius);
    });

    expect(visited.slice(0, order.length)).toEqual(order);
    expect(sim.state.world.enemies[actor.id]?.state).toBe("idle");
  });

  it.each([
    { group: "open_march_goats", activity: "graze", travel: 5.5, pauseMin: 10_000, pauseMax: 22_000 },
    { group: "bramble_hogs", activity: "forage", travel: 4.5, pauseMin: 4_000, pauseMax: 10_000 },
  ])("keeps $activity movement local and repeatable, with repeated activity pauses", ({ group, travel, pauseMin, pauseMax }) => {
    const habitat = habitats.habitatForGroup(group)!;
    const trace = (id: string) => {
      const actor = enemy(habitat, id);
      const spawn: Vec3 = [...actor.position];
      const destinations: Vec3[] = [];
      const sim = fixture([actor], {
        nearestWalkable(wanted) {
          if (distance(wanted, actor.position) > 0.3) destinations.push([...wanted]);
          return [...wanted];
        },
      });
      const positions: Vec3[] = [];
      sim.advance(120_000, () => positions.push([...actor.position]));
      expect(Math.max(...positions.map((position) => distance(position, spawn)))).toBeGreaterThan(1);
      expect(Math.max(...positions.map((position) => distance(position, spawn)))).toBeLessThanOrEqual(travel);
      for (const position of positions) {
        expect(distance(position, point(habitat.centre))).toBeLessThanOrEqual(habitat.radius);
      }
      const browsePoints = [...habitat.anchors]
        .sort((a, b) => distance(point(a), spawn) - distance(point(b), spawn)).slice(0, 3);
      for (const destination of destinations) {
        const distanceFromBrowseDirection = Math.min(...browsePoints.map(([x, z]) => {
          const dx = x - spawn[0];
          const dz = z - spawn[2];
          const lengthSquared = dx * dx + dz * dz;
          const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
            ((destination[0] - spawn[0]) * dx + (destination[2] - spawn[2]) * dz) / lengthSquared));
          return distance(destination, [spawn[0] + dx * along, spawn[1], spawn[2] + dz * along]);
        }));
        expect(distanceFromBrowseDirection).toBeLessThanOrEqual(0.45);
      }
      // Returning to the same browse point retains the individual's offset instead of jittering.
      expect(new Set(destinations.map((destination) => JSON.stringify(destination))).size)
        .toBeLessThan(destinations.length);
      const firstMovement = positions.findIndex((position) => distance(position, spawn) > 0.1);
      const completedPauses: number[] = [];
      let pause = 0;
      for (let index = firstMovement + 1; index < positions.length; index += 1) {
        if (distance(positions[index]!, positions[index - 1]!) < 1e-8) {
          pause += 100;
        } else {
          // Ignore the short stationary turns between strides. A completed activity pause must
          // end in actual movement, so an actor that walks once and freezes cannot satisfy this.
          if (pause > 1_000) completedPauses.push(pause);
          pause = 0;
        }
      }
      expect(completedPauses.length).toBeGreaterThanOrEqual(2);
      for (const duration of completedPauses) {
        expect(duration).toBeGreaterThanOrEqual(pauseMin);
        // Arrival and a turn toward the next destination add at most a few simulation ticks.
        expect(duration).toBeLessThanOrEqual(pauseMax + 800);
      }
      return { positions, destinations };
    };

    const first = trace(`${group}:0`);
    expect(trace(`${group}:0`)).toEqual(first);
    const second = trace(`${group}:1`);
    expect(second.positions).not.toEqual(first.positions);
    // At least one shared browse point has separate individual destinations, regardless of timing.
    expect(first.destinations.some((a) => second.destinations.some((b) => {
      const gap = distance(a, b);
      return gap > 0.01 && gap < 0.9;
    }))).toBe(true);
  });

  it("rejects a destination snapped across a wall even when the result is inside the habitat", () => {
    const habitat = habitats.habitatForGroup("march_road_reavers")!;
    const actor = enemy(habitat, "wall_endpoint_patrol");
    const spawn: Vec3 = [...actor.position];
    const requests: Vec3[] = [];
    const sim = fixture([actor], {
      nearestWalkable(wanted) {
        requests.push([...wanted]);
        return [wanted[0] + 0.101, wanted[1], wanted[2]];
      },
    });
    sim.advance(30_000);

    expect(requests.length).toBeGreaterThan(0);
    expect(requests.some((wanted) => distance(
      [wanted[0] + 0.101, wanted[1], wanted[2]], point(habitat.centre),
    ) < habitat.radius)).toBe(true);
    expect(actor.position).toEqual(spawn);
  });

  it("rejects short steering steps snapped across a wall after accepting the authored destination", () => {
    const habitat = habitats.habitatForGroup("march_road_reavers")!;
    const actor = enemy(habitat, "wall_step_patrol");
    const spawn: Vec3 = [...actor.position];
    let destinations = 0;
    let redirectedSteps = 0;
    const sim = fixture([actor], {
      nearestWalkable(wanted) {
        if (distance(wanted, actor.position) > 0.3) {
          destinations += 1;
          return [...wanted];
        }
        redirectedSteps += 1;
        return [wanted[0] + 0.101, wanted[1], wanted[2]];
      },
    });
    sim.advance(30_000);

    expect(destinations).toBeGreaterThan(0);
    expect(redirectedSteps).toBeGreaterThan(0);
    expect(actor.position).toEqual(spawn);
  });

  it("accepts sub-tolerance XZ navigation snaps and navmesh height changes", () => {
    const habitat = habitats.habitatForGroup("march_road_reavers")!;
    const actor = enemy(habitat, "nav_precision_patrol");
    const spawn: Vec3 = [...actor.position];
    const sim = fixture([actor], {
      nearestWalkable: (wanted) => [wanted[0] + 0.099, 2.5, wanted[2]],
    });
    sim.advance(10_000);

    expect(distance(actor.position, spawn)).toBeGreaterThan(1);
    expect(actor.position[1]).toBe(2.5);
  });

  it.each([
    { name: "habitat", centre: [-240, -20], radius: 1, outside: [-243, -20] },
    { name: "region", centre: [-21, -50], radius: 8, outside: [-18, -50] },
    { name: "world", centre: [-349, -50], radius: 8, outside: [-352, -50] },
  ] as const)("does not walk toward an anchor outside the $name boundary", ({ centre, radius, outside }) => {
    const habitat: HabitatDef = {
      id: "invalid_anchor_fixture", groupId: "invalid_anchor_fixture", regionId: "fallowmarch",
      centre, radius, anchors: [centre, outside], activity: "patrol", dressing: [],
    };
    vi.spyOn(habitats, "habitatForGroup").mockReturnValue(habitat);
    const actor = enemy(habitat, "boundary_patrol");
    const spawn: Vec3 = [...actor.position];
    const sim = fixture([actor], { nearestWalkable: (wanted) => [...wanted] });
    sim.advance(30_000, () => {
      expect(distance(actor.position, spawn)).toBeLessThanOrEqual(0.5);
      expect(distance(actor.position, point(outside))).toBeGreaterThan(2);
    });
  });

  it("does not push an idle animal beyond its habitat edge while making room for a neighbour", () => {
    const habitat = habitats.habitatForGroup("open_march_goats")!;
    const edge: Vec3 = [habitat.centre[0] + habitat.radius - 0.01, 0, habitat.centre[1]];
    const actor = enemy(habitat, "edge_goat", [...edge]);
    const neighbour = enemy(habitat, "inner_goat", [edge[0] - 0.2, edge[1], edge[2]]);
    actor.combat!.bodyRadius = neighbour.combat!.bodyRadius = 0.4;
    const neighbourBefore: Vec3 = [...neighbour.position];
    const sim = fixture([actor, neighbour]);
    sim.advance(100);

    expect(actor.position).toEqual(edge);
    expect(distance(neighbour.position, neighbourBefore)).toBeGreaterThan(0);
    expect(distance(actor.position, point(habitat.centre))).toBeLessThanOrEqual(habitat.radius);
    expect(distance(neighbour.position, point(habitat.centre))).toBeLessThanOrEqual(habitat.radius);
  });

  it.each(["feature-lab:goat", "lab:goat", "explicit_lab_goat"])(
    "keeps %s on the local lab floor despite having a world group ID",
    (id) => {
      const habitat = habitats.habitatForGroup("open_march_goats")!;
      const actor = enemy(habitat, id, [0, 0, 0]);
      if (id === "explicit_lab_goat") actor.meta!.featureLab = true;
      const requests: Vec3[] = [];
      const sim = fixture([actor], {
        nearestWalkable(wanted) { requests.push([...wanted]); return [...wanted]; },
      });
      const positions: Vec3[] = [];
      sim.advance(60_000, () => positions.push([...actor.position]));

      expect(requests.length).toBeGreaterThan(0);
      expect(Math.max(...positions.map((position) => distance(position, [0, 0, 0])))).toBeGreaterThan(1);
      expect(requests.every((wanted) => distance(wanted, [0, 0, 0]) <= 6.01)).toBe(true);
    },
  );
});
