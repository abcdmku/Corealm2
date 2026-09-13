import { describe, expect, it } from "vitest";
import { REGIONS } from "../game/src/content/regions.js";
import { resourceDef } from "../game/src/content/resources.js";
import { WORLD_HABITATS, habitatForGroup } from "../game/src/content/worldHabitats.js";
import { WORLD_SITES } from "../game/src/content/worldSites.js";
import { organicDistance } from "../game/src/world/organicFields.js";
import { waterBasinForCluster } from "../game/src/world/waterBodies.js";
import { encounterBodyRadius } from "../game/src/content/encounterPlacement.js";
import MANIFEST from "../game/public/assets/manifest.json";
import { buildComposition } from "../game/src/render/buildings.js";
import { structureCollisionFromCompositionParts } from "../game/src/world/regionBuilder.js";
import { lavaClearanceAt, WILDERNESS_LAVA_CHANNELS } from "../game/src/content/wildernessLava.js";
import { WILDERNESS_RESOURCE_INTENTS } from "../game/src/content/wildernessDepth.js";

const ordinaryGroups = REGIONS.flatMap((region) => region.enemyGroups
  .filter((group) => !group.boss && !group.miniBoss)
  .map((group) => ({ group, region })));
const groupsById = new Map(ordinaryGroups.map((entry) => [entry.group.id, entry]));
const basins = REGIONS.flatMap((region) => region.clusters
  .filter((cluster) => resourceDef(cluster.resourceId).archetype === "fishing_spot")
  .map(waterBasinForCluster));

describe("authored wildlife habitats", () => {
  it("covers each ordinary surface group once and supplies every existing actor with an anchor", () => {
    expect(WORLD_HABITATS.map((habitat) => habitat.groupId).sort())
      .toEqual(ordinaryGroups.map(({ group }) => group.id).sort());
    expect(new Set(WORLD_HABITATS.map((habitat) => habitat.id)).size).toBe(WORLD_HABITATS.length);
    for (const habitat of WORLD_HABITATS) {
      const { group, region } = groupsById.get(habitat.groupId)!;
      expect(habitat.regionId, habitat.id).toBe(region.id);
      expect(group.count, habitat.id).toBeGreaterThanOrEqual(group.countPolicy === 'fixed' ? 1 : 7);
      expect(group.count, habitat.id).toBeLessThanOrEqual(15);
      expect(habitat.anchors.length, habitat.id).toBeGreaterThanOrEqual(group.count);
      expect(habitatForGroup(group.id), group.id).toBe(habitat);
      expect(new Set(habitat.dressing.map((piece) => piece.id)).size, habitat.id).toBe(habitat.dressing.length);
    }
    for (const region of REGIONS) {
      for (const group of region.enemyGroups.filter((candidate) => candidate.boss || candidate.miniBoss)) {
        expect(habitatForGroup(group.id), `${group.id}: boss placement must keep its own encounter`).toBeNull();
      }
    }
  });

  it("keeps habitat centres, actor anchors and dressing inside their exact playable region", () => {
    const errors: string[] = [];
    for (const habitat of WORLD_HABITATS) {
      const { region } = groupsById.get(habitat.groupId)!;
      const points = [
        { name: "centre", point: habitat.centre },
        ...habitat.anchors.map((point, index) => ({ name: `anchor ${index + 1}`, point })),
        ...habitat.dressing.map((piece) => ({ name: piece.id, point: [piece.x, piece.z] as const })),
      ];
      for (const { name, point: [x, z] } of points) {
        if (!Number.isFinite(x) || !Number.isFinite(z)
          || x < region.bounds.min[0] || x > region.bounds.max[0]
          || z < region.bounds.min[1] || z > region.bounds.max[1]) {
          errors.push(`${habitat.id}/${name}: ${x},${z} outside ${region.id}`);
        }
      }
    }
    expect(errors).toEqual([]);
  });

  it("contains every activity anchor and leaves enough separation for distinct animals", () => {
    const errors: string[] = [];
    for (const habitat of WORLD_HABITATS) {
      const bodyRadius = encounterBodyRadius(groupsById.get(habitat.groupId)!.group);
      const minimumSeparation = bodyRadius * 2 + .5;
      expect(Number.isFinite(habitat.radius) && habitat.radius > 0, habitat.id).toBe(true);
      for (const [index, [x, z]] of habitat.anchors.entries()) {
        if (Math.hypot(x - habitat.centre[0], z - habitat.centre[1]) + bodyRadius > habitat.radius + 1e-6) {
          errors.push(`${habitat.id}/anchor ${index + 1} lies outside habitat radius`);
        }
        for (let next = index + 1; next < habitat.anchors.length; next++) {
          const other = habitat.anchors[next]!;
          const distance = Math.hypot(x - other[0], z - other[1]);
          if (distance < minimumSeparation - 1e-6) {
            errors.push(`${habitat.id}/anchors ${index + 1},${next + 1}: ${distance.toFixed(2)} m separation`);
          }
        }
      }
    }
    expect(errors).toEqual([]);
  });

  it("keeps animal anchors and refuge props above the actual organic water boundary", () => {
    const errors: string[] = [];
    for (const habitat of WORLD_HABITATS) {
      const bodyRadius = encounterBodyRadius(groupsById.get(habitat.groupId)!.group);
      const points = [
        ...habitat.anchors.map(([x, z], index) => ({ name: `anchor ${index + 1}`, x, z })),
        ...habitat.dressing.map((piece) => ({ name: piece.id, x: piece.x, z: piece.z })),
      ];
      for (const point of points) {
        for (const basin of basins) {
          const clearance = organicDistance(point.x - basin.x, point.z - basin.z, basin.shape) - basin.shoreRadius;
          if (clearance < 0.5) errors.push(`${habitat.id}/${point.name}: ${clearance.toFixed(2)} m from ${basin.id} shore`);
        }
      }
      for (const [index, [x, z]] of habitat.anchors.entries()) for (const basin of basins) {
        for (let sample = 0; sample < 32; sample++) {
          const angle = sample * Math.PI / 16;
          const clearance = organicDistance(x + Math.cos(angle) * bodyRadius - basin.x,
            z + Math.sin(angle) * bodyRadius - basin.z, basin.shape) - basin.shoreRadius;
          if (clearance < 0) errors.push(`${habitat.id}/anchor ${index + 1}: body crosses ${basin.id} shore by ${(-clearance).toFixed(3)} m`);
        }
      }
    }
    expect(errors).toEqual([]);
  });

  it("leaves the central work floors of mines and groves free of wildlife activity", () => {
    const errors: string[] = [];
    for (const habitat of WORLD_HABITATS) {
      for (const site of WORLD_SITES.filter((candidate) => candidate.kind === "mine" || candidate.kind === "grove")) {
        for (const [index, [x, z]] of habitat.anchors.entries()) {
          const distance = Math.hypot(x - site.centre[0], z - site.centre[1]);
          if (distance < site.workRadius) errors.push(`${habitat.id}/anchor ${index + 1} enters ${site.id} work floor`);
        }
      }
    }
    expect(errors).toEqual([]);
  });

  it("keeps complete northern actor bodies and activity connections clear of active lava and high-tier resource floors", () => {
    expect(WILDERNESS_LAVA_CHANNELS).toHaveLength(21);
    const resources = WORLD_SITES.filter(site => WILDERNESS_RESOURCE_INTENTS.some(intent => intent.id === site.id));
    expect(resources).toHaveLength(10);
    const errors = new Set<string>();
    for (const habitat of WORLD_HABITATS.filter(row => row.regionId === 'wilderness')) {
      const radius = encounterBodyRadius(groupsById.get(habitat.groupId)!.group);
      for (let a = 0; a < habitat.anchors.length; a++) for (let b = a; b < habitat.anchors.length; b++) {
        const from = habitat.anchors[a]!, to = habitat.anchors[b]!;
        const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1])));
        for (let step = 0; step <= steps; step++) {
          const x = from[0] + (to[0] - from[0]) * step / steps;
          const z = from[1] + (to[1] - from[1]) * step / steps;
          if (lavaClearanceAt(x, z) < radius + .5)
            errors.add(`${habitat.id}/connection ${a + 1},${b + 1} intersects a lava bank body reservation`);
          for (const site of resources) {
            const dx = x - site.centre[0], dz = z - site.centre[1];
            const localX = dx * Math.cos(site.rotationY) - dz * Math.sin(site.rotationY);
            const localZ = dx * Math.sin(site.rotationY) + dz * Math.cos(site.rotationY);
            const clearance = Math.hypot(Math.max(0, Math.abs(localX) - site.extent[0]),
              Math.max(0, Math.abs(localZ) - site.extent[1]));
            if (clearance < radius + .5)
              errors.add(`${habitat.id}/connection ${a + 1},${b + 1} enters ${site.id} with its body`);
          }
        }
      }
    }
    expect([...errors]).toEqual([]);
  });

  it("keeps actor centres at least 0.75 m clear of settlement building footprints", () => {
    const errors: string[] = [];
    const buildings = REGIONS.flatMap((region) => region.settlement?.buildings ?? []);
    for (const habitat of WORLD_HABITATS) {
      for (const [index, [x, z]] of habitat.anchors.entries()) {
        for (const building of buildings) {
          const dx = x - building.position[0];
          const dz = z - building.position[1];
          const cos = Math.cos(building.rotationY);
          const sin = Math.sin(building.rotationY);
          const overX = Math.max(0, Math.abs(dx * cos - dz * sin) - building.footprint[0] / 2);
          const overZ = Math.max(0, Math.abs(dx * sin + dz * cos) - building.footprint[1] / 2);
          const distance = Math.hypot(overX, overZ);
          if (distance < 0.75) errors.push(`${habitat.id}/anchor ${index + 1}: ${distance.toFixed(2)} m from ${building.id}`);
        }
      }
    }
    expect(errors).toEqual([]);
  });

  it("keeps domestic flocks inside the real farm fences and the enlarged herd beside the barn", () => {
    const areas = [
      // Physical rails are x[-96,-90], z[-25,-17], with a west entrance.
      { groupId: "marchfield_hens", min: [-96, -25], max: [-90, -17] },
      { groupId: "bracken_hens", min: [-103.9, -25.5], max: [-96, -17] },
      { groupId: "redsill_cattle", min: [-123, -48], max: [-107, -32] },
    ];
    for (const area of areas) {
      const habitat = habitatForGroup(area.groupId)!;
      const radius = encounterBodyRadius(groupsById.get(area.groupId)!.group);
      for (const [x, z] of habitat.anchors) {
        expect(x - radius, area.groupId).toBeGreaterThanOrEqual(area.min[0]!);
        expect(x + radius, area.groupId).toBeLessThanOrEqual(area.max[0]!);
        expect(z - radius, area.groupId).toBeGreaterThanOrEqual(area.min[1]!);
        expect(z + radius, area.groupId).toBeLessThanOrEqual(area.max[1]!);
        if (area.groupId !== 'redsill_cattle')
          expect(Math.hypot(x + 96, z + 22) + radius, area.groupId).toBeLessThan(7.9);
      }
    }
    // Existing farmhouse dressing occupies these locations even though it is not a settlement
    // BuildingDef. Keep the flock clear of the trough and the outer flock clear of the scarecrow.
    for (const [x, z] of habitatForGroup("marchfield_hens")!.anchors) {
      expect(Math.hypot(x + 92.1, z + 22.8), "hen overlaps farm trough").toBeGreaterThanOrEqual(1);
    }
    for (const [x, z] of habitatForGroup("bracken_hens")!.anchors) {
      expect(Math.hypot(x + 99.4, z + 19.4), "hen overlaps farm scarecrow").toBeGreaterThanOrEqual(1);
    }
    const assets = new Map(MANIFEST.assets.map(asset => [asset.id, asset]));
    const solids = structureCollisionFromCompositionParts('farm_yard', buildComposition('farm_yard', 1337),
      { origin: [-96, 0, -22], rotationY: 0, ownerId: 'marchfield_farmstead' }, {
        assetSize: id => assets.get(id)?.size ?? null,
        assetCenterXZ: id => { const asset = assets.get(id); return asset?.base && asset.size
          ? { x: asset.base.x + asset.size.x / 2, z: asset.base.z + asset.size.z / 2 } : null; },
      });
    for (const area of areas) for (const [x, z] of habitatForGroup(area.groupId)!.anchors) {
      const radius = encounterBodyRadius(groupsById.get(area.groupId)!.group);
      for (const solid of solids) {
        if (solid.kind !== 'box') continue;
        const dx = x - solid.position[0], dz = z - solid.position[2];
        const localX = dx * Math.cos(solid.rotationY) - dz * Math.sin(solid.rotationY);
        const localZ = dx * Math.sin(solid.rotationY) + dz * Math.cos(solid.rotationY);
        const clearance = Math.hypot(Math.max(0, Math.abs(localX) - solid.size[0] / 2),
          Math.max(0, Math.abs(localZ) - solid.size[2] / 2));
        expect(clearance, `${area.groupId}/${solid.id}`).toBeGreaterThan(radius + .05);
      }
    }
  });
});
