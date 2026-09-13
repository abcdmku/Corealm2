import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { EquipmentBonuses, ItemDef, ItemId } from "../game/src/contracts.js";
import { EQUIPMENT, KITS, MAGIC_ORBS } from "../game/src/content/equipment.js";
import { WILDERNESS_LOOT_ITEMS } from "../game/src/content/wildernessLoot.js";
import { BOSS_ARMOR_ITEMS, BOSS_ARMOR_SETS } from '../game/src/content/bossArmor.js';
import { MINIBOSS_JEWELLERY } from '../game/src/content/universalMinibossLoot.js';
import { computeMaxHealth, createInitialState, setSkillLevel } from "../game/src/state/store.js";
import {
  GEAR_APPEARANCE_IDS, GEAR_ASSET_GAPS, VISIBLE_EQUIP_SLOTS,
  applyGearAppearance, gatheringToolAppearance, gearAppearance, gearAppearanceParts,
  gearAppearancePartsWithCharge, weaponAttachment, weaponSocket,
} from "../game/src/render/equipmentVisuals.js";
import { iconShapeFor } from "../game/src/ui/itemIcons.js";
import { fishingRodAssetId, isProceduralGearAsset } from "../game/src/render/proceduralGear.js";

/**
 * The equipment ladder, frozen as tests.
 *
 * `KITS` (content/equipment.ts) was exported with a comment saying it existed "so a test can
 * re-check the totals in the header comment without re-deriving them by hand", and then went
 * unimported for the whole of Phase 1: the equipment table that PRD 2.3's health column and PRD
 * 2.4's damage column are solved from had zero test coverage. A live sweep found the numbers
 * correct; nothing in CI would have caught them moving.
 *
 * The appearance half is checked the same way. The failure this guards against is specific and
 * cheap to ship: a typo in an asset id resolves to nothing at load time, `AssetRegistry.load`
 * rejects, the rig swallows it, and the item is silently invisible with no error anywhere. So every
 * asset id the table can produce — for BOTH body variants — is checked against the manifest.
 */

const BY_ID = new Map<ItemId, ItemDef>(EQUIPMENT.map((def) => [def.id, def]));
const ALL_BY_ID = new Map<ItemId, ItemDef>([...MAGIC_ORBS, ...EQUIPMENT].map((def) => [def.id, def]));
const WILDERNESS_EQUIPMENT = WILDERNESS_LOOT_ITEMS.filter(def => def.equip);
const ALL_EQUIPMENT = [...EQUIPMENT, ...WILDERNESS_EQUIPMENT, ...BOSS_ARMOR_ITEMS, ...MINIBOSS_JEWELLERY];

function kitTotals(kit: keyof typeof KITS): EquipmentBonuses {
  const totals: EquipmentBonuses = {
    meleeAccuracy: 0, meleePower: 0,  magicAccuracy: 0, magicPower: 0, defence: 0, health: 0, vitality: 0 };
  for (const id of KITS[kit] ?? []) {
    const bonuses = BY_ID.get(id)?.equip?.bonuses;
    if (!bonuses) throw new Error(`KITS.${kit} names ${id}, which is not an equippable row`);
    totals.meleeAccuracy += bonuses.meleeAccuracy;
    totals.meleePower += bonuses.meleePower;
    totals.defence += bonuses.defence;
    totals.magicAccuracy += bonuses.magicAccuracy;
    totals.magicPower += bonuses.magicPower;
    totals.vitality += bonuses.vitality;
    totals.health += bonuses.health;
  }
  return totals;
}

describe("the gear ladder", () => {
  it("has 95 equippable rows with unique ids", () => {
    expect(EQUIPMENT).toHaveLength(93);
    expect(BY_ID.size).toBe(93);
    for (const def of EQUIPMENT) {
      expect(def.equip, `${def.id} has no equip block`).toBeDefined();
      expect(def.category).toBe("equipment");
    }
  });

  it("authors the complete wand and staff ladders with their hand use and cadence", () => {
    const expected = [
      ["basic_wooden_wand", "wand", 1, 2200],
      ["basic_wooden_staff", "staff", 2, 3000],
      ["palewood_wand", "wand", 1, 2200],
      ["palewood_staff", "staff", 2, 3000],
      ["duskoak_wand", "wand", 1, 2200],
      ["duskoak_staff", "staff", 2, 3000],
      ["cairnpine_wand", "wand", 1, 2200],
      ["cairnpine_staff", "staff", 2, 3000],
      ["air_wand", "wand", 1, 2200],
      ["air_staff", "staff", 2, 3000],
      ["earth_wand", "wand", 1, 2200],
      ["earth_staff", "staff", 2, 3000],
      ["water_wand", "wand", 1, 2200],
      ["water_staff", "staff", 2, 3000],
      ["cinderpine_wand", "wand", 1, 2200],
      ["cinderpine_staff", "staff", 2, 3000],
      ["fire_wand", "wand", 1, 2200],
      ["fire_staff", "staff", 2, 3000],
      // The rare miniboss staves stay uncharged plain staffs on the standard cadence.
      ["galeskin_staff", "staff", 2, 3000],
      ["mossbound_staff", "staff", 2, 3000],
      ["tideworn_staff", "staff", 2, 3000],
      ["cinderwake_staff", "staff", 2, 3000],
    ] as const;
    expect(EQUIPMENT.filter((def) => def.magicWeapon)).toHaveLength(expected.length);
    for (const [id, kind, hands, cadence] of expected) {
      const def = BY_ID.get(id);
      expect(def?.magicWeapon, id).toMatchObject({ kind, hands });
      expect(def?.equip?.slot, id).toBe("mainHand");
      expect(def?.equip?.attackSpeedMs, id).toBe(cadence);
    }
  });

  it("authors released Orbs as non-equipment crafting components", () => {
    const expected = [
      ["air_orb", "wind", true],
      ["earth_orb", "earth", true],
      ["water_orb", "water", true],
      ["fire_orb", "fire", true],
    ] as const;
    expect(MAGIC_ORBS).toHaveLength(expected.length);
    for (const [id, element, released] of expected) {
      const def = ALL_BY_ID.get(id);
      expect(def?.equip, id).toBeUndefined();
      expect(def?.category, id).toBe("component");
      expect(def?.orb, id).toEqual({ element, released });
    }
  });

  it("dresses exactly one item per slot in each of the eight kits", () => {
    for (const kit of Object.keys(KITS)) {
      const ids = KITS[kit] ?? [];
      const slots = ids.map((id) => BY_ID.get(id)?.equip?.slot);
      const expectedLength = kit.startsWith("magic_") ? 6 : 7;
      expect(ids, kit).toHaveLength(expectedLength);
      expect(new Set(slots).size, `${kit} wears two items in one slot`).toBe(expectedLength);
    }
  });

  // The header block of content/equipment.ts states these, and every one of them is solved from a
  // worked example in the PRD rather than chosen. Melee kits also carry 1 (t5) and 2 (t10)
  // magicAccuracy off their pendants, which the header does not quote; asserted here so the full
  // seven fields are pinned, not just the five that were written down.
  it("sums to the totals the header solves from the PRD", () => {
    expect(kitTotals("melee_t1")).toEqual({
      meleeAccuracy: 9, meleePower: 8,  magicAccuracy: 0, magicPower: 0, defence: 16, health: 6, vitality: 0 });
    expect(kitTotals("melee_t5")).toEqual({
      meleeAccuracy: 21, meleePower: 14,  magicAccuracy: 0, magicPower: 0, defence: 33, health: 14, vitality: 0 });
    expect(kitTotals("melee_t10")).toEqual({
      meleeAccuracy: 40, meleePower: 26,  magicAccuracy: 0, magicPower: 0, defence: 58, health: 16, vitality: 0 });
    expect(kitTotals("magic_t1")).toEqual({
      meleeAccuracy: 0, meleePower: 0,  magicAccuracy: 10, magicPower: 9, defence: 12, health: 4, vitality: 0 });
    expect(kitTotals("magic_t5")).toEqual({
      meleeAccuracy: 0, meleePower: 2,  magicAccuracy: 23, magicPower: 16, defence: 26, health: 10, vitality: 0 });
    expect(kitTotals("magic_t10")).toEqual({
      meleeAccuracy: 0, meleePower: 4,  magicAccuracy: 45, magicPower: 31, defence: 47, health: 12, vitality: 0 });
  });

  it("reproduces PRD 2.3's derived-health column at the levels it quotes", () => {
    const health = (melee: number, magic: number, kit: keyof typeof KITS): number => {
      const state = createInitialState(1337, 0);
      setSkillLevel(state, "melee", melee);
      setSkillLevel(state, "magic", magic);
      return computeMaxHealth(state, kitTotals(kit).health);
    };
    expect(health(10, 1, "melee_t1")).toBe(41);
    expect(health(12, 5, "melee_t5")).toBe(58);
    expect(health(18, 8, "melee_t10")).toBe(75);
  });

  it("keeps armour out of power, which is what makes the PRD's max-hit table reproduce", () => {
    // PRD 2.4's worked rows quote weapon-only gearPower. If a single armour row ever gains power,
    // "Melee 18, tier 10 kit -> maxHit 12" stops holding.
    for (const def of EQUIPMENT) {
      const equip = def.equip;
      if (!equip || equip.slot === "mainHand" || def.id.startsWith("crafted_")) continue;
      expect(equip.bonuses.meleePower, `${def.id} gives meleePower from a non-weapon slot`).toBe(0);
    }
  });
});

// -------------------------------------------------------------------------- appearance

interface ManifestAsset { id: string }
const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../game/public/assets/manifest.json", import.meta.url)), "utf8"),
) as { assets: ManifestAsset[] };
const MANIFEST_IDS = new Set(manifest.assets.map((asset) => asset.id));

describe("gear appearance", () => {
  it("covers every id in the content table and nothing else", () => {
    expect(EQUIPMENT).toHaveLength(93);
    expect(WILDERNESS_EQUIPMENT).toHaveLength(33);
    expect(MINIBOSS_JEWELLERY).toHaveLength(14);
    expect(ALL_EQUIPMENT).toHaveLength(168);
    expect(new Set(ALL_EQUIPMENT.map(def => def.id)).size).toBe(ALL_EQUIPMENT.length);
    expect([...GEAR_APPEARANCE_IDS].sort()).toEqual(ALL_EQUIPMENT.map((def) => def.id).sort());
  });

  it("agrees with content on which slot each item goes in", () => {
    for (const def of ALL_EQUIPMENT) {
      for (const part of gearAppearanceParts(def.id)) {
        expect(part.slot, def.id).toBe(def.equip?.slot);
      }
    }
  });

  // This is the check that stops a typo shipping as an invisible sword: a bad asset id fails
  // AssetRegistry.load at runtime, the rig catches it, and the player just wears nothing.
  it("names only assets that exist in the manifest or are built at boot, for both body variants", () => {
    // Two legitimate sources now, and the check has to know the difference. A manifest id must be a
    // real file — that is what stops a typo shipping as an invisible sword. A `proc_staff_*` id is
    // GENERATED: `render/proceduralGear.ts` builds the mesh and `AssetRegistry.registerBuilt`
    // publishes it into the same cache `load()` reads, so it will never appear in a manifest that
    // `tools/build-assets.ts` derives from files on disk. Excusing it by prefix would let any typo
    // starting "proc_" through, so it is checked against the real registration list instead.
    // The authored dagger is built by the same registry that supplies held fishing tools.
    for (const body of ["male", "female"] as const) {
      for (const def of ALL_EQUIPMENT) {
        for (const part of gearAppearanceParts(def.id, body)) {
          expect(MANIFEST_IDS.has(part.assetId) || isProceduralGearAsset(part.assetId), `${def.id} (${body}) -> ${part.assetId}`).toBe(true);
        }
      }
    }
  });

  it("gives every magic tier its own authored wand and staff construction", () => {
    for (const kind of ["wand", "staff"] as const) {
      // basic_wooden shares the tier-1 construction and is separated by its fittings colour only.
      const ids = ["basic_wooden", "palewood", "duskoak", "cairnpine", "cinderpine"].map((wood) => `${wood}_${kind}`);
      const parts = ids.map((id) => gearAppearanceParts(id)[0]);
      for (const [index, part] of parts.entries()) {
        expect(part, `${ids[index]} draws nothing`).toBeDefined();
        expect(part?.assetId, ids[index]).toMatch(new RegExp(`^corealm_${kind}_[1-4]$`));
        expect(part?.accent, `${ids[index]} should be unlit`).toBeUndefined();
        expect(part?.orb, `${ids[index]} should have an empty socket by itself`).toBeUndefined();
        expect(weaponSocket(part?.assetId ?? ""), `${ids[index]} has no hand socket`).not.toBeNull();
      }
      // Four separate meshes across the four wood tiers, not one mesh with four colours.
      expect(new Set(parts.slice(1).map((part) => part?.assetId)).size, `${kind} constructions`).toBe(4);
      expect(new Set(parts.map((part) => part?.tint)).size, `${kind} fitting colours`).toBe(5);
      // The grades carry their own size progression, so nothing is scaled at bind time.
      expect(new Set(parts.map((part) => part?.scale))).toEqual(new Set([1]));
    }
  });

  it("gives every shield tier its own authored board", () => {
    const ids = ["palewood_shield", "duskoak_shield", "cairnpine_shield", "cinderpine_shield"];
    const parts = ids.map((id) => gearAppearanceParts(id)[0]);
    for (const [index, part] of parts.entries()) {
      expect(part?.assetId, ids[index]).toMatch(/^corealm_shield_[1-4]$/);
      expect(part?.scale, ids[index]).toBe(1);
    }
    expect(new Set(parts.map((part) => part?.assetId)).size).toBe(4);
  });

  it("renders the crafted elemental core on the weapon", () => {
    expect(gearAppearanceParts("air_orb")).toHaveLength(0);
    for (const [prefix, element] of [["air", "wind"], ["earth", "earth"], ["water", "water"], ["fire", "fire"]] as const) {
      for (const kind of ["wand", "staff"]) {
        const itemId = `${prefix}_${kind}`;
        for (const charged of [true, false]) {
          const parts = gearAppearancePartsWithCharge(itemId, { itemId, charged });
          expect(parts).toHaveLength(1);
          expect(parts[0]?.orb, `${itemId}: ${charged}`).toMatchObject({ element, charged });
        }
      }
    }
  });

  it("shows something for every visible slot, with no gaps left", () => {
    const empty = ALL_EQUIPMENT
      .filter((def) => def.equip && VISIBLE_EQUIP_SLOTS.includes(def.equip.slot))
      .filter((def) => gearAppearance(def.id) === null)
      .map((def) => def.id);
    expect(empty).toEqual([]);
    expect(Object.keys(GEAR_ASSET_GAPS)).toEqual([]);
  });

  it("leaves rings and pendants out of the direct rig slots", () => {
    for (const def of ALL_EQUIPMENT) {
      if (!["accessory1", "accessory2"].includes(def.equip?.slot ?? "")) continue;
      expect(gearAppearanceParts(def.id)).toHaveLength(0);
    }
    expect(VISIBLE_EQUIP_SLOTS).not.toContain("accessory1");
    expect(VISIBLE_EQUIP_SLOTS).not.toContain("accessory2");
  });

  it("keeps crafted melee families and swaps imported mage body variants", () => {
    const t1 = gearAppearance("grithe_sword");
    const t10 = gearAppearance("kaldite_sword");
    expect(t1?.scale).toBe(0.9);
    expect(t10?.scale).toBe(0.9);
    expect(t1?.assetId).toBe("corealm_sword_1");
    expect(t10?.assetId).toBe("corealm_sword_3");
    expect(t1?.tint).not.toBe(t10?.tint);
    expect(gearAppearanceParts("grithe_cuirass").map((part) => part.assetId)).toEqual([
      "outfit_male_knight_chest",
      "outfit_male_knight_pauldron",
    ]);
    expect(gearAppearance("kaldite_plate", "female")?.assetId).toBe("outfit_female_knight_chest");
    expect(gearAppearanceParts("cairnpelt_robe", "male").map((part) => part.assetId)).toEqual([
      "fab_male_mage_body",
    ]);
    expect(gearAppearance("marchhide_hood", "female")?.assetId).toBe("fab_female_mage_head");
    expect(gearAppearance("grithe_helm", "male")?.assetId).toBe("outfit_male_knight_helmet");
  });

  it("uses icon copper, iron and cobalt for melee, preserving magic cloth colours", () => {
    expect(gearAppearance("grithe_cuirass")?.tint).toBe(0xc58258);
    expect(gearAppearance("corven_plate")?.tint).toBe(0x7f8589);
    expect(gearAppearance("kaldite_plate")?.tint).toBe(0x587cae);
    for (const id of ['marchhide_robe', 'bramblehide_robe', 'cairnpelt_robe']) {
      expect(gearAppearance(id)?.tint).toBeUndefined();
      expect(gearAppearance(id)?.itemId).toBe(id);
    }
  });

  it("attaches weapons to bones and armour to skin, and never scales a skinned part", () => {
    for (const def of ALL_EQUIPMENT) {
      const held = def.equip?.slot === "mainHand" || def.equip?.slot === "offHand";
      for (const part of gearAppearanceParts(def.id)) {
        // Worn armour is skinned, except for the additive tier pieces, which are rigid because they
        // ride one torso or hip bone over the outfit rather than deforming with it.
        const expected = held || part.assetId.startsWith("proc_") ? "bone" : "skin";
        expect(part.attach, `${def.id} -> ${part.assetId}`).toBe(expected);
        if (part.attach === "skin") expect(part.scale, def.id).toBeUndefined();
        else expect(weaponSocket(part.assetId), `${def.id} has no socket`).not.toBeNull();
      }
    }
  });

  it("retains crafted melee tier trim and uses complete imported mage parts", () => {
    const trims = (itemId: string) => gearAppearanceParts(itemId)
      .filter(part => part.assetId.startsWith("proc_")).map(part => part.assetId);
    // Copper has no neck trim. Crafted melee keeps a hip piece to close the plate-to-leg gap.
    // Imported mage silhouettes contain those regions in their own skinned parts.
    expect(trims("grithe_cuirass")).toEqual([]);
    expect(trims("marchhide_robe")).toEqual([]);
    for (const [body, legs] of [
      ["corven_plate", "corven_greaves"], ["kaldite_plate", "kaldite_greaves"],
      ["emberite_plate", "emberite_greaves"],
    ] as const) {
      expect(trims(body), body).toHaveLength(1);
      expect(trims(legs), legs).toHaveLength(1);
    }
    for (const legs of ["grithe_greaves"]) {
      expect(trims(legs), legs).toHaveLength(1);
    }
    // No two tiers of a line share a piece.
    const all = ["grithe", "corven", "kaldite", "emberite"].flatMap(t => trims(`${t}_greaves`));
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(4);
    for (const body of ['male', 'female'] as const) {
      for (const prefix of ['marchhide', 'bramblehide', 'cairnpelt', 'charhide', 'dragonhide', 'starhide']) {
        for (const [suffix, slot] of [['hood', 'head'], ['robe', 'body'], ['leggings', 'legs'], ['wraps', 'hands'], ['boots', 'feet']] as const) {
          const id = `${prefix}_${suffix}`;
          expect(gearAppearanceParts(id, body)).toEqual([{ itemId: id, assetId: `fab_${body}_mage_${slot}`, slot, attach: 'skin' }]);
        }
      }
      for (const set of BOSS_ARMOR_SETS) for (const [slot, id] of Object.entries(set.members)) {
        expect(gearAppearanceParts(id, body)).toEqual([{ itemId: id, assetId: `fab_${body}_${set.id}_${slot}`, slot, attach: 'skin' }]);
      }
    }
  });
});

describe("weapon sockets", () => {
  it("puts the sword's grip in the right fist and the shield on the left hand", () => {
    // Measured in hand_r local space on base_male.glb: fist centre (-0.010, 0.085, 0.000), grip
    // axis = local +Z, and the sword's grip centre sits at asset y = -0.10.
    expect(weaponSocket("sword")).toEqual({
      bone: "hand_r", position: [-0.01, 0.085, 0.1], rotation: [Math.PI / 2, 0, 0], scale: 1,
    });
    expect(weaponSocket("pickaxe")?.rotation[1]).toBeCloseTo(Math.PI / 2, 10);
    expect(weaponSocket("corealm_staff_1")?.bone).toBe("hand_r");
    expect(weaponSocket("corealm_wand_4")?.bone).toBe("hand_r");
  });

  it("straps the shield to the left forearm clear of the arm instead of dangling it from the fist", () => {
    const socket = weaponSocket("shield")!;
    // lowerarm_l local +Y runs elbow (0) to wrist (0.244) on base_male.glb, and the forearm has a
    // radius of about 0.045 m about that axis.
    expect(socket.bone).toBe("lowerarm_l");
    expect(socket.position[1]).toBeGreaterThan(0.05);
    expect(socket.position[1]).toBeLessThan(0.20);
    // The boss leaves along asset +Z; the rotation must send it to local -X, the back-of-hand side.
    const boss = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(...socket.rotation));
    expect(boss.x).toBeCloseTo(-1, 6);
    // Every worn tier's inner face must sit outside the forearm, on the opposite side to the boss.
    for (const id of ["palewood_shield", "duskoak_shield", "cairnpine_shield", "cinderpine_shield"]) {
      const appearance = gearAppearance(id)!;
      const worn = weaponAttachment(appearance)!;
      expect(worn.bone).toBe("lowerarm_l");
      expect(worn.position[0], `${id} inner face`).toBeLessThan(-0.05);
    }
  });

  it("pins an explicit grip for every generated fishing rod instead of the rig fallback", () => {
    for (const itemId of ["worn_rod", "palewood_rod", "duskoak_rod", "cairnpine_rod", "cinderpine_rod"]) {
      const socket = weaponSocket(fishingRodAssetId(itemId));
      expect(socket, itemId).not.toBeNull();
      // The rod models put their grip at the origin, so the socket is the bare fist centre.
      expect(socket!.bone).toBe("hand_r");
      expect(socket!.position).toEqual([-0.01, 0.085, 0]);
      expect(socket!.rotation).toEqual([Math.PI / 2, 0, 0]);
    }
  });

  it("fits the pickaxe head inside a believable one-handed swing at every tier", () => {
    // pickaxe.glb spans 0.813 m across the head and 1.198 m end to end at scale 1, against a
    // 1.81 m rig with a 0.424 m shoulder span. Unfitted, the tier-20 row drew a 1.00 m head.
    for (const itemId of ["worn_pickaxe", "grithe_pickaxe", "corven_pickaxe", "kaldite_pickaxe", "emberite_pickaxe"]) {
      const appearance = gatheringToolAppearance(itemId)!;
      const socket = weaponAttachment(appearance)!;
      expect(socket.scale * 0.813, `${itemId} head width`).toBeLessThan(0.70);
      expect(socket.scale * 1.198, `${itemId} length`).toBeLessThan(1.05);
      expect(socket.scale * 1.198, `${itemId} length`).toBeGreaterThan(0.60);
    }
  });

  it("keeps the dagger's full grip seated in the fist at every tier", () => {
    for (const tier of ["grithe", "corven", "kaldite", "emberite"]) {
      const dagger = gearAppearance(`${tier}_dagger`);
      expect(dagger?.assetId).toBe(`corealm_dagger_${["grithe", "corven", "kaldite", "emberite"].indexOf(tier) + 1}`);
      const socket = dagger ? weaponAttachment(dagger) : null;
      expect(socket?.scale).toBe(1);
      const grip = new THREE.Vector3(0, -0.1, 0);
      grip.applyEuler(new THREE.Euler(...socket!.rotation)).multiplyScalar(socket!.scale);
      grip.add(new THREE.Vector3(...socket!.position));
      expect(grip.distanceTo(new THREE.Vector3(-0.01, 0.085, 0))).toBeLessThan(0.001);
    }
  });

  it("compensates the socket when another caller scales a held part", () => {
    const dagger = gearAppearance("grithe_dagger");
    expect(dagger).not.toBeNull();
    const socket = dagger ? weaponAttachment({ ...dagger, scale: 0.558 }) : null;
    expect(socket).not.toBeNull();
    // 0.62 * tierSilhouetteScale(1) = 0.558; the uncompensated 0.100 m offset would put the grip
    // 4.4 cm from the fist centre, past its 3.8 cm half-span.
    expect(socket?.scale).toBeCloseTo(0.558, 3);
    expect(socket?.position[2]).toBeCloseTo(0.056, 3);
    expect(socket?.position[0]).toBeCloseTo(-0.01, 10);
  });
});

describe("tinting", () => {
  it("clones the material instead of repainting every other user of the asset", () => {
    const shared = new THREE.MeshStandardMaterial({ color: 0xffffff });
    const source = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    const attached = source.clone();
    const appearance = gearAppearance("kaldite_plate");
    expect(appearance).not.toBeNull();
    if (appearance) applyGearAppearance(attached, appearance);

    const painted = attached.material as THREE.MeshStandardMaterial;
    expect(painted).not.toBe(shared);
    expect(painted.color.getHex()).toBe(appearance?.tint);
    // The NPCs in Coldbrace wear the same peasant and ranger parts out of the same asset cache.
    expect(shared.color.getHex()).toBe(0xffffff);
  });

  it("recolours Ranger from source luminance without an emissive flattening pass", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const robe = { itemId: 'npc-ranger', assetId: 'outfit_male_ranger_chest', slot: 'body' as const, attach: 'skin' as const, tint: 0x416f9d };
    expect(robe).not.toBeNull();
    if (robe) applyGearAppearance(mesh, robe);
    const painted = mesh.material as THREE.MeshStandardMaterial;
    expect(painted.color.getHex()).toBe(0xffffff);
    expect(painted.emissive.getHex()).toBe(0x000000);
    expect(painted.emissiveIntensity).toBe(0);
    expect(painted.customProgramCacheKey()).toContain("ranger-tier-colour:416f9d");

    const shader = {
      fragmentShader: "#include <color_fragment>", vertexShader: "", uniforms: {},
    } as Parameters<THREE.Material["onBeforeCompile"]>[0];
    painted.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain("gearTierSourceLuma");
    expect(shader.fragmentShader).toContain("gearTierValue");

    const knight = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const plate = gearAppearance("grithe_cuirass");
    if (plate) applyGearAppearance(knight, plate);
    expect((knight.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0x000000);
  });

  it("restricts Kaldite's glow to authored masks or a separate gem material", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const sword = gearAppearance("kaldite_sword");
    expect(sword?.accent).toBeDefined();
    if (sword) applyGearAppearance(mesh, sword);
    const painted = mesh.material as THREE.MeshStandardMaterial;
    expect(painted.emissive.getHex()).toBe(0x000000);
    expect(painted.emissiveIntensity).toBe(0);
    const masked = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ emissiveMap: new THREE.Texture() }));
    if (sword) applyGearAppearance(masked, sword);
    expect(masked.material.emissive.getHex()).toBe(sword?.accent);
    expect(masked.material.emissiveIntensity).toBeGreaterThan(0);
    // Grithe and Corven have no accent, so they must not gain an emissive at all.
    const grithe = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    const grey = gearAppearance("grithe_sword");
    if (grey) applyGearAppearance(grithe, grey);
    expect((grithe.material as THREE.MeshStandardMaterial).emissive.getHex()).toBe(0x000000);
  });

  it("keeps authored wood and rare weapon maps without recolouring another cached user", () => {
    for (const itemId of ["basic_wooden_staff", "cinderpine_wand", "tideworn_sword", "mossbound_staff"]) {
      const source = new THREE.MeshStandardMaterial({
        map: new THREE.Texture(), normalMap: new THREE.Texture(),
        roughnessMap: new THREE.Texture(), metalnessMap: new THREE.Texture(),
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), source);
      applyGearAppearance(mesh, gearAppearance(itemId)!);
      expect(mesh.material).not.toBe(source);
      for (const map of ["map", "normalMap", "roughnessMap", "metalnessMap"] as const) {
        expect(mesh.material[map], `${itemId}: ${map}`).toBe(source[map]);
      }
      expect(source.color.getHex()).toBe(0xffffff);
      if (itemId.includes("wooden") || itemId === "cinderpine_wand") {
        // Unlit means no emissive colour. Intensity is left at the material default because a
        // black emissive contributes nothing whatever it is multiplied by.
        expect(mesh.material.emissive.getHex()).toBe(0);
      }
    }
    expect(gearAppearancePartsWithCharge("basic_wooden_wand", { itemId: "fire_wand", charged: true })[0]?.orb).toBeUndefined();
  });

  it("gives mixed Ranger tiers distinct material merge identities", () => {
    const source = new THREE.MeshStandardMaterial({ name: "MI_Ranger" });
    const identities = [0x416f9d, 0x2f4f3b, 0x4a4d52, 0x5c4a3c].map(tint => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), source);
      applyGearAppearance(mesh, { assetId: 'outfit_male_ranger_chest', slot: 'body', attach: 'skin', tint });
      return `${mesh.material.name}|${mesh.material.color.getHexString()}`;
    });
    expect(new Set(identities).size).toBe(4);
  });
});

describe("item icons", () => {
  // Slot alone drew many rows with the wrong silhouette, including a sword glyph for the
  // Cairnpine Staff in the Worn panel.
  it("draws the archetype, not the slot", () => {
    expect(iconShapeFor(BY_ID.get("cairnpine_staff"))).toBe("staff");
    expect(iconShapeFor(BY_ID.get("kaldite_dagger"))).toBe("dagger");
    expect(iconShapeFor(ALL_BY_ID.get("air_orb"))).toBe("orb");
    expect(iconShapeFor(BY_ID.get("crafted_earring_t10"))).toBe("ring");
    expect(iconShapeFor(BY_ID.get("crafted_earring_t20"))).toBe("ring");
    expect(iconShapeFor(BY_ID.get("cairnpelt_robe"))).toBe("robe");
    expect(iconShapeFor(BY_ID.get("marchhide_hood"))).toBe("hood");
  });

  it("still falls back to the slot for everything else", () => {
    expect(iconShapeFor(BY_ID.get("kaldite_sword"))).toBe("sword");
    expect(iconShapeFor(BY_ID.get("cairnpine_shield"))).toBe("shield");
    expect(iconShapeFor(BY_ID.get("crafted_ring_t10"))).toBe("ring");
    expect(iconShapeFor(BY_ID.get("kaldite_helm"))).toBe("helm");
    expect(iconShapeFor(BY_ID.get("kaldite_boots"))).toBe("boot");
  });

  it("gives every equipment row a shape", () => {
    for (const def of ALL_EQUIPMENT) expect(iconShapeFor(def), def.id).toBeTruthy();
  });
});
