/** Repair imported creature assets into a review directory; production files are never written. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Animation, Document, Node, NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { resample } from "@gltf-transform/functions";
import { Matrix4, Quaternion, Vector3 } from "three";
import sharp from "sharp";
import { attackProfile, CRAB_IDLE, hitProfile } from "./creature-motion/profiles.js";
import { authorBearHit } from "./creature-motion/bear-hit.js";
import { authorHoovedHit } from "./creature-motion/hooved-hit.js";
import type { HoovedAnimal } from "./creature-motion/hooved-hit.js";
import type { MotionProfile } from "./creature-motion/profiles.js";
import type { ExtractedSourceClip } from "./creature-motion/source-clips.js";
import { deformedBounds } from "./creature-motion/validate-deformation.js";
import { addChannel, applyClip, curve, duration, removeClip, restorePose, storedPose } from "./creature-motion/pose.js";
import { loadContactHelpers } from "./calibrate-legacy-gait.js";
import type { ContactMeasurement } from "./calibrate-legacy-gait.js";
import { loadGeometryGlb } from "./player-locomotion-audit.js";

const repo = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = path.join(repo, "game/public/assets/models");
const outputRoot = path.join(repo, "runs/local-creature-rebuild");
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
type ClipMetadata = { clip: string; seconds: number; contactNormalized: number; source: string; label: string };

function authorMotion(doc: Document, name: string, profile: MotionProfile, baseName = "Idle"): number {
  const base = doc.getRoot().listAnimations().find(c => c.getName() === baseName)!;
  if (!base) throw new Error(`${name}: missing ${baseName} pose`);
  const original = storedPose(doc);
  applyClip(base, 0);
  const initial = storedPose(doc);
  const nodes = doc.getRoot().listNodes();
  const skeleton = new Set(doc.getRoot().listSkins().flatMap(skin => skin.listJoints()));
  const animated = new Map<Node, typeof profile.joints>();
  for (const gesture of profile.joints) {
    const matches = nodes.filter(n => skeleton.has(n) && gesture.bone.test(n.getName()));
    if (!matches.length) throw new Error(`${name}: ${gesture.bone} addresses no skin joint`);
    for (const node of matches) animated.set(node, [...(animated.get(node) ?? []), gesture]);
  }
  const axes = new Map<Node, Record<"x" | "y" | "z", Vector3>>();
  for (const node of animated.keys()) {
    const worldRotation = new Quaternion();
    new Matrix4().fromArray(node.getWorldMatrix()).decompose(new Vector3(), worldRotation, new Vector3());
    worldRotation.invert();
    axes.set(node, {
      x: new Vector3(1, 0, 0).applyQuaternion(worldRotation).normalize(),
      y: new Vector3(0, 1, 0).applyQuaternion(worldRotation).normalize(),
      z: new Vector3(0, 0, 1).applyQuaternion(worldRotation).normalize(),
    });
  }
  restorePose(original);
  removeClip(doc, name);
  const clip = doc.createAnimation(name);
  const steps = Math.ceil(profile.seconds * 30);
  const times = Array.from({ length: steps + 1 }, (_, i) => i * profile.seconds / steps);
  // Hold the complete source idle pose, including nonjoint wrappers addressed by the source.
  // This keeps missing channels from reverting to a different bind pose during a crossfade.
  const baseTargets = new Set(base.listChannels().map(c => c.getTargetNode()!));
  const bindPose = new Map(original.map(p => [p.node, p]));
  for (const p of initial) {
    if (!skeleton.has(p.node) && !baseTargets.has(p.node)) continue;
    const gestures = animated.get(p.node);
    const bind = bindPose.get(p.node)!;
    if (p.t.some((v, i) => Math.abs(v - bind.t[i]!) > 0.00001)) addChannel(doc, clip, p.node, "translation", [0, profile.seconds], [...p.t, ...p.t]);
    if (p.s.some((v, i) => Math.abs(v - bind.s[i]!) > 0.00001)) addChannel(doc, clip, p.node, "scale", [0, profile.seconds], [...p.s, ...p.s]);
    if (!gestures) {
      if (new Quaternion().fromArray(p.r).angleTo(new Quaternion().fromArray(bind.r)) > 0.00001) addChannel(doc, clip, p.node, "rotation", [0, profile.seconds], [...p.r, ...p.r]);
      continue;
    }
    const values: number[] = [];
    for (const time of times) {
      const rotation = new Quaternion().fromArray(p.r);
      for (const gesture of gestures) {
        const radians = curve(profile.phases, gesture.angles, time / profile.seconds) * Math.PI / 180;
        rotation.multiply(new Quaternion().setFromAxisAngle(axes.get(p.node)![gesture.axis], radians));
      }
      values.push(...rotation.normalize().toArray());
    }
    addChannel(doc, clip, p.node, "rotation", times, values);
  }
  clip.setExtras({ authored: true, contactNormalized: profile.contactNormalized, description: profile.label });
  return animated.size;
}

function parentChain(node: Node): string[] {
  const chain: string[] = [];
  let parent = node.getParentNode();
  while (parent) { if (parent.getName()) chain.unshift(parent.getName()); parent = parent.getParentNode(); }
  return chain;
}

function skeletonRoots(joints: Set<Node>): Node[] {
  return [...joints].filter(node => {
    let parent = node.getParentNode();
    while (parent) {
      if (joints.has(parent)) return false;
      parent = parent.getParentNode();
    }
    return true;
  });
}

function importSource(doc: Document, source: ExtractedSourceClip, name: string): void {
  removeClip(doc, name);
  const clip = doc.createAnimation(name);
  const nodes = doc.getRoot().listNodes();
  const joints = new Set(doc.getRoot().listSkins().flatMap(s => s.listJoints()));
  const deforming = new Set([...joints, ...nodes.filter(n => n.getMesh())]);
  const topJoints = new Set(skeletonRoots(joints));
  const assigned = new Set<string>();
  for (const track of source.tracks) {
    const split = track.name.lastIndexOf(".");
    const nodeName = track.name.slice(0, split);
    const property = track.name.slice(split + 1);
    const target = property === "position" ? "translation" : property === "quaternion" ? "rotation" : property === "scale" ? "scale" : null;
    if (!target) continue;
    const sourceNodes = source.targets.filter(t => t.fbxId === track.sourceNodeId && t.name === nodeName).sort((a, b) => a.parentChain.length - b.parentChain.length);
    const sourceNode = sourceNodes[0];
    const candidates = nodes.filter(n => n.getName() === nodeName);
    if (!candidates.length) continue; // exporter dropped IK helpers that deform no vertices
    let node = candidates[0]!;
    if (candidates.length > 1) {
      if (!sourceNode) throw new Error(`${source.id}: ${nodeName} lacks source identity`);
      const chain = sourceNode.parentChain.filter(Boolean).join("/");
      const exact = candidates.filter(n => parentChain(n).join("/") === chain);
      if (exact.length !== 1) throw new Error(`${source.id}: ambiguous hierarchy ${chain}/${nodeName}`);
      node = exact[0]!;
    }
    // Wrapper ancestors also reach vertices; include them if they have a deforming descendant.
    if (!deforming.has(node)) {
      let needed = false;
      node.traverse(n => { if (deforming.has(n)) needed = true; });
      if (!needed) continue;
    }
    const key = `${nodes.indexOf(node)}:${target}`;
    if (assigned.has(key)) throw new Error(`${source.id}: repeated animation target ${key}`);
    assigned.add(key);
    const values = track.values.slice();
    if (target === "translation" && topJoints.has(node)) {
      // Navigation owns horizontal travel. Keep source vertical compression and weight shift.
      const rest = node.getTranslation();
      for (let i = 0; i < values.length; i += 3) { values[i] = rest[0]!; values[i + 2] = rest[2]!; }
    }
    addChannel(doc, clip, node, target, track.times, values);
  }
  clip.setExtras({ source: path.basename(source.source.file), sourceSha256: source.source.sha256, importedByIdentity: true });
}

function closeImportedLoop(doc: Document, name: string): void {
  const clip = doc.getRoot().listAnimations().find(c => c.getName() === name)!;
  let angularGap = 0;
  for (const channel of clip.listChannels()) {
    if (channel.getTargetPath() !== "rotation") continue;
    const values = channel.getSampler()!.getOutput()!.getArray()!;
    const first = new Quaternion().fromArray(Array.from(values.slice(0, 4), Number));
    const last = new Quaternion().fromArray(Array.from(values.slice(-4), Number));
    angularGap = Math.max(angularGap, first.angleTo(last));
  }
  if (angularGap < 2 * Math.PI / 180) return;
  const end = duration(clip) + 3 / 30;
  for (const sampler of clip.listSamplers()) {
    const input = sampler.getInput()!, output = sampler.getOutput()!;
    const times = Array.from(input.getArray()!, Number), values = Array.from(output.getArray()!, Number);
    times.push(end); values.push(...values.slice(0, output.getElementSize()));
    sampler.setInput(doc.createAccessor().setType("SCALAR").setArray(new Float32Array(times)).setBuffer(input.getBuffer()));
    sampler.setOutput(doc.createAccessor().setType(output.getType()).setArray(new Float32Array(values)).setBuffer(output.getBuffer()));
  }
  clip.setExtras({ ...clip.getExtras(), loopRecoverySeconds: 0.1, sourceEndGapDegrees: angularGap * 180 / Math.PI });
}

function invariantHash(doc: Document): string {
  const h = createHash("sha256");
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    for (const semantic of primitive.listSemantics().sort()) {
      h.update(semantic); const a = primitive.getAttribute(semantic)!.getArray()!;
      h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    }
    const indices = primitive.getIndices()?.getArray();
    if (indices) h.update(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength));
  }
  for (const skin of doc.getRoot().listSkins()) {
    const a = skin.getInverseBindMatrices()!.getArray()!;
    h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    h.update(JSON.stringify(skin.listJoints().map(n => [n.getName(), parentChain(n)])));
  }
  h.update(JSON.stringify(storedPose(doc).map(p => [p.node.getName(), parentChain(p.node), p.t, p.r, p.s])));
  return h.digest("hex");
}

function validateClips(doc: Document): { clips: number; channels: number; animatedJoints: Record<string, number>; maxQuaternionError: number } {
  let channels = 0, maxQuaternionError = 0;
  const animatedJoints: Record<string, number> = {};
  const names = new Set<string>();
  for (const clip of doc.getRoot().listAnimations()) {
    if (names.has(clip.getName())) throw new Error(`Duplicate clip ${clip.getName()}`);
    names.add(clip.getName());
    const changing = new Set<Node>();
    const targets = new Set<string>();
    for (const channel of clip.listChannels()) {
      channels++;
      const target = channel.getTargetNode();
      if (!target) throw new Error(`${clip.getName()}: unbound channel`);
      const key = `${doc.getRoot().listNodes().indexOf(target)}:${channel.getTargetPath()}`;
      if (targets.has(key)) throw new Error(`${clip.getName()}: duplicate target ${key}`);
      targets.add(key);
      const sampler = channel.getSampler()!;
      const input = sampler.getInput()!.getArray()!;
      const values = sampler.getOutput()!.getArray()!;
      const width = sampler.getOutput()!.getElementSize();
      if (input.length * width !== values.length) throw new Error(`${clip.getName()}: invalid keyframe dimensions`);
      for (let i = 0; i < input.length; i++) {
        if (!Number.isFinite(input[i]) || (i > 0 && Number(input[i]) <= Number(input[i - 1]))) throw new Error(`${clip.getName()}: unordered keyframes`);
        for (let k = 0; k < width; k++) if (!Number.isFinite(values[i * width + k])) throw new Error(`${clip.getName()}: nonfinite pose`);
        if (channel.getTargetPath() === "rotation") {
          const q = new Quaternion().fromArray(Array.from(values.slice(i * width, (i + 1) * width), Number));
          maxQuaternionError = Math.max(maxQuaternionError, Math.abs(q.length() - 1));
          if (i > 0 && q.angleTo(new Quaternion().fromArray(Array.from(values.slice(0, width), Number))) > 4 * Math.PI / 180) changing.add(target);
        }
      }
    }
    animatedJoints[clip.getName()] = changing.size;
    if (/^Hit/.test(clip.getName()) && changing.size < 3) throw new Error(`${clip.getName()}: recoil does not articulate enough joints`);
  }
  if (maxQuaternionError > 0.001) throw new Error(`Invalid quaternion length: ${maxQuaternionError}`);
  return { clips: names.size, channels, animatedJoints, maxQuaternionError };
}

function removeRepeatedConstantKeys(doc: Document): number {
  let removed = 0;
  for (const clip of doc.getRoot().listAnimations()) for (const sampler of clip.listSamplers()) {
    const input = sampler.getInput()!;
    const output = sampler.getOutput()!;
    const times = input.getArray()!;
    const values = output.getArray()!;
    const width = output.getElementSize();
    const keptTimes: number[] = [];
    const keptValues: number[] = [];
    let changed = false;
    for (let i = 0; i < times.length; i++) {
      if (i > 0 && times[i] === times[i - 1]) {
        if (Array.from(values.slice(i * width, (i + 1) * width)).some((v, k) => v !== values[(i - 1) * width + k])) throw new Error(`${clip.getName()}: colliding keys carry different poses`);
        removed++; changed = true; continue;
      }
      keptTimes.push(Number(times[i]));
      keptValues.push(...Array.from(values.slice(i * width, (i + 1) * width), Number));
    }
    if (changed) {
      // Input accessors may be shared with other channels, so repair this sampler independently.
      sampler.setInput(doc.createAccessor().setType("SCALAR").setArray(new Float32Array(keptTimes)).setBuffer(input.getBuffer()));
      sampler.setOutput(doc.createAccessor().setType(output.getType()).setArray(new Float32Array(keptValues)).setBuffer(output.getBuffer()));
    }
  }
  return removed;
}

function measureContact(doc: Document, id: string): number {
  const clip = doc.getRoot().listAnimations().find(c => c.getName() === "Attack")!;
  const pattern = id.includes("scorpion") ? /Sting_01_07/ : id.includes("rhino") ? /CATRigHub003Bone002/ : /Head_(?:Top|JawEnd)/;
  const tip = doc.getRoot().listNodes().find(n => pattern.test(n.getName()));
  if (!tip) return 0.43;
  const pose = storedPose(doc);
  let best = -Infinity, contact = 0.43;
  for (let i = 6; i <= 28; i++) {
    restorePose(pose); applyClip(clip, duration(clip) * i / 40);
    const z = tip.getWorldMatrix()[14]!;
    if (z > best) { best = z; contact = i / 40; }
  }
  restorePose(pose);
  return contact;
}

function validateDeformation(doc: Document): Record<string, { min: number[]; max: number[]; rootTravelXZ: number }> {
  const original = storedPose(doc);
  const rest = deformedBounds(doc);
  const restSpan = rest.max.map((v, i) => v - rest.min[i]!);
  const largestSpan = Math.max(...restSpan);
  const joints = new Set(doc.getRoot().listSkins().flatMap(s => s.listJoints()));
  const roots = skeletonRoots(joints);
  const result: Record<string, { min: number[]; max: number[]; rootTravelXZ: number }> = {};
  for (const clip of doc.getRoot().listAnimations().filter(c => /Attack|Hit|Walk|Run/.test(c.getName()))) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const rootMin = new Map<Node, number[]>(), rootMax = new Map<Node, number[]>();
    for (let i = 0; i <= 8; i++) {
      restorePose(original); applyClip(clip, duration(clip) * i / 8);
      const bounds = deformedBounds(doc);
      for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis]!, bounds.min[axis]!); max[axis] = Math.max(max[axis]!, bounds.max[axis]!); }
      for (const node of roots) {
        const p = node.getTranslation();
        const lo = rootMin.get(node) ?? p.slice(), hi = rootMax.get(node) ?? p.slice();
        for (const axis of [0, 2]) { lo[axis] = Math.min(lo[axis]!, p[axis]!); hi[axis] = Math.max(hi[axis]!, p[axis]!); }
        rootMin.set(node, lo); rootMax.set(node, hi);
      }
    }
    const rootTravelXZ = Math.max(0, ...roots.map(n => {
      const lo = rootMin.get(n)!, hi = rootMax.get(n)!;
      return Math.hypot(hi[0]! - lo[0]!, hi[2]! - lo[2]!);
    }));
    if (/Attack|Hit/.test(clip.getName()) && rootTravelXZ > 0.001) throw new Error(`${clip.getName()}: horizontal root travel ${rootTravelXZ} competes with navigation`);
    if (max.some((v, i) => v - min[i]! > largestSpan * 4)) throw new Error(`${clip.getName()}: skin deformation exceeds four times the rest span`);
    result[clip.getName()] = { min, max, rootTravelXZ };
  }
  restorePose(original);
  return result;
}

async function measureGaits(file: string, assetId: string) {
  // Measure the actual serialized output with the same calibrated contact method used
  // by convertAnimal and calibrate-legacy-gait. No geometry or animation is written here.
  const [gltf, helpers] = await Promise.all([loadGeometryGlb(file), loadContactHelpers()]);
  const gaits: Record<string, { clipSeconds: number; impliedMps: number; strideMetres: number; strideDefinition: string }> = {};
  const gaitContactMeasurements: Record<string, ContactMeasurement> = {};
  for (const clip of gltf.animations.filter(clip => /^(Walk|Run)$/.test(clip.name))) {
    const measurement = helpers.measureContactGait(gltf.scene, clip, { assetId, samples: 1920 });
    gaitContactMeasurements[clip.name] = measurement;
    if (measurement.speedMps === null) continue;
    gaits[clip.name] = { clipSeconds: clip.duration, impliedMps: measurement.speedMps,
      strideMetres: measurement.speedMps * clip.duration, strideDefinition: "equivalent-native-cycle-travel" };
  }
  return { gaits, gaitContactMeasurements };
}

async function sourceClip(name: string): Promise<ExtractedSourceClip> {
  return JSON.parse(await readFile(path.join(outputRoot, "source-clips", `${name}.json`), "utf8")) as ExtractedSourceClip;
}

async function main(): Promise<void> {
  const selected = process.argv.find(a => a.startsWith("--only="))?.slice(7).split(",");
  const hitOnly = process.argv.includes("--hit-only");
  if (hitOnly && (!selected?.length || selected.some(id => !["animal_bear", "animal_cattle", "animal_aurochs", "animal_boar"].includes(id)))) {
    throw new Error("--hit-only requires --only selecting reviewed bear, cattle, aurochs or boar anatomy");
  }
  const metadata: Record<string, unknown>[] = [];
  for (const category of ["animal", "boss"]) {
    for (const file of (await readdir(path.join(sourceRoot, category))).filter(f => f.endsWith(".glb") && (category !== "boss" || f.startsWith("boss_rhino_"))).sort()) {
      const id = file.slice(0, -4);
      if (selected && !selected.includes(id)) continue;
      const sourceFile = path.join(sourceRoot, category, file);
      const original = await readFile(sourceFile);
      const doc = await io.readBinary(new Uint8Array(original));
      const invariants = invariantHash(doc);
      const protectedAnimations = hitOnly ? animationHash(doc) : null;
      const changes: string[] = [];
      const correctedTextures: { name: string; before: string; after: string; preCompressionFlipExact: boolean; meanChannelError: number; format: string }[] = [];
      const orientationCorrect = Boolean(doc.getRoot().getExtras().creatureRebuildVersion) || doc.getRoot().listNodes().some(n => n.getExtras().fbxTextureOrientation === "source-correct");
      for (const texture of orientationCorrect ? [] : doc.getRoot().listTextures()) {
        const image = texture.getImage();
        if (!image) continue;
        // These imports carry albedo and emissive only. Fail if a normal map is added: its tangent
        // convention must be audited separately before an automated orientation repair.
        if (doc.getRoot().listMaterials().some(m => m.getNormalTexture() === texture)) throw new Error(`${id}: normal map requires a tangent-space orientation audit`);
        const flipped = await sharp(image).flip().png({ compressionLevel: 9 }).toBuffer();
        const expected = await sharp(image).flip().raw().toBuffer();
        if (!expected.equals(await sharp(flipped).raw().toBuffer())) throw new Error(`${id}: texture correction lost texels`);
        // Existing JPEG maps have no alpha. Keep their shipping format instead of inflating every
        // atlas to a PNG. Alpha-bearing PNGs remain lossless; no resize or colour adjustment occurs.
        const jpeg = texture.getMimeType() === "image/jpeg";
        const corrected = jpeg ? await sharp(flipped).jpeg({ quality: 95, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer() : flipped;
        const actual = await sharp(corrected).raw().toBuffer();
        let error = 0;
        for (let i = 0; i < expected.length; i++) error += Math.abs(expected[i]! - actual[i]!);
        const meanChannelError = error / expected.length;
        if (meanChannelError > 1.5) throw new Error(`${id}: atlas encoding error ${meanChannelError}/255 exceeds budget`);
        correctedTextures.push({ name: texture.getName(), before: hash(image), after: hash(corrected), preCompressionFlipExact: true, meanChannelError, format: jpeg ? "jpeg" : "png" });
        texture.setImage(corrected).setMimeType(jpeg ? "image/jpeg" : "image/png");
      }
      changes.push(orientationCorrect ? "Keep previously corrected FBX texture orientation" : "Correct FBX vertical texture orientation; preserve PNG alpha/RGB exactly and bound JPEG re-encoding error below 1.5/255");
      const fish = /animal_(perch|pike|salmon)$/.test(id);
      let attack: ClipMetadata | null = null;
      if (hitOnly) {
        attack = doc.getRoot().getExtras().attack as ClipMetadata;
        if (!attack || attack.clip !== "Attack") throw new Error("Hit-only rebuild requires the previously reviewed attack metadata");
        for (const side of [0, -1, 1] as const) {
          if (id === "animal_bear") authorBearHit(doc, side);
          else authorHoovedHit(doc, id as HoovedAnimal, side);
        }
        changes.push("Replace recoil with anatomical shoulder and pelvis compression, neck recoil and planted contacts; preserve all non-hit clips");
      } else if (!fish) {
        if (id === "animal_crab") {
          importSource(doc, await sourceClip("crab_idle_pose"), "IdlePose");
          authorMotion(doc, "Idle", CRAB_IDLE, "IdlePose");
          removeClip(doc, "IdlePose");
          changes.push("Replace scuttling-in-place Idle with the source planted stance and a restrained 3.6s claw idle");
        }
        if (id === "animal_coyote") {
          importSource(doc, await sourceClip("wolf_attack"), "Attack");
          changes.push("Restore Wolf_Attack jaw/neck animation and remove synthetic root lunge");
        }
        if (id.includes("frog")) {
          importSource(doc, await sourceClip("frog_walk"), "Walk");
          importSource(doc, await sourceClip("frog_run"), "Run");
          closeImportedLoop(doc, "Run");
          changes.push("Restore source frog locomotion with vertical hop compression/airtime; root X/Z stay fixed");
        }
        if (id.startsWith("boss_rhino_")) {
          for (const [key, name] of [["idle", "Idle"], ["walk", "Walk"], ["run", "Run"], ["attack", "Attack"], ["hit", "Hit"], ["death", "Death"]]) importSource(doc, await sourceClip(`rhino_${key}`), name!);
          changes.push("Restore actual Walk and Get_Hit; retain Run separately; bind all source clips by FBX identity to repair duplicate-name tracks");
        }
        const profile = attackProfile(id);
        if (profile) {
          const joints = authorMotion(doc, "Attack", profile);
          changes.push(`Replace root lunge with ${profile.label} across ${joints} joints`);
          attack = { clip: "Attack", seconds: profile.seconds, contactNormalized: profile.contactNormalized, source: "Corealm authored articulated clip", label: profile.label };
        } else {
          const clip = doc.getRoot().listAnimations().find(c => c.getName() === "Attack")!;
          attack = { clip: "Attack", seconds: duration(clip), contactNormalized: measureContact(doc, id), source: "Original FBX authored attack", label: "Contact estimated from forward strike-joint reach; confirm with feature lab timeline" };
        }
        const attackClip = doc.getRoot().listAnimations().find(c => c.getName() === "Attack")!;
        attackClip.setExtras({ ...attackClip.getExtras(), contactNormalized: attack.contactNormalized });
        if (id === "animal_bear") {
          for (const side of [0, -1, 1] as const) authorBearHit(doc, side);
        } else if (["animal_cattle", "animal_aurochs", "animal_boar"].includes(id)) {
          for (const side of [0, -1, 1] as const) authorHoovedHit(doc, id as HoovedAnimal, side);
        } else {
          if (!id.startsWith("boss_rhino_")) authorMotion(doc, "Hit", hitProfile(id, 0));
          authorMotion(doc, "HitLeft", hitProfile(id, -1));
          authorMotion(doc, "HitRight", hitProfile(id, 1));
        }
        changes.push("Add directional articulated recoil with delayed torso recovery and separate limb bracing");
      }
      if (invariantHash(doc) !== invariants) throw new Error(`${id}: geometry, UV, skin or bind pose changed`);
      let repeatedKeys = 0;
      if (!hitOnly) {
        repeatedKeys = removeRepeatedConstantKeys(doc);
        await doc.transform(resample({ tolerance: 0.000001, cleanup: false }));
        repeatedKeys += removeRepeatedConstantKeys(doc);
      }
      if (repeatedKeys) changes.push(`Remove ${repeatedKeys} identical keyframes sharing a timestamp in source clips`);
      const validation = validateClips(doc);
      const deformation = validateDeformation(doc);
      doc.getRoot().setExtras({ ...doc.getRoot().getExtras(), creatureRebuildVersion: 1, originalSha256: hash(original), attack });
      const output = await io.writeBinary(doc);
      const destination = path.join(outputRoot, "models", category, file);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, output);
      const roundTrip = await io.readBinary(output);
      if (invariantHash(roundTrip) !== invariants) throw new Error(`${id}: serialization changed geometry or bind pose`);
      if (protectedAnimations !== null && animationHash(roundTrip) !== protectedAnimations) throw new Error(`${id}: hit-only rebuild changed an approved non-hit clip`);
      validateClips(roundTrip);
      const { gaits, gaitContactMeasurements } = await measureGaits(destination, id);
      metadata.push({ id, stagedFile: path.relative(repo, destination).replaceAll("\\", "/"), productionFile: `models/${category}/${file}`, sourceSha256: hash(original), sha256: hash(output), bytes: output.length, originalBytes: original.length, attack, gaits, gaitContactMeasurements, gaitMetadataMethod: "canonical-contact-velocity", recalibratedGaits: id.includes("frog") || id.startsWith("boss_rhino_"), changes, correctedTextures, validation: { ...validation, geometryUvSkinBindPoseUnchanged: true, serializedRoundTripValid: true, deformation }, animations: doc.getRoot().listAnimations().map(c => c.getName()), clips: doc.getRoot().listAnimations().map(c => ({ name: c.getName(), seconds: duration(c), contactNormalized: c.getExtras().contactNormalized ?? null })) });
      console.log(`${id}: ${original.length} -> ${output.length} bytes; ${validation.clips} clips; ${attack ? `contact ${(attack.seconds * attack.contactNormalized).toFixed(3)}s` : "ambient fish"}`);
    }
  }
  if (selected) {
    const previous = JSON.parse(await readFile(path.join(repo, "tools/data/creature-motion-rebuild.json"), "utf8")) as { assets: Record<string, unknown>[] };
    const replacements = new Map(metadata.map(a => [a.id, a]));
    metadata.splice(0, metadata.length, ...previous.assets.map(a => {
      const replacement = replacements.get(a.id);
      // Hit-only revisions preserve the calibrated Idle/gaits, bind pose and mesh exactly.
      return replacement ? (hitOnly ? { ...a, ...replacement } : replacement) : a;
    }));
  }
  const report = { version: 1, generatedAt: new Date().toISOString(), status: "staged; requires production feature-lab motion and texture acceptance before promotion", sourceTextureDefect: "FBX converter forced map.flipY=false. Geometry UVs are unchanged; embedded atlas must be vertically corrected.", assets: metadata };
  await mkdir(path.join(repo, "tools/data"), { recursive: true });
  await writeFile(path.join(outputRoot, "validation.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(path.join(repo, "tools/data/creature-motion-rebuild.json"), JSON.stringify(report, null, 2) + "\n");
}

/** Hit-only iteration must preserve every approved attack, gait, idle and death sample exactly. */
function animationHash(doc: Document): string {
  const digest = createHash("sha256");
  for (const clip of doc.getRoot().listAnimations().filter(clip => !/^Hit/.test(clip.getName()))) {
    digest.update(clip.getName());
    for (const channel of clip.listChannels()) {
      const node = channel.getTargetNode()!;
      const sampler = channel.getSampler()!;
      digest.update(JSON.stringify([node.getName(), parentChain(node), channel.getTargetPath(), sampler.getInterpolation()]));
      for (const accessor of [sampler.getInput()!, sampler.getOutput()!]) {
        const array = accessor.getArray()!;
        digest.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      }
    }
  }
  return digest.digest("hex");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
