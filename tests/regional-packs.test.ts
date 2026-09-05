import { describe, expect, it } from "vitest";
import MANIFEST from "../game/public/assets/manifest.json";
import { CREATURE_EXPANSION } from "../game/src/content/creatureExpansion.js";
import { CREATURE_ENEMY_GROUPS } from "../game/src/content/creatureHabitats.js";
import { ENEMY_BLOCKS, enemyBlockFor } from "../game/src/content/enemies.js";
import { enemyCombatLevel } from "../game/src/content/index.js";
import { REGIONS } from "../game/src/content/regions.js";
import {
  REGIONAL_PACKS, REGIONAL_PACK_SOURCES, REGIONAL_PACK_VARIANTS,
  REGIONAL_PACK_GROUPS, REGIONAL_PACK_HABITATS, REGIONAL_PACK_LEVEL_RANGES,
} from "../game/src/content/regionalPacks.js";
import { tierSilhouetteScale } from "../game/src/core/math.js";
import { habitatIdleTargets } from "../game/src/world/habitatMovement.js";

const assets = new Map(MANIFEST.assets.map((asset) => [asset.id, asset]));
const bases = new Map(ENEMY_BLOCKS.map((base) => [base.id, base]));
const sources = new Map(REGIONAL_PACK_SOURCES.map((source) => [source.id, source]));
const variants = new Map(REGIONAL_PACK_VARIANTS.map((variant) => [variant.id, variant]));
const groups = new Map([
  ...REGIONS.flatMap((region) => [...region.enemyGroups, ...(region.dungeon?.enemyGroups ?? [])]),
  ...CREATURE_ENEMY_GROUPS,
].map((group) => [group.id, group]));

function modelRadii(assetId: string, scale: number): { body: number; visual: number } {
  const asset = assets.get(assetId)!;
  return {
    body: Math.max(asset.size.x, asset.size.z) * scale / 2,
    visual: Math.hypot(
      Math.max(Math.abs(asset.base.x), Math.abs(asset.base.x + asset.size.x)),
      Math.max(Math.abs(asset.base.z), Math.abs(asset.base.z + asset.size.z)),
    ) * scale,
  };
}

describe("authored regional pack staging", () => {
  it("adds 24 packs per surface region, each with 5–10 ordered, uniquely identified residents", () => {
    expect(REGIONAL_PACKS).toHaveLength(96);
    expect(new Set(REGIONAL_PACKS.map((pack) => pack.id)).size).toBe(96);
    const memberIds: string[] = [];
    for (const region of REGIONS) {
      expect(REGIONAL_PACKS.filter((pack) => pack.regionId === region.id), region.id).toHaveLength(24);
    }
    for (const pack of REGIONAL_PACKS) {
      expect(pack.id).toBe(`pack_${pack.regionId}_${pack.settingId}`);
      expect(pack.members.length).toBeGreaterThanOrEqual(5);
      expect(pack.members.length).toBeLessThanOrEqual(10);
      expect(pack.anchors).toHaveLength(pack.members.length);
      expect(pack.rationale.length).toBeGreaterThan(30);
      expect(pack.placementRisks.length).toBeGreaterThan(0);
      pack.members.forEach((member, index) => {
        expect(member.id).toBe(`${pack.id}_${index + 1}`);
        expect(member.anchorIndex).toBe(index);
        expect(variants.get(member.variantId)?.baseEnemyDefId).toBe(pack.baseEnemyDefId);
        memberIds.push(member.id);
      });
      const ranks = pack.members.map((member) => variants.get(member.variantId)!.rank);
      expect(ranks.filter((rank) => rank === "ordinary").length).toBeGreaterThan(pack.members.length / 2);
      expect(ranks).toContain("seasoned");
      expect(ranks).toContain("mature");
    }
    expect(memberIds).toHaveLength(558);
    expect(new Set(memberIds).size).toBe(558);
  });

  it("uses actual ordinary source models and retains the original 24-species populations", () => {
    for (const source of REGIONAL_PACK_SOURCES) {
      const group = groups.get(source.id)!;
      expect(group, source.id).toBeDefined();
      expect(group.boss || group.miniBoss, source.id).not.toBe(true);
      expect(source.assetId).toBe(group.assetId);
      expect(source.scale).toBe(group.scale);
      expect(enemyBlockFor(group.id, group.family, group.tier)?.family).toBe(bases.get(source.baseEnemyDefId)?.family);
      const radii = modelRadii(source.assetId, 1);
      expect(source.nativeBodyRadius, source.id).toBeCloseTo(radii.body, 10);
      expect(source.nativeVisualRadius, source.id).toBeCloseTo(radii.visual, 10);
    }
    expect(CREATURE_EXPANSION).toHaveLength(24);
    for (const species of CREATURE_EXPANSION) {
      expect(CREATURE_ENEMY_GROUPS.some((group) => group.id === `${species.id}_residents`)).toBe(true);
      expect(REGIONS.some((region) => region.enemyGroups.some((group) => group.id === `${species.id}_residents`))).toBe(true);
    }
  });

  it("keeps variants within the same stat family and changes only health, attack, defence and size", () => {
    expect(new Set(REGIONAL_PACK_VARIANTS.map((variant) => variant.id)).size).toBe(REGIONAL_PACK_VARIANTS.length);
    for (const sourceId of new Set(REGIONAL_PACK_SOURCES.map((source) => source.baseEnemyDefId))) {
      const base = bases.get(sourceId)!;
      const rows = REGIONAL_PACK_VARIANTS.filter((variant) => variant.baseEnemyDefId === sourceId);
      expect(rows.map((row) => row.rank)).toEqual(["ordinary", "seasoned", "mature"]);
      rows.forEach((variant, index) => {
        expect(variant.stats).toEqual({
          ...base, id: variant.id,
          maxHealth: Math.max(base.maxHealth + index, Math.round(base.maxHealth * (1 + index * 0.06))),
          attackLevel: base.attackLevel + index, defenceLevel: base.defenceLevel + index,
        });
        expect(variant.scaleMultiplier).toBe(1 + index * 0.02);
        expect(variant.scaleMultiplier).toBeLessThanOrEqual(1.04);
        expect(enemyCombatLevel(variant.stats)).toBeGreaterThanOrEqual(enemyCombatLevel(base));
        if (index > 0) {
          expect(variant.stats.maxHealth).toBeGreaterThan(rows[index - 1]!.stats.maxHealth);
          expect(enemyCombatLevel(variant.stats)).toBeGreaterThanOrEqual(enemyCombatLevel(rows[index - 1]!.stats));
        }
      });
    }
  });

  it("derives every pack and regional level range from the actual member stat blocks", () => {
    for (const pack of REGIONAL_PACKS) {
      const levels = pack.members.map((member) => enemyCombatLevel(variants.get(member.variantId)!.stats));
      expect(pack.levelRange).toEqual([Math.min(...levels), Math.max(...levels)]);
      expect(pack).not.toHaveProperty("level");
    }
    for (const [regionId, range] of Object.entries(REGIONAL_PACK_LEVEL_RANGES)) {
      const levels = REGIONAL_PACKS.filter((pack) => pack.regionId === regionId)
        .flatMap((pack) => pack.members.map((member) => enemyCombatLevel(variants.get(member.variantId)!.stats)));
      expect(range).toEqual([Math.min(...levels), Math.max(...levels)]);
    }
  });

  it("reserves full moving visual bounds and separates physical spawn bodies", () => {
    for (const pack of REGIONAL_PACKS) {
      const source = sources.get(pack.baseGroupId)!;
      const habitat = REGIONAL_PACK_HABITATS.find((row) => row.groupId === pack.id)!;
      const members = pack.members.map((member) => {
        const variant = variants.get(member.variantId)!;
        const scale = pack.scale * tierSilhouetteScale(variant.stats.tier) * variant.scaleMultiplier;
        const radii = modelRadii(pack.assetId, scale);
        const anchor = pack.anchors[member.anchorIndex]!;
        const movement = habitatIdleTargets(member.id, [anchor[0], 0, anchor[1]], habitat);
        expect(movement.candidates).toHaveLength(pack.activity === "graze" || pack.activity === "forage" ? 3 : pack.anchors.length);
        const points = [anchor, ...movement.candidates.map((candidate) => [candidate.position[0], candidate.position[2]] as const)];
        for (const point of points) {
          expect(Math.hypot(point[0] - pack.centre[0], point[1] - pack.centre[1]) + radii.visual,
            `${pack.id}/${member.id} full visual envelope`).toBeLessThanOrEqual(pack.radius);
        }
        return { anchor, body: radii.body };
      });
      expect(source.assetId).toBe(pack.assetId);
      for (let a = 0; a < members.length; a++) {
        for (let b = a + 1; b < members.length; b++) {
          const first = members[a]!, second = members[b]!;
          expect(Math.hypot(first.anchor[0] - second.anchor[0], first.anchor[1] - second.anchor[1])
            - first.body - second.body, `${pack.id} members ${a + 1}/${b + 1}`).toBeGreaterThan(0.3);
        }
      }
    }
  });

  it("leaves each complete reservation in its region and at least 2 m between packs", () => {
    for (const pack of REGIONAL_PACKS) {
      const bounds = REGIONS.find((region) => region.id === pack.regionId)!.bounds;
      expect(pack.centre[0] - pack.radius, pack.id).toBeGreaterThanOrEqual(bounds.min[0]);
      expect(pack.centre[0] + pack.radius, pack.id).toBeLessThanOrEqual(bounds.max[0]);
      expect(pack.centre[1] - pack.radius, pack.id).toBeGreaterThanOrEqual(bounds.min[1]);
      expect(pack.centre[1] + pack.radius, pack.id).toBeLessThanOrEqual(bounds.max[1]);
    }
    for (let a = 0; a < REGIONAL_PACKS.length; a++) {
      for (let b = a + 1; b < REGIONAL_PACKS.length; b++) {
        const first = REGIONAL_PACKS[a]!, second = REGIONAL_PACKS[b]!;
        expect(Math.hypot(first.centre[0] - second.centre[0], first.centre[1] - second.centre[1])
          - first.radius - second.radius, `${first.id}/${second.id}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("provides matching production projections without inventing boss or habitat behavior", () => {
    expect(REGIONAL_PACK_GROUPS).toHaveLength(96);
    expect(REGIONAL_PACK_HABITATS).toHaveLength(96);
    for (const pack of REGIONAL_PACKS) {
      const group = REGIONAL_PACK_GROUPS.find((row) => row.id === pack.id)!;
      const habitat = REGIONAL_PACK_HABITATS.find((row) => row.groupId === pack.id)!;
      const base = bases.get(pack.baseEnemyDefId)!;
      expect(group).toEqual({
        id: pack.id, family: base.family, name: base.name, tier: base.tier,
        count: pack.members.length, centre: pack.centre, radius: pack.radius,
        assetId: pack.assetId, scale: pack.scale,
      });
      expect(habitat).toEqual({
        id: `${pack.id}_habitat`, groupId: pack.id, regionId: pack.regionId,
        centre: pack.centre, radius: pack.radius, anchors: pack.anchors, activity: pack.activity, dressing: [],
      });
    }
  });

  it("makes most packs monster or bandit threats while retaining a few passive populations", () => {
    for (const region of REGIONS) {
      const packs = REGIONAL_PACKS.filter((pack) => pack.regionId === region.id);
      expect(packs.filter((pack) => bases.get(pack.baseEnemyDefId)!.behaviour !== "passive").length, region.id)
        .toBeGreaterThanOrEqual(19);
    }
    expect(REGIONAL_PACKS.some((pack) => bases.get(pack.baseEnemyDefId)!.behaviour === "passive")).toBe(true);
    expect(REGIONAL_PACKS.filter((pack) => pack.speciesId === "reaver").length).toBeGreaterThanOrEqual(20);
    expect(REGIONAL_PACKS.some((pack) => pack.speciesId === "scorpion")).toBe(true);
  });
});
