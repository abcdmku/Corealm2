import { describe, expect, it } from "vitest";
import rawResources from "../game/content/data/resources.json";
import { RESOURCES, RESOURCE_ARCHETYPES, resourceDef } from "../game/src/content/resources.js";
import { FAIRY_ORE_RESOURCES, FAIRY_TREE_RESOURCES } from "../game/src/content/fairyOres.js";
import { WILDERNESS_ORE_RESOURCES, WILDERNESS_TREE_RESOURCES } from "../game/src/content/wildernessResources.js";
import { HIGH_TIER_TREE_RESOURCES } from "../game/src/content/treeSpecies.js";
import { CROWNWARD_FISH_RESOURCES } from "../game/src/content/crownwardFishing.js";
import { GATHERING_PRODUCTION_TIERS } from "../game/src/content/gatheringProductionTiers.js";
import { RESOURCE_DATA, RESOURCE_RECORDS, resourceRows, resourceById } from "../game/src/content/resourceData.js";
import { RESOURCE_SOURCE_CATALOGS, ResourceRecordSchema, type ResourceCatalog } from "../game/src/content/schema/resources.js";
import { parseCollection } from "../game/src/content/schema/core.js";
import { buildResourceRecords, type ResourceSourceTables } from "../tools/content/export-resources.js";

function sourceTables(): ResourceSourceTables {
  return {
    CROWNWARD_FISH_RESOURCES, HIGH_TIER_TREE_RESOURCES, FAIRY_ORE_RESOURCES, FAIRY_TREE_RESOURCES,
    WILDERNESS_ORE_RESOURCES, WILDERNESS_TREE_RESOURCES,
    GATHERING_PRODUCTION_RESOURCES: GATHERING_PRODUCTION_TIERS.flatMap(row => row.resourceDefs),
    ESSENCE_RESOURCES: resourceRows("ESSENCE_RESOURCES"),
  };
}

describe("JSON resource catalog", () => {
  it("preserves authored file order, fields and shared lookup references", () => {
    expect(RESOURCES).toHaveLength(35);
    expect(RESOURCES).toBe(RESOURCE_DATA);
    expect(RESOURCE_ARCHETYPES).toBe(RESOURCES);
    expect(RESOURCES).toEqual(rawResources.map(({ catalog: _catalog, ...row }) => row));
    for (const row of RESOURCES) {
      expect(row).not.toHaveProperty("catalog");
      expect(resourceById(row.id)).toBe(row);
      expect(resourceDef(row.id)).toBe(row);
    }
    expect(() => resourceDef("missing-resource")).toThrow('Unknown resource id "missing-resource".');
    expect(() => resourceById("missing-resource")).toThrow('Unknown resource id "missing-resource".');
  });

  it("preserves every named source view and shares nested presentation objects", () => {
    const sources = sourceTables();
    for (const source of RESOURCE_SOURCE_CATALOGS) {
      const expected = RESOURCE_DATA.filter((_row, index) => RESOURCE_RECORDS[index]!.catalog === source);
      expect(sources[source], source).toEqual(expected);
      for (const row of sources[source]) {
        expect(row, `${source}: ${row.id}`).toBe(resourceById(row.id));
        expect(row.presentation).toBe(resourceById(row.id).presentation);
      }
    }
    const selected: readonly ResourceCatalog[] = ["FAIRY_TREE_RESOURCES", "CROWNWARD_FISH_RESOURCES"];
    expect(resourceRows(selected)).toEqual([...CROWNWARD_FISH_RESOURCES, ...FAIRY_TREE_RESOURCES]);
    expect(resourceRows([...selected].reverse())).toEqual(resourceRows(selected));
    expect(resourceRows(["FAIRY_TREE_RESOURCES", "FAIRY_TREE_RESOURCES"])).toEqual(FAIRY_TREE_RESOURCES);
    expect(resourceRows([])).toEqual([]);
  });

  it("rejects unknown nested fields, invalid ranges and probabilities", () => {
    const first = rawResources[0]!;
    const parse = (row: unknown) => parseCollection(ResourceRecordSchema, [row], { name: "resources" });
    expect(() => parse({ ...first, catalog: "UNKNOWN" })).toThrow("catalog");
    expect(() => parse({ ...first, catalog: undefined })).toThrow("catalog");
    expect(() => parse({ ...first, respawnSecond: 5 })).toThrow("respawnSecond");
    expect(() => parse({ ...first, presentation: { ...first.presentation, waterOfset: 1 } })).toThrow("waterOfset");
    expect(() => parse({ ...first, yieldRange: [3, 2] })).toThrow("min must be <= max");
    expect(() => parse({ ...first, yieldRange: [1.5, 2] })).toThrow("expected integer");
    expect(() => parse({ ...first, presentation: { ...first.presentation, variantScale: [2, 1] } })).toThrow("min must be <= max");
    expect(() => parse({ ...first, presentation: { ...first.presentation, availableAssetIds: [] } })).toThrow("availableAssetIds");
    expect(() => parse({ ...first, bonus: [{ itemId: "foo", chance: 1.1 }] })).toThrow("chance");
    expect(() => parseCollection(ResourceRecordSchema, [first, first], { name: "resources" })).toThrow("duplicate id");
  });

  it("exports only complete, exclusive source membership with unchanged source values and order", () => {
    const sources = sourceTables();
    expect(buildResourceRecords(sources, RESOURCES)).toEqual(RESOURCE_RECORDS);
    expect(() => buildResourceRecords({ ...sources, CROWNWARD_FISH_RESOURCES: [] }, RESOURCES)).toThrow("no named source");
    expect(() => buildResourceRecords({ ...sources, ESSENCE_RESOURCES: [...sources.ESSENCE_RESOURCES, CROWNWARD_FISH_RESOURCES[0]!] }, RESOURCES)).toThrow("overlaps sources");
    expect(() => buildResourceRecords({ ...sources, CROWNWARD_FISH_RESOURCES: [...CROWNWARD_FISH_RESOURCES].reverse() }, RESOURCES)).toThrow("parity failed");
    expect(() => buildResourceRecords({ ...sources, CROWNWARD_FISH_RESOURCES: CROWNWARD_FISH_RESOURCES.map(row => ({ ...row, reqLevel: 99 })) }, RESOURCES)).toThrow("reqLevel");
  });
});
