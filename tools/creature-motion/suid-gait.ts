import type { Document, Node } from '@gltf-transform/core';
import { Quaternion, Vector3 } from 'three';
import { captureTracks, createSkinReader, cyclicFootPath, fract, setWorldPosition, setWorldQuaternion, solveTwoBone, worldPosition, worldQuaternion, type BakedGait } from '../lib/ground-gait.js';
import { duration, restorePose, storedPose } from './pose.js';

/** New suid leg cycles at the existing duration and native stride speed. */
export function authorSuidGait(doc: Document, id: string, name: 'Walk' | 'Run', nativeMps: number, floorY: number): BakedGait {
  if (!['animal_boar', 'animal_hog'].includes(id) || !(nativeMps > 0) || !Number.isFinite(nativeMps) || !Number.isFinite(floorY)) throw new Error('Invalid suid gait inputs');
  const hog = id === 'animal_hog';
  const rest = storedPose(doc), nodes = doc.getRoot().listNodes();
  const requireNode = (suffix: string): Node => { const found = nodes.filter(node => node.getName() === `WildBoar_${suffix}SHJnt`); if (found.length !== 1) throw new Error(`Missing suid ${suffix}`); return found[0]!; };
  const clip = doc.getRoot().listAnimations().find(clip => clip.getName() === name)!;
  const seconds = duration(clip), root = hog ? nodes.find(n => n.getName() === 'Bone001')! : requireNode('ROOT'), rootPosition = worldPosition(root), skin = createSkinReader(doc, hog ? 'miko34' : 'WildBoar_mesh');
  const duty = name === 'Walk' ? .50 : .38, crouch = hog ? .06 : name === 'Walk' ? .19 : .12;
  const legs = ['l_FrontLeg', 'r_FrontLeg', 'l_HindLeg', 'r_HindLeg'].map((prefix, index) => {
    const hogBase = index < 2 ? 23 : 29, mirror = index % 2 ? '(mirrored)' : '';
    const [a, b, end, ankle] = (hog
      ? [0, 1, 2, 3].map(offset => nodes.find(n => n.getName() === `Bone0${hogBase + offset}${mirror}`)!)
      : ['Hip', 'Knee1', 'Knee2', 'Ankle'].map(suffix => requireNode(`${prefix}_${suffix}`))) as [Node, Node, Node, Node];
    if (b.getParentNode() !== a || end.getParentNode() !== b || ankle.getParentNode() !== end) throw new Error(`Suid ${prefix} chain changed`);
    const start = worldPosition(a), knee = worldPosition(b), distal = worldPosition(end);
    const axis = distal.clone().sub(start).normalize(), pole = knee.clone().sub(start); pole.addScaledVector(axis, -pole.dot(axis)).normalize();
    // A threshold of .5 misses actual hog heel vertices split almost equally
    // between distal and ankle bones. Include every positive ankle influence.
    const ankleBranch = new Set<Node>();
    const collect = (node: Node): void => { ankleBranch.add(node); node.listChildren().forEach(collect); };
    collect(ankle);
    const all = Array.from({ length: skin.count }, (_, index) => index).filter(index => skin.influences(index).some(influence => ankleBranch.has(influence.node) && influence.weight > 0));
    const soleFloor = Math.min(...all.map(index => skin.restPoints[index]!.y));
    const vertices = all.filter(index => skin.restPoints[index]!.y <= soleFloor + .005), primary = vertices.find(index => skin.restPoints[index]!.y === soleFloor)!;
    const pad = skin.restPoints[primary]!, center = pad.clone(); center.y = floorY + .0005;
    center.z += start.z - distal.z;
    // The boar's heel includes Knee1 weights. A seven-degree toe support pose
    // clears that flexible heel while the toe's four distal influences stay rigid.
    const solePitch = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), hog ? 0 : .12);
    return { prefix, a, b, end, ankle, vertices, primary, center, offset: pad.clone().sub(distal).applyQuaternion(solePitch), distalQ: solePitch.clone().multiply(worldQuaternion(end)), ankleQ: solePitch.clone().multiply(worldQuaternion(ankle)), pole,
      l1: start.distanceTo(knee), l2: knee.distanceTo(distal), phaseOffset: name === 'Walk' ? [.25, .75, 0, .5][index]! : [0, .5, .5, 0][index]!, minimumReachMargin: Infinity };
  });
  const specs = nodes.filter(node => node.getName()).flatMap(node => (['translation', 'rotation', 'scale'] as const).map(path => ({ node, path })));
  const intervals = 3840, times = Array.from({ length: intervals + 1 }, (_, i) => seconds * i / intervals), poses: number[][][] = [];
  try {
    for (const time of times) {
      const phase = time === times.at(-1) ? 0 : time / seconds;
      restorePose(rest);
      const bounce = name === 'Walk' ? .008 * Math.cos(4 * Math.PI * phase) : .025 * Math.cos(4 * Math.PI * phase);
      setWorldPosition(root, rootPosition.clone().add(new Vector3(0, -crouch + bounce, 0)));
      for (const leg of legs) {
        const localPhase = fract(phase - leg.phaseOffset);
        const path = cyclicFootPath(localPhase, duty, seconds, nativeMps, name === 'Walk' ? .06 : .14);
        if (!path.contact) {
          const u = (localPhase - duty) / (1 - duty), edge = .05, span = nativeMps * seconds * duty, v = nativeMps * seconds * (1 - duty), extra = v * edge / 2;
          const turn = (t: number) => t - t ** 3 / edge ** 2 + t ** 4 / (2 * edge ** 3);
          if (u < edge) path.z = -span / 2 - v * turn(u);
          else if (u > 1 - edge) { const t = 1 - u; path.z = span / 2 + v * turn(t); }
          else { const t = (u - edge) / (1 - 2 * edge), s = t * t * t * (10 + t * (-15 + 6 * t)); path.z = (-span / 2 - extra) * (1 - 2 * s); }
        }
        const target = leg.center.clone().add(new Vector3(0, path.y, path.z)), endTarget = target.clone().sub(leg.offset);
        for (let i = 0; i < 6; i++) {
          const hip = worldPosition(leg.a), d = hip.distanceTo(endTarget), margin = leg.l1 + leg.l2 - d;
          if (margin < .0005 || d - Math.abs(leg.l1 - leg.l2) < .0005) throw new Error(`${name} ${leg.prefix} unreachable phase${phase}, margin${margin}`);
          leg.minimumReachMargin = Math.min(leg.minimumReachMargin, margin);
          solveTwoBone(leg.a, leg.b, leg.end, endTarget, hip.clone().add(leg.pole));
          setWorldQuaternion(leg.end, leg.distalQ); setWorldQuaternion(leg.ankle, leg.ankleQ);
          const correction = target.clone().sub(skin.point(leg.primary));
          if (correction.length() < 1e-8) break;
          endTarget.add(correction);
        }
        if (skin.point(leg.primary).distanceTo(target) > 1e-6) throw new Error('Suid physical pad did not converge');
      }
      poses.push(specs.map(({ node, path }) => path === 'rotation' ? node.getRotation() : path === 'translation' ? node.getTranslation() : node.getScale()));
    }
    const tracks = captureTracks(specs, times, poses).map(track => {
      const width = track.path === 'rotation' ? 4 : 3, first = track.values.slice(0, width);
      if (track.path === 'rotation') for (let i = 4; i < track.values.length; i += 4) if (track.values.slice(i, i + 4).reduce((sum, value, k) => sum + value * track.values[i - 4 + k]!, 0) < 0) for (let k = 0; k < 4; k++) track.values[i + k] = -track.values[i + k]!;
      if (track.values.every((value, i) => Math.abs(value - first[i % width]!) < 1e-12)) return { ...track, times: [0, seconds], values: [...first, ...first] };
      return track;
    });
    return { name, seconds, nativeMps, tracks, feet: legs.map(leg => ({ name: leg.prefix, vertices: leg.vertices, primaryVertices: [leg.primary], phaseOffset: leg.phaseOffset, duty, clearance: .0005 })),
      notes: ['Four-beat walk and diagonal trot where the original Run exists. Source geometry, joint lengths, clip duration and measured native speed preserved.', 'Body compression permits full existing stroke without stretching joints. Boar hooves use a .12-radian toe-down stance to clear flexible heels. All selected original sole vertices remain in the physical audit after serialization.'],
      diagnostics: { bodyCrouchM: crouch, feet: legs.map(leg => ({ name: leg.prefix, minimumReachMarginM: leg.minimumReachMargin })) } };
  } finally { restorePose(rest); }
}


