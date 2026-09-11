import { describe, expect, it } from "vitest";
import MANIFEST from "../game/public/assets/manifest.json";
import { CREATURE_EXPANSION } from "../game/src/content/creatureExpansion.js";
import { CREATURE_ENEMY_GROUPS, CREATURE_HABITATS, CREATURE_HABITAT_NOTES } from "../game/src/content/creatureHabitats.js";
import { enemyBlockFor } from "../game/src/content/enemies.js";
import { REGIONS } from "../game/src/content/regions.js";
import { WORLD_HABITATS } from "../game/src/content/worldHabitats.js";
import { WORLD_SITES } from "../game/src/content/worldSites.js";
import { tierSilhouetteScale } from "../game/src/core/math.js";

const groups = new Map(CREATURE_ENEMY_GROUPS.map((group) => [group.id, group]));
const notes = new Map(CREATURE_HABITAT_NOTES.map((row) => [row.habitatId, row]));
const assets = new Map(MANIFEST.assets.map((asset) => [asset.id, asset]));

function horizontalRadius(assetId: string, sx: number, sz: number): number {
  const asset = assets.get(assetId);
  expect(asset, assetId).toBeDefined();
  // Use bounds about the actual origin. A long tail or an offset plant cannot borrow the
  // clearance of a hypothetical centred model; this circle remains conservative at any yaw.
  return Math.hypot(
    Math.max(Math.abs(asset!.base.x), Math.abs(asset!.base.x + asset!.size.x)) * sx,
    Math.max(Math.abs(asset!.base.z), Math.abs(asset!.base.z + asset!.size.z)) * sz,
  );
}

function segmentDistance(x: number, z: number, a: readonly number[], b: readonly number[]): number {
  const dx = b[0]! - a[0]!, dz = b[1]! - a[1]!;
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]!) * dx + (z - a[1]!) * dz) / lengthSquared));
  return Math.hypot(x - a[0]! - dx * t, z - a[1]! - dz * t);
}

describe("staged creature habitats", () => {
  it("pairs all 24 species with canonical ordinary groups and preserves 53 stable resident IDs", () => {
    expect(CREATURE_ENEMY_GROUPS).toHaveLength(24);
    expect(CREATURE_HABITATS).toHaveLength(24);
    expect(CREATURE_HABITAT_NOTES).toHaveLength(24);
    expect(new Set(CREATURE_HABITATS.map((row) => row.id)).size).toBe(24);
    expect(new Set(CREATURE_ENEMY_GROUPS.map((row) => row.id)).size).toBe(24);
    expect(CREATURE_ENEMY_GROUPS.map((group) => group.family).sort())
      .toEqual(CREATURE_EXPANSION.map((species) => species.id).sort());
    const residentIds: string[] = [];
    for (const habitat of CREATURE_HABITATS) {
      const group = groups.get(habitat.groupId)!;
      const note = notes.get(habitat.id)!;
      const species = CREATURE_EXPANSION.find((row) => row.id === note.speciesId)!;
      expect(group, habitat.id).toBeDefined();
      expect(group.boss || group.miniBoss).not.toBe(true);
      expect(group.id).toBe(`${species.id}_residents`);
      expect(group.family).toBe(species.stats.family);
      expect(group.name).toBe(species.stats.name);
      expect(group.tier).toBe(species.stats.tier);
      expect(group.scale).toBe(species.scale);
      expect(group.assetId).toBe(species.assetId);
      expect(enemyBlockFor(group.id, group.family, group.tier)?.id).toBe(note.enemyDefId);
      expect(habitat.regionId).toBe(species.regionId);
      expect(habitat.activity).toBe(species.activity);
      expect(habitat.centre).toEqual(group.centre);
      expect(habitat.radius).toBe(group.radius);
      expect(Number.isInteger(group.count) && group.count > 0).toBe(true);
      expect(habitat.anchors.length).toBeGreaterThanOrEqual(group.count);
      for (let index = 0; index < group.count; index++) {
        residentIds.push(group.count === 1 ? group.id : `${group.id}_${index + 1}`);
      }
    }
    expect(residentIds).toHaveLength(53);
    expect(new Set(residentIds).size).toBe(53);
    expect(CREATURE_ENEMY_GROUPS.filter((group) => group.count === 1).map((group) => group.family).sort())
      .toEqual(["basalt_drake", "cinder_ravager", "duskoak_lynx", "gorge_mantis", "quarry_nightmare", "reedjaw_crocodile"]);
  });

  it("keeps all 124 anchors in their authored region and reservation", () => {
    expect(CREATURE_HABITATS.reduce((count, habitat) => count + habitat.anchors.length, 0)).toBe(124);
    const regions = new Map(REGIONS.map((region) => [region.id, region]));
    for (const habitat of CREATURE_HABITATS) {
      const bounds = regions.get(habitat.regionId)!.bounds;
      expect(habitat.centre[0] - habitat.radius).toBeGreaterThanOrEqual(bounds.min[0]);
      expect(habitat.centre[0] + habitat.radius).toBeLessThanOrEqual(bounds.max[0]);
      expect(habitat.centre[1] - habitat.radius).toBeGreaterThanOrEqual(bounds.min[1]);
      expect(habitat.centre[1] + habitat.radius).toBeLessThanOrEqual(bounds.max[1]);
      for (const [x, z] of habitat.anchors) {
        expect(Number.isFinite(x) && Number.isFinite(z), habitat.id).toBe(true);
        expect(Math.hypot(x - habitat.centre[0], z - habitat.centre[1]), habitat.id).toBeLessThanOrEqual(habitat.radius);
      }
      const group = groups.get(habitat.groupId)!;
      const scale = group.scale * tierSilhouetteScale(group.tier);
      const asset = assets.get(group.assetId)!;
      const collisionDiameter = Math.max(asset.size.x, asset.size.z) * scale;
      for (let a = 0; a < group.count; a++) {
        for (let b = a + 1; b < group.count; b++) {
          expect(segmentDistance(...habitat.anchors[a]!, habitat.anchors[b]!, habitat.anchors[b]!), group.id)
            .toBeGreaterThan(collisionDiameter);
        }
      }
    }
  });

  it("retains pending placement notes without adding behavior or acceptance flags to game contracts", () => {
    for (const note of CREATURE_HABITAT_NOTES) {
      expect(note.movementDomain).toBe("ground");
      expect(note.enabled).toBe(false);
      expect(note.status).toBe("proposed_pending_lab_and_world_acceptance");
      expect(note.rationale.length).toBeGreaterThan(30);
      expect(note.riskNotes.length).toBeGreaterThan(0);
      expect(note.settingId.length).toBeGreaterThan(0);
      expect(note.nearestScreenedExclusion.gapMetres).toBeGreaterThan(0);
    }
    for (const habitat of CREATURE_HABITATS) {
      expect(habitat).not.toHaveProperty("enabled");
      expect(habitat).not.toHaveProperty("rationale");
      expect(habitat).not.toHaveProperty("movementDomain");
    }
  });

  it("uses existing native cover with room for bodies along every straight activity connection", () => {
    expect(CREATURE_HABITATS.reduce((count, habitat) => count + habitat.dressing.length, 0)).toBe(17);
    const allGroups = new Map([
      ...REGIONS.flatMap((region) => region.enemyGroups),
    ].map((group) => [group.id, group]));
    const allHabitats = WORLD_HABITATS.map(habitat => {
      const group = allGroups.get(habitat.groupId)!;
      const scale = group.scale * tierSilhouetteScale(group.tier);
      return { habitat, bodyRadius: horizontalRadius(group.assetId, scale, scale) };
    });
    const errors: string[] = [];
    for (const original of CREATURE_HABITATS) {
      const habitat = WORLD_HABITATS.find(row => row.groupId === original.groupId)!;
      expect(habitat, original.id).toBeDefined();
      // These notes describe the frozen source gallery, not the later fantasy-body projection.
      const sourceGroup = groups.get(original.groupId)!;
      const sourceScale = sourceGroup.scale * tierSilhouetteScale(sourceGroup.tier);
      const sourceRadius = horizontalRadius(sourceGroup.assetId, sourceScale, sourceScale);
      if (habitat.dressing.length > 0) {
        expect(notes.get(original.id)!.dressingBodyRadius, original.id).toBeGreaterThanOrEqual(sourceRadius * 1.2 + 0.25);
        expect(notes.get(habitat.id)!.dressingNotes.length).toBeGreaterThan(0);
      }
      expect(new Set(habitat.dressing.map((piece) => piece.id)).size).toBe(habitat.dressing.length);
      for (const piece of habitat.dressing) {
        expect(piece.assetId).toMatch(/^corealm_(rock_strata|shrub|fern|stump|scree|deadwood)_/);
        const sx = typeof piece.scale === "number" ? piece.scale : piece.scale[0];
        const sy = typeof piece.scale === "number" ? piece.scale : piece.scale[1];
        const sz = typeof piece.scale === "number" ? piece.scale : piece.scale[2];
        expect([sx, sy, sz].every((value) => Number.isFinite(value) && value > 0)).toBe(true);
        expect([piece.x, piece.z, piece.yaw, piece.sink ?? 0].every(Number.isFinite)).toBe(true);
        const propRadius = horizontalRadius(piece.assetId, sx, sz);
        const sway = /^corealm_(shrub|fern)_/.test(piece.assetId) ? 0.25 : 0;
        for (const { habitat: other, bodyRadius: otherRadius } of allHabitats) {
          for (let a = 0; a < other.anchors.length; a++) {
            for (let b = a; b < other.anchors.length; b++) {
              const clearance = segmentDistance(piece.x, piece.z, other.anchors[a]!, other.anchors[b]!) - otherRadius - propRadius - sway;
              if (clearance < 1 - 1e-6) errors.push(`${habitat.id}/${piece.id}: ${other.id} anchors ${a + 1},${b + 1}, ${clearance.toFixed(3)} m`);
            }
          }
        }
      }
    }
    expect(errors).toEqual([]);
  });

  it("keeps dressing bounds inside the region and outside existing mine, grove and building footprints", () => {
    for (const original of CREATURE_HABITATS) {
      const habitat = WORLD_HABITATS.find(row => row.groupId === original.groupId)!;
      const region = REGIONS.find((candidate) => candidate.id === habitat.regionId)!;
      for (const piece of habitat.dressing) {
        const sx = typeof piece.scale === "number" ? piece.scale : piece.scale[0];
        const sz = typeof piece.scale === "number" ? piece.scale : piece.scale[2];
        const radius = horizontalRadius(piece.assetId, sx, sz);
        expect(piece.x - radius).toBeGreaterThanOrEqual(region.bounds.min[0]);
        expect(piece.x + radius).toBeLessThanOrEqual(region.bounds.max[0]);
        expect(piece.z - radius).toBeGreaterThanOrEqual(region.bounds.min[1]);
        expect(piece.z + radius).toBeLessThanOrEqual(region.bounds.max[1]);
        const footprints = [
          ...WORLD_SITES.filter((site) => site.kind === "mine" || site.kind === "grove")
            .map((site) => ({ id: site.id, centre: site.centre, yaw: site.rotationY, halfX: site.extent[0], halfZ: site.extent[1] })),
          ...REGIONS.flatMap((candidate) => candidate.settlement?.buildings ?? [])
            .map((building) => ({ id: building.id, centre: building.position, yaw: building.rotationY,
              halfX: building.footprint[0] / 2, halfZ: building.footprint[1] / 2 })),
        ];
        for (const footprint of footprints) {
          const dx = piece.x - footprint.centre[0], dz = piece.z - footprint.centre[1];
          const cos = Math.cos(footprint.yaw), sin = Math.sin(footprint.yaw);
          const distance = Math.hypot(
            Math.max(0, Math.abs(dx * cos - dz * sin) - footprint.halfX),
            Math.max(0, Math.abs(dx * sin + dz * cos) - footprint.halfZ),
          );
          expect(distance - radius, `${habitat.id}/${piece.id} near ${footprint.id}`).toBeGreaterThan(1);
        }
      }
    }
  });
});
