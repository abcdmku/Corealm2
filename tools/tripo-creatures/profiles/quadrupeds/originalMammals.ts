import type { Document, Node } from '@gltf-transform/core';
import { Matrix4, Vector3 } from 'three';
import type { CreatureRepairContext, CreatureRepairResult } from '../../repairProfile.js';
import { applyClip, duration, restorePose, storedPose } from '../../../creature-motion/pose.js';
import { deformedBounds } from '../../../creature-motion/validate-deformation.js';

export const assetIds = [
  'creature_bracken_tapir',
  'creature_cairn_bighorn',
  'creature_duskoak_lynx',
  'creature_marsh_moose',
  'creature_quillback_porcupine',
] as const;

/** These are authored Corealm rigs. Their existing anatomy and IK takes are retained. */
export async function repair(doc: Document, context: CreatureRepairContext): Promise<CreatureRepairResult> {
  if (!(assetIds as readonly string[]).includes(context.assetId)) throw new Error(`Unsupported original mammal ${context.assetId}`);
  const root = doc.getRoot();
  const stateNames = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
  for (const name of stateNames) {
    const matches = root.listAnimations().filter(clip => clip.getName() === name);
    if (matches.length !== 1 || !(duration(matches[0]!) > 0)) throw new Error(`${context.assetId} requires one authored ${name} take`);
  }
  const provenance: Record<string, unknown> = {
    source: 'Corealm original anatomical rig and authored IK animation',
    preserved: ['geometry', 'weights', 'inverse binds', 'joint rotations', 'clip durations', 'locomotion'],
  };
  if (context.assetId !== 'creature_cairn_bighorn') {
    return {
      changes: [],
      warnings: ['The six authored runtime takes and their original rig are retained. Devdocs visual verdict is required.'],
      provenance,
    };
  }

  const clip = root.listAnimations().find(item => item.getName() === 'Death')!;
  const motionRoots = root.listNodes().filter(node => node.getName() === 'cairn_bighorn_Root');
  if (motionRoots.length !== 1) throw new Error('Bighorn requires one authored motion root');
  const motionRoot = motionRoots[0]!;
  const ancestorOf = (ancestor: Node, child: Node): boolean => child === ancestor || Boolean(child.getParentNode() && ancestorOf(ancestor, child.getParentNode()!));
  for (const node of root.listNodes().filter(node => node.getMesh())) {
    if (!node.getSkin() || node.getSkin()!.listJoints().some(joint => !ancestorOf(motionRoot, joint))) {
      throw new Error('Bighorn grounding requires every rendered vertex to follow the motion root');
    }
  }
  const channels = clip.listChannels().filter(channel => channel.getTargetNode() === motionRoot && channel.getTargetPath() === 'translation');
  if (channels.length !== 1) throw new Error('Bighorn Death requires one authored root translation channel');
  const sampler = channels[0]!.getSampler()!;
  if (sampler.getInterpolation() !== 'LINEAR') throw new Error('Bighorn root grounding requires linear source interpolation');
  const seconds = duration(clip), floor = context.entry.groundY ?? context.entry.base?.y ?? NaN;
  if (!Number.isFinite(floor)) throw new Error('Bighorn ground plane is not finite');
  const times = [...new Set([
    ...Array.from(sampler.getInput()!.getArray()!, Number),
    ...Array.from({ length: Math.ceil(seconds * 240) + 1 }, (_, frame) => frame * seconds / Math.ceil(seconds * 240)),
  ])].sort((a, b) => a - b);
  const pose = storedPose(doc), translations: number[] = [];
  let lowestBefore = Infinity, greatestLift = 0;
  try {
    for (const time of times) {
      restorePose(pose); applyClip(clip, time);
      const minimum = deformedBounds(doc).min[1]!;
      lowestBefore = Math.min(lowestBefore, minimum);
      const lift = Math.max(0, floor - minimum);
      if (lift > .09) throw new Error(`Bighorn Death requires an unexpected ground correction ${lift}`);
      greatestLift = Math.max(greatestLift, lift);
      const parent = motionRoot.getParentNode();
      const world = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(motionRoot.getWorldMatrix()));
      world.y += lift;
      if (parent) world.applyMatrix4(new Matrix4().fromArray(parent.getWorldMatrix()).invert());
      translations.push(...world.toArray());
    }
  } finally { restorePose(pose); }

  if (greatestLift <= .0005) {
    return { changes: [], warnings: ['Authored bighorn takes retained. Devdocs visual verdict is required.'], provenance };
  }
  // Give this channel fresh accessors so no other clip, sampler or state is changed.
  const buffer = root.listBuffers()[0]!;
  const oldInput = sampler.getInput()!, oldOutput = sampler.getOutput()!;
  sampler.setInput(doc.createAccessor('bighorn_death_ground_time').setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer));
  sampler.setOutput(doc.createAccessor('bighorn_death_ground_translation').setType('VEC3').setArray(new Float32Array(translations)).setBuffer(buffer));
  for (const accessor of [oldInput, oldOutput]) if (accessor.listParents().every(parent => parent.propertyType === 'Root')) accessor.dispose();

  provenance.deathGrounding = {
    reason: 'The current polished bighorn mesh penetrates the floor during the latter part of the authored collapse.',
    floor, lowestBefore, greatestLift, samples: times.length,
    method: 'Sample the complete weighted mesh and raise only the existing Death root translation by the measured penetration.',
  };
  return {
    changes: ['Corrected bighorn Death floor penetration while preserving the authored collapse, all joint rotations and every other take.'],
    warnings: ['Devdocs must review the corrected Death state and transitions before promotion.'],
    provenance,
  };
}
