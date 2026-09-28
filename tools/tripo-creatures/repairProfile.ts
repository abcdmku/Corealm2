import type { Document } from '@gltf-transform/core';
import type { AssetEntry } from '../../game/src/render/assets.js';

/** Family authors edit documents; the shared runner owns source hashes, validation and staging. */
export interface CreatureRepairContext {
  assetId: string;
  entry: AssetEntry;
  /** Returns a fresh document, so preparing a donor's bind pose cannot affect another repair. */
  readAsset(assetId: string): Promise<Document>;
}

export interface CreatureRepairResult {
  changes: string[];
  warnings?: string[];
  /** Source clips, anatomical decisions, measured contacts and repair provenance. */
  provenance?: Record<string, unknown>;
  /** Recalibrated motion measurements, when the repaired cycles differ from the source. */
  motion?: Pick<AssetEntry, 'impliedWalkMps' | 'walkClipSeconds' | 'impliedRunMps' | 'runClipSeconds' | 'attackSeconds' | 'contactNormalized' | 'groundY'>;
}

export interface CreatureRepairProfile {
  id: string;
  assetIds: readonly string[];
  repair(doc: Document, context: CreatureRepairContext): Promise<CreatureRepairResult>;
}
