import { createHash } from "node:crypto";
import { constants, gzipSync } from "node:zlib";
import type { GenerationCachePort } from "../generationCache.js";
import { encodeWorldData, type WorldDataManifest } from "../worldDataFormat.js";

export type WorldRecordEntry = WorldDataManifest["records"][string];

/**
 * One world record as the release ships it: the encoded payload gzipped at level 9, taking the
 * smaller of the default and filtered strategies, named by the sha256 of the compressed bytes.
 * `tools/build-world.ts` packs what the Chromium page sends the same way.
 */
export function packWorldRecord(raw: Uint8Array): { bytes: Uint8Array; entry: WorldRecordEntry } {
  const standard = gzipSync(raw, { level: 9 });
  const filtered = gzipSync(raw, { level: 9, strategy: constants.Z_FILTERED });
  const bytes = filtered.length < standard.length ? filtered : standard;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // An opaque suffix prevents static hosts from decoding gzip before the integrity check.
  return { bytes, entry: { file: `${sha256}.world`, sha256, bytes: bytes.length } };
}

/**
 * The Node counterpart of `WorldBakeWriter`: a generation cache that never hits and hands each
 * completed record to `onRecord` as soon as it is written, so a bake's memory stays bounded.
 */
export class WorldRecordWriter implements GenerationCachePort {
  readonly records: Record<string, WorldRecordEntry> = {};
  constructor(private readonly onRecord: (key: string, gzipBytes: Uint8Array, entry: WorldRecordEntry) => void | Promise<void>) {}
  async get<T>(_key: string, _valid: (value: unknown) => value is T): Promise<T | null> { return null; }
  async put(key: string, data: unknown): Promise<boolean> {
    if (this.records[key]) throw new Error(`Duplicate world record ${key}`);
    // Encoded before the first await: the caller goes on to mutate what it cached.
    const { bytes, entry } = packWorldRecord(encodeWorldData(data));
    this.records[key] = entry;
    await this.onRecord(key, bytes, entry);
    return true;
  }
}
