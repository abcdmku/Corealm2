import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { creatureClipGroups, defaultItemPose, humanoidClipGroups, initialCreatureClip, poseClip } from '../devdocs/src/viewer/clips.js';
import { POSE_CLIPS } from '../game/src/render/characterRig.js';

describe('devdocs production animation selection', () => {
  const manifest = JSON.parse(readFileSync('game/public/assets/manifest.json', 'utf8')) as { assets: { id: string; animations: string[] }[] };
  const libraries = manifest.assets.filter(asset => /^animation_library_/.test(asset.id)).flatMap(asset => asset.animations);

  it('resolves every production pose against the shipped animation libraries', () => {
    for (const pose of Object.keys(POSE_CLIPS) as (keyof typeof POSE_CLIPS)[]) expect(poseClip(libraries, pose), pose).toBeTruthy();
    expect(humanoidClipGroups(libraries).size).toBe(new Set(libraries).size);
  });

  it('selects tool and weapon poses using actual item identities', () => {
    expect(defaultItemPose('corven_sword')).toBe('attack_melee');
    expect(defaultItemPose('air_staff')).toBe('cast');
    expect(defaultItemPose('air_wand')).toBe('cast');
    expect(defaultItemPose('corven_pickaxe')).toBe('mine');
    expect(defaultItemPose('corven_hatchet')).toBe('chop');
    expect(defaultItemPose('worn_rod')).toBe('fish');
    expect(defaultItemPose()).toBe('idle');
  });

  it('groups each native creature clip without losing unmatched takes or mislabelling walk as run', () => {
    const names = ['Idle', 'Walk', 'Run', 'Bite_Front', 'HitRecieve', 'Death', 'Dance'];
    expect(Object.fromEntries(creatureClipGroups(names))).toEqual({ Idle: 'idle', Walk: 'walk', Run: 'run', Bite_Front: 'attack', HitRecieve: 'hit', Death: 'death', Dance: 'Other clips' });
    expect(initialCreatureClip(['Chest_Close', 'Chest_Closed'])).toBe('Chest_Closed');
    expect(initialCreatureClip(['Bite_Front', 'Flying'])).toBe('Flying');
  });

  it('keeps every shipped native animation available for inspection', () => {
    for (const asset of manifest.assets.filter(asset => !asset.id.startsWith('animation_library_'))) {
      expect(creatureClipGroups(asset.animations).size, asset.id).toBe(new Set(asset.animations).size);
    }
  });
});
