import { arr, id, lit, obj, ref, refine, str, union, type Infer } from './core.js';

const inputId = () => str({ nonEmpty: true }, { readOnly: true });
const unique = <T>(rows: readonly T[]) => new Set(rows).size === rows.length;
export const PreWildernessSourceBlockSchema = obj({ combatInputId: inputId(), lootInputId: inputId() });
export const PreWildernessFantasyBlockSchema = obj({ sourceInputId: inputId(),
  tier: union([lit(1), lit(5), lit(10), lit(20)] as const), lootInputId: inputId() });
export const PreWildernessGroupAliasSchema = obj({ id: id(), baseEnemyId: id() });
export const PreWildernessFantasyEncounterSchema = obj({ id: id(), originalEnemyId: id(), replacementSourceInputId: inputId() });
export const PreWildernessSpeciesRefSchema = obj({ id: id(), assetId: ref('asset'), sourceInputId: inputId() });
export const PreWildernessAssemblyConfigSchema = refine(obj({
  legacyAssemblyInputIds: arr(inputId()), sourceBlocks: arr(PreWildernessSourceBlockSchema),
  fantasyBlocks: arr(PreWildernessFantasyBlockSchema), groupAliases: arr(PreWildernessGroupAliasSchema),
  fantasyEncounters: arr(PreWildernessFantasyEncounterSchema), progressionSpecies: arr(PreWildernessSpeciesRefSchema),
}), value => unique(value.legacyAssemblyInputIds)
  && unique(value.fantasyBlocks.map(row => `${row.sourceInputId}/${row.tier}`))
  && unique([...value.groupAliases, ...value.fantasyEncounters].map(row => row.id))
  && unique(value.progressionSpecies.map(row => row.id))
  && value.sourceBlocks.length === value.progressionSpecies.length
  && value.sourceBlocks.every((row, index) => row.combatInputId === value.progressionSpecies[index]!.sourceInputId),
'assembly identities must be unique and source blocks must align with ordered progression species');
export type PreWildernessAssemblyConfig = Infer<typeof PreWildernessAssemblyConfigSchema>;
export type PreWildernessSpeciesRef = Infer<typeof PreWildernessSpeciesRefSchema>;
