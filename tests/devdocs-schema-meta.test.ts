/**
 * The schema is the source. These assertions run against the real content schemas, not fixtures,
 * so a page can stop hand-declaring labels, units, ref kinds, list semantics and grid grouping.
 */
import { describe, expect, it } from "vitest";
import { SKILL_IDS, SPELL_ELEMENTS } from "../game/src/contracts.js";
import {
  ArraySchema, DiscriminatedSchema, ObjectSchema, RecordSchema, REF_KIND_SOURCES, TupleSchema,
  UnionSchema, type RefKind, type Schema,
} from "../game/src/content/schema/core.js";
import { CONTENT_COLLECTIONS } from "../game/src/content/compiler/collections.js";
import { CreatureDefinitionSchema } from "../game/src/content/schema/creatureDefinitions.js";
import { EncounterDefinitionSchema } from "../game/src/content/schema/encounters.js";
import { EquipmentSetRecordSchema } from "../game/src/content/schema/equipmentSets.js";
import { ItemRecordSchema } from "../game/src/content/schema/itemRecords.js";
import { LootTableSchema } from "../game/src/content/schema/loot.js";
import { npcSchema, shopSchema } from "../game/src/content/schema/people.js";
import { RecipeRecordSchema } from "../game/src/content/schema/recipes.js";
import { CampfireFuelRecordSchema } from "../game/src/content/schema/campfireFuels.js";
import { dialogueRecordSchema, questSchema } from "../game/src/content/schema/story.js";
import { WorldRegionSchema } from "../game/src/content/schema/worldRegions.js";
import { fieldCore, fieldPath, recordLabelKey, serialFieldSpec } from "../devdocs/src/model/fields.js";

const REF_KINDS = [
  "item", "recipe", "resource", "resourceCluster", "enemy", "species", "lootTable",
  "npc", "shop", "quest", "dialogue", "spell", "rune", "set",
  "asset", "audio", "region", "skill", "station", "element",
  "entity", "location", "settlement", "enemyFamily", "campfireFuel",
  "material", "equipmentFamily", "recipeTemplate", "creatureProfile", "encounter",
] as const satisfies readonly RefKind[];

interface FoundRef { path: string; kind: string; role: string | undefined; inArray: boolean }

/** A list "of refs or ref-bearing objects": its item is a reference, or names one directly. */
function bearsRef(item: Schema): boolean {
  if (serialFieldSpec(item).ref) return true;
  const node = fieldCore(item);
  if (node instanceof ObjectSchema) return (Object.values(node.fields) as Schema[]).some(field => !!serialFieldSpec(field).ref);
  if (node instanceof DiscriminatedSchema) return (Object.values(node.members) as Schema[]).some(bearsRef);
  if (node instanceof UnionSchema) return (node.members as readonly Schema[]).some(bearsRef);
  return false;
}

/** Walk every node of a schema once, recording where references and arrays sit. */
function walk(schema: Schema, path: string, inArray: boolean, seen: Set<Schema>, refs: FoundRef[], arrays: FoundRef[]): void {
  if (seen.has(schema)) return;
  seen.add(schema);
  const key = path.split(".").pop()?.replace(/[[\]{}<>\d]/g, "") ?? "";
  const spec = serialFieldSpec(schema, key);
  if (spec.ref) refs.push({ path, kind: spec.ref, role: spec.role, inArray });
  const node = fieldCore(schema);
  if (node instanceof ObjectSchema) for (const [name, field] of Object.entries(node.fields)) walk(field as Schema, path ? `${path}.${name}` : name, inArray, seen, refs, arrays);
  else if (node instanceof ArraySchema) {
    if (bearsRef(node.item)) arrays.push({ path, kind: "", role: spec.role, inArray });
    walk(node.item, `${path}[]`, true, seen, refs, arrays);
  } else if (node instanceof TupleSchema) (node.items as readonly Schema[]).forEach((item, index) => walk(item, `${path}[${index}]`, inArray, seen, refs, arrays));
  else if (node instanceof RecordSchema) walk(node.value, `${path}{}`, inArray, seen, refs, arrays);
  else if (node instanceof DiscriminatedSchema) for (const [name, member] of Object.entries(node.members)) walk(member as Schema, `${path}<${name}>`, inArray, seen, refs, arrays);
  else if (node instanceof UnionSchema) (node.members as readonly Schema[]).forEach((member, index) => walk(member, `${path}<${index}>`, inArray, seen, refs, arrays));
}

function scanCollections(): { refs: FoundRef[]; arrays: FoundRef[] } {
  const refs: FoundRef[] = [];
  const arrays: FoundRef[] = [];
  for (const spec of CONTENT_COLLECTIONS) walk(spec.schema, spec.name, false, new Set(), refs, arrays);
  return { refs, arrays };
}

describe("schema reference sources", () => {
  it("gives every RefKind somewhere to get its options from", () => {
    expect(Object.keys(REF_KIND_SOURCES).sort()).toEqual([...REF_KINDS].sort());
    for (const kind of REF_KINDS) expect(REF_KIND_SOURCES[kind], kind).toBeDefined();
  });

  it("resolves the seven kinds that have no collection of their own", () => {
    expect(REF_KIND_SOURCES.skill).toEqual({ enum: SKILL_IDS });
    expect(REF_KIND_SOURCES.element).toEqual({ enum: SPELL_ELEMENTS });
    expect(REF_KIND_SOURCES.station).toEqual({ derive: "stations" });
    expect(REF_KIND_SOURCES.location).toEqual({ derive: "locations" });
    expect(REF_KIND_SOURCES.settlement).toEqual({ derive: "settlements" });
    expect(REF_KIND_SOURCES.enemyFamily).toEqual({ derive: "enemyFamilies" });
    expect(REF_KIND_SOURCES.entity).toEqual({ derive: "entities" });
  });

  it("stays data only, so the table can cross the wire unchanged", () => {
    expect(JSON.parse(JSON.stringify(REF_KIND_SOURCES))).toEqual(REF_KIND_SOURCES);
  });

  it("uses a kind every real schema reference can resolve", () => {
    const { refs } = scanCollections();
    expect(refs.length).toBeGreaterThan(40);
    const unmapped = refs.filter(found => !(found.kind in REF_KIND_SOURCES));
    expect(unmapped).toEqual([]);
  });
});

describe("schema relationship and list metadata", () => {
  it("gives every reference inside a list the role its target should show it under", () => {
    const { refs } = scanCollections();
    const missing = refs.filter(found => found.inArray && !found.role).map(found => found.path);
    expect(missing).toEqual([]);
  });

  it("gives every list of references a role of its own", () => {
    const { arrays } = scanCollections();
    expect(arrays.length).toBeGreaterThan(10);
    expect(arrays.filter(found => !found.role).map(found => found.path)).toEqual([]);
  });

  it("marks the lists whose order is part of the content", () => {
    expect(fieldPath(questSchema, ["stages"])).toMatchObject({ kind: "array", ordered: true });
    expect(fieldPath(npcSchema, ["questIds"])).toMatchObject({ kind: "array", ordered: true, role: "Offers" });
    expect(fieldPath(dialogueRecordSchema, ["options"])).toMatchObject({ kind: "array", ordered: true });
    expect(fieldPath(EquipmentSetRecordSchema, ["thresholds"])).toMatchObject({ kind: "array", ordered: true });
    // Ingredients are consumed together; their order is presentation only.
    expect(fieldPath(RecipeRecordSchema, ["inputs"])?.ordered).toBeUndefined();
  });

  it("tells a weighted list apart from a list of per-roll probabilities", () => {
    expect(fieldPath(EncounterDefinitionSchema, ["members"])).toMatchObject({ weight: "weight", role: "Spawns as" });
    expect(fieldPath(EncounterDefinitionSchema, ["members"])?.probability).toBeUndefined();
    expect(fieldPath(LootTableSchema, ["rolls", 0, "drops"])).toMatchObject({ probability: "chance", role: "Dropped by" });
    expect(fieldPath(LootTableSchema, ["rolls", 0, "drops"])?.weight).toBeUndefined();
  });

  it("groups the small numbers a sheet draws as one grid", () => {
    expect(fieldPath(CreatureDefinitionSchema, ["adjustments", "armour"])).toMatchObject({ group: "combat" });
    expect(fieldPath(ItemRecordSchema, ["equip", "bonuses", "defence"])).toMatchObject({ group: "bonuses" });
    expect(fieldPath(ItemRecordSchema, ["equip", "requires", "melee"])).toMatchObject({ group: "requirements" });
  });
});

describe("addressing a real schema by path", () => {
  it("reaches a creature adjustment and describes it without the page saying anything", () => {
    const spec = fieldPath(CreatureDefinitionSchema, ["adjustments", "maxHealth"]);
    expect(spec).toMatchObject({ kind: "number", label: "Health", integer: true, min: 1, step: 1, optional: true, group: "combat" });
    expect(spec?.unit).toBeUndefined();
  });

  it("reaches a shop stock line and names the relationship", () => {
    expect(fieldPath(shopSchema, ["stock", 0, "itemId"])).toMatchObject({ kind: "string", label: "Item", ref: "item", role: "Sold at", minLength: 1 });
    expect(fieldPath(shopSchema, ["stock"])).toMatchObject({ kind: "array", label: "Stock", role: "Sold at" });
  });

  it("finds item and table references inside explicit rolls", () => {
    expect(fieldPath(CreatureDefinitionSchema, ["loot", "rolls", 0, "tables", 0, "tableId"])).toMatchObject({ ref: "lootTable", role: "Rolled by" });
    expect(fieldPath(CreatureDefinitionSchema, ["loot", "rolls", 0, "drops", 0, "itemId"])).toMatchObject({ ref: "item", role: "Dropped by" });
  });

  it("returns undefined instead of guessing at a path the schema does not have", () => {
    expect(fieldPath(shopSchema, ["stock", 0, "price"])).toBeUndefined();
    expect(fieldPath(shopSchema, ["nope"])).toBeUndefined();
    expect(fieldPath(shopSchema, ["buyMultiplier", 0])).toBeUndefined();
  });
});

describe("record display names", () => {
  it("reads the marked field, not a guess from the id", () => {
    expect(recordLabelKey(ItemRecordSchema)).toBe("name");
    expect(recordLabelKey(questSchema)).toBe("name");
    expect(recordLabelKey(WorldRegionSchema)).toBe("name");
    expect(recordLabelKey(CreatureDefinitionSchema)).toBe("name");
    // Campfire fuels are keyed by their log item and have no name column at all.
    expect(recordLabelKey(CampfireFuelRecordSchema)).toBe("logItemId");
  });
});
