/**
 * Hanging cloth driven by the body: a robe skirt or a sleeve membrane gets chains of cloth joints,
 * its hanging vertices are reweighted from the body bones onto those chains, and every clip gets
 * the chains' rotations from a damped spring simulation of the body's own motion (Verlet with
 * inextensible links, ring spacing so the sheet cannot tear, the legs and torso as capsule
 * colliders, the floor as a plane). Loops run several cycles and keep the last so the seam closes;
 * one-shots settle on their first frame first. A gliding body moves forward (+Z) through still air
 * at a constant speed; the air's drag on the cloth trails its robe. No keyed sway or wind noise.
 *
 * This is the creature-rig spring chain (tools/creature-rig/py/crlib/retarget.py `secondary`)
 * ported onto production glTF bodies.
 */
import type { Accessor, Document, Node, Primitive, Skin } from '@gltf-transform/core';
import * as THREE from 'three';
import { applyClip, restorePose, storedPose } from '../../creature-motion/pose.js';
import { bindRest, clipSeconds } from './transplant.js';

export interface ClothPhysics {
  /** Pull towards the rest shape (1/s²). Heavier cloth is softer. */
  stiffness: number;
  /** Velocity damping (1/s); also the drag a gliding body feels. */
  damping: number;
  /** Extra gravity (m/s²) on top of the pull. */
  gravity: number;
  /** 0: the rest shape turns fully with its bone; 1: it keeps hanging in world space. */
  hang: number;
  /** Air drag (1/s) against the body's glide: a body gliding at v m/s pushes its cloth back by drag * v. */
  drag: number;
}

/** A skirt hanging from the hips: `chains` columns around the body, `segments` joints down each. */
export interface SkirtSpec extends ClothPhysics {
  kind: 'skirt';
  /** Mesh node names whose hanging part is cloth. */
  meshes: RegExp;
  /** The joint the skirt hangs from, and the height of its ring relative to that joint (m). */
  parent: string;
  top: number;
  chains: number;
  segments: number;
}

/** A membrane hanging below an arm (a bat sleeve): columns along the arm, hanging down. */
export interface SleeveSpec extends ClothPhysics {
  kind: 'sleeve';
  meshes: RegExp;
  /** Arm bones the columns may hang from, shoulder to hand. */
  arm: string[];
  chains: number;
  segments: number;
}

/** A tall soft point (a linen hood's peak) on one column rising from a joint: it keeps its shape
 * on the body and bends where it meets the floor. */
export interface TipSpec extends ClothPhysics {
  kind: 'tip';
  meshes: RegExp;
  parent: string;
  /** Height above the parent joint (bind, m) where the soft part starts. */
  from: number;
  segments: number;
}

export type ClothSpec = SkirtSpec | SleeveSpec | TipSpec;

interface Chain {
  joints: Node[];
  /** Local rest translation of each joint (parent frame) and of the chain's end point. */
  offsets: THREE.Vector3[];
  /** World rest points of the joints and the end (bind pose), for targets. */
  rest: THREE.Vector3[];
  parent: Node;
  spec: ClothSpec;
  /** How far the cloth surface reaches from each rest point (m): its floor clearance. */
  thick: number[];
  /** The chain whose same-level points this one keeps its spacing to (the next column of the sheet). */
  next?: Chain;
}

export interface ClothRig { chains: Chain[]; colliders: { a: Node; b: Node; radius: number }[]; spine: Node[]; names: Set<string> }

const v3 = (a: ArrayLike<number>) => new THREE.Vector3(a[0], a[1], a[2]);
const mat = (node: Node) => new THREE.Matrix4().fromArray(node.getWorldMatrix());

/** Joint world matrices at bind (the pose the inverse binds describe). */
function bindWorld(doc: Document): Map<Node, THREE.Matrix4> {
  const stored = storedPose(doc), rest = bindRest(doc);
  for (const [node, r] of rest) node.setTranslation(r.t as [number, number, number]).setRotation(r.r as [number, number, number, number]).setScale(r.s as [number, number, number]);
  const out = new Map(doc.getRoot().listNodes().map(node => [node, mat(node)]));
  restorePose(stored);
  return out;
}

function ibmOf(skin: Skin, joint: Node): THREE.Matrix4 {
  const index = skin.listJoints().indexOf(joint);
  if (index < 0) throw new Error(`${joint.getName()} is not in skin ${skin.getName()}`);
  return new THREE.Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(index, []));
}

function addJoint(skin: Skin, joint: Node, ibm: THREE.Matrix4) {
  const accessor = skin.getInverseBindMatrices()!;
  const array = new Float32Array(accessor.getCount() * 16 + 16);
  array.set(accessor.getArray()!); array.set(ibm.toArray(), accessor.getCount() * 16);
  accessor.setArray(array);
  skin.addJoint(joint);
}

interface Influence { joint: number; weight: number }
/** Blend a vertex's original influences with cloth influences (share `a` for cloth), keep the four largest. */
function writeWeights(prim: Primitive, vertex: number, cloth: Influence[], a: number) {
  const J = prim.getAttribute('JOINTS_0')!, W = prim.getAttribute('WEIGHTS_0')!;
  const j = J.getElement(vertex, []), w = W.getElement(vertex, []);
  const merged = new Map<number, number>();
  for (let k = 0; k < 4; k++) if (w[k]! > 0) merged.set(j[k]!, (merged.get(j[k]!) ?? 0) + w[k]! * (1 - a));
  for (const c of cloth) merged.set(c.joint, (merged.get(c.joint) ?? 0) + c.weight * a);
  const top = [...merged].filter(([, x]) => x > 1e-4).sort((p, q) => q[1] - p[1]).slice(0, 4);
  const sum = top.reduce((s, [, x]) => s + x, 0);
  const jj = [0, 0, 0, 0], ww = [0, 0, 0, 0];
  top.forEach(([joint, x], k) => { jj[k] = joint; ww[k] = x / sum; });
  J.setElement(vertex, jj); W.setElement(vertex, ww);
}

/** Widen JOINTS_0 to 16 bits when new joint indices no longer fit a byte. */
function widenJoints(prim: Primitive, count: number) {
  const J = prim.getAttribute('JOINTS_0')!;
  if (count <= 255 || J.getComponentType() !== 5121) return;
  J.setArray(new Uint16Array(J.getArray()!));
}

const smooth = (u: number) => { const x = Math.min(1, Math.max(0, u)); return x * x * (3 - 2 * x); };

/** Weights along a chain for parameter s in [0, segments]: the parent blends in over the first half segment. */
function along(s: number, segments: number): { bone: number; weight: number }[] {
  if (s <= 0) return [];
  if (s < 0.5) return [{ bone: 0, weight: smooth(2 * s) }].filter(x => x.weight > 0);
  const t = Math.min(s - 0.5, segments - 1), i = Math.floor(t), f = smooth(t - i);
  return i + 1 < segments ? [{ bone: i, weight: 1 - f }, { bone: i + 1, weight: f }] : [{ bone: i, weight: 1 }];
}

function meshPrims(doc: Document, pattern: RegExp) {
  return doc.getRoot().listNodes().filter(node => node.getMesh() && node.getSkin() && pattern.test(node.getName()))
    .flatMap(node => node.getMesh()!.listPrimitives().map(prim => {
      // Mirrored parts (a left and a right membrane) can share one weights accessor; each gets its own.
      for (const semantic of ['JOINTS_0', 'WEIGHTS_0']) prim.setAttribute(semantic, prim.getAttribute(semantic)!.clone());
      return { node, prim, skin: node.getSkin()! };
    }));
}

const findJoint = (skin: Skin, name: string) => {
  const joint = skin.listJoints().find(j => j.getName() === name) ?? skin.listJoints().find(j => j.getName().endsWith(`_${name}`) && !j.getName().startsWith('cloth_'));
  if (!joint) throw new Error(`no joint ${name} in skin ${skin.getName()}`);
  return joint;
};

function buildSkirt(doc: Document, spec: SkirtSpec, bind: Map<Node, THREE.Matrix4>, tag: string): Chain[] {
  const prims = meshPrims(doc, spec.meshes);
  if (!prims.length) throw new Error(`no skirt mesh ${spec.meshes}`);
  const skin = prims[0]!.skin;
  const parent = findJoint(skin, spec.parent), ibm = ibmOf(skin, parent), skinToBind = bind.get(parent)!.clone().multiply(ibm);
  // Work in bind world space (y up, floor at 0).
  const verts: { prim: Primitive; index: number; p: THREE.Vector3 }[] = [];
  for (const { prim } of prims) {
    const P = prim.getAttribute('POSITION')!;
    for (let i = 0; i < P.getCount(); i++) verts.push({ prim, index: i, p: v3(P.getElement(i, [])).applyMatrix4(skinToBind) });
  }
  const hip = new THREE.Vector3().setFromMatrixPosition(bind.get(parent)!), y0 = hip.y + spec.top;
  const angle = (p: THREE.Vector3) => Math.atan2(p.x - hip.x, p.z - hip.z);
  const M = spec.chains, K = spec.segments, sector = 2 * Math.PI / M;
  const below = verts.filter(v => v.p.y < y0);
  const hem: number[] = [], points: THREE.Vector3[][] = [];
  for (let j = 0; j < M; j++) {
    const theta = j * sector - Math.PI;
    const near = below.filter(v => Math.abs(Math.atan2(Math.sin(angle(v.p) - theta), Math.cos(angle(v.p) - theta))) < sector * 0.75);
    if (!near.length) throw new Error(`skirt column ${j} has no vertices`);
    hem.push(Math.min(...near.map(v => v.p.y)));
    const column: THREE.Vector3[] = [];
    for (let k = 0; k <= K; k++) {
      const y = y0 + (hem[j]! - y0) * k / K, band = (y0 - hem[j]!) / K * 0.6;
      const slice = near.filter(v => Math.abs(v.p.y - y) < band);
      // The column runs down the middle of the cloth's thickness at this height and angle.
      const radius = slice.length ? slice.reduce((s, v) => s + Math.hypot(v.p.x - hip.x, v.p.z - hip.z), 0) / slice.length : column.length ? Math.hypot(column.at(-1)!.x - hip.x, column.at(-1)!.z - hip.z) : 0.1;
      column.push(new THREE.Vector3(hip.x + Math.sin(theta) * radius, y, hip.z + Math.cos(theta) * radius));
    }
    points.push(column);
  }
  const chains = points.map((column, j) => makeChain(doc, skin, parent, ibm, skinToBind, column, `${tag}_${j}`, spec));
  chains.forEach((chain, j) => { chain.next = chains[(j + 1) % M]; });
  // Reweight: angle between two columns, height down the column.
  for (const v of below) {
    const u = (angle(v.p) + Math.PI) / sector, a = Math.floor(u) % M, b = (a + 1) % M, f = u - Math.floor(u);
    const bottom = hem[a]! * (1 - f) + hem[b]! * f, s = K * (y0 - v.p.y) / Math.max(y0 - bottom, 1e-3);
    bindVertex(v.prim, skin, v.index, v.p, [[chains[a]!, 1 - f], [chains[b]!, f]], s, K);
  }
  return chains;
}

function buildTip(doc: Document, spec: TipSpec, bind: Map<Node, THREE.Matrix4>, tag: string): Chain[] {
  const prims = meshPrims(doc, spec.meshes);
  if (!prims.length) throw new Error(`no tip mesh ${spec.meshes}`);
  const skin = prims[0]!.skin, parent = findJoint(skin, spec.parent), ibm = ibmOf(skin, parent), skinToBind = bind.get(parent)!.clone().multiply(ibm);
  const verts = prims.flatMap(({ prim }) => { const P = prim.getAttribute('POSITION')!; return Array.from({ length: P.getCount() }, (_, index) => ({ prim, index, p: v3(P.getElement(index, [])).applyMatrix4(skinToBind) })); });
  const y0 = new THREE.Vector3().setFromMatrixPosition(bind.get(parent)!).y + spec.from, K = spec.segments;
  const above = verts.filter(v => v.p.y > y0), top = Math.max(...above.map(v => v.p.y));
  if (process.env.DEBUG_TIP) console.log('tip', tag, 'joint y', (y0 - spec.from).toFixed(3), 'top', top.toFixed(3), 'verts', above.length);
  // The column runs up the middle of the point, through the centroid of each height band.
  const points = Array.from({ length: K + 1 }, (_, k) => {
    const y = y0 + (top - y0) * k / K, band = above.filter(v => Math.abs(v.p.y - y) < (top - y0) / K * 0.5);
    const c = band.reduce((sum, v) => sum.add(v.p), new THREE.Vector3()).divideScalar(Math.max(band.length, 1));
    return new THREE.Vector3(band.length ? c.x : 0, y, band.length ? c.z : 0);
  });
  const chain = makeChain(doc, skin, parent, ibm, skinToBind, points, `${tag}_0`, spec);
  for (const v of above) bindVertex(v.prim, skin, v.index, v.p, [[chain, 1]], K * (v.p.y - y0) / (top - y0), K);
  return [chain];
}

function buildSleeve(doc: Document, spec: SleeveSpec, bind: Map<Node, THREE.Matrix4>, tag: string): Chain[] {
  const chains: Chain[] = [];
  for (const { prim, skin } of meshPrims(doc, spec.meshes)) {
    // The membrane's own skin names the side it hangs from.
    const side = skin.listJoints().some(j => /upperarm_l$/.test(j.getName())) ? 'l' : 'r';
    const arm = spec.arm.map(name => findJoint(skin, `${name}_${side}`));
    const J = prim.getAttribute('JOINTS_0')!, W = prim.getAttribute('WEIGHTS_0')!, P = prim.getAttribute('POSITION')!;
    const skinToBind = bind.get(arm[0]!)!.clone().multiply(ibmOf(skin, arm[0]!));
    const verts = Array.from({ length: P.getCount() }, (_, index) => ({ index, p: v3(P.getElement(index, [])).applyMatrix4(skinToBind) }));
    // The arm runs sideways in the bind pose; columns are spaced along it and hang in -y.
    const xs = verts.map(v => v.p.x), lo = Math.min(...xs), hi = Math.max(...xs);
    const M = spec.chains, K = spec.segments, width = (hi - lo) / (M - 1);
    const column = (x: number) => verts.filter(v => Math.abs(v.p.x - x) < width * 0.75);
    const tops: number[] = [], bottoms: number[] = [];
    for (let j = 0; j < M; j++) {
      const x = lo + width * j, near = column(x);
      tops.push(Math.max(...near.map(v => v.p.y))); bottoms.push(Math.min(...near.map(v => v.p.y)));
      // Hang the column from the arm bone it lies along in the bind pose (the last bone whose head
      // is nearer the shoulder than the column).
      const reach = (node: Node) => Math.abs(new THREE.Vector3().setFromMatrixPosition(bind.get(node)!).x);
      const parent = [...arm].reverse().find(bone => reach(bone) <= Math.abs(x)) ?? arm[0]!;
      const zs = near.filter(v => v.p.y > tops[j]! - 0.04).map(v => v.p.z), z = zs.reduce((s, q) => s + q, 0) / zs.length;
      const points = Array.from({ length: K + 1 }, (_, k) => new THREE.Vector3(x, tops[j]! + (bottoms[j]! - tops[j]!) * k / K, z));
      const toBind = bind.get(parent)!.clone().multiply(ibmOf(skin, parent));
      chains.push(makeChain(doc, skin, parent, ibmOf(skin, parent), toBind, points, `${tag}_${side}_${j}`, spec));
      if (j) chains[chains.length - 2]!.next = chains[chains.length - 1];
    }
    const first = chains.length - M;
    for (const v of verts) {
      const u = Math.min(M - 1 - 1e-6, Math.max(0, (v.p.x - lo) / width)), a = Math.floor(u), f = u - a;
      const top = tops[a]! * (1 - f) + tops[a + 1]! * f, bottom = bottoms[a]! * (1 - f) + bottoms[a + 1]! * f;
      const s = K * (top - v.p.y) / Math.max(top - bottom, 1e-3);
      bindVertex(prim, skin, v.index, v.p, [[chains[first + a]!, 1 - f], [chains[first + a + 1]!, f]], s, K);
    }
  }
  return chains;
}

/**
 * Weight one vertex (bind world position `p`) onto the chains it lies between, at parameter `s`
 * down them. Along the first half segment the body weights fade out as the chains' first joints fade
 * in. The cloth's thickness around each chain point is recorded so the floor holds the surface, not
 * just the chain, above it.
 */
function bindVertex(prim: Primitive, skin: Skin, index: number, p: THREE.Vector3, columns: [Chain, number][], s: number, K: number) {
  const cloth: (Influence & { chain: Chain; bone: number })[] = [];
  let share = 0;
  for (const [chain, cw] of columns) for (const { bone, weight } of along(s, K)) {
    cloth.push({ chain, bone, joint: skin.listJoints().indexOf(chain.joints[bone]!), weight: weight * cw }); share += weight * cw;
  }
  if (!cloth.length) return;
  const total = cloth.reduce((sum, c) => sum + c.weight, 0);
  for (const c of cloth) c.weight /= total;
  const main = cloth.reduce((best, c) => (c.weight > best.weight ? c : best));
  const a = main.chain.rest[main.bone]!, b = main.chain.rest[main.bone + 1]!;
  const distance = p.distanceTo(new THREE.Line3(a, b).closestPointToPoint(p, true, new THREE.Vector3()));
  for (const k of [main.bone, main.bone + 1]) main.chain.thick[k] = Math.max(main.chain.thick[k]!, distance);
  widenJoints(prim, skin.listJoints().length);
  writeWeights(prim, index, cloth, Math.min(1, share));
}

/** New joints down `points` (bind world), parented to `parent`, rest rotations identity. */
function makeChain(doc: Document, skin: Skin, parent: Node, parentIbm: THREE.Matrix4, skinToBind: THREE.Matrix4, points: THREE.Vector3[], name: string, spec: ClothSpec): Chain {
  // Parent-local coordinates of each point: parentIbm * skin-space point.
  const bindToSkin = skinToBind.clone().invert();
  const local = points.map(p => p.clone().applyMatrix4(bindToSkin).applyMatrix4(parentIbm));
  const joints: Node[] = [], offsets: THREE.Vector3[] = [];
  let up = parent;
  for (let k = 0; k < points.length; k++) {
    const offset = k ? local[k]!.clone().sub(local[k - 1]!) : local[0]!.clone();
    offsets.push(offset);
    if (k === points.length - 1) break;
    const joint = doc.createNode(`cloth_${name}_${k}`).setTranslation(offset.toArray() as [number, number, number]);
    up.addChild(joint);
    addJoint(skin, joint, new THREE.Matrix4().makeTranslation(-local[k]!.x, -local[k]!.y, -local[k]!.z).multiply(parentIbm));
    joints.push(joint); up = joint;
  }
  return { joints, offsets, rest: points.map(p => p.clone()), parent, spec, thick: points.map(() => 0) };
}

export interface ClothOptions { specs: ClothSpec[]; colliders: { from: string; to: string; radius: number }[]; spine: string[] }

/** Add cloth joints and reweight the hanging vertices. Call after the clips are in place. */
export function rigCloth(doc: Document, options: ClothOptions): ClothRig {
  const bind = bindWorld(doc);
  const chains = options.specs.flatMap((spec, i) => spec.kind === 'skirt' ? buildSkirt(doc, spec, bind, `skirt${i}`) : spec.kind === 'tip' ? buildTip(doc, spec, bind, `tip${i}`) : buildSleeve(doc, spec, bind, `sleeve${i}`));
  const skin = doc.getRoot().listSkins()[0]!;
  const colliders = options.colliders.map(c => ({ a: findJoint(skin, c.from), b: findJoint(skin, c.to), radius: c.radius }));
  return { chains, colliders, spine: options.spine.map(name => findJoint(skin, name)), names: new Set(chains.flatMap(c => c.joints.map(j => j.getName()))) };
}

const FPS = 30, SUB = 4, CLEARANCE = 0.035;

/** Simulate every chain through `clip` and write its rotation channels (30 fps). */
export function simulateCloth(doc: Document, rig: ClothRig, clipName: string, opts: { loop: boolean; glide?: number }) {
  const clip = doc.getRoot().listAnimations().find(c => c.getName() === clipName);
  if (!clip) return;
  const seconds = clipSeconds(clip), n = Math.max(2, Math.round(seconds * FPS) + 1);
  const stored = storedPose(doc);
  const bindParent = bindWorld(doc);
  // Body poses per frame (world matrices of every node the cloth needs).
  const needed = new Set<Node>([...rig.chains.map(c => c.parent), ...rig.colliders.flatMap(c => [c.a, c.b])]);
  const frames: Map<Node, THREE.Matrix4>[] = [];
  for (let f = 0; f < n; f++) {
    restorePose(stored); applyClip(clip, Math.min(seconds, f / FPS));
    frames.push(new Map([...needed].map(node => [node, mat(node)])));
  }
  restorePose(stored);
  const dt = 1 / FPS, h = dt / SUB;
  const q = new THREE.Quaternion(), qs = new THREE.Quaternion(), scale = new THREE.Vector3(), pos = new THREE.Vector3();
  // Rest shape of each chain relative to its parent, turned partly with it (hang keeps the rest in world space).
  const targets = (chain: Chain, f: number, shift: number) => {
    const M = frames[f]!.get(chain.parent)!, B = bindParent.get(chain.parent)!;
    M.decompose(pos, q, scale); B.decompose(pos, qs, scale);
    // Cloth hangs in world space only while its bone stands; on a lying body its rest shape runs
    // along the body and gravity lays it on the floor.
    const since = q.clone().multiply(qs.clone().invert()), upright = Math.max(0, new THREE.Vector3(0, 1, 0).applyQuaternion(since).y);
    const turn = since.slerp(new THREE.Quaternion(), chain.spec.hang * upright);
    const root = chain.rest[0]!.clone().applyMatrix4(B.clone().invert()).applyMatrix4(M);
    root.z += shift;
    return chain.rest.map(p => p.clone().sub(chain.rest[0]!).applyQuaternion(turn).add(root));
  };
  const lengths = rig.chains.map(c => c.rest.slice(1).map((p, i) => p.distanceTo(c.rest[i]!)));
  const spacing = rig.chains.map(c => c.next === undefined ? [] : c.rest.map((p, i) => p.distanceTo(c.next!.rest[i]!)));
  const glide = opts.glide ?? 0;
  const order = opts.loop ? [...Array(3)].flatMap(() => [...Array(n - 1).keys()]) : [...Array(30).fill(0), ...Array(n).keys()];
  const init = rig.chains.map(c => targets(c, order[0]!, 0));
  const x = init.map(t => t.map(p => p.clone())), prev = init.map(t => t.map(p => p.clone()));
  const history: THREE.Vector3[][][] = [];
  const capsule = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const ab = b.clone().sub(a), t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-12)));
    const c = a.clone().addScaledVector(ab, t), d = p.clone().sub(c), dist = d.length();
    if (dist < r) p.copy(c.add(dist > 1e-9 ? d.multiplyScalar(r / dist) : new THREE.Vector3(0, 0, -r)));
  };
  for (const [step, f] of order.entries()) {
    const shift = 0;
    const tg = rig.chains.map(c => targets(c, f, shift));
    const cols = rig.colliders.map(c => { const M = frames[f]!.get(c.a)!, N = frames[f]!.get(c.b)!;
      const a = new THREE.Vector3().setFromMatrixPosition(M), b = new THREE.Vector3().setFromMatrixPosition(N); a.z += shift; b.z += shift; return { a, b, r: c.radius }; });
    for (let s = 0; s < SUB; s++) {
      rig.chains.forEach((chain, ci) => {
        const { stiffness: k, damping, gravity: g, drag } = chain.spec, keep = Math.exp(-damping * h);
        for (let i = 1; i < chain.rest.length; i++) {
          const p = x[ci]![i]!, acc = tg[ci]![i]!.clone().sub(p).multiplyScalar(k); acc.y -= g; acc.z -= drag * glide;
          const next = p.clone().add(p.clone().sub(prev[ci]![i]!).multiplyScalar(keep)).addScaledVector(acc, h * h);
          prev[ci]![i]!.copy(p); p.copy(next);
        }
        x[ci]![0]!.copy(tg[ci]![0]!);
      });
      for (let iteration = 0; iteration < 3; iteration++) {
        rig.chains.forEach((chain, ci) => {
          if (chain.next === undefined) return;
          for (let i = 1; i < chain.rest.length; i++) {
            const a = x[ci]![i]!, b = x[rig.chains.indexOf(chain.next)]![i]!, d = a.distanceTo(b), r = spacing[ci]![i]!;
            const want = Math.min(Math.max(d, 0.9 * r), 1.1 * r);
            if (d > 1e-9 && want !== d) { const corr = b.clone().sub(a).multiplyScalar((1 - want / d) * 0.5); a.add(corr); b.sub(corr); }
          }
        });
        rig.chains.forEach((chain, ci) => {
          for (let i = 1; i < chain.rest.length; i++) {
            const p = x[ci]![i]!;
            for (const c of cols) capsule(p, c.a, c.b, c.r);
            const up = x[ci]![i - 1]!, dir = p.clone().sub(up);
            // The cloth's own thickness reaches below the chain once the segment lies down.
            const lying = dir.lengthSq() > 1e-12 ? Math.sqrt(Math.max(0, 1 - (dir.y * dir.y) / dir.lengthSq())) : 0;
            p.y = Math.max(p.y, CLEARANCE + chain.thick[i]! * lying);
            p.copy(up).addScaledVector(dir.lengthSq() > 1e-12 ? dir.normalize() : new THREE.Vector3(0, -1, 0), lengths[ci]![i - 1]!);
            const floor = CLEARANCE + chain.thick[i]! * lying;
            if (p.y <= floor) {
              // Resting on the floor: friction takes most of the sliding speed.
              p.y = floor;
              const last = prev[ci]![i]!; last.x += (p.x - last.x) * 0.6; last.z += (p.z - last.z) * 0.6;
            }
          }
        });
      }
    }
    // Frames of the kept cycle (a loop's last pass, or the one-shot after settling).
    if ((opts.loop && step >= order.length - (n - 1)) || (!opts.loop && step >= 30)) history.push(x.map(chain => chain.map(p => p.clone().setZ(p.z - shift))));
  }
  if (opts.loop) history.push(history[0]!.map(chain => chain.map(p => p.clone())));
  if (process.env.DEBUG_CLOTH === clipName) rig.chains.forEach((c, ci) => { if (!c.joints[0]!.getName().includes(process.env.DEBUG_CHAIN ?? "")) return; const f = (p: THREE.Vector3) => p.toArray().map(v => v.toFixed(2)).join(","); console.log(c.joints[0]!.getName(), "thick", c.thick.map(t => t.toFixed(2)).join(","), "parent", c.parent.getName(), "rest", c.rest.map(f).join(" | "), "\n  T", targets(c, 0, 0).map(f).join(" | "), "\n  S", history[0]![ci]!.map(f).join(" | "), "\n  E", history.at(-1)![ci]!.map(f).join(" | ")); });
  // Bake: each joint turns (minimal arc from its rest direction) to point at the next simulated point.
  const rotations = rig.chains.map(c => c.joints.map(() => [] as number[]));
  const pose = new THREE.Matrix4(), inv = new THREE.Matrix4();
  history.forEach((points, f) => {
    rig.chains.forEach((chain, ci) => {
      let parent = frames[Math.min(f, n - 1)]!.get(chain.parent)!.clone();
      chain.joints.forEach((_, i) => {
        const head = new THREE.Matrix4().makeTranslation(chain.offsets[i]!.x, chain.offsets[i]!.y, chain.offsets[i]!.z);
        const frame = parent.clone().multiply(head);
        inv.copy(frame).invert();
        const d = points[ci]![i + 1]!.clone().applyMatrix4(inv).normalize(), rest = chain.offsets[i + 1]!.clone().normalize();
        const r = new THREE.Quaternion().setFromUnitVectors(rest, d);
        rotations[ci]![i]!.push(r.x, r.y, r.z, r.w);
        parent = frame.multiply(pose.makeRotationFromQuaternion(r));
      });
    });
  });
  if (opts.loop) closeLoop(rotations);
  const times = Array.from({ length: history.length }, (_, f) => Math.min(seconds, f / FPS));
  const buffer = doc.getRoot().listBuffers()[0]!;
  rig.chains.forEach((chain, ci) => chain.joints.forEach((joint, i) => {
    for (const channel of clip.listChannels()) if (channel.getTargetNode() === joint) { channel.getSampler()?.dispose(); channel.dispose(); }
    const input = doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer);
    const output = doc.createAccessor().setType('VEC4').setArray(continuous(rotations[ci]![i]!)).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    clip.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(joint).setTargetPath('rotation').setSampler(sampler));
  }));
}

/** Spread the last-to-first difference over the cycle so a loop has no pop at the seam. */
function closeLoop(rotations: number[][][]) {
  for (const chain of rotations) for (const track of chain) {
    const n = track.length / 4, first = new THREE.Quaternion().fromArray(track, 0), last = new THREE.Quaternion().fromArray(track, (n - 1) * 4);
    const fix = last.clone().invert().multiply(first);
    for (let f = 0; f < n; f++) {
      const r = new THREE.Quaternion().fromArray(track, f * 4).multiply(new THREE.Quaternion().slerp(fix, f / (n - 1)));
      r.toArray(track, f * 4);
    }
  }
}

function continuous(values: number[]): Float32Array<ArrayBuffer> {
  for (let i = 4; i < values.length; i += 4) {
    const dot = values[i]! * values[i - 4]! + values[i + 1]! * values[i - 3]! + values[i + 2]! * values[i - 2]! + values[i + 3]! * values[i - 1]!;
    if (dot < 0) for (let k = 0; k < 4; k++) values[i + k] = -values[i + k]!;
  }
  return new Float32Array(values);
}

/** Lowest deformed point of the body, ignoring vertices mostly carried by cloth joints. */
export function bodyMinY(doc: Document, ignore: Set<string>): number {
  let min = Infinity;
  const point = new THREE.Vector3(), out = new THREE.Vector3(), tmp = new THREE.Vector3();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(), skin = node.getSkin();
    if (!mesh) continue;
    const joints = skin?.listJoints() ?? [];
    const matrices = joints.map((joint, i) => mat(joint).multiply(new THREE.Matrix4().fromArray(skin!.getInverseBindMatrices()!.getElement(i, []))));
    const skip = joints.map(joint => ignore.has(joint.getName()));
    for (const prim of mesh.listPrimitives()) {
      const P = prim.getAttribute('POSITION')!, J = prim.getAttribute('JOINTS_0') as Accessor | null, W = prim.getAttribute('WEIGHTS_0') as Accessor | null;
      const j = [0, 0, 0, 0], w = [0, 0, 0, 0], world = mat(node);
      for (let i = 0; i < P.getCount(); i++) {
        point.fromArray(P.getElement(i, []));
        if (skin && J && W) {
          J.getElement(i, j); W.getElement(i, w);
          let cloth = 0; out.set(0, 0, 0);
          for (let k = 0; k < 4; k++) if (w[k]) { if (skip[j[k]!]) cloth += w[k]!; out.add(tmp.copy(point).applyMatrix4(matrices[j[k]!]!).multiplyScalar(w[k]!)); }
          if (cloth > 0.5) continue;
        } else out.copy(point).applyMatrix4(world);
        min = Math.min(min, out.y);
      }
    }
  }
  return min;
}
