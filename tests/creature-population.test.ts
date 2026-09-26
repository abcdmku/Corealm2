import { describe, expect, it } from 'vitest';
import type { SemanticEntity } from '../game/src/contracts.js';
import { refineCreaturePopulation } from '../game/src/world/creaturePopulation.js';

const pack = (radius: number, regionId: SemanticEntity['regionId'] = 'karrowmoor'): SemanticEntity[] => Array.from({ length: 15 }, (_, i) => ({
  id: `${regionId}:${radius}:${i}`, archetype: 'enemy', name: 'Resident', tier: 10, regionId,
  state: 'alive', position: [i, 0, 0], interactions: ['attack'], meta: { groupId: `pack:${radius}` },
  combat: { health: 30, maxHealth: 30, level: 10, aggroRadius: 2, bodyRadius: radius },
}));

describe('resident budget integrity', () => {
  it('keeps stable surviving IDs and never adds residents on repeated refinement', () => {
    [.4, .8, 1.1, 1.6].forEach(radius => {
      const source = pack(radius), result = refineCreaturePopulation(source);
      expect(result).toEqual(source.slice(0, result.length));
      expect(refineCreaturePopulation(pack(radius))).toEqual(result);
      expect(refineCreaturePopulation(result)).toEqual(result);
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(source.length);
    });
  });
  it('keeps bosses, excluded regions and already sparse groups', () => {
    const source = [...pack(2, 'vellenwood'), ...pack(2).slice(0, 1),
      { ...pack(3)[0]!, archetype: 'boss' as const }];
    expect(refineCreaturePopulation(source, entity => entity.regionId === 'karrowmoor')).toEqual(source);
  });
  it('treats tall narrow silhouettes as large creatures', () => {
    const source = pack(.5).map(entity => ({ ...entity, view: { assetId: 'tall_actor', scale: 1 } }));
    expect(refineCreaturePopulation(source, undefined, () => ({ y: 4 })).length).toBeLessThanOrEqual(3);
  });
});
