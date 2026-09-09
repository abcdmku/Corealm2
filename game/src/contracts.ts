/**
 * Corealm frozen contracts.
 *
 * FROZEN. Only the root agent edits this file. A worker who needs a change here stops and reports
 * the exact mismatch (AGENTS.md rule 5); the root changes the contract and its callers together.
 *
 * Source of truth: runs/corealm/PRD.md section 7.2, with the corrections in
 * runs/corealm/architecture.md section 1.
 */

// ---------------------------------------------------------------- primitives

/** World-space point in metres, Y-up. Tuple form, per the brief's semantic-entity example. */
export type Vec3 = readonly [number, number, number];

export type SkillId =
  | "melee" | "magic"
  | "mining" | "woodcutting" | "fishing"
  | "smithing" | "crafting" | "cooking" | "fletching"
  | "agility";

export const SKILL_IDS: readonly SkillId[] = [
  "melee", "magic",
  "mining", "woodcutting", "fishing",
  "smithing", "crafting", "cooking", "fletching",
  "agility",
] as const;

export type RegionId = "fallowmarch" | "vellenwood" | "karrowmoor" | "kilnhalt" | "gravelmaw";

// ------------------------------------------------------------------- audio

/** Independent client-side mix buses. These are preferences, never simulation state. */
export type AudioBus = "music" | "ambient" | "sfx";

/** Linear gain values in the inclusive 0..1 range. */
export interface AudioVolumes {
  music: number;
  ambient: number;
  sfx: number;
}

/** Material weights shared by the terrain renderer and terrain-aware presentation systems. */
export interface GroundSurfaceSample {
  grass: number;
  dry: number;
  rock: number;
  gravel: number;
  dirt: number;
  mud: number;
  cobble: number;
  wet: number;
}

/**
 * Semantic cue vocabulary and its runtime list, so catalog coverage is testable. Gameplay
 * publishes meaning; the audio layer chooses one of the cue's curated file variants.
 */
export const AUDIO_CUE_IDS = [
  "ui.click", "ui.confirm", "ui.cancel", "ui.error", "ui.level_up",
  "movement.footstep_grass", "movement.footstep_dirt", "movement.footstep_forest",
  "movement.footstep_stone", "movement.footstep_wood", "movement.footstep_cave",
  "gather.mining_swing", "gather.mining_impact", "gather.rock_break",
  "gather.wood_swing", "gather.wood_impact", "gather.tree_fall",
  "gather.fishing_cast", "gather.fishing_reel", "gather.fishing_catch",
  "production.smith", "production.smelt", "production.craft",
  "production.cook", "production.fletch",
  "combat.melee_swing", "combat.melee_hit", "combat.melee_miss",
  "combat.magic_cast", "combat.magic_hit", "combat.special",
  "combat.player_hit", "combat.enemy_death", "combat.player_death",
  "interaction.door_open", "interaction.portal", "interaction.climb",
  "interaction.vault", "interaction.loot", "interaction.equip", "interaction.consume",
  "interaction.bank", "interaction.trade", "interaction.dialogue_open",
  "interaction.dialogue_close", "interaction.activity_stop",
  // Animal voices, one per VOICE rather than per family, because several families share a throat:
  // cattle and aurochs both low, goats and ibex both bleat, coneys and rats both squeak, scorpions
  // and crabs both click. `audio/director.ts: cueForCreature` owns the family-to-voice map.
  "creature.hen_cluck", "creature.frog_croak", "creature.goat_bleat", "creature.cow_low",
  "creature.coney_squeak", "creature.viper_hiss", "creature.stag_bell", "creature.hog_grunt",
  "creature.coyote_howl", "creature.bear_roar", "creature.chitin_click",
] as const;

export type AudioCueId = (typeof AUDIO_CUE_IDS)[number];

export type EquipSlot =
  | "head" | "body" | "legs" | "feet" | "hands"
  | "mainHand" | "offHand" | "accessory1" | "accessory2";

export const EQUIP_SLOTS: readonly EquipSlot[] = [
  "head", "body", "legs", "feet", "hands",
  "mainHand", "offHand", "accessory1", "accessory2",
] as const;

export type EntityId = string;
export type ItemId = string;
export type RecipeId = string;
export type QuestId = string;

// ------------------------------------------------------------------- spells

/**
 * The four attack elements.
 *
 * They are a LOOK and a SOUND, not four damage types. There is no elemental weakness table and no
 * resistance stat: `EquipmentBonuses` carries one `magicArmour`, every enemy row carries one
 * `magicArmour`, and inventing a second axis would mean re-solving the whole PRD 2.4 magic balance
 * against four columns instead of one. What separates them is when their Essence and spells unlock.
 * All four are released: Air, Earth, and Water with the Phase 1 regions, Fire with Kilnhalt (tier 20).
 *
 * `wind` covers gale and charge, which is why Voltrend — a garnet cracked for the charge in it —
 * is a wind spell rather than a fifth element. The tier-10 magic kit already calls its accessories
 * `storm_ring` and `storm_charm`, so the equipment ladder made that association before this did.
 */
export type SpellElement = "wind" | "water" | "earth" | "fire";

export const SPELL_ELEMENTS: readonly SpellElement[] = ["wind", "water", "earth", "fire"] as const;

/**
 * The four escalating shapes a spell can take, low to high.
 *
 * This is the axis the renderer reads. All four elements at one rung share a silhouette, a particle
 * count and a timing envelope, and differ only in tint — one sprite atlas therefore covers sixteen
 * spells (`render/spellVfx.ts`). Rung is also the difficulty read the player gets before the damage
 * number lands: a `lash` is a single small dart, a `surge` is a wide front with a ground wave under
 * it, and the two are not mistakable at gameplay distance.
 */
export type SpellRung = "lash" | "bolt" | "burst" | "surge";

export const SPELL_RUNGS: readonly SpellRung[] = ["lash", "bolt", "burst", "surge"] as const;

/**
 * Every attack spell, in unlock order, Magic 1 to Magic 70.
 *
 * Four rungs of four. The first rung follows the region ladder: Air at 1, Earth at 5, Water at 10,
 * and Fire at 15 — castable since fire fuel released with the tier-20 Kilnhalt region.
 *
 * Widened from a three-way union together with its callers, per AGENTS.md rule 5: `content/spells.ts`,
 * `systems/combat.ts`, `agent/tools.ts` and `ui/spellbookPanel.ts`. Kept as a literal union rather
 * than relaxed to `string` so a typo in a quest reference or an agent call is a compile error
 * rather than a `NOT_FOUND` at runtime.
 */
export type SpellId =
  // lash — Magic 1 to 15
  | "voltrend" | "stonebrand" | "rimewash" | "emberlash"
  // bolt — Magic 17 to 35
  | "skirlbolt" | "sleetbolt" | "shalebolt" | "cinderbolt"
  // burst — Magic 41 to 59
  | "galeburst" | "spateburst" | "cragburst" | "pyreburst"
  // surge — Magic 62 to 70
  | "squallsurge" | "tidesurge" | "scarpsurge" | "kilnsurge";

export type Archetype =
  | "ore" | "tree" | "fishing_spot"
  | "enemy" | "boss" | "npc" | "station" | "bank" | "shop"
  | "obstacle" | "door" | "portal" | "loot" | "recovery_cache" | "landmark";

export type InteractionId =
  | "inspect" | "mine" | "chop" | "fish"
  | "attack" | "cast" | "talk" | "open" | "enter" | "climb" | "vault"
  | "loot" | "take" | "awaken" | "produce" | "recharge" | "bank" | "trade" | "equip" | "unequip";

/** The unions above as values, so a tool schema can enumerate them instead of accepting any string. */
export const ARCHETYPES: readonly Archetype[] = [
  "ore", "tree", "fishing_spot",
  "enemy", "boss", "npc", "station", "bank", "shop",
  "obstacle", "door", "portal", "loot", "recovery_cache", "landmark",
];

export const INTERACTION_IDS: readonly InteractionId[] = [
  "inspect", "mine", "chop", "fish",
  "attack", "cast", "talk", "open", "enter", "climb", "vault",
  "loot", "take", "awaken", "produce", "recharge", "bank", "trade", "equip", "unequip",
];

/** A production station category. Recipes may accept more than one category. */
export type StationKind =
  | "furnace" | "anvil" | "range" | "campfire" | "crafting_table" | "fletching_bench"
  | "essence_altar";

// ---------------------------------------------------------- structure library

/**
 * Broad visual families used by the deterministic structure-variant library.
 *
 * A family describes why a recipe exists, not how it collides. Structure variants may change
 * facades, rooflines, trim and exterior dressing, but they keep the owning prefab's footprint,
 * doorway topology and walk-under cover unchanged. `prefabCollision` intentionally has no seed or
 * kit input, so a variant that moves structural mass would make the visible building disagree with
 * navigation and camera occlusion.
 */
export type StructureFamily =
  | "domestic"
  | "civic"
  | "workshop"
  | "fortification"
  | "open_air"
  | "ruin";

/** Public, renderer-independent metadata for one curated structure recipe. */
export interface StructureVariantDescriptor<TPrefab extends string = string> {
  /** Stable id within its prefab, for diagnostics and deterministic snapshots. */
  readonly id: string;
  readonly label: string;
  readonly family: StructureFamily;
  readonly prefab: TPrefab;
  /** Maximum number of optional part placements this recipe may add. */
  readonly detailBudget: number;
}

// ---------------------------------------------------------- items, equipment

export interface ItemStack { itemId: ItemId; quantity: number }
export interface InventorySlot extends ItemStack { slotIndex: number }

/** Read-only contents revealed by opening a world loot container. */
export interface LootContainerView {
  entityId: EntityId;
  name: string;
  position: Vec3;
  items: ItemStack[];
}

/** Exact result of explicitly taking one displayed stack from a world loot container. */
export interface LootTakeResult {
  taken: ItemStack[];
  remaining: ItemStack[];
  containerEmpty: boolean;
}

export interface EquipmentBonuses {
  accuracy: number;
  power: number;
  armour: number;
  magicAccuracy: number;
  magicPower: number;
  magicArmour: number;
  vitality: number;
}

export type ItemCategory =
  | "resource" | "bar" | "equipment" | "food" | "tool"
  | "quest" | "currency" | "component";

export type MagicWeaponKind = "wand" | "staff";

export interface ElementalWeaponChargeSpec {
  element: SpellElement;
  capacity: number;
  initialCharges: number;
  rechargeItemId: ItemId;
  rechargeCost: number;
  /** The singleton boss drop consumed to awaken this element's altar. */
  orbItemId: ItemId;
  /** False for authored future content whose region has not shipped. */
  released: boolean;
}

export interface MagicWeaponSpec {
  kind: MagicWeaponKind;
  /** Wands leave the off hand free. Staffs require it to be empty. */
  hands: 1 | 2;
  /** Present only on elemental weapons crafted at an awakened regional altar. */
  charge?: ElementalWeaponChargeSpec;
}

export interface EssenceOrbSpec {
  element: SpellElement;
  /** False for authored future content whose region has not shipped. */
  released: boolean;
}

export interface ItemDef {
  id: ItemId;
  name: string;
  tier: number;
  description: string;
  stackable: boolean;
  /** Shop buy price. Sell price is round(value * 0.6). */
  value: number;
  category: ItemCategory;
  equip?: {
    slot: EquipSlot;
    bonuses: EquipmentBonuses;
    attackSpeedMs?: number;
    requires: Partial<Record<SkillId, number>>;
  };
  /** Present only on main-hand magic weapons. */
  magicWeapon?: MagicWeaponSpec;
  /** Present only on boss-drop Orbs used to awaken their matching regional altar. */
  orb?: EssenceOrbSpec;
  food?: { healAmount: number };
  tool?: { skill: SkillId; gatherBonus: number };
}

// ------------------------------------------------------- the semantic entity

export interface SemanticEntity {
  id: EntityId;
  archetype: Archetype;
  name: string;
  tier: number;
  regionId: RegionId;
  position: Vec3;
  /** Archetype-specific, e.g. "available" | "depleted" | "alive" | "dead". */
  state: string;
  /** Reachable working position when the visible target is inaccessible, such as a fish school. */
  interactionPosition?: Vec3;
  requirements?: Partial<Record<SkillId, number>>;
  interactions: InteractionId[];
  resource?: { remaining: number; maxYields: number; respawnSeconds: number; itemId: ItemId };
  combat?: {
    health: number;
    maxHealth: number;
    level: number;
    aggroRadius: number;
    /**
     * How fast this creature moves while pursuing, metres per second.
     *
     * Read by BOTH layers, which is why it is here rather than in either. `systems/enemyAI.ts`
     * steps the entity at it, and `render/entityViews.ts` divides it by the walk cycle's own
     * implied speed to get the playback rate that keeps the feet on the ground. A hen and a bear
     * covering ground at the same 3.1 m/s was the visible half of that: the hen's cycle implies
     * 0.75 m/s, so its legs were running four times too slowly for the distance it covered.
     */
    moveSpeedMps?: number;
    /** Pottering speed. See `walkSpeedMps` on `EnemyDef`; the render layer picks the gait to match. */
    walkSpeedMps?: number;
    /**
     * Half the creature's widest ground footprint, metres, at its drawn scale.
     *
     * Here rather than in `render/` because it is what stops two of them standing in the same
     * place, and that is a simulation rule: `systems/enemyAI.ts` uses the sum of two radii as the
     * distance they have to keep. Without it every animal that aggros paths at the SAME point - the
     * player - and nothing makes them give way, so a sett of bears arrives as one lump of fur.
     *
     * Measured, not authored. `world/regionBuilder.ts` reads the asset's manifest bbox, which
     * `tools/build-animals.ts` wrote from the converted mesh, so a bear is 1.23 m and a frog 0.16.
     */
    bodyRadius?: number;
  };
  npc?: { dialogueRootId: string; questIds: QuestId[] };
  station?: { kind: StationKind; skill: SkillId; recipeIds: RecipeId[] };
  /** Agility shortcut. Traversal is a route-graph edge, not a navmesh off-mesh link. */
  obstacle?: { reqLevel: number; exitPosition: Vec3; durationMs: number; savesMeters: number };
  /**
   * How this entity is drawn. The seam between the world layer (which owns semantics) and the
   * render layer (which owns meshes). `assetId` refers to an id in assets/manifest.json.
   * The render layer never invents an appearance; the world layer never touches Three.js.
   */
  view?: {
    assetId: string;
    /** Uniform scale. Assets are authored in metres, so this is usually near 1. */
    scale?: number;
    /**
     * Optional per-axis shape correction, multiplied after `scale` in the asset's local frame.
     * Most entities omit this. Modular architecture uses it when a shipped mesh has the right
     * material and silhouette but the wrong fixed aspect ratio for the roof it must close.
     */
    scaleAxes?: Vec3;
    rotationY?: number;
    /**
     * Ground speed this mover is currently being stepped at, in metres per second, written by
     * whichever system owns its movement each time it takes a step.
     *
     * Exists because the renderer retimes a locomotion cycle against the speed the body ACTUALLY
     * covers ground at, and without this field it has to guess which authored speed the AI is
     * using. The guess is wrong for a leash return, which hurries at 1.16x the pursuit speed the
     * fallback retimes against — a permanent 16% foot slide on every walk home.
     */
    gaitSpeedMps?: number;
    /** Swapped in when `state` is "depleted" or "dead". Falls back to a desaturated material. */
    depletedAssetId?: string;
    /**
     * Draw only the lowest fraction of the mesh, 0..1. Used to cut a tree down to a stump.
     *
     * The asset library ships no stump, and Phase 1 substituted `anvil_log` — an anvil that
     * happens to stand on a log — which put a blacksmith's anvil wherever a stump belonged.
     * Clipping a real tree's own trunk is the honest version and costs one geometry per group.
     */
    clipFraction?: number;
    /** Tier palette override. Defaults to the entity's own tier. */
    materialTier?: number;
    /**
     * Sim time this entity was killed, in the same clock `GameLoop` runs on. Absent while alive.
     *
     * A timestamp rather than a progress value on purpose. `render/entityViews.ts` needs to fade a
     * corpse out smoothly at frame rate, and the view sync it would otherwise read from runs four
     * times a second - six visible steps across a fade, which reads as a stutter rather than a
     * dissolve. Given the instant it happened, the renderer computes the fade continuously from its
     * own frame clock, and gets the same answer after a reload because the instant is state.
     */
    diedAtMs?: number;
    /** Metres above `position` for the interaction label and highlight ring. */
    labelHeight?: number;
    /**
     * Skinned parts layered onto `assetId`'s skeleton. NOT a replacement for `assetId`.
     *
     * Every NPC in Phase 1 was literally headless. `world/regionBuilder.ts` `dressedAssetFor()`
     * swapped an NPC's body for a full outfit GLB, and the outfit files are not bodies:
     * `outfit_male_peasant.glb` holds exactly four meshes (Arms, Body, Feet, Legs), tops out at
     * y = 1.559 against `base_male`'s 1.810, and carries no Head, Eyes or Eyebrows — measured by
     * structural dump of the GLB. The fix is body + parts, so `assetId` stays `base_male` /
     * `base_female` (which carry the face) and the clothing arrives here.
     *
     * `render/skinning.ts` binds each part to the BODY's `Bone` objects while keeping the PART's
     * own `boneInverses` — that is what makes cross-file mixing correct. It is safe because all
     * four humanoid rigs in the 213-asset library carry the same 65 joints in the same order
     * (verified name-by-name: root, pelvis, spine_01..03, neck_01, Head, clavicle/upperarm/
     * lowerarm/hand + 5 fingers x 4 per side, thigh/calf/foot/ball per side). They differ only in
     * bind pose; the residual is 0 mm for the female set and <= 23.7 mm for the male set, and it
     * sits inside the clothing everywhere except the wrists. Do NOT retarget: the joint lists
     * already match, so retargeting can only add error.
     *
     * A part whose skeleton fails to bind must be DROPPED, not drawn. An unbound part renders
     * forever in bind pose — that is the T-posed tunic lying across the player's shoulders in
     * runs/corealm/screenshots/RIG-town-player.png — which reads far worse than a missing sleeve.
     */
    partAssetIds?: readonly string[];
    /**
     * Terrain normal under this entity: UNIT LENGTH, WORLD SPACE, Y-up.
     *
     * Computed in the WORLD layer from a central difference on the same `heightAt` port that
     * places the entity (no Three.js in `world/`), and clamped to about 20 degrees off vertical.
     * Nothing tilted to the ground in Phase 1: `writeSlot` composed its matrix from a Y-axis
     * rotation only, and 34 of 159 surface entities stand on ground steeper than 10 degrees —
     * worst case `lower_quarry_kaldite_3`, a 5.3 m ore rock on a 48.9-degree slope with 3.02 m of
     * daylight under one edge.
     *
     * `render/` must SLERP toward this, scaled by `tiltStrength`, not apply it raw. A tree laid
     * over at the full slope of the hill reads worse than a tree standing plumb; a pebble does not.
     */
    groundNormal?: readonly [number, number, number];
    /**
     * 0..1, how much of `groundNormal` to apply. Per-archetype defaults live in `render/`, not
     * here, because they are a look decision: trees want about 0.10, pebbles and flat plants 1.0.
     * Set it per entity only to override that table.
     */
    tiltStrength?: number;
  };
  meta?: Record<string, string | number | boolean>;
}

// ----------------------------------------------------------------- solids

/**
 * A volume the player must not walk into.
 *
 * This type sits in contracts rather than in either layer that touches it, because both do: the
 * world layer PRODUCES the list while it builds a region (it is the only layer that knows a
 * gatehouse has two piers and a gap between them), and `systems/solids.ts` CONSUMES it to clamp
 * movement and to carve the navmesh. Neither may import the other, and neither owns the shape.
 *
 * Why this exists at all, measured before it was written: the whole world had 40 colliders — one
 * terrain heightfield and 39 boxes derived from the 36 authored buildings. 892 semantic entities
 * registered no volume whatsoever, so the player walked through the bank chest, the anvil, both
 * market stalls, an NPC, an enemy, a resource tree, an ore rock, the region gate arch, and across
 * a pond floor 0.50 m under the water plane.
 *
 * Two rules that are not obvious and are load-bearing:
 *
 *  - `radius`, or half the diagonal of a box, must stay under `INTERACT_RANGE` (2.4 m). A volume
 *    wider than the interaction reach makes its own entity unreachable: `moveTo({ entityId })`
 *    walks to the surface of the carve and can then never get close enough to click the thing.
 *    Seven gate-check lines depend on that reach.
 *  - `y` is the volume's BASE, not its centre, because everything that produces one knows where
 *    the ground is and not where the middle of the mesh ended up.
 */
export type SolidVolume =
  | {
      kind: "box";
      /** Owning entity or building part, for debugging and for skipping a volume when it is removed. */
      id: string;
      /** Centre in XZ; `y` is the base of the box. */
      position: Vec3;
      /** Full extents in the box's own frame, before `rotationY`. */
      size: readonly [number, number, number];
      rotationY: number;
    }
  | {
      kind: "cylinder";
      id: string;
      /** Centre in XZ; `y` is the base of the cylinder. */
      position: Vec3;
      radius: number;
      height: number;
    };

// ------------------------------------------------------------- observation

export type ObservationScope = "visible" | "known";

export interface ObservedEntity {
  id: EntityId;
  archetype: Archetype;
  name: string;
  tier: number;
  regionId: RegionId;
  position: Vec3;
  /** Working position, when different from the visible model. */
  interactionPosition?: Vec3;
  /** Path distance to the working position in metres. */
  distance: number;
  /**
   * The route-graph place this row stands at, when it is one.
   *
   * `id` is the ENTITY's id, and for a place backed by an entity the two differ: the Coldbrace bank
   * comes back as `coldbrace_bank` at the location `bank_interior`, the Gravelmaw's mouth as
   * `gravelmaw_mouth_portal` at `gravelmaw_entrance`. So `id` cannot be handed to
   * `moveTo({ locationId })`, and every caller that wanted to was reduced to matching positions.
   * This is that join, stated rather than guessed.
   */
  locationId?: string;
  state: string;
  interactions: InteractionId[];
  requirementsMet: boolean;
  blockedBy?: string;
}

export interface ObserveFilter {
  scope?: ObservationScope;
  /** Default 40, max 140. */
  radius?: number;
  archetypes?: Archetype[];
  interaction?: InteractionId;
  requirementsMet?: boolean;
  regionId?: RegionId;
  /** Default 25, max 100. */
  limit?: number;
}

// ------------------------------------------------------------------ errors

export type GameErrorCode =
  | "NOT_FOUND" | "OUT_OF_RANGE" | "NOT_REACHABLE" | "REQUIREMENTS_NOT_MET"
  | "INVENTORY_FULL" | "BUSY" | "INVALID_ARGUMENT" | "DEAD" | "DEPLETED"
  | "NOT_ENOUGH_CURRENCY" | "NOT_ENOUGH_ITEMS" | "NO_DIALOGUE"
  | "TIMEOUT" | "UNAVAILABLE"
  /**
   * Agent-session refusals. These never come from the world: they are the collaboration contract
   * saying no before the world is asked. `NOT_PERMITTED` is a tool the current mode or control
   * owner does not allow, `PAUSED` is the player's pause button, `CANCELLED` is a bounded
   * operation cut short by Stop or Take control, `APPROVAL_REQUIRED` is a request the player has
   * not yet answered.
   */
  | "NOT_PERMITTED" | "PAUSED" | "CANCELLED" | "APPROVAL_REQUIRED";

export const GAME_ERROR_CODES: readonly GameErrorCode[] = [
  "NOT_FOUND", "OUT_OF_RANGE", "NOT_REACHABLE", "REQUIREMENTS_NOT_MET",
  "INVENTORY_FULL", "BUSY", "INVALID_ARGUMENT", "DEAD", "DEPLETED",
  "NOT_ENOUGH_CURRENCY", "NOT_ENOUGH_ITEMS", "NO_DIALOGUE",
  "TIMEOUT", "UNAVAILABLE",
  "NOT_PERMITTED", "PAUSED", "CANCELLED", "APPROVAL_REQUIRED",
];

export interface GameError { code: GameErrorCode; message: string; entityId?: EntityId }

export type Result<T> = { ok: true; value: T } | { ok: false; error: GameError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(code: GameErrorCode, message: string, entityId?: EntityId): Result<T> {
  return { ok: false, error: entityId ? { code, message, entityId } : { code, message } };
}

// ------------------------------------------------------------------ events

export type GameEventType =
  | "navigation.started" | "navigation.completed" | "navigation.failed"
  | "activity.started" | "activity.stopped"
  | "resource.depleted" | "inventory.full"
  | "item.received" | "item.lost"
  /**
   * Gear moving between the pack and a worn slot. These exist so an agent that reconstructs its
   * inventory from `item.received`/`item.lost` does not read an equip as "I lost my weapon":
   * neither of those two fires for the piece being worn or taken off. A swap emits one
   * `item.equipped` carrying `replaced`, and the displaced piece's return to the pack is part of
   * that event rather than a separate `item.received`.
   */
  | "item.equipped" | "item.unequipped"
  | "combat.started" | "combat.ended"
  /**
   * A cast has been rolled and paid for, and its bolt is in the air.
   *
   * Carries `flightMs`, the gap before the damage lands. This exists because a spell now HURTS on
   * arrival rather than on release (`systems/combat.ts landSpellHits`), so the hit log entry is
   * written at the far end of the flight — too late to be the renderer's cue to start drawing the
   * bolt. `data` is
   * `{ spellId, targetId, element, rung, flightMs, hit, fuelSource, weaponItemId,
   * remainingCharges, essenceItemId, remainingEssence }`.
   *
   * `hit` is the resolved roll, published before the damage lands. That is deliberate rather than a
   * leak: the effect layer has to know at launch whether to draw a bolt that connects or one that
   * fizzles short, and this is a single-player simulation where the client already owns the world.
   */
  | "spell.launched"
  /**
   * One regional altar awakening. `data` names the altar, element and consumed Orb.
   */
  | "essence.altarAwakened"
  /**
   * One completed altar transaction. `data` names the altar, weapon, element and essence item and
   * includes `before`, `after`, and `essenceSpent` so consumers can reconcile the exact change.
   */
  | "essence.recharged"
  | "health.low" | "player.died"
  | "level.gained" | "production.completed"
  | "campfire.built" | "campfire.replaced" | "campfire.expired"
  | "quest.updated" | "dialogue.opened" | "dialogue.closed"
  | "entity.discovered"
  /**
   * The collaboration session, published on the same bus as the world so an agent waits on a
   * mode change or a player's Stop with the one `corealm_events` call it already uses.
   * `agent.session` is mode, control owner, pause and objective changes; `agent.task` is a bounded
   * operation starting, finishing or being cut short; `agent.approval` is a request being raised
   * or answered.
   */
  | "agent.session" | "agent.task" | "agent.approval"
  /**
   * The guidance layer. `overlay.arrived` is the player reaching a marker overlay's target — the
   * marker clears itself unless it was set with `persist`. `agent.guide` is a proposed plan's
   * cursor moving: a step completed (by arrival, the agent, or the player skipping it), the last
   * step completing, or the plan being cleared.
   */
  | "overlay.arrived" | "agent.guide";

export const GAME_EVENT_TYPES: readonly GameEventType[] = [
  "navigation.started", "navigation.completed", "navigation.failed",
  "activity.started", "activity.stopped",
  "resource.depleted", "inventory.full",
  "item.received", "item.lost", "item.equipped", "item.unequipped",
  "combat.started", "combat.ended", "spell.launched",
  "essence.altarAwakened", "essence.recharged",
  "health.low", "player.died", "level.gained", "production.completed",
  "campfire.built", "campfire.replaced", "campfire.expired",
  "quest.updated", "dialogue.opened", "dialogue.closed", "entity.discovered",
  "agent.session", "agent.task", "agent.approval",
  "overlay.arrived", "agent.guide",
];

/**
 * What `GameEvent.data` carries, per type.
 *
 * Emitters have always written plain records, and a handful of types are emitted from more than
 * one place with more than one shape (`item.received` is a gather, a loot pile, a purchase and a
 * currency drop). This map states every field any emitter writes, with optionals where the shapes
 * differ, so a consumer narrows on `type` instead of casting `data` to `Record<string, unknown>`
 * and hoping. It is also the source the agent manual renders its event catalogue from, so the
 * documentation cannot drift from the type.
 */
export interface GameEventPayloads {
  "navigation.started": { pathLength?: number; etaMs: number; points?: number; legs?: number; route?: boolean };
  "navigation.completed": { position: Vec3 };
  "navigation.failed": { reason: string; to?: Vec3 };
  "activity.started": { kind: string; skill?: SkillId; entityId?: EntityId; interaction?: string; recipeId?: RecipeId };
  "activity.stopped": { kind: string; reason: string; skill?: SkillId; entityId?: EntityId; completed?: number; remaining?: number };
  "resource.depleted": { entityId?: EntityId; itemId?: ItemId; tier?: number; respawnInSeconds?: number; plotId?: EntityId; respawnSeconds?: number };
  "inventory.full": { itemId?: ItemId; name?: string; attempted?: number; added?: number; recipeId?: RecipeId };
  "item.received": {
    itemId?: ItemId; name?: string; quantity?: number; source?: string; skill?: SkillId; from?: EntityId;
    sourceName?: string; currency?: number; pileId?: EntityId; items?: ItemStack[];
  };
  "item.lost": { itemId?: ItemId; name?: string; quantity?: number; reason?: string; cacheId?: EntityId; items?: ItemStack[] };
  "item.equipped": { itemId: ItemId; name: string; slot: EquipSlot; replaced: ItemId | null };
  "item.unequipped": { itemId: ItemId; name: string; slot: EquipSlot; quantity: number };
  "combat.started": {
    initiator?: "player" | "enemy"; targetId?: EntityId; by?: EntityId; name?: string; spellId?: SpellId | null;
    /** Boss choreography rides on this type: `boss.phase`, `boss.telegraph`, `boss.slam`. */
    event?: string; enemyId?: EntityId; phase?: number; kind?: string; centre?: Vec3; radius?: number;
    firesAtMs?: number; damage?: number; hit?: boolean;
  };
  "combat.ended": { reason: string; enemyId?: EntityId; name?: string; xp?: number };
  "spell.launched": {
    spellId: SpellId; targetId: EntityId; element: SpellElement; rung: SpellRung; flightMs: number; hit: boolean;
    fuelSource: string; weaponItemId: ItemId | null; remainingCharges: number | null;
    essenceItemId: ItemId | null; remainingEssence: number | null;
  };
  "essence.altarAwakened": { altarId: EntityId; element: SpellElement; orbItemId: ItemId };
  "essence.recharged": {
    altarId: EntityId; weaponItemId: ItemId; element: SpellElement; before: number; after: number;
    essenceItemId: ItemId; essenceSpent: number;
  };
  "health.low": { health: number; maxHealth: number; fraction: number; threshold: number };
  "player.died": { position: Vec3; regionId: RegionId; respawnPointId: string; respawnPosition: Vec3; [key: string]: unknown };
  "level.gained": { skill: SkillId; level: number; levelsGained: number };
  "production.completed": { recipeId?: RecipeId; recipeName?: string; skill?: SkillId; kind?: string; tier?: number; [key: string]: unknown };
  "campfire.built": { logItemId: ItemId; tier: number; lifetimeMs: number; expiresAtPlaySeconds: number; [key: string]: unknown };
  "campfire.replaced": { previousLogItemId: ItemId; previousTier: number; logItemId: ItemId; tier: number; [key: string]: unknown };
  "campfire.expired": { logItemId: ItemId; tier: number; position: Vec3 };
  "quest.updated": {
    questId: QuestId; status: "unstarted" | "active" | "complete"; stage: number; stageCount: number;
    objective: string | null; objectiveRefs: QuestObjectiveRef[];
  };
  "dialogue.opened": { npcId: EntityId; speaker: string; nodeId: string; optionCount: number };
  "dialogue.closed": { npcId: EntityId };
  "entity.discovered": { locationId: string; regionId: RegionId; via: string };
  "agent.session": {
    change: "mode" | "control" | "paused" | "objective" | "connected";
    mode: AgentMode; controlOwner: AgentControlOwner; paused: boolean; objective: string | null;
    agentName: string | null; by: "agent" | "player" | "system";
  };
  "agent.task": {
    taskId: string; tool: string; status: "started" | "completed" | "cancelled" | "failed";
    summary: string; reason?: string;
  };
  "agent.approval": {
    requestId: string; kind: AgentApprovalKind; description: string;
    status: "pending" | "approved" | "denied" | "expired";
  };
  /** The player reached a marker overlay's target. `cleared` says whether the marker removed itself. */
  "overlay.arrived": { id: string; position: Vec3; cleared: boolean };
  /**
   * A proposed plan's cursor moved. `completed` is the step that just finished (0-based) and `via`
   * says how; `step`/`text` is the step that is current now, null once the plan is finished.
   */
  "agent.guide": {
    change: "advanced" | "finished" | "cleared";
    completed: number | null; via: "arrived" | "agent" | "player" | null;
    step: number | null; text: string | null; stepCount: number;
  };
}

/** A `GameEvent` narrowed to one type. `data` is that type's payload, nothing looser. */
export type TypedGameEvent<T extends GameEventType = GameEventType> = T extends GameEventType
  ? { seq: number; type: T; atMs: number; entityId?: EntityId; data: GameEventPayloads[T] }
  : never;

export interface GameEvent {
  /** Monotonic, never reused. */
  seq: number;
  type: GameEventType;
  /** Sim clock milliseconds. */
  atMs: number;
  entityId?: EntityId;
  data: Record<string, unknown>;
}

/** Narrows a loose event to its typed payload. Safe because every emitter writes the shape above. */
export function asTypedEvent<T extends GameEventType>(event: GameEvent, type: T): TypedGameEvent<T> | null {
  return event.type === type ? (event as unknown as TypedGameEvent<T>) : null;
}

/**
 * One cursor read from the event ring.
 *
 * The ring keeps a bounded window, so a caller that sleeps through more events than it holds
 * comes back to a gap. `dropped` says so, `droppedCount` says how many, and `oldestSeq` is the
 * first sequence still readable — the caller can resync by re-reading state through
 * `corealm_context` instead of trusting an inventory reconstructed from a stream with a hole.
 */
export interface EventBatch {
  events: GameEvent[];
  /** Pass back as `sinceSeq`. */
  nextSeq: number;
  /** Lowest sequence number still in the ring, or `nextSeq` when the ring is empty. */
  oldestSeq: number;
  /** True when `sinceSeq` was older than the ring: events between it and `oldestSeq` are gone. */
  dropped: boolean;
  droppedCount: number;
}

/**
 * A change token for the whole game state.
 *
 * `revision` advances on every mutation the store is told about, `eventSeq` on every published
 * event. Two reads with equal pairs saw the same world; anything else means re-read. `simMs`
 * rides along because a deadline compared against wall time is always wrong.
 */
export interface StateRevision {
  revision: number;
  eventSeq: number;
  simMs: number;
  tick: number;
}

// ------------------------------------------------------------ agent session

/**
 * The three collaboration modes.
 *
 *  - `guide`: read-only. Answers, recommendations, explanations. The agent never touches the world.
 *  - `assist`: the player drives. The agent may draw overlays and propose steps.
 *  - `play`: the agent may perform game actions while it owns control, until stopped.
 */
export type AgentMode = "guide" | "assist" | "play";

/** Who is allowed to move the character right now. */
export type AgentControlOwner = "player" | "agent";

export type AgentApprovalKind = "control" | "trade";

// ------------------------------------------------------------- state views

export interface PlayerView {
  position: Vec3;
  regionId: RegionId;
  health: number;
  maxHealth: number;
  /** Which way the player is facing, radians, 0 = +Z (north), increasing toward +X. */
  facingRad: number;
  /**
   * A fight is happening right now: the player has a target, or an enemy has engaged them.
   * It clears on the frame the last enemy dies or disengages, so `waitFor(() => !inCombat)` is a
   * safe way for an agent to wait out a kill. The eight-second no-regen window is a different
   * question — read `regenBlocked` for that.
   */
  inCombat: boolean;
  /** The PRD 2.3 no-regen window: true for eight seconds after the last blow in either direction. */
  regenBlocked: boolean;
  /** Live target, or null. Non-null implies `inCombat`. */
  targetId: EntityId | null;
  /** Enemies that have engaged the player and are still alive. */
  engagedBy: EntityId[];
  dead: boolean;
  moving: boolean;
  activityKind: string | null;
  combatLevelEstimate: number;
}

export interface SkillView { level: number; xp: number; xpToNext: number }

export interface ActivitySummary {
  kind: string;
  skill?: SkillId;
  entityId?: EntityId;
  recipeId?: RecipeId;
  /** 0..1 for the current unit of work. */
  progress: number;
  completed: number;
  remaining: number;
}

/**
 * One id a quest objective points at.
 *
 * Objective prose is prose: it names the Bracken Pit, not `bracken_pit`. Everything actionable in
 * a sentence appears here instead, because `moveTo`, `interact` and `getInventory` all take ids and
 * a player's journal should never print one.
 */
export type QuestObjectiveRef =
  | { kind: "item"; id: ItemId }
  | { kind: "entity"; id: EntityId }
  | { kind: "location"; id: string }
  | { kind: "enemyFamily"; id: string }
  | { kind: "recipe"; id: RecipeId }
  | { kind: "spell"; id: SpellId };

export interface QuestSummary {
  id: QuestId;
  name: string;
  regionId: RegionId;
  status: "unstarted" | "active" | "complete";
  stage: number;
  stageCount: number;
  /** Player-facing prose. Never contains an id. */
  currentObjective: string | null;
  /**
   * Every id the current objective refers to, in the order the sentence names them. Empty when the
   * quest is not active. An agent reads this instead of parsing `currentObjective`.
   */
  currentObjectiveRefs: QuestObjectiveRef[];
  requirements: Partial<Record<SkillId, number>>;
}

export interface DialogueView {
  npcId: EntityId;
  speaker: string;
  text: string;
  options: { id: string; text: string; enabled: boolean; disabledReason?: string }[];
}

/**
 * The sim clock, as a value.
 *
 * Every deadline the game hands out — a recovery cache's expiry, a crop's growth, a respawn — is
 * stamped in SIM milliseconds, and until this existed there was no way to read the sim clock
 * through the API at all. A caller holding `expiresAtMs` could only guess at "how long is left" by
 * anchoring off `GameEvent.atMs` and coasting at wall rate between events, which is wrong whenever
 * the clock is paused or rescaled and silently wrong in a world that happens to be quiet.
 *
 * `paused` and `timeScale` are here because a countdown that ignores them is a countdown that
 * lies, and both the death report and an agent planning around a deadline need to know.
 */
export interface TimeView {
  /** Sim milliseconds since boot. The frame every `*AtMs` field in the game is expressed in. */
  simMs: number;
  /** Whole sim ticks elapsed. `simMs / SIM_TICK_MS`, without the rounding question. */
  tick: number;
  /** Sim milliseconds per real millisecond. 1 in normal play. */
  timeScale: number;
  paused: boolean;
}

export interface BankView { slots: ItemStack[]; usedSlots: number; capacity: number }

/**
 * One row of the spellbook, resolved for the player standing there right now.
 *
 * `maxHit` is computed WITH worn gear, not bare, because the question the panel answers is "what
 * does this do if I cast it now" and the player is wearing what they are wearing. `castable`
 * separates a locked spell from one missing its matching Essence, so the UI can say which.
 */
export interface SpellRow {
  id: SpellId;
  name: string;
  element: SpellElement;
  rung: SpellRung;
  reqLevel: number;
  /** Highest damage this spell can roll at the player's current Magic level and worn gear. */
  maxHit: number;
  baseXp: number;
  /** Resolved from the equipped staff or wand, not a fixed spell-table cadence. */
  castMs: number;
  requiredElement: SpellElement;
  fuelCost: number;
  unlocked: boolean;
  castable: boolean;
  /** Null when castable; otherwise a player-facing, current-state reason. */
  blockedBy: string | null;
  description: string;
}

export interface EquippedMagicWeaponView {
  itemId: ItemId;
  name: string;
  element: SpellElement;
  charges: number;
  capacity: number;
  rechargeItemId: ItemId;
  rechargeCost: number;
}

export interface SpellbookView {
  spells: SpellRow[];
  /** The player's standing choice, or null when the game is picking. */
  preferredSpellId: SpellId | null;
  /** What a "Cast at" would actually throw right now, or null if nothing is castable. */
  activeSpellId: SpellId | null;
  magicLevel: number;
  /** The equipped charged elemental wand or staff, if any. */
  equippedWeapon: EquippedMagicWeaponView | null;
  /** Matching essence carried in the 28-slot inventory, including zeroes. */
  essence: Record<SpellElement, number>;
  /** Every released element. Fire joined the list with the tier-20 Kilnhalt region. */
  releasedElements: SpellElement[];
}

export interface ShopView {
  shopId: EntityId;
  stock: { itemId: ItemId; name: string; buyPrice: number; sellPrice: number; quantity: number }[];
  /** Authoritative per-unit quotes for carried items, including goods absent from shop stock. */
  sellPrices: Record<ItemId, number>;
  currency: number;
}

export interface DocHit { docId: string; title: string; section: string; snippet: string; score: number }

/**
 * One assistance overlay.
 *
 * `highlight` is "this thing": a ground ring at the target. `marker` is "go here": a pin, a ground
 * route from the player to it that follows them as they walk, and an optional label; it clears
 * itself when the player arrives (`overlay.arrived`) unless `persist` is set. `path` is a raw
 * polyline for callers that already have one. `label` is text alone.
 */
export interface OverlaySpec {
  id: string;
  kind: "highlight" | "path" | "marker" | "label";
  entityId?: EntityId;
  /** Route/location id. The API resolves this to a fixed world position before rendering. */
  locationId?: string;
  position?: Vec3;
  path?: Vec3[];
  /** Label text. On a marker this floats above the pin. */
  text?: string;
  /** "#rrggbb" */
  colour?: string;
  /** Default 0, meaning until cleared. */
  ttlMs?: number;
  /** Marker only: stay after the player arrives. Default false. */
  persist?: boolean;
  /** Marker only: metres from the target that count as arriving. Defaults by target kind. */
  arriveRadius?: number;
  /** Marker only: draw the ground route from the player. Default true. */
  route?: boolean;
}

export type MoveTarget = { entityId: EntityId } | { position: Vec3 } | { locationId: string };

/** A previewed route. `points` is drawable as a `path` overlay as-is. */
export interface PathPlan {
  points: Vec3[];
  /** Metres walked, excluding portal and shortcut legs. */
  pathLength: number;
  etaMs: number;
  /** Route-graph hops the walk needs beyond the navmesh, in order. Empty for a plain walk. */
  legs: { kind: "walk" | "shortcut" | "portal"; fromId: string; toId: string; reqLevel?: number }[];
}

// ------------------------------------------------------ the real-engine feature lab

/** The focused workbench selected by the lab route and panel. */
export type FeatureLabMode = "combat" | "building";

/** The production structure recipe families the building workbench can assemble. */
export type FeatureLabStructureKind = "prefab" | "composition" | "wall-run";

/** Regional architecture palettes available to the structure renderer. */
export type FeatureLabStructureKit = "plaster" | "timber" | "stone";

export interface FeatureLabStructureSelection {
  kind: FeatureLabStructureKind;
  id: string;
  kit: FeatureLabStructureKit;
  width: number;
  depth: number;
  seed: number;
}

/** JSON-safe proof of the structure currently assembled through the production entity renderer. */
export interface FeatureLabStructureView {
  ready: boolean;
  revision: number;
  selection: FeatureLabStructureSelection;
  variant: string | null;
  partCount: number;
  assetCount: number;
  collisionCount: number;
  buildMs: number;
  bounds: {
    min: Vec3;
    max: Vec3;
  } | null;
}

/** The two semantic actor families the empty production-engine lab can place. */
export type FeatureLabTargetKind = "npc" | "creature";

/** A canonical spawn choice. Rendering and combat data stay behind the id in production content. */
export interface FeatureLabPreset {
  id: string;
  label: string;
  kind: FeatureLabTargetKind;
  tier: number;
}

export interface FeatureLabCatalog {
  targets: Readonly<Record<FeatureLabTargetKind, readonly FeatureLabPreset[]>>;
  equipment: readonly {
    slot: EquipSlot;
    label: string;
    items: readonly { id: ItemId; label: string }[];
  }[];
  skills: readonly { id: SkillId; label: string }[];
  spells: readonly { id: SpellId; label: string }[];
  structures: {
    prefabs: readonly { id: string; label: string }[];
    compositions: readonly { id: string; label: string }[];
    kits: readonly { id: FeatureLabStructureKit; label: string }[];
  };
}

/** Narrow animation evidence published without making contracts depend on the render layer. */
export interface FeatureLabMotionView {
  pose?: string;
  motion?: string | null;
  clip?: string | null;
  time?: number | null;
  liveRig?: boolean;
}

/** Semantic and visual evidence from the shared yard driven by the normal Corealm engine. */
export interface FeatureLabState {
  ready: boolean;
  engine: "corealm-production";
  world: "fallowmarch-yard";
  mode: FeatureLabMode;
  walkingEnabled: boolean;
  playerVisible: boolean;
  freeCameraEnabled: boolean;
  player: PlayerView;
  playerPosition: Vec3;
  playerMotion: FeatureLabMotionView | null;
  movement: {
    mode: "idle" | "path" | "direct";
    destination: Vec3 | null;
    destinationEntityId: EntityId | null;
  };
  selectedEntityId: EntityId | null;
  /** Opt-in production foliage/resource comparison yard, absent in ordinary lab fixtures. */
  presentation?: FeatureLabPresentationView;
  structure: FeatureLabStructureView;
  bank: {
    entityId: EntityId;
    state: string;
    position: Vec3;
    screen: readonly [number, number] | null;
    contents: BankView;
    inventory: ItemStack[];
  } | null;
  altar: {
    entityId: EntityId;
    state: "dormant" | "awakened";
    element: SpellElement;
    interactions: InteractionId[];
    orbItemId: ItemId;
    orbConsumed: boolean;
  } | null;
  target: {
    kind: FeatureLabTargetKind;
    presetId: string;
    entityId: EntityId;
    name: string;
    state: string;
    position: Vec3;
    screen: readonly [number, number] | null;
    health: number | null;
    maxHealth: number | null;
    motion: FeatureLabMotionView | null;
    /**
     * Live AI readback for the spawned creature, or null for an NPC.
     *
     * Health alone cannot tell a test whether a creature aggroed, chased, gave up, or came back:
     * all four leave the health bar exactly where it was. `systems/enemyAI.ts` already tracks the
     * answer in `state.world.enemies[id]`, and this publishes it rather than making the harness
     * guess from positions.
     */
    ai: FeatureLabCreatureAi | null;
  } | null;
  equipment: Record<EquipSlot, ItemId | null>;
  equipmentTotals: EquipmentBonuses;
  levels: Record<SkillId, number>;
  spellId: SpellId | null;
  liveSpellParticles: number;
  counters: {
    navigationStarted: number;
    navigationCompleted: number;
    combatStarted: number;
    spellLaunched: number;
  };
  errors: string[];
}

export interface FeatureLabPresentationView {
  enabled: boolean;
  resourceEntityIds: EntityId[];
  scatterInstances: number;
}

/** Browser/control surface for setup only; ordinary play still goes through real pointer input. */
/** What `systems/enemyAI.ts` currently thinks the spawned creature is doing. */
export interface FeatureLabCreatureAi {
  /** The runtime mode: idle, aggro (pursuing or fighting), returning to spawn, or dead. */
  state: "idle" | "aggro" | "dead" | "returning";
  /** Behaviour from the content stat block: what it takes to make this creature fight. */
  behaviour: "passive" | "aggressive" | "territorial";
  aggroRadius: number;
  /** Combat level, COMPUTED from the stat block by `enemyCombatLevel`, never authored. */
  level: number;
  /** Pursuit speed, or null when the creature uses the shared default in `systems/enemyAI.ts`. */
  moveSpeedMps: number | null;
  /**
   * Half the widest ground axis at drawn scale, or null when the asset was never measured.
   *
   * `systems/enemyAI.ts` uses it for separation and for how close a pursuer stops, so it is also
   * the only readback that says how big the creature actually is on the ground.
   */
  bodyRadius: number | null;
  spawnPosition: Vec3;
  /** Metres from its spawn point. Compare against `LEASH_METRES` to reason about leashing. */
  distanceFromSpawn: number;
  distanceFromPlayer: number;
  /** Milliseconds of sim time until it respawns, or null when it is not dead. */
  respawnInMs: number | null;
}

/** Lab adapter for the reusable elemental attack system. Damage is deterministic dummy damage. */
export interface SpellRangeState {
  selected: string;
  casting: boolean;
  elapsed: number;
  duration: number;
  castId: number;
  impacts: number;
  totalImpacts: number;
  hits: number;
  damage: number;
  instances: number;
  particleCount: number;
  volumeCount: number;
  solidCount: number;
  vfxUpdateMs: number;
  droppedParticles: number;
  filamentCount: number;
  droppedFilaments: number;
  bodyCount: number;
  droppedBodies: number;
  speed: number;
  repeat: boolean;
  targets: {
    id: string;
    position: Vec3;
    health: number;
    maxHealth: number;
    hits: number;
    status: string | null;
  }[];
}
export interface SpellRangeApi {
  getState(): SpellRangeState;
  select(id: string): void;
  cast(): void;
  reset(): void;
  frame(): void;
}

export interface FeatureLabApi {
  getState(): FeatureLabState;
  getCatalog(): FeatureLabCatalog;
  setMode(mode: FeatureLabMode): FeatureLabState;
  setWalkingEnabled(enabled: boolean): FeatureLabState;
  setPlayerVisible(visible: boolean): FeatureLabState;
  /** Isolated equipped-rig reaction preview; does not change player health or prove gameplay death. */
  previewPlayerReaction(pose: "hit" | "death"): FeatureLabState;
  setFreeCameraEnabled(enabled: boolean): FeatureLabState;
  setStructure(patch: Partial<FeatureLabStructureSelection>): Promise<FeatureLabState>;
  fitStructure(): FeatureLabState;
  /**
   * Spawns one actor in front of the player, replacing whatever was there.
   *
   * `options.distance` places it that many metres out instead of the default 10. Aggro radius is
   * authored per family from 3 m to 22 m, so a fixed distance can only ever exercise one side of
   * it: a passive hen at 3 m and a Rootheart at 22 m need the spawn to move, not the creature.
   */
  spawnTarget(
    kind: FeatureLabTargetKind,
    presetId: string,
    options?: { distance?: number },
  ): Promise<FeatureLabState>;
  setLevel(skillId: SkillId, level: number): FeatureLabState;
  equipPlayer(slot: EquipSlot, itemId: ItemId | null): Promise<FeatureLabState>;
  setSpell(spellId: SpellId): FeatureLabState;
  /**
   * Runs one production action.
   *
   * `flee` walks the player directly away from the target through the real movement system, which
   * is the only way to test disengaging: the player moves at 4.2 m/s and pursuit at about 3.1, and
   * enemies leash 28 m from their own spawn. A teleport would prove none of that.
   */
  perform(
    action: "attack" | "cast" | "flee" | "reset-player" | "awaken-altar" | "open-bank" | "reset-bank",
  ): Promise<FeatureLabState>;
}

declare global {
  interface Window {
    __featureLab?: FeatureLabApi;
  }
}

// --------------------------------------------------------------- the API

/**
 * The canonical game API. This is the ONLY write path into the world.
 *
 * `ui/*`, `agent/tools.ts`, and `debug/gameDebug.ts` all route through this interface. There is no
 * second path. Agent parity depends on it: a human click and a WebMCP call reach the same function.
 *
 * Nothing here throws across the boundary. Failures come back as `Result<T>`.
 */
export interface GameApi {
  // state
  getPlayer(): PlayerView;
  getSkills(): Record<SkillId, SkillView>;
  getInventory(): { slots: (InventorySlot | null)[]; freeSlots: number };
  getEquipment(): { slots: Record<EquipSlot, ItemStack | null>; totals: EquipmentBonuses };
  getActivity(): ActivitySummary | null;
  getQuests(): QuestSummary[];
  getCurrency(): number;
  /** The sim clock. Compare any `*AtMs` deadline against `simMs`, never against wall time. */
  getTime(): TimeView;
  /** The change token. Equal pairs mean nothing happened between two reads. */
  getRevision(): StateRevision;

  // observation
  observe(filter: ObserveFilter): ObservedEntity[];
  inspect(entityId: EntityId): Result<SemanticEntity>;
  searchDocs(query: string, limit?: number): Promise<DocHit[]>;

  // movement
  moveTo(target: MoveTarget): Result<{ pathLength: number; etaMs: number }>;
  /**
   * The path `moveTo` would walk, without walking it. Read-only: exists so an assistant can draw
   * a route for the player to follow. `legs` names the route-graph hops when the navmesh alone
   * cannot reach the target (a portal, an Agility shortcut).
   */
  planPath(target: MoveTarget): Result<PathPlan>;
  stop(): Result<{ stopped: string[] }>;

  // interaction
  interact(entityId: EntityId, interaction: InteractionId): Result<{ started: string }>;
  /** Takes one displayed stack from a world loot container. Omit `stackIndex` to take all. */
  takeLoot(entityId: EntityId, stackIndex?: number): Result<LootTakeResult>;
  useItem(itemId: ItemId, target?: { itemId: ItemId }): Result<{ effect: string }>;
  equipItem(itemId: ItemId): Result<{ slot: EquipSlot; replaced: ItemId | null }>;
  unequipItem(slot: EquipSlot): Result<{ itemId: ItemId }>;
  /** Compatibility command: uses the nearest valid station. */
  produce(recipeId: RecipeId, quantity: number): Result<{ queued: number; durationMs: number }>;
  /** Starts at the exact station the player or agent selected. */
  produceAt(
    stationId: EntityId,
    recipeId: RecipeId,
    quantity: number,
  ): Result<{ queued: number; durationMs: number }>;
  /** Build one portable cooking fire from a carried log at the first valid nearby sample. */
  buildCampfire(logItemId: ItemId): Result<{
    entityId: EntityId;
    lifetimeMs: number;
    position: Vec3;
  }>;

  // combat
  attack(entityId: EntityId): Result<{ targetId: EntityId; attackSpeedMs: number }>;
  cast(spellId: SpellId, entityId: EntityId): Result<{ targetId: EntityId; castMs: number }>;
  getSpellbook(): SpellbookView;
  /**
   * Sets the standing spell choice, or clears it back to automatic with null.
   *
   * Deliberately NOT gated on the level or available fuel. A player one level short still gets to
   * point at the spell they are working toward, and `systems/combat.ts` falls back to the automatic
   * pick until it becomes castable. Refusing the click would need the UI to explain a rejection
   * that the panel already shows as a lock icon.
   */
  setPreferredSpell(spellId: SpellId | null): Result<{ preferredSpellId: SpellId | null }>;

  // npc, bank, shop
  dialogue(op: "state" | "choose" | "end", optionId?: string): Result<DialogueView | null>;
  bank(
    op: "list" | "deposit" | "withdraw" | "depositAll",
    args?: { itemId?: ItemId; quantity?: number; filter?: string },
  ): Result<BankView>;
  shop(
    op: "list" | "buy" | "sell",
    args?: { shopId?: EntityId; itemId?: ItemId; quantity?: number },
  ): Result<ShopView>;

  // overlays
  overlay(op: "set" | "clear", spec?: OverlaySpec): Result<{ activeCount: number }>;

  // events
  events(
    sinceSeq: number,
    filter?: GameEventType[],
    timeoutMs?: number,
  ): Promise<EventBatch>;
}
