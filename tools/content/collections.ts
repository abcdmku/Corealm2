import { parseCollection, parseValue, type Schema } from "../../game/src/content/schema/core.js";
import { npcRecordSchema, shopSchema } from "../../game/src/content/schema/people.js";
import { questSchema, dialogueRecordSchema } from "../../game/src/content/schema/story.js";
import { SpellRecordSchema, SpellRuneSchema, ElementalSpellSchema } from "../../game/src/content/schema/spells.js";
import { audioCatalogSchema } from "../../game/src/content/schema/audio.js";
import { BALANCE_SCHEMAS } from "../../game/src/content/schema/balance.js";

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
  collection("shops", shopSchema), collection("npcs", npcRecordSchema),
  collection("quests", questSchema), collection("dialogue", dialogueRecordSchema),
  collection("spells", SpellRecordSchema), collection("spellRunes", SpellRuneSchema, "itemId"),
  collection("elementalSpells", ElementalSpellSchema),
  { name: "audio", file: "data/audio/catalog.json", schema: audioCatalogSchema, shape: "object", idKey: "id" },
  ...Object.entries(BALANCE_SCHEMAS).map(([kind, schema]): ContentCollection => ({ name: `balance/${kind}`, file: `data/balance/${kind}.json`, schema, shape: "object", idKey: "id" })),
];

export function parseContentCollection(spec: ContentCollection, raw: unknown): unknown {
  return spec.shape === "array"
    ? parseCollection(spec.schema, raw, { name: spec.name, idKey: spec.idKey })
    : parseValue(spec.schema, raw, spec.name);
}
