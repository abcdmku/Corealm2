import { parseCollection, parseValue, type Schema } from "../../game/src/content/schema/core.js";
import { npcRecordSchema, shopSchema } from "../../game/src/content/schema/people.js";
import { questSchema, dialogueRecordSchema } from "../../game/src/content/schema/story.js";
import { SpellRecordSchema, SpellRuneSchema, ElementalSpellSchema } from "../../game/src/content/schema/spells.js";
import { audioCatalogSchema } from "../../game/src/content/schema/audio.js";
import { BALANCE_SCHEMAS } from '../../game/src/content/schema/balance.js';
import { WorldRegionSchema } from '../../game/src/content/schema/worldRegions.js';
import { ItemRecordSchema } from "../../game/src/content/schema/itemRecords.js";
import { RecipeRecordSchema } from "../../game/src/content/schema/recipes.js";
import { ResourceRecordSchema } from "../../game/src/content/schema/resources.js";
import { ProgressionTierSchema, MaterialSchema, EquipmentFamilySchema, RecipeTemplateSchema } from "../../game/src/content/schema/progression.js";
import { EquipmentSetRecordSchema } from "../../game/src/content/schema/equipmentSets.js";

import { CampfireFuelRecordSchema } from "../../game/src/content/schema/campfireFuels.js";
import { CreatureDefinitionSchema, CreatureProfileSchema } from '../../game/src/content/schema/creatureDefinitions.js';
import { EncounterDefinitionSchema, WorldPlacementSchema, ResourcePlacementSchema } from '../../game/src/content/schema/encounters.js';
import { LootTableSchema } from '../../game/src/content/schema/loot.js';

/** The editor, formatter and checker share this registration. Paths are never supplied by HTTP clients. */
export interface ContentCollection {
  name: string;
  file: string;
  schema: Schema;
  shape: "array" | "object";
  idKey: string;
  ordered?: boolean;
}

const collection = (name: string, schema: Schema, idKey = "id"): ContentCollection => ({ name, file: `data/${name}.json`, schema, shape: "array", idKey });
export const CONTENT_COLLECTIONS: readonly ContentCollection[] = [
  collection("items", ItemRecordSchema),
  collection("recipes", RecipeRecordSchema), collection("resources", ResourceRecordSchema),
  collection("progression", ProgressionTierSchema), collection("materials", MaterialSchema), collection("equipmentFamilies", EquipmentFamilySchema), collection("recipeTemplates", RecipeTemplateSchema),
  collection("campfireFuels", CampfireFuelRecordSchema, "logItemId"),
  collection("equipmentSets", EquipmentSetRecordSchema),
  
  collection('creatureDefinitions', CreatureDefinitionSchema), collection('creatureProfiles', CreatureProfileSchema), collection('lootTables', LootTableSchema),
  collection('worldRegions', WorldRegionSchema), collection('encounters', EncounterDefinitionSchema), collection('placements', WorldPlacementSchema), collection('resourcePlacements', ResourcePlacementSchema),
  collection("shops", shopSchema), collection("npcs", npcRecordSchema),
  collection("quests", questSchema), collection("dialogue", dialogueRecordSchema),
  collection("spells", SpellRecordSchema), collection("spellRunes", SpellRuneSchema, "itemId"),
  collection("elementalSpells", ElementalSpellSchema),
  ...Object.entries(BALANCE_SCHEMAS).filter(([kind]) => ['campfires','formation','recipes','sets'].includes(kind)).map(([kind,schema]):ContentCollection=>({name:`balance/${kind}`,file:`data/balance/${kind}.json`,schema,shape:'object',idKey:'id'})),
  { name: "audio", file: "data/audio/catalog.json", schema: audioCatalogSchema, shape: "object", idKey: "id" },
];

export function parseContentCollection(spec: ContentCollection, raw: unknown): unknown {
  return spec.shape === "array"
    ? parseCollection(spec.schema, raw, { name: spec.name, idKey: spec.idKey })
    : parseValue(spec.schema, raw, spec.name);
}
