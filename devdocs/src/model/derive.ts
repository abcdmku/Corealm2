import { equipmentStats, productionStats } from "../../../game/src/content/formulas/progression.js";
import { calculateCreatureCombat } from "../../../game/src/content/formulas/creature.js";
import type { EquipmentFamily, ProgressionTier, RecipeTemplate } from "../../../game/src/content/schema/progression.js";
import type { CreatureDefinition, CreatureProfile } from "../../../game/src/content/schema/creatureDefinitions.js";
import type { ContentRow } from "./contracts.js";

/*
  Client-side derivation. The same formula functions the compiler runs, called in the browser so a
  record page can show a computed value beside the terms that produced it and recompute instantly
  when a curve parameter or an override changes. Nothing here writes; it only explains.
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
}

export type EquipmentMember = ProgressionTier["equipment"][number];
export type ProductionEntry = ProgressionTier["production"][number];
export type BonusKey = keyof EquipmentFamily["parameters"]["bonusesBase"];

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

/** Value, bonuses and gathering strength for one tier member, with the family curve explained. */
export function deriveEquipmentMember(tier: Pick<ProgressionTier, "tier" | "reqLevel">, member: EquipmentMember, family: EquipmentFamily) {
  const calculated = equipmentStats(tier.tier, family.parameters);
  const adjustments = member.adjustments;
  const source: DerivationSource = { collection: "equipmentFamilies", id: family.id, label: family.name };
  const params = family.parameters;
  const value: Derivation = {
    value: adjustments?.value ?? calculated.value, computed: calculated.value,
    expression: `max(0, ${linear(params.valueBase, tier.tier, params.valuePerLevel)})`,
    overridden: adjustments?.value !== undefined, source: { ...source, path: "parameters.valuePerLevel" },
  };
  const bonuses = Object.fromEntries(BONUS_KEYS.map(key => {
    const override = adjustments?.bonuses?.[key];
    return [key, {
      value: override ?? calculated.bonuses[key], computed: calculated.bonuses[key],
      expression: linear(params.bonusesBase[key], tier.tier, params.bonusesPerLevel[key]),
      overridden: override !== undefined, source: { ...source, path: `parameters.bonusesPerLevel.${key}` },
    } satisfies Derivation];
  })) as Record<BonusKey, Derivation>;
  const gatherBonus: Derivation = {
    value: adjustments?.gatherBonus ?? calculated.gatherBonus, computed: calculated.gatherBonus,
    expression: linear(0, tier.tier, params.gatherBonusPerLevel, false),
    overridden: adjustments?.gatherBonus !== undefined, source: { ...source, path: "parameters.gatherBonusPerLevel" },
  };
  return {
    value, bonuses, gatherBonus,
    category: family.category, slot: family.slot ?? "mainHand", skill: family.skill,
    requires: { skill: family.skill, level: tier.reqLevel },
    attackSpeedMs: family.attackSpeedMs, magicWeapon: family.magicWeapon,
  };
}

/** Duration, experience and required level for one production entry, with the template explained. */
export function deriveProductionEntry(tier: Pick<ProgressionTier, "tier" | "reqLevel">, entry: ProductionEntry, template: RecipeTemplate) {
  const calculated = productionStats(tier.tier, template.parameters);
  const adjustments = entry.adjustments;
  const source: DerivationSource = { collection: "recipeTemplates", id: template.id, label: template.name };
  const durationMs: Derivation = {
    value: adjustments?.durationMs ?? calculated.durationMs, computed: calculated.durationMs,
    expression: `${fmt(template.parameters.durationMs)} ms`, overridden: adjustments?.durationMs !== undefined, source: { ...source, path: "parameters.durationMs" },
  };
  const xp: Derivation = {
    value: adjustments?.xp ?? calculated.xp, computed: calculated.xp,
    expression: linear(template.parameters.xpBase, tier.tier, template.parameters.xpPerLevel), overridden: adjustments?.xp !== undefined, source: { ...source, path: "parameters.xpPerLevel" },
  };
  const reqLevel: Derivation = {
    value: adjustments?.reqLevel ?? tier.reqLevel, computed: tier.reqLevel,
    expression: `tier required level`, overridden: adjustments?.reqLevel !== undefined, source: { collection: "progression", id: "", label: "tier", path: "reqLevel" },
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

/** A creature's resolved row (base + variant), its combat block derived from the role curve, and which fields are inherited. */
export function deriveCreature(definition: CreatureDefinition, base: CreatureDefinition | undefined, profile: CreatureProfile | undefined) {
  const row = { ...base, ...definition, adjustments: { ...base?.adjustments, ...definition.adjustments } } as CreatureDefinition & { adjustments: Record<string, unknown> };
  const inherited = base ? Object.keys(base).filter(key => !(key in definition)) : [];
  const level = row.level ?? 1;
  const computed = profile ? calculateCreatureCombat(Math.max(1, Math.floor(level)), profile) as unknown as Record<string, unknown> : {};
  const source: DerivationSource = profile ? { collection: "creatureProfiles", id: profile.id, label: profile.name } : { collection: "creatureProfiles", id: "", label: "role" };
  const combat: Record<string, Derivation<unknown>> = {};
  for (const key of COMBAT_FIELDS) {
    const override = row.adjustments[key];
    combat[key] = {
      value: override ?? computed[key], computed: computed[key],
      expression: profile ? COMBAT_EXPRESSIONS[key]?.(level, profile) ?? "" : "no role",
      overridden: override !== undefined, source: { ...source, path: COMBAT_PARAM[key] },
    };
  }
  // Fields the curve does not set but adjustments can (movement speeds and the like) stay as plain overrides.
  for (const [key, override] of Object.entries(row.adjustments)) {
    if (key in combat || override === undefined) continue;
    combat[key] = { value: override, computed: undefined, expression: "", overridden: true, source };
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
export const typedRows = <T>(rows: readonly ContentRow[]): readonly T[] => rows as unknown as readonly T[];
