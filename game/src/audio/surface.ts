import type { GroundSurfaceSample, RegionId, Vec3 } from "../contracts.js";
import { getRegion } from "../content/regions.js";
import type { FootstepSurface } from "./director.js";

/** Selects footsteps from the material the renderer shows under the player. */
export function footstepSurfaceAt(
  regionId: RegionId,
  position: Vec3,
  ground: GroundSurfaceSample,
): FootstepSurface {
  if (regionId === "gravelmaw") return "cave";

  const [x, , z] = position;
  const paving = getRegion(regionId)?.settlement?.paving?.find(({ rect }) =>
    x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ);
  if (paving) return paving.assetId === "floor_wood" || paving.assetId === "floor_wood_light"
    ? "wood"
    : "stone";

  const stone = Math.max(ground.rock, ground.gravel, ground.cobble);
  const dirt = Math.max(ground.dirt, ground.mud, ground.wet);
  const natural = Math.max(ground.grass, ground.dry);
  if (stone > dirt && stone > natural) return "stone";
  if (dirt > natural) return "dirt";

  if (regionId === "vellenwood") return "forest";
  return "grass";
}
