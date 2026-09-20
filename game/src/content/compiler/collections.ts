import { parseCollection, parseValue, type Schema } from "../schema/core.js";
import { npcRecordSchema, shopSchema } from "../schema/people.js";
import { questSchema, dialogueRecordSchema } from "../schema/story.js";
import { SpellRecordSchema, SpellRuneSchema, ElementalSpellSchema } from "../schema/spells.js";
import { audioCatalogSchema } from "../schema/audio.js";
import { BALANCE_SCHEMAS } from '../schema/balance.js';
import { WorldRegionSchema } from '../schema/worldRegions.js';
import { ItemRecordSchema } from "../schema/itemRecords.js";
import { RecipeRecordSchema } from "../schema/recipes.js";
import { ResourceRecordSchema } from "../schema/resources.js";
import { ProgressionTierSchema, MaterialSchema, EquipmentFamilySchema, RecipeTemplateSchema } from "../schema/progression.js";
import { EquipmentSetRecordSchema } from "../schema/equipmentSets.js";

import { CampfireFuelRecordSchema } from "../schema/campfireFuels.js";
import { CreatureDefinitionSchema, CreatureProfileSchema } from '../schema/creatureDefinitions.js';
import { EncounterDefinitionSchema, WorldPlacementSchema, ResourcePlacementSchema } from '../schema/encounters.js';
import { LootTableSchema } from '../schema/loot.js';

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
