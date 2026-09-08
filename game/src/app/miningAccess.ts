import type { Vec3 } from "../contracts.js";
import { getRegion } from "../content/regions.js";
import { resourceDef } from "../content/resources.js";
import { worldSitePoint, type WorldSite } from "../content/worldSites.js";
import { tierSilhouetteScale } from "../core/math.js";
import { variantSeed } from "../render/buildings.js";
import { INTERACT_RANGE, PLAYER_RADIUS } from "./config.js";

export interface MiningAssetMeasurements {
  assetSize(assetId: string): { x: number; y: number; z: number } | null;
  assetCenterXZ?(assetId: string): { x: number; z: number } | null;
}

const FACE_CLEARANCE = 0.70;
// The production navmesh expands resource cylinders by about 0.45 m. Leave another 0.10 m
// for the sampled edge while retaining a close working position for the pickaxe animation.
const COLLISION_CLEARANCE = PLAYER_RADIUS + 0.20;

/**
 * Native ore boulders use a local +Z approach. Keep the resource at its authored pivot and give
 * navigation a nearby working position outside both the visible rock and its resource cylinder.
 * Dressing clearance and the route to this point still require the production navigation proof.
 */
export function miningAccessPositions(
  sites: readonly WorldSite[],
  heightAt: (x: number, z: number) => number,
  measurements?: MiningAssetMeasurements,
): Map<string, Vec3> {
  const positions = new Map<string, Vec3>();
  for (const site of sites) {
    if (site.kind !== "mine") continue;
    if (!measurements) throw new Error(`Mine ${site.id} requires measured resource bounds for its working positions`);
    if (![...site.centre, site.rotationY].every(Number.isFinite)) {
      throw new Error(`Mine ${site.id} has a non-finite site transform`);
    }
    const region = getRegion(site.regionId);
    for (const slot of site.resourceSlots) {
      const id = `${slot.clusterId}_${slot.index}`;
      if (positions.has(id)) throw new Error(`Duplicate mining access position ${id}`);
      if (![slot.x, slot.z, slot.yaw, slot.scale].every(Number.isFinite) || slot.scale <= 0
        || !Number.isInteger(slot.index) || slot.index < 1) {
        throw new Error(`Mine ${site.id} has an invalid resource slot ${id}`);
      }
      const cluster = region?.clusters.find((candidate) => candidate.id === slot.clusterId);
      if (!cluster || slot.index > cluster.count) throw new Error(`Mine ${site.id} has no resource slot ${id}`);
      const definition = resourceDef(cluster.resourceId);
      if (definition.archetype !== "ore") continue;
      const hero = slot.index === 1 && cluster.heroAssetId !== undefined;
      const variants = definition.presentation.availableAssetIds;
      const assetId = hero ? cluster.heroAssetId! : variants[variantSeed(id) % variants.length];
      if (!assetId?.startsWith("corealm_ore_")) {
        throw new Error(`Mine ${site.id}/${id} has no native mineral rock with an authored +Z approach`);
      }
      const size = measurements.assetSize(assetId);
      const centre = measurements.assetCenterXZ?.(assetId) ?? { x: 0, z: 0 };
      if (!size || ![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0)
        || ![centre.x, centre.z].every(Number.isFinite)) {
        throw new Error(`Mine ${site.id}/${id} has no valid source bounds for ${assetId}`);
      }
      // Match regionBuilder's presentationScale and drawnScale, including its rounding order.
      // Hashes choose presentation only; no seeded world or gathering RNG stream is consumed.
      const [minimum, maximum] = definition.presentation.variantScale ?? [1, 1];
      const unit = ((variantSeed(`${id}:scale`) >>> 8) & 0xffff) / 0xffff;
      const target = definition.presentation.targetWorldSize / Math.max(size.x, size.y, size.z);
      const silhouette = tierSilhouetteScale(definition.tier);
      const viewScale = hero && cluster.heroScale !== undefined ? cluster.heroScale
        : Math.round(target * (minimum + (maximum - minimum) * unit) / silhouette * 10_000) / 10_000;
      const scale = viewScale * slot.scale * silhouette;
      if (!Number.isFinite(scale) || scale <= 0) throw new Error(`Mine ${site.id}/${id} has an invalid presentation scale`);

      // Resource cylinders use the same cap in regionBuilder.pushClusterSolid. Their width can
      // put the navmesh edge farther out than the shallow mineral face's own +Z bound.
      const radius = Math.round(Math.min(Math.max(0.4, INTERACT_RANGE - 1),
        Math.max(0.35, (size.x + size.z) * 0.20 * scale)) * 100) / 100;
      const front = (centre.z + size.z / 2) * scale;
      // Small deposits still need clearance from the sampled bank and its navmesh erosion.
      // Keep the working pivot outside that shoulder even when the source rock shrinks.
      const forward = Math.max(1.65, front + FACE_CLEARANCE, radius + COLLISION_CLEARANCE);
      const lateral = centre.x * scale;
      const yaw = site.rotationY + slot.yaw;
      const [originX, originZ] = worldSitePoint(site, slot.x, slot.z);
      const x = originX + lateral * Math.cos(yaw) + forward * Math.sin(yaw);
      const z = originZ - lateral * Math.sin(yaw) + forward * Math.cos(yaw);
      const y = heightAt(x, z);
      if (![x, y, z].every(Number.isFinite)) throw new Error(`Mine ${site.id}/${id} has no finite working ground`);
      positions.set(id, [x, y, z]);
    }
  }
  return positions;
}
