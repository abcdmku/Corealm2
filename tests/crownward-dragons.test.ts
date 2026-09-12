import { describe, expect, it } from 'vitest';
import { CROWNWARD_DRAGON_FORMS, CROWNWARD_DRAGON_SPECIES, CROWNWARD_DRAGON_ENCOUNTER_INTENTS,
  crownwardDragonGroup, resolveCrownwardDragonEncounters, type CrownwardDragonPositions } from '../game/src/content/crownwardDragons.js';
import { WILDERNESS_DRAGONS } from '../game/src/content/wildernessDragons.js';
import { enemyCombatLevel } from '../game/src/content/index.js';
import { ALL_ITEMS } from '../game/src/content/items.js';
import { tierSilhouetteScale } from '../game/src/core/math.js';

describe('Crownward dragon encounters', () => {
  it('reuses existing accepted assets and locomotion rather than introducing another rig', () => {
    for (const form of CROWNWARD_DRAGON_FORMS) {
      const source = WILDERNESS_DRAGONS.find(row => row.id === form.sourceSpeciesId)!;
      const species = CROWNWARD_DRAGON_SPECIES.find(row => row.id === form.id)!;
      expect(species.assetId).toBe(source.assetId);
      expect(species.stats.moveSpeedMps).toBe(source.stats.moveSpeedMps);
      expect(species.stats.walkSpeedMps).toBe(source.stats.walkSpeedMps);
      expect(species.stats.attackSpeedMs).toBe(source.stats.attackSpeedMs);
      expect(species.stats.tier).toBe(40);
      expect(enemyCombatLevel(species.stats)).toBe(form.level);
      for (const drop of species.stats.drops) expect(ALL_ITEMS.some(item => item.id === drop.itemId)).toBe(true);
    }
  });

  it('preserves authored body size through boss and miniboss runtime multipliers', () => {
    for (const form of CROWNWARD_DRAGON_FORMS) {
      const group = crownwardDragonGroup(form.id, `lab:${form.id}`, [0, 0]);
      expect(Boolean(group.boss)).toBe(form.rank === 'boss');
      expect(Boolean(group.miniBoss)).toBe(form.rank === 'miniboss');
      expect(group.scale * (group.boss ? 1.6 : 1.3) * tierSilhouetteScale(group.tier)).toBeCloseTo(form.nativeScale);
      expect(group.count).toBe(1);
      expect(group.radius).toBe(0);
    }
  });

  it('places two red and two black minibosses and one adult only at supplied positions', () => {
    const positions = Object.fromEntries(CROWNWARD_DRAGON_ENCOUNTER_INTENTS.map((intent, i) => [intent.id, [400 + i * 40, -100]])) as unknown as CrownwardDragonPositions;
    const groups = resolveCrownwardDragonEncounters(positions);
    expect(groups.filter(group => group.miniBoss)).toHaveLength(4);
    expect(groups.filter(group => group.boss)).toHaveLength(1);
    expect(groups.filter(group => group.assetId === 'creature_baby_red_dragon')).toHaveLength(2);
    expect(groups.filter(group => group.assetId === 'creature_baby_black_dragon')).toHaveLength(2);
    expect(new Set(groups.map(group => group.id)).size).toBe(5);
    for (const group of groups) expect(group.centre).toBe(positions[group.id as keyof CrownwardDragonPositions]);
    expect(() => resolveCrownwardDragonEncounters({} as CrownwardDragonPositions)).toThrow('Missing finite dragon position');
  });
});
