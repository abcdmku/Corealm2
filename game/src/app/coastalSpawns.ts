import type { WorldScene } from "../render/scene.js";
import type { WorldPorts } from "../world/regionBuilder.js";
import { Rng } from "../core/rng.js";

/** Stable, sparse population across the dry coastal continuation of each biome. */
export function coastalSpawnSites(scene: WorldScene, seed: number): NonNullable<WorldPorts["coastalSpawns"]> {
  const bounds = scene.getScatterBounds(Infinity);
  const core = scene.getWorldBounds();
  const sites: NonNullable<WorldPorts["coastalSpawns"]>[number][] = [];
  const spacing = 36;
  for (let x = bounds.minX; x < bounds.maxX; x += spacing) {
    for (let z = bounds.minZ; z < bounds.maxZ; z += spacing) {
      const rng = new Rng(seed ^ Math.imul(x, 73856093) ^ Math.imul(z, 19349663));
      const px = x + rng.float(6, spacing - 6);
      const pz = z + rng.float(6, spacing - 6);
      if (px >= core.minX && px <= core.maxX && pz >= core.minZ && pz <= core.maxZ) continue;
      const sample = scene.sampleWorld(px, pz);
      if (!sample.playable || !sample.coast || sample.height < sample.coast.seaLevel + 0.5
        || sample.slope === null || sample.slope > 0.85) continue;
      // A whole creature footprint must stay dry, including on narrow headlands.
      if ([-3, 3].some((dx) => [-3, 3].some((dz) => !scene.sampleWorld(px + dx, pz + dz).playable))) continue;
      sites.push({ id: `coastal_${x}_${z}`, regionId: sample.semanticRegion,
        biomeId: sample.visualBiome, spot: [px, pz] });
    }
  }
  return sites;
}
