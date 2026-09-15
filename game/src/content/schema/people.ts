import type { RegionId } from "../../contracts.js";
import { arr, discriminated, enumOf, id, int, lit, num, obj, ref, str } from "./core.js";

export const shopSchema = obj({
  id: id(),
  name: str({ nonEmpty: true }, { label: "Name", display: true }),
  buyMultiplier: num({ min: 0 }, { label: "Buy multiplier", help: "Multiplies item value when the player buys.", group: "prices" }),
  sellMultiplier: num({ min: 0 }, { label: "Sell multiplier", help: "Multiplies item value when the player sells.", group: "prices" }),
  stock: arr(obj({
    itemId: ref("item", { label: "Item", role: "Sold at" }),
    quantity: int({ min: 0 }, { label: "Quantity" }),
  }), {}, { label: "Stock", role: "Sold at" }),
});

export const npcSchema = obj({
  id: id(),
  name: str({ nonEmpty: true }, { label: "Name", display: true }),
  regionId: enumOf([
    "fallowmarch", "vellenwood", "karrowmoor", "kilnhalt", "wilderness", "gravelmaw", "crownward", "gloamgarden", "faeholme",
  ] as const satisfies readonly RegionId[], { label: "Region", ref: "region", role: "Lives in" }),
  settlementId: ref("settlement", { label: "Settlement", help: "Settlement id from region data.", role: "Lives in" }),
  role: str({ nonEmpty: true }, { label: "Role", multiline: true }),
  voice: str({ nonEmpty: true }, { label: "Voice", multiline: true }),
  dialogueRootId: ref("dialogue", { label: "Dialogue root", role: "Speaks" }),
  questIds: arr(ref("quest", { label: "Quest", role: "Offers" }), {}, { label: "Quests", help: "Quests in the order they should be offered.", role: "Offers", ordered: true }),
  locationId: ref("location", { label: "Location", help: "Nearest route graph node.", role: "Stands at" }),
});

export const fairyNpcSchema = npcSchema.extend({
  assetId: ref("asset", { label: "Model", role: "Model for" }),
  bindHeightMetres: num({ exclusiveMin: 0 }, { label: "Bind height", unit: "m" }),
});

export const npcRecordSchema = discriminated("catalog", {
  base: npcSchema.extend({ catalog: lit("base", { hidden: true }) }),
  fairy: fairyNpcSchema.extend({ catalog: lit("fairy", { hidden: true }) }),
});
