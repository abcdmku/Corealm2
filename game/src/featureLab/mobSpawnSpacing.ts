import type { SemanticEntity } from '../contracts.js';
import { createFeatureLabEntity, FEATURE_LAB_CATALOG } from './catalog.js';
import { refineCreaturePopulation } from '../world/creaturePopulation.js';

export function createMobSpacingFixture(ports: {
  heightAt(x: number, z: number): number;
  baseY(assetId: string): number;
  assetSize(assetId: string): { x: number; y: number; z: number } | null;
}, stonePopulation = false): SemanticEntity[] {
  const actors = (stonePopulation ? ['species:flint_mandible', 'species:blind_cave_weaver', 'species:scree_watcher', 'marchfield_hens']
    : ['marchfield_hens', 'redsill_cattle', 'open_march_goats']).flatMap((id, pack) => {
    const preset = FEATURE_LAB_CATALOG.targets.creature.find(row => row.id === id)!;
    if (!preset) throw new Error(`Missing spacing fixture preset ${id}`);
    return Array.from({ length: stonePopulation ? 15 : 7 }, (_, index) => {
      const x = -25 + pack * 20 + (index % 3), z = -25 - Math.floor(index / 3);
      const entity = createFeatureLabEntity(preset, { entityId: `spawn-spacing:${id}:${index}`,
        groundPosition: [x, ports.heightAt(x, z), z], baseY: ports.baseY, assetSize: ports.assetSize });
      entity.meta = { ...entity.meta, groupId: `spawn-spacing:${id}` };
      return entity;
    });
  });
  return stonePopulation ? refineCreaturePopulation(actors, () => true, ports.assetSize) : actors;
}
