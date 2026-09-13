import { POSE_CLIPS, type CharacterPose } from '../../../game/src/render/characterRig.js';
import { ownClipCandidates, type CharacterMotion } from '../../../game/src/render/entityViews.js';

export function defaultItemPose(itemId?: string): CharacterPose {
  if (!itemId) return 'idle';
  if (/pickaxe/.test(itemId)) return 'mine';
  if (/hatchet|axe/.test(itemId)) return 'chop';
  if (/rod/.test(itemId)) return 'fish';
  if (/staff|wand/.test(itemId)) return 'cast';
  return 'attack_melee';
}

export function poseClip(names: readonly string[], pose: CharacterPose): string | undefined {
  return POSE_CLIPS[pose].find(name => names.includes(name));
}

export function humanoidClipGroups(names: readonly string[]): Map<string, string> {
  const groups = new Map<string, string>();
  for (const [pose, clips] of Object.entries(POSE_CLIPS)) {
    for (const clip of clips) if (names.includes(clip) && !groups.has(clip)) groups.set(clip, pose.replaceAll('_', ' '));
  }
  for (const name of names) if (!groups.has(name)) groups.set(name, 'Other clips');
  return groups;
}

export function creatureClipGroups(names: readonly string[]): Map<string, string> {
  const groups = new Map<string, string>();
  // Idle's final fallback includes every remaining clip. Classify specific motions first.
  for (const motion of ['attack', 'hit', 'death', 'walk', 'run'] as CharacterMotion[]) {
    for (const name of ownClipCandidates(names, motion)) {
      if (!groups.has(name)) groups.set(name, motion);
    }
  }
  for (const name of names) if (!groups.has(name)) groups.set(name, /^idle|^flying|closed$/i.test(name) ? 'idle' : 'Other clips');
  return groups;
}

export function initialCreatureClip(names: readonly string[]): string | undefined {
  return ownClipCandidates(names, 'idle')[0];
}
