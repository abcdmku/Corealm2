import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { SolidVolume, Vec3 } from '../game/src/contracts.js';
import { buildFairyTerrainSpec } from '../game/src/app/worldSpec.js';
import { prepareWorldSurface } from '../game/src/app/worldSurface.js';
import { WorldScene } from '../game/src/render/scene.js';
import { LANTERN_REST, LANTERN_REST_FOUNDATIONS, LANTERN_REST_LOCATIONS, LANTERN_REST_ROADS } from '../game/src/content/settlements/lanternRest.js';
import { PRISM_HOLLOW, PRISM_HOLLOW_FOUNDATIONS, PRISM_HOLLOW_LOCATIONS, PRISM_HOLLOW_ROADS } from '../game/src/content/settlements/prismHollow.js';
import type { SettlementDef } from '../game/src/content/regions.js';
import { BUILDING_KITS, buildPrefab, prefabCollision, roofOverhang, variantSeed } from '../game/src/render/buildings.js';
import { selectedStructureVariantId } from '../game/src/render/structures/catalog.js';
import { createFairyMarketCanopyGeometry } from '../game/src/render/fairyArchitecture.js';
import { Solids } from '../game/src/systems/solids.js';
import { structureCollisionFromAsset, structureCollisionFromBoxes } from '../game/src/world/regionBuilder.js';

const manifest = JSON.parse(readFileSync('game/public/assets/manifest.json', 'utf8')) as {
  assets: { id: string; size: { x: number; y: number; z: number }; base: { x: number; y: number; z: number } }[];
};
const assetIds = new Set(manifest.assets.map(asset => asset.id));
const assetsById = new Map(manifest.assets.map(asset => [asset.id, asset]));
const solidVolumes = LANTERN_REST.buildings.flatMap(building => structureCollisionFromBoxes(
  prefabCollision(building.prefab, building.footprint, variantSeed(building.id)), {
    origin: [building.position[0], 0, building.position[1]], rotationY: building.rotationY,
    ownerId: building.id, name: building.name, prefab: building.prefab, regionId: 'gloamgarden',
  },
).solids);
const solids = new Solids(solidVolumes);

function clearAt(x: number, z: number, label: string, collision = solids): void {
  const position: Vec3 = [x, 0, z];
  const resolved = collision.resolve(position, position, 0.9);
  expect(Math.hypot(resolved[0] - x, resolved[2] - z), label).toBeLessThan(0.001);
}

function clearSegment(a: readonly number[], b: readonly number[], label: string, collision = solids): void {
  const distance = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
  const count = Math.ceil(distance / 0.15);
  for (let step = 0; step <= count; step++) {
    const t = step / Math.max(1, count);
    clearAt(a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, `${label} at ${t.toFixed(3)}`, collision);
  }
}

function boxCorners(box: SolidVolume): number[][] {
  if (box.kind !== 'box') throw new Error('Expected a structure box');
  const cos = Math.cos(box.rotationY), sin = Math.sin(box.rotationY);
  return [-1, 1].flatMap(x => [-1, 1].map(z => [
    box.position[0] + x * box.size[0] / 2 * cos + z * box.size[2] / 2 * sin,
    box.position[2] - x * box.size[0] / 2 * sin + z * box.size[2] / 2 * cos,
  ]));
}

describe('Lantern Rest hamlet', () => {
  it('preserves the bank, spawn court and both arrival routes', () => {
    expect(LANTERN_REST.bank.id).toBe('lantern_rest_bank');
    expect(LANTERN_REST.bank.position).toEqual([2085.25, -115.4]);
    expect(LANTERN_REST.centre).toEqual([2080, -105]);
    clearSegment([2068, -128], [2068, -120], 'portal to arrival');
    clearSegment([2068, -120], LANTERN_REST.centre, 'arrival to square');
    clearSegment(LANTERN_REST.centre, [2091, -106], 'square to bank lane');
    clearSegment([2091, -106], [2089, -115], 'bank lane to counter');
  });

  it('leaves every authored branch clear of production building collision with navigation clearance', () => {
    const points = new Map<string, readonly number[]>([
      ['lantern_rest_square', LANTERN_REST.centre],
      ['lantern_rest_bank_approach', [2089, -115]],
      ['gloamgarden_arrival', [2068, -120]],
      ...LANTERN_REST_LOCATIONS.map(location => [location.id, location.position] as const),
    ]);
    for (const road of LANTERN_REST_ROADS) {
      expect(points.has(road.from), road.from).toBe(true);
      expect(points.has(road.to), road.to).toBe(true);
      clearSegment(points.get(road.from)!, points.get(road.to)!, `${road.from} to ${road.to}`);
    }
    // Real services retain clear standing room at the open fronts.
    clearSegment([2060, -118], [2060, -121.5], 'forge mouth');
    clearSegment([2080, -100], [2077, -100], 'general stall approach');
    clearSegment([2088, -99], [2086.3, -100], 'cooking bay approach');
  });

  it('uses several production cottage variations and only measured manifest assets', () => {
    const cottages = LANTERN_REST.buildings.filter(building => building.prefab === 'cottage');
    expect(cottages).toHaveLength(5);
    const variants = new Set(cottages.map(building => selectedStructureVariantId(
      building.prefab, building.footprint, variantSeed(building.id), BUILDING_KITS[LANTERN_REST.kit],
    )));
    expect(variants.size).toBeGreaterThanOrEqual(4);
    const placedAssets = [
      ...LANTERN_REST.buildings.flatMap(building => buildPrefab(
        building.prefab, building.footprint, variantSeed(building.id), LANTERN_REST.kit,
      ).map(part => part.assetId)),
      LANTERN_REST.bank.assetId,
      ...LANTERN_REST.stations.map(station => station.assetId),
      ...LANTERN_REST.shops.map(shop => shop.assetId),
      ...(LANTERN_REST.props ?? []).map(prop => prop.assetId),
    ];
    for (const id of new Set(placedAssets)) expect(assetIds.has(id), id).toBe(true);
  });

  it('keeps roof silhouettes apart and service attachments within their real structures', () => {
    const canopy = createFairyMarketCanopyGeometry();
    const canopySize = canopy.boundingBox!.getSize(new THREE.Vector3());
    const canopyCentre = canopy.boundingBox!.getCenter(new THREE.Vector3());
    canopy.dispose();
    const roofs = LANTERN_REST.buildings.flatMap(building => {
      if (building.prefab === 'market_row') {
        return buildPrefab(building.prefab, building.footprint, variantSeed(building.id), LANTERN_REST.kit)
          .filter(part => part.assetId === 'market_stall').map(part => {
            const localX = part.dx + canopyCentre.x * Math.cos(part.rotationY) + canopyCentre.z * Math.sin(part.rotationY);
            const localZ = part.dz - canopyCentre.x * Math.sin(part.rotationY) + canopyCentre.z * Math.cos(part.rotationY);
            return { kind: 'box' as const, id: `${building.id}/${part.tag}`, ownerId: building.id,
              position: [building.position[0] + localX * Math.cos(building.rotationY) + localZ * Math.sin(building.rotationY), 0,
                building.position[1] - localX * Math.sin(building.rotationY) + localZ * Math.cos(building.rotationY)] as Vec3,
              size: [canopySize.x, 1, canopySize.z] as Vec3, rotationY: building.rotationY + part.rotationY };
          });
      }
      const overhang = roofOverhang(building.prefab, building.footprint, LANTERN_REST.kit);
      return [{ kind: 'box' as const, id: building.id, ownerId: building.id, position: [building.position[0], 0, building.position[1]] as Vec3,
        size: [building.footprint[0] + overhang.x * 2, 1, building.footprint[1] + overhang.z * 2] as Vec3,
        rotationY: building.rotationY }];
    });
    for (let a = 0; a < roofs.length; a++) for (let b = a + 1; b < roofs.length; b++) {
      // The adjacent cloth stalls are one market building. The original assertion checks the
      // full one-metre separation between different structures, now using actual canopy bounds.
      if (roofs[a]!.ownerId === roofs[b]!.ownerId) continue;
      const left = boxCorners(roofs[a]!), right = boxCorners(roofs[b]!);
      const separated = [0, 1].some(axis => Math.max(...left.map(point => point[axis]!)) + 1
        < Math.min(...right.map(point => point[axis]!))
        || Math.max(...right.map(point => point[axis]!)) + 1 < Math.min(...left.map(point => point[axis]!)));
      expect(separated, `${roofs[a]!.id} / ${roofs[b]!.id}`).toBe(true);
    }
    for (const service of [LANTERN_REST.bank, ...LANTERN_REST.stations, ...LANTERN_REST.shops]) {
      const building = LANTERN_REST.buildings.find(entry => entry.id === service.attachedTo)!;
      expect(building, service.id).toBeDefined();
      const dx = service.position[0] - building.position[0], dz = service.position[1] - building.position[1];
      const localX = dx * Math.cos(building.rotationY) - dz * Math.sin(building.rotationY);
      const localZ = dx * Math.sin(building.rotationY) + dz * Math.cos(building.rotationY);
      const gap = Math.hypot(Math.max(0, Math.abs(localX) - building.footprint[0] / 2),
        Math.max(0, Math.abs(localZ) - building.footprint[1] / 2));
      expect(gap, service.id).toBeLessThanOrEqual(3);
    }
  });

  it('grounds each building on its own small footing without merging the town into one pad', () => {
    expect(LANTERN_REST.padShape).toBeUndefined();
    expect(LANTERN_REST_FOUNDATIONS).toHaveLength(LANTERN_REST.buildings.length);
    for (const foundation of LANTERN_REST_FOUNDATIONS) {
      const building = LANTERN_REST.buildings.find(entry => entry.id === foundation.buildingId)!;
      expect(foundation.halfExtents).toEqual([building.footprint[0] / 2 + 1, building.footprint[1] / 2 + 1]);
      expect(foundation.radius).toBeCloseTo(Math.hypot(...foundation.halfExtents));
      expect(foundation.blend).toBeLessThanOrEqual(1);
      expect(foundation.rotationY).toBe(building.rotationY);
      expect(foundation.halfExtents[0]).toBeGreaterThan(building.footprint[0] / 2);
      expect(foundation.halfExtents[1]).toBeGreaterThan(building.footprint[1] / 2);
    }
  });
});

describe('Prism Hollow hamlet', () => {
  it('keeps the entry, bank and cottage branches clear without opening a town road onto the combat table', () => {
    const collision = new Solids(PRISM_HOLLOW.buildings.flatMap(building => structureCollisionFromBoxes(
      prefabCollision(building.prefab, building.footprint, variantSeed(building.id)), {
        origin: [building.position[0], 0, building.position[1]], rotationY: building.rotationY,
        ownerId: building.id, name: building.name, prefab: building.prefab, regionId: 'faeholme',
      },
    ).solids));
    const points = new Map<string, readonly number[]>([
      ['faeholme_south_path', [2300, 140]],
      ...PRISM_HOLLOW_LOCATIONS.map(location => [location.id, location.position] as const),
    ]);
    for (const road of PRISM_HOLLOW_ROADS) {
      expect(points.has(road.from), road.from).toBe(true);
      expect(points.has(road.to), road.to).toBe(true);
      clearSegment(points.get(road.from)!, points.get(road.to)!, `${road.from} to ${road.to}`, collision);
    }
    expect(PRISM_HOLLOW.respawnPointId).toBe('lantern_rest');
    expect(PRISM_HOLLOW_LOCATIONS.every(location => location.position[1] < 169)).toBe(true);
  });

  it('uses existing production recipes with separate small footings', () => {
    expect(PRISM_HOLLOW.buildings.filter(building => building.prefab === 'cottage')).toHaveLength(3);
    for (const building of PRISM_HOLLOW.buildings) {
      const parts = buildPrefab(building.prefab, building.footprint, variantSeed(building.id), PRISM_HOLLOW.kit);
      for (const part of parts) expect(assetIds.has(part.assetId), part.assetId).toBe(true);
      const foundation = PRISM_HOLLOW_FOUNDATIONS.find(entry => entry.buildingId === building.id)!;
      expect(foundation.radius).toBeLessThan(6);
      expect(foundation.blend).toBeLessThanOrEqual(1);
    }
  });
});

function settlementSolids(town: SettlementDef): Solids {
  const volumes = town.buildings.flatMap(building => structureCollisionFromBoxes(
    prefabCollision(building.prefab, building.footprint, variantSeed(building.id)), {
      origin: [building.position[0], 0, building.position[1]], rotationY: building.rotationY,
      ownerId: building.id, name: building.name, prefab: building.prefab,
      regionId: town.id === 'lantern_rest' ? 'gloamgarden' : 'faeholme',
    },
  ).solids);
  const measurements = {
    assetSize: (id: string) => assetsById.get(id)?.size ?? null,
    assetCenterXZ: (id: string) => {
      const asset = assetsById.get(id);
      return asset ? { x: asset.base.x + asset.size.x / 2, z: asset.base.z + asset.size.z / 2 } : null;
    },
  };
  for (const prop of [...(town.props ?? []).filter(prop => prop.solid), ...town.stations, ...town.shops, town.bank]) {
    const scale = 'scale' in prop ? prop.scale ?? 1 : 1;
    const position: Vec3 = [prop.position[0], -(assetsById.get(prop.assetId)?.base.y ?? 0) * scale, prop.position[1]];
    const solid = structureCollisionFromAsset(prop.id, position, prop.assetId, scale, prop.rotationY, true, measurements);
    if (solid) volumes.push(solid);
  }
  return new Solids(volumes);
}

describe('compact fairy village compositions', () => {
  it.each([
    { town: LANTERN_REST, locations: LANTERN_REST_LOCATIONS, roads: LANTERN_REST_ROADS },
    { town: PRISM_HOLLOW, locations: PRISM_HOLLOW_LOCATIONS, roads: PRISM_HOLLOW_ROADS },
  ])('keeps all $town.id lanes clear of real buildings, fences, counters and service props', ({ town, locations, roads }) => {
    const collision = settlementSolids(town);
    const points = new Map<string, readonly number[]>([
      ['lantern_rest_square', [2080, -105]], ['lantern_rest_bank_approach', [2089, -115]],
      ['gloamgarden_arrival', [2068, -120]], ['faeholme_south_path', [2300, 140]],
      ...locations.map(location => [location.id, location.position] as const),
    ]);
    for (const road of roads) clearSegment(points.get(road.from)!, points.get(road.to)!, `${road.from} to ${road.to}`, collision);
  });

  it('builds exactly three real cloth stalls and replaces bare bank walls with reachable pitched-roof pavilions', () => {
    const town = LANTERN_REST;
    const market = town.buildings.find(building => building.id === 'lantern_rest_shelter')!;
    expect(market.footprint).toEqual([12, 3]);
    const parts = buildPrefab(market.prefab, market.footprint, variantSeed(market.id), town.kit);
    expect(parts.filter(part => part.assetId === 'market_stall')).toHaveLength(3);
    expect(town.shops.filter(shop => shop.assetId === 'market_stall')).toHaveLength(0);
    for (const settlement of [town, PRISM_HOLLOW]) {
      const pavilion = settlement.buildings.find(building => building.id === settlement.bank.attachedTo)!;
      expect(pavilion.prefab).toBe('forge');
      const geometry = buildPrefab(pavilion.prefab, pavilion.footprint, variantSeed(pavilion.id), settlement.kit);
      expect(geometry.some(part => part.tag === 'roof')).toBe(true);
      expect(geometry.some(part => part.assetId === 'lamp_wall')).toBe(true);
      expect(prefabCollision(pavilion.prefab, pavilion.footprint, variantSeed(pavilion.id)).map(box => box.tag)).toEqual(['back', 'left', 'right']);
    }
  });

  it('allows standing within bank interaction range through both open pavilion fronts', () => {
    const lantern = settlementSolids(LANTERN_REST), prism = settlementSolids(PRISM_HOLLOW);
    clearSegment([2089, -115], [2087.2, -115], 'Lantern bank interaction approach', lantern);
    clearSegment([2304.5, 135.8], [2306.5, 135.65], 'Prism bank interaction approach', prism);
    expect(LANTERN_REST.bank.position).toEqual([2085.25, -115.4]);
    expect(PRISM_HOLLOW.bank.position).toEqual([2308.4, 135.65]);
    expect(Math.hypot(2087.2 - LANTERN_REST.bank.position[0], -115 - LANTERN_REST.bank.position[1])).toBeLessThan(2);
    expect(Math.hypot(2306.5 - PRISM_HOLLOW.bank.position[0], 135.65 - PRISM_HOLLOW.bank.position[1])).toBeLessThan(2);
  });

  it('keeps the actual terrain floor level across all twelve building footprints beside receiving banks', () => {
    const scene = new WorldScene(new THREE.Scene());
    try {
      scene.buildWorld(buildFairyTerrainSpec(), prepareWorldSurface);
      const buildings = [...LANTERN_REST.buildings, ...PRISM_HOLLOW.buildings];
      expect(buildings).toHaveLength(12);
      for (const building of buildings) {
        const centreHeight = scene.meshHeightAt(...building.position);
        const cos = Math.cos(building.rotationY), sin = Math.sin(building.rotationY);
        for (const x of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
          const localX = x * building.footprint[0] / 2, localZ = z * building.footprint[1] / 2;
          const height = scene.meshHeightAt(building.position[0] + localX * cos + localZ * sin,
            building.position[1] - localX * sin + localZ * cos);
          expect(Math.abs(height - centreHeight), `${building.id} floor at ${x},${z}`).toBeLessThan(.025);
        }
      }
      // The curved outer stalls project beyond the old rectangular row. Check their real contact
      // corners and added rear posts as well as preserving all twelve footprint checks above.
      const market = LANTERN_REST.buildings.find(building => building.id === 'lantern_rest_shelter')!;
      const marketFloor = scene.meshHeightAt(...market.position);
      const marketParts = buildPrefab(market.prefab, market.footprint, variantSeed(market.id), LANTERN_REST.kit)
        .filter(part => part.assetId === 'market_stall' || part.tag.startsWith('fairy_stall_rear_post_'));
      expect(marketParts).toHaveLength(9);
      for (const part of marketParts) {
        const asset = assetsById.get(part.assetId)!;
        const axes = part.scaleAxes ?? [1, 1, 1];
        for (const x of [asset.base.x, asset.base.x + asset.size.x]) {
          for (const z of [asset.base.z, asset.base.z + asset.size.z]) {
            const px = part.dx + x * part.scale * axes[0]! * Math.cos(part.rotationY) + z * part.scale * axes[2]! * Math.sin(part.rotationY);
            const pz = part.dz - x * part.scale * axes[0]! * Math.sin(part.rotationY) + z * part.scale * axes[2]! * Math.cos(part.rotationY);
            const worldX = market.position[0] + px * Math.cos(market.rotationY) + pz * Math.sin(market.rotationY);
            const worldZ = market.position[1] - px * Math.sin(market.rotationY) + pz * Math.cos(market.rotationY);
            expect(Math.abs(scene.meshHeightAt(worldX, worldZ) - marketFloor), `${market.id}/${part.tag} ground contact`).toBeLessThan(.025);
          }
        }
      }
    } finally {
      scene.clear();
    }
  });
});
