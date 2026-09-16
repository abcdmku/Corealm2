import type { WorldSite } from '../content/worldSites.js';
import { worldMapForRegion } from '../contracts.js';
import type { AssetLoadOptions, AssetRegistry } from '../render/assets.js';
import type { WorldScene } from '../render/scene.js';
import { drawWorldSiteDressing, type WorldSiteDressingResult } from '../render/worldSiteDressing.js';
import type { PlayerAssetArea } from '../render/playerAssetPlan.js';

interface SiteRecord {
  site: WorldSite;
  resolved: WorldSiteDressingResult;
  ready: boolean;
  loading?: Promise<void>;
  drawn?: boolean;
  extra?: () => Promise<void>;
  bounds?: readonly [number,number,number,number];
}

/** Keeps global placement/collision metadata, but only constructs settings near the player. */
export class WorldSiteStreaming {
  private readonly records = new Map<string, SiteRecord>();
  constructor(
    private readonly scene: WorldScene,
    private readonly assets: AssetRegistry,
    private readonly sceneForSite: (site: WorldSite) => WorldScene = () => this.scene,
  ) {}

  register(site: WorldSite, resolved: WorldSiteDressingResult): void {
    if (this.records.has(site.id)) throw new Error(`Duplicate streamed setting ${site.id}`);
    this.records.set(site.id, { site, resolved, ready: false });
  }

  attach(siteId: string, prepare: () => Promise<void>, bounds?: readonly [number,number,number,number]): void {
    const record = this.records.get(siteId);
    if (!record || record.ready || record.loading) throw new Error(`Cannot attach a loaded setting: ${siteId}`);
    record.extra = prepare; record.bounds = bounds;
  }

  private selected(area: PlayerAssetArea): SiteRecord[] {
    const mapId = worldMapForRegion(area.regionId);
    return [...this.records.values()].filter(({ site, resolved, bounds }) =>
      worldMapForRegion(site.regionId) === mapId && ((bounds && Math.hypot(
        Math.max(bounds[0]-area.position[0],0,area.position[0]-bounds[1]),
        Math.max(bounds[2]-area.position[2],0,area.position[2]-bounds[3])) <= area.viewRadius) || resolved.placements.some(piece => {
        // Include the full footprint, including large cliffs whose origins are outside the view.
        const radius = area.viewRadius + Math.hypot(piece.size[0], piece.size[2]) * .5;
        return Math.hypot(piece.position[0] + piece.centreOffset[0] - area.position[0],
          piece.position[2] + piece.centreOffset[1] - area.position[2]) <= radius;
      })));
  }

  async prepare(area: PlayerAssetArea, options: AssetLoadOptions): Promise<void> {
    await Promise.all(this.selected(area).map(record => {
      if (record.ready) return;
      if (record.loading) {
        // A foreground destination can overtake an older travel request in the registry queue.
        for (const id of record.resolved.assetIds) this.assets.prioritize(id, options);
        return record.loading;
      }
      record.loading = (async () => {
        // Each completed half remains reusable if the other half needs a download retry.
        if (record.extra) { await record.extra(); record.extra = undefined; }
        if (!record.drawn) {
          record.resolved = await drawWorldSiteDressing(this.sceneForSite(record.site),this.assets,record.site,record.resolved,options);
          record.drawn = true;
        }
        record.ready = true;
      })()
        .finally(() => { record.loading = undefined; });
      return record.loading;
    }));
  }

  snapshot(area: PlayerAssetArea) {
    const selected = this.selected(area);
    return { total: this.records.size, resident: [...this.records.values()].filter(row => row.ready).map(row => row.site.id).sort(),
      selected: selected.map(row => row.site.id).sort(), pending: selected.filter(row => !row.ready).map(row => row.site.id).sort() };
  }
}
