/** Offline physical-paw authoring for the shipped rat and rabbit skeletons. */
import type { Document, Node } from '@gltf-transform/core';
import { Quaternion, Vector3 } from 'three';
import { storedPose, restorePose } from './pose.js';
import { captureTracks, createSkinReader, cyclicFootPath, fract, setWorldPosition, setWorldQuaternion, solveTwoBone, worldPosition, worldQuaternion, type BakedGait, type BakedTrack } from '../lib/ground-gait.js';

export function authorSmallMammalGait(doc: Document, id: string, name: 'Walk' | 'Run', seconds: number, floorY: number, nativeMps: number): BakedGait {
  if (!['animal_rat', 'animal_rabbit', 'animal_rabbit_dark'].includes(id) || !(seconds > 0) || !(nativeMps > 0) || ![seconds, floorY, nativeMps].every(Number.isFinite)) throw new Error('Invalid small mammal gait inputs');
  const rat = id === 'animal_rat', prefix = 'WildRabbit', mesh = rat ? 'rat_exp15' : 'wild_rabbit_test5';
  const nodes = doc.getRoot().listNodes(), rest = storedPose(doc), skin = createSkinReader(doc, mesh);
  const find = (name: string): Node => { const node = nodes.find(n => n.getName() === name); if (!node) throw new Error(`Missing ${name}`); return node; };
  const root = find(rat ? 'Bone001' : `${prefix}_ROOTSHJnt`), rootPosition = worldPosition(root);
  const duty = name === 'Walk' ? (rat ? .50 : .42) : .20, clearance = .0005, samples = 3840;
  const crouch = rat ? -.01 : name === 'Run' ? -.015 : -.03;
  const feet = ['l_FrontLeg', 'r_FrontLeg', 'l_HindLeg', 'r_HindLeg'].map((suffix, index) => {
    const rear = suffix.includes('Hind'), base = `${prefix}_${suffix}_`;
    const mirror = index % 2 === 0 ? '(mirrored)' : '';
    const upper = find(rat ? `Bone${rear ? '030' : '025'}${mirror}` : `${base}HipSHJnt`), lower = find(rat ? `Bone${rear ? '031' : '026'}${mirror}` : `${base}KneeSHJnt`), end = find(rat ? `Bone${rear ? '032' : '027'}${mirror}` : `${base}AnkleSHJnt`), ankle = find(rat ? `Bone${rear ? '033' : '028'}${mirror}` : `${base}AnkleSHJnt`);
    const a = worldPosition(upper), b = worldPosition(lower), c = worldPosition(end), line = c.clone().sub(a);
    const pole = b.clone().sub(a).addScaledVector(line, -b.clone().sub(a).dot(line) / line.lengthSq()).normalize();
    const branch = new Set<Node>();
    const visit = (node: Node): void => { branch.add(node); node.listChildren().forEach(visit); }; visit(ankle);
    const all = skin.restPoints.flatMap((_, i) => skin.influences(i).some(influence => branch.has(influence.node) && influence.weight > 0) ? [i] : []), minimum = Math.min(...all.map(i => skin.restPoints[i]!.y));
    const vertices = all.filter(i => skin.restPoints[i]!.y <= minimum + .005), primaryVertices = vertices.filter(i => skin.restPoints[i]!.y <= minimum + .0000001);
    if (!vertices.length || !primaryVertices.length) throw new Error('Missing physical paw');
    const center = c.clone(); center.y += floorY + clearance - minimum; center.z = a.z + (!rat && !rear && name === 'Run' ? -.025 : 0);
    const phaseOffset = name === 'Walk' ? [0, .5, .75, .25][index]! : [0, .06, .50, .56][index]!;
    const primaryCenter = primaryVertices.reduce((sum, i) => sum.add(skin.restPoints[i]!), new Vector3()).multiplyScalar(1 / primaryVertices.length).add(center.clone().sub(c));
    return { name: suffix, upper, lower, end, center, primaryCenter, pole, endQ: worldQuaternion(end), vertices, primaryVertices, phaseOffset, duty, clearance, minimumExtensionMargin: Infinity, maximumTargetError: 0 };
  });
  const specs: { node: Node; path: BakedTrack['path'] }[] = nodes.filter(n => n.getName()).flatMap(node => [{ node, path: 'translation' as const }, { node, path: 'rotation' as const }, { node, path: 'scale' as const }]);
  const times = Array.from({ length: samples + 1 }, (_, i) => seconds * i / samples), poses: number[][][] = [];
  try {
    for (let i = 0; i <= samples; i++) {
      const phase = i === samples ? 0 : i / samples; restorePose(rest);
      setWorldPosition(root, rootPosition.clone().add(new Vector3(0, crouch, 0)));
      if (rat) { const tail=find('Bone012'); setWorldQuaternion(tail, new Quaternion().setFromAxisAngle(new Vector3(1,0,0), .12).multiply(worldQuaternion(tail))); }
      for (const foot of feet) {
        const localPhase = fract(phase - foot.phaseOffset);
        const path = cyclicFootPath(localPhase, duty, seconds, nativeMps, rat ? .015 : foot.name.includes('Hind') ? .015 : .035);
        if (!path.contact) {
          const u = (localPhase - duty) / (1 - duty), edge = .05, span = nativeMps * seconds * duty, v = nativeMps * seconds * (1 - duty), extra = v * edge / 2;
          const turn = (t: number) => t - t ** 3 / edge ** 2 + t ** 4 / (2 * edge ** 3);
          if (u < edge) path.z = -span / 2 - v * turn(u);
          else if (u > 1 - edge) { const t = 1 - u; path.z = span / 2 + v * turn(t); }
          else { const t = (u - edge) / (1 - 2 * edge), s = t * t * t * (10 + t * (-15 + 6 * t)); path.z = (-span / 2 - extra) * (1 - 2 * s); }
        }
        const target = foot.center.clone().add(new Vector3(0, path.y, path.z)), hip = worldPosition(foot.upper);
        const desiredPrimary = foot.primaryCenter.clone().add(new Vector3(0, path.y, path.z));
        for (let iteration = 0; iteration < 4; iteration++) {
          const result = solveTwoBone(foot.upper, foot.lower, foot.end, target, hip.clone().add(foot.pole));
          if (result.extensionMargin < .0005 || result.error > .00001) throw new Error(`${id}/${name}/${foot.name} unreachable phase ${phase}: ${JSON.stringify(result)}`);
          setWorldQuaternion(foot.end, foot.endQ);
          foot.minimumExtensionMargin = Math.min(foot.minimumExtensionMargin, result.extensionMargin); foot.maximumTargetError = Math.max(foot.maximumTargetError, result.error);
          const actual = skin.points(foot.primaryVertices).reduce((sum, p) => sum.add(p), new Vector3()).multiplyScalar(1 / foot.primaryVertices.length);
          target.add(desiredPrimary.clone().sub(actual));
        }
      }
      const pose: number[][] = specs.map(s => s.path === 'rotation' ? s.node.getRotation() : s.path === 'translation' ? s.node.getTranslation() : s.node.getScale());
      if (poses.length) specs.forEach((spec, j) => { if (spec.path === 'rotation' && pose[j]!.reduce((sum, v, k) => sum + v * poses.at(-1)![j]![k]!, 0) < 0) pose[j] = pose[j]!.map(v => -v); });
      poses.push(pose);
    }
    const tracks = captureTracks(specs, times, poses).map(track => { const width = track.path === 'rotation' ? 4 : 3, first = track.values.slice(0, width); return track.values.every((v, i) => Math.abs(v - first[i % width]!) < 1e-12) ? { ...track, times: [0, seconds], values: [...first, ...first] } : track; });
    return { name, seconds, nativeMps, tracks, feet: feet.map(({ name, vertices, primaryVertices, phaseOffset, duty, clearance }) => ({ name, vertices, primaryVertices, phaseOffset, duty, clearance })), notes: ['Four-beat walk and paired fore/hind run using physical original weighted soles.', 'Source segment lengths, translations, scales, geometry and nonlocomotion samplers preserved. All gait poses authored as complete tracks.'], diagnostics: { samples, crouch, feet: feet.map(f => ({ name: f.name, minimumExtensionMargin: f.minimumExtensionMargin, maximumTargetError: f.maximumTargetError })) } };
  } finally { restorePose(rest); }
}












