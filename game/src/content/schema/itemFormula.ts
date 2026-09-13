import { arr, discriminated, enumOf, int, lit, num, obj, opt, ref, refine, tuple, union, type Infer } from "./core.js";
import { ElementalWeaponChargeSchema, EquipmentBonusesSchema } from "./items.js";

export const BOSS_FORMULA_SLOTS = ["head", "body", "legs", "hands", "feet"] as const;
const slot = enumOf(BOSS_FORMULA_SLOTS);
const element = enumOf(["wind", "earth", "water", "fire"] as const);
export const ItemFormulaDerivationSchema = discriminated("variant", {
  bossArmor: obj({ kind: lit("itemFormula"), variant: lit("bossArmor"), setId: ref("set"), slot }),
  elemental: obj({ kind: lit("itemFormula"), variant: lit("elemental"), element, weapon: enumOf(["wand", "staff"] as const) }),
  baseTool: obj({ kind: lit("itemFormula"), variant: lit("baseTool"), toolId: ref("item") }),
});

const scalar = num();
const positive = num({ exclusiveMin: 0 });
const tier = int({ min: 1 });
const bonusExpression = union([obj({ value: scalar }), obj({ max: tuple([scalar, scalar] as const) })] as const);
const sparseBonuses = obj({ meleeAccuracy: opt(bonusExpression), meleePower: opt(bonusExpression),
  defence: opt(bonusExpression), magicAccuracy: opt(bonusExpression), magicPower: opt(bonusExpression),
  health: opt(bonusExpression), vitality: opt(bonusExpression) });
const baseline = obj({ slot, low: sparseBonuses, high: sparseBonuses });
const baselines = refine(arr(baseline, { minLength: 5, maxLength: 5 }),
  rows => new Set(rows.map(row => row.slot)).size === BOSS_FORMULA_SLOTS.length, "Every original boss armor slot must appear once");
const set = obj({ id: ref("set"), style: enumOf(["melee", "magic"] as const), tier,
  slots: refine(arr(slot, { minLength: 1, maxLength: 5 }), slots => new Set(slots).size === slots.length, "Set slots must be unique") });
const baseWeapon = obj({ id: ref("item"),
  magicWeapon: obj({ kind: enumOf(["wand", "staff"] as const), hands: union([lit(1), lit(2)] as const) }) });
const profile = obj({ element, bases: obj({ wand: ref("item"), staff: ref("item") }),
  outputs: obj({ wand: ref("item"), staff: ref("item") }),
  charge: ElementalWeaponChargeSchema, addedBonuses: sparseBonuses });
const tool = obj({ id: ref("item"), tier, skill: enumOf(["mining", "woodcutting", "fishing"] as const) });

/** Boss checkpoints, chargedWeapon() references/metadata and authored base-tool identities. */
export const ItemFormulaBalanceSchema = refine(obj({
  bonusDefaults: EquipmentBonusesSchema,
  bossArmor: obj({ baselineTiers: refine(tuple([tier, tier] as const), ([low, high]) => low < high, "Boss baseline tiers must increase"),
    extrapolatedTier: tier, premium: positive,
    valuePerTier: obj({ head: positive, body: positive, legs: positive, hands: positive, feet: positive }),
    baselines: obj({ melee: baselines, magic: baselines }),
    sets: refine(arr(set, { minLength: 6, maxLength: 6 }), rows => new Set(rows.map(row => row.id)).size === rows.length, "Boss sets must be unique") }),
  elemental: obj({ additiveDefault: scalar,
    baseWeapons: refine(arr(baseWeapon, { minLength: 8, maxLength: 8 }), rows => new Set(rows.map(row => row.id)).size === rows.length, "Elemental bases must be unique"),
    profiles: refine(arr(profile, { minLength: 4, maxLength: 4 }), rows => new Set(rows.map(row => row.element)).size === rows.length, "Elemental profiles must be unique") }),
  baseTools: refine(arr(tool, { minLength: 12, maxLength: 12 }), rows => new Set(rows.map(row => row.id)).size === rows.length, "Base tools must be unique"),
}), params => params.bossArmor.extrapolatedTier > params.bossArmor.baselineTiers[1]
  && params.bossArmor.sets.every(set => [...params.bossArmor.baselineTiers, params.bossArmor.extrapolatedTier].includes(set.tier))
  && params.elemental.profiles.every(profile => profile.element === profile.charge.element
    && (["wand", "staff"] as const).every(kind => params.elemental.baseWeapons.some(base => base.id === profile.bases[kind] && base.magicWeapon.kind === kind))),
"Boss tiers and elemental base/charge references must match their authored profiles");

export type ItemFormulaDerivation = Infer<typeof ItemFormulaDerivationSchema>;
export type ItemFormulaBalance = Infer<typeof ItemFormulaBalanceSchema>;
