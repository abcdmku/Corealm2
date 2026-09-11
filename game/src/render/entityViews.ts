import { interpolatedGroundHeight } from "./terrainContact.js";
import { conformTerrainRig, restoreTerrainRig, terrainRigSnapshot, type TerrainPose } from "./terrainRig.js";
/**
 * Semantic entities -> Three.js objects.
 *
 * This is the render half of the seam the contract describes: the world layer owns what an entity
 * IS, this file owns what it LOOKS LIKE. It reads `SemanticEntity.view` plus explicit visual tags
 * in `meta` (such as an essence cache's element), and it never writes gameplay state. If a value
 * is not authored on the semantic entity, it is not this file's business to invent it.
 *
 * The performance shape that matters: entities are grouped by (assetId, material tier or
 * architecture region, archetype, 128 m cell) and every group's parts are drawn out of a
 * `BatchedMesh` shared by MATERIAL with every other group in the same cell. Six hundred ore nodes
 * across three regions are a handful of draw calls, not six hundred; architecture shares within a
 * regional style so a Karrowmoor slate roof cannot inherit Fallowmarch's shader or colour.
 * Each entity owns a fixed slot in its group and one batch instance per part per pose variant;
 * changing state writes a matrix and flips two visibility bits. No rebuild, no allocation, no
 * reupload of anything but the matrices.
 *
 * Round 5 is that batching, and it is the whole of how the draw-call budget came back under 400.
 * One `InstancedMesh` per (group, part) meant the entity layer submitted a draw per part whether or
 * not two of them were the same paint, and after three settlements landed there were 490 of them.
 * Measured with `npm run perf` on a real GPU (RTX 5080, 1920x1080), all 18 poses, nothing else in
 * the tree changed between the two runs:
 *
 * ```text
 *   pose                  before  after      pose                  before  after
 *   town_entrance            517    284      marchfield               347    199
 *   spawn                    505    249      vellenwood_canopy        321    205
 *   hollowcut_seam           491    299      march_road               309    184
 *   highcairn                470    290      sunder_ledge             240    142
 *   karrowmoor_terraces      443    294      bracken_pit              186     97
 *   rootfall                 440    240      redsill_shallows         173     99
 *   gravelmaw_entrance       420    280      upper_karrow_seam        173    147
 *   bank                     387    228      great_cairn              164    127
 *   town_center              383    239      palewood_copse            57     38
 * ```
 *
 * Seven poses were over the 400 ceiling and the worst is now 299. Triangles fell too — 0.2M to 0.9M
 * per pose — because `BatchedMesh` leaves an invisible instance out of the multi-draw entirely,
 * where the old pair of `InstancedMesh`es still submitted the spent variant's slots. What it costs
 * is CPU: median frame time roughly doubled, 0.6-1.9 ms to 0.8-3.4 ms, worst frame 12.6 ms, against
 * a 16.67 ms budget. That is the per-instance cull running on the CPU, and it is the price of the
 * cull that makes the triangle count honest.
 *
 * Verified rather than assumed, because the risk here is silent: `checkGrounding()` returns
 * BYTE-IDENTICAL rows before and after (153 measured, worst 1.000 m, 31 over tolerance, same twelve
 * worst ids and gaps), which only holds if every slot's matrix, visibility and geometry survived the
 * move. Gate-check is 24/27 with `spent-node` and `building-footing` both green.
 *
 * Round 2 fixes two findings that both came down to this file:
 *
 *  - Tier was unreadable (finding 4). Tier now moves three things at once: the body colour (pulled
 *    hard toward the tier's `body` swatch), an added ore SEAM in the tier's brightened `metal`
 *    swatch, and the silhouette scale. See `APPEARANCE` and `seamGeometry`.
 *  - Nothing was animated (finding 6). 98 clips were loading and no `AnimationMixer` existed, so
 *    every character stood in bind pose with its arms out. Rigged entities now get a mixer with a
 *    per-entity idle clip and phase, and — this is the part that matters at scale — the ones that
 *    do NOT get a mixer are instanced from a CPU-baked idle pose rather than from bind pose, so a
 *    background NPC is a still character instead of a scarecrow.
 *
 * Round 4 fixes four more, all of them measured in the browser before and after:
 *
 *  - Every NPC in the world was headless. `view.assetId` was a clothes-only outfit GLB
 *    (`outfit_male_peasant.glb` = Arms/Body/Feet/Legs, top vertex y 1.559 against `base_male`'s
 *    1.810, no Head/Eyes/Eyebrows), so you could see the wall through the neck. Characters are now
 *    assembled through `render/skinning.ts`: a head-capped base body carrying its own Eyes and
 *    Eyebrows, the outfit layered on and rebound to the body's bones, and a deterministic hair
 *    asset on top. Measured mesh counts per character, offline against the real GLBs
 *    (runs/corealm/audit/ev-assemble.ts): male peasant 5 -> 6, female peasant 4 -> 6, male ranger
 *    10 -> 6, female ranger 10 -> 5. Across the world's 12 NPCs that is 92 -> 70 meshes, i.e. 44
 *    FEWER draw calls than the headless version cost.
 *  - No enemy in the world could ever be animated, because `NAMED_CHARACTER_RESERVE` (64) equalled
 *    the `maxUniqueDrawCalls` boot passes (64) and the non-npc ceiling was therefore exactly 0.
 *    The budget is now split into two independent pools; see `canAffordUnique`.
 *  - A rigged entity had one clip for its whole life. Enemies now select idle / walk / death from
 *    what their own GLB ships, and the instanced fallback bakes one pose per state instead of one
 *    pose full stop.
 *  - Nothing bedded into a slope. `writeSlot` now slerps the instance orientation toward
 *    `view.groundNormal` by `view.tiltStrength`, defaulted per archetype by `DEFAULT_TILT`.
 */
import * as THREE from "three";
import { isNativeTreeAsset } from "../content/treeSpecies.js";
import { containedWaterMaterialSnapshot } from "./containedTroughWater.js";
import { selectSpeedMatchedLocomotion } from "./speedMatchedLocomotion.js";
import { createMaskedHitOverlay, hitOverlayWeight } from './creatureHitOverlay.js';
import { clone as cloneRigged } from "three/examples/jsm/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Archetype, EntityId, RegionId, SemanticEntity, Vec3 } from "../contracts.js";
import type { AssetLoadOptions, AssetRegistry } from "./assets.js";
import type { WorldScene } from "./scene.js";
import type { PaletteSwatch } from "./materials.js";
import { artSurfaceRoleForMaterial } from "./artDirection.js";
import { scatterWindMargin } from "./scatterBounds.js";
import { EntityActiveSet } from "./entityActiveSet.js";
import { Rng } from "../core/rng.js";
import {
  architectureMaterialRole,
  architectureMaterialRoleForAsset,
  MaterialLibrary,
  paletteForTier,
  tierSilhouetteScale,
} from "./materials.js";
import { runPresentationScale } from "./characterRig.js";
import { AnimationLod } from "./animationLod.js";
import {
  advanceCreaturePlayback, createCreaturePlayback, creatureBlend, missingCreatureHit,
  transitionCreaturePlayback, type CreaturePlayback,
} from "./creatureMotion.js";
import {
  assembleDressedCharacter,
  headCapHeightFor,
  type CharacterPartSource,
  type DressedCharacter,
} from "./skinning.js";

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const DOWN_AXIS = new THREE.Vector3(0, -1, 0);

/**
 * How a new `Batch` is sized, and how much it grows by.
 *
 * Both ceilings double on overflow and `BatchedMesh` copies the old buffers across, so these only
 * decide how many reallocations boot pays for. The vertex step is deliberately above 65,535: below
 * it `BatchedMesh` allocates a Uint16 index buffer and the first growth past the limit has to
 * convert every index one at a time.
 */
const BATCH_INSTANCE_STEP = 128;
const BATCH_VERTEX_STEP = 2_048;

/**
 * Edge of the square a batch covers, in metres.
 *
 * A batch shared by the whole 700x400 m world has a bounding sphere that touches every frustum, so
 * the renderer can never cull the OBJECT and every batch pays a full material bind and an
 * `onBeforeRender` pass over all its instances, twice per frame with the shadow map. Measured
 * against a world-wide key (runs/corealm/dc/perf-after2.json vs perf-after3.json, the sweep that
 * chose this number): 96 world-wide batches cost about 7 ms of CPU a frame at EVERY pose, including
 * `palewood_copse`, which draws 35 calls and 2M triangles — median frame time went 3.0 ms -> 9.9 ms
 * there with no change in what was on screen.
 *
 * Cutting the batch key by a 128 m cell gets object-level culling back. It is a trade: two towns
 * that share `MI_WoodTrim` no longer share a draw, and a settlement that straddles a cell boundary
 * pays twice for the materials it spans. 128 m is wider than any settlement here (Coldbrace's wall
 * runs span 78 m) so most of them land in one or two cells. On the shipped world that is 263
 * batches rather than 43, of which 216-219 are drawn at any of the seven poses sampled — the split
 * costs batch COUNT and buys back the frame time, and the draw-call table in this file's header is
 * measured with it on.
 */
const BATCH_CELL_SIZE = 128;

/**
 * Archetypes that keep out of the cell split, because they walk.
 *
 * A cell is part of the group key, so an enemy that crosses a boundary would release its slot and
 * re-acquire in a different group mid-stride. There are ~60 of them in the world against ~3,300
 * static props, so parking them all in one world-wide cell costs a handful of unculled batches and
 * buys a mover that never pops.
 */
const CELL_FREE_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>([
  "enemy", "boss", "npc",
]);

// Module-scope scratch. `writeSlot` runs once per entity per sync over ~900 entities; a fresh
// Quaternion and Vector3 per call is garbage the collector walks during exactly the passes that are
// already the most expensive. Each of these is written and consumed within one synchronous call.
const SCRATCH_QUATERNION = new THREE.Quaternion();
const SCRATCH_SCALE = new THREE.Vector3();
const SCRATCH_NORMAL = new THREE.Vector3();
const SCRATCH_TILT = new THREE.Quaternion();
const SCRATCH_BLEND = new THREE.Quaternion();
const SCRATCH_PLACEMENT = new THREE.Matrix4();
const SCRATCH_TRANSFORM = new THREE.Matrix4();
const SCRATCH_DETAIL = new THREE.Matrix4();
const SCRATCH_DETAIL_POSITION = new THREE.Vector3();
const SCRATCH_DETAIL_SCALE = new THREE.Vector3();
const SCRATCH_DETAIL_QUATERNION = new THREE.Quaternion();
// Written and consumed inside one synchronous call, exactly like the matrices above.
const SCRATCH_COLOUR = new THREE.Color();

/** States that render with the spent treatment. Everything else renders live. */
const SPENT_STATES = new Set(["depleted", "dead", "empty", "harvested", "closed", "spent"]);

type EssenceElement = "wind" | "earth" | "water" | "fire";

const ESSENCE_CACHE_ASSETS: ReadonlySet<string> = new Set([
  "rocks_free_essence_cache",
  "rocks_free_essence_node",
]);

const ESSENCE_ALTAR_ASSET = "altar_ruins_altar";
const ESSENCE_ALTAR_RUINS_ASSET = "altar_ruins_site";

const ESSENCE_VEINS_MASK_URL = "/assets/textures/essence_veins_mask.png";

/** Emissive colour and energy are element identity; the rock's authored albedo stays underneath. */
const ESSENCE_GLOW: Readonly<Record<EssenceElement, { colour: number; intensity: number }>> = {
  wind: { colour: 0xbff8ff, intensity: 2.15 },
  earth: { colour: 0xb5d34b, intensity: 1.9 },
  water: { colour: 0x168cff, intensity: 2.25 },
  fire: { colour: 0xff521c, intensity: 2.3 },
};

/** Muted stone dyes keep the full ruin coloured without turning it into one saturated light. */
const ESSENCE_STRUCTURE_COLOUR: Readonly<Record<EssenceElement, number>> = {
  wind: 0xb8dce0,
  earth: 0x98ae72,
  water: 0x83a8cc,
  fire: 0xc9896f,
};

/** The weathered stone beneath each element, keyed by the region that owns that element. */
const ESSENCE_REGION_STONE: Readonly<Record<EssenceElement, number>> = {
  wind: 0xf0dfc4,
  earth: 0xb8c7a0,
  water: 0xc2d0e2,
  fire: 0xc5aaa0,
};

/** Explicit cache metadata or a regional altar complex supplies the element-colour identity. */
function essenceElementFor(entity: SemanticEntity): EssenceElement | null {
  const assetId = entity.view?.assetId;
  const essenceCache = entity.archetype === "ore"
    && entity.meta?.essenceCache === true
    && !!assetId
    && ESSENCE_CACHE_ASSETS.has(assetId);
  const essenceAltar = entity.archetype === "station"
    && entity.station?.kind === "essence_altar"
    && entity.meta?.essenceAltar === true
    && assetId === ESSENCE_ALTAR_ASSET;
  const essenceRuins = entity.archetype === "landmark"
    && entity.meta?.essenceAltarRuins === true
    && assetId === ESSENCE_ALTAR_RUINS_ASSET;
  if (!essenceCache && !essenceAltar && !essenceRuins) return null;

  const element = entity.meta?.essenceElement;
  return element === "wind" || element === "earth" || element === "water" || element === "fire"
    ? element
    : null;
}

/**
 * The beat between a body settling and the moment it starts to dissolve, and how long that takes.
 *
 * Deliberately NOT a single linger covering the longest death animation in the game. That was the
 * first version and it read as waiting: the clips run from the deer's 0.83 s to the coyote's 4.17 s
 * (`tools/animals/clip-durations.ts`), so one constant long enough for the coyote left a hen lying
 * on the grass for three seconds after it had finished dying. The linger is therefore taken per
 * creature from its OWN death clip, and this is only the pause afterwards.
 */
const CORPSE_DWELL_MS = 350;
const CORPSE_FADE_MS = 900;

/**
 * The linger used when there is no rig to measure a death clip from.
 *
 * Only instanced corpses land here, which are the ones past the rig release radius (70 m). Chosen
 * near the middle of the clip range rather than at the top of it, because at that distance a body
 * is a few pixels and going early is a far cheaper mistake than lying there.
 */
const CORPSE_FALLBACK_LINGER_MS = 1500;

/** Below this, an opacity change is not worth a material write. One step of an 8-bit channel. */
const FADE_EPSILON = 1 / 255;

/**
 * How far through dissolving a corpse is: 0 whole, 1 gone.
 *
 * Exported so the shape can be pinned without a renderer, and so the two numbers above have exactly
 * one reader. Both arguments are on the SIM clock - `view.diedAtMs` is stamped there - which is
 * what makes this a pure function of state rather than of how many frames have been drawn.
 */
export function corpseFade(nowMs: number, diedAtMs: number, lingerMs: number): number {
  const progress = (nowMs - diedAtMs - lingerMs) / CORPSE_FADE_MS;
  return Math.min(1, Math.max(0, progress));
}

/**
 * How long THIS corpse should lie still: the length of the death animation it actually played.
 *
 * Measured off the rig rather than assumed, so every creature waits exactly as long as it needs to
 * finish falling and not a frame longer. Anything without a death clip on a live rig - an instanced
 * body, or one of the three fish, which the pack ships no death animation for - takes the fallback.
 */
export function corpseLinger(deathClipSeconds: number | null): number {
  if (deathClipSeconds === null || !(deathClipSeconds > 0)) return CORPSE_FALLBACK_LINGER_MS;
  return deathClipSeconds * 1000 + CORPSE_DWELL_MS;
}

/**
 * Archetypes whose tier is a gameplay ladder, and are therefore allowed to move their proportions.
 *
 * Round 1 scaled EVERYTHING by `tierSilhouetteScale`, so a Karrowmoor market stall was 12% larger
 * than the identical stall in Coldbrace purely because its region carries a higher tier. Tier is a
 * readability signal for things you gather from and fight; it is not a size rule for architecture.
 */
const TIERED_ARCHETYPES = new Set<Archetype>([
  "ore", "tree", "fishing_spot", "enemy", "boss",
]);

/** How far a given archetype's art is pulled toward its tier palette, and toward which swatch. */
interface Appearance {
  swatch: PaletteSwatch;
  /** 0..1. Zero means "leave the authored art alone", and costs no material clone at all. */
  strength: number;
}

/**
 * The tier-legibility policy, in one table.
 *
 * Ore is the strong case and the one the PRD writes a contract for: at 0.88 a stock grey rock
 * texture actually lands on the tier's body colour, where round 1's 0.25 could not move it at all.
 * NPCs, buildings, props and landmarks are deliberately absent — they resolve to `NEUTRAL` and
 * render as authored, because tinting a shopkeeper toward "Kaldite blue-black" communicates
 * nothing and costs a cloned material.
 */
const APPEARANCE: Partial<Record<Archetype, Appearance>> = {
  ore: { swatch: "body", strength: 0.88 },
  tree: { swatch: "body", strength: 0.55 },
  fishing_spot: { swatch: "accent", strength: 0.7 },
  enemy: { swatch: "metal", strength: 0.45 },
  boss: { swatch: "metal", strength: 0.55 },
};

const NEUTRAL: Appearance = { swatch: "metal", strength: 0 };

/**
 * Archetypes whose tier is kept out of the instance-group key without looking at the art at all.
 *
 * `npc` and nothing else. It is a shortcut, not a separate rule: `EntityViews.groupTier` would
 * reach the same answer from the materials, and this only saves it the traverse on the one
 * archetype whose "materials" are six separately loaded part GLBs.
 */
const TIER_BLIND_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>(["npc"]);

/** Canopy materials follow the tier ACCENT, not the rock body a trunk shares its swatch with. */
const LEAF_MATERIAL = /leaf|leaves|foliage|canopy/i;

/** Local-space bend at full height. Trunks stay fixed while their foliage moves. */
const TREE_FOLIAGE_WIND = 0.055;
const NATIVE_TREE_FOLIAGE_WIND = 0.035;

/**
 * Materials a tier tint must never touch. Eyes, teeth and the pure black/white trims on the
 * monster packs are art direction, not tier: pulling them toward a palette colour flattens a face
 * into a smear and buys no legibility.
 */
const PROTECTED_MATERIAL = /eye|teeth|tongue|hair|white|black/i;

/**
 * The animal pack's materials, which the tier tint must also never touch.
 *
 * `APPEARANCE.enemy` pulls an enemy material 45% toward the tier's METAL swatch, and at tier 10
 * that swatch is Kaldite blue-black. That policy was written when the whole bestiary was four
 * stylized meshes sharing a stock grey texture, where the tint was the ONLY thing saying which
 * tier a monster belonged to. Against photographic animal maps it does the opposite: measured on
 * the first render pass, a brown bear and a black-and-white cow both came out as near-silhouettes
 * with no fur or hide left in them.
 *
 * Tier legibility does not need it any more, because SPECIES now carries it and carries it better:
 * tier 1 is hens, coneys and frogs, tier 5 is deer and coyotes, tier 10 is bears and aurochs. A
 * player never has to read a bear's palette to know it outranks a hen.
 *
 * `tools/build-animals.ts` names every material `animal_<assetId>_mat` and `tools/build-bosses.ts`
 * names every material `boss_<assetId>_mat`, so these prefixes are a contract between those files
 * and this one, not a guess. Being strength 0 also puts these groups on `groupTier`'s
 * tier-independent path, which merges instances across tiers.
 *
 * The bosses need it for a second reason on top of the hide: their element is carried by an
 * EMISSIVE map of glowing seams, recoloured per element when the texture is staged. Pulling the
 * base colour 45% toward Kaldite blue-black would leave an earth boss glowing green out of a
 * blue-black body, which reads as a bug rather than as a creature.
 */
const CREATURE_MATERIAL = /^(animal|boss)_/i;

/**
 * Humanoid idles, from the shared 65-joint clip library.
 *
 * CORRECTION. The comment that stood here claimed "every character pack shares one skeleton", and
 * that claim is why the headless-NPC and bind-pose bugs got written. It is false. Hashing each GLB's
 * `inverseBindMatrices` buffer across models/character, models/outfit and models/animation finds
 * FOUR distinct 65-joint humanoid skeletons: `base_male` alone (ba5af210); `base_female` plus
 * hair_long/hair_buns plus every female outfit part (eea9805d); eyebrows plus
 * hair_short/hair_buzzed/hair_beard plus every male outfit part (3c715354); and both animation
 * libraries (0d2ac055). What they share is the JOINT LIST — 65 joints, identical names in identical
 * order — which is what makes a name-keyed rebind legal and a raw bone-array share illegal. The
 * residual is the rest-pose delta between two rigs: 0 mm for base_female + female parts, at most
 * 23.7 mm (foot) / 23.3 mm (hand) for base_male + male parts. See `render/skinning.ts`, which owns
 * the rebind and re-verified all of this across 17 files.
 *
 * Four idles, picked per entity, because a settlement where five NPCs breathe in unison reads worse
 * than five NPCs standing still.
 */
const HUMANOID_IDLES: readonly string[] = [
  "Idle_Loop", "Idle_Talking_Loop", "Idle_FoldArms_Loop", "Idle_No_Loop",
];

/**
 * What a character is doing, as far as this layer can tell from semantics alone.
 *
 * Deliberately narrow. `render/` reads `SemanticEntity` and nothing else, so it cannot see
 * `state.world.enemies[id].state` (idle/aggro/returning) — that lives in the store and belongs to
 * `systems/`. What it CAN see is `entity.state` (alive/dead) and whether `entity.position` moved
 * between syncs, and those two cover idle / walk / death. `attack` and `hit` are one-shots the
 * owner of the combat stream pushes in through `playAction`.
 */
export type CharacterMotion = "idle" | "walk" | "run" | "attack" | "hit" | "death";

/**
 * Clip names to try per motion for an asset that ships its OWN clips, best first.
 *
 * Measured from the manifest rather than assumed: enemy_crab, enemy_blob and enemy_skull each ship
 * ["Bite_Front", "Bite_InPlace", "Dance", "Death", "HitRecieve", "Idle", "Jump", "No", "Walk",
 * "Yes"]; enemy_bee ships ["Bite_Front", "Death", "Flying", "HitRecieve"] and has NO Idle and NO
 * Walk, which is why `Flying` appears in both of those rows — a bee that stops flapping when it
 * stops moving reads as dead.
 */
const OWN_CLIP_PATTERNS: Record<CharacterMotion, readonly RegExp[]> = {
  // A container's "Closed" clip is a held pose, while "Close" is the transition into it. Without
  // this preference the chest manifest order picks Chest_Close and loops the transition forever.
  idle: [/^idle/i, /^flying/i, /(?:^|_)closed$/i],
  walk: [/^walk/i, /^flying/i, /^jump/i],
  // Falls back to the walk clip, because not every rig ships a run: the hog, the rat and the fish
  // have one locomotion cycle each and pursuing on it is correct for them.
  run: [/^run/i, /^walk/i, /^flying/i, /^jump/i],
  attack: [/^bite_front/i, /^bite/i, /attack/i],
  hit: [/^hitrecieve/i, /^hit/i],
  death: [/^death/i],
};

/** Orders an asset's own clips without using a transition as its resting animation. */
export function ownClipCandidates(
  own: readonly string[],
  motion: CharacterMotion,
): string[] {
  const picked: string[] = [];
  for (const pattern of OWN_CLIP_PATTERNS[motion]) {
    for (const name of own) if (pattern.test(name) && !picked.includes(name)) picked.push(name);
  }
  if (motion !== "idle") return picked;
  for (const name of own) if (!picked.includes(name)) picked.push(name);
  return picked;
}

/**
 * The same table against the shared 65-joint library, for anything built on a humanoid body.
 *
 * All of these resolve: `__gameDebug.listClips()` returns 85 names and every one of these is in it.
 * `Death01` is spelt without an underscore in the library; that is the file's spelling, not a typo.
 */
const HUMANOID_CLIPS: Record<CharacterMotion, readonly string[]> = {
  idle: HUMANOID_IDLES,
  // A humanoid now gets both gaits, chosen by whether it is pursuing. Jog was the only option here
  // while pursuit was the only time anything moved; a reaver pottering around its camp on a jog
  // cycle is the same defect the animals had.
  walk: ["Walk_Loop", "Jog_Fwd_Loop"],
  run: ["Jog_Fwd_Loop", "Walk_Loop"],
  // Humanoid enemies do not carry a weapon attachment. A punch reads correctly; a sword clip
  // makes them swing a blade that is not there.
  attack: ["Punch_Jab", "Sword_Attack", "Sword_Regular_A"],
  hit: ["Hit_Chest", "Hit_Knockback"],
  death: ["Death01"],
};

/**
 * Bounds on how far a walk cycle may be retimed to match the ground it covers.
 *
 * Below 0.6 a cycle reads as slow motion.
 *
 * CORRECTION, and the reason `MAX_WALK_CADENCE_HZ` exists below. The old ceiling was 3.2 and was
 * raised to it deliberately, to close the foot slide on the pack's small animals. That reasoning
 * optimised the wrong quantity. Slide is minimised by cranking the playback rate, and cranking the
 * playback rate is exactly what makes legs race — so driving slide to zero produced a roster where
 * a coney completed 3.94 leg cycles per second, a frog 3.62 and a goat 3.35, all at 0% slide and
 * all reported from play as "their feet move rapidly and they are jittery". Both halves of that
 * report are one cause: at 3.9 Hz a 60 fps frame budget leaves fifteen frames to draw a whole
 * cycle, so the legs snap between poses rather than sweeping through them.
 *
 * A rate ceiling cannot express that, because the same rate means different things on different
 * clips: the goat's walk is 0.47 s and the hog's is 1.33 s, so 1.6x is 3.4 Hz on one and 1.2 Hz on
 * the other. The ceiling that matters is in CYCLES PER SECOND, and it is applied below.
 */
const WALK_RATE_MIN = 0.6;
const WALK_RATE_MAX = 3.2;

/**
 * The fastest a walk cycle may be played, in cycles per second.
 *
 * This is what the eye actually judges. Real quadruped walks and trots sit between about 1.5 and
 * 2.5 Hz, and small animals live at the top of that; 2.4 is the generous end of natural rather than
 * a stylistic choice, so it corrects the racing without slowing anything that already looked right
 * (the bear at 2.42 and the rhino bosses at 1.59 are untouched by it).
 *
 * It is a SAFETY NET, not the primary mechanism. `content/enemies.ts` speeds are tuned so the cap
 * does not bite, because a cap that bites is a cap trading racing legs for foot slide — the same
 * trade in the other direction. `tests/creature-gait.test.ts` asserts both ends of that: nothing
 * exceeds this cadence, and nothing needs the cap to avoid exceeding it.
 */
const MAX_WALK_CADENCE_HZ = 2.4;

/**
 * Whole sim ticks with no displacement after which a mover's gait pose drops to idle.
 *
 * One, and that is not hasty: the AI steps a moving creature every single 100 ms tick, so a whole
 * tick without displacement IS the stop, not noise. Waiting for the 4 Hz structural sync's
 * two-cycle hysteresis instead held the gait for 250-500 ms after arrival — at a cattle run
 * cadence that is exactly "one extra gallop on the spot when it reaches its target", which is how
 * play reported it. `MOVING_HOLD_SYNCS` stays as the structural path's own hysteresis; this is
 * the fast path that ends the gait the moment the simulation stops moving the body.
 */
const SETTLED_TICKS_TO_IDLE = 1;

/** Measured planted-foot speed of Jog_Fwd_Loop in the shared humanoid animation library. */
const HUMANOID_JOG_IMPLIED_MPS = 5.92;

/**
 * Measured planted-foot speed of Walk_Loop, by the same method on the same rig
 * (runs/corealm/audit/humanoid-stride-probe.ts, calibrated against the jog's recorded 5.92).
 */
const HUMANOID_WALK_IMPLIED_MPS = 1.15;

/**
 * The ground speed below which a humanoid's locomotion prefers Walk_Loop over the jog, expressed
 * as a fraction of the jog's implied 5.92 m/s (0.55 x 5.92 = 3.26 m/s).
 *
 * This threshold chooses the CLIP only; it no longer sets the jog's playback rate. Exact
 * foot-planting on the jog was tried twice and looks like slow motion at every enemy speed —
 * the same finding `characterRig.setLocomotionSpeed` documents for the player at 4.2 — so a
 * humanoid jog now plays at the player's own `runPresentationScale`, cadence over planting.
 * Below this speed even that reads wrong (a 0.9 m/s potter under a 0.9x jog is a moonwalk), and
 * the walk cycle takes over, speed-matched exactly as `walkStrideScale` does for the player.
 */
const HUMANOID_JOG_MIN_RATE = 0.55;

/** Motions that play once and hand back to the entity's resting motion. */
const ONE_SHOT_MOTIONS: ReadonlySet<CharacterMotion> = new Set<CharacterMotion>(["attack", "hit"]);

/**
 * Which base body a clothes-only outfit GLB needs under it, and what its own part id is.
 *
 * This is the local fallback the rig diagnosis' recommendation 1 offers: `world/regionBuilder.ts`
 * is moving NPCs to `view.assetId = base_male|base_female` plus `view.partAssetIds`, but until that
 * lands `view.assetId` is one of these four clothes-only files, and drawing one as a whole body is
 * exactly the headless NPC. Keying the body off the outfit id here means the fix is live either way
 * and becomes dead weight — not a conflict — the day the world layer starts authoring parts.
 */
const OUTFIT_BODIES: Readonly<Record<string, string>> = {
  outfit_male_peasant: "base_male",
  outfit_male_ranger: "base_male",
  outfit_female_peasant: "base_female",
  outfit_female_ranger: "base_female",
};

/**
 * Outfits that already cover the skull, so hair is skipped.
 *
 * Male_Ranger_Head_Hood spans y 1.5253-1.8650 and hair_short spans 1.661-1.840, i.e. the hair sits
 * entirely inside the hood and pokes through its crown. A hooded NPC keeps the face it gets from
 * the head cap and goes without hair.
 */
const HOODED_PARTS: ReadonlySet<string> = new Set([
  "outfit_male_ranger", "outfit_female_ranger",
  "outfit_male_ranger_hood", "outfit_female_ranger_hood",
]);

const HAIR_PART = /^hair_/;

/**
 * An authored outfit part id, split into (sex, family, slot).
 *
 * `world/regionBuilder.outfitPartsFor` emits exactly this shape: one family for the whole
 * character, chosen from the npc id. That gives the world FOUR outfits - male/female x
 * peasant/ranger - and the shipped roster of 12 NPCs realises all four, which is why three of the
 * five male peasants in the world are the same person and why the player and `npc_carter_bel` are
 * pixel-for-pixel identical in runs/corealm/screenshots/ev3-before-npc-carter_bel.png.
 */
const OUTFIT_PART = /^outfit_(male|female)_(peasant|ranger)_(chest|legs|boots|gloves|hood|pauldron)$/;

/**
 * Outfit slots that may take EITHER family on the same character.
 *
 * Mixing is legal because both families are authored onto the same body and their coverage bands
 * overlap at every seam. Measured from the manifest (base y + size y, i.e. the authored bind-space
 * span of each part GLB):
 *
 * ```text
 *   male    chest 0.921-1.558 (peasant)  0.909-1.600 (ranger)
 *           legs  0.403-1.054            0.423-1.052
 *           boots -0.004-0.448           -0.004-0.556
 *   female  chest 0.988-1.519            0.919-1.541
 *           legs  0.436-1.091            0.411-1.061
 *           boots -0.007-0.458           -0.004-0.556
 * ```
 *
 * Every cross-family pair overlaps: the smallest chest/leg margin is a ranger chest over female
 * peasant legs, 1.091 - 0.919 = 172 mm, and the tightest boot/leg pair is female peasant boots
 * under female peasant legs at 458 - 436 = 22 mm. Nothing here can open a gap that shows bare skin,
 * which is the one regression this mixing could plausibly cause. The head-cap seam survives too:
 * the cut is 1.550 male / 1.500 female and the LOWEST chest top of the four is 1.519, so there is
 * at least 19 mm of collar over the cut whichever chest is chosen.
 *
 * `chest` is deliberately not in the list. It is what says whether this person is a villager or an
 * outdoorsman, and `regionBuilder` derives that from the npc's own role.
 *
 * `hood` and `pauldron` exist only as ranger meshes, so they are presence choices rather than
 * family choices. A hood over a peasant tunic reads as a traveller and a single pauldron over one
 * reads as a militia guard; both are silhouette changes this library otherwise cannot make.
 */
const MIXABLE_SLOTS: readonly string[] = ["legs", "boots", "gloves"];

/** How often a character not authored with one is given a hood / a pauldron. */
const HOOD_CHANCE = 0.18;
const PAULDRON_CHANCE = 0.34;
/** How often an authored ranger keeps its hood. The rest go bare-headed and get hair. */
const HOOD_KEEP_CHANCE = 0.6;
/** How often a male character wears a beard. `hair_beard` is a second layer, not a hair choice. */
const BEARD_CHANCE = 0.45;

/**
 * Hair meshes offered per sex.
 *
 * `render/skinning.hairAssetFor` offers two per sex; this widens the female list and adds the
 * beard, and it deliberately does NOT put `hair_long` on a male body. hair_long spans bind y
 * 1.501-1.777 against a male head cap at 1.550, so 49 mm of it hangs below the cut and over the
 * shoulder line of a rig it was not authored for. `hair_short` at 1.661-1.840 and `hair_buzzed` at
 * 1.644-1.813 sit entirely above the cut, and `hair_beard` at 1.550-1.690 sits on the chin.
 *
 * The variety that matters here is COLOUR, not mesh: the packed hair texture is near-white on
 * every character in runs/corealm/screenshots/ev3-before-npc-carter_bel.png, so a per-entity
 * multiply moves it across the whole natural range.
 */
const MALE_HAIR: readonly string[] = ["hair_short", "hair_buzzed"];
const FEMALE_HAIR: readonly string[] = ["hair_long", "hair_buns", "hair_short"];
const BEARD_ASSET = "hair_beard";

/**
 * What a per-entity tint is allowed to move, resolved from the SOURCE material's name.
 *
 * The names are stable and few. Dumped from all 36 character and outfit GLBs: the humanoid kit
 * paints with `MI_Peasant`, `MI_Ranger`, `MI_Regular_{Male,Female}`, `MI_Superhero_{Male,Female}`,
 * `MI_Hair_{1,2}` and `MI_Eyes`; the four monster packs with `Main`, `Main_Dark`, `Main_Light`,
 * `Main_2`, `Wings`, `Horns`, `Teeth`, `Tongue`, `Eyes`, `Black` and `White`.
 *
 * `cloth` and `clothAlt` are two roles rather than one because a mixed character wears both
 * families at once, and giving the two their own dye is what turns "a different pair of trousers"
 * into "a different person". Eyes, teeth, tongue and the pure black/white trims resolve to `none`
 * for the same reason `PROTECTED_MATERIAL` exists: a tinted eye is a smear.
 */
type TintRole =
  | "none"
  | "cloth"
  | "clothAlt"
  | "skin"
  | "hair"
  | "creature"
  | "creatureAccent"
  | "architecture";

const CLOTH_MATERIAL = /^MI_Peasant/i;
const CLOTH_ALT_MATERIAL = /^MI_Ranger/i;
const SKIN_MATERIAL = /^MI_(Regular|Superhero)_(Male|Female)/i;
const HAIR_MATERIAL = /^MI_Hair/i;
const CREATURE_BODY_MATERIAL = /^Main(_Dark|_Light|_2)?$/i;
const CREATURE_ACCENT_MATERIAL = /^(Wings|Horns)$/i;

/** Character archetypes whose parts carry a per-entity dye colour. Architecture varies separately. */
const TINTABLE_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>(["npc", "enemy", "boss"]);

/**
 * Architecture is emitted as scenery landmarks, while a gate's inspectable arch is a portal.
 * Material-name matching remains mandatory, so unrelated materials on the same archetypes retain
 * their authored colour.
 */
// Traversal structures and town fixtures are part of the same built vernacular as landmarks and
// portals. Keeping them out of this set left Rootfall's timber arch, market counters and Canopy
// Walk in raw orange wood while the walls, doors and roadside structures used the regional palette.
const ARCHITECTURE_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>([
  "landmark", "portal", "obstacle", "bank", "shop", "station",
]);

/** Quantised per-building value shifts. Stored as instance colour, so they add no material buckets. */
const ARCHITECTURE_VALUE_STEPS: readonly number[] = [0.96, 0.98, 1, 1.02, 1.04];

/**
 * The dye lots, hair colours, skin tones and creature hues, as MULTIPLIERS against the authored
 * texture.
 *
 * Every entry keeps a channel at or near 1.0 on purpose. `diffuseColor *= vColor` in the fragment
 * shader (three 0.185, ShaderChunk/color_fragment) is a straight multiply, so a swatch whose
 * brightest channel is 0.7 does not recolour the art, it dims it by 30% - the same mistake
 * `MaterialLibrary.variant` documents under `preserveLuminance`. These shift hue and leave the
 * value where the texture's author put it.
 *
 * The skin ramp is the exception and is a value ramp as well as a hue one, because skin tone IS a
 * value difference. It stops at 0.50 rather than going darker because the key light here is a low
 * sun, and a face below that reads as being in shadow rather than as a face.
 */
const CLOTH_TINTS: readonly number[] = [
  0xffb3a4, 0xa9c4ff, 0xc4e59a, 0xffd98f, 0xf0e8dc,
  0xb2aeb8, 0xdca8d6, 0xffb573, 0x9fd9c4, 0xe6cfa2,
];
const HAIR_TINTS: readonly number[] = [0x4a4038, 0x7d5a3a, 0xb08050, 0xd4712e, 0xf2dd9b, 0xdadade];
const SKIN_TINTS: readonly number[] = [0xfff2e6, 0xf6dcc4, 0xe0bc98, 0xc39a70, 0xa07850, 0x805c40];
const CREATURE_TINTS: readonly number[] = [
  0xffb0a0, 0xa8d8ff, 0xc8ffa8, 0xffe6a0, 0xd8b0ff,
  0xa0ffe0, 0xffa8d8, 0xd0d0d0, 0xffd0b0, 0xb8ffb8,
];

/** Per-individual value steps inside one creature family, so a swarm is not six copies. */
const CREATURE_SHADES: readonly number[] = [1, 0.92, 0.84];

/** No tint. Also the value a `BatchedMesh` colours texture is initialised to. */
const NO_TINT = 0xffffff;

/**
 * Per-entity build, as a multiplier on the drawn scale.
 *
 * Uniform first, then a small extra on Y, because the two together are what read as different
 * PEOPLE rather than as one person at two zoom levels. The combined envelope is 0.95 x 0.98 = 0.93
 * to 1.06 x 1.03 = 1.09, i.e. a 1.82 m `base_male` is drawn between 1.70 m and 1.99 m. Anything
 * wider than that stops reading as a crowd and starts reading as a bug.
 *
 * `BatchedMesh` handles the non-uniform half correctly: `defaultnormal_vertex` divides the normal
 * by the per-axis squared column lengths of the instance matrix before transforming it (three
 * 0.185), so a stretched instance still lights right. The unique path is a plain `Object3D.scale`
 * and three does the same thing there through the normal matrix.
 */
const BUILD_SCALES: readonly number[] = [0.95, 0.98, 1, 1.02, 1.04, 1.06];
const BUILD_HEIGHTS: readonly number[] = [0.98, 1, 1.015, 1.03];
/** Archetypes that get a build. The boss is excluded: there is one, and its size is the read. */
const BUILD_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>(["npc", "enemy"]);
const NO_BUILD: readonly [number, number, number] = [1, 1, 1];

/**
 * How far each archetype beds into the terrain normal, 0..1, when the world layer supplies a normal
 * but no `view.tiltStrength`.
 *
 * THIS IS THE FALLBACK, NOT THE LIVE TABLE. `world/regionBuilder.ts:476` authors `tiltStrength` on
 * every tilt-eligible entity it emits, so in the shipped world this table is consulted for nothing:
 * measured live, ore reads 0.85, tree 0.12, obstacle 0.5, fishing_spot 1 and landmark 0.25 straight
 * off `view`. The numbers below are therefore kept EQUAL to the authored ones — two tables that
 * disagree is how a look silently changes the day one of them stops being written.
 *
 *   tree 0.12       A tree grows toward the light, not perpendicular to the hill.
 *   ore 0.85        A rock IS bedded into the hill it came out of.
 *   obstacle 0.50   Fallen logs and boulders: same argument as ore, less of it, because several are
 *                   authored as climbable and a hard tilt moves the climb line.
 *   fishing_spot 1.0 Flat things. A lily pad that does not lie in the ground is not a lily pad.
 *
 * Verified by measurement, not by argument (runs/corealm/audit/ev2-sink.ts). The world layer clamps
 * the normal it hands over to 20 degrees off vertical, so the applied tilt is
 * `min(slope, 20 deg) * strength` and is ALWAYS shallower than the ground the object stands on. At
 * footprint radius r the tilted base plane drops `r * sin(tilt)` while the terrain drops
 * `r * tan(slope)`, and the second is larger for every one of the eleven steepest-standing entities
 * in the world: lower_quarry_kaldite_5 0.97 m against 3.01 m, scree_slide 1.00 against 1.04,
 * fallen_duskoak 1.59 against 1.65, duskoak_stand_trees_9 1.20 against 1.27, ridge_pines_trees_6
 * 1.36 against 1.44. Nothing this table produces can put an object below the terrain under its own
 * footprint, and a tree at 0.12 leans by at most 2.4 degrees.
 *
 * That is also the whole of what `checkGrounding` is reporting when it flags these rows, and round 5
 * measured it instead of arguing it. `checkGrounding` scores `drawnBounds().min.y` — the DOWNHILL
 * corner of a tilted AABB — against `groundHeight` sampled at the entity's CENTRE, so on a slope a
 * correctly bedded object MUST score negative. runs/corealm/audit/dcb-shots.ts re-scores the same
 * rows against the LOWEST terrain under each entity's own drawn footprint (a 7x7 grid across its
 * AABB) rather than under its centre:
 *
 * ```text
 *   entity                   centre gap   footprint gap   terrain relief under footprint
 *   lower_quarry_kaldite_1       -1.000          +0.203         2.731 m over 5.78 x 5.77 m
 *   lower_quarry_kaldite_3       -0.836          +0.776         2.954
 *   upper_karrow_kaldite_3       -0.617          +0.434         2.126
 *   upper_karrow_kaldite_1       -0.599          +0.465         2.238
 *   lower_quarry_kaldite_5       -0.561          +0.445         2.557
 *   fallen_duskoak               -0.454          -0.206         3.236
 *   sunder_ledge                 -0.363          +0.298         2.434
 *   bracken_pit_grithe_6         -0.343          +0.004         0.992
 *   hollowcut_corven_5           -0.335          +0.178         1.535
 * ```
 *
 * Eleven of the twelve worst rows come out POSITIVE: the mesh's lowest point is above the lowest
 * ground under it, and every one of them stands on 1.0-3.5 m of relief. Nothing is sunk. The one
 * genuine negative is `fallen_duskoak`, a 6.9 x 15.8 m `roof_log` authored as a bridge ACROSS a
 * 3.2 m gully (content/regions.ts) — its AABB necessarily contains ground it is meant to span.
 *
 * This is a defect in the audit's metric, not in the placement, and it is not fixable from this
 * file: `checkGrounding` lives in `debug/gameDebug.ts` and the entity's y comes from
 * `world/regionBuilder.ts:placeOnGround`. What this file can honestly say is that `drawnBounds` is
 * reporting the box correctly — see the byte-identical before/after in the header.
 *
 * Everything absent resolves to 0. That includes `landmark`, and it is not an oversight: building
 * parts are emitted as `landmark` entities (world/regionBuilder.ts:530), 36 buildings' worth of
 * them, and `checkBuildingFooting()` already returns worst 0 for every one. Tilting a wall segment
 * toward the ground normal would break the only part of the grounding audit that was already clean.
 * The world layer authors 0.25 on the standalone landmarks it does want tilted and hands building
 * parts no normal at all, so the fallback never has to make that distinction.
 */
const DEFAULT_TILT: Partial<Record<Archetype, number>> = {
  tree: 0.12,
  ore: 0.85,
  obstacle: 0.5,
  fishing_spot: 1,
};

/**
 * Archetypes whose position is expected to change while the game runs.
 *
 * Only these are walked by `syncMotion`, which the render frame may call at full rate; everything
 * else is reconciled by `sync` at whatever cadence the loop chooses.
 */
const MOVING_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>(["enemy", "boss", "npc"]);

/**
 * Orders rigs for the per-frame mixer budget, in place.
 *
 * The front `NEAREST_ANIMATION_SHARE` of the budget is reserved for the nearest rigs, so whatever
 * the player is standing in front of animates on every single frame. The rest of the budget goes to
 * whichever rigs were ticked LEAST RECENTLY, which is what stops the tail freezing.
 *
 * The ordering key for that second half is a FRAME COUNTER, and that is the whole subtlety. Two
 * earlier versions ranked by how much animation time a rig was owed, and both degenerated into the
 * original bug because that quantity saturates: owed time is clamped, every starved rig reaches the
 * ceiling within a couple of frames on a slow machine, they all tie, and the sort falls through to
 * distance again. A counter cannot tie and cannot saturate.
 *
 * `viewer` may be absent, in which case there is no meaningful distance and the whole budget
 * rotates.
 */
export function orderAnimationBudget(
  ranked: { position: THREE.Vector3; lastTickedFrame: number }[],
  cap: number,
  viewer?: THREE.Vector3,
): void {
  if (ranked.length > 1 && viewer) {
    ranked.sort((a, b) =>
      a.position.distanceToSquared(viewer) - b.position.distanceToSquared(viewer));
  }
  if (ranked.length <= cap) return;
  const reserved = viewer
    ? Math.min(ranked.length, Math.max(1, Math.ceil(cap * NEAREST_ANIMATION_SHARE)))
    : 0;
  const tail = ranked.splice(reserved);
  tail.sort((a, b) => a.lastTickedFrame - b.lastTickedFrame);
  ranked.push(...tail);
}

/**
 * Which locomotion cycle a moving creature should be playing.
 *
 * A walk and a run are different animations, not one animation at two speeds, so retiming cannot
 * substitute one for the other: a gallop played slowly is still a gallop. Everything in the game
 * used to move on its run cycle, which is why the roster read as racing and jittering however the
 * playback rate was tuned.
 */
/**
 * The ground speed to retime a gait against: the walk cycle's speed for a walk, the run's for a run.
 *
 * Pairing a clip with the wrong speed is the whole original defect in one line — dividing a pursuit
 * speed by a walk cycle's stride asks for a rate several times too high, and the legs race.
 */
function gaitSpeed(
  record: { moveSpeedMps?: number; walkSpeedMps?: number; gaitSpeedMps?: number },
  motion: CharacterMotion,
): number | undefined {
  // The published live speed wins: it is the one number that is correct in every mode, where the
  // fallbacks have to guess which authored speed the AI happens to be using — and guess wrong
  // for a leash return, which hurries at 1.16x the pursuit speed.
  if ((motion === "run" || motion === "walk") && record.gaitSpeedMps !== undefined) {
    return record.gaitSpeedMps;
  }
  if (motion === "run") return record.moveSpeedMps;
  if (motion === "walk") return record.walkSpeedMps ?? record.moveSpeedMps;
  return record.moveSpeedMps;
}

function gaitFor(record: { pursuing: boolean }): CharacterMotion {
  return record.pursuing ? "run" : "walk";
}

/**
 * Whether `systems/enemyAI.ts` currently has this creature chasing or walking home.
 *
 * `entity.state` is the only channel the render layer is allowed to read for this — the AI's own
 * `state.world.enemies[id].state` lives in the store and `render/` never touches it — and the AI
 * writes `aggro` and `returning` onto the entity at the same instant it sets its own runtime.
 */
function isPursuing(entity: SemanticEntity): boolean {
  return entity.state === "aggro" || entity.state === "returning";
}

/** Characters get a forgiving capsule pick target without adding invisible render geometry. */
const EXPANDED_PICK_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>(["npc", "enemy", "boss"]);
const MIN_CHARACTER_PICK_RADIUS = 0.72;
const MAX_CHARACTER_PICK_RADIUS = 1.35;
const CHARACTER_PICK_RADIUS_SCALE = 0.85;

/**
 * An inspect-only entity drawn wider than this (metres, highlight radius) is a place, not a thing.
 *
 * The altar ruins site is one 20 m mesh: hovering any of its arches lit an 11 m ring around the
 * whole court and a click "selected" the ruins you were standing in. Nothing that only offers
 * inspect needs a click target that big — the smaller pieces inside it (the altar, the essence
 * nodes) are their own entities and keep theirs. Gatherable trees and climbable obstacles can be
 * just as wide and stay pickable, because clicking them does something.
 */
const MAX_INSPECT_ONLY_PICK_RADIUS = 5;

function isInspectOnly(entity: SemanticEntity): boolean {
  return entity.interactions.every((interaction) => interaction === "inspect");
}

/**
 * How many syncs a character keeps walking after the last observed position change.
 *
 * `EnemyAI.stepToward` writes a position every 100 ms sim tick while `sync` runs at 250 ms, so a
 * moving enemy shows a position change on most but not all syncs. Two syncs of hysteresis (~500 ms)
 * stops the walk pose flickering off between steps; the same 20-per-second idle/run thrash on the
 * player is what froze the player's run clip (animation diagnosis finding 2).
 */
const MOVING_HOLD_SYNCS = 2;

/**
 * Fraction of the mixer budget handed out strictly nearest-first.
 *
 * The rest goes to whichever rigs have waited longest. Splitting it rather than ranking by one key
 * is what makes the result frame-rate independent: a pure "most starved first" order would let the
 * tail take a frame off the creature the player is actually fighting, and a pure distance order is
 * what froze the tail in the first place. Half and half keeps the nearest few animating every
 * single frame and still guarantees everything else a turn.
 *
 * A starvation THRESHOLD in seconds was tried here first and is a trap: at a low frame rate one
 * frame's delta already exceeds any sensible threshold, every rig lands in the same tier, and the
 * order collapses back to distance — which is exactly the bug, reappearing only on slow machines.
 */
const NEAREST_ANIMATION_SHARE = 0.5;

/**
 * Ceiling on owed animation time, in seconds. Matches the per-frame `delta` clamp in `update`.
 *
 * A rig that has been out of the animation radius for a minute comes back owing a minute. Without
 * this it would fast-forward every one of those seconds in a single mixer call.
 */
const MAX_PENDING_ANIMATION_SECONDS = 0.25;

/**
 * Ignore submillimetre position noise, while recognizing every accepted simulation step.
 * A snail walks 2.5 mm per 100 ms tick. The former 5 mm threshold skipped its targets and
 * repeatedly restarted its gait. The AI already rejects navigation progress below 1 mm;
 * this 0.1 mm rendering tolerance stays below that rule and gives the snail a 25-fold margin.
 */
export const MOVING_EPSILON = 0.0001;

/**
 * Whether this render frame is the first of a new simulation tick.
 *
 * `app/loop.ts` passes `clock.alpha()`, the fraction of the current `SIM_TICK_MS` already elapsed,
 * so it ramps 0 to 1 and drops back once per tick. A frame whose alpha is BELOW the previous
 * frame's is therefore the frame a tick rolled over. Render rate is irrelevant: at 30 fps that is
 * every third frame and at 165 fps every seventeenth, and both answer the same question.
 *
 * `syncMotion` uses it for one thing, and it is worth naming: deciding when an entity that has
 * stopped moving should collapse its interpolation span. Without that, `previous` and `target` stay
 * a step apart forever and the lerp between them sweeps back and forth at frame rate for as long as
 * the entity stands still.
 */
export function crossedSimTick(alpha: number, lastAlpha: number): boolean {
  return alpha < lastAlpha;
}

/** Four fish are authored into a school. Each entity shows a deterministic two to four of them. */
const FISH_SCHOOL_CAPACITY = 4;

/** The procedural school loop is deliberately slow. It reads as fish milling, not a whirlpool. */
const FISH_LOOP_RADIANS_PER_SECOND = 0.62;

/**
 * Water draws at order 2 in `WorldScene`. Fish remain below that surface in world space, but draw
 * immediately afterward through a translucent material so the 94%-opaque water cannot erase the
 * school. The ripple follows the fish and stays the last, quiet surface cue.
 */
const SUBMERGED_FISH_RENDER_ORDER = 3;
const FISH_MARKER_RENDER_ORDER = 4;
const SUBMERGED_FISH_OPACITY = 0.64;
const SOURCE_RETRY_DELAY_MS = 1_000;

/**
 * Starter fish are intentionally small, but their interaction ripple cannot shrink in the same
 * proportion or the whole node drops below a pixel at normal play distance. Later, larger fish
 * need less relative padding. The logarithmic falloff keeps future tiers within the same range.
 */
const FISH_MARKER_TIER_ONE_SCALE = 0.94;
const FISH_MARKER_MIN_SCALE = 0.68;
const FISH_MARKER_TIER_FALLOFF = 0.07;

/**
 * How much of a felled tree is left standing, as a fraction of its height.
 *
 * The nature kit ships one mesh per tree with the trunk and the canopy fused, and no stump asset at
 * all. Round 3 worked around that by swapping in `anvil_log` — which is an anvil that happens to
 * sit on a log — so every worked-out tree in the world turned into a blacksmith's anvil. Clipping
 * the tree's own geometry to its lowest sixth gives a real stump: same trunk, same material, same
 * place, obviously cut.
 */
const TREE_STUMP_FRACTION = 0.22;

/**
 * Fraction of the chosen clip to freeze at for the instanced fallback, per motion.
 *
 * Mid-clip for the looping ones, i.e. settled rather than at the loop seam. Death is the exception
 * and the reason this stopped being one number: a corpse baked at 35% of `Death` is a character
 * halfway to the floor, hanging in the air. 0.98 is the clip's final frame, which is the pose the
 * live one-shot clamps to, so an instanced corpse and an animated corpse match.
 */
const BAKE_PHASES: Record<CharacterMotion, number> = {
  idle: 0.35,
  walk: 0.28,
  run: 0.28,
  attack: 0.5,
  hit: 0.5,
  death: 0.98,
};

/**
 * Share of `maxUniqueDrawCalls` reserved for named characters. The remainder is everything else's.
 *
 * The reserve exists because the budget is first-come and entity order is region order: forty
 * wilderness enemies would spend the whole allowance before the first shopkeeper in Coldbrace is
 * reached, so the characters the player stands in front of would be the statues.
 *
 * Round 3 wrote it as an absolute 64 subtracted from `maxUniqueDrawCalls`, and boot passes
 * `maxUniqueDrawCalls: 64`, so the ceiling for anything that is not an NPC was EXACTLY ZERO and
 * `uniqueDrawCalls + cost <= 0` could not be true at any spend including none. Measured
 * consequence: 872 entities produced `uniqueViews: 4`, all four of them NPCs, and
 * `animatedLastFrame` read 0 in every frame sampled outside Coldbrace square. No enemy in the game
 * had ever animated.
 *
 * A ratio alone does not fix it, which is the part worth writing down. With ONE shared counter and
 * a ceiling of `max - reserve`, the named characters are reached first and spend past that ceiling,
 * so every later enemy is still refused — the arithmetic changes and the outcome does not. The two
 * classes therefore get two independent counters below, and the split is a hard one.
 */
const NAMED_CHARACTER_SHARE = 0.6;

/**
 * How much further than `animationRadius` a character may drift before it gives its rig back.
 *
 * Two pools with hard ceilings fixed "no enemy can ever animate", and left a second bug behind it
 * that is just as visible: the pools are spent FIRST-COME in entity order, and entity order is
 * region order. Measured at f692015 with `maxUniqueDrawCalls: 96`, the named pool (58) went
 * entirely to the four Coldbrace NPCs and the other pool (38) to rill_skitterlings_1..3 plus
 * cairnwights_fields_1 — four of fifty enemies, picked by where they sit in the array. Stand in
 * Highcairn and all five of its characters are statues; fight anything but those four enemies and
 * `playAction` returns false, so no swing, no flinch and no death animation ever plays.
 *
 * So the pools are now allocated by DISTANCE from the camera, not by array order:
 * `canAffordUnique` refuses anything past `animationRadius`, `update` hands back the rigs of
 * characters that have drifted past `animationRadius * this`, and the same pass promotes instanced
 * characters that have come close enough. The budget is unchanged — the same 96 draw calls, spent
 * on the characters the player is actually standing in front of.
 *
 * 1.75 rather than 1.0 because a boundary with no hysteresis thrashes: a character parked at
 * exactly the radius would rebuild its skeleton and re-merge its geometry every frame. 40 m in,
 * 70 m out. Between the two its full rig keeps running. Beyond release it uses an interpolated
 * skeletal palette with the same phase, so the boundary changes cost without freezing motion.
 */
const UNIQUE_RELEASE_FACTOR = 1.75;

/**
 * Characters promoted from their instanced pose to a live rig per frame.
 *
 * Capped at all because promoting a dressed NPC runs `assembleDressedCharacter` — a head cap cut
 * out of the body mesh, four to six outfit parts rebound to its bones, and a merge — and doing a
 * whole settlement roster in the frame the player crosses into it is a hitch.
 *
 * Four rather than one, measured: the named pool at `maxUniqueDrawCalls: 96` affords exactly four
 * dressed NPCs, so four per frame is "one frame of work when you walk into a town" rather than a
 * queue. One was tried first and is wrong in the harness, where headless GL runs the world at a few
 * frames a second: Highcairn took 4 seconds of wall clock to light its four NPCs, so every
 * screenshot and every 700 ms perf settle caught the town half animated.
 *
 * Demotion is deliberately NOT capped: it is a dispose, it is what frees the pool, and a promotion
 * that waits a frame for its budget is a character that stands still for a frame.
 */
const UNIQUE_PROMOTIONS_PER_FRAME = 4;

type ResourcePartDetail =
  | { kind: "oreVein" }
  | {
    kind: "fish";
    schoolIndex: number;
    phase: number;
    orbitX: number;
    orbitZ: number;
    depthJitter: number;
    scale: number;
  }
  | { kind: "ripple"; recovery: boolean }
  | { kind: "bubbles" };

interface SourcePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
  triangles: number;
  /** Local displacement bound for shader wind; copied into the batch's per-geometry bounds. */
  windStrength?: number;
  /** Optional local motion for generated resource details. It never affects gameplay position. */
  resourceDetail?: ResourcePartDetail;
}

/**
 * What a dressed humanoid is made of: a base body plus the parts layered onto its skeleton.
 *
 * Resolved from `view.partAssetIds` when the world layer authors them, and from `OUTFIT_BODIES`
 * when it still hands over a clothes-only outfit as the whole body.
 */
interface CharacterSpec {
  bodyAssetId: string;
  /** Layered onto the body's bones, in draw order. Includes the hair pick. */
  partAssetIds: string[];
  /** Stable identity for grouping and cost caching: body plus parts, in order. */
  key: string;
}

/**
 * One entity's dye lots, one per `TintRole`. `NO_TINT` means "draw the art as authored".
 *
 * Chosen from the entity id and nothing else, so two loads of the same world produce the same
 * faces and a `__gameDebug.reset({seed})` diff does not flap. Each pick is a fresh `Rng` seeded by
 * a hash of the id and the role name, exactly like `skinning.hairAssetFor`: no shared stream is
 * consumed, so adding these shifts no other deterministic draw in the game.
 */
interface EntityTints {
  cloth: number;
  clothAlt: number;
  skin: number;
  hair: number;
  creature: number;
  creatureAccent: number;
}

/**
 * One `BatchedMesh` holding every entity part in the world that draws under the same material.
 *
 * This is the draw-call fix. A group used to own one `InstancedMesh` per part, so the entity layer
 * submitted one draw per (asset, tier, part) pair whether or not two of them were the same paint.
 * Measured on the shipped world at f692015 + settlements: 356 `InstancedMesh`es, and with the
 * shadow pass that is 321 of the 385 draw calls at the `town_entrance` pose — the whole budget.
 *
 * The kits do not have 356 materials. Hashing every material in all 213 manifest GLBs by what the
 * renderer can actually see of it (name, texture names, colour/metallic/roughness factors, side,
 * alpha mode) gives 63 distinct materials, and `MI_WoodTrim` alone appears in 29 separate GLBs with
 * a byte-identical base-colour image (sha1 f02e4f9db3 in every one). See
 * runs/corealm/dc/matkey.mjs: that scan also reports ZERO cases of two materials sharing the
 * runtime key while carrying different texture bytes, which is the thing that would make this
 * unsafe.
 *
 * `BatchedMesh` is what lets those become one draw: many geometries, one material, one
 * `multiDrawElements`. It also culls PER INSTANCE, which plain instancing cannot — so unlike
 * merging instance groups by hand, sharing a batch between Coldbrace and Karrowmoor does not cost
 * the far region's triangles at the near region's camera.
 */
interface Batch {
  key: string;
  mesh: THREE.BatchedMesh;
  /** Allocated ceilings. All three grow by doubling; `BatchedMesh` copies its buffers across. */
  maxInstances: number;
  maxVertices: number;
  maxIndices: number;
  usedInstances: number;
  usedVertices: number;
  usedIndices: number;
  /** Geometry -> batch geometry id, so a geometry two parts share is uploaded once. */
  geometryIds: Map<THREE.BufferGeometry, number>;
  /** instanceId -> the group slot it draws, so a raycast hit can name an entity. */
  owners: ({ group: InstanceGroup; slot: number } | null)[];
}

/**
 * One part of one group's pose variant, drawn out of a shared `Batch`.
 *
 * Replaces the `InstancedMesh` a part used to own. It carries its own `SourcePart` rather than
 * relying on a parallel array, which is what used to force the live/walk bakes to line up
 * index-for-index.
 */
interface PartDraw {
  batch: Batch;
  geometryId: number;
  part: SourcePart;
  /** slot -> instanceId. Sparse: an instance is allocated the first time a slot draws this part. */
  instances: number[];
  /**
   * Which per-entity tint this part's material answers to, resolved once from its name.
   *
   * Characters use their dye role. Architecture uses one neutral value role shared by every
   * material on its parent building. Everything else is "none".
   */
  role: TintRole;
  /**
   * slot -> the tint hex last written into the batch for it. Never re-uploaded when unchanged.
   *
   * `BatchedMesh.setColorAt` flags the whole colours texture `needsUpdate`, and `writeSlot` runs
   * once per moving entity per RENDER frame, so writing an unchanged colour would re-upload a
   * DataTexture per batch per frame for nothing. It also has to be keyed by SLOT rather than by
   * instance: a freed slot keeps its `BatchedMesh` instance and is handed to the next entity that
   * needs one, which would otherwise inherit the previous occupant's dye.
   */
  tints: number[];
}

interface InstanceGroup {
  key: string;
  assetId: string;
  /** Which `BATCH_CELL_SIZE` cell this group's parts batch into. See `batchFor`. */
  cell: string;
  /** Set when this group draws a dressed humanoid rather than a single GLB. */
  character: CharacterSpec | null;
  depletedAssetId: string | null;
  archetype: Archetype;
  tier: number;
  /** Region whose architecture palette this group uses, or null for ordinary entity art. */
  regionId: RegionId | null;
  /** Elemental material identity for a DEXSOFT essence cache, otherwise null. */
  essenceElement: EssenceElement | null;
  /** slot -> entity, or null for a freed slot. */
  slots: (EntityId | null)[];
  free: number[];
  liveParts: SourcePart[];
  /** Built on first spent slot. See `ensureSpent`. */
  spentParts: SourcePart[] | null;
  /**
   * Built on the first slot that actually moves. See `ensureMoving`.
   *
   * Lazy for the same reason `spentParts` is: a second baked pose is a second set of geometries
   * uploaded into the batches, and nothing in the world moves at any of the 18 poses in
   * debug/shots.ts, so building it eagerly would spend buffer space nothing ever draws.
   */
  movingParts: SourcePart[] | null;
  live: PartDraw[];
  spent: PartDraw[];
  moving: PartDraw[];
  /** True when this group's parts came from a rigged asset baked into a pose. */
  posed: boolean;
  /** True when the asset is rigged but no baked pose was available when the group was built. */
  needsPose: boolean;
  /** Interpolated skeletal instances used whenever an actor does not own a live rig. */
  animationLod: AnimationLod | null;
  animationLodUsedAt: number;
}

/** A live skeletal animation on one non-instanced entity. */
interface RigState {
  mixer: THREE.AnimationMixer;
  /** The node the mixer was built on: for a dressed character that is the BODY, not the group. */
  root: THREE.Object3D;
  action: THREE.AnimationAction;
  clipName: string;
  motion: CharacterMotion;
  /** Motion to fall back to when a one-shot finishes. */
  resting: CharacterMotion;
  /** Per-entity idle jitter. Locomotion and one-shots use deterministic tempos. */
  idleTimeScale: number;
  previousAction: THREE.AnimationAction | null;
  replayActions: Map<THREE.AnimationClip, THREE.AnimationAction>;
  hitAction: THREE.AnimationAction | null;
}

interface ViewRecord {
  entityId: EntityId;
  archetype: Archetype;
  groupKey: string;
  slot: number;
  /** Non-instanced fallback for rigged characters. */
  unique: THREE.Object3D | null;
  /** Assembly backing `unique` when it is a dressed humanoid. Owns geometries; must be disposed. */
  dressed: DressedCharacter | null;
  /** Mixer driving `unique`, when this entity earned one. */
  rig: RigState | null;
  playback: CreaturePlayback | null;
  motion: CharacterMotion;
  resting: CharacterMotion;
  idleTimeScale: number;
  /** Meshes in `unique`, counted once at build rather than guessed. */
  uniqueMeshes: number;
  /** Draw calls `unique` costs, shadow pass included. Returned to the pool on release. */
  uniqueCost: number;
  /** True when this record's cost came out of the named pool. See `canAffordUnique`. */
  named: boolean;
  /** Set when a rigged entity was built before its skeleton source was available. */
  awaitingRig: boolean;
  /**
   * True when this entity's asset is skinned, so it is eligible for a mixer if the budget and the
   * camera distance ever allow one. Cached because `rebalanceUniques` asks it every frame and
   * `isRigged` walks a scene graph on a miss.
   */
  rigCandidate: boolean;
  /** Cheap change detection so a steady frame writes nothing. */
  signature: string;
  /** Where this entity is DRAWN. Equal to `target` unless `syncMotion` is interpolating. */
  position: THREE.Vector3;
  /** The last position semantics reported. */
  target: THREE.Vector3;
  /** The one before that, so a render frame can interpolate between the two. */
  previous: THREE.Vector3;
  /** Structural sync may consume a new target before the same frame's motion update. */
  motionTargetPending: boolean;
  rotationTargetPending: boolean;
  /**
   * The interpolation alpha this record last drew at, used only to spot a sim-tick boundary.
   *
   * `alpha` sawtooths 0 to 1 once per `SIM_TICK_MS`, so a frame whose alpha is LOWER than the last
   * one is the first frame of a new tick. See the settle branch in `syncMotion`.
   */
  lastAlpha: number;
  rotationY: number;
  targetRotationY: number;
  previousRotationY: number;
  /** Syncs left before this entity stops counting as moving. See `MOVING_HOLD_SYNCS`. */
  movingTicks: number;
  /** Pursuit speed published on the entity, used to retime the walk cycle. */
  moveSpeedMps?: number;
  walkSpeedMps?: number;
  /** The speed the mover is ACTUALLY stepped at right now, when its owner publishes one. */
  gaitSpeedMps?: number;
  /** Consecutive whole sim ticks with no displacement. See `SETTLED_TICKS_TO_IDLE`. */
  settledTicks: number;
  /** Raised only while playAction tries to move this record to the front of the rig pool. */
  actionPriority: boolean;
  scale: number;
  /** Per-axis shape correction authored on the semantic view, in asset-local coordinates. */
  scaleAxes: readonly [number, number, number];
  /**
   * Per-entity dye lots, resolved once from the entity id. Null for anything not a character.
   *
   * On the record rather than looked up per write because `writeSlot` runs at render rate for
   * everything that moves, and because both draw paths — the batched instance colour and the
   * cloned material on a rigged unique — have to read the same answer or a character changes
   * colour the moment it walks into rig range.
   */
  tints: EntityTints | null;
  /** Neutral instance multiplier shared by every part under the same parent building id. */
  architectureValue: number;
  /** Per-entity build multiplier on `scale`, as (x, y, z). `NO_BUILD` for everything else. */
  build: readonly [number, number, number];
  /** Number of visible fish in this node's four-fish batched school. */
  schoolCount: number;
  /** Stable phase offset so nearby schools do not turn together. */
  schoolPhase: number;
  /** Fish depth below the semantic surface proxy. Authored on resource presentation metadata. */
  waterOffset: number;
  spent: boolean;
  /** Sim time this entity died, straight off `view.diedAtMs`. Null for anything alive. */
  diedAtMs: number | null;
  /**
   * True while `systems/enemyAI.ts` has this creature chasing the player or walking home.
   *
   * Chooses the RUN cycle over the WALK cycle. `entity.state` carries `aggro` and `returning`
   * alongside `alive` and `dead`, so the render layer can tell a pursuit from a potter without
   * reaching into the store for `state.world.enemies`.
   */
  pursuing: boolean;
  /** 0 while the corpse is whole, 1 once it has fully dissolved. See `CORPSE_FADE_MS`. */
  fade: number;
  /**
   * Seconds of animation this rig is owed, because the per-frame mixer budget ran out before it.
   *
   * Zero for anything ticked every frame, which is every rig whenever there are fewer of them than
   * the budget. Clamped, so it says how much time to ADVANCE but not how long the rig has waited —
   * see `lastTickedFrame`, which is what the ordering uses.
   */
  pendingDelta: number;
  /**
   * The frame counter value when this rig's mixer was last advanced.
   *
   * The ordering key for the contested half of the budget, and it is a COUNTER rather than the
   * owed seconds on purpose. Owed seconds saturate: `pendingDelta` is clamped, so every starved rig
   * reaches the ceiling within a couple of frames, ties with all the others, and the sort collapses
   * back to distance — which is the bug it was meant to fix, reappearing after two frames.
   *
   * Counted per RIG TICKED rather than per frame, so the values are unique and the order is strict.
   * A per-frame number leaves every rig ticked in the same frame tied, and a stable sort settles
   * those by array position, which is distance — so the nearest of the contested rigs took every
   * tie and refreshed twice as often as the rest.
   */
  lastTickedFrame: number;
  /**
   * This corpse's own linger, latched from its death clip on the first frame after it died.
   *
   * Latched rather than re-read, because the rig can be demoted to an instance part-way through and
   * a linger that changed underneath the fade would make the body jump back to solid.
   */
  lingerMs: number | null;
  /**
   * Materials cloned for THIS corpse so its opacity can be driven without touching a shared one.
   *
   * `MaterialCache.variant` hands out one material per (source, tier, state, dye), which is the
   * whole reason a hundred bodies cost a handful of materials - and exactly why the fade cannot be
   * written into it. Setting opacity on that shared variant would dissolve every other corpse
   * wearing it at the same time. Owned here and disposed with the record.
   */
  fadeMaterials: THREE.Material[] | null;
  /** Unit terrain normal from `view.groundNormal`, or null. */
  normal: readonly [number, number, number] | null;
  tilt: number;
  labelHeight: number;
  radius: number;
  /** Authored forest contact radius in world metres; independent of the canopy's pick bounds. */
  trunkRadius: number | null;
  /** False for inspect-only entities past `MAX_INSPECT_ONLY_PICK_RADIUS`; `pick` skips them. */
  pickable: boolean;
}

export interface EntityViewStats {
  entities: number;
  groups: number;
  /** Parts uploaded into a batch, across every group and pose variant. NOT a draw-call count. */
  instancedMeshes: number;
  uniqueViews: number;
  /** Unique views carrying a live `AnimationMixer`. */
  riggedViews: number;
  /** Mixers actually ticked on the most recent `update`, after the budget and radius cuts. */
  animatedLastFrame: number;
  /** Rigged assets whose instanced fallback runs from a baked idle pose, not bind pose. */
  bakedPoses: number;
  highlights: number;
  /** Of `instancedMeshes`, the ones with at least one occupied slot. The rest submit nothing. */
  drawnInstancedMeshes: number;
  /**
   * `BatchedMesh`es allocated: one per (cell, material, geometry attribute signature). See `Batch`.
   *
   * Keyed on the material ALONE this world resolves to 43 batches, and that was measured and then
   * rejected — see `BATCH_CELL_SIZE`, where a world-wide batch cost ~7 ms of CPU per frame at every
   * pose because nothing could cull the object. With the 128 m cell in the key it is 263.
   */
  batches: number;
  /**
   * Of those, the ones some occupied slot draws through. THIS is the submitted-draw unit.
   *
   * Measured live on the shipped world at `town_entrance`: 255 groups holding 490 parts resolve to
   * 263 batches, 217 of them drawn. That is the whole reason a `wall_plaster_window` and a
   * `barrel_apples` standing in the same 128 m cell now cost one draw between them.
   */
  drawnBatches: number;
  /**
   * Draw calls this layer would submit if the WHOLE WORLD were inside the camera frustum, shadow
   * pass included.
   *
   * IT IS NOT COMPARABLE TO `renderer.info.render.calls` AND IT NEVER WAS, which is the whole
   * history of this field. `renderer.info.render.calls` is ONE FRAME of the WHOLE SCENE after
   * frustum and shadow-frustum culling — terrain chunks, scatter, buildings, water, sky and the UI
   * pass included. This is every entity in a 700x400 m world at once, this layer only, nothing
   * culled. Reading 970 here against a measured 432 there and calling it a 538-call overspend is
   * subtracting two different quantities, and no amount of work on this file will make the two
   * meet: the world is four times the size of any one frame of it.
   *
   * The gap is measured, not asserted. runs/corealm/audit/dcb-shots.ts reads both numbers out of
   * the same frame at seven poses. Before batching, at `hollowcut_seam`: this said 970, the
   * renderer said 432. After: 454-494 here against 226-287 there, i.e. this layer's world-wide
   * figure runs a little under twice the whole scene's on-screen figure, which is what you expect
   * when three quarters of the world is behind you or past the 210 m fog.
   *
   * NOTHING IS BUDGETED OFF THIS, and the claim that the animation budget was "deciding on
   * fiction" does not survive reading `canAffordUnique`: it spends `namedDrawCalls` and
   * `otherDrawCalls`, both incremented in `spend()` from `uniqueCostOf`, which counts real merged
   * mesh counts at the moment each character is built. This field is never read outside `stats()`.
   *
   * What it counts is the BATCH, not the part: `drawnBatches * 2 + uniqueMeshes * 2 + highlights *
   * 2`. Measured live on the shipped world at `town_entrance`: 255 groups holding 490 parts resolve
   * to 263 batches, 217 of them drawn, plus 2 unique characters at 20 draw calls -> 454, against
   * 970 for the same world when every part was its own `InstancedMesh`.
   *
   * It also used to over-count in a way that IS fixed: it charged for every `InstancedMesh` the
   * layer had allocated, including groups whose entities all took non-instanced rigs and spent or
   * walk variants nothing was in. Only variants with an occupied slot are charged now.
   */
  estimatedDrawCalls: number;
  /** Draw calls currently spent on the non-instanced character path, against its own budget. */
  uniqueDrawCalls: number;
  /** That total split by pool, because the two are budgeted separately. See `canAffordUnique`. */
  namedDrawCalls: number;
  otherDrawCalls: number;
  /** Unique views assembled from a base body plus layered parts rather than from one GLB. */
  dressedCharacters: number;
  /** Instance groups whose parts were baked from a dressed body-plus-parts assembly. */
  dressedGroups: number;
  /**
   * Distinct visual combinations across every character and creature currently drawn.
   *
   * The unit is what a player can actually tell apart: the part set (or asset plus tier), the
   * dye lots, and the build, all rounded the way they are drawn. Measured on the shipped world
   * this was 12 before this pass - 4 authored outfits plus two hair picks on the peasants, and 8
   * enemy (mesh, tier) pairs - against 63 entities. It is the number the brief's "a wider variety
   * of npc models / entities recolour" asks about, so it is reported rather than argued.
   */
  distinctLooks: number;
  /** Records currently drawn in their walk pose. */
  movingViews: number;
  triangles: number;
  missingAssets: string[];
  residency: EntityResidencyStats;
}

/** JSON-safe visual residency state. The semantic store remains outside this class. */
export interface EntityResidencyStats {
  tracked: number;
  eligible: number;
  selected: number;
  resident: number;
  pending: number;
  missing: number;
  failed: number;
  radius: number;
  structureRadius: number;
  actorRadius: number;
  fullResidency: boolean;
  residentIds: EntityId[];
  pendingIds: EntityId[];
  missingIds: EntityId[];
  failedIds: EntityId[];
  pendingAssets: string[];
  failedAssets: string[];
  missingAssets: string[];
}

export interface EntityRegionPreloadResult {
  regionId: RegionId;
  entities: number;
  assets: number;
  loaded: number;
  failedAssets: string[];
  missingAssets: string[];
  residency: EntityResidencyStats;
}

export type EntityMotionPath = "live-rig" | "sampled-rig" | "unique-static" | "baked" | "instanced-static";

/** JSON-safe renderer state for browser motion acceptance. Gameplay never reads this. */
export interface EntityMotionSnapshot {
  readonly terrainContact: ReturnType<typeof terrainRigSnapshot>;
  readonly hitOverlay: { clip: string; time: number; duration: number; weight: number; active: true; bones: readonly string[]; maskStatus: string } | null;
  readonly entityId: EntityId;
  readonly liveRig: boolean;
  readonly path: EntityMotionPath | null;
  readonly semanticPosition: Vec3;
  readonly drawnPosition: Vec3;
  /** Model-to-world scale along its forward stride, including authored build variation. */
  readonly drawnStrideScale: number;
  readonly semanticRotationY: number;
  readonly drawnRotationY: number;
  readonly facing: Vec3;
  readonly motion: CharacterMotion | null;
  readonly restingMotion: CharacterMotion | null;
  readonly clip: string | null;
  readonly time: number | null;
  readonly duration: number | null;
  readonly timeScale: number | null;
}

/**
 * The scene surface this renderer owns.
 *
 * `WorldScene` satisfies this interface, while focused render labs can supply two lightweight
 * groups without constructing terrain, scatter, water, or the rest of the production world.
 */
export interface EntityViewScene {
  meshHeightAt?(x: number, z: number): number;
  readonly entityGroup: THREE.Group;
  readonly overlayGroup: THREE.Group;
}

export interface EntityViewOptions {
  /**
   * THE cap that matters, expressed in the unit the budget is written in.
   *
   * A rigged character cannot be instanced — its pose lives in its skeleton — so every one of them
   * is a straight per-mesh cost, doubled because they cast. A fully dressed character is 10 skinned
   * meshes (stack-findings.md section 7) and the Phase 1 base NPCs are 3-4, so a cap counted in
   * ENTITIES is off by a factor of three depending on which asset happens to be nearby. Counting
   * draw calls instead makes the ceiling mean the same thing whatever the art is.
   *
   * Off-screen characters are frustum-culled to nothing, so this is a world-wide allowance rather
   * than a per-frame one; the per-frame cost is whatever subset is actually in shot.
   */
  maxUniqueDrawCalls?: number;
  /** Hard ceiling on unique objects regardless of cost, so a cheap asset cannot flood the scene. */
  maxUniqueViews?: number;
  /**
   * Mixers ticked per frame, nearest first. Separate from `maxUniqueViews` because a mixer costs
   * CPU every frame while a unique object only costs draw calls when it is on screen.
   */
  maxAnimatedViews?: number;
  /** Acquisition radius for full rigs. Farther actors continue through sampled skeletal poses. */
  animationRadius?: number;
  /** Ring radius floor, so a small node is still clickable-looking at 12 m. */
  minHighlightRadius?: number;
}

export class EntityViews {
  private readonly containedWaterOriginals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

  /** Explicit lab switch, default off. It changes only already-loaded native water-trough batches. */
  setContainedTroughWater(enabled: boolean) {
    for (const [mesh, original] of this.containedWaterOriginals) mesh.material = original;
    this.containedWaterOriginals.clear();
    const rows = [];
    for (const batch of this.batches.values()) {
      const owners = batch.owners.filter(owner => owner !== null);
      if (!owners.length || owners.some(owner => owner.group.assetId !== "corealm_water_trough")) continue;
      const source = batch.mesh.material as THREE.MeshPhysicalMaterial;
      if (!source.isMeshPhysicalMaterial || !source.name.startsWith("Corealm farm water")) continue;
      if (enabled) {
        this.containedWaterOriginals.set(batch.mesh, batch.mesh.material);
        batch.mesh.material = this.materials.containedTroughWater(source);
      }
      rows.push({ mesh: batch.mesh.name, geometry: batch.mesh.geometry.uuid,
        material: containedWaterMaterialSnapshot(batch.mesh.material as THREE.MeshPhysicalMaterial) });
    }
    return { enabled, meshes: rows };
  }

  /** Explicit immutable source whitelist for the transmission depth diagnostic. */
  staticOccluderMeshes(): { mesh: THREE.Mesh; revision: string; instanceIds: number[]; sourceInstanceIds: number[] }[] {
    const result: { mesh: THREE.Mesh; revision: string; instanceIds: number[]; sourceInstanceIds: number[] }[] = [];
    const matrix = new THREE.Matrix4();
    for (const batch of this.batches.values()) {
      const mesh = batch.mesh;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.some(material => material.transparent || !material.depthWrite
        || (material as THREE.MeshPhysicalMaterial).transmission > 0)) continue;
      const owners = batch.owners.flatMap((owner, instance) => owner && owner.group.assetId === "corealm_water_trough"
        && mesh.getVisibleAt(instance) ? [{ owner, instance }] : []);
      if (!owners.length) continue;
      const revision = owners.map(({ owner, instance }) => {
        mesh.getMatrixAt(instance, matrix);
        return `${instance}:${owner.group.slots[owner.slot]}:${matrix.elements.join(",")}`;
      }).join("|");
      const position = mesh.geometry.getAttribute("position");
      const version = "version" in position ? position.version : position.data.version;
      result.push({ mesh, revision: `${mesh.geometry.uuid}:${version}:${mesh.geometry.index?.version}|${revision}`,
        instanceIds: owners.map(owner => owner.instance), sourceInstanceIds: batch.owners.flatMap((owner, instance) => owner ? [instance] : []) });
    }
    return result;
  }

  /** Small public-API candidate list; shadow-casting materials retain ordinary rendering. */
  transmissiveMeshes(): THREE.Mesh[] {
    return [...this.batches.values()].map(batch => batch.mesh).filter(mesh => !mesh.castShadow
      && (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        .some(material => (material as THREE.MeshPhysicalMaterial).transmission > 0));
  }

  private readonly activeSet = new EntityActiveSet();
  private readonly groups = new Map<string, InstanceGroup>();
  private readonly records = new Map<EntityId, ViewRecord>();
  /** Live semantic references for resident movers, refreshed with structural residency. */
  private readonly residentMovingEntities: SemanticEntity[] = [];
  private readonly locomotionIntents = new Map<EntityId, "idle" | "walk" | "run">();
  /** Non-null only while the documentation pipeline renders one semantic entity in isolation. */
  private captureSubjectId: EntityId | null = null;
  private hiddenRoofs = new Set<EntityId>();
  private readonly highlights = new Map<EntityId, THREE.Object3D>();
  /** Every `BatchedMesh` this layer draws through, keyed by material identity. See `Batch`. */
  private readonly batches = new Map<string, Batch>();
  private readonly batchOwners = new WeakMap<THREE.BatchedMesh, Batch>();
  private readonly missing = new Set<string>();
  private readonly group = new THREE.Group();
  private readonly highlightGroup = new THREE.Group();
  private readonly pickCapsuleBase = new THREE.Vector3();
  private readonly pickCapsuleTop = new THREE.Vector3();
  private readonly pickRayPoint = new THREE.Vector3();
  private readonly pickCapsulePoint = new THREE.Vector3();

  /**
   * The ORIGINAL loaded scene graph per asset id, not a clone.
   *
   * `AssetRegistry.instance()` hands out `source.clone(true)`, and `Object3D.clone` copies a
   * SkinnedMesh's `skeleton` BY REFERENCE — every plain clone deforms with the original's bones,
   * so animating one animates none of them. `SkeletonUtils.clone` fixes that, but only when it is
   * handed the true original, which is why this map exists.
   */
  private readonly sources = new Map<string, THREE.Object3D>();
  private readonly sourceRequests = new Set<string>();
  private readonly sourceLoads = new Map<string, Promise<THREE.Object3D | null>>();
  private readonly failedSources = new Map<string, { attempts: number; retryAtMs: number }>();
  private sourcesChanged = false;

  private readonly riggedAssets = new Map<string, boolean>();
  /** `(assetKey, archetype)` -> does tier belong in the group key. See `groupTier`. */
  private readonly tierKeyed = new Map<string, boolean>();
  /** Asset id -> whether one of its source materials belongs to the architecture palette. */
  private readonly architectureAssets = new Map<string, boolean>();
  private readonly seamGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly workedOreGeometries = new Map<
    string,
    { scar: THREE.BufferGeometry; dust: THREE.BufferGeometry; fragments: THREE.BufferGeometry }
  >();
  private readonly fishingGeometries = new Map<
    string,
    { ripple: THREE.BufferGeometry; bubbles: THREE.BufferGeometry }
  >();
  private readonly campfireRockGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly resourceMaterials = new Map<string, THREE.MeshStandardMaterial>();
  /** One translucent underwater treatment per authored fish material, shared by every school. */
  private readonly submergedFishMaterials = new Map<THREE.Material, THREE.Material>();
  /** Only fishing nodes need generated motion, so the render tick never walks every resource. */
  private readonly fishingViews = new Set<ViewRecord>();
  private resourceTimeSeconds = 0;
  /** Element/state clones owned here; their albedo maps remain shared with the imported GLB. */
  private readonly essenceMaterials = new Map<string, THREE.MeshStandardMaterial>();
  /** Sparse under-top rails and emblem rings added to the awakened altar mesh. */
  private readonly essenceAltarDetailMaterials = new Map<EssenceElement, THREE.MeshStandardMaterial>();
  private essenceAltarLineGeometry: THREE.BufferGeometry | null = null;
  private essenceAltarCircleGeometry: THREE.BufferGeometry | null = null;
  /** One browser-loaded mask shared by every elemental material variant. */
  private readonly essenceVeinsMask = loadEssenceVeinsMask();
  /** A purpose-built sparse sigil for the altar, separate from the rocks' fracture pattern. */
  private readonly essenceAltarLinesMask = loadEssenceAltarLinesMask();
  /** Per-entity dye clones for the non-instanced path, keyed (source material, tint hex). */
  private readonly tintedMaterials = new Map<string, THREE.Material>();
  private readonly bakedGeometries: THREE.BufferGeometry[] = [];
  /** Rigged records with a mixer. Kept as its own set so `update` never walks 600 ore nodes. */
  private readonly animated = new Set<ViewRecord>();
  /**
   * Records carrying a death instant, so the per-frame fade never sweeps the whole world.
   *
   * NOT the same set as `animated`: a corpse leaves that one the moment its death clip clamps, and
   * dissolving it is precisely the work that has to happen afterwards.
   */
  private readonly fading = new Set<ViewRecord>();
  private readonly animationOrder: ViewRecord[] = [];
  private animatedLastFrame = 0;
  /** Monotonic per-rig tick counter. Only ever compared, so wrapping is not a concern in practice. */
  private animationTickSequence = 0;
  /** Meshes per rigged asset, so the budget can be checked BEFORE paying for a skeleton clone. */
  private readonly meshCounts = new Map<string, number>();
  /**
   * Draw calls a fully assembled dressed character costs, keyed by `CharacterSpec.key`.
   *
   * Filled in by `bakedParts`, which assembles every character spec once while building its
   * instance group — and `ensureGroup` always runs before the unique decision in `acquire`, so by
   * the time the budget is checked the true merged cost is known rather than estimated.
   */
  private readonly characterCosts = new Map<string, number>();
  /** Resolved character specs, keyed by (entity, assetId, authored parts). See `characterFor`. */
  private readonly characterSpecs = new Map<string, CharacterSpec | null>();
  private readonly missingHitClips = new Map<string, THREE.AnimationClip | null>();
  private readonly hitOverlayClips = new Map<string, ReturnType<typeof createMaskedHitOverlay>>();
  private uniqueDrawCalls = 0;
  private namedDrawCalls = 0;
  private otherDrawCalls = 0;
  /** Records currently holding a non-instanced object. See `countUnique`. */
  private uniqueViewCount = 0;

  private readonly maxUniqueDrawCalls: number;
  private readonly maxUniqueViews: number;
  private readonly maxAnimatedViews: number;
  private readonly animationRadiusSq: number;
  private readonly uniqueReleaseRadiusSq: number;
  private readonly minHighlightRadius: number;
  /**
   * Last camera position `update` was given, or null before the first frame.
   *
   * The unique/rig pools are allocated against this. Null means "nobody has told us where the
   * camera is", and the pools then behave exactly as they did before — first-come — which is what
   * the very first `sync` (boot runs one before the loop starts) needs.
   */
  private viewer: THREE.Vector3 | null = null;
  /** Records whose asset is skinned, instanced or not. Kept apart so the rebalance is ~60 rows. */
  private readonly rigCandidates = new Set<ViewRecord>();
  private ringGeometry: THREE.BufferGeometry | null = null;
  private resourceRingGeometry: THREE.BufferGeometry | null = null;
  private pipGeometry: THREE.BufferGeometry | null = null;
  private readonly resourceHighlightMaterials = new Map<THREE.Material, THREE.MeshBasicMaterial>();
  private readonly treeContactRadii = new WeakMap<readonly SourcePart[], number>();

  constructor(
    private readonly scene: EntityViewScene,
    private readonly assets: AssetRegistry,
    private readonly materials: MaterialLibrary,
    options: EntityViewOptions = {},
  ) {
    this.maxUniqueDrawCalls = options.maxUniqueDrawCalls ?? 96;
    this.maxUniqueViews = options.maxUniqueViews ?? 24;
    this.maxAnimatedViews = options.maxAnimatedViews ?? 10;
    const animationRadius = options.animationRadius ?? 40;
    this.animationRadiusSq = animationRadius ** 2;
    this.uniqueReleaseRadiusSq = (animationRadius * UNIQUE_RELEASE_FACTOR) ** 2;
    this.minHighlightRadius = options.minHighlightRadius ?? 0.9;
    this.group.name = "entity-views";
    this.highlightGroup.name = "entity-highlights";
    this.scene.entityGroup.add(this.group);
    this.scene.overlayGroup.add(this.highlightGroup);
  }

  // ------------------------------------------------------------- loading

  /**
   * Loads every GLB the given entities reference. Call once after the world layer has built its
   * entities and before the first `sync`. Without it, `sync` queues missing assets and leaves those
   * visual rows pending until the requests finish.
   *
   * Calling this is OPTIONAL — `sync` requests any source it is missing and upgrades the affected
   * entities on the next pass — but calling it means characters are rigged on their very first
   * frame instead of a quarter of a second later.
   */
  async prepare(entities: readonly SemanticEntity[]): Promise<{ loaded: number; missing: string[] }> {
    const ids = this.assetIdsFor(entities);
    await this.hydrateAssets(ids, true, { priority: "visible-spawn", primary: true });
    return {
      loaded: ids.filter((id) => this.sources.has(id) || this.assets.isLoaded(id)).length,
      missing: ids.filter((id) => this.missing.has(id) || this.failedSources.has(id)),
    };
  }

  /**
   * Grabs the true source graph for an asset, kicking off the (already-resolved) registry load the
   * first time it is asked for. Returns null until that microtask lands; callers degrade to the
   * static path and `sync` retries them once `sourcesChanged` flips.
   */
  private sourceOf(id: string): THREE.Object3D | null {
    const cached = this.sources.get(id);
    if (cached) return cached;
    return this.requestSource(id);
  }

  /** Moves and resizes the visual working set without changing the semantic store. */
  updateActiveArea(
    position: Vec3 | THREE.Vector3,
    radius: number,
    structureRadius = radius,
  ): EntityResidencyStats {
    this.activeSet.setArea(vec3Of(position), radius, structureRadius);
    this.reconcileActiveSet();
    return this.residencyStats();
  }

  /** Moves the visual working set while keeping its current radius. */
  updateActivePosition(position: Vec3 | THREE.Vector3): EntityResidencyStats {
    this.activeSet.setPosition(vec3Of(position));
    this.reconcileActiveSet();
    return this.residencyStats();
  }

  /** Changes the actor/resource radius while static architecture keeps its draw-distance radius. */
  updateActiveRadius(radius: number): EntityResidencyStats {
    this.activeSet.setDynamicRadius(radius);
    this.reconcileActiveSet();
    return this.residencyStats();
  }

  /** Keeps static architecture resident through the selected camera draw distance. */
  updateStructureRadius(radius: number): EntityResidencyStats {
    this.activeSet.setStructureRadius(radius);
    this.reconcileActiveSet();
    return this.residencyStats();
  }

  updateActorRadius(radius: number): EntityResidencyStats {
    this.activeSet.setActorRadius(radius);
    this.reconcileActiveSet();
    return this.residencyStats();
  }

  /**
   * Loads a semantic region's visual assets without selecting its entities or allocating meshes.
   * Region rectangles remain gameplay ownership only; normal residency is still an XZ radius.
   */
  async preloadRegion(regionId: RegionId): Promise<EntityRegionPreloadResult> {
    const entities = this.activeSet.forRegion(regionId);
    const ids = this.assetIdsFor(entities);
    await this.hydrateAssets(ids, true, { priority: "travel-prefetch", regionId });
    this.reconcileActiveSet();
    return {
      regionId,
      entities: entities.length,
      assets: ids.length,
      loaded: ids.filter((id) => this.sources.has(id) || this.assets.isLoaded(id)).length,
      failedAssets: ids.filter((id) => this.failedSources.has(id)),
      missingAssets: ids.filter((id) => this.missing.has(id)),
      residency: this.residencyStats(),
    };
  }

  /** Full-island residency for deterministic map capture. Passing false restores the active area. */
  async forceFullResidency(enabled = true): Promise<EntityResidencyStats> {
    this.activeSet.setFullResidency(enabled);
    if (enabled) {
      await this.hydrateAssets(
        this.assetIdsFor(this.activeSet.selected()),
        true,
        { priority: "background" },
      );
    }
    this.reconcileActiveSet();
    return this.residencyStats();
  }

  /** Retries every selected asset that has not loaded, then reconciles records before resolving. */
  async retryHydration(): Promise<EntityResidencyStats> {
    await this.hydrateAssets(
      this.assetIdsFor(this.activeSet.selected()),
      true,
      { priority: "visible-spawn", primary: true },
    );
    this.reconcileActiveSet();
    return this.residencyStats();
  }

  residencyStats(): EntityResidencyStats {
    const activeStats = this.activeSet.stats();
    const selected = this.activeSet.selected();
    const residentIds: EntityId[] = [];
    const pendingIds: EntityId[] = [];
    const missingIds: EntityId[] = [];
    const failedIds: EntityId[] = [];

    for (const entity of selected) {
      if (this.records.has(entity.id)) {
        residentIds.push(entity.id);
        continue;
      }
      const ids = this.assetIdsForEntity(entity);
      if (this.missing.has(entity.view!.assetId)) missingIds.push(entity.id);
      else pendingIds.push(entity.id);
      if (ids.some((id) => this.failedSources.has(id))) failedIds.push(entity.id);
    }

    const assets = this.assetIdsFor(selected);
    return {
      tracked: activeStats.tracked,
      eligible: activeStats.eligible,
      selected: activeStats.selected,
      resident: residentIds.length,
      pending: pendingIds.length,
      missing: missingIds.length,
      failed: failedIds.length,
      radius: activeStats.radius,
      structureRadius: activeStats.structureRadius,
      actorRadius: activeStats.actorRadius,
      fullResidency: activeStats.fullResidency,
      residentIds,
      pendingIds,
      missingIds,
      failedIds,
      pendingAssets: assets.filter((id) => !this.assets.isLoaded(id) && !this.missing.has(id)),
      failedAssets: assets.filter((id) => this.failedSources.has(id)),
      missingAssets: assets.filter((id) => this.missing.has(id)),
    };
  }

  /** Resource/scatter handoffs need record readiness, independent of camera visibility. */
  hasView(entityId: EntityId): boolean {
    return this.records.has(entityId);
  }

  // ---------------------------------------------------------------- sync

  /**
   * Reconciles the drawn world with the semantic world.
   *
   * Cheap by design: an entity whose position, state, tier and asset are unchanged costs one string
   * comparison. Entities that vanished from the list release their slot; new ones take one.
   */
  sync(entities: readonly SemanticEntity[]): void {
    this.activeSet.replace(entities);
    // Residency and rig demotion may discard a drawn record while its semantic actor still
    // exists. Only removal from the authoritative snapshot ends its explicit motion intent.
    for (const entityId of this.locomotionIntents.keys()) {
      if (!this.activeSet.has(entityId)) this.locomotionIntents.delete(entityId);
    }
    this.reconcileActiveSet();
  }

  private reconcileActiveSet(): void {
    if (this.sourcesChanged) {
      this.sourcesChanged = false;
      this.dropUnposed();
    }

    const seen = new Set<EntityId>();
    this.residentMovingEntities.length = 0;

    for (const entity of this.activeSet.selected()) {
      seen.add(entity.id);
      this.syncOne(entity);
      // Refresh even when syncOne's signature is unchanged: a save restore or semantic rebuild
      // can replace the object behind the same id without changing its current drawn transform.
      if (this.records.has(entity.id) && MOVING_ARCHETYPES.has(entity.archetype)) {
        this.residentMovingEntities.push(entity);
      }
    }

    for (const [entityId, record] of this.records) {
      if (seen.has(entityId)) continue;
      this.release(record);
      this.records.delete(entityId);
      this.clearHighlight(entityId);
    }
  }

  /**
   * Per-frame tick. The root calls this from the render frame:
   *
   *   entityViews.update(deltaSeconds, renderer.camera.position);
   *
   * `sync` is NOT this — it runs a few times a second and diffs semantics. Animation needs real
   * wall-clock delta every frame, which is why it is a separate entry point.
   *
   * Each resident actor advances its own playback clock. Near actors evaluate a full skeleton;
   * other actors interpolate a sampled skeletal palette. The viewer ranks full-rig evaluations
   * and never decides whether a visible actor's animation clock runs.
   */
  update(deltaSeconds: number, viewer?: THREE.Vector3, nowMs?: number): void {
    this.animatedLastFrame = 0;
    if (viewer) {
      this.viewer = (this.viewer ?? new THREE.Vector3()).copy(viewer);
      // Before the tick, not after: a character promoted this frame should be ticked this frame,
      // or it renders one frame of its baked pose at the exact moment the player walks up to it.
      // Capture isolation freezes the pool after focusEntity promoted the subject. Rebalancing
      // while the shot is held could create a newly visible unique character behind it.
      if (this.captureSubjectId === null) this.rebalanceUniques();
    }
    // Unconditional, and deliberately: a corpse is dropped OUT of `animated` the moment its death
    // clip clamps, so a fade gated on there being live rigs would never run on the one thing it
    // exists for. Fishing views below are ticked on the same terms.
    if (nowMs !== undefined) this.tickCorpseFade(nowMs);

    // A backgrounded tab hands back a delta of seconds. Fast-forwarding a crowd through 40 loops
    // of an idle clip costs real time and looks identical to not doing it.
    const delta = Math.min(Math.max(deltaSeconds, 0), 0.25);

    this.resourceTimeSeconds += delta;
    for (const record of this.fishingViews) {
      if (this.captureSubjectId !== null && record.entityId !== this.captureSubjectId) continue;
      if (record.unique || record.slot < 0) continue;
      const group = this.groups.get(record.groupKey);
      if (group) this.writeSlot(group, record);
    }

    // Every resident actor has a running clock, including actors outside the full-rig radius.
    // Only pose evaluation is budgeted; elapsed time never depends on representation or distance.
    for (const record of this.rigCandidates) {
      if (this.captureSubjectId !== null && record.entityId !== this.captureSubjectId) continue;
      const state = record.playback;
      if (!state || record.fade >= 1) continue;
      const finished = advanceCreaturePlayback(state, delta);
      if (finished && ONE_SHOT_MOTIONS.has(record.motion)) this.setMotion(record, record.resting);
      if (record.unique) {
        if (record.motion === "death" && finished) {
          this.sampleRig(record);
          this.animated.delete(record);
        }
      } else {
        const group = this.groups.get(record.groupKey);
        if (group) this.writeSlot(group, record);
      }
    }
    if (this.animated.size === 0) return;

    // Reused rather than rebuilt: this runs every frame, and a fresh array per frame is garbage
    // the collector has to walk during exactly the frames that are already the most expensive.
    //
    // Rigs inside release hysteresis remain candidates. Actors beyond it already draw their
    // interpolated palette, so neither representation contains a distance-based frozen band.
    const ranked = this.animationOrder;
    ranked.length = 0;
    for (const record of this.animated) {
      // Retained rigs remain animated throughout release hysteresis. Far instances use the
      // same playback clock through the palette shader instead of freezing.
      // Owed time accrues for every candidate, whether or not the budget reaches it this frame.
      // Clamped for the same reason `delta` is: a rig that has been out of range for a minute must
      // not fast-forward a minute of animation the instant it comes back.
      record.pendingDelta = Math.min(record.pendingDelta + delta, MAX_PENDING_ANIMATION_SECONDS);
      ranked.push(record);
    }

    // THE BUDGET ROTATES. Sorting by distance alone and stopping at the cap meant the same nearest
    // ten won every single frame, so an eleventh rig never advanced a keyframe for as long as it
    // stayed eleventh. Measured in the Gravelmaw, where 17 creatures stand within 40 m: ten
    // animated and five stood frozen mid-stride while sliding toward the player at 14 to 27 m.
    // That is the "creatures do not walk smoothly" report, and it is invisible in the feature lab
    // because the lab spawns ONE creature and one is always under the cap.
    //
    // The policy itself is `orderAnimationBudget`, which is a pure function so it can be tested
    // without a scene. Two earlier versions of it degenerated back into this bug on a slow machine
    // and neither failure was visible without measuring a live crowd; `tests/animationBudget.test.ts`
    // now covers both.
    orderAnimationBudget(ranked, this.maxAnimatedViews, viewer);

    for (const record of ranked) {
      if (this.animatedLastFrame >= this.maxAnimatedViews) break;
      this.sampleRig(record);
      record.pendingDelta = 0;
      // Incremented PER RIG rather than per frame, so no two rigs ever share a value and
      // least-recently-ticked is a strict total order. Sharing a per-frame number leaves ties, and
      // a stable sort settles ties by array position — which is distance order, so the same
      // nearer-but-still-contested rigs won every tie and refreshed twice as often as the rest.
      record.lastTickedFrame = this.animationTickSequence += 1;
      this.animatedLastFrame += 1;
    }
  }

  /**
   * Position-and-facing refresh for the archetypes that move, cheap enough to call every frame.
   *
   * CORRECTION: this said "OPT-IN and currently uncalled". `app/loop.ts:381` now calls it every
   * render frame with `this.renderAlpha`, and that is what the numbers below are measured against.
   * `sync` runs at 4 Hz (loop.ts:266 returns early until 250 ms have passed) while
   * `EnemyAI.stepToward` writes a position every 100 ms sim tick, so three of every four enemy
   * movement steps used to be invisible and the fourth a 40 cm jump. A moving entity is now drawn
   * between the last two ticks instead of at the last one.
   *
   * Structure — asset, tier, state, add and remove — is still `sync`'s job at whatever cadence the
   * loop likes. This only moves things that already exist, so calling it is always safe and never
   * allocates a group.
   *
   * `alpha` is clamped to 0..1. Passing 1 (the default) is "no interpolation, just the current
   * position at full rate", which on its own already removes three quarters of the stepping.
   */
  syncMotion(entities: readonly SemanticEntity[], alpha = 1): void {
    if (this.records.size === 0) return;
    const blend = Math.min(1, Math.max(0, alpha));

    for (const entity of entities) {
      if (!MOVING_ARCHETYPES.has(entity.archetype)) continue;
      if (this.captureSubjectId !== null && entity.id !== this.captureSubjectId) continue;
      const record = this.records.get(entity.id);
      if (!record) continue;
      // A corpse that has finished dissolving is off screen and going nowhere. Interpolating and
      // re-writing its slot sixty times a second would only re-hide something already hidden.
      if (record.fade >= 1) continue;

      const view = entity.view;
      // Refreshed here rather than in `sync`, because `sync` runs at 4 Hz and this runs every
      // render frame: a creature that started chasing has to change gait on the frame it starts,
      // not up to a quarter of a second later.
      record.pursuing = isPursuing(entity);
      if (view?.gaitSpeedMps !== undefined) record.gaitSpeedMps = view.gaitSpeedMps;
      const rotationY = view?.rotationY ?? record.targetRotationY;
      const dx = entity.position[0] - record.target.x;
      const dz = entity.position[2] - record.target.z;
      const tickRolled = crossedSimTick(blend, record.lastAlpha);
      record.lastAlpha = blend;
      const moved = Math.hypot(dx, dz) > MOVING_EPSILON;
      const structuralStep = record.motionTargetPending;
      record.motionTargetPending = false;
      if (moved || structuralStep) {
        // syncOne already retained the previous target for a structural step. Copying its new
        // target again would erase the interpolation span and falsely settle the gait this tick.
        if (moved) record.previous.copy(record.target);
        record.target.set(entity.position[0], entity.position[1], entity.position[2]);
        record.settledTicks = 0;
        // Re-arm the hold here too. Without it, calling this every frame consumes the position
        // change before `sync` ever sees one, `updateMoving` decays the counter to zero, and the
        // walking pose could never latch for anything.
        record.movingTicks = MOVING_HOLD_SYNCS;
        // Structural sync runs at 4 Hz. Waiting for it to select the walking clip leaves up to a
        // quarter-second of a chasing enemy gliding in its idle pose. `interruptOneShot` is FALSE:
        // an attack or flinch in flight finishes before the gait resumes — the attack is the read,
        // and cutting it for a step is how swings became invisible.
        if (!record.spent) this.setMotion(record, record.pursuing ? "run" : "walk", false);
      } else if (tickRolled) {
        // SETTLE. Nothing else ever collapses this span, and without it a stopped entity jitters
        // forever: `previous` keeps the second-to-last position, `target` the last, and the lerp
        // below sweeps between them every frame as alpha sawtooths. Measured on a dead goat, whose
        // simulated position had not changed in seconds, the drawn position oscillated 10 cm at
        // frame rate; a chasing enemy stops after a 0.31 m step and swings over all of it.
        //
        // The condition is "a whole sim tick passed with no new position", not "dx is zero". dx is
        // zero on every frame after the first WITHIN a tick, and that is exactly when the lerp is
        // doing its job, so collapsing there would delete interpolation and make everything step.
        record.previous.copy(record.target);
        // The gait ends WITH the movement, not half a second after it. Zeroing `movingTicks`
        // keeps the 4 Hz structural path agreeing, or its stale hold would flip the walk back on
        // at the next sync. One-shots are not interrupted: `setMotion`'s own guard holds a swing
        // that is still running, so an enemy arriving at standoff goes run -> idle -> bite.
        record.settledTicks = Math.min(record.settledTicks + 1, SETTLED_TICKS_TO_IDLE + 1);
        if (record.settledTicks === SETTLED_TICKS_TO_IDLE && !record.spent) {
          record.movingTicks = 0;
          this.setMotion(record, "idle", false);
        }
      }
      if (rotationY !== record.targetRotationY) {
        record.previousRotationY = record.targetRotationY;
        record.targetRotationY = rotationY;
      } else if (tickRolled && !record.rotationTargetPending) {
        // SETTLE, exactly as the position span above and for the same reason. `systems/enemyAI.ts`
        // writes `view.rotationY = atan2(...)` while an enemy is turning, and when it stops the two
        // ends of this span stay a step apart while `blend` keeps sawtoothing 0 to 1, so the yaw
        // rocks back and forth at frame rate forever. It is worse than the position case: a facing
        // that swings as an enemy passes the player can leave half a turn inside the span, and
        // `shortestArc` then sweeps all of it every tick, which is the spinning.
        record.previousRotationY = record.targetRotationY;
      }
      record.rotationTargetPending = false;

      record.position.lerpVectors(record.previous, record.target, blend);
      if (this.scene.meshHeightAt) {
        record.position.y = interpolatedGroundHeight(record.previous.toArray(), record.target.toArray(),
          record.position.toArray(), (x, z) => this.scene.meshHeightAt!(x, z));
      }
      record.rotationY = shortestArc(record.previousRotationY, record.targetRotationY, blend);

      if (record.unique) {
        this.placeUnique(record);
        continue;
      }
      const group = this.groups.get(record.groupKey);
      if (!group) continue;
      this.writeSlot(group, record);
    }
  }

  /**
   * Updates resident movers without collecting or scanning the semantic world each frame.
   * References follow the latest structural sync and residency selection; in-place simulation
   * position and facing changes remain visible between those syncs. This does not advance clocks.
   */
  syncResidentMotion(alpha = 1): void {
    this.syncMotion(this.residentMovingEntities, alpha);
  }

  /** Existing resident references for bounded actor effects; callers must not mutate the list. */
  residentActors(): readonly SemanticEntity[] { return this.residentMovingEntities; }

  /**
   * Shows one real entity view against the world surface while hiding every other semantic view.
   * Locations pass null and get the complete world back. This works for unique rigs and batched
   * props alike, so guide captures never need a second model-loading or rendering path.
   */
  setCaptureSubject(entityId: EntityId | null): void {
    if (this.captureSubjectId === entityId) return;
    const previous = this.captureSubjectId;
    this.captureSubjectId = entityId;
    this.activeSet.pin(entityId);
    this.reconcileActiveSet();
    this.highlightGroup.visible = entityId === null;

    // Once isolation is active, the whole world is already hidden. Swapping portraits should
    // touch two records, not restore and hide thousands of batched parts between every frame.
    if (previous !== null && entityId !== null) {
      const previousRecord = this.records.get(previous);
      if (previousRecord) this.setCaptureRecordVisible(previousRecord, false);
      const nextRecord = this.records.get(entityId);
      if (nextRecord) this.setCaptureRecordVisible(nextRecord, true);
      return;
    }

    for (const record of this.records.values()) {
      const visible = entityId === null || record.entityId === entityId;
      this.setCaptureRecordVisible(record, visible);
    }
  }

  /** Update individual roof instances, never shared material visibility. */
  setHiddenRoofs(ids: ReadonlySet<EntityId>): void {
    const changed = new Set([...this.hiddenRoofs, ...ids]);
    const previous = this.hiddenRoofs;
    this.hiddenRoofs = new Set(ids);
    for (const id of changed) {
      if (previous.has(id) === ids.has(id)) continue;
      const record = this.records.get(id);
      if (record) this.setCaptureRecordVisible(record,
        !ids.has(id) && (this.captureSubjectId === null || this.captureSubjectId === id));
    }
  }

  private setCaptureRecordVisible(record: ViewRecord, visible: boolean): void {
    visible = visible && !this.hiddenRoofs.has(record.entityId);
    if (record.unique) {
      record.unique.visible = visible;
      return;
    }
    const group = this.groups.get(record.groupKey);
    if (!group || record.slot < 0) return;
    if (visible) {
      this.writeSlot(group, record);
      return;
    }
    group.animationLod?.hide(record.slot);
    for (const draw of group.live) hideInstance(draw, record.slot);
    for (const draw of group.spent) hideInstance(draw, record.slot);
    for (const draw of group.moving) hideInstance(draw, record.slot);
  }

  private syncOne(entity: SemanticEntity): void {
    const view = entity.view!;
    let assetsReady = true;
    for (const assetId of this.assetIdsForEntity(entity)) {
      if (this.missing.has(assetId)) continue;
      if (!this.assets.isLoaded(assetId)) assetsReady = false;
      this.requestSource(assetId, false, {
        priority: "visible-spawn",
        regionId: entity.regionId,
        primary: assetId === view.assetId,
      });
    }
    if (this.missing.has(view.assetId) || !assetsReady) {
      // A semantic view may change asset while its replacement is in flight. Keeping the old record
      // would turn a transient fallback into a stale mesh that can survive until the next state edit.
      const stale = this.records.get(entity.id);
      if (stale) {
        this.release(stale);
        this.records.delete(entity.id);
        this.clearHighlight(entity.id);
      }
      return;
    }

    const tier = view.materialTier ?? entity.tier;
    const clip = view.clipFraction ?? 0;
    const character = this.characterFor(entity.id, entity.archetype, view.assetId, view.partAssetIds);
    const regionId = this.architectureRegion(entity.archetype, entity.regionId, view.assetId);
    const campfire = entity.station?.kind === "campfire";
    const authoredWaterOffset = entity.meta?.waterOffset;
    const waterOffset = typeof authoredWaterOffset === "number" ? authoredWaterOffset : 0;
    const essenceElement = essenceElementFor(entity);
    // Element is material identity, not instance colour. Keeping it in the group key prevents an
    // air cache and a water cache that share one rock asset from ever sharing the wrong parts.
    const groupKey = `${character?.key ?? view.assetId}|${view.depletedAssetId ?? "-"}|${this.groupTier(entity.archetype, tier, view.assetId, character)}|${regionId ?? "-"}|${entity.archetype}|essence:${essenceElement ?? "-"}|${clip}|${campfire ? "fire" : "-"}|${batchCell(entity.archetype, entity.position)}`;
    // Dormant altar complexes retain a quiet elemental hue but use the non-emissive material set.
    // Awakening changes the same semantic entities to the fully lit material identity.
    const spent = SPENT_STATES.has(entity.state)
      || (essenceElement !== null && entity.state === "dormant");
    const silhouette = TIERED_ARCHETYPES.has(entity.archetype) ? tierSilhouetteScale(tier) : 1;
    const scale = (view.scale ?? 1) * silhouette;
    const scaleAxes = view.scaleAxes ?? NO_BUILD;
    const rotationY = view.rotationY ?? 0;
    const normal = view.groundNormal ?? null;
    // A fishing proxy sits on solved water. Tilting it toward terrain below the pool would cant
    // the surface ripple and turn the authored water offset into a diagonal displacement.
    const tilt = entity.archetype === "fishing_spot"
      ? 0
      : normal ? (view.tiltStrength ?? DEFAULT_TILT[entity.archetype] ?? 0) : 0;

    // Movement has to be decided BEFORE the signature, because it is part of it: an enemy that
    // stops walking stops changing position, so a signature built from position alone would never
    // notice the stop and the walk pose would stick forever.
    const moving = this.updateMoving(entity);
    const signature = `${groupKey}|${spent ? 1 : 0}|${moving ? 1 : 0}|${round(entity.position[0])},${round(entity.position[1])},${round(entity.position[2])}|${round(rotationY)}|${round(scale)}|${scaleAxes.map(round).join(",")}|${round(waterOffset)}|${tiltKey(normal, tilt)}`;

    let existing = this.records.get(entity.id);

    // A rigged entity built before its skeleton arrived is holding a baked idle frame. Upgrade it
    // the moment the source is available, per entity, rather than waiting for the global
    // `sourcesChanged` sweep in `sync`: that sweep only fires when some OTHER asset finishes
    // loading, and anything that was not in the entity list on that exact pass never got a second
    // look. Ordrun is in the dungeon, the dungeon is not in the list until the player is inside
    // it, and so the boss of the game stood through a two-phase fight in bind-adjacent pose.
    if (existing?.awaitingRig && this.characterReady(view.assetId, character)) {
      this.release(existing);
      this.records.delete(entity.id);
      existing = undefined;
    }

    if (existing && existing.signature === signature) return;

    if (existing && existing.groupKey !== groupKey) {
      this.release(existing);
      this.records.delete(entity.id);
    }

    const record = this.records.get(entity.id)
      ?? this.acquire(entity, groupKey, tier, clip, character, regionId, essenceElement);
    if (!record) return;

    record.signature = signature;
    record.target.set(entity.position[0], entity.position[1], entity.position[2]);
    record.position.copy(record.target);
    if (rotationY !== record.targetRotationY) {
      record.previousRotationY = record.targetRotationY;
      record.rotationTargetPending = MOVING_ARCHETYPES.has(entity.archetype);
    }
    record.targetRotationY = rotationY;
    record.rotationY = rotationY;
    record.scale = scale;
    record.scaleAxes = scaleAxes;
    record.waterOffset = waterOffset;
    record.spent = spent;
    this.setDiedAt(record, view.diedAtMs ?? null);
    record.normal = normal;
    record.tilt = tilt;
    record.labelHeight = view.labelHeight ?? 1.6;
    record.trunkRadius = typeof entity.meta?.trunkRadius === "number"
      && Number.isFinite(entity.meta.trunkRadius) && entity.meta.trunkRadius > 0
      ? entity.meta.trunkRadius : null;
    record.radius = Math.max(
      this.minHighlightRadius,
      this.assetRadius(view.assetId) * scale * record.build[0] * Math.max(...scaleAxes),
    );
    record.pickable = !(isInspectOnly(entity) && record.radius > MAX_INSPECT_ONLY_PICK_RADIUS);

    const group = this.groups.get(groupKey);
    if (!group) return;

    this.setMotion(record, spent ? "death" : moving ? gaitFor(record) : "idle");

    if (record.unique) {
      this.placeUnique(record);
      this.applyUniqueState(record, tier);
    } else {
      this.writeSlot(group, record);
    }

    const highlight = this.highlights.get(entity.id);
    if (highlight) this.placeHighlight(highlight, record);
  }

  /**
   * Tracks whether an entity moved since the last sync, with hysteresis.
   *
   * Only `MOVING_ARCHETYPES` are tracked. Everything else in the world is placed once at boot and
   * never moves again, and paying a vector compare per ore node per sync buys nothing.
   */
  private updateMoving(entity: SemanticEntity): boolean {
    if (!MOVING_ARCHETYPES.has(entity.archetype)) return false;
    const record = this.records.get(entity.id);
    if (!record) return false;
    const dx = entity.position[0] - record.target.x;
    const dz = entity.position[2] - record.target.z;
    if (Math.hypot(dx, dz) > MOVING_EPSILON) {
      record.previous.copy(record.target);
      record.motionTargetPending = true;
      record.movingTicks = MOVING_HOLD_SYNCS;
    } else if (record.movingTicks > 0) {
      record.movingTicks -= 1;
    }
    return record.movingTicks > 0;
  }

  private acquire(
    entity: SemanticEntity,
    groupKey: string,
    tier: number,
    clip: number,
    character: CharacterSpec | null,
    regionId: RegionId | null,
    essenceElement: EssenceElement | null,
  ): ViewRecord | null {
    const view = entity.view!;
    const group = this.ensureGroup(
      groupKey, view.assetId, view.depletedAssetId ?? null, entity.archetype, tier,
      batchCell(entity.archetype, entity.position), clip, character, regionId,
      entity.station?.kind === "campfire",
      essenceElement,
    );
    if (!group) return null;

    // Rigged characters cannot be instanced with a live pose (their pose lives in the skeleton), so
    // a capped number of them get their own object and a mixer. The rest fall back to an instance
    // of the baked idle pose, which is cheap and — unlike bind pose — looks like a person.
    const rigged = group.liveParts.length === 0 || this.isRigged(view.assetId);
    const ready = rigged && this.characterReady(view.assetId, character);

    const record: ViewRecord = {
      entityId: entity.id,
      archetype: entity.archetype,
      groupKey,
      slot: -1,
      unique: null,
      dressed: null,
      rig: null,
      playback: null,
      motion: "idle",
      resting: "idle",
      idleTimeScale: new Rng(hashString(entity.id)).float(0.88, 1.12),
      uniqueMeshes: 0,
      uniqueCost: 0,
      named: entity.archetype === "npc" || entity.archetype === "boss",
      // A rigged entity built before its skeleton source arrived is re-acquired on the next sync.
      awaitingRig: rigged && !ready,
      rigCandidate: rigged,
      signature: "",
      // Seeded from the entity rather than left at the origin: `buildUnique` allocates the rig pool
      // by distance from the camera, and a record reading (0,0,0) until `syncOne` writes it back
      // would be measured from the middle of the world.
      position: new THREE.Vector3(entity.position[0], entity.position[1], entity.position[2]),
      target: new THREE.Vector3(entity.position[0], entity.position[1], entity.position[2]),
      previous: new THREE.Vector3(entity.position[0], entity.position[1], entity.position[2]),
      motionTargetPending: false,
      rotationTargetPending: false,
      // Starts at 1 so the first frame reads as a tick boundary and a record that spawns
      // standing still settles immediately rather than after its first movement.
      lastAlpha: 1,
      rotationY: view.rotationY ?? 0,
      targetRotationY: view.rotationY ?? 0,
      previousRotationY: view.rotationY ?? 0,
      movingTicks: 0,
      settledTicks: 0,
      ...(entity.combat?.moveSpeedMps === undefined ? {} : { moveSpeedMps: entity.combat.moveSpeedMps }),
      ...(entity.combat?.walkSpeedMps === undefined ? {} : { walkSpeedMps: entity.combat.walkSpeedMps }),
      ...(view.gaitSpeedMps === undefined ? {} : { gaitSpeedMps: view.gaitSpeedMps }),
      actionPriority: false,
      scale: 1,
      scaleAxes: NO_BUILD,
      tints: tintsFor(entity.id, entity.archetype, character),
      architectureValue: regionId ? architectureValueFor(regionId) : 1,
      build: buildFor(entity.id, entity.archetype),
      schoolCount: 2 + (hashString(`${entity.id}:school-count`) % 3),
      schoolPhase: (hashString(`${entity.id}:school-phase`) / 0xffff_ffff) * Math.PI * 2,
      waterOffset: typeof entity.meta?.waterOffset === "number" ? entity.meta.waterOffset : 0,
      spent: false,
      diedAtMs: null,
      pursuing: false,
      fade: 0,
      pendingDelta: 0,
      lastTickedFrame: 0,
      lingerMs: null,
      fadeMaterials: null,
      normal: null,
      tilt: 0,
      labelHeight: view.labelHeight ?? 1.6,
      radius: this.minHighlightRadius,
      trunkRadius: null,
      pickable: true,
    };

    if (!ready || !this.buildUnique(record, group)) {
      const slot = this.takeSlot(group, entity.id);
      if (slot < 0) return null;
      record.slot = slot;
    }

    this.records.set(entity.id, record);
    if (entity.archetype === "fishing_spot") this.fishingViews.add(record);
    if (rigged) this.rigCandidates.add(record);
    return record;
  }

  /**
   * Gives one record the non-instanced, mixer-driven copy of its character, if it can have one.
   *
   * Split out of `acquire` because `rebalanceUniques` needs the identical construction when a
   * character walks into range long after its group was built. Returns false and leaves the record
   * untouched when the source is not in, the budget is spent, or the entity is too far from the
   * camera to be worth a skeleton.
   */
  private buildUnique(record: ViewRecord, group: InstanceGroup): boolean {
    const assetId = group.assetId;
    const character = group.character;
    const source = this.sourceOf(assetId);
    if (!source) return false;
    if (!this.canAffordUnique(record.archetype, assetId, source, character, record.position)) {
      return false;
    }

    const dressed = character ? this.assembleCharacter(character) : null;
    const unique = dressed ? dressed.group : cloneRigged(source);
    const uniqueMeshes = dressed ? dressed.drawCalls : this.meshesIn(assetId, source);
    const entityId = record.entityId;
    unique.userData.entityId = entityId;
    unique.traverse((child) => {
      child.userData.entityId = entityId;
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      // The bounded nearby rig pool changes pose every frame. Three's cached skinned sphere
      // can describe an old pose and reject a creature that is still in view.
      // Distance residency and the conservative sampled-animation bounds handle distant actors.
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
      // Characters ground themselves with their own shadow. It is the second draw the budget is
      // counting, and a floating shadowless NPC reads as unfinished on its own.
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Keep the authored material, so a live -> dead -> respawned entity re-derives its look
      // from the ART rather than from its own previous variant. Compounding variants is how a
      // node that respawns after being mined comes back permanently grey.
      mesh.userData.baseMaterial = mesh.material;
    });
    // A rebuilt body starts at the visibility its fade has already reached. Without this, walking
    // up to a corpse that dissolved while it was instanced promotes it to a rig and shows it whole
    // for the one frame before `tickCorpseFade` runs again.
    unique.visible = record.fade < 1;
    this.group.add(unique);

    record.unique = unique;
    record.dressed = dressed;
    record.uniqueMeshes = uniqueMeshes;
    record.uniqueCost = uniqueMeshes * 2;
    record.awaitingRig = false;
    this.uniqueViewCount += 1;
    this.spend(record.named, record.uniqueCost);

    record.rig = this.attachRig(record, dressed?.animationRoot ?? unique, assetId);
    if (record.rig) {
      this.animated.add(record);
      this.sampleRig(record);
    }
    return true;
  }

  /**
   * Moves the rig pools to whoever is standing in front of the camera, once per frame.
   *
   * Demote first, then promote, and in that order for a reason: the pool is what gates promotion,
   * so walking from Coldbrace to Highcairn can only light up Highcairn NPCs after the four in
   * Coldbrace have handed their 48 draw calls back. Both halves are no-ops until `update` has been
   * given a camera position, which is what makes the boot-time first sync behave as it always did.
   *
   * A demoted character does NOT vanish for the quarter second until the next `sync`: it takes an
   * instance slot in the same pass and is written into its group baked pose immediately.
   */
  private rebalanceUniques(): void {
    const viewer = this.viewer;
    if (!viewer || this.rigCandidates.size === 0) return;

    for (const record of this.rigCandidates) {
      // The boss is exempt in both directions. There is one of them, the fight is the climax of its
      // region, and an instanced boss is a rig frozen on one baked frame through a two-phase fight.
      if (!record.unique || record.archetype === "boss") continue;
      if (record.position.distanceToSquared(viewer) <= this.uniqueReleaseRadiusSq) continue;
      this.demoteUnique(record);
    }

    let promoted = 0;
    const ranked = [...this.rigCandidates].sort((a, b) => this.compareRigPriority(a, b, viewer));
    for (const record of ranked) {
      if (promoted >= UNIQUE_PROMOTIONS_PER_FRAME) break;
      if (record.unique || record.slot < 0) continue;
      if (record.position.distanceToSquared(viewer) > this.animationRadiusSq) continue;
      const group = this.groups.get(record.groupKey);
      if (!group || !this.characterReady(group.assetId, group.character)) continue;
      const slot = record.slot;
      if (!this.buildUnique(record, group)) {
        // The 40 m acquisition radius and 70 m release radius stop boundary thrash, but they used
        // to let a rig at 69 m block the enemy attacking at 2 m. Evict a lower-priority holder and
        // retry before accepting a frozen combat target.
        if (!this.makeRoomFor(record, group, ranked, viewer) || !this.buildUnique(record, group)) {
          continue;
        }
      }
      promoted += 1;
      this.freeSlot(group, record.entityId, slot);
      record.slot = -1;
      this.placeUnique(record);
      this.applyUniqueState(record, group.tier);
      this.setMotion(record, record.spent ? "death" : record.movingTicks > 0 ? gaitFor(record) : "idle");
    }
  }

  /** Boss, requested action, moving, then distance. Separate draw pools still enforce NPC reserve. */
  private compareRigPriority(a: ViewRecord, b: ViewRecord, viewer: THREE.Vector3): number {
    const boss = Number(b.archetype === "boss") - Number(a.archetype === "boss");
    if (boss !== 0) return boss;
    const aAction = a.actionPriority || (a.rig !== null && ONE_SHOT_MOTIONS.has(a.rig.motion));
    const bAction = b.actionPriority || (b.rig !== null && ONE_SHOT_MOTIONS.has(b.rig.motion));
    const action = Number(bAction) - Number(aAction);
    if (action !== 0) return action;
    const moving = Number(b.movingTicks > 0) - Number(a.movingTicks > 0);
    if (moving !== 0) return moving;
    return a.position.distanceToSquared(viewer) - b.position.distanceToSquared(viewer);
  }

  /**
   * Frees enough lower-priority unique cost for `wanted`. Draw-budget pressure stays inside the
   * named/other split; only the shared unique-view ceiling may evict across it. Returns true when
   * the ordinary budget check can succeed after the evictions.
   */
  private makeRoomFor(
    wanted: ViewRecord,
    group: InstanceGroup,
    ranked: readonly ViewRecord[],
    viewer: THREE.Vector3,
  ): boolean {
    const source = this.sourceOf(group.assetId);
    if (!source) return false;
    const cost = this.uniqueCostOf(group.assetId, source, group.character);
    const namedBudget = Math.round(this.maxUniqueDrawCalls * NAMED_CHARACTER_SHARE);
    const budget = wanted.named ? namedBudget : this.maxUniqueDrawCalls - namedBudget;
    const spend = (): number => wanted.named ? this.namedDrawCalls : this.otherDrawCalls;
    const budgetBlocked = spend() + cost > budget;

    const victims = ranked
      .filter((candidate) => candidate !== wanted
        && candidate.unique !== null
        && candidate.archetype !== "boss"
        // Crossing the named/other split cannot fix a pool shortage. It can fix only the global
        // unique-view ceiling, when the wanted pool already has draw-call room.
        && (candidate.named === wanted.named || !budgetBlocked)
        && this.compareRigPriority(wanted, candidate, viewer) < 0)
      .sort((a, b) => this.compareRigPriority(b, a, viewer));

    for (const victim of victims) {
      if (spend() + cost <= budget && this.countUnique() < this.maxUniqueViews) break;
      this.demoteUnique(victim);
    }
    return spend() + cost <= budget && this.countUnique() < this.maxUniqueViews;
  }

  /** Converts a live rig back to the group's baked pose in the same frame. */
  private demoteUnique(record: ViewRecord): boolean {
    if (!record.unique || record.archetype === "boss") return false;
    const group = this.groups.get(record.groupKey);
    if (!group) return false;
    const slot = this.takeSlot(group, record.entityId);
    if (slot < 0) return false;
    this.releaseUnique(record);
    record.slot = slot;
    this.writeSlot(group, record);
    return true;
  }

  private release(record: ViewRecord): void {
    this.rigCandidates.delete(record);
    this.fishingViews.delete(record);
    this.fading.delete(record);
    this.clearFade(record);
    if (record.unique) {
      this.releaseUnique(record);
      return;
    }
    const group = this.groups.get(record.groupKey);
    if (!group || record.slot < 0) return;
    this.freeSlot(group, record.entityId, record.slot);
    record.slot = -1;
  }

  /**
   * Tears down one non-instanced character: mixer, scene node, owned geometry, pooled draw calls.
   *
   * Separate from `release` because `rebalanceUniques` demotes a character to its instanced pose
   * without the record going away, and that path must not drop the record out of `rigCandidates`
   * (it is exactly the record that has to be promoted again when the player walks back).
   */
  private releaseUnique(record: ViewRecord): void {
    if (record.rig) {
      record.rig.action.stop();
      record.rig.mixer.stopAllAction();
      record.rig.mixer.uncacheRoot(record.rig.root);
      this.animated.delete(record);
      record.rig = null;
    }
    if (!record.unique) return;
    this.uniqueViewCount = Math.max(0, this.uniqueViewCount - 1);
    // The fade clones hang off the meshes inside `record.unique` and nothing else owns them, so
    // they go with it. `record.fade` itself is left alone: the corpse is still dead, and a demote
    // to the instanced path has to keep dissolving from where it had got to.
    if (record.fadeMaterials) {
      for (const material of record.fadeMaterials) material.dispose();
      record.fadeMaterials = null;
    }
    record.unique.removeFromParent();
    // `DressedCharacter.dispose` frees the head-cap and merged geometries this assembly allocated
    // and nothing else owns. The source geometries and materials are shared with the loaded asset
    // and are deliberately left alone.
    record.dressed?.dispose();
    record.dressed = null;
    record.unique = null;
    this.refund(record.named, record.uniqueCost);
    record.uniqueCost = 0;
    record.uniqueMeshes = 0;
  }

  /** Hands one instance slot back to its group and hides it in every pose variant. */
  private freeSlot(group: InstanceGroup, entityId: EntityId, slot: number): void {
    if (slot < 0 || group.slots[slot] !== entityId) return;
    group.slots[slot] = null;
    group.free.push(slot);
    group.animationLod?.hide(slot);
    for (const draw of group.live) hideInstance(draw, slot);
    for (const draw of group.spent) hideInstance(draw, slot);
    for (const draw of group.moving) hideInstance(draw, slot);
  }

  private spend(named: boolean, cost: number): void {
    if (named) this.namedDrawCalls += cost;
    else this.otherDrawCalls += cost;
    this.uniqueDrawCalls += cost;
  }

  private refund(named: boolean, cost: number): void {
    if (named) this.namedDrawCalls = Math.max(0, this.namedDrawCalls - cost);
    else this.otherDrawCalls = Math.max(0, this.otherDrawCalls - cost);
    this.uniqueDrawCalls = Math.max(0, this.uniqueDrawCalls - cost);
  }

  /**
   * Throws away everything that was built while a skeleton source was still in flight, so the next
   * sync pass rebuilds it properly: unique objects get a real rig, and instanced rigged groups get
   * their baked pose instead of bind pose.
   *
   * This runs at most once per boot in practice. `AssetRegistry.load` resolves from cache in a
   * single microtask, so the only pass that ever sees a missing source is the synchronous one boot
   * fires before the loop starts.
   */
  private dropUnposed(): void {
    const stale = new Set<string>();
    for (const [key, group] of this.groups) {
      if (group.needsPose && this.sources.has(group.assetId)) stale.add(key);
    }

    for (const [entityId, record] of [...this.records]) {
      const group = this.groups.get(record.groupKey);
      const sourceReady = group ? this.sources.has(group.assetId) : false;
      if (!stale.has(record.groupKey) && !(record.awaitingRig && sourceReady)) continue;
      this.release(record);
      this.records.delete(entityId);
    }

    for (const key of stale) {
      const group = this.groups.get(key);
      if (!group) continue;
      this.releaseDraws(group.live);
      this.releaseDraws(group.spent);
      this.releaseDraws(group.moving);
      group.animationLod?.dispose();
      this.groups.delete(key);
    }
  }

  // ------------------------------------------------------------- groups

  private ensureGroup(
    key: string,
    assetId: string,
    depletedAssetId: string | null,
    archetype: Archetype,
    tier: number,
    cell: string,
    clipFraction = 0,
    character: CharacterSpec | null = null,
    regionId: RegionId | null = null,
    campfire = false,
    essenceElement: EssenceElement | null = null,
  ): InstanceGroup | null {
    const existing = this.groups.get(key);
    if (existing) return existing;

    const rigged = this.isRigged(assetId);
    const ready = rigged && this.characterReady(assetId, character);
    let liveParts = ready
      ? this.bakedParts(assetId, character, archetype, tier, regionId, false, "idle")
      : this.collectParts(assetId, archetype, tier, regionId, false, essenceElement);

    // `view.clipFraction` keeps only the bottom of the mesh. One geometry per group, built once.
    if (clipFraction > 0 && clipFraction < 1) {
      const clipped = clipPartsBelow(liveParts, clipFraction);
      if (clipped.length > 0) liveParts = clipped;
    }

    if (archetype === "fishing_spot" && liveParts.length > 0) {
      liveParts = this.buildFishingSchool(assetId, tier, liveParts);
    } else if (campfire && liveParts.length > 0) {
      liveParts = this.buildCampfireBase(assetId, liveParts);
    }

    // The ore seam. It is a separate part on the LIVE side only: losing the vein is half of what
    // makes a depleted node read as depleted.
    if (archetype === "ore" && !assetId.startsWith("corealm_ore_") && !essenceElement && liveParts.length > 0) {
      const seam = this.seamPart(assetId, tier, liveParts);
      if (seam) liveParts.push(seam);
    }

    const group: InstanceGroup = {
      key,
      assetId,
      cell,
      character,
      depletedAssetId,
      archetype,
      tier,
      regionId,
      essenceElement,
      slots: [],
      free: [],
      liveParts,
      spentParts: null,
      movingParts: null,
      live: [],
      spent: [],
      moving: [],
      posed: ready,
      needsPose: rigged && !ready,
      animationLod: null,
      animationLodUsedAt: 0,
    };
    group.live = this.buildDraws(group.liveParts, group.cell, group.archetype);
    this.groups.set(key, group);
    return group;
  }

  /**
   * Builds the spent variant on first use.
   *
   * Round 1 built it eagerly for every group, which doubled the instanced mesh count of the whole
   * entity layer for a state most nodes are never in. It costs less than it did — an unused spent
   * geometry sits in a batch with no visible instance and is left out of the multi-draw — but the
   * buffer space and the bake are still real, and most nodes are never spent.
   */
  private ensureSpent(group: InstanceGroup): void {
    if (group.spent.length > 0) return;
    if (!group.spentParts) group.spentParts = this.buildSpentParts(group);
    // A group with no spent geometry at all keeps its LIVE instance drawn under the spent
    // material rather than being hidden. `writeSlot` switches the live instance off only when it
    // has something to put in its place; a node that vanishes on depletion is worse than one that
    // only changes colour, and that vanishing is exactly what Phase 1 shipped.
    if (group.spentParts.length === 0) return;
    group.spent = this.buildDraws(group.spentParts, group.cell, group.archetype);
  }

  /**
   * Builds the walking variant on first use, for a rigged group only.
   *
   * The instanced path cannot animate — a batched draw ignores skinning entirely — but it can
   * hold a DIFFERENT baked pose depending on what the entity is doing, which is the difference
   * between fifty enemies that are all one frozen statue and fifty that at least stand differently
   * when they are chasing you. Only built when something in the group actually moves, so the 18
   * static poses in debug/shots.ts pay nothing for it.
   */
  private ensureMoving(group: InstanceGroup): void {
    if (group.moving.length > 0 || !group.posed) return;
    if (!group.movingParts) {
      group.movingParts = this.bakedParts(
        group.assetId, group.character, group.archetype, group.tier, group.regionId, false, "walk",
      );
    }
    // The live and walk bakes no longer have to line up part-for-part: a `PartDraw` carries its own
    // `SourcePart`, so `writeSlot` reads each variant's own geometry and transform instead of
    // indexing one array with the other's positions.
    if (group.movingParts.length === 0) return;
    group.moving = this.buildDraws(group.movingParts, group.cell, group.archetype);
  }

  /** Builds one shared palette for a group's animated instances, independent of actor count. */
  private ensureAnimationLod(group: InstanceGroup, record: ViewRecord): AnimationLod | null {
    group.animationLodUsedAt = this.resourceTimeSeconds;
    if (group.animationLod) return group.animationLod;
    if (!group.posed || group.archetype === "fishing_spot") return null;
    const source = this.sourceOf(group.assetId);
    if (!source) return null;
    const dressed = group.character ? this.assembleCharacter(group.character) : null;
    const root = dressed?.group ?? source;
    const animationRoot = dressed?.animationRoot ?? root;
    const clips = new Map<string, THREE.AnimationClip>();
    for (const motion of ["idle", "walk", "run", "attack", "hit", "death"] as const) {
      for (const name of this.clipCandidates(group.assetId, record.entityId, motion)) {
        const clip = this.firstFittingClip(group.assetId, [name], animationRoot);
        if (clip) clips.set(clip.name, clip);
      }
    }
    const fallbackHit = this.motionClip(record, "hit");
    if (fallbackHit) clips.set(fallbackHit.name, fallbackHit);
    if (record.playback) clips.set(record.playback.clip.name, record.playback.clip);
    try {
      group.animationLod = new AnimationLod(
        this.group, root, animationRoot, [...clips.values()],
        (material) => this.variantFor(material, group.assetId, group.archetype, group.tier, group.regionId, false),
      );
    } finally {
      dressed?.dispose();
    }
    // Groups outlive their resident entities. Keep revisiting a town cheap without accumulating
    // every town's animation atlases for the rest of a long play session.
    let cachedBytes = 0;
    for (const candidate of this.groups.values()) cachedBytes += candidate.animationLod?.textureBytes ?? 0;
    if (cachedBytes > 128 * 1024 * 1024) {
      const dormant = [...this.groups.values()]
        .filter((candidate) => candidate !== group && candidate.animationLod?.drawCalls === 0)
        .sort((a, b) => a.animationLodUsedAt - b.animationLodUsedAt);
      for (const candidate of dormant) {
        if (cachedBytes <= 128 * 1024 * 1024) break;
        cachedBytes -= candidate.animationLod!.textureBytes;
        candidate.animationLod!.dispose();
        candidate.animationLod = null;
      }
    }
    return group.animationLod;
  }

  /**
   * What a worked-out node looks like.
   *
   * An authored depleted asset wins. It may carry a cut face, moss, snow, or another state that a
   * material filter cannot recover. Derived states only cover content without one:
   *
   *   ore        the rock, minus its vein. The vein is already a separate part (see `seamPart`),
   *              so dropping it is exactly the change the player made by mining it.
   *   tree       the trunk, clipped to `TREE_STUMP_FRACTION` of its height: a stump.
   *
   * Everything else falls back to the live geometry under the spent material.
   */
  private buildSpentParts(group: InstanceGroup): SourcePart[] {
    if (group.depletedAssetId && this.assets.isLoaded(group.depletedAssetId)) {
      const rigged = this.isRigged(group.depletedAssetId);
      const source = rigged ? this.sourceOf(group.depletedAssetId) : null;
      const parts = rigged && source
        ? this.bakedParts(
          group.depletedAssetId, null, group.archetype, group.tier, group.regionId, false, "death",
        )
        : this.collectParts(
          group.depletedAssetId, group.archetype, group.tier, group.regionId, false,
        );
      if (parts.length > 0) {
        // Native stumps share the tree's rooted origin. A spreading or leaning canopy's centre
        // is not the trunk: centering this pair would move the cut tree sideways on harvest.
        if (isNativeTreeAsset(group.assetId) && isNativeTreeAsset(group.depletedAssetId)) return parts;
        return this.alignDepletedParts(group.liveParts, parts);
      }
    }

    const live = this.spentMaterialParts(group);

    if (group.archetype === "ore") {
      if (group.essenceElement) return live;
      const rock = live.filter((part) => part.resourceDetail?.kind !== "oreVein");
      if (rock.length > 0) return [...rock, ...this.workedOutOreParts(group, rock)];
    }

    if (group.archetype === "tree") {
      const clipped = clipPartsBelow(live, TREE_STUMP_FRACTION);
      if (clipped.length > 0) return clipped;
    }

    if (group.archetype === "fishing_spot") return [this.fishingRecoveryPart(group)];

    return live;
  }

  /**
   * An entity is grounded from its available asset's authored floor. A stump or other authored
   * depleted mesh can use a different pivot, so align its floor and horizontal centre to the live
   * silhouette before both variants share the entity transform.
   */
  private alignDepletedParts(
    liveParts: readonly SourcePart[],
    depletedParts: readonly SourcePart[],
  ): SourcePart[] {
    const live = this.partsBounds(liveParts);
    const depleted = this.partsBounds(depletedParts);
    if (live.isEmpty() || depleted.isEmpty()) return [...depletedParts];
    const liveCentre = new THREE.Vector3();
    const depletedCentre = new THREE.Vector3();
    live.getCenter(liveCentre);
    depleted.getCenter(depletedCentre);
    const alignment = new THREE.Matrix4().makeTranslation(
      liveCentre.x - depletedCentre.x,
      live.min.y - depleted.min.y,
      liveCentre.z - depletedCentre.z,
    );
    return depletedParts.map((part) => ({
      ...part,
      matrix: alignment.clone().multiply(part.matrix),
    }));
  }

  /**
   * The live parts again, re-materialised with the spent variant. Geometry is shared, not copied.
   *
   * For a rigged group the pose changes too: this is the corpse, and every one of the four enemy
   * packs ships a `Death` clip. Baking that clip's final frame is what turns a killed enemy from a
   * grey statue standing to attention into a body on the ground, at zero extra draw calls — the
   * spent variant already existed, it was just holding the idle pose.
   */
  private spentMaterialParts(group: InstanceGroup): SourcePart[] {
    const rigged = this.isRigged(group.assetId);
    const parts = rigged && this.characterReady(group.assetId, group.character)
      ? this.bakedParts(
        group.assetId, group.character, group.archetype, group.tier, group.regionId, true, "death",
      )
      : this.collectParts(
        group.assetId, group.archetype, group.tier, group.regionId, true, group.essenceElement,
      );
    if (group.archetype !== "ore" || parts.length === 0) return parts;

    // The emissive map is the essence cache's vein. It is part of the rock material rather than a
    // generated geometry part, so there is nothing to append (or later remove) for these groups.
    if (group.essenceElement) return parts;

    // The ore seam is generated, not authored, so `collectParts` never returns it. Re-append it in
    // the same position the live side has it, or the index arithmetic above lines up with nothing.
    const seam = this.seamPart(group.assetId, group.tier, parts);
    if (seam) parts.push({ ...seam, material: this.materials.oreRock(group.tier, true) });
    return parts;
  }

  /**
   * Pulls (geometry, material, local transform) out of a loaded GLB and builds its material variant.
   * Gameplay nodes keep the existing tier treatment. Architecture and scenery use a region-aware
   * luminance recolour over the identical source texture, so neither path adds texture buckets.
   */
  private collectParts(
    assetId: string,
    archetype: Archetype,
    tier: number,
    regionId: RegionId | null,
    spent: boolean,
    essenceElement: EssenceElement | null = null,
  ): SourcePart[] {
    if (!this.assets.isLoaded(assetId)) return [];
    const source = this.sources.get(assetId) ?? this.assets.instance(assetId);
    source.updateMatrixWorld(true);

    const parts: SourcePart[] = [];
    source.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const base = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (!base) return;
      parts.push({
        geometry: mesh.geometry,
        material: this.variantFor(
          base, assetId, archetype, tier, regionId, spent, essenceElement,
        ),
        matrix: mesh.matrixWorld.clone(),
        triangles: triangleCount(mesh.geometry),
        windStrength: !spent && isNativeTreeAsset(assetId) && artSurfaceRoleForMaterial(base.name) === "foliage"
          ? NATIVE_TREE_FOLIAGE_WIND : 0,
      });
    });
    if (assetId === ESSENCE_ALTAR_ASSET && essenceElement && !spent) {
      parts.push(...this.essenceAltarDetailParts(essenceElement));
    }
    return parts;
  }

  /** One clean line below the slab and one concentric emblem on each long face. */
  private essenceAltarDetailParts(element: EssenceElement): SourcePart[] {
    this.essenceAltarLineGeometry ??= new THREE.BoxGeometry(1.72, 0.026, 0.018);
    this.essenceAltarCircleGeometry ??= new THREE.TorusGeometry(0.17, 0.018, 8, 32);
    let material = this.essenceAltarDetailMaterials.get(element);
    if (!material) {
      const colour = new THREE.Color(ESSENCE_GLOW[element].colour);
      material = new THREE.MeshStandardMaterial({
        name: `altar-imbued-detail:${element}`,
        color: colour.clone().multiplyScalar(0.22),
        emissive: colour,
        emissiveIntensity: 0.9,
        roughness: 0.35,
        metalness: 0.05,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.essenceAltarDetailMaterials.set(element, material);
    }
    const part = (geometry: THREE.BufferGeometry, x: number, y: number, z: number): SourcePart => ({
      geometry,
      material,
      matrix: new THREE.Matrix4().makeTranslation(x, y, z),
      triangles: triangleCount(geometry),
    });
    return [
      part(this.essenceAltarLineGeometry, 0, 0.765, 0.487),
      part(this.essenceAltarLineGeometry, 0, 0.765, -0.487),
      part(this.essenceAltarCircleGeometry, 0, 0.47, 0.488),
      part(this.essenceAltarCircleGeometry, 0, 0.47, -0.488),
    ];
  }

  /**
   * The instanced fallback for a rigged asset: one frame of one clip, CPU-skinned into static
   * geometry.
   *
   * An `InstancedMesh` ignores skinning entirely, so instancing a skinned geometry raw draws it in
   * bind pose — the arms-straight-out look that was the single strongest "unfinished build" signal
   * in the round-1 screenshots. Baking costs a few milliseconds once per asset and nothing per
   * frame, and keeps forty background characters at four draw calls instead of a hundred and sixty.
   *
   * `motion` picks WHICH pose, so a group can hold an idle set, a walking set and a corpse set and
   * `writeSlot` chooses between them per slot. `character` makes the baked body a full dressed
   * humanoid — head, clothes and hair — rather than the clothes-only GLB that produced twelve
   * headless NPCs.
   *
   * Falls back to the raw (bind-pose) parts if anything about the rig is unexpected. A slightly
   * wrong pose is worth having; a boot failure over a cosmetic path is not.
   */
  private bakedParts(
    assetId: string,
    character: CharacterSpec | null,
    archetype: Archetype,
    tier: number,
    regionId: RegionId | null,
    spent: boolean,
    motion: CharacterMotion,
  ): SourcePart[] {
    const source = this.sourceOf(assetId);
    if (!source) return this.collectParts(assetId, archetype, tier, regionId, spent);
    let dressed: DressedCharacter | null = null;
    // Set when a mesh could not be CPU-skinned and its SOURCE geometry was handed out instead. That
    // geometry may be one the assembly owns, so freeing the assembly would tear it out from under
    // the InstancedMesh that now points at it.
    let sharedGeometry = false;
    try {
      dressed = character ? this.assembleCharacter(character) : null;
      const posed = dressed ? dressed.group : cloneRigged(source);
      const animationRoot = dressed ? dressed.animationRoot : posed;
      const clip = this.firstFittingClip(assetId, this.clipCandidates(assetId, assetId, motion), animationRoot);
      if (clip) {
        const mixer = new THREE.AnimationMixer(animationRoot);
        mixer.clipAction(clip).play();
        mixer.setTime(clip.duration * BAKE_PHASES[motion]);
      }
      posed.updateMatrixWorld(true);

      const parts: SourcePart[] = [];
      posed.traverse((child) => {
        const skinned = child as THREE.SkinnedMesh;
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const base = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        if (!base) return;
        const material = this.variantFor(base, assetId, archetype, tier, regionId, spent);

        if (skinned.isSkinnedMesh && skinned.skeleton) {
          const frozen = freezeSkin(skinned);
          if (frozen) {
            this.bakedGeometries.push(frozen);
            // `applyBoneTransform` returns positions in the mesh's LOCAL space: it ends by applying
            // `bindMatrixInverse`, which is exactly what the skinning shader does before the model
            // matrix. So the transform back to world is the mesh's own world matrix, the same one
            // the unskinned branch below uses.
            //
            // This was `bindMatrix`, which is only equal to it when every node above the mesh is
            // identity. That holds for the Quaternius characters and holds for nothing in the
            // animal pack: those GLBs carry the centimetre-to-metre conversion as a 0.01 root
            // scale, and several rigs park a further scale on the mesh node itself (the bear's is
            // 72.242). Dropping the hierarchy drew every instanced animal at 100x - a 1.77 m stag
            // measured 177.96 m through the terrain, which is what "giant things everywhere" was.
            parts.push({
              geometry: frozen,
              material,
              matrix: skinned.matrixWorld.clone(),
              triangles: triangleCount(frozen),
            });
            return;
          }
        }
        sharedGeometry = true;
        parts.push({
          geometry: mesh.geometry,
          material,
          matrix: mesh.matrixWorld.clone(),
          triangles: triangleCount(mesh.geometry),
        });
      });
      if (parts.length > 0) return parts;
    } catch {
      // fall through to the unposed path
    } finally {
      // `freezeSkin` clones every geometry it bakes, so the assembly's own merged and head-capped
      // geometries are dead the moment the bake is done and can be freed here.
      if (!sharedGeometry) dressed?.dispose();
      else dressed?.group.removeFromParent();
    }
    return this.collectParts(assetId, archetype, tier, regionId, spent);
  }

  // -------------------------------------------------------- characters

  /**
   * Resolves an entity's dressed-character spec, memoised on the resolved key.
   *
   * Memoised because `sync` runs a few times a second over every entity in the world and this
   * allocates an array and a string. The map is keyed by (entityId, assetId, parts) so a semantic
   * change to the outfit still re-resolves.
   */
  private characterFor(
    entityId: EntityId,
    archetype: Archetype,
    assetId: string,
    partAssetIds: readonly string[] | undefined,
  ): CharacterSpec | null {
    const cacheKey = `${entityId}|${archetype}|${assetId}|${partAssetIds?.join("+") ?? ""}`;
    const cached = this.characterSpecs.get(cacheKey);
    if (cached !== undefined) return cached;
    const spec = characterSpecFor(entityId, archetype, assetId, partAssetIds);
    this.characterSpecs.set(cacheKey, spec);
    // Start the clothes loading the FIRST time this entity is seen, not when its instance group is
    // built. `boot.preloadEntityAssets` does not know about `view.partAssetIds`, so if the request
    // waits for `ensureGroup` the group is built undressed and only a later `dropUnposed` round can
    // fix it. Kicking it here means the parts are in flight during boot's own first sync.
    if (spec) this.characterReady(assetId, spec);
    return spec;
  }

  /**
   * Like `sourceOf`, but STARTS the load for an asset the registry was never asked for.
   *
   * `sourceOf` refuses anything `assets.isLoaded` says no to, which is right for `view.assetId`:
   * boot preloads those and a miss means a genuine content error. Outfit parts are different.
   * `boot.preloadEntityAssets` (boot.ts:1116) collects `view.assetId` and `view.depletedAssetId`
   * only — it has never heard of `view.partAssetIds` — so every one of the 4-6 clothing GLBs an NPC
   * needs is unloaded at first sync. Without this, `characterReady` is false forever and every NPC
   * in the world renders as a naked base body. Measured: 12 of 12, `meshes: 3`, no clothes.
   *
   * `sourceRequests` deduplicates one attempt. A failed attempt leaves the row pending and clears
   * that marker, which lets explicit hydration or a later sync retry it. Setting `sourcesChanged`
   * makes `sync` rebuild the affected groups once the clothes land.
   */
  private requestSource(
    id: string,
    forceRetry = false,
    options: AssetLoadOptions = {},
  ): THREE.Object3D | null {
    const cached = this.sources.get(id);
    if (cached) return cached;
    if (this.missing.has(id)) return null;
    // Procedurally built assets live in the registry cache without a manifest row.
    if (!this.assets.entry(id) && !this.assets.isLoaded(id)) {
      this.missing.add(id);
      this.failedSources.delete(id);
      return null;
    }
    if (this.sourceRequests.has(id)) return null;

    const previousFailure = this.failedSources.get(id);
    if (!forceRetry && previousFailure && Date.now() < previousFailure.retryAtMs) return null;

    this.sourceRequests.add(id);
    const load = this.assets
      .load(id, options)
      .then((group) => {
        this.sources.set(id, group);
        this.failedSources.delete(id);
        this.sourcesChanged = true;
        return group;
      })
      .catch(() => {
        this.failedSources.set(id, {
          attempts: (previousFailure?.attempts ?? 0) + 1,
          retryAtMs: Date.now() + SOURCE_RETRY_DELAY_MS,
        });
        this.sourcesChanged = true;
        return null;
      })
      .finally(() => {
        this.sourceRequests.delete(id);
        this.sourceLoads.delete(id);
      });
    this.sourceLoads.set(id, load);
    return null;
  }

  private async hydrateAssets(
    ids: readonly string[],
    forceRetry: boolean,
    options: AssetLoadOptions,
  ): Promise<void> {
    for (const id of ids) this.requestSource(id, forceRetry, options);
    const loads = ids
      .map((id) => this.sourceLoads.get(id))
      .filter((load): load is Promise<THREE.Object3D | null> => Boolean(load));
    await Promise.all(loads);
  }

  private assetIdsFor(entities: readonly SemanticEntity[]): string[] {
    const ids = new Set<string>();
    for (const entity of entities) {
      for (const id of this.assetIdsForEntity(entity)) ids.add(id);
    }
    return [...ids].sort();
  }

  private assetIdsForEntity(entity: SemanticEntity): string[] {
    const view = entity.view;
    if (!view) return [];
    const ids = new Set<string>([view.assetId]);
    if (view.depletedAssetId) ids.add(view.depletedAssetId);
    const character = characterSpecFor(
      entity.id, entity.archetype, view.assetId, view.partAssetIds,
    );
    if (character) {
      ids.add(character.bodyAssetId);
      for (const partId of character.partAssetIds) ids.add(partId);
    }
    return [...ids].sort();
  }

  /**
   * Whether every GLB a character needs has landed. A half-dressed character is not worth building.
   *
   * Requests EVERY part before answering, rather than returning false at the first one that is not
   * in yet. That is not tidiness: `sourcesChanged` triggers one `dropUnposed` rebuild round per
   * batch of arrivals, so short-circuiting means one round per part file — thirty part files across
   * twelve NPCs, at a 250 ms sync cadence, is seven seconds of NPCs standing around in their
   * underwear. Asking for all of them at once collapses that to two rounds.
   */
  private characterReady(assetId: string, character: CharacterSpec | null): boolean {
    if (!character) return this.sourceOf(assetId) !== null;
    let ready = this.requestSource(character.bodyAssetId) !== null;
    for (const partId of character.partAssetIds) {
      // A part that failed to load, or that the manifest does not carry at all, is never going to
      // arrive; dress the character without it rather than waiting forever.
      if (this.missing.has(partId)) continue;
      if (!this.requestSource(partId)) ready = false;
    }
    return ready;
  }

  /**
   * Builds one dressed humanoid: head-capped body + outfit + hair, one skeleton, merged.
   *
   * `headCap: true` is the load-bearing flag and the counter-intuitive half of the fix. Outfit parts
   * are authored to REPLACE the body below the neck, not to cover it — measured in bind space, the
   * peasant trousers sit 5.4 mm INSIDE base_male's bare thigh and the boot is 27.5 mm narrower than
   * the bare foot — so layering clothes onto an intact body leaks skin through them. Cutting the
   * body to a head cap (base_male at y 1.55, base_female at 1.50) and layering that onto the full
   * outfit is the way round that works, and it keeps the body's own Eyes and Eyebrows meshes, which
   * sit entirely above the cut.
   */
  private assembleCharacter(character: CharacterSpec): DressedCharacter | null {
    const body = this.requestSource(character.bodyAssetId);
    if (!body) return null;
    const parts: CharacterPartSource[] = [];
    for (const assetId of character.partAssetIds) {
      const source = this.requestSource(assetId);
      if (source) parts.push({ assetId, source });
    }
    try {
      const dressed = assembleDressedCharacter({
        bodyAssetId: character.bodyAssetId,
        body,
        parts,
        headCap: true,
        // A partly rebound outfit is worse than a missing part: the unmatched joint keeps its own
        // undriven bone and hangs in bind pose beside the moving body.
        onMissingBone: "reject",
        merge: true,
        mergeOptions: { materialKey: characterMaterialKey },
        name: `character-${character.key}`,
      });
      this.characterCosts.set(character.key, dressed.drawCalls);
      return dressed;
    } catch {
      // A body with no SkinnedMesh throws by design. Falling back to the plain clone keeps the
      // entity on screen rather than dropping it, which is the right trade for a cosmetic path.
      return null;
    }
  }

  /** Which tier treatment a given source material on a given archetype gets. */
  private variantFor(
    base: THREE.Material,
    assetId: string,
    archetype: Archetype,
    tier: number,
    regionId: RegionId | null,
    spent: boolean,
    essenceElement: EssenceElement | null = null,
  ): THREE.Material {
    if (base.userData["iconAuthored"]) return base;
    if (assetId === "corealm_water_trough") {
      const water = this.materials.forContainedTrough(assetId, base);
      if (water !== base) return water;
    }
    // Native seams and their spent companions carry authored mineral colors and stone layers.
    if (assetId.startsWith("corealm_ore_")) return base;
    if (isNativeTreeAsset(assetId)) {
      // Forest activation swaps scatter instances for semantic views at the exact same placement.
      // Keep the same authored palette, organic grade and world-origin wind phase on both paths.
      const role = artSurfaceRoleForMaterial(base.name);
      const surface = role ? this.materials.organic(base, role) : base;
      return !spent && role === "foliage"
        ? this.materials.wind(surface, NATIVE_TREE_FOLIAGE_WIND)
        : surface;
    }
    if (regionId && ARCHITECTURE_ARCHETYPES.has(archetype)) {
      const architectureRole = architectureMaterialRoleForAsset(assetId, base.name);
      if (architectureRole) {
        const architecture = this.materials.architecture(base, regionId, architectureRole);
        if (!essenceElement) return architecture;
        return this.essenceMaterial(
          architecture,
          essenceElement,
          spent,
          assetId === ESSENCE_ALTAR_RUINS_ASSET ? "structure" : "veins",
        );
      }
    }

    const look = this.appearanceFor(archetype, base);
    if (essenceElement) {
      // State must not desaturate or darken the surface: depletion is the loss of charge, not a
      // different rock. MaterialLibrary's normal tier treatment preserves the imported albedo map.
      const surface = this.materials.variant(base, {
        tier,
        state: "normal",
        strength: look.strength,
        swatch: look.swatch,
      });
      return this.essenceMaterial(
        surface,
        essenceElement,
        spent,
        assetId === ESSENCE_ALTAR_ASSET
          ? "altar"
          : assetId === ESSENCE_ALTAR_RUINS_ASSET ? "structure" : "veins",
      );
    }
    let variant = this.materials.variant(base, {
      tier,
      state: spent ? "depleted" : "normal",
      strength: look.strength,
      swatch: look.swatch,
    });
    const organicRole = artSurfaceRoleForMaterial(base.name);
    if (organicRole) variant = this.materials.organic(variant, organicRole);
    if (spent) return variant;
    if (archetype === "tree" && LEAF_MATERIAL.test(base.name)) {
      return this.materials.wind(variant, TREE_FOLIAGE_WIND);
    }
    return variant;
  }

  /**
   * Imported rock surface plus the seamless elemental vein mask.
   *
   * `clone()` shares the original `map`, normal map and PBR maps, so the DEXSOFT texture remains
   * the base surface. Only the emissive channel is replaced. One clone per (surface, element,
   * state) keeps all five rocks in a cache inside the existing BatchedMesh shape.
   */
  private essenceMaterial(
    surface: THREE.Material,
    element: EssenceElement,
    spent: boolean,
    treatment: "veins" | "altar" | "structure" = "veins",
  ): THREE.Material {
    const standard = surface as THREE.MeshStandardMaterial;
    if (!standard.isMeshStandardMaterial) return surface;

    const key = `${surface.uuid}|${element}|${spent ? "spent" : "live"}|${treatment}`;
    const cached = this.essenceMaterials.get(key);
    if (cached) return cached;

    const glow = ESSENCE_GLOW[element];
    const structureColour = ESSENCE_STRUCTURE_COLOUR[element];
    const regionStone = ESSENCE_REGION_STONE[element];
    const material = standard.clone();
    material.name = `${surface.name || "rock"}@essence:${element}:${spent ? "spent" : "live"}`;
    // The court receives a broad element-colour wash. The altar keeps its stone underneath a much
    // brighter fissure mask, so awakening reads as imbued lines instead of a featureless light box.
    material.emissiveMap = treatment === "structure"
      ? standard.map
      : treatment === "altar" ? this.essenceAltarLinesMask : this.essenceVeinsMask;
    if (treatment === "structure") {
      // The trim-sheet albedo supplies weathering while this multiplier supplies the region's base
      // rock. Element colour is a second layer, quiet when dormant and stronger after activation.
      material.color.copy(new THREE.Color(regionStone))
        .lerp(new THREE.Color(structureColour), spent ? 0.1 : 0.32);
    }
    if (treatment === "altar") {
      material.color.copy(new THREE.Color(regionStone))
        .lerp(new THREE.Color(glow.colour), spent ? 0.08 : 0.26);
    }
    if (treatment === "structure" || treatment === "altar") {
      // Altar Ruins Free ships with a near-black trim sheet. Multiplying that map by a pale tint
      // cannot make it lighter, so remap its value into the regional stone range after sampling the
      // texture. This remains diffuse stone: dormant ruins still have zero emissive output.
      const stoneTint = material.color.clone();
      const tintLuminance = Math.max(
        1e-4,
        stoneTint.r * 0.2126 + stoneTint.g * 0.7152 + stoneTint.b * 0.0722,
      );
      stoneTint.multiplyScalar(1 / tintLuminance);
      const tintVector = `vec3(${stoneTint.r.toFixed(6)}, ${stoneTint.g.toFixed(6)}, ${stoneTint.b.toFixed(6)})`;
      const sourceCompile = standard.onBeforeCompile;
      const sourceProgramKey = standard.customProgramCacheKey();
      material.onBeforeCompile = (shader, renderer) => {
        sourceCompile.call(standard, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <map_fragment>",
          /* glsl */ `#include <map_fragment>
float gEssenceStoneLuminance = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
float gEssenceStoneValue = clamp( pow( max( gEssenceStoneLuminance, 0.001 ), 0.55 ) * 1.15 + 0.08, 0.0, 0.9 );
vec3 gEssenceStoneTinted = clamp( gEssenceStoneValue * ${tintVector}, 0.0, 1.0 );
diffuseColor.rgb = mix( diffuseColor.rgb, gEssenceStoneTinted, 0.82 );`,
        );
      };
      material.customProgramCacheKey = () => (
        `${sourceProgramKey}|essence-stone-lift-v1:${element}:${spent ? "spent" : "live"}:${treatment}`
      );
    }
    material.emissive = new THREE.Color(
      spent ? 0x000000 : treatment === "structure" ? structureColour : glow.colour,
    );
    material.emissiveIntensity = spent
      ? 0
      : glow.intensity * (treatment === "structure" ? 0.38 : treatment === "altar" ? 0.5 : 1);
    material.needsUpdate = true;
    this.essenceMaterials.set(key, material);
    return material;
  }

  private appearanceFor(archetype: Archetype, material: THREE.Material): Appearance {
    if (PROTECTED_MATERIAL.test(material.name)) return NEUTRAL;
    if (CREATURE_MATERIAL.test(material.name)) return NEUTRAL;
    // Preserve the old tier-body treatment if a tile mesh is ever used as gameplay art. Scenery
    // takes the region-aware architecture path before this fallback and stays tier-independent.
    if (!ARCHITECTURE_ARCHETYPES.has(archetype)
      && architectureMaterialRole(material.name) === "roof") {
      return { swatch: "body", strength: 0.42 };
    }
    if (archetype === "tree" && LEAF_MATERIAL.test(material.name)) {
      // Canopy stays close to its authored colour: species and scale carry a tree's region look,
      // and a heavy tint here fights the world layer rather than helping it.
      return { swatch: "accent", strength: 0.25 };
    }
    return APPEARANCE[archetype] ?? NEUTRAL;
  }

  /**
   * The tier component of the instance-group key: the real tier when tier changes what this asset
   * draws, and `"-"` when it provably does not.
   *
   * This is the draw-call fix for wave 2. The three settlements added 156 props and 10 buildings,
   * and every (asset, tier) pair was its own group even when the two groups held byte-identical
   * geometry under the identical material OBJECT. Measured over the shipped world: 184 groups /
   * 356 `InstancedMesh`es keyed by tier, against 119 groups / 244 meshes keyed this way — 112
   * fewer meshes, i.e. 224 fewer world-wide submitted draws with the shadow pass counted.
   *
   * It is safe because it asks the same question the renderer does. `MaterialLibrary.variant`
   * returns the SOURCE material instance, not a clone, whenever strength, glow and state are all
   * zero/normal — so a group whose every material resolves to `strength === 0` under
   * `appearanceFor` draws the same objects at tier 1 and tier 10. The tier's other two effects are
   * both accounted for: `tierSilhouetteScale` is a per-SLOT scale and only applies to
   * `TIERED_ARCHETYPES`, all six of which have a non-zero `APPEARANCE` row and are rejected on the
   * first line below; and the spent variant's `applyDepletion` clone is derived from the source
   * colour with no palette term in it, so it too is tier-independent at strength 0.
   *
   * `ore` is the one archetype the material scan cannot answer, because its seam is GENERATED in
   * `materials.oreRock(tier)` rather than shipped in the GLB.
   */
  private groupTier(
    archetype: Archetype,
    tier: number,
    assetId: string,
    character: CharacterSpec | null,
  ): number | string {
    if (isNativeTreeAsset(assetId)) return "-";
    if (archetype === "ore") return tier;
    if ((APPEARANCE[archetype]?.strength ?? 0) > 0) return tier;
    if (TIER_BLIND_ARCHETYPES.has(archetype)) return "-";

    const cacheKey = `${character?.key ?? assetId}|${archetype}`;
    const cached = this.tierKeyed.get(cacheKey);
    if (cached !== undefined) return cached ? tier : "-";

    const ids = character ? [character.bodyAssetId, ...character.partAssetIds] : [assetId];
    let keyed = false;
    let materials = 0;
    for (const id of ids) {
      // Undecidable until the GLB is in. Keep the tier in the key for now rather than caching a
      // guess: an asset that turns out to use a tier-treated material must not be merged first.
      if (!this.assets.isLoaded(id)) return tier;
      const source = this.sources.get(id) ?? this.assets.instance(id);
      source.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (!material) continue;
          materials += 1;
          if (this.appearanceFor(archetype, material).strength > 0) keyed = true;
        }
      });
    }
    if (materials === 0) return tier;
    this.tierKeyed.set(cacheKey, keyed);
    return keyed ? tier : "-";
  }

  /** Region key only for scenery assets that actually contain a recognised architecture paint. */
  private architectureRegion(
    archetype: Archetype,
    regionId: RegionId,
    assetId: string,
  ): RegionId | null {
    if (!ARCHITECTURE_ARCHETYPES.has(archetype)) return null;

    let architecture = this.architectureAssets.get(assetId);
    if (architecture === undefined) {
      architecture = false;
      const source = this.sources.get(assetId) ?? this.assets.instance(assetId);
      source.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (material && architectureMaterialRoleForAsset(assetId, material.name)) architecture = true;
        }
      });
      this.architectureAssets.set(assetId, architecture);
    }
    return architecture ? regionId : null;
  }

  // ------------------------------------------------ resource presentation

  private partsBounds(parts: readonly SourcePart[]): THREE.Box3 {
    const box = new THREE.Box3();
    for (const part of parts) {
      part.geometry.computeBoundingBox();
      const bounds = part.geometry.boundingBox;
      if (bounds) box.union(bounds.clone().applyMatrix4(part.matrix));
    }
    return box;
  }

  /** Turns one fish mesh into a batched four-slot school plus a quiet surface marker. */
  private buildFishingSchool(
    assetId: string,
    tier: number,
    parts: readonly SourcePart[],
  ): SourcePart[] {
    const box = this.partsBounds(parts);
    if (box.isEmpty()) return [...parts];
    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(centre);
    const span = Math.max(size.x, size.z, 0.1);
    const centreModel = new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z);
    const rng = new Rng(hashString(`${assetId}:school`));
    const school: SourcePart[] = [];

    for (let schoolIndex = 0; schoolIndex < FISH_SCHOOL_CAPACITY; schoolIndex += 1) {
      const detail: ResourcePartDetail = {
        kind: "fish",
        schoolIndex,
        phase: (schoolIndex / FISH_SCHOOL_CAPACITY) * Math.PI * 2 + rng.float(-0.28, 0.28),
        orbitX: span * rng.float(0.28, 0.48),
        orbitZ: span * rng.float(0.2, 0.38),
        depthJitter: -span * rng.float(0.015, 0.055),
        scale: rng.float(0.82, 1.04),
      };
      for (const part of parts) {
        school.push({
          ...part,
          material: this.submergedFishMaterial(part.material),
          matrix: centreModel.clone().multiply(part.matrix),
          resourceDetail: detail,
        });
      }
    }

    const marker = this.fishingMarkerGeometry(assetId, tier, span);
    school.push({
      geometry: marker.ripple,
      material: this.resourceMaterial("water-live", tier),
      matrix: new THREE.Matrix4(),
      triangles: triangleCount(marker.ripple),
      resourceDetail: { kind: "ripple", recovery: false },
    });
    school.push({
      geometry: marker.bubbles,
      material: this.resourceMaterial("water-live", tier),
      matrix: new THREE.Matrix4(),
      triangles: triangleCount(marker.bubbles),
      resourceDetail: { kind: "bubbles" },
    });
    return school;
  }

  /**
   * Makes authored fish readable through the nearly opaque water without flattening their texture
   * or colour into a procedural tint. The clone keeps every source map and PBR value. Only alpha,
   * depth writing and shadow casting change, and the cache means four fish still use one material.
   */
  private submergedFishMaterial(source: THREE.Material): THREE.Material {
    const cached = this.submergedFishMaterials.get(source);
    if (cached) return cached;

    const material = source.clone();
    material.name = `${source.name || source.type}@submerged-fish`;
    material.transparent = true;
    material.opacity = source.opacity * SUBMERGED_FISH_OPACITY;
    material.depthWrite = false;
    material.userData.entityCastShadow = false;
    this.submergedFishMaterials.set(source, material);
    return material;
  }

  private fishingMarkerGeometry(
    assetId: string,
    tier: number,
    span: number,
  ): { ripple: THREE.BufferGeometry; bubbles: THREE.BufferGeometry } {
    const paletteTier = paletteForTier(tier).tier;
    const cacheKey = `${assetId}:${paletteTier}`;
    const cached = this.fishingGeometries.get(cacheKey);
    if (cached) return cached;

    const relativeRadius = THREE.MathUtils.clamp(
      FISH_MARKER_TIER_ONE_SCALE
        - Math.log2(Math.max(1, paletteTier)) * FISH_MARKER_TIER_FALLOFF,
      FISH_MARKER_MIN_SCALE,
      FISH_MARKER_TIER_ONE_SCALE,
    );
    const ringRadius = span * relativeRadius;
    const rings: THREE.BufferGeometry[] = [];
    for (const scale of [0.62, 1] as const) {
      const outer = ringRadius * scale;
      const ring = new THREE.RingGeometry(
        outer * 0.86,
        outer,
        28,
      );
      ring.rotateX(-Math.PI * 0.5);
      rings.push(ring);
    }
    const ripple = mergeGeometries(rings, false) ?? rings[0]!;
    if (ripple !== rings[0]) for (const ring of rings) ring.dispose();
    ripple.computeBoundingSphere();

    const bubblesRaw: THREE.BufferGeometry[] = [];
    const rng = new Rng(hashString(`${assetId}:bubbles`));
    for (let index = 0; index < 3; index += 1) {
      const angle = (index / 3) * Math.PI * 2 + rng.float(-0.4, 0.4);
      const radius = ringRadius * rng.float(0.055, 0.085);
      const bubble = new THREE.SphereGeometry(radius, 6, 4);
      bubble.translate(
        Math.cos(angle) * ringRadius * rng.float(0.24, 0.48),
        -ringRadius * rng.float(0.05, 0.13),
        Math.sin(angle) * ringRadius * rng.float(0.24, 0.48),
      );
      bubblesRaw.push(bubble);
    }
    const bubbles = mergeGeometries(bubblesRaw, false) ?? bubblesRaw[0]!;
    if (bubbles !== bubblesRaw[0]) for (const bubble of bubblesRaw) bubble.dispose();
    bubbles.computeBoundingSphere();

    const out = { ripple, bubbles };
    this.fishingGeometries.set(cacheKey, out);
    return out;
  }

  /** A depleted fishing node retains only a low-opacity recovery ripple. */
  private fishingRecoveryPart(group: InstanceGroup): SourcePart {
    const cacheKey = `${group.assetId}:${paletteForTier(group.tier).tier}`;
    let marker = this.fishingGeometries.get(cacheKey);
    if (!marker) marker = this.fishingMarkerGeometry(group.assetId, group.tier, 1);
    return {
      geometry: marker.ripple,
      material: this.resourceMaterial("water-recovery", group.tier),
      matrix: new THREE.Matrix4(),
      triangles: triangleCount(marker.ripple),
      resourceDetail: { kind: "ripple", recovery: true },
    };
  }

  /** Crosses two copies of the authored log and adds one merged low-poly stone ring. */
  private buildCampfireBase(assetId: string, parts: readonly SourcePart[]): SourcePart[] {
    const box = this.partsBounds(parts);
    if (box.isEmpty()) return [...parts];
    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(centre);
    const span = Math.max(size.x, size.z, 0.25);
    const normalise = new THREE.Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z);
    const out: SourcePart[] = [];

    for (const [index, angle] of [Math.PI * 0.25, -Math.PI * 0.25].entries()) {
      const crossed = new THREE.Matrix4().makeRotationY(angle);
      crossed.setPosition(0, index * Math.max(0.025, size.y * 0.18), 0);
      for (const part of parts) {
        out.push({
          ...part,
          matrix: crossed.clone().multiply(normalise).multiply(part.matrix),
        });
      }
    }

    let rocks = this.campfireRockGeometries.get(assetId);
    if (!rocks) {
      const stones: THREE.BufferGeometry[] = [];
      const rng = new Rng(hashString(`${assetId}:fire-ring`));
      for (let index = 0; index < 9; index += 1) {
        const angle = (index / 9) * Math.PI * 2;
        const radius = span * rng.float(0.09, 0.12);
        const stone = new THREE.DodecahedronGeometry(radius, 0);
        stone.scale(rng.float(1.05, 1.35), rng.float(0.58, 0.78), rng.float(0.85, 1.15));
        stone.rotateY(rng.float(0, Math.PI));
        stone.translate(
          Math.cos(angle) * span * 0.64,
          radius * 0.45,
          Math.sin(angle) * span * 0.64,
        );
        stones.push(stone);
      }
      rocks = mergeGeometries(stones, false) ?? stones[0]!;
      if (rocks !== stones[0]) for (const stone of stones) stone.dispose();
      rocks.computeBoundingSphere();
      this.campfireRockGeometries.set(assetId, rocks);
    }
    out.push({
      geometry: rocks,
      material: this.resourceMaterial("fire-rock", 1),
      matrix: new THREE.Matrix4(),
      triangles: triangleCount(rocks),
    });
    return out;
  }

  /** Dark cut face, ground dust, and loose chips layered over the intact depleted rock. */
  private workedOutOreParts(group: InstanceGroup, rock: readonly SourcePart[]): SourcePart[] {
    let geometry = this.workedOreGeometries.get(group.assetId);
    if (!geometry) {
      const box = this.partsBounds(rock);
      if (box.isEmpty()) return [];
      const size = new THREE.Vector3();
      const centre = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(centre);
      const span = Math.max(0.1, Math.min(size.x, size.z));

      const scarPieces: THREE.BufferGeometry[] = [];
      const cut = new THREE.CircleGeometry(1, 11);
      cut.scale(size.x * 0.17, size.y * 0.12, 1);
      cut.translate(centre.x, centre.y + size.y * 0.03, centre.z + size.z * 0.435);
      scarPieces.push(cut);
      for (const [offset, angle] of [[-0.05, -0.58], [0.03, 0.12], [0.08, 0.72]] as const) {
        const slash = new THREE.BoxGeometry(size.x * 0.2, size.y * 0.018, size.z * 0.018);
        slash.rotateZ(angle);
        slash.translate(
          centre.x + size.x * offset,
          centre.y + size.y * (0.03 + offset * 0.45),
          centre.z + size.z * 0.445,
        );
        scarPieces.push(slash);
      }
      const scar = mergeGeometries(scarPieces, false) ?? scarPieces[0]!;
      if (scar !== scarPieces[0]) for (const part of scarPieces) part.dispose();
      scar.computeBoundingSphere();

      const dust = new THREE.CircleGeometry(1, 18);
      dust.scale(span * 0.47, span * 0.31, 1);
      dust.rotateX(-Math.PI * 0.5);
      dust.translate(centre.x + size.x * 0.08, box.min.y + size.y * 0.012, centre.z + size.z * 0.2);
      dust.computeBoundingSphere();

      const chips: THREE.BufferGeometry[] = [];
      const rng = new Rng(hashString(`${group.assetId}:worked-out`));
      for (let index = 0; index < 5; index += 1) {
        const radius = span * rng.float(0.035, 0.07);
        const chip = new THREE.TetrahedronGeometry(radius, 0);
        const angle = rng.float(-0.15, Math.PI + 0.15);
        chip.rotateY(rng.float(0, Math.PI));
        chip.translate(
          centre.x + Math.cos(angle) * span * rng.float(0.45, 0.68),
          box.min.y + radius * 0.55,
          centre.z + Math.sin(angle) * span * rng.float(0.42, 0.62),
        );
        chips.push(chip);
      }
      const fragments = mergeGeometries(chips, false) ?? chips[0]!;
      if (fragments !== chips[0]) for (const chip of chips) chip.dispose();
      fragments.computeBoundingSphere();
      geometry = { scar, dust, fragments };
      this.workedOreGeometries.set(group.assetId, geometry);
    }

    return [
      {
        geometry: geometry.scar,
        material: this.resourceMaterial("ore-scar", group.tier),
        matrix: new THREE.Matrix4(),
        triangles: triangleCount(geometry.scar),
      },
      {
        geometry: geometry.dust,
        material: this.resourceMaterial("ore-dust", group.tier),
        matrix: new THREE.Matrix4(),
        triangles: triangleCount(geometry.dust),
      },
      {
        geometry: geometry.fragments,
        material: this.materials.oreRock(group.tier, true),
        matrix: new THREE.Matrix4(),
        triangles: triangleCount(geometry.fragments),
      },
    ];
  }

  /** Small shared material set. Keys are stable, so cells still batch by material and state. */
  private resourceMaterial(
    kind: "water-live" | "water-recovery" | "fire-rock" | "ore-scar" | "ore-dust",
    tier: number,
  ): THREE.MeshStandardMaterial {
    const key = `${kind}:${tier}`;
    const cached = this.resourceMaterials.get(key);
    if (cached) return cached;
    const palette = paletteForTier(tier);
    let material: THREE.MeshStandardMaterial;

    if (kind === "water-live" || kind === "water-recovery") {
      material = new THREE.MeshStandardMaterial({
        name: `resource-${kind}-${tier}`,
        color: new THREE.Color(palette.accent).lerp(new THREE.Color(0xa8dce4), 0.58),
        emissive: new THREE.Color(palette.accent),
        emissiveIntensity: kind === "water-live" ? 0.18 : 0.045,
        roughness: 0.3,
        metalness: 0,
        transparent: true,
        opacity: kind === "water-live" ? 0.32 : 0.1,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      material.userData.entityCastShadow = false;
    } else if (kind === "fire-rock") {
      material = new THREE.MeshStandardMaterial({
        name: "campfire-ring-rock",
        color: 0x4a4844,
        roughness: 0.97,
        metalness: 0,
        flatShading: true,
      });
    } else if (kind === "ore-scar") {
      material = new THREE.MeshStandardMaterial({
        name: `ore-worked-scar-${tier}`,
        color: new THREE.Color(palette.body).multiplyScalar(0.16),
        roughness: 1,
        metalness: 0,
        flatShading: true,
      });
    } else {
      material = new THREE.MeshStandardMaterial({
        name: `ore-worked-dust-${tier}`,
        color: new THREE.Color(palette.body).multiplyScalar(0.48),
        roughness: 1,
        metalness: 0,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      material.userData.entityCastShadow = false;
    }
    this.resourceMaterials.set(key, material);
    return material;
  }

  // -------------------------------------------------------------- seams

  /**
   * The ore seam geometry for one asset is a thin, branching fill inside a surface fracture.
   *
   * Built from the ACTUAL bounding box of the collected parts, not the manifest's size, because the
   * manifest records extent and says nothing about where the origin sits — a seam placed off a
   * guessed origin floats beside its rock half the time.
   *
   * Cached per asset and authored palette tier. Low-contrast palettes receive a slightly wider
   * fracture, while every node in the tier still shares one geometry and batches by material cell.
   */
  private seamPart(assetId: string, tier: number, parts: readonly SourcePart[]): SourcePart | null {
    const geometry = this.seamGeometry(assetId, tier, parts);
    if (!geometry) return null;
    return {
      geometry,
      material: this.materials.oreRock(tier, false),
      matrix: new THREE.Matrix4(),
      triangles: triangleCount(geometry),
      resourceDetail: { kind: "oreVein" },
    };
  }

  private seamGeometry(
    assetId: string,
    tier: number,
    parts: readonly SourcePart[],
  ): THREE.BufferGeometry | null {
    const palette = paletteForTier(tier);
    const cacheKey = `${assetId}:${palette.tier}`;
    const cached = this.seamGeometries.get(cacheKey);
    if (cached) return cached;

    const box = this.partsBounds(parts);
    if (box.isEmpty()) return null;

    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(centre);
    if (size.x <= 0 || size.y <= 0 || size.z <= 0) return null;

    const rng = new Rng(hashString(`${assetId}:fracture`));
    const direction = rng.float(0.18, Math.PI * 0.82);
    const points: Array<readonly [number, number]> = [];
    for (let index = 0; index < 7; index += 1) {
      const t = -0.43 + index * (0.86 / 6);
      const cross = rng.float(-0.055, 0.055);
      points.push([
        centre.x + Math.cos(direction) * size.x * t - Math.sin(direction) * size.x * cross,
        centre.z + Math.sin(direction) * size.z * t + Math.cos(direction) * size.z * cross,
      ]);
    }

    const surfaceMeshes = parts.map((part) => {
      const mesh = new THREE.Mesh(part.geometry, part.material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(part.matrix);
      mesh.matrixWorld.copy(part.matrix);
      return mesh;
    });
    const surfaceRay = new THREE.Raycaster();
    surfaceRay.near = 0;
    surfaceRay.far = size.y * 1.5;
    const rayOrigin = new THREE.Vector3();
    const veins: THREE.BufferGeometry[] = [];
    const surfaceY = (x: number, z: number): number => {
      rayOrigin.set(x, box.max.y + size.y * 0.2, z);
      surfaceRay.set(rayOrigin, DOWN_AXIS);
      let sampled = Number.NEGATIVE_INFINITY;
      for (const mesh of surfaceMeshes) {
        const hit = surfaceRay.intersectObject(mesh, false)[0];
        if (hit) sampled = Math.max(sampled, hit.point.y);
      }
      if (Number.isFinite(sampled)) return sampled;

      const nx = (x - centre.x) / Math.max(size.x * 0.5, 0.001);
      const nz = (z - centre.z) / Math.max(size.z * 0.5, 0.001);
      const radial = Math.min(1, Math.hypot(nx, nz));
      return box.max.y - size.y * (0.06 + radial * radial * 0.24);
    };
    const addSegment = (
      from: readonly [number, number],
      to: readonly [number, number],
      width: number,
    ): void => {
      const fromY = surfaceY(from[0], from[1]);
      const toY = surfaceY(to[0], to[1]);
      const direction3d = new THREE.Vector3(
        to[0] - from[0],
        toY - fromY,
        to[1] - from[1],
      );
      const length = direction3d.length();
      if (length < 0.001) return;
      const x = (from[0] + to[0]) * 0.5;
      const z = (from[1] + to[1]) * 0.5;
      const thickness = Math.max(size.y * 0.014, 0.007);
      const vein = new THREE.BoxGeometry(length, thickness, width);
      vein.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(X_AXIS, direction3d.normalize()));
      vein.translate(x, (fromY + toY) * 0.5 - thickness * 0.32, z);
      veins.push(vein);
    };

    const body = new THREE.Color(palette.body);
    const metal = new THREE.Color(palette.metal);
    const bodyLuminance = body.r * 0.2126 + body.g * 0.7152 + body.b * 0.0722;
    const metalLuminance = metal.r * 0.2126 + metal.g * 0.7152 + metal.b * 0.0722;
    const luminanceGap = Math.abs(metalLuminance - bodyLuminance);
    const contrastSupport = 1 - THREE.MathUtils.smoothstep(luminanceGap, 0.08, 0.24);
    const widthRatio = THREE.MathUtils.lerp(0.032, 0.048, contrastSupport);
    const width = Math.max(Math.min(size.x, size.z) * widthRatio, 0.016);
    for (let index = 0; index < points.length - 1; index += 1) {
      addSegment(points[index]!, points[index + 1]!, width * rng.float(0.72, 1.08));
    }
    for (const branchIndex of [1, 3, 5] as const) {
      const origin = points[branchIndex]!;
      const branchAngle = direction + (branchIndex % 2 === 0 ? 1 : -1) * rng.float(0.55, 0.92);
      const branchLength = Math.min(size.x, size.z) * rng.float(0.15, 0.24);
      addSegment(origin, [
        origin[0] + Math.cos(branchAngle) * branchLength,
        origin[1] + Math.sin(branchAngle) * branchLength,
      ], width * 0.62);
    }

    const merged = mergeGeometries(veins, false);
    for (const vein of veins) vein.dispose();
    if (!merged) return null;
    merged.computeBoundingSphere();
    this.seamGeometries.set(cacheKey, merged);
    return merged;
  }

  // ---------------------------------------------------------- animation

  /**
   * Gives one rigged object a looping clip and a motion state machine.
   *
   * Two sources of variety, both deterministic from the entity id so a screenshot is reproducible:
   * WHICH idle clip (four humanoid idles, so a row of NPCs is not doing the same thing) and WHERE
   * in the clip it starts (so the two who did land on the same clip are not in lockstep). Timescale
   * is nudged +/-12% for the same reason — identical loop lengths resynchronise within a minute.
   */
  private attachRig(record: ViewRecord, root: THREE.Object3D, assetId: string): RigState | null {
    this.ensurePlayback(record, root, assetId);
    const state = record.playback;
    if (!state) return null;
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(state.clip);
    action.setLoop(THREE.LoopRepeat, Infinity).play();
    const rig: RigState = {
      mixer, root, action, previousAction: null, replayActions: new Map(), hitAction: null, clipName: state.clip.name,
      motion: record.motion, resting: record.resting, idleTimeScale: record.idleTimeScale,
    };
    return rig;
  }

  private ensurePlayback(record: ViewRecord, root: THREE.Object3D, assetId: string): void {
    if (record.playback) return;
    const clip = this.firstFittingClip(assetId, this.clipCandidates(assetId, record.entityId, "idle"), root);
    if (!clip) return;
    const phase = new Rng(hashString(record.entityId) ^ 0x18ab_54e3).float(0, 1);
    record.playback = createCreaturePlayback(clip, record.idleTimeScale, phase);
  }

  private motionClip(record: ViewRecord, motion: CharacterMotion, impactSide?: "left" | "right" | "front"): THREE.AnimationClip | null {
    const group = this.groups.get(record.groupKey);
    if (!group) return null;
    const root = record.rig?.root ?? this.sourceOf(group.assetId);
    if (!root) return null;
    const speed = gaitSpeed(record, motion);
    // Explicit authoring controls still inspect the requested native clip. Runtime pursuit can
    // choose a walk without changing semantic combat/movement intent or the shared motion clock.
    const selected = this.locomotionIntents.has(record.entityId) ? motion
      : selectSpeedMatchedLocomotion(motion, speed, this.assets.entry(group.assetId),
        record.scale * record.build[2] * record.scaleAxes[2]).motion;
    const candidates = this.clipCandidates(group.assetId, record.entityId, selected, speed);
    if (selected !== motion) candidates.push(...this.clipCandidates(group.assetId, record.entityId, motion, speed)
      .filter(name => !candidates.includes(name)));
    if (motion === "hit" && impactSide && impactSide !== "front") {
      const directional = impactSide === "left" ? "HitLeft" : "HitRight";
      if (this.assets.entry(group.assetId)?.animations?.includes(directional)) candidates.unshift(directional);
    }
    const clip = this.firstFittingClip(
      group.assetId,
      candidates, root,
    );
    if (clip || motion !== "hit") return clip;
    if (!this.missingHitClips.has(group.assetId)) {
      const idle = this.firstFittingClip(group.assetId, this.clipCandidates(group.assetId, record.entityId, "idle"), root);
      this.missingHitClips.set(group.assetId, idle ? missingCreatureHit(root, idle) : null);
    }
    return this.missingHitClips.get(group.assetId) ?? null;
  }

  /** Motion intent updates the shared clock; both skeletal representations sample that clock. */
  private setMotion(record: ViewRecord, motion: CharacterMotion, interruptOneShot = false, restart = false,
    impactSide?: "left" | "right" | "front"): void {
    if (motion === "idle" || motion === "walk" || motion === "run") {
      motion = this.locomotionIntents.get(record.entityId) ?? motion;
    }
    const group = this.groups.get(record.groupKey);
    const root = record.rig?.root ?? (group ? this.sourceOf(group.assetId) : null);
    if (!group || !root || !record.rigCandidate) return;
    this.ensurePlayback(record, root, group.assetId);
    const state = record.playback;
    if (!state) return;
    if (record.motion === "death" && (record.spent || motion === "death")) return;
    if (motion === 'death') state.hitOverlay = null;
    if (!ONE_SHOT_MOTIONS.has(motion)) record.resting = motion;
    const desiredGaitClip = motion === "run" && this.assets.entry(group.assetId)?.locomotionPolicy === "speed-matched"
      ? this.motionClip(record, motion) : null;
    if (record.motion === motion && !restart && (!desiredGaitClip || desiredGaitClip === state.clip)) {
      state.timeScale = this.motionTimeScale(
        group.assetId, motion, state.clip, record.idleTimeScale, gaitSpeed(record, motion),
        record.scale * record.build[2] * record.scaleAxes[2],
      );
      return;
    }
    if (ONE_SHOT_MOTIONS.has(record.motion) && !ONE_SHOT_MOTIONS.has(motion)
      && motion !== "death" && state.time < state.clip.duration && !interruptOneShot) return;
    const clip = desiredGaitClip ?? this.motionClip(record, motion, impactSide);
    if (!clip) {
      if (motion === "death") {
        record.motion = "death";
        state.loop = false;
        state.timeScale = 0;
        state.previousClip = null;
        this.sampleRig(record);
        this.animated.delete(record);
      }
      return;
    }
    const oneShot = ONE_SHOT_MOTIONS.has(motion) || motion === "death";
    const timeScale = this.motionTimeScale(
      group.assetId, motion, clip, record.idleTimeScale, gaitSpeed(record, motion),
      record.scale * record.build[2] * record.scaleAxes[2],
    );
    if (clip.name === state.clip.name && !oneShot) {
      state.timeScale = timeScale;
      state.loop = true;
    } else {
      transitionCreaturePlayback(state, clip, timeScale, !oneShot, oneShot ? 0.06 : 0.18);
    }
    record.motion = motion;
    if (record.rig) {
      this.sampleRig(record);
      this.animated.add(record);
    }
  }

  /** Evaluates a full rig at exactly the same time and weights as the instanced palette path. */
  private sampleRig(record: ViewRecord): void {
    const rig = record.rig;
    const state = record.playback;
    if (!rig || !state) return;
    restoreTerrainRig(rig.root);
    const action = rig.mixer.clipAction(state.clip);
    let previous = state.previousClip ? rig.mixer.clipAction(state.previousClip) : null;
    if (state.previousClip === state.clip) {
      // A second hit can restart the same clip before its first recoil has settled. Three caches
      // one action per clip; a separate action is necessary to blend the two different phases.
      previous = rig.replayActions.get(state.clip) ?? null;
      if (!previous) {
        previous = rig.mixer.clipAction(state.clip.clone());
        rig.replayActions.set(state.clip, previous);
      }
    }
    if (rig.action !== action || rig.previousAction !== previous) {
      rig.mixer.stopAllAction();
      if (previous) previous.setLoop(THREE.LoopRepeat, Infinity).play();
      action.setLoop(THREE.LoopRepeat, Infinity).play();
      rig.action = action;
      rig.previousAction = previous;
    }
    const blend = creatureBlend(state);
    action.enabled = true;
    action.time = state.time;
    action.timeScale = state.timeScale;
    action.setEffectiveWeight(blend);
    if (previous) {
      previous.enabled = true;
      previous.time = state.previousTime;
      previous.timeScale = state.previousTimeScale;
      previous.setEffectiveWeight(1 - blend);
    }
    const overlay = state.hitOverlay;
    const hitAction = overlay ? rig.mixer.clipAction(overlay.clip) : null;
    if (rig.hitAction && rig.hitAction !== hitAction) rig.hitAction.stop();
    rig.hitAction = hitAction;
    if (hitAction && overlay) {
      hitAction.enabled = true;
      hitAction.setLoop(THREE.LoopOnce, 1);
      hitAction.clampWhenFinished = true;
      hitAction.play();
      hitAction.time = overlay.time;
      hitAction.setEffectiveWeight(hitOverlayWeight(overlay.time, overlay.clip.duration));
    }
    rig.clipName = state.clip.name;
    rig.motion = record.motion;
    rig.resting = record.resting;
    rig.mixer.update(0);
    this.placeUnique(record);
  }

  /** Idle may vary per person. A gait or one-shot must match what the entity is doing. */
  private motionTimeScale(
    assetId: string,
    motion: CharacterMotion,
    clip: THREE.AnimationClip,
    idleTimeScale: number,
    moveSpeedMps?: number,
    drawnStrideScale = 1,
  ): number {
    if (motion === "idle") return idleTimeScale;
    const entry = this.assets.entry(assetId);
    const own = entry?.animations ?? [];
    if ((motion === "walk" || motion === "run") && own.length === 0) {
      // The shared humanoid library, on the player's own policies: the walk speed-matched to the
      // ground it covers, the jog at the player's presentation cadence — brisk over planted,
      // because 0.71x exact planting already reads as slow motion at the PLAYER's 4.2 and only
      // gets worse below it. A speed of 0 (a record never stepped) clamps to the same 0.9 floor
      // the player's acceleration band uses.
      if (clip.name === "Jog_Fwd_Loop") {
        return runPresentationScale(moveSpeedMps ?? 0);
      }
      if (clip.name === "Walk_Loop" && moveSpeedMps) {
        const rate = Math.min(
          WALK_RATE_MAX,
          Math.max(WALK_RATE_MIN, moveSpeedMps / HUMANOID_WALK_IMPLIED_MPS),
        );
        return clip.duration > 0 ? Math.min(rate, MAX_WALK_CADENCE_HZ * clip.duration) : rate;
      }
    }
    // Match the gait to the ground it covers.
    //
    // These cycles are authored in place, so playing them at their authored tempo under a body the
    // simulation is moving is pure foot slide: the chicken's cycle implies 0.75 m/s and it was
    // travelling at 3.1, so its legs ran four times too slowly for the distance covered - "the feet
    // barely move and they move way too fast". `tools/build-animals.ts` measures the implied speed
    // off the feet and puts it in the manifest. That measurement is in source-model metres.
    // The placement scales its forward stride by the same Z factor in live rigs and sampled
    // instances, so the world-space implied speed must include that factor before retiming.
    //
    // Clamped because a few rigs have no real stride to measure - a viper slithers, a crab scuttles
    // sideways, a fish swims - and their implied speed is near zero, which would ask for a playback
    // rate in the tens. Those have no plantable foot either, so the slide does not read.
    // Each gait is retimed against its OWN measured stride. A run cycle covers far more ground per
    // cycle than a walk, so dividing a pursuit speed by the walk's implied speed asks for a rate
    // several times too high — which is the shape of the original bug, in miniature.
    const measuredMotion = entry?.locomotionPolicy === "speed-matched" && motion === "run" && /^walk/i.test(clip.name)
      ? "walk" : motion;
    const implied = measuredMotion === "run"
      ? entry?.impliedRunMps ?? entry?.impliedWalkMps
      : entry?.impliedWalkMps;
    if ((motion === "walk" || motion === "run") && implied !== undefined && Number.isFinite(implied) && implied > 0
      && moveSpeedMps !== undefined && Number.isFinite(moveSpeedMps) && moveSpeedMps > 0) {
      const strideScale = Number.isFinite(drawnStrideScale) && Math.abs(drawnStrideScale) > 1e-6
        ? Math.abs(drawnStrideScale) : 1;
      // A measured stride must cover the actual requested distance, including fast pursuit.
      // Capping this rate leaves a planted foot moving across the ground under the actor.
      return moveSpeedMps / (implied * strideScale);
    }
    return 1;
  }

  /**
   * Plays a one-shot on an entity's rig: a swing, or a flinch when it takes one.
   *
   * CORRECTION: this said "OPT-IN and currently uncalled". `app/loop.ts:493` calls it with
   * `("attack")` on the swinger and `:497` with `("hit")` on whatever it landed on, both off the
   * `CombatSystem.consumeHits()` stream that already drives the floating damage numbers. Verified
   * live against rill_skitterlings_1 (runs/corealm/audit/ev2-combat.ts): `getDrawnBounds` reports
   * `animated:Idle` at rest, `animated:HitRecieve` within 700 ms of the first swing and
   * `animated:Death` once it dies.
   *
   * Both full and sampled rigs consume the same action. A near combat target gets a priority
   * promotion when a full rig is affordable; distance never suppresses the action itself.
   * An optional duration aligns the authored clip with the simulation's committed attack timeline.
   */
  actionDurationSeconds(entityId: EntityId, motion: "attack" | "hit", impactSide?: "left" | "right" | "front"): number | null {
    const record = this.records.get(entityId);
    if (!record || record.spent || record.motion === "death") return null;
    const clip = this.motionClip(record, motion, impactSide);
    return clip && Number.isFinite(clip.duration) && clip.duration > 0 ? clip.duration : null;
  }

  playAction(entityId: EntityId, motion: "attack" | "hit",
    options?: { durationSeconds?: number; impactSide?: "left" | "right" | "front" }): boolean {
    const record = this.records.get(entityId);
    if (!record) return false;
    if (motion === 'hit') {
      if (!record.playback || record.spent || record.motion === 'death') return false;
      const group = this.groups.get(record.groupKey);
      const root = record.rig?.root ?? (group ? this.sourceOf(group.assetId) : null);
      const nativeHit = this.motionClip(record, 'hit', options?.impactSide);
      const idle = this.motionClip(record, 'idle');
      if (!root || !group || !nativeHit || !idle) return false;
      const key = `${group.assetId}:${nativeHit.uuid}`;
      if (!this.hitOverlayClips.has(key)) this.hitOverlayClips.set(key, createMaskedHitOverlay(root, nativeHit, idle));
      const masked = this.hitOverlayClips.get(key)!;
      const clip = masked.clip;
      if (!clip) return false;
      const seconds = options?.durationSeconds;
      record.playback.hitOverlay = { clip, time: 0, bones: masked.boneNames, maskStatus: masked.status,
        timeScale: seconds !== undefined && Number.isFinite(seconds) && seconds > 0 ? clip.duration / seconds : 1 };
      // The base gait clock, root interpolation and support limbs continue unchanged.
      if (record.rig) { this.sampleRig(record); this.animated.add(record); }
      else if (group.animationLod && record.slot >= 0) this.writeSlot(group, record);
      return true;
    }
    if (!record.rig) {
      // A combat target is necessarily near the player, but an old rig inside release hysteresis
      // may still own the pool. Give this record one synchronous priority pass before giving up.
      record.actionPriority = true;
      try {
        this.rebalanceUniques();
      } finally {
        record.actionPriority = false;
      }
    }
    if (!record.playback || record.motion === "death" || record.spent) return false;
    this.setMotion(record, motion, false, true, options?.impactSide);
    if (record.motion !== motion) return false;
    const duration = options?.durationSeconds;
    if (duration !== undefined && Number.isFinite(duration) && duration > 0 && record.playback) {
      record.playback.timeScale = record.playback.clip.duration / duration;
      this.sampleRig(record);
    }
    return true;
  }

  /** Explicit motion intent for stationary production-rig authoring and motion inspection. */
  setLocomotion(entityId: EntityId, motion: "idle" | "walk" | "run"): boolean {
    const record = this.records.get(entityId);
    if (!record?.rigCandidate || record.spent) return false;
    this.locomotionIntents.set(entityId, motion);
    this.setMotion(record, motion, true);
    return record.motion === motion;
  }

  clearLocomotion(entityId: EntityId): void {
    this.locomotionIntents.delete(entityId);
  }

  /**
   * Clip names to try for a motion, best first.
   *
   * An asset that ships its own clips uses them and nothing else: the monster packs are not the
   * 65-joint humanoid, so a humanoid clip would bind to bones that do not exist. Everything else
   * draws from the shared library; for `idle` that list is rotated by a seed so a row of NPCs is not
   * doing the same thing.
   *
   * The catch-all "then anything it ships" tail applies to `idle` only. For the other motions a
   * miss returns nothing and `setMotion` leaves the current clip alone, which is right: playing
   * whatever clip happened to be first because a pack has no Walk would make a bee dance across the
   * meadow.
   */
  private clipCandidates(
    assetId: string,
    varySeed: string,
    motion: CharacterMotion,
    gaitSpeedMps?: number,
  ): string[] {
    const own = this.assets.entry(assetId)?.animations ?? [];
    if (own.length > 0) {
      return ownClipCandidates(own, motion);
    }
    if (motion !== "idle") {
      const candidates = [...HUMANOID_CLIPS[motion]];
      // A "run" too slow for the jog prefers the walk cycle sped up — see HUMANOID_JOG_MIN_RATE.
      // Reordered rather than filtered, so a rig somehow missing Walk_Loop still jogs.
      if ((motion === "run" || motion === "walk")
        && gaitSpeedMps !== undefined
        && gaitSpeedMps < HUMANOID_JOG_IMPLIED_MPS * HUMANOID_JOG_MIN_RATE
        && candidates.includes("Walk_Loop")) {
        return ["Walk_Loop", ...candidates.filter((name) => name !== "Walk_Loop")];
      }
      return candidates;
    }
    const start = new Rng(hashString(varySeed) ^ 0x51ed_27b1).int(0, HUMANOID_IDLES.length - 1);
    return [...HUMANOID_IDLES.slice(start), ...HUMANOID_IDLES.slice(0, start)];
  }

  /**
   * The first clip in `names` that this rig can actually play, or null.
   *
   * `assetId` is not decoration. `AssetRegistry` keeps the shared 65-joint library in one
   * name-keyed map and every pack's own clips in a SECOND map keyed `assetId:clipName`, precisely
   * because enemy_crab, enemy_blob and enemy_skull all export clips called `Idle`, `Walk` and
   * `Death` on three different skeletons. `assets.clip("Idle")` therefore returns undefined for a
   * monster pack — asking it alone means no enemy ever resolves a clip at all and every one of them
   * bakes from bind pose. Try the asset's own clip first, fall back to the shared library.
   */
  private firstFittingClip(
    assetId: string,
    names: readonly string[],
    root: THREE.Object3D,
  ): THREE.AnimationClip | null {
    for (const name of names) {
      const clip = this.assets.clipOf(assetId, name) ?? this.assets.clip(name);
      if (clip && clipFits(root, clip)) return clip;
    }
    return null;
  }

  /**
   * Whether this entity may take the non-instanced path, checked BEFORE the skeleton clone.
   *
   * Deciding after cloning would mean paying for ~50 rejected character clones at boot, which is
   * the kind of cost that only shows up as "the loading screen got slower" with nothing to blame.
   *
   * TWO POOLS, not one ceiling. `NAMED_CHARACTER_SHARE` explains why at length; the short version is
   * that a single counter plus a reserve cannot work, because entity order is region order and the
   * named characters are reached first, so they spend past the non-named ceiling and every enemy in
   * the world is refused regardless of what the ceiling is set to. That was the measured state:
   * `uniqueViews: 4`, all four NPCs, `animatedLastFrame: 0` everywhere else.
   */
  private canAffordUnique(
    archetype: Archetype,
    assetId: string,
    source: THREE.Object3D,
    character: CharacterSpec | null,
    position: THREE.Vector3,
  ): boolean {
    const cost = this.uniqueCostOf(assetId, source, character);
    if (cost === 0) return false;

    // A boss is never instanced. There is one of them, the fight is the climax of its region, and
    // the instanced fallback freezes a rig on a single baked idle frame — which is why Ordrun
    // stood through a two-phase fight in a pose that read as a bug. Twenty draw calls against a
    // budget with eighty to spare at the worst dungeon pose is the right trade.
    if (archetype === "boss") return true;
    if (this.countUnique() >= this.maxUniqueViews) return false;
    // Distance before budget. Both pools used to be spent first-come in entity order, which is
    // region order, so the four Coldbrace NPCs took the whole named pool and rill_skitterlings_1..3
    // took the whole other pool — measured, four of the world's fifty enemies, and none of them
    // necessarily anywhere near the player. See `UNIQUE_RELEASE_FACTOR`.
    if (this.viewer && position.distanceToSquared(this.viewer) > this.animationRadiusSq) return false;

    const named = archetype === "npc";
    const namedBudget = Math.round(this.maxUniqueDrawCalls * NAMED_CHARACTER_SHARE);
    return named
      ? this.namedDrawCalls + cost <= namedBudget
      : this.otherDrawCalls + cost <= this.maxUniqueDrawCalls - namedBudget;
  }

  /**
   * What one non-instanced copy of this entity costs in draw calls, shadow pass included.
   *
   * For a dressed character that is the MERGED mesh count, not the sum of the parts: `ensureGroup`
   * has already assembled this exact spec once to bake its instanced pose, and recorded the answer.
   * Measured against the real GLBs, merging matters — an unmerged male ranger is 13 meshes and a
   * merged one is 6.
   */
  private uniqueCostOf(
    assetId: string,
    source: THREE.Object3D,
    character: CharacterSpec | null,
  ): number {
    if (!character) return this.meshesIn(assetId, source) * 2;
    const known = this.characterCosts.get(character.key);
    if (known !== undefined) return known * 2;
    // No assembly has happened yet: charge the unmerged sum, which can only over-estimate.
    let meshes = this.countMeshesOf(character.bodyAssetId);
    for (const partId of character.partAssetIds) meshes += this.countMeshesOf(partId);
    return Math.max(2, meshes * 2);
  }

  private countMeshesOf(assetId: string): number {
    const source = this.sources.get(assetId);
    return source ? this.meshesIn(assetId, source) : 1;
  }

  private meshesIn(assetId: string, source: THREE.Object3D): number {
    const cached = this.meshCounts.get(assetId);
    if (cached !== undefined) return cached;
    let count = 0;
    source.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) count += 1;
    });
    this.meshCounts.set(assetId, count);
    return count;
  }

  private isRigged(assetId: string): boolean {
    // Item skins deform only when worn by CharacterRig. A displayed or dropped garment
    // retains its authored bind pose; humanoid idle clips would fold and sink it.
    if (this.assets.entry(assetId)?.itemModel) return false;
    const cached = this.riggedAssets.get(assetId);
    if (cached !== undefined) return cached;
    if (!this.assets.isLoaded(assetId)) return false;
    // Prefer the source graph: `AssetRegistry.instance()` deep-clones, and doing that per lookup
    // once cost a full character clone every time a group was resolved.
    const probe = this.sources.get(assetId) ?? this.assets.instance(assetId);
    let rigged = false;
    probe.traverse((child) => {
      if ((child as THREE.SkinnedMesh).isSkinnedMesh) rigged = true;
    });
    this.riggedAssets.set(assetId, rigged);
    return rigged;
  }

  // ------------------------------------------------------------- slots

  private takeSlot(group: InstanceGroup, entityId: EntityId): number {
    const reused = group.free.pop();
    if (reused !== undefined) {
      group.slots[reused] = entityId;
      return reused;
    }
    // No capacity ceiling any more: a `BatchedMesh` instance is allocated per (part, slot) on the
    // first write and the batch grows itself, so there is nothing to pre-size and nothing to
    // rebuild. The old `resize` path — throw away every instance buffer, rebuild, re-write every
    // slot — is gone with it.
    group.slots.push(entityId);
    return group.slots.length - 1;
  }

  // ----------------------------------------------------------- batching

  /**
   * The batch a part draws through, created on first use.
   *
   * Keyed by material identity AND geometry attribute signature. The second half is not optional:
   * `BatchedMesh` throws if an added geometry is missing an attribute the batch already carries,
   * and the kits ship both `COLOR_0,NORMAL,POSITION,TEXCOORD_0` (134 primitives) and
   * `NORMAL,POSITION,TEXCOORD_0` (126) under the same material names. Splitting on the signature
   * turns that from a crash into at most one extra batch per material, and it is also exactly the
   * split `vertexColors` needs — GLTFLoader compiles a separate material for a vertex-coloured
   * primitive, and those two must not share a draw.
   */
  private batchFor(part: SourcePart, cell: string): Batch | null {
    const position = part.geometry.getAttribute("position");
    if (!position) return null;
    const key = `${cell}||${materialBatchKey(part.material)}||${attributeSignature(part.geometry)}`;
    const existing = this.batches.get(key);
    if (existing) return existing;

    const vertices = position.count;
    const indices = part.geometry.getIndex()?.count ?? 0;
    const maxInstances = BATCH_INSTANCE_STEP;
    const maxVertices = Math.max(BATCH_VERTEX_STEP, vertices * 2);
    const maxIndices = Math.max(BATCH_VERTEX_STEP * 3, indices * 2);
    const mesh = new THREE.BatchedMesh(maxInstances, maxVertices, maxIndices, part.material);
    mesh.name = `entity-batch-${this.batches.size}`;
    const castsShadow = part.material.userData.entityCastShadow !== false;
    mesh.castShadow = castsShadow;
    mesh.receiveShadow = castsShadow;
    if ((part.windStrength ?? 0) > 0) {
      mesh.customDepthMaterial = this.materials.windShadow(part.material, part.windStrength!, "depth");
      mesh.customDistanceMaterial = this.materials.windShadow(part.material, part.windStrength!, "distance");
    }
    // Per-INSTANCE culling is the whole reason this class is here, and it makes the object-level
    // test both redundant and wrong: a batch's bounding sphere spans every region that uses the
    // material, so it would never cull, while `onBeforeRender` (and `onBeforeShadow`) already drops
    // the instances outside the frustum and submits nothing at all when none survive.
    // Object-level culling is back on and it is the cheap half: one sphere test drops a whole
    // off-screen cell before the renderer touches its material or its instances. Per-instance
    // culling then trims what is left, which is what keeps the triangle count honest inside the
    // cell the camera is standing in.
    mesh.frustumCulled = true;
    mesh.perObjectFrustumCulled = true;
    const detail = part.resourceDetail;
    if (detail?.kind === "fish") mesh.renderOrder = SUBMERGED_FISH_RENDER_ORDER;
    else if (detail?.kind === "ripple" || detail?.kind === "bubbles") {
      mesh.renderOrder = FISH_MARKER_RENDER_ORDER;
    }
    // The per-frame instance sort only earns its cost when draw order changes the picture.
    mesh.sortObjects = part.material.transparent === true;
    const batch: Batch = {
      key,
      mesh,
      maxInstances,
      maxVertices,
      maxIndices,
      usedInstances: 0,
      usedVertices: 0,
      usedIndices: 0,
      geometryIds: new Map(),
      owners: [],
    };
    this.batches.set(key, batch);
    this.batchOwners.set(mesh, batch);
    this.group.add(mesh);
    return batch;
  }

  /** Uploads one geometry into a batch, growing its buffers first if it will not fit. */
  private addBatchGeometry(batch: Batch, geometry: THREE.BufferGeometry, windStrength = 0): number {
    const existing = batch.geometryIds.get(geometry);
    if (existing !== undefined) return existing;

    const vertices = geometry.getAttribute("position")?.count ?? 0;
    const indices = geometry.getIndex()?.count ?? 0;
    if (batch.usedVertices + vertices > batch.maxVertices
      || batch.usedIndices + indices > batch.maxIndices) {
      batch.maxVertices = Math.max(batch.maxVertices * 2, batch.usedVertices + vertices);
      batch.maxIndices = Math.max(batch.maxIndices * 2, batch.usedIndices + indices);
      batch.mesh.setGeometrySize(batch.maxVertices, batch.maxIndices);
    }
    let upload = geometry;
    if (windStrength > 0) {
      // BatchedMesh copies these bounds and uses them for both camera and shadow culling.
      // Share the source buffers while giving the upload its own expanded bounds: scattering
      // still owns the original geometry, and no second set of vertex buffers is needed here.
      upload = new THREE.BufferGeometry();
      upload.setIndex(geometry.index);
      for (const [name, attribute] of Object.entries(geometry.attributes)) upload.setAttribute(name, attribute);
      upload.boundingBox = geometry.boundingBox?.clone()
        ?? new THREE.Box3().setFromBufferAttribute(geometry.getAttribute("position") as THREE.BufferAttribute);
      upload.boundingSphere = geometry.boundingSphere?.clone()
        ?? upload.boundingBox.getBoundingSphere(new THREE.Sphere());
      const margin = scatterWindMargin(new THREE.Matrix4(), windStrength);
      upload.boundingBox.expandByScalar(margin);
      upload.boundingSphere.radius += margin;
    }
    const id = batch.mesh.addGeometry(upload);
    batch.usedVertices += vertices;
    batch.usedIndices += indices;
    batch.geometryIds.set(geometry, id);
    return id;
  }

  /** The instance one slot draws this part through, allocated on first use. */
  private instanceFor(draw: PartDraw, group: InstanceGroup, slot: number): number {
    const existing = draw.instances[slot];
    if (existing !== undefined && existing >= 0) return existing;
    const batch = draw.batch;
    if (batch.usedInstances >= batch.maxInstances) {
      batch.maxInstances = Math.max(batch.maxInstances * 2, batch.usedInstances + 1);
      batch.mesh.setInstanceCount(batch.maxInstances);
    }
    const id = batch.mesh.addInstance(draw.geometryId);
    // `BatchedMesh` never invalidates its own bounds, and the object-level frustum test reads them.
    // A batch that keeps a sphere from when it held three instances culls away the other nine
    // hundred, which is the whole cell going missing from one camera angle and not another.
    batch.mesh.boundingSphere = null;
    batch.usedInstances += 1;
    batch.owners[id] = { group, slot };
    draw.instances[slot] = id;
    return id;
  }

  private buildDraws(parts: readonly SourcePart[], cell: string, archetype: Archetype): PartDraw[] {
    const tintable = TINTABLE_ARCHETYPES.has(archetype);
    const architecture = ARCHITECTURE_ARCHETYPES.has(archetype);
    const draws: PartDraw[] = [];
    for (const part of parts) {
      const batch = this.batchFor(part, cell);
      if (!batch) continue;
      draws.push({
        batch,
        geometryId: this.addBatchGeometry(batch, part.geometry, part.windStrength),
        part,
        instances: [],
        role: tintable
          ? tintRoleFor(part.material.name)
          : architecture && architectureMaterialRole(part.material.name) ? "architecture" : "none",
        tints: [],
      });
    }
    return draws;
  }

  /** Hands every instance a set of draws holds back to its batch. */
  private releaseDraws(draws: readonly PartDraw[]): void {
    for (const draw of draws) {
      for (const id of draw.instances) {
        if (id === undefined || id < 0) continue;
        draw.batch.mesh.deleteInstance(id);
        draw.batch.mesh.boundingSphere = null;
        draw.batch.owners[id] = null;
        draw.batch.usedInstances = Math.max(0, draw.batch.usedInstances - 1);
      }
      draw.instances.length = 0;
      draw.tints.length = 0;
    }
  }

  /**
   * Writes one entity's instance matrix into whichever pose variant it is currently in.
   *
   * The orientation is where the terrain normal lands. Round 3 composed it from `rotationY` alone,
   * so nothing in the world bedded into a slope: 34 of 159 surface entities stand on ground steeper
   * than 10 degrees and the worst — a 5.3 m ore rock on a 48.9-degree face — had 3.02 m of daylight
   * under one edge. `view.groundNormal` is slerped in from vertical by `tilt`, applied OUTSIDE the
   * yaw so a rock still faces the bearing the world layer gave it.
   */
  private writeSlot(group: InstanceGroup, record: ViewRecord): void {
    const slot = record.slot;
    if (slot < 0) return;
    // A dissolved corpse is switched off here rather than only in `tickCorpseFade`, because
    // `syncMotion` calls this for every enemy every frame and would otherwise put it straight back
    // on screen. Enemies are in `MOVING_ARCHETYPES`, and a dead one is still an enemy.
    if (record.fade >= 1 || this.hiddenRoofs.has(record.entityId)) {
      group.animationLod?.hide(slot);
      for (const variant of [group.live, group.spent, group.moving]) {
        for (const draw of variant) hideInstance(draw, slot);
      }
      return;
    }
    const moving = record.movingTicks > 0 && !record.spent;

    // Module scratch, for the reason the quaternions above are: `syncMotion` calls this once per
    // moving entity per RENDER frame. Two fresh Matrix4s per call is garbage allocated in exactly
    // the frames that are already the tightest.
    const build = record.build;
    const placement = SCRATCH_PLACEMENT.compose(
      record.position,
      orientation(record.rotationY, record.normal, record.tilt, SCRATCH_QUATERNION),
      SCRATCH_SCALE.set(
        record.scale * build[0] * record.scaleAxes[0],
        record.scale * build[1] * record.scaleAxes[1],
        record.scale * build[2] * record.scaleAxes[2],
      ),
    );
    const transform = SCRATCH_TRANSFORM;

    const playback = record.playback;
    const lod = playback ? this.ensureAnimationLod(group, record) : null;
    if (lod && playback) {
      lod.set(slot, placement, {
        terrain: this.terrainPose(record, placement),
        clip: playback.clip,
        time: playback.time,
        ...(playback.previousClip ? {
          previousClip: playback.previousClip, previousTime: playback.previousTime,
        } : {}),
        blend: creatureBlend(playback),
        ...(playback.hitOverlay ? { overlay: {
          clip: playback.hitOverlay.clip, time: playback.hitOverlay.time,
          weight: hitOverlayWeight(playback.hitOverlay.time, playback.hitOverlay.clip.duration),
        } } : {}),
        opacity: 1 - record.fade,
      }, (source) => {
        if (!record.tints) return null;
        const hex = tintFor(record.tints, tintRoleFor(source.name));
        return hex === NO_TINT ? null : SCRATCH_COLOUR.setHex(hex);
      });
      for (const variant of [group.live, group.spent, group.moving]) {
        for (const draw of variant) hideInstance(draw, slot);
      }
      return;
    }
    if (record.spent) this.ensureSpent(group);
    else if (moving) this.ensureMoving(group);

    // A spent group with no geometry of its own keeps drawing its LIVE parts rather than nothing.
    // Hiding the live instance without drawing a replacement is how a worked-out node used to
    // disappear from the world entirely. The walk variant works the same way.
    const spentReady = record.spent && group.spent.length > 0;
    const movingReady = !record.spent && moving && group.moving.length > 0;
    const active = spentReady ? group.spent : movingReady ? group.moving : group.live;

    for (const draw of active) {
      const detail = draw.part.resourceDetail;
      if (detail?.kind === "fish" && detail.schoolIndex >= record.schoolCount) {
        hideInstance(draw, slot);
        continue;
      }
      this.resourcePartTransform(draw.part, record, placement, transform);
      const instance = this.instanceFor(draw, group, slot);
      draw.batch.mesh.setMatrixAt(instance, transform);
      draw.batch.mesh.setVisibleAt(instance, true);
      draw.batch.mesh.boundingSphere = null;
      this.paintInstance(draw, slot, instance, record.tints, record.architectureValue);
    }
    // An instance that is not part of the current pose is switched off, not parked at a zero-scale
    // matrix. `BatchedMesh` leaves an invisible instance out of the multi-draw entirely, so the
    // pose the entity is NOT in costs nothing — where the old `InstancedMesh` pair still submitted
    // both draws and still counted every hidden instance's triangles.
    for (const variant of [group.live, group.spent, group.moving]) {
      if (variant === active) continue;
      for (const draw of variant) hideInstance(draw, slot);
    }
  }

  /** Adds deterministic local motion to generated resource parts, then applies entity placement. */
  private resourcePartTransform(
    part: SourcePart,
    record: ViewRecord,
    placement: THREE.Matrix4,
    out: THREE.Matrix4,
  ): void {
    const detail = part.resourceDetail;
    if (!detail || detail.kind === "oreVein") {
      out.multiplyMatrices(placement, part.matrix);
      return;
    }

    const drawnYScale = Math.max(
      0.001,
      record.scale * record.build[1] * record.scaleAxes[1],
    );
    SCRATCH_DETAIL_QUATERNION.identity();
    SCRATCH_DETAIL_SCALE.set(1, 1, 1);

    if (detail.kind === "fish") {
      const pace = FISH_LOOP_RADIANS_PER_SECOND * (0.88 + detail.schoolIndex * 0.045);
      const angle = record.schoolPhase + detail.phase + this.resourceTimeSeconds * pace;
      SCRATCH_DETAIL_POSITION.set(
        Math.cos(angle) * detail.orbitX,
        record.waterOffset / drawnYScale
          + detail.depthJitter
          + Math.sin(angle * 1.7 + detail.schoolIndex) * Math.abs(detail.depthJitter) * 0.16,
        Math.sin(angle) * detail.orbitZ,
      );
      // Imported fish face along local Z. Turn that axis along the orbit tangent.
      SCRATCH_DETAIL_QUATERNION.setFromAxisAngle(Y_AXIS, -angle);
      SCRATCH_DETAIL_SCALE.setScalar(detail.scale);
    } else if (detail.kind === "ripple") {
      const speed = detail.recovery ? 0.85 : 1.35;
      const pulse = 1 + Math.sin(this.resourceTimeSeconds * speed + record.schoolPhase) * 0.06;
      SCRATCH_DETAIL_POSITION.set(0, 0.018 / drawnYScale, 0);
      SCRATCH_DETAIL_SCALE.set(pulse, 1, pulse);
    } else {
      const lift = Math.sin(this.resourceTimeSeconds * 1.7 + record.schoolPhase) * 0.035;
      SCRATCH_DETAIL_POSITION.set(0, lift / drawnYScale, 0);
    }

    SCRATCH_DETAIL.compose(
      SCRATCH_DETAIL_POSITION,
      SCRATCH_DETAIL_QUATERNION,
      SCRATCH_DETAIL_SCALE,
    );
    out.multiplyMatrices(placement, SCRATCH_DETAIL).multiply(part.matrix);
  }

  /**
   * Writes one entity's dye or architectural value shift into one batch instance when needed.
   *
   * This is the whole recolour mechanism on the instanced path, and the reason it is free.
   * `BatchedMesh.setColorAt` writes into a per-instance RGBA float texture the batch owns and the
   * shader multiplies into `vColor` (three 0.185: `USE_BATCHING_COLOR` in `color_vertex`, which the
   * fragment stage picks up as `USE_COLOR_ALPHA` and applies as `diffuseColor *= vColor`). It does
   * NOT clone a material, so the `(cell, material, attribute signature)` batch key is untouched and
   * two hundred differently dyed NPCs still share whatever draws their neighbours share. The same
   * is true of a building's quantised +/-4% neutral value shift: it changes no material key, and
   * every modular part seeded from that building's parent id receives the same multiplier.
   *
   * The white case is skipped rather than written, and that matters: the FIRST `setColorAt` on a
   * batch allocates its colours texture, which switches the whole batch onto a different compiled
   * program. Doing that to a batch on which every instance is white costs a program and buys
   * nothing.
   */
  private paintInstance(
    draw: PartDraw,
    slot: number,
    instance: number,
    tints: EntityTints | null,
    architectureValue: number,
  ): void {
    if (draw.role === "none") return;
    const token = draw.role === "architecture"
      ? architectureValue
      : tints ? tintFor(tints, draw.role) : NO_TINT;
    if (draw.tints[slot] === token) return;
    const neutral = draw.role === "architecture" ? token === 1 : token === NO_TINT;
    if (draw.tints[slot] === undefined && neutral) {
      draw.tints[slot] = token;
      return;
    }
    if (draw.role === "architecture") {
      draw.batch.mesh.setColorAt(instance, SCRATCH_COLOUR.setRGB(token, token, token));
    } else {
      draw.batch.mesh.setColorAt(instance, SCRATCH_COLOUR.setHex(token));
    }
    draw.tints[slot] = token;
  }

  /**
   * The same dye on the non-instanced path: one cloned material per (source material, tint).
   *
   * A rigged character is its own object with its own draws, so there is no batch to fragment here
   * and a clone costs nothing but the clone. It is cached anyway, keyed on the pair, because the
   * palettes are small tables and a settlement's worth of characters resolves to a handful of
   * entries — 8 of them across the whole shipped roster, measured. The clones are owned by this
   * class and freed in `dispose`; the SOURCE material is shared with the loaded asset and is never
   * touched.
   *
   * `Color.multiply` in three's working (linear) space is the same arithmetic the shader does to
   * `vColor`, so a character keeps exactly its colour when it is promoted from an instance to a rig
   * and back — which is a thing the player watches happen every time they walk into a town.
   */
  private tintedMaterial(base: THREE.Material, hex: number): THREE.Material {
    if (hex === NO_TINT) return base;
    const standard = base as THREE.MeshStandardMaterial;
    if (!standard.isMeshStandardMaterial) return base;
    const key = `${base.uuid}|${hex}`;
    const cached = this.tintedMaterials.get(key);
    if (cached) return cached;
    const clone = standard.clone();
    clone.color = standard.color.clone().multiply(SCRATCH_COLOUR.setHex(hex));
    this.tintedMaterials.set(key, clone);
    return clone;
  }

  /** Applies a record's dye to its non-instanced object, over whatever state painted it. */
  private applyEntityTint(record: ViewRecord): void {
    const tints = record.tints;
    if (!tints || !record.unique) return;
    record.unique.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mapped = materials.map((material) =>
        this.tintedMaterial(material, tintFor(tints, tintRoleFor(material.name))));
      mesh.material = mapped.length === 1 ? mapped[0]! : mapped;
    });
  }

  /** Applies a record's drawn transform to its non-instanced object. */
  private placeUnique(record: ViewRecord): void {
    if (!record.unique) return;
    record.unique.position.copy(record.position);
    record.unique.quaternion.copy(
      orientation(record.rotationY, record.normal, record.tilt, SCRATCH_QUATERNION),
    );
    const build = record.build;
    record.unique.scale.set(
      record.scale * build[0] * record.scaleAxes[0],
      record.scale * build[1] * record.scaleAxes[1],
      record.scale * build[2] * record.scaleAxes[2],
    );
    if (record.rig) {
      restoreTerrainRig(record.rig.root);
      const pose = this.terrainPose(record, new THREE.Matrix4());
      if (pose) conformTerrainRig(record.rig.root, pose);
    }
  }

  private terrainPose(record: ViewRecord, placement: THREE.Matrix4): TerrainPose | undefined {
    const heightAt = this.scene.meshHeightAt;
    const assetId = this.groups.get(record.groupKey)?.assetId ?? "";
    if (!heightAt || !/^(animal_|creature_)/.test(assetId)
      || /wasp|wraith|banshee/.test(assetId)) return undefined;
    // Raised floors and underground rooms own their own support plane.
    if (Math.abs(record.position.y - heightAt.call(this.scene, record.position.x, record.position.z)) > 0.15) return undefined;
    return { placement, origin: record.position, heightAt: (x, z) => heightAt.call(this.scene, x, z) };
  }

  /**
   * Records when an entity died, and undoes the fade when it stops being dead.
   *
   * Kept in a set rather than found by sweeping every record, because the fade runs at frame rate
   * over a world of ~900 entities of which at most a handful are ever dissolving at once.
   */
  private setDiedAt(record: ViewRecord, diedAtMs: number | null): void {
    if (record.diedAtMs === diedAtMs) return;
    record.diedAtMs = diedAtMs;
    if (diedAtMs === null) {
      this.fading.delete(record);
      this.clearFade(record);
      return;
    }
    this.fading.add(record);
  }

  /**
   * Puts a corpse back to solid: drops the owned materials and un-hides whatever the fade hid.
   *
   * Called when a killed enemy respawns, and on release. `applyUniqueState` re-derives the look
   * from the authored materials on the next state change, so nothing here has to restore them - it
   * only has to stop pointing at the clones and free them.
   */
  private clearFade(record: ViewRecord): void {
    record.lingerMs = null;
    if (record.fade === 0 && !record.fadeMaterials) return;
    record.fade = 0;
    if (record.unique) record.unique.visible = true;
    if (record.fadeMaterials) {
      for (const material of record.fadeMaterials) material.dispose();
      record.fadeMaterials = null;
    }
  }

  /**
   * Dissolves corpses, once per frame, from the instant each of them died.
   *
   * Driven by the SIM clock the caller passes in, not by an accumulated frame delta, so the answer
   * survives a stalled tab, a reload and a save resumed an hour later: the fade is a function of
   * `nowMs - diedAtMs` and of nothing this class remembers between frames.
   *
   * The two draw paths are handled differently, and the difference is deliberate rather than an
   * omission. A unique gets a real opacity ramp, because it is the one a player is standing next
   * to. An instance cannot: `BatchedMesh` shares one material across every slot in the batch, so
   * turning transparency on for a corpse would turn it on for every living animal drawn beside it.
   * An instanced corpse therefore holds its death pose and then switches off. That is only ever
   * visible past the rig release radius (70 m), where a body is a few pixels.
   */
  private tickCorpseFade(nowMs: number): void {
    if (this.fading.size === 0) return;
    for (const record of this.fading) {
      const diedAtMs = record.diedAtMs;
      if (diedAtMs === null) continue;
      if (record.lingerMs === null) {
        // `syncOne` switches the rig to its death clip in the same call that stamped the instant
        // above, so by this frame the clip is already the right one to measure.
        const clip = record.motion === "death" ? record.playback?.clip.duration ?? null : null;
        record.lingerMs = corpseLinger(clip);
      }
      const fade = corpseFade(nowMs, diedAtMs, record.lingerMs);
      if (Math.abs(fade - record.fade) < FADE_EPSILON && fade !== 1) continue;
      const settled = record.fade >= 1 && fade >= 1;
      record.fade = fade;
      if (settled) continue;

      if (record.unique) {
        if (fade >= 1) {
          // Hidden, not released. Three skips an invisible subtree entirely, so it costs no draw
          // call, and the record stays whole for the respawn that is coming in another 25 seconds.
          record.unique.visible = false;
        } else {
          record.unique.visible = true;
          if (fade > 0) this.applyFadeOpacity(record, 1 - fade);
        }
        continue;
      }

      // Only at the end, and only once. An instanced corpse has no opacity to ramp, so every frame
      // before this one would be an identical write into the batch for no visible difference.
      if (fade < 1) continue;
      const group = this.groups.get(record.groupKey);
      if (group) this.writeSlot(group, record);
    }
  }

  /**
   * Drives one corpse's opacity through materials it owns outright.
   *
   * Cloned on the first frame of the fade rather than up front, because the overwhelming majority
   * of entities never dissolve and cloning for them would multiply the material count of the world
   * for nothing. `depthWrite` goes off with transparency on: a half-faded body that still writes
   * depth punches a hole in whatever is drawn behind it.
   */
  private applyFadeOpacity(record: ViewRecord, opacity: number): void {
    const unique = record.unique;
    if (!unique) return;

    if (!record.fadeMaterials) {
      const owned: THREE.Material[] = [];
      unique.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const clones = source.map((material) => {
          const clone = material.clone();
          clone.onBeforeCompile = material.onBeforeCompile;
          clone.customProgramCacheKey = material.customProgramCacheKey.bind(material);
          clone.transparent = true;
          clone.depthWrite = false;
          owned.push(clone);
          return clone;
        });
        mesh.material = clones.length === 1 ? clones[0]! : clones;
      });
      record.fadeMaterials = owned;
    }

    for (const material of record.fadeMaterials) material.opacity = opacity;
  }

  /**
   * Paints a non-instanced entity for its current state, always from the authored material.
   *
   * A dead character keeps its rig but stops being ticked, so it holds whatever pose it stopped in
   * rather than popping back to bind — which is the one thing that would put the arms-out silhouette
   * back on screen after all this. `setMotion` is what stops the ticking now: it switches the rig to
   * the pack's own `Death` clip, clamps on the last frame and drops the record out of `animated`.
   */
  private applyUniqueState(record: ViewRecord, tier: number): void {
    if (!record.unique) return;

    // This pass reassigns every `mesh.material` below, which would leave the fade clones owned by
    // nobody and pointed at by nothing. Drop them here and let the next fade frame re-clone from
    // whatever this pass decides the corpse looks like.
    if (record.fadeMaterials) {
      for (const material of record.fadeMaterials) material.dispose();
      record.fadeMaterials = null;
    }
    restoreBaseMaterials(record.unique);
    const look = APPEARANCE[record.archetype] ?? NEUTRAL;
    if (!record.spent) {
      this.materials.retint(record.unique, tier, look.strength, look.swatch, (material) =>
        !PROTECTED_MATERIAL.test(material.name) && !CREATURE_MATERIAL.test(material.name));
      // After the tier pass, not instead of it: the tier says what LEAGUE a thing is in and the
      // dye says which individual it is, and both are multiplies against the same texture.
      this.applyEntityTint(record);
      this.applyOrganicMaterials(record.unique);
      return;
    }
    record.unique.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      // Death ignores the protected-material rule on purpose: a corpse with bright living eyes is
      // the wrong read, and this is the state the player most needs to see from across a clearing.
      // The ANIMAL exemption is NOT ignored, though, and the two rules are answering different
      // questions: the dead STATE desaturates and darkens, which a dead animal wants, while the
      // tier STRENGTH pushes toward a metal swatch, which would turn a bear carcass Kaldite blue.
      // Zeroing only the strength keeps the corpse treatment and drops the palette push.
      const mapped = materials.map((material) =>
        this.materials.variant(material, {
          tier,
          state: "dead",
          strength: CREATURE_MATERIAL.test(material.name) ? 0 : look.strength,
          swatch: look.swatch,
        }));
      mesh.material = mapped.length === 1 ? mapped[0]! : mapped;
    });
    // A corpse keeps the individual's dye. Losing it on death would make every body in a swarm
    // the same body, which is the read this whole pass exists to remove.
    this.applyEntityTint(record);
    this.applyOrganicMaterials(record.unique);
  }

  /** Promoted rigs and baked distant poses keep the same surface treatment. */
  private applyOrganicMaterials(root: THREE.Object3D): void {
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const grade = (material: THREE.Material): THREE.Material => {
        const role = artSurfaceRoleForMaterial(material.name);
        return role ? this.materials.organic(material, role) : material;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(grade) : grade(mesh.material);
    });
  }

  // --------------------------------------------------- hover / selection

  /**
   * Ground contact ring with an optional overhead pip. Picking still uses the complete model;
   * a broad canopy must not turn a chop target into a clearing-sized ground marker.
   */
  setHighlight(
    entityId: EntityId,
    colour: string | number = "#ffd98a",
    showPip = true,
  ): boolean {
    const record = this.records.get(entityId);
    if (!record) return false;

    this.clearHighlight(entityId);
    const resource = record.archetype === "tree" || record.archetype === "ore";
    const source = this.materials.highlight(colour);
    let material = source;
    if (resource) {
      let quiet = this.resourceHighlightMaterials.get(source);
      if (!quiet) {
        quiet = source.clone();
        quiet.color.lerp(new THREE.Color(0xaaa18b), 0.4);
        quiet.opacity = 0.46;
        quiet.toneMapped = true;
        this.resourceHighlightMaterials.set(source, quiet);
      }
      material = quiet;
    }
    const marker = new THREE.Group();
    marker.name = `highlight-${entityId}`;

    const ring = new THREE.Mesh(resource ? this.resourceRing() : this.ring(), material);
    ring.name = "ring";
    ring.rotation.x = -Math.PI / 2;
    marker.add(ring);

    if (showPip) {
      const pip = new THREE.Mesh(this.pip(), material);
      pip.name = "pip";
      marker.add(pip);
    }

    this.highlightGroup.add(marker);
    this.highlights.set(entityId, marker);
    this.placeHighlight(marker, record);
    return true;
  }

  clearHighlight(entityId: EntityId): void {
    const existing = this.highlights.get(entityId);
    if (!existing) return;
    existing.removeFromParent();
    this.highlights.delete(entityId);
  }

  clearAllHighlights(): void {
    for (const entityId of [...this.highlights.keys()]) this.clearHighlight(entityId);
  }

  private placeHighlight(marker: THREE.Object3D, record: ViewRecord): void {
    marker.position.copy(record.position);
    marker.position.y += 0.04;
    let radius = record.radius;
    let height = record.labelHeight;
    const resource = record.archetype === "tree" || record.archetype === "ore";
    if (resource) {
      const group = this.groups.get(record.groupKey);
      const bounds = this.drawnBounds(record.entityId);
      if (record.archetype === "tree" && !record.spent) {
        const contact = record.trunkRadius
          ?? (group ? this.treeContactRadius(group.liveParts) * record.scale : 0.3);
        radius = Math.max(0.35, contact * 1.15 + 0.12);
      } else if (bounds) {
        // A stump and a worked seam have their own silhouette. The old canopy or boulder must
        // not continue driving either the ground ring or the marker's height after depletion.
        const footprint = Math.max(bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]);
        radius = Math.min(1.2, Math.max(0.35, footprint * 0.5 + 0.1));
      } else radius = 0.45;
      if (bounds) height = bounds.max[1] - record.position.y + 0.16;
    }
    marker.scale.setScalar(1);
    marker.getObjectByName("ring")?.scale.setScalar(radius);
    const pip = marker.getObjectByName("pip");
    if (pip) {
      pip.position.y = height;
      // Pip size is a UI measure, independent of tree height and canopy width.
      pip.scale.setScalar(resource ? 0.42 : record.radius);
    }
  }

  /** Imported trees without a forest descriptor use their lowest trunk geometry, not foliage. */
  private treeContactRadius(parts: readonly SourcePart[]): number {
    const cached = this.treeContactRadii.get(parts);
    if (cached !== undefined) return cached;
    const trunks = parts.filter((part) => !LEAF_MATERIAL.test(part.material.name));
    const bounds = this.partsBounds(trunks);
    const ceiling = bounds.min.y + Math.min(0.6, (bounds.max.y - bounds.min.y) * 0.15);
    const point = new THREE.Vector3();
    let radius = 0;
    for (const part of trunks) {
      const positions = part.geometry.getAttribute("position");
      for (let index = 0; index < positions.count; index += 1) {
        point.fromBufferAttribute(positions, index).applyMatrix4(part.matrix);
        if (point.y <= ceiling) radius = Math.max(radius, Math.hypot(point.x, point.z));
      }
    }
    this.treeContactRadii.set(parts, radius || 0.3);
    return radius || 0.3;
  }

  private ring(): THREE.BufferGeometry {
    if (!this.ringGeometry) this.ringGeometry = new THREE.RingGeometry(0.86, 1.06, 28);
    return this.ringGeometry;
  }

  private resourceRing(): THREE.BufferGeometry {
    this.resourceRingGeometry ??= new THREE.RingGeometry(0.955, 1, 40);
    return this.resourceRingGeometry;
  }

  private pip(): THREE.BufferGeometry {
    if (!this.pipGeometry) this.pipGeometry = new THREE.OctahedronGeometry(0.16, 0);
    return this.pipGeometry;
  }

  // ------------------------------------------------------------ picking

  /**
   * Which entity a ray hits, or null. Handles both instanced entities (via `instanceId`) and the
   * rigged fallback objects (via `userData.entityId`). The input layer sets the ray; this file
   * does not know about the mouse.
   */
  pick(raycaster: THREE.Raycaster): EntityId | null {
    return this.pickHit(raycaster)?.entityId ?? null;
  }

  /** Distance is the actual mesh or character pick-shape intersection, never the entity base. */
  pickHit(raycaster: THREE.Raycaster): { entityId: EntityId; distance: number } | null {
    return this.pickCandidates(raycaster)[0] ?? null;
  }

  /** Distance-sorted pick, returning every entity under the ray. Right-click menus want this. */
  pickAll(raycaster: THREE.Raycaster): EntityId[] {
    return this.pickCandidates(raycaster).map((candidate) => candidate.entityId);
  }

  private pickCandidates(raycaster: THREE.Raycaster): { entityId: EntityId; distance: number }[] {
    const nearest = new Map<EntityId, number>();
    meshHits: for (const hit of raycaster.intersectObject(this.group, true)) {
      const entityId = this.entityOfHit(hit);
      if (!entityId || this.hiddenRoofs.has(entityId)) continue;
      // A hit on a 20 m ruin is a hit on the place, not on a thing. Let it fall through to
      // whatever is behind it — usually the ground, so the click walks there.
      const record = this.records.get(entityId);
      if (record?.pickable === false || record && record.fade >= 1) continue;
      // Three's raycaster still intersects invisible objects. A dissolved unique rig
      // must not cover its loot chest, and a hidden interior must not cover the surface.
      for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) {
        if (!object.visible) continue meshHits;
      }
      const previous = nearest.get(entityId);
      if (previous === undefined || hit.distance < previous) nearest.set(entityId, hit.distance);
    }

    for (const candidate of this.expandedCharacterPicks(raycaster)) {
      const previous = nearest.get(candidate.entityId);
      if (previous === undefined || candidate.distance < previous) {
        nearest.set(candidate.entityId, candidate.distance);
      }
    }

    return [...nearest].map(([entityId, distance]) => ({ entityId, distance }))
      .sort((a, b) => a.distance - b.distance);
  }

  private expandedCharacterPicks(
    raycaster: THREE.Raycaster,
  ): { entityId: EntityId; distance: number }[] {
    const found: { entityId: EntityId; distance: number }[] = [];
    for (const record of this.records.values()) {
      if (!EXPANDED_PICK_ARCHETYPES.has(record.archetype)) continue;
      // A dissolved corpse is NOT a click target.
      //
      // The capsule below is invisible by design — it exists so a coney is as easy to click as a
      // bear — which means it does not disappear just because the mesh did. Both draw paths switch
      // a corpse off at `fade >= 1` (`tickCorpseFade` hides the unique, `writeSlot` hides the
      // instance), so the raycast half of `pickCandidates` stops finding it and this half kept
      // reporting it: clicking bare grass selected an animal that was not there, and kept doing so
      // for the rest of the 30 second respawn.
      //
      // A corpse still fading is deliberately left pickable. It is on screen, and inspecting the
      // thing you just killed is a reasonable click.
      if (record.fade >= 1) continue;

      const radius = Math.max(
        MIN_CHARACTER_PICK_RADIUS,
        Math.min(MAX_CHARACTER_PICK_RADIUS, record.radius * CHARACTER_PICK_RADIUS_SCALE),
      );
      const height = Math.max(1.4, record.labelHeight);
      const inset = Math.min(radius, height * 0.45);
      this.pickCapsuleBase.copy(record.position).addScaledVector(THREE.Object3D.DEFAULT_UP, inset);
      this.pickCapsuleTop.copy(record.position).addScaledVector(THREE.Object3D.DEFAULT_UP, height - inset);

      let gapSq = raycaster.ray.distanceSqToSegment(
        this.pickCapsuleBase,
        this.pickCapsuleTop,
        this.pickRayPoint,
        this.pickCapsulePoint,
      );
      let hitRadius = radius;
      if (gapSq > radius * radius) {
        // Second chance, for LONG bodies: a capsule around the vertical axis is centred on the
        // torso, and its radius is clamped to 1.35 m — a cow is 2.53 m nose to tail, so its head
        // and rump were not clickable at all. Measured with a frozen-sim hover sweep
        // (runs/corealm/audit/pick-map-probe.ts): the pickable region stopped ~0.3 m short of
        // both ends. A click that misses this way falls through to the ground and WALKS the
        // player — mid-fight, that is the character marching away from a chasing animal, which
        // play reported as "sometimes you can't attack a monster". So anything whose footprint is
        // meaningfully longer than it is wide also offers a capsule laid along its spine, at its
        // drawn yaw. A union with the vertical capsule, never a replacement, so nothing that
        // picked before can stop picking.
        const assetId = this.groups.get(record.groupKey)?.assetId;
        const size = assetId ? this.assets.assetSize(assetId) : null;
        if (!size) continue;
        const long = Math.max(size.x, size.z);
        const short = Math.min(size.x, size.z);
        if (long <= 0) continue;
        // `record.radius` is the drawn half of the LONG axis; scale the short one the same way.
        const girth = record.radius * (short / long);
        const along = record.radius - girth;
        if (along <= 0.15) continue;

        const crossRadius = Math.max(
          MIN_CHARACTER_PICK_RADIUS,
          Math.min(MAX_CHARACTER_PICK_RADIUS, girth * CHARACTER_PICK_RADIUS_SCALE),
        );
        const spineY = Math.max(crossRadius, Math.min(height - crossRadius, height * 0.45));
        const dirX = Math.sin(record.rotationY);
        const dirZ = Math.cos(record.rotationY);
        this.pickCapsuleBase.copy(record.position);
        this.pickCapsuleBase.x -= dirX * along;
        this.pickCapsuleBase.z -= dirZ * along;
        this.pickCapsuleBase.y += spineY;
        this.pickCapsuleTop.copy(record.position);
        this.pickCapsuleTop.x += dirX * along;
        this.pickCapsuleTop.z += dirZ * along;
        this.pickCapsuleTop.y += spineY;
        gapSq = raycaster.ray.distanceSqToSegment(
          this.pickCapsuleBase,
          this.pickCapsuleTop,
          this.pickRayPoint,
          this.pickCapsulePoint,
        );
        if (gapSq > crossRadius * crossRadius) continue;
        hitRadius = crossRadius;
      }

      const centreDistance = raycaster.ray.origin.distanceTo(this.pickRayPoint);
      const entryDistance = Math.max(0, centreDistance - Math.sqrt(hitRadius * hitRadius - gapSq));
      if (entryDistance < raycaster.near || entryDistance > raycaster.far) continue;
      found.push({ entityId: record.entityId, distance: entryDistance });
    }
    return found;
  }

  private entityOfHit(hit: THREE.Intersection): EntityId | null {
    const owned = this.ownerOf(hit);
    if (owned) return owned;
    if ((hit.object as THREE.BatchedMesh).isBatchedMesh) return null;

    let node: THREE.Object3D | null = hit.object;
    while (node) {
      const entityId = node.userData.entityId;
      if (typeof entityId === "string") return entityId;
      node = node.parent;
    }
    return null;
  }

  /**
   * The entity a raycast hit belongs to, or null when the hit is not one of this layer's instances.
   *
   * `BatchedMesh.raycast` reports which instance was hit as `intersection.batchId`, and the batch
   * remembers which (group, slot) it lent that instance to — which is the only mapping there is,
   * because one batch is shared by every group that paints with its material.
   */
  private ownerOf(hit: THREE.Intersection): EntityId | null {
    const mesh = hit.object as THREE.BatchedMesh;
    if (!mesh.isBatchedMesh) return null;
    const batchId = (hit as THREE.Intersection & { batchId?: number }).batchId;
    if (batchId === undefined) return null;
    const owner = this.batchOwners.get(mesh)?.owners[batchId];
    return owner ? owner.group.slots[owner.slot] ?? null : null;
  }

  /** World position an entity is drawn at. Used for overlays and camera framing. */
  positionOf(entityId: EntityId): THREE.Vector3 | null {
    const record = this.records.get(entityId);
    return record ? record.position.clone() : null;
  }

  /** Live mixer state, or the pose the instanced fallback actually draws. */
  motionSnapshot(entityId: EntityId): EntityMotionSnapshot | null {
    const record = this.records.get(entityId);
    if (!record) return null;

    const rig = record.rig;
    const group = record.slot >= 0 ? this.groups.get(record.groupKey) : null;
    const moving = record.movingTicks > 0 && !record.spent;
    const spentReady = Boolean(group && record.spent && group.spent.length > 0);
    const movingReady = Boolean(group && moving && group.moving.length > 0);
    const bakedMotion: CharacterMotion | null = group?.posed
      ? spentReady ? "death" : movingReady ? "walk" : "idle"
      : null;
    const path: EntityMotionPath | null = rig
      ? "live-rig"
      : record.unique
        ? "unique-static"
        : group?.animationLod && record.playback
          ? "sampled-rig"
        : group?.posed
          ? "baked"
          : group
            ? "instanced-static"
            : null;
    const rotationY = record.rotationY;

    return {
      entityId,
      liveRig: rig !== null,
      terrainContact: rig ? terrainRigSnapshot(rig.root) : group?.animationLod?.terrainSnapshot(record.slot) ?? null,
      path,
      semanticPosition: [record.target.x, record.target.y, record.target.z],
      drawnPosition: [record.position.x, record.position.y, record.position.z],
      drawnStrideScale: Math.abs(record.scale * record.build[2] * record.scaleAxes[2]),
      semanticRotationY: record.targetRotationY,
      drawnRotationY: rotationY,
      facing: [Math.sin(rotationY), 0, Math.cos(rotationY)],
      motion: record.playback ? record.motion : bakedMotion,
      restingMotion: record.playback ? record.resting : null,
      clip: record.playback?.clip.name ?? null,
      time: record.playback?.time ?? null,
      duration: record.playback?.clip.duration ?? null,
      timeScale: record.playback?.timeScale ?? null,
      hitOverlay: record.playback?.hitOverlay ? {
        clip: record.playback.hitOverlay.clip.name, time: record.playback.hitOverlay.time,
        duration: record.playback.hitOverlay.clip.duration,
        weight: hitOverlayWeight(record.playback.hitOverlay.time, record.playback.hitOverlay.clip.duration),
        active: true, bones: record.playback.hitOverlay.bones ?? [], maskStatus: record.playback.hitOverlay.maskStatus ?? 'unknown',
      } : null,
    };
  }

  has(entityId: EntityId): boolean {
    return this.records.has(entityId);
  }

  // -------------------------------------------------------------- stats

  private assetRadius(assetId: string): number {
    const entry = this.assets.entry(assetId);
    if (!entry) return this.minHighlightRadius;
    return Math.max(entry.size.x, entry.size.z) * 0.55;
  }

  /**
   * Kept as a counter rather than a walk of `this.records`.
   *
   * `canAffordUnique` asks for it, and `rebalanceUniques` asks `canAffordUnique` once per character
   * record per frame. Walking 1,203 records inside a loop over 62 candidates is 75,000 property
   * reads a frame to answer a question the layer already knows the answer to.
   */
  private countUnique(): number {
    return this.uniqueViewCount;
  }

  /**
   * The world-space box this layer actually draws for one entity, or null when it draws nothing.
   *
   * Written for the depleted-node bug: a screenshot showing an empty patch of grass cannot
   * distinguish "the spent mesh was never built" from "the spent mesh is a pebble" from "the live
   * mesh is hidden and nothing replaced it". Mesh counts cannot either — an `InstancedMesh` exists
   * whether or not any of its slots hold a visible matrix. This reads the matrix in the entity's
   * own slot, which is the only thing that answers the question.
   */
  drawnBounds(
    entityId: EntityId,
  ): { min: Vec3; max: Vec3; meshes: number; path: string; fade: number } | null {
    const record = this.records.get(entityId);
    if (!record) return null;

    const box = new THREE.Box3();
    let meshes = 0;

    if (record.unique) {
      record.unique.updateMatrixWorld(true);
      // SkinnedMesh caches its first bounding box. Precise sampling follows the current bone
      // pose, so a reaching arm or crouched body changes gallery framing and health-bar height.
      box.setFromObject(record.unique, true);
      record.unique.traverse((child) => { if ((child as THREE.Mesh).isMesh) meshes += 1; });
      // The playback RATE is part of the answer, not decoration: a walk cycle can be playing and
      // still read as sliding if it is running at the wrong speed for the ground being covered, and
      // a clip name alone cannot tell those apart.
      const rate = record.rig ? record.rig.action.timeScale : 1;
      const path = record.rig
        ? `animated:${record.rig.clipName}@${rate.toFixed(2)}x`
        : "unique";
      return box.isEmpty() ? null : boxToBounds(box, meshes, path, record.fade);
    }

    const group = this.groups.get(record.groupKey);
    if (!group || record.slot < 0) return null;
    if (group.animationLod && record.playback) {
      const bounds = group.animationLod.bounds(record.slot, box);
      return bounds && !bounds.isEmpty()
        ? boxToBounds(bounds, group.animationLod.drawCalls, `sampled:${record.playback.clip.name}`, record.fade)
        : null;
    }
    const moving = record.movingTicks > 0 && !record.spent;
    const active = record.spent && group.spent.length > 0
      ? group.spent
      : moving && group.moving.length > 0 ? group.moving : group.live;
    const matrix = new THREE.Matrix4();
    for (const draw of active) {
      const instance = draw.instances[record.slot];
      // Absent and switched-off are both "this pose does not draw here", and both must not widen
      // the box. This is what makes a depleted node's bounds the STUMP rather than the tree.
      if (instance === undefined || instance < 0) continue;
      if (!draw.batch.mesh.getVisibleAt(instance)) continue;
      draw.batch.mesh.getMatrixAt(instance, matrix);
      draw.part.geometry.computeBoundingBox();
      const bounds = draw.part.geometry.boundingBox;
      if (!bounds) continue;
      box.union(bounds.clone().applyMatrix4(matrix));
      meshes += 1;
    }
    return box.isEmpty() ? null : boxToBounds(box, meshes, record.spent ? "instanced-spent" : "instanced", record.fade);
  }

  stats(): EntityViewStats {
    // Which pose variant each group actually has something in. A group whose entities all took a
    // non-instanced rig has parts registered in a batch and no visible instance in any of them, and
    // an unused spent or walk variant is the same. Charging for those is what put 636 on a report
    // next to a renderer reading 321.
    const occupied = new Map<string, { live: boolean; spent: boolean; moving: boolean }>();
    for (const record of this.records.values()) {
      if (record.slot < 0) continue;
      const group = this.groups.get(record.groupKey);
      if (!group) continue;
      if (group.animationLod && record.playback) continue;
      const flags = occupied.get(group.key) ?? { live: false, spent: false, moving: false };
      const moving = record.movingTicks > 0 && !record.spent;
      if (record.spent && group.spent.length > 0) flags.spent = true;
      else if (moving && group.moving.length > 0) flags.moving = true;
      else flags.live = true;
      occupied.set(group.key, flags);
    }

    let instancedMeshes = 0;
    let drawnInstancedMeshes = 0;
    let triangles = 0;
    let bakedPoses = 0;
    let dressedGroups = 0;
    let sampledDrawCalls = 0;
    const drawnBatches = new Set<Batch>();
    const charge = (draws: readonly PartDraw[]): void => {
      drawnInstancedMeshes += draws.length;
      for (const draw of draws) drawnBatches.add(draw.batch);
    };
    for (const group of this.groups.values()) {
      sampledDrawCalls += group.animationLod?.drawCalls ?? 0;
      instancedMeshes += group.live.length + group.spent.length + group.moving.length;
      const flags = occupied.get(group.key);
      if (flags) {
        if (flags.live) charge(group.live);
        if (flags.spent) charge(group.spent);
        if (flags.moving) charge(group.moving);
      }
      if (group.posed) bakedPoses += 1;
      if (group.character) dressedGroups += 1;
      const active = group.slots.filter((slot) => slot !== null).length;
      for (const part of group.liveParts) triangles += part.triangles * active;
    }

    let unique = 0;
    let uniqueMeshes = 0;
    let uniqueTriangles = 0;
    let dressedCharacters = 0;
    let movingViews = 0;
    const looks = new Set<string>();
    for (const record of this.records.values()) {
      if (record.movingTicks > 0) movingViews += 1;
      if (record.tints || record.architectureValue !== 1) looks.add(lookKey(record));
      if (!record.unique) continue;
      unique += 1;
      if (record.dressed) dressedCharacters += 1;
      uniqueMeshes += record.uniqueMeshes;
      record.unique.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) uniqueTriangles += triangleCount(mesh.geometry);
      });
    }

    return {
      entities: this.records.size,
      groups: this.groups.size,
      instancedMeshes,
      drawnInstancedMeshes,
      uniqueViews: unique,
      riggedViews: this.animated.size,
      animatedLastFrame: this.animatedLastFrame,
      bakedPoses,
      highlights: this.highlights.size,
      batches: this.batches.size,
      drawnBatches: drawnBatches.size,
      // Counted, not guessed, and with the shadow pass in it. The unit is the BATCH now, not the
      // part: every part that shares a material shares one `multiDrawElements`. Unique character
      // meshes are still one draw each and cast, so two; highlights are unlit overlays that do not
      // cast, so a ring plus a pip is two. World-wide and unculled — see the field doc.
      estimatedDrawCalls: (drawnBatches.size + sampledDrawCalls + uniqueMeshes + this.highlights.size) * 2,
      uniqueDrawCalls: this.uniqueDrawCalls,
      namedDrawCalls: this.namedDrawCalls,
      otherDrawCalls: this.otherDrawCalls,
      dressedCharacters,
      dressedGroups,
      distinctLooks: looks.size,
      movingViews,
      triangles: Math.round(triangles + uniqueTriangles),
      missingAssets: [...this.missing].sort(),
      residency: this.residencyStats(),
    };
  }

  dispose(): void {
    for (const [mesh, original] of this.containedWaterOriginals) mesh.material = original;
    this.containedWaterOriginals.clear();
    this.activeSet.replace([]);
    this.clearAllHighlights();
    for (const record of this.records.values()) this.release(record);
    for (const group of this.groups.values()) group.animationLod?.dispose();
    for (const batch of this.batches.values()) {
      batch.mesh.removeFromParent();
      batch.mesh.dispose();
    }
    this.batches.clear();
    this.group.clear();
    this.groups.clear();
    this.records.clear();
    this.residentMovingEntities.length = 0;
    this.locomotionIntents.clear();
    this.animated.clear();
    this.fading.clear();
    this.rigCandidates.clear();
    this.fishingViews.clear();
    this.resourceTimeSeconds = 0;
    this.viewer = null;
    this.meshCounts.clear();
    this.characterCosts.clear();
    this.characterSpecs.clear();
    this.missingHitClips.clear();
    this.hitOverlayClips.clear();
    this.uniqueDrawCalls = 0;
    this.namedDrawCalls = 0;
    this.otherDrawCalls = 0;
    this.uniqueViewCount = 0;
    for (const material of this.tintedMaterials.values()) material.dispose();
    this.tintedMaterials.clear();
    for (const material of this.essenceMaterials.values()) material.dispose();
    this.essenceMaterials.clear();
    for (const material of this.essenceAltarDetailMaterials.values()) material.dispose();
    this.essenceAltarDetailMaterials.clear();
    this.essenceAltarLineGeometry?.dispose();
    this.essenceAltarCircleGeometry?.dispose();
    this.essenceAltarLineGeometry = null;
    this.essenceAltarCircleGeometry = null;
    this.essenceVeinsMask.dispose();
    this.essenceAltarLinesMask.dispose();
    for (const geometry of this.seamGeometries.values()) geometry.dispose();
    for (const entry of this.workedOreGeometries.values()) {
      entry.scar.dispose();
      entry.dust.dispose();
      entry.fragments.dispose();
    }
    for (const entry of this.fishingGeometries.values()) {
      entry.ripple.dispose();
      entry.bubbles.dispose();
    }
    for (const geometry of this.campfireRockGeometries.values()) geometry.dispose();
    for (const material of this.resourceMaterials.values()) material.dispose();
    for (const material of this.submergedFishMaterials.values()) material.dispose();
    for (const geometry of this.bakedGeometries) geometry.dispose();
    this.seamGeometries.clear();
    this.workedOreGeometries.clear();
    this.fishingGeometries.clear();
    this.campfireRockGeometries.clear();
    this.resourceMaterials.clear();
    this.submergedFishMaterials.clear();
    this.bakedGeometries.length = 0;
    this.sources.clear();
    this.sourceRequests.clear();
    this.sourceLoads.clear();
    this.failedSources.clear();
    this.missing.clear();
    this.sourcesChanged = false;
    this.captureSubjectId = null;
    this.hiddenRoofs.clear();
    this.riggedAssets.clear();
    this.tierKeyed.clear();
    this.architectureAssets.clear();
    this.ringGeometry?.dispose();
    this.resourceRingGeometry?.dispose();
    this.pipGeometry?.dispose();
    this.ringGeometry = null;
    this.resourceRingGeometry = null;
    this.pipGeometry = null;
    for (const material of this.resourceHighlightMaterials.values()) material.dispose();
    this.resourceHighlightMaterials.clear();
  }
}

/**
 * Loads the authored grayscale vein mask without making Node-side renderer tests depend on a DOM.
 *
 * An empty texture in Node still keeps `emissiveMap !== null`, so shader/material identity matches
 * the browser even though that environment never draws pixels. In Chromium the one TextureLoader
 * request is shared by every element and every live cache node.
 */
function loadEssenceVeinsMask(): THREE.Texture {
  const texture = typeof document === "undefined"
    ? new THREE.Texture()
    : new THREE.TextureLoader().load(
      ESSENCE_VEINS_MASK_URL,
      undefined,
      undefined,
      (error: unknown) => {
        console.error(
          `[entityViews] essence vein mask failed to load from ${ESSENCE_VEINS_MASK_URL}. `
          + "Essence caches will keep their rock texture but lose their elemental glow.",
          error,
        );
      },
    );
  texture.name = "essence-veins-mask";
  // This is a scalar mask, not display colour. Decoding it as sRGB would crush the dim vein edges.
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.5, 1.5);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

/** One angular channel and one diamond keep the altar's emission deliberate and readable. */
function loadEssenceAltarLinesMask(): THREE.Texture {
  if (typeof document === "undefined") {
    const texture = new THREE.Texture();
    texture.name = "essence-altar-lines-mask";
    return texture;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.Texture();
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const paths: readonly (readonly [number, number])[][] = [
    [[48, 336], [140, 336], [196, 256], [316, 256], [372, 176], [464, 176]],
    [[220, 256], [256, 220], [292, 256], [256, 292], [220, 256]],
  ];
  const stroke = (width: number, colour: string): void => {
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = width;
    context.strokeStyle = colour;
    for (const path of paths) {
      context.beginPath();
      context.moveTo(path[0]![0], path[0]![1]);
      for (let index = 1; index < path.length; index += 1) {
        context.lineTo(path[index]![0], path[index]![1]);
      }
      context.stroke();
    }
  };
  stroke(12, "#3a3a3a");
  stroke(4, "#ffffff");

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = "essence-altar-lines-mask";
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  // The Unity trim sheet uses tiled UVs. Repeat a large-scale sigil so those coordinates do not
  // clamp to the black border while still keeping the line count low.
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(0.3, 0.3);
  texture.offset.set(0.12, 0.18);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function vec3Of(position: Vec3 | THREE.Vector3): Vec3 {
  if (Array.isArray(position)) return [position[0], position[1], position[2]];
  const vector = position as THREE.Vector3;
  return [vector.x, vector.y, vector.z];
}

/** Everything a player could use to tell one drawn character or creature from another. */
function lookKey(record: ViewRecord): string {
  const tints = record.tints;
  const dye = tints
    ? [tints.cloth, tints.clothAlt, tints.skin, tints.hair, tints.creature, tints.creatureAccent]
      .map((hex) => hex.toString(16)).join(",")
    : "-";
  return `${record.groupKey}|${dye}|${record.architectureValue.toFixed(2)}|${record.build.map(round).join(",")}`;
}

/**
 * Resolves what a dressed humanoid is made of, or null when the entity is not one.
 *
 * Two inputs, in priority order. `view.partAssetIds` is the authored answer and the one the world
 * layer is moving to. Failing that, `OUTFIT_BODIES` recognises the four clothes-only outfit GLBs
 * that `view.assetId` still carries today and puts the right base body under them — without which
 * every NPC in the game renders with no head, no eyes and no eyebrows.
 *
 * On top of the authored answer this REMIXES, and that is the whole of the mesh-level variety this
 * library can give. Measured before: `world/regionBuilder` emits one outfit family per character,
 * so the 12 shipped NPCs realise 4 authored part sets, and with the two hair picks the peasants get
 * that is at most 6 distinct bodies for the whole world — the reason `npc_carter_bel` and the
 * player are pixel-for-pixel identical in
 * runs/corealm/screenshots/ev3-before-npc-carter_bel.png. Keeping the chest and re-rolling legs,
 * boots, gloves, hood and pauldron per entity takes the same 24 meshes to 2^3 x 2 x 2 = 32 part
 * sets per (sex, chest family), and the hair and beard rolls multiply that again.
 *
 * Every pick is a fresh `Rng` seeded by a hash of the entity id and the slot name, exactly as
 * `skinning.hairAssetFor` does it: pure function of the id, no shared stream consumed, so adding
 * this shifts no other deterministic draw in the game and a `__gameDebug.reset({seed})` diff sees
 * the same faces twice.
 *
 * A body with no measured head-cap plane no longer refuses outright. It refuses only on the
 * OUTFIT_BODIES fallback path, where the whole point is to cut a base body down to a head; when the
 * world layer authors `view.partAssetIds` — including on an `enemy` archetype, which is how a
 * humanoid monster is built — the spec is returned and `assembleDressedCharacter` simply finds no
 * cut to make. Hair is still skipped there: it is a base-body decision, not a parts decision.
 */
function characterSpecFor(
  entityId: EntityId,
  archetype: Archetype,
  assetId: string,
  partAssetIds: readonly string[] | undefined,
): CharacterSpec | null {
  let bodyAssetId = assetId;
  let parts: string[] = partAssetIds ? [...partAssetIds] : [];
  const authored = parts.length > 0;

  if (!authored) {
    const implied = OUTFIT_BODIES[assetId];
    if (!implied) return null;
    bodyAssetId = implied;
    parts = [assetId];
    // Only the two base bodies have a measured head-cap plane, and without one this fallback would
    // layer clothes over an INTACT body — the case that leaks bare skin through the trousers.
    if (headCapHeightFor(bodyAssetId) === null) return null;
  }

  const humanoid = headCapHeightFor(bodyAssetId) !== null;
  if (humanoid) parts = remixOutfit(entityId, parts, archetype === "npc");

  const hooded = parts.some((id) => HOODED_PARTS.has(id));
  const haired = parts.some((id) => HAIR_PART.test(id));
  if (humanoid && !hooded && !haired) {
    const female = bodyAssetId === "base_female";
    parts.push(pickFrom(female ? FEMALE_HAIR : MALE_HAIR, `hair:${bodyAssetId}:${entityId}`));
    if (!female && chance(`beard:${entityId}`, BEARD_CHANCE)) parts.push(BEARD_ASSET);
  }

  return { bodyAssetId, partAssetIds: parts, key: `${bodyAssetId}>${parts.join("+")}` };
}

/**
 * Re-rolls the mixable slots of an authored outfit, keeping the chest family.
 *
 * Returns the input untouched when it is not the authored `outfit_<sex>_<family>_<slot>` shape.
 * The world layer is allowed to hand over anything; guessing at a part list this does not recognise
 * would be this file inventing appearance rather than reading it.
 */
function remixOutfit(entityId: EntityId, parts: readonly string[], headwear: boolean): string[] {
  const parsed = parts.map((id) => OUTFIT_PART.exec(id));
  if (parsed.some((match) => match === null)) return [...parts];

  const sex = parsed[0]?.[1];
  const chest = parsed.find((match) => match?.[3] === "chest");
  if (!sex || !chest) return [...parts];
  const chestFamily = chest[2] ?? "peasant";

  const out: string[] = [`outfit_${sex}_${chestFamily}_chest`];
  for (const slot of MIXABLE_SLOTS) {
    // A slot the world layer did not author is not invented here: peasant and ranger both ship all
    // three, so an absent one means the caller meant it to be absent.
    if (!parsed.some((match) => match?.[3] === slot)) continue;
    const family = chance(`slot:${slot}:${entityId}`, 0.5) ? "ranger" : "peasant";
    out.push(`outfit_${sex}_${family}_${slot}`);
  }

  const authoredHood = parsed.some((match) => match?.[3] === "hood");
  // Only an NPC's headwear is re-rolled. A humanoid MONSTER's hood is the silhouette the content
  // layer chose to make it read as that monster, and taking it off 40% of the time would be this
  // file overruling `content/enemies.ts` rather than varying it.
  const hooded = headwear
    ? chance(`hood:${entityId}`, authoredHood ? HOOD_KEEP_CHANCE : HOOD_CHANCE)
    : authoredHood;
  if (hooded) out.push(`outfit_${sex}_ranger_hood`);
  if (chance(`pauldron:${entityId}`, PAULDRON_CHANCE)) out.push(`outfit_${sex}_ranger_pauldron`);
  return out;
}

/** Deterministic index into a table, from a seed string. Fresh `Rng`, no shared stream. */
function pickFrom<T>(values: readonly T[], seed: string): T {
  const picked = values[new Rng(hashString(seed)).int(0, values.length - 1)];
  return picked ?? values[0]!;
}

/** One coherent value shift for every built surface in a region, so a town reads as one kit. */
function architectureValueFor(regionId: RegionId): number {
  return pickFrom(ARCHITECTURE_VALUE_STEPS, `architectureValue:${regionId}`);
}

/** Deterministic coin flip at probability `p`, from a seed string. */
function chance(seed: string, p: number): boolean {
  return new Rng(hashString(seed)).float(0, 1) < p;
}

/**
 * Which tint a source material answers to, from its name alone.
 *
 * Name alone is enough because these two kits do not share names with anything else in the library:
 * `runs/corealm/dc/matkey.mjs` groups all 213 manifest GLBs into 63 distinct materials, and
 * `MI_*`, `Main*`, `Wings` and `Horns` occur only in the character, outfit and monster packs. The
 * caller gates on archetype anyway (`TINTABLE_ARCHETYPES`), so a prop that one day ships a material
 * called `Main` still cannot be recoloured by this.
 */
function tintRoleFor(name: string): TintRole {
  if (CLOTH_MATERIAL.test(name)) return "cloth";
  if (CLOTH_ALT_MATERIAL.test(name)) return "clothAlt";
  if (HAIR_MATERIAL.test(name)) return "hair";
  if (SKIN_MATERIAL.test(name)) return "skin";
  if (CREATURE_BODY_MATERIAL.test(name)) return "creature";
  if (CREATURE_ACCENT_MATERIAL.test(name)) return "creatureAccent";
  return "none";
}

function tintFor(tints: EntityTints, role: TintRole): number {
  switch (role) {
    case "cloth": return tints.cloth;
    case "clothAlt": return tints.clothAlt;
    case "skin": return tints.skin;
    case "hair": return tints.hair;
    case "creature": return tints.creature;
    case "creatureAccent": return tints.creatureAccent;
    default: return NO_TINT;
  }
}

/**
 * One entity's dye lots, or null when nothing about it is tintable.
 *
 * Creature hue is keyed on the entity id with its trailing index stripped — `scree_skitterlings_4`
 * becomes `scree_skitterlings` — so a whole spawn group is one animal and two groups of the same
 * mesh are two. That is the difference the brief asks for between a moor crab and a scree crab, and
 * it is the FAMILY the world layer already spells into the id rather than `entity.meta`, which
 * `render/` does not read. Individuals inside a group then take one of three value steps, so a
 * swarm of six is not six copies.
 */
function tintsFor(
  entityId: EntityId,
  archetype: Archetype,
  character: CharacterSpec | null,
): EntityTints | null {
  const creatureFamily = entityId.replace(/_\d+$/, "");
  const isCreature = archetype === "enemy" || archetype === "boss";
  if (!character && !isCreature) return null;

  const creature = isCreature
    ? shade(
      pickFrom(CREATURE_TINTS, `family:${creatureFamily}`),
      pickFrom(CREATURE_SHADES, `shade:${entityId}`),
    )
    : NO_TINT;

  return {
    cloth: character ? pickFrom(CLOTH_TINTS, `cloth:${entityId}`) : NO_TINT,
    clothAlt: character ? pickFrom(CLOTH_TINTS, `clothAlt:${entityId}`) : NO_TINT,
    skin: character ? pickFrom(SKIN_TINTS, `skin:${entityId}`) : NO_TINT,
    hair: character ? pickFrom(HAIR_TINTS, `hairColour:${entityId}`) : NO_TINT,
    creature,
    // The accent is a different entry in the same table rather than a second table: wings and horns
    // want to read as belonging to the animal and not to a palette of their own.
    creatureAccent: isCreature ? pickFrom(CREATURE_TINTS, `accent:${creatureFamily}`) : NO_TINT,
  };
}

/** Scales an 8-bit-per-channel hex toward black. Used for the per-individual creature step. */
function shade(hex: number, factor: number): number {
  if (factor >= 1) return hex;
  const scale = (value: number): number => Math.max(0, Math.min(255, Math.round(value * factor)));
  return (scale((hex >> 16) & 0xff) << 16) | (scale((hex >> 8) & 0xff) << 8) | scale(hex & 0xff);
}

/**
 * The per-entity build multiplier, or `NO_BUILD`.
 *
 * Deliberately NOT folded into the change-detection signature: it is a pure function of the entity
 * id, so it cannot change while the record lives, and a record rebuilt after a release recomputes
 * exactly the same numbers.
 */
function buildFor(entityId: EntityId, archetype: Archetype): readonly [number, number, number] {
  if (!BUILD_ARCHETYPES.has(archetype)) return NO_BUILD;
  const uniform = pickFrom(BUILD_SCALES, `build:${entityId}`);
  const height = pickFrom(BUILD_HEIGHTS, `height:${entityId}`);
  return [uniform, uniform * height, uniform];
}

/**
 * Material identity for a character part, ACROSS separately loaded GLBs.
 *
 * `mergeSkinnedMeshes` defaults to material UUID, which never merges two files: `world/regionBuilder`
 * dresses an NPC from four to six separate part GLBs, and two loads of MI_Peasant are two Material
 * instances holding two Texture instances. Measured effect of leaving it at the default: a dressed
 * male ranger is 11 meshes and a female ranger 11, against 6 for the same outfit shipped as one GLB.
 * With this key all four outfits land at 6 meshes — merges of 9->6, 12->6, 8->6 and 13->6.
 *
 * It is safe because the images really are the same image. sha1 over each GLB's embedded texture
 * bytes: T_Peasant_BaseColor is cbc36fd517 in _chest, _legs, _boots and _gloves alike, and
 * T_Ranger_BaseColor is add5a3c8ba across the ranger set; base_male's eyebrow material MI_Hair_1
 * carries T_Hair_1_BaseColor ffe6590578, byte-identical to hair_short's and hair_buzzed's. So the
 * merged mesh drawing under the FIRST material draws exactly the pixels the others would have.
 *
 * Name plus texture name plus colour, not name alone: a name collision between two unrelated packs
 * would otherwise silently paint one with the other's texture.
 */
function characterMaterialKey(material: THREE.Material): string {
  const standard = material as THREE.MeshStandardMaterial;
  const map = standard.map;
  return [
    material.name,
    material.type,
    map ? map.name : "-",
    standard.color ? standard.color.getHexString() : "-",
    standard.transparent ? "t" : "o",
    material.side,
  ].join("|");
}

/**
 * The orientation an entity is drawn at: its authored yaw, then tilted toward the ground normal.
 *
 * `setFromUnitVectors(UP, normal)` is the full lie-flat-on-the-hill rotation; slerping vertical
 * toward it by `strength` is what lets a tree take 10% of a slope and a lily pad take all of it.
 * Applied by premultiply, i.e. AFTER the yaw in local terms, so tilting never spins the model.
 */
function orientation(
  rotationY: number,
  normal: readonly [number, number, number] | null,
  strength: number,
  out: THREE.Quaternion,
): THREE.Quaternion {
  out.setFromAxisAngle(Y_AXIS, rotationY);
  if (!normal || strength <= 0) return out;
  SCRATCH_NORMAL.set(normal[0], normal[1], normal[2]);
  if (SCRATCH_NORMAL.lengthSq() < 1e-6) return out;
  SCRATCH_NORMAL.normalize();
  SCRATCH_TILT.setFromUnitVectors(Y_AXIS, SCRATCH_NORMAL);
  SCRATCH_BLEND.identity().slerp(SCRATCH_TILT, Math.min(1, strength));
  return out.premultiply(SCRATCH_BLEND);
}

/** Normal and tilt folded into the change-detection signature at 0.01 resolution. */
function tiltKey(normal: readonly [number, number, number] | null, strength: number): string {
  if (!normal || strength <= 0) return "-";
  return `${round(normal[0])},${round(normal[1])},${round(normal[2])}:${round(strength)}`;
}

/** Interpolates an angle the short way round, so a turn through north does not spin 350 degrees. */
function shortestArc(from: number, to: number, alpha: number): number {
  const delta = ((to - from + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return from + delta * alpha;
}

/**
 * Cuts a set of parts off at a fraction of their COMBINED height.
 *
 * The fraction has to be measured across the whole asset, not per mesh. A tree ships as a trunk
 * mesh and a canopy mesh; cutting each at its own lowest quarter leaves a stub of trunk AND a ring
 * of leaves hanging in the air where the bottom of the canopy used to be. Measuring once across
 * both and cutting every part at that one world height is what actually produces a stump: the
 * trunk keeps its lower quarter and the canopy, which lives entirely above the cut, keeps nothing.
 *
 * Parts are returned identity-placed with their source transform baked in, so a rotated or offset
 * part still cuts along world Y. Runs once per group.
 */
function clipPartsBelow(parts: readonly SourcePart[], fraction: number): SourcePart[] {
  const boxes = parts.map((part) => {
    part.geometry.computeBoundingBox();
    const bounds = part.geometry.boundingBox;
    return bounds ? bounds.clone().applyMatrix4(part.matrix) : null;
  });

  const box = new THREE.Box3();
  for (const bounds of boxes) if (bounds) box.union(bounds);
  if (box.isEmpty()) return [];

  const height = box.max.y - box.min.y;
  const cut = box.min.y + height * fraction;
  // A part that does not reach the ground is foliage, not structure. Cutting it at the same height
  // leaves the underside of the canopy floating where the tree was — which is what the first
  // version of this did, and it read as a bush rather than a stump. Only parts that start at the
  // base survive the cut at all.
  const groundReach = box.min.y + height * 0.1;

  const out: SourcePart[] = [];
  for (const [index, part] of parts.entries()) {
    const bounds = boxes[index];
    if (bounds && bounds.min.y > groundReach) continue;
    const geometry = clipGeometryBelow(part.geometry, part.matrix, cut);
    if (!geometry) continue;
    out.push({
      geometry,
      material: part.material,
      matrix: new THREE.Matrix4(),
      triangles: triangleCount(geometry),
    });
  }
  return out;
}

/**
 * Keeps only the triangles below world height `cut`, with `matrix` baked in.
 *
 * A triangle is kept when its CENTROID is below the cut, which leaves a flat-ish top rather than
 * the ragged fringe an all-vertices test produces on low-poly geometry.
 *
 * Returns null when the cut keeps nothing — for a tree canopy that is the correct answer, and the
 * caller drops the part entirely.
 */
export function clipGeometryBelow(
  geometry: THREE.BufferGeometry,
  matrix: THREE.Matrix4,
  cut: number,
): THREE.BufferGeometry | null {
  const baked = geometry.clone();
  // Quantized GLTF attributes decode through their getters, but matrix baking writes back
  // into the attribute's storage. Metre-space positions overflow normalized integer storage.
  // Decode both transformed attributes before applying the world/normal matrices.
  for (const name of ["position", "normal"] as const) {
    const attribute = baked.getAttribute(name);
    if (!attribute || (attribute.array instanceof Float32Array && !attribute.normalized)) continue;
    const values = new Float32Array(attribute.count * attribute.itemSize);
    for (let vertex = 0; vertex < attribute.count; vertex += 1) {
      for (let component = 0; component < attribute.itemSize; component += 1) {
        values[vertex * attribute.itemSize + component] = attribute.getComponent(vertex, component);
      }
    }
    baked.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
  }
  baked.applyMatrix4(matrix);
  const source = baked.getIndex() ? baked.toNonIndexed() : baked;
  const position = source.getAttribute("position");
  if (!position || position.count < 3) return null;

  const keep: number[] = [];
  for (let triangle = 0; triangle < position.count; triangle += 3) {
    const centroid = (position.getY(triangle) + position.getY(triangle + 1) + position.getY(triangle + 2)) / 3;
    if (centroid <= cut) keep.push(triangle);
  }
  if (keep.length === 0) return null;

  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv", "color"] as const) {
    const attribute = source.getAttribute(name);
    if (!attribute) continue;
    const size = attribute.itemSize;
    const values = new Float32Array(keep.length * 3 * size);
    let write = 0;
    for (const triangle of keep) {
      for (let vertex = 0; vertex < 3; vertex += 1) {
        for (let component = 0; component < size; component += 1) {
          values[write] = attribute.getComponent(triangle + vertex, component);
          write += 1;
        }
      }
    }
    out.setAttribute(name, new THREE.BufferAttribute(values, size));
  }
  out.computeBoundingSphere();
  return out;
}

function boxToBounds(
  box: THREE.Box3,
  meshes: number,
  path: string,
  fade: number,
): { min: Vec3; max: Vec3; meshes: number; path: string; fade: number } {
  return {
    min: [box.min.x, box.min.y, box.min.z] as unknown as Vec3,
    max: [box.max.x, box.max.y, box.max.z] as unknown as Vec3,
    meshes,
    path,
    // `Box3.setFromObject` measures an invisible object exactly as it measures a visible one, so
    // the box alone cannot say whether a corpse is still on screen. This can.
    fade,
  };
}

/**
 * Which batch cell an entity belongs to.
 *
 * Part of the GROUP key as well as the batch key, because a group's parts are uploaded into one
 * cell's batches and every slot in it has to be inside that cell for the bounding sphere to mean
 * anything. `Math.floor` on a negative coordinate still lands in a consistent cell.
 */
function batchCell(archetype: Archetype, position: Vec3): string {
  if (CELL_FREE_ARCHETYPES.has(archetype)) return "*";
  const x = Math.floor(position[0] / BATCH_CELL_SIZE);
  const z = Math.floor(position[2] / BATCH_CELL_SIZE);
  return `${x}_${z}`;
}

/** Switches one slot's instance of a part off, if it ever had one. */
function hideInstance(draw: PartDraw, slot: number): void {
  const instance = draw.instances[slot];
  if (instance === undefined || instance < 0) return;
  draw.batch.mesh.setVisibleAt(instance, false);
}

/**
 * The geometry attributes a batch must agree on, as a comparable string.
 *
 * `BatchedMesh._validateGeometry` throws if an added geometry is missing an attribute the batch
 * already has, or disagrees on `itemSize`/`normalized`, or on whether there is an index at all.
 * This is that contract written down, so the key sorts geometries into compatible batches instead
 * of finding out at `addGeometry`.
 */
function attributeSignature(geometry: THREE.BufferGeometry): string {
  const names = Object.keys(geometry.attributes).sort();
  const parts = names.map((name) => {
    const attribute = geometry.getAttribute(name);
    return `${name}:${attribute.itemSize}${attribute.normalized ? "n" : ""}`;
  });
  parts.push(geometry.getIndex() ? "idx" : "noidx");
  return parts.join(",");
}

/**
 * Material identity ACROSS separately loaded GLBs, so one batch can serve every asset that paints
 * with the same material.
 *
 * The same problem `characterMaterialKey` solves for outfit parts, at world scale: two loads of the
 * medieval-village kit are two `Material` instances holding two `Texture` instances, and comparing
 * by UUID would mean 356 batches instead of 43. Everything the renderer can distinguish is in the
 * key — name, every map's name, colour, the PBR scalars, side, blending and alpha.
 *
 * It is safe because the textures really are the same texture. runs/corealm/dc/matkey.mjs hashes
 * the embedded image bytes of every material in all 213 manifest GLBs and groups them by this key:
 * 63 distinct keys, and ZERO keys carrying more than one image hash. `MI_WoodTrim` is one key
 * across 29 GLBs and one sha1 (f02e4f9db3) across all of them. If that ever stops being true the
 * scan says so, and the failure mode is one wrong texture rather than a crash.
 */
function materialBatchKey(material: THREE.Material): string {
  // Authored items may deliberately reuse material names with different embedded images
  // or physical settings. Their loader-cached material identity is the safe batch boundary.
  if (material.userData["iconAuthored"]) return `item:${material.uuid}`;
  const standard = material as THREE.MeshStandardMaterial;
  const mapName = (map: THREE.Texture | null | undefined): string => (map ? map.name || map.uuid : "-");
  return [
    material.name || material.type,
    material.type,
    mapName(standard.map),
    mapName(standard.normalMap),
    mapName(standard.roughnessMap),
    mapName(standard.metalnessMap),
    mapName(standard.emissiveMap),
    mapName(standard.aoMap),
    mapName(standard.alphaMap),
    standard.color ? standard.color.getHexString() : "-",
    standard.emissive ? standard.emissive.getHexString() : "-",
    standard.emissiveIntensity ?? 1,
    standard.roughness ?? 1,
    standard.metalness ?? 0,
    standard.envMapIntensity ?? 1,
    material.side,
    material.transparent ? "t" : "o",
    material.opacity,
    material.alphaTest,
    material.depthWrite ? "dw" : "-",
    material.blending,
    standard.vertexColors ? "vc" : "-",
    standard.flatShading ? "flat" : "-",
    standard.wireframe ? "wire" : "-",
  ].join("|");
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  if (index) return Math.round(index.count / 3);
  const position = geometry.getAttribute("position");
  return position ? Math.round(position.count / 3) : 0;
}

/** Puts a unique object back on the materials its GLB shipped with, before a state is re-applied. */
function restoreBaseMaterials(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const base = mesh.userData.baseMaterial as THREE.Material | THREE.Material[] | undefined;
    if (base) mesh.material = base;
  });
}

/** FNV-1a. Deterministic per-entity seeds, so animation phase survives a reload unchanged. */
function hashString(value: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

/**
 * Whether a clip's tracks address bones this object actually has.
 *
 * `AssetRegistry` keys its clip library by NAME across every pack, and the three monster packs all
 * export a clip called `Idle` on three different skeletons — so "the clip named Idle" is whichever
 * GLB loaded first, and playing it on the wrong rig silently animates nothing. Sampling the first
 * dozen tracks (which are the root and spine bones, i.e. the discriminating ones) is enough to
 * reject a mismatch before it becomes a character frozen in bind pose with no error anywhere.
 */
function clipFits(root: THREE.Object3D, clip: THREE.AnimationClip): boolean {
  let checked = 0;
  let matched = 0;
  for (const track of clip.tracks) {
    if (checked >= 12) break;
    try {
      const parsed = THREE.PropertyBinding.parseTrackName(track.name);
      if (!parsed.nodeName) continue;
      checked += 1;
      if (THREE.PropertyBinding.findNode(root, parsed.nodeName)) matched += 1;
    } catch {
      return false;
    }
  }
  return checked > 0 && matched / checked >= 0.75;
}

/**
 * CPU-skins one posed frame of a `SkinnedMesh` into a static geometry.
 *
 * The bone matrices come from the object's world matrices, so the caller must have posed the
 * skeleton and called `updateMatrixWorld` first. Skin attributes are dropped from the result: they
 * are dead weight on an instanced draw, and leaving them means Three.js still reports the geometry
 * as skinnable.
 *
 * Returns null rather than the source geometry when the mesh cannot be baked. The caller registers
 * whatever it gets back for disposal, and handing it the shared source geometry would mean
 * disposing the asset itself out from under every other user of it.
 */
function freezeSkin(mesh: THREE.SkinnedMesh): THREE.BufferGeometry | null {
  const source = mesh.geometry;
  const position = source.getAttribute("position");
  if (!position || !source.getAttribute("skinIndex") || !source.getAttribute("skinWeight")) {
    return null;
  }

  const baked = source.clone();
  const output = new THREE.Float32BufferAttribute(new Float32Array(position.count * 3), 3);
  const vertex = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);
    mesh.applyBoneTransform(index, vertex);
    output.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }

  baked.setAttribute("position", output);
  baked.deleteAttribute("skinIndex");
  baked.deleteAttribute("skinWeight");
  // Normals were authored for the bind pose; a bent elbow needs them recomputed or it lights flat.
  baked.computeVertexNormals();
  baked.computeBoundingSphere();
  return baked;
}
