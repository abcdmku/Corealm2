import { describe, expect, it } from 'vitest';
import type { EnemyGroupDef } from '../game/src/content/regions.js';
import { createEncounterFormation, encounterPopulationCount, EncounterFormationError,
  encounterFormationClearance } from '../game/src/content/encounterPopulation.js';
import { DEEP_WILDERNESS_KEEPERS, DEEP_WILDERNESS_PACKS, DEEP_WILDERNESS_PACK_HABITATS,
  deepWildernessPackFormation } from '../game/src/content/deepWildernessEncounters.js';
import { WILDERNESS_DEPTH, WILDERNESS_EXPANSION_SITES, WILDERNESS_RESOURCE_INTENTS,
  wildernessTierAt } from '../game/src/content/wildernessDepth.js';
import { lavaClearanceAt, WILDERNESS_LAVA_EXPANSION_CHANNELS } from '../game/src/content/wildernessLava.js';
import { DEEP_WILDERNESS_STRUCTURES } from '../game/src/render/compositions/deepWildernessStructures.js';
import { LEGACY_CAVE_FLOOR_INTENTS, LEGACY_ENCOUNTER_PLACEMENTS, createLegacyEncounterFormation } from '../game/src/content/legacyEncounterPlacements.js';
import { REGIONS, SOURCE_REGIONS } from '../game/src/content/regions.js';
import { WORLD_SITES, worldSitePoint } from '../game/src/content/worldSites.js';
import { WILDERNESS_RUIN_SITES } from '../game/src/content/wildernessLandmarks.js';
import { dungeonSolids, chamberFloorAt, type DungeonSpec } from '../game/src/render/dungeon.js';
import { authoredThresholds } from '../game/src/world/dungeonDoors.js';
import { buildComposition } from '../game/src/render/buildings.js';
import { structureCollisionFromCompositionParts } from '../game/src/world/regionBuilder.js';
import manifest from '../game/public/assets/manifest.json';
import type { SolidVolume } from '../game/src/contracts.js';
import { BIOME_POPULATION } from '../game/src/content/biomePopulation.js';
import { populationGroup } from '../game/src/content/encounterPlacement.js';

const group: EnemyGroupDef = { id: 'retained_group', family: 'wraith', name: 'Wraith', tier: 70,
  count: 3, centre: [10, 20], radius: 5, assetId: 'creature_wraith', scale: 1 };
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

describe('ordinary encounter formations', () => {
  it('supplies 7–15 simultaneous ordinary residents while keeping singular bosses', () => {
    const observed = new Set<number>();
    for (let index = 0; index < 100; index++) {
      const count = encounterPopulationCount({ ...group, id: `pack_${index}` });
      expect(count).toBeGreaterThanOrEqual(7); expect(count).toBeLessThanOrEqual(15); observed.add(count);
    }
    expect(observed.size).toBe(9);
    expect(encounterPopulationCount({ ...group, count: 11 })).toBe(11);
    expect(encounterPopulationCount({ ...group, count: 15, miniBoss: true })).toBe(1);
    expect(encounterPopulationCount({ ...group, count: 15, boss: true })).toBe(1);
  });

  it('retains group identity and the initial actor ordering as a formation grows', () => {
    const seven = createEncounterFormation(group, { bodyRadius: 2.5, count: 7 });
    const fifteen = createEncounterFormation(group, { bodyRadius: 2.5, count: 15 });
    expect(fifteen.anchors.slice(0, 7)).toEqual(seven.anchors);
    expect(fifteen.group.id).toBe(group.id);
    expect(fifteen.group.assetId).toBe(group.assetId);
    expect(createEncounterFormation(group, { bodyRadius: 2.5, count: 15 })).toEqual(fifteen);
    expect(group.count).toBe(3); expect(group.radius).toBe(5);
    expect(seven.actorIds).toEqual(Array.from({ length: 7 }, (_, index) => `retained_group_${index + 1}`));
    const formerSingleton = createEncounterFormation({ ...group, count: 1 }, { bodyRadius: 1.5, count: 7 });
    expect(formerSingleton.actorIds).toEqual(['retained_group', 'retained_group_2', 'retained_group_3',
      'retained_group_4', 'retained_group_5', 'retained_group_6', 'retained_group_7']);
    const projected = populationGroup({ ...group, count: 1 });
    expect(projected.count).toBeGreaterThanOrEqual(7);
    expect(projected.legacyCount).toBe(1);
    const projectedFormation = createEncounterFormation(projected, { bodyRadius: 1.5 });
    expect(projectedFormation.actorIds[0]).toBe('retained_group');
    expect(projectedFormation.actorIds[1]).toBe('retained_group_2');
  });

  it('leaves animated bodies apart and enlarges an insufficient original reservation', () => {
    const formation = createEncounterFormation(group, { bodyRadius: 5.3, count: 15 });
    expect(formation.group.radius).toBeGreaterThan(group.radius);
    for (const [index, anchor] of formation.anchors.entries()) {
      expect(distance(anchor, group.centre) + formation.bodyRadius).toBeLessThanOrEqual(formation.group.radius + 1e-6);
      for (const other of formation.anchors.slice(index + 1)) expect(distance(anchor, other)).toBeGreaterThanOrEqual(11.1 - 1e-6);
    }
    expect(encounterFormationClearance(formation, formation.anchors[0]!)).toBe(-5.3);
  });

  it('uses receiving-floor and adjacent-pack clearance without duplicating terrain math', () => {
    const occupied = [{ position: [10, 20] as const, bodyRadius: 2 }];
    const formation = createEncounterFormation(group, { bodyRadius: 1.5, count: 9, maxRadius: 20,
      occupied, accepts: (point, radius) => point[0] - radius >= 10 });
    for (const point of formation.anchors) {
      expect(point[0] - formation.bodyRadius).toBeGreaterThanOrEqual(10);
      expect(distance(point, occupied[0]!.position)).toBeGreaterThanOrEqual(4);
    }
  });

  it('keeps safe authored points first and rejects duplicates or bodies crossing a room wall', () => {
    const preferred = [[11, 20], [11, 20], [300, 300], [15, 20]] as const;
    const formation = createEncounterFormation(group, { bodyRadius: 1.5, count: 7,
      preferredAnchors: preferred, maxRadius: 15 });
    expect(formation.anchors.slice(0, 2)).toEqual([preferred[0], preferred[3]]);
    expect(new Set(formation.anchors.map(point => point.join(','))).size).toBe(7);
  });

  it('fails a cramped chamber instead of stacking residents or silently reducing population', () => {
    expect(() => createEncounterFormation(group, { bodyRadius: 2.5, count: 7, maxRadius: 4 })).toThrow(EncounterFormationError);
    expect(() => createEncounterFormation(group, { bodyRadius: 1, count: 6 })).toThrow('7–15');
    expect(() => createEncounterFormation(group, { bodyRadius: 0 })).toThrow('moving body');
  });
});

describe('legacy enlarged encounter placements', () => {
  const current = REGIONS.flatMap(region => [...region.enemyGroups, ...(region.dungeon?.enemyGroups ?? [])]);
  const source = SOURCE_REGIONS.flatMap(region => [...region.enemyGroups, ...(region.dungeon?.enemyGroups ?? [])]);
  const formation = (layout: typeof LEGACY_ENCOUNTER_PLACEMENTS[number]) => createLegacyEncounterFormation(
    current.find(group => group.id === layout.id)!, { bodyRadius: layout.bodyRadiusBudget })!;
  const gapToSolid = (point: readonly number[], solid: SolidVolume): number => {
    const dx = point[0]! - solid.position[0], dz = point[1]! - solid.position[2];
    if (solid.kind === 'cylinder') return Math.hypot(dx, dz) - solid.radius;
    const x = dx * Math.cos(solid.rotationY) - dz * Math.sin(solid.rotationY);
    const z = dx * Math.sin(solid.rotationY) + dz * Math.cos(solid.rotationY);
    return Math.hypot(Math.max(0, Math.abs(x) - solid.size[0] / 2), Math.max(0, Math.abs(z) - solid.size[2] / 2));
  };

  it('retains every source group and original actor identity in thirty-six explicit layouts', () => {
    expect(LEGACY_ENCOUNTER_PLACEMENTS).toHaveLength(36);
    for (const layout of LEGACY_ENCOUNTER_PLACEMENTS) {
      const original = source.find(group => group.id === layout.id) ?? BIOME_POPULATION.find(group => group.id === layout.id);
      expect(original, layout.id).toBeDefined();
      expect(original!.count, layout.id).toBe(layout.originalCount);
      expect(original!.centre, layout.id).toEqual(layout.originalCentre);
      const result = formation(layout);
      expect(result.group.count, layout.id).toBe(layout.count);
      expect(result.group.id, layout.id).toBe(layout.id);
      expect(result.actorIds[0], layout.id).toBe(layout.originalCount === 1 ? layout.id : `${layout.id}_1`);
      expect(result.anchors).toHaveLength(layout.count);
    }
  });

  it('keeps measured bodies separate and every surface resident inside its canonical region', () => {
    const rows = LEGACY_ENCOUNTER_PLACEMENTS.map(layout => ({ layout, formed: formation(layout) }));
    for (const { layout, formed } of rows) {
      const region = SOURCE_REGIONS.find(region => region.id === layout.regionId);
      for (const [index, anchor] of formed.anchors.entries()) {
        if (region) {
          expect(anchor[0] - layout.bodyRadiusBudget, layout.id).toBeGreaterThan(region.bounds.min[0]);
          expect(anchor[0] + layout.bodyRadiusBudget, layout.id).toBeLessThan(region.bounds.max[0]);
          expect(anchor[1] - layout.bodyRadiusBudget, layout.id).toBeGreaterThan(region.bounds.min[1]);
          expect(anchor[1] + layout.bodyRadiusBudget, layout.id).toBeLessThan(region.bounds.max[1]);
        }
        for (const other of formed.anchors.slice(index + 1))
          expect(distance(anchor, other), layout.id).toBeGreaterThanOrEqual(layout.bodyRadiusBudget * 2 + .5 - 1e-6);
        for (const other of rows.filter(row => row.layout.id !== layout.id && row.layout.regionId === layout.regionId))
          for (const neighbor of other.formed.anchors)
            expect(distance(anchor, neighbor), `${layout.id}/${other.layout.id}`)
              .toBeGreaterThanOrEqual(layout.bodyRadiusBudget + other.layout.bodyRadiusBudget + .5 - 1e-6);
      }
    }
  });

  it('keeps relocated Wilderness packs clear of the new hatchlings and deep encounter bodies', () => {
    for (const layout of LEGACY_ENCOUNTER_PLACEMENTS.filter(row => row.regionId === 'wilderness')) {
      for (const anchor of formation(layout).anchors) for (const pack of DEEP_WILDERNESS_PACKS)
        for (const other of deepWildernessPackFormation(pack).anchors)
          expect(distance(anchor, other), `${layout.id}/${pack.id}`)
            .toBeGreaterThan(layout.bodyRadiusBudget + pack.bodyRadius + .5);
    }
  });

  it('leaves mines, grove work floors and Wilderness lava clear at every expanded anchor', () => {
    for (const layout of LEGACY_ENCOUNTER_PLACEMENTS.filter(row => row.regionId !== 'gravelmaw')) {
      for (const point of formation(layout).anchors) {
        for (const site of WORLD_SITES.filter(site => site.kind !== 'habitat')) {
          if (site.kind === 'fishery') {
            // A fishery extent includes the pond and its whole natural bank. Shore species
            // share that bank; the actual work aisle and native props remain excluded.
            expect(distance(point, site.centre), `${layout.id}/${site.id} work aisle`)
              .toBeGreaterThan(site.workRadius + layout.bodyRadiusBudget);
            for (const prop of site.dressing) {
              const asset = manifest.assets.find(asset => asset.id === prop.assetId)!;
              const scale = typeof prop.scale === 'number' ? [prop.scale, prop.scale, prop.scale] : prop.scale;
              const origin = worldSitePoint(site, prop.x, prop.z), yaw = site.rotationY + prop.yaw;
              const cx = (asset.base.x + asset.size.x / 2) * scale[0]!;
              const cz = (asset.base.z + asset.size.z / 2) * scale[2]!;
              const dx = point[0] - origin[0] - cx * Math.cos(yaw) - cz * Math.sin(yaw);
              const dz = point[1] - origin[1] + cx * Math.sin(yaw) - cz * Math.cos(yaw);
              const gap = Math.hypot(Math.max(0, Math.abs(dx * Math.cos(yaw) - dz * Math.sin(yaw)) - asset.size.x * scale[0]! / 2),
                Math.max(0, Math.abs(dx * Math.sin(yaw) + dz * Math.cos(yaw)) - asset.size.z * scale[2]! / 2));
              expect(gap, `${layout.id}/${site.id}/${prop.id}`).toBeGreaterThan(layout.bodyRadiusBudget + .05);
            }
            continue;
          }
          const dx = point[0] - site.centre[0], dz = point[1] - site.centre[1];
          const x = dx * Math.cos(site.rotationY) - dz * Math.sin(site.rotationY);
          const z = dx * Math.sin(site.rotationY) + dz * Math.cos(site.rotationY);
          const gap = Math.hypot(Math.max(0, Math.abs(x) - site.extent[0]), Math.max(0, Math.abs(z) - site.extent[1]));
          expect(gap, `${layout.id}/${site.id}`).toBeGreaterThan(layout.bodyRadiusBudget);
        }
        if (layout.regionId === 'wilderness') {
          expect(lavaClearanceAt(point[0], point[1], WILDERNESS_LAVA_EXPANSION_CHANNELS), layout.id)
            .toBeGreaterThan(layout.bodyRadiusBudget + .25);
          for (const resource of WILDERNESS_RESOURCE_INTENTS) {
            const gap = Math.hypot(Math.max(0, Math.abs(point[0] - resource.position[0]) - 23),
              Math.max(0, Math.abs(point[1] - resource.position[1]) - (resource.kind === 'mine' ? 25 : 23)));
            expect(gap, `${layout.id}/${resource.id}`).toBeGreaterThan(layout.bodyRadiusBudget);
          }
        }
      }
    }
  });

  it('fits the production farm, castle and ruin collision geometry', () => {
    const assets = new Map(manifest.assets.map(asset => [asset.id, asset]));
    const scene = [
      { id: 'farm_yard' as const, position: [-96,-22], rotationY: 0 },
      { id: 'black_knight_castle' as const, position: [40,600], rotationY: Math.PI },
      ...WILDERNESS_RUIN_SITES.map(site => ({ id: site.composition, position: site.position, rotationY: site.rotationY })),
    ];
    const solids = scene.flatMap(site => structureCollisionFromCompositionParts(site.id, buildComposition(site.id, 21),
      { origin: [site.position[0]!, 0, site.position[1]!], rotationY: site.rotationY, ownerId: site.id }, {
        assetSize: id => assets.get(id)?.size ?? null,
        assetCenterXZ: id => { const asset = assets.get(id); return asset?.base && asset.size
          ? { x: asset.base.x + asset.size.x / 2, z: asset.base.z + asset.size.z / 2 } : null; },
      }));
    for (const layout of LEGACY_ENCOUNTER_PLACEMENTS.filter(row => row.regionId !== 'gravelmaw'))
      for (const anchor of formation(layout).anchors) for (const solid of solids)
        expect(gapToSolid(anchor, solid), `${layout.id}/${solid.id}`).toBeGreaterThan(layout.bodyRadiusBudget + .05);
  });

  it('keeps all thirty-five early cave residents before the original locked door on receiving floor', () => {
    const original = SOURCE_REGIONS.find(region => region.dungeon)?.dungeon!;
    const dungeon = { ...original, chambers: original.chambers.map(chamber => ({ ...chamber,
      radius: LEGACY_CAVE_FLOOR_INTENTS.find(row => row.id === chamber.id)?.radius ?? chamber.radius })) };
    const spec: DungeonSpec = { regionId: 'gravelmaw', wallHeight: 13, corridors: [],
      chambers: dungeon.chambers.map(chamber => ({ ...chamber, centre: [...chamber.centre], floorY: chamber.floorOffset })) };
    const walls = dungeonSolids(spec, { includeCeilings: false });
    const thresholds = authoredThresholds(dungeon, 0);
    const solids = [...walls, ...thresholds.flatMap(threshold => threshold.staticSolids.filter(solid => !solid.id.includes('partition:2:')))];
    const before = LEGACY_ENCOUNTER_PLACEMENTS.filter(row => row.regionId === 'gravelmaw' && row.id !== 'gravelmaw_ch3_bears');
    expect(before.reduce((sum, row) => sum + row.count, 0)).toBe(35);
    const oldFloor = { ...spec, chambers: spec.chambers.map(chamber => ({ ...chamber,
      radius: LEGACY_CAVE_FLOOR_INTENTS.find(row => row.id === chamber.id)?.originalRadius ?? chamber.radius })) };
    expect(chamberFloorAt(oldFloor, [40.75, 0, -29 + 1.2])).toBeNull();
    expect(chamberFloorAt(spec, [40.75, 0, -29 + 1.2])).not.toBeNull();
    for (const layout of LEGACY_ENCOUNTER_PLACEMENTS.filter(row => row.regionId === 'gravelmaw')) {
      for (const point of formation(layout).anchors) {
        for (const solid of solids) expect(gapToSolid(point, solid), `${layout.id}/${solid.id}`).toBeGreaterThan(layout.bodyRadiusBudget + .05);
        for (let index = 0; index < 12; index++) {
          const angle = index / 12 * Math.PI * 2;
          expect(chamberFloorAt(spec, [point[0] + Math.cos(angle) * layout.bodyRadiusBudget, 0,
            point[1] + Math.sin(angle) * layout.bodyRadiusBudget]), layout.id).not.toBeNull();
        }
        const side = (point[0] - 26) * Math.sin(.41822432957922906) + (point[1] + 68) * Math.cos(.41822432957922906);
        if (layout.id !== 'gravelmaw_ch3_bears') expect(side, layout.id).toBeGreaterThan(layout.bodyRadiusBudget + 1);
        else expect(side, layout.id).toBeLessThan(-layout.bodyRadiusBudget - 1);
      }
    }
  });
});

describe('expanded Wilderness population proposal', () => {
  it('covers all six dragon and six new creature bodies with 24 ordinary packs', () => {
    expect(DEEP_WILDERNESS_PACKS).toHaveLength(24);
    expect(new Set(DEEP_WILDERNESS_PACKS.map(pack => pack.id)).size).toBe(24);
    expect(new Set(DEEP_WILDERNESS_PACKS.map(pack => pack.speciesId)).size).toBe(12);
    expect(DEEP_WILDERNESS_PACKS.filter(pack => pack.siteId)).toHaveLength(6);
    for (const pack of DEEP_WILDERNESS_PACKS) {
      expect(pack.count).toBeGreaterThanOrEqual(7); expect(pack.count).toBeLessThanOrEqual(15);
      expect(DEEP_WILDERNESS_PACK_HABITATS.find(row => row.groupId === pack.id)?.anchors).toHaveLength(pack.count);
      if (pack.speciesId.startsWith('baby_')) expect(wildernessTierAt(pack.centre[1])).toBe(50);
      if (pack.speciesId.endsWith('_wilderness_dragon')) expect(wildernessTierAt(pack.centre[1])).toBe(70);
    }
  });

  it('places two singular rune keepers shallow and three in deep structure rear courts', () => {
    expect(DEEP_WILDERNESS_KEEPERS).toHaveLength(5);
    expect(DEEP_WILDERNESS_KEEPERS.filter(keeper => keeper.tier === 50)).toHaveLength(2);
    expect(DEEP_WILDERNESS_KEEPERS.filter(keeper => keeper.tier === 70)).toHaveLength(3);
    expect(new Set(DEEP_WILDERNESS_KEEPERS.map(keeper => keeper.rune)).size).toBe(5);
    for (const keeper of DEEP_WILDERNESS_KEEPERS) {
      expect(keeper.count).toBe(1);
      expect(wildernessTierAt(keeper.centre[1])).toBe(keeper.tier);
    }
  });

  it('keeps every animated anchor dry, in its depth band and away from lava banks', () => {
    for (const pack of DEEP_WILDERNESS_PACKS) {
      const formation = deepWildernessPackFormation(pack);
      for (const point of formation.anchors) {
        expect(Math.abs(point[0]) + pack.bodyRadius, pack.id).toBeLessThan(350);
        expect(point[1] - pack.bodyRadius, pack.id).toBeGreaterThan(WILDERNESS_DEPTH.south);
        expect(point[1] + pack.bodyRadius, pack.id).toBeLessThan(WILDERNESS_DEPTH.north);
        expect(wildernessTierAt(point[1]), pack.id).toBe(wildernessTierAt(pack.centre[1]));
        expect(lavaClearanceAt(point[0], point[1], WILDERNESS_LAVA_EXPANSION_CHANNELS), pack.id)
          .toBeGreaterThan(pack.bodyRadius + 1);
      }
    }
  });

  it('reserves animated bodies between packs, even at dense fortress courts', () => {
    for (const [index, first] of DEEP_WILDERNESS_PACKS.entries()) for (const second of DEEP_WILDERNESS_PACKS.slice(index + 1)) {
      for (const a of deepWildernessPackFormation(first).anchors) for (const b of deepWildernessPackFormation(second).anchors) {
        expect(distance(a, b), `${first.id}/${second.id}`).toBeGreaterThan(first.bodyRadius + second.bodyRadius + .5);
      }
    }
  });

  it('fits inhabited structure courts and leaves their central through lanes open', () => {
    for (const pack of DEEP_WILDERNESS_PACKS.filter(pack => pack.siteId)) {
      const site = WILDERNESS_EXPANSION_SITES.find(site => site.id === pack.siteId)!;
      const structure = DEEP_WILDERNESS_STRUCTURES[site.id];
      const court = structure.courts[pack.court === 'west' ? 0 : 1]!;
      for (const point of deepWildernessPackFormation(pack).anchors) {
        const dx = point[0] - site.position[0], dz = point[1] - site.position[1];
        const local = [dx * Math.cos(site.rotationY) - dz * Math.sin(site.rotationY),
          dx * Math.sin(site.rotationY) + dz * Math.cos(site.rotationY)];
        expect(distance(local, court.centre) + pack.bodyRadius, pack.id).toBeLessThanOrEqual(court.radius + 1e-6);
        expect(Math.abs(local[0]!) - pack.bodyRadius, pack.id).toBeGreaterThan(structure.clearWidth / 2);
      }
    }
  });

  it('leaves new resource work floors and other structure footprints clear', () => {
    for (const pack of DEEP_WILDERNESS_PACKS) {
      for (const point of deepWildernessPackFormation(pack).anchors) {
        for (const resource of WILDERNESS_RESOURCE_INTENTS) {
          const halfX = 23, halfZ = resource.kind === 'mine' ? 25 : 23;
          const gap = Math.hypot(Math.max(0, Math.abs(point[0] - resource.position[0]) - halfX),
            Math.max(0, Math.abs(point[1] - resource.position[1]) - halfZ));
          expect(gap, `${pack.id}/${resource.id}`).toBeGreaterThan(pack.bodyRadius + 1);
        }
        for (const site of WILDERNESS_EXPANSION_SITES) {
          if (site.id === pack.siteId) continue;
          const dx = point[0] - site.position[0], dz = point[1] - site.position[1];
          const x = dx * Math.cos(site.rotationY) - dz * Math.sin(site.rotationY);
          const z = dx * Math.sin(site.rotationY) + dz * Math.cos(site.rotationY);
          const gap = Math.hypot(Math.max(0, Math.abs(x) - site.footprint[0] / 2),
            Math.max(0, Math.abs(z) - site.footprint[1] / 2));
          expect(gap, `${pack.id}/${site.id}`).toBeGreaterThan(pack.bodyRadius + 1);
        }
      }
    }
  });
});
