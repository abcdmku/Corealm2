import { describe, expect, it, vi } from "vitest";
import type { RegionId, Vec3 } from "../game/src/contracts.js";
import { relocateDungeonSave } from "../game/src/persistence/dungeonPlacement.js";
import { dungeonFloorHeight, type DungeonSpec } from "../game/src/render/dungeon.js";
import { createInitialState, type GameState } from "../game/src/state/store.js";

// Deliberately independent of the authored world: overlapping rooms have different depths,
// so a migration using one chamber's nominal floor cannot pass these cases.
const SPEC: DungeonSpec = {
  regionId: "gravelmaw",
  chambers: [
    { id: "upper", name: "Upper", centre: [0, 0], radius: 6, floorY: -31, lit: true },
    { id: "middle", name: "Middle", centre: [9, 0], radius: 6, floorY: -36, lit: false },
    { id: "lower", name: "Lower", centre: [18, 4], radius: 6, floorY: -43, lit: false },
  ],
  corridors: [
    { from: [0, 0], to: [9, 0], fromY: -31, toY: -36, width: 3 },
    { from: [9, 0], to: [18, 4], fromY: -36, toY: -43, width: 3 },
  ],
  wallHeight: 8,
};
const surfaceHeightAt = (x: number, z: number): number => 8 + x * 0.03 + z * 0.02;
const unchanged = {
  player: false, recoveryCache: false, campfire: false, lootPiles: [], enemySpawns: [],
};

function floorPosition(x: number, z: number, offset = 0): Vec3 {
  return [x, dungeonFloorHeight(SPEC, x, z) + offset, z];
}

function pile(position: Vec3): GameState["world"]["lootPiles"][string] {
  return { position, items: [{ itemId: "air_orb", quantity: 1 }], expiresAtMs: 97_321, ownerOnly: true };
}

function enemy(spawnPos: Vec3): GameState["world"]["enemies"][string] {
  return { spawnPos, health: 0, state: "dead", respawnAtMs: 51_234, diedAtMs: 4_567, bossPhase: 2 };
}

function savedState(): GameState {
  const state = createInitialState(918, 74_000);
  state.meta.playSeconds = 212.5;
  state.player.regionId = "gravelmaw";
  state.player.position = floorPosition(5, 1, 21.2);
  state.player.health = 11;
  state.player.facingRad = 1.7;
  state.player.movement = {
    mode: "path", path: [floorPosition(5, 1, 21.2), floorPosition(9, 0, 21.2)],
    pathIndex: 1, destination: floorPosition(9, 0, 21.2), destinationEntityId: "cave_guard_2",
  };
  state.currency = 1_379;
  state.magic.weaponCharges.air_wand = 237;
  state.quests.depths = { status: "active", stage: 3, counters: { kills: 4 }, flags: { entered: true } };
  state.world.recoveryCache = {
    id: "recovery:player", position: floorPosition(0, 1, 21.2), regionId: "gravelmaw",
    items: [{ itemId: "air_essence", quantity: 173 }], expiresAtMs: 617_000,
    expiresAtWallMs: 1_900_000_123_456,
  };
  state.world.campfire = {
    id: "campfire:player", position: floorPosition(18, 4, 21.2), regionId: "gravelmaw",
    logItemId: "duskoak_log", tier: 5, expiresAtPlaySeconds: 333.75,
  };
  return state;
}

describe("Gravelmaw saved placement repair", () => {
  it("repairs mixed legacy records on the blended floor without changing possessions or lifecycle state", () => {
    const state = savedState();
    state.world.lootPiles = {
      loot_cave_guard_2_170001: pile(floorPosition(5, 1, 21.2)),
      unknown_old_drop: pile(floorPosition(10, 2, 21.2 + 0.3)),
      loot_cave_guard_3_170002: pile(floorPosition(18, 4, 0.6)),
      loot_surface_guard_4_170003: pile(floorPosition(0, 1, 21.2)),
    };
    state.world.enemies = {
      cave_guard_2: enemy(floorPosition(0, 2, 21.2)),
      missing_old_enemy: enemy(floorPosition(17, 5, 21.2 - 0.4)),
      cave_guard_3: enemy(floorPosition(18, 4, -0.7)),
      surface_guard_4: enemy(floorPosition(5, 1, 21.2)),
    };
    const regions: Record<string, RegionId> = {
      cave_guard_2: "gravelmaw", cave_guard_3: "gravelmaw", surface_guard_4: "fallowmarch",
    };
    const entityRegion = vi.fn((id: string) => regions[id]);
    const expected = structuredClone(state);
    expected.player.position = floorPosition(5, 1);
    expected.player.movement = {
      mode: "idle", path: null, pathIndex: 0, destination: null, destinationEntityId: null,
    };
    expected.world.recoveryCache!.position = floorPosition(0, 1);
    expected.world.campfire!.position = floorPosition(18, 4);
    expected.world.lootPiles.loot_cave_guard_2_170001!.position = floorPosition(5, 1);
    expected.world.lootPiles.unknown_old_drop!.position = floorPosition(10, 2);
    expected.world.enemies.cave_guard_2!.spawnPos = floorPosition(0, 2);
    expected.world.enemies.missing_old_enemy!.spawnPos = floorPosition(17, 5);

    expect(relocateDungeonSave(state, SPEC, { surfaceHeightAt, entityRegion })).toEqual({
      player: true, recoveryCache: true, campfire: true,
      lootPiles: ["loot_cave_guard_2_170001", "unknown_old_drop"],
      enemySpawns: ["cave_guard_2", "missing_old_enemy"],
    });
    expect(state).toEqual(expected);
    expect(entityRegion).toHaveBeenCalledWith("cave_guard_2");
    expect(entityRegion).toHaveBeenCalledWith("surface_guard_4");

    expect(relocateDungeonSave(state, SPEC, { surfaceHeightAt, entityRegion })).toEqual(unchanged);
    expect(state).toEqual(expected);
  });

  it("trusts explicit dungeon ownership even when a saved position was snapped to the surface", () => {
    const state = savedState();
    const surface: Vec3 = [5, surfaceHeightAt(5, 1), 1];
    state.player.position = surface;
    state.world.recoveryCache!.position = surface;
    state.world.campfire!.position = surface;
    state.world.lootPiles = { loot_cave_guard_12_99: pile(surface), anonymous_surface: pile(surface) };
    state.world.enemies = { cave_guard_12: enemy(surface), anonymous_surface: enemy(surface) };
    const entityRegion = (id: string): RegionId | undefined => id === "cave_guard_12" ? "gravelmaw" : undefined;

    expect(relocateDungeonSave(state, SPEC, { surfaceHeightAt, entityRegion })).toEqual({
      player: true, recoveryCache: true, campfire: true,
      lootPiles: ["loot_cave_guard_12_99"], enemySpawns: ["cave_guard_12"],
    });
    for (const position of [state.player.position, state.world.recoveryCache!.position,
      state.world.campfire!.position, state.world.lootPiles.loot_cave_guard_12_99!.position,
      state.world.enemies.cave_guard_12!.spawnPos]) expect(position).toEqual(floorPosition(5, 1));
    expect(state.world.lootPiles.anonymous_surface!.position).toEqual(surface);
    expect(state.world.enemies.anonymous_surface!.spawnPos).toEqual(surface);
  });

  it("leaves explicitly surface-owned records and their movement untouched at the legacy cave height", () => {
    const state = savedState();
    state.player.regionId = "fallowmarch";
    state.world.recoveryCache!.regionId = "karrowmoor";
    state.world.campfire!.regionId = "kilnhalt";
    state.world.lootPiles.loot_surface_wolf_2_99 = pile(floorPosition(5, 1, 21.2));
    state.world.enemies.surface_wolf_2 = enemy(floorPosition(0, 1, 21.2));
    const before = structuredClone(state);

    expect(relocateDungeonSave(state, SPEC, {
      surfaceHeightAt, entityRegion: () => "vellenwood",
    })).toEqual(unchanged);
    expect(state).toEqual(before);
  });

  it.each([
    { name: "surface coincides with the old floor", x: 5, z: 1, oldOffset: 0, surfaceGap: 0 },
    { name: "surface is too close", x: 5, z: 1, oldOffset: 0, surfaceGap: 1.49 },
    { name: "surface is not clearly farther than the old floor", x: 5, z: 1, oldOffset: 0.79, surfaceGap: 1.52 },
    { name: "record is not near the old floor", x: 5, z: 1, oldOffset: 1.1, surfaceGap: 10 },
    { name: "record is outside the chambers", x: -9, z: 0, oldOffset: 0, surfaceGap: 10 },
  ])("preserves untagged loot and enemies when $name", ({ x, z, oldOffset, surfaceGap }) => {
    const state = createInitialState();
    const position = floorPosition(x, z, 21.2 + oldOffset);
    state.world.lootPiles.loot_unknown_guard_7_123 = pile(position);
    state.world.enemies.unknown_guard_7 = enemy(position);
    const before = structuredClone(state);

    expect(relocateDungeonSave(state, SPEC, {
      surfaceHeightAt: () => position[1] + surfaceGap, entityRegion: () => undefined,
    })).toEqual(unchanged);
    expect(state).toEqual(before);
  });

  it("keeps an already settled player's path when only world records need repair", () => {
    const state = savedState();
    state.player.position = floorPosition(5, 1, 0.79);
    const playerBefore = structuredClone(state.player);

    expect(relocateDungeonSave(state, SPEC, { surfaceHeightAt })).toEqual({
      ...unchanged, recoveryCache: true, campfire: true,
    });
    expect(state.player).toEqual(playerBefore);
  });

  it("accepts a nearby navigable point on the current cave floor", () => {
    const state = createInitialState();
    state.player.regionId = "gravelmaw";
    state.player.position = floorPosition(5, 1, 21.2);
    const navigable = floorPosition(5.5, 1.4, 0.2);
    const navClosest = vi.fn(() => navigable);

    expect(relocateDungeonSave(state, SPEC, { surfaceHeightAt, navClosest })).toEqual({
      ...unchanged, player: true,
    });
    expect(navClosest).toHaveBeenCalledWith(floorPosition(5, 1));
    expect(state.player.position).toEqual(navigable);
    expect(relocateDungeonSave(state, SPEC, { surfaceHeightAt, navClosest })).toEqual(unchanged);
    expect(navClosest).toHaveBeenCalledTimes(1);
  });

  it.each([
    { name: "no navigation result", x: -5.6, navigable: null },
    { name: "surface navigation", x: -5.6, navigable: [-5.6, surfaceHeightAt(-5.6, 0), 0] as Vec3 },
    { name: "wrong cave height", x: -5.6, navigable: floorPosition(-5.6, 0, 1.1) },
    { name: "excessive horizontal shift", x: -5.6, navigable: floorPosition(-3.5, 0) },
    { name: "point beyond the cave footprint", x: -7, navigable: floorPosition(-8.2, 0) },
  ])("falls back to the same XZ and exact floor for $name", ({ x, navigable }) => {
    const state = createInitialState();
    state.player.regionId = "gravelmaw";
    state.player.position = floorPosition(x, 0, 21.2);

    expect(relocateDungeonSave(state, SPEC, {
      surfaceHeightAt, navClosest: () => navigable,
    })).toEqual({ ...unchanged, player: true });
    expect(state.player.position).toEqual(floorPosition(x, 0));
  });

  it("does not run this legacy migration for another dungeon region", () => {
    const state = savedState();
    state.world.lootPiles.loot_cave_guard_2_99 = pile(floorPosition(5, 1, 21.2));
    state.world.enemies.cave_guard_2 = enemy(floorPosition(18, 4, 21.2));
    const before = structuredClone(state);
    const navClosest = vi.fn(() => floorPosition(0, 0));

    expect(relocateDungeonSave(state, { ...SPEC, regionId: "karrowmoor" }, {
      surfaceHeightAt, entityRegion: () => "gravelmaw", navClosest,
    })).toEqual(unchanged);
    expect(state).toEqual(before);
    expect(navClosest).not.toHaveBeenCalled();
  });
});
