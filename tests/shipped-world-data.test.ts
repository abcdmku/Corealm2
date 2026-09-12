import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { GenerationCache } from '../game/src/world/generationCache.js';
import { ShippedWorldData } from '../game/src/world/shippedWorldData.js';
import { encodeWorldData, worldDataSha256 } from '../game/src/world/worldDataFormat.js';

class MemoryLocal extends GenerationCache {
  records = new Map<string, unknown>();
  override async get<T>(key: string, valid: (value: unknown) => value is T): Promise<T | null> {
    const data = structuredClone(this.records.get(key)); return valid(data) ? data : null;
  }
  override async put(key: string, data: unknown) { this.records.set(key, structuredClone(data)); return true; }
}
afterEach(() => vi.unstubAllGlobals());
const valid = (value: unknown): value is { positions: Float32Array } => !!value && (value as any).positions instanceof Float32Array;

async function fixture() {
  const data = { positions: new Float32Array([1.5, 2, -0]) };
  const packed = gzipSync(encodeWorldData(data));
  const sha256 = await worldDataSha256(packed);
  const record = { file: `${sha256}.world`, bytes: packed.length, sha256 };
  const manifest = { format: 'corealm-world', version: 1, scope: 'game/1337/world', revision: 'revision',
    tiles: [], records: { 'terrain/world': record } };
  const local = new MemoryLocal('revision', 'game/1337/world');
  const fetch = vi.fn(async (url: string | URL) => String(url).endsWith('manifest.json')
    ? Response.json(manifest) : new Response(Uint8Array.from(packed)));
  vi.stubGlobal('location', { href: 'https://game.test/subdir/' }); vi.stubGlobal('fetch', fetch);
  return { data, packed, manifest, local, fetch, source: new ShippedWorldData(local, '/subdir/generated/world/manifest.json', true) };
}

describe('shipped world loading', () => {
  it('loads exact bytes from the deployment base and uses local storage on later requests', async () => {
    const f = await fixture();
    expect(await f.source.get('terrain/world', valid)).toEqual(f.data);
    expect(String(f.fetch.mock.calls[1]![0])).toMatch(/^https:\/\/game.test\/subdir\/generated\/world\/[a-f0-9]+\.world$/);
    expect(await f.source.get('terrain/world', valid)).toEqual(f.data);
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.source.snapshot().generated).toEqual([]);
    await expect(f.source.put('other', {})).rejects.toThrow(/runtime world generation/);
  });
  it('works without writable local storage', async () => {
    const f = await fixture(); f.local.put = async () => false;
    expect(await f.source.get('terrain/world', valid)).toEqual(f.data);
    expect(f.source.snapshot().shipped).toEqual(['terrain/world']);
  });
  it('rejects a stale release, missing tile or corrupted download rather than generating it', async () => {
    const stale = await fixture(); stale.manifest.revision = 'old';
    await expect(stale.source.get('terrain/world', valid)).rejects.toThrow(/revision/);
    const missing = await fixture();
    await expect(missing.source.get('scatter/4:5', valid)).rejects.toThrow(/missing/);
    const corrupt = await fixture(); corrupt.packed[20] = corrupt.packed[20]! ^ 0xff;
    await expect(corrupt.source.get('terrain/world', valid)).rejects.toThrow(/integrity/);
  });
});
