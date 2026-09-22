import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { GenerationCache } from '../game/src/world/generationCache.js';
import { ShippedWorldData } from '../game/src/world/shippedWorldData.js';
import { encodeWorldData, worldDataSha256 } from '../game/src/world/worldDataFormat.js';
import { loadWorldDataTask, worldDataTransfers } from '../game/src/world/worldData.worker.js';
import { WorldDataLoading, type WorldDataLoadReply, type WorldDataLoadTask } from '../game/src/world/worldDataLoading.js';

class MemoryLocal extends GenerationCache {
  records = new Map<string, unknown>();
  override async get<T>(key: string, valid: (value: unknown) => value is T): Promise<T | null> {
    const data = structuredClone(this.records.get(key)); return valid(data) ? data : null;
  }
  override async put(key: string, data: unknown) { this.records.set(key, structuredClone(data)); return true; }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
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
  it('decodes and caches off-thread before transferring exact arrays without detaching the cache', async () => {
    const f = await fixture();
    const task: WorldDataLoadTask = { id: 1, op: 'decode', revision: f.local.revision, scope: f.local.scope,
      key: 'terrain/world', bytes: Uint8Array.from(f.packed), entry: f.manifest.records['terrain/world']! };
    const value = await loadWorldDataTask(task, f.local) as typeof f.data;
    const message = structuredClone(value, { transfer: worldDataTransfers(value) });
    expect(value.positions.byteLength).toBe(0);
    expect(message).toEqual(f.data);
    expect(await loadWorldDataTask({ ...task, op: 'read' }, f.local)).toEqual(f.data);
    expect(await loadWorldDataTask({ ...task, op: 'has' }, f.local)).toBe(true);
    const corrupt = Uint8Array.from(f.packed); corrupt[20] = corrupt[20]! ^ 0xff;
    await expect(loadWorldDataTask({ ...task, bytes: corrupt }, f.local)).rejects.toThrow(/integrity/);
    expect(await f.local.get('terrain/world', valid)).toEqual(f.data);
  });

  it('transfers each shared typed-array buffer once', () => {
    const array = new Float32Array([1, 2, 3]);
    expect(worldDataTransfers({ array, other: array.subarray(1), nested: [array] })).toEqual([array.buffer]);
  });

  it('validates terrain inputs and numeric arrays in the worker before caching or publishing', async () => {
    const f = await fixture();
    const data = { input: 'terrain-input', streamedDraws: true, ranges: [{ min: 0, max: 0 }],
      lattice: { heights: new Float32Array(4), cols: 2, rows: 2, minX: 0, minZ: 0, step: 1 },
      chunks: { tile: { surfaceRecord: 'terrain-draw/tile', attributes: {}, index: null } }, coast: null };
    const bytes = Uint8Array.from(gzipSync(encodeWorldData(data))), sha256 = await worldDataSha256(bytes);
    const task: WorldDataLoadTask = { id: 1, op: 'decode', revision: f.local.revision, scope: f.local.scope,
      key: 'terrain/world', terrainInput: data.input, bytes, entry: { file: `${sha256}.world`, sha256, bytes: bytes.length } };
    expect(await loadWorldDataTask(task, f.local)).toEqual(data);
    expect(await loadWorldDataTask({ ...task, op: 'read', terrainInput: 'stale-input' }, f.local)).toBeNull();
    await expect(loadWorldDataTask({ ...task, terrainInput: 'stale-input' }, f.local)).rejects.toThrow(/incompatible inputs/);
    data.lattice.heights[0] = NaN;
    const bad = Uint8Array.from(gzipSync(encodeWorldData(data)));
    await expect(loadWorldDataTask({ ...task, bytes: bad, entry: { ...task.entry, bytes: bad.length, sha256: await worldDataSha256(bad) } }, f.local)).rejects.toThrow(/incompatible inputs/);
    expect((await f.local.get('terrain/world', (v): v is typeof data => !!v))?.lattice.heights[0]).toBe(0);
  });

  it('matches concurrent worker replies and rejects outstanding work on worker failure', async () => {
    const worker = { onmessage: null as ((event: { data: WorldDataLoadReply }) => void) | null,
      onerror: null as (() => void) | null, onmessageerror: null as (() => void) | null,
      postMessage: vi.fn(), terminate: vi.fn() };
    const loading = new WorldDataLoading('revision', 'scope', worker as unknown as Worker);
    const a = loading.run({ op: 'read', key: 'a' });
    const b = loading.run({ op: 'read', key: 'b' });
    const ids = worker.postMessage.mock.calls.map(call => call[0].id as number);
    worker.onmessage!({ data: { id: ids[1]!, value: 'second' } });
    expect(await b).toBe('second');
    worker.onmessage!({ data: { id: ids[0]!, value: 'first' } });
    expect(await a).toBe('first');
    const failed = loading.run({ op: 'read', key: 'fail' });
    const rejection = expect(failed).rejects.toThrow(/worker failed/);
    worker.onerror!(); await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(loading.run({ op: 'read', key: 'later' })).rejects.toThrow(/worker failed/);
  });

  it('coalesces simultaneous requests before transferring a compressed file to the worker', async () => {
    const f = await fixture();
    const tasks: WorldDataLoadTask[] = [];
    class LoadingWorker {
      onmessage: ((event: { data: WorldDataLoadReply }) => void) | null = null;
      postMessage(task: WorldDataLoadTask, transfers: Transferable[]) {
        const copy = structuredClone(task, { transfer: transfers }); tasks.push(copy);
        void loadWorldDataTask(copy, f.local).then(value => {
          const result = structuredClone(value, { transfer: worldDataTransfers(value) });
          this.onmessage?.({ data: { id: copy.id, value: result } });
        }, error => this.onmessage?.({ data: { id: copy.id, error: String(error) } }));
      }
      terminate() {}
    }
    vi.stubGlobal('Worker', LoadingWorker);
    const source = new ShippedWorldData(f.local, '/subdir/generated/world/manifest.json', true);
    const values = await Promise.all([source.get('terrain/world', valid), source.get('terrain/world', valid)]);
    expect(values).toEqual([f.data, f.data]);
    expect(tasks.filter(task => task.op === 'decode')).toHaveLength(1);
    expect(await source.get('terrain/world', valid)).toEqual(f.data);
    expect(f.fetch).toHaveBeenCalledTimes(2);
    // A cache hit must still satisfy this caller's current geometry validation.
    await expect(source.get('terrain/world', (_value): _value is object => false)).rejects.toThrow(/incompatible inputs/);
  });

  it('rejects stalled worker work instead of leaving a loading screen waiting forever', async () => {
    vi.useFakeTimers();
    const worker = { postMessage: vi.fn(), terminate: vi.fn() };
    const loading = new WorldDataLoading('revision', 'scope', worker as unknown as Worker);
    const pending = loading.run({ op: 'read', key: 'terrain/world' });
    const rejected = expect(pending).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(30_000); await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('starts both terrain grids together and keeps model traffic behind them', async () => {
    const f=await fixture(), load=vi.fn(async (_id:string)=>{});
    Object.assign(f.manifest.records,{'terrain/fairy':{...f.manifest.records['terrain/world'],file:`${'f'.repeat(64)}.world`}});
    Object.assign(f.manifest,{assetObjects:[{x:0,z:0,ids:['nearby']}]});
    const pending:((response:Response)=>void)[]=[];
    f.fetch.mockImplementation(async url=>String(url).endsWith('manifest.json') ? Response.json(f.manifest)
      : new Promise<Response>(resolve=>pending.push(resolve)));
    const preload=f.source.preloadArea(0,0,20,load);
    await vi.waitFor(()=>expect(pending).toHaveLength(2));
    expect(load).not.toHaveBeenCalled();
    pending[0]!(new Response(Uint8Array.from(f.packed)));
    for(let i=0;i<20;i++)await Promise.resolve();
    expect(load).not.toHaveBeenCalled();
    pending[1]!(new Response(Uint8Array.from(f.packed)));
    await preload;
    expect(load.mock.calls.map(call=>call[0])).toEqual(['nearby']);
  });

  it('prefetches only intersecting foliage and reuses the same verified data download', async () => {
    const f=await fixture(), load=vi.fn(async (_id:string)=>{});
    Object.assign(f.manifest,{assetTiles:[
      {minX:0,maxX:96,minZ:0,maxZ:96,ids:['oak','grass']},
      {minX:96,maxX:192,minZ:0,maxZ:96,ids:['oak','pine']},
      {minX:300,maxX:396,minZ:0,maxZ:96,ids:['distant']},
    ]});
    await f.source.preloadArea(90,40,20,load);
    expect(load.mock.calls.map(call=>call[0])).toEqual(['oak','grass','pine']);
    expect(await f.source.get('terrain/world',valid)).toEqual(f.data);
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(f.source.snapshot().generated).toEqual([]);
  });
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
