import type { RegionId } from "../contracts.js";
import { REGIONS } from "../content/regions.js";
import type { DungeonSpec } from "../world/dungeonLayout.js";

/** Canonical dungeon coordinates shared by browser preparation and reference hosting. */
export function buildDungeonSpec(scene: { heightAt(region: RegionId, x: number, z: number): number }): DungeonSpec | null {
  for (const region of REGIONS) {
    const dungeon = region.dungeon;
    if (!dungeon) continue;
    const base = scene.heightAt(region.id, dungeon.entrance[0], dungeon.entrance[1]);
    const chambers = dungeon.chambers.map((chamber) => ({
      id: chamber.id, name: chamber.name, centre: [chamber.centre[0], chamber.centre[1]] as [number, number],
      radius: chamber.radius, floorY: base + chamber.floorOffset, lit: chamber.lit,
    }));
    const corridors = chambers.slice(0, -1).map((chamber, index) => {
      const next = chambers[index + 1]!;
      return { from: chamber.centre, to: next.centre, fromY: chamber.floorY, toY: next.floorY, width: 6 };
    });
    return { regionId: dungeon.id, chambers, corridors, wallHeight: 13 };
  }
  return null;
}
