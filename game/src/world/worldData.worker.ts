import { GenerationCache } from './generationCache.js';
import { decodeWorldData, worldDataSha256 } from './worldDataFormat.js';
import type { WorldDataLoadReply, WorldDataLoadTask } from './worldDataLoading.js';
import { validTerrainCache } from '../render/terrainCache.js';

const caches = new Map<string, GenerationCache>();
const object = (value: unknown): value is object => !!value && typeof value === 'object';

/** Collect shared buffers once. Transfer ownership instead of copying terrain arrays back. */
export function worldDataTransfers(value: unknown): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const visit = (value: unknown): void => {
    if (ArrayBuffer.isView(value)) { if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer); }
    else if (object(value)) for (const child of Object.values(value)) if (object(child)) visit(child);
  };
  visit(value); return [...buffers];
}

export async function loadWorldDataTask(task: WorldDataLoadTask, cache: GenerationCache): Promise<unknown> {
  if (task.op !== 'decode') {
    const value = await cache.get(task.key, task.terrainInput === undefined ? object
      : (value): value is object => validTerrainCache(value, task.terrainInput!));
    return task.op === 'has' ? value !== null : value;
  }
  const { bytes, entry, key } = task;
  if (bytes.length !== entry.bytes || await worldDataSha256(bytes) !== entry.sha256) throw new Error(`World file failed integrity check: ${key}`);
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
  const unpacked = await new Response(stream).arrayBuffer();
  const data = decodeWorldData(new Uint8Array(unpacked));
  if (task.terrainInput !== undefined && !validTerrainCache(data, task.terrainInput)) throw new Error(`World file has incompatible inputs: ${key}`);
  // Serialize into the disposable cache before handing the buffers to the page. The page still
  // validates current geometry inputs on every read, including reads of this derived cache.
  await cache.put(key, data);
  return data;
}

if (typeof self !== 'undefined' && typeof document === 'undefined') self.onmessage = async (event: MessageEvent<WorldDataLoadTask>) => {
  const task = event.data, cacheKey = `${task.revision}/${task.scope}`;
  let cache = caches.get(cacheKey);
  if (!cache) { cache = new GenerationCache(task.revision, task.scope); caches.set(cacheKey, cache); }
  try {
    const value = await loadWorldDataTask(task, cache);
    self.postMessage({ id: task.id, value, cache: cache.snapshot() } satisfies WorldDataLoadReply, { transfer: worldDataTransfers(value) });
  } catch (cause) {
    self.postMessage({ id: task.id, error: cause instanceof Error ? cause.message : String(cause) } satisfies WorldDataLoadReply);
  }
};
