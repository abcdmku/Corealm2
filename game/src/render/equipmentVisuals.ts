/**
 * Item-to-model mappings, hand sockets, and per-item material treatment for worn gear.
 *
 * Melee armour uses Quaternius' Knight set and magic armour uses the hooded Ranger set, one mesh
 * per slot under a tier colour treatment. Held gear is Corealm original: four sword grades, four
 * dagger grades, four shield boards, four staves and four wands, each grade a separate
 * construction with its own wood, leather, metal and crystal materials. The tier tint therefore
 * reaches the metal only; the other three roles keep what they were authored with.
 * Altar-crafted elemental weapons add a charged core around the set crystal.
 */
import * as THREE from "three";
import type { EquipSlot, ItemId } from "../contracts.js";
import { tierSilhouetteScale } from "./materials.js";
import { buildEquipmentCoreGeometry } from "./equipmentDetails.js";

/** Which base body the parts are resolved against. `boot.ts` builds the player as `base_male`. */
export type CharacterBody = "male" | "female";

export interface GearAppearance {
  assetId: string;
  slot: EquipSlot;
  /**
   * `skin` parts are skinned meshes that must be rebound to the body's skeleton
   * (`render/skinning.ts rebindSkinnedPart`); `bone` parts are rigid meshes parented to a bone with
   * the transform from `weaponSocket`.
   */
  attach: "bone" | "skin";
  tint?: number;
  /**
   * Uniform scale for a `bone` part. Always undefined for `skin` parts: a skinned mesh follows the
   * body's bones, so scaling it detaches the silhouette from the skeleton driving it.
   */
  scale?: number;
  /** Emissive accent used by the remaining gem-treated weapon materials. */
  accent?: number;
  /** The crafted elemental socket drawn at the weapon head. The weapon material itself remains non-emissive. */
  orb?: GearOrbAppearance;
}

export type GearOrbElement = "wind" | "earth" | "water" | "fire";

export interface GearOrbAppearance {
  element: GearOrbElement;
  charged: boolean;
  colour: number;
  emissive: number;
  position: readonly [number, number, number];
  radius: number;
}

/** Render-only weapon charge state. Exact charge count does not change the mesh. */
export interface GearWeaponChargePresentation {
  itemId: ItemId | null;
  charged: boolean;
}

/**
 * Slots the rig can show. `accessory1` / `accessory2` are deliberately absent — see the header.
 * This is the list the loop should iterate, so adding a slot is one edit here.
 */
export const VISIBLE_EQUIP_SLOTS: readonly EquipSlot[] = [
  "head", "body", "legs", "feet", "hands", "mainHand", "offHand",
] as const;

// ------------------------------------------------------------------------ tints

/**
 * The tier colours are applied over authored material regions. Restored ORM maps separate steel
 * from cloth, leather and wood. A metal-only luminance treatment removes the source weapons'
 * bronze vertex hue and prevents a second dark multiply from hiding their painted wear.
 * Knight uses the same metal mask, so straps and its red scarf keep their authored colours.
 * Ranger and magic wood have separate texture-luminance treatments below.
 */

/** Tier 0. Old iron with rust in it: warmer and darker than Grithe, so the upgrade reads. */
const WORN = 0x6f6257;
/** Melee tier 1: bronze. */
const GRITHE = 0xb77a3f;
/** Melee tier 5: medium neutral grey, separated clearly from both bronze and bright steel. */
const CORVEN = 0x7f8589;
/** Melee tier 10: neutral bright steel, with wear still supplied by the authored texture. */
const KALDITE = 0xffffff;
const KALDITE_GARNET = 0x5c1522;
/**
 * Melee tier 20: kiln steel with a warm cast against Kaldite's neutral steel.
 */
const EMBERITE = 0xffc9a0;
const EMBERITE_OPAL = 0xb8481e;
/** Magic tier 1: blue. */
const MARCHHIDE = 0x416f9d;
/** Magic tier 5: dark green. */
const BRAMBLEHIDE = 0x2f4f3b;
/** Magic tier 10: charcoal black, light enough to keep seams visible under gameplay lighting. */
const WIGHTSHROUD = 0x4a4d52;
/** Magic tier 20: seared warm grey-brown, the charhide read against the tier 10 cold charcoal. */
const CHARHIDE = 0x5c4a3c;

/**
 * Magic tier fittings.
 *
 * Each magic tier now has its own authored staff and wand construction, and each construction
 * carries its own wood, leather and crystal. The tint pipeline leaves those three roles alone, so
 * these values describe the ferrules, collars, cages and prongs only. Before the Corealm grades
 * landed all nine staff ids shared one imported mesh and these were wood colours applied over the
 * whole object, which is what turned the Cairnpine staff into flat slate in the lab.
 */
const PALEWOOD_FITTING = 0xc9a86a;
const DUSKOAK_FITTING = 0x8d7a5c;
const CAIRNPINE_FITTING = 0xa9b2b6;
const CINDERPINE_FITTING = 0xc08a5a;

/**
 * The four rare miniboss weapon tints, from the Phase 2 amendment: one shared imported sword and
 * staff geometry, identified per region purely by material tint through this production path and
 * the icon path. Applied over the Blink meshes' own textures, so each stays a real object with a
 * regional colour identity rather than four recolour-flat silhouettes.
 */
const GALESKIN_TINT = 0xaadfe4;   // Fallowmarch: pale cyan.
const MOSSBOUND_TINT = 0x6f8f4a;  // Vellenwood: moss green...
const MOSSBOUND_OCHRE = 0xc09a4a; // ...and ochre.
const TIDEWORN_TINT = 0x3556b0;   // Karrowmoor: cobalt...
const TIDEWORN_TEAL = 0x2f9ba0;   // ...and teal.
const CINDERWAKE_TINT = 0xd86a2e; // Kilnhalt: ember orange...
const CINDERWAKE_CRIMSON = 0x9c2420; // ...and crimson.

// ------------------------------------------------------------------------ the ladder

type OutfitKit = "ranger" | "knight";
type OutfitPart = "helmet" | "hood" | "chest" | "legs" | "boots" | "gloves" | "pauldron" | "scarf";
type WeaponAsset =
  | "axe" | "pickaxe" | "miniboss_sword" | "miniboss_staff" | "corealm_axe_1"
  | "corealm_sword_1" | "corealm_sword_2" | "corealm_sword_3" | "corealm_sword_4"
  | "corealm_dagger_1" | "corealm_dagger_2" | "corealm_dagger_3" | "corealm_dagger_4"
  | "corealm_shield_1" | "corealm_shield_2" | "corealm_shield_3" | "corealm_shield_4"
  | "corealm_staff_1" | "corealm_staff_2" | "corealm_staff_3" | "corealm_staff_4"
  | "corealm_wand_1" | "corealm_wand_2" | "corealm_wand_3" | "corealm_wand_4";

/**
 * A resolved part before the body variant is chosen. One item can be more than one part.
 *
 * The dagger is authored in equipmentDetails; other weapons are file-backed. Magic variants reuse
 * one mesh per weapon kind.
 */
type PartSpec =
  | { kind: "outfit"; kit: OutfitKit; part: OutfitPart; tint: number; accent?: number }
  | { kind: "weapon"; assetId: WeaponAsset; tint: number; accent?: number; scale: number };

interface GearVisual {
  slot: EquipSlot;
  /** Empty when the id is covered but has no direct mesh, such as an orb or accessory. */
  parts: readonly PartSpec[];
}

interface LadderTier {
  tier: number;
  kit: OutfitKit;
  /** Tint for every armour part in this kit. */
  cloth: number;
  clothAccent?: number;
  /** Tint for the main-hand weapon. */
  weapon: number;
  weaponAccent?: number;
  /** Tint for the off-hand shield. */
  offHandTint?: number;
  /**
   * Every held row names its own grade asset. An elemental variant shares the construction of the
   * wood tier it is crafted from, and differs by its charged core.
   */
  mainHand: readonly { id: ItemId; asset: WeaponAsset; scale?: number; fixedScale?: boolean }[];
  offHand?: { id: ItemId; asset: WeaponAsset };
  head: ItemId;
  body: ItemId;
  legs: ItemId;
  feet: ItemId;
  hands: ItemId;
  accessories: readonly ItemId[];
}

/**
 * Every id in `content/equipment.ts`, grouped the way the content file groups them. All tiers keep
 * their class silhouette and change palette, stats, names, and weapon scale.
 */
const LADDER: readonly LadderTier[] = [
  // Reviewed native sword grades already contain their length progression. The common
  // fit scale matches the held first-grade proof; applying tierSilhouetteScale again doubles it.
  {
    tier: 1, kit: "knight", cloth: GRITHE, weapon: GRITHE, offHandTint: GRITHE,
    mainHand: [
      { id: "grithe_dagger", asset: "corealm_dagger_1", scale: 1, fixedScale: true },
      { id: "grithe_sword", asset: "corealm_sword_1", scale: 0.9, fixedScale: true },
    ],
    offHand: { id: "palewood_shield", asset: "corealm_shield_1" },
    head: "grithe_helm", body: "grithe_cuirass", legs: "grithe_greaves",
    feet: "grithe_boots", hands: "grithe_gloves",
    accessories: ["grithe_ring", "grithe_pendant"],
  },
  {
    tier: 5, kit: "knight", cloth: CORVEN, weapon: CORVEN, offHandTint: CORVEN,
    mainHand: [
      { id: "corven_dagger", asset: "corealm_dagger_2", scale: 1, fixedScale: true },
      { id: "corven_sword", asset: "corealm_sword_2", scale: 0.9, fixedScale: true },
    ],
    offHand: { id: "duskoak_shield", asset: "corealm_shield_2" },
    head: "corven_helm", body: "corven_plate", legs: "corven_greaves",
    feet: "corven_boots", hands: "corven_gauntlets",
    accessories: ["corven_ring", "corven_pendant"],
  },
  {
    tier: 10, kit: "knight", cloth: KALDITE,
    weapon: KALDITE, weaponAccent: KALDITE_GARNET, offHandTint: KALDITE,
    mainHand: [
      { id: "kaldite_dagger", asset: "corealm_dagger_3", scale: 1, fixedScale: true },
      { id: "kaldite_sword", asset: "corealm_sword_3", scale: 0.9, fixedScale: true },
    ],
    offHand: { id: "cairnpine_shield", asset: "corealm_shield_3" },
    head: "kaldite_helm", body: "kaldite_plate", legs: "kaldite_greaves",
    feet: "kaldite_boots", hands: "kaldite_gauntlets",
    accessories: ["kaldite_ring", "kaldite_pendant"],
  },
  {
    tier: 1, kit: "ranger", cloth: MARCHHIDE, weapon: PALEWOOD_FITTING,
    mainHand: [
      { id: "palewood_wand", asset: "corealm_wand_1", scale: 1, fixedScale: true },
      { id: "palewood_staff", asset: "corealm_staff_1", scale: 1, fixedScale: true },
      { id: "air_wand", asset: "corealm_wand_1", scale: 1, fixedScale: true },
      { id: "air_staff", asset: "corealm_staff_1", scale: 1, fixedScale: true },
    ],
    head: "marchhide_hood", body: "marchhide_robe", legs: "marchhide_leggings",
    feet: "marchhide_boots", hands: "marchhide_wraps",
    accessories: ["ember_ring", "ember_charm"],
  },
  {
    tier: 5, kit: "ranger", cloth: BRAMBLEHIDE, weapon: DUSKOAK_FITTING,
    mainHand: [
      { id: "duskoak_wand", asset: "corealm_wand_2", scale: 1, fixedScale: true },
      { id: "duskoak_staff", asset: "corealm_staff_2", scale: 1, fixedScale: true },
      { id: "earth_wand", asset: "corealm_wand_2", scale: 1, fixedScale: true },
      { id: "earth_staff", asset: "corealm_staff_2", scale: 1, fixedScale: true },
    ],
    head: "bramblehide_hood", body: "bramblehide_robe", legs: "bramblehide_leggings",
    feet: "bramblehide_boots", hands: "bramblehide_wraps",
    accessories: ["stone_ring", "stone_charm"],
  },
  {
    tier: 10, kit: "ranger", cloth: WIGHTSHROUD, weapon: CAIRNPINE_FITTING,
    mainHand: [
      { id: "cairnpine_wand", asset: "corealm_wand_3", scale: 1, fixedScale: true },
      { id: "cairnpine_staff", asset: "corealm_staff_3", scale: 1, fixedScale: true },
      { id: "water_wand", asset: "corealm_wand_3", scale: 1, fixedScale: true },
      { id: "water_staff", asset: "corealm_staff_3", scale: 1, fixedScale: true },
    ],
    head: "cairnpelt_hood", body: "cairnpelt_robe", legs: "cairnpelt_leggings",
    feet: "cairnpelt_boots", hands: "cairnpelt_wraps",
    accessories: ["storm_ring", "storm_charm"],
  },
  {
    tier: 20, kit: "knight", cloth: EMBERITE,
    weapon: EMBERITE, weaponAccent: EMBERITE_OPAL, offHandTint: EMBERITE,
    mainHand: [
      { id: "emberite_dagger", asset: "corealm_dagger_4", scale: 1, fixedScale: true },
      { id: "emberite_sword", asset: "corealm_sword_4", scale: 0.9, fixedScale: true },
    ],
    offHand: { id: "cinderpine_shield", asset: "corealm_shield_4" },
    head: "emberite_helm", body: "emberite_plate", legs: "emberite_greaves",
    feet: "emberite_boots", hands: "emberite_gauntlets",
    accessories: ["emberite_ring", "emberite_pendant"],
  },
  {
    tier: 20, kit: "ranger", cloth: CHARHIDE, weapon: CINDERPINE_FITTING,
    mainHand: [
      { id: "cinderpine_wand", asset: "corealm_wand_4", scale: 1, fixedScale: true },
      { id: "cinderpine_staff", asset: "corealm_staff_4", scale: 1, fixedScale: true },
      { id: "fire_wand", asset: "corealm_wand_4", scale: 1, fixedScale: true },
      { id: "fire_staff", asset: "corealm_staff_4", scale: 1, fixedScale: true },
    ],
    head: "charhide_hood", body: "charhide_robe", legs: "charhide_leggings",
    feet: "charhide_boots", hands: "charhide_wraps",
    accessories: ["cinder_ring", "cinder_charm"],
  },
];

/**
 * The eight rare miniboss weapons: one shared imported sword mesh and one shared staff mesh, four
 * regional tints. The Blink meshes are authored at real-world size with grips at the origin, so
 * the staves take no extra scale and the swords take only the tier silhouette factor.
 */
const RARE_WEAPON_VISUALS: readonly {
  id: ItemId; asset: WeaponAsset; tier: number; tint: number; accent?: number;
}[] = [
  { id: "galeskin_sword", asset: "miniboss_sword", tier: 1, tint: GALESKIN_TINT, accent: GALESKIN_TINT },
  { id: "galeskin_staff", asset: "miniboss_staff", tier: 1, tint: GALESKIN_TINT, accent: GALESKIN_TINT },
  { id: "mossbound_sword", asset: "miniboss_sword", tier: 5, tint: MOSSBOUND_TINT, accent: MOSSBOUND_OCHRE },
  { id: "mossbound_staff", asset: "miniboss_staff", tier: 5, tint: MOSSBOUND_TINT, accent: MOSSBOUND_OCHRE },
  { id: "tideworn_sword", asset: "miniboss_sword", tier: 10, tint: TIDEWORN_TINT, accent: TIDEWORN_TEAL },
  { id: "tideworn_staff", asset: "miniboss_staff", tier: 10, tint: TIDEWORN_TINT, accent: TIDEWORN_TEAL },
  { id: "cinderwake_sword", asset: "miniboss_sword", tier: 20, tint: CINDERWAKE_TINT, accent: CINDERWAKE_CRIMSON },
  { id: "cinderwake_staff", asset: "miniboss_staff", tier: 20, tint: CINDERWAKE_TINT, accent: CINDERWAKE_CRIMSON },
];

/** Visible-slot ids that still lack a mesh. Accessories are intentionally indirect. */
export const GEAR_ASSET_GAPS: Readonly<Record<ItemId, string>> = {};

function outfitPart(kit: OutfitKit, part: OutfitPart, tint: number, accent?: number): PartSpec {
  return accent === undefined
    ? { kind: "outfit", kit, part, tint }
    : { kind: "outfit", kit, part, tint, accent };
}

function weaponPart(assetId: WeaponAsset, tint: number, scale: number, accent?: number): PartSpec {
  return accent === undefined
    ? { kind: "weapon", assetId, tint, scale }
    : { kind: "weapon", assetId, tint, scale, accent };
}

function buildTable(): Map<ItemId, GearVisual> {
  const table = new Map<ItemId, GearVisual>();

  // Tier 0, outside the LADDER because it is one weapon and no kit. `tierSilhouetteScale(0)` clamps
  // to the tier-1 value of 0.900, so the worn blade would draw exactly as big as a Grithe sword;
  // 0.86 of that keeps it visibly smaller. WORN gives its metal a dull brown iron colour; the
  // Grithe upgrade has a brighter bronze finish.
  table.set("worn_sword", {
    slot: "mainHand",
    parts: [weaponPart("corealm_sword_1", WORN, round3(tierSilhouetteScale(1) * 0.86))],
  });

  // Both starter weapons are plain brown and unlit.
  table.set("basic_wooden_wand", {
    slot: "mainHand",
    parts: [weaponPart("corealm_wand_1", WORN, 1)],
  });
  table.set("basic_wooden_staff", {
    slot: "mainHand",
    parts: [weaponPart("corealm_staff_1", WORN, 1)],
  });

  for (const row of LADDER) {
    const silhouette = tierSilhouetteScale(row.tier);
    for (const hand of row.mainHand) {
      table.set(hand.id, {
        slot: "mainHand",
        parts: [weaponPart(
          hand.asset,
          row.weapon,
          (hand.scale ?? 1) * (hand.fixedScale ? 1 : silhouette),
          row.weaponAccent,
        )],
      });
    }
    if (row.offHand) {
      // The four boards carry their own size and construction progression, so the tier silhouette
      // factor is not applied again. `offHandTint` now describes the iron rim and boss only: the
      // board, its battens and its leather grip are authored wood and leather and keep their
      // colour through the tint pipeline.
      table.set(row.offHand.id, {
        slot: "offHand",
        parts: [weaponPart(row.offHand.asset, row.offHandTint ?? row.weapon, 1)],
      });
    }

    const headPart: OutfitPart = row.kit === "knight" ? "helmet" : "hood";
    table.set(row.head, {
      slot: "head",
      parts: [outfitPart(row.kit, headPart, row.cloth, row.clothAccent)],
    });

    const bodyParts: PartSpec[] = [outfitPart(row.kit, "chest", row.cloth, row.clothAccent)];
    bodyParts.push(outfitPart(row.kit, "pauldron", row.cloth, row.clothAccent));
    if (row.kit === "knight") bodyParts.push(outfitPart("knight", "scarf", row.cloth, row.clothAccent));
    table.set(row.body, { slot: "body", parts: bodyParts });

    table.set(row.legs, { slot: "legs", parts: [outfitPart(row.kit, "legs", row.cloth, row.clothAccent)] });
    table.set(row.feet, { slot: "feet", parts: [outfitPart(row.kit, "boots", row.cloth, row.clothAccent)] });
    table.set(row.hands, { slot: "hands", parts: [outfitPart(row.kit, "gloves", row.cloth, row.clothAccent)] });

    for (const [index, id] of row.accessories.entries()) {
      table.set(id, { slot: index === 0 ? "accessory1" : "accessory2", parts: [] });
    }
  }

  for (const rare of RARE_WEAPON_VISUALS) {
    const swordScale = round3(tierSilhouetteScale(rare.tier));
    table.set(rare.id, {
      slot: "mainHand",
      parts: [weaponPart(
        rare.asset,
        rare.tint,
        rare.asset === "miniboss_staff" ? 1 : swordScale,
        rare.accent,
      )],
    });
  }

  return table;
}

const GEAR_VISUALS = buildTable();

/** Carried gathering tools shown only while their activity is running. */
const GATHERING_TOOL_APPEARANCES = new Map<ItemId, GearAppearance>([
  ["worn_pickaxe", { assetId: "pickaxe", slot: "mainHand", attach: "bone", tint: WORN, scale: 0.84 }],
  ["grithe_pickaxe", { assetId: "pickaxe", slot: "mainHand", attach: "bone", tint: GRITHE, scale: tierSilhouetteScale(1) }],
  ["corven_pickaxe", { assetId: "pickaxe", slot: "mainHand", attach: "bone", tint: CORVEN, scale: tierSilhouetteScale(5) }],
  ["kaldite_pickaxe", { assetId: "pickaxe", slot: "mainHand", attach: "bone", tint: KALDITE, scale: tierSilhouetteScale(10), accent: KALDITE_GARNET }],
  ["worn_hatchet", { assetId: "corealm_axe_1", slot: "mainHand", attach: "bone", tint: WORN, scale: 0.84 }],
  ["grithe_hatchet", { assetId: "corealm_axe_1", slot: "mainHand", attach: "bone", tint: GRITHE, scale: tierSilhouetteScale(1) }],
  ["corven_hatchet", { assetId: "corealm_axe_1", slot: "mainHand", attach: "bone", tint: CORVEN, scale: tierSilhouetteScale(5) }],
  ["kaldite_hatchet", { assetId: "corealm_axe_1", slot: "mainHand", attach: "bone", tint: KALDITE, scale: tierSilhouetteScale(10), accent: KALDITE_GARNET }],
  ["emberite_pickaxe", { assetId: "pickaxe", slot: "mainHand", attach: "bone", tint: EMBERITE, scale: tierSilhouetteScale(20), accent: EMBERITE_OPAL }],
  ["emberite_hatchet", { assetId: "corealm_axe_1", slot: "mainHand", attach: "bone", tint: EMBERITE, scale: tierSilhouetteScale(20), accent: EMBERITE_OPAL }],
]);

/** Appearance of a carried pickaxe or hatchet while gathering, if the item is one. */
export function gatheringToolAppearance(itemId: ItemId): GearAppearance | null {
  return GATHERING_TOOL_APPEARANCES.get(itemId) ?? null;
}

/** Every equipment id this file covers. The equipment test compares it with the content table. */
export const GEAR_APPEARANCE_IDS: readonly ItemId[] = [...GEAR_VISUALS.keys()];

/**
 * Every distinct registered asset the current rows can ask for, so a rig can warm them before equip.
 *
 * This exists because of a measured stall, not a hunch. Instrumenting `CharacterRig.attachBoneSlot`
 * with `performance.now()` in a headless run: `applyEquipment` fired 1 ms after the equip landed in
 * the store, and then `assets.load("sword")` took 3366 ms and `assets.load("shield")` 5918 ms on
 * first request. For those seconds the player equips a sword and their hand stays empty, which
 * reads exactly like the render seam still being unwired. Second request: 3 ms, from the cache.
 *
 * Both pack weapon GLBs are included so a starter wand and a later staff do not appear late.
 */
export function gearAssetIds(body: CharacterBody = "male"): readonly string[] {
  const ids = new Set<string>();
  for (const visual of GEAR_VISUALS.values()) {
    for (const spec of visual.parts) {
      ids.add(resolve(spec, visual.slot, body).assetId);
    }
  }
  for (const appearance of GATHERING_TOOL_APPEARANCES.values()) ids.add(appearance.assetId);
  return [...ids];
}

function resolve(spec: PartSpec, slot: EquipSlot, body: CharacterBody): GearAppearance {
  if (spec.kind === "weapon") {
    const appearance: GearAppearance = {
      assetId: spec.assetId, slot, attach: "bone", tint: spec.tint, scale: round3(spec.scale),
    };
    if (spec.accent !== undefined) appearance.accent = spec.accent;
    return appearance;
  }
  const appearance: GearAppearance = {
    assetId: `outfit_${body}_${spec.kit}_${spec.part}`, slot, attach: "skin", tint: spec.tint,
  };
  if (spec.accent !== undefined) appearance.accent = spec.accent;
  return appearance;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The appearance for an item, or null when it has no mesh (accessories — see
 * `GEAR_ASSET_GAPS`) or is not equipment at all.
 *
 * `body` is optional so the frozen one-argument call site keeps working; it defaults to male
 * because that is what `boot.ts` builds the player as today. When an item resolves to more than one
 * part (tier 5 and 10 body pieces carry a pauldron) this returns the FIRST — call
 * `gearAppearanceParts` to get all of them.
 */
export function gearAppearance(itemId: ItemId, body: CharacterBody = "male"): GearAppearance | null {
  const parts = gearAppearanceParts(itemId, body);
  return parts[0] ?? null;
}

/** Every part an item contributes, in attach order. Empty for a covered id with no mesh. */
export function gearAppearanceParts(itemId: ItemId, body: CharacterBody = "male"): readonly GearAppearance[] {
  const visual = GEAR_VISUALS.get(itemId);
  if (!visual) return [];
  return visual.parts.map((spec) => resolve(spec, visual.slot, body));
}

interface OrbPalette {
  element: GearOrbElement;
  colour: number;
  emissive: number;
}

const ORB_PALETTES: Readonly<Record<string, OrbPalette>> = {
  air_wand: { element: "wind", colour: 0xd6fbff, emissive: 0x79edff },
  air_staff: { element: "wind", colour: 0xd6fbff, emissive: 0x79edff },
  earth_wand: { element: "earth", colour: 0xd5b558, emissive: 0x83bd50 },
  earth_staff: { element: "earth", colour: 0xd5b558, emissive: 0x83bd50 },
  water_wand: { element: "water", colour: 0x6cbcff, emissive: 0x197ce8 },
  water_staff: { element: "water", colour: 0x6cbcff, emissive: 0x197ce8 },
  fire_wand: { element: "fire", colour: 0xffba59, emissive: 0xf4691c },
  fire_staff: { element: "fire", colour: 0xffba59, emissive: 0xf4691c },
};

/**
 * Root-local elemental core sockets.
 *
 * Every Corealm staff grade sets its crystal at [0, 0.85, 0] and every wand grade at [0, 0.265, 0]
 * (`buildEquipmentWeapon`'s `userData.elementalSocket`, verified against the exported bounds). The
 * radii are a little wider than the authored crystal, 0.170 m and 0.084 m tall, so a charged core
 * reads as a shell wrapping the set stone rather than a second solid coincident with it.
 */
const STAFF_ORB = { position: [0, 0.85, 0] as const, radius: 0.098 };
const WAND_ORB = { position: [0, 0.265, 0] as const, radius: 0.053 };
const ORB_SOCKETS: Readonly<Record<string, {
  position: readonly [number, number, number];
  radius: number;
}>> = {
  corealm_staff_1: STAFF_ORB, corealm_staff_2: STAFF_ORB,
  corealm_staff_3: STAFF_ORB, corealm_staff_4: STAFF_ORB,
  corealm_wand_1: WAND_ORB, corealm_wand_2: WAND_ORB,
  corealm_wand_3: WAND_ORB, corealm_wand_4: WAND_ORB,
};

/** Adds the crafted elemental core to a magic weapon. */
export function gearAppearancePartsWithCharge(
  itemId: ItemId,
  charge: GearWeaponChargePresentation,
  body: CharacterBody = "male",
): readonly GearAppearance[] {
  const parts = gearAppearanceParts(itemId, body);
  const palette = charge.itemId === itemId ? ORB_PALETTES[itemId] : undefined;
  if (!palette) return parts;
  return parts.map((part) => {
    const socket = ORB_SOCKETS[part.assetId];
    if (!socket) return part;
    return {
      ...part,
      orb: {
        ...palette,
        charged: charge.charged,
        position: socket.position,
        radius: socket.radius,
      },
    };
  });
}

// ------------------------------------------------------------------------ hand sockets

/**
 * Where a rigid weapon sits in its hand bone.
 *
 * Every number here is measured off game/public/assets/models/character/base_male.glb and the four
 * weapon GLBs, not guessed. In `hand_r` local space the finger roots run along +Y (middle_01_r at
 * (-0.005, 0.115, +0.015)), the knuckle line is the Z axis (index_01_r z +0.041, pinky_01_r z
 * -0.035) and the palm normal is -X (thumb_03_r at x -0.064). A closed fist therefore grips along
 * LOCAL Z, and its centre is about (-0.010, 0.085, 0.000). `hand_l` is the exact mirror (thumb at
 * +X), so the shield's face normal must leave along -X to sit on the back of the hand.
 *
 * Euler XYZ in Three composes as Rx*Ry*Rz (verified numerically against THREE.Quaternion), so:
 *   (PI/2, 0, 0)     maps asset +Y -> local +Z and asset +X -> local +X
 *   (PI/2, PI/2, 0)  maps asset +Y -> local +Z and asset +X -> local +Y
 *   (PI/2, -PI/2, 0) maps asset +Y -> local +Z and asset +Z -> local -X
 *
 * Asset bounds, decoded from the quantised POSITION accessors with the node transform applied:
 *   sword    y [-0.208, +0.924], origin at the guard, grip centre y = -0.10
 *   axe      y [-0.381, +0.446] after its -90 deg Z node rotation, grip centre y = -0.25
 *   pickaxe  y [-0.494, +0.704], head spread across x [-0.410, +0.403], grip centre y = -0.15
 *   shield   face in XY, boss toward +Z, grip bar at z [-0.001, +0.044], centre z = +0.022
 * The offset is `fistCentre - R * gripCentre`, which is where each Z component below comes from.
 *
 * The pack weapons also point along asset +Y. Their grip offsets use a point 12% above the lower
 * bound, which keeps a short butt below the fist and most of the shaft above it.
 *
 * The previous shared constant (characterRig.ts: rotation (PI/2,0,0), position (0, 0.03, 0.04))
 * put the sword's entire 21 cm grip and pommel outside the fist with only the guard touching it.
 *
 * `scale` is the fit scale of the ASSET and is 1 for all four: the GLBs are already at metre scale.
 * The final size is `socket.scale * appearance.scale`. Because a scaled child shrinks toward its
 * own origin, the grip half of the offset has to shrink with it: at the dagger's smallest applied
 * scale (0.62 * 0.900 = 0.558) an uncompensated socket puts the grip centre 4.4 cm from the fist
 * centre, past the fist's 3.8 cm half-span, i.e. visibly floating off the pommel end. That is what
 * `weaponAttachment` exists for; `weaponSocket` is the frozen scale-1 form.
 */
interface WeaponSocket {
  bone: string;
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  scale: number;
}

/** Fist centre in hand-bone local space. `hand_l` is the mirror of `hand_r` about X. */
const FIST_RIGHT: readonly [number, number, number] = [-0.010, 0.085, 0.000];
const FIST_LEFT: readonly [number, number, number] = [0.010, 0.085, 0.000];

interface SocketParts {
  bone: string;
  /** Anchor in bone-local space. A fist centre for held gear, a strap point for a worn shield. */
  fist: readonly [number, number, number];
  grip: readonly [number, number, number];
  rotation: readonly [number, number, number];
  /**
   * Asset fit scale, applied on top of the tier scale a caller asks for. 1 for every asset whose
   * modelled size is already right for a 1.81 m body. The pickaxe is the exception: its head spans
   * 0.813 m at scale 1, so the tier-10 and tier-20 rows drew a 0.94-1.00 m head, over twice the
   * rig's 0.42 m shoulder span. The grip offset scales with `fit * requested`, because a scaled
   * child shrinks toward its own origin.
   */
  fit?: number;
}

/** Where the grip centre lands relative to the asset origin AFTER `rotation`, at scale 1. */
const SOCKET_PARTS: Readonly<Record<string, SocketParts>> = {
  sword: { bone: "hand_r", fist: FIST_RIGHT, grip: [0, 0, 0.100], rotation: [Math.PI / 2, 0, 0] },
  // Shared by all four dagger grades: every grade keeps its grip centre at asset y = -0.100.
  dagger: { bone: "hand_r", fist: FIST_RIGHT, grip: [0, 0, 0.100], rotation: [Math.PI / 2, 0, 0] },
  axe: { bone: "hand_r", fist: FIST_RIGHT, grip: [0, 0, 0.250], rotation: [Math.PI / 2, 0, 0] },
  pickaxe: { bone: "hand_r", fist: FIST_RIGHT, grip: [0, 0, 0.150], rotation: [Math.PI / 2, Math.PI / 2, 0], fit: 0.68 },
  // Strapped to the forearm, not dangled from the fist. `rotation` is unchanged and still sends
  // asset +Z (the boss) to local -X, which is the back-of-hand side; only the anchor moved.
  //
  // Held at `hand_l` the board's back plane sat at local x = +0.035 while the forearm runs along
  // x = 0 with a ~0.045 m radius, so the arm came out through the face of the shield -- visible as
  // the forearm crossing the boards in every left-side view, and as the board swinging away from
  // the body like a tray whenever the melee clip raised the hand. `lowerarm_l` local +Y runs
  // elbow (0) to wrist (0.244); the anchor centres the board over the middle of that span and
  // stands its inner face 0.060 m clear of the bone, which clears the arm with ~0.015 m to spare.
  shield: {
    bone: "lowerarm_l", fist: [-0.060, 0.120, 0], grip: [0, 0, 0],
    rotation: [Math.PI / 2, -Math.PI / 2, 0],
  },
  /**
   * The Corealm boards, which are taller than they are wide and pointed at the bottom, so unlike
   * the round import they need their long axis to run down the body rather than across the arm.
   *
   * Euler (0, -PI/2, PI) sends asset +Z (the boss) to local -X, the back-of-hand side, and asset +Y
   * (the wide top of the board) to local -Y, which is toward the elbow and shoulder while the arm
   * hangs. The point therefore hangs past the wrist. The anchor stands the board's rear plane
   * 0.075 m clear of the forearm axis, so the visible face never meets the arm; the enarme bar and
   * standoffs, which sit 0.045-0.065 m behind that plane, land inside the forearm, which is where
   * an arm actually goes through a strapped shield.
   */
  corealm_shield: {
    bone: "lowerarm_l", fist: [-0.075, 0.100, 0], grip: [0, 0, 0],
    rotation: [0, -Math.PI / 2, Math.PI],
  },
  /**
   * The Corealm staff grades put their leather grip across the origin (`handle(-0.14, 0.14)`), so
   * the grip offset along the shaft is zero. The lateral pair is inherited from the reviewed
   * imported-staff socket and is what keeps the shaft off the torso from above.
   */
  corealm_staff: {
    bone: "hand_r", fist: FIST_RIGHT, grip: [0.043, -0.021, 0],
    rotation: [Math.PI * 0.53, 0, -Math.PI * 0.06],
  },
  /**
   * The wand grades hold their handle across the origin too.
   *
   * They are modelled at 0.407-0.437 m, which is a wand rather than the import's 0.79 m baton, but
   * at that size an uncharged wand almost disappeared at the gameplay camera in the lab. A 1.22 fit
   * brings them to 0.50-0.53 m: still unmistakably a wand beside a 1.03 m sword, and its crystal is
   * large enough to find.
   */
  corealm_wand: {
    bone: "hand_r", fist: FIST_RIGHT, grip: [0, 0, 0], rotation: [Math.PI / 2, 0, 0], fit: 1.22,
  },
  // The imported rare weapons keep their authored grip pivots: the sword's crossguard sits exactly
  // on its origin (grip centre a hand-width down the handle), and the staff's grip is its origin.
  // Verified in the feature lab, like every other socket in this table.
  miniboss_sword: {
    // Rx(-90) rather than the CC0 sword's Rx(+90): the imported blade runs +Y from a crossguard
    // origin, and the first lab sweep showed +90 hanging it point-down into the ground. With the
    // flip the handle (-Y) lands at +Z, so the grip centre sits a hand-width up the handle.
    bone: "hand_r", fist: FIST_RIGHT, grip: [0, 0, 0.100], rotation: [-Math.PI / 2, 0, 0],
  },
  /**
   * Every `proc_rod_*` model from `render/proceduralGear.ts`. Y-up with the grip already at the
   * origin, so the grip offset is zero and the butt, reel, guides and line hang off that point.
   * This entry pins what the rod was authored against ("+Z becomes downward with the existing hand
   * attachment", `proceduralGearModels.buildFishingRod`); before it, the rod was riding
   * `CharacterRig.socketFor`'s unmeasured fallback and any change there would have moved it.
   */
  fishing_rod: { bone: "hand_r", fist: FIST_RIGHT, grip: [0, 0, 0], rotation: [Math.PI / 2, 0, 0] },
  miniboss_staff: {
    // The mesh origin sits at the authored grip just under the crystal, i.e. near the TOP of the
    // 1.75 m shaft. Holding the origin put the crystal at fist height with the foot dragging the
    // ground (first lab sweep); 0.55 m down the shaft holds it mid-staff like the pack staffs,
    // crystal above the shoulder, foot clear of the ground.
    bone: "hand_r", fist: FIST_RIGHT, grip: [0.043, -0.021, 0.55],
    rotation: [Math.PI * 0.53, 0, -Math.PI * 0.06],
  },
};

/**
 * The socket table entry for an asset, after the aliases.
 *
 * The four promoted sword grades share the reviewed sword grip; the promoted axe shares the axe
 * grip; and every generated fishing rod shares one rod grip.
 */
function socketPartsFor(assetId: string): SocketParts | undefined {
  if (/^corealm_sword_[1-4]$/.test(assetId)) return SOCKET_PARTS["sword"];
  if (/^corealm_dagger_[1-4]$/.test(assetId)) return SOCKET_PARTS["dagger"];
  if (/^corealm_shield_[1-4]$/.test(assetId)) return SOCKET_PARTS["corealm_shield"];
  if (/^corealm_staff_[1-4]$/.test(assetId)) return SOCKET_PARTS["corealm_staff"];
  if (/^corealm_wand_[1-4]$/.test(assetId)) return SOCKET_PARTS["corealm_wand"];
  if (assetId === "corealm_axe_1") return SOCKET_PARTS["axe"];
  if (assetId.startsWith("proc_rod_")) return SOCKET_PARTS["fishing_rod"];
  return SOCKET_PARTS[assetId];
}

function socketAt(assetId: string, requested: number): WeaponSocket | null {
  const parts = socketPartsFor(assetId);
  if (!parts) return null;
  const fit = parts.fit ?? 1;
  const scale = fit * requested;
  return {
    bone: parts.bone,
    position: [
      round3(parts.fist[0] + parts.grip[0] * scale),
      round3(parts.fist[1] + parts.grip[1] * scale),
      round3(parts.fist[2] + parts.grip[2] * scale),
    ],
    rotation: parts.rotation,
    scale: round3(fit),
  };
}

/** The socket at the asset's own fit scale. Prefer `weaponAttachment` when the part is scaled. */
export function weaponSocket(assetId: string): WeaponSocket | null {
  return socketAt(assetId, 1);
}

/**
 * The socket with the grip offset corrected for an applied scale, and `scale` already multiplied
 * out. This is what a rig should call: pass the `GearAppearance` it is about to attach.
 */
export function weaponAttachment(appearance: GearAppearance): WeaponSocket | null {
  const requested = appearance.scale ?? 1;
  const socket = socketAt(appearance.assetId, requested);
  if (!socket) return null;
  return { ...socket, scale: round3(socket.scale * requested) };
}

// ------------------------------------------------------------------------ tinting

/**
 * Recolours an attached part in place.
 *
 * The material is CLONED first: every part comes out of `AssetRegistry.load`, which hands back the
 * same cached GLTF scene to every caller, so tinting in place would repaint every other user of
 * that asset — including the NPCs wearing the same peasant set. Dispose the clones with
 * `skinning.disposeGraph(part, { materials: true })` when the slot is swapped.
 *
 * Cloning a material does not cost a draw call; two meshes with different materials were already
 * two draws.
 */
export function applyGearAppearance(object: THREE.Object3D, appearance: GearAppearance): void {
  if (appearance.tint !== undefined || appearance.accent !== undefined) {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((material) => tintedMaterial(material, appearance))
        : tintedMaterial(mesh.material, appearance);
    });
  }
  if (appearance.orb) object.add(magicOrbMesh(appearance.orb));
}

function tintedMaterial(material: THREE.Material, appearance: GearAppearance): THREE.Material {
  const clone = material.clone();
  // Three does not copy compile callbacks. Keep the source's authored surface shader when
  // applying a tier, as MaterialManager's variants do for other production assets.
  clone.onBeforeCompile = (shader, renderer) => material.onBeforeCompile.call(material, shader, renderer);
  clone.customProgramCacheKey = material.customProgramCacheKey.bind(material);
  const shaded = clone as Partial<THREE.MeshStandardMaterial>;
  const role = material.userData["equipmentRole"] as string | undefined;
  const tintable = role !== "leather" && role !== "gem" && role !== "wood";
  if (tintable && appearance.tint !== undefined && shaded.color instanceof THREE.Color) {
    shaded.color.setHex(appearance.tint);
  }
  if (appearance.accent !== undefined && shaded.emissive instanceof THREE.Color) {
    // Accents belong to an authored light mask or a separate setting. A uniform emissive cast
    // over a steel blade hides its edge and makes its leather grip glow.
    const localized = Boolean(shaded.emissiveMap) || role === "gem";
    shaded.emissive.setHex(localized ? appearance.accent : 0x000000);
    shaded.emissiveIntensity = localized ? (shaded.emissiveMap ? 1.2 : 0.18) : 0;
    if (role === "gem" && shaded.color instanceof THREE.Color) shaded.color.setHex(appearance.accent);
  }
  if (isRangerOutfitAsset(appearance.assetId)
    && appearance.tint !== undefined
    && shaded.color instanceof THREE.Color) {
    applyRangerTierColour(clone, appearance.tint);
  }
  if (appearance.assetId === "miniboss_sword" || appearance.assetId === "miniboss_staff") {
    // Keep the native normal and emissive maps. The neutralized albedo still supplies the edge,
    // runes and fittings; the regional colour should not turn its light edges into a solid stripe.
    if (!shaded.metalnessMap) shaded.metalness = appearance.assetId === "miniboss_sword" ? 0.58 : 0.28;
    if (!shaded.roughnessMap) shaded.roughness = appearance.assetId === "miniboss_sword" ? 0.40 : 0.52;
    if (appearance.tint !== undefined) applyRareTierColour(clone, appearance.tint);
  } else if (appearance.tint !== undefined && shaded.color instanceof THREE.Color) {
    const source = material as THREE.MeshStandardMaterial;
    if (shaded.metalnessMap && tintable
      && (isKnightOutfitAsset(appearance.assetId) || ["sword", "axe", "pickaxe", "corealm_axe_1"].includes(appearance.assetId)
        || /^corealm_sword_[1-4]$/.test(appearance.assetId))) {
      applyMetalTierColour(clone, source, appearance.tint, isKnightOutfitAsset(appearance.assetId) ? 0.22 : 0.10);
    }
  }
  // CharacterRig merges modular parts by material name and base colour. Shader-owned colour is
  // white, so include treatment identity in the name to keep mixed armour tiers distinct.
  clone.name = `${material.name || material.type}|gear:${appearance.tint ?? "native"}:${appearance.accent ?? "none"}`;
  clone.needsUpdate = true;
  return clone;
}

function isRangerOutfitAsset(assetId: string): boolean {
  return assetId.startsWith("outfit_male_ranger_") || assetId.startsWith("outfit_female_ranger_");
}

function isKnightOutfitAsset(assetId: string): boolean {
  return assetId.startsWith("outfit_male_knight_") || assetId.startsWith("outfit_female_knight_");
}

/**
 * UV-weighted source samples put metal luminance near .10 for the bronze weapons, .061 for
 * shield fittings and .22 for Knight plate. These references restore a shared tier colour while
 * retaining dark seams, bright wear, native map colour and all authored roughness/normal detail.
 */
function applyMetalTierColour(
  material: THREE.Material,
  source: THREE.MeshStandardMaterial,
  tint: number,
  reference: number,
): void {
  const shaded = material as THREE.MeshStandardMaterial;
  shaded.color.copy(source.color);
  shaded.emissive.copy(source.emissive);
  shaded.emissiveIntensity = source.emissiveIntensity;
  const inheritedCompile = material.onBeforeCompile;
  const inheritedCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer): void => {
    inheritedCompile.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `
      vec3 gearMetalSource = diffuseColor.rgb;
      #include <color_fragment>
      #if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
        gearMetalSource *= dot(vColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      #endif
    `);
    shader.fragmentShader = shader.fragmentShader.replace("#include <metalnessmap_fragment>", `
      #include <metalnessmap_fragment>
      float gearMetalMask = smoothstep(0.20, 0.70, metalnessFactor);
      float gearMetalLuma = dot(gearMetalSource, vec3(0.2126, 0.7152, 0.0722));
      float gearMetalWear = max(pow(max(gearMetalLuma, 0.0001) / ${reference.toFixed(3)}, 0.80), 0.08);
      vec3 gearMetalColour = ${glslColour(tint)} * 0.72 * gearMetalWear
        * gearMetalSource / max(gearMetalLuma, 0.001);
      vec3 gearMetalHighlight = max(gearMetalColour - vec3(0.78), vec3(0.0));
      gearMetalColour = min(gearMetalColour, vec3(0.78))
        + 0.17 * gearMetalHighlight / (vec3(0.17) + gearMetalHighlight);
      diffuseColor.rgb = mix(diffuseColor.rgb, gearMetalColour, gearMetalMask);
    `);
  };
  material.customProgramCacheKey = (): string => `${inheritedCacheKey()}|metal-tier:${tint}:${reference}`;
}

/** Regional colour stays strongest in the midtones; worn bright edges keep a steel reflection. */
function applyRareTierColour(material: THREE.Material, tint: number): void {
  const shaded = material as THREE.MeshStandardMaterial;
  if (!(shaded.color instanceof THREE.Color)) return;
  shaded.color.setHex(0xffffff);
  patchGearShader(material, `rare-tier:${tint}`, `
    float gearRareLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float gearRareEdge = smoothstep(0.38, 0.80, gearRareLuma);
    vec3 gearRareColour = mix(${glslColour(tint)}, vec3(0.78, 0.83, 0.87), gearRareEdge * 0.62);
    diffuseColor.rgb *= gearRareColour;
  `);
}

function glslColour(tint: number): string {
  const colour = new THREE.Color(tint);
  return `vec3(${colour.r.toFixed(6)}, ${colour.g.toFixed(6)}, ${colour.b.toFixed(6)})`;
}

function patchGearShader(material: THREE.Material, key: string, colour: string, roughness = ""): void {
  const inheritedCompile = material.onBeforeCompile;
  const inheritedCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer): void => {
    inheritedCompile.call(material, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>${colour}`);
    if (roughness) {
      shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>${roughness}`);
    }
  };
  material.customProgramCacheKey = (): string => `${inheritedCacheKey()}|${key}`;
}

/**
 * Rehues Ranger's nearly black albedo without using emissive light.
 *
 * A uniform emissive lift made every normal face equally bright, which erased the hood folds,
 * chest planes, straps, and boot shape. This fragment pass reads the authored texture and vertex
 * colour luminance, maps that value into the tier hue, then leaves Three's normal PBR lighting to
 * shade the result. A soft luminance expansion keeps the cloth folds, while warm source pixels
 * retain the leather colour. There is no emissive lift.
 */
function applyRangerTierColour(material: THREE.Material, tint: number): void {
  const shaded = material as Partial<THREE.MeshStandardMaterial>;
  if (!(shaded.color instanceof THREE.Color)) return;

  // The shader below owns the tier colour. White lets it measure the unmodified source albedo.
  shaded.color.setHex(0xffffff);
  if (shaded.emissive instanceof THREE.Color) {
    shaded.emissive.setHex(0x000000);
    shaded.emissiveIntensity = 0;
  }

  const colour = new THREE.Color(tint);
  const colourLiteral = `vec3(${colour.r.toFixed(6)}, ${colour.g.toFixed(6)}, ${colour.b.toFixed(6)})`;
  const inheritedCompile = material.onBeforeCompile;
  const inheritedCacheKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer): void => {
    inheritedCompile.call(material, shader, renderer);
    const marker = "#include <color_fragment>";
    if (!shader.fragmentShader.includes(marker)) return;
    shader.fragmentShader = shader.fragmentShader.replace(marker, `${marker}
      float gearTierSourceLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      float gearTierValue = clamp(pow(max(gearTierSourceLuma, 0.001) / 0.14, 0.72), 0.18, 1.32);
      // Leather has to be BROWN, not merely warm. The old mask was red-minus-blue alone, which is
      // positive for the hood's mossy green, the tan boots and the pauldron fur, so those three
      // parts kept their source colour at every tier: Hide and Heavy Hide were identical above the
      // waist in the lab. Requiring red over green as well leaves straps and belts protected and
      // lets dyed cloth take the tier.
      float gearWarm = smoothstep(0.012, 0.065, diffuseColor.r - diffuseColor.b);
      float gearBrown = smoothstep(0.000, 0.030, diffuseColor.r - diffuseColor.g);
      float gearLeatherMask = gearWarm * gearBrown;
      vec3 gearClothColour = ${colourLiteral} * gearTierValue;
      // Even protected leather carries some of the tier, or a full hide set reads as one dye lot
      // with brown accessories bolted on.
      vec3 gearLeatherColour = mix(diffuseColor.rgb * 1.32, gearClothColour * 1.15, 0.42);
      diffuseColor.rgb = mix(gearClothColour, gearLeatherColour, gearLeatherMask * 0.88);
    `);
  };
  material.customProgramCacheKey = (): string => (
    `${inheritedCacheKey()}|ranger-tier-colour:${tint.toString(16)}`
  );
  material.needsUpdate = true;
}

/** A cut crystal with a bevelled girdle and finished facets; geometry is shared for the session. */
const MAGIC_ORB_GEOMETRY = buildEquipmentCoreGeometry();

function magicOrbMesh(appearance: GearOrbAppearance): THREE.Mesh {
  const charged = appearance.charged;
  const material = new THREE.MeshPhysicalMaterial({
    color: charged ? appearance.colour : 0x384044,
    emissive: charged ? appearance.emissive : 0x000000,
    emissiveIntensity: charged ? 0.72 : 0,
    metalness: charged ? 0.03 : 0.12,
    roughness: charged ? 0.17 : 0.39,
    clearcoat: 0.88,
    clearcoatRoughness: 0.12,
    vertexColors: true,
    transparent: true,
    opacity: charged ? 0.97 : 0.66,
    depthWrite: true,
  });
  const orb = new THREE.Mesh(MAGIC_ORB_GEOMETRY, material);
  orb.name = `magic-weapon-socket-${appearance.element}-${charged ? "charged" : "empty"}`;
  orb.position.set(...appearance.position);
  orb.rotation.set(0.34, 0.51, 0.18);
  orb.scale.setScalar(appearance.radius);
  orb.castShadow = false;
  orb.receiveShadow = false;
  return orb;
}
