/** Runtime schema for the complete gathering and production ladder rows. */
import { SKILL_IDS, SPELL_ELEMENTS } from "../../contracts.js";
import type { GatheringProductionTierDef } from "../index.js";
import {
  arr, enumOf, int, obj, opt, ref, str, type Schema,
} from "./core.js";

const skill = enumOf(SKILL_IDS, { label: "Skill", ref: "skill" });
const element = enumOf(SPELL_ELEMENTS, { label: "Element", ref: "element" });

const resourceLinksSchema = obj({
  mining: arr(ref("resource", { label: "Mining resource" }), { minLength: 1 }, { label: "Mining" }),
  fishing: ref("resource", { label: "Fishing resource" }),
  woodcutting: ref("resource", { label: "Woodcutting resource" }),
}, {}, { label: "Resource links" });

const tierItemsSchema = obj({
  ore: ref("item"),
  flux: ref("item"),
  gem: ref("item"),
  bar: ref("item"),
  log: ref("item"),
  shaft: ref("item"),
  handle: ref("item"),
  hide: ref("item"),
  rawFish: ref("item"),
  cookedFish: ref("item"),
  burntFish: ref("item"),
  rawMeat: ref("item"),
  cookedMeat: ref("item"),
  burntMeat: ref("item"),
  dagger: ref("item"),
  sword: ref("item"),
  helm: ref("item"),
  body: ref("item"),
  legs: ref("item"),
  boots: ref("item"),
  gloves: ref("item"),
  pickaxe: ref("item"),
  hatchet: ref("item"),
  staff: ref("item"),
  wand: ref("item"),
  rod: ref("item"),
  shield: ref("item"),
  hood: ref("item"),
  robe: ref("item"),
  magicLegs: ref("item"),
  magicBoots: ref("item"),
  wraps: ref("item"),
}, {}, { label: "Production items" });

const magicSchema = obj({
  element,
  essence: ref("item", { label: "Essence" }),
  orb: ref("item", { label: "Orb" }),
  staff: ref("item", { label: "Staff" }),
  wand: ref("item", { label: "Wand" }),
  basicStaff: opt(ref("item", { label: "Basic staff" })),
  basicWand: opt(ref("item", { label: "Basic wand" })),
}, {}, { label: "Elemental magic" });

/** JSON row shape; resource definitions are shared with the resources collection by id. */
export type GatheringTierRecord = Omit<GatheringProductionTierDef, "resourceDefs" | "campfire"> & {
  resourceDefIds: readonly string[];
  campfireFuelId: string;
};

/** One complete gathering/production unlock row, keyed by its numeric tier. */
export const GatheringTierSchema = obj({
  tier: int({ min: 1 }, { label: "Tier", readOnly: true, identity: true, step: 1 }),
  reqLevel: int({ min: 1 }, { label: "Required level", unit: "level", step: 1 }),
  metalName: str({ nonEmpty: true }, { label: "Metal name" }),
  woodName: str({ nonEmpty: true }, { label: "Wood name" }),
  resources: resourceLinksSchema,
  resourceDefIds: arr(ref("resource", { label: "Resource" }), { minLength: 3 }, { label: "Resource definitions" }),
  items: tierItemsSchema,
  magic: magicSchema,
  smelting: obj({
    orePerBar: int({ min: 1 }, { label: "Ore per bar", step: 1 }),
    fluxPerBar: int({ min: 1 }, { label: "Flux per bar", step: 1 }),
  }, {}, { label: "Smelting" }),
  campfireFuelId: ref("campfireFuel", { label: "Campfire fuel", readOnly: true }),
}) satisfies Schema<GatheringTierRecord>;
