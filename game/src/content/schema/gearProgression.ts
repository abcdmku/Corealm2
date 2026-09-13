import { EQUIP_SLOTS } from "../../contracts.js";
import { arr, discriminated, enumOf, int, lit, num, obj, opt, refine, str, tuple, union, type Infer, type Schema } from "./core.js";
import { EquipmentBonusesSchema } from "./items.js";

export const PROGRESSION_GEAR_ROLES = ["metal_sword", "wood_shield", "metal_helm", "metal_plate", "metal_greaves",
  "metal_boots", "metal_gauntlets", "wood_wand", "wood_staff", "hide_hood", "hide_robe", "hide_leggings", "hide_boots", "hide_wraps"] as const;
export const PROGRESSION_SPECIAL_ROLES = ["ashseal_guard", "regent_staff", "chainbound_sword", "nightmarshal_plate", "hollowstar_staff"] as const;
const regionalRoles = [...PROGRESSION_GEAR_ROLES, "pickaxe", "hatchet", "rod"] as const;
const wildernessRoles = [...PROGRESSION_GEAR_ROLES, "pickaxe", "hatchet", ...PROGRESSION_SPECIAL_ROLES] as const;

export const GearProgressionDerivationSchema = discriminated("catalog", {
  REGIONAL_TIER_ITEMS: obj({ kind: lit("gearProgression"), catalog: lit("REGIONAL_TIER_ITEMS"),
    ladderTier: union([lit(30), lit(40), lit(60)] as const), role: enumOf(regionalRoles) }),
  WILDERNESS_LOOT_ITEMS: obj({ kind: lit("gearProgression"), catalog: lit("WILDERNESS_LOOT_ITEMS"),
    ladderTier: union([lit(50), lit(70)] as const), role: enumOf(wildernessRoles) }),
});

const scalar = num();
const value = int({ min: 0 });
const positive = num({ exclusiveMin: 0 });
const pair = tuple([scalar, scalar] as const);
const valuePair = tuple([value, value] as const);
const valueTriple = tuple([value, value, value] as const);
const tier = int({ min: 1 });
function sparseBonuses<T>(field: Schema<T>) {
  return obj({ meleeAccuracy: opt(field), meleePower: opt(field), defence: opt(field),
    magicAccuracy: opt(field), magicPower: opt(field), health: opt(field), vitality: opt(field) });
}
const regionalStats = sparseBonuses(scalar);
const wildernessStat = union([obj({ pair }), obj({ maxPairs: tuple([pair, pair] as const) })] as const);
const specialStat = union([obj({ value: scalar }), obj({ max: pair })] as const);
const identityFields = {
  role: enumOf(PROGRESSION_GEAR_ROLES), family: enumOf(["metal", "wood", "hide"] as const),
  suffix: str({ nonEmpty: true }), slot: enumOf(EQUIP_SLOTS), skill: enumOf(["melee", "magic"] as const),
  weapon: opt(enumOf(["sword", "wand", "staff"] as const)),
};
const regionalGear = obj({ ...identityFields, values: valueTriple, stats: tuple([regionalStats, regionalStats, regionalStats] as const) });
const wildernessGear = obj({ ...identityFields, values: valuePair, stats: sparseBonuses(wildernessStat) });
const toolFields = { family: enumOf(["metal", "wood"] as const), skill: enumOf(["mining", "woodcutting", "fishing"] as const) };
const regionalTool = obj({ ...toolFields, role: enumOf(["pickaxe", "hatchet", "rod"] as const), values: valueTriple });
const wildernessTool = obj({ ...toolFields, role: enumOf(["pickaxe", "hatchet"] as const), values: valuePair });
const special = obj({ role: enumOf(PROGRESSION_SPECIAL_ROLES), tier: int({ min: 1 }),
  slot: enumOf(EQUIP_SLOTS), skill: enumOf(["melee", "magic"] as const), value,
  weapon: opt(enumOf(["sword", "wand", "staff"] as const)), stats: sparseBonuses(specialStat) });

function completeRoles<T extends { role: string }>(schema: Schema<T>, roles: readonly string[]) {
  return refine(arr(schema, { minLength: roles.length, maxLength: roles.length }),
    rows => new Set(rows.map(row => row.role)).size === roles.length && roles.every(role => rows.some(row => row.role === role)),
    "Each original progression role must appear exactly once");
}

/** Original generator checkpoints and operands, independent of generated item records. */
export const GearProgressionBalanceSchema = obj({
  bonusDefaults: EquipmentBonusesSchema,
  weaponProfiles: obj({
    sword: obj({ attackSpeedMs: positive }),
    wand: obj({ attackSpeedMs: positive, hands: union([lit(1), lit(2)] as const) }),
    staff: obj({ attackSpeedMs: positive, hands: union([lit(1), lit(2)] as const) }),
  }),
  regional: obj({
    checkpointTiers: refine(tuple([tier, tier, tier] as const), ([low, high, deep]) => low < high && high < deep, "Checkpoint tiers must increase"),
    gear: completeRoles(regionalGear, PROGRESSION_GEAR_ROLES),
    tools: completeRoles(regionalTool, ["pickaxe", "hatchet", "rod"]),
  }),
  wilderness: obj({
    tiers: refine(tuple([tier, tier] as const), ([shallow, deep]) => shallow < deep, "Wilderness tiers must increase"),
    gear: completeRoles(wildernessGear, PROGRESSION_GEAR_ROLES),
    tools: completeRoles(wildernessTool, ["pickaxe", "hatchet"]),
    specialGear: completeRoles(special, PROGRESSION_SPECIAL_ROLES),
  }),
});

export type GearProgressionDerivation = Infer<typeof GearProgressionDerivationSchema>;
export type GearProgressionBalance = Infer<typeof GearProgressionBalanceSchema>;
