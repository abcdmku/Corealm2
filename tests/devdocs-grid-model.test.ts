import { describe, expect, it } from "vitest";
import type { Schema } from "../game/src/content/schema/core.js";
import { CONTENT_COLLECTIONS } from "../tools/content/collections.js";
import type { ContentRow } from "../devdocs/src/model/contracts.js";
import { getPath } from "../devdocs/src/model/draft.js";
import { fieldPath } from "../devdocs/src/model/fields.js";
import { createDraftStore, draftKey, type DraftStore } from "../devdocs/src/model/store.js";
import { defaultColumns, defaultVisible, isMixed, settableFields, sortRows, countText } from "../devdocs/src/ui/grid/columns.js";
import { applyEdit, place } from "../devdocs/src/ui/grid/edits.js";
import { HOTKEYS } from "../devdocs/src/ui/grid/hotkeys.js";

/*
  The table's model layer is plain TypeScript: schema in, columns out, and edits applied to the
  draft store the way the grid and the command palette apply them. No React and no DOM, so these
  run against the real content schemas rather than a fixture of them.
*/

const schemaOf = (name: string): Schema => {
  const collection = CONTENT_COLLECTIONS.find(candidate => candidate.name === name);
  if (!collection) throw new Error(`No collection named ${name}`);
  return collection.schema;
};
const creatures = schemaOf("creatureDefinitions");
const profiles = schemaOf("creatureProfiles");

describe("default columns", () => {
  const columns = defaultColumns(creatures);
  const byKey = (key: string) => columns.find(column => column.key === key);

  it("leads with the display name and keeps the id read-only", () => {
    expect(columns[0]?.key).toBe("name");
    expect(columns[0]?.kind).toBe("text");
    expect(columns[0]?.width).toBe(220);
    expect(byKey("id")?.kind).toBe("static");
  });

  it("types scalars and references from the schema", () => {
    expect(byKey("level")?.kind).toBe("number");
    expect(byKey("availability")?.kind).toBe("choice");
    expect(byKey("availability")?.spec.choices).toEqual(["world", "lab"]);
    expect(byKey("profileId")?.kind).toBe("ref");
    expect(byKey("profileId")?.spec.ref).toBe("creatureProfile");
  });

  it("never gives an array, map or union its own editable column", () => {
    expect(byKey("loot")?.kind).toBe("count");
    expect(byKey("presentation")?.kind).toBe("count");
    expect(byKey("adjustments.marks")?.kind).toBe("count");
    // Nothing below a union is flattened into a column; the count cell opens the record instead.
    expect(byKey("loot.tableId")).toBeUndefined();
    expect(byKey("presentation.regionId")).toBeUndefined();
  });

  it("flattens one level of objects with a dotted header", () => {
    expect(byKey("adjustments.maxHealth")?.label).toBe("Adjustments.Health");
    expect(byKey("adjustments.maxHealth")?.kind).toBe("number");
  });

  it("keeps every grouped scalar of a profile as its own number column", () => {
    const keys = defaultColumns(profiles).map(column => column.key);
    expect(keys.slice(0, 3)).toEqual(["name", "id", "role"]);
    for (const key of ["healthPerLevel", "healthBase", "attackMultiplier", "accuracyPerLevel", "attackSpeedMs", "marksPerLevel"]) {
      expect(defaultColumns(profiles).find(column => column.key === key)?.kind).toBe("number");
    }
    expect(defaultColumns(profiles).find(column => column.key === "attackSpeedMs")?.spec.unit).toBe("ms");
  });

  it("opens with the first few columns only", () => {
    expect(defaultVisible(columns)).toHaveLength(8);
    expect(defaultVisible(columns)[0]).toBe("name");
  });
});

describe("cell readings", () => {
  it("reports whether a selection disagrees", () => {
    expect(isMixed([])).toBe(false);
    expect(isMixed(["world"])).toBe(false);
    expect(isMixed(["world", "world"])).toBe(false);
    expect(isMixed(["world", "lab"])).toBe(true);
    expect(isMixed([undefined, undefined])).toBe(false);
    expect(isMixed([undefined, 0])).toBe(true);
    expect(isMixed([{ tableId: "a" }, { tableId: "a" }])).toBe(false);
    expect(isMixed([{ tableId: "a" }, { tableId: "b" }])).toBe(true);
  });

  it("names a union variant and counts an array", () => {
    const loot = fieldPath(creatures, ["loot"])!;
    expect(countText(undefined, loot)).toBe("—");
    expect(countText({ tableId: "goblin" }, loot)).toBe("Table ID");
    expect(countText([1, 2, 3], loot)).toBe("3");
  });

  it("sorts empties last and holds ties in place", () => {
    const rows = [{ n: 2 }, { n: undefined }, { n: 1 }, { n: 1 }];
    expect(sortRows(rows, row => row.n, "asc").map(row => row.n)).toEqual([1, 1, 2, undefined]);
    expect(sortRows(rows, row => row.n, "desc").map(row => row.n)).toEqual([2, 1, 1, undefined]);
  });
});

describe("settable fields", () => {
  const fields = settableFields(creatures, HOTKEYS.filter(hotkey => hotkey.collection === "creatureDefinitions").map(hotkey => hotkey.path));

  it("offers every enum and reference field of the schema", () => {
    const byKey = new Map(fields.map(field => [field.key, field]));
    expect(byKey.get("availability")?.kind).toBe("choice");
    expect(byKey.get("profileId")?.kind).toBe("ref");
    expect(byKey.get("family")?.kind).toBe("ref");
    expect(byKey.has("level")).toBe(false);
    expect(byKey.has("id")).toBe(false);
    expect(byKey.has("name")).toBe(false);
  });

  it("adds the hotkeyed leaves that live inside a union", () => {
    const loot = fields.find(field => field.key === "loot.tableId");
    expect(loot?.kind).toBe("ref");
    expect(loot?.label).toBe("Loot.Loot table");
    expect(fields.find(field => field.key === "presentation.regionId")?.kind).toBe("ref");
  });

  it("offers a hotkeyed number as a typed value", () => {
    const tier = settableFields(schemaOf("items"), [["tier"]]).find(field => field.key === "tier");
    expect(tier?.kind).toBe("value");
    expect(tier?.spec.kind).toBe("number");
  });
});

describe("hotkeys", () => {
  it("names one field per letter per collection", () => {
    const seen = new Set<string>();
    for (const hotkey of HOTKEYS) {
      expect(hotkey.key).toMatch(/^[a-z]$/);
      const id = `${hotkey.collection}:${hotkey.key}`;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });

  it("resolves every path on its collection's real schema", () => {
    for (const hotkey of HOTKEYS) {
      const spec = fieldPath(schemaOf(hotkey.collection), hotkey.path);
      expect(spec, `${hotkey.collection} ${hotkey.path.join(".")}`).toBeDefined();
      expect(spec!.readOnly ?? false).toBe(false);
    }
  });

  it("reaches a field the palette can set", () => {
    for (const hotkey of HOTKEYS) {
      const fields = settableFields(schemaOf(hotkey.collection), [hotkey.path]);
      expect(fields.map(field => field.key), `${hotkey.collection} ${hotkey.path.join(".")}`).toContain(hotkey.path.join("."));
    }
  });
});

describe("applying an edit to a selection", () => {
  const rows: ContentRow[] = [
    { id: "goblin", name: "Goblin", availability: "world", level: 3, loot: { drops: [{ itemId: "coin", chance: 1 }] } },
    { id: "wolf", name: "Wolf", availability: "world", level: 5, loot: { tableId: "wolf_table" } },
    { id: "rat", name: "Rat", availability: "lab", level: 1 },
  ];
  const context = (store: DraftStore) => ({ store, collection: "creatureDefinitions", idKey: "id", revision: "r1", schema: creatures });
  const targets = (ids: readonly string[]) => rows.flatMap(row => ids.includes(String(row.id)) ? [{ id: String(row.id), row }] : []);
  const draftOf = (store: DraftStore, id: string) => store.entry(draftKey("creatureDefinitions", id))?.draft;

  it("writes one commit per record and leaves the rest alone", () => {
    const store = createDraftStore();
    const changed = applyEdit(context(store), targets(["goblin", "wolf", "rat"]), ["availability"], { kind: "set", value: "lab" });
    expect(changed).toBe(2); // "rat" already reads "lab".
    expect(draftOf(store, "goblin")?.availability).toBe("lab");
    expect(draftOf(store, "wolf")?.availability).toBe("lab");
    expect(store.entry(draftKey("creatureDefinitions", "rat"))?.dirty).toBe(false);
    expect(store.dirtyEntries().map(entry => entry.id).sort()).toEqual(["goblin", "wolf"]);

    // One undo step per record, every one labelled with the path, so the shell bar counts records.
    expect(store.undoLabel()).toBe("availability");
    expect(store.undo()?.key).toBe(draftKey("creatureDefinitions", "wolf"));
    expect(store.undo()?.key).toBe(draftKey("creatureDefinitions", "goblin"));
    expect(store.undoLabel()).toBeUndefined();
    expect(store.isDirty()).toBe(false);
  });

  it("keeps the record's own value for a relative edit on a mixed cell", () => {
    const store = createDraftStore();
    const changed = applyEdit(context(store), targets(["goblin", "wolf", "rat"]), ["level"], { kind: "op", op: { kind: "add", value: 1 }, rules: { integer: true, min: 1 } });
    expect(changed).toBe(3);
    expect([draftOf(store, "goblin")?.level, draftOf(store, "wolf")?.level, draftOf(store, "rat")?.level]).toEqual([4, 6, 2]);
  });

  it("replaces an untagged union variant instead of merging both members", () => {
    const store = createDraftStore();
    applyEdit(context(store), targets(["goblin", "wolf"]), ["loot", "tableId"], { kind: "set", value: "shared_table" });
    expect(draftOf(store, "goblin")?.loot).toEqual({ tableId: "shared_table" });
    expect(draftOf(store, "wolf")?.loot).toEqual({ tableId: "shared_table" });
  });

  it("places a leaf without a schema the plain way", () => {
    expect(place({ id: "x", loot: { drops: [] } }, ["loot", "tableId"], "t")).toEqual({ id: "x", loot: { drops: [], tableId: "t" } });
    expect(place({ id: "x", loot: { drops: [] } }, ["loot", "tableId"], "t", creatures)).toEqual({ id: "x", loot: { tableId: "t" } });
    expect(getPath(place({ id: "x" }, ["adjustments", "maxHealth"], 12, creatures), ["adjustments", "maxHealth"])).toBe(12);
  });

  it("clears an optional field", () => {
    const store = createDraftStore();
    expect(applyEdit(context(store), targets(["goblin"]), ["level"], { kind: "set", value: undefined })).toBe(1);
    expect(draftOf(store, "goblin")).not.toHaveProperty("level");
  });
});
