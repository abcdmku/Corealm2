import type { GenerationCachePort } from './generationCache.js';
import { encodeWorldData } from './worldDataFormat.js';

declare global {
  interface Window {
    __corealmWriteWorldData?: (key: string, base64: string) => Promise<void>;
    __corealmWorldBake?: { revision: string; scope: string; tiles: string[]; records: string[] };
  }
}

/** The build driver writes each completed record immediately, keeping the bake's memory bounded. */
export class WorldBakeWriter implements GenerationCachePort {
  readonly records: string[] = [];
  async get<T>(_key: string, _valid: (value: unknown) => value is T): Promise<T | null> { return null; }
  async put(key: string, data: unknown): Promise<boolean> {
    if (!window.__corealmWriteWorldData) throw new Error('World baking requires the build driver');
    const bytes = encodeWorldData(data);
    const stream = new Blob([Uint8Array.from(bytes)]).stream().pipeThrough(new CompressionStream('gzip'));
    const packed = new Uint8Array(await new Response(stream).arrayBuffer());
    const parts: string[] = [];
    for (let offset = 0; offset < packed.length; offset += 32768) parts.push(String.fromCharCode(...packed.subarray(offset, offset + 32768)));
    await window.__corealmWriteWorldData(key, btoa(parts.join('')));
    this.records.push(key);
    return true;
  }
  snapshot() { return { records: [...this.records] }; }
}
