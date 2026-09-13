import { expect, it } from "vitest";
import { arr, discriminated, lit, obj, opt, ref } from "../game/src/content/schema/core.js";
import { checkReferences } from "../tools/content/references.js";
import { npcRecordSchema } from "../game/src/content/schema/people.js";
import { audioCatalogSchema } from "../game/src/content/schema/audio.js";

it("reports foreign keys inside optional tagged branches without rejecting absent optional values", () => {
  const schema = obj({ choices: arr(discriminated("kind", {
    item: obj({ kind: lit("item"), id: ref("item") }),
    quest: obj({ kind: lit("quest"), id: opt(ref("quest")) }),
  })) });
  const pools = { item: new Set(["ore"]), quest: new Set(["intro"]) };
  expect(checkReferences(schema, { choices: [{ kind: "item", id: "ore" }, { kind: "quest" }] }, pools, "row")).toEqual([]);
  expect(checkReferences(schema, { choices: [{ kind: "quest", id: "missing" }] }, pools, "row")).toEqual(['row.choices[0].id: unknown quest reference "missing"']);
});

it("checks NPC models, settlements and locations through the production schemas", () => {
  const errors = checkReferences(npcRecordSchema, {
    catalog: "fairy", assetId: "missing-model", settlementId: "missing-town", locationId: "missing-node",
  }, { asset: new Set(), settlement: new Set(), location: new Set() }, "npc");
  expect(errors).toHaveLength(3);
  expect(errors.join("\n")).toContain('unknown asset reference "missing-model"');
  expect(errors.join("\n")).toContain('unknown settlement reference "missing-town"');
  expect(errors.join("\n")).toContain('unknown location reference "missing-node"');
});

it("rejects syntactically valid audio paths absent from the public file pool", () => {
  expect(checkReferences(audioCatalogSchema, { cues: {}, loops: {
    soundtrack: { url: "audio/music/missing.mp3", bus: "music" },
  }, regions: {} }, { asset: new Set(["audio/music/castle.mp3"]) }, "audio"))
    .toEqual(['audio.loops.soundtrack.url: unknown asset reference "audio/music/missing.mp3"']);
});
