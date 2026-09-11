import { STARTER_SHARED_PACK_RESERVATIONS, STARTER_HABITATS, STARTER_GROUPS } from "../game/src/content/starterHabitats.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import MANIFEST from "../game/public/assets/manifest.json";
import { collectRoadStamps } from "../game/src/app/worldSurface.js";
import { REGIONS, ESSENCE_ALTAR_COURT_RADIUS, type Spot } from "../game/src/content/regions.js";
import { REGIONAL_PACKS, type RegionalPackDef } from "../game/src/content/regionalPacks.js";
import { activatedRegionalPackIds, REGIONAL_PACK_ACTIVATION } from "../game/src/content/regionalPackActivation.js";
import { createRpgRegionalPackCatalogue } from "../game/src/content/rpgRegionalPacks.js";
import { BIOME_POPULATION_HABITATS } from "../game/src/content/biomePopulation.js";
import { resourceDef } from "../game/src/content/resources.js";
import { WORLD_HABITATS, habitatForGroup, type HabitatDef } from "../game/src/content/worldHabitats.js";
import { WORLD_SITES, worldSitePoint } from "../game/src/content/worldSites.js";
import { tierSilhouetteScale } from "../game/src/core/math.js";
import {
  BUILDING_KITS, buildComposition, buildPrefab, buildWallRun, variantSeed, type PartPlacement,
} from "../game/src/render/buildings.js";
import type { WorldScene } from "../game/src/render/scene.js";
import { authoredThresholds } from "../game/src/world/dungeonDoors.js";
import { habitatIdleTargets } from "../game/src/world/habitatMovement.js";
import { structureEntitiesFromParts } from "../game/src/world/regionBuilder.js";
import { waterBasinForCluster } from "../game/src/world/waterBodies.js";

// These are source reservation checks. A pack radius includes every actor's body and idle
// movement. A passing disc test does not prove terrain, solved shores, forest collision or nav.
type Reservation = { id: string; distance: (point: Spot) => number; margin: number };
type Rect = { centre: Spot; half: Spot; yaw: number };
const assets = new Map(MANIFEST.assets.map((asset) => [asset.id, asset]));
const packIds = new Set(REGIONAL_PACKS.map((pack) => pack.id));
const populationIds = new Set(BIOME_POPULATION_HABITATS.map((habitat) => habitat.groupId));
// Match boot's accepted catalogue, including assignment overrides and native asset measurements.
// The other source plans remain useful authoring candidates, but do not occupy the live world.
const activatedPackIds = activatedRegionalPackIds();
const activeCatalogue = createRpgRegionalPackCatalogue((id) => {
  const asset = assets.get(id);
  return asset ? { size: asset.size, base: asset.base } : null;
}, activatedPackIds, REGIONAL_PACK_ACTIVATION.assignmentOverrides);
// Once integrated, packs are checked against each other below, not counted a second time as
// old content. Habitat identity uses groupId because its own id can have a habitat suffix.
const existingHabitats = WORLD_HABITATS.filter((habitat) => !packIds.has(habitat.groupId) && !STARTER_SHARED_PACK_RESERVATIONS[habitat.groupId]);
const surfaceGroups = REGIONS.flatMap((region) => region.enemyGroups)
  .filter((group) => !packIds.has(group.id) && !STARTER_SHARED_PACK_RESERVATIONS[group.id]);
const groupsById = new Map(surfaceGroups.map((group) => [group.id, group]));

function groupVisualRadius(groupId: string): number {
  const group = groupsById.get(groupId);
  if (!group) throw new Error(`${groupId}: no canonical surface group`);
  const asset = assets.get(group.assetId);
  if (!asset) throw new Error(`${groupId}: no native asset measurements for ${group.assetId}`);
  // Measure about the real model origin so offset bodies and tails remain covered at every yaw.
  return Math.hypot(
    Math.max(Math.abs(asset.base.x), Math.abs(asset.base.x + asset.size.x)),
    Math.max(Math.abs(asset.base.z), Math.abs(asset.base.z + asset.size.z)),
  ) * group.scale * tierSilhouetteScale(group.tier);
}

function habitatBodyMargin(groupId: string): number {
  return Math.max(3, groupVisualRadius(groupId) + 0.45);
}

function segmentDistance(point: Spot, from: Spot, to: Spot): number {
  const dx = to[0] - from[0], dz = to[1] - from[1];
  const squared = dx * dx + dz * dz;
  const t = squared === 0 ? 0 : Math.max(0, Math.min(1,
    ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / squared));
  return Math.hypot(point[0] - from[0] - t * dx, point[1] - from[1] - t * dz);
}

function rectDistance(point: Spot, rect: Rect): number {
  const dx = point[0] - rect.centre[0], dz = point[1] - rect.centre[1];
  const localX = dx * Math.cos(rect.yaw) - dz * Math.sin(rect.yaw);
  const localZ = dx * Math.sin(rect.yaw) + dz * Math.cos(rect.yaw);
  return Math.hypot(Math.max(0, Math.abs(localX) - rect.half[0]),
    Math.max(0, Math.abs(localZ) - rect.half[1]));
}

function disc(id: string, centre: Spot, radius: number, margin = 1): Reservation {
  return { id, margin, distance: (point) => Math.hypot(point[0] - centre[0], point[1] - centre[1]) - radius };
}

function box(id: string, rect: Rect, margin = 1): Reservation {
  return { id, margin, distance: (point) => rectDistance(point, rect) };
}

function corridor(id: string, from: Spot, to: Spot, radius: number, margin = 1): Reservation {
  return { id, margin, distance: (point) => segmentDistance(point, from, to) - radius };
}

function nativeBox(id: string, assetId: string, origin: Spot, yaw: number,
  scale: number | readonly [number, number, number] = 1): Reservation {
  const asset = assets.get(assetId);
  if (!asset) throw new Error(`${id}: no native asset measurements for ${assetId}`);
  const sx = typeof scale === "number" ? scale : scale[0];
  const sz = typeof scale === "number" ? scale : scale[2];
  const x = (asset.base.x + asset.size.x / 2) * sx;
  const z = (asset.base.z + asset.size.z / 2) * sz;
  return box(id, {
    centre: [origin[0] + x * Math.cos(yaw) + z * Math.sin(yaw),
      origin[1] - x * Math.sin(yaw) + z * Math.cos(yaw)],
    half: [asset.size.x * sx / 2, asset.size.z * sz / 2], yaw,
  });
}

function partBoxes(id: string, parts: readonly PartPlacement[], origin: Spot, yaw: number): Reservation[] {
  // Use the production placement conversion, including rounded transforms and scale axes.
  return structureEntitiesFromParts(parts, {
    origin: [origin[0], 0, origin[1]], rotationY: yaw, regionId: "fallowmarch",
    tier: 1, ownerId: id, name: id,
  }).map((entity) => {
    const view = entity.view;
    if (!view) throw new Error(`${entity.id}: production structure part has no view`);
    const scale = view.scale ?? 1;
    const axes = view.scaleAxes ?? [1, 1, 1];
    return nativeBox(entity.id, view.assetId, [entity.position[0], entity.position[2]],
      view.rotationY ?? 0, [scale * axes[0], scale * axes[1], scale * axes[2]]);
  });
}

function failures(reservations: readonly Reservation[],
  packs: readonly Pick<RegionalPackDef, "id" | "centre" | "radius">[] = REGIONAL_PACKS): string[] {
  const errors: string[] = [];
  for (const pack of packs) for (const reserve of reservations) {
    const gap = reserve.distance(pack.centre) - pack.radius;
    if (gap + 1e-7 < reserve.margin) {
      errors.push(`${pack.id} / ${reserve.id}: ${gap.toFixed(3)} m edge gap; requires ${reserve.margin} m`);
    }
  }
  return errors;
}

const sceneSource = readFileSync(new URL("../game/src/render/scene.ts", import.meta.url), "utf8");
function sceneConstant(name: string): number {
  const match = sceneSource.match(new RegExp(`const ${name} = ([0-9.]+);`));
  if (!match) throw new Error(`Review pack road reservations: production ${name} changed`);
  return Number(match[1]);
}
const roadSway = sceneConstant("ROAD_MAX_SWAY");
const roadDefaultWidth = sceneConstant("ROAD_DEFAULT_WORN_WIDTH");
const roadFade = sceneConstant("ROAD_FADE_METRES");
const roadVerge = sceneConstant("ROAD_VERGE_METRES");
const roadWidthDrift = sceneConstant("ROAD_WIDTH_DRIFT");
const roads = collectRoadStamps({ heightAt: () => 0 } as unknown as WorldScene);
const roadReservations = roads.flatMap((road, roadIndex) => {
  const width = road.width ?? roadDefaultWidth;
  const fullVisibleHalfWidth = (width / 2 + (roadFade + roadVerge) * width / roadDefaultWidth)
    * (1 + roadWidthDrift);
  return road.points.slice(0, -1).map((from, index) => {
    const to = road.points[index + 1]!;
    return corridor(`road ${roadIndex}/control leg ${index}`, [from[0], from[2]], [to[0], to[2]],
      roadSway + fullVisibleHalfWidth, 1e-6);
  });
});

const waterReservations = REGIONS.flatMap((region) => region.clusters
  .filter((cluster) => resourceDef(cluster.resourceId).archetype === "fishing_spot")
  .map((cluster) => disc(cluster.id, cluster.centre, waterBasinForCluster(cluster).outerRadius, 1)));
const siteReservations = WORLD_SITES.flatMap((site) => [
  box(site.id, { centre: site.centre, half: site.extent, yaw: site.rotationY }, 1),
  ...site.dressing.map((piece) => nativeBox(`${site.id}/${piece.id}`, piece.assetId,
    worldSitePoint(site, piece.x, piece.z), site.rotationY + piece.yaw, piece.scale)),
]);
function reserveHabitats(habitats: readonly HabitatDef[]): Reservation[] {
  return habitats.flatMap((habitat) => [
    disc(habitat.id, habitat.centre, habitat.radius, habitatBodyMargin(habitat.groupId)),
    ...habitat.dressing.map((piece) => nativeBox(`${habitat.id}/${piece.id}`, piece.assetId,
      [piece.x, piece.z], piece.yaw, piece.scale)),
  ]);
}
const habitatReservations = reserveHabitats(existingHabitats);
// Preserve the original source-plan gate against the original habitats. The accepted population
// may use pockets held only by unactivated candidates; its live overlap gate follows below.
const originalHabitatReservations = reserveHabitats(existingHabitats.filter(habitat => !populationIds.has(habitat.groupId)));
const fullyAnchoredGroups = surfaceGroups.filter((group) => !group.boss && !group.miniBoss
  && (habitatForGroup(group.id)?.anchors.length ?? 0) >= group.count);
const fullyAnchoredIds = new Set(fullyAnchoredGroups.map((group) => group.id));
// Production always uses a supplied habitat anchor before its generated legacy spot. Preserve
// the legacy disc only when some members can still reach that fallback placement path.
const encounterReservations = surfaceGroups.filter((group) => !fullyAnchoredIds.has(group.id)).map((group) =>
  // Bosses already reserve a broad 32 m encounter floor, with a further metre outside it.
  // Ordinary group radii are actor-origin reservations and need the complete model envelope.
  disc(group.id, group.centre, group.boss || group.miniBoss ? Math.max(32, group.radius) : group.radius,
    group.boss || group.miniBoss ? 1 : habitatBodyMargin(group.id)));
const resourceReservations = REGIONS.flatMap((region) => region.clusters
  .filter((cluster) => resourceDef(cluster.resourceId).archetype !== "fishing_spot")
  .map((cluster) => disc(cluster.id, cluster.centre, cluster.radius, 3)));

const settlementReservations = REGIONS.flatMap((region) => {
  const town = region.settlement;
  if (!town) return [];
  return [
    ...(town.padShape ? [box(`${town.id}/pad`, { centre: town.centre,
      half: [town.padShape.halfX, town.padShape.halfZ], yaw: town.padShape.rotationY }, 6)] : []),
    ...town.buildings.flatMap((building) => partBoxes(building.id,
      buildPrefab(building.prefab, building.footprint, variantSeed(building.id), town.kit),
      building.position, building.rotationY)),
    ...(town.walls ?? []).flatMap((wall) => {
      const length = Math.hypot(wall.to[0] - wall.from[0], wall.to[1] - wall.from[1]);
      const yaw = Math.atan2(-(wall.to[1] - wall.from[1]), wall.to[0] - wall.from[0]);
      return partBoxes(wall.id, buildWallRun(length, wall.openings ?? [], BUILDING_KITS[town.kit],
        variantSeed(wall.id)), wall.from, yaw);
    }),
    ...(town.props ?? []).map((prop) => nativeBox(prop.id, prop.assetId, prop.position,
      prop.rotationY, prop.scale ?? 1)),
  ];
});

const routeAndLandmarkReservations = REGIONS.flatMap((region) => [
  ...region.obstacles.flatMap((obstacle) => [
    corridor(obstacle.id, obstacle.position, obstacle.exitPosition, 6),
    nativeBox(obstacle.id, obstacle.assetId, obstacle.position, obstacle.rotationY ?? 0, obstacle.scale ?? 1),
    ...(obstacle.composition ? partBoxes(`${obstacle.id}/setting`,
      buildComposition(obstacle.composition, variantSeed(obstacle.id), region.settlement?.kit ?? "stone"),
      obstacle.position, obstacle.rotationY ?? 0) : []),
  ]),
  ...region.landmarks.flatMap((landmark) => [
    disc(landmark.id, landmark.position, landmark.composition === "farm_yard" ? 20 : 8),
    ...(assets.has(landmark.assetId) ? [nativeBox(landmark.id, landmark.assetId, landmark.position,
      landmark.rotationY ?? 0, landmark.scale ?? 1)] : []),
    ...(landmark.composition ? partBoxes(`${landmark.id}/setting`,
      buildComposition(landmark.composition, variantSeed(landmark.id), region.settlement?.kit ?? "stone"),
      landmark.position, landmark.rotationY ?? 0) : []),
  ]),
  ...region.gates.flatMap((gate) => [
    disc(gate.id, gate.position, 12),
    ...(gate.composition ? partBoxes(`${gate.id}/setting`,
      buildComposition(gate.composition, variantSeed(gate.id), region.settlement?.kit ?? "stone"),
      gate.position, gate.rotationY ?? 0) : []),
  ]),
  ...region.stations.filter((station) => station.kind === "essence_altar")
    .map((station) => disc(station.id, station.position, ESSENCE_ALTAR_COURT_RADIUS, 3)),
]);

const dungeonReservations = REGIONS.flatMap((region) => {
  const dungeon = region.dungeon;
  if (!dungeon) return [];
  return [
    disc(`${dungeon.id}/mouth`, dungeon.entrance, 16),
    // The mine moved, but this is still the surface approach to the entrance at [46, -24].
    disc(`${dungeon.id}/original quarry approach`, [60, -16], 16),
    corridor(`${dungeon.id}/mouth approach`, dungeon.entrance, [60, -16], 8),
    ...(dungeon.entranceComposition ? partBoxes(`${dungeon.id}/mouth setting`,
      buildComposition(dungeon.entranceComposition, variantSeed("gravelmaw_mouth_portal"), region.settlement?.kit ?? "stone"),
      dungeon.entrance, dungeon.entranceRotationY ?? 0) : []),
    ...dungeon.chambers.map((chamber) => disc(chamber.id, chamber.centre, chamber.radius + 5)),
    // Production boot connects consecutive chambers with 6 m corridors. The seven-metre
    // reservation also protects their shell and side walls in XZ, even where they lie underground.
    ...dungeon.chambers.slice(0, -1).map((chamber, index) => corridor(
      `${dungeon.id}/corridor ${index}`, chamber.centre, dungeon.chambers[index + 1]!.centre, 7)),
    ...authoredThresholds(dungeon, 0).flatMap((threshold) => [threshold.barrier, ...threshold.staticSolids]
      .map((solid) => box(solid.id, { centre: [solid.position[0], solid.position[2]],
        half: [solid.size[0] / 2, solid.size[2] / 2], yaw: solid.rotationY }))),
    ...dungeon.obstacles.map((obstacle) => corridor(obstacle.id, obstacle.position, obstacle.exitPosition, 6)),
  ];
});

describe("regional pack source reservations", () => {
  it("checks every authored pack and maintains two-metre aisles between full reservations", () => {
    expect(REGIONAL_PACKS).toHaveLength(96);
    const errors: string[] = [];
    for (const region of REGIONS.filter(region => region.id !== "wilderness")) {
      expect(REGIONAL_PACKS.filter((pack) => pack.regionId === region.id), region.id).toHaveLength(24);
    }
    for (const [index, pack] of REGIONAL_PACKS.entries()) {
      const region = REGIONS.find((entry) => entry.id === pack.regionId)!;
      const boundaryGap = Math.min(pack.centre[0] - region.bounds.min[0], region.bounds.max[0] - pack.centre[0],
        pack.centre[1] - region.bounds.min[1], region.bounds.max[1] - pack.centre[1]) - pack.radius;
      expect(boundaryGap, `${pack.id}: full reservation crosses semantic boundary`).toBeGreaterThanOrEqual(1);
      for (const other of REGIONAL_PACKS.slice(index + 1)) {
        const gap = Math.hypot(pack.centre[0] - other.centre[0], pack.centre[1] - other.centre[1])
          - pack.radius - other.radius;
        if (gap < 2 - 1e-7) errors.push(`${pack.id} / ${other.id}: ${gap.toFixed(3)} m between pack edges`);
      }
    }
    expect(errors).toEqual([]);
  });

  it("reserves every production road control with the full possible meander, fade and verge", () => {
    expect(roads.length).toBeGreaterThan(50);
    expect(roadReservations.length).toBeGreaterThan(roads.length);
    expect(failures(roadReservations)).toEqual([]);
  });

  it("clears whole water basins and rotated resource sites, including native dressing", () => {
    expect(waterReservations).toHaveLength(5);
    expect(siteReservations.length).toBeGreaterThan(WORLD_SITES.length);
    expect(failures([...waterReservations, ...siteReservations, ...resourceReservations])).toEqual([]);
  });

  it("contains shared starter occupants and their idle routes within their parent reservation", () => {
    const envelopes: { id: string; points: Spot[]; radius: number }[] = [];
    for (const [groupId, packId] of Object.entries(STARTER_SHARED_PACK_RESERVATIONS)) {
      const pack = REGIONAL_PACKS.find(row => row.id === packId)!;
      const group = STARTER_GROUPS.find(row => row.id === groupId)!;
      const habitat = STARTER_HABITATS.find(row => row.groupId === groupId)!;
      expect(pack, packId).toBeDefined(); expect(group, groupId).toBeDefined(); expect(habitat, groupId).toBeDefined();
      expect(habitat.regionId).toBe(pack.regionId);
      const asset = assets.get(group.assetId)!;
      const radius = Math.hypot(Math.max(Math.abs(asset.base.x), Math.abs(asset.base.x + asset.size.x)),
        Math.max(Math.abs(asset.base.z), Math.abs(asset.base.z + asset.size.z))) * group.scale * tierSilhouetteScale(group.tier);
      const points: Spot[] = [];
      for (let index = 0; index < group.count; index++) {
        const anchor = habitat.anchors[index]!;
        const id = group.count === 1 ? groupId : `${groupId}_${index + 1}`;
        points.push(anchor, ...habitatIdleTargets(id, [anchor[0], 0, anchor[1]], habitat).candidates
          .map(target => [target.position[0], target.position[2]] as Spot));
      }
      for (const point of points) expect(Math.hypot(point[0] - pack.centre[0], point[1] - pack.centre[1]) + radius,
        groupId).toBeLessThanOrEqual(pack.radius);
      envelopes.push({ id: groupId, points, radius });
    }
    for (let a = 0; a < envelopes.length; a++) for (let b = a + 1; b < envelopes.length; b++) {
      const first = envelopes[a]!, second = envelopes[b]!;
      for (const p of first.points) for (const q of second.points) {
        expect(Math.hypot(p[0] - q[0], p[1] - q[1]) - first.radius - second.radius,
          `${first.id} / ${second.id}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("leaves existing habitats, fallback group discs and boss encounters separate", () => {
    expect(habitatReservations.length).toBeGreaterThan(existingHabitats.length);
    expect(encounterReservations.length + fullyAnchoredGroups.length).toBe(surfaceGroups.length);
    expect(fullyAnchoredGroups.map((group) => group.id).sort())
      .toEqual(existingHabitats.map((habitat) => habitat.groupId).sort());
    for (const group of fullyAnchoredGroups) {
      const habitat = habitatForGroup(group.id)!;
      expect(WORLD_HABITATS, group.id).toContain(habitat);
      expect(habitat.groupId).toBe(group.id);
      for (let index = 0; index < group.count; index++) {
        const anchor = habitat.anchors[index];
        expect(anchor, `${group.id}: member ${index + 1} would use legacy fallback`).toBeDefined();
        expect(anchor!.every(Number.isFinite), group.id).toBe(true);
        expect(Math.hypot(anchor![0] - habitat.centre[0], anchor![1] - habitat.centre[1]), group.id)
          .toBeLessThanOrEqual(habitat.radius);
        const entityId = group.count === 1 ? group.id : `${group.id}_${index + 1}`;
        const targets = habitatIdleTargets(entityId, [anchor![0], 0, anchor![1]], habitat);
        for (const target of targets.candidates) {
          const envelope = Math.hypot(target.position[0] - habitat.centre[0], target.position[2] - habitat.centre[1])
            + groupVisualRadius(group.id);
          expect(envelope, `${entityId}: candidate ${target.anchorIndex} exceeds body reservation`)
            .toBeLessThanOrEqual(habitat.radius + habitatBodyMargin(group.id));
        }
      }
    }
    expect(failures([...originalHabitatReservations, ...encounterReservations])).toEqual([]);
  });

  it("checks activated production packs against every current habitat and the original world exclusions", () => {
    expect(activeCatalogue.packs.length).toBeGreaterThan(0);
    expect(activeCatalogue.packs.map(pack => pack.id).sort()).toEqual([...activatedPackIds].sort());
    const newHabitats = existingHabitats.filter(habitat => populationIds.has(habitat.groupId));
    expect(newHabitats.map(habitat => habitat.groupId).sort()).toEqual([...populationIds].sort());
    expect(failures([
      ...habitatReservations, ...encounterReservations, ...roadReservations,
      ...waterReservations, ...siteReservations, ...resourceReservations,
      ...settlementReservations, ...routeAndLandmarkReservations, ...dungeonReservations,
    ], activeCatalogue.packs)).toEqual([]);
    // Accepted pack dressing is assembled separately at boot. Its native pieces must also leave
    // the new population's full body-and-idle discs clear, even when a prop extends past its pack.
    const activeDressing = activeCatalogue.habitats.flatMap(habitat => habitat.dressing.map(piece =>
      nativeBox(`${habitat.id}/${piece.id}`, piece.assetId, [piece.x, piece.z], piece.yaw, piece.scale)));
    expect(failures(activeDressing, newHabitats)).toEqual([]);
  });

  it("keeps towns, composed native buildings and walls, landmarks, gates and shortcuts clear", () => {
    expect(settlementReservations.length).toBeGreaterThan(1000);
    expect(routeAndLandmarkReservations.length).toBeGreaterThan(100);
    expect(failures([...settlementReservations, ...routeAndLandmarkReservations])).toEqual([]);
  });

  it("reserves the entire dungeon XZ footprint and original entrance approach", () => {
    expect(dungeonReservations.some((entry) => entry.id.includes("ordrun_gate:partition"))).toBe(true);
    expect(dungeonReservations.some((entry) => entry.id === "gravelmaw_arena")).toBe(true);
    expect(dungeonReservations.some((entry) => entry.id.endsWith("original quarry approach"))).toBe(true);
    expect(failures(dungeonReservations)).toEqual([]);
  });
});
