/**
 * Studio mode, assemble and stage: the candidate is the production GLB plus the clips py/studio.py
 * retargeted onto its own skeleton (<work>/studio.json). The studio rig, skin, mesh and every native
 * clip stay byte-identical; clips listed in studio.replace (or added again) are dropped first.
 * Staging proves that: every clip the candidate keeps is hashed (sampler input and output bytes,
 * target and interpolation) against production, and a changed native clip fails the stage.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readGlb } from "./glb.mjs";
import { openDocument } from "./intake.mjs";
import { assetConfig, paths } from "./paths.mjs";
import { measure } from "./stage.mjs";

const manifestEntry = (assetId) => {
  const entry = JSON.parse(readFileSync(paths.manifest, "utf8")).assets.find((a) => a.id === assetId);
  if (!entry) throw new Error(`${assetId} is not in the manifest`);
  return entry;
};
const candidatePath = (entry) => path.join(paths.models, entry.file.replace(/^models\//, ""));

export async function assembleStudio(assetId, work = paths.work(assetId)) {
  const entry = manifestEntry(assetId);
  const data = JSON.parse(readFileSync(path.join(work, "studio.json"), "utf8"));
  const { io, doc } = await openDocument(path.join(paths.publicAssets, entry.file));
  const root = doc.getRoot();
  const buffer = root.listBuffers()[0];
  const drop = new Set([...data.replace, ...data.clips.map((c) => c.name)]);
  for (const a of root.listAnimations()) if (drop.has(a.getName())) {
    for (const s of a.listSamplers()) {
      const accessors = [s.getInput(), s.getOutput()];
      s.dispose();
      for (const acc of accessors) if (acc && acc.listParents().every((p) => p === root)) acc.dispose();
    }
    for (const c of a.listChannels()) c.dispose();
    a.dispose();
  }
  const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  // Props under joints (a bow string, a nocked arrow, a staff focus) keep the pose a native clip
  // keys for them (studio.propPoseClip); unkeyed they would fall back to a bind pose the studio
  // never shows.
  const propPose = [];
  const poseClip = data.propPoseClip && root.listAnimations().find((a) => a.getName() === data.propPoseClip);
  if (poseClip) {
    const joints = new Set(root.listSkins().flatMap((s) => s.listJoints()));
    const underJoint = (n) => { for (let p = n.getParentNode(); p; p = p.getParentNode()) if (joints.has(p)) return true; return false; };
    for (const ch of poseClip.listChannels()) {
      const node = ch.getTargetNode();
      if (joints.has(node) || !underJoint(node)) continue;
      const out = ch.getSampler().getOutput();
      propPose.push({ node, path: ch.getTargetPath(), value: Array.from(out.getArray().slice(0, out.getElementSize())), type: out.getType() });
    }
  }
  for (const clip of data.clips) {
    const anim = doc.createAnimation(clip.name);
    const times = Float32Array.from({ length: clip.frames }, (_, i) => i / clip.fps);
    const input = doc.createAccessor(`${clip.name}_t`).setType("SCALAR").setArray(times).setBuffer(buffer);
    for (const pp of propPose) {
      const sampler = doc.createAnimationSampler().setInput(input).setInterpolation("STEP")
        .setOutput(doc.createAccessor().setType(pp.type).setArray(Float32Array.from(Array.from({ length: clip.frames }, () => pp.value).flat())).setBuffer(buffer));
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(pp.node).setTargetPath(pp.path).setSampler(sampler));
    }
    for (const [name, track] of Object.entries(clip.tracks)) {
      const node = byName.get(name);
      if (!node) throw new Error(`${assetId}: no node ${name}`);
      for (const [pathName, type] of [["rotation", "VEC4"], ["translation", "VEC3"]]) {
        if (!track[pathName]) continue;
        const sampler = doc.createAnimationSampler().setInput(input).setInterpolation("LINEAR")
          .setOutput(doc.createAccessor().setType(type).setArray(Float32Array.from(track[pathName].flat())).setBuffer(buffer));
        anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(pathName).setSampler(sampler));
      }
    }
  }
  const out = candidatePath(entry);
  mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  return { out };
}

const accessorBytes = (glb, index) => {
  const a = glb.json.accessors[index];
  const view = glb.json.bufferViews[a.bufferView];
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type] * { 5126: 4, 5123: 2, 5122: 2, 5121: 1, 5120: 1 }[a.componentType] * a.count;
  const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  return glb.bin.subarray(offset, offset + size);
};

/** Hash of one clip: every channel's target, interpolation and sampler bytes. */
export function clipHash(glb, animation) {
  const hash = createHash("sha256");
  for (const channel of animation.channels) {
    const sampler = animation.samplers[channel.sampler];
    hash.update(`${glb.json.nodes[channel.target.node].name}.${channel.target.path}:${sampler.interpolation ?? "LINEAR"}`);
    hash.update(accessorBytes(glb, sampler.input));
    hash.update(accessorBytes(glb, sampler.output));
  }
  return hash.digest("hex");
}

export function stageStudio(assetId, work = paths.work(assetId)) {
  const entry = manifestEntry(assetId);
  const config = assetConfig(assetId);
  const data = JSON.parse(readFileSync(path.join(work, "studio.json"), "utf8"));
  const file = candidatePath(entry);
  const production = readGlb(path.join(paths.publicAssets, entry.file));
  const candidate = readGlb(file);
  const added = data.clips.map((c) => c.name);
  const native = [];
  for (const a of candidate.json.animations) {
    if (added.includes(a.name)) continue;
    const p = production.json.animations.find((x) => x.name === a.name);
    if (!p || clipHash(production, p) !== clipHash(candidate, a)) throw new Error(`${assetId} ${a.name}: native clip changed`);
    native.push(a.name);
  }
  const donorMap = JSON.parse(readFileSync(path.join(paths.tool, "py/classes", `${config.class}.donors.json`), "utf8"));
  const bytes = readFileSync(file);
  const m = measure(file);
  const donor = Object.fromEntries(data.clips.map((c) => {
    const [key, clip] = c.donor.split(":");
    return [c.name, `${donorMap.donors[key]?.source ?? key}: ${clip.replaceAll("+", " + ")}`];
  }));
  const candidateFile = path.relative(paths.rigRoot, file).replaceAll("\\", "/");
  const record = {
    id: assetId, file: entry.file, pack: entry.pack, category: entry.category, is: entry.is, tags: entry.tags,
    bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), size: m.size, base: m.base, bounds: m.bounds,
    groundY: entry.groundY ?? 0, triangles: m.triangles, animations: m.animations, materials: m.materials, candidateFile,
    motionProvenance: {
      native,
      donor,
      authored: [],
      notes: [
        `Studio rig, skin, mesh and native clips (${native.join(", ") || "none"}) kept byte-identical from production (per-clip hashes checked); ${added.join(", ")} added by tools/creature-rig studio mode: a rest-relative retarget onto the existing skeleton (hips scaled by leg length ${data.legScale.toFixed(3)}, foot IK, no scale keys).`,
        config.studio.grip ? `Weapon hands keep their native grip (${Object.keys(config.studio.grip).join(", ")}).` : null,
        Object.values(config.studio.clips ?? {}).some((c) => c.lift) ? "Lying clips lift the hips by a smooth envelope of the skinned mesh's floor penetration." : null,
      ].filter(Boolean).join(" "),
      clipSeconds: m.clipSeconds,
      sourceFile: `game/public/assets/${entry.file}`,
      sourceSha256: entry.sha256,
    },
  };
  const catalogFile = path.join(paths.rigRoot, "catalog.json");
  const catalog = existsSync(catalogFile) ? JSON.parse(readFileSync(catalogFile, "utf8")) : { assets: [] };
  catalog.assets = [...catalog.assets.filter((a) => a.id !== assetId), record].sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(catalogFile, JSON.stringify(catalog, null, 2));
  return record;
}
