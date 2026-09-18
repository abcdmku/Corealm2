import { WILDERNESS_ROAD_BRAZIERS } from "../content/wildernessLandmarks.js";
import { WILDERNESS_RUINS, type WildernessRuinId } from "../render/compositions/wildernessRuins.js";
import { DEEP_WILDERNESS_STRUCTURES, type DeepWildernessStructureId } from "../render/compositions/deepWildernessStructures.js";
import { WILDERNESS_LAVA_CHANNELS, lavaSections } from "../content/wildernessLava.js";
import type { SolidVolume, Vec3 } from "../contracts.js";
import type { WorldScene } from "../render/scene.js";
import type { ResolvedWorldSiteDressing } from "../render/worldSiteDressing.js";
import { REGIONS, REGIONAL_ESSENCE_ALTARS, ESSENCE_ALTAR_CLEAR_RADIUS } from "../content/regions.js";
import { WORLD_SITES, worldSitePoint } from "../content/worldSites.js";
import { worldSiteHaulRamp } from "../world/siteTerrain.js";
import { worldExclusions } from "../world/scatter.js";

import { isFairyRegion } from "../contracts.js";
import { FAIRY_COMBAT_PLATEAUS, FAIRY_DEEP_PATH_CLEARINGS } from "../world/fairyLandforms.js";
import { FAIRY_GARDEN_LANDINGS } from "../world/fairyRegionalRelief.js";
import { castleGroundLayout } from "../render/compositions/crownwardCastles.js";

export function registerExclusions(
  scene: WorldScene,
  solids: readonly SolidVolume[],
  dressing: readonly ResolvedWorldSiteDressing[],
  fairyScene?: WorldScene,
): void {
  worldExclusions.clear();
  // Keep the entire encounter floor usable while trees frame its outer rim.
  // Tree-only clearance leaves the fine ground cover and flowers in these glades.
  for (const landing of FAIRY_GARDEN_LANDINGS) {
    worldExclusions.addCorridor([[landing.from[0], 0, landing.from[1]],
      [landing.to[0], 0, landing.to[1]]], landing.halfWidth * 2, 'road', `${landing.id}:landing`);
    worldExclusions.addTreeClearance([[landing.from[0], 0, landing.from[1]],
      [landing.to[0], 0, landing.to[1]]], landing.halfWidth + 1, `${landing.id}:landing`);
  }
  for (const plateau of FAIRY_COMBAT_PLATEAUS) {
    worldExclusions.addTreeClearance([[plateau.centre[0], 0, plateau.centre[1]]],
      plateau.clearingRadius + 5, `${plateau.id}:crown-clearance`);
  }
  for (const clearing of FAIRY_DEEP_PATH_CLEARINGS) {
    worldExclusions.addTreeClearance([[clearing.position[0], 0, clearing.position[1]]],
      clearing.radius + 2, `${clearing.id}:valley-clearance`);
  }
  for (const body of scene.getWaterBodies()) if (body.id.startsWith("river:")) {
    worldExclusions.addCircle(body.centre[0], body.centre[1], body.radii.outer + 2, "custom", body.id);
  }
  // Reserve the entire carved bank, including the footprint of large dressing rocks.
  // Production bank detail owns this strip; general biome scatter starts beyond it.
  for (const channel of WILDERNESS_LAVA_CHANNELS) {
    for (const section of lavaSections(channel, 2)) {
      worldExclusions.addCircle(section.x, section.z,
        section.halfWidth + channel.bankWidth + 1.5, 'custom', `lava-bank:${channel.id}`);
    }
    for (const mass of channel.rockMasses ?? []) {
      if (mass.weathered) continue; // Ordinary scatter follows the shared sloping ground outside the reserved channel.
      const x = mass.polygon.reduce((sum, p) => sum + p[0], 0) / mass.polygon.length;
      const z = mass.polygon.reduce((sum, p) => sum + p[1], 0) / mass.polygon.length;
      const radius = Math.max(...mass.polygon.map(p => Math.hypot(p[0] - x, p[1] - z))) + 3;
      worldExclusions.addCircle(x, z, radius, 'custom', `lava-landform:${mass.id}`);
    }
  }
  for (const [index,[x,z]] of WILDERNESS_ROAD_BRAZIERS.entries()) {
    worldExclusions.addCircle(x,z,2,'building',`wilderness-road-brazier-${index}`);
  }
  const authoredLocations = new Set(WORLD_SITES.map((site) => site.locationId));
  const authoredClusters = new Set(WORLD_SITES.flatMap((site) => site.resourceSlots.map((slot) => slot.clusterId)));
  for (const region of REGIONS) {
    for (const castle of region.landmarks) {
      const layout = castleGroundLayout(castle.composition);
      if (!layout) continue;
      worldExclusions.addOrientedRect(castle.position[0],castle.position[1],layout.exclusion[0],layout.exclusion[1],castle.rotationY ?? 0,2,'building',castle.id);
    }
    for (const landmark of region.landmarks) {
      const ruin = WILDERNESS_RUINS[landmark.composition as WildernessRuinId]
        ?? DEEP_WILDERNESS_STRUCTURES[landmark.composition as DeepWildernessStructureId];
      if (ruin) worldExclusions.addOrientedRect(landmark.position[0],landmark.position[1],
        ruin.footprint[0]+4,ruin.footprint[1]+4,landmark.rotationY??0,2,'building',landmark.id);
    }
    for (const location of region.locations) {
      // These are route/door anchors, not clearings. Their roads and physical footprints
      // reserve walking space; overlapping five-metre discs erase the planted village banks.
      if (isFairyRegion(region.id) && (location.id.startsWith('lantern_rest_')
        || location.id.startsWith('prism_hollow_'))) continue;
      if (!authoredLocations.has(location.id)) {
        worldExclusions.addCircle(location.position[0], location.position[1], 5, "cluster", location.id);
      }
    }
    for (const cluster of region.clusters) {
      if (!authoredClusters.has(cluster.id)) {
        worldExclusions.addCircle(cluster.centre[0], cluster.centre[1], cluster.radius + 2, "cluster", cluster.id);
      }
    }
  }
  for (const solid of solids) {
    // Underground walls must not clear visible vegetation on the terrain above them.
    const top = solid.position[1] + (solid.kind === "box" ? solid.size[1] : solid.height);
    const probes: [number, number][] = [[solid.position[0], solid.position[2]]];
    if (solid.kind === "box") {
      const cos = Math.cos(solid.rotationY), sin = Math.sin(solid.rotationY);
      for (const x of [-solid.size[0] / 2, 0, solid.size[0] / 2]) {
        for (const z of [-solid.size[2] / 2, 0, solid.size[2] / 2]) {
          probes.push([solid.position[0] + x * cos + z * sin, solid.position[2] - x * sin + z * cos]);
        }
      }
    } else {
      for (let i = 0; i < 8; i++) probes.push([
        solid.position[0] + Math.cos(i * Math.PI / 4) * solid.radius,
        solid.position[2] + Math.sin(i * Math.PI / 4) * solid.radius,
      ]);
    }
    if (probes.every(([x, z]) => (fairyScene && x >= fairyScene.getWorldBounds().minX
      ? fairyScene : scene).meshHeightAt(x, z) > top + 0.5)) continue;
    if (solid.kind === "box") {
      worldExclusions.addOrientedRect(solid.position[0], solid.position[2], solid.size[0], solid.size[2], solid.rotationY, 0.4, "building", solid.id);
    } else {
      worldExclusions.addCircle(solid.position[0], solid.position[2], solid.radius + 0.5, "custom", solid.id);
    }
  }
  for (const piece of dressing) {
    if (piece.size[1] < 0.35 || /^corealm_(fern|shrub|flower)_/.test(piece.assetId)) continue;
    worldExclusions.addOrientedRect(
      piece.position[0] + piece.centreOffset[0], piece.position[2] + piece.centreOffset[1],
      piece.size[0], piece.size[2], piece.rotationY, 0.15, "custom", piece.id,
    );
  }
  for (const site of WORLD_SITES) {
    if (site.kind === "mine") {
      const ramp = worldSiteHaulRamp(site);
      const approach = ramp.worldEnd;
      worldExclusions.addCircle(site.centre[0], site.centre[1], site.workRadius, "worksite", site.id);
      worldExclusions.addCorridor([[site.centre[0], 0, site.centre[1]], [approach[0], 0, approach[1]]], 4.5, "worksite", site.id);
      const aisle: Vec3[] = site.resourceSlots.map((slot) => {
        const point = worldSitePoint(site, slot.x + Math.sin(slot.yaw) * 2.1, slot.z + Math.cos(slot.yaw) * 2.1);
        return [point[0], 0, point[1]];
      });
      worldExclusions.addCorridor(aisle, 2.4, "worksite", `${site.id}:working-aisle`);
    }
    for (const slot of site.resourceSlots) {
      const point = worldSitePoint(site, slot.x, slot.z);
      worldExclusions.addCircle(point[0], point[1], site.kind === "grove" ? 1.8 : 1.6, "cluster", `${slot.clusterId}_${slot.index}`);
    }
  }
  for (const altar of Object.values(REGIONAL_ESSENCE_ALTARS)) {
    worldExclusions.addCircle(altar.position[0], altar.position[1], ESSENCE_ALTAR_CLEAR_RADIUS, "ritual", altar.id);
  }
  for (const [index, points] of [...scene.getRoadPolylines(), ...(fairyScene?.getRoadPolylines() ?? [])].entries()) {
    const fairyBounds = fairyScene?.getWorldBounds();
    const fairyRoad = fairyBounds && points.every(point => point[0] >= fairyBounds.minX && point[0] <= fairyBounds.maxX
      && point[2] >= fairyBounds.minZ && point[2] <= fairyBounds.maxZ);
    worldExclusions.addCorridor(points, fairyRoad ? 1.3 : 5, "road", `resolved-road-${index}`);
  }
}
