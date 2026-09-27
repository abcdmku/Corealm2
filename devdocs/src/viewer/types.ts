import type * as THREE from 'three';
import type { CharacterPose } from '../../../game/src/render/characterRig.js';

/** What a creature can be shown doing. The game's motion vocabulary plus directional hits. */
export const CREATURE_STATES = ['idle', 'walk', 'run', 'attack', 'hit', 'hitLeft', 'hitRight', 'death'] as const;
export type CreatureState = (typeof CREATURE_STATES)[number];

export type ViewerSource =
  | { mode: 'asset' | 'creature'; assetId: string }
  /** A creature definition as the game draws it: its presentation asset, scale, tint and motion states. */
  | { mode: 'actor'; creatureId: string }
  | { mode: 'glb'; url: string; manifestSize?: ViewerSize }
  | { mode: 'outfit'; body?: 'male' | 'female'; itemIds: readonly string[]; mainHandId?: string; offHandId?: string; pose?: CharacterPose };
export interface ViewerSize { x: number; y: number; z: number }
export interface ViewerClip { name: string; duration: number; group: string }
export interface ViewerMaterial { name: string; type: string; textures: string[] }
export interface ViewerAttachment { slot: string; asset: string; bone: string; position: number[]; rotation: number[]; scale: number[] }
/** One state the loaded model can be put in: a creature state, a player pose, or an asset's clip group. */
export interface ViewerStateInfo {
  name: string;
  /** The clip that plays it, if any. */
  clip: string | null;
  /** False when the model has nothing to show for this state. */
  available: boolean;
  /** True when the game synthesises it (a procedural recoil, a fallback clip) instead of playing an authored clip. */
  synthetic?: boolean;
}
/** How the game dresses a creature definition's model. */
export interface ViewerAppearance { creatureId: string; assetId: string; scale: number; tint: string | null }
export interface ViewerSnapshot {
  /** Every state this model supports, in display order. */
  states: ViewerStateInfo[];
  /** The state last set with `setState`, or the initial state. */
  state: string | null;
  appearance: ViewerAppearance | null;
  ready: boolean;
  clip: string | null;
  time: number;
  duration: number;
  playing: boolean;
  speed: number;
  clips: ViewerClip[];
  materials: ViewerMaterial[];
  size: ViewerSize | null;
  manifestSize: ViewerSize | null;
  body: 'male' | 'female' | null;
  parts: string[];
  attachments: ViewerAttachment[];
  missingBones: string[];
  meshCount: number;
  boneSample: number[];
  wireframe: boolean;
  bounds: boolean;
}
export interface ViewerModel {
  root: THREE.Object3D;
  animationRoot: THREE.Object3D;
  clips: THREE.AnimationClip[];
  clipGroups: Map<string, string>;
  initialClip?: string;
  manifestSize?: ViewerSize;
  body?: 'male' | 'female';
  parts: string[];
  attachments: ViewerAttachment[];
  missingBones: string[];
  appearance?: ViewerAppearance;
  /** States in display order. Absent: the core derives them from clip groups. */
  states?: ViewerStateInfo[];
  initialState?: string;
  /** Puts the model in a state; return false to let the core play the state's clip. */
  setState?(name: string): boolean;
  /** Per-frame hook for models the core does not drive with its own mixer. */
  update?(dt: number): void;
  dispose(): void;
}
