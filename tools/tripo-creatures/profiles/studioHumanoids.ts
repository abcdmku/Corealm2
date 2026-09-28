import type { Animation, Document, Node } from '@gltf-transform/core';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { addChannel, applyClip, duration, restorePose, storedPose } from '../../creature-motion/pose.js';
import { deformedBounds } from '../../creature-motion/validate-deformation.js';
import type { CreatureRepairContext, CreatureRepairResult } from '../repairProfile.js';
import { repairStudioSkeleton, studioSkeletonIds } from './studio-skeleton.js';

const duplicateTimeIds = [
  'creature_goblin_scout', 'creature_goblin_archer', 'creature_goblin_shaman', 'creature_zombie',
  'creature_skeleton_soldier', 'creature_skeleton_archer', 'creature_grave_ghoul', 'creature_wraith',
  'creature_iron_golem', 'creature_skeleton_mage', 'creature_plague_zombie', 'creature_chalk_warden',
  'creature_grave_lantern', 'creature_cairn_treader', 'creature_scree_watcher', 'creature_boss_mossbound',
  'creature_gloam_wraith', 'creature_chainbound_archon', 'creature_ivory_castellan',
  'creature_moonpetal_stalker', 'creature_ashbound_votary_elite', 'creature_skeleton_archer_elite',
  'creature_skeleton_mage_elite', 'creature_skeleton_soldier_elite', 'creature_cave_roach',
] as const;
const floorClips: Record<string, readonly string[]> = {
  bandit_forest_ranger: ['Attack', 'Death'], bandit_highland_ranger: ['Death'], bandit_quarry_ranger: ['Death'],
  creature_cairn_treader: ['Death'], creature_gloam_wraith: ['Death'],
  creature_chalk_warden: ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'],
};
// These native clips need only the runner's removal of retired directional hits.
const canonicalHitIds = [
  'creature_basalt_maw', 'creature_cinder_ravager', 'creature_furnace_grazer',
  'creature_gorge_mantis', 'creature_troll_mauler', 'creature_wild_goblin',
];
export const studioHumanoidIds = [...new Set([...duplicateTimeIds, ...Object.keys(floorClips), ...canonicalHitIds])];

/** Work on serialized float32 times, the precision actually consumed by glTF players. */
export function normalizeStudioTimes(doc: Document) {
  const repairs: { clip: string; node: string; path: string; removed: number; maximumDuplicateDifference: number }[] = [];
  const groundRebakes = new Map<Animation, Node>();
  for (const clip of doc.getRoot().listAnimations()) for (const channel of clip.listChannels()) {
    const sampler = channel.getSampler()!, input = sampler.getInput()!, output = sampler.getOutput()!;
    const originalTimes = input.getArray()!, originalValues = output.getArray()!;
    if (!originalTimes.some((time, i) => i > 0 && Math.fround(time) <= Math.fround(originalTimes[i - 1]!))) continue;
    if (sampler.getInterpolation() === 'CUBICSPLINE') throw new Error('Cubic duplicate-time repair requires tangent-specific review');
    const width = output.getElementSize(), times: number[] = [], values: number[] = [];
    let removed = 0, maximumDuplicateDifference = 0;
    for (let i = 0; i < originalTimes.length; i++) {
      const time = Math.fround(originalTimes[i]!);
      if (times.length && time < times[times.length - 1]!) throw new Error('Reversed studio key times');
      if (time === times[times.length - 1]) {
        const delta = Math.hypot(...Array.from({ length: width }, (_, axis) => originalValues[i * width + axis]! - values[values.length - width + axis]!));
        maximumDuplicateDifference = Math.max(maximumDuplicateDifference, delta); removed++;
        if (delta > 1e-5) {
          const node = channel.getTargetNode()!;
          const knownGround = /^(SkeletonGround|beetle_source_ground)$/.test(node.getName())
            || (node.getName() === 'root' && clip.getName() === 'Attack' && delta < .0001);
          if (channel.getTargetPath() !== 'translation' || !knownGround || time !== Math.fround(originalTimes[originalTimes.length - 1]!)) {
            throw new Error(`${clip.getName()}/${node.getName()}: ambiguous unequal duplicate keys`);
          }
          // This is the old ground baker's terminal action reset. Re-evaluate the held
          // articulated pose without that channel below, rather than choosing either value.
          groundRebakes.set(clip, node);
        }
        continue;
      }
      times.push(time); values.push(...Array.from(originalValues.slice(i * width, (i + 1) * width)));
    }
    const buffer = doc.getRoot().listBuffers()[0]!;
    sampler.setInput(doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer));
    sampler.setOutput(doc.createAccessor().setType(output.getType()).setArray(new Float32Array(values)).setBuffer(buffer));
    repairs.push({ clip: clip.getName(), node: channel.getTargetNode()!.getName(), path: channel.getTargetPath()!, removed, maximumDuplicateDifference });
  }
  return { repairs, groundRebakes };
}

/** Recompute only a ground translation against the original articulated clip. */
export function rebakeStudioGround(doc: Document, clip: Animation, node: Node, floor = .003) {
  const rest = storedPose(doc), base = [...node.getTranslation()] as [number, number, number];
  for (const channel of [...clip.listChannels()]) if (channel.getTargetNode() === node && channel.getTargetPath() === 'translation') channel.dispose();
  const seconds = duration(clip), count = Math.ceil(seconds * 120);
  const times = [...new Set([0, seconds, ...Array.from({ length: count + 1 }, (_, i) => seconds * i / count),
    ...clip.listSamplers().flatMap(sampler => Array.from(sampler.getInput()!.getArray()!))].map(Math.fround))].sort((a, b) => a - b);
  const values: number[] = []; let maximumLift = 0;
  try {
    for (const time of times) {
      restorePose(rest); applyClip(clip, time); node.setTranslation(base);
      const lift = Math.max(0, floor - deformedBounds(doc).min[1]!);
      maximumLift = Math.max(maximumLift, lift);
      const parentWorld = node.getParentNode() ? new Matrix4().fromArray(node.getParentNode()!.getWorldMatrix()) : new Matrix4();
      const local = new Vector3(...base).applyMatrix4(parentWorld); local.y += lift;
      values.push(...local.applyMatrix4(parentWorld.invert()).toArray());
    }
  } finally { restorePose(rest); }
  addChannel(doc, clip, node, 'translation', times, values);
  return { clip: clip.getName(), node: node.getName(), samples: times.length, maximumLift, floor };
}

function holdTerminalPose(doc: Document, clip: Animation, seconds = .25) {
  const end = duration(clip), heldEnd = Math.fround(end + seconds), buffer = doc.getRoot().listBuffers()[0]!;
  for (const sampler of clip.listSamplers()) {
    const input = sampler.getInput()!, output = sampler.getOutput()!, times = Array.from(input.getArray()!), values = Array.from(output.getArray()!);
    const width = output.getElementSize();
    if (sampler.getInterpolation() === 'CUBICSPLINE') throw new Error('Cubic terminal hold is not supported');
    times.push(heldEnd); values.push(...values.slice(-width));
    sampler.setInput(doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer));
    sampler.setOutput(doc.createAccessor().setType(output.getType()).setArray(new Float32Array(values)).setBuffer(buffer));
  }
}

/** Preserve each authored string axis, while removing its antipodal roll ambiguity. */
function planarBowstrings(doc: Document): number {
  let changed = 0;
  for (const clip of doc.getRoot().listAnimations()) {
    const nockChannel = clip.listChannels().find(channel => channel.getTargetNode()!.getName() === 'NockedArrow' && channel.getTargetPath() === 'translation');
    if (!nockChannel) throw new Error('Archer clip has no authored nock translation');
    const sampler = nockChannel.getSampler()!, input = sampler.getInput()!.getArray()!, output = sampler.getOutput()!;
    if (sampler.getInterpolation() !== 'LINEAR') throw new Error('Bowstring planar repair requires linear nock keys');
    const seconds = duration(clip), count = Math.ceil(seconds * 240);
    const times = [...new Set([...Array.from(input), ...Array.from({ length: count + 1 }, (_, i) => Math.fround(seconds * i / count))])].sort((a, b) => a - b);
    for (const name of ['BowStringLower', 'BowStringUpper']) {
      const node = doc.getRoot().listNodes().find(node => node.getName() === name)!;
      const anchor = new Vector3(0, name.endsWith('Lower') ? -.52 : .52, -.08);
      const translations: number[] = [], rotations: number[] = [], scales: number[] = [];
      let right = 1;
      for (const time of times) {
        while (right < input.length - 1 && input[right]! < time) right++;
        const left = Math.max(0, right - 1), fraction = Math.max(0, Math.min(1, (time - input[left]!) / (input[right]! - input[left]!)));
        const nock = new Vector3().fromArray(output.getElement(left, [])).lerp(new Vector3().fromArray(output.getElement(right, [])), fraction);
        if (Math.abs(nock.x) > 1e-5) throw new Error('Bowstring nock leaves its verified bend plane');
        const delta = anchor.clone().sub(nock);
        translations.push(...anchor.clone().add(nock).multiplyScalar(.5).toArray());
        rotations.push(...new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.atan2(delta.z, delta.y)).toArray());
        scales.push(1, delta.length(), 1);
      }
      for (const channel of [...clip.listChannels()]) if (channel.getTargetNode() === node) channel.dispose();
      addChannel(doc, clip, node, 'translation', times, translations);
      addChannel(doc, clip, node, 'rotation', times, rotations);
      addChannel(doc, clip, node, 'scale', times, scales);
      changed += 3;
    }
  }
  return changed;
}

export async function repairStudioHumanoid(doc: Document, context: CreatureRepairContext): Promise<CreatureRepairResult> {
  let shapeCorrection: { node: string; previous: number[]; intended: number[] } | undefined;
  if (context.assetId === 'creature_chalk_warden') {
    const wrapper = doc.getRoot().listNodes().find(node => node.getName() === 'chalk_warden_whole_body');
    const expected = [.29, .738, 1.017], intended: [number, number, number] = [1.16, .82, 1.13];
    if (!wrapper || wrapper.getScale().some((value, axis) => Math.abs(value - expected[axis]!) > 1e-5)) {
      throw new Error('Chalk Warden no longer has the verified distorted wrapper');
    }
    shapeCorrection = { node: wrapper.getName(), previous: [...wrapper.getScale()], intended };
    wrapper.setScale(intended);
  }
  const bowstringChannels = /^(?:creature_skeleton_archer|creature_skeleton_archer_elite)$/.test(context.assetId) ? planarBowstrings(doc) : 0;
  const { repairs, groundRebakes } = normalizeStudioTimes(doc), groundReports = [];
  for (const [clip, node] of groundRebakes) {
    groundReports.push(rebakeStudioGround(doc, clip, node));
    if (clip.getName() === 'Death') holdTerminalPose(doc, clip);
  }
  const selected = floorClips[context.assetId];
  if (selected) {
    const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]!;
    const ground = doc.createNode('studio_contact_correction');
    for (const child of [...scene.listChildren()]) { scene.removeChild(child); ground.addChild(child); }
    scene.addChild(ground);
    for (const clip of doc.getRoot().listAnimations()) {
      if (selected.includes(clip.getName())) groundReports.push(rebakeStudioGround(doc, clip, ground));
      else addChannel(doc, clip, ground, 'translation', [0, duration(clip)], [0, 0, 0, 0, 0, 0]);
    }
  }
  const skeleton = studioSkeletonIds.includes(context.assetId) ? await repairStudioSkeleton(doc, context) : undefined;
  return {
    changes: [
      ...(shapeCorrection ? ['Removed the later world-axis compression from Chalk Warden; retained its original authored proportions and native body curves.'] : []),
      ...(bowstringChannels ? ['Preserved bowstring bend axes with continuous planar rotations, preventing the lower string from leaving the bow plane during release.'] : []),
      ...(repairs.length ? [`Removed duplicate float32 sample times in ${repairs.length} channels; unequal final ground keys recomputed from the held pose.`] : []),
      ...(groundReports.length ? ['Rebaked affected ground translations from full skinned geometry, preserving joint articulation and unaffected motion.'] : []),
      ...(skeleton?.changes ?? []),
    ],
    warnings: ['Requires devdocs review of each affected state.'],
    provenance: { timelineRepairs: repairs, groundRepairs: groundReports, bowstringChannels, shapeCorrection,
      ...(skeleton ? { skeletonDeath: skeleton.provenance } : {}),
      preserved: ['geometry', 'skin weights', 'inverse binds', 'materials', skeleton ? 'non-Death body joint animation curves' : 'body joint animation curves'] },
    ...(skeleton?.motion ? { motion: skeleton.motion } : {}),
  };
}
