import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EquipmentBonuses, SemanticEntity, SkillId, Vec3 } from "../game/src/contracts.js";
import { SKILL_IDS, ok } from "../game/src/contracts.js";
import { EventBus } from "../game/src/core/events.js";
import { Rng, RngStreams } from "../game/src/core/rng.js";
import { createCoastalEncounterFormation } from "../game/src/content/coastalEncounterFormation.js";
import { ENEMIES } from "../game/src/content/enemies.js";
import { content } from "../game/src/content/index.js";
import { WORLD_BOUNDS } from "../game/src/content/regions.js";
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

function fixture(entities: SemanticEntity[], nav?: EnemyNavPort, groundHeightAt?: (x: number, z: number) => number,
  habitatForEntity?: (entity: SemanticEntity) => HabitatDef | null) {
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
  const ai = new EnemyAiSystem({ store, events, entities: entityPort, combat, nav, groundHeightAt, habitatForEntity });
  let now = 0;
  return {
    store, state, ai, combat,
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
    { group: "march_road_reavers", activity: "patrol", order: [2, 3, 4, 0, 1, 2, 3],
      anchors: [[-254, 26], [-246, 26], [-245, 32], [-250, 35], [-255, 32]] },
    { group: "palewood_adders", activity: "prowl", order: [2, 3, 0, 1, 2, 3],
      anchors: [[-254, 26], [-246, 26], [-246, 34], [-254, 34]] },
  ] as const)("follows the authored $activity circuit from the anchor nearest its spawn", ({ group, activity, order, anchors }) => {
    // Distinct, fixed corners make circuit order observable regardless of world pack layout.
    const habitat: HabitatDef = {
      id: "circuit_fixture", groupId: group, regionId: "fallowmarch",
      centre: [-250, 30], radius: 8, activity, anchors, dressing: [],
    };
    vi.spyOn(habitats, "habitatForGroup").mockReturnValue(habitat);
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
    { group: "redsill_frogs", activity: "forage", travel: 4.5, pauseMin: 4_000, pauseMax: 10_000 },
  ] as const)("keeps $activity movement local and repeatable, with repeated activity pauses", ({ group, activity, travel, pauseMin, pauseMax }) => {
    // The nearest browse points leave room for visible strides and exercise the travel limit.
    // World authoring may pack anchors closer together without changing these AI guarantees.
    const habitat: HabitatDef = {
      id: "browse_fixture", groupId: group, regionId: "fallowmarch",
      centre: [-250, 30], radius: 10, activity,
      anchors: [[-250, 30], [-245, 30], [-250, 36], [-258, 30], [-250, 22]], dressing: [],
    };
    vi.spyOn(habitats, "habitatForGroup").mockReturnValue(habitat);
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

  it.each(["open_march_goats", "pack_test"])("keeps idle %s inside its habitat during separation", groupId => {
    const habitat = { ...habitats.habitatForGroup("open_march_goats")!, groupId };
    vi.spyOn(habitats, "habitatForGroup").mockReturnValue(habitat);
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


describe("generated coastal habitat behavior", () => {
  it("patrols a generated formation outside the original world bounds through the injected habitat", () => {
    const site = { id: "coastal_patrol_fixture", regionId: "fallowmarch", biomeId: "fallowmarch",
      spot: [WORLD_BOUNDS.min[0] - 30, -50] } as const;
    const formation = createCoastalEncounterFormation(site, {
      id: "coastal_source", family: "goat", name: "Coastal goat", tier: 1, count: 7,
      centre: [-250, 30], radius: 10, assetId: "animal_goat", scale: 1,
    }, { bodyRadius: 1, accepts: () => true })!;
    expect(formation).not.toBeNull();
    const habitat = formation.habitat;
    expect(habitat.boundary).toBe("playable-coast");
    expect(habitat.anchors.every(([x]) => x < WORLD_BOUNDS.min[0])).toBe(true);
    // The same points remain invalid for an authored habitat without the explicit coast policy.
    const { boundary: _boundary, ...authored } = habitat;
    expect(habitat.anchors.every(anchor => !habitats.habitatContains(authored, point(anchor)))).toBe(true);
    const actor = enemy(habitat, formation.actorIds[0]!);
    const spawn: Vec3 = [...actor.position];
    const targets: number[] = [];
    const sim = fixture([actor], {
      nearestWalkable(wanted, tolerance) {
        expect(tolerance).toBe(0.1);
        expect(habitats.habitatContains(habitat, wanted)).toBe(true);
        if (distance(wanted, actor.position) > 0.3) {
          targets.push(habitat.anchors.findIndex(anchor => distance(wanted, point(anchor)) <= 0.45));
        }
        return [...wanted];
      },
    }, undefined, candidate => candidate.meta?.groupId === habitat.groupId ? habitat : null);
    const reached = new Set<number>();
    let travel = 0;
    sim.advance(120_000, () => {
      expect(habitats.habitatContains(habitat, actor.position)).toBe(true);
      travel = Math.max(travel, distance(actor.position, spawn));
      habitat.anchors.forEach((anchor, index) => {
        if (distance(actor.position, point(anchor)) < 0.8) reached.add(index);
      });
    });
    expect(travel).toBeGreaterThan(2);
    expect(targets.slice(0, 8)).toEqual([1, 2, 3, 4, 5, 6, 0, 1]);
    expect(reached.size).toBe(habitat.anchors.length);
    expect(sim.ai.modeOf(actor.id)).toBe("idle");
  });

  it.each([
    { name: "outside-circle", anchor: [-389, -50] },
    { name: "NaN", anchor: [NaN, -50] },
    { name: "infinite", anchor: [-380, Infinity] },
  ] as const)("rejects a coastal $name anchor before navigation", ({ anchor }) => {
    const habitat: HabitatDef = {
      id: "invalid_coastal_fixture", groupId: "invalid_coastal_fixture", regionId: "fallowmarch",
      centre: [-380, -50], radius: 8, boundary: "playable-coast", activity: "patrol",
      anchors: [[-380, -50], anchor], dressing: [],
    };
    expect(habitats.habitatContains(habitat, point(anchor))).toBe(false);
    const actor = enemy(habitat, "coastal_invalid_anchor");
    const spawn: Vec3 = [...actor.position];
    const requests: Vec3[] = [];
    const sim = fixture([actor], {
      nearestWalkable(wanted) {
        requests.push([...wanted]);
        expect(habitats.habitatContains(habitat, wanted)).toBe(true);
        return [...wanted];
      },
    }, undefined, () => habitat);
    sim.advance(30_000, () => expect(actor.position).toEqual(spawn));
    // The valid spawn anchor is still considered, so a disabled AI cannot satisfy this check.
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every(wanted => distance(wanted, spawn) <= 0.45)).toBe(true);
  });

  it.each(["missing", "across-wall", "NaN"] as const)("rejects a coastal %s navigation result", result => {
    const habitat: HabitatDef = {
      id: "coastal_nav_fixture", groupId: "coastal_nav_fixture", regionId: "fallowmarch",
      centre: [-380, -50], radius: 8, boundary: "playable-coast", activity: "patrol",
      anchors: [[-380, -50], [-376, -50]], dressing: [],
    };
    const actor = enemy(habitat, "coastal_blocked_nav");
    const spawn: Vec3 = [...actor.position];
    const requests: Vec3[] = [];
    const sim = fixture([actor], {
      nearestWalkable(wanted) {
        requests.push([...wanted]);
        if (result === "missing") return null;
        return [result === "NaN" ? NaN : wanted[0] + 0.101, wanted[1], wanted[2]];
      },
    }, undefined, () => habitat);
    sim.advance(30_000, () => expect(actor.position).toEqual(spawn));
    expect(requests.some(wanted => distance(wanted, spawn) > 3)).toBe(true);
  });
});


describe("enemy world replacement", () => {
  it("immediately scans a reused coastal ID at clock zero with fresh species stats and AI state", () => {
    const previousEnemies = content.allEnemies();
    content.register({ enemies: ENEMIES });
    try {
      const habitat: HabitatDef = {
        id: "coastal_reset_habitat", groupId: "coastal_reset_fixture", regionId: "fallowmarch",
        centre: [-380, -50], radius: 12, boundary: "playable-coast", activity: "patrol",
        anchors: [[-380, -50], [-372, -50]], dressing: [],
      };
      const canonicalActor = (defId: string, id: string, position: Vec3) => {
        const def = content.enemy(defId)!;
        const actor = enemy(habitat, id, position);
        actor.name = def.name;
        actor.tier = def.tier;
        Object.assign(actor.combat!, {
          health: def.maxHealth, maxHealth: def.maxHealth, aggroRadius: def.aggroRadius,
        });
        Object.assign(actor.meta!, { enemyDefId: def.id, family: def.family });
        return actor;
      };
      const oldActor = canonicalActor("goat_t1", habitat.groupId, [-380, 0, -50]);
      const oldBoss = canonicalActor("ordrun", "ordrun", [-378, 0, -50]);
      oldBoss.archetype = "boss";
      oldBoss.combat!.health = oldBoss.combat!.maxHealth / 2;
      const entities = [oldActor, oldBoss];
      const sim = fixture(entities, { nearestWalkable: wanted => [...wanted] }, undefined,
        actor => actor.id === habitat.groupId ? habitat : null);
      sim.combat.setEnemyOverride(oldActor.id, null);
      const oldTime = 90_000;
      sim.ai.provoke(oldActor.id, oldTime);
      sim.ai.provoke(oldBoss.id, oldTime);
      sim.ai.tick(100, oldTime);
      sim.combat.tick(100, oldTime);
      sim.ai.tick(100, oldTime + 1_800);
      sim.combat.tick(100, oldTime + 1_800);
      expect(sim.ai.modeOf(oldActor.id)).toBe("aggro");
      expect(sim.ai.telegraphFor(oldBoss.id)?.stage).toBe("windup");
      expect(sim.combat.defFor(oldActor).id).toBe("goat_t1");
      expect(sim.state.world.enemies[oldActor.id]?.health).toBe(oldActor.combat!.maxHealth);

      const replacement = canonicalActor("frog_t1", oldActor.id, [-372, 0, -50]);
      replacement.view!.assetId = "animal_frog";
      const spawn: Vec3 = [...replacement.position];
      const oldPositions = [oldActor.position.slice(), oldBoss.position.slice()];
      expect(replacement.combat!.maxHealth).not.toBe(oldActor.combat!.maxHealth);
      entities.splice(0, entities.length, replacement);
      sim.store.reset(19, 0);
      const state = sim.store.get();
      state.player.position = [spawn[0] + 3, spawn[1], spawn[2]];
      sim.combat.resetForNewWorld();
      sim.ai.resetForNewWorld();
      expect(sim.ai.modeOf(replacement.id)).toBeUndefined();
      expect(sim.ai.modeOf(oldBoss.id)).toBeUndefined();
      expect(sim.ai.telegraphs()).toEqual([]);

      // Same realm and a rewound clock must still scan the replacement on this first tick.
      sim.ai.tick(100, 0);
      sim.combat.tick(100, 0);
      expect(Object.keys(state.world.enemies)).toEqual([replacement.id]);
      expect(state.world.enemies[replacement.id]).toMatchObject({
        health: content.enemy("frog_t1")!.maxHealth, state: "idle", spawnPos: spawn,
      });
      expect(sim.combat.defFor(replacement)).toBe(content.enemy("frog_t1"));
      expect(sim.ai.modeOf(replacement.id)).toBe("idle");
      expect(state.combat.engagedBy).toEqual([]);
      expect(sim.ai.telegraphs()).toEqual([]);

      sim.combat.damageEnemy(replacement.id, 1, 100);
      sim.ai.provoke(replacement.id, 100);
      for (let atMs = 100; atMs <= 1_000; atMs += 100) sim.ai.tick(100, atMs);
      expect(state.world.enemies[replacement.id]?.health).toBe(replacement.combat!.maxHealth - 1);
      expect(sim.ai.modeOf(replacement.id)).toBe("aggro");
      expect(distance(replacement.position, spawn)).toBeGreaterThan(0);
      expect([oldActor.position, oldBoss.position]).toEqual(oldPositions);
    } finally {
      content.register({ enemies: previousEnemies });
    }
  });
});


describe("hostile pack pursuit boundary", () => {
  it("retaliates across the idle habitat edge, then disengages beyond the combat leash", () => {
    const habitat: HabitatDef = { id: "test", groupId: "pack_test", regionId: "fallowmarch",
      centre: [-250, 30], radius: 6, activity: "patrol", anchors: [[-250, 30]], dressing: [] };
    vi.spyOn(habitats, "habitatForGroup").mockReturnValue(habitat);
    const actor = enemy(habitat, "pack_test:1");
    actor.combat!.bodyRadius = 0.5;
    const sim = fixture([actor]);
    sim.state.player.position = [-247, 0, 30];
    sim.ai.provoke(actor.id, 0);
    sim.advance(1_000);
    expect(sim.ai.modeOf(actor.id)).toBe("aggro");
    sim.state.player.position = [-243, 0, 30];
    sim.advance(2_000);
    expect(sim.state.combat.engagedBy).toContain(actor.id);
    expect(distance(actor.position, point(habitat.centre))).toBeGreaterThan(5.05);
    sim.state.player.position = [-210, 0, 30];
    sim.advance(5_000);
    expect(sim.state.combat.engagedBy).not.toContain(actor.id);
    expect(sim.ai.modeOf(actor.id)).toBe("idle");
    sim.ai.provoke(actor.id, 8_000);
    expect(sim.ai.modeOf(actor.id)).toBe("idle");
    sim.state.player.position = [-243, 0, 30];
    sim.ai.provoke(actor.id, 8_000);
    expect(sim.ai.modeOf(actor.id)).toBe("aggro");
  });
});


describe("enemy terrain contact", () => {
  it("queries downhill destinations at ground height and removes large navigation offsets", () => {
    const habitat: HabitatDef = { id: "march_road_reavers", groupId: "march_road_reavers", regionId: "fallowmarch",
      centre: [-200, 0], radius: 15, activity: "patrol", anchors: [[-200, 0], [-195, 0], [-195, 5]], dressing: [] };
    vi.spyOn(habitats, "habitatForGroup").mockReturnValue(habitat);
    const actor = enemy(habitat, "march_road_reavers:1");
    const h = (x: number) => -(x + 200) * 1.2;
    let queries = 0, movedSamples = 0;
    const sim = fixture([actor], {
      nearestWalkable(wanted) {
        queries++;
        if (Math.abs(wanted[1] - h(wanted[0])) > 0.001) return null;
        return [wanted[0], h(wanted[0]) + 3, wanted[2]];
      },
    }, h);
    sim.advance(30_000, () => {
      expect(actor.position[1]).toBeCloseTo(h(actor.position[0]), 6);
      if (distance(actor.position, [-200, 0, 0]) > 2) movedSamples++;
    });
    expect(queries).toBeGreaterThan(10);
    expect(movedSamples).toBeGreaterThan(10);
  });
});
