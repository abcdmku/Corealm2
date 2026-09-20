import { tables as bundledTables, revision as bundledRevision, formulaRevision as bundledFormulaRevision, version as bundledVersion } from '../../content/compiled/catalog.json';
import { takeInstalledCatalog, type InstalledCatalog } from './catalogInstall.js';
import type { ItemDef } from '../contracts.js';
import type { RecipeDef, ResourceDef, EnemyDef } from './index.js';
import type { ProgressionTier, Material, EquipmentFamily, RecipeTemplate } from './schema/progression.js';
import type { CreatureDefinition, CreatureProfile } from './schema/creatureDefinitions.js';
import type { ResolvedCreature } from './creatureCompiler.js';
import type { CreatureSpeciesDef } from './creatureSpecies.js';
import type { RpgBestiaryEntry } from './rpgBestiary.js';
import type { SourceLocation } from './compiler/contracts.js';

/** A server installs its database's catalog before this module loads. Everything else runs on the build's. */
const { tables, revision, formulaRevision, version } = takeInstalledCatalog() ?? { tables: bundledTables, revision: bundledRevision, formulaRevision: bundledFormulaRevision, version: bundledVersion };
export const RESOLVED_TABLES = tables as unknown as Record<string, unknown>;

/** Only successful source transactions or checked builds replace this versioned artifact. */
export const RESOLVED_CATALOG = { tables, revision, formulaRevision, version } as unknown as {
  version: 1;
  revision: string;
  /** The formula code this catalog was compiled with. A bundled server compiles publishes with it. */
  formulaRevision: string;
  tables: {
    items: ItemDef[]; recipes: RecipeDef[]; resources: ResourceDef[];
    progression: ProgressionTier[]; materials: Material[];
    equipmentFamilies: EquipmentFamily[]; recipeTemplates: RecipeTemplate[];
    creatureDefinitions: CreatureDefinition[]; creatureProfiles: CreatureProfile[];
    compiledCreatures: ResolvedCreature[]; enemies: EnemyDef[];
    species: (CreatureSpeciesDef | RpgBestiaryEntry)[];
  };
};

/**
 * A live publish moves the catalog this process runs on. The table object is refilled in place, so
 * `RESOLVED_TABLES` and `RESOLVED_CATALOG.tables` stay one object. A module that copied a table out at
 * import keeps its copy until the next start; `multiplayer/contentSwap.ts` names the tables it re-points.
 */
export function adoptCatalog(next: InstalledCatalog): void {
  for (const name of Object.keys(RESOLVED_TABLES)) if (!(name in next.tables)) delete RESOLVED_TABLES[name];
  Object.assign(RESOLVED_TABLES, next.tables);
  Object.assign(RESOLVED_CATALOG, { revision: next.revision, formulaRevision: next.formulaRevision });
}
