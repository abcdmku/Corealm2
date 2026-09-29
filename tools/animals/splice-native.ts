/**
 * Splice the Animal pack deluxe studio takes back into the current production GLBs.
 *
 * The meshes, skins, inverse binds and rest TRS of every pack body never changed after the first
 * import; only the clips were rebuilt. So this does not reconvert anything. It reads each take from
 * the pack FBX (tools/creature-motion/source-clips.ts), binds every track to the production node
 * with the same FBX identity (name, plus parent chain where a rig repeats a name), and swaps the
 * clips of the current production file. Textures, polished skins, rig additions (goose wings,
 * salamander jaw, snail shell/eyes) and presentation wrappers stay exactly as they are.
 *
 * Allowed changes, per the motion brief: clip renaming, root XZ pinned to rest (root Y kept), one
 * appended closing key on looping clips whose take does not already close, `resample()` at its
 * default 1e-4 tolerance, and dropping tracks on nodes that deform nothing (IK helpers). Nothing
 * else touches a native key.
 *
 *   npx tsx tools/animals/splice-native.ts [--only animal_deer,animal_bear] [--out dir]
 *
 * Writes <out>/models/<production path>.glb and <out>/catalog.json. Never writes production.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Document, NodeIO, type Accessor, type Node as GltfNode } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds, resample } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { extractSourceClips, type ExtractedSourceClip } from "../creature-motion/source-clips.js";
import { argValue, gameRoot, repoRoot } from "../lib/paths.js";
import { readDonor, retargetClip, type RetargetMap } from "./retarget-native.js";

const PACK_DIR = process.env.ANIMAL_PACK_DIR
  ?? "C:/Users/Borg/.t3/tmp/animalpack/extracted/Assets/Animal pack deluxe";
const RANGES_FILE = process.env.ANIMAL_PACK_RANGES ?? "C:/Users/Borg/.t3/tmp/animalpack/clip-ranges.json";
const SOURCE_FPS = 30;
const LOOPING = new Set(["Idle", "Walk", "Run"]);

/** Runtime clip names; `--try` previews may add any other name. */
type State = string;

/** One pack take. `frames` narrows the Unity range (a slice of an Eat take, say). */
interface Take { file: string; frames?: [number, number]; note?: string }
/** A take authored on a different pack rig, retargeted rest-relative onto this body. */
interface DonorTake extends Take { donor: string; map: RetargetMap }
type StateSource = Take | DonorTake;

interface Body { rig: string; states: Partial<Record<State, StateSource>>; notes?: string[] }

const take = (file: string, frames?: [number, number], note?: string): Take => ({ file, frames, note });

/**
 * Deer-family charge from the goat headbutt. The deer's neck is far longer than the goat's, so a
 * bind-relative copy bent it until the head sank behind the folded forelegs. Start-relative instead:
 * head, ears and neck take the goat's world rotation away from its first frame, the shoulders take a
 * third of it, and pelvis, legs and root hold the deer's own Idle stance. The head drops to chest
 * height with the antlers presented forward. Ibex_Attack read the same; the goat is the closer twin.
 */
export const DEER_CHARGE: [RegExp, number][] = [
  [/_Head_|_Ear_|_Neck_/, 1], [/_Spine_0[34]SHJnt$|_Spine_TopSHJnt$/, 0.3], [/_Tail_/, 0.6],
];

/** Per-body take table; see D:/corealm-scratch/anim-audit/family-animals.md section 1.5. */
export const BODIES: Record<string, Body> = {
  deer: { rig: "Deer_Rig.fbx", states: {
    Idle: take("Deer_Idle.fbx"), Walk: take("Deer_Walk.fbx"), Run: take("Deer_Run.fbx"), Death: take("Deer_Die.fbx"),
    // The pack has no deer attack: the goat headbutt, start-relative (see DEER_CHARGE).
    Attack: { file: "Goat_Attack.fbx", donor: "animal_goat", map: { from: "Goat_", to: "Deer_", startRelative: { weights: DEER_CHARGE } } } } },
  bear: { rig: "Bear_Rig.fbx", states: {
    Idle: take("Bear_Idle.fbx"), Walk: take("Bear_Walk.fbx"), Run: take("Bear_Run.fbx"), Attack: take("Bear_Attack.fbx"), Death: take("Bear_Die.fbx") } },
  wolf: { rig: "Wolf_Rig.fbx", states: {
    Idle: take("Wolf_IdleA.fbx"), Walk: take("Wolf_Walk.fbx"), Run: take("Wolf_Run.fbx"), Attack: take("Wolf_Attack.fbx"),
    // Wolf_Die walks for two seconds before it rears and drops; the hind toes stop at frame 56.
    Death: take("Wolf_Die.fbx", [56, 125], "from the rear-up; the take's walk-in is cut") } },
  cattle: { rig: "Cattle_Rig.fbx", states: {
    Idle: take("Cattle_Idle.fbx"), Walk: take("Cattle_Walk.fbx"), Run: take("Cattle_Run.fbx"), Attack: take("Cattle_Attack.fbx"), Death: take("Cattle_Die.fbx") } },
  goat: { rig: "Goat_Rig.fbx", states: {
    Idle: take("Goat_Idle.fbx"), Walk: take("Goat_Walk.fbx"), Run: take("Goat_Run.fbx"), Attack: take("Goat_Attack.fbx"), Death: take("Goat_Die.fbx") } },
  ibex: { rig: "Ibex_Rig.fbx", states: {
    Idle: take("Ibex_Idle.fbx"), Walk: take("Ibex_Walk.fbx"), Run: take("Ibex_Run.fbx"), Attack: take("Ibex_Attack.fbx"), Death: take("Ibex_Die.fbx") } },
  boar: { rig: "WildBoar_Rig.fbx", states: {
    Idle: take("WildBoar_Idle.fbx"), Walk: take("WildBoar_Walk.fbx"), Run: take("WildBoar_Run.fbx"), Attack: take("WildBoar_Attack.fbx"), Death: take("WildBoar_Die.fbx") } },
  hog: { rig: "iron_age_pig_rig_exp.FBX", states: {
    Idle: take("iron_age_pig_idle_anim.FBX"), Walk: take("iron_age_pig_walk_anim.FBX"), Death: take("iron_age_pig_die_anim.FBX"),
    // The pig rig roots its spine at the chest, so only the boar's neck, head, jaw and ears map:
    // the attack is the boar's native tusk toss on a still body.
    Attack: { file: "WildBoar_Attack.fbx", donor: "animal_boar", map: { from: "WildBoar_", to: "-", extra: {
      WildBoar_Neck_01SHJnt: "Bone012", WildBoar_Neck_02SHJnt: "Bone013", WildBoar_Neck_TopSHJnt: "Bone014",
      WildBoar_Head_JawSHJnt: "Bone017", WildBoar_Nose_01_01SHJnt: "Bone035",
      WildBoar_l_Ear_01_01SHJnt: "Bone019(mirrored)", WildBoar_l_Ear_01_02SHJnt: "Bone020(mirrored)",
      WildBoar_r_Ear_01_01SHJnt: "Bone019", WildBoar_r_Ear_01_02SHJnt: "Bone020" } } } } },
  rabbit: { rig: "WildRabbit_Rig.fbx", states: {
    Idle: take("WildRabbit_Idle.fbx"), Walk: take("WildRabbit_Walk.fbx"), Run: take("WildRabbit_Run.fbx"), Death: take("WildRabbit_Die.fbx") } },
  rat: { rig: "rat_rig_exp.FBX", states: {
    Idle: take("rat_idle_anim.FBX"), Walk: take("rat_walk_anim.FBX"), Death: take("rat_die_anim.FBX") } },
  frog: { rig: "common_frog_rig_exp.FBX", states: {
    Idle: take("common_frog_idle_anim.FBX"), Walk: take("common_frog_walk_anim.FBX"), Run: take("common_frog_run_anim.FBX"), Death: take("common_frog_die_anim.FBX") } },
  chicken: { rig: "Chicken_Rig.fbx", states: {
    Idle: take("Chicken_Idle.fbx"), Walk: take("Chicken_Walk.fbx"), Run: take("Chicken_Run.fbx"), Death: take("Chicken_Die.fbx"),
    // Opening of the native feeding take: the head drives from standing to the ground in twelve
    // frames (8-20). The rest of the take is ground pecking, so the slice ends there.
    Attack: take("Chicken_Eat.fbx", [1, 26], "peck: opening strike of the native Eat take") } },
  viper: { rig: "Viper_Rig.fbx", states: {
    Idle: take("Viper_Idle.fbx"), Walk: take("Viper_Glide.fbx"), Run: take("Viper_FastGlide.fbx"), Attack: take("Viper_Attack.fbx"), Death: take("Viper_Die.fbx") } },
  scorpion: { rig: "Scorpion_Rig.fbx", states: {
    Idle: take("Scorpion_Idle.fbx"), Walk: take("Scorpion_Walk.fbx"), Run: take("Scorpion_Run.fbx"), Attack: take("Scorpion_Attack.fbx"), Death: take("Scorpion_Die.fbx") } },
  crocodile: { rig: "Crocodile_Rig.fbx", states: {
    Idle: take("Crocodile_Idle.fbx"), Walk: take("Crocodile_Walk.fbx"), Run: take("Crocodile_Run.fbx"), Attack: take("Crocodile_Bite.fbx"), Death: take("Crocodile_Die.fbx") } },
  salamander: { rig: "FireSalamander_Rig.fbx", states: {
    Idle: take("FireSalamander_Idle.fbx"), Walk: take("FireSalamander_Walk.fbx"), Run: take("FireSalamander_Run.fbx"), Death: take("FireSalamander_Die.fbx"),
    // Same joint template as the crocodile; the croc jaw drives the salamander's added jaw joint.
    Attack: { file: "Crocodile_Bite.fbx", donor: "creature_reedjaw_crocodile", map: { from: "Crocodile_", to: "FireSalamander_",
      extra: { Crocodile_Head_JawSHJnt: "Salamander_LowerJaw" } } } } },
  goose: { rig: "swan_goose_rig_exp.FBX", states: {
    Idle: take("swan_goose_idle_anim.FBX"), Walk: take("swan_goose_walk_anim.FBX"), Run: take("swan_goose_run_anim.FBX"), Death: take("swan_goose_die_anim.FBX"),
    // The native feeding lunge: the bill drives 36 cm forward and down to the ground (700-740)
    // and returns to the standing pose (786). The static tail of the take is left out.
    Attack: take("swan_goose_eat_anim.FBX", [700, 786], "bill lunge: the native Eat take's dip and return") } },
  snail: { rig: "snail_rig_exp.FBX", states: {
    Idle: take("snail_idle_anim.FBX"), Walk: take("snail_walk_anim.FBX"), Death: take("snail_die_anim.FBX") } },
};

/** Production asset id -> body. Fish, horse and crab are out of scope. */
export const ASSETS: Record<string, string> = {
  animal_deer: "deer", creature_crown_hart: "deer", fairy_garden_hart_gloamgarden: "deer", fairy_garden_hart_faeholme: "deer",
  animal_bear: "bear", animal_coyote: "wolf", animal_cattle: "cattle", animal_aurochs: "cattle",
  animal_goat: "goat", animal_ibex: "ibex", animal_boar: "boar", animal_hog: "hog",
  animal_rabbit: "rabbit", animal_rabbit_dark: "rabbit", creature_heath_jack: "rabbit", animal_rat: "rat",
  animal_frog: "frog", animal_frog_green: "frog", fairy_garden_frog_gloamgarden: "frog", fairy_garden_frog_faeholme: "frog",
  animal_chicken: "chicken", animal_chicken_speckled: "chicken", animal_viper: "viper", animal_scorpion: "scorpion",
  creature_reedjaw_crocodile: "crocodile", creature_kiln_salamander: "salamander", creature_reedbank_goose: "goose",
  creature_quarry_snail: "snail", fairy_garden_snail_faeholme: "snail",
};

interface ManifestAsset {
  id: string; file: string; pack: string; category: string; is: string; tags: string[];
  materials: string[]; [key: string]: unknown;
}

interface Channel { node: GltfNode; path: "translation" | "rotation" | "scale"; times: Float32Array<ArrayBuffer>; values: Float32Array<ArrayBuffer> }
interface SplicedClip { state: State; channels: Channel[]; duration: number; closingKey: boolean; seamRatio: number; dropped: string[]; source: string }

function sourceKey(source: StateSource): string {
  const donor = "donor" in source ? `${source.donor}_` : "";
  return `${donor}${source.file}${source.frames ? `@${source.frames.join("-")}` : ""}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function loadRanges(): Promise<Map<string, [number, number]>> {
  const raw = JSON.parse(await readFile(RANGES_FILE, "utf8")) as Record<string, { first: number; last: number }>;
  return new Map(Object.entries(raw).map(([file, range]) => [file.toLowerCase(), [range.first, range.last]]));
}

/** Extract every take the selected assets need, once each, in one Chromium session. */
async function extractTakes(sources: StateSource[], cacheDir: string): Promise<Map<string, ExtractedSourceClip>> {
  const ranges = await loadRanges();
  const unique = new Map<string, StateSource>();
  for (const source of sources) unique.set(sourceKey(source), source);
  const requests = [...unique].map(([id, source]) => {
    const frames = source.frames ?? ranges.get(source.file.toLowerCase());
    if (!frames) throw new Error(`No Unity clip range for ${source.file}`);
    return { id, file: path.join(PACK_DIR, "Animations", source.file), name: id, frames, fps: SOURCE_FPS };
  });
  const clips = await extractSourceClips(requests, cacheDir);
  return new Map(clips.map((clip) => [clip.id, clip]));
}

function nodePath(node: GltfNode, parents: Map<GltfNode, GltfNode>): string[] {
  const names: string[] = [];
  for (let at: GltfNode | undefined = node; at; at = parents.get(at)) names.unshift(at.getName());
  return names;
}

/**
 * Binds a source track to one production node by FBX identity: the node name, and where a rig
 * repeats a name (the deer's horn skin duplicates its neck/head/ear chain), the parent chain.
 */
function bindTrack(
  trackName: string, sourceNodeId: number | null, clip: ExtractedSourceClip,
  byName: Map<string, GltfNode[]>, parents: Map<GltfNode, GltfNode>,
): GltfNode | null {
  const name = trackName.slice(0, trackName.lastIndexOf("."));
  const candidates = byName.get(name) ?? [];
  if (candidates.length <= 1) return candidates[0] ?? null;
  const target = clip.targets.find((entry) => entry.fbxId === sourceNodeId && entry.name === name);
  if (!target) throw new Error(`Ambiguous ${name} and no FBX identity for its track`);
  const chain = [...target.parentChain, name].filter(Boolean);
  const score = (node: GltfNode) => {
    const own = nodePath(node, parents).filter(Boolean);
    let matched = 0;
    while (matched < Math.min(own.length, chain.length) && own[own.length - 1 - matched] === chain[chain.length - 1 - matched]) matched++;
    return matched;
  };
  const ranked = candidates.map((node) => ({ node, score: score(node) })).sort((a, b) => b.score - a.score);
  if (ranked[0]!.score === ranked[1]!.score) throw new Error(`Cannot separate duplicate ${name} by parent chain`);
  return ranked[0]!.node;
}

function quatAngle(a: ArrayLike<number>, i: number, b: ArrayLike<number>, j: number): number {
  const dot = Math.abs(a[i]! * b[j]! + a[i + 1]! * b[j + 1]! + a[i + 2]! * b[j + 2]! + a[i + 3]! * b[j + 3]!);
  return 2 * Math.acos(Math.min(1, dot));
}

/**
 * Turn one extracted take into production channels. Root XZ is pinned to the production rest
 * translation; everything else is the native key data. Looping clips get at most one closing key.
 */
function spliceClip(
  state: State, clip: ExtractedSourceClip, doc: Document, rootJoints: Set<GltfNode>, deforming: Set<GltfNode>,
): SplicedClip {
  const nodes = doc.getRoot().listNodes();
  const parents = new Map<GltfNode, GltfNode>();
  for (const node of nodes) for (const child of node.listChildren()) parents.set(child, node);
  const byName = new Map<string, GltfNode[]>();
  for (const node of nodes) byName.set(node.getName(), [...(byName.get(node.getName()) ?? []), node]);

  const channels: Channel[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const track of clip.tracks) {
    const property = track.name.slice(track.name.lastIndexOf(".") + 1);
    const pathName = property === "position" ? "translation" : property === "quaternion" ? "rotation" : property === "scale" ? "scale" : null;
    if (!pathName) { dropped.push(`${track.name} (unsupported)`); continue; }
    const node = bindTrack(track.name, track.sourceNodeId, clip, byName, parents);
    if (!node) { dropped.push(`${track.name} (no node)`); continue; }
    if (!deforming.has(node)) { dropped.push(`${track.name} (non-deforming)`); continue; }
    const key = `${nodes.indexOf(node)}:${pathName}`;
    if (seen.has(key)) throw new Error(`Two source tracks bind to ${track.name}`);
    seen.add(key);
    const values = Float32Array.from(track.values);
    if (pathName === "translation" && rootJoints.has(node)) {
      const rest = node.getTranslation();
      for (let i = 0; i < values.length; i += 3) { values[i] = rest[0]; values[i + 2] = rest[2]; }
    }
    channels.push({ node, path: pathName, times: Float32Array.from(track.times), values });
  }

  let duration = clip.duration;
  let closingKey = false;
  let seamRatio = 0;
  if (LOOPING.has(state)) {
    // A take either ends on its opening pose (closed: appending a key would add a held frame, a
    // visible hitch) or one frame short of it (open: it needs exactly one closing key). A track
    // counts as open when its last-to-first gap is a real fraction of its own frame step and more
    // than two degrees (or 0.05 source units); sub-degree residue on a near-static bone is closed.
    for (const channel of channels) {
      const size = channel.path === "rotation" ? 4 : 3;
      const count = channel.times.length;
      if (count < 2) continue;
      const last = (count - 1) * size;
      const gap = size === 4 ? quatAngle(channel.values, 0, channel.values, last)
        : Math.hypot(channel.values[0]! - channel.values[last]!, channel.values[1]! - channel.values[last + 1]!, channel.values[2]! - channel.values[last + 2]!);
      let step = 0;
      for (let i = 1; i < count; i++) {
        const a = (i - 1) * size, b = i * size;
        const frames = Math.max(1, (channel.times[i]! - channel.times[i - 1]!) * SOURCE_FPS);
        step = Math.max(step, (size === 4 ? quatAngle(channel.values, a, channel.values, b)
          : Math.hypot(channel.values[a]! - channel.values[b]!, channel.values[a + 1]! - channel.values[b + 1]!, channel.values[a + 2]! - channel.values[b + 2]!)) / frames);
      }
      const threshold = Math.max(size === 4 ? 0.035 : 0.05, 0.25 * step);
      if (gap > threshold) closingKey = true;
      if (step > 0) seamRatio = Math.max(seamRatio, gap / step);
    }
    if (closingKey) {
      const end = duration + 1 / SOURCE_FPS;
      for (const channel of channels) {
        const size = channel.path === "rotation" ? 4 : 3;
        const times = new Float32Array(channel.times.length + 1);
        times.set(channel.times); times[channel.times.length] = end;
        const values = new Float32Array(channel.values.length + size);
        values.set(channel.values);
        const last = channel.values.length - size;
        let sign = 1;
        if (size === 4) {
          const dot = channel.values[0]! * channel.values[last]! + channel.values[1]! * channel.values[last + 1]!
            + channel.values[2]! * channel.values[last + 2]! + channel.values[3]! * channel.values[last + 3]!;
          sign = dot < 0 ? -1 : 1;
        }
        for (let c = 0; c < size; c++) values[channel.values.length + c] = sign * channel.values[c]!;
        channel.times = times; channel.values = values;
      }
      duration = end;
    }
  }
  return { state, channels, duration, closingKey, seamRatio, dropped, source: clip.source.file };
}

function replaceAnimations(doc: Document, clips: SplicedClip[]): void {
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0]!;
  const stale = new Set<Accessor>();
  for (const animation of root.listAnimations()) {
    for (const sampler of animation.listSamplers()) {
      const input = sampler.getInput(), output = sampler.getOutput();
      if (input) stale.add(input);
      if (output) stale.add(output);
    }
    animation.dispose();
  }
  for (const accessor of stale) {
    if (accessor.listParents().every((parent) => parent === root)) accessor.dispose();
  }
  for (const clip of clips) {
    const animation = doc.createAnimation(clip.state);
    for (const channel of clip.channels) {
      const input = doc.createAccessor().setType("SCALAR").setArray(channel.times).setBuffer(buffer);
      const output = doc.createAccessor().setType(channel.path === "rotation" ? "VEC4" : "VEC3").setArray(channel.values).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation("LINEAR");
      animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(channel.node).setTargetPath(channel.path).setSampler(sampler));
    }
  }
}

function round3(value: number): number { return Math.round(value * 1000) / 1000; }

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = argValue(args, "--only")?.split(",").map((id) => id.trim());
  const outDir = path.resolve(argValue(args, "--out") ?? path.join(repoRoot, "test-results", "creature-motion", "animals"));
  const ids = only ?? Object.keys(ASSETS);
  // --try Name=File.fbx[@first-last][~donorId~FromPrefix~ToPrefix[~Src:Dst,...[~deer-charge]]] adds a preview clip to every
  // selected asset, for judging a candidate take on a contact sheet before it enters the table.
  const tries = args.flatMap((arg, index) => args[index - 1] === "--try" ? [arg] : []).map((spec) => {
    const [name, rest] = spec.split("=") as [string, string];
    const [fileRange, donorId, from, to, pairs, preset] = rest.split("~") as [string, string?, string?, string?, string?, string?];
    const startRelative = preset === "deer-charge" ? { weights: DEER_CHARGE } : undefined;
    const extra = pairs ? Object.fromEntries(pairs.split(",").map((pair) => pair.split(":") as [string, string])) : undefined;
    const [file, range] = fileRange.split("@") as [string, string?];
    const frames = range ? range.split("-").map(Number) as [number, number] : undefined;
    const source: StateSource = donorId ? { file, frames, donor: donorId, map: { from: from!, to: to!, extra, startRelative } } : { file, frames };
    return [name, source] as const;
  });
  if (tries.length) for (const id of ids) {
    const bodyName = `${ASSETS[id]}+try`;
    BODIES[bodyName] = { ...BODIES[ASSETS[id]!]!, states: { ...BODIES[ASSETS[id]!]!.states, ...Object.fromEntries(tries) } };
    ASSETS[id] = bodyName;
  }
  for (const id of ids) if (!ASSETS[id]) throw new Error(`Not a pack body: ${id}`);
  if (!existsSync(PACK_DIR)) throw new Error(`Pack not extracted at ${PACK_DIR}`);

  const manifest = JSON.parse(await readFile(path.join(gameRoot, "public", "assets", "manifest.json"), "utf8")) as { assets: ManifestAsset[] };
  const sources = ids.flatMap((id) => Object.values(BODIES[ASSETS[id]!]!.states).filter((source): source is StateSource => Boolean(source)));
  const takes = await extractTakes(sources, path.join(outDir, "source"));

  await MeshoptDecoder.ready; await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

  const catalogFile = path.join(outDir, "catalog.json");
  const catalog = existsSync(catalogFile)
    ? JSON.parse(await readFile(catalogFile, "utf8")) as { assets: Record<string, unknown>[] }
    : { assets: [] };
  for (const id of ids) {
    const body = BODIES[ASSETS[id]!]!;
    const entry = manifest.assets.find((asset) => asset.id === id);
    if (!entry) throw new Error(`No manifest entry for ${id}`);
    const doc = await io.read(path.join(gameRoot, "public", "assets", entry.file));
    const skins = doc.getRoot().listSkins();
    const joints = new Set(skins.flatMap((skin) => skin.listJoints()));
    const parents = new Map<GltfNode, GltfNode>();
    for (const node of doc.getRoot().listNodes()) for (const child of node.listChildren()) parents.set(child, node);
    const ancestors = (node: GltfNode) => { const list: GltfNode[] = []; for (let at = parents.get(node); at; at = parents.get(at)) list.push(at); return list; };
    // The skeleton root is the topmost joint. A joint whose parent merely is not skinned (the hog's
    // Bone003 under an unskinned Bone002) is not a root, and pinning its X would freeze its stretch.
    const rootJoints = new Set([...joints].filter((joint) => !ancestors(joint).some((node) => joints.has(node))));
    // Deforming = skin joints, mesh nodes, and every node above them: an unskinned bone between two
    // joints (hog Bone002) still carries its whole subtree.
    const deforming = new Set<GltfNode>();
    for (const node of [...joints, ...doc.getRoot().listNodes().filter((node) => node.getMesh())]) {
      deforming.add(node);
      for (const above of ancestors(node)) deforming.add(above);
    }

    const spliced: SplicedClip[] = [];
    const donor: Record<string, string> = {};
    const native: string[] = [];
    for (const [state, source] of Object.entries(body.states) as [State, StateSource][]) {
      let clip = takes.get(sourceKey(source))!;
      if ("donor" in source) {
        const donorEntry = manifest.assets.find((asset) => asset.id === source.donor)!;
        const idle = body.states.Idle ? takes.get(sourceKey(body.states.Idle)) : undefined;
        clip = retargetClip(clip, source.map, await readDonor(path.join(gameRoot, "public", "assets", donorEntry.file)), doc, idle);
        donor[state] = `${source.file}${source.frames ? ` frames ${source.frames.join("-")}` : ""} retargeted ${source.map.startRelative ? "start-relative (head/neck full, shoulders 0.3, legs hold own Idle stance)" : "rest-relative"} from the ${source.donor} rig`;
      } else if (source.frames) {
        native.push(state);
        donor[state] = `native ${source.file} frames ${source.frames.join("-")}${source.note ? ` (${source.note})` : ""}`;
      } else native.push(state);
      spliced.push(spliceClip(state, clip, doc, rootJoints, deforming));
    }
    replaceAnimations(doc, spliced);
    await doc.transform(resample());

    const relative = entry.file;
    const outFile = path.join(outDir, "models", relative);
    await mkdir(path.dirname(outFile), { recursive: true });
    const bytes = Buffer.from(await io.writeBinary(doc));
    await writeFile(outFile, bytes);
    const bounds = getBounds(doc.getRoot().listScenes()[0]!);
    const animations = doc.getRoot().listAnimations().map((animation) => animation.getName());
    const notes = spliced.map((clip) => `${clip.state} ${clip.duration.toFixed(3)}s ${clip.channels.length}ch`
      + `${clip.closingKey ? ` +1 closing key` : ""} seam ${clip.seamRatio.toFixed(2)}x`
      + `${clip.dropped.length ? `, dropped ${clip.dropped.length} non-deforming/unbound tracks` : ""}`);
    const row = {
      ...entry,
      bytes: bytes.byteLength,
      size: { x: round3(bounds.max[0] - bounds.min[0]), y: round3(bounds.max[1] - bounds.min[1]), z: round3(bounds.max[2] - bounds.min[2]) },
      base: { x: round3(bounds.min[0]), y: round3(bounds.min[1]), z: round3(bounds.min[2]) },
      animations,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      candidateFile: path.posix.join("models", relative),
      motionProvenance: {
        native: native.filter((state) => !donor[state] || donor[state]!.startsWith("native")),
        donor: Object.fromEntries(Object.entries(donor).filter(([, value]) => !value.startsWith("native"))),
        authored: [],
        notes: [
          `Native Animal pack deluxe takes spliced by node identity into the current production file (mesh, skin, textures unchanged).`,
          ...Object.entries(donor).filter(([, value]) => value.startsWith("native")).map(([state, value]) => `${state}: ${value}`),
          ...(body.notes ?? []),
          ...notes,
        ].join(" "),
      },
    };
    catalog.assets = catalog.assets.filter((asset) => asset.id !== id).concat(row);
    console.log(`${id.padEnd(32)} ${animations.join(",").padEnd(30)} ${notes.join(" | ")}`);
  }
  catalog.assets.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  await writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
