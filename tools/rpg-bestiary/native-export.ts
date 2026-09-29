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
import { applyClip, restorePose, storedPose } from '../creature-motion/pose.js';
import { deformedBounds } from '../creature-motion/validate-deformation.js';
import { repoRoot } from '../lib/paths.js';
import { clipSeconds, compact, fbxSource, gltfSource, io, type NativeSource, type NativeState, sourceJson, transplant, type TransplantOptions } from './native/transplant.js';

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
interface Spec { options: () => Promise<TransplantOptions>; provenance: Provenance; flags?: string[] }
const state = async (as: string, source: Promise<NativeSource>, clip: string): Promise<NativeState> => ({ as, source: await source, clip });

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
const earth = (): Spec => ({
  options: async () => ({ keep: [], rotation: 'rest', translation: 'rest',
    states: await Promise.all([['Idle', 'idle'], ['Walk', 'walking'], ['Attack', 'right punch'], ['Hit', 'take hit'], ['Death', 'death']]
      .map(([as, clip]) => state(as!, earthSource(), clip!))) }),
  provenance: { native: ['Idle', 'Walk', 'Attack', 'Hit', 'Death'], donor: {}, authored: [],
    notes: 'earth elemental.fbx Default Take slices: idle, walking, right punch as Attack, take hit as Hit, death as Death, at native tempo (the x1.16 / x1.12 retimes and the chest sine are gone). No earth_source_ground / studio_contact_correction tracks; no Run (runtime Walk fallback).' },
});

// ---- Beetle Golem [Animated]: native curves at native tempo on the Mossbound anatomy (reshaped binds).
const beetle = (): Spec => ({
  options: async () => ({ keep: [], rotation: 'rest', translation: 'rest',
    states: await Promise.all([['Idle', 'Idle_Normal'], ['Walk', 'Walk'], ['Attack', 'Attack1'], ['AttackSecondary', 'Attack2'], ['Hit', 'Hurt1'], ['Death', 'Death']]
      .map(([as, clip]) => state(as!, beetleSource(), clip!))) }),
  provenance: { native: ['Idle', 'Walk', 'Attack', 'AttackSecondary', 'Hit', 'Death'], donor: {}, authored: [],
    notes: 'BeetleGolem_v3.blend actions (48 Hz source record): Idle_Normal, Walk, Attack1, Attack2 as AttackSecondary, Hurt1 as Hit, Death, at native tempo; applied as deltas from the Mossbound binds. No torso/head sine, no x1.13/x1.21 retime, no ground wrappers, no Run.' },
});

// ---- Quaternius Universal Base Characters: UAL takes on the same 65-joint skeleton, renamed only.
// Like the bandit builder, each take applies from the body's own bind (species proportion maps move
// binds); translation deltas take one uniform scale, the body's hip height over the UAL mannequin's.
type UalTake = readonly [state: string, library: 1 | 2, take: string];
const ubc = (takes: UalTake[], notes: string, prefix = ''): Spec => ({
  options: async () => ({ keep: [], rotation: 'rest', translation: 'rest', pinned: [`${prefix}root`], translationScaleFrom: 'pelvis',
    target: name => `${prefix}${name}`,
    states: await Promise.all(takes.map(([as, library, take]) => state(as, ual(library), take))) }),
  provenance: { native: takes.map(([as]) => as), donor: {}, authored: [],
    notes: `Universal Animation Library takes (raw UAL${takes.some(t => t[1] === 2) ? '1/UAL2' : '1'}_Standard.glb, not the resampled runtime library): ${takes.map(([as, l, take]) => `${take}${l === 2 ? ' (UAL2)' : ''} as ${as}`).join(', ')}. ${notes}` },
});
const humanoid: UalTake[] = [['Idle', 1, 'Idle_Loop'], ['Walk', 1, 'Walk_Loop'], ['Run', 1, 'Jog_Fwd_Loop'], ['Hit', 1, 'Hit_Chest'], ['Death', 1, 'Death01']];
const zombie: UalTake[] = [['Idle', 2, 'Zombie_Idle_Loop'], ['Walk', 2, 'Zombie_Walk_Fwd_Loop'], ['Attack', 2, 'Zombie_Scratch'], ['Hit', 1, 'Hit_Chest'], ['Death', 1, 'Death01']];
const spell: UalTake[] = [['Idle', 1, 'Spell_Simple_Idle_Loop'], ['Walk', 1, 'Walk_Loop'], ['Run', 1, 'Jog_Fwd_Loop'], ['Hit', 1, 'Hit_Chest'], ['Death', 1, 'Death01']];
const noRetime = 'No root pinning beyond the UAL root, no retime, no IK, no floor lift.';
const goblinArcherAttack = (process.env.ARCHER_ATTACK ?? 'Spell_Simple_Shoot') as string;

export const SPECS: Record<string, Spec> = {
  ...Object.fromEntries(Object.entries({
    soldier: undefined,
    archer: 'prop review: the bow is swung like the demo sword; in Walk its lower limb crosses the legs',
    mage: 'prop review: the staff is swung like the demo sword; its foot dips ~5 cm below the floor in Walk and sweeps into it in Attack',
  }).flatMap(([role, prop]) => [`creature_skeleton_${role}`, `creature_skeleton_${role}_elite`].map(id => [id, skeleton(prop)]))),
  creature_cave_roach: roach(),
  creature_wild_goblin: goblin(),
  creature_chalk_warden: earth(),
  creature_cairn_treader: earth(),
  creature_boss_mossbound: beetle(),
  creature_goblin_scout: ubc([...humanoid, ['Attack', 1, 'Sword_Attack']], noRetime),
  creature_moonpetal_stalker: ubc([...humanoid, ['Attack', 1, 'Sword_Attack']], `${noRetime} The heath-jack x1.08 retime is gone.`),
  creature_goblin_archer: ubc([...humanoid, ['Attack', goblinArcherAttack === 'OverhandThrow' ? 2 : 1, goblinArcherAttack]],
    `${noRetime} UAL Standard has no bow draw: Spell_Simple_Shoot (bow arm thrust forward) reads best of the native takes; the authored IK bow draw and frozen fingers are gone.`),
  creature_goblin_shaman: ubc([...spell, ['Attack', 1, 'Spell_Simple_Shoot']], noRetime),
  creature_zombie: ubc(zombie, `${noRetime} UAL2 has no zombie run: Run omitted (runtime Walk fallback).`),
  creature_plague_zombie: ubc(zombie, `${noRetime} UAL2 has no zombie run: Run omitted (runtime Walk fallback).`),
  creature_grave_ghoul: ubc([...zombie, ['Run', 1, 'Jog_Fwd_Loop']], `${noRetime} The extra spine crouch is gone.`),
  creature_grave_lantern: ubc([...zombie, ['Run', 1, 'Jog_Fwd_Loop']], `${noRetime} Grave-ghoul body with prefixed node names.`, 'grave_lantern_'),
  creature_wraith: ubc([...spell, ['Attack', 1, 'Sword_Attack']], noRetime),
  creature_gloam_wraith: ubc([...spell, ['Attack', 1, 'Spell_Simple_Shoot']], `${noRetime} The x1.15 retime and the Idle-as-locomotion hover are gone.`),
  creature_chainbound_archon: ubc([...spell, ['Attack', 1, 'Spell_Simple_Shoot']], noRetime),
  creature_ashbound_votary_elite: ubc([...humanoid, ['Attack', 1, 'Sword_Attack']], `${noRetime} The x1.2 retime and Idle-as-Walk/Run are gone.`),
  creature_iron_golem: ubc([...humanoid, ['Attack', 1, 'Punch_Cross']], `${noRetime} The x1.35/x1.2/x1.3 retimes are gone.`),
  creature_ivory_castellan: ubc([...humanoid, ['Attack', 1, 'Punch_Cross']], `${noRetime} The inherited iron-golem retimes are gone.`),
  creature_scree_watcher: ubc([...humanoid, ['Attack', 1, 'Punch_Cross']], `${noRetime} The x1.07 retime and head/spine sines are gone.`),
  ...Object.fromEntries(['forest', 'highland', 'quarry'].map(region => [`bandit_${region}_ranger`,
    ubc([...humanoid, ['Attack', 1, 'Punch_Jab']], `${noRetime} Replaces the f2969ad clips, which came from the resampled animation_library_1 (Death01 57 of 73 keys), and the later studio_contact_correction lift.`)])),
  creature_kiln_marrow: lava(),
  creature_furnace_regent: lava(),
};

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
  const report = transplant(doc, await spec.options());
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
    base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] }, groundY: bounds.min[1],
    animations: clips.map(clip => clip.getName()), materials: doc.getRoot().listMaterials().map(material => material.getName()),
    walkClipSeconds: seconds('Walk'), runClipSeconds: seconds('Run'), attackSeconds: seconds('Attack'),
    candidateFile, motionProvenance: { ...spec.provenance, sources: report.clips }, reviewFlags: spec.flags ?? [] };
  if (asset.runClipSeconds === undefined) delete asset.runClipSeconds;
  catalog.assets = catalog.assets.filter(other => other.id !== id).concat(asset);
  console.log(JSON.stringify({ id, clips: report.clips.map(c => `${c.name}:${c.seconds.toFixed(3)}s/${c.channels}ch`), kept: clips.filter(c => !report.clips.some(r => r.name === c.getName())).map(c => c.getName()),
    skipped: report.skipped, restDelta: report.maxRestDelta, groundY: +bounds.min[1]!.toFixed(4), bytes: glb.byteLength }));
}
await writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`);
