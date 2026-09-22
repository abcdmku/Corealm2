import { bootTelemetry } from "../perf/bootTelemetry.js";
import { GenerationCache, type GenerationCachePort } from './generationCache.js';
import { decodeWorldData, worldDataSha256, type WorldDataManifest } from './worldDataFormat.js';
import { WorldDataLoading } from './worldDataLoading.js';
import { validTerrainCache, type TerrainCacheData } from '../render/terrainCache.js';

/** Release data is authoritative. Browser storage is an optional local copy of those files. */
export class ShippedWorldData implements GenerationCachePort {
  private manifest: Promise<WorldDataManifest | null> | null = null;
  private shipped: string[] = [];
  private generated: string[] = [];
  private readonly downloads = new Map<string, Promise<Uint8Array>>();
  private readonly decodes = new Map<string, Promise<unknown>>();
  private readonly loading: WorldDataLoading | null;
  constructor(private local: GenerationCache, private url: string, private required: boolean) {
    this.loading = typeof Worker === 'undefined' ? null : new WorldDataLoading(local.revision, local.scope);
  }
  snapshot() { return { ...(this.loading?.cache ?? this.local.snapshot()), shipped: [...this.shipped], generated: [...this.generated] }; }

  private async cached<T>(key: string, valid: (value: unknown) => value is T, terrainInput?: string): Promise<T | null> {
    if (!this.loading) return this.local.get(key, valid);
    const value = await this.loading.run({ op: 'read', key, terrainInput });
    if (terrainInput !== undefined) return value as T | null;
    try { return valid(value) ? value : null; } catch { return null; }
  }

  private async hasCached(key: string): Promise<boolean> {
    if (this.loading) return Boolean(await this.loading.run({ op: 'has', key }));
    return !!await this.local.get(key, (value): value is object => !!value && typeof value === 'object');
  }

  /** Overlap independent data and foliage downloads with initialization, using the same registry queue. */
  async preloadArea(x:number,z:number,radius:number,loadAsset:(id:string)=>Promise<unknown>): Promise<void> {
    const manifest=await this.index();if(!manifest)return;
    // Both height grids unblock semantic assembly. Fetch them together before large models
    // compete for the connection; those models then overlap terrain reconstruction.
    await Promise.all(['terrain/world','terrain/fairy'].map(async key=>{
      if(manifest.records[key] && !await this.hasCached(key))
        await this.download(key,manifest.records[key]!);
    }));
    for(const key of Object.keys(manifest.records).filter(key=>/^(terrain\/|assembly\/|site-cut\/|spawns\/)/.test(key))) {
      // Browser storage can satisfy these without making another request on repeat visits.
      void this.hasCached(key).then(cached=>{
        if(!cached) void this.download(key,manifest.records[key]!).catch(()=>{});
      }).catch(()=>{});
    }
    const tiles=(manifest.assetTiles??[]).filter(tile=>Math.hypot(
      Math.max(tile.minX-x,0,x-tile.maxX),Math.max(tile.minZ-z,0,z-tile.maxZ))<=radius);
    for (const tile of tiles) if (tile.record && manifest.records[tile.record]) {
      const key=tile.record;
      void this.hasCached(key).then(cached=>{
        if(!cached) void this.download(key,manifest.records[key]!).catch(()=>{});
      }).catch(()=>{});
    }
    const ids=new Set([...tiles.flatMap(tile=>tile.ids),...(manifest.assetObjects??[])
      .filter(object=>Math.hypot(object.x-x,object.z-z)<=radius).flatMap(object=>object.ids)]);
    await Promise.all([...ids].map(loadAsset));
  }

  private download(key:string,entry:WorldDataManifest['records'][string]):Promise<Uint8Array> {
    if(!/^[a-f0-9]{64}\.world$/.test(entry.file))return Promise.reject(new Error(`Invalid world filename: ${key}`));
    let pending=this.downloads.get(key);
    if(!pending) {
      pending=(async()=>{
        const response=await fetch(new URL(entry.file,new URL(this.url,location.href)),{signal:AbortSignal.timeout(30_000)});
        if(!response.ok)throw new Error(`World file ${key}: HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      })();
      this.downloads.set(key,pending);
      void pending.catch(()=>{this.downloads.delete(key);});
    }
    return pending;
  }

  private index(): Promise<WorldDataManifest | null> {
    return this.manifest ??= (async () => {
      try {
        const response = await fetch(this.url, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const manifest = await response.json() as WorldDataManifest;
        if (manifest.format !== 'corealm-world' || manifest.version !== 1
          || manifest.revision !== this.local.revision || manifest.scope !== this.local.scope
          || !manifest.records || !Array.isArray(manifest.tiles)) throw new Error('World data revision does not match this game');
        return manifest;
      } catch (error) {
        if (this.required) throw new Error(`Unable to load the released world: ${String(error)}`);
        return null;
      }
    })();
  }

  get<T>(key: string, valid: (value: unknown) => value is T): Promise<T | null> {
    return this.read(key, valid);
  }

  getTerrain(key: string, input: string): Promise<TerrainCacheData | null> {
    return this.read(key, (value): value is TerrainCacheData => validTerrainCache(value, input), input);
  }

  private async read<T>(key: string, valid: (value: unknown) => value is T, terrainInput?: string): Promise<T | null> {
    const cached = await bootTelemetry.measureAsync("boot.worldData.cacheRead", () => this.cached(key, valid, terrainInput), { detail: { key } });
    if (cached) return cached;
    const manifest = await this.index();
    if (!manifest) return null;
    try {
      const entry = manifest.records[key];
      if (!entry || !/^[a-f0-9]{64}\.world$/.test(entry.file)) throw new Error(`World file is missing: ${key}`);
      if (this.loading) {
        const decodeKey = JSON.stringify([key, terrainInput]);
        let pending = this.decodes.get(decodeKey);
        if (!pending) {
          pending = (async () => {
            // Keep the shared compressed download intact for callers with different validators.
            // The large decoded arrays travel back by ownership transfer, without a copy.
            const bytes = Uint8Array.from(await this.download(key, entry));
            try {
              return await bootTelemetry.measureAsync('boot.worldData.worker', () => this.loading!.run({ op: 'decode', key, bytes, entry, terrainInput }), { detail: { key } });
            } finally { this.downloads.delete(key); }
          })();
          this.decodes.set(decodeKey, pending);
          void pending.finally(() => this.decodes.delete(decodeKey)).catch(() => {});
        }
        const data = await pending;
        if (terrainInput === undefined && !valid(data)) throw new Error(`World file has incompatible inputs: ${key}`);
        if (!this.shipped.includes(key)) this.shipped.push(key);
        return data as T;
      }
      const bytes = await this.download(key,entry);
      if (bytes.length !== entry.bytes || await worldDataSha256(bytes) !== entry.sha256) throw new Error(`World file failed integrity check: ${key}`);
      const stream = new Blob([Uint8Array.from(bytes)]).stream().pipeThrough(new DecompressionStream('gzip'));
      const unpacked = await bootTelemetry.measureAsync("boot.worldData.decompress", () => new Response(stream).arrayBuffer(), { detail: { key } });
      const data = bootTelemetry.measureSync("boot.worldData.decode", () => decodeWorldData(new Uint8Array(unpacked)), { detail: { key } });
      if (!valid(data)) throw new Error(`World file has incompatible inputs: ${key}`);
      this.shipped.push(key);
      await bootTelemetry.measureAsync("boot.worldData.cacheWrite", () => this.local.put(key, data), { detail: { key } });
      this.downloads.delete(key);
      return data;
    } catch (error) {
      if (this.required) throw error;
      return null;
    }
  }

  async put(key: string, data: unknown): Promise<boolean> {
    if (this.required) throw new Error(`Release attempted runtime world generation: ${key}`);
    this.generated.push(key);
    return this.local.put(key, data);
  }
}
