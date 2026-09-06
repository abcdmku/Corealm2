import { describe, expect, it } from "vitest";
import MANIFEST from "../game/public/assets/manifest.json";
import { content, enemyCombatLevel } from "../game/src/content/index.js";
import { REGIONS } from "../game/src/content/regions.js";
import {
  REGIONAL_PACKS, REGIONAL_PACK_HABITATS, REGIONAL_PACK_VARIANTS,
} from "../game/src/content/regionalPacks.js";
import { tierSilhouetteScale } from "../game/src/core/math.js";
import { assembleRegionalPackFixture } from "../game/src/featureLab/regionalPacks.js";
import { resolveEnemyDef } from "../game/src/systems/combat.js";
import { habitatIdleTargets } from "../game/src/world/habitatMovement.js";
import { assembleRegionalPack, type RegionalPackPorts } from "../game/src/world/regionalPackEntities.js";

const assets = new Map(MANIFEST.assets.map((asset) => [asset.id, asset]));
const variants = new Map(REGIONAL_PACK_VARIANTS.map((variant) => [variant.id, variant]));
const ports: RegionalPackPorts = {
  heightAt: (x, z) => 3 + x * 0.015 - z * 0.02,
  baseY: (id) => assets.get(id)!.base.y,
  assetSize: (id) => assets.get(id)?.size ?? null,
};
const round2 = (value: number): number => Math.round(value * 100) / 100;

describe("regional pack production construction", () => {
  it("constructs all 558 members with canonical variant stats, grounding and measured body sizes", () => {
    let count = 0;
    for (const pack of REGIONAL_PACKS) {
      const assembly = assembleRegionalPack(pack.id, ports);
      expect(assembly.packId).toBe(pack.id);
      expect(assembly.entities).toHaveLength(pack.members.length);
      expect(assembly.habitat).toEqual(REGIONAL_PACK_HABITATS.find((habitat) => habitat.groupId === pack.id));
      for (const [index, entity] of assembly.entities.entries()) {
        const member = pack.members[index]!;
        const variant = variants.get(member.variantId)!;
        const stats = variant.stats;
        const anchor = pack.anchors[member.anchorIndex]!;
        const viewScale = pack.scale * variant.scaleMultiplier;
        const drawnScale = viewScale * tierSilhouetteScale(stats.tier);
        const asset = assets.get(pack.assetId)!;
        expect(entity.id).toBe(member.id);
        expect(entity.name).toBe(stats.name);
        expect(entity.archetype).toBe("enemy");
        expect(entity.tier).toBe(stats.tier);
        expect(entity.regionId).toBe(pack.regionId);
        expect(entity.position).toEqual([
          anchor[0], round2(ports.heightAt(...anchor) - asset.base.y * drawnScale), anchor[1],
        ]);
        expect(entity.view?.assetId).toBe(pack.assetId);
        expect(entity.view?.scale).toBe(viewScale);
        expect(entity.combat).toEqual({
          health: stats.maxHealth, maxHealth: stats.maxHealth, level: enemyCombatLevel(stats),
          aggroRadius: stats.aggroRadius,
          ...(stats.moveSpeedMps === undefined ? {} : { moveSpeedMps: stats.moveSpeedMps }),
          ...(stats.walkSpeedMps === undefined ? {} : { walkSpeedMps: stats.walkSpeedMps }),
          bodyRadius: Math.max(asset.size.x, asset.size.z) * drawnScale / 2,
        });
        expect(entity.meta).toMatchObject({
          family: stats.family, enemyDefId: variant.id, groupId: pack.id,
          habitatId: assembly.habitat.id, behaviour: stats.behaviour,
          spawnX: round2(anchor[0]), spawnZ: round2(anchor[1]),
        });
        expect(entity.meta).not.toHaveProperty("rank");
        count++;
      }
    }
    expect(count).toBe(558);
  });

  it("preserves deterministic members independently of other packs and placement translation", () => {
    const first = REGIONAL_PACKS[0]!;
    const before = assembleRegionalPack(first.id, ports, { seed: 217 });
    for (const pack of REGIONAL_PACKS.slice(1)) assembleRegionalPack(pack.id, ports, { seed: 999 });
    expect(assembleRegionalPack(first.id, ports, { seed: 217 })).toEqual(before);
    const changedSeed = assembleRegionalPack(first.id, ports, { seed: 218 });
    expect(changedSeed.entities.map((entity) => entity.view?.rotationY))
      .not.toEqual(before.entities.map((entity) => entity.view?.rotationY));
    expect(changedSeed.entities.map((entity) => entity.position)).toEqual(before.entities.map((entity) => entity.position));
    const moved = assembleRegionalPack(first.id, ports, {
      translation: [50, -17], regionId: "kilnhalt", seed: 217,
    });
    expect(moved.habitat.regionId).toBe("kilnhalt");
    expect(moved.habitat.centre).toEqual([first.centre[0] + 50, first.centre[1] - 17]);
    for (const [index, entity] of moved.entities.entries()) {
      expect(entity.id).toBe(before.entities[index]!.id);
      expect(entity.regionId).toBe("kilnhalt");
      expect(entity.view).toEqual(before.entities[index]!.view);
      expect(entity.combat).toEqual(before.entities[index]!.combat);
      expect(entity.position[0]).toBeCloseTo(before.entities[index]!.position[0] + 50, 10);
      expect(entity.position[2]).toBeCloseTo(before.entities[index]!.position[2] - 17, 10);
    }
  });

  it("translates each complete lab encounter into Fallowmarch and preserves its idle destinations", () => {
    const bounds = REGIONS.find((region) => region.id === "fallowmarch")!.bounds;
    for (const pack of REGIONAL_PACKS) {
      const authored = assembleRegionalPack(pack.id, ports);
      const fixture = assembleRegionalPackFixture(pack.id, ports);
      const dx = -72 - pack.centre[0], dz = 30 - pack.centre[1];
      expect(fixture.spawn).toEqual([-72, ports.heightAt(-72, 60), 60]);
      expect(fixture.habitat.centre).toEqual([-72, 30]);
      expect(fixture.habitat.regionId).toBe("fallowmarch");
      expect(fixture.habitat.radius).toBe(pack.radius);
      expect(-72 - pack.radius).toBeGreaterThan(bounds.min[0]);
      expect(-72 + pack.radius).toBeLessThan(bounds.max[0]);
      expect(30 - pack.radius).toBeGreaterThan(bounds.min[1]);
      expect(30 + pack.radius).toBeLessThan(bounds.max[1]);
      for (const [index, entity] of fixture.entities.entries()) {
        const source = authored.entities[index]!;
        expect(entity.regionId).toBe("fallowmarch");
        expect(entity.combat).toEqual(source.combat);
        expect(entity.view).toEqual(source.view);
        const originalTargets = habitatIdleTargets(source.id, source.position, authored.habitat);
        const fixtureTargets = habitatIdleTargets(entity.id, entity.position, fixture.habitat);
        expect(fixtureTargets.ranging).toBe(originalTargets.ranging);
        expect(fixtureTargets.nearestAnchorIndex).toBe(originalTargets.nearestAnchorIndex);
        expect(fixtureTargets.candidates.map((target) => target.anchorIndex))
          .toEqual(originalTargets.candidates.map((target) => target.anchorIndex));
        fixtureTargets.candidates.forEach((target, targetIndex) => {
          const original = originalTargets.candidates[targetIndex]!;
          expect(target.position[0]).toBeCloseTo(original.position[0] + dx, 10);
          expect(target.position[2]).toBeCloseTo(original.position[2] + dz, 10);
        });
      }
    }
  });

  it("resolves the individual stat block through the normal combat registry after caller registration", () => {
    const previous = content.allEnemies();
    try {
      content.register({ enemies: REGIONAL_PACK_VARIANTS.map((variant) => variant.stats) });
      for (const pack of REGIONAL_PACKS.filter((row) => row.members.length >= 7).slice(0, 3)) {
        const fixture = assembleRegionalPackFixture(pack.id, ports);
        for (const entity of fixture.entities) {
          const variant = variants.get(String(entity.meta?.enemyDefId))!;
          expect(resolveEnemyDef(entity)).toBe(variant.stats);
        }
      }
    } finally {
      content.register({ enemies: previous });
    }
  });

  it("returns independent data without mutating authoring or registering content", () => {
    const pack = REGIONAL_PACKS[0]!;
    const authoredBefore = JSON.stringify([pack, REGIONAL_PACK_HABITATS, REGIONAL_PACK_VARIANTS]);
    const registeredBefore = content.allEnemies();
    const first = assembleRegionalPackFixture(pack.id, ports);
    const firstEntity = first.entities[0]!;
    firstEntity.position = [firstEntity.position[0] + 5, firstEntity.position[1], firstEntity.position[2]];
    first.entities[0]!.combat!.health = 0;
    const second = assembleRegionalPackFixture(pack.id, ports);
    expect(second.entities[0]!.position).not.toEqual(first.entities[0]!.position);
    expect(second.entities[0]!.combat!.health).toBeGreaterThan(0);
    expect(JSON.stringify([pack, REGIONAL_PACK_HABITATS, REGIONAL_PACK_VARIANTS])).toBe(authoredBefore);
    expect(content.allEnemies()).toBe(registeredBefore);
  });

  it("rejects unknown packs, missing measurements and invalid placement or grounding", () => {
    const id = REGIONAL_PACKS[0]!.id;
    expect(() => assembleRegionalPack("missing", ports)).toThrow("Unknown regional pack");
    expect(() => assembleRegionalPackFixture("missing", ports)).toThrow("Unknown regional pack fixture");
    expect(() => assembleRegionalPack(id, { ...ports, assetSize: () => null })).toThrow("finite model measurements");
    expect(() => assembleRegionalPack(id, { ...ports, assetSize: () => ({ x: 1, y: -1, z: 2 }) }))
      .toThrow("finite model measurements");
    expect(() => assembleRegionalPack(id, { ...ports, baseY: () => NaN })).toThrow("finite model measurements");
    expect(() => assembleRegionalPack(id, ports, { translation: [Infinity, 0] })).toThrow("Invalid regional pack placement");
    expect(() => assembleRegionalPack(id, ports, { seed: NaN })).toThrow("Invalid regional pack placement");
    expect(() => assembleRegionalPack(id, { ...ports, heightAt: () => NaN })).toThrow("invalid grounding");
    expect(() => assembleRegionalPackFixture(id, {
      ...ports, heightAt: (x, z) => x === -72 && z === 60 ? NaN : ports.heightAt(x, z),
    })).toThrow("invalid player grounding");
  });
});
