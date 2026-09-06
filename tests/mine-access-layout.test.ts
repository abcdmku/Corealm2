import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REGIONS } from "../game/src/content/regions.js";
import { resourceDef } from "../game/src/content/resources.js";
import { miningAccessPositions } from "../game/src/app/miningAccess.js";
import { PLAYER_RADIUS } from "../game/src/app/config.js";
import { tierSilhouetteScale } from "../game/src/core/math.js";
import { buildWorld } from "../game/src/world/regionBuilder.js";
import {
  WORLD_SITES, type WorldSite, type WorldSiteDressing, type WorldSiteResourceSlot,
} from "../game/src/content/worldSites.js";

const mines = WORLD_SITES.filter((site) => site.kind === "mine");
const clusters = new Map(REGIONS.flatMap((region) => region.clusters.map((cluster) => [cluster.id, cluster])));
const manifest = JSON.parse(readFileSync(new URL("../game/public/assets/manifest.json", import.meta.url), "utf8")) as {
  assets: { id: string; size: { x: number; y: number; z: number }; base: { x: number; y: number; z: number } }[];
};
const modelSizes = new Map(manifest.assets.map((asset) => [asset.id, asset.size]));
const models = new Map(manifest.assets.map(asset => [asset.id, asset]));
const measurements = {
  assetSize: (id: string) => models.get(id)?.size ?? null,
  assetCenterXZ: (id: string) => {
    const model = models.get(id);
    return model ? { x: model.base.x + model.size.x / 2, z: model.base.z + model.size.z / 2 } : null;
  },
};
const access = miningAccessPositions(WORLD_SITES, () => 0, measurements);
const productionEntities = new Map(buildWorld(12345, () => 0, {
  ...measurements, heightAt: () => 0, baseY: id => models.get(id)?.base.y ?? 0, accessPositions: access,
}).entities.map(entity => [entity.id, entity]));
type Point = readonly [number, number];
interface Footprint { id: string; x: number; z: number; halfX: number; halfZ: number; yaw: number }

function dressingFootprint(piece: WorldSiteDressing): Footprint {
  const size = modelSizes.get(piece.assetId)!;
  const scale = typeof piece.scale === "number" ? [piece.scale, piece.scale, piece.scale] : piece.scale;
  return {
    id: piece.id, x: piece.x, z: piece.z, yaw: piece.yaw,
    halfX: size.x * scale[0]! / 2, halfZ: size.z * scale[2]! / 2,
  };
}

function oreFootprints(site: WorldSite): Footprint[] {
  return site.resourceSlots.flatMap((slot) => {
    const resource = resourceDef(clusters.get(slot.clusterId)!.resourceId);
    // Check every available variant at its largest authored scale. RegionBuilder cancels the
    // tier silhouette multiplier so targetWorldSize remains the actual drawn size.
    return resource.presentation.availableAssetIds.map((assetId) => {
      const size = modelSizes.get(assetId)!;
      const scale = resource.presentation.targetWorldSize / Math.max(size.x, size.y, size.z)
        * (resource.presentation.variantScale?.[1] ?? 1) * slot.scale;
      return {
        id: `${slot.clusterId}_${slot.index}`, x: slot.x, z: slot.z, yaw: slot.yaw,
        halfX: size.x * scale / 2, halfZ: size.z * scale / 2,
      };
    });
  });
}

function distanceToFootprint([x, z]: Point, box: Footprint): number {
  const dx = x - box.x; const dz = z - box.z;
  const cos = Math.cos(box.yaw); const sin = Math.sin(box.yaw);
  return Math.hypot(
    Math.max(0, Math.abs(dx * cos - dz * sin) - box.halfX),
    Math.max(0, Math.abs(dx * sin + dz * cos) - box.halfZ),
  );
}

function aislePoint(site: WorldSite, slot: WorldSiteResourceSlot): Point {
  // This is the broad circulation lane, not the close pickaxe working pose. Ground
  // boulders are deeper than the old wall slabs, so a fixed 2.1 m pivot offset can
  // run through their maximum presentation envelope. Reserve the same 0.85 m
  // minimum aisle with one player radius for bends between neighboring lane points.
  const depth = Math.max(...oreFootprints(site).map(box => box.halfZ));
  const forward = Math.max(2.1, depth + 0.85 + PLAYER_RADIUS);
  return [slot.x + Math.sin(slot.yaw) * forward, slot.z + Math.cos(slot.yaw) * forward];
}

function corridorClearance(from: Point, to: Point, solids: readonly Footprint[]) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.2));
  let clearance = Infinity;
  let blocker = "";
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const point: Point = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    for (const solid of solids) {
      const gap = distanceToFootprint(point, solid);
      if (gap < clearance) { clearance = gap; blocker = solid.id; }
    }
  }
  return { clearance, blocker };
}

describe("authored mining access layout", () => {
  it("gives the Lower Quarry and Gravelmaw separate settings with room for both approaches", () => {
    const site = mines.find((candidate) => candidate.id === "lower_quarry_bench")!;
    const region = REGIONS.find((candidate) => candidate.id === site.regionId)!;
    const envelope: Footprint = {
      id: site.id, x: site.centre[0], z: site.centre[1], yaw: site.rotationY,
      halfX: site.extent[0], halfZ: site.extent[1],
    };
    // Reserve a 24 m portal setting plus a 15 m open interval before the quarry envelope.
    // Checking the mine centre alone hid the former overlap between these two settings.
    expect(distanceToFootprint(region.dungeon!.entrance, envelope)).toBeGreaterThanOrEqual(39);
    const slide = region.obstacles.find((obstacle) => obstacle.id === "scree_slide")!;
    expect(distanceToFootprint(slide.exitPosition, envelope)).toBeGreaterThanOrEqual(8);
    for (const wall of region.settlement!.walls ?? []) {
      const result = corridorClearance(wall.from, wall.to, [envelope]);
      expect(result.clearance, wall.id).toBeGreaterThanOrEqual(8);
    }
    const halfWorldZ = Math.abs(Math.sin(site.rotationY)) * site.extent[0]
      + Math.abs(Math.cos(site.rotationY)) * site.extent[1];
    const terrace = region.terraces![0]!;
    expect(site.centre[1] - halfWorldZ).toBeGreaterThanOrEqual(terrace.minZ + 3);
    expect(site.centre[1] + halfWorldZ).toBeLessThanOrEqual(terrace.maxZ - 3);
  });

  it.each(mines)("$id has a clear circulation lane from its apron in front of every ore", (site) => {
    const solids = [
      ...site.dressing.filter((piece) => /^corealm_(rock|cliff)_|^(crate|workbench|barrel)/.test(piece.assetId))
        .map(dressingFootprint),
      ...oreFootprints(site),
    ];
    const apron: Point = [Math.sin(site.terrain.approachAngle) * 2, Math.cos(site.terrain.approachAngle) * 2];
    for (const slot of site.resourceSlots) {
      const result = corridorClearance(apron, aislePoint(site, slot), solids);
      // A 1.7 m clear aisle leaves room for the 0.35 m player and the 0.45 m navmesh inset.
      // This checks authored occupancy only. Real terrain, cut collision and navigation need
      // the root's browser proof from the connected road, without focusEntity teleport setup.
      expect(result.clearance, `${slot.clusterId}_${slot.index} blocked by ${result.blocker}`)
        .toBeGreaterThanOrEqual(0.85);
    }
  });

  it.each(mines)("$id keeps the working aisle connected between adjacent seams", (site) => {
    const solids = [
      ...site.dressing.filter((piece) => /^corealm_(rock|cliff)_|^(crate|workbench|barrel)/.test(piece.assetId))
        .map(dressingFootprint),
      ...oreFootprints(site),
    ];
    const ordered = site.cutFace!.stations.map((station) => site.resourceSlots.find((slot) =>
      slot.clusterId === station.clusterId && slot.index === station.index)!);
    for (let index = 1; index < ordered.length; index++) {
      const left = ordered[index - 1]!; const right = ordered[index]!;
      const result = corridorClearance(aislePoint(site, left), aislePoint(site, right), solids);
      expect(result.clearance, `${left.clusterId}_${left.index} to ${right.clusterId}_${right.index}: ${result.blocker}`)
        .toBeGreaterThanOrEqual(0.85);
    }
  });

  it.each(mines)("$id connects the broad lane to every measured production working position", site => {
    const solids = [
      ...site.dressing.filter(piece => /^corealm_(rock|cliff)_|^(crate|workbench|barrel)/.test(piece.assetId)).map(dressingFootprint),
      ...site.resourceSlots.map(slot => {
        const id = `${slot.clusterId}_${slot.index}`, entity = productionEntities.get(id)!;
        const view = entity.view!, size = modelSizes.get(view.assetId)!;
        const scale = view.scale! * tierSilhouetteScale(view.materialTier ?? entity.tier);
        return { id, x: slot.x, z: slot.z, yaw: slot.yaw, halfX: size.x * scale / 2, halfZ: size.z * scale / 2 };
      }),
    ];
    for (const slot of site.resourceSlots) {
      const id = `${slot.clusterId}_${slot.index}`, point = access.get(id)!;
      const dx = point[0] - site.centre[0], dz = point[2] - site.centre[1];
      const cos = Math.cos(site.rotationY), sin = Math.sin(site.rotationY);
      const work: Point = [dx * cos - dz * sin, dx * sin + dz * cos];
      expect(productionEntities.get(id)!.interactionPosition).toEqual(point);
      const result = corridorClearance(aislePoint(site, slot), work, solids);
      // Actual work positions intentionally come closer than the broad lane. Retain
      // the production body/nav clearance, measured against the current rendered ore.
      expect(result.clearance, `${id}: ${result.blocker}`).toBeGreaterThanOrEqual(PLAYER_RADIUS + 0.20);
    }
  });

  it.each(mines)("$id leaves a broad hauling approach clear through its full authored footprint", (site) => {
    const forward: Point = [Math.sin(site.terrain.approachAngle), Math.cos(site.terrain.approachAngle)];
    const reach = Math.min(
      site.extent[0] / Math.max(0.001, Math.abs(forward[0])),
      site.extent[1] / Math.max(0.001, Math.abs(forward[1])),
    );
    const result = corridorClearance([0, 0], [forward[0] * reach, forward[1] * reach], [
      ...site.dressing.map(dressingFootprint), ...oreFootprints(site),
    ]);
    expect(result.clearance, result.blocker).toBeGreaterThanOrEqual(1.8);
  });
});
