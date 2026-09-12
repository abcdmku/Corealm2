import { GenerationCache, type GenerationCachePort } from './generationCache.js';
import { decodeWorldData, worldDataSha256, type WorldDataManifest } from './worldDataFormat.js';

/** Release data is authoritative. Browser storage is an optional local copy of those files. */
export class ShippedWorldData implements GenerationCachePort {
  private manifest: Promise<WorldDataManifest | null> | null = null;
  private shipped: string[] = [];
  private generated: string[] = [];
  constructor(private local: GenerationCache, private url: string, private required: boolean) {}
  snapshot() { return { ...this.local.snapshot(), shipped: [...this.shipped], generated: [...this.generated] }; }

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

  async get<T>(key: string, valid: (value: unknown) => value is T): Promise<T | null> {
    const cached = await this.local.get(key, valid);
    if (cached) return cached;
    const manifest = await this.index();
    if (!manifest) return null;
    try {
      const entry = manifest.records[key];
      if (!entry || !/^[a-f0-9]{64}\.world$/.test(entry.file)) throw new Error(`World file is missing: ${key}`);
      const response = await fetch(new URL(entry.file, new URL(this.url, location.href)), { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`World file ${key}: HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== entry.bytes || await worldDataSha256(bytes) !== entry.sha256) throw new Error(`World file failed integrity check: ${key}`);
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      const data = decodeWorldData(new Uint8Array(await new Response(stream).arrayBuffer()));
      if (!valid(data)) throw new Error(`World file has incompatible inputs: ${key}`);
      this.shipped.push(key);
      await this.local.put(key, data);
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
