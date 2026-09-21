import { takeInstalledCatalog, type InstalledCatalog } from './catalogInstall.js';
import type { ItemDef } from '../contracts.js';
import type { RecipeDef, ResourceDef, EnemyDef } from './index.js';
import type { ProgressionTier, Material, EquipmentFamily, RecipeTemplate } from './schema/progression.js';
import type { CreatureDefinition, CreatureProfile } from './schema/creatureDefinitions.js';
import type { ResolvedCreature } from './creatureCompiler.js';
import type { CreatureSpeciesDef } from './creatureSpecies.js';
import type { RpgBestiaryEntry } from './rpgBestiary.js';
import type { SourceLocation } from './compiler/contracts.js';

/**
 * The catalog this process runs on, claimed once, at the moment the content graph starts evaluating.
 *
 * There is no fallback here on purpose. This module holds no static import of the compiled JSON, so
 * a client, a worker or a server bundle that never needs it never carries it. A process that wants
 * the build's catalog says so by importing `bundledCatalog.js` first; a server installs its
 * database's catalog first. A process that did neither is misordered, and the error says so rather
 * than silently running on content from the wrong place.
 */
const installed = takeInstalledCatalog();
if (!installed) {
  throw new Error("No content catalog is installed. Import \"content/bundledCatalog.js\" for its side effect before any content module to run on the build's catalog, or call installCatalog() and then import() the rest.");
}
const { tables, revision, formulaRevision, version } = installed;
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
