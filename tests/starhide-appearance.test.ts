import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { CharacterRig, type GearAppearanceLike } from "../game/src/render/characterRig.js";
import { gearAppearanceParts } from "../game/src/render/equipmentVisuals.js";

const approvedTag = "tier50-70-tailored-approved";
const legacyStarhideTag = "starhide-tailored-approved";
const pieces = [
  ["dragonhide_hood", "head"], ["dragonhide_robe", "body"], ["dragonhide_leggings", "legs"],
  ["dragonhide_boots", "feet"], ["dragonhide_wraps", "hands"],
  ["starhide_hood", "head"], ["starhide_robe", "body"], ["starhide_leggings", "legs"],
  ["starhide_boots", "feet"], ["starhide_wraps", "hands"],
] as const;

type ItemEntry = { id: string; tags: string[]; itemModel?: { itemId: string; wearable: boolean } };
function approvedEntry(itemId: string, tag = approvedTag): ItemEntry {
  return { id: `corealm_item_${itemId}`, tags: [tag], itemModel: { itemId, wearable: true } };
}

function fixture(entry: ItemEntry | undefined, bodyAssetId = "base_male") {
  const assets = {
    entry: vi.fn((id: string) => id === entry?.id ? entry : undefined),
    load: vi.fn(async () => new THREE.Group()),
  };
  const rig = new CharacterRig(assets as never) as any;
  rig.bodyAssetId = bodyAssetId;
  return { rig, assets };
}

beforeEach(() => {
  // Ordinary production selection must work without a lab route or development build.
  vi.stubGlobal("location", { search: "" });
  vi.stubEnv("DEV", false);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("accepted T50 and T70 production appearance", () => {
  it.each(pieces)("replaces native male %s with its approved skinned item", (itemId, slot) => {
    const fallback = gearAppearanceParts(itemId, "male");
    expect(fallback.length).toBeGreaterThan(0);
    const original = structuredClone(fallback);
    const { rig, assets } = fixture(approvedEntry(itemId));
    const result: readonly GearAppearanceLike[] = rig.authoredItemParts(itemId, fallback);
    expect(result).toEqual([{ assetId: `corealm_item_${itemId}`, slot, attach: "skin" }]);
    // The authored materials must not inherit the imported outfit's tier tint or spare parts.
    expect(result[0]).not.toHaveProperty("tint");
    expect(fallback).toEqual(original);
    expect(assets.load).not.toHaveBeenCalled();
    rig.dispose();
  });

  it.each(pieces)("keeps %s on the female body's fitted legacy appearance", (itemId) => {
    const fallback = gearAppearanceParts(itemId, "female");
    expect(fallback.length).toBeGreaterThan(0);
    const original = structuredClone(fallback);
    const { rig } = fixture(approvedEntry(itemId), "base_female");
    expect(rig.authoredItemParts(itemId, fallback)).toBe(fallback);
    expect(fallback).toEqual(original);
    rig.dispose();
  });

  it.each(pieces.filter(([itemId]) => itemId.startsWith("starhide_")))(
    "retains the existing Starhide approval tag for %s", (itemId, slot) => {
      const { rig } = fixture(approvedEntry(itemId, legacyStarhideTag));
      expect(rig.authoredItemParts(itemId, gearAppearanceParts(itemId, "male"))).toEqual([
        { assetId: `corealm_item_${itemId}`, slot, attach: "skin" },
      ]);
      rig.dispose();
    },
  );

  it.each(pieces.filter(([itemId]) => itemId.startsWith("dragonhide_")))(
    "does not use the old Starhide approval tag to admit %s", (itemId) => {
      const fallback = gearAppearanceParts(itemId, "male");
      const { rig } = fixture(approvedEntry(itemId, legacyStarhideTag));
      expect(rig.authoredItemParts(itemId, fallback)).toBe(fallback);
      rig.dispose();
    },
  );

  it.each(["", "base_male_custom", "alternate_humanoid"])("requires the exact native male body instead of %j", bodyAssetId => {
    const fallback = gearAppearanceParts("starhide_robe", "male");
    const { rig } = fixture(approvedEntry("starhide_robe"), bodyAssetId);
    expect(rig.authoredItemParts("starhide_robe", fallback)).toBe(fallback);
    rig.dispose();
  });

  describe.each(["dragonhide", "starhide"])("%s approval guards", theme => {
    const itemId = `${theme}_robe`;
    it.each([
      ["no registered asset", undefined],
      ["no approval tag", { ...approvedEntry(itemId), tags: ["armor", "authored"] }],
      ["review-only tag", { ...approvedEntry(itemId), tags: ["temporary-asset-review"] }],
      ["candidate-only tag", { ...approvedEntry(itemId), tags: ["reference-tailored-candidate"] }],
      ["similar approval tag", { ...approvedEntry(itemId), tags: [`${approvedTag}-pending`] }],
      ["no item metadata", { id: `corealm_item_${itemId}`, tags: [approvedTag] }],
      ["wrong item metadata", { ...approvedEntry(itemId), itemModel: { itemId: `${theme}_hood`, wearable: true } }],
      ["nonwearable metadata", { ...approvedEntry(itemId), itemModel: { itemId, wearable: false } }],
    ] satisfies [string, ItemEntry | undefined][])("retains the complete fallback when the asset has %s", (_reason, entry) => {
      const fallback = gearAppearanceParts(itemId, "male");
      const { rig } = fixture(entry);
      expect(rig.authoredItemParts(itemId, fallback)).toBe(fallback);
      rig.dispose();
    });
  });

  it.each(["grithe_cuirass", "nightglass_plate", "starhide_robe_old", "starhide_crown", "starhide_wraps_preview",
    "dragonhide_robe_old", "dragonhide_crown", "dragonhide_wraps_preview"])(
    "does not admit unapproved item ID %s through the crafted armor tag", itemId => {
      const fallback: readonly GearAppearanceLike[] = [
        { assetId: "existing-fitted-chest", slot: "body", attach: "skin", tint: 0x514b73 },
        { assetId: "existing-fitted-shoulder", slot: "body", attach: "skin", tint: 0xbeb8ad },
      ];
      const { rig } = fixture(approvedEntry(itemId));
      expect(rig.authoredItemParts(itemId, fallback)).toBe(fallback);
      rig.dispose();
    },
  );

  it.each(["duskguard_plate", "oathguard_plate", "frostguard_plate", "tideweave_robe", "nightweave_robe", "frostweave_robe"])(
    "keeps boss armor %s on its existing appearance even with the crafted approval tag", itemId => {
      const fallback = gearAppearanceParts(itemId, "male");
      expect(fallback.length).toBeGreaterThan(0);
      const { rig } = fixture(approvedEntry(itemId));
      expect(rig.authoredItemParts(itemId, fallback)).toBe(fallback);
      rig.dispose();
    },
  );

  it.each(["dragonhide_robe", "starhide_robe"])("still previews unapproved %s in the staged development lab", itemId => {
    vi.stubEnv("DEV", true);
    vi.stubGlobal("location", { search: "?mode=combat&reviewStaged=1" });
    const { rig } = fixture(approvedEntry(itemId, "temporary-asset-review"));
    expect(rig.authoredItemParts(itemId, gearAppearanceParts(itemId, "male"))).toEqual([
      { assetId: `corealm_item_${itemId}`, slot: "body", attach: "skin" },
    ]);
    rig.dispose();
  });

  it.each([
    ["production build", false, "?mode=combat&reviewStaged=1", "temporary-asset-review"],
    ["normal world route", true, "?reviewStaged=1", "temporary-asset-review"],
    ["missing staged flag", true, "?mode=combat", "temporary-asset-review"],
    ["missing review marker", true, "?mode=combat&reviewStaged=1", "reference-tailored-candidate"],
  ] as const)("does not bypass approval in a %s", (_reason, dev, search, tag) => {
    vi.stubEnv("DEV", dev);
    vi.stubGlobal("location", { search });
    const itemId = "dragonhide_robe", fallback = gearAppearanceParts(itemId, "male");
    const { rig } = fixture(approvedEntry(itemId, tag));
    expect(rig.authoredItemParts(itemId, fallback)).toBe(fallback);
    rig.dispose();
  });

  it("does not manufacture an equip slot when the item resolver has no appearance", () => {
    const fallback: readonly GearAppearanceLike[] = [];
    const { rig } = fixture(approvedEntry("starhide_robe"));
    expect(rig.authoredItemParts("starhide_robe", fallback)).toBe(fallback);
    rig.dispose();
  });

  it("continues to resolve registered held equipment without the armor approval tag", () => {
    const entry = { id: "corealm_item_grithe_sword", tags: [], itemModel: { itemId: "grithe_sword", wearable: false } };
    const fallback: readonly GearAppearanceLike[] = [{ assetId: "existing-sword", slot: "mainHand", attach: "bone", tint: 0xc58258 }];
    const { rig } = fixture(entry);
    expect(rig.authoredItemParts("grithe_sword", fallback)).toEqual([
      { assetId: "corealm_item_grithe_sword", slot: "mainHand", attach: "bone" },
    ]);
    rig.dispose();
  });
});
