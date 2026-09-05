import { describe, expect, it } from "vitest";
import { ALL_ITEMS } from "../game/src/content/items.js";
import { CREATURE_LOOT_ITEMS } from "../game/src/content/creatureLoot.js";
import {
  gatheringToolAppearance, gearAppearanceParts,
} from "../game/src/render/equipmentVisuals.js";
import {
  itemIconAppearance, type ItemIconAssetPart,
} from "../game/src/render/itemIconAppearances.js";
import { fishingRodAssetId, FISHING_ROD_LOOKS } from "../game/src/render/proceduralGear.js";

function assets(itemId: string, charged?: boolean): readonly ItemIconAssetPart[] {
  const appearance = itemIconAppearance(itemId, charged === undefined ? undefined : { charged });
  expect(appearance.parts.every(part => part.kind === "asset"), itemId).toBe(true);
  return appearance.parts as readonly ItemIconAssetPart[];
}

describe("inventory and held equipment parity", () => {
  it("shows the finished dagger and keeps each visible equipment model's production treatment", () => {
    for (const item of ALL_ITEMS.filter(item => item.equip && !item.magicWeapon?.charge)) {
      const held = gearAppearanceParts(item.id);
      if (held.length === 0) continue;
      const icon = assets(item.id);
      expect(icon.map(part => part.assetId), item.id).toEqual(held.map(part => part.assetId));
      expect(icon.map(part => part.gearAppearance), item.id).toEqual(held);
      expect(icon.map(part => part.scale), item.id).toEqual(held.map(part => part.scale));
    }
    for (const tier of ["grithe", "corven", "kaldite", "emberite"]) {
      expect(assets(`${tier}_dagger`)[0]?.assetId).toBe("corealm_dagger");
    }
  });

  it("distinguishes all elemental weapons from their plain bases and preserves depleted preview state", () => {
    const elemental = ALL_ITEMS.filter(item => item.magicWeapon?.charge);
    expect(elemental).toHaveLength(8);
    const plainWood = { wind: "palewood", earth: "duskoak", water: "cairnpine", fire: "cinderpine" } as const;
    for (const item of elemental) {
      const element = item.magicWeapon!.charge!.element;
      const base = `${plainWood[element]}_${item.magicWeapon!.kind}`;
      const canonical = assets(item.id)[0]!;
      const depleted = assets(item.id, false)[0]!;
      expect(canonical.gearAppearance?.orb, item.id).toMatchObject({ element, charged: true });
      expect(depleted.gearAppearance?.orb, item.id).toMatchObject({ element, charged: false });
      expect(depleted.gearAppearance?.orb?.position).toEqual(canonical.gearAppearance?.orb?.position);
      expect(depleted.gearAppearance?.orb?.radius).toEqual(canonical.gearAppearance?.orb?.radius);
      expect(assets(base)[0]?.gearAppearance?.orb, base).toBeUndefined();
      expect(assets(item.id)[0]?.gearAppearance?.orb?.charged, "preview must not mutate canonical art").toBe(true);
      expect(JSON.stringify(itemIconAppearance(item.id))).not.toBe(JSON.stringify(itemIconAppearance(base)));
    }
    expect(assets("basic_wooden_staff", false)[0]?.gearAppearance?.orb).toBeUndefined();
  });

  it("uses the actual gathering tool and every finished rod rather than a separate icon proxy", () => {
    for (const item of ALL_ITEMS.filter(item => item.tool)) {
      if (item.tool!.skill === "fishing") {
        expect(FISHING_ROD_LOOKS[item.id], item.id).toBeDefined();
        expect(assets(item.id)[0]?.assetId).toBe(fishingRodAssetId(item.id));
      } else {
        const held = gatheringToolAppearance(item.id);
        expect(held, item.id).not.toBeNull();
        expect(assets(item.id)[0]?.gearAppearance, item.id).toEqual(held);
      }
    }
  });

  it("stages all hand equipment compactly without applying glove staging to other slots", () => {
    const hands = ALL_ITEMS.filter(item => item.equip?.slot === "hands");
    expect(hands).toHaveLength(8);
    for (const item of ALL_ITEMS.filter(item => item.equip)) {
      expect(itemIconAppearance(item.id).presentation, item.id)
        .toBe(item.equip!.slot === "hands" ? "paired-hands" : undefined);
    }
  });

  it("gives every expansion trophy its anatomical family and every new accessory its own construction", () => {
    expect(CREATURE_LOOT_ITEMS).toHaveLength(32);
    for (const item of CREATURE_LOOT_ITEMS) {
      const appearance = itemIconAppearance(item.id);
      expect(appearance.parts, item.id).toHaveLength(1);
      const part = appearance.parts[0]!;
      expect(part.kind, item.id).toBe("primitive");
      if (part.kind !== "primitive") continue;
      expect(part.variant, item.id).toBeDefined();
      if (item.equip) expect(part.variant, item.id).toBeGreaterThan(0);
    }
    for (const [itemId, family] of [
      ["fox_guardhair", "tuft"], ["spider_thread", "cord"], ["heron_quill", "quill"],
      ["moose_antler_palm", "antler-palm"], ["crocodile_scute", "scute"], ["tortoise_shell_plate", "shell"],
    ] as const) {
      const part = itemIconAppearance(itemId).parts[0]!;
      expect(part.kind === "primitive" && part.primitive, itemId).toBe(family);
    }
  });
});
