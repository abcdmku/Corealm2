import type { SemanticEntity } from '../contracts.js';
import { createFairyGardenResidents } from '../content/fairyGardenEncounters.js';
import { encounterPopulationCount, encounterActorId } from '../content/encounterPopulation.js';
import { FAIRY_GARDEN_SPECIES } from '../content/fairyGardenCreatures.js';
import { buildEnemyGroup } from '../world/regionBuilder.js';
import { Rng } from '../core/rng.js';

export function createFairyPopulationFixture(ports: {
  heightAt(x: number, z: number): number;
  baseY(assetId: string): number;
  assetSize(assetId: string): { x: number; y: number; z: number } | null;
}): SemanticEntity[] {
  const entities: SemanticEntity[] = [];
  const residents = createFairyGardenResidents({ id: 'population_lab', regionId: 'gloamgarden', centre: [0, -30], radius: 19 }, ['spriggle', 'sporekin']);
  for (const { group, habitat, speciesId } of residents) {
    const species = FAIRY_GARDEN_SPECIES.find(row => row.id === speciesId)!;
    const count = encounterPopulationCount(group);
    buildEnemyGroup('fallowmarch', { ...group, count }, new Rng(30),
      ([x, z], assetId, scale) => [x, ports.heightAt(x, z) - ports.baseY(assetId) * scale, z],
      entities, ports.assetSize, { habitat: { ...habitat, regionId: 'fallowmarch' },
        members: Array.from({ length: count }, (_, index) => ({ id: encounterActorId(group, index), stats: species.stats, scaleMultiplier: 1 })) });
  }
  return entities;
}
