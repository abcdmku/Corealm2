import { equipmentStats, productionStats } from "../../../game/src/content/formulas/progression.js";
import { calculateCreatureCombat } from "../../../game/src/content/formulas/creature.js";
import type { EquipmentFamily, ProgressionTier, RecipeTemplate } from "../../../game/src/content/schema/progression.js";
import type { CreatureDefinition, CreatureProfile } from "../../../game/src/content/schema/creatureDefinitions.js";
import type { ContentRow } from "./contracts.js";
import type { Link, Path, RecordRef, Resolved } from "./origin.js";

/*
  Client-side derivation. The same formula functions the compiler runs, called in the browser so a
  record page can show a computed value beside the terms that produced it and recompute instantly
  when a curve parameter or an override changes. Nothing here writes; it only explains.

  Every derivation also carries `resolved`: the `Resolved<T>` chain from `model/origin.ts`. It says
  the same thing as `value` / `computed` / `overridden`, but keeps the middle links a boolean has to
  throw away (a variant number beating its base number beating the role curve) and names the record
  an edit is written to. `overridden` stays the one-bit view of `chain[0].kind === "own"`.
*/

export interface DerivationSource { collection: string; id: string; label: string; path?: string }
export interface Derivation<T = number> {
  /** The value the game sees: the override when there is one, otherwise the computed value. */
  value: T;
  computed: T;
  /** Human-readable terms, e.g. `round(0 + 1 × 195.71)`. */
  expression: string;
  overridden: boolean;
  /** Where the curve parameters live. */
  source: DerivationSource;
  /** The same answer as a chain: what won, what it beat, and where an edit lands. */
  resolved: Resolved<T>;
}

const ownLink = <T,>(value: T): Link<T> => ({ origin: { kind: "own" }, value });
const inheritedLink = <T,>(value: T, from: RecordRef): Link<T> => ({ origin: { kind: "inherited", from }, value });
const curveLink = <T,>(value: T, source: RecordRef, expression: string): Link<T> => ({ origin: { kind: "curve", source, expression }, value });
const absentLink = <T,>(): Link<T> => ({ origin: { kind: "absent" }, value: undefined as T });

/** Drop the links that do not apply and let the first survivor explain the value. */
function chainOf<T>(links: readonly (Link<T> | undefined)[], path: Path, storedOn?: RecordRef): Resolved<T> {
  const chain = links.filter((link): link is Link<T> => link !== undefined);
  const value = chain[0]?.value as T;
  return storedOn ? { value, chain, path, storedOn } : { value, chain, path };
}

/** A value a curve computes and an own adjustment may beat: `[own?, curve]`. */
function curveDerivation<T>(own: T | undefined, computed: T, source: DerivationSource, expression: string, path: Path, storedOn?: RecordRef): Derivation<T> {
  const resolved = chainOf<T>([own !== undefined ? ownLink(own) : undefined, curveLink(computed, source, expression)], path, storedOn);
  return { value: own ?? computed, computed, expression, overridden: own !== undefined, source, resolved };
}

export type EquipmentMember = ProgressionTier["equipment"][number];
export type ProductionEntry = ProgressionTier["production"][number];
export type BonusKey = keyof EquipmentFamily["parameters"]["bonusesBase"];
/** The tier a member or entry is stored on. Only its identity and required level are read. */
export type TierRef = Pick<ProgressionTier, "tier" | "reqLevel"> & { id?: string };

export const BONUS_KEYS: readonly BonusKey[] = ["meleeAccuracy", "magicAccuracy", "defence", "health", "meleePower", "magicPower", "vitality"];
export const BONUS_LABELS: Readonly<Record<BonusKey, string>> = {
  meleeAccuracy: "Melee accuracy", magicAccuracy: "Magic accuracy", defence: "Defence", health: "Health",
  meleePower: "Melee power", magicPower: "Magic power", vitality: "Vitality",
};

export const fmt = (value: number, digits = 2): string => Number.isInteger(value) ? String(value) : String(Number(value.toFixed(digits)));
const linear = (base: number, tier: number, perLevel: number, round = true): string => {
  const inner = base === 0 ? `${tier} × ${fmt(perLevel)}` : `${fmt(base)} + ${tier} × ${fmt(perLevel)}`;
  return round ? `round(${inner})` : inner;
};

/**
 * The progression row an adjustment is written to. `data/progression.json` keys tiers by `id`
 * ("tier_5"), the collection idKey; the tier number is the fallback for callers that only hand us
 * `{ tier, reqLevel }`.
 */
const tierRef = (tier: TierRef): RecordRef => ({ collection: "progression", id: tier.id ?? `tier_${tier.tier}`, label: `Tier ${tier.tier}` });

/** Value, bonuses and gathering strength for one tier member, with the family curve explained. */
export function deriveEquipmentMember(tier: TierRef, member: EquipmentMember, family: EquipmentFamily) {
  const calculated = equipmentStats(tier.tier, family.parameters);
  const adjustments = member.adjustments;
  const source: DerivationSource = { collection: "equipmentFamilies", id: family.id, label: family.name };
  const params = family.parameters;
  const storedOn = tierRef(tier);
  const value = curveDerivation(adjustments?.value, calculated.value,
    { ...source, path: "parameters.valuePerLevel" },
    `max(0, ${linear(params.valueBase, tier.tier, params.valuePerLevel)})`, ["adjustments", "value"], storedOn);
  const bonuses = Object.fromEntries(BONUS_KEYS.map(key => [key, curveDerivation(
    adjustments?.bonuses?.[key], calculated.bonuses[key],
    { ...source, path: `parameters.bonusesPerLevel.${key}` }, linear(params.bonusesBase[key], tier.tier, params.bonusesPerLevel[key]),
    ["adjustments", "bonuses", key], storedOn,
  )])) as Record<BonusKey, Derivation>;
  const gatherBonus = curveDerivation(adjustments?.gatherBonus, calculated.gatherBonus,
    { ...source, path: "parameters.gatherBonusPerLevel" },
    linear(0, tier.tier, params.gatherBonusPerLevel, false), ["adjustments", "gatherBonus"], storedOn);
  return {
    value, bonuses, gatherBonus,
    category: family.category, slot: family.slot ?? "mainHand", skill: family.skill,
    requires: { skill: family.skill, level: tier.reqLevel },
    attackSpeedMs: family.attackSpeedMs, magicWeapon: family.magicWeapon,
  };
}

/** Duration, experience and required level for one production entry, with the template explained. */
export function deriveProductionEntry(tier: TierRef, entry: ProductionEntry, template: RecipeTemplate) {
  const calculated = productionStats(tier.tier, template.parameters);
  const adjustments = entry.adjustments;
  const source: DerivationSource = { collection: "recipeTemplates", id: template.id, label: template.name };
  const storedOn = tierRef(tier);
  const durationMs = curveDerivation(adjustments?.durationMs, calculated.durationMs,
    { ...source, path: "parameters.durationMs" }, `${fmt(template.parameters.durationMs)} ms`, ["adjustments", "durationMs"], storedOn);
  const xp = curveDerivation(adjustments?.xp, calculated.xp,
    { ...source, path: "parameters.xpPerLevel" },
    linear(template.parameters.xpBase, tier.tier, template.parameters.xpPerLevel), ["adjustments", "xp"], storedOn);
  // No template curve computes the required level: it is the tier row's own number, so what an
  // entry override beats is an inherited link rather than a curve.
  const ownReqLevel = adjustments?.reqLevel;
  const fromTier: RecordRef = { ...storedOn, path: "reqLevel" };
  const reqLevel: Derivation = {
    value: ownReqLevel ?? tier.reqLevel, computed: tier.reqLevel,
    expression: `tier required level`, overridden: ownReqLevel !== undefined,
    source: { collection: "progression", id: "", label: "tier", path: "reqLevel" },
    resolved: chainOf<number>(
      [ownReqLevel !== undefined ? ownLink(ownReqLevel) : undefined, inheritedLink(tier.reqLevel, fromTier)],
      ["adjustments", "reqLevel"], ownReqLevel === undefined ? fromTier : storedOn),
  };
  return { durationMs, xp, reqLevel, kind: template.kind, skill: template.skill, stations: template.stations };
}

const COMBAT_EXPRESSIONS: Record<string, (level: number, profile: CreatureProfile) => string> = {
  maxHealth: (level, p) => `max(1, ${linear(p.healthBase, level, p.healthPerLevel)})`,
  attackLevel: (level, p) => `max(1, ${linear(0, level, p.attackMultiplier)})`,
  defenceLevel: (level, p) => `max(1, ${linear(0, level, p.defenceMultiplier)})`,
  accuracy: (level, p) => linear(0, level, p.accuracyPerLevel),
  armour: (level, p) => linear(0, level, p.armourPerLevel),
  magicArmour: (level, p) => linear(0, level, p.magicArmourPerLevel),
  maxHit: (level, p) => `max(1, round(1 + ${level} × ${fmt(p.hitPerLevel)}))`,
  marks: (level, p) => `[round(${level} × ${fmt(p.marksPerLevel)}), ×2]`,
  attackSpeedMs: (_l, p) => `${p.attackSpeedMs} ms from role`,
  behaviour: (_l, p) => `${p.role} role`,
  aggroRadius: (_l, p) => `${p.role} role`,
  attackStyle: (_l, p) => `${p.role} role`,
  attackRangeM: (_l, p) => `${p.role} role`,
};
const COMBAT_PARAM: Record<string, string> = {
  maxHealth: "healthPerLevel", attackLevel: "attackMultiplier", defenceLevel: "defenceMultiplier", accuracy: "accuracyPerLevel",
  armour: "armourPerLevel", magicArmour: "magicArmourPerLevel", maxHit: "hitPerLevel", marks: "marksPerLevel", attackSpeedMs: "attackSpeedMs",
};
export const COMBAT_LABELS: Readonly<Record<string, string>> = {
  maxHealth: "Health", attackLevel: "Attack", defenceLevel: "Defence", accuracy: "Accuracy", armour: "Armour", magicArmour: "Magic armour",
  maxHit: "Max hit", marks: "Marks", attackSpeedMs: "Attack speed", behaviour: "Behaviour", aggroRadius: "Aggro radius", attackStyle: "Attack style",
  attackRangeM: "Attack range", moveSpeedMps: "Move speed", walkSpeedMps: "Walk speed",
};
export const COMBAT_FIELDS = ["maxHealth", "attackLevel", "defenceLevel", "accuracy", "armour", "magicArmour", "maxHit", "marks", "attackSpeedMs", "attackStyle", "attackRangeM", "behaviour", "aggroRadius"] as const;
/** Adjustable but not computed: the curve never sets these, so their chain never has a curve link. */
export const UNCOMPUTED_FIELDS = ["moveSpeedMps", "walkSpeedMps"] as const;
/** Fields a variant either authors or takes whole from its base. They are not adjustments. */
export const IDENTITY_FIELDS = ["name", "family", "level", "profileId", "availability", "loot", "presentation"] as const;
export type IdentityField = typeof IDENTITY_FIELDS[number];

const creatureRef = (record: CreatureDefinition, path?: string): RecordRef =>
  ({ collection: "creatureDefinitions", id: record.id, label: record.name ?? record.id, ...(path === undefined ? {} : { path }) });

/**
 * A whole-field identity value on a creature: authored here, taken from the base, or simply not
 * there. No curve computes these, so the chain is one link long.
 */
export function resolveInherited<K extends IdentityField>(definition: CreatureDefinition, base: CreatureDefinition | undefined, key: K): Resolved<CreatureDefinition[K]> {
  const path: Path = [key];
  const own = (definition as Record<string, unknown>)[key];
  if (own !== undefined) return chainOf([ownLink(own)], path) as Resolved<CreatureDefinition[K]>;
  const carried = base ? (base as Record<string, unknown>)[key] : undefined;
  if (base && carried !== undefined) {
    const from = creatureRef(base, key);
    return chainOf([inheritedLink(carried, from)], path, from) as Resolved<CreatureDefinition[K]>;
  }
  return chainOf([absentLink()], path) as Resolved<CreatureDefinition[K]>;
}

/** A creature's resolved row (base + variant), its combat block derived from the role curve, and which fields are inherited. */
export function deriveCreature(definition: CreatureDefinition, base: CreatureDefinition | undefined, profile: CreatureProfile | undefined) {
  const row = { ...base, ...definition, adjustments: { ...base?.adjustments, ...definition.adjustments } } as CreatureDefinition & { adjustments: Record<string, unknown> };
  const inherited = base ? Object.keys(base).filter(key => !(key in definition)) : [];
  const level = row.level ?? 1;
  const computed = profile ? calculateCreatureCombat(Math.max(1, Math.floor(level)), profile) as unknown as Record<string, unknown> : {};
  const source: DerivationSource = profile ? { collection: "creatureProfiles", id: profile.id, label: profile.name } : { collection: "creatureProfiles", id: "", label: "role" };
  const ownAdjustments = (definition.adjustments ?? {}) as Record<string, unknown>;
  const baseAdjustments = (base?.adjustments ?? {}) as Record<string, unknown>;
  const combat: Record<string, Derivation<unknown>> = {};
  for (const key of COMBAT_FIELDS) {
    const own = ownAdjustments[key];
    const carried = baseAdjustments[key];
    const override = row.adjustments[key];
    const expression = profile ? COMBAT_EXPRESSIONS[key]?.(level, profile) ?? "" : "no role";
    const curveSource: DerivationSource = { ...source, path: COMBAT_PARAM[key] };
    const from = base ? creatureRef(base, `adjustments.${key}`) : undefined;
    combat[key] = {
      value: override ?? computed[key], computed: computed[key],
      expression, overridden: override !== undefined, source: curveSource,
      resolved: chainOf<unknown>([
        own !== undefined ? ownLink(own) : undefined,
        carried !== undefined && from ? inheritedLink(carried, from) : undefined,
        curveLink(computed[key], curveSource, expression),
      ], ["adjustments", key], own === undefined && carried !== undefined ? from : undefined),
    };
  }
  // Fields the curve does not set but adjustments can (movement speeds and the like) stay as plain
  // overrides: own, carried from the base, or absent — never a curve link.
  for (const key of [...UNCOMPUTED_FIELDS, ...Object.keys(row.adjustments)]) {
    if (key in combat) continue;
    const own = ownAdjustments[key];
    const carried = baseAdjustments[key];
    const override = row.adjustments[key];
    const from = base ? creatureRef(base, `adjustments.${key}`) : undefined;
    combat[key] = {
      value: override, computed: undefined, expression: "", overridden: override !== undefined, source,
      resolved: chainOf<unknown>([
        own !== undefined ? ownLink(own) : undefined,
        carried !== undefined && from ? inheritedLink(carried, from) : undefined,
        own === undefined && carried === undefined ? absentLink() : undefined,
      ], ["adjustments", key], own === undefined && carried !== undefined ? from : undefined),
    };
  }
  return { row, inherited, level, combat, profile };
}

/** Find the tier member and family behind a generated item id. */
export function equipmentSource(itemId: string, progression: readonly ProgressionTier[], families: readonly EquipmentFamily[]) {
  for (const tier of progression) {
    const member = tier.equipment.find(entry => entry.id === itemId);
    if (!member) continue;
    const family = families.find(entry => entry.id === member.familyId);
    return family ? { tier, member, family } : undefined;
  }
  return undefined;
}

/** Find the tier entry and template behind a generated recipe id. */
export function productionSource(recipeId: string, progression: readonly ProgressionTier[], templates: readonly RecipeTemplate[]) {
  for (const tier of progression) {
    const entry = tier.production.find(row => row.id === recipeId);
    if (!entry) continue;
    const template = templates.find(row => row.id === entry.templateId);
    return template ? { tier, entry, template } : undefined;
  }
  return undefined;
}

/** Rows of a collection response, typed for the derivation helpers. Callers own the trust boundary. */
export const typedRows = <T,>(rows: readonly ContentRow[]): readonly T[] => rows as unknown as readonly T[];
