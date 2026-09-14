import { tables, revision, version } from '../../content/compiled/catalog.json';
import type { ItemDef } from '../contracts.js';
import type { RecipeDef, ResourceDef, EnemyDef } from './index.js';
import type { ProgressionTier, Material, EquipmentFamily, RecipeTemplate } from './schema/progression.js';
import type { CreatureDefinition, CreatureProfile } from './schema/creatureDefinitions.js';
import type { ResolvedCreature } from './creatureCompiler.js';
import type { CreatureSpeciesDef } from './creatureSpecies.js';
import type { RpgBestiaryEntry } from './rpgBestiary.js';
import type { SourceLocation } from './compiler/contracts.js';

export const RESOLVED_TABLES = tables as unknown as Record<string, unknown>;

/** Only successful source transactions or checked builds replace this versioned artifact. */
export const RESOLVED_CATALOG = { tables, revision, version } as unknown as {
  version: 1;
  revision: string;
  tables: {
    items: ItemDef[]; recipes: RecipeDef[]; resources: ResourceDef[];
    progression: ProgressionTier[]; materials: Material[];
    equipmentFamilies: EquipmentFamily[]; recipeTemplates: RecipeTemplate[];
    creatureDefinitions: CreatureDefinition[]; creatureProfiles: CreatureProfile[];
    compiledCreatures: ResolvedCreature[]; enemies: EnemyDef[];
    species: (CreatureSpeciesDef | RpgBestiaryEntry)[];
  };
};
