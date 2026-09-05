import type { RegionId, Vec3 } from "../contracts.js";
import { dungeonFloorHeight, type DungeonSpec } from "../render/dungeon.js";
import type { GameState } from "../state/store.js";

export interface DungeonSavePlacementOptions {
  surfaceHeightAt(x: number, z: number): number;
  /** Current semantic entity realm, including the source enemy encoded in a loot id. */
  entityRegion?(id: string): RegionId | undefined;
  navClosest?(position: Vec3): Vec3 | null;
}

/**
 * Rehomes saves from Gravelmaw's former elevation onto its floor after the 21.2 m deepening.
 * Region tags outrank height inference. Untagged surface drops are left alone when ambiguous.
 * Call after save validation and before restoring runtime containers and player movement.
 */
export function relocateDungeonSave(
  state: GameState,
  spec: DungeonSpec,
  options: DungeonSavePlacementOptions,
): { player: boolean; recoveryCache: boolean; campfire: boolean; lootPiles: string[]; enemySpawns: string[] } {
  const moved = { player: false, recoveryCache: false, campfire: false, lootPiles: [] as string[], enemySpawns: [] as string[] };
  if (spec.regionId !== "gravelmaw" || spec.chambers.length === 0) return moved;

  const destination = (position: Vec3, regionId?: RegionId): Vec3 | null => {
    if (regionId !== undefined && regionId !== spec.regionId) return null;
    if (!position.every(Number.isFinite) || !insideFootprint(spec, position)) return null;
    const floor = dungeonFloorHeight(spec, position[0], position[2]);
    // Recast can put the feet a few centimetres above the authored floor. Preserve current saves.
    if (Math.abs(position[1] - floor) <= 0.8) return null;
    if (regionId === undefined) {
      const oldGap = Math.abs(position[1] - (floor + 21.2));
      const surface = options.surfaceHeightAt(position[0], position[2]);
      const surfaceGap = Math.abs(position[1] - surface);
      if (oldGap > 0.8 || !Number.isFinite(surface) || surfaceGap <= 1.5 || surfaceGap <= oldGap + 0.75) return null;
    }
    const target: Vec3 = [position[0], floor, position[2]];
    const snapped = options.navClosest?.([...target] as Vec3);
    if (snapped && snapped.every(Number.isFinite) && insideFootprint(spec, snapped)
      && Math.hypot(snapped[0] - target[0], snapped[2] - target[2]) <= 1.5
      && Math.abs(snapped[1] - dungeonFloorHeight(spec, snapped[0], snapped[2])) <= 0.8) {
      return [snapped[0], snapped[1], snapped[2]];
    }
    return target;
  };

  const player = destination(state.player.position, state.player.regionId);
  if (player) {
    state.player.position = player;
    state.player.movement = { mode: "idle", path: null, pathIndex: 0, destination: null, destinationEntityId: null };
    moved.player = true;
  }
  for (const kind of ["recoveryCache", "campfire"] as const) {
    const saved = state.world[kind];
    if (!saved) continue;
    const position = destination(saved.position, saved.regionId);
    if (position) { saved.position = position; moved[kind] = true; }
  }
  for (const [id, pile] of Object.entries(state.world.lootPiles)) {
    const sourceId = /^loot_(.+)_\d+$/.exec(id)?.[1];
    const position = destination(pile.position, sourceId ? options.entityRegion?.(sourceId) : undefined);
    if (position) { pile.position = position; moved.lootPiles.push(id); }
  }
  for (const [id, enemy] of Object.entries(state.world.enemies)) {
    const position = destination(enemy.spawnPos, options.entityRegion?.(id));
    if (position) { enemy.spawnPos = position; moved.enemySpawns.push(id); }
  }
  return moved;
}

function insideFootprint(spec: DungeonSpec, point: Vec3): boolean {
  if (spec.chambers.some((chamber) => Math.hypot(point[0] - chamber.centre[0], point[2] - chamber.centre[1])
    <= chamber.radius + 1.6)) return true;
  return spec.corridors.some((corridor) => {
    const dx = corridor.to[0] - corridor.from[0];
    const dz = corridor.to[1] - corridor.from[1];
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
      ((point[0] - corridor.from[0]) * dx + (point[2] - corridor.from[1]) * dz) / lengthSquared));
    return Math.hypot(point[0] - corridor.from[0] - t * dx, point[2] - corridor.from[1] - t * dz) <= corridor.width / 2;
  });
}
