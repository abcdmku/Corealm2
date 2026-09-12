import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { SemanticEntity } from '../game/src/contracts.js';
import { immediatePlayerItems, selectPlayerEntities } from '../game/src/render/playerAssetPlan.js';
import { CharacterRig } from '../game/src/render/characterRig.js';
import { WorldSiteStreaming } from '../game/src/world/worldSiteStreaming.js';
import { resolveWorldSiteDressing } from '../game/src/render/worldSiteDressing.js';
import type { WorldSite } from '../game/src/content/worldSites.js';
import { StructureCameraStreaming } from '../game/src/render/structureCameraSources.js';

const area = { position: [0, 0, 0] as [number, number, number], regionId: 'fallowmarch' as const, resourceRadius: 32, viewRadius: 160 };
const entity = (id: string, x: number, archetype: SemanticEntity['archetype'], regionId: SemanticEntity['regionId'] = 'fallowmarch'): SemanticEntity => ({
  id, name: id, tier: 1, archetype, regionId, state: 'available', position: [x, 0, 0], interactions: [], view: { assetId: id },
});

describe('player-specific loading', () => {
  it('covers structures and actors across surface regions but excludes far resources and underground sources', () => {
    const rows = [entity('near', 31, 'tree'), entity('far-resource', 33, 'tree'), entity('wall', 159, 'landmark'),
      entity('border-actor', 159, 'npc', 'karrowmoor'), entity('cave', 0, 'npc', 'gravelmaw'), entity('far-wall', 161, 'landmark')];
    expect(selectPlayerEntities(rows, area).map(row => row.id)).toEqual(['border-actor', 'near', 'wall']);
    expect(selectPlayerEntities(rows, { ...area, regionId: 'gravelmaw' }).map(row => row.id)).toEqual(['cave']);
    expect(rows[0]!.position).toEqual([31, 0, 0]);
  });

  it('deduplicates equipped and carried items and prepares the actual authored gathering model', async () => {
    const state = { inventory: { slots: [{ itemId: 'worn_hatchet', quantity: 1 }, null] },
      equipment: { mainHand: { itemId: 'worn_hatchet', quantity: 1 } }, bank: { slots: [{ itemId: 'kaldite_pickaxe', quantity: 1 }] } };
    const items = immediatePlayerItems(state as never);
    expect(items).toEqual(['worn_hatchet']);
    const assets = { entry: (id: string) => id === 'corealm_item_worn_hatchet'
      ? { id, tags: [], itemModel: { itemId: 'worn_hatchet' } } : undefined, load: vi.fn(async () => new THREE.Group()) };
    const rig = new CharacterRig(assets as never);
    expect(await rig.prepareItems(items)).toEqual(['corealm_item_worn_hatchet']);
    expect(assets.load).toHaveBeenCalledTimes(1);
    expect(assets.load).toHaveBeenCalledWith('corealm_item_worn_hatchet', { priority: 'player', primary: true });
  });

  it('resolves all collision without loading models and retries a whole site after a dependency failure', async () => {
    const site: WorldSite = { id: 'edge', locationId: 'edge', kind: 'habitat', regionId: 'karrowmoor', centre: [165, 0],
      rotationY: 0, extent: [20, 20], workRadius: 0, terrain: { floorRadius: 0, backRise: 0, backDistance: 0, bermWidth: 0, approachAngle: 0 },
      resourceSlots: [], dressing: [
        { id: 'a', assetId: 'crate_wood', x: 0, z: 0, yaw: 0, scale: 1 },
        { id: 'b', assetId: 'barrel', x: 2, z: 0, yaw: 0, scale: 1 },
      ] };
    const assets = { assetSize: () => ({ x: 20, y: 4, z: 2 }), assetCenterXZ: () => ({ x: 0, z: 0 }), baseY: () => -1,
      load: vi.fn(async () => new THREE.Group()) };
    const scene = { meshHeightAt: () => 3, scatterInstanced: vi.fn(() => [new THREE.Group()]) };
    const resolved = resolveWorldSiteDressing(scene as never, assets as never, site);
    expect(resolved.solids[0]).toMatchObject({ position: [165, 3, 0], size: [20, 4, 2] });
    expect(assets.load).not.toHaveBeenCalled();
    const stream = new WorldSiteStreaming(scene as never, assets as never);
    stream.register(site, resolved);
    // Origin lies outside the radius, but the edge of this large prop is visible.
    expect(stream.snapshot(area).selected).toEqual(['edge']);
    assets.load.mockRejectedValueOnce(new Error('offline'));
    await expect(stream.prepare(area, { priority: 'travel-prefetch' })).rejects.toThrow('offline');
    expect(scene.scatterInstanced).not.toHaveBeenCalled();
    expect(stream.snapshot(area).pending).toEqual(['edge']);
    await stream.prepare(area, { priority: 'visible-spawn' });
    expect(scene.scatterInstanced).toHaveBeenCalledTimes(2);
    expect(stream.snapshot(area).pending).toEqual([]);
    await stream.prepare(area, {});
    expect(scene.scatterInstanced).toHaveBeenCalledTimes(2);
  });

  it('installs camera sources once when foreground loading overtakes prefetch', async () => {
    const source = new THREE.Group(); source.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    const assets = { load: vi.fn(async () => source), instance: () => source.clone() };
    const install = vi.fn();
    const stream = new StructureCameraStreaming(assets as never, install);
    const target = { ...entity('building#roof', 0, 'landmark'), meta: { buildingId: 'building' } };
    await Promise.all([stream.prepare([target], { priority: 'travel-prefetch' }), stream.prepare([target], { priority: 'visible-spawn' })]);
    expect(install).toHaveBeenCalledTimes(1);
    expect(stream.sources.meshes).toHaveLength(1);
    expect(stream.sources.meshes[0]!.userData.structureOwner).toBe('building');
  });

  it('does not hold a ready destination behind an unrelated slow camera prefetch', async () => {
    const source = new THREE.Group(); source.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
    let finish!: () => void;
    const slow = new Promise<void>(resolve => { finish = resolve; });
    const assets = { load: async (id: string) => { if (id === 'slow#roof') await slow; return source; }, instance: () => source.clone() };
    const stream = new StructureCameraStreaming(assets as never, () => {});
    const target = (id: string) => ({ ...entity(id, 0, 'landmark'), meta: { buildingId: id.split('#')[0]! } });
    const background = stream.prepare([target('slow#roof')], { priority: 'travel-prefetch' });
    await stream.prepare([target('ready#roof')], { priority: 'visible-spawn' });
    expect(stream.sources.roots.map(root => root.name)).toEqual(['camera:ready#roof']);
    finish(); await background;
    expect(stream.sources.roots).toHaveLength(2);
  });
});
