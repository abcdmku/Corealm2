import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Vec3 } from '../game/src/contracts.js';
import { buildFairyTerrainSpec } from '../game/src/app/worldSpec.js';
import { prepareWorldSurface } from '../game/src/app/worldSurface.js';
import { getRegion, type SettlementDef } from '../game/src/content/regions.js';
import { WorldScene } from '../game/src/render/scene.js';
import { buildPrefab, prefabCollision, variantSeed } from '../game/src/render/buildings.js';
import { Solids } from '../game/src/systems/solids.js';
import { structureCollisionFromBoxes } from '../game/src/world/regionBuilder.js';

const gloamgarden = getRegion('gloamgarden')!;
const faeholme = getRegion('faeholme')!;
const lantern = gloamgarden.settlements.find(town => town.id === 'lantern_rest')!;
const prism = faeholme.settlements.find(town => town.id === 'prism_hollow')!;
const assetIds = new Set((JSON.parse(readFileSync('game/public/assets/manifest.json', 'utf8')) as {
  assets: { id: string }[];
}).assets.map(asset => asset.id));

function settlementSolids(town: SettlementDef, regionId: 'gloamgarden' | 'faeholme'): Solids {
  return new Solids(town.buildings.flatMap(building => structureCollisionFromBoxes(
    prefabCollision(building.prefab, building.footprint, variantSeed(building.id)), {
      origin: [building.position[0], 0, building.position[1]], rotationY: building.rotationY,
      ownerId: building.id, name: building.name, prefab: building.prefab, regionId,
    },
  ).solids));
}

function clearSegment(solids: Solids, a: readonly number[], b: readonly number[], label: string): void {
  const count = Math.ceil(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) / .15);
  for (let step = 0; step <= count; step++) {
    const t = step / Math.max(1, count);
    const x = a[0]! + (b[0]! - a[0]!) * t, z = a[1]! + (b[1]! - a[1]!) * t;
    const point: Vec3 = [x, 0, z];
    const resolved = solids.resolve(point, point, .9);
    expect(Math.hypot(resolved[0] - x, resolved[2] - z), `${label} at ${t.toFixed(2)}`).toBeLessThan(.001);
  }
}

describe('authoritative fairy settlements', () => {
  it('places their named banks and separate market services in the compiled world', () => {
    for (const [region, town] of [[gloamgarden, lantern], [faeholme, prism]] as const) {
      expect(region.locations.some(location => location.id === town.bankLocationId && location.kind === 'bank')).toBe(true);
      expect(town.bank.attachedTo).toBeDefined();
      expect(town.buildings.some(building => building.id === town.bank.attachedTo)).toBe(true);
      expect(town.shops).toHaveLength(3);
      expect(new Set(town.shops.map(shop => shop.id)).size).toBe(3);
      expect(town.buildings.some(building => building.prefab === 'market_row')).toBe(false);
      for (const shop of town.shops) expect(assetIds.has(shop.assetId), shop.id).toBe(true);
    }
    expect(lantern.bank.position).toEqual([2085.25, -115.4]);
    expect(prism.bank.position).toEqual([2308.4, 135.65]);
  });

  it('keeps the authored bank approaches open to player navigation', () => {
    clearSegment(settlementSolids(lantern, 'gloamgarden'), [2089, -115], [2087.2, -115], 'Lantern bank');
    clearSegment(settlementSolids(prism, 'faeholme'), [2304.5, 135.8], [2306.5, 135.65], 'Prism bank');
    expect(Math.hypot(2087.2 - lantern.bank.position[0], -115 - lantern.bank.position[1])).toBeLessThan(2);
    expect(Math.hypot(2306.5 - prism.bank.position[0], 135.65 - prism.bank.position[1])).toBeLessThan(2);
  });

  it('uses only measured building assets and keeps local footings level', () => {
    for (const town of [lantern, prism]) for (const building of town.buildings) {
      const parts = buildPrefab(building.prefab, building.footprint, variantSeed(building.id), town.kit);
      expect(parts.length, building.id).toBeGreaterThan(0);
      for (const part of parts) expect(assetIds.has(part.assetId), `${building.id}/${part.assetId}`).toBe(true);
    }
    const scene = new WorldScene(new THREE.Scene());
    try {
      scene.buildWorld(buildFairyTerrainSpec(), prepareWorldSurface);
      for (const building of [...lantern.buildings, ...prism.buildings]) {
        const centre = scene.meshHeightAt(...building.position);
        const cosine = Math.cos(building.rotationY), sine = Math.sin(building.rotationY);
        for (const x of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
          const localX = x * building.footprint[0] / 2, localZ = z * building.footprint[1] / 2;
          const height = scene.meshHeightAt(building.position[0] + localX * cosine + localZ * sine,
            building.position[1] - localX * sine + localZ * cosine);
          expect(Math.abs(height - centre), `${building.id} footing at ${x},${z}`).toBeLessThan(.2);
        }
      }
    } finally {
      scene.clear();
    }
  });
});
