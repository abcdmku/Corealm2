/** Quest and dialogue shapes shared by the runtime loaders and content editor. */
import { SKILL_IDS } from "../../contracts.js";
import type { QuestPredicate } from "../quests.js";
import { SpellSchema } from "./spells.js";
import {
  arr, bool, discriminated, enumOf, id, int, lazy, lit, nullable, num, obj, opt, rec,
  ref, str, type Schema,
} from "./core.js";

const text = str({}, { multiline: true });
const name = str({ nonEmpty: true });
const skill = enumOf(SKILL_IDS, { ref: "skill", label: "Skill", role: "Uses skill" });
const level = int({ min: 1 }, { label: "Level", step: 1 });
const quantity = int({ min: 1 }, { label: "Quantity", step: 1 });
const count = int({ min: 1 }, { label: "Count", step: 1 });
const stageIndex = int({ min: 0 }, { label: "Stage index", readOnly: true, identity: true });
const radius = num({ exclusiveMin: 0 }, { label: "Radius", unit: "m" });
const entityId = ref("entity", { label: "Entity id", help: "World entity identifier.", role: "Quest target" });
const locationId = ref("location", { label: "Location id", help: "Route-graph location identifier.", role: "Quest location" });
const enemyFamily = ref("enemyFamily", { label: "Enemy family", help: "Enemy family counted by combat events.", role: "Hunted by" });
const skillXp = rec(num({ min: 0 }, { unit: "xp" }), skill, { label: "Skill XP", role: "Trains" });
/** One role per direction: a granted stack reads "Reward of", a consumed one "Taken by". */
const itemStack = (role: string) => obj({ itemId: ref("item", { label: "Item", role }), quantity });
const worldState = obj({ entityId, state: name.describe({ label: "State" }), lockedReason: opt(text, { label: "Locked reason" }) }, {}, { label: "World state" });

/** Recursive predicates remain tagged at every depth for precise diagnostics and editor forms. */
export const questPredicateSchema: Schema<QuestPredicate> = lazy(() => discriminated("kind", {
  talk: obj({ kind: lit("talk"), npcId: ref("npc", { label: "NPC", role: "Talk target of" }), dialogueNodeId: ref("dialogue", { label: "Dialogue node", role: "Talk target of" }) }),
  have: obj({ kind: lit("have"), itemId: ref("item", { label: "Item", role: "Quest item" }), quantity, orAwakenedAltarId: opt(entityId) }),
  banked: obj({ kind: lit("banked"), itemId: ref("item", { label: "Item", role: "Quest item" }), quantity }),
  equipped: obj({ kind: lit("equipped"), itemId: ref("item", { label: "Item", role: "Quest item" }) }),
  kill: obj({ kind: lit("kill"), enemyFamily, count }),
  gather: obj({ kind: lit("gather"), itemId: ref("item", { label: "Item", role: "Quest item" }), count }),
  produce: obj({ kind: lit("produce"), recipeId: ref("recipe", { label: "Recipe", role: "Quest recipe" }), count }),
  deplete: obj({ kind: lit("deplete"), itemId: ref("item", { label: "Item", role: "Quest item" }), count }),
  reach: obj({ kind: lit("reach"), locationId, radius: opt(radius) }),
  visit: obj({ kind: lit("visit"), locationId, radius: opt(radius) }),
  nearEntity: obj({ kind: lit("nearEntity"), entityId, radius: opt(radius) }),
  traverse: obj({ kind: lit("traverse"), obstacleId: entityId.describe({ label: "Obstacle" }) }),
  entityState: obj({ kind: lit("entityState"), entityId, state: name.describe({ label: "State" }) }),
  skill: obj({ kind: lit("skill"), skill, level }),
  flag: obj({ kind: lit("flag"), flag: name.describe({ label: "Flag" }), value: opt(bool(), { label: "Value" }) }),
  counter: obj({ kind: lit("counter"), counter: name.describe({ label: "Counter" }), atLeast: int({ min: 0 }, { label: "At least" }) }),
  // Every member must hold, so `of` is a set of conditions rather than an ordered list.
  all: obj({ kind: lit("all"), of: arr(questPredicateSchema, { minLength: 1 }, { label: "All of", role: "Condition of" }) }),
}));

export const questGrantSchema = obj({
  xp: opt(skillXp),
  items: opt(arr(itemStack("Reward of"), {}, { label: "Items", role: "Reward of" })),
  takeItems: opt(arr(itemStack("Taken by"), {}, { label: "Taken items", role: "Taken by" })),
  currency: opt(int({ min: 0 }, { label: "Marks" })),
  flags: opt(arr(name.describe({ label: "Flag" }), {}, { label: "Flags" })),
  worldState: opt(arr(worldState, {}, { label: "World state", role: "Set by" })),
  unlocks: opt(arr(text, {}, { label: "Unlocks" })),
});

export const questObjectiveRefSchema = discriminated("kind", {
  item: obj({ kind: lit("item"), id: ref("item", { label: "Item", role: "Objective of" }) }),
  entity: obj({ kind: lit("entity"), id: entityId.describe({ role: "Objective of" }) }),
  location: obj({ kind: lit("location"), id: locationId.describe({ role: "Objective of" }) }),
  enemyFamily: obj({ kind: lit("enemyFamily"), id: enemyFamily.describe({ role: "Objective of" }) }),
  recipe: obj({ kind: lit("recipe"), id: ref("recipe", { label: "Recipe", role: "Objective of" }) }),
  spell: obj({ kind: lit("spell"), id: SpellSchema.fields.id.describe({ ref: "spell", readOnly: false, identity: false, role: "Objective of" }) }),
});

export const questStageSchema = obj({
  index: stageIndex,
  objective: text.describe({ label: "Objective" }),
  refs: opt(arr(questObjectiveRefSchema, {}, { label: "Objective refs", role: "Objective of" })),
  hint: text.describe({ label: "Hint" }),
  completion: questPredicateSchema,
  grants: opt(questGrantSchema, { label: "Grants" }),
  onFlag: opt(arr(obj({ flag: name.describe({ label: "Flag" }), grant: questGrantSchema }), {}, { label: "On flag" })),
});

export const questSchema = obj({
  id: id(),
  name: name.describe({ label: "Name", display: true }),
  regionId: enumOf([
    "fallowmarch", "vellenwood", "karrowmoor", "kilnhalt", "wilderness", "gravelmaw",
    "crownward", "gloamgarden", "faeholme",
  ] as const, { ref: "region", label: "Region", role: "Quest in" }),
  kind: enumOf(["local", "skill", "puzzle", "dungeon", "chain"] as const, { label: "Kind" }),
  summary: text.describe({ label: "Summary" }),
  giverNpcId: ref("npc", { label: "Quest giver", role: "Gives" }),
  requirements: rec(level, skill, { label: "Requirements", role: "Required by" }),
  prerequisiteQuestIds: arr(ref("quest", { label: "Quest", role: "Prerequisite of" }), {}, { label: "Prerequisites", role: "Prerequisite of" }),
  onStart: opt(questGrantSchema, { label: "On start" }),
  stages: arr(questStageSchema, { minLength: 1 }, { label: "Stages", help: "Stages in journal and progression order.", ordered: true }),
  rewards: obj({
    xp: skillXp,
    items: arr(itemStack("Reward of"), {}, { label: "Items", role: "Reward of" }),
    currency: int({ min: 0 }, { label: "Marks" }),
    unlocks: arr(text, {}, { label: "Unlocks" }),
    worldState: opt(arr(worldState, {}, { label: "World state", role: "Set by" })),
  }, {}, { label: "Rewards" }),
});

const reason = str({}, { label: "Disabled reason", multiline: true, help: "Why this condition blocks the option. Hidden branches may use an empty reason." });
const questId = ref("quest", { label: "Quest", role: "Mentioned in" });
const bound = int({ min: 0 });
export const dialogueConditionSchema = discriminated("kind", {
  questStatus: obj({ kind: lit("questStatus"), questId, status: enumOf(["unstarted", "active", "complete"] as const, { label: "Status" }), reason }),
  questStage: obj({ kind: lit("questStage"), questId, min: opt(bound, { label: "Min stage" }), max: opt(bound, { label: "Max stage" }), reason }),
  questFlag: obj({ kind: lit("questFlag"), questId, flag: name.describe({ label: "Flag" }), value: opt(bool(), { label: "Value" }), reason }),
  questCounter: obj({ kind: lit("questCounter"), questId, counter: name.describe({ label: "Counter" }), min: opt(int(), { label: "Min" }), max: opt(int(), { label: "Max" }), reason }),
  questOffer: obj({ kind: lit("questOffer"), questId: questId.describe({ role: "Offered in" }), reason }),
  skill: obj({ kind: lit("skill"), skill, level, reason }),
  item: obj({ kind: lit("item"), itemId: ref("item", { label: "Item", role: "Required by" }), quantity, reason }),
  lacksItem: obj({ kind: lit("lacksItem"), itemId: ref("item", { label: "Item", role: "Required by" }), quantity, reason }),
  currency: obj({ kind: lit("currency"), amount: int({ min: 0 }, { label: "Marks" }), reason }),
});

export const dialogueEffectSchema = discriminated("kind", {
  startQuest: obj({ kind: lit("startQuest"), questId: questId.describe({ role: "Started in" }) }),
  setFlag: obj({ kind: lit("setFlag"), questId, flag: name.describe({ label: "Flag" }), value: opt(bool(), { label: "Value" }) }),
  bumpCounter: obj({ kind: lit("bumpCounter"), questId, counter: name.describe({ label: "Counter" }), by: opt(int(), { label: "By" }) }),
  giveItem: obj({ kind: lit("giveItem"), itemId: ref("item", { label: "Item", role: "Given by" }), quantity }),
  takeItem: obj({ kind: lit("takeItem"), itemId: ref("item", { label: "Item", role: "Taken by" }), quantity }),
  grantXp: obj({ kind: lit("grantXp"), skill, amount: num({ min: 0 }, { unit: "xp", label: "Amount" }) }),
  grantCurrency: obj({ kind: lit("grantCurrency"), amount: int({ min: 0 }, { label: "Marks" }) }),
});

// All conditions in one list must hold, so the list itself is unordered.
const conditions = arr(dialogueConditionSchema, {}, { label: "Conditions", role: "Condition of" });
const nextNode = nullable(ref("dialogue", { role: "Reached from" }), { label: "Next node", help: "Null ends the conversation.", role: "Reached from" });
export const dialogueOptionSchema = obj({
  id: id({ label: "Option id" }),
  text: text.describe({ label: "Text", display: true }),
  showIf: opt(conditions, { label: "Show if", help: "All conditions must hold for this option to appear." }),
  requires: opt(conditions, { label: "Requires", help: "Failed conditions disable the option and display their reasons." }),
  effects: opt(arr(dialogueEffectSchema, {}, { label: "Effects", role: "Effect of" })),
  nextIf: opt(arr(obj({ when: conditions, next: nextNode }), {}, { label: "Branches", role: "Reached from", ordered: true }), { help: "First matching branch wins." }),
  next: nextNode,
});

export const dialogueNodeSchema = obj({
  id: id(),
  speaker: opt(name, { label: "Speaker", help: "Defaults to the NPC name." }),
  text: text.describe({ label: "Text", display: true }),
  variants: opt(arr(obj({ when: conditions, text: text.describe({ label: "Text" }) }), {}, { label: "Variants", ordered: true }), { help: "First matching variant replaces the node text." }),
  options: arr(dialogueOptionSchema, { minLength: 1 }, { label: "Options", ordered: true, role: "Option of" }),
});

export const dialogueRecordSchema = dialogueNodeSchema.extend({
  catalog: enumOf(["base", "fairy"] as const, { readOnly: true, label: "Catalog", help: "Source collection used to rebuild aggregate exports." }),
});
