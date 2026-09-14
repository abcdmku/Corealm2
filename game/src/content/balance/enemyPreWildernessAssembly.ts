import type { EnemyDef } from '../index.js';
import type { PreWildernessAssemblyConfig } from '../schema/enemyPreWildernessAssembly.js';
import { deriveEnemyAssemblySource, type EnemyAssemblySource, type EnemyAssemblySourceParams,
  type AssemblySourceLootResolver } from './enemyAssemblySources.js';
import { scaleFantasy, type FantasyParams } from './enemySourceVariants.js';
import type { EnemyFieldsWithoutDrops } from './enemySources.js';
export type { PreWildernessAssemblyConfig, PreWildernessSpeciesRef } from '../schema/enemyPreWildernessAssembly.js';

export interface PreWildernessAssemblyParams { legacy: EnemyAssemblySourceParams; fantasy: FantasyParams }
export interface PreWildernessAssemblyDependencies {
  assemblySources: readonly EnemyAssemblySource[];
  resolveCombat: (inputId: string) => Readonly<EnemyFieldsWithoutDrops> | undefined;
  resolveLoot: AssemblySourceLootResolver;
}

/** Replays the original canonical fold, then appends the two ordered alias collections. */
export function buildPreWildernessAssembly(params: PreWildernessAssemblyParams, config: Readonly<PreWildernessAssemblyConfig>,
  dependencies: PreWildernessAssemblyDependencies) {
  const assembly = new Map(dependencies.assemblySources.map(row => [row.id, row]));
  if (assembly.size !== dependencies.assemblySources.length) throw new Error('Duplicate authored assembly source');
  const authored = new Map<string, EnemyDef>();
  const resolveAuthored = (id: string): EnemyDef => {
    const cached = authored.get(id); if (cached) return cached;
    const source = assembly.get(id); if (!source) throw new Error(`Missing authored assembly source ${id}`);
    const result = deriveEnemyAssemblySource(params.legacy, source, dependencies.resolveLoot);
    authored.set(id, result); return result;
  };
  const resolveSource = (combatInputId: string, lootInputId: string): EnemyDef => {
    const authoredSource = assembly.get(combatInputId);
    if (authoredSource) {
      if (authoredSource.kind !== 'redWorm' || lootInputId !== combatInputId) throw new Error(`Invalid authored species join ${combatInputId}`);
      return resolveAuthored(combatInputId);
    }
    const combat = dependencies.resolveCombat(combatInputId);
    if (!combat) throw new Error(`Missing source combat input ${combatInputId}`);
    const drops = dependencies.resolveLoot(lootInputId);
    if (!drops) throw new Error(`Missing source loot input ${lootInputId}`);
    return { ...combat, drops };
  };
  const legacyBlocks = config.legacyAssemblyInputIds.map(id => {
    if (assembly.get(id)?.kind === 'redWorm') throw new Error(`Red worm cannot be a legacy block ${id}`);
    return resolveAuthored(id);
  });
  const sourceBlocks = config.sourceBlocks.map(row => resolveSource(row.combatInputId, row.lootInputId));
  const sources = new Map(config.sourceBlocks.map((row, index) => [row.combatInputId, { row, stats: sourceBlocks[index]! }]));
  const fantasyBlocks = config.fantasyBlocks.map(row => {
    const source = sources.get(row.sourceInputId);
    if (!source || source.row.lootInputId !== row.lootInputId) throw new Error(`Missing or mismatched fantasy source ${row.sourceInputId}`);
    return scaleFantasy(params.fantasy, source.stats, row.tier);
  });
  const allBlocks = [...new Map([...legacyBlocks, ...sourceBlocks, ...fantasyBlocks].map(row => [row.id, row])).values()];
  const byBlockId = new Map(allBlocks.map(row => [row.id, row]));
  const aliasIds = new Set<string>();
  const checkAlias = (id: string) => {
    if (aliasIds.has(id) || byBlockId.has(id)) throw new Error(`Duplicate assembly alias ${id}`);
    aliasIds.add(id);
  };
  const groupAliases = config.groupAliases.map(row => {
    checkAlias(row.id);
    const base = byBlockId.get(row.baseEnemyId);
    if (!base) throw new Error(`Missing group alias base ${row.baseEnemyId}`);
    return { ...base, id: row.id };
  });
  const fantasySources = new Set(config.fantasyBlocks.map(row => row.sourceInputId));
  const fantasyEncounterBlocks = config.fantasyEncounters.map(row => {
    checkAlias(row.id);
    const original = byBlockId.get(row.originalEnemyId), replacement = sources.get(row.replacementSourceInputId)?.stats;
    if (!original || !replacement || !fantasySources.has(row.replacementSourceInputId)) {
      throw new Error(`Missing original stats or replacement creature for ${row.id}`);
    }
    return { ...original, id: row.id, family: replacement.family, name: replacement.name,
      moveSpeedMps: replacement.moveSpeedMps, walkSpeedMps: replacement.walkSpeedMps };
  });
  if (config.progressionSpecies.length !== sourceBlocks.length
    || config.progressionSpecies.some((row, index) => row.sourceInputId !== config.sourceBlocks[index]!.combatInputId)) {
    throw new Error('Progression species do not match ordered source blocks');
  }
  const sourceSpecies = config.progressionSpecies.map((row, index) => ({ id: row.id, assetId: row.assetId, stats: sourceBlocks[index]! }));
  const preWildernessBlocks = [...allBlocks, ...groupAliases, ...fantasyEncounterBlocks];
  return { allBlocks, groupAliases, fantasyEncounterBlocks, preWildernessBlocks,
    preWildernessById: new Map(preWildernessBlocks.map(row => [row.id, row])), sourceSpecies };
}
