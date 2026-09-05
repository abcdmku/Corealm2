/** Offline, metre-space gait authoring. Never imported by the game. */
import type { Document, Node } from '@gltf-transform/core';
import { Matrix4, Quaternion, Vector3 } from 'three';

export type BakedTrack = { node: Node; path: 'rotation' | 'translation' | 'scale'; times: number[]; values: number[] };
export type ContactFoot = { name: string; vertices: number[]; primaryVertices: number[]; phaseOffset: number; duty: number; clearance: number };
export type BakedGait = { name: 'Walk' | 'Run'; seconds: number; nativeMps: number; tracks: BakedTrack[]; feet: ContactFoot[]; notes: string[]; diagnostics?: Record<string, unknown> };
export const fract = (value: number): number => ((value % 1) + 1) % 1;
export const contactAt = (foot: ContactFoot, phase: number): boolean => fract(phase - foot.phaseOffset) < foot.duty;
export function worldPosition(node: Node): Vector3 { return new Vector3().setFromMatrixPosition(new Matrix4().fromArray(node.getWorldMatrix())); }
export function worldQuaternion(node: Node): Quaternion { const q = new Quaternion(); new Matrix4().fromArray(node.getWorldMatrix()).decompose(new Vector3(), q, new Vector3()); return q; }
export function setWorldQuaternion(node: Node, desired: Quaternion): void {
  const parent = node.getParentNode();
  node.setRotation((parent ? worldQuaternion(parent).invert().multiply(desired) : desired.clone()).normalize().toArray());
}
export function setWorldPosition(node: Node, desired: Vector3): void {
  const parent = node.getParentNode();
  node.setTranslation((parent ? desired.clone().applyMatrix4(new Matrix4().fromArray(parent.getWorldMatrix()).invert()) : desired).toArray());
}
/** Solve through a world-space pole. The source scales and segment translations stay intact. */
export function solveTwoBone(upper: Node, lower: Node, end: Node, target: Vector3, pole: Vector3): { error: number; extensionMargin: number } {
  const a = worldPosition(upper), b = worldPosition(lower), c = worldPosition(end);
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
  const axis = target.clone().sub(a), requestedDistance = axis.length();
  if (requestedDistance < 1e-10 || l1 < 1e-10 || l2 < 1e-10) throw new Error('Degenerate two-bone chain');
  axis.normalize();
  const d = Math.max(Math.abs(l1 - l2) + 1e-7, Math.min(l1 + l2 - 1e-7, requestedDistance));
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const bend = pole.clone().sub(a).addScaledVector(axis, -pole.clone().sub(a).dot(axis));
  if (bend.lengthSq() < 1e-12) throw new Error('Degenerate two-bone pole');
  const knee = a.clone().addScaledVector(axis, along).addScaledVector(bend.normalize(), height);
  const upperQ = new Quaternion().setFromUnitVectors(b.clone().sub(a).normalize(), knee.clone().sub(a).normalize()).multiply(worldQuaternion(upper));
  setWorldQuaternion(upper, upperQ);
  const posedB = worldPosition(lower), posedC = worldPosition(end);
  const lowerQ = new Quaternion().setFromUnitVectors(posedC.sub(posedB).normalize(), target.clone().sub(posedB).normalize()).multiply(worldQuaternion(lower));
  setWorldQuaternion(lower, lowerQ);
  return { error: worldPosition(end).distanceTo(target), extensionMargin: l1 + l2 - requestedDistance };
}

export type SkinReader = { count: number; point(index: number): Vector3; points(indices: number[]): Vector3[]; indicesForBranches(roots: string[], maximumRestY: number): number[]; influences(index: number): { node: Node; weight: number }[]; restPoints: Vector3[] };
/** Includes imported world scale once, including blended physical tip vertices. */
export function createSkinReader(doc: Document, meshNodeName: string): SkinReader {
  const meshNode = doc.getRoot().listNodes().find(node => node.getName() === meshNodeName);
  if (!meshNode?.getMesh() || !meshNode.getSkin()) throw new Error(`Missing source skinned mesh ${meshNodeName}`);
  if (meshNode.getMesh()!.listPrimitives().length !== 1) throw new Error('Ground gait reader requires the reviewed single-primitive source');
  const primitive = meshNode.getMesh()!.listPrimitives()[0]!;
  if (primitive.getAttribute('JOINTS_1') || primitive.getAttribute('WEIGHTS_1') || primitive.listTargets().length) throw new Error('Ground gait reader requires the reviewed four-influence mesh without morph targets');
  const positions = primitive.getAttribute('POSITION')!, jointsA = primitive.getAttribute('JOINTS_0')!, weightsA = primitive.getAttribute('WEIGHTS_0')!;
  const skin = meshNode.getSkin()!, joints = skin.listJoints(), inverse = skin.getInverseBindMatrices()!;
  const ibm = joints.map((_, i) => new Matrix4().fromArray(inverse.getElement(i, [])));
  const rows = Array.from({ length: positions.getCount() }, (_, i) => ({ position: positions.getElement(i, []), joints: jointsA.getElement(i, []), weights: weightsA.getElement(i, []) }));
  if (rows.some(row => row.weights.some(weight => !Number.isFinite(weight) || weight < 0) || Math.abs(row.weights.reduce((sum, value) => sum + value, 0) - 1) > 1e-4)) throw new Error('Ground gait reader requires finite normalized source skin weights');
  const pointWithMatrices = (index: number, matrices: Map<number, Matrix4>): Vector3 => {
    const row = rows[index]!; const result = new Vector3();
    for (let k = 0; k < row.weights.length; k++) if (row.weights[k]! > 0) {
      const jointIndex = row.joints[k]!;
      if (!matrices.has(jointIndex)) matrices.set(jointIndex, new Matrix4().fromArray(joints[jointIndex]!.getWorldMatrix()).multiply(ibm[jointIndex]!));
      result.addScaledVector(new Vector3().fromArray(row.position).applyMatrix4(matrices.get(jointIndex)!), row.weights[k]!);
    }
    return result;
  };
  const point = (index: number): Vector3 => pointWithMatrices(index, new Map());
  const points = (indices: number[]): Vector3[] => { const matrices = new Map<number, Matrix4>(); return indices.map(index => pointWithMatrices(index, matrices)); };
  const restPoints = points(rows.map((_, i) => i));
  const influences = (index: number) => rows[index]!.joints.flatMap((joint, k) => rows[index]!.weights[k]! > 0 ? [{ node: joints[joint]!, weight: rows[index]!.weights[k]! }] : []);
  return { count: rows.length, point, points, restPoints, influences, indicesForBranches(roots, maximumRestY) {
    const descendants = new Set<Node>();
    const visit = (node: Node): void => { descendants.add(node); node.listChildren().forEach(visit); };
    roots.forEach(name => { const node = doc.getRoot().listNodes().find(n => n.getName() === name); if (!node) throw new Error(`Missing branch ${name}`); visit(node); });
    const seen = new Set<string>();
    return rows.flatMap((row, index) => {
      if (restPoints[index]!.y > maximumRestY || influences(index).reduce((sum, influence) => sum + (descendants.has(influence.node) ? influence.weight : 0), 0) < .5) return [];
      const key = JSON.stringify([row.position, row.joints, row.weights]);
      if (seen.has(key)) return []; seen.add(key); return [index];
    });
  } };
}

/** Linear planted travel and a cubic swing whose endpoint velocity matches stance. */
export function cyclicFootPath(phase: number, duty: number, seconds: number, nativeMps: number, lift: number): { z: number; y: number; contact: boolean } {
  const p = fract(phase), span = nativeMps * seconds * duty;
  if (p < duty) return { z: span * (.5 - p / duty), y: 0, contact: true };
  const u = (p - duty) / (1 - duty), slope = -nativeMps * seconds * (1 - duty);
  const u2 = u * u, u3 = u2 * u;
  const z = (2 * u3 - 3 * u2 + 1) * (-span / 2) + (u3 - 2 * u2 + u) * slope + (-2 * u3 + 3 * u2) * (span / 2) + (u3 - u2) * slope;
  return { z, y: lift * 16 * u2 * (1 - u) ** 2, contact: false };
}

export function captureTracks(nodes: { node: Node; path: BakedTrack['path'] }[], times: number[], poses: number[][][]): BakedTrack[] {
  return nodes.map((spec, trackIndex) => ({ ...spec, times, values: poses.flatMap(pose => pose[trackIndex]!) }));
}
