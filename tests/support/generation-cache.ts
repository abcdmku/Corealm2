import type { GenerationCachePort } from "../../game/src/world/generationCache.js";

export class MemoryGenerationCache implements GenerationCachePort {
  entries = new Map<string, unknown>();
  hits = 0;
  async get<T>(key: string, valid: (value: unknown) => value is T): Promise<T | null> {
    const value = structuredClone(this.entries.get(key));
    if (!valid(value)) return null;
    this.hits++;
    return value;
  }
  async put(key: string, value: unknown): Promise<boolean> {
    this.entries.set(key, structuredClone(value));
    return true;
  }
}
