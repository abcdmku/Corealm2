import type * as THREE from 'three';
import type { CharacterPose } from '../../../game/src/render/characterRig.js';

export type ViewerSource =
  | { mode: 'asset' | 'creature'; assetId: string }
  | { mode: 'glb'; url: string; manifestSize?: ViewerSize }
  | { mode: 'outfit'; body?: 'male' | 'female'; itemIds: readonly string[]; mainHandId?: string; offHandId?: string; pose?: CharacterPose };
export interface ViewerSize { x: number; y: number; z: number }
export interface ViewerClip { name: string; duration: number; group: string }
export interface ViewerMaterial { name: string; type: string; textures: string[] }
export interface ViewerAttachment { slot: string; asset: string; bone: string; position: number[]; rotation: number[]; scale: number[] }
export interface ViewerSnapshot {
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
  dispose(): void;
}
