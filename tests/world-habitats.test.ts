import { describe, expect, it } from "vitest";
import { REGIONS } from "../game/src/content/regions.js";
import { resourceDef } from "../game/src/content/resources.js";
import { WORLD_HABITATS, habitatForGroup } from "../game/src/content/worldHabitats.js";
import { WORLD_SITES } from "../game/src/content/worldSites.js";
import { organicDistance } from "../game/src/world/organicFields.js";
import { waterBasinForCluster } from "../game/src/world/waterBodies.js";

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
      const minimumSeparation = groupsById.get(habitat.groupId)!.group.family === "hen" ? 0.65 : 1.5;
      expect(Number.isFinite(habitat.radius) && habitat.radius > 0, habitat.id).toBe(true);
      for (const [index, [x, z]] of habitat.anchors.entries()) {
        if (Math.hypot(x - habitat.centre[0], z - habitat.centre[1]) > habitat.radius) {
          errors.push(`${habitat.id}/anchor ${index + 1} lies outside habitat radius`);
        }
        for (let next = index + 1; next < habitat.anchors.length; next++) {
          const other = habitat.anchors[next]!;
          const distance = Math.hypot(x - other[0], z - other[1]);
          if (distance < minimumSeparation) {
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

  it("keeps actor centres at least 0.75 m clear of settlement building footprints", () => {
    const errors: string[] = [];
    const buildings = REGIONS.flatMap((region) => region.settlement.buildings);
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

  it("keeps the domestic flocks inside their farm yards and cattle in the existing grazing area", () => {
    const areas = [
      { groupId: "marchfield_hens", min: [-95, -24], max: [-91, -18] },
      { groupId: "bracken_hens", min: [-101.8, -23], max: [-100.3, -21.3] },
      { groupId: "redsill_cattle", min: [-113, -38], max: [-105, -30] },
    ];
    for (const area of areas) {
      const habitat = habitatForGroup(area.groupId)!;
      for (const [x, z] of habitat.anchors) {
        expect(x, area.groupId).toBeGreaterThanOrEqual(area.min[0]!);
        expect(x, area.groupId).toBeLessThanOrEqual(area.max[0]!);
        expect(z, area.groupId).toBeGreaterThanOrEqual(area.min[1]!);
        expect(z, area.groupId).toBeLessThanOrEqual(area.max[1]!);
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
  });
});
