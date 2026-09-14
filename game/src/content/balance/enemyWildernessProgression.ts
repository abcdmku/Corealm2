import { combatLevel, tuneCombat, type CombatLevelParams, type TuningParams } from './enemies.js';
import type { EnemyDef } from '../index.js';
import type { EnemyFieldsWithoutDrops } from './enemySources.js';
import type { WildernessKeeperRow } from '../schema/enemyWildernessSources.js';
import type { WildernessGroupInput, WildernessLootRequest, WildernessProgressionParams, WildernessSpeciesInput } from '../schema/enemyWildernessProgression.js';
export type { WildernessGroupInput, WildernessLootRequest, WildernessProgressionParams, WildernessSpeciesInput } from '../schema/enemyWildernessProgression.js';

export interface WildernessProgressionDependencies {
  combatLevel: CombatLevelParams;
  tuning: TuningParams;
  keepers: readonly Readonly<WildernessKeeperRow>[];
  resolveWildernessLoot: (request: Readonly<WildernessLootRequest>) => EnemyDef['drops'];
}

export function wildernessTierAt(p: WildernessProgressionParams, z: number): 50 | 70 {
  return z < p.depth.divide ? p.bands[0].tier : p.bands[1].tier;
}

export function wildernessLevelAt(p: WildernessProgressionParams, base: Readonly<EnemyFieldsWithoutDrops>, z: number,
  dependencies: Pick<WildernessProgressionDependencies, 'combatLevel' | 'keepers'>): number {
  if (!Number.isFinite(z)) throw new Error(`Invalid Wilderness encounter depth for ${base.id}`);
  const tier = wildernessTierAt(p, z), shallow = tier === p.bands[0].tier;
  const band = shallow ? p.bands[0] : p.bands[1];
  const south = shallow ? p.depth.south : p.depth.divide, north = shallow ? p.depth.divide : p.depth.north;
  const progress = Math.max(0, Math.min(1, (z - south) / (north - south)));
  if (base.tier < p.legacySourceTierThreshold) return band.legacyBase + Math.round(progress * p.legacyProgressLevels);
  const authored = combatLevel(dependencies.combatLevel, base);
  const nativeLevel = base.tier === tier && !dependencies.keepers.some(keeper => keeper.id === base.family)
    ? authored : Math.max(band.fallbackFloor, Math.min(band.fallbackCeiling, tier + authored - base.tier));
  return nativeLevel + Math.round(progress * p.nativeProgressLevels);
}

export function wildernessMarks(p: WildernessProgressionParams, base: Readonly<EnemyFieldsWithoutDrops>, tier: 50 | 70): [number, number] {
  const ratio = tier / base.tier, marks = p.marks;
  const minimum = Math.max(tier * marks.minimumPerTargetTier,
    Math.round((base.marks?.[0] ?? base.tier * marks.defaultMinimumPerSourceTier) * ratio));
  return [minimum, Math.max(minimum, tier * marks.maximumPerTargetTier,
    Math.round((base.marks?.[1] ?? base.tier * marks.defaultMaximumPerSourceTier) * ratio))];
}

function requireUsableBase(base: Readonly<EnemyFieldsWithoutDrops>, groupId: string): Readonly<EnemyFieldsWithoutDrops> {
  for (const [key, value] of Object.entries({
    maxHealth: base.maxHealth, attackLevel: base.attackLevel, defenceLevel: base.defenceLevel,
    accuracy: base.accuracy, armour: base.armour, magicArmour: base.magicArmour, maxHit: base.maxHit,
  })) if (!Number.isFinite(value) || value < 0) throw new Error(`${groupId}: invalid source ${key}`);
  if (base.maxHealth <= 0 || base.attackLevel <= 0 || base.defenceLevel <= 0 || base.tier <= 0)
    throw new Error(`${groupId}: Wilderness source needs positive health, combat levels and tier`);
  return base;
}

/** Receives current authored groups and the resolved graph; no captured registries or final-output seeds. */
export function buildWildernessProgression(p: WildernessProgressionParams,
  groups: readonly Readonly<WildernessGroupInput>[],
  preWilderness: ReadonlyMap<string, Readonly<EnemyFieldsWithoutDrops>>,
  speciesRefs: readonly Readonly<WildernessSpeciesInput>[],
  sources: ReadonlyMap<string, Readonly<EnemyFieldsWithoutDrops>>,
  dependencies: WildernessProgressionDependencies): EnemyDef[] {
  const keepers = new Map(dependencies.keepers.map(keeper => [keeper.id as string, keeper]));
  const uniqueGroups = new Set<string>();
  type Species = { id: string; assetId: string; stats: Readonly<EnemyFieldsWithoutDrops> };
  const speciesByFamily = new Map<string, Species[]>();
  for (const ref of speciesRefs) {
    const stats = sources.get(ref.sourceInputId);
    if (!stats) throw new Error(`Missing Wilderness species source ${ref.sourceInputId} for ${ref.id}`);
    const rows = speciesByFamily.get(stats.family) ?? [];
    rows.push({ id: ref.id, assetId: ref.assetId, stats });
    speciesByFamily.set(stats.family, rows);
  }
  for (const rows of speciesByFamily.values()) rows.sort((a, b) => a.id.localeCompare(b.id));
  const lookup = (groupId: string, family: string, tier: number) => {
    const exact = preWilderness.get(groupId);
    return exact?.family === family ? exact : preWilderness.get(`${family}_t${tier}`);
  };
  const resolved = groups.map(group => {
    if (uniqueGroups.has(group.id)) throw new Error(`Duplicate Wilderness encounter ${group.id}`);
    uniqueGroups.add(group.id);
    if (!group.family || !Number.isFinite(group.centre[1])) throw new Error(`${group.id}: invalid Wilderness family or depth`);
    const keeper = keepers.get(group.id);
    if (keeper && wildernessTierAt(p, group.centre[1]) !== keeper.tier)
      throw new Error(`${group.id}: rune keeper is outside its ${keeper.tier} depth band`);
    if (keeper && (group.count !== 1 || !(group.boss || group.miniBoss)))
      throw new Error(`${group.id}: rune keeper must be one boss or miniboss`);
    const supplied = lookup(group.id, group.family, group.tier);
    const candidates = speciesByFamily.get(group.family) ?? [];
    const species = candidates.find(row => row.assetId === group.assetId) ?? candidates[0];
    let base = supplied?.id === group.id && supplied.family === group.family ? supplied : species?.stats;
    base ??= supplied?.family === group.family ? supplied : undefined;
    if (!base) for (const tier of p.fallbackTiers) {
      const fallback = lookup(group.id, group.family, tier);
      if (fallback?.family === group.family) { base = fallback; break; }
    }
    if (!base) throw new Error(`Missing Wilderness source for ${group.id} (${group.family})`);
    return { group, keeper, base: requireUsableBase(base, group.id), speciesId: species?.id ?? group.family };
  });
  const output = new Map<string, EnemyDef>();
  const add = (block: EnemyDef) => {
    if (output.has(block.id)) throw new Error(`Conflicting Wilderness block id ${block.id}`);
    output.set(block.id, block);
  };
  const tune = (base: Readonly<EnemyFieldsWithoutDrops>, target: number, tier: number) =>
    ({ ...base, ...tuneCombat(dependencies.tuning, dependencies.combatLevel, base, target, tier, base.id) });
  const byFamily = new Map<string, typeof resolved>();
  for (const row of resolved) {
    const siblings = byFamily.get(row.group.family) ?? [];
    siblings.push(row); byFamily.set(row.group.family, siblings);
  }
  for (const [family, siblings] of [...byFamily].sort(([a], [b]) => a.localeCompare(b))) {
    const keeper = siblings.find(row => row.keeper)?.keeper;
    const ordered = [...siblings].sort((a, b) => a.group.centre[1] - b.group.centre[1] || a.group.id.localeCompare(b.group.id));
    const representative = keeper ? siblings.find(row => row.keeper?.id === keeper.id)! : ordered[0]!;
    const canonicalSpecies = speciesByFamily.get(family)?.find(row => row.assetId === representative.group.assetId)
      ?? speciesByFamily.get(family)?.[0];
    const base = requireUsableBase(canonicalSpecies?.stats ?? representative.base, representative.group.id);
    for (const tier of keeper ? [keeper.tier] : p.bands.map(band => band.tier)) {
      const z = tier === p.bands[0].tier ? p.depth.south : p.depth.divide;
      const level = keeper ? keeper.tier * keeper.multiplier : wildernessLevelAt(p, base, z, dependencies);
      add({ ...tune(base, level, tier), id: `${family}_t${tier}`, family,
        name: canonicalSpecies?.stats.name ?? representative.group.name, marks: wildernessMarks(p, base, tier),
        drops: dependencies.resolveWildernessLoot({ speciesId: canonicalSpecies?.id ?? representative.speciesId, tier,
          ...(keeper ? { keeperId: keeper.id } : {}) }) });
    }
  }
  for (const { group, keeper, base, speciesId } of resolved) {
    const tier = keeper?.tier ?? wildernessTierAt(p, group.centre[1]);
    const target = keeper ? tier * keeper.multiplier : wildernessLevelAt(p, base, group.centre[1], dependencies);
    add({ ...tune(base, target, tier), id: group.id, family: group.family, name: group.name,
      marks: wildernessMarks(p, base, tier),
      drops: dependencies.resolveWildernessLoot({ speciesId, tier, ...(keeper ? { keeperId: keeper.id } : {}), groupId: group.id }) });
  }
  return [...output.values()];
}
