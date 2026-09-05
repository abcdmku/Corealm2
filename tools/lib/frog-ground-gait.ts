/** Offline replacement frog creep and hop. Geometry, binds and static scales stay intact. */
import type { Document, Node } from '@gltf-transform/core';
import { Quaternion, Vector3 } from 'three';
import { storedPose, restorePose } from '../creature-motion/pose.js';
import { captureTracks, createSkinReader, cyclicFootPath, fract, setWorldPosition, setWorldQuaternion, solveTwoBone, worldPosition, worldQuaternion, type BakedGait, type BakedTrack } from './ground-gait.js';

const AXIS_X = new Vector3(1, 0, 0);
const FOOT_CLEARANCE = .0005;
const RUN_CROUCH = -.005;
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * t * (10 + t * (-15 + t * 6)); };
const definitions = [
  { name: 'frontNegativeX', branch: 'Bone014', upper: 'Bone014', lower: 'Bone015', distal: 'Bone016', palm: 'Bone017', rear: false, walkOffset: 0 },
  { name: 'frontPositiveX', branch: 'Bone014(mirrored)', upper: 'Bone014(mirrored)', lower: 'Bone015(mirrored)', distal: 'Bone016(mirrored)', palm: 'Bone017(mirrored)', rear: false, walkOffset: .5 },
  { name: 'rearNegativeX', branch: 'Bone010(mirrored)(mirrored)', upper: 'Bone010(mirrored)(mirrored)', lower: 'Bone011(mirrored)(mirrored)', distal: 'Bone012(mirrored)(mirrored)', palm: 'Bone013(mirrored)(mirrored)', rear: true, walkOffset: .75 },
  { name: 'rearPositiveX', branch: 'Bone010(mirrored)', upper: 'Bone010(mirrored)', lower: 'Bone011(mirrored)', distal: 'Bone012(mirrored)', palm: 'Bone013(mirrored)', rear: true, walkOffset: .25 },
];

function bodyOffset(name: 'Walk' | 'Run', phase: number): number {
  if (name === 'Walk') return -.004 + .0015 * Math.cos(4 * Math.PI * phase);
  // One smooth body arc, with compression before the hind push and after landing.
  // Forelimbs release at .96, hindlimbs at .22; forelimbs catch at .62, hinds at .80.
  if (phase <= .14 || phase >= .67) return RUN_CROUCH;
  return RUN_CROUCH + (.100 - RUN_CROUCH) * Math.sin(Math.PI * (phase - .14) / .53) ** 2;
}

function bake(doc: Document, name: 'Walk' | 'Run', seconds: number, floorY: number, nativeMps: number): BakedGait {
  if (!(seconds > 0) || !Number.isFinite(seconds) || !Number.isFinite(floorY) || !(nativeMps > 0) || !Number.isFinite(nativeMps)) throw new Error('Invalid frog gait duration/floor/speed');
  const samples = name === 'Run' ? 1920 : 960;
  const rest = storedPose(doc), nodes = doc.getRoot().listNodes();
  const find = (name: string): Node => { const node = nodes.find(node => node.getName() === name); if (!node) throw new Error(`Missing frog node ${name}`); return node; };
  const root = find('Bone002'), rootPosition = worldPosition(root), skin = createSkinReader(doc, 'lloop');
  const feet = definitions.map((definition, index) => {
    const upper = find(definition.upper), lower = find(definition.lower), distal = find(definition.distal), palm = find(definition.palm);
    const a = worldPosition(upper), b = worldPosition(lower), c = worldPosition(distal), palmPosition = worldPosition(palm);
    const line = c.clone().sub(a), poleDirection = b.clone().sub(a).addScaledVector(line, -b.clone().sub(a).dot(line) / line.lengthSq()).normalize();
    const vertices = skin.indicesForBranches([definition.branch], .003);
    if (vertices.length !== [50, 50, 40, 40][index]) throw new Error(`Unexpected frog sole membership ${definition.name}: ${vertices.length}`);
    const soleMinimum = Math.min(...vertices.map(vertex => skin.restPoints[vertex]!.y));
    // Distal and palm both retain their world orientation during stance, so the
    // lower-leg weighted wrist/heel vertices translate with the toe pads too.
    const primaryVertices = vertices.filter(vertex => skin.restPoints[vertex]!.y <= soleMinimum + .0015);
    const center = palmPosition.clone(); center.y += floorY + FOOT_CLEARANCE - soleMinimum;
    if (definition.rear) center.z -= name === 'Walk' ? .012 : .040;
    else center.z = a.z + palmPosition.z - c.z;
    return { ...definition, upper, lower, distal, palm, a, b, c, poleDirection, center, distalOffset: palmPosition.clone().sub(c), distalQ: worldQuaternion(distal), palmQ: worldQuaternion(palm),
      l1: a.distanceTo(b), l2: b.distanceTo(c), vertices, primaryVertices,
      phaseOffset: name === 'Walk' ? definition.walkOffset : definition.rear ? .80 : .62,
      duty: name === 'Walk' ? .80 : definition.rear ? .42 : .34,
      minimumExtensionMargin: Infinity, minimumFoldMargin: Infinity, maximumTargetError: 0 };
  });
  // Full pose tracks replace old locomotion channels. Holding controls and body
  // transforms at rest prevents old toe/body tracks leaking into the new solve.
  const specs: { node: Node; path: BakedTrack['path'] }[] = nodes.filter(node => node.getName()).flatMap(node => [
    { node, path: 'translation' as const }, { node, path: 'rotation' as const }, { node, path: 'scale' as const },
  ]);
  const times = Array.from({ length: samples + 1 }, (_, index) => seconds * index / samples);
  const poses: number[][][] = [];
  try {
    for (let index = 0; index <= samples; index++) {
      const phase = index === samples ? 0 : index / samples;
      restorePose(rest);
      const offset = bodyOffset(name, phase);
      setWorldPosition(root, rootPosition.clone().add(new Vector3(0, offset, 0)));
      for (const foot of feet) {
        const localPhase = fract(phase - foot.phaseOffset);
        const path = cyclicFootPath(localPhase, foot.duty, seconds, nativeMps, foot.rear ? .014 : .016);
        const swing = path.contact ? 0 : (localPhase - foot.duty) / (1 - foot.duty);
        const edgeFraction = .10;
        const envelope = path.contact ? 0 : smooth(swing / edgeFraction) * smooth((1 - swing) / edgeFraction);
        const wave = path.contact ? 0 : Math.sin(Math.PI * swing) ** 2;
        const pitch = (foot.rear ? .30 : -.18) * wave;
        const distalTurn = new Quaternion().setFromAxisAngle(AXIS_X, pitch);
        const palmTurn = new Quaternion().setFromAxisAngle(AXIS_X, -.20 * wave);
        const target = foot.center.clone(); target.z += path.z;
        target.y += name === 'Run' ? envelope * (offset - RUN_CROUCH + .025) : path.y;
        const ankle = target.clone().sub(foot.distalOffset.clone().applyQuaternion(distalTurn));
        const hip = worldPosition(foot.upper), requested = hip.distanceTo(ankle), minimum = Math.abs(foot.l1 - foot.l2), maximum = foot.l1 + foot.l2;
        const extensionMargin = maximum - requested, foldMargin = requested - minimum;
        if (extensionMargin < .0005 || foldMargin < .0005) throw new Error(`${name}/${nativeMps}/${foot.name} unreachable at ${phase}: distance=${requested}, allowed=${minimum}..${maximum}`);
        const pole = hip.clone().addScaledVector(foot.poleDirection, .1);
        const solved = solveTwoBone(foot.upper, foot.lower, foot.distal, ankle, pole);
        setWorldQuaternion(foot.distal, distalTurn.multiply(foot.distalQ));
        setWorldQuaternion(foot.palm, palmTurn.multiply(foot.palmQ));
        const error = worldPosition(foot.palm).distanceTo(target);
        if (solved.error > 1e-5 || error > 1e-5) throw new Error(`${name}/${foot.name} IK endpoint error ${solved.error}/${error}`);
        foot.minimumExtensionMargin = Math.min(foot.minimumExtensionMargin, extensionMargin);
        foot.minimumFoldMargin = Math.min(foot.minimumFoldMargin, foldMargin);
        foot.maximumTargetError = Math.max(foot.maximumTargetError, error);
      }
      const pose: number[][] = specs.map(spec => spec.path === 'rotation' ? spec.node.getRotation() : spec.path === 'translation' ? spec.node.getTranslation() : spec.node.getScale());
      if (poses.length) for (let track = 0; track < specs.length; track++) {
        if (specs[track]!.path !== 'rotation') continue;
        const current = pose[track]!, previous = poses.at(-1)![track]!;
        if (current.reduce((sum, value, i) => sum + value * previous[i]!, 0) < 0) pose[track] = current.map(value => -value);
      }
      poses.push(pose);
    }
    const tracks = captureTracks(specs, times, poses).map(track => {
      const width = track.path === 'rotation' ? 4 : 3;
      const first = track.values.slice(0, width);
      if (track.values.every((value, index) => Math.abs(value - first[index % width]!) < 1e-12)) return { ...track, times: [0, seconds], values: [...first, ...first] };
      return track;
    });
    return { name, seconds, nativeMps, tracks,
      feet: feet.map(foot => ({ name: foot.name, vertices: foot.vertices, primaryVertices: foot.primaryVertices, phaseOffset: foot.phaseOffset, duty: foot.duty, clearance: FOOT_CLEARANCE })),
      notes: ['Four-beat planted creep; Run uses simultaneous rear push, airborne body arc, forelimb landing and rear recovery.', 'All source geometry, bind matrices, hierarchy and local scales are unchanged. All gait channels are complete authored replacements.', 'Front14/15 and rear10/11 solve to the distal joint; distal forearm/metatarsus and palm orientations are fixed during stance, with smooth air flexion.', 'Physical wrist/heel vertices remain in the full sole sets. No positive-velocity filter and no hidden endpoint clamping.'],
      diagnostics: { samplesPerCycle: samples, nativeMps, bodyRoot: root.getName(), rootYOffsetRange: name === 'Walk' ? [-.0055, -.0025] : [RUN_CROUCH, .100], feet: feet.map(foot => ({ name: foot.name, chain: [foot.upper.getName(), foot.lower.getName(), foot.distal.getName(), foot.palm.getName()], center: foot.center.toArray(), plantedStrokeM: nativeMps * seconds * foot.duty, minimumExtensionMargin: foot.minimumExtensionMargin, minimumFoldMargin: foot.minimumFoldMargin, maximumTargetError: foot.maximumTargetError })) } };
  } finally { restorePose(rest); }
}

export function authorFrogGait(doc: Document, name: 'Walk' | 'Run', seconds: number, floorY: number): BakedGait {
  return bake(doc, name, seconds, floorY, name === 'Walk' ? .08 : .30);
}

/** Disposable source audit can compare speed candidates without changing the default. */
export function authorFrogGaitCandidate(doc: Document, name: 'Walk' | 'Run', seconds: number, floorY: number, nativeMps: number): BakedGait {
  return bake(doc, name, seconds, floorY, nativeMps);
}
