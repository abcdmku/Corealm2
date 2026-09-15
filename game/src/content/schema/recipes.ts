import { SKILL_IDS } from "../../contracts.js";
import type { StationKind } from "../../contracts.js";
import type { RecipeDef, RecipeKind } from "../index.js";
import { arr, enumOf, id, int, nullable, num, obj, opt, ref, str, union, type Schema } from "./core.js";

const quantity = () => int({ min: 1 }, { label: "Quantity", step: 1 });
/** Ingredients are consumed together, so their order is presentation only; it is not `ordered`. */
const ingredient = obj({
  itemId: ref("item", { label: "Item", role: "Ingredient of" }),
  quantity: quantity(),
});

export const RecipeSchema = obj({
  id: id(),
  name: str({ nonEmpty: true }, { label: "Name", display: true }),
  kind: enumOf(["smelt", "smith", "cook", "craft", "fletch"] as const satisfies readonly RecipeKind[], { label: "Recipe kind" }),
  skill: enumOf(SKILL_IDS, { label: "Skill", ref: "skill", role: "Uses skill" }),
  reqLevel: int({ min: 1 }, { label: "Required level", step: 1 }),
  tier: int({ min: 0 }, { label: "Tier", step: 1 }),
  stations: nullable(arr(enumOf([
    "furnace", "anvil", "range", "campfire", "crafting_table", "fletching_bench", "essence_altar",
  ] as const satisfies readonly StationKind[], { label: "Station", ref: "station", role: "Made at" }), { minLength: 1 }, { role: "Made at" }),
  { label: "Accepted stations", help: "Null allows production anywhere.", role: "Made at" }),
  inputs: arr(ingredient, {}, { label: "Ingredients", role: "Ingredient of" }),
  output: obj({
    itemId: ref("item", { label: "Item", role: "Made by" }),
    quantity: quantity(),
  }, {}, { label: "Output", role: "Made by" }),
  durationMs: num({ exclusiveMin: 0 }, { label: "Duration", unit: "ms" }),
  xp: int({ min: 0 }, { label: "XP", unit: "xp", step: 1 }),
  burntItemId: opt(ref("item", { role: "Burnt output of" }), { label: "Burnt output", help: "Item produced when cooking fails.", role: "Burnt output of" }),
}) satisfies Schema<RecipeDef>;

export const RecipeRecordSchema = RecipeSchema;
export type RecipeRecord = RecipeDef;
