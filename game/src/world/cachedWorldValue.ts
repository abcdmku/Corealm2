import type { GenerationCachePort } from './generationCache.js';

/** Bake immutable assembly inputs once; each session receives its own mutable copy. */
export async function cachedWorldValue<T>(cache: GenerationCachePort | null, key: string, create: () => T,
  valid: (value: unknown) => value is T): Promise<T> {
  const found = await cache?.get(key, valid);
  if (found) return found;
  const value = create();
  // Storage adapters clone on write, before gameplay mutates the returned assembly.
  await cache?.put(key, value);
  return value;
}
