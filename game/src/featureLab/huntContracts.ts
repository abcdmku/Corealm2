import type { SemanticEntity, Vec3 } from "../contracts.js";
import { Rng } from "../core/rng.js";
import { buildEnemyGroup, type AssetSize } from "../world/regionBuilder.js";

/** Eight ordinary bandits, production stats/AI/loot, enough for any 4-8 kill offer. */
export function assembleHuntContractsFixture(
  heightAt: (x: number, z: number) => number,
  baseY: (assetId: string) => number,
  assetSize: (assetId: string) => AssetSize | null,
): { entities: SemanticEntity[]; spawn: Vec3 } {
  const entities: SemanticEntity[] = [];
  buildEnemyGroup("fallowmarch", { id: "lab_hunt_bandits", family: "reaver", name: "Road Bandit",
    tier: 1, count: 8, centre: [-56, -35], radius: 14, assetId: "outfit_male_peasant", scale: 1.12 },
  new Rng(606), (point, assetId, scale) => [point[0], heightAt(...point) - baseY(assetId) * scale, point[1]],
  entities, assetSize);
  for (const entity of entities) entity.meta = { ...entity.meta, huntFixture: true };
  return { entities, spawn: [-56, heightAt(-56, -12), -12] };
}
