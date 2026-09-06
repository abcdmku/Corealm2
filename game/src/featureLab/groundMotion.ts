import type { SemanticEntity, Vec3 } from '../contracts.js';
import type { HabitatDef } from '../content/worldHabitats.js';
import { createFeatureLabEntity, FEATURE_LAB_CATALOG } from './catalog.js';

export const GROUND_MOTION_ACTORS = [
  { assetId: 'animal_frog', presetId: 'redsill_frogs', centre: [-66, 24] },
  { assetId: 'animal_frog_green', presetId: 'blackwater_frogs', centre: [-54, 24] },
  { assetId: 'animal_crab', presetId: 'gravelmaw:gravelmaw_ch2_crabs', centre: [-42, 24] },
  { assetId: 'animal_scorpion', presetId: 'gravelmaw:gravelmaw_ch2_scorpions', centre: [-30, 24] },
] as const;

export const LEGACY_GROUND_MOTION_ACTORS = [
  { assetId: 'animal_coyote', presetId: 'tarn_coyotes', centre: [-78, 24] },
  { assetId: 'animal_bear', presetId: 'highcairn_bears', centre: [-66, 24] },
  { assetId: 'animal_cattle', presetId: 'redsill_cattle', centre: [-54, 24] },
  { assetId: 'animal_aurochs', presetId: 'terrace_aurochs', centre: [-42, 24] },
  { assetId: 'animal_goat', presetId: 'open_march_goats', centre: [-30, 24] },
  { assetId: 'animal_ibex', presetId: 'ridge_ibex', centre: [-90, 24] },
  { assetId: 'animal_deer', presetId: 'duskoak_stags', centre: [-66, 48] },
  { assetId: 'animal_boar', presetId: 'scree_boars', centre: [-42, 36] },
  { assetId: 'animal_hog', presetId: 'bramble_hogs', centre: [-54, 36] },
  { assetId: 'animal_rat', presetId: 'gravelmaw:gravelmaw_ch1_rats', centre: [-30, 12] },
  { assetId: 'animal_rabbit', presetId: 'marchfield_coneys', centre: [-42, 12] },
  { assetId: 'animal_rabbit_dark', presetId: 'rootfall_coneys', centre: [-54, 12] },
] as const;

export interface GroundMotionFixture {
  readonly entities: SemanticEntity[];
  readonly habitats: HabitatDef[];
  readonly spawn: Vec3;
  readonly actors: { assetId: string; entityId: string; presetId: string }[];
  habitatForEntity(entity: SemanticEntity): HabitatDef | null;
}

/** Compact authored patrol circuits, using production actors, stats and AI.
 * No animation state, travel speed, simulation time or combat behavior override. */
export function createGroundMotionFixture(ports: {
  cohort?: 'ground' | 'legacy';
  assetIds?: readonly string[];
  heightAt(x: number, z: number): number;
  baseY(assetId: string): number;
  assetSize(assetId: string): { x: number; y: number; z: number } | null;
}): GroundMotionFixture {
  const habitats: HabitatDef[] = [], entities: SemanticEntity[] = [], actors: GroundMotionFixture['actors'] = [];
  const available = ports.cohort === 'legacy' ? LEGACY_GROUND_MOTION_ACTORS : GROUND_MOTION_ACTORS;
  if (ports.assetIds && (!ports.assetIds.length || ports.assetIds.some(id => !available.some(row => row.assetId === id)))) throw new Error('Unknown ground motion fixture selection');
  for (const row of available.filter(row => !ports.assetIds || ports.assetIds.includes(row.assetId))) {
    const preset = FEATURE_LAB_CATALOG.targets.creature.find(preset => preset.id === row.presetId);
    if (!preset) throw new Error(`Ground motion fixture lacks ${row.assetId}`);
    const [x, z] = row.centre, entityId = `ground-motion:${row.assetId}`;
    const anchors = [[x - .8, z - .8], [x + .8, z - .8], [x + .8, z + .8], [x - .8, z + .8]] as const;
    const point = anchors[0];
    const entity = createFeatureLabEntity(preset, { entityId, groundPosition: [point[0], ports.heightAt(point[0], point[1]), point[1]], baseY: ports.baseY, assetSize: ports.assetSize, rotationY: Math.PI / 2 });
    if (entity.view?.assetId !== row.assetId) throw new Error(`Ground motion source changed ${row.assetId}`);
    entity.regionId = 'fallowmarch';
    entity.meta = { ...entity.meta, groundMotionFixture: true };
    const habitat: HabitatDef = { id: entityId, groupId: entityId, regionId: 'fallowmarch', centre: [x, z], radius: 5, anchors, activity: 'patrol', dressing: [] };
    entities.push(entity); habitats.push(habitat); actors.push({ assetId: row.assetId, entityId, presetId: preset.id });
  }
  const byEntity = new Map(entities.map((entity, i) => [entity.id, habitats[i]!]));
  return { entities, habitats, actors, spawn: [-48, ports.heightAt(-48, 0), 0], habitatForEntity: entity => byEntity.get(entity.id) ?? null };
}
