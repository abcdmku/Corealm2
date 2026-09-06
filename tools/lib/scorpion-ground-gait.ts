/** Offline Run repair for the original eight-leg scorpion. Source geometry stays exact. */
import type { AnimationChannel, Document, Node } from '@gltf-transform/core';
import { Quaternion, Vector3 } from 'three';
import { duration, restorePose, sample, storedPose } from '../creature-motion/pose.js';
import { captureTracks, createSkinReader, cyclicFootPath, fract, setWorldQuaternion, solveTwoBone, worldPosition, worldQuaternion, type BakedGait, type BakedTrack } from './ground-gait.js';

const NATIVE_MPS = .31;
const DUTY = .60;
const CLEARANCE = .0005;
const SAMPLE_INTERVALS = 1920;
const LEG_TYPES = ['FrontLeg', 'MidFrontLeg', 'MidBackLeg', 'BackLeg'] as const;
const INSETS = [.020, .008, .022, .008];
const SOLE_COUNTS = [6, 7, 4, 4];
type SourceChannel = { channel: AnimationChannel; node: Node; path: BakedTrack['path']; start: number[]; initialNext: number[]; initialSpan: number };
const WORLD_AXES = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];

function linearSolve(matrix: number[][], values: number[]): number[] {
  const rows = matrix.map((row, i) => [...row, values[i]!]), n = values.length;
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let i = column + 1; i < n; i++) if (Math.abs(rows[i]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = i;
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    const divisor = rows[column]![column]!;
    if (Math.abs(divisor) < 1e-15) throw new Error('Singular scorpion sole solve');
    for (let j = column; j <= n; j++) rows[column]![j] = rows[column]![j]! / divisor;
    for (let i = 0; i < n; i++) if (i !== column) {
      const multiplier = rows[i]![column]!;
      for (let j = column; j <= n; j++) rows[i]![j] = rows[i]![j]! - multiplier * rows[column]![j]!;
    }
  }
  return rows.map(row => row[n]!);
}

/** Damped rotation-only corrections fit the original weighted sole. The damping
 * prevents almost-dependent skin weights from producing large null-space twists. */
function fitPhysicalSole(chain: Node[], points: (indices: number[]) => Vector3[], vertices: number[], targets: Vector3[]): { error: number; correction: number } {
  const controls = chain.slice(0, 5), originals = controls.map(node => new Quaternion().fromArray(node.getRotation()));
  const variables = controls.flatMap(node => WORLD_AXES.map(axis => ({ node, axis })));
  const epsilon = 1e-4;
  let error = Infinity;
  for (let iteration = 0; iteration < 12; iteration++) {
    const actual = points(vertices), residual = targets.flatMap((target, i) => target.clone().sub(actual[i]!).toArray());
    error = Math.max(...targets.map((target, i) => target.distanceTo(actual[i]!)));
    if (error < 2e-7) break;
    const jacobian = variables.map(({ node, axis }) => {
      const local = node.getRotation();
      setWorldQuaternion(node, new Quaternion().setFromAxisAngle(axis, epsilon).multiply(worldQuaternion(node)));
      const shifted = points(vertices);
      node.setRotation(local);
      return shifted.flatMap((point, i) => point.sub(actual[i]!).multiplyScalar(1 / epsilon).toArray());
    });
    const normal = variables.map((_, i) => variables.map((_, j) => jacobian[i]!.reduce((sum, value, k) => sum + value * jacobian[j]![k]!, 0) + (i === j ? 1e-5 : 0)));
    const rhs = jacobian.map(column => column.reduce((sum, value, i) => sum + value * residual[i]!, 0));
    const update = linearSolve(normal, rhs);
    for (let i = 0; i < controls.length; i++) {
      const delta = new Vector3().fromArray(update, i * 3), angle = delta.length();
      if (angle > 0) setWorldQuaternion(controls[i]!, new Quaternion().setFromAxisAngle(delta.normalize(), Math.min(angle, .10)).multiply(worldQuaternion(controls[i]!)));
    }
  }
  error = Math.max(...targets.map((target, i) => target.distanceTo(points(vertices)[i]!)));
  const correction = Math.max(...controls.map((node, i) => originals[i]!.angleTo(new Quaternion().fromArray(node.getRotation()))));
  if (correction > .65) throw new Error(`Scorpion sole correction exceeds anatomical limit ${correction}`);
  return { error, correction };
}

function closedSource(channels: SourceChannel[], elapsed: number, seconds: number): void {
  const t = Math.max(0, Math.min(1, (elapsed / seconds - .85) / .15));
  const weight = t * t * t * (10 - 15 * t + 6 * t * t);
  for (const { channel, node, path, start, initialNext, initialSpan } of channels) {
    const values = sample(channel.getSampler()!, elapsed), backwards = (elapsed - seconds) / initialSpan;
    if (path === 'rotation') {
      const startQ = new Quaternion().fromArray(start).normalize(), nextQ = new Quaternion().fromArray(initialNext).normalize();
      if (startQ.dot(nextQ) < 0) nextQ.set(-nextQ.x, -nextQ.y, -nextQ.z, -nextQ.w);
      const delta = startQ.clone().invert().multiply(nextQ).normalize();
      const closing = startQ.multiply(new Quaternion().slerp(delta, backwards));
      node.setRotation(new Quaternion().fromArray(values).slerp(closing, weight).normalize().toArray());
    } else {
      const result = values.map((value, axis) => value + weight * (start[axis]! + (initialNext[axis]! - start[axis]!) * backwards - value)) as [number, number, number];
      if (path === 'translation') node.setTranslation(result); else node.setScale(result);
    }
  }
}

export function authorScorpionRun(doc: Document, seconds: number, floorY: number): BakedGait {
  const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Run');
  if (!clip || Math.abs(seconds - duration(clip)) > 1e-6 || Math.abs(seconds - .6333333253860474) > 1e-5 || !Number.isFinite(floorY)) throw new Error('Scorpion Run source contract changed');
  const rest = storedPose(doc), nodes = doc.getRoot().listNodes();
  const find = (name: string): Node => { const matches = nodes.filter(node => node.getName() === name); if (matches.length !== 1) throw new Error(`Scorpion requires one ${name}`); return matches[0]!; };
  const skin = createSkinReader(doc, 'Scorpion_Mesh'), body = find('Scorpion_ROOTSHJnt');
  const legs = ['l', 'r'].flatMap((side, sideIndex) => LEG_TYPES.map((type, index) => {
    const prefix = `Scorpion_${side}_${type}_`;
    const chain = ['HipSHJnt', 'Knee1SHJnt', 'Knee2SHJnt', 'AnkleSHJnt', 'BallSHJnt', 'ToeSHJnt'].map(suffix => find(prefix + suffix));
    chain.forEach((node, i) => { if (node.getParentNode() !== (i ? chain[i - 1] : body)) throw new Error(`Scorpion chain changed at ${node.getName()}`); });
    const [upper, lower, distal] = chain as [Node, Node, Node, ...Node[]];
    const a = worldPosition(upper), b = worldPosition(lower), c = worldPosition(distal);
    const axis = c.clone().sub(a).normalize(), pole = b.clone().sub(a); pole.addScaledVector(axis, -pole.dot(axis)).normalize();
    const vertices = skin.indicesForBranches([upper.getName()], .003);
    if (vertices.length !== SOLE_COUNTS[index]) throw new Error(`Scorpion ${side}/${type} physical sole changed`);
    const primary = [...vertices].sort((a, b) => skin.restPoints[a]!.y - skin.restPoints[b]!.y)[0]!;
    const pad = skin.restPoints[primary]!.clone(), center = pad.clone();
    center.x -= Math.sign(center.x) * INSETS[index]!;
    center.y = floorY + CLEARANCE;
    center.z = a.z + pad.z - c.z;
    return { side, type, chain, upper, lower, distal, vertices, primary, pad, center, distalOffset: pad.clone().sub(c), distalQ: worldQuaternion(distal), pole,
      l1: a.distanceTo(b), l2: b.distanceTo(c), phaseOffset: fract(index * .125 + sideIndex * .5), minimumExtension: Infinity, minimumFold: Infinity, maximumTipError: 0, maximumSoleError: 0, maximumSoleCorrection: 0 };
  }));
  const legNodes = new Set(legs.flatMap(leg => leg.chain)), legRest = rest.filter(row => legNodes.has(row.node));
  for (const row of rest) if (row.s.some(value => value <= 0) || Math.max(...row.s) - Math.min(...row.s) > Math.max(...row.s) * 1e-5) throw new Error(`Scorpion ${row.node.getName()} does not have the reviewed positive uniform scale`);
  const source: SourceChannel[] = clip.listChannels().map(channel => {
    const node = channel.getTargetNode()!, path = channel.getTargetPath();
    if (!node || (path !== 'translation' && path !== 'rotation' && path !== 'scale')) throw new Error('Unsupported scorpion source channel');
    const sampler = channel.getSampler()!, start = sample(sampler, 0), input = Array.from(sampler.getInput()!.getArray()!, Number);
    const initialSpan = input.find(time => time > 0) ?? seconds;
    return { channel, node, path: path as BakedTrack['path'], start, initialSpan, initialNext: sampler.getInterpolation() === 'STEP' ? start : sample(sampler, initialSpan) };
  });
  const specs = nodes.filter(node => node.getName()).flatMap(node => (['translation', 'rotation', 'scale'] as const).map(path => ({ node, path })));
  const rawTimes = Array.from({ length: SAMPLE_INTERVALS + 1 }, (_, i) => seconds * i / SAMPLE_INTERVALS);
  for (const leg of legs) for (const phase of [leg.phaseOffset, fract(leg.phaseOffset + DUTY)]) {
    rawTimes.push(phase * seconds);
    for (let i = -8; i <= 8; i++) rawTimes.push(fract(phase + i / (SAMPLE_INTERVALS * 2)) * seconds);
  }
  for (const row of source) rawTimes.push(...Array.from(row.channel.getSampler()!.getInput()!.getArray()!, Number));
  const times = [...new Set(rawTimes.map(time => Math.fround(Math.max(0, Math.min(seconds, time)))))].sort((a, b) => a - b);
  const poses: number[][][] = [];
  let minimumTipSeparation = Infinity;
  try {
    for (const time of times) {
      const phase = time === times.at(-1) ? 0 : time / seconds;
      restorePose(rest); closedSource(source, time, seconds); restorePose(legRest);
      const actualTips: Vector3[] = [];
      for (const leg of legs) {
        const localPhase = fract(phase - leg.phaseOffset), path = cyclicFootPath(localPhase, DUTY, seconds, NATIVE_MPS, .018);
        // Rear heels are nearly coplanar with their toes in the source bind pose.
        // A small ankle pitch gives them an actual raised heel during toe contact.
        const swing = path.contact ? 0 : (localPhase - DUTY) / (1 - DUTY), pitch = (leg.type === 'BackLeg' ? -.06 : 0) + (leg.type === 'FrontLeg' || leg.type === 'MidFrontLeg' ? .16 : -.16) * Math.sin(Math.PI * swing) ** 2;
        const turn = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch), orientation = turn.clone().multiply(leg.distalQ);
        const target = leg.center.clone().add(new Vector3(0, path.y, path.z));
        const endTarget = target.clone().sub(leg.distalOffset.clone().applyQuaternion(turn));
        let error = Infinity;
        for (let iteration = 0; iteration < 6; iteration++) {
          const hip = worldPosition(leg.upper), distance = hip.distanceTo(endTarget);
          const extension = leg.l1 + leg.l2 - distance, fold = distance - Math.abs(leg.l1 - leg.l2);
          if (extension < .0005 || fold < .0005) throw new Error(`Scorpion ${leg.side}/${leg.type} unreachable phase ${phase}: extension=${extension}, fold=${fold}`);
          solveTwoBone(leg.upper, leg.lower, leg.distal, endTarget, hip.clone().addScaledVector(leg.pole, .1));
          setWorldQuaternion(leg.distal, orientation);
          const actual = skin.point(leg.primary), correction = target.clone().sub(actual);
          error = correction.length();
          leg.minimumExtension = Math.min(leg.minimumExtension, extension); leg.minimumFold = Math.min(leg.minimumFold, fold);
          if (error < 1e-8) break;
          endTarget.add(correction);
        }
        if (error > 1e-6) throw new Error(`Scorpion physical pad did not converge: ${leg.side}/${leg.type} ${error}`);
        const soleTargets = leg.vertices.map(index => skin.restPoints[index]!.clone().sub(leg.pad).applyQuaternion(turn).add(target));
        const beforeFit = leg.chain.slice(0, 5).map(node => new Quaternion().fromArray(node.getRotation()));
        const fitted = fitPhysicalSole(leg.chain, skin.points, leg.vertices, soleTargets);
        // The weighted multi-point fit is overdetermined. Restore the physical tip
        // constraint after fitting the heel so residual least-squares error cannot
        // lower the toe during release or leave it hovering throughout stance.
        const fittedDistalQ = worldQuaternion(leg.distal);
        for (let iteration = 0; iteration < 6; iteration++) {
          const correction = target.clone().sub(skin.point(leg.primary));
          if (correction.length() < 1e-8) break;
          const hip = worldPosition(leg.upper);
          solveTwoBone(leg.upper, leg.lower, leg.distal, worldPosition(leg.distal).add(correction), hip.clone().addScaledVector(leg.pole, .1));
          setWorldQuaternion(leg.distal, fittedDistalQ);
        }
        const totalCorrection = Math.max(...leg.chain.slice(0, 5).map((node, i) => beforeFit[i]!.angleTo(new Quaternion().fromArray(node.getRotation()))));
        if (totalCorrection > .65) throw new Error(`Scorpion final sole correction exceeds anatomical limit ${totalCorrection}`);
        fitted.correction = totalCorrection;
        fitted.error = Math.max(...skin.points(leg.vertices).map((point, index) => point.distanceTo(soleTargets[index]!)));
        error = skin.point(leg.primary).distanceTo(target);
        if (error > 1e-6) throw new Error(`Scorpion final physical pad did not converge: ${leg.side}/${leg.type} ${error}`);
        leg.maximumSoleError = Math.max(leg.maximumSoleError, fitted.error);
        leg.maximumSoleCorrection = Math.max(leg.maximumSoleCorrection, fitted.correction);
        leg.maximumTipError = Math.max(leg.maximumTipError, error); actualTips.push(skin.point(leg.primary));
      }
      for (let i = 0; i < actualTips.length; i++) for (let j = 0; j < i; j++) minimumTipSeparation = Math.min(minimumTipSeparation, actualTips[i]!.distanceTo(actualTips[j]!));
      poses.push(specs.map(({ node, path }) => path === 'rotation' ? node.getRotation() : path === 'translation' ? node.getTranslation() : node.getScale()));
    }
    const tracks = captureTracks(specs, times, poses).map(track => {
      const width = track.path === 'rotation' ? 4 : 3, first = track.values.slice(0, width);
      if (track.path === 'rotation') for (let i = 4; i < track.values.length; i += 4) if (track.values.slice(i, i + 4).reduce((sum, value, k) => sum + value * track.values[i - 4 + k]!, 0) < 0) for (let k = 0; k < 4; k++) track.values[i + k] = -track.values[i + k]!;
      for (let i = 0; i < width; i++) track.values[track.values.length - width + i] = first[i]!;
      if (track.values.every((value, i) => Math.abs(value - first[i % width]!) < 1e-12)) return { ...track, times: [0, seconds], values: [...first, ...first] };
      return track;
    });
    return { name: 'Run', seconds, nativeMps: NATIVE_MPS, tracks, feet: legs.map(leg => ({ name: `${leg.side}_${leg.type}`, vertices: leg.vertices, primaryVertices: [leg.primary], phaseOffset: leg.phaseOffset, duty: DUTY, clearance: CLEARANCE })),
      notes: ['Eight legs follow a travelling phase wave with at least four supports. Every designated stance pad has identical -Z travel at 0.31 m/s.', 'Hip/Knee1 solve to Knee2; the distal chain keeps world orientation in stance and flexes in swing. A damped whole-sole rotation fit followed by a physical-tip constraint includes the original blended weights. Rear ankles have 0.06 radians of heel lift.', 'Source body, pedipalp, claw and sting motion remains, with a smooth closing tangent. All other animation clips and source geometry are unchanged.', 'Runtime acceleration, root turning and animation blending require production lab review.'],
      diagnostics: { samples: times.length, minimumTipSeparationM: minimumTipSeparation, feet: legs.map(leg => ({ name: `${leg.side}_${leg.type}`, chain: leg.chain.map(node => node.getName()), primary: leg.primary, center: leg.center.toArray(), plantedSweepM: NATIVE_MPS * seconds * DUTY, minimumExtensionM: leg.minimumExtension, minimumFoldM: leg.minimumFold, maximumPhysicalPadSolveErrorM: leg.maximumTipError, maximumSoleFitErrorM: leg.maximumSoleError, maximumSoleCorrectionRad: leg.maximumSoleCorrection })) } };
  } finally { restorePose(rest); }
}
