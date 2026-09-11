import type { EnemyGroupDef } from './regions.js';
import type { CreatureSpeciesDef } from './creatureSpecies.js';
import { enemyCombatLevel, type EnemyDef } from './index.js';
import { tuneEnemyCombatLevel } from './encounterBalance.js';
import { WILDERNESS_DEPTH, WILDERNESS_RUNE_KEEPERS, wildernessTierAt } from './wildernessDepth.js';
import { WILDERNESS_STRUCTURE_COMPONENTS, wildernessDrops, type WildernessStructureLootId } from './wildernessLoot.js';

export type WildernessEnemyBaseLookup = (groupId: string, family: string, tier: number) => EnemyDef | undefined;
type WildernessTier = 50 | 70;
type Keeper = typeof WILDERNESS_RUNE_KEEPERS[number];

const KEEPERS = new Map<string, Keeper>(WILDERNESS_RUNE_KEEPERS.map((keeper) => [keeper.id, keeper]));
const TIERS = [50, 70] as const;
const LEGACY_TIERS = [20, 10, 5, 1] as const;

/** Exact court-pack identities avoid giving a nearby open-ground pack a fortress component. */
export function wildernessStructureLootForGroup(groupId: string): WildernessStructureLootId | undefined {
  for (const siteId of Object.keys(WILDERNESS_STRUCTURE_COMPONENTS) as WildernessStructureLootId[]) {
    if (groupId === `${siteId}_west_conclave` || groupId === `${siteId}_east_conclave`) return siteId;
  }
  return undefined;
}

function bandProgress(z: number, tier: WildernessTier): number {
  const south = tier === 50 ? WILDERNESS_DEPTH.south : WILDERNESS_DEPTH.divide;
  const north = tier === 50 ? WILDERNESS_DEPTH.divide : WILDERNESS_DEPTH.north;
  return Math.max(0, Math.min(1, (z - south) / (north - south)));
}

/** Same-species encounters grow steadily northward. Different bodies retain their relative weight. */
export function wildernessEnemyLevelAt(base: Readonly<EnemyDef>, z: number): number {
  if (!Number.isFinite(z)) throw new Error(`Invalid Wilderness encounter depth for ${base.id}`);
  const tier = wildernessTierAt(z);
  const progress = bandProgress(z, tier);
  if (base.tier < 50) return (tier === 50 ? 48 : 69) + Math.round(progress * 8);
  // The new bodies already have authored T50/T70 combat identities. Cross-tier family fallbacks
  // preserve their offset from the regional tier rather than multiplying the old stat numbers.
  const low = tier === 50 ? 48 : 69, high = tier === 50 ? 57 : 77;
  const nativeLevel = Math.max(low, Math.min(high, tier + enemyCombatLevel(base) - base.tier));
  return nativeLevel + Math.round(progress * 4);
}

function requireUsableBase(base: EnemyDef, groupId: string): EnemyDef {
  for (const [key, value] of Object.entries({
    maxHealth: base.maxHealth, attackLevel: base.attackLevel, defenceLevel: base.defenceLevel,
    accuracy: base.accuracy, armour: base.armour, magicArmour: base.magicArmour, maxHit: base.maxHit,
  })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${groupId}: invalid source ${key}`);
  }
  if (base.maxHealth <= 0 || base.attackLevel <= 0 || base.defenceLevel <= 0 || base.tier <= 0) {
    throw new Error(`${groupId}: Wilderness source needs positive health, combat levels and tier`);
  }
  return base;
}

function scaledMarks(base: EnemyDef, tier: WildernessTier): [number, number] {
  const ratio = tier / base.tier;
  const min = Math.max(tier, Math.round((base.marks?.[0] ?? base.tier) * ratio));
  return [min, Math.max(min, tier * 2, Math.round((base.marks?.[1] ?? base.tier * 3) * ratio))];
}

/**
 * Pure registration projection. The caller supplies final placements and the pre-Wilderness
 * lookup, so this module never imports the region or enemy registry that will consume its result.
 * Every group receives an exact alias. Ordinary families also receive both tier fallbacks;
 * keeper families receive only their native canonical block with their fixed keeper level.
 */
export function buildWildernessEnemyProgression(
  groups: readonly Readonly<EnemyGroupDef>[],
  baseLookup: WildernessEnemyBaseLookup,
  speciesList: readonly CreatureSpeciesDef[],
): EnemyDef[] {
  const uniqueGroups = new Set<string>();
  const speciesByFamily = new Map<string, CreatureSpeciesDef[]>();
  for (const species of speciesList) {
    const family = species.stats.family;
    const rows = speciesByFamily.get(family) ?? [];
    rows.push(species);
    speciesByFamily.set(family, rows);
  }
  for (const rows of speciesByFamily.values()) rows.sort((a, b) => a.id.localeCompare(b.id));

  const resolved = groups.map((group) => {
    if (uniqueGroups.has(group.id)) throw new Error(`Duplicate Wilderness encounter ${group.id}`);
    uniqueGroups.add(group.id);
    if (!group.family || !Number.isFinite(group.centre[1])) throw new Error(`${group.id}: invalid Wilderness family or depth`);
    const keeper = KEEPERS.get(group.id);
    if (keeper && wildernessTierAt(group.centre[1]) !== keeper.tier) {
      throw new Error(`${group.id}: rune keeper is outside its ${keeper.tier} depth band`);
    }
    if (keeper && (group.count !== 1 || !(group.boss || group.miniBoss))) {
      throw new Error(`${group.id}: rune keeper must be one boss or miniboss`);
    }
    const supplied = baseLookup(group.id, group.family, group.tier);
    const candidates = speciesByFamily.get(group.family) ?? [];
    const species = candidates.find((row) => row.assetId === group.assetId) ?? candidates[0];
    // Exact encounter blocks may carry a deliberately slower gait or a different behaviour.
    // Keep that production history ahead of a generic family/species block.
    let base = supplied?.id === group.id && supplied.family === group.family ? supplied : species?.stats;
    base ??= supplied?.family === group.family ? supplied : undefined;
    if (!base) {
      for (const tier of [...TIERS, ...LEGACY_TIERS]) {
        const fallback = baseLookup(group.id, group.family, tier);
        if (fallback?.family === group.family) { base = fallback; break; }
      }
    }
    if (!base) throw new Error(`Missing Wilderness source for ${group.id} (${group.family})`);
    return { group, keeper, base: requireUsableBase(base, group.id), speciesId: species?.id ?? group.family };
  });

  const output = new Map<string, EnemyDef>();
  const add = (block: EnemyDef): void => {
    if (output.has(block.id)) throw new Error(`Conflicting Wilderness block id ${block.id}`);
    output.set(block.id, block);
  };
  const byFamily = new Map<string, typeof resolved>();
  for (const row of resolved) {
    const siblings = byFamily.get(row.group.family) ?? [];
    siblings.push(row); byFamily.set(row.group.family, siblings);
  }

  for (const [family, siblings] of [...byFamily].sort(([a], [b]) => a.localeCompare(b))) {
    const keeper = siblings.find((row) => row.keeper)?.keeper;
    const ordered = [...siblings].sort((a, b) => a.group.centre[1] - b.group.centre[1] || a.group.id.localeCompare(b.group.id));
    const representative = keeper ? siblings.find((row) => row.keeper?.id === keeper.id)! : ordered[0]!;
    const canonicalSpecies = speciesByFamily.get(family)?.find((row) => row.assetId === representative.group.assetId)
      ?? speciesByFamily.get(family)?.[0];
    const base = requireUsableBase(canonicalSpecies?.stats ?? representative.base, representative.group.id);
    for (const tier of keeper ? [keeper.tier] : TIERS) {
      const z = tier === 50 ? WILDERNESS_DEPTH.south : WILDERNESS_DEPTH.divide;
      const level = keeper ? keeper.tier * keeper.multiplier : wildernessEnemyLevelAt(base, z);
      add({ ...tuneEnemyCombatLevel(base, level, tier), id: `${family}_t${tier}`, family,
        name: canonicalSpecies?.stats.name ?? representative.group.name, marks: scaledMarks(base, tier),
        drops: wildernessDrops(canonicalSpecies?.id ?? representative.speciesId, tier, keeper?.id) });
    }
  }

  for (const { group, keeper, base, speciesId } of resolved) {
    const tier = keeper?.tier ?? wildernessTierAt(group.centre[1]);
    const target = keeper ? tier * keeper.multiplier : wildernessEnemyLevelAt(base, group.centre[1]);
    add({ ...tuneEnemyCombatLevel(base, target, tier), id: group.id, family: group.family, name: group.name,
      marks: scaledMarks(base, tier),
      drops: wildernessDrops(speciesId, tier, keeper?.id, wildernessStructureLootForGroup(group.id)) });
  }
  return [...output.values()];
}
