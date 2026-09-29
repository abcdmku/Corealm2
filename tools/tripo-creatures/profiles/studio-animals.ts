import type { Document, Node } from '@gltf-transform/core';
import { AnimationClip, Group, InterpolateDiscrete, InterpolateLinear, Matrix4, Quaternion,
  QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';
import { loadContactHelpers } from '../../calibrate-legacy-gait.js';
import { addChannel, applyClip, duration, removeClip, restorePose, storedPose } from '../../creature-motion/pose.js';
import { ASSETS as nativePackBodies, BODIES as nativePackTakes } from '../../animals/splice-native.js';
import { deformedBounds } from '../../creature-motion/validate-deformation.js';
import type { CreatureRepairContext, CreatureRepairResult } from '../repairProfile.js';
import { limitGroundCorrectionSpeed, sampleGroundSupport } from '../retarget.js';

// Animal pack deluxe bodies ship the studio's own takes, spliced by tools/animals/splice-native.ts;
// the states the pack never had (Hit everywhere, Run for hog/rat/snail, Attack for rabbit/rat/frog/
// snail) are omitted and the runtime falls back. Ambient fish keep their swim cycles. The two lava
// rigs still need new motion.
export const studioAnimalIds = [
  'animal_cattle', 'animal_chicken', 'animal_chicken_speckled', 'animal_coyote',
  'animal_deer', 'animal_frog', 'animal_goat', 'animal_hog', 'animal_rabbit', 'animal_rat', 'animal_viper',
  'creature_amethyst_dragon', 'creature_baby_black_dragon', 'creature_baby_lava_dragon',
  'creature_baby_red_dragon', 'creature_basalt_drake', 'creature_black_wilderness_dragon',
  'creature_crown_hart', 'creature_furnace_regent', 'creature_heath_jack', 'creature_kiln_marrow',
  'creature_kiln_salamander', 'creature_marchwild_horse', 'creature_purple_wilderness_dragon',
  'creature_quarry_snail', 'creature_red_wilderness_dragon', 'creature_red_worm',
  'creature_reedbank_goose', 'creature_reedjaw_crocodile', 'fairy_garden_drake_faeholme',
  'fairy_garden_drake_gloamgarden', 'fairy_garden_frog_faeholme', 'fairy_garden_frog_gloamgarden',
  'fairy_garden_hart_faeholme', 'fairy_garden_hart_gloamgarden', 'fairy_garden_snail_faeholme',
  'animal_aurochs', 'animal_bear', 'animal_boar', 'animal_frog_green', 'animal_ibex',
  'animal_rabbit_dark', 'animal_scorpion', 'boss_rhino_air', 'boss_rhino_earth', 'boss_rhino_water',
] as const;
const donorId = 'fantasy_monster_02';
const world = (node: Node) => new Matrix4().fromArray(node.getWorldMatrix());
const position = (node: Node) => new Vector3().setFromMatrixPosition(world(node));
const rotation = (node: Node) => {
  const value = new Quaternion();
  world(node).decompose(new Vector3(), value, new Vector3());
  return value.normalize();
};
const depth = (node: Node): number => node.getParentNode() ? depth(node.getParentNode()!) + 1 : 0;
/** A Blender action can be the serialized default. Skin inverse binds supply the actual rest. */
function bindPose(doc: Document): void {
  const matrices = new Map<Node, Matrix4>();
  for (const mesh of doc.getRoot().listNodes()) {
    const skin = mesh.getSkin();
    if (!skin) continue;
    const inverse = skin.getInverseBindMatrices();
    if (!inverse) throw new Error('Studio donor has no inverse binds');
    const meshWorld = world(mesh);
    skin.listJoints().forEach((joint, index) => {
      const bind = meshWorld.clone().multiply(new Matrix4().fromArray(inverse.getElement(index, [])).invert());
      const previous = matrices.get(joint);
      if (previous && previous.elements.some((value, i) => Math.abs(value - bind.elements[i]!) > .0001)) {
        throw new Error(`Conflicting studio bind for ${joint.getName()}`);
      }
      matrices.set(joint, bind);
    });
  }
  for (const [joint, bind] of [...matrices].sort((a, b) => depth(a[0]) - depth(b[0]))) {
    const parent = joint.getParentNode();
    joint.setMatrix((parent ? (matrices.get(parent) ?? world(parent)).clone().invert().multiply(bind) : bind).toArray());
  }
}

function nodeMap(doc: Document) {
  return (name: string) => {
    const matches = doc.getRoot().listNodes().filter(node => node.getName() === name);
    if (matches.length !== 1) throw new Error(`Expected one studio joint ${name}, found ${matches.length}`);
    return matches[0]!;
  };
}

function setPosition(node: Node, point: Vector3) {
  const parent = node.getParentNode();
  node.setTranslation((parent ? point.clone().applyMatrix4(world(parent).invert()) : point).toArray());
}

function setRotation(node: Node, value: Quaternion) {
  const parent = node.getParentNode();
  node.setRotation((parent ? rotation(parent).invert().multiply(value) : value).normalize().toArray());
}

/** Canonical proxy contact measurement needs the animated node graph, not its textures or meshes. */
export function contactRig(doc: Document) {
  const root = new Group(), nodes = new Map(doc.getRoot().listNodes().map(node => {
    const object = new Group();
    object.name = node.getName(); object.position.fromArray(node.getTranslation());
    object.quaternion.fromArray(node.getRotation()); object.scale.fromArray(node.getScale());
    return [node, object] as const;
  }));
  for (const [node, object] of nodes) {
    const parent = node.getParentNode();
    (parent ? nodes.get(parent)! : root).add(object);
  }
  const clips = doc.getRoot().listAnimations().map(animation => new AnimationClip(animation.getName(), -1,
    animation.listChannels().map(channel => {
      const node = nodes.get(channel.getTargetNode()!)!, sampler = channel.getSampler()!;
      if (sampler.getInterpolation() === 'CUBICSPLINE') throw new Error('Lava contact proxy requires baked linear or STEP source tracks');
      const times = Float32Array.from(sampler.getInput()!.getArray()!), values = Float32Array.from(sampler.getOutput()!.getArray()!);
      const interpolation = sampler.getInterpolation() === 'STEP' ? InterpolateDiscrete : InterpolateLinear;
      const path = channel.getTargetPath();
      if (path === 'rotation') return new QuaternionKeyframeTrack(`${node.uuid}.quaternion`, times, values, interpolation);
      if (path !== 'translation' && path !== 'scale') throw new Error(`Unsupported lava contact channel ${path}`);
      return new VectorKeyframeTrack(`${node.uuid}.${path === 'translation' ? 'position' : 'scale'}`, times, values, interpolation);
    })));
  root.updateMatrixWorld(true);
  return { root, clips };
}

/**
 * The gavlig skeleton has heel and hand controllers beside the hips, rather than below
 * the shin and forearm. Reconstruct those endpoints after FK retargeting; simply copying
 * rotations leaves feet behind when the pelvis falls and tears the ankle geometry.
 * Native Idle, Walk and Smash/Attack are deliberately preserved, including their keys.
 */
export async function repairStudioAnimal(doc: Document, context: CreatureRepairContext): Promise<CreatureRepairResult> {
  if (!(studioAnimalIds as readonly string[]).includes(context.assetId)) throw new Error(`Unsupported studio animal ${context.assetId}`);
  if (!['creature_kiln_marrow', 'creature_furnace_regent'].includes(context.assetId)) {
    const result: CreatureRepairResult = {
      changes: [], provenance: { preservedNativeClips: doc.getRoot().listAnimations()
        .map(clip => clip.getName()).filter(name => !['HitLeft', 'HitRight'].includes(name)),
      geometryAndSkinWeightsUnchanged: true, normalizationOnly: true, requiresDevdocsReview: true },
    };
    if (doc.getRoot().listAnimations().some(clip => ['HitLeft', 'HitRight'].includes(clip.getName()))) {
      removeClip(doc, 'HitLeft'); removeClip(doc, 'HitRight');
      result.changes.push('Removed retired directional hit clips; retained the original Hit and all other native curves.');
    }
    const packBody = nativePackBodies[context.assetId];
    const requiredStates = packBody ? Object.keys(nativePackTakes[packBody]!.states)
      : ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];
    for (const name of requiredStates) {
      if (!doc.getRoot().listAnimations().some(clip => clip.getName() === name)) {
        throw new Error(`Studio animal ${context.assetId} has no canonical ${name}`);
      }
    }
    return result;
  }
  const donor = await context.readAsset(donorId), target = nodeMap(doc), source = nodeMap(donor);
  const original = storedPose(doc), donorOriginal = storedPose(donor);
  const idle = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Idle');
  const donorIdle = donor.getRoot().listAnimations().find(clip => clip.getName() === 'Idle');
  if (!idle || !donorIdle) throw new Error('Lava repair requires both native idle poses');
  applyClip(idle, 0);
  const baseline = storedPose(doc), targetHipStart = position(target('lava_src_52_hips'));
  const idleBounds = deformedBounds(doc), bodyHeight = idleBounds.max[1]! - idleBounds.min[1]!;
  applyClip(donorIdle, 0);
  const sourceHipStart = position(source('rootx'));
  restorePose(donorOriginal);
  restorePose(original);
  bindPose(doc);
  bindPose(donor);

  const mapping: Record<string, string> = {
    lava_src_52_hips: 'rootx', lava_src_47_spine: 'spine_01x', lava_src_46_ribs: 'spine_02x',
    lava_src_39_spine1: 'spine_03x', lava_src_45_neck: 'neckx', lava_src_44_head: 'headx',
  };
  const directions: Record<string, string> = {
    lava_src_52_hips: 'lava_src_47_spine', lava_src_47_spine: 'lava_src_46_ribs',
    lava_src_46_ribs: 'lava_src_39_spine1', lava_src_45_neck: 'lava_src_44_head',
  };
  const legs = [];
  for (const [side, suffix, indices] of [
    ['L', 'l', [38, 37, 36, 35, 51, 50, 66, 64, 65, 62]],
    ['R', 'r', [21, 20, 19, 18, 49, 48, 4, 2, 3, 57]],
  ] as const) {
    const names = ['shoulder', 'upper_arm', 'forearm', 'hand', 'thigh', 'shin', 'heel', 'foot', 'toe', 'IKhand']
      .map((name, index) => `lava_src_${indices[index]}_${name}_${side}`);
    const donors = ['shoulder', 'arm_stretch', 'forearm_stretch', 'hand', 'thigh_stretch', 'leg_stretch', 'foot', 'toes_01', 'toes_01'];
    names.slice(0, 9).forEach((name, index) => { mapping[name] = donors[index]! + suffix; });
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [4, 5], [5, 6], [6, 7]] as const) directions[names[a]!] = names[b]!;
    const shin = target(names[5]!), heel = target(names[6]!), hand = target(names[3]!), handControl = target(names[9]!);
    legs.push({ shin, heel, hand, handControl, ankle: position(heel).applyMatrix4(world(shin).invert()) });
  }
  const pairs = Object.entries(mapping).map(([name, from]) => {
    const node = target(name), donorNode = source(from), targetBind = rotation(node), sourceBind = rotation(donorNode);
    const child = directions[name];
    if (child) {
      const targetDirection = position(target(child)).sub(position(node));
      const donorDirection = position(source(mapping[child]!)).sub(position(donorNode));
      if (targetDirection.lengthSq() < 1e-10 || donorDirection.lengthSq() < 1e-10) throw new Error(`Invalid anatomical segment ${name}`);
      targetBind.premultiply(new Quaternion().setFromUnitVectors(targetDirection.normalize(), donorDirection.normalize()));
    }
    return { node, donorNode, offset: sourceBind.invert().multiply(targetBind) };
  }).sort((a, b) => depth(a.node) - depth(b.node));
  const legLength = (get: (name: string) => Node, names: string[]) => names.slice(1)
    .reduce((sum, name, index) => sum + position(get(name)).distanceTo(position(get(names[index]!))), 0);
  const scale = legLength(target, ['lava_src_51_thigh_L', 'lava_src_50_shin_L', 'lava_src_66_heel_L'])
    / legLength(source, ['thigh_stretchl', 'leg_stretchl', 'footl']);
  const targetFacing = position(target('lava_src_64_foot_L')).sub(position(target('lava_src_66_heel_L')));
  const donorFacing = position(source('toes_01l')).sub(position(source('footl')));
  if (!(targetFacing.z > 0 && donorFacing.z > 0
    && position(target('lava_src_51_thigh_L')).x > position(target('lava_src_49_thigh_R')).x
    && position(source('thigh_stretchl')).x > position(source('thigh_stretchr')).x)) {
    throw new Error('Studio lava retarget requires verified +Z facing and left-positive-X anatomy');
  }
  restorePose(original);
  restorePose(donorOriginal);

  // Monster02's native fall is a somersault. The heavy lava body instead uses
  // the grounded UAL collapse, calibrated against both native standing poses.
  // Keep Run and Hit on their accepted donor and exact previous mapping.
  const deathDonorId = 'animation_library_1';
  const deathDonor = await context.readAsset(deathDonorId), deathSource = nodeMap(deathDonor);
  const deathOriginal = storedPose(deathDonor);
  bindPose(deathDonor);
  const deathIdle = deathDonor.getRoot().listAnimations().find(clip => clip.getName() === 'Idle_Loop');
  if (!deathIdle) throw new Error('Lava grounded Death requires the UAL native standing reference');
  applyClip(deathIdle, 0); restorePose(baseline);
  const deathBaseline = storedPose(deathDonor), deathRoot = deathSource('pelvis'), deathHipStart = position(deathRoot);
  const deathMapping: Record<string, string> = {
    lava_src_52_hips: 'pelvis', lava_src_47_spine: 'spine_01', lava_src_46_ribs: 'spine_02',
    lava_src_39_spine1: 'spine_03', lava_src_45_neck: 'neck_01', lava_src_44_head: 'Head',
  };
  for (const [side, suffix, indices] of [
    ['L', 'l', [38, 37, 36, 35, 51, 50, 66, 64, 65]],
    ['R', 'r', [21, 20, 19, 18, 49, 48, 4, 2, 3]],
  ] as const) {
    const names = ['shoulder', 'upper_arm', 'forearm', 'hand', 'thigh', 'shin', 'heel', 'foot', 'toe'];
    const from = ['clavicle', 'upperarm', 'lowerarm', 'hand', 'thigh', 'calf', 'foot', 'ball', 'ball'];
    names.forEach((name, index) => { deathMapping[`lava_src_${indices[index]}_${name}_${side}`] = `${from[index]}_${suffix}`; });
  }
  const deathPairs = Object.entries(deathMapping).map(([name, from]) => {
    const node = target(name), donorNode = deathSource(from);
    return { node, donorNode, offset: rotation(donorNode).invert().multiply(rotation(node)) };
  }).sort((a, b) => depth(a.node) - depth(b.node));
  const deathScale = legLength(target, ['lava_src_51_thigh_L', 'lava_src_50_shin_L', 'lava_src_66_heel_L'])
    / legLength(deathSource, ['thigh_l', 'calf_l', 'foot_l']);
  if (!(position(deathSource('thigh_l')).x > position(deathSource('thigh_r')).x
    && position(deathSource('ball_l')).z > position(deathSource('foot_l')).z)) {
    throw new Error('Lava grounded Death requires verified +Z and left-positive-X UAL anatomy');
  }
  restorePose(original); restorePose(deathOriginal);

  const ground = target('lava_ground_motion'), groundParent = ground.getParentNode();
  const groundBaseline = new Map(baseline.map(pose => [pose.node, pose])).get(ground)!.t;
  const takes = [
    { name: 'Run', source: 'Run', seconds: 1.05, loop: true },
    { name: 'Hit', source: 'Hit', seconds: .78, loop: false },
    { name: 'Death', source: 'Death01', seconds: 2.4, loop: false },
  ];
  const reports = [];
  try {
    for (const take of takes) {
      const isDeath = take.name === 'Death', actionDonor = isDeath ? deathDonor : donor;
      const actionDonorId = isDeath ? deathDonorId : donorId, actionPose = isDeath ? deathBaseline : donorOriginal;
      const actionRoot = isDeath ? deathRoot : source('rootx'), actionStart = isDeath ? deathHipStart : sourceHipStart;
      const actionScale = isDeath ? deathScale : scale, actionPairs = isDeath ? deathPairs : pairs;
      const clip = actionDonor.getRoot().listAnimations().find(animation => animation.getName() === take.source);
      if (!clip) throw new Error(`Missing native ${actionDonorId}/${take.source}`);
      const sourceSeconds = duration(clip), steps = Math.ceil(take.seconds * 60);
      const times = Array.from({ length: steps + 1 }, (_, frame) => Math.fround(frame * take.seconds / steps));
      const tracks = new Map(baseline.map(pose => [pose.node, { t: [] as number[], r: [] as number[], s: [] as number[] }]));
      let maximumGroundCorrection = 0, maximumAnkleError = 0;
      const firstRoot = (() => { restorePose(actionPose); applyClip(clip, 0); return position(actionRoot); })();
      const endRoot = (() => { restorePose(actionPose); applyClip(clip, sourceSeconds); return position(actionRoot); })();
      for (let frame = 0; frame <= steps; frame++) {
        const phase = frame / steps;
        restorePose(actionPose); applyClip(clip, sourceSeconds * phase); restorePose(baseline);
        for (const pair of actionPairs) setRotation(pair.node, rotation(pair.donorNode).multiply(pair.offset));
        const offset = position(actionRoot).sub(actionStart).multiplyScalar(actionScale);
        if (take.loop) {
          const travel = firstRoot.clone().lerp(endRoot, phase).sub(actionStart).multiplyScalar(actionScale);
          offset.x -= travel.x; offset.z -= travel.z;
        }
        setPosition(target('lava_src_52_hips'), targetHipStart.clone().add(offset));
        for (const limb of legs) {
          const ankle = limb.ankle.clone().applyMatrix4(world(limb.shin));
          setPosition(limb.heel, ankle);
          maximumAnkleError = Math.max(maximumAnkleError, position(limb.heel).distanceTo(ankle));
          setPosition(limb.handControl, position(limb.hand));
          setRotation(limb.handControl, rotation(limb.hand));
        }
        const lift = .003 - deformedBounds(doc).min[1]!;
        maximumGroundCorrection = Math.max(maximumGroundCorrection, Math.abs(lift));
        const worldLift = new Vector3(0, lift, 0);
        if (groundParent) {
          const inverse = world(groundParent).invert();
          worldLift.applyMatrix4(inverse).sub(new Vector3().applyMatrix4(inverse));
        }
        ground.setTranslation(new Vector3().fromArray(groundBaseline).add(worldLift).toArray());
        for (const pose of baseline) {
          const values = tracks.get(pose.node)!;
          values.t.push(...pose.node.getTranslation()); values.r.push(...pose.node.getRotation()); values.s.push(...pose.node.getScale());
        }
      }
      if (take.loop) for (const values of tracks.values()) {
        values.t.splice(-3, 3, ...values.t.slice(0, 3)); values.r.splice(-4, 4, ...values.r.slice(0, 4));
        values.s.splice(-3, 3, ...values.s.slice(0, 3));
      }
      let groundingEnvelope: Record<string, number> | undefined;
      let groundTranslationTimes: number[] | undefined;
      if (take.name === 'Death') {
        // Quantize exactly as addChannel will serialize, then evaluate the final
        // interpolation with this support channel set to zero. Fast limbs can
        // dip below the floor between the retarget's original baked keys.
        for (const values of tracks.values()) {
          values.t = Array.from(Float32Array.from(values.t));
          values.r = Array.from(Float32Array.from(values.r));
          values.s = Array.from(Float32Array.from(values.s));
        }
        const previousSupport = tracks.get(ground)!.t;
        const parentWorld = groundParent ? world(groundParent) : new Matrix4();
        const asWorldLift = (values: number[], offset: number) => new Vector3().fromArray(values, offset)
          .applyMatrix4(parentWorld).sub(new Vector3().applyMatrix4(parentWorld)).y;
        const firstSupport = asWorldLift(previousSupport, 0), lastSupport = asWorldLift(previousSupport, previousSupport.length - 3);
        const qa = new Quaternion(), qb = new Quaternion();
        const sampled = sampleGroundSupport(times, time => {
          let right = 1;
          while (right < times.length - 1 && times[right]! < time) right++;
          const left = right - 1, alpha = Math.max(0, Math.min(1, (time - times[left]!) / (times[right]! - times[left]!)));
          for (const [node, values] of tracks) {
            const vector = (data: number[]) => [0, 1, 2].map(axis =>
              data[left * 3 + axis]! * (1 - alpha) + data[right * 3 + axis]! * alpha) as [number, number, number];
            node.setTranslation(node === ground ? [0, 0, 0] : vector(values.t));
            node.setScale(vector(values.s));
            node.setRotation(qa.fromArray(values.r, left * 4).slerp(qb.fromArray(values.r, right * 4), alpha).toArray());
          }
          return .003 - deformedBounds(doc).min[1]!;
        });
        // Retain the donor's pose sequence, slowing only intervals whose support
        // change exceeds the body's settling speed. An upper envelope alone
        // would lift the entire creature ahead of a changing hand/foot contact.
        const retimed = [0];
        for (let index = 1; index < sampled.times.length; index++) retimed.push(Math.fround(retimed[index - 1]! + Math.max(
          sampled.times[index]! - sampled.times[index - 1]!,
          Math.abs(sampled.required[index]! - sampled.required[index - 1]!) / bodyHeight * 1.001)));
        const deathTimeScale = retimed.at(-1)! / take.seconds;
        if (deathTimeScale > 1.8) throw new Error('Lava grounded Death needs excessive support retiming');
        for (const values of tracks.values()) {
          const t: number[] = [], r: number[] = [], s: number[] = [];
          for (const time of sampled.times) {
            let right = 1;
            while (right < times.length - 1 && times[right]! < time) right++;
            const left = right - 1, alpha = Math.max(0, Math.min(1, (time - times[left]!) / (times[right]! - times[left]!)));
            for (const [data, output] of [[values.t, t], [values.s, s]] as const) for (let axis = 0; axis < 3; axis++) {
              output.push(data[left * 3 + axis]! * (1 - alpha) + data[right * 3 + axis]! * alpha);
            }
            r.push(...qa.fromArray(values.r, left * 4).slerp(qb.fromArray(values.r, right * 4), alpha).toArray());
          }
          values.t = t; values.r = r; values.s = s;
        }
        times.splice(0, times.length, ...retimed);
        const limited = limitGroundCorrectionSpeed(retimed, sampled.required, bodyHeight);
        if (Math.abs(limited[0]! - firstSupport) > 1e-5
          || Math.abs(limited.at(-1)! - lastSupport) > 1e-5) {
          throw new Error('Lava Death floor envelope changes its initial or held corpse pose');
        }
        const groundValues: number[] = [];
        let maximumAddedLift = 0, maximumCorrectionSpeed = 0;
        for (let index = 0; index < sampled.times.length; index++) {
          const extra = limited[index]! - sampled.required[index]!;
          maximumAddedLift = Math.max(maximumAddedLift, extra);
          if (index) maximumCorrectionSpeed = Math.max(maximumCorrectionSpeed,
            Math.abs(limited[index]! - limited[index - 1]!) / (retimed[index]! - retimed[index - 1]!));
          const inverse = parentWorld.clone().invert();
          const localLift = new Vector3(0, limited[index]!, 0).applyMatrix4(inverse).sub(new Vector3().applyMatrix4(inverse));
          groundValues.push(...localLift.toArray());
        }
        tracks.get(ground)!.t = groundValues;
        groundTranslationTimes = [...retimed];
        groundingEnvelope = { bodyHeight, maxSpeedMps: bodyHeight, maximumCorrectionSpeed, maximumAddedLift,
          deathTimeScale,
          supportSamples: sampled.times.length, firstSupportDifference: limited[0]! - firstSupport,
          lastSupportDifference: limited.at(-1)! - lastSupport };
        times.push(Math.fround(times.at(-1)! + .45));
        groundTranslationTimes.push(times.at(-1)!);
        for (const values of tracks.values()) { values.t.push(...values.t.slice(-3)); values.r.push(...values.r.slice(-4)); values.s.push(...values.s.slice(-3)); }
      }
      removeClip(doc, take.name);
      const output = doc.createAnimation(take.name).setExtras({
        sourceAssetId: actionDonorId, sourceTake: take.source, studioLavaRepair: 1,
        method: isDeath ? 'Native standing-reference grounded collapse with FK ankle followers and interpolated floor contact'
          : 'Anatomical world-bind retarget, FK ankle followers for independent heel roots, complete pose and deformed floor contact',
      });
      for (const [node, values] of tracks) {
        addChannel(doc, output, node, 'translation', node === ground && groundTranslationTimes ? groundTranslationTimes : times, values.t);
        addChannel(doc, output, node, 'rotation', times, values.r);
        addChannel(doc, output, node, 'scale', times, values.s);
      }
      if (take.name === 'Death') {
        let minimumFloor = Infinity, maximumFloor = -Infinity;
        for (let frame = 0; frame <= 960; frame++) {
          restorePose(original); applyClip(output, duration(output) * frame / 960);
          const floor = deformedBounds(doc).min[1]!;
          minimumFloor = Math.min(minimumFloor, floor); maximumFloor = Math.max(maximumFloor, floor);
        }
        if (minimumFloor < 0) throw new Error(`Lava Death interpolated geometry penetrates the floor: ${minimumFloor}`);
        groundingEnvelope!.minimumFloor = minimumFloor;
        groundingEnvelope!.maximumFloor = maximumFloor;
      }
      reports.push({ name: take.name, sourceAssetId: actionDonorId, sourceTake: take.source, sourceSeconds, seconds: times.at(-1),
        maximumGroundCorrection, maximumAnkleError, groundingEnvelope,
        heldSeconds: take.name === 'Death' ? .45 : 0, samples: times.length });
    }
  } finally { restorePose(original); restorePose(donorOriginal); restorePose(deathOriginal); }
  removeClip(doc, 'HitLeft'); removeClip(doc, 'HitRight');
  // Reuse the importer's actual stance-velocity measurement. A new cadence must not
  // keep the old walk-as-run speed or an arbitrary guessed metres-per-second value.
  // Build TRS tracks directly: scoped tsImport can give the .mjs caller and glTF
  // transforms different module constructors, so cloneDocument is not safe here.
  const rig = contactRig(doc);
  const { measureContactGait } = await loadContactHelpers();
  const contacts = ['Walk', 'Run'].map(name => ({ name, measurement: measureContactGait(rig.root,
    rig.clips.find(clip => clip.name === name), { samples: 960, axis: 'z', direction: 1,
      groups: [['lava_src_64_foot_L', 'lava_src_65_toe_L'], ['lava_src_2_foot_R', 'lava_src_3_toe_R']] }) }));
  if (contacts.some(contact => !(contact.measurement.speedMps && contact.measurement.speedMps > 0))) {
    throw new Error(`Lava motion has no measurable backward foot contact: ${JSON.stringify(contacts.map(({ name, measurement }) => ({
      name, reason: measurement.reason, feet: measurement.feet,
      heights: measurement.contacts?.map(contact => ({ bone: contact.bone, minY: contact.minY, maxY: contact.maxY })),
    })))}; available=${JSON.stringify(rig.clips.map(clip => ({ name: clip.name, duration: clip.duration })))}`);
  }
  return {
    changes: ['Replaced frozen-body collapse and compressed-idle reactions with native studio biped sequences.',
      'Retargeted an actual running cycle and retained native gavlig Idle, Walk and Attack unchanged.',
      'Kept independent heel roots attached to shin endpoints, preserved skin weights and geometry, and held the final articulated corpse.'],
    provenance: { donorAssetId: donorId, groundedDeathDonor: `${deathDonorId}/Death01`,
      mappedJoints: pairs.length, translationScale: scale, deathTranslationScale: deathScale, clips: reports,
      contacts: contacts.map(({ name, measurement }) => ({ name, speedMps: measurement.speedMps, method: measurement.method, feet: measurement.feet })),
      preservedNativeClips: ['Idle', 'Walk', 'Attack'], geometryAndSkinWeightsUnchanged: true, requiresDevdocsReview: true },
    motion: { runClipSeconds: 1.05, impliedWalkMps: contacts[0]!.measurement.speedMps!,
      impliedRunMps: contacts[1]!.measurement.speedMps!, groundY: .003 },
  };
}
