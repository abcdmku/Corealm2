import type { Document, Node } from '@gltf-transform/core';
import { Matrix4, Vector3 } from 'three';
import type { CreatureRepairContext, CreatureRepairProfile, CreatureRepairResult } from '../repairProfile.js';
import { retargetCreatureMotion, type CreatureMotionProfile } from '../retarget.js';
import * as birds from './quadrupeds/birds.js';
import * as originalMammals from './quadrupeds/originalMammals.js';
import * as reptiles from './quadrupeds/reptiles.js';
import * as unusual from './quadrupeds/unusual.js';
import { repairGloamWeights } from './quadrupeds/foxWeights.js';
import { applyClip, duration, restorePose, storedPose } from '../../creature-motion/pose.js';
import { deformedBounds } from '../../creature-motion/validate-deformation.js';

const foxIds = ['creature_redbrush_fox', 'creature_gloam_fox'];
const world = (node: Node) => new Vector3().setFromMatrixPosition(new Matrix4().fromArray(node.getWorldMatrix()));

/** The custom fox rigs name their negative-X limbs L; the studio wolf uses r. */
export function foxMotionProfile(doc: Document, donor: Document): CreatureMotionProfile {
  const mapping: Record<string, string> = {
    Pelvis: 'Wolf_ROOTSHJnt', SpineMid: 'Wolf_Spine_02SHJnt', Chest: 'Wolf_Spine_TopSHJnt',
    Neck: 'Wolf_Neck_01SHJnt', Head: 'Wolf_Neck_TopSHJnt',
    TailBase: 'Wolf_Tail_01_01SHJnt', TailMid: 'Wolf_Tail_01_02SHJnt',
    TailEnd: 'Wolf_Tail_01_04SHJnt', TailTip: 'Wolf_Tail_01_05SHJnt',
  };
  const directionChildren: Record<string, string> = {};
  for (const [side, studioSide] of [['L', 'r'], ['R', 'l']]) {
    for (const [target, source] of [
      ['ForeUpper', 'FrontLeg_Hip'], ['ForeLower', 'FrontLeg_Knee'],
      ['ForeWrist', 'FrontLeg_Ankle'], ['ForePaw', 'FrontLeg_Ball'],
      ['HindUpper', 'HindLeg_Hip'], ['HindLower', 'HindLeg_Knee1'],
      ['HindHock', 'HindLeg_Knee2'], ['HindPaw', 'HindLeg_Ankle'],
    ]) mapping[`${target}_${side}`] = `Wolf_${studioSide}_${source}SHJnt`;
    for (const [parent, child] of [
      ['ForeUpper', 'ForeLower'], ['ForeLower', 'ForeWrist'], ['ForeWrist', 'ForePaw'],
      ['HindUpper', 'HindLower'], ['HindLower', 'HindHock'], ['HindHock', 'HindPaw'],
    ]) directionChildren[`${parent}_${side}`] = `${child}_${side}`;
  }
  const node = (document: Document, name: string) => {
    const found = document.getRoot().listNodes().filter(candidate => candidate.getName() === name);
    if (found.length !== 1) throw new Error(`Expected one ${name}, found ${found.length}`);
    return found[0]!;
  };
  const chainLength = (document: Document, names: string[]) => names.slice(1).reduce((sum, name, i) =>
    sum + world(node(document, name)).distanceTo(world(node(document, names[i]!))), 0);
  const targetLeg = chainLength(doc, ['ForeUpper_L', 'ForeLower_L', 'ForeWrist_L', 'ForePaw_L']);
  const sourceLeg = chainLength(donor, ['Wolf_r_FrontLeg_HipSHJnt', 'Wolf_r_FrontLeg_KneeSHJnt',
    'Wolf_r_FrontLeg_AnkleSHJnt', 'Wolf_r_FrontLeg_BallSHJnt']);
  return {
    mapping, directionChildren, sourceToTargetRotation: [0, 0, 0, 1],
    root: { target: 'Pelvis', source: 'Wolf_ROOTSHJnt', translationScale: targetLeg / sourceLeg, horizontal: 'in-place' },
    clips: { Idle: { source: 'Idle', loop: true }, Walk: { source: 'Walk', loop: true },
      Run: { source: 'Run', loop: true }, Attack: { source: 'Attack' }, Hit: { source: 'Hit' },
      Death: { source: 'Death', holdLastSeconds: 0.4 } },
    replaceAnimations: true, samplesPerSecond: 30,
    grounding: { floor: 0, maxCorrection: targetLeg * 0.9 },
  };
}

async function repairFox(doc: Document, context: CreatureRepairContext): Promise<CreatureRepairResult> {
  const weightRepair = context.assetId === 'creature_gloam_fox' ? repairGloamWeights(doc) : undefined;
  const donor = await context.readAsset('animal_coyote');
  const spec = foxMotionProfile(doc, donor);
  const report = retargetCreatureMotion(doc, donor, spec);
  const measurements = measureFoxMotion(doc);
  return {
    changes: ['Replaced six sparse procedural fox clips with anatomically mapped studio canine motion.',
      'Mapped limbs by measured side, retained the authored curved tail rest, and completed every state pose.',
      'Grounded the deformed feet and retained the complete held studio death sequence.',
      ...(weightRepair ? ['Repaired the connected tail and torso skin regions that crossed arbitrary anatomical weight cutoffs.'] : [])],
    provenance: { donorAssetId: 'animal_coyote', ...report, measurements, ...(weightRepair ? { weightRepair } : {}) },
    motion: { walkClipSeconds: report.clips.find(clip => clip.name === 'Walk')!.seconds,
      runClipSeconds: report.clips.find(clip => clip.name === 'Run')!.seconds,
      impliedWalkMps: measurements.walk.mps, impliedRunMps: measurements.run.mps,
      contactNormalized: measurements.contactNormalized,
      attackSeconds: report.clips.find(clip => clip.name === 'Attack')!.seconds, groundY: 0 },
  };
}

/** Use the repaired target's paw motion, rather than copying donor speeds across proportions. */
function measureFoxMotion(doc: Document) {
  const pose = storedPose(doc), root = doc.getRoot(), samples = 240;
  const feet = ['ForePaw_L', 'ForePaw_R', 'HindPaw_L', 'HindPaw_R'].map(name => {
    const node = root.listNodes().find(candidate => candidate.getName() === name);
    if (!node) throw new Error(`Missing fox sole ${name}`);
    return node;
  });
  const measure = (name: string) => {
    const clip = root.listAnimations().find(candidate => candidate.getName() === name)!;
    const seconds = duration(clip), points = feet.map(() => [] as Vector3[]);
    for (let frame = 0; frame <= samples; frame++) {
      restorePose(pose); applyClip(clip, frame * seconds / samples);
      feet.forEach((foot, index) => points[index]!.push(world(foot)));
    }
    const speeds: number[] = [];
    const contacts = points.map((track, index) => {
      const low = Math.min(...track.map(point => point.y)), high = Math.max(...track.map(point => point.y));
      const window = Math.max(.008, Math.min(.04, (high - low) * .12)), values: number[] = [];
      for (let frame = 1; frame < track.length; frame++) {
        const previous = track[frame - 1]!, point = track[frame]!;
        const speed = (previous.z - point.z) / (seconds / samples);
        if ((point.y + previous.y) * .5 <= low + window && speed > .05) values.push(speed);
      }
      values.sort((a, b) => a - b); speeds.push(...values);
      return { bone: feet[index]!.getName(), samples: values.length, stanceMps: values[Math.floor(values.length / 2)] ?? 0, heightWindowM: window };
    });
    if (contacts.some(contact => contact.samples < 3)) throw new Error(`Fox ${name} has no reliable stance interval on every paw`);
    speeds.sort((a, b) => a - b);
    return { mps: speeds[Math.floor(speeds.length / 2)]!, contacts };
  };
  try {
    const walk = measure('Walk'), run = measure('Run');
    const attack = root.listAnimations().find(clip => clip.getName() === 'Attack')!, seconds = duration(attack);
    let farthest = -Infinity, contactNormalized = 0;
    for (let frame = 0; frame <= samples; frame++) {
      restorePose(pose); applyClip(attack, frame * seconds / samples);
      const forward = deformedBounds(doc).max[2]!;
      if (forward > farthest) { farthest = forward; contactNormalized = frame / samples; }
    }
    return { walk, run, contactNormalized, contactSeconds: seconds * contactNormalized,
      method: 'Median backward sole-joint speed in the lowest 12% of each paw arc, sampled at 240 phases; attack contact is the maximum deformed muzzle reach along verified +Z.' };
  } finally { restorePose(pose); }
}

export const profile: CreatureRepairProfile = {
  id: 'quadrupeds', assetIds: [...foxIds, ...birds.assetIds, ...originalMammals.assetIds, ...reptiles.assetIds, ...unusual.assetIds],
  async repair(doc, context) {
    if (foxIds.includes(context.assetId)) return repairFox(doc, context);
    if ((birds.assetIds as readonly string[]).includes(context.assetId)) return birds.repair(doc, context);
    if ((originalMammals.assetIds as readonly string[]).includes(context.assetId)) return originalMammals.repair(doc, context);
    if ((reptiles.assetIds as readonly string[]).includes(context.assetId)) return reptiles.repair(doc, context);
    if ((unusual.assetIds as readonly string[]).includes(context.assetId)) return unusual.repair(doc, context);
    throw new Error(`Unsupported quadruped ${context.assetId}`);
  },
};
