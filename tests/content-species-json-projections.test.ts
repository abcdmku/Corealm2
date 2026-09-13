import { describe, expect, expectTypeOf, it } from "vitest";
import { ITEM_DATA } from "../game/src/content/itemData.js";
import { resourceById } from "../game/src/content/resourceData.js";
import { TREE_SPECIES, projectTreeSpecies, projectTreeAssetIds, treeAssetIds, treeResource } from "../game/src/content/treeSpecies.js";
import { CROWNWARD_FISH, projectCrownwardFish } from "../game/src/content/crownwardFishing.js";

describe("tree and fish JSON projections", () => {
  it("projects every native tree and its assets from canonical records", () => {
    expect(TREE_SPECIES.flatMap(treeAssetIds)).toEqual(TREE_SPECIES.flatMap(species =>
      resourceById(species.resourceId).presentation.availableAssetIds));
    for (const species of TREE_SPECIES) {
      const resource = resourceById(species.resourceId);
      expect(projectTreeSpecies(species, resource, ITEM_DATA)).toEqual(species);
      expect(treeResource(species)).toEqual(resource);
      expect(treeAssetIds(species)).toEqual(resource.presentation.availableAssetIds);
      expect(treeAssetIds(species)).not.toBe(resource.presentation.availableAssetIds);
    }
  });

  it("propagates cloned tree resource and yield item edits without changing inputs", () => {
    const original = TREE_SPECIES[0]!;
    const resource = structuredClone(resourceById(original.resourceId));
    const item = { ...ITEM_DATA.find(row => row.id === original.logId)!, id: "edited_log", value: 987 };
    resource.name = "Edited Pine";
    resource.reqLevel = 17;
    resource.itemId = item.id;
    resource.presentation = { ...resource.presentation, availableAssetIds: ["edited_pine_a", "edited_pine_b"], targetWorldSize: 13 };
    const before = structuredClone({ resource, item });

    const projected = projectTreeSpecies(original, resource, [item]);
    expect(projected).toEqual({ ...original, name: "Edited Pine", level: 17,
      logId: "edited_log", logValue: 987, variants: 2, height: 13 });
    expect(projectTreeAssetIds(resource)).toEqual(["edited_pine_a", "edited_pine_b"]);
    expect({ resource, item }).toEqual(before);
    expect(TREE_SPECIES[0]).toEqual(original);
    expect(resourceById(original.resourceId).name).toBe("Pine");
  });

  it("keeps the fish tuple and derives names without stripping or rewriting text", () => {
    expectTypeOf(CROWNWARD_FISH[0].id).toEqualTypeOf<"crown_trout">();
    expectTypeOf(CROWNWARD_FISH[1].id).toEqualTypeOf<"crown_tuna">();
    expectTypeOf(CROWNWARD_FISH[2].id).toEqualTypeOf<"pearlwater_salmon">();
    expectTypeOf(CROWNWARD_FISH.length).toEqualTypeOf<3>();
    for (const fish of CROWNWARD_FISH) {
      expect(projectCrownwardFish(fish.id, resourceById(`fish_${fish.id}`), ITEM_DATA)).toEqual(fish);
    }
    const resource = structuredClone(resourceById("fish_crown_trout"));
    const item = { ...ITEM_DATA.find(row => row.id === resource.itemId)!, name: "Raw Silver Trout", value: 901 };
    resource.tier = 35;
    resource.presentation = { ...resource.presentation, availableAssetIds: ["edited_trout"], targetWorldSize: 1.3 };
    const before = structuredClone({ resource, item });
    expect(projectCrownwardFish("crown_trout", resource, [item])).toEqual({
      id: "crown_trout", name: "Raw Silver Trout", tier: 35, asset: "edited_trout", size: 1.3, value: 901,
    });
    expect({ resource, item }).toEqual(before);
    expect(CROWNWARD_FISH[0].name).toBe("Trout");
  });

  it("rejects broken resource and item links instead of retaining stale fallback values", () => {
    const pine = TREE_SPECIES[0]!;
    const tree = resourceById(pine.resourceId);
    const fish = resourceById("fish_crown_trout");
    expect(() => projectTreeSpecies(pine, tree, [])).toThrow("Missing tree yield item");
    expect(() => projectTreeSpecies(pine, fish, ITEM_DATA)).toThrow("Invalid tree resource");
    expect(() => projectCrownwardFish("crown_trout", fish, [])).toThrow("Missing fish yield item");
    expect(() => projectCrownwardFish("crown_tuna", fish, ITEM_DATA)).toThrow("Invalid fish resource");
    expect(() => projectCrownwardFish("crown_trout", {
      ...fish, presentation: { ...fish.presentation, availableAssetIds: [] },
    }, ITEM_DATA)).toThrow("Missing fish presentation asset");
  });
});
