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
const skill = enumOf(SKILL_IDS, { ref: "skill", label: "Skill" });
const level = int({ min: 1 }, { label: "Level", step: 1 });
const quantity = int({ min: 1 }, { label: "Quantity", step: 1 });
const count = int({ min: 1 }, { label: "Count", step: 1 });
const stageIndex = int({ min: 0 }, { label: "Stage index", readOnly: true, identity: true });
const radius = num({ exclusiveMin: 0 }, { label: "Radius", unit: "m" });
const entityId = ref("entity", { label: "Entity id", help: "World entity identifier." });
const locationId = ref("location", { label: "Location id", help: "Route-graph location identifier." });
const enemyFamily = ref("enemyFamily", { label: "Enemy family", help: "Enemy family counted by combat events." });
const skillXp = rec(num({ min: 0 }, { unit: "xp" }), skill, { label: "Skill XP" });
const itemStack = obj({ itemId: ref("item"), quantity });
const worldState = obj({ entityId, state: name, lockedReason: opt(text) });

/** Recursive predicates remain tagged at every depth for precise diagnostics and editor forms. */
export const questPredicateSchema: Schema<QuestPredicate> = lazy(() => discriminated("kind", {
  talk: obj({ kind: lit("talk"), npcId: ref("npc"), dialogueNodeId: ref("dialogue") }),
  have: obj({ kind: lit("have"), itemId: ref("item"), quantity, orAwakenedAltarId: opt(entityId) }),
  banked: obj({ kind: lit("banked"), itemId: ref("item"), quantity }),
  equipped: obj({ kind: lit("equipped"), itemId: ref("item") }),
  kill: obj({ kind: lit("kill"), enemyFamily, count }),
  gather: obj({ kind: lit("gather"), itemId: ref("item"), count }),
  produce: obj({ kind: lit("produce"), recipeId: ref("recipe"), count }),
  deplete: obj({ kind: lit("deplete"), itemId: ref("item"), count }),
  reach: obj({ kind: lit("reach"), locationId, radius: opt(radius) }),
  visit: obj({ kind: lit("visit"), locationId, radius: opt(radius) }),
  nearEntity: obj({ kind: lit("nearEntity"), entityId, radius: opt(radius) }),
  traverse: obj({ kind: lit("traverse"), obstacleId: entityId }),
  entityState: obj({ kind: lit("entityState"), entityId, state: name }),
  skill: obj({ kind: lit("skill"), skill, level }),
  flag: obj({ kind: lit("flag"), flag: name, value: opt(bool()) }),
  counter: obj({ kind: lit("counter"), counter: name, atLeast: int({ min: 0 }) }),
  all: obj({ kind: lit("all"), of: arr(questPredicateSchema, { minLength: 1 }) }),
}));

export const questGrantSchema = obj({
  xp: opt(skillXp),
  items: opt(arr(itemStack)),
  takeItems: opt(arr(itemStack)),
  currency: opt(int({ min: 0 }, { label: "Marks" })),
  flags: opt(arr(name)),
  worldState: opt(arr(worldState)),
  unlocks: opt(arr(text)),
});

export const questObjectiveRefSchema = discriminated("kind", {
  item: obj({ kind: lit("item"), id: ref("item") }),
  entity: obj({ kind: lit("entity"), id: entityId }),
  location: obj({ kind: lit("location"), id: locationId }),
  enemyFamily: obj({ kind: lit("enemyFamily"), id: enemyFamily }),
  recipe: obj({ kind: lit("recipe"), id: ref("recipe") }),
  spell: obj({ kind: lit("spell"), id: SpellSchema.fields.id.describe({ ref: "spell", readOnly: false, identity: false }) }),
});

export const questStageSchema = obj({
  index: stageIndex,
  objective: text,
  refs: opt(arr(questObjectiveRefSchema)),
  hint: text,
  completion: questPredicateSchema,
  grants: opt(questGrantSchema),
  onFlag: opt(arr(obj({ flag: name, grant: questGrantSchema }))),
});

export const questSchema = obj({
  id: id(),
  name,
  regionId: enumOf([
    "fallowmarch", "vellenwood", "karrowmoor", "kilnhalt", "wilderness", "gravelmaw",
    "crownward", "gloamgarden", "faeholme",
  ] as const, { ref: "region", label: "Region" }),
  kind: enumOf(["local", "skill", "puzzle", "dungeon", "chain"] as const),
  summary: text,
  giverNpcId: ref("npc", { label: "Quest giver" }),
  requirements: rec(level, skill),
  prerequisiteQuestIds: arr(ref("quest")),
  onStart: opt(questGrantSchema),
  stages: arr(questStageSchema, { minLength: 1 }, { help: "Stages in journal and progression order." }),
  rewards: obj({
    xp: skillXp,
    items: arr(itemStack),
    currency: int({ min: 0 }, { label: "Marks" }),
    unlocks: arr(text),
    worldState: opt(arr(worldState)),
  }),
});

const reason = str({}, { label: "Disabled reason", multiline: true, help: "Why this condition blocks the option. Hidden branches may use an empty reason." });
const questId = ref("quest");
const bound = int({ min: 0 });
export const dialogueConditionSchema = discriminated("kind", {
  questStatus: obj({ kind: lit("questStatus"), questId, status: enumOf(["unstarted", "active", "complete"] as const), reason }),
  questStage: obj({ kind: lit("questStage"), questId, min: opt(bound), max: opt(bound), reason }),
  questFlag: obj({ kind: lit("questFlag"), questId, flag: name, value: opt(bool()), reason }),
  questCounter: obj({ kind: lit("questCounter"), questId, counter: name, min: opt(int()), max: opt(int()), reason }),
  questOffer: obj({ kind: lit("questOffer"), questId, reason }),
  skill: obj({ kind: lit("skill"), skill, level, reason }),
  item: obj({ kind: lit("item"), itemId: ref("item"), quantity, reason }),
  lacksItem: obj({ kind: lit("lacksItem"), itemId: ref("item"), quantity, reason }),
  currency: obj({ kind: lit("currency"), amount: int({ min: 0 }, { label: "Marks" }), reason }),
});

export const dialogueEffectSchema = discriminated("kind", {
  startQuest: obj({ kind: lit("startQuest"), questId }),
  setFlag: obj({ kind: lit("setFlag"), questId, flag: name, value: opt(bool()) }),
  bumpCounter: obj({ kind: lit("bumpCounter"), questId, counter: name, by: opt(int()) }),
  giveItem: obj({ kind: lit("giveItem"), itemId: ref("item"), quantity }),
  takeItem: obj({ kind: lit("takeItem"), itemId: ref("item"), quantity }),
  grantXp: obj({ kind: lit("grantXp"), skill, amount: num({ min: 0 }, { unit: "xp" }) }),
  grantCurrency: obj({ kind: lit("grantCurrency"), amount: int({ min: 0 }, { label: "Marks" }) }),
});

const conditions = arr(dialogueConditionSchema);
const nextNode = nullable(ref("dialogue"), { label: "Next node", help: "Null ends the conversation." });
export const dialogueOptionSchema = obj({
  id: id({ label: "Option id" }),
  text,
  showIf: opt(conditions, { help: "All conditions must hold for this option to appear." }),
  requires: opt(conditions, { help: "Failed conditions disable the option and display their reasons." }),
  effects: opt(arr(dialogueEffectSchema)),
  nextIf: opt(arr(obj({ when: conditions, next: nextNode })), { help: "First matching branch wins." }),
  next: nextNode,
});

export const dialogueNodeSchema = obj({
  id: id(),
  speaker: opt(name, { help: "Defaults to the NPC name." }),
  text,
  variants: opt(arr(obj({ when: conditions, text })), { help: "First matching variant replaces the node text." }),
  options: arr(dialogueOptionSchema, { minLength: 1 }),
});

export const dialogueRecordSchema = dialogueNodeSchema.extend({
  catalog: enumOf(["base", "fairy"] as const, { readOnly: true, help: "Source collection used to rebuild aggregate exports." }),
});
