import { arr, discriminated, enumOf, int, lit, num, obj, ref, refine, tuple, type Infer, type Schema } from "./core.js";

/**
 * Item derivations whose values or food effects came from the original material/food builders.
 * The tag records only the source identity. Numeric operands stay in the balance tables.
 */
const itemRef = ref("item", { readOnly: true, identity: true });
const tier = int({ min: 1 }, { readOnly: true, identity: true, step: 1 });

const cookedFood = obj({
  kind: lit("materialFood", { readOnly: true }),
  variant: lit("cookedFood", { readOnly: true }),
  itemId: itemRef,
  rawItemId: itemRef,
});

const creatureMaterial = obj({
  kind: lit("materialFood", { readOnly: true }),
  variant: lit("creatureMaterial", { readOnly: true }),
  itemId: itemRef,
  tier,
});

const regionalMaterialTag = obj({
  kind: lit("materialFood", { readOnly: true }),
  variant: lit("regionalMaterial", { readOnly: true }),
  itemId: itemRef,
  tier,
  role: enumOf(["ore", "bar", "hide", "thread", "handle"] as const, { readOnly: true, identity: true }),
});

/** A strict tagged union for the three source formulas. */
export const MaterialFoodDerivationSchema = discriminated("variant", {
  cookedFood,
  creatureMaterial,
  regionalMaterial: regionalMaterialTag,
}) satisfies Schema<
  | { kind: "materialFood"; variant: "cookedFood"; itemId: string; rawItemId: string }
  | { kind: "materialFood"; variant: "creatureMaterial"; itemId: string; tier: number }
  | { kind: "materialFood"; variant: "regionalMaterial"; itemId: string; tier: number; role: "ore" | "bar" | "hide" | "thread" | "handle" }
>;

export type MaterialFoodDerivation = Infer<typeof MaterialFoodDerivationSchema>;

const positiveInt = int({ min: 1 });
const value = int({ min: 0 });
const multiplier = num({ exclusiveMin: 0 });
const catalog = enumOf(["ITEMS", "CROWNWARD_FISH_ITEMS"] as const);

/** Raw-to-cooked identities. The shared multiplier below applies only to Crownward rows. */
const cookedFoodIdentity = obj({ itemId: ref("item"), rawItemId: ref("item"), catalog });
const cookedFoods = refine(arr(cookedFoodIdentity, { minLength: 11, maxLength: 11 }), rows => {
  const ids = new Set(rows.map(row => row.itemId));
  const rawIds = new Set(rows.map(row => row.rawItemId));
  return ids.size === rows.length && rawIds.size === rows.length
    && rows.filter(row => row.catalog === "ITEMS").length === 8
    && rows.filter(row => row.catalog === "CROWNWARD_FISH_ITEMS").length === 3;
}, "cooked food targets must be unique and contain eight base plus three Crownward rows");

const checkpointTiers = refine(tuple([positiveInt, positiveInt, positiveInt] as const), ([low, high, deep]) => {
  return low < high && high < deep;
}, "regional material checkpoint tiers must increase");

const role = enumOf(["ore", "bar", "hide", "thread", "handle"] as const);
const regionalMaterialValues = refine(arr(obj({ role, values: tuple([value, value, value] as const) }), { minLength: 5, maxLength: 5 }), rows => {
  const roles = new Set(rows.map(row => row.role));
  return roles.size === rows.length && roles.size === 5;
}, "regional material roles must be unique");
const regionalMaterialIdentity = obj({ itemId: ref("item"), role });
const regionalMaterialIdentities = refine(arr(regionalMaterialIdentity, { minLength: 15, maxLength: 15 }), rows => {
  const ids = new Set(rows.map(row => row.itemId));
  return ids.size === rows.length;
}, "regional material item ids must be unique");

/**
 * Inputs extracted from the original cooked-food and regional-material builders.
 * Creature material prices deliberately come from the existing loot balance table so there is
 * one authority for the four tier values.
 */
export const MaterialFoodBalanceSchema = obj({
  cookedValueMultiplier: multiplier,
  cookedFoods,
  regional: obj({ checkpointTiers, values: regionalMaterialValues, identities: regionalMaterialIdentities }),
});

export type MaterialFoodBalance = Infer<typeof MaterialFoodBalanceSchema>;

// Lower-case aliases match the existing balance schema naming convention and keep imports clear
// for tools that register schemas by file name.
export const materialFoodDerivationSchema = MaterialFoodDerivationSchema;
export const materialFoodBalanceSchema = MaterialFoodBalanceSchema;
