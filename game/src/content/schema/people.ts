import type { RegionId } from "../../contracts.js";
import { arr, discriminated, enumOf, id, int, lit, num, obj, ref, str } from "./core.js";

export const shopSchema = obj({
  id: id(),
  name: str({ nonEmpty: true }, { label: "Name" }),
  buyMultiplier: num({ min: 0 }, { label: "Buy multiplier", help: "Multiplies item value when the player buys." }),
  sellMultiplier: num({ min: 0 }, { label: "Sell multiplier", help: "Multiplies item value when the player sells." }),
  stock: arr(obj({
    itemId: ref("item", { label: "Item" }),
    quantity: int({ min: 0 }, { label: "Quantity" }),
  }), {}, { label: "Stock" }),
});

export const npcSchema = obj({
  id: id(),
  name: str({ nonEmpty: true }, { label: "Name" }),
  regionId: enumOf([
    "fallowmarch", "vellenwood", "karrowmoor", "kilnhalt", "wilderness", "gravelmaw", "crownward", "gloamgarden", "faeholme",
  ] as const satisfies readonly RegionId[], { label: "Region", ref: "region" }),
  settlementId: ref("settlement", { label: "Settlement", help: "Settlement id from region data." }),
  role: str({ nonEmpty: true }, { label: "Role", multiline: true }),
  voice: str({ nonEmpty: true }, { label: "Voice", multiline: true }),
  dialogueRootId: ref("dialogue", { label: "Dialogue root" }),
  questIds: arr(ref("quest"), {}, { label: "Quests", help: "Quests in the order they should be offered." }),
  locationId: ref("location", { label: "Location", help: "Nearest route graph node." }),
});

export const fairyNpcSchema = npcSchema.extend({
  assetId: ref("asset", { label: "Model" }),
  bindHeightMetres: num({ exclusiveMin: 0 }, { label: "Bind height", unit: "m" }),
});

export const npcRecordSchema = discriminated("catalog", {
  base: npcSchema.extend({ catalog: lit("base", { hidden: true }) }),
  fairy: fairyNpcSchema.extend({ catalog: lit("fairy", { hidden: true }) }),
});
