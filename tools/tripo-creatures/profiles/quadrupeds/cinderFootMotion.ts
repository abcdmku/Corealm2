import type { Animation, Document } from '@gltf-transform/core';
import { Quaternion, Vector3 } from 'three';
import { createSkinReader, setWorldPosition, setWorldQuaternion, solveTwoBone, worldPosition, worldQuaternion } from '../../../lib/ground-gait.js';
import { addChannel, applyClip, duration, removeClip, restorePose, storedPose } from '../../../creature-motion/pose.js';

/** Fit native foot trajectories to the short rear legs and long forearms. */
export function fitCinderFootMotion(doc: Document, donor: Document, mapping: Record<string, string>) {
  const requireNode = (document: Document, name: string) => {
    const found = document.getRoot().listNodes().filter(node => node.getName() === name);
    if (found.length !== 1) throw new Error(`Expected one Cinder motion node ${name}`);
    return found[0]!;
  };
  const requireClip = (document: Document, name: string) => {
    const found = document.getRoot().listAnimations().filter(clip => clip.getName() === name);
    if (found.length !== 1) throw new Error(`Expected one Cinder motion clip ${name}`);
    return found[0]!;
  };
  const original = storedPose(doc), sourcePose = storedPose(donor);
  const pelvis = requireNode(doc, 'Pelvis'), ground = requireNode(doc, 'corealm_retarget_ground');
  const sourceRoot = requireNode(donor, mapping.Pelvis!);
  const mesh = doc.getRoot().listNodes().find(node => node.getSkin() && node.getMesh());
  if (!mesh) throw new Error('Cinder foot motion requires a skinned mesh');
  const skin = createSkinReader(doc, mesh.getName()), all = Array.from({ length: skin.count }, (_, index) => index);
  const floor = .003, bodyPitchRadians = -35 * Math.PI / 180, bodyDropMetres = -.30;
  // A common horizontal scale keeps the planted feet at one travel speed. The
  // fitted bounds reject both rear overextension and the forearms' minimum radius.
  const horizontalTrajectoryScale = .6, verticalTrajectoryScale = 1.8;
  const limbs = ['FrontLeft', 'FrontRight', 'HindLeft', 'HindRight'].map(name => {
    const upper = requireNode(doc, name + 'Upper'), lower = requireNode(doc, name + 'Lower'), end = requireNode(doc, name + 'Foot');
    if (lower.getParentNode() !== upper || end.getParentNode() !== lower) throw new Error(`Cinder requires the fitted two-segment chain ${name}`);
    const anchor = worldPosition(end), primary = all.filter(index => skin.influences(index).some(influence => influence.node === end && influence.weight > .5));
    if (primary.length < 10) throw new Error(`Cinder has no physical sole patch for ${name}`);
    const restFloor = Math.min(...skin.points(primary).map(point => point.y));
    const branch = all.filter(index => skin.influences(index).reduce((sum, influence) =>
      sum + ([upper, lower, end].includes(influence.node) ? influence.weight : 0), 0) > .5);
    return { name, upper, lower, end, anchor, primary, branch, clearance: anchor.y - restFloor,
      source: requireNode(donor, mapping[name + 'Foot']!), sourceBaseline: new Vector3(),
      upperLength: worldPosition(upper).distanceTo(worldPosition(lower)), lowerLength: worldPosition(lower).distanceTo(anchor) };
  });
  const minimumY = (indices: number[]) => Math.min(...skin.points(indices).map(point => point.y));
  // This includes the rear hip and shoulder transition surfaces, which have
  // mixed weights. Distal leg and tail vertices cannot raise the body path.
  const bodyNames = new Set(['Pelvis', 'Spine', 'Chest', 'Neck', 'Head', 'Muzzle']);
  const body = all.filter(index => skin.influences(index).reduce((sum, influence) =>
    sum + (bodyNames.has(influence.node.getName()) ? influence.weight : 0), 0) > .5);
  const smooth = (value: number) => { value = Math.max(0, Math.min(1, value)); return value * value * (3 - 2 * value); };
  const witness = () => ({
    landmarks: ['Pelvis', 'Chest', 'Head', 'Muzzle'].map(name => ({ name, position: worldPosition(requireNode(doc, name)).toArray() })),
    soles: limbs.map(limb => ({ name: limb.name, position: skin.points(limb.primary).sort((a, b) => a.y - b.y)[0]!.toArray() })),
  });
  const idle = requireClip(doc, 'Idle'), sourceIdle = requireClip(donor, 'Idle');
  restorePose(original); applyClip(idle, duration(idle) * .35);
  const before = witness(), reference = storedPose(doc);
  // Keep the observed native Idle knee plane. Using each moving source knee as
  // the pole crosses a straight-leg singularity on this differently sized rig.
  const referenceRotations = new Map(reference.map(row => [row.node, row.r]));
  restorePose(sourcePose); applyClip(sourceIdle, duration(sourceIdle) * .35);
  limbs.forEach(limb => limb.sourceBaseline.copy(worldPosition(limb.source)));
  const sourceTravel = new Map(donor.getRoot().listAnimations().map(clip => {
    restorePose(sourcePose); applyClip(clip, 0); const start = worldPosition(sourceRoot);
    restorePose(sourcePose); applyClip(clip, duration(clip));
    return [clip.getName(), worldPosition(sourceRoot).sub(start).setY(0)];
  }));
  const nativeAt = (clip: Animation, time: number) => {
    restorePose(original); applyClip(clip, time); ground.setTranslation([0, 0, 0]);
  };
  const goalsAt = (name: string, time: number) => {
    const clip = requireClip(donor, name), seconds = duration(clip), phase = Math.min(1, time / seconds);
    restorePose(sourcePose); applyClip(clip, Math.min(time, seconds));
    return limbs.map(limb => {
      const displacement = worldPosition(limb.source).sub(limb.sourceBaseline);
      if (['Idle', 'Walk', 'Run'].includes(name)) displacement.addScaledVector(sourceTravel.get(name)!, -phase);
      const lift = Math.max(0, displacement.y - .0005) * verticalTrajectoryScale;
      return new Vector3(limb.anchor.x + displacement.x * horizontalTrajectoryScale,
        floor + limb.clearance + lift, limb.anchor.z + displacement.z * horizontalTrajectoryScale);
    });
  };
  const solve = (goals: Vector3[]) => {
    const origin = worldPosition(pelvis), rotation = worldQuaternion(pelvis), footRotations = limbs.map(limb => worldQuaternion(limb.end));
    for (const limb of limbs) {
      limb.upper.setRotation(referenceRotations.get(limb.upper)!); limb.lower.setRotation(referenceRotations.get(limb.lower)!);
    }
    setWorldQuaternion(pelvis, new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), bodyPitchRadians).multiply(rotation));
    setWorldPosition(pelvis, origin.add(new Vector3(0, bodyDropMetres, 0)));
    let maximumGoalError = 0, minimumExtensionMargin = Infinity, maximumSoleError = 0;
    for (let index = 0; index < limbs.length; index++) {
      const limb = limbs[index]!, hip = worldPosition(limb.upper), knee = worldPosition(limb.lower), end = worldPosition(limb.end);
      const axis = end.clone().sub(hip).normalize(), pole = knee.clone().sub(hip);
      pole.addScaledVector(axis, -pole.dot(axis));
      if (pole.lengthSq() < 1e-10) throw new Error(`Cinder has a degenerate measured knee plane for ${limb.name}`);
      pole.normalize();
      const goal = goals[index]!.clone(), soleY = goal.y - limb.clearance;
      for (let iteration = 0; iteration < 4; iteration++) {
        const result = solveTwoBone(limb.upper, limb.lower, limb.end, goal, hip.clone().add(pole));
        setWorldQuaternion(limb.end, footRotations[index]!);
        maximumGoalError = Math.max(maximumGoalError, result.error);
        minimumExtensionMargin = Math.min(minimumExtensionMargin, result.extensionMargin);
        const correction = soleY - minimumY(limb.primary);
        if (Math.abs(correction) < .00005) break;
        goal.y += correction;
      }
      maximumSoleError = Math.max(maximumSoleError, Math.abs(minimumY(limb.primary) - soleY));
    }
    const meshFloor = minimumY(all);
    if (maximumGoalError > .00001 || maximumSoleError > .0002 || meshFloor < .0025) {
      throw new Error(`Cinder stance no longer fits: goal error ${maximumGoalError}, sole error ${maximumSoleError}, mesh floor ${meshFloor}`);
    }
    return { maximumGoalError, minimumExtensionMargin, maximumSoleError, meshFloor };
  };
  const states = [];
  try {
    const death = requireClip(doc, 'Death'), deathBoundary = duration(requireClip(donor, 'Death')) * .2;
    nativeAt(death, 0); const nativeDeathStart = storedPose(doc); solve(goalsAt('Death', 0));
    const deathBias = nativeDeathStart.filter(row => row.node !== ground).map(row => ({ node: row.node,
      translation: new Vector3().fromArray(row.node.getTranslation()).sub(new Vector3().fromArray(row.t)),
      rotation: new Quaternion().fromArray(row.r).invert().multiply(new Quaternion().fromArray(row.node.getRotation())) }));
    const fitDeathContact = () => {
      const requestedPelvis = worldPosition(pelvis);
      const bodyLift = Math.max(0, floor - minimumY(body));
      setWorldPosition(pelvis, requestedPelvis.clone().add(new Vector3(0, bodyLift, 0)));
      let maximumFoldRadians = 0;
      for (const limb of limbs) {
        const hip = worldPosition(limb.upper);
        // A rolling shoulder can put the forearm below its endpoint. Fold the
        // complete branch out of the floor without changing either bone length.
        const upperWorld = worldQuaternion(limb.upper);
        const radial = skin.points(limb.branch).reduce((sum, point) => sum.add(point), new Vector3())
          .multiplyScalar(1 / limb.branch.length).sub(hip).setY(0).normalize();
        const foldAxis = radial.cross(new Vector3(0, 1, 0)).normalize();
        const applyFold = (angle: number) => {
          setWorldQuaternion(limb.upper, new Quaternion().setFromAxisAngle(foldAxis, angle).multiply(upperWorld));
          return minimumY(limb.branch);
        };
        let bestFloor = minimumY(limb.branch), bestAngle = 0;
        if (bestFloor < floor - .00002) for (let degrees = 2; degrees <= 120; degrees += 2) {
          const angle = degrees * Math.PI / 180, value = applyFold(angle);
          if (value > bestFloor) { bestFloor = value; bestAngle = angle; }
          if (value >= floor) {
            let low = angle - 2 * Math.PI / 180, high = angle;
            for (let iteration = 0; iteration < 9; iteration++) {
              const middle = (low + high) / 2;
              if (applyFold(middle) >= floor) high = middle; else low = middle;
            }
            bestAngle = high; break;
          }
        }
        applyFold(bestAngle); maximumFoldRadians = Math.max(maximumFoldRadians, bestAngle);
      }
      // Joint blending can move the shared hip surface slightly. Correct from
      // that surface only; a low toe must never add a whole-body lift.
      const attachmentLift = Math.max(0, floor - minimumY(body));
      setWorldPosition(pelvis, worldPosition(pelvis).add(new Vector3(0, attachmentLift, 0)));
      return { requestedPelvis: requestedPelvis.toArray(), pelvis: worldPosition(pelvis).toArray(), bodyLift: bodyLift + attachmentLift,
        maximumFoldRadians, bodyFloor: minimumY(body), meshFloor: minimumY(all) };
    };
    for (const clip of [...doc.getRoot().listAnimations()]) {
      const name = clip.getName(), sourceSeconds = duration(requireClip(donor, name));
      const input = clip.listChannels().find(channel => channel.getTargetNode() === pelvis && channel.getTargetPath() === 'rotation')!.getSampler()!.getInput()!;
      const baseTimes = Array.from(input.getArray()!);
      // The early transition needs denser floor samples. All channels retain the
      // same time grid, including the ground track consumed by tail settlement.
      const times = name === 'Death' ? [...new Set([...baseTimes, deathBoundary, ...baseTimes.flatMap((time, index) => {
        if (time >= deathBoundary || index === baseTimes.length - 1) return [];
        const end = Math.min(deathBoundary, baseTimes[index + 1]!);
        return Array.from({ length: 15 }, (_, index) => time + (end - time) * (index + 1) / 16);
      })])].sort((a, b) => a - b) : baseTimes;
      const active = new Set(clip.listChannels().map(channel => channel.getTargetNode()!));
      const tracks = original.filter(row => active.has(row.node)).map(row => ({ node: row.node,
        translation: [] as number[], rotation: [] as number[], scale: [] as number[] }));
      const samples: ReturnType<typeof solve>[] = [];
      const deathSamples: ({ time: number } & ReturnType<typeof fitDeathContact>)[] = [];
      for (const time of times) {
        const phase = Math.min(1, time / sourceSeconds);
        if (name === 'Death') {
          nativeAt(clip, time); const amount = 1 - smooth(phase / .2);
          for (const bias of deathBias) {
            // Retain the corrected start plus the already-scaled native root
            // displacement. Fading this translation added a spurious 30 cm hop.
            bias.node.setTranslation(new Vector3().fromArray(bias.node.getTranslation()).addScaledVector(bias.translation, bias.node === pelvis ? 1 : amount).toArray());
            bias.node.setRotation(new Quaternion().fromArray(bias.node.getRotation()).multiply(new Quaternion().slerp(bias.rotation, amount)).normalize().toArray());
          }
          deathSamples.push({ time, ...fitDeathContact() });
        } else {
          nativeAt(clip, time); samples.push(solve(goalsAt(name, time)));
        }
        for (const track of tracks) {
          track.translation.push(...track.node.getTranslation()); track.rotation.push(...track.node.getRotation()); track.scale.push(...track.node.getScale());
        }
      }
      if (['Idle', 'Walk', 'Run'].includes(name)) for (const track of tracks) {
        track.translation.splice(track.translation.length - 3, 3, ...track.translation.slice(0, 3));
        track.rotation.splice(track.rotation.length - 4, 4, ...track.rotation.slice(0, 4));
        track.scale.splice(track.scale.length - 3, 3, ...track.scale.slice(0, 3));
      }
      removeClip(doc, name); const output = doc.createAnimation(name);
      for (const track of tracks) for (const path of ['translation', 'rotation', 'scale'] as const) addChannel(doc, output, track.node, path, times, track[path]);
      states.push(name === 'Death' ? { state: name, samples: times.length, nativeTorsoRotationPreservedFromSeconds: deathBoundary, contacts: deathSamples }
        : { state: name, samples: times.length, maximumGoalError: Math.max(...samples.map(sample => sample.maximumGoalError)),
          maximumSoleError: Math.max(...samples.map(sample => sample.maximumSoleError)), minimumExtensionMargin: Math.min(...samples.map(sample => sample.minimumExtensionMargin)),
          meshFloor: Math.min(...samples.map(sample => sample.meshFloor)) });
    }
    restorePose(original); const outputIdle = requireClip(doc, 'Idle'); applyClip(outputIdle, duration(outputIdle) * .35);
    return { bodyPitchRadians, bodyDropMetres, horizontalTrajectoryScale, verticalTrajectoryScale, before, after: witness(), states,
      chains: limbs.map(limb => ({ name: limb.name, upperLength: limb.upperLength, lowerLength: limb.lowerLength, anchor: limb.anchor.toArray(), soleVertices: limb.primary.length })),
      method: 'Anchor native foot trajectories to the target stance, fit body height and pitch to actual reach limits, and solve each two-segment leg through its measured native Idle knee plane. Preserve native foot world orientation and body/head micro-motion. During Death retain the corrected pelvis start plus native displacement, release the stance rotation over the first fifth, and accommodate leg contact without distal-foot whole-body lifting.' };
  } finally { restorePose(original); restorePose(sourcePose); }
}
