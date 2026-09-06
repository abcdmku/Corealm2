/**
 * The player's character: one skeleton, many rebound parts, one mixer, one pose machine.
 *
 * ## The comment this file used to carry was wrong, and that is why it was broken
 *
 * It claimed "every character pack and both animation libraries share ONE identical 65-bone
 * skeleton". They do not. Hashing each GLB's `inverseBindMatrices` buffer across models/character,
 * models/outfit and models/animation finds FOUR distinct 65-joint humanoid rigs:
 *
 *   ba5af210  base_male, alone
 *   eea9805d  base_female + hair_long + hair_buns + every female outfit part
 *   3c715354  eyebrows + hair_short + hair_buzzed + hair_beard + every male outfit part
 *   0d2ac055  both animation libraries
 *
 * What they share is the JOINT LIST: 65 joints, byte-identical names in byte-identical order. That
 * is why a NAME-KEYED rebind works (take the body's `Bone` objects, keep the part's own
 * `boneInverses`) and why no retargeting is needed. Believing the bind poses were identical is what
 * produced `attachOutfit`, which cloned each outfit with `SkeletonUtils.clone` — an independent
 * skeleton by design — and parented it as a SIBLING of the body while the `AnimationMixer` was
 * built on the body only. Result, on screen 100% of the time: a tunic frozen in T-pose across the
 * shoulders and a boot hanging in front of the shins
 * (runs/corealm/screenshots/baseline-bank.png), plus 65 orphan Bones per piece being matrix-updated
 * every frame — 195 dead nodes on the player alone. `render/skinning.ts` owns that rebind now; this
 * file calls it.
 *
 * Only the player and a handful of named NPCs get a rig. The rest of the world's characters go
 * through the instanced, CPU-skinned path in `entityViews.ts`, because a fully dressed character is
 * ~27k triangles across ten skinned meshes and the draw-call budget does not survive many of them.
 */
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { EquipSlot, ItemId, ItemStack, Vec3 } from "../contracts.js";
import { MOVEMENT } from "../app/config.js";
import type { TraversalSample } from "../systems/traversalMotion.js";
import { TraversalPoseLayer } from "./traversalPose.js";
import type { AssetRegistry } from "./assets.js";
import * as equipmentVisuals from "./equipmentVisuals.js";
import {
  FISHING_ROD_LOOKS,
  fishingRodAssetId,
  fishingRodItemForTier,
} from "./proceduralGear.js";
import {
  applyHeadCap,
  collectBones,
  collectSkinnedMeshes,
  createSkeletonCache,
  hairAssetFor,
  headCapHeightFor,
  mergeSkinnedMeshes,
  rebindSkinnedPart,
  type SkeletonCache,
} from "./skinning.js";

/** What the character is doing, which decides the clip. */
export type CharacterPose =
  | "idle" | "walk" | "run"
  | "mine" | "chop" | "fish"
  | "attack_melee" | "cast" | "hit" | "death"
  | "eat" | "climb" | "vault" | "balance" | "slide" | "produce" | "bank";

/** Contact events measured from the authored clips and consumed by sound and combat feedback. */
export type CharacterMotionEvent =
  | { kind: "footstep"; foot: "left" | "right"; pose: CharacterPose }
  | { kind: "swing" | "impact"; pose: CharacterPose };

interface ClipMotionMarker {
  phase: number;
  kind: CharacterMotionEvent["kind"];
  foot?: "left" | "right";
}

/**
 * Normalised contact frames measured from the shipped GLBs with forward kinematics.
 *
 * The jog's feet touch down near 0.10 and 0.60. TreeChopping's hands accelerate through 0.08
 * and settle onto the target near 0.22. Sword_Attack reaches its target near 0.30. These are
 * presentation data, not guesses based on gameplay timers.
 */
const CLIP_MOTION_MARKERS: Readonly<Record<string, readonly ClipMotionMarker[]>> = {
  Walk_Loop: [
    { phase: 0.10, kind: "footstep", foot: "left" },
    { phase: 0.60, kind: "footstep", foot: "right" },
  ],
  Jog_Fwd_Loop: [
    { phase: 0.10, kind: "footstep", foot: "left" },
    { phase: 0.60, kind: "footstep", foot: "right" },
  ],
  Sprint_Loop: [
    { phase: 0.10, kind: "footstep", foot: "left" },
    { phase: 0.60, kind: "footstep", foot: "right" },
  ],
  TreeChopping_Loop: [
    { phase: 0.08, kind: "swing" },
    { phase: 0.22, kind: "impact" },
  ],
  Sword_Attack: [
    { phase: 0.18, kind: "swing" },
    { phase: 0.30, kind: "impact" },
  ],
  Sword_Regular_A: [
    { phase: 0.35, kind: "swing" },
    { phase: 0.56, kind: "impact" },
  ],
  Punch_Jab: [
    { phase: 0.20, kind: "swing" },
    { phase: 0.42, kind: "impact" },
  ],
  Spell_Simple_Shoot: [
    { phase: 0.32, kind: "swing" },
    { phase: 0.42, kind: "impact" },
  ],
  // The mirror is a reflection in space, not in time, so its contact frames are the original's.
  Spell_Simple_Shoot_Mirror: [
    { phase: 0.32, kind: "swing" },
    { phase: 0.42, kind: "impact" },
  ],
};

const GATHER_IMPACT_PHASE = 0.22;

/**
 * Pose to clip name, from the shared library.
 *
 * The gaps are real and worth stating: neither library ships a fishing or a mining clip (measured —
 * the 85 loaded clips are listed in animation_library_1 and _2 and contain neither), so fishing
 * borrows a held-rail idle and the feedback comes from the bobber and ripple instead of the body,
 * and mining borrows the tree-chopping swing, which reads correctly with a pickaxe in hand. `mine`
 * and `chop` therefore resolve to the SAME action; `play` treats that as a no-op rather than a
 * restart, so switching a gathering target mid-swing does not stutter.
 *
 * Every name here resolves against the loaded set — verified against `listClips()`, 85 names, zero
 * misses. Reachability, not resolution, was the old bug: `poseFor` could emit only 9 of these 15.
 */
const POSE_CLIPS: Record<CharacterPose, readonly string[]> = {
  idle: ["Idle_Loop", "Idle_FoldArms_Loop"],
  walk: ["Walk_Loop"],
  run: ["Jog_Fwd_Loop", "Sprint_Loop"],
  mine: ["TreeChopping_Loop"],
  chop: ["TreeChopping_Loop"],
  fish: ["Idle_Rail_Loop", "Idle_Loop"],
  attack_melee: ["Sword_Attack", "Sword_Regular_A", "Punch_Jab"],
  // MIRRORED. The library's only cast raises the LEFT hand and a staff is a main-hand item held in
  // the right, so played as authored the caster raised an empty hand while the staff hung at their
  // side. `render/assets.ts` registers a reflected copy of each; the fallbacks are the originals, so
  // a build whose mirror registration failed still animates rather than freezing on idle.
  cast: ["Spell_Simple_Shoot_Mirror", "Spell_Simple_Shoot", "Spell_Simple_Idle_Loop"],
  hit: ["Hit_Chest", "Hit_Knockback"],
  death: ["Death01"],
  eat: ["Consume"],
  climb: ["ClimbUp_1m", "NinjaJump_Start"],
  vault: ["NinjaJump_Start"],
  // These source clips provide the base gait/stance. TraversalPoseLayer authors the arms,
  // narrow foot placement and planted crouch; the names do not relabel unchanged idle/walk.
  balance: ["Walk_Loop"],
  slide: ["Idle_Loop"],
  produce: ["Fixing_Kneeling", "Interact"],
  bank: ["Chest_Open", "Interact"],
};

/**
 * Poses that play once and fall back to idle rather than looping.
 *
 * `climb` used to be here and is not any more. `ClimbUp_1m` is 0.667 s (measured in
 * animation_library_2.glb) against an authored Agility traversal of 2-4 s, so the player climbed
 * once, snapped to idle, stood still for the remaining 1.3-3.3 s and then teleported to the exit —
 * runs/corealm/diagnosis/animation-and-movement-feel.md finding 12. Looping it is that finding's
 * own first recommendation.
 */
const ONE_SHOT: ReadonlySet<CharacterPose> = new Set(["attack_melee", "cast", "hit", "death", "eat", "bank"]);

/**
 * Playback rate for a pose whose clip length does not match the event it stands for.
 *
 * The rig is not told how long a traversal lasts — `activity.started` carries `durationMs` but
 * `PoseInput` does not — so `climb` runs at a fixed 0.5x, a 1.333 s cycle, which is 1.5 to 3 hauls
 * across the authored 2-4 s leg. That reads as a scramble instead of as a stall. Everything not
 * listed here plays at its authored rate; locomotion is scaled separately and per frame by
 * `setLocomotionSpeed`.
 */
const POSE_TIME_SCALE: Partial<Record<CharacterPose, number>> = { climb: 0.5 };

/**
 * Crossfade lengths, in seconds.
 *
 * 0.18 s for locomotion, which is the gait blend and wants to be soft. One-shots get 0.06 s because
 * `Hit_Chest` is only 0.333 s long (measured from animation_library_1): a 0.18 s fade in plus a
 * 0.18 s fade out consumes the whole clip and the flinch never reaches full weight.
 */
const CROSSFADE_SECONDS = 0.18;
const ONE_SHOT_CROSSFADE_SECONDS = 0.06;

/**
 * Ground speed the walk clip was authored at, in m/s.
 *
 * Forward-kinematics measurement of animation_library_1.glb: 240 samples per clip, body-relative
 * velocity of `ball_l` through its planted phase. Walk_Loop implies 0.98 m/s. It is close enough to
 * the configured walk band that playback scaling can plant the foot without making the pose look
 * wrong.
 *
 * Jog_Fwd_Loop and Sprint_Loop imply 5.92 and 9.15 m/s. Matching either to 4.2 m/s by time scaling
 * makes it visibly slow. Running therefore uses the presentation rates in MOVEMENT instead. The
 * tradeoff is intentional: brisk cadence wins over scalar foot planting until the rig has stride
 * warping, foot IK, or a clip authored for 4.2 m/s.
 */
const WALK_CLIP_SPEED = 0.98;

/**
 * Clamp on the walk time scale.
 *
 * A player pinned against a wall reports ~0 m/s, and 0 would freeze the clip mid-stride, which
 * reads as a crash rather than as a stall. The gait normally switches to idle before that occurs,
 * but the floor also protects the frame where a pose transition and a speed update cross.
 *
 * The ceiling was 1.6, and that was measured to be wrong. Real ground speed under direct WASD
 * input, sampled with `performance.now()` and `getPlayerPosition()` inside ONE in-page evaluate so
 * the tool round-trip cancels: 1.727 m/s pressing W, 2.304 m/s pressing S, 1.702 m/s pressing D
 * (runs/corealm/audit/rig2-slide.ts). At 1.727 m/s `Walk_Loop` wants 1.762 and got 1.6, so the feet
 * ran 0.159 m/s slow. 2.2 covers the whole walk band up to 2.16 m/s; `Walk_Loop` is a 1.333 s
 * cycle, so 2.2x is 1.65 strides per second, which is a power walk and not a scurry.
 */
const MIN_WALK_TIME_SCALE = 0.6;
const MAX_WALK_TIME_SCALE = 2.2;

/** Jog is the normal run. Sprint is used only when the asset library cannot supply the jog. */
const RUN_CLIPS: ReadonlySet<string> = new Set(["Jog_Fwd_Loop", "Sprint_Loop"]);

/**
 * Where a bone-attached slot hangs.
 *
 * `Head`, `hand_r` and `hand_l` are all confirmed present in base_male.glb and in every outfit part
 * (all 65 joints ship in every file, whether the part skins to them or not).
 */
const BONE_FOR_SLOT: Partial<Record<EquipSlot, string>> = {
  head: "Head",
  mainHand: "hand_r",
  offHand: "hand_l",
};

/** Slots drawn by rebinding a skinned part onto the body's skeleton rather than by bone attachment. */
const SKIN_SLOTS: ReadonlySet<EquipSlot> = new Set<EquipSlot>(["body", "legs", "feet", "hands"]);

/**
 * Which body region a layered part covers, keyed off the manifest's own tags.
 *
 * The outfit pack tags every modular part with a region word: `torso` (chest), `legs`, `feet`
 * (boots), `arms` (gloves), `head` (hood or helmet), `shoulder` (pauldron), and `neck` (scarf).
 * Hair is tagged both `hair` and `head`, so it first gets its own region. Headgear then hides
 * that region while worn, and removing the headgear restores the original hair.
 *
 * This is what lets an equipped chest piece REPLACE the starting tunic instead of layering inside
 * it, and it is what the head-cap coverage test below counts.
 */
const REGION_TAGS: readonly (readonly [string, string])[] = [
  ["hair", "hair"],
  ["neck", "neck"],
  ["shoulder", "shoulder"],
  ["torso", "body"],
  ["legs", "legs"],
  ["feet", "feet"],
  ["arms", "hands"],
  ["head", "head"],
];

/** Draw order of the layered regions. Fixed, so the assembled part list is deterministic. */
const REGION_ORDER: readonly string[] = ["body", "legs", "feet", "hands", "shoulder", "neck", "head", "hair"];

/** The regions that must all be dressed before the base body may be cut down to a head cap. */
const HEAD_CAP_REQUIRES: readonly string[] = ["body", "legs", "feet", "hands"];

/**
 * How a modular outfit id decomposes. The coverage completion below uses the four body regions;
 * head, shoulder, and neck pieces remain optional.
 */
const OUTFIT_ID = /^outfit_(male|female)_(peasant|ranger|knight)_(chest|legs|boots|gloves|helmet|hood|pauldron|scarf)$/;

/** The part that dresses each region `HEAD_CAP_REQUIRES` counts, in the order they are appended. */
const COVERAGE_PARTS: readonly (readonly [part: string, region: string])[] = [
  ["chest", "body"],
  ["legs", "legs"],
  ["boots", "feet"],
  ["gloves", "hands"],
];

/**
 * The shape `render/equipmentVisuals.ts` exports, restated here as a port.
 *
 * The rig cannot import that module directly: it is being written by another worker in the same
 * wave, and this file has to typecheck and run before it lands. The names and fields match the
 * frozen signature exactly, so `import * as equipmentVisuals` satisfies this interface structurally
 * with no adapter. Until `setGearVisuals` is called the equipment path resolves nothing and the
 * character wears its build-time outfit, which is what it does today.
 */
export interface GearAppearanceLike {
  assetId: string;
  slot: EquipSlot;
  attach: "bone" | "skin";
  tint?: number;
  scale?: number;
  accent?: number;
  orb?: GearOrbAppearanceLike;
}

export interface GearOrbAppearanceLike {
  element: "wind" | "earth" | "water" | "fire";
  charged: boolean;
  colour: number;
  emissive: number;
  position: readonly [number, number, number];
  radius: number;
}

/** Charge state affects the magic weapon's built-in orb, never a hand slot of its own. */
export interface GearWeaponChargePresentationLike {
  itemId: ItemId | null;
  charged: boolean;
}

const NO_WEAPON_CHARGE: GearWeaponChargePresentationLike = { itemId: null, charged: false };

export interface WeaponSocketLike {
  bone: string;
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  scale: number;
}

export interface GearVisualsPort {
  gearAppearance(itemId: ItemId): GearAppearanceLike | null;
  weaponSocket(assetId: string): WeaponSocketLike | null;
  readonly VISIBLE_EQUIP_SLOTS: readonly EquipSlot[];
  /**
   * Every part an item contributes. Tier 5 and 10 body pieces carry a pauldron as well as a chest,
   * so the silhouette grows with tier; `gearAppearance` returns only the first of them.
   */
  gearAppearanceParts?(itemId: ItemId): readonly GearAppearanceLike[];
  /** Resolves the current magic weapon and its built-in elemental socket state. */
  gearAppearancePartsWithCharge?(
    itemId: ItemId,
    charge: GearWeaponChargePresentationLike,
  ): readonly GearAppearanceLike[];
  /** `weaponSocket` with the grip offset corrected for `appearance.scale`. Prefer it when present. */
  weaponAttachment?(appearance: GearAppearanceLike): WeaponSocketLike | null;
  /** Applies tint and accent by CLONING each material. The rig disposes those clones. */
  applyGearAppearance?(object: THREE.Object3D, appearance: GearAppearanceLike): void;
  /** Every asset the item table can ask for, so the rig can warm them before the first equip. */
  gearAssetIds?(body?: "male" | "female"): readonly string[];
}

/**
 * Fist centre in the hand bones' local space, for an asset the appearance port has no socket for.
 *
 * Measured on base_male.glb: in `hand_r` local space the finger roots run along +Y (middle_01_r at
 * (-0.005, 0.115, 0.015)), the knuckle line is Z (index_01_r z +0.041, pinky_01_r z -0.035) and the
 * palm normal is -X, so a closed fist grips along local Z with its centre at (-0.010, 0.085, 0).
 * `hand_l` mirrors about X. `render/equipmentVisuals.ts` owns the per-asset grip offsets that put
 * each weapon's own grip centre here; this is only what is left when it does not know the asset.
 *
 * The constant this replaced — rotation (PI/2, 0, 0) with position (0, 0.03, 0.04), shared by all
 * four weapons — put the sword's entire 21 cm grip and pommel out past the pinky.
 */
const FIST_RIGHT: readonly [number, number, number] = [-0.01, 0.085, 0];
const FIST_LEFT: readonly [number, number, number] = [0.01, 0.085, 0];

export interface CharacterRigOptions {
  /** Base body asset id from the manifest, e.g. "base_male". */
  bodyAssetId: string;
  /** Optional outfit part asset ids layered onto the same skeleton. */
  outfitAssetIds?: string[];
  /**
   * Hair asset, layered like any other part.
   *
   * Undefined does NOT mean bald: it means "pick one", through `skinning.hairAssetFor` seeded on
   * `hairSeed`. Bald was the old behaviour and it was a defect — the player was the only character
   * in the world without hair, because every NPC goes through `skinning.loadDressedCharacter`
   * which picks for itself and `boot.ts` passes no hair. Pass `null` for a genuinely bald head.
   */
  hairAssetId?: string | null;
  /**
   * Seed for the automatic hair pick. Defaults to the body asset id.
   *
   * Deterministic by construction: `hairAssetFor` is a pure function of this string, so the same
   * seed gives the same hair across reloads, screenshots and processes.
   */
  hairSeed?: string;
  /**
   * Append the missing coverage parts of a partial outfit set. Default true.
   *
   * Set false only to look at exactly the parts you passed.
   */
  completeOutfit?: boolean;
  /**
   * Force the head cap on or off instead of deciding it from what the character is wearing.
   *
   * The default (undefined) is the coverage test in `applyCap`: cut only when body, legs, feet and
   * hands are all dressed. Pass true to cut anyway — correct for a character whose outfit covers
   * the arms in a way the manifest tags do not say.
   */
  headCap?: boolean;
  castShadow?: boolean;
  /**
   * Merge same-material layered parts into one draw. Default true.
   *
   * Set false only to debug what a single part looks like: the merge is what keeps a dressed
   * player from costing more draw calls than the sibling-attached version it replaces.
   */
  mergeParts?: boolean;
  /** Warm every equippable visual after build. Default true; boot defers the player's set. */
  preloadGear?: boolean;
  /** Fit the player's jog stride to 4.2 m/s at its normal 1.2x cadence. */
  playerLocomotion?: boolean;
}

/** What `poseFor` needs to know. `activitySkill` is what splits gathering three ways. */
export interface PoseInput {
  moving: boolean;
  /** Ground speed in m/s. Must come from the sim, never from a per-frame position delta. */
  speed: number;
  dead: boolean;
  /**
   * A fight is in progress. Read for context only: the swing and flinch poses are one-shots driven
   * off the combat hit stream, because `inCombat` is a multi-second state flag and `Sword_Attack`
   * and `Hit_Chest` are 1.533 s and 0.333 s events. A pose selector cannot see the edge that
   * matters, so it must not own these two.
   */
  inCombat: boolean;
  activityKind: string | null;
  /** `ActivitySummary.skill`. "mining" | "woodcutting" | "fishing" for a gathering activity. */
  activitySkill?: string | null;
  /** Resource tier for a gathering activity. Fishing uses it to choose the held rod color. */
  activityTier?: number | null;
  /** Selected tool when the gathering system exposes one. This wins over `activityTier`. */
  activityToolItemId?: ItemId | null;
}

export class CharacterRig {
  readonly root = new THREE.Group();

  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private locomotionClips = new Map<string, THREE.AnimationClip>();
  private current: CharacterPose = "idle";
  private currentAction: THREE.AnimationAction | null = null;
  private currentClipName: string | null = null;
  private markerAction: THREE.AnimationAction | null = null;
  private markerPhase = 0;
  private controlledTimeScale: number | null = null;
  private readonly motionEvents: CharacterMotionEvent[] = [];
  private ready = false;
  private missingClips = new Set<string>();
  private traversalSample: TraversalSample | null = null;
  private readonly traversalPose = new TraversalPoseLayer();
  private readonly traversalHiddenGear = new Map<THREE.Object3D, boolean>();

  // Assembly.
  private bodyAssetId = "";
  private body: THREE.Object3D | null = null;
  /** The node layered meshes are parented onto: the same parent the body's own meshes hang off. */
  private layerTarget: THREE.Object3D | null = null;
  private hostBones = new Map<string, THREE.Bone>();
  private skeletonCache: SkeletonCache = createSkeletonCache();
  private castShadow = true;
  private mergeParts = true;
  private forceHeadCap: boolean | undefined;

  // Layered skinned parts.
  private baseOutfitIds: string[] = [];
  private gearBySlot = new Map<EquipSlot, readonly GearAppearanceLike[]>();
  private layerMeshes: THREE.SkinnedMesh[] = [];
  /** Geometries and materials this rig allocated for the current layer set. Nothing else owns them. */
  private layerGeometries: THREE.BufferGeometry[] = [];
  private layerMaterials: THREE.Material[] = [];
  /** null until the first assembly. No real signature can be null, so the first call runs. */
  private layerSignature: string | null = null;
  /** Source identities of the last successfully committed layers, retained across mesh merging. */
  private committedLayerAssets: string[] = [];
  private layerLoadPending = false;
  private layerWork: Promise<void> = Promise.resolve();

  // Head cap.
  private bodyMeshes: THREE.SkinnedMesh[] = [];
  private bodyGeometries = new Map<THREE.SkinnedMesh, THREE.BufferGeometry>();
  private capGeometries: THREE.BufferGeometry[] = [];
  private capRemoved: { mesh: THREE.SkinnedMesh; parent: THREE.Object3D }[] = [];
  private capped = false;

  // Bone attachments.
  private boneAttachments = new Map<EquipSlot, THREE.Object3D>();
  private boneAttachmentMaterials = new Map<EquipSlot, THREE.Material[]>();
  private slotEpoch = new Map<EquipSlot, number>();
  private slotLoading = new Map<EquipSlot, string>();
  private slotLoadErrors = new Map<EquipSlot, string>();
  /** Temporary gathering tool shown during its activity. Worn gear remains in `gearBySlot`. */
  private activityMainHandKey: string | null = null;
  /**
   * Defaults to the real `render/equipmentVisuals.ts`, so worn gear renders with no wiring at all.
   * `setGearVisuals` overrides it — a test hands in a stub, and null turns equipment visuals off.
   */
  private gear: GearVisualsPort | null = equipmentVisuals;

  constructor(private readonly assets: AssetRegistry) {
    this.root.name = "character-rig";
  }

  /**
   * Builds the rig: one cloned body, one skeleton, one mixer, and the outfit rebound onto it.
   *
   * `SkeletonUtils.clone` is required rather than `Object3D.clone` for the body: a plain clone
   * shares the source skeleton, so every character built from one asset would animate in lockstep.
   * The layered parts are cloned the same way and then have their cloned skeletons thrown away by
   * `rebindSkinnedPart`, which is the whole point.
   */
  async build(options: CharacterRigOptions): Promise<boolean> {
    try {
      const source = await this.assets.load(options.bodyAssetId);
      const body = cloneSkinned(source) as THREE.Group;
      body.name = "body";
      this.root.add(body);

      this.bodyAssetId = options.bodyAssetId;
      this.body = body;
      this.castShadow = options.castShadow !== false;
      this.mergeParts = options.mergeParts !== false;
      this.forceHeadCap = options.headCap;
      this.bodyMeshes = collectSkinnedMeshes(body);
      const first = this.bodyMeshes[0];
      if (!first) return this.fail();

      for (const mesh of this.bodyMeshes) {
        mesh.castShadow = this.castShadow;
        mesh.receiveShadow = this.castShadow;
        mesh.geometry = dequantizeGeometry(mesh.geometry);
        // Remembered AFTER the dequantize, so `restoreCap` puts back the geometry the head cap was
        // cut from rather than the quantized original.
        this.bodyGeometries.set(mesh, mesh.geometry);
      }

      this.layerTarget = first.parent ?? body;
      this.hostBones = collectBones(body);
      this.skeletonCache = createSkeletonCache();
      // Run the body's own meshes through the same cache the parts use, so a part authored on the
      // body's rig resolves to the same `THREE.Skeleton` OBJECT and stays mergeable with it. For
      // the body this is a no-op rebind: the host bones are its own and boneInverses is unchanged.
      for (const mesh of this.bodyMeshes) {
        mesh.bind(this.skeletonCache.resolve(mesh.skeleton, this.hostBones, new Set<string>()), mesh.bindMatrix);
        mesh.bindMode = THREE.AttachedBindMode;
      }

      this.baseOutfitIds = [...(options.outfitAssetIds ?? [])];
      if (options.completeOutfit !== false) this.completeOutfitSet();
      const hair = options.hairAssetId === undefined
        ? hairAssetFor(options.hairSeed ?? options.bodyAssetId, options.bodyAssetId.includes("female") ? "female" : "male")
        : options.hairAssetId;
      if (hair) this.baseOutfitIds.push(hair);

      if (options.playerLocomotion) {
        const jog = this.assets.clip("Jog_Fwd_Loop");
        if (jog) {
          const { bakePlayerJog } = await import("./playerLocomotion.js");
          this.locomotionClips.set(jog.name, bakePlayerJog(jog, body, 3.5).clip);
        }
      }
      this.mixer = new THREE.AnimationMixer(body);
      await this.rebuildLayers();
      this.ready = true;
      this.play("idle", true);
      if (options.preloadGear !== false) this.preloadGear();
      return true;
    } catch {
      return this.fail();
    }
  }

  private fail(): boolean {
    this.ready = false;
    return false;
  }

  /**
   * Warms every asset worn gear can ask for, in the background.
   *
   * MEASURED, and this is the whole reason it exists: with `performance.now()` around
   * `attachBoneSlot`, `applyEquipment` fired 1 ms after a `corealm_equip` landed in the store and
   * then `assets.load("sword")` took 3366 ms and `assets.load("shield")` 5918 ms on first request.
   * For those seconds the player equips a sword and their hand stays empty, which is
   * indistinguishable on screen from the render seam never having been wired at all. The second
   * request took 3 ms, so a warm cache is the entire fix.
   *
   * Deliberately not awaited: callers may schedule this outside the critical boot path.
   * `AssetRegistry.load` deduplicates in-flight requests, so racing it against a later equip costs
   * no duplicate transfer.
   */
  preloadGear(): void {
    const ids = this.gear?.gearAssetIds?.(this.bodyAssetId.includes("female") ? "female" : "male");
    if (!ids || ids.length === 0) return;
    for (const assetId of ids) {
      // Individually, not `loadMany`: one missing id must not refuse the other seven.
      void this.assets.load(assetId).catch(() => undefined);
    }
  }

  /**
   * Appends the coverage parts a partial outfit set is missing, from the same kit.
   *
   * `boot.ts` dresses the player in chest + legs + boots and no gloves, and that one absent part
   * costs two separate visible defects — both of them in
   * runs/corealm/screenshots/rig2-before-bank-crop.png, measured before this landed.
   *
   * First: the peasant `gloves` GLB is the one that carries `Male_Peasant_Arms`, which is the
   * SLEEVES and not merely the hands (inspected: outfit_male_peasant_gloves.glb holds exactly one
   * mesh, Male_Peasant_Arms). Without it the player has bare arms, and the only part of the tunic's
   * sleeve that clears the naked bicep is its dark cuff — which is the "dark object at the
   * chest/shoulder" the brief asks about. It is not a mis-socketed attachment and it is not an
   * unbound part: it is the peasant sleeve's cuff trim, the only 2 cm of the sleeve wider than the
   * arm inside it.
   *
   * Second: `HEAD_CAP_REQUIRES` counts `hands`, so with gloves missing the head cap never fires and
   * the whole naked base body draws under the clothes. The outfit parts are authored to REPLACE the
   * body, not cover it (skinning.applyHeadCap: 5.4 mm of bare thigh outside the trousers, 27.5 mm
   * of bare foot outside the boot), so the bare chest reads through the tunic and the bare knee
   * through the boot top.
   *
   * Only regions the caller did not already dress are added, and they are appended AFTER the
   * caller's own ids, so nothing authored moves and the layer order stays deterministic.
   */
  private completeOutfitSet(): void {
    let sex: string | null = null;
    let kit: string | null = null;
    const covered = new Set<string>();
    for (const assetId of this.baseOutfitIds) {
      const match = OUTFIT_ID.exec(assetId);
      if (!match) continue;
      sex ??= match[1] ?? null;
      kit ??= match[2] ?? null;
      const region = this.regionOf(assetId);
      if (region) covered.add(region);
    }
    // Nothing to complete FROM. A character wearing a full-body GLB or nothing at all is left
    // exactly as the caller asked for it.
    if (!sex || !kit) return;
    for (const [part, region] of COVERAGE_PARTS) {
      if (covered.has(region)) continue;
      const assetId = `outfit_${sex}_${kit}_${part}`;
      // Refuse an id the manifest does not carry rather than queue a load that will throw: the
      // ranger kit has hood and pauldron that the peasant kit does not, and a future kit may be
      // missing one of these four.
      if (!this.assets.entry(assetId)) continue;
      this.baseOutfitIds.push(assetId);
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Swaps the item -> appearance tables. The real `render/equipmentVisuals.ts` is already the
   * default, so this is for a test stub, or for null when equipment visuals should be off.
   */
  setGearVisuals(port: GearVisualsPort | null): void {
    this.gear = port;
  }

  /** Slots the rig will draw. The loop iterates this, so adding a slot is one array edit upstream. */
  visibleSlots(): readonly EquipSlot[] {
    return this.gear?.VISIBLE_EQUIP_SLOTS ?? VISIBLE_SLOTS;
  }

  // ------------------------------------------------------------------ pose

  /**
   * Switches pose with a crossfade. `force` restarts a one-shot that is already playing, which is
   * what makes repeated swings read as repeated swings rather than one long animation.
   *
   * Two guards that were not here before, and both were load-bearing bugs. `this.current` is set
   * BEFORE the unresolved-action return, so a pose whose clip is missing cannot leave the rig
   * believing it is still in the previous one. And a pose that resolves to the action already
   * running is a no-op rather than a `reset()`: `mine` and `chop` share `TreeChopping_Loop`, and
   * the old code would restart the swing every time the caller changed its mind about which it was.
   *
   * A running one-shot also outranks an unforced pose. Without that, a swing lasts exactly one
   * frame: the loop calls `play(poseFor(...))` every frame, `poseFor` cannot know a swing is in
   * progress, and the very next frame crossfades `Sword_Attack` (1.533 s) back to idle. Death is
   * the one thing allowed to interrupt, because being dead is not a pose you recover from.
   */
  play(pose: CharacterPose, force = false, timeScale?: number): void {
    if (!this.mixer) return;
    if (pose === this.current && !force) return;
    if (!force && pose !== "death" && ONE_SHOT.has(this.current) && this.currentAction?.isRunning()) return;

    const previousPose = this.current;
    const previousClipDuration = this.currentAction?.getClip().duration ?? 0;
    const previousLocomotionPhase = isLocomotionPose(previousPose)
      && isLocomotionPose(pose)
      && this.currentAction
      && previousClipDuration > 0
      ? this.currentAction.time / previousClipDuration
      : null;
    const resolved = this.resolveAction(pose);
    const previous = this.currentAction;
    this.current = pose;
    if (!resolved) return;

    const { action, clipName } = resolved;
    if (action === previous && !force && action.isRunning()) {
      this.currentClipName = clipName;
      return;
    }

    action.reset();
    if (previousLocomotionPhase !== null) {
      action.time = previousLocomotionPhase * action.getClip().duration;
    }
    action.paused = false;
    action.enabled = true;
    // A caller-supplied scale outranks the per-pose table. Only the cast uses it, and only to make
    // rung read in the BODY: `Spell_Simple_Shoot` is the single casting clip the 86-clip library
    // ships (the others are Enter, Exit and an Idle_Loop, none of them a throw), so a Kilnsurge and
    // an Emberlash are the same 1.0 s motion. Slowing the heavy rungs gives them visible weight
    // without a second clip and without a wind-up that would fight the already-resolved cast.
    //
    // Marker phases are NORMALISED, so `recordMotionMarkers` still fires swing at 0.32 and contact
    // at 0.42 of whatever duration this produces — the release just arrives later in wall time,
    // which is what "heavier" means here. `app/loop.ts` sets the projectile's flight deadline from
    // the swing marker, so the effect follows the body rather than drifting off it.
    action.setEffectiveTimeScale(timeScale ?? POSE_TIME_SCALE[pose] ?? 1);
    action.setEffectiveWeight(1);

    if (ONE_SHOT.has(pose)) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
    }

    if (previous && previous !== action) {
      action.crossFadeFrom(previous, ONE_SHOT.has(pose) ? ONE_SHOT_CROSSFADE_SECONDS : CROSSFADE_SECONDS, false);
    }
    action.play();

    this.currentAction = action;
    this.currentClipName = clipName;
    this.controlledTimeScale = null;
    this.markerAction = action;
    this.markerPhase = previousLocomotionPhase ?? 0;
  }

  /**
   * Sets locomotion playback without changing translation speed.
   *
   * Walk_Loop is speed-matched across its whole band. The player's private jog shortens the leg
   * stride to 3.5 m/s while preserving the source pelvis and foot roll, matching 4.2 m/s at the
   * stable 1.2x cadence. Acceleration still blends toward that cadence through the run band.
   * Sprint_Loop receives the same treatment, but resolveAction reaches it only if Jog_Fwd_Loop is
   * unavailable.
   *
   * Only locomotion clips are scaled. A swing or flinch keeps its authored tempo. Call this every
   * frame after play, which resets a newly selected action's scale to 1.
   */
  setLocomotionSpeed(metresPerSecond: number): void {
    if (!this.currentAction || !this.currentClipName) return;
    if (this.currentClipName === "Walk_Loop") {
      this.currentAction.setEffectiveTimeScale(walkStrideScale(metresPerSecond));
    } else if (RUN_CLIPS.has(this.currentClipName)) {
      this.currentAction.setEffectiveTimeScale(runPresentationScale(metresPerSecond));
    }
  }

  /**
   * Locks the gathering loop to the gameplay roll that it represents.
   *
   * The clip is 0.967 s and a gathering roll is 1.8 s. Letting both clocks free-run made every
   * later hit land at a different pose. This maps the clip's measured impact frame onto the next
   * roll deadline every rendered frame. Pausing only the action time still lets the mixer advance
   * crossfades normally.
   */
  syncGatheringCycle(msUntilImpact: number, cycleMs: number, reset = false): void {
    const action = this.currentAction;
    const clipName = this.currentClipName;
    if (!action || !clipName || (this.current !== "mine" && this.current !== "chop")) return;

    const phase = gatheringActionPhase(msUntilImpact, cycleMs, GATHER_IMPACT_PHASE);
    const previous = this.markerAction === action ? this.markerPhase : phase;
    action.paused = true;
    action.time = phase * action.getClip().duration;
    this.controlledTimeScale = action.getClip().duration / (Math.max(1, cycleMs) / 1000);
    this.mixer?.update(0);

    if (!reset) this.recordMotionMarkers(clipName, previous, phase);
    this.markerAction = action;
    this.markerPhase = phase;
  }

  /** Drains contact events once. Rendering, sound, and hit feedback consume the same edges. */
  drainMotionEvents(): CharacterMotionEvent[] {
    return this.motionEvents.splice(0, this.motionEvents.length);
  }

  private recordMotionMarkers(clipName: string, previous: number, current: number): void {
    const markers = CLIP_MOTION_MARKERS[clipName] ?? [];
    for (const marker of markers) {
      if (!crossedAnimationMarker(previous, current, marker.phase)) continue;
      if (marker.kind === "footstep" && marker.foot) {
        this.motionEvents.push({ kind: "footstep", foot: marker.foot, pose: this.current });
      } else if (marker.kind === "swing" || marker.kind === "impact") {
        this.motionEvents.push({ kind: marker.kind, pose: this.current });
      }
    }
  }

  /** The selected clip and its measured contact marker drive both sim and presentation timing. */
  meleeTiming(): { contactMs: number; recoveryMs: number; clipSeconds: number } {
    const resolved = this.resolveAction("attack_melee");
    const clipSeconds = resolved?.action.getClip().duration ?? 1.533333;
    const phase = resolved ? CLIP_MOTION_MARKERS[resolved.clipName]?.find((marker) => marker.kind === "impact")?.phase ?? 0.3 : 0.3;
    const recoveryMs = clipSeconds * 1000 / (POSE_TIME_SCALE.attack_melee ?? 1);
    return { contactMs: recoveryMs * phase, recoveryMs, clipSeconds };
  }

  private resolveAction(pose: CharacterPose): { action: THREE.AnimationAction; clipName: string } | null {
    if (!this.mixer) return null;
    for (const clipName of POSE_CLIPS[pose]) {
      const cached = this.actions.get(clipName);
      if (cached) return { action: cached, clipName };
      const clip = this.locomotionClips.get(clipName) ?? this.assets.clip(clipName);
      if (!clip) {
        this.missingClips.add(clipName);
        continue;
      }
      const action = this.mixer.clipAction(clip);
      this.actions.set(clipName, action);
      return { action, clipName };
    }
    // Falling back to idle rather than freezing in bind pose: a T-posed character is the single
    // loudest "unfinished" signal a frame can carry.
    return pose === "idle" ? null : this.resolveAction("idle");
  }

  /**
   * Chooses a pose from movement and activity, so callers do not duplicate the mapping.
   *
   * Gathering splits by skill. It used to collapse onto `mine` unconditionally, so a player
   * standing in the Redsill shallows mimed chopping a tree; `ActivityState.skill` was already on
   * the state object and was simply dropped when the API flattened it to `activityKind`.
   *
   * The run/walk threshold comes from `MOVEMENT.walkPoseThreshold` (2.2 m/s), not the 3.0 that used
   * to be inlined here. 3.0 was above every speed the player could reach, so of 11,050 recorded
   * frames of continuous movement exactly one landed in the walk band and `Walk_Loop` was dead.
   */
  poseFor(input: PoseInput): CharacterPose {
    this.syncActivityGear(input);
    if (input.dead) return "death";
    if (input.activityKind === "gathering") {
      if (input.activitySkill === "woodcutting") return "chop";
      if (input.activitySkill === "fishing") return "fish";
      return "mine";
    }
    if (input.activityKind === "production" || input.activityKind === "building_campfire") return "produce";
    if (input.activityKind === "eating") return "eat";
    if (input.activityKind === "traversing") return "climb";
    if (input.moving) return input.speed > MOVEMENT.walkPoseThreshold ? "run" : "walk";
    return "idle";
  }

  /** Gathering temporarily shows the carried tool, then restores the worn main-hand item. */
  private syncActivityGear(input: PoseInput): void {
    if (!this.ready) return;
    const fishing = !input.dead
      && input.activityKind === "gathering"
      && input.activitySkill === "fishing";
    const miningOrWoodcutting = !input.dead
      && input.activityKind === "gathering"
      && (input.activitySkill === "mining" || input.activitySkill === "woodcutting");
    let nextAppearance: GearAppearanceLike | null = null;
    let nextKey: string | null = null;
    if (fishing) {
      const requested = input.activityToolItemId;
      const rodItemId = requested && FISHING_ROD_LOOKS[requested]
        ? requested
        : fishingRodItemForTier(input.activityTier);
      const assetId = fishingRodAssetId(rodItemId);
      nextAppearance = { assetId, slot: "mainHand", attach: "bone" };
      nextKey = `${rodItemId}:${assetId}`;
    } else if (miningOrWoodcutting && input.activityToolItemId) {
      nextAppearance = equipmentVisuals.gatheringToolAppearance(input.activityToolItemId);
      if (nextAppearance) nextKey = `${input.activityToolItemId}:${nextAppearance.assetId}`;
    }
    if (nextKey === this.activityMainHandKey) return;

    this.activityMainHandKey = nextKey;
    if (nextAppearance) {
      void this.attachBoneSlot("mainHand", nextAppearance);
      return;
    }

    const worn = (this.gearBySlot.get("mainHand") ?? []).find((part) => !isSkinPart(part)) ?? null;
    void this.attachBoneSlot("mainHand", worn);
  }

  // ------------------------------------------------------------- equipment

  /**
   * Pushes the worn set into the rig. Idempotent, so a caller may hand it the same slots forever.
   *
   * Bone slots resolve immediately; skin slots are collected and the layered set is rebuilt once,
   * so equipping a full kit is one rebuild rather than four.
   */
  async applyEquipment(
    slots: Readonly<Partial<Record<EquipSlot, ItemStack | null>>>,
    charge: GearWeaponChargePresentationLike = NO_WEAPON_CHARGE,
  ): Promise<void> {
    const work: Promise<void>[] = [];
    let skinChanged = false;

    for (const slot of this.visibleSlots()) {
      const stack = slots[slot] ?? null;
      const parts = stack ? this.appearanceParts(stack.itemId, charge) : [];
      const previous = this.gearBySlot.get(slot) ?? [];
      if (sameAppearances(previous, parts)) continue;

      if (parts.length > 0) this.gearBySlot.set(slot, parts);
      else this.gearBySlot.delete(slot);

      if (previous.some(isSkinPart) || parts.some(isSkinPart)) skinChanged = true;
      // At most one rigid attachment per slot: a hand holds one thing and a head wears one helmet.
      // A fishing rod temporarily owns the visible main hand. The worn item is still recorded
      // above and will be attached when fishing ends.
      if (slot !== "mainHand" || !this.activityMainHandKey) {
        work.push(this.attachBoneSlot(slot, parts.find((part) => !isSkinPart(part)) ?? null));
      }
    }

    if (skinChanged || this.layerLoadPending) work.push(this.rebuildLayers());
    await Promise.all(work);
  }

  /** Every part an item shows, preferring the multi-part call so tier 5/10 keep their pauldron. */
  private appearanceParts(
    itemId: ItemId,
    charge: GearWeaponChargePresentationLike = NO_WEAPON_CHARGE,
  ): readonly GearAppearanceLike[] {
    const port = this.gear;
    if (!port) return [];
    const charged = port.gearAppearancePartsWithCharge?.(itemId, charge);
    if (charged) return charged;
    const parts = port.gearAppearanceParts?.(itemId);
    if (parts) return parts;
    const single = port.gearAppearance(itemId);
    return single ? [single] : [];
  }

  /**
   * Attaches or clears one slot by asset id, bypassing the item tables.
   *
   * Kept public because it is the seam a debug scenario or a cutscene wants: "put a pickaxe in his
   * hand" without inventing an item to equip.
   */
  async equipSlotAsset(slot: EquipSlot, assetId: string | null): Promise<void> {
    const skin = SKIN_SLOTS.has(slot);
    if (assetId) this.gearBySlot.set(slot, [{ assetId, slot, attach: skin ? "skin" : "bone" }]);
    else this.gearBySlot.delete(slot);
    if (skin) {
      await this.rebuildLayers();
      return;
    }
    await this.attachBoneSlot(slot, assetId ? { assetId, slot, attach: "bone" } : null);
  }

  /** Parents an already-built object onto a slot's bone. Pass null to clear. */
  setSlot(
    slot: EquipSlot,
    object: THREE.Object3D | null,
    boneName?: string,
    ownedMaterials: readonly THREE.Material[] = [],
  ): void {
    const existing = this.boneAttachments.get(slot);
    if (existing) {
      existing.removeFromParent();
      this.boneAttachments.delete(slot);
      // Only the clones. An untinted attachment shares its material with the loaded asset, and
      // disposing that would strip the texture off every other copy of the mesh in the world.
      for (const material of this.boneAttachmentMaterials.get(slot) ?? []) material.dispose();
      this.boneAttachmentMaterials.delete(slot);
    }
    if (!object) return;
    const bone = this.hostBones.get(boneName ?? BONE_FOR_SLOT[slot] ?? "");
    if (!bone) {
      for (const material of ownedMaterials) material.dispose();
      return;
    }
    bone.add(object);
    this.boneAttachments.set(slot, object);
    if (this.traversalSample && (slot === "mainHand" || slot === "offHand")) {
      this.traversalHiddenGear.set(object, object.visible);
      object.visible = false;
    }
    if (ownedMaterials.length > 0) this.boneAttachmentMaterials.set(slot, [...ownedMaterials]);
  }

  private async attachBoneSlot(slot: EquipSlot, appearance: GearAppearanceLike | null): Promise<void> {
    const epoch = (this.slotEpoch.get(slot) ?? 0) + 1;
    this.slotEpoch.set(slot, epoch);
    this.slotLoadErrors.delete(slot);
    if (!appearance) {
      this.slotLoading.delete(slot);
      this.setSlot(slot, null);
      return;
    }
    this.slotLoading.set(slot, appearance.assetId);
    try {
      const source = await this.assets.load(appearance.assetId);
      // A load that finished after a newer change to the same slot must not win the race.
      if (this.slotEpoch.get(slot) !== epoch) return;
      this.slotLoading.delete(slot);
      const object = source.clone(true);
      const socket = this.socketFor(slot, appearance);
      object.position.set(socket.position[0], socket.position[1], socket.position[2]);
      object.rotation.set(socket.rotation[0], socket.rotation[1], socket.rotation[2]);
      object.scale.setScalar(socket.scale);
      object.name = `equip-${slot}-${appearance.assetId}`;
      for (const mesh of meshesOf(object)) {
        mesh.castShadow = this.castShadow;
        mesh.receiveShadow = this.castShadow;
      }
      this.gear?.applyGearAppearance?.(object, appearance);
      const cloned = clonedMaterialsOf(object, source);
      this.setSlot(slot, object, socket.bone);
      // `setSlot` disposes the previous attachment's material clones. Record this attachment only
      // after that cleanup, or it would dispose its own fresh tint and forget the old one.
      if (this.boneAttachments.get(slot) === object && cloned.length > 0) {
        this.boneAttachmentMaterials.set(slot, cloned);
      } else {
        for (const material of cloned) material.dispose();
      }
    } catch (error) {
      // A stale failed load must not clear a newer attachment that already won this slot.
      if (this.slotEpoch.get(slot) === epoch) {
        this.slotLoading.delete(slot);
        this.slotLoadErrors.set(slot, error instanceof Error ? error.message : String(error));
        this.setSlot(slot, null);
      }
    }
  }

  /**
   * Where this attachment sits. `weaponAttachment` is preferred over `weaponSocket` because it also
   * corrects the grip offset for the applied scale: a scaled child shrinks toward its own origin,
   * so at the dagger's 0.558 applied scale an uncorrected socket floats the grip 4.4 cm off the
   * fist, past the fist's own 3.8 cm half-span.
   */
  private socketFor(slot: EquipSlot, appearance: GearAppearanceLike): WeaponSocketLike {
    const port = this.gear;
    const measured = port?.weaponAttachment?.(appearance) ?? port?.weaponSocket(appearance.assetId);
    if (measured) return measured;
    const bone = BONE_FOR_SLOT[slot] ?? "hand_r";
    const scale = appearance.scale ?? 1;
    // Nothing measured for this asset: sit it upright on the head, or at the fist centre in a hand.
    if (slot === "head") return { bone, position: [0, 0, 0], rotation: [0, 0, 0], scale };
    return {
      bone,
      position: bone === "hand_l" ? FIST_LEFT : FIST_RIGHT,
      rotation: [Math.PI / 2, 0, 0],
      scale,
    };
  }

  // ------------------------------------------------------------ skin layers

  /**
   * Rebuilds the layered skinned parts: base outfit, overridden per region by worn gear.
   *
   * Serialised through `layerWork` because every call awaits asset loads, and two overlapping
   * rebuilds would race over the same graph. Returns early when the resolved part list is unchanged,
   * which is the common case — the loop calls into this path only when the worn signature moves.
   */
  private rebuildLayers(): Promise<void> {
    this.layerWork = this.layerWork.then(() => this.rebuildLayersNow()).catch(() => undefined);
    return this.layerWork;
  }

  private async rebuildLayersNow(): Promise<void> {
    const target = this.layerTarget;
    if (!target) return;

    const byRegion = new Map<string, string>();
    const extras: string[] = [];
    for (const assetId of this.baseOutfitIds) {
      const region = this.regionOf(assetId);
      if (region) byRegion.set(region, assetId);
      else extras.push(assetId);
    }
    const worn = new Map<string, GearAppearanceLike>();
    for (const parts of this.gearBySlot.values()) {
      for (const appearance of parts) {
        if (!isSkinPart(appearance)) continue;
        const region = this.regionOf(appearance.assetId) ?? regionForSlot(appearance.slot);
        if (region) byRegion.set(region, appearance.assetId);
        else extras.push(appearance.assetId);
        worn.set(appearance.assetId, appearance);
      }
    }
    // These modular hoods and closed helmets have no authored opening for a hairstyle.
    // Keep the base hairstyle in baseOutfitIds so unequipping restores it on the next rebuild.
    if (byRegion.has("head")) byRegion.delete("hair");

    // Deduplicated: a part the manifest has no region tag for lands in `extras`, and the same id
    // can reach `extras` from both the base outfit and a worn piece. Layering one twice would
    // double its draw cost and z-fight with itself.
    const ids: string[] = [];
    for (const region of REGION_ORDER) {
      const assetId = byRegion.get(region);
      if (assetId && !ids.includes(assetId)) ids.push(assetId);
    }
    for (const assetId of extras) if (!ids.includes(assetId)) ids.push(assetId);

    const covered = this.forceHeadCap ?? HEAD_CAP_REQUIRES.every((region) => byRegion.has(region));
    const wantCap = covered && headCapHeightFor(this.bodyAssetId) !== null;
    // The tint is in the signature: two tiers of the same asset differ only by colour, so without
    // it swapping Corven plate for Kaldite plate would look like a no-op and never rebuild.
    const signature = `${wantCap ? "cap" : "raw"}|${ids.map((id) => `${id}:${appearanceKey(worn.get(id))}`).join("|")}`;
    if (signature === this.layerSignature) {
      this.layerLoadPending = false;
      return;
    }

    // Load first, mutate second: a failed load must not leave the character half dressed.
    const sources: { assetId: string; source: THREE.Object3D }[] = [];
    for (const assetId of ids) {
      try {
        sources.push({ assetId, source: await this.assets.load(assetId) });
      } catch {
        // Keep the complete previous outfit and its matching body cap. Committing a partial
        // source list could remove the body beneath trousers or sleeves that never loaded.
        // The requested appearances are already recorded in gearBySlot. A pending flag lets
        // a repeated applyEquipment call retry even when those appearances are unchanged.
        this.layerLoadPending = true;
        return;
      }
    }

    this.clearLayers();
    if (wantCap) this.applyCap();
    else this.restoreCap();

    const rebound: THREE.SkinnedMesh[] = [];
    for (const { assetId, source } of sources) {
      const clone = cloneSkinned(source);
      const result = rebindSkinnedPart(clone, this.hostBones, target, {
        castShadow: this.castShadow,
        receiveShadow: this.castShadow,
        skeletonCache: this.skeletonCache,
      });
      const appearance = worn.get(assetId);
      for (const mesh of result.meshes) {
        mesh.name = `part-${assetId}-${mesh.name}`;
        mesh.geometry = dequantizeGeometry(mesh.geometry);
        if (!appearance) continue;
        this.gear?.applyGearAppearance?.(mesh, appearance);
        // Whatever the tint swapped in is a clone this rig owns; recorded so `clearLayers` frees
        // it. An untinted part keeps the loaded asset's own material and must never be disposed.
        for (const material of clonedMaterialsOf(mesh, source)) this.layerMaterials.push(material);
      }
      rebound.push(...result.meshes);
    }

    if (this.mergeParts && rebound.length > 1) {
      const merged = mergeSkinnedMeshes(rebound, { materialKey: materialMergeKey });
      this.layerMeshes = merged.meshes;
      this.layerGeometries = merged.geometries;
    } else {
      this.layerMeshes = rebound;
      this.layerGeometries = [];
    }
    this.layerSignature = signature;
    this.committedLayerAssets = [...ids];
    this.layerLoadPending = false;
  }

  /** The manifest tag that says which body region a layered asset covers, or null. */
  private regionOf(assetId: string): string | null {
    const tags = this.assets.entry(assetId)?.tags;
    if (!tags) return null;
    for (const [tag, region] of REGION_TAGS) if (tags.includes(tag)) return region;
    return null;
  }

  private clearLayers(): void {
    for (const mesh of this.layerMeshes) mesh.removeFromParent();
    this.layerMeshes = [];
    this.committedLayerAssets = [];
    for (const geometry of this.layerGeometries) geometry.dispose();
    this.layerGeometries = [];
    for (const material of this.layerMaterials) material.dispose();
    this.layerMaterials = [];
  }

  /**
   * Cuts the base body down to a head cap.
   *
   * Why at all: the outfit parts are authored to REPLACE the body below the neck, not to cover it.
   * Measured cross-sections in bind space — thigh band y[0.55,0.90], base_male maxAbsX 0.1952
   * against outfit_male_peasant_legs 0.1898, so the trousers sit 5.4 mm INSIDE the bare leg; foot
   * band y[0,0.20], 0.1865 against a 0.1590 boot, 27.5 mm. Layering clothes over an intact body
   * leaks bare skin through them.
   *
   * Only when the whole body below the neck is dressed, which is what `HEAD_CAP_REQUIRES` counts.
   * The cut plane is a horizontal one and the bind pose is a T-pose, so a cut that clears the
   * shoulders also removes the arms: capping a character with no `hands` part would leave a torso
   * with no arms, which is worse than a bare wrist.
   */
  private applyCap(): void {
    if (this.capped || !this.body) return;
    const cut = headCapHeightFor(this.bodyAssetId);
    if (cut === null) return;
    const result = applyHeadCap(this.body, cut);
    this.capGeometries = result.geometries;
    // `applyHeadCap` detaches any mesh with nothing above the cut. Remember which, so the cut is
    // reversible when the player takes the trousers off again. Measured on base_male and
    // base_female, nothing is removed outright — Eyes and Eyebrows sit entirely above the plane —
    // but a body asset that is not one of those two may lose a mesh here.
    this.capRemoved = [];
    for (const mesh of this.bodyMeshes) {
      if (mesh.parent) continue;
      this.capRemoved.push({ mesh, parent: this.layerTarget ?? this.body });
    }
    this.capped = true;
  }

  private restoreCap(): void {
    if (!this.capped) return;
    for (const [mesh, geometry] of this.bodyGeometries) mesh.geometry = geometry;
    for (const { mesh, parent } of this.capRemoved) parent.add(mesh);
    this.capRemoved = [];
    for (const geometry of this.capGeometries) geometry.dispose();
    this.capGeometries = [];
    this.capped = false;
  }

  // ------------------------------------------------------------------ misc

  setPosition(position: Vec3, facingRad: number): void {
    this.root.position.set(position[0], position[1], position[2]);
    this.root.rotation.y = facingRad;
  }

  /** Sample one authored traversal cycle from its activity clock, never repeat a climbing loop. */
  syncTraversalPose(sample: TraversalSample | null): void {
    const wasTraversing = this.traversalSample !== null;
    this.traversalSample = sample;
    if (!sample) {
      for (const [object, visible] of this.traversalHiddenGear) object.visible = visible;
      this.traversalHiddenGear.clear();
      if (wasTraversing && this.currentAction) this.currentAction.paused = false;
      return;
    }
    for (const slot of ["mainHand", "offHand"] as const) {
      const object = this.boneAttachments.get(slot);
      if (!object) continue;
      if (!this.traversalHiddenGear.has(object)) this.traversalHiddenGear.set(object, object.visible);
      object.visible = false;
    }
    // A concealed crossing is only hidden once its cover is opaque. Until then the actor is in
    // plain view at the entrance, so play the start of the real move: walking into a passage
    // mouth, or the climb/vault/balance/slide itself. Idle there read as a stationary timer.
    const uncovered = sample.curtainOpacity < 1;
    const moving: CharacterPose = sample.kind === "passage" ? "walk" : sample.kind;
    const pose: CharacterPose = !sample.concealed ? moving : uncovered ? moving : "idle";
    this.play(pose);
    const action = this.currentAction;
    if (!action || sample.concealed) return;
    const travel = Math.max(0, Math.min(1, (sample.progress - 0.12) / 0.74));
    // The shipped jump is a takeoff, not a complete landing. Reverse its recovery half;
    // the path's independent foot height supplies displacement, with no guessed RNG outcome.
    const phase = sample.kind === "balance" ? (travel * 3) % 1
      : sample.kind === "slide" ? 0.2
        : travel < 0.5 ? travel * 2 : (1 - travel) * 2;
    action.time = Math.min(0.999999, phase) * action.getClip().duration;
    action.paused = true;
  }

  update(deltaSeconds: number): void {
    this.traversalPose.restore();
    const action = this.currentAction;
    const clipName = this.currentClipName;
    const duration = action?.getClip().duration ?? 0;
    const previous = action && duration > 0
      ? (this.markerAction === action ? this.markerPhase : action.time / duration)
      : 0;
    this.mixer?.update(deltaSeconds);
    this.traversalPose.apply(this.root, this.hostBones, this.traversalSample);

    if (action && clipName && action === this.currentAction && clipName === this.currentClipName && duration > 0) {
      const current = Math.min(1, Math.max(0, action.time / duration));
      if (!action.paused) this.recordMotionMarkers(clipName, previous, current);
      this.markerAction = action;
      this.markerPhase = current;
    }
    // A finished one-shot returns to idle on its own, so a swing does not freeze on its last frame.
    if (this.currentAction && ONE_SHOT.has(this.current) && !this.currentAction.isRunning()) {
      this.play("idle", true);
    }
  }

  /** Clip names the rig asked for and did not find. Surfaced through the debug API. */
  getMissingClips(): string[] {
    return [...this.missingClips];
  }

  currentPose(): CharacterPose {
    return this.current;
  }

  /** The clip actually playing. Two frames 100 ms apart reporting the same name and a moved time is
   * what proves the locomotion clip advances rather than restarting. */
  currentClip(): string | null {
    return this.currentClipName;
  }

  /** Live playback state for browser acceptance; gameplay never reads this. */
  motionSnapshot(includeFeet = false): {
    pose: CharacterPose;
    clip: string | null;
    time: number;
    duration: number;
    timeScale: number;
    clipUuid: string | null;
    clipSource: "player-local" | "shared" | null;
    nativeStrideMps: number | null;
    actionWeight: number;
    drawnPosition: Vec3;
    drawnRotationY: number;
    feet?: { left: { ball: Vec3; ankle: Vec3 }; right: { ball: Vec3; ankle: Vec3 } };
    attachments?: Record<string, string>;
    attachmentLoading?: Record<string, string>;
    attachmentErrors?: Record<string, string>;
    activityMainHandKey?: string | null;
    layerSignature?: string | null;
    layerLoadPending?: boolean;
    layerMeshes?: string[];
    layerAssets?: string[];
    hairVisible?: boolean;
  } {
    const clip = this.currentAction?.getClip();
    const local = Boolean(clip && this.locomotionClips.get(clip.name) === clip);
    const bonePosition = (name: string): Vec3 => {
      const bone = this.hostBones.get(name);
      return bone ? bone.getWorldPosition(new THREE.Vector3()).toArray() as Vec3 : [0, 0, 0];
    };
    return {
      pose: this.current,
      clip: this.currentClipName,
      time: this.currentAction?.time ?? 0,
      duration: this.currentAction?.getClip().duration ?? 0,
      timeScale: this.controlledTimeScale ?? this.currentAction?.getEffectiveTimeScale() ?? 0,
      clipUuid: clip?.uuid ?? null,
      clipSource: clip ? local ? "player-local" : "shared" : null,
      nativeStrideMps: local ? 3.5 : null,
      actionWeight: this.currentAction?.getEffectiveWeight() ?? 0,
      drawnPosition: this.root.position.toArray() as Vec3,
      drawnRotationY: this.root.rotation.y,
      ...(includeFeet ? { attachments: Object.fromEntries([...this.boneAttachments].map(([slot, object]) => [slot, object.name])),
        layerSignature: this.layerSignature, layerLoadPending: this.layerLoadPending,
        layerMeshes: this.layerMeshes.filter(mesh => mesh.parent && mesh.visible).map(mesh => mesh.name),
        layerAssets: [...this.committedLayerAssets],
        hairVisible: this.root.visible && this.layerMeshes.some(mesh => mesh.parent && mesh.visible)
          && this.committedLayerAssets.some(assetId => this.regionOf(assetId) === "hair"),
        attachmentLoading: Object.fromEntries(this.slotLoading), attachmentErrors: Object.fromEntries(this.slotLoadErrors),
        activityMainHandKey: this.activityMainHandKey, feet: {
        left: { ball: bonePosition("ball_l"), ankle: bonePosition("foot_l") },
        right: { ball: bonePosition("ball_r"), ankle: bonePosition("foot_r") },
      } } : {}),
    };
  }

  /**
   * What the rig costs and what it is wearing. Read by screenshots and by the debug API; this is
   * the number that has to move when a kit is equipped.
   */
  stats(): { meshes: number; drawCalls: number; bones: number; parts: number; attachments: number; headCapped: boolean } {
    let bones = 0;
    this.root.traverse((child) => {
      if ((child as THREE.Bone).isBone) bones += 1;
    });
    const meshes = [...this.bodyMeshes.filter((mesh) => mesh.parent), ...this.layerMeshes];
    const drawCalls = meshes.reduce(
      (sum, mesh) => sum + (Array.isArray(mesh.material) ? Math.max(1, mesh.geometry.groups.length) : 1),
      0,
    );
    let attachments = 0;
    for (const object of this.boneAttachments.values()) {
      object.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) attachments += 1;
      });
    }
    return {
      meshes: meshes.length,
      drawCalls: drawCalls + attachments,
      bones,
      parts: this.layerMeshes.length,
      attachments,
      headCapped: this.capped,
    };
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.actions.clear();
    this.clearLayers();
    this.restoreCap();
    for (const slot of [...this.boneAttachments.keys()]) this.setSlot(slot, null);
    this.root.removeFromParent();
  }
}

/** Phase that places the measured contact marker on the next semantic gathering deadline. */
export function gatheringActionPhase(msUntilImpact: number, cycleMs: number, impactPhase = GATHER_IMPACT_PHASE): number {
  const safeCycle = Number.isFinite(cycleMs) && cycleMs > 0 ? cycleMs : 1;
  const remaining = Number.isFinite(msUntilImpact)
    ? Math.min(safeCycle, Math.max(0, msUntilImpact))
    : safeCycle;
  const phase = impactPhase - remaining / safeCycle;
  return ((phase % 1) + 1) % 1;
}

/** True when forward playback crossed a normalised marker, including one loop wrap. */
export function crossedAnimationMarker(previous: number, current: number, marker: number): boolean {
  if (![previous, current, marker].every(Number.isFinite) || previous === current) return false;
  // Phase arithmetic such as (0.22 - 1) % 1 can produce 0.21999999999999997. Without this
  // tolerance the very next frame treats the same marker as a new crossing and plays a false hit
  // at activity start.
  const epsilon = 1e-6;
  if (current > previous) return marker > previous + epsilon && marker <= current + epsilon;
  return marker > previous + epsilon || marker <= current + epsilon;
}

/** Read-only marker phases for timing tests and the browser diagnostic surface. */
export function motionMarkerPhases(clipName: string, kind: CharacterMotionEvent["kind"]): readonly number[] {
  return (CLIP_MOTION_MARKERS[clipName] ?? [])
    .filter((marker) => marker.kind === kind)
    .map((marker) => marker.phase);
}

/**
 * Equipment slots the rig draws when no `equipmentVisuals` port is wired.
 *
 * It used to advertise five slots and implement two, and neither of the two had a caller anywhere
 * in the repo. It is now the honest list of what `applyEquipment` can route: four skinned regions
 * and three bone attachments. `GearVisualsPort.VISIBLE_EQUIP_SLOTS` overrides it.
 */
export const VISIBLE_SLOTS: readonly EquipSlot[] = [
  "head", "body", "legs", "feet", "hands", "mainHand", "offHand",
] as const;

/** The clamped time scale that plants Walk_Loop at the supplied ground speed. */
function walkStrideScale(metresPerSecond: number): number {
  return Math.min(MAX_WALK_TIME_SCALE, Math.max(MIN_WALK_TIME_SCALE, metresPerSecond / WALK_CLIP_SPEED));
}

/**
 * Brisk visual cadence for either run clip, independent of the unchanged 4.2 m/s translation.
 *
 * Exported because `render/entityViews.ts` plays humanoid ENEMIES on the same Jog_Fwd_Loop: a
 * reaver retimed by exact foot-planting ran in slow motion for exactly the reason the comment on
 * `setLocomotionSpeed` gives for the player, and the fix is the same presentation policy from the
 * same function, so the two can never drift apart again.
 */
export function runPresentationScale(metresPerSecond: number): number {
  const scaled = metresPerSecond / MOVEMENT.runSpeed * MOVEMENT.runPlaybackRate;
  return Math.min(MOVEMENT.runPlaybackRate, Math.max(MOVEMENT.runMinPlaybackRate, scaled));
}

function isLocomotionPose(pose: CharacterPose): boolean {
  return pose === "walk" || pose === "run";
}

/** A part drawn by rebinding it onto the body's skeleton rather than parenting it to a bone. */
function isSkinPart(appearance: GearAppearanceLike): boolean {
  return appearance.attach === "skin";
}

function regionForSlot(slot: EquipSlot): string | null {
  if (slot === "body") return "body";
  if (slot === "legs") return "legs";
  if (slot === "feet") return "feet";
  if (slot === "hands") return "hands";
  if (slot === "head") return "head";
  return null;
}

/** Everything about an appearance that changes what is drawn. Also the layer-rebuild signature. */
function appearanceKey(appearance: GearAppearanceLike | undefined): string {
  if (!appearance) return "-";
  const orb = appearance.orb;
  const orbKey = orb
    ? `${orb.element}/${orb.charged ? 1 : 0}/${orb.colour}/${orb.emissive}/${orb.position.join(",")}/${orb.radius}`
    : "-";
  return [
    appearance.assetId,
    appearance.attach,
    appearance.tint ?? "-",
    appearance.scale ?? 1,
    appearance.accent ?? "-",
    orbKey,
  ].join("/");
}

function sameAppearances(a: readonly GearAppearanceLike[], b: readonly GearAppearanceLike[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (appearanceKey(a[index]) !== appearanceKey(b[index])) return false;
  }
  return true;
}

/**
 * One dequantized copy per source geometry, shared by every rig. Keyed weakly on the loaded
 * asset's geometry, so it lives exactly as long as the asset does.
 */
const DEQUANTIZED = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/**
 * Rewrites normalized integer vertex attributes as plain floats. WORKAROUND — delete it when
 * `render/skinning.ts` is fixed.
 *
 * `selectVertices` (skinning.ts:498) and `mergeGeometries` (skinning.ts:765) both copy vertex data
 * with `attribute.getComponent`, which DENORMALIZES an integer attribute to its 0..1 float value,
 * into an array allocated by `allocateLike` — the SOURCE's integer type — and then re-flag the
 * result `normalized`. Every humanoid GLB in this pack ships COLOR_0 as UBYTE normalized (measured
 * by parsing the accessors: all three base_male primitives, and every outfit part), and the outfit
 * materials multiply by vertex colour, so every colour component truncated from 0..1 to 0 and the
 * mesh rendered pure black. Visible in runs/corealm/screenshots/rig-town-peasant-zoom.png as a
 * black tunic where runs/corealm/screenshots/baseline-town_center.png has a pale one — and only on
 * the meshes that went through a clip or a merge, which is why the hair and the bare forearm beside
 * them stayed correctly lit.
 *
 * Feeding those helpers float attributes makes their copy exact, and costs one Float32 colour
 * buffer per distinct source geometry (114 KB for base_male's body, cached for the process).
 *
 * Never mutates the source: `SkeletonUtils.clone` shares geometry with the loaded asset by
 * reference, so writing to it would recolour every other copy of that mesh in the world.
 */
function dequantizeGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = DEQUANTIZED.get(geometry);
  if (cached) return cached;

  const names = Object.keys(geometry.attributes).filter((name) => geometry.getAttribute(name)?.normalized);
  if (names.length === 0) {
    DEQUANTIZED.set(geometry, geometry);
    return geometry;
  }

  // Shares every untouched attribute by reference; only the normalized ones are rebuilt.
  const out = new THREE.BufferGeometry();
  const index = geometry.getIndex();
  if (index) out.setIndex(index);
  for (const name of Object.keys(geometry.attributes)) {
    const attribute = geometry.getAttribute(name);
    if (!attribute) continue;
    if (!attribute.normalized) {
      out.setAttribute(name, attribute);
      continue;
    }
    const size = attribute.itemSize;
    const values = new Float32Array(attribute.count * size);
    for (let vertex = 0; vertex < attribute.count; vertex += 1) {
      for (let component = 0; component < size; component += 1) {
        values[vertex * size + component] = attribute.getComponent(vertex, component);
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(values, size, false));
  }
  out.boundingBox = geometry.boundingBox;
  out.boundingSphere = geometry.boundingSphere;
  if (!out.boundingSphere) out.computeBoundingSphere();
  DEQUANTIZED.set(geometry, out);
  return out;
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) meshes.push(mesh);
  });
  return meshes;
}

/**
 * Materials on `root` that are NOT also on `source`, i.e. the ones a tint pass cloned.
 *
 * `AssetRegistry.load` hands the same cached GLTF scene to every caller and `Object3D.clone` shares
 * materials with it, so an untinted attachment's material belongs to the asset and disposing it
 * would strip the texture off every other copy of that mesh in the world.
 * `equipmentVisuals.applyGearAppearance` clones tinted materials and creates the weapon socket's
 * material. Identity against the source is the exact ownership test for both cases.
 */
function clonedMaterialsOf(root: THREE.Object3D, source: THREE.Object3D): THREE.Material[] {
  const shared = new Set<THREE.Material>();
  for (const mesh of meshesOf(source)) {
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) shared.add(material);
  }
  const owned = new Set<THREE.Material>();
  for (const mesh of meshesOf(root)) {
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (!shared.has(material)) owned.add(material);
    }
  }
  return [...owned];
}

/**
 * Merge key for layered parts.
 *
 * `mergeSkinnedMeshes` defaults to material UUID, which never merges across separately loaded GLBs:
 * three loads of MI_Peasant are three Material instances. Keying on the authored NAME does merge
 * them — outfit_male_peasant_chest, _legs and _boots all ship MI_Peasant from one pack, and
 * `SkeletonCache`'s content lookup already puts them on one Skeleton object, which is the other
 * condition the merge needs. The tint is part of the key so a recoloured tier-10 piece cannot be
 * merged into an untinted one and lose its colour.
 */
function materialMergeKey(material: THREE.Material): string {
  if (!material.name) return material.uuid;
  const colour = (material as THREE.MeshStandardMaterial).color;
  return `${material.name}|${colour instanceof THREE.Color ? colour.getHexString() : "-"}`;
}
