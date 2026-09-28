import type { Document, Node } from '@gltf-transform/core';
import { Matrix4, Quaternion, Vector3 } from 'three';

const matrix = (node: Node) => new Matrix4().fromArray(node.getWorldMatrix());
const position = (node: Node) => new Vector3().setFromMatrixPosition(matrix(node));
const rotation = (node: Node) => {
  const q = new Quaternion(); matrix(node).decompose(new Vector3(), q, new Vector3()); return q.normalize();
};
const setRotation = (node: Node, q: Quaternion) => {
  const parent = node.getParentNode();
  node.setRotation((parent ? rotation(parent).invert().multiply(q) : q).normalize().toArray());
};
const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value)); return t * t * t * (10 + t * (-15 + 6 * t));
};

/** A complete segment frame retains axial roll when the limb passes its opposite direction. */
function frame(direction: Vector3, normal: Vector3) {
  const y = direction.clone().normalize(), x = y.clone().cross(normal);
  if (x.lengthSq() < 1e-12) throw new Error('Crawler Death has a degenerate bend frame');
  x.normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, x.clone().cross(y).normalize()));
}

type Transport = {
  pole: Vector3;
  upperInverse: Quaternion;
  lowerInverse: Quaternion;
  upperRotation: Quaternion;
  lowerRotation: Quaternion;
};

/**
 * Create in native Idle@0; call on sequential baked Death frames after donor retargeting.
 * This owns the whole-body roll. It changes rotations only; the caller owns grounding.
 */
export function createStudioCrawlerDeath(doc: Document, target: ReadonlyMap<string, Node>, root: Node): (phase: number) => void {
  const rootInverse = rotation(root).invert();
  const limbs = ['l', 'r'].flatMap(side => ['', '_dupli_001', '_dupli_002', '_dupli_003'].flatMap((suffix, index) => {
    const nodes = ['shoulder', 'arm_stretch', 'forearm_stretch', 'hand'].map(name => target.get(`${name}${suffix}${side}`));
    if (nodes.every(node => !node)) return [];
    if (nodes.some(node => !node)) throw new Error(`Incomplete crawler Death chain ${suffix}${side}`);
    const [shoulder, hip, knee, foot] = nodes as [Node, Node, Node, Node];
    if (hip.getParentNode() !== shoulder || knee.getParentNode() !== hip || foot.getParentNode() !== knee) {
      throw new Error(`Crawler Death requires the native serial chain ${suffix}${side}`);
    }
    const points = nodes.map(node => position(node!));
    const shoulderDirection = points[1]!.clone().sub(points[0]!).normalize();
    const sign = side === 'l' ? 1 : -1, pincer = index === 3;
    const foldedShoulder = new Vector3(sign * .30, -.92, pincer ? .28 : -.08).normalize();
    return [{ shoulder, hip, knee, foot, side: sign, index, pincer,
      upper: points[1]!.distanceTo(points[2]!), lower: points[2]!.distanceTo(points[3]!),
      shoulderRotation: new Quaternion().setFromUnitVectors(shoulderDirection, foldedShoulder).multiply(rotation(shoulder)),
      footRotation: new Quaternion().fromArray(foot.getRotation()), transport: undefined as Transport | undefined }];
  }));
  if (!limbs.length) throw new Error('Crawler Death has no verified support chains');
  const tails = ['x', '_dupli_001x'].map(suffix => [...target.values()]
    .filter(node => new RegExp(`^c_tail_\\d\\d${suffix}$`).test(node.getName()))
    .sort((a, b) => a.getName().localeCompare(b.getName()))).filter(chain => chain.length > 1)
    .map(chain => ({ side: Math.sign(position(chain[0]!).x) || 1,
      segments: chain.slice(0, -1).map((node, index) => {
        const child = chain[index + 1]!;
        if (child.getParentNode() !== node) throw new Error(`Disconnected crawler tail ${node.getName()}`);
        const direction = position(child).sub(position(node));
        // Native tails bend in the fore/aft vertical plane. Preserve their cross section
        // when this plane settles onto the ground instead of independently swinging bones.
        const normal = new Vector3(1, 0, 0);
        return { node, child, length: direction.length(), inverse: frame(direction, normal).invert(), rotation: rotation(node) };
      }) }));

  // A torso-only floor reference avoids using the same long legs that caused the body
  // to be propped up. These samples are read-only; no positions, weights or binds change.
  type SurfacePoint = { point: Vector3; terms: { joint: Node; inverse: Matrix4; weight: number }[] };
  const bodyPoints: SurfacePoint[] = [], tailPoints: SurfacePoint[] = [];
  for (const meshNode of doc.getRoot().listNodes()) {
    const skin = meshNode.getSkin();
    if (!skin) continue;
    const joints = skin.listJoints(), inverses = joints.map((_, i) => new Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(i, [] as number[])));
    for (const primitive of meshNode.getMesh()?.listPrimitives() ?? []) {
      const positions = primitive.getAttribute('POSITION')!, indices = primitive.getAttribute('JOINTS_0'), weights = primitive.getAttribute('WEIGHTS_0');
      if (!indices || !weights) continue;
      for (let i = 0; i < positions.getCount(); i++) {
        const ids = indices.getElement(i, [] as number[]), values = weights.getElement(i, [] as number[]);
        const dominant = values.indexOf(Math.max(...values));
        const body = /^(rootx|spine_\d\dx|neckx|headx)$/.test(joints[ids[dominant]!]!.getName());
        const tail = /^c_tail_/.test(joints[ids[dominant]!]!.getName());
        if (!body && !tail) continue;
        const sample = { point: new Vector3().fromArray(positions.getElement(i, [] as number[])),
          terms: values.flatMap((weight, slot) => weight ? [{ joint: joints[ids[slot]!]!, inverse: inverses[ids[slot]!]!, weight }] : []) };
        if (body) bodyPoints.push(sample);
        if (tail) tailPoints.push(sample);
      }
    }
  }
  if (!bodyPoints.length) throw new Error('Crawler Death has no weighted torso surface');
  let previousPhase = -1;
  return phase => {
    if (!Number.isFinite(phase) || phase < 0 || phase > 1 || phase < previousPhase) {
      throw new Error('Crawler Death must be baked once in ascending normalized phase');
    }
    previousPhase = phase;
    const fold = ease((phase - .22) / .66), roll = ease((phase - .31) / .57);
    if (!fold && !roll) return;
    setRotation(root, new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 1.65 * roll).multiply(rotation(root)));
    const delta = rotation(root).multiply(rootInverse);
    for (const leg of limbs) {
      const footLocal = new Quaternion().fromArray(leg.foot.getRotation());
      const shoulderStart = rotation(leg.shoulder);
      setRotation(leg.shoulder, shoulderStart.slerp(delta.clone().multiply(leg.shoulderRotation), fold));
      const hip = position(leg.hip), knee = position(leg.knee), foot = position(leg.foot), reach = leg.upper + leg.lower;
      const end = hip.clone().add(new Vector3(-leg.side * .18, -.43, leg.pincer ? .24 : (1 - leg.index) * .10).multiplyScalar(reach).applyQuaternion(delta));
      const targetPoint = foot.clone().lerp(end, fold)
        .add(new Vector3(leg.side * .23, -.12, 0).multiplyScalar(reach * Math.sin(Math.PI * fold)).applyQuaternion(delta));
      const axis = targetPoint.sub(hip), distance = Math.max(Math.abs(leg.upper - leg.lower) + 1e-6, Math.min(reach - 1e-6, axis.length()));
      axis.normalize();
      let pole = knee.clone().sub(hip).addScaledVector(axis, -knee.clone().sub(hip).dot(axis));
      if (pole.lengthSq() < 1e-10) pole = new Vector3(leg.side, -.25, .35).applyQuaternion(delta);
      pole.normalize();
      const desiredPole = new Vector3(leg.side, -.3, (leg.index % 2 ? -1 : 1) * .30).applyQuaternion(delta);
      desiredPole.addScaledVector(axis, -desiredPole.dot(axis)).normalize();
      if (!leg.transport) {
        const upper = knee.clone().sub(hip), lower = foot.clone().sub(knee), normal = upper.clone().cross(lower).normalize();
        leg.transport = { pole: pole.clone(), upperInverse: frame(upper, normal).invert(), lowerInverse: frame(lower, normal).invert(),
          upperRotation: rotation(leg.hip), lowerRotation: rotation(leg.knee) };
      }
      const transport = leg.transport;
      const previous = transport.pole.clone().addScaledVector(axis, -transport.pole.dot(axis));
      if (previous.lengthSq() > 1e-10) {
        previous.normalize();
        if (desiredPole.dot(previous) < 0) desiredPole.negate();
        pole.copy(previous.lerp(desiredPole, .20 * fold).normalize());
      }
      const along = (leg.upper * leg.upper - leg.lower * leg.lower + distance * distance) / (2 * distance);
      const bend = hip.clone().addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0, leg.upper * leg.upper - along * along)));
      const reached = hip.clone().addScaledVector(axis, distance), upper = bend.clone().sub(hip), lower = reached.sub(bend), normal = upper.clone().cross(lower).normalize();
      setRotation(leg.hip, frame(upper, normal).multiply(transport.upperInverse).multiply(transport.upperRotation));
      setRotation(leg.knee, frame(lower, normal).multiply(transport.lowerInverse).multiply(transport.lowerRotation));
      // The terminal control follows the folded forearm. Reorienting it in world
      // space independently would twist the wrist when the bend frame rolls over.
      leg.foot.setRotation(footLocal.slerp(leg.footRotation, fold).normalize().toArray());
      transport.pole.copy(pole);
    }
    const transforms = new Map<Node, Matrix4>();
    let bodyMinimum = Infinity, bodyMaximum = -Infinity;
    for (const sample of bodyPoints) {
      const point = new Vector3();
      for (const term of sample.terms) {
        if (!transforms.has(term.joint)) transforms.set(term.joint, matrix(term.joint));
        point.addScaledVector(sample.point.clone().applyMatrix4(term.inverse).applyMatrix4(transforms.get(term.joint)!), term.weight);
      }
      bodyMinimum = Math.min(bodyMinimum, point.y); bodyMaximum = Math.max(bodyMaximum, point.y);
    }
    let tailHeight = bodyMinimum + (bodyMaximum - bodyMinimum) * .025 + .006;
    const tailSettle = ease((phase - .30) / .61);
    const tailStart = tails.flatMap(tail => tail.segments.map(segment => ({ node: segment.node, q: segment.node.getRotation() })));
    for (let pass = 0; pass < 3; pass++) {
      for (const start of tailStart) start.node.setRotation(start.q);
      for (const tail of tails) for (let i = 0; i < tail.segments.length; i++) {
        const segment = tail.segments[i]!, at = position(segment.node);
        const horizontal = new Vector3(tail.side * (.22 + .30 * Math.sin(i / tail.segments.length * Math.PI)), 0, -1).normalize();
        const vertical = Math.max(-.68, Math.min(.35, (tailHeight - at.y) / segment.length));
        const direction = horizontal.multiplyScalar(Math.sqrt(1 - vertical * vertical)); direction.y = vertical;
        const desired = frame(direction, new Vector3(0, 1, 0)).multiply(segment.inverse).multiply(segment.rotation);
        setRotation(segment.node, rotation(segment.node).slerp(desired, tailSettle));
      }
      // The double tail has broad terminal leaves; its bone centers alone do not
      // describe contact. Adjust the plane using the unchanged skinned surface.
      // Each attempt restores the same donor pose, so partial settling is not compounded.
      const matrices = new Map<Node, Matrix4>();
      let minimum = Infinity;
      for (const sample of tailPoints) {
        const point = new Vector3();
        for (const term of sample.terms) {
          if (!matrices.has(term.joint)) matrices.set(term.joint, matrix(term.joint));
          point.addScaledVector(sample.point.clone().applyMatrix4(term.inverse).applyMatrix4(matrices.get(term.joint)!), term.weight);
        }
        minimum = Math.min(minimum, point.y);
      }
      if (!Number.isFinite(minimum)) break;
      tailHeight += (bodyMinimum + .012 - minimum) * ease((phase - .60) / .28);
    }
  };
}
