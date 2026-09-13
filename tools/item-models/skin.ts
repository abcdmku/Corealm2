import { fileURLToPath } from "node:url";
import { Document, NodeIO, type Accessor, type Node } from "@gltf-transform/core";
import { copyToDocument } from "@gltf-transform/functions";
import { ALL_ITEMS } from "../../game/src/content/items.js";

const sourcePath = fileURLToPath(new URL("../../game/public/assets/models/character/base_male.glb", import.meta.url));
const wearableSlots = new Set(["head", "body", "hands", "legs", "feet"]);
const smooth = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
type Weights = Map<string, number>;
const rigid = (name: string): Weights => new Map([[name, 1]]);
function blend(a: Weights, b: Weights, t: number): Weights {
  const result = new Map<string, number>();
  for (const [name, weight] of a) result.set(name, weight * (1 - t));
  for (const [name, weight] of b) result.set(name, (result.get(name) ?? 0) + weight * t);
  return result;
}

/** Attach the native male rig to world-baked, identity-transform authored armor.
 * Weapons and accessories keep their authored rigid attachment path. Only skeleton nodes and
 * inverse binds come from the body GLB; geometry and materials always belong to the item.
 */
export async function attachItemSkin(document: Document, itemId: string): Promise<void> {
  const item = ALL_ITEMS.find(candidate => candidate.id === itemId);
  if (!item) throw new Error(`Unknown item ${itemId}`);
  const slot = item.equip?.slot;
  if (!slot || !wearableSlots.has(slot)) return;
  const scene = document.getRoot().getDefaultScene();
  if (!scene) throw new Error(`${itemId}: skin requires a default scene`);
  if (document.getRoot().listSkins().length) throw new Error(`${itemId}: skin already attached`);
  const meshNodes = document.getRoot().listNodes().filter(node => node.getMesh());
  if (!meshNodes.length) throw new Error(`${itemId}: skin requires authored meshes`);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const node of meshNodes) {
    if (node.getWorldMatrix().some((value, index) => Math.abs(value - identity[index]!) > 1e-7)) {
      throw new Error(`${itemId}: bake mesh transforms before skinning ${node.getName()}`);
    }
  }

  const source = await new NodeIO().read(sourcePath);
  const sourceSkin = source.getRoot().listSkins()[0];
  if (!sourceSkin || sourceSkin.listJoints().length !== 65 || !sourceSkin.getInverseBindMatrices()) {
    throw new Error("Native male skin must contain 65 joints and inverse binds");
  }
  const sourceJoints = sourceSkin.listJoints();
  const indices = new Map(sourceJoints.map((node, index) => [node.getName(), index]));
  const positions = new Map(sourceJoints.map(node => [node.getName(), node.getWorldTranslation()]));
  function joint(name: string): number {
    const index = indices.get(name);
    if (index === undefined) throw new Error(`Native male skeleton lacks ${name}`);
    return index;
  }
  function coordinate(name: string, axis: 0 | 1): number {
    joint(name);
    return positions.get(name)![axis];
  }
  // Copy ancestors explicitly. Copying a whole Armature would also copy its old body meshes.
  const nodes = new Map<Node, Node>();
  function copyNode(node: Node): Node {
    const existing = nodes.get(node);
    if (existing) return existing;
    const result = document.createNode(node.getName()).setTranslation(node.getTranslation())
      .setRotation(node.getRotation()).setScale(node.getScale());
    nodes.set(node, result);
    const parent = node.getParentNode();
    if (parent) copyNode(parent).addChild(result);
    else scene!.addChild(result);
    return result;
  }
  const inverse = sourceSkin.getInverseBindMatrices()!;
  const copiedInverse = copyToDocument(document, source, [inverse]).get(inverse) as Accessor;
  const buffer = document.getRoot().listBuffers()[0] ?? document.createBuffer();
  const importedBuffer = copiedInverse.getBuffer();
  copiedInverse.setBuffer(buffer);
  if (importedBuffer && importedBuffer !== buffer) importedBuffer.dispose();
  const skin = document.createSkin(`${itemId}-native-male`).setInverseBindMatrices(copiedInverse);
  sourceJoints.forEach(node => skin.addJoint(copyNode(node)));
  skin.setSkeleton(copyNode(sourceJoints[0]!));

  function torso(y: number): Weights {
    const chain = ["pelvis", "spine_01", "spine_02", "spine_03"];
    for (let index = 0; index < chain.length - 1; index++) {
      const a = chain[index]!, b = chain[index + 1]!;
      if (y <= coordinate(b, 1)) return blend(rigid(a), rigid(b), smooth(coordinate(a, 1), coordinate(b, 1), y));
    }
    return rigid("spine_03");
  }
  function arm(x: number, side: string): Weights {
    const elbow = Math.abs(coordinate(`lowerarm_${side}`, 0));
    const wrist = Math.abs(coordinate(`hand_${side}`, 0));
    const upperLower = blend(rigid(`upperarm_${side}`), rigid(`lowerarm_${side}`), smooth(elbow - 0.055, elbow + 0.055, x));
    return blend(upperLower, rigid(`hand_${side}`), smooth(wrist - 0.045, wrist + 0.025, x));
  }
  function weightsAt(x: number, y: number): Weights {
    const side = x >= 0 ? "l" : "r", lateral = Math.abs(x);
    if (slot === "head") return rigid("Head");
    if (slot === "feet") {
      const ankle = coordinate(`foot_${side}`, 1);
      return blend(rigid(`foot_${side}`), rigid(`calf_${side}`), smooth(ankle - .015, ankle + .075, y));
    }
    if (slot === "hands") return arm(lateral, side);
    if (slot === "legs") {
      const knee = coordinate(`calf_${side}`, 1);
      const leg = blend(rigid(`calf_${side}`), rigid(`thigh_${side}`), smooth(knee - 0.065, knee + 0.065, y));
      return blend(leg, rigid("pelvis"), smooth(0.88, 1.01, y));
    }
    const shoulder = Math.abs(coordinate(`upperarm_${side}`, 0));
    // Sleeve vertices enter only their own arm chain. Wide low hems stay on the spine/pelvis.
    const sleeve = smooth(shoulder - 0.035, shoulder + 0.075, lateral) * smooth(1.25, 1.39, y);
    return blend(torso(y), arm(lateral, side), sleeve);
  }

  const done = new Set<Accessor>();
  // Close-fitting gloves copy the real finger/webbing weights instead of treating the
  // whole hand as one rigid mitten. Source and exported vertices share native bind space.
  const handSamples: { position: number[]; influences: Weights }[] = [];
  if (meshNodes.some(node => node.getExtras()["itemModelDeform"] === "native-hand")) {
    if (slot !== "hands") throw new Error(`${itemId}: native-hand deformation requires handwear`);
    for (const node of source.getRoot().listNodes()) {
      if (!node.getMesh() || node.getSkin() !== sourceSkin) continue;
      if (node.getWorldMatrix().some((value, index) => Math.abs(value - identity[index]!) > 1e-5)) {
        throw new Error("Native hand weight source must have identity world transform");
      }
      for (const primitive of node.getMesh()!.listPrimitives()) {
        const p = primitive.getAttribute("POSITION"), j = primitive.getAttribute("JOINTS_0"), w = primitive.getAttribute("WEIGHTS_0");
        if (!p || !j || !w) continue;
        for (let vertex = 0; vertex < p.getCount(); vertex++) {
          const xyz: number[] = []; p.getElement(vertex, xyz);
          if (Math.abs(xyz[0]!) < .54 || xyz[1]! < 1.30) continue;
          const joints: number[] = [], weights: number[] = [];
          j.getElement(vertex, joints); w.getElement(vertex, weights);
          const influences: Weights = new Map();
          weights.forEach((weight, i) => { if (weight > 0) influences.set(sourceJoints[joints[i]!]!.getName(), weight); });
          handSamples.push({ position: xyz, influences });
        }
      }
    }
    if (!handSamples.length) throw new Error("Native body has no hand weight samples");
  }
  function nativeHandWeights(point: number[]): Weights {
    let nearest = handSamples[0]!, distance = Infinity;
    for (const sample of handSamples) {
      const d = (point[0]! - sample.position[0]!) ** 2 + (point[1]! - sample.position[1]!) ** 2 + (point[2]! - sample.position[2]!) ** 2;
      if (d < distance) { nearest = sample; distance = d; }
    }
    if (distance > .08 ** 2) throw new Error(`${itemId}: glove vertex is more than 8cm from native hand/forearm`);
    return nearest.influences;
  }
  function skirtWeights(x: number, y: number): Weights {
    const leg = (side: string) => rigid(`thigh_${side}`);
    // Both sides share continuous weights across the centre seam. The waist stays pelvic.
    return blend(blend(leg("r"), leg("l"), smooth(-.20, .20, x)), rigid("pelvis"), smooth(.80, 1.02, y));
  }
  for (const node of meshNodes) {
    node.setSkin(skin);
    const rigidBone = node.getExtras()["itemModelBone"];
    const isSkirt = node.getExtras()["itemModelDeform"] === "skirt";
    const isNativeHand = node.getExtras()["itemModelDeform"] === "native-hand";
    if (rigidBone !== undefined && (typeof rigidBone !== "string" || !indices.has(rigidBone))) throw new Error(`${itemId}: invalid rigid plate bone ${rigidBone}`);
    for (const primitive of node.getMesh()!.listPrimitives()) {
      const position = primitive.getAttribute("POSITION");
      if (!position) throw new Error(`${itemId}: mesh lacks POSITION`);
      // The exporter creates independent primitives; shared positions with different skin data
      // are intentionally rejected rather than silently assigned twice.
      if (done.has(position)) throw new Error(`${itemId}: duplicate POSITION accessor before skinning`);
      done.add(position);
      const joints = new Uint16Array(position.getCount() * 4);
      const weights = new Float32Array(position.getCount() * 4);
      const point: number[] = [];
      for (let vertex = 0; vertex < position.getCount(); vertex++) {
        position.getElement(vertex, point);
        if (!point.every(Number.isFinite)) throw new Error(`${itemId}: nonfinite vertex ${vertex}`);
        const influences = [...(typeof rigidBone === "string" ? rigid(rigidBone) : isNativeHand ? nativeHandWeights(point) : isSkirt ? skirtWeights(point[0]!, point[1]!) : weightsAt(point[0]!, point[1]!))].filter(([, weight]) => weight > 0)
          .sort((a, b) => b[1] - a[1]).slice(0, 4);
        const total = influences.reduce((sum, [, weight]) => sum + weight, 0);
        if (!Number.isFinite(total) || total <= 0) throw new Error(`${itemId}: invalid skin weights`);
        influences.forEach(([name, weight], influence) => {
          joints[vertex * 4 + influence] = joint(name);
          weights[vertex * 4 + influence] = weight / total;
        });
      }
      primitive.setAttribute("JOINTS_0", document.createAccessor(`${itemId}-joints`).setType("VEC4").setArray(joints).setBuffer(buffer));
      primitive.setAttribute("WEIGHTS_0", document.createAccessor(`${itemId}-weights`).setType("VEC4").setArray(weights).setBuffer(buffer));
    }
  }
}
