import type { Document } from '@gltf-transform/core';
import type { AssetEntry } from '../../game/src/render/assets.js';
import type { CreatureStateName } from './validation.js';

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
  /** Explicit authored roles for retained non-combat sources; active combat bodies require all six states. */
  stateRequirements?: Readonly<Record<string, { states: readonly CreatureStateName[]; reason: string }>>;
  repair(doc: Document, context: CreatureRepairContext): Promise<CreatureRepairResult>;
}

export function assertRetainedSourceRole(assetId: string, requirements: { states: readonly CreatureStateName[]; reason: string } | undefined, activeAssetIds: ReadonlySet<string>): void {
  if (!requirements) return;
  if (!requirements.reason.trim()) throw new Error(`${assetId}: authored-state exception requires a reason`);
  if (activeAssetIds.has(assetId)) throw new Error(`${assetId}: active creature definitions require the complete six-state lifecycle`);
}
