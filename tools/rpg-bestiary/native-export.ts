/**
 * Faithful native export of the RPG bestiary / Quaternius / OpenGameArt studio bodies.
 * The current production body is kept (mesh, skin, textures, props, elite variants); its clips are
 * replaced by the studio's native takes, renamed to runtime states. Missing Run/Hit are omitted
 * (runtime fallbacks); a Death with no native take is kept untouched and reported as "needs death".
 *
 *   npx tsx tools/rpg-bestiary/native-export.ts [ids...] [--out test-results/creature-motion/rpg]
 *
 * Sources are git-ignored or archived; set COREALM_MAIN when the main checkout moves.
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Document } from '@gltf-transform/core';
import { applyClip, restorePose, storedPose } from '../creature-motion/pose.js';
import { deformedBounds } from '../creature-motion/validate-deformation.js';
import { repoRoot } from '../lib/paths.js';
import { bodyMinY, type ClothOptions, rigCloth, simulateCloth } from './native/cloth.js';
import { clipSeconds, compact, fbxSource, gltfSource, io, lyingLift, type NativeSource, type NativeState, sourceJson, type TakePart, transplant, type TransplantOptions } from './native/transplant.js';

const MAIN = process.env.COREALM_MAIN ?? 'C:/Users/Borg/Documents/GitHub/Corealm2';
const ARCHIVE = 'D:/corealm-evidence-archive/main-test-results';
/** Git-ignored intermediates live in whichever checkout ran the extractors. */
const derived = (relative: string) => [path.join(repoRoot, relative), path.join(MAIN, relative)].find(existsSync)
  ?? (() => { throw new Error(`Missing native source ${relative}`); })();

const memo = new Map<string, Promise<NativeSource> | NativeSource>();
const once = <T extends NativeSource | Promise<NativeSource>>(key: string, load: () => T) => (memo.get(key) ?? memo.set(key, load()).get(key)!) as Promise<NativeSource>;

const skeletonSource = () => once('skeleton', () => {
  const dir = [path.join(repoRoot, 'test-results/rpg-bestiary-skeleton'), path.join(MAIN, 'test-results/rpg-bestiary-skeleton')].find(existsSync);
  if (!dir) throw new Error('Run tools/rpg-bestiary/skeleton-source/extract.py first');
  const base = path.join(dir, 'Assets/DungeonCharacters/Skeletons_demo');
  return fbxSource(path.join(base, 'models/DungeonSkeleton_demo.FBX'), Object.fromEntries(
    ['idle_A', 'walk', 'attack_A'].map(take => [take, path.join(base, `animation/DS_onehand_${take}.FBX`)])));
});
const roachSource = () => once('roach', () => sourceJson(derived('tools/rpg-bestiary/roach-source/derived/source.json'), 'roach'));
const goblinSource = () => once('goblin', () => {
  // The goblin factory names bones mocap_<name> without an index.
  const source = sourceJson(derived('tools/rpg-bestiary/mocap-goblin-source/derived/source.json'), 'mocap');
  return { ...source, rest: new Map([...source.rest].map(([name, rest]) => [name.replace(/^mocap_\d+_/, 'mocap_'), rest])),
    clips: new Map([...source.clips].map(([clip, tracks]) => [clip, tracks.map(track => ({ ...track, node: track.node.replace(/^mocap_\d+_/, 'mocap_') }))])) };
});
const earthSource = () => once('earth', () => sourceJson(derived('tools/rpg-bestiary/earth-elemental-source/derived/source.json'), 'earth'));
const beetleSource = () => once('beetle', () => sourceJson(derived('tools/rpg-bestiary/beetle-golem-source/derived/source.json'), 'beetle'));
const lavaSource = (take: string) => once(`lava-${take}`, () => gltfSource(derived(`tools/rpg-bestiary/lava-golem-source/derived/${take}.glb`),
  (name, index) => `lava_src_${index}_${(name || 'node').replace(/[^a-zA-Z0-9_]/g, '_')}`));
const ual = (library: 1 | 2) => once(`ual${library}`, () => gltfSource(derived(`tools/rpg-bestiary/humanoid-source/derived/UAL${library}_Standard.glb`)));

type Provenance = { native: string[]; donor: Record<string, string>; authored: string[]; retained?: Record<string, string>; notes: string };
/** `lift`: lying clips whose hips drop get the crlib lying-lift envelope (thicker bodies than the mannequin). */
/** `grip`: set a rigid prop's offset along its own axis inside the hand (a re-grip; no motion change). */
/** `hold`: joints held at their first key in the listed clips (a hovering body's legs under its robe). */
/** `cloth`: robe/sleeve spring chains simulated from the body motion; `glide` m/s per clip for a body that floats while it moves. */
/** `hover`: the body floats; it stands on its own origin (groundY 0), not on its lowest idle point. */
/** `toes`: shorten the boot toe caps in front of the ball joint (a mesh fix; the motion is untouched). */
interface Spec { toes?: { meshes: RegExp; scale: number; note: string }; options: () => Promise<TransplantOptions>; provenance: Provenance; flags?: string[]; lift?: { roots: string[]; clips: string[]; lead?: number };
  grip?: { node: string; translation: [number, number, number]; note: string };
  hold?: { joints: RegExp; clips: string[] }; cloth?: ClothOptions & { glide: Record<string, number> }; hover?: boolean }
const state = async (as: string, source: Promise<NativeSource>, clip: string, range?: readonly [number, number]): Promise<NativeState> => ({ as, source: await source, clip, range });

// ---- Dungeon Skeletons Demo: the demo ships only the onehand Idle/Walk/Attack takes.
const skeleton = (prop?: string): Spec => ({
  options: async () => ({ keep: ['Death'], rotation: 'raw', translation: 'raw',
    states: await Promise.all([state('Idle', skeletonSource(), 'idle_A'), state('Walk', skeletonSource(), 'walk'), state('Attack', skeletonSource(), 'attack_A')]) }),
  provenance: { native: ['Idle', 'Walk', 'Attack'], donor: {}, authored: [], retained: { Death: 'Current production Death kept unchanged (UAL Death01 retarget): needs death' },
    notes: 'DS_onehand_idle_A / DS_onehand_walk / DS_onehand_attack_A, FBX takes copied onto the production Bip001 rig unchanged. No SkeletonGround lift, no Run (runtime Walk fallback), no Hit (runtime overlay). Role-arm overrides and authored bow/staff attacks removed.' },
  flags: ['needs death', ...(prop ? [prop] : [])],
});

// ---- Danimal roach: every state native, run = native Flee strip.
const roach = (): Spec => ({
  options: async () => ({ keep: [], rotation: 'raw', translation: 'raw',
    states: await Promise.all([['Idle', 'Idle'], ['Walk', 'Walk'], ['Run', 'Flee'], ['Attack', 'Attack1'], ['AttackSecondary', 'Attack2'], ['Death', 'Die']]
      .map(([as, clip]) => state(as!, roachSource(), clip!))) }),
  provenance: { native: ['Idle', 'Walk', 'Run', 'Attack', 'AttackSecondary', 'Death'], donor: {}, authored: [],
    notes: 'Roach.blend NLA strips (48 Hz source record): Idle, Walk, Flee as Run, Attack1, Attack2 as AttackSecondary, Die as Death. No roach_source_ground lift; no Hit (runtime overlay).' },
});

// ---- gavlig lava golem: three exact Blender takes; no run, hit or death exist.
const lava = (): Spec => ({
  options: async () => ({ keep: ['Death'], rotation: 'raw', translation: 'raw',
    states: await Promise.all([state('Idle', lavaSource('idle'), 'Animation'), state('Walk', lavaSource('walk'), 'Animation'), state('Attack', lavaSource('smash'), 'Animation')]) }),
  provenance: { native: ['Idle', 'Walk', 'Attack'], donor: {}, authored: [], retained: { Death: 'Current production Death kept unchanged (UAL Death01 retarget): needs death' },
    notes: 'golem_clean.blend idle / walk / smash actions (60 fps Blender export). No lava_ground_motion or authored ground tracks; Run and Hit omitted (runtime fallbacks).' },
  flags: ['needs death'],
});

// ---- Danimal mocap goblin: native strips; the locomotion origin is held in place (horizontal only).
const goblinRun = process.env.GOBLIN_RUN !== 'omit';
const goblin = (): Spec => ({
  options: async () => ({ keep: [], rotation: 'raw', translation: 'raw',
    // Hips live under a Z-up armature: local X/Y are horizontal.
    inPlace: { node: 'mocap_Hips', axes: [0, 1], clips: ['Walk', 'Run'] },
    states: await Promise.all([['Idle', 'Idle'], ['Walk', 'Walk'], ...(goblinRun ? [['Run', 'Flee']] : []), ['Attack', 'Attack2'], ['AttackSecondary', 'Attack1'], ['Death', 'Die']]
      .map(([as, clip]) => state(as!, goblinSource(), clip!))) }),
  provenance: { native: ['Idle', 'Walk', ...(goblinRun ? ['Run'] : []), 'Attack', 'AttackSecondary', 'Death'], donor: {}, authored: [],
    notes: `Goblin.blend NLA strips (48 Hz source record): Idle, Walk${goblinRun ? ', Flee as Run' : ''}, Attack2 as Attack, Attack1 as AttackSecondary, Die as Death. Hips horizontal drift held in Walk/Run only. No floor-lift track; no Hit (runtime overlay).` },
});

// ---- piacenti Earth Elemental: one Default Take split by the Unity meta; native tempo (30 Hz ufbx samples).
// Cairn Treader's binds were reshaped, so native deltas apply from each production rest.
// Only the reshaped body (Cairn Treader) gets the lying lift; Chalk Warden's binds are the studio's
// own, so its native Death stays byte-for-byte (its 5 cm floor dip is a native fault, reported).
const earth = (reshaped = false): Spec => ({
  ...(reshaped ? { lift: { roots: ['earth_11_hips'], clips: ['Death'] } } : {}),
  options: async () => ({ keep: [], rotation: 'rest', translation: 'rest',
    states: await Promise.all([['Idle', 'idle'], ['Walk', 'walking'], ['Attack', 'right punch'], ['Hit', 'take hit'], ['Death', 'death']]
      .map(([as, clip]) => state(as!, earthSource(), clip!))) }),
  provenance: { native: ['Idle', 'Walk', 'Attack', 'Hit', 'Death'], donor: {}, authored: [],
    notes: 'earth elemental.fbx Default Take slices: idle, walking, right punch as Attack, take hit as Hit, death as Death, at native tempo (the x1.16 / x1.12 retimes and the chest sine are gone). No earth_source_ground / studio_contact_correction tracks; no Run (runtime Walk fallback).' },
});

// ---- Beetle Golem [Animated]: native curves at native tempo on the Mossbound anatomy (reshaped binds).
// Mossbound's binds are reshaped (37 cm), which drops its native Death 34 cm through the floor.
const beetle = (): Spec => ({
  // The legs hang from the armature beside the body (IK roots), so all three roots lift together.
  lift: { roots: ['beetle_1_Bone', 'beetle_22_Bone_L', 'beetle_26_Bone_R'], clips: ['Death'] },
  options: async () => ({ keep: [], rotation: 'rest', translation: 'rest',
    states: await Promise.all([['Idle', 'Idle_Normal'], ['Walk', 'Walk'], ['Attack', 'Attack1'], ['AttackSecondary', 'Attack2'], ['Hit', 'Hurt1'], ['Death', 'Death']]
      .map(([as, clip]) => state(as!, beetleSource(), clip!))) }),
  provenance: { native: ['Idle', 'Walk', 'Attack', 'AttackSecondary', 'Hit', 'Death'], donor: {}, authored: [],
    notes: 'BeetleGolem_v3.blend actions (48 Hz source record): Idle_Normal, Walk, Attack1, Attack2 as AttackSecondary, Hurt1 as Hit, Death, at native tempo; applied as deltas from the Mossbound binds. No torso/head sine, no x1.13/x1.21 retime, no ground wrappers, no Run.' },
});

// ---- Quaternius Universal Base Characters: UAL takes on the same 65-joint skeleton, renamed only.
// Like the bandit builder, each take applies from the body's own bind (species proportion maps move
// binds); translation deltas take one uniform scale, the body's hip height over the UAL mannequin's.
type UalTake = readonly [state: string, library: 1 | 2, take: string, range?: readonly [from: number, to: number], then?: TakePart[]];
const ubc = (takes: UalTake[], notes: string, prefix = ''): Spec => ({
  lift: { roots: [`${prefix}pelvis`], clips: ['Death'] },
  options: async () => ({ keep: [], rotation: 'rest', translation: 'rest', pinned: [`${prefix}root`], translationScaleFrom: 'pelvis',
    target: name => `${prefix}${name}`,
    states: await Promise.all(takes.map(async ([as, library, take, range, then]) => ({ ...await state(as, ual(library), take, range), then }))) }),
  provenance: { native: takes.map(([as]) => as), donor: {}, authored: [],
    notes: `Universal Animation Library takes (raw UAL${takes.some(t => t[1] === 2) ? '1/UAL2' : '1'}_Standard.glb, not the resampled runtime library): ${takes.map(([as, l, take, range, then]) => `${[[take, range] as TakePart, ...(then ?? [])].map(([t, r]) => `${t}${r ? ` ${r[0]}-${r[1]} s` : ''}`).join(' + ')}${l === 2 ? ' (UAL2)' : ''} as ${as}`).join(', ')}. ${notes}` },
});
const humanoid: UalTake[] = [['Idle', 1, 'Idle_Loop'], ['Walk', 1, 'Walk_Loop'], ['Run', 1, 'Jog_Fwd_Loop'], ['Hit', 1, 'Hit_Chest'], ['Death', 1, 'Death01']];
const zombie: UalTake[] = [['Idle', 2, 'Zombie_Idle_Loop'], ['Walk', 2, 'Zombie_Walk_Fwd_Loop'], ['Attack', 2, 'Zombie_Scratch'], ['Hit', 1, 'Hit_Chest'], ['Death', 1, 'Death01']];
/** Hunched bodies have no Hit: every UAL hit starts upright, and the runtime overlays a Hit as
 * inverse(Idle@0) * Hit(t) on the spine, so Hit_Chest (or Hit_Head) straightened the hunch for the
 * whole flinch. Without one the runtime recoils the spine from the hunched idle itself. */
const hunched = zombie.filter(([as]) => as !== 'Hit');
const noHit = 'Hit omitted (runtime spine recoil from the hunched idle): the upright UAL hits popped the hunch straight.';
const spell: UalTake[] = [['Idle', 1, 'Spell_Simple_Idle_Loop'], ['Walk', 1, 'Walk_Loop'], ['Run', 1, 'Jog_Fwd_Loop'], ['Hit', 1, 'Hit_Chest'], ['Death', 1, 'Death01']];
/** The UAL cast gesture, raise then lower (Enter ends exactly where Exit starts). Spell_Simple_Shoot
 * alone is a 0.5 s held arm, and chained between them it pops the forearm 28 degrees. */
const cast: UalTake = ['Attack', 1, 'Spell_Simple_Enter', undefined, [['Spell_Simple_Exit']]];
const noRetime = 'No root pinning beyond the UAL root, no retime, no IK, no floor lift.';
/**
 * Robed spirits float: the robe hangs to the floor with no feet under it. They do not walk: Walk
 * and Run play the plain standing idle with the legs held under the robe while the body glides,
 * and the robe (and any sleeve membrane) is cloth simulated from the body's motion, trailing
 * from the glide's drag. Their Idle is Idle_Loop, not Spell_Simple_Idle_Loop, which held one arm
 * out in a frozen cast for the whole loop.
 */
const GLIDE = { Walk: 1.4, Run: 3.2 };
const robe = (mesh: RegExp, sleeves?: RegExp, hood?: { mesh: RegExp; from: number }): NonNullable<Spec['cloth']> => ({
  specs: [
    // A heavy robe: soft pull, most of its hang kept in world space, real damping.
    { kind: 'skirt', meshes: mesh, parent: 'pelvis', top: 0, chains: 12, segments: 4, stiffness: 45, damping: 5, gravity: 2, hang: 0.55, drag: 2 },
    // A light torn membrane lags more.
    // A stiff linen peak keeps its shape and bends where it meets the floor.
    ...(hood ? [{ kind: 'tip' as const, meshes: hood.mesh, parent: 'Head', from: hood.from, segments: 3, stiffness: 260, damping: 14, gravity: 1, hang: 0, drag: 0.5 }] : []),
    ...(sleeves ? [{ kind: 'sleeve' as const, meshes: sleeves, arm: ['upperarm', 'lowerarm', 'hand'], chains: 5, segments: 3, stiffness: 14, damping: 3, gravity: 6, hang: 0.8, drag: 2.5 }] : []),
  ],
  colliders: [...['l', 'r'].flatMap(side => [
    { from: `thigh_${side}`, to: `calf_${side}`, radius: 0.1 }, { from: `calf_${side}`, to: `foot_${side}`, radius: 0.075 }, { from: `foot_${side}`, to: `ball_${side}`, radius: 0.05 }]),
    { from: 'pelvis', to: 'spine_02', radius: 0.15 }, { from: 'spine_02', to: 'neck_01', radius: 0.15 }],
  spine: [], glide: GLIDE,
});
const hoverTakes: UalTake[] = [['Idle', 1, 'Idle_Loop'], ['Walk', 1, 'Idle_Loop'], ['Run', 1, 'Idle_Loop'], ['Hit', 1, 'Hit_Chest'], ['Death', 1, 'Death01']];
const hover = (cloth: NonNullable<Spec['cloth']>, notes: string): Spec => {
  const spec = ubc([...hoverTakes, cast], `${noRetime} ${notes} Hovering body: Idle_Loop as Idle, and as Walk and Run with the thigh, calf, foot and ball joints held at their first key (no stepping) while it glides at ${GLIDE.Walk} / ${GLIDE.Run} m/s. The robe skirt${cloth.specs.length > 1 ? ' and the arm membranes' : ''} hang on cloth joints driven by a damped spring simulation of the body motion (legs, hips and chest as colliders, floor plane), baked into every clip; air drag against the glide trails the robe in Walk and Run.`);
  return { ...spec, hover: true, cloth, hold: { joints: /(thigh|calf|foot|ball)/, clips: ['Walk', 'Run'] }, lift: { ...spec.lift!, lead: 14 } };
};

export const SPECS: Record<string, Spec> = {
  ...Object.fromEntries(Object.entries({
    soldier: undefined,
    archer: 'prop review: the bow is swung like the demo sword; in Walk its lower limb crosses the legs',
    mage: 'prop review: the staff is swung like the demo sword; its foot dips ~5 cm below the floor in Walk and sweeps into it in Attack',
  }).flatMap(([role, prop]) => [`creature_skeleton_${role}`, `creature_skeleton_${role}_elite`].map(id => [id, skeleton(prop)]))),
  creature_cave_roach: roach(),
  creature_wild_goblin: goblin(),
  creature_chalk_warden: earth(),
  creature_cairn_treader: earth(true),
  creature_boss_mossbound: beetle(),
  creature_goblin_scout: ubc([...humanoid, ['Attack', 1, 'Sword_Attack']], noRetime),
  creature_moonpetal_stalker: ubc([...humanoid, ['Attack', 1, 'Sword_Attack']], `${noRetime} The heath-jack x1.08 retime is gone.`),
  // The bow arm rises to aim and drops again (the cast enter and exit); Spell_Simple_Shoot alone
  // held the aimed arm still for the whole attack.
  creature_goblin_archer: ubc([...humanoid, cast],
    `${noRetime} UAL Standard has no bow draw: the bow arm is raised to aim and lowered (Spell_Simple_Enter then Exit); Spell_Simple_Shoot alone was a frozen aim. The authored IK bow draw and frozen fingers are gone.`),
  // The staff hung 60% of its length below the hand, so its foot scraped 2-6 cm through the floor in Walk, Run and Hit.
  // Idle_Loop, not Spell_Simple_Idle_Loop (a cast arm held out for the whole loop). No Run: the
  // jog pumps the staff hand to the chest, which drives the staff through the head at any grip.
  creature_goblin_shaman: { ...ubc([...humanoid.filter(([as]) => as !== 'Run'), cast], `${noRetime} Run omitted (runtime Walk fallback): Jog_Fwd_Loop swung the staff through the head.`),
    grip: { node: 'prop_0', translation: [0, 0.95, 0], note: 'The staff is re-gripped low on its shaft (45 cm from the source grip, the hand near its foot) so it stands up from the fist like a walking staff and swings clear of the legs and floor in Walk and Hit.' } },
  creature_zombie: ubc(hunched, `${noRetime} UAL2 has no zombie run: Run omitted (runtime Walk fallback). ${noHit}`),
  creature_plague_zombie: ubc(hunched, `${noRetime} UAL2 has no zombie run: Run omitted (runtime Walk fallback). ${noHit}`),
  creature_grave_ghoul: ubc([...hunched, ['Run', 1, 'Jog_Fwd_Loop']], `${noRetime} The extra spine crouch is gone. ${noHit}`),
  creature_grave_lantern: ubc([...zombie, ['Run', 1, 'Jog_Fwd_Loop']], `${noRetime} Grave-ghoul body with prefixed node names.`, 'grave_lantern_'),
  creature_wraith: hover(robe(/Male_Wizard_Body$/), `Sword_Attack's lunge drove the robe 27 cm through the floor and swung an empty hand.`),
  creature_gloam_wraith: hover(robe(/Male_Wizard_Body$/, /torn_arm_membrane/, { mesh: /Head_Hood$/, from: 0.3 }), 'The x1.15 retime is gone. The torn arm membranes hang from the arm as cloth instead of stretching rigidly from the arm to the hip.'),
  creature_chainbound_archon: hover(robe(/Male_Wizard_Body$/), ''),
  creature_ashbound_votary_elite: hover(robe(/Male_Wizard_Body$/), "The x1.2 retime is gone. Attack chains the cast enter and exit (Sword_Attack's lunge drove the robe 27 cm through the floor)."),
  // No boxing: the golem bodies club overhead with one fist (Sword_Regular_A and its recovery,
  // unarmed); OverhandThrow put their long arms 28 cm through the floor, TreeChopping held both fists at the chest.
  creature_iron_golem: armouredToes(ubc([...humanoid, ['Attack', 2, 'Sword_Regular_A', undefined, [['Sword_Regular_A_Rec']]]], `${noRetime} The x1.35/x1.2/x1.3 retimes are gone. Attack is an unarmed one-fist overhead blow, not the Punch_Cross boxing guard.`)),
  creature_ivory_castellan: armouredToes(ubc([...humanoid, ['Attack', 2, 'Sword_Regular_A', undefined, [['Sword_Regular_A_Rec']]]], `${noRetime} The inherited iron-golem retimes are gone. Attack is an unarmed one-fist overhead blow, not the Punch_Cross boxing guard.`)),
  creature_scree_watcher: ubc([...humanoid, ['Attack', 2, 'OverhandThrow']], `${noRetime} The x1.07 retime and head/spine sines are gone. Attack is the overhand hurl as a stone-palm smash, not the Punch_Cross boxing guard.`),
  ...Object.fromEntries(['forest', 'highland', 'quarry'].map(region => [`bandit_${region}_ranger`,
    // Unarmed: a braced one-fist hammer blow (Sword_Regular_A and its recovery, as the golems club).
    // OverhandThrow read as an empty-handed whirl; Sword_Dash in place dropped to a crawl with a hand
    // on the floor; Sword_Regular_B and Shield_Dash start in a combat stance; Shield_OneShot is a held block.
    ubc([...humanoid, ['Attack', 2, 'Sword_Regular_A', undefined, [['Sword_Regular_A_Rec']]]], `${noRetime} Replaces the f2969ad clips, which came from the resampled animation_library_1 (Death01 57 of 73 keys), and the later studio_contact_correction lift. Attack is an unarmed one-fist hammer blow from a braced crouch (UAL2 Sword_Regular_A and its recovery), not the Punch_Jab boxing guard nor the OverhandThrow whirl.`)])),
  creature_kiln_marrow: lava(),
  creature_furnace_regent: lava(),
};

const LOOPS = new Set(['Idle', 'Walk', 'Run']);
/** Hold every channel of the matching joints at its first key (a held pose, no new motion). */
function holdJoints(doc: Document, joints: RegExp, clips: string[]) {
  for (const clip of doc.getRoot().listAnimations()) {
    if (!clips.includes(clip.getName())) continue;
    for (const channel of clip.listChannels()) {
      if (!joints.test(channel.getTargetNode()?.getName() ?? '')) continue;
      const sampler = channel.getSampler()!, output = sampler.getOutput()!, width = output.getElementSize(), values = output.getArray()!.slice();
      for (let i = width; i < values.length; i++) values[i] = values[i % width]!;
      sampler.setOutput(doc.createAccessor().setType(output.getType()).setArray(values).setBuffer(output.getBuffer()));
    }
  }
}

/** The knight sabatons reach 29 cm past the ball joint (the mannequin's toe is ~7 cm), so at toe-off,
 * when the studio walk points the whole foot down, the toe spike cut 15-22 cm into the floor. */
function armouredToes(spec: Spec): Spec {
  return { ...spec, toes: { meshes: /Feet_Armor$|SuperHero_Male$/, scale: 0.5, note: 'The oversized sabaton toe caps are shortened to half their reach past the ball joint (mesh only), and the boot below the ankle is weighted to the foot instead of the calf, so the toe-off in Walk and the Attack lunge no longer drive the boots through the floor.' } };
}

/** Scale the reach of boot vertices in front of each ball joint and move the boot below the ankle
 * onto the foot (bind pose, skin space). */
function shortenToes(doc: Document, meshes: RegExp, scale: number) {
  for (const node of doc.getRoot().listNodes()) {
    const skin = node.getSkin();
    if (!skin || !node.getMesh() || !meshes.test(node.getName())) continue;
    const joints = skin.listJoints(), index = (name: string) => joints.findIndex(j => j.getName() === name);
    // Joint origins in skin space: the inverse of each inverse bind.
    const origin = (joint: number) => invert4(skin.getInverseBindMatrices()!.getElement(joint, []));
    const sides = ['l', 'r'].map(side => {
      const feet = ['foot', 'ball', 'ball_leaf'].map(n => index(`${n}_${side}`));
      return { feet, calf: index(`calf_${side}`), foot: feet[0]!, z: origin(feet[1]!)[14]!, ankle: origin(feet[0]!)[13]! };
    });
    const band = 0.06;
    for (const prim of node.getMesh()!.listPrimitives()) {
      const P = prim.getAttribute('POSITION')!.clone(), J = prim.getAttribute('JOINTS_0')!.clone(), W = prim.getAttribute('WEIGHTS_0')!.clone();
      prim.setAttribute('POSITION', P).setAttribute('JOINTS_0', J).setAttribute('WEIGHTS_0', W);
      for (let i = 0; i < P.getCount(); i++) {
        const j = J.getElement(i, [] as number[]), w = W.getElement(i, [] as number[]), q = P.getElement(i, [] as number[]);
        // The boot below the ankle rides the foot: calf weight there fades out over a band above the
        // ankle, so a deep knee bend no longer swings the instep and heel cuff into the floor.
        for (const s of sides) {
          const k = j.findIndex((joint, n) => joint === s.calf && w[n]! > 0);
          if (k < 0) continue;
          const keep = Math.min(1, Math.max(0, (q[1]! - s.ankle) / band));
          if (keep >= 1) continue;
          const moved = w[k]! * (1 - keep), f = j.findIndex((joint, n) => joint === s.foot && w[n]! > 0);
          w[k] = w[k]! * keep;
          if (f >= 0) w[f] = w[f]! + moved; else { const free = w.findIndex(x => x === 0); if (free >= 0) { j[free] = s.foot; w[free] = moved; } else w[k] = w[k]! + moved; }
          J.setElement(i, j); W.setElement(i, w);
        }
        const side = sides.find(s => [0, 1, 2, 3].reduce((sum, k) => sum + (s.feet.includes(j[k]!) ? w[k]! : 0), 0) > 0.99);
        const p = P.getElement(i, []);
        if (side && p[2]! > side.z) P.setElement(i, [p[0]!, p[1]!, side.z + (p[2]! - side.z) * scale]);
      }
    }
  }
}
function invert4(m: number[]): number[] {
  // Rigid inverse bind (rotation + translation, uniform scale): origin = -R^T t / s^2.
  const s2 = m[0]! * m[0]! + m[1]! * m[1]! + m[2]! * m[2]!, t = [m[12]!, m[13]!, m[14]!];
  const o = [0, 1, 2].map(c => -(m[c * 4]! * t[0]! + m[c * 4 + 1]! * t[1]! + m[c * 4 + 2]! * t[2]!) / s2);
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, o[0]!, o[1]!, o[2]!, 1];
}

// ---- Export
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const args = process.argv.slice(2), outIndex = args.indexOf('--out');
const out = path.resolve(repoRoot, outIndex < 0 ? 'test-results/creature-motion/rpg' : args.splice(outIndex, 2)[1]!);
const ids = args.length ? args : Object.keys(SPECS);
const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'game/public/assets/manifest.json'), 'utf8')) as { assets: Record<string, unknown>[] };
const catalogFile = path.join(out, 'catalog.json');
const catalog = existsSync(catalogFile) ? JSON.parse(readFileSync(catalogFile, 'utf8')) as { assets: Record<string, unknown>[] } : { assets: [] };
for (const id of ids) {
  const spec = SPECS[id], entry = manifest.assets.find(asset => asset.id === id);
  if (!spec || !entry) throw new Error(`Unknown native export ${id}`);
  const file = entry.file as string, doc = await io.read(path.join(repoRoot, 'game/public/assets', file));
  if (spec.grip) {
    const prop = doc.getRoot().listNodes().find(node => node.getName() === spec.grip!.node);
    if (!prop) throw new Error(`${id}: no prop node ${spec.grip.node}`);
    prop.setTranslation(spec.grip.translation); // absolute, so re-exporting a promoted file is idempotent
  }
  if (spec.toes) shortenToes(doc, spec.toes.meshes, spec.toes.scale);
  const report = transplant(doc, await spec.options());
  if (spec.hold) holdJoints(doc, spec.hold.joints, spec.hold.clips);
  const cloth = spec.cloth ? rigCloth(doc, spec.cloth) : undefined;
  const lifts = Object.fromEntries((spec.lift?.clips ?? []).map(clip => [clip, lyingLift(doc, clip, spec.lift!.roots,
    { lead: spec.lift!.lead, minY: cloth ? () => bodyMinY(doc, cloth.names) : undefined })]).filter(([, lift]) => (lift as number) > 0));
  if (cloth) for (const clip of doc.getRoot().listAnimations()) simulateCloth(doc, cloth, clip.getName(), { loop: LOOPS.has(clip.getName()), glide: spec.cloth!.glide[clip.getName()] });
  await compact(doc);
  const clips = doc.getRoot().listAnimations(), idle = clips.find(clip => clip.getName() === 'Idle')!;
  const pose = storedPose(doc); applyClip(idle, 0); const bounds = deformedBounds(doc); restorePose(pose);
  // Production studio bodies embed their textures; keep them embedded.
  const glb = await io.writeBinary(doc);
  await mkdir(path.dirname(path.join(out, 'models', file.replace(/^models\//, ''))), { recursive: true });
  const candidateFile = `models/${file.replace(/^models\//, '')}`;
  await writeFile(path.join(out, candidateFile), glb);
  const seconds = (name: string) => { const clip = clips.find(c => c.getName() === name); return clip ? clipSeconds(clip) : undefined; };
  const { motionRepair: _retired, ...kept } = entry;
  const asset: Record<string, unknown> = { ...kept, bytes: glb.byteLength, sha256: sha(glb),
    size: { x: bounds.max[0]! - bounds.min[0]!, y: bounds.max[1]! - bounds.min[1]!, z: bounds.max[2]! - bounds.min[2]! },
    base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] }, groundY: spec.hover ? 0 : bounds.min[1], ...(spec.hover ? { hover: true } : {}),
    animations: clips.map(clip => clip.getName()), materials: doc.getRoot().listMaterials().map(material => material.getName()),
    walkClipSeconds: seconds('Walk'), runClipSeconds: seconds('Run'), attackSeconds: seconds('Attack'),
    candidateFile, reviewFlags: spec.flags ?? [],
    motionProvenance: { ...spec.provenance, sources: report.clips, notes: spec.provenance.notes + (spec.grip ? ` ${spec.grip.note}` : '') + (spec.toes ? ` ${spec.toes.note}` : '') + (Object.keys(lifts).length
      ? ` Lying clips lift the hips by a smooth envelope of the skinned mesh's floor penetration, as the creature-rig retarget does for bodies thicker than the donor (end lift ${Object.entries(lifts).map(([c, l]) => `${c} ${(l as number).toFixed(3)} m`).join(', ')}).` : '') } };
  if (asset.runClipSeconds === undefined) delete asset.runClipSeconds;
  catalog.assets = catalog.assets.filter(other => other.id !== id).concat(asset);
  console.log(JSON.stringify({ id, clips: report.clips.map(c => `${c.name}:${c.seconds.toFixed(3)}s/${c.channels}ch`), kept: clips.filter(c => !report.clips.some(r => r.name === c.getName())).map(c => c.getName()),
    skipped: report.skipped, lifts, restDelta: report.maxRestDelta, groundY: +bounds.min[1]!.toFixed(4), bytes: glb.byteLength }));
}
await writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`);
