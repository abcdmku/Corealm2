/**
 * Builds the ground features shared by the playable world and the build-time map renderer.
 *
 * This belongs in the app composition layer: roads depend on authored content and the resolved
 * heightfield, while water asks the render scene to solve its exact shoreline.
 */
import type { Vec3 } from "../contracts.js";
import { isFairyRegion } from '../contracts.js';
import { FAIRY_ASCENT_ROUTES, FAIRY_VALLEY_ROUTE_CONTROLS } from '../world/fairyLandforms.js';
import { FAIRY_HOLLOW_ROUTES, FAIRY_UPPER_GARDEN_RAMPS } from '../world/fairyRegionalRelief.js';
import { castleGroundLayout } from '../render/compositions/crownwardCastles.js';
import {
  ESSENCE_ALTAR_COURT_RADIUS,
  REGIONS,
  type PavingAssetId,
  type RegionDef,
} from "../content/regions.js";
import { WORLD_SITES, worldSitePoint, type WorldSite } from "../content/worldSites.js";
import { resourceDef } from "../content/resources.js";
import {
  WorldScene, pavingStampFromRect,
  type PavingStamp, type PavingSurface, type RoadStamp, type WaterStamp,
} from "../render/scene.js";
import { WATER_FILL_DEPTH, waterBasinForCluster } from "../world/waterBodies.js";
import { fishingAccessPositions } from "./fishingAccess.js";
import { worldSiteHaulRamp } from "../world/siteTerrain.js";

export const DEFAULT_WORLD_SEED = 1337;

export interface PreparedWorldSurface {
  roadCount: number;
  pavingCount: number;
  waterCount: number;
}

/**
 * Applies every terrain stamp and solves every authored water surface.
 *
 * Pass this from `WorldScene.buildWorld`'s surface-preparation callback. At that point the shared
 * height lattice exists, so roads and organic shorelines resolve against their final ground, but
 * no terrain chunk has been shaded. The chunks then consume these final stamps on their first and
 * only vertex pass.
 */
export function prepareWorldSurface(
  scene: WorldScene,
  seed = DEFAULT_WORLD_SEED,
): PreparedWorldSurface {
  const paving = collectPavingStamps(scene);
  const water = collectWaterStamps(scene);
  const waterCount = buildWaterBodies(scene);
  const sites = WORLD_SITES.filter(site => pointInScene(scene, site.centre));
  const access = fishingAccessPositions(sites, scene.getWaterBodies(), (x, z) => scene.meshHeightAt(x, z));
  const roads = collectRoadStamps(scene, access);
  scene.setGroundStamps({ roads, paving, water, seed });
  return { roadCount: roads.length, pavingCount: paving.length, waterCount };
}

function pointInScene(scene: WorldScene, [x, z]: readonly [number, number]): boolean {
  const bounds = scene.getWorldBounds?.();
  return !bounds || (x >= bounds.minX && x <= bounds.maxX && z >= bounds.minZ && z <= bounds.maxZ);
}

/** Region centres identify which authored map owns its roads, paving and water. */
function regionsInScene(scene?: WorldScene): readonly RegionDef[] {
  return scene ? REGIONS.filter(region => pointInScene(scene, [
    (region.bounds.min[0] + region.bounds.max[0]) / 2,
    (region.bounds.min[1] + region.bounds.max[1]) / 2,
  ])) : REGIONS;
}

/**
 * Resolves authored links through actual gates. The scene's visual curve is also the line consumed
 * by foliage exclusions and the map; semantic navigation keeps the authored link unchanged.
 */
export function collectRoadStamps(scene: WorldScene, access: ReadonlyMap<string, Vec3> = new Map()): RoadStamp[] {
  const stamps: RoadStamp[] = [];
  for (const region of regionsInScene(scene)) {
    const locationById = new Map(region.locations.map((location) => [location.id, location]));
    for (const road of region.roads) {
      const sourceFrom = locationById.get(road.from);
      const sourceTo = locationById.get(road.to);
      if (!sourceFrom || !sourceTo) continue;
      const fairyControls = isFairyRegion(region.id) ? FAIRY_VALLEY_ROUTE_CONTROLS.find(route =>
        route.from === road.from && route.to === road.to) : undefined;
      if (fairyControls) {
        stamps.push({ width: 2.6, points: fairyControls.points.map(([x, z]) => [x, scene.heightAt(region.id, x, z), z]) });
        continue;
      }
      const fromAccess = access.get(sourceFrom.id);
      const toAccess = access.get(sourceTo.id);
      const from = fromAccess ? { ...sourceFrom, position: [fromAccess[0], fromAccess[2]] as [number, number] } : sourceFrom;
      const to = toAccess ? { ...sourceTo, position: [toAccess[0], toAccess[2]] as [number, number] } : sourceTo;

      const fromMine = WORLD_SITES.find((site) => site.kind === "mine" && site.locationId === from.id);
      const toMine = WORLD_SITES.find((site) => site.kind === "mine" && site.locationId === to.id);
      const waypoints = fromMine ? mineRoadApproach(fromMine, to.position) : [from.position];
      const settlement = region.settlement;
      const gates = settlement?.buildings.filter((building) => building.prefab === "gatehouse") ?? [];
      if (settlement && gates.length > 0) {
        const distanceToCentre = (point: readonly [number, number]): number =>
          Math.hypot(point[0] - settlement.centre[0], point[1] - settlement.centre[1]);
        const perimeter = Math.max(...gates.map((gate) => distanceToCentre(gate.position)));
        const fromInside = distanceToCentre(from.position) < perimeter - 1;
        const toInside = distanceToCentre(to.position) < perimeter - 1;
        if (fromInside !== toInside) {
          const gate = gates.reduce((best, candidate) => {
            const routeLength = (entry: typeof candidate): number =>
              Math.hypot(entry.position[0] - from.position[0], entry.position[1] - from.position[1]) +
              Math.hypot(to.position[0] - entry.position[0], to.position[1] - entry.position[1]);
            return routeLength(candidate) < routeLength(best) ? candidate : best;
          });
          // Hold the centreline on the gate's opening axis for a few metres on either side. The
          // curve pass returns to every one of these controls, so its meander cannot graze a pier.
          let outwardX = Math.sin(gate.rotationY);
          let outwardZ = Math.cos(gate.rotationY);
          const gateFromCentreX = gate.position[0] - settlement.centre[0];
          const gateFromCentreZ = gate.position[1] - settlement.centre[1];
          if (outwardX * gateFromCentreX + outwardZ * gateFromCentreZ < 0) {
            outwardX *= -1;
            outwardZ *= -1;
          }
          const travelSign = fromInside ? 1 : -1;
          const travelX = outwardX * travelSign;
          const travelZ = outwardZ * travelSign;
          const approach = Math.min(
            5,
            Math.hypot(gate.position[0] - from.position[0], gate.position[1] - from.position[1]) * 0.35,
            Math.hypot(to.position[0] - gate.position[0], to.position[1] - gate.position[1]) * 0.35,
          );
          if (approach > 0.5) {
            waypoints.push(
              [gate.position[0] - travelX * approach, gate.position[1] - travelZ * approach],
              gate.position,
              [gate.position[0] + travelX * approach, gate.position[1] + travelZ * approach],
            );
          } else {
            waypoints.push(gate.position);
          }
        }
      }
      waypoints.push(...(toMine ? mineRoadApproach(toMine, from.position).reverse() : [to.position]));

      // Do not fill the link with straight six-metre samples here. Each sample becomes a hard
      // control in `curveRoadPolyline`, which used to suppress the meander entirely.
      const points: Vec3[] = waypoints.map(([x, z]) => [x, scene.heightAt(region.id, x, z), z]);
      stamps.push({ points, width: isFairyRegion(region.id) ? 2.6 : 3.2 });
    }
  }
  for (const route of FAIRY_ASCENT_ROUTES) if (pointInScene(scene, route.points[0]!)) {
    stamps.push({ width: route.width, points: route.points.map(([x, z]) => [x, scene.heightAt(route.regionId, x, z), z]) });
  }
  for (const route of FAIRY_HOLLOW_ROUTES) if (pointInScene(scene, route[0]!)) {
    stamps.push({ width: 2.6, points: route.map(([x, z]) => [x, scene.meshHeightAt(x, z), z]) });
  }
  for (const ramp of FAIRY_UPPER_GARDEN_RAMPS) if (pointInScene(scene, ramp.points[0]!.position)) {
    stamps.push({ width: 2.6, points: ramp.points.map(({ position: [x, z] }) => [x, scene.meshHeightAt(x, z), z]) });
  }
  return stamps;
}

/** Workings are reached across their open apron; onward roads pass around the rock face. */
function mineRoadApproach(site: WorldSite, other: readonly [number, number]): (readonly [number, number])[] {
  const dx = other[0] - site.centre[0], dz = other[1] - site.centre[1];
  const angle = site.terrain.approachAngle;
  const bearing = site.rotationY + angle;
  const localX = dx * Math.cos(bearing) - dz * Math.sin(bearing);
  const localZ = dx * Math.sin(bearing) + dz * Math.cos(bearing);
  const ramp = worldSiteHaulRamp(site);
  const approachPoint = (x: number, z: number) => worldSitePoint(site,
    x * Math.cos(angle) + z * Math.sin(angle), -x * Math.sin(angle) + z * Math.cos(angle));
  const points: (readonly [number, number])[] = [site.centre,
    approachPoint(0, ramp.startDistance), approachPoint(0, (ramp.startDistance + ramp.endDistance) / 2), ramp.worldEnd];
  if (localZ < 0) {
    // Clearance includes the road curve's nine-metre meander and its worn shoulder.
    const halfSide = site.extent[0] * Math.abs(Math.cos(angle)) + site.extent[1] * Math.abs(Math.sin(angle));
    const halfDepth = site.extent[0] * Math.abs(Math.sin(angle)) + site.extent[1] * Math.abs(Math.cos(angle));
    const side = (localX < 0 ? -1 : 1) * (halfSide + 12);
    points.push(approachPoint(side, ramp.endDistance), approachPoint(side, -halfDepth - 12));
  }
  return points;
}

/**
 * What each paving asset means as a stamped surface.
 *
 * The authored vocabulary is still an asset id, because that is also what `audio/surface.ts` reads
 * for footsteps and what a settlement author is choosing between. The ground draws the courses
 * itself now, so the id only has to say which of the three figures it is.
 */
const PAVING_SURFACES: Record<PavingAssetId, PavingSurface> = {
  floor_cobble: "stone",
  floor_brick: "brick",
  floor_wood: "plank",
  floor_wood_light: "plank",
};

export function collectPavingStamps(scene?: WorldScene): PavingStamp[] {
  const stamps: PavingStamp[] = [];
  for (const region of regionsInScene(scene)) {
    for (const castle of region.landmarks) {
      const layout = castleGroundLayout(castle.composition);
      if (!layout) continue;
      stamps.push({centre:castle.position,halfExtents:[layout.paving[0]/2,layout.paving[1]/2],rotationY:castle.rotationY ?? 0,surface:'stone',kerb:false});
    }
    for (const paving of region.settlement?.paving ?? []) {
      stamps.push(pavingStampFromRect(paving.rect, {
        surface: PAVING_SURFACES[paving.assetId],
        kerb: paving.kerb,
      }));
    }
    for (const altar of region.stations.filter((station) => station.kind === "essence_altar")) {
      // The ruin court is the ground itself, not a second plane laid over it. `stone` resolves
      // through the region palette, so each site uses its local limestone, forest stone, or slate
      // and the unkerbed edge wears naturally back into the surrounding biome.
      stamps.push({
        centre: altar.position,
        halfExtents: [ESSENCE_ALTAR_COURT_RADIUS, ESSENCE_ALTAR_COURT_RADIUS],
        rotationY: altar.rotationY,
        surface: "stone",
        kerb: false,
      });
    }
  }
  return stamps;
}

export function collectWaterStamps(scene: WorldScene): WaterStamp[] {
  const stamps: WaterStamp[] = [];
  for (const region of regionsInScene(scene)) {
    for (const cluster of region.clusters) {
      if (cluster.waterBodyId || resourceDef(cluster.resourceId).archetype !== "fishing_spot") continue;
      const [x, z] = cluster.centre;
      const basin = waterBasinForCluster(cluster);
      stamps.push({
        centre: [x, z],
        radius: basin.crestRadius,
        level: scene.heightAt(region.id, x, z) + WATER_FILL_DEPTH,
        shape: basin.shape,
      });
    }
  }
  return stamps;
}

export function buildWaterBodies(scene: WorldScene): number {
  let built = 0;
  for (const region of regionsInScene(scene)) {
    for (const cluster of region.clusters) {
      if (cluster.waterBodyId || resourceDef(cluster.resourceId).archetype !== "fishing_spot") continue;
      const [x, z] = cluster.centre;
      const half = waterBasinForCluster(cluster).crestRadius;
      const floor = scene.heightAt(region.id, x, z);
      scene.buildWater(
        { minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half },
        floor + WATER_FILL_DEPTH,
        region.id,
      );
      built += 1;
    }
  }
  return built;
}
