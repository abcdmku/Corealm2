import { createLootCompiler, withGoldRoll } from './lootCompiler.js';
import { formulaRegistry } from './formulas/index.js';
export { calculateCreatureCombat } from './formulas/creature.js';
import type { CreatureDefinition, CreatureProfile } from './schema/creatureDefinitions.js';
import { parseValue } from './schema/core.js';
import { EnemySchema } from './schema/enemies.js';
import type { EnemyDef } from './index.js';
import type { CreatureSpeciesDef } from './creatureSpecies.js';
import type { RpgBestiaryEntry } from './rpgBestiary.js';
import type { LootTableRecord } from './schema/loot.js';

/** Every region uses the same level curve. Profiles supply the deliberate role differences. */

export interface ResolvedCreature {
  id: string; definition: CreatureDefinition; enemy: EnemyDef;
  availability: 'world' | 'lab'; assetId?: string; scale?: number;
  presentation?: CreatureSpeciesDef | RpgBestiaryEntry;
  profileId: string; level: number; inheritedFields: readonly string[];
  adjustments: NonNullable<CreatureDefinition['adjustments']>;
}

/** The one place an enemy gets its rolls: gold first, sized by the final range (curve, then adjustments). */
function parseEnemy(fields: Record<string, unknown> & { gold?: [number, number]; lootRolls: EnemyDef['lootRolls'] }, path: string): EnemyDef {
  return parseValue(EnemySchema, { ...fields, lootRolls: withGoldRoll(fields.lootRolls, fields.gold) }, path);
}

/** Encounter levels use the same curve and keep the creature's authored exceptions. */
export function resolveCreatureAtLevel(creature: ResolvedCreature, profiles: readonly CreatureProfile[], level: number): EnemyDef {
  const profile = profiles.find(row => row.id === creature.profileId);
  if (!profile) throw new Error(`${creature.id}.profileId: unknown profile ${creature.profileId}`);
  return parseEnemy({
    ...formulaRegistry['creature.combat'].calculate({ tier: level }, profile),
    ...creature.adjustments,
    id: creature.id, name: creature.enemy.name, family: creature.enemy.family,
    tier: level, lootRolls: creature.enemy.lootRolls,
  }, `creatureDefinitions.${creature.id}.combat`);
}

/** Pure compilation, shared by runtime and authoring transactions. Variants have exactly one base. */
export function compileCreatures(definitions: readonly CreatureDefinition[], profiles: readonly CreatureProfile[], lootTables: readonly LootTableRecord[]) {
  const source = new Map(definitions.map(row => [row.id, row]));
  const profileMap = new Map(profiles.map(row => [row.id, row]));
  const compileLoot = createLootCompiler(lootTables);
  if (source.size !== definitions.length) throw new Error('Duplicate creature definition id');
  if (profileMap.size !== profiles.length) throw new Error('Duplicate creature profile id');
  const creatures: ResolvedCreature[] = definitions.map(definition => {
    const base = definition.baseId ? source.get(definition.baseId) : undefined;
    if (definition.baseId && !base) throw new Error(`${definition.id}.baseId: unknown base ${definition.baseId}`);
    if (base?.baseId) throw new Error(`${definition.id}.baseId: variants cannot inherit variants`);
    const row = { ...base, ...definition, adjustments: { ...base?.adjustments, ...definition.adjustments } };
    if (!row.name || !row.family || row.level === undefined || !row.profileId || !row.loot) throw new Error(`${row.id}: base creature needs name, family, level, profileId and loot`);
    const profile = profileMap.get(row.profileId);
    if (!profile) throw new Error(`${row.id}.profileId: unknown profile ${row.profileId}`);
    const lootRolls = compileLoot(row.loot, `creatureDefinitions.${row.id}.loot`);
    const enemy = parseEnemy({ ...formulaRegistry['creature.combat'].calculate({ tier: row.level }, profile), ...row.adjustments,
      id: row.id, name: row.name, family: row.family, tier: row.level, lootRolls }, `creatureDefinitions.${row.id}.combat`);
    const art = row.presentation;
    let presentation: CreatureSpeciesDef | RpgBestiaryEntry | undefined;
    if (art) { const { kind: _kind, ...fields } = art; presentation = { ...fields, stats: enemy }; }
    return { id: row.id, definition, enemy, availability: row.availability, assetId: art?.assetId, scale: art?.scale,
      presentation, profileId: row.profileId, level: row.level, adjustments: row.adjustments,
      inheritedFields: base ? Object.keys(base).filter(key => !(key in definition)) : [] };
  });
  const enemies = creatures.filter(row => row.availability === 'world').map(row => row.enemy);
  // Encounter variants may share one presentation identity. The explicit art owner wins.
  const speciesMap = new Map<string, CreatureSpeciesDef | RpgBestiaryEntry>();
  for (const row of creatures) if (row.presentation && !speciesMap.has(row.presentation.id)) speciesMap.set(row.presentation.id, row.presentation);
  return { creatures, enemies, species: [...speciesMap.values()], byCreatureId: new Map(creatures.map(row => [row.id, row])),
    byEnemyId: new Map(creatures.map(row => [row.id, row.enemy])), bySpeciesId: speciesMap };
}


