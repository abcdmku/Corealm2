import type { Document, Node } from '@gltf-transform/core';
import { Quaternion, Vector3 } from 'three';
import { duration, restorePose, storedPose } from './pose.js';
import { captureTracks, createSkinReader, cyclicFootPath, fract, setWorldPosition, setWorldQuaternion, solveTwoBone, worldPosition, worldQuaternion, type BakedGait } from '../lib/ground-gait.js';

/** Offline unguligrade hoof contact, retaining source anatomy and native stride speed. */
export function authorCaprineGait(doc: Document, id: string, name: 'Walk' | 'Run', nativeMps: number, floorY: number): BakedGait {
  if (!['animal_goat', 'animal_ibex'].includes(id)) throw new Error('Only reviewed caprine rigs are supported');
  if (!(nativeMps > 0) || !Number.isFinite(nativeMps) || !Number.isFinite(floorY)) throw new Error('Invalid caprine gait parameters');
  const prefix = id === 'animal_goat' ? 'Goat' : 'Ibex', mesh = id === 'animal_goat' ? 'goat_mesh' : 'buk26';
  const clip = doc.getRoot().listAnimations().find(c => c.getName() === name);
  if (!clip) throw new Error('Missing source gait');
  const seconds = duration(clip), original = storedPose(doc), skin = createSkinReader(doc, mesh);
  const bone = (suffix: string): Node => { const nodes = doc.getRoot().listNodes().filter(n => n.getName() === `${prefix}_${suffix}SHJnt`); if (nodes.length !== 1) throw new Error(`Missing ${suffix}`); return nodes[0]!; };
  const root = bone('ROOT'), rootPosition = worldPosition(root), duty = name === 'Walk' ? .58 : .26, pitch = .12;
  try {
    const legs = ['l_FrontLeg', 'r_FrontLeg', 'l_HindLeg', 'r_HindLeg'].map((part, i) => {
      const hip = bone(`${part}_Hip`), knee = bone(`${part}_Knee1`), fetlock = bone(`${part}_Knee2`), ankle = bone(`${part}_Ankle`);
      if (knee.getParentNode() !== hip || fetlock.getParentNode() !== knee || ankle.getParentNode() !== fetlock) throw new Error(`Unexpected ${part} hierarchy`);
      const a = worldPosition(hip), b = worldPosition(knee), c = worldPosition(fetlock), axis = c.clone().sub(a).normalize(), pole = b.clone().sub(a);
      pole.addScaledVector(axis, -pole.dot(axis)).normalize();
      const ankleQ = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch).multiply(worldQuaternion(ankle));
      setWorldQuaternion(ankle, ankleQ);
      const descendants = new Set<Node>();
      const visit = (node: Node): void => { descendants.add(node); node.listChildren().forEach(visit); }; visit(fetlock);
      // Include every positive distal influence, including weights below 50%.
      const all = Array.from({ length: skin.count }, (_, j) => j).filter(j => skin.influences(j).some(w => descendants.has(w.node)));
      const points = skin.points(all), minimum = Math.min(...points.map(p => p.y));
      const vertices = all.filter((_, j) => points[j]!.y <= minimum + .02), primaryVertices = all.filter((_, j) => points[j]!.y <= minimum + .0003);
      if (!vertices.length || !primaryVertices.length) throw new Error(`Missing physical ${part} hoof`);
      const pad = skin.points(primaryVertices).reduce((sum, p) => sum.add(p), new Vector3()).multiplyScalar(1 / primaryVertices.length);
      const center = pad.clone(); center.y += floorY + .0005 - minimum; center.z += a.z - c.z;
      return { hip, knee, fetlock, ankle, ankleQ, fetlockQ: worldQuaternion(fetlock), pole, center, offset: pad.clone().sub(c), minimumReachMargin: Infinity,
        foot: { name: part, vertices, primaryVertices, phaseOffset: name === 'Walk' ? [0, .5, .75, .25][i]! : [0, .5, .5, 0][i]!, duty, clearance: .0005 } };
    });
    const specs = original.filter(p => p.node.getName()).flatMap(p => (['rotation', 'translation', 'scale'] as const).map(path => ({ node: p.node, path })));
    const count = 3840, times = Array.from({ length: count + 1 }, (_, i) => i / count * seconds), poses: number[][][] = [];
    for (let i = 0; i <= count; i++) {
      restorePose(original); const phase = i === count ? 0 : i / count;
      setWorldPosition(root, rootPosition.clone().add(new Vector3(0, -.12 + .005 * Math.cos(phase * Math.PI * 4), 0)));
      for (const leg of legs) {
        const localPhase = fract(phase - leg.foot.phaseOffset), path = cyclicFootPath(localPhase, duty, seconds, nativeMps, name === 'Walk' ? .075 : .11);
        if (!path.contact) {
          const u = (localPhase - duty) / (1 - duty), edge = .05, span = nativeMps * seconds * duty, v = nativeMps * seconds * (1 - duty), extra = v * edge / 2;
          const turn = (t: number) => t - t ** 3 / edge ** 2 + t ** 4 / (2 * edge ** 3);
          if (u < edge) path.z = -span / 2 - v * turn(u);
          else if (u > 1 - edge) path.z = span / 2 + v * turn(1 - u);
          else { const t = (u - edge) / (1 - 2 * edge), s = t ** 3 * (10 + t * (-15 + 6 * t)); path.z = (-span / 2 - extra) * (1 - 2 * s); }
        }
        const target = leg.center.clone().add(new Vector3(0, path.y, path.z)), endTarget = target.clone().sub(leg.offset);
        for (let iteration = 0; iteration < 6; iteration++) {
          const result = solveTwoBone(leg.hip, leg.knee, leg.fetlock, endTarget, worldPosition(leg.hip).add(leg.pole));
          if (result.error > .00001 || result.extensionMargin < .0005) throw new Error(`${id}/${name}/${leg.foot.name} unreachable phase ${phase}: ${JSON.stringify(result)}`);
          leg.minimumReachMargin = Math.min(leg.minimumReachMargin, result.extensionMargin);
          setWorldQuaternion(leg.fetlock, leg.fetlockQ); setWorldQuaternion(leg.ankle, leg.ankleQ);
          const actual = skin.points(leg.foot.primaryVertices).reduce((sum, p) => sum.add(p), new Vector3()).multiplyScalar(1 / leg.foot.primaryVertices.length);
          const correction = target.clone().sub(actual); if (correction.length() < 1e-8) break; endTarget.add(correction);
        }
      }
      poses.push(specs.map(({ node, path }) => [...(path === 'rotation' ? node.getRotation() : path === 'translation' ? node.getTranslation() : node.getScale())]));
    }
    const tracks = captureTracks(specs, times, poses).map(track => { const width = track.path === 'rotation' ? 4 : 3, first = track.values.slice(0, width); return track.values.every((v, i) => Math.abs(v - first[i % width]!) < 1e-12) ? { ...track, times: [0, seconds], values: [...first, ...first] } : track; });
    return { name, seconds, nativeMps, tracks, feet: legs.map(l => l.foot), notes: ['Hooves use a fixed 0.12rad forward pitch, with measured physical distal sole contact.', 'Hip/Knee1 articulation preserves original segment lengths. Source gait durations, native speeds and all nonlocomotion data remain unchanged.'], diagnostics: { count, hoofPitchRad: pitch, bodyCrouchM: .12, feet: legs.map(l => ({ name: l.foot.name, minimumReachMargin: l.minimumReachMargin })) } };
  } finally { restorePose(original); }
}
