/** Measure posed sole contact without changing geometry, clips or the production manifest. */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Document, Node, Primitive } from "@gltf-transform/core";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { Matrix4, Vector3 } from "three";
import { applyClip, duration, restorePose, storedPose } from "./creature-motion/pose.js";
import { deformedBounds } from "./creature-motion/validate-deformation.js";

const repo = fileURLToPath(new URL("../", import.meta.url));
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const quantile = (values: number[], q: number): number => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * q)]!;
};
const round = (value: number) => Number(value.toFixed(6));

function soleGroup(id: string, bone: Node): string | null {
  const name = bone.getName();
  const m = bone.getWorldMatrix();
  const side = m[12]! < 0 ? "left" : "right";
  if (id.includes("rhino")) return /^CATRig[LR](ArmPalm|LegAnkle|LegDigit)/.test(name) ? `${side}-${name.includes("Arm") ? "front" : "hind"}` : null;
  if (id.includes("frog")) {
    const index = Number(/^Bone(\d+)/.exec(name)?.[1]);
    if ((index >= 16 && index <= 25)) return `${side}-front`;
    if (index === 12 || index === 13 || (index >= 26 && index <= 31)) return `${side}-hind`;
    return null;
  }
  if (id === "animal_hog") return /^Bone0(26|27|32|33)(?:\(|$)/.test(name) ? `${side}-${/^Bone0(26|27)/.test(name) ? "front" : "hind"}` : null;
  if (id === "animal_rat") return /^Bone0(28|29|33|34)(?:\(|$)/.test(name) ? `${side}-${/^Bone0(28|29)/.test(name) ? "front" : "hind"}` : null;
  if (id === "animal_crab") return /^Bone0(22|25|28|31)(?:\(|$)/.test(name) ? `${side}-${name.slice(4, 7)}` : null;
  if (id === "animal_viper") return /Viper_(?:ROOT|Front_|Back_)/.test(name) ? "body-contact" : null;
  if (!/Ankle|Ball|Toe/.test(name)) return null;
  const limb = /_(?:l|r)_(.*?)(?:_Ankle|_Ball|_Toe)/.exec(name)?.[1];
  return `${side}-${limb ?? "foot"}`;
}

function footSampler(doc: Document, id: string): { sample: () => Record<string, number>; vertices: number; groups: string[] } {
  const selected: { node: Node; primitive: Primitive; index: number; group: string }[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const skin = node.getSkin();
    if (!skin) continue;
    const jointGroups = skin.listJoints().map(joint => soleGroup(id, joint));
    for (const primitive of node.getMesh()!.listPrimitives()) {
      const jointIndices = primitive.getAttribute("JOINTS_0")!;
      const jointWeights = primitive.getAttribute("WEIGHTS_0")!;
      for (let i = 0; i < jointIndices.getCount(); i++) {
        const indices = jointIndices.getElement(i, []), weights = jointWeights.getElement(i, []);
        const contribution = new Map<string, number>();
        indices.forEach((index, j) => {
          const group = jointGroups[index];
          if (group) contribution.set(group, (contribution.get(group) ?? 0) + weights[j]!);
        });
        const strongest = [...contribution.entries()].sort((a, b) => b[1] - a[1])[0];
        if (strongest && strongest[1] >= 0.45) selected.push({ node, primitive, index: i, group: strongest[0] });
      }
    }
  }
  if (!selected.length) throw new Error(`${id}: no sole-weighted vertices`);
  const nodes = [...new Set(selected.map(s => s.node))];
  return {
    vertices: selected.length,
    groups: [...new Set(selected.map(s => s.group))].sort(),
    sample: () => {
      const matrices = new Map(nodes.map(node => {
        const skin = node.getSkin()!;
        return [node, skin.listJoints().map((joint, i) => new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(i, []))))];
      }));
      const result: Record<string, number> = {};
      for (const item of selected) {
        const positions = item.primitive.getAttribute("POSITION")!, indices = item.primitive.getAttribute("JOINTS_0")!, weights = item.primitive.getAttribute("WEIGHTS_0")!;
        const point = new Vector3().fromArray(positions.getElement(item.index, []));
        const joints = indices.getElement(item.index, []), amounts = weights.getElement(item.index, []);
        const deformed = new Vector3();
        for (let j = 0; j < joints.length; j++) if (amounts[j]) deformed.add(point.clone().applyMatrix4(matrices.get(item.node)![joints[j]!]!).multiplyScalar(amounts[j]!));
        result[item.group] = Math.min(result[item.group] ?? Infinity, deformed.y);
      }
      return result;
    },
  };
}

/** The longest near-constant contact band rejects isolated toe downstrokes and airborne frames. */
function contactBand(values: number[], bandWidth: number, idleY: number): { y: number; samples: number } {
  const sorted = values.slice().sort((a, b) => a - b);
  let best: number[] = [], bestDistance = Infinity;
  for (let i = 0; i < sorted.length; i++) {
    const band: number[] = [];
    for (let j = i; j < sorted.length && sorted[j]! <= sorted[i]! + bandWidth; j++) band.push(sorted[j]!);
    const distance = Math.abs(quantile(band, 0.5) - idleY);
    if (band.length > best.length || (band.length === best.length && distance < bestDistance)) { best = band; bestDistance = distance; }
  }
  return { y: quantile(best, 0.5), samples: best.length };
}

async function main(): Promise<void> {
  const metadataFile = path.join(repo, "tools/data/creature-motion-rebuild.json");
  const metadata = JSON.parse(await readFile(metadataFile, "utf8")) as { assets: { id: string; stagedFile: string; groundY?: number; groundCalibration?: unknown }[] };
  const manifest = JSON.parse(await readFile(path.join(repo, "game/public/assets/manifest.json"), "utf8")) as { assets: { id: string; base: { y: number }; size: { y: number } }[] };
  const rows: Record<string, unknown>[] = [];
  for (const asset of metadata.assets) {
    const entry = manifest.assets.find(a => a.id === asset.id)!;
    if (/animal_(perch|pike|salmon)$/.test(asset.id)) {
      asset.groundY = entry.base.y;
      asset.groundCalibration = { status: "unchanged-waterborne", bindBaseY: entry.base.y, reason: "Ambient fish retain authored water depth; fins are not ground contacts." };
      rows.push({ id: asset.id, bindBaseY: entry.base.y, groundY: asset.groundY, delta: 0, status: "unchanged-waterborne" });
      continue;
    }
    const doc = await io.read(path.join(repo, asset.stagedFile));
    const pose = storedPose(doc);
    const sampler = footSampler(doc, asset.id);
    const sampled: Record<string, { frameContacts: number[]; soles: number[]; meshMinY: number[] }> = {};
    for (const clip of doc.getRoot().listAnimations().filter(c => /^(Idle|Walk|Run)$/.test(c.getName()))) {
      const values = { frameContacts: [] as number[], soles: [] as number[], meshMinY: [] as number[] };
      for (let i = 0; i < 48; i++) {
        restorePose(pose); applyClip(clip, duration(clip) * i / 48);
        const soles = Object.values(sampler.sample());
        values.frameContacts.push(Math.min(...soles));
        values.soles.push(...soles);
        values.meshMinY.push(deformedBounds(doc).min[1]!);
      }
      sampled[clip.getName()] = values;
    }
    restorePose(pose);
    const idle = sampled.Idle!;
    const idleY = quantile(idle.frameContacts, 0.5);
    const bandWidth = Math.max(0.0015, entry.size.y * 0.002);
    const locomotion = Object.fromEntries(Object.entries(sampled).filter(([name]) => name !== "Idle").map(([name, data]) => [name, { ...contactBand(data.soles, bandWidth, idleY), meshMinY: Math.min(...data.meshMinY), meshMaxMinY: Math.max(...data.meshMinY) }]));
    const contacts = [idleY, idleY, ...Object.values(locomotion).map(v => v.y).filter(y => Math.abs(y - idleY) <= Math.max(0.006, entry.size.y * 0.015))];
    // Idle determines standing contact. The agreement of planted gait bands confirms it; outlier
    // root-motion defects are reported separately and never baked into a compensating asset offset.
    const measured = quantile(contacts, 0.5);
    const groundY = Math.abs(measured - entry.base.y) < 0.002 ? entry.base.y : round(measured);
    asset.groundY = groundY;
    const issues = Object.entries(locomotion).filter(([, v]) => v.meshMinY < idleY - Math.max(0.03, entry.size.y * 0.1)).map(([name]) => `${name}: transient toe downstroke exceeds static-grounding tolerance`);
    asset.groundCalibration = { status: groundY === entry.base.y ? "unchanged-within-2mm" : "calibrated", bindBaseY: entry.base.y, groundY, delta: round(groundY - entry.base.y), method: "Median Idle sole contact with stable planted locomotion bands; no whole-mesh tail extrema", samplesPerClip: 48, soleVertices: sampler.vertices, footGroups: sampler.groups, idleSoleY: round(idleY), idleMeshMinY: [round(Math.min(...idle.meshMinY)), round(quantile(idle.meshMinY, 0.5)), round(Math.max(...idle.meshMinY))], locomotion, issues };
    rows.push({ id: asset.id, bindBaseY: entry.base.y, groundY, delta: round(groundY - entry.base.y), idleSoleY: round(idleY), issues });
  }
  await writeFile(metadataFile, JSON.stringify(metadata, null, 2) + "\n");
  await writeFile(path.join(repo, "runs/local-creature-rebuild/grounding-calibration.json"), JSON.stringify({ rows }, null, 2) + "\n");
  console.log(JSON.stringify(rows, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
