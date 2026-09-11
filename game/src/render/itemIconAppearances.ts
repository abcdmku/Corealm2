/**
 * The source of truth for item icon geometry.
 *
 * ItemDef stays a gameplay contract. Icon art belongs to the render layer, so this table resolves
 * every current item id to either an existing GLB or one small procedural model family. There is
 * deliberately no category fallback: adding an item without deciding what it looks like fails at
 * module load and in tests instead of silently shipping the wrong picture.
 */
import type { ItemDef, ItemId } from "../contracts.js";
import { ALL_ITEMS } from "../content/items.js";
import { TREE_SPECIES } from "../content/treeSpecies.js";
import {
  gatheringToolAppearance, gearAppearanceParts, gearAppearancePartsWithCharge,
  wornTrimRestTransform, type GearAppearance,
} from "./equipmentVisuals.js";
import { paletteForTier } from "./materials.js";
import { fishingRodAssetId } from "./proceduralGear.js";

export type ItemIconPrimitive =
  | "amulet"
  | "antler"
  | "antler-palm"
  | "claw"
  | "cord"
  | "dagger"
  | "essence"
  | "egg"
  | "feather"
  | "fish"
  | "handle"
  | "gland"
  | "hide"
  | "horn"
  | "ingot"
  | "log"
  | "orb"
  | "meat"
  | "quill"
  | "ring"
  | "rod"
  | "seed"
  | "scute"
  | "shell"
  | "shaft"
  | "staff"
  | "tuft";

export interface ItemIconAssetPart {
  kind: "asset";
  assetId: string;
  colour?: number;
  accent?: number;
  scale?: number;
  /** Exact production equipment treatment, including its charged or depleted crystal. */
  gearAppearance?: GearAppearance;
  /**
   * Where a worn piece sits in the character's own space. Set for the additive armour tier pieces,
   * which are authored around a torso or hip joint rather than in the bind pose the skinned outfit
   * parts already carry, so without it a neck piece and a hip piece stack up at the origin.
   */
  wornRest?: { position: readonly [number, number, number]; rotation: readonly [number, number, number] };
}

export interface ItemIconPrimitivePart {
  kind: "primitive";
  primitive: ItemIconPrimitive;
  colour: number;
  accent?: number;
  /** Stable anatomical variation within a finished material family. */
  variant?: number;
}

export type ItemIconPart = ItemIconAssetPart | ItemIconPrimitivePart;

export interface ItemIconAppearance {
  itemId: ItemId;
  parts: readonly ItemIconPart[];
  /** Extra empty space around this item after the common projected-bounds fit. */
  frameScale?: number;
  /** Corrects an authored model's pose while leaving the shared camera fixed. */
  rotation?: readonly [number, number, number];
  /** Compact inventory staging of the authored hand/cuff geometry. */
  presentation?: "paired-hands";
}

export interface ItemIconPresentationState {
  /** Omit for canonical item art; elemental items show their charged identity by default. */
  charged?: boolean;
}

const APPEARANCES = new Map<ItemId, ItemIconAppearance>();
const BY_ID = new Map(ALL_ITEMS.map((item) => [item.id, item] as const));

function def(id: ItemId): ItemDef {
  const item = BY_ID.get(id);
  if (!item) throw new Error(`Unknown item icon id: ${id}`);
  return item;
}

function put(
  itemId: ItemId,
  parts: readonly ItemIconPart[],
  options: Pick<ItemIconAppearance, "frameScale" | "rotation" | "presentation"> = {},
): void {
  if (APPEARANCES.has(itemId)) throw new Error(`Duplicate item icon appearance: ${itemId}`);
  if (parts.length === 0) throw new Error(`Item icon appearance has no parts: ${itemId}`);
  APPEARANCES.set(itemId, { itemId, parts, ...options });
}

function asset(assetId: string, colour?: number, scale?: number): ItemIconAssetPart {
  return { kind: "asset", assetId, ...(colour === undefined ? {} : { colour }), ...(scale === undefined ? {} : { scale }) };
}

function primitive(
  shape: ItemIconPrimitive,
  colour: number,
  accent?: number,
  variant?: number,
): ItemIconPrimitivePart {
  return {
    kind: "primitive", primitive: shape, colour,
    ...(accent === undefined ? {} : { accent }),
    ...(variant === undefined ? {} : { variant }),
  };
}

function equipmentPart(appearance: GearAppearance): ItemIconAssetPart {
  const wornRest = wornTrimRestTransform(appearance.assetId);
  return {
    kind: "asset", assetId: appearance.assetId, gearAppearance: appearance,
    ...(appearance.scale === undefined ? {} : { scale: appearance.scale }),
    ...(wornRest === null ? {} : { wornRest }),
  };
}

function tierMetal(id: ItemId): number {
  return paletteForTier(def(id).tier).metal;
}

function tierBody(id: ItemId): number {
  return paletteForTier(def(id).tier).body;
}

function tierAccent(id: ItemId): number {
  return paletteForTier(def(id).tier).accent;
}

const WOOD: Readonly<Record<number, number>> = {
  0: 0x68472f,
  1: 0xb99a6b,
  5: 0x51372a,
  10: 0x765238,
  20: 0x4a3a30,
  30: 0x79734e, 40: 0x805638, 50: 0x79513b, 60: 0x68422f, 70: 0x625276,
};

/** Fresh end grain stays lighter than bark, including the scorched Cinderpine tier. */
const LOG_END_GRAIN: Readonly<Record<number, number>> = {
  1: 0xd9c49a,
  5: 0xb99a74,
  10: 0xcab18a,
  20: 0xa18a70,
  30: 0xd6bc85, 40: 0xe0bd86, 50: 0xcba56d, 60: 0xca9a65, 70: 0xc9b2e0,
};

function wood(id: ItemId): number {
  return WOOD[def(id).tier] ?? WOOD[1]!;
}

// Currency and gathered resources.
put("marks", [asset("coin", 0xd6a83f)], { rotation: [0.22, 0, -0.15] });
put("grithe_ore", [asset("corealm_item_grithe_ore")]);
put("march_stone", [asset("rock_small_2", 0xb8aa91)]);
put("corven_ore", [asset("corealm_item_corven_ore")]);
put("kaldite_ore", [asset("corealm_item_kaldite_ore")]);
put("emberite_ore", [asset("corealm_item_emberite_ore")]);
// These promoted deposits already carry their own mineral seams and fractured host colours.
put("cindervein_ore", [asset("corealm_ore_cindervein")]);
put("nightglass_ore", [asset("corealm_ore_nightglass")]);
put("kilnstone", [asset("rock_small_1", 0x4a443c)]);

for (const id of TREE_SPECIES.map(species => species.logId)) {
  put(id, [primitive("log", wood(id), LOG_END_GRAIN[def(id).tier])], { rotation: [0, 0, -0.2] });
}

put("silt_minnow", [primitive("fish", 0x7f98a3, 0xc4d4d7)]);
put("bramble_trout", [primitive("fish", 0x4f5962, 0x9d6d54)]);
put("cragfin", [primitive("fish", 0x53697b, 0xb9c4c5)]);
put("ashfin", [primitive("fish", 0x574a44, 0xd88a56)]);

// Processed resources and components.
for (const id of ["grithe_bar", "corven_bar", "kaldite_bar", "emberite_bar"] as const) {
  put(id, [primitive("ingot", tierMetal(id), tierBody(id))]);
}

put("pale_quartz", [asset("corealm_item_pale_quartz")]);
put("vell_amber", [asset("corealm_item_vell_amber")]);
put("cairn_garnet", [asset("corealm_item_cairn_garnet")]);
put("fire_opal", [asset("corealm_item_fire_opal")]);
for (const id of ["palewood_shaft", "duskoak_shaft", "cairnpine_shaft", "cinderpine_shaft"] as const) {
  put(id, [primitive("shaft", wood(id), tierMetal(id))], { rotation: [0, 0, -0.25] });
}
for (const id of ["palewood_handle", "duskoak_handle", "cairnpine_handle", "cinderpine_handle"] as const) {
  put(id, [primitive("handle", wood(id), tierBody(id))], { rotation: [0, 0, -0.3], frameScale: 1.08 });
}
put("coarse_hide", [primitive("hide", 0x9a7654, 0x5b4432)]);
put("bramble_hide", [primitive("hide", 0x65503d, 0x362d26)]);
put("cairn_pelt", [primitive("hide", 0x8b7f70, 0x4c443c)]);
put("charhide", [primitive("hide", 0x574840, 0x2e2622)]);

// Candidate loot remains unregistered until the root accepts its lab proof. Each row uses a
// finished material form: stone kernels, folded hide, wound thread or a worked metal component.
const WILDERNESS_MATERIAL_ICONS: readonly ItemIconAppearance[] = [
  { itemId: "cindersteel_bar", parts: [primitive("ingot", 0x8f7867, 0xc47b47)] },
  { itemId: "nightglass_bar", parts: [primitive("ingot", 0x697b98, 0xa398bf)] },
  { itemId: "molten_heart", parts: [asset("corealm_item_emberite_ore", 0xe99562)] },
  { itemId: "astral_core", parts: [asset("corealm_item_kaldite_ore", 0xa797d5)] },
  { itemId: "dragonhide", parts: [primitive("hide", 0x653c36, 0xb07550, 1)] },
  { itemId: "starhide", parts: [primitive("hide", 0x514b73, 0x9c94be, 2)] },
  { itemId: "grave_thread", parts: [primitive("cord", 0x484046, 0x968573, 0)] },
  { itemId: "void_thread", parts: [primitive("cord", 0x413d65, 0x9885ba, 2)] },
  { itemId: "teak_handle", parts: [primitive("handle", WOOD[50]!, 0x8f7867)],
    rotation: [0, 0, -0.3], frameScale: 1.08 },
  { itemId: "magic_handle", parts: [primitive("handle", WOOD[70]!, 0x697b98)],
    rotation: [0, 0, -0.3], frameScale: 1.08 },
  { itemId: "ashseal_iron", parts: [primitive("ingot", 0x735f54, 0xb48f67)], rotation: [0, 0.3, 0] },
  // The fluted production gorget supplies the crucible crown's open metal rim.
  { itemId: "furnace_crown", parts: [asset("proc_armour_collar_20", 0xb6814c)] },
  // Its dark authored metal texture needs a pale tint to keep the links visible at 48 px.
  { itemId: "chainbound_link", parts: [asset("chain_coil", 0xe4efff)], rotation: [0.35, 0, 0] },
  { itemId: "nightforge_seal", parts: [primitive("scute", 0x69758d, 0xb1abc4, 3)] },
  { itemId: "hollow_star_fragment", parts: [asset("corealm_item_pale_quartz", 0x655d89)],
    rotation: [0, 0, -0.25] },
];
for (const { itemId, parts, ...options } of WILDERNESS_MATERIAL_ICONS) {
  if (BY_ID.has(itemId)) put(itemId, parts, options);
}

/** Element colour stays consistent between the loose essence and the boss-won orb. */
const ELEMENT_COLOURS = {
  air: { body: 0x78cce8, glow: 0xd8f7ff },
  earth: { body: 0x668c43, glow: 0xb9d66b },
  water: { body: 0x327fc2, glow: 0xa9e6ff },
  fire: { body: 0xe06428, glow: 0xffcf9e },
} as const;

for (const element of ["air", "earth", "water", "fire"] as const) {
  const colours = ELEMENT_COLOURS[element];
  put(`${element}_essence`, [primitive("essence", colours.body, colours.glow)], { frameScale: 1.2 });
}

// Spell runes: one carved plate each. Colour climbs with the rank the rune unlocks, and the Field
// Rune sits apart in ring-green so an area cost is told from a rank cost inside the pouch.
const RUNE_COLOURS: Readonly<Record<string, readonly [number, number]>> = {
  mind_rune: [0xb9c2cf, 0xf1f5ff],
  chaos_rune: [0x7d9cc4, 0xd6e8ff],
  death_rune: [0x8a6fb5, 0xe3d3ff],
  blood_rune: [0xa8734d, 0xffd9b0],
  wrath_rune: [0xc94a3c, 0xffc39a],
  cosmic_rune: [0x6f9a5c, 0xd4f0b8],
};
for (const [itemId, [body, glow]] of Object.entries(RUNE_COLOURS)) {
  put(itemId, [primitive("scute", body, glow)], { frameScale: 1.1 });
}

// Animal trophies, one per family. Colour is the only thing separating several of these, so each
// one is picked off the animal's own texture rather than from a palette: a coyote fang is bone
// against a bear claw's horn-brown, and the two horn shapes differ in silhouette as well.
put("hen_feather", [primitive("feather", 0xb08a5a, 0x6d5433)]);
put("hen_egg", [primitive("egg", 0xefe3cc, 0xa89070)]);
put("curl_horn", [primitive("horn", 0xa89676, 0x6b5c44)]);
put("ox_horn", [primitive("horn", 0xd8cdb6, 0x8a7f68)]);
put("coney_foot", [primitive("claw", 0xcfc3b0, 0x8d7f6b)]);
put("marsh_gland", [primitive("gland", 0x9fc08a, 0x5f7a4e)]);
put("viper_skin", [primitive("hide", 0x8d8f6b, 0x4a4a33)]);
put("venom_gland", [primitive("gland", 0xb7d46a, 0x63803a)]);
put("stag_antler", [primitive("antler", 0xa38f6d, 0x6b5b42)]);
put("curved_tusk", [primitive("horn", 0xe0d3ae, 0x93855f)]);
put("coyote_fang", [primitive("claw", 0xe6ddc8, 0x9a8f76)]);
put("bear_claw", [primitive("claw", 0x6f5b45, 0x3a2d21)]);
put("boar_bristle", [primitive("hide", 0x4a4038, 0x231d18)]);
put("ibex_horn", [primitive("horn", 0x7d6a4f, 0x453a2b)]);
put("aurochs_horn", [primitive("horn", 0xc8b995, 0x6f6349)]);
// A tail is a curled taper, not a stick. `shaft` gave it two metal bands and read as a dowel.
put("rat_tail", [primitive("horn", 0x9b7f74, 0x5c4a42)]);
put("scorpion_stinger", [primitive("claw", 0xc9a24a, 0x6f5620)]);
put("crab_claw", [primitive("claw", 0xc4552f, 0x71291a)]);
put("ashback_claw", [primitive("claw", 0x8a8378, 0x4d463d)]);
put("cinder_tusk", [primitive("horn", 0x5a4c40, 0x2e2520)]);
put("emberhorn", [primitive("horn", 0x8a5a44, 0x53301f)]);
put("kiln_fang", [primitive("claw", 0xb5764a, 0x6e3a1e)]);

// Authored creature-expansion materials. Rows remain explicit while root registers the new item
// catalogue in its later integration step; unregistered rows do not create phantom icon IDs.
const CREATURE_TROPHY_ICONS: readonly {
  id: ItemId; shape: ItemIconPrimitive; colour: number; accent: number; variant: number;
}[] = [
  { id: "fox_guardhair", shape: "tuft", colour: 0x9b4930, accent: 0xcda177, variant: 0 },
  { id: "lynx_sinew", shape: "cord", colour: 0xc2aa80, accent: 0x6a5136, variant: 0 },
  { id: "badger_bristle", shape: "tuft", colour: 0x3c3b37, accent: 0xcfcdc1, variant: 1 },
  { id: "porcupine_quill", shape: "quill", colour: 0xdbccb1, accent: 0x46382b, variant: 0 },
  { id: "horse_tailhair", shape: "cord", colour: 0x443329, accent: 0x93714b, variant: 1 },
  { id: "bighorn_fleece", shape: "tuft", colour: 0xbaa88c, accent: 0x8c765b, variant: 2 },
  { id: "moose_antler_palm", shape: "antler-palm", colour: 0xa98f6b, accent: 0x634b32, variant: 0 },
  { id: "tapir_leather", shape: "hide", colour: 0x7a6551, accent: 0x3f3025, variant: 1 },
  { id: "crocodile_scute", shape: "scute", colour: 0x6c7859, accent: 0x434b35, variant: 0 },
  { id: "salamander_secretion", shape: "gland", colour: 0x9f7b38, accent: 0x433321, variant: 1 },
  { id: "tortoise_shell_plate", shape: "shell", colour: 0x7b6753, accent: 0x42342b, variant: 0 },
  { id: "monitor_sinew", shape: "cord", colour: 0x926d48, accent: 0x473225, variant: 0 },
  { id: "goose_down", shape: "tuft", colour: 0xdedbd4, accent: 0xb4af9e, variant: 3 },
  { id: "heron_quill", shape: "quill", colour: 0x899fa1, accent: 0xe4ddcf, variant: 1 },
  { id: "bustard_plume", shape: "feather", colour: 0xa98963, accent: 0x574843, variant: 1 },
  { id: "turkey_tailfeather", shape: "feather", colour: 0x815435, accent: 0xded0a4, variant: 2 },
  { id: "snail_mucus", shape: "gland", colour: 0x99aca2, accent: 0x967b55, variant: 2 },
  { id: "beetle_mandible", shape: "claw", colour: 0x514433, accent: 0xb09f73, variant: 1 },
  { id: "centipede_chitin", shape: "scute", colour: 0x4e3e31, accent: 0x241e1b, variant: 1 },
  { id: "spider_thread", shape: "cord", colour: 0xd3ceba, accent: 0x9f9475, variant: 2 },
  { id: "ravager_talon", shape: "claw", colour: 0x3b2722, accent: 0x83453c, variant: 2 },
  { id: "drake_scale", shape: "scute", colour: 0x545050, accent: 0x9a846b, variant: 2 },
  { id: "mantis_scythe", shape: "claw", colour: 0x626b42, accent: 0x787750, variant: 3 },
  { id: "nightmare_plate", shape: "scute", colour: 0x5c5f64, accent: 0x858982, variant: 3 },
];
for (const row of CREATURE_TROPHY_ICONS) {
  if (BY_ID.has(row.id)) put(row.id, [primitive(row.shape, row.colour, row.accent, row.variant)]);
}

const ACCESSORY_ANATOMY: Readonly<Record<ItemId, number>> = {
  foxhair_ring: 1, lynx_sinew_ring: 2, quillguard_ring: 3, chitin_ring: 4,
  turkey_plume_charm: 1, heron_quill_charm: 2, antler_palm_charm: 3, mantis_edge_charm: 4,
};

// These opal settings follow the crafted metals, rather than the unused T50 Sunderglass palette.
// Thread-wrapped rings reuse the existing braided band; dark bindings distinguish the charms.
const WILDERNESS_JEWELLERY: Readonly<Record<ItemId, ItemIconPrimitivePart>> = {
  cindersteel_ring: primitive("ring", 0x8f7867, 0xdb874c),
  cindersteel_pendant: primitive("amulet", 0x8f7867, 0xdb874c),
  nightglass_ring: primitive("ring", 0x697b98, 0xdb874c),
  nightglass_pendant: primitive("amulet", 0x697b98, 0xdb874c),
  emberweave_ring: primitive("ring", 0x8f7867, 0xdb874c, 2),
  emberweave_charm: primitive("amulet", 0x514348, 0xe69b61),
  starweave_ring: primitive("ring", 0x697b98, 0xe69b61, 2),
  starweave_charm: primitive("amulet", 0x524b78, 0xe69b61),
};

// Game meat. Raw, cooked and burnt share one model; colour carries preparation state, exactly the
// convention the fish line below already uses.
put("raw_game_meat", [primitive("meat", 0xbe6a63, 0xe8ddc6)]);
put("roast_game", [primitive("meat", 0x8d5330, 0xe0d4bc)]);
put("burnt_game", [primitive("meat", 0x37302b, 0x6a625a)]);
put("raw_venison", [primitive("meat", 0x8f4a48, 0xe4d8c1)]);
put("roast_venison", [primitive("meat", 0x6f3d26, 0xd8ccb3)]);
put("burnt_venison", [primitive("meat", 0x2f2926, 0x615a53)]);
put("raw_haunch", [primitive("meat", 0xa1544d, 0xe8ddc6)]);
put("roast_haunch", [primitive("meat", 0x7d4527, 0xdcd0b7)]);
put("burnt_haunch", [primitive("meat", 0x2a2422, 0x585149)]);
put("raw_ember_haunch", [primitive("meat", 0xa8524a, 0xf0e2c8)]);
put("roast_ember_haunch", [primitive("meat", 0x84431f, 0xe2d3b6)]);
put("burnt_ember_haunch", [primitive("meat", 0x241f1d, 0x4f4841)]);

// Seeds and food. Raw and cooked fish share a model, while colour carries preparation state.
put("seared_minnow", [primitive("fish", 0xc58a54, 0xf0c781)]);
put("burnt_minnow", [primitive("fish", 0x3b3029, 0x72533d)]);
put("seared_trout", [primitive("fish", 0xa76a48, 0xdfad70)]);
put("burnt_trout", [primitive("fish", 0x312925, 0x654837)]);
put("seared_cragfin", [primitive("fish", 0x9e704f, 0xe3b877)]);
put("burnt_cragfin", [primitive("fish", 0x282322, 0x59443a)]);
put("seared_ashfin", [primitive("fish", 0xa06342, 0xe8ab6a)]);
put("burnt_ashfin", [primitive("fish", 0x231f1e, 0x4f3c32)]);

// The same finished tools, tint and grip dimensions shown during production gathering.
for (const id of ["worn_pickaxe", "grithe_pickaxe", "corven_pickaxe", "kaldite_pickaxe", "emberite_pickaxe",
  "worn_hatchet", "grithe_hatchet", "corven_hatchet", "kaldite_hatchet", "emberite_hatchet",
  "cindersteel_pickaxe", "cindersteel_hatchet", "nightglass_pickaxe", "nightglass_hatchet"] as const) {
  if (!BY_ID.has(id)) continue;
  const appearance = gatheringToolAppearance(id);
  if (!appearance) throw new Error(`Gathering tool icon has no production appearance: ${id}`);
  put(id, [equipmentPart(appearance)], { rotation: [0, 0, -0.38] });
}
for (const id of ["worn_rod", "palewood_rod", "duskoak_rod", "cairnpine_rod", "cinderpine_rod"] as const) {
  put(id, [asset(fishingRodAssetId(id))], { rotation: [0, 0, -0.28] });
}

for (const item of ALL_ITEMS.filter((entry) => entry.orb !== undefined)) {
  const element = item.orb!.element === "wind" ? "air" : item.orb!.element;
  if (!(element in ELEMENT_COLOURS)) {
    throw new Error(`Released orb ${item.id} has no icon palette for ${element}`);
  }
  const colours = ELEMENT_COLOURS[element as keyof typeof ELEMENT_COLOURS];
  put(item.id, [primitive("orb", colours.body, colours.glow)], {
    frameScale: item.orb!.released ? 1 : 1.06,
  });
}

// Static item art shows elemental identity. Explicit charge previews use the same runtime core.
for (const item of ALL_ITEMS.filter((entry) => entry.category === "equipment")) {
  const id = item.id;
  const jewellery = WILDERNESS_JEWELLERY[id];
  if (jewellery) {
    put(id, [jewellery]);
    continue;
  }
  if (/_ring$/.test(id)) {
    put(id, [primitive("ring", tierMetal(id), tierAccent(id), ACCESSORY_ANATOMY[id])]);
    continue;
  }
  if (/_pendant$|_charm$/.test(id)) {
    put(id, [primitive("amulet", tierMetal(id), tierAccent(id), ACCESSORY_ANATOMY[id])]);
    continue;
  }

  const gear = item.magicWeapon?.charge
    ? gearAppearancePartsWithCharge(id, { itemId: id, charged: true })
    : gearAppearanceParts(id);
  if (gear.length === 0) throw new Error(`Equipment icon has neither worn geometry nor a proxy: ${id}`);
  put(
    id,
    gear.map(equipmentPart),
    {
      ...(item.equip?.slot === "mainHand" ? { rotation: [0, 0, -0.38] as const } : {}),
      ...(item.equip?.slot === "hands" ? { presentation: "paired-hands" as const } : {}),
    },
  );
}

const missing = ALL_ITEMS.filter((item) => !APPEARANCES.has(item.id)).map((item) => item.id);
if (missing.length > 0) throw new Error(`Items without icon appearances: ${missing.join(", ")}`);
if (APPEARANCES.size !== ALL_ITEMS.length) {
  throw new Error(`Item icon appearance count ${APPEARANCES.size} does not match item count ${ALL_ITEMS.length}`);
}

export const ITEM_ICON_APPEARANCE_IDS: readonly ItemId[] = [...APPEARANCES.keys()];

export function itemIconAppearance(itemId: ItemId, state?: ItemIconPresentationState): ItemIconAppearance {
  const appearance = APPEARANCES.get(itemId);
  if (!appearance) throw new Error(`No item icon appearance for ${itemId}`);
  if (state?.charged !== undefined && def(itemId).magicWeapon?.charge) {
    return {
      ...appearance,
      parts: gearAppearancePartsWithCharge(itemId, { itemId, charged: state.charged }).map(equipmentPart),
    };
  }
  return appearance;
}

export function itemIconAssetIds(): readonly string[] {
  const ids = new Set<string>();
  for (const appearance of APPEARANCES.values()) {
    for (const part of appearance.parts) if (part.kind === "asset") ids.add(part.assetId);
  }
  return [...ids].sort();
}
