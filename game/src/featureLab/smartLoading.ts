import type { WorldSite } from '../content/worldSites.js';
import type { SemanticEntity, Vec3 } from '../contracts.js';
import type { AssetRegistry } from '../render/assets.js';
import type { CharacterRig } from '../render/characterRig.js';
import { EntityViews } from '../render/entityViews.js';
import { immediatePlayerItems, selectPlayerEntities, type PlayerAssetArea } from '../render/playerAssetPlan.js';
import type { WorldScene } from '../render/scene.js';
import { StructureCameraStreaming } from '../render/structureCameraSources.js';
import { resolveWorldSiteDressing } from '../render/worldSiteDressing.js';
import type { GameState } from '../state/store.js';
import { WorldSiteStreaming } from '../world/worldSiteStreaming.js';

/** Small deterministic fixture for the production player-specific asset paths. */
export async function createSmartLoadingLab(scene: WorldScene, assets: AssetRegistry, rig: CharacterRig) {
  const sites = new WorldSiteStreaming(scene, assets);
  for (const [id, x, assetId, regionId] of [
    ['near', 10, 'crate_metal', 'fallowmarch'], ['far', 105, 'barrel_apples', 'karrowmoor'],
    ['cave', 10, 'barrel_rack', 'gravelmaw'],
  ] as const) {
    const site: WorldSite = { id, locationId: id, regionId, centre: [x, 0], rotationY: 0,
      kind: 'habitat', workRadius: 0, extent: [4, 4],
      terrain: { floorRadius: 0, backRise: 0, backDistance: 0, bermWidth: 0, approachAngle: 0 }, resourceSlots: [],
      dressing: [{ id: 'prop', assetId, x: 0, z: 0, yaw: 0, scale: 1 }] };
    sites.register(site, resolveWorldSiteDressing(scene, assets, site));
  }
  const entities: SemanticEntity[] = [0, 100].map((x, i) => ({
    id: `smart-building-${i}#roof`, name: 'Loading fixture roof', tier: 1, archetype: 'landmark',
    regionId: 'fallowmarch', position: [x, scene.meshHeightAt(x, -5) + 3, -5], state: 'available', interactions: [],
    meta: { buildingId: `smart-building-${i}` }, view: { assetId: i ? 'roof_wood_plank' : 'crate_wood', scale: 1 },
  }));
  const views = new EntityViews(scene, assets, scene.materials);
  const camera = new StructureCameraStreaming(assets, () => {});
  let area: PlayerAssetArea = { position: [0, 0, 0], regionId: 'fallowmarch', resourceRadius: 24, viewRadius: 24 };
  let items: string[] = [], itemAssets: string[] = [];
  const snapshot = () => ({ area, sites: sites.snapshot(area), items, itemAssets,
    cameraRoots: camera.sources.roots.map(root => root.name), views: views.residencyStats(),
    loaded: ['crate_metal', 'barrel_apples', 'barrel_rack', 'crate_wood', 'roof_wood_plank',
      'corealm_item_worn_hatchet', 'corealm_item_kaldite_pickaxe'].filter(id => assets.isLoaded(id)) });
  async function prepare(next: PlayerAssetArea, prefetch = false) {
    const selected = selectPlayerEntities(entities, next);
    const options = { priority: prefetch ? 'travel-prefetch' as const : 'visible-spawn' as const, primary: !prefetch };
    const [result] = await Promise.all([views.prepare(selected, options), sites.prepare(next, options), camera.prepare(selected, options)]);
    if (result.missing.length) throw new Error(`Missing fixture sources: ${result.missing.join(', ')}`);
    if (!prefetch) {
      area = next;
      views.updateActiveArea(area.position, area.resourceRadius, area.viewRadius);
      views.sync(entities);
    }
    return snapshot();
  }
  await prepare(area);
  return { snapshot, prepare: (x: number, prefetch = false) => prepare({ ...area, position: [x, 0, 0] as Vec3 }, prefetch),
    prepareInventory: async (inventory: GameState['inventory'], equipment: GameState['equipment']) => {
      items = immediatePlayerItems({ inventory, equipment });
      itemAssets = await rig.prepareItems(items);
      return snapshot();
    } };
}
