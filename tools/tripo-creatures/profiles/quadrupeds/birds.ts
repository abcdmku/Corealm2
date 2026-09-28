import type { Accessor, Document, Node } from '@gltf-transform/core';
import { Matrix4, Quaternion } from 'three';
import { addChannel, duration } from '../../../creature-motion/pose.js';
import type { CreatureRepairContext, CreatureRepairResult } from '../../repairProfile.js';
import { retargetCreatureMotion } from '../../retarget.js';

export const assetIds = [
  'creature_marchfield_turkey',
  'creature_scree_bustard',
  'creature_blackwater_heron',
] as const;

const declaredOrder = ['ROOT', 'Pelvis', 'Spine', 'Chest', 'Neck', 'Head', 'Beak', 'Tail', 'Wing_L', 'WingTip_L', 'Wing_R', 'WingTip_R', 'Thigh_L', 'Hock_L', 'Foot_L', 'Toe_L', 'RearToe_L', 'Thigh_R', 'Hock_R', 'Foot_R', 'Toe_R', 'RearToe_R'];
const skinOrder = ['ROOT', 'Pelvis', 'Spine', 'Chest', 'Neck', 'Head', 'Beak', 'Wing_L', 'WingTip_L', 'Wing_R', 'WingTip_R', 'Tail', 'Thigh_L', 'Hock_L', 'Foot_L', 'Toe_L', 'RearToe_L', 'Thigh_R', 'Hock_R', 'Foot_R', 'Toe_R', 'RearToe_R'];

/** These two builders wrote declaration-order indices against depth-first skin joints. */
function repairNativeBirdSkinIndices(doc: Document, assetId: string) {
  const skins = doc.getRoot().listSkins();
  if (skins.length !== 1) throw new Error(`${assetId}: expected one original native bird skin`);
  const skin = skins[0]!;
  const names = skin.listJoints().map(node => node.getName());
  const rootName = assetId === 'creature_marchfield_turkey' ? 'RyecrestRoot' : 'BustardRoot';
  if (names.length !== skinOrder.length || names.some((name, index) => name !== (index === 0 ? rootName : skinOrder[index]))) {
    throw new Error(`${assetId}: native bird skin order has changed`);
  }
  if (skin.getExtras().corealmSkinIndexRepair) throw new Error(`${assetId}: skin indices already repaired; rebuild from the source`);
  const remap = declaredOrder.map((name, index) => names.indexOf(index === 0 ? rootName : name));
  let changedInfluences = 0, changedVertices = 0;
  const seen = new Set<Accessor>();
  for (const node of doc.getRoot().listNodes()) if (node.getSkin() === skin) {
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const joints = primitive.getAttribute('JOINTS_0');
      if (!joints || seen.has(joints)) continue;
      seen.add(joints);
      const values = joints.getArray()!;
      for (let vertex = 0; vertex < values.length; vertex += 4) {
        let changed = false;
        for (let slot = 0; slot < 4; slot++) {
          const previous = Number(values[vertex + slot]), next = remap[previous];
          if (next === undefined || next < 0) throw new Error(`${assetId}: invalid native bird joint index`);
          if (next !== previous) { values[vertex + slot] = next; changedInfluences++; changed = true; }
        }
        if (changed) changedVertices++;
      }
    }
  }
  skin.setExtras({ ...skin.getExtras(), corealmSkinIndexRepair: 'native-groundbird-declaration-to-dfs-v1' });
  return { changedInfluences, changedVertices, declarationOrder: declaredOrder.map(name => name === 'ROOT' ? rootName : name), skinOrder: names, remap };
}

/**
 * The bustard's builder used hard y=.60 and z=-.31 region masks. Adjacent vertices
 * on one triangle therefore jumped between wing/chest and neck/head, or body/tail.
 * Diffuse those discontinuities along the actual surface, welding only coincident
 * UV/normal seam vertices. No vertex positions or disconnected limbs are blended.
 */
function smoothNativeBirdWeightSeams(doc: Document, assetId: string) {
  const turkey = assetId === 'creature_marchfield_turkey';
  const skin = doc.getRoot().listSkins()[0]!;
  const meshNode = doc.getRoot().listNodes().find(node => node.getSkin() === skin && node.getMesh());
  const primitives = meshNode?.getMesh()?.listPrimitives() ?? [];
  if (primitives.length !== 1) throw new Error('Native bird seam repair requires the original single primitive');
  const primitive = primitives[0]!;
  const positions = primitive.getAttribute('POSITION')!, joints = primitive.getAttribute('JOINTS_0')!;
  const weights = primitive.getAttribute('WEIGHTS_0')!, indices = primitive.getIndices()!.getArray()!;
  if (positions.getCount() !== (turkey ? 2780 : 7513)) throw new Error('Native bird geometry changed; re-audit the weight seam repair');
  const width = skin.listJoints().length;
  const groups: number[][] = [], groupByPosition = new Map<string, number>(), vertexGroup: number[] = [];
  const groupHeight: number[] = [];
  for (let vertex = 0; vertex < positions.getCount(); vertex++) {
    const point = positions.getElement(vertex, [] as number[]), key = point.map(value => value.toFixed(6)).join(':');
    let group = groupByPosition.get(key);
    if (group === undefined) { group = groups.length; groupByPosition.set(key, group); groups.push([]); groupHeight.push(point[1]!); }
    groups[group]!.push(vertex); vertexGroup[vertex] = group;
  }
  const adjacent = groups.map(() => new Set<number>());
  for (let triangle = 0; triangle < indices.length; triangle += 3) for (let side = 0; side < 3; side++) {
    const a = vertexGroup[indices[triangle + side]!]!, b = vertexGroup[indices[triangle + (side + 1) % 3]!]!;
    if (a !== b) { adjacent[a]!.add(b); adjacent[b]!.add(a); }
  }
  let values = groups.map(group => {
    const result = new Float64Array(width);
    for (const vertex of group) {
      const js = joints.getElement(vertex, [] as number[]), ws = weights.getElement(vertex, [] as number[]);
      for (let slot = 0; slot < 4; slot++) result[js[slot]!]! += ws[slot]! / group.length;
    }
    return result;
  });
  const active = new Set<number>();
  let discontinuousEdges = 0;
  for (let a = 0; a < groups.length; a++) for (const b of adjacent[a]!) if (a < b) {
    // The turkey's native folded knee exposes the builder's hard y=.29 thigh seam.
    // Its remaining weights do not have the bustard's widespread deformation defect.
    if (turkey && !(groupHeight[a]! > .2 && groupHeight[a]! < .36 && groupHeight[b]! > .2 && groupHeight[b]! < .36)) continue;
    let difference = 0;
    for (let joint = 0; joint < width; joint++) difference += Math.abs(values[a]![joint]! - values[b]![joint]!);
    if (difference > .65) { active.add(a); active.add(b); discontinuousEdges++; }
  }
  const rings = turkey ? 3 : 12, iterations = turkey ? 12 : 40;
  let frontier = [...active];
  for (let ring = 0; ring < rings; ring++) {
    const next: number[] = [];
    for (const a of frontier) for (const b of adjacent[a]!) if (!active.has(b)) { active.add(b); next.push(b); }
    frontier = next;
  }
  for (let iteration = 0; iteration < iterations; iteration++) {
    const next = values.map(value => value.slice());
    for (const a of active) {
      if (!adjacent[a]!.size) continue;
      for (let joint = 0; joint < width; joint++) {
        let sum = 0;
        for (const b of adjacent[a]!) sum += values[b]![joint]!;
        next[a]![joint] = values[a]![joint]! * .4 + .6 * sum / adjacent[a]!.size;
      }
    }
    values = next;
  }
  for (const group of active) {
    const influences = Array.from(values[group]!, (weight, joint) => ({ weight, joint }))
      .sort((a, b) => b.weight - a.weight).slice(0, 4);
    const sum = influences.reduce((total, influence) => total + influence.weight, 0);
    for (const vertex of groups[group]!) {
      joints.setElement(vertex, influences.map(influence => influence.joint));
      weights.setElement(vertex, influences.map(influence => influence.weight / sum));
    }
  }
  return { discontinuousEdges, weldedVertices: groups.length, changedVertices: [...active].reduce((total, group) => total + groups[group]!.length, 0), rings, iterations };
}

/** Restore the studio skin's mesh-relative bind while retaining its imported unit basis. */
function restoreStudioDonorBind(doc: Document) {
  const meshes = doc.getRoot().listNodes().filter(node => node.getSkin());
  const worlds = new Map<Node, Matrix4>();
  for (const mesh of meshes) {
    const skin = mesh.getSkin()!, inverse = skin.getInverseBindMatrices();
    if (!inverse) throw new Error('The studio bird donor has no inverse binds');
    const meshWorld = new Matrix4().fromArray(mesh.getWorldMatrix());
    skin.listJoints().forEach((joint, index) => {
      const bind = meshWorld.clone().multiply(new Matrix4().fromArray(inverse.getElement(index, [])).invert());
      const existing = worlds.get(joint);
      if (existing && existing.elements.some((value, axis) => Math.abs(value - bind.elements[axis]!) > 1e-4)) {
        throw new Error(`Conflicting studio bird bind for ${joint.getName()}`);
      }
      worlds.set(joint, bind);
    });
  }
  if (!worlds.size) throw new Error('The studio bird donor has no bound joints');
  const correctedRotations: { joint: string; degrees: number }[] = [];
  const depth = (node: Node): number => node.getParentNode() ? 1 + depth(node.getParentNode()!) : 0;
  for (const [joint, world] of [...worlds].sort(([a], [b]) => depth(a) - depth(b))) {
    const previous = new Quaternion().fromArray(joint.getRotation());
    const parent = joint.getParentNode();
    const parentWorld = parent ? worlds.get(parent) ?? new Matrix4().fromArray(parent.getWorldMatrix()) : new Matrix4();
    joint.setMatrix(parentWorld.clone().invert().multiply(world).toArray());
    const degrees = previous.angleTo(new Quaternion().fromArray(joint.getRotation())) * 180 / Math.PI;
    if (degrees > .001) correctedRotations.push({ joint: joint.getName(), degrees });
  }
  let maximumBindError = 0;
  for (const mesh of meshes) {
    const meshWorld = new Matrix4().fromArray(mesh.getWorldMatrix());
    const skin = mesh.getSkin()!, inverse = skin.getInverseBindMatrices()!;
    skin.listJoints().forEach((joint, index) => {
      const actual = new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(inverse.getElement(index, [])));
      actual.elements.forEach((value, axis) => { maximumBindError = Math.max(maximumBindError, Math.abs(value - meshWorld.elements[axis]!)); });
    });
  }
  if (maximumBindError > 1e-4) throw new Error(`Studio bird bind reconstruction failed: ${maximumBindError}`);
  return { joints: worlds.size, maximumBindError, correctedRotations, method: 'meshWorld multiplied by inverse inverse-bind matrix, reconstructed in parent-local space' };
}

/** Transfer the native studio hen's folded-leg side fall while retaining the other five takes. */
async function replaceTurkeyDeath(doc: Document, context: CreatureRepairContext) {
  const retained = doc.getRoot().listAnimations().filter(clip => clip.getName() !== 'Death').map(clip => ({
    name: clip.getName(), channels: clip.listChannels().map(channel => {
      const sampler = channel.getSampler()!, path = channel.getTargetPath();
      if (sampler.getInterpolation() !== 'LINEAR' || (path !== 'rotation' && path !== 'translation' && path !== 'scale')) {
        throw new Error('Turkey source takes changed; re-audit their interpolation before replacing Death');
      }
      return { node: channel.getTargetNode()!, path, times: Array.from(sampler.getInput()!.getArray()!), values: Array.from(sampler.getOutput()!.getArray()!) };
    }),
  }));
  const donor = await context.readAsset('animal_chicken');
  const donorBind = restoreStudioDonorBind(donor);
  const mapping: Record<string, string> = {
    Pelvis: 'Chicken_ROOTSHJnt', Spine: 'Chicken_Chest_01_01SHJnt', Chest: 'Chicken_Chest_01_03SHJnt',
    Neck: 'Chicken_Neck_01_02SHJnt', Head: 'Chicken_Head_TopSHJnt', Tail: 'Chicken_Tail_01_01SHJnt',
  };
  const directionChildren: Record<string, string> = {};
  for (const [side, donorSide] of [['L', 'r'], ['R', 'l']]) {
    for (const [target, source] of [['Thigh', 'Leg_Hip'], ['Hock', 'Leg_Knee'], ['Foot', 'Leg_Ankle'], ['Toe', 'Toe_02_01'], ['RearToe', 'Toe_03_01']]) {
      mapping[`${target}_${side}`] = `Chicken_${donorSide}_${source}SHJnt`;
    }
    directionChildren[`Thigh_${side}`] = `Hock_${side}`;
    directionChildren[`Hock_${side}`] = `Foot_${side}`;
    directionChildren[`Foot_${side}`] = `Toe_${side}`;
  }
  const donorRoot = donor.getRoot().listNodes().find(node => node.getName() === 'Chicken_ROOTSHJnt');
  const targetRoot = doc.getRoot().listNodes().find(node => node.getName() === 'Pelvis');
  if (!donorRoot || !targetRoot) throw new Error('Missing verified native bird motion roots');
  const translationScale = targetRoot.getWorldMatrix()[13]! / donorRoot.getWorldMatrix()[13]!;
  const report = retargetCreatureMotion(doc, donor, {
    mapping, directionChildren, sourceToTargetRotation: [0, 0, 0, 1],
    root: { target: 'Pelvis', source: 'Chicken_ROOTSHJnt', translationScale },
    clips: { Death: { source: 'Death', holdLastSeconds: .4 } },
    replaceAnimations: true, samplesPerSecond: 30, grounding: { floor: .003, maxCorrection: .8 },
  });
  for (const take of retained) {
    const clip = doc.createAnimation(take.name);
    for (const channel of take.channels) addChannel(doc, clip, channel.node, channel.path, channel.times, channel.values);
  }
  return { donorAssetId: 'animal_chicken', donorTake: 'Death', donorBind,
    anatomy: 'Both birds face +Z. Target L is negative X and maps to studio r. Hip-to-knee, knee-to-ankle and ankle-to-toe directions follow the studio fall; torso and neck retain the target rest offsets.',
    ...report };
}
/** Each take resets every property animated by any other take, including the death pelvis. */
function completeAnimatedProperties(doc: Document) {
  const required = new Map<Node, Set<'rotation' | 'translation' | 'scale'>>();
  for (const clip of doc.getRoot().listAnimations()) for (const channel of clip.listChannels()) {
    const node = channel.getTargetNode()!, path = channel.getTargetPath();
    if (path !== 'rotation' && path !== 'translation' && path !== 'scale') throw new Error('Unexpected native bird animation property');
    const paths = required.get(node) ?? new Set(); paths.add(path); required.set(node, paths);
  }
  let addedChannels = 0;
  for (const clip of doc.getRoot().listAnimations()) {
    const channels = clip.listChannels();
    for (const [node, paths] of required) for (const path of paths) {
      if (channels.some(channel => channel.getTargetNode() === node && channel.getTargetPath() === path)) continue;
      const value = path === 'rotation' ? node.getRotation() : path === 'translation' ? node.getTranslation() : node.getScale();
      addChannel(doc, clip, node, path, [0, duration(clip)], [...value, ...value]);
      addedChannels++;
    }
  }
  return addedChannels;
}

export async function repair(doc: Document, context: CreatureRepairContext): Promise<CreatureRepairResult> {
  if (!assetIds.includes(context.assetId as typeof assetIds[number])) throw new Error(`No bird repair for ${context.assetId}`);
  if (context.assetId === 'creature_blackwater_heron') return {
    changes: [],
    provenance: { audit: 'Original Corealm articulated heron has consistent skin order and complete animated properties in every take. Preserve its seven-joint neck and authored foot IK while devdocs assesses its poses.' },
  };
  const indices = repairNativeBirdSkinIndices(doc, context.assetId);
  const seams = smoothNativeBirdWeightSeams(doc, context.assetId);
  const death = context.assetId === 'creature_marchfield_turkey' ? await replaceTurkeyDeath(doc, context) : undefined;
  const addedChannels = completeAnimatedProperties(doc);
  return {
    changes: [
      `Corrected ${indices.changedInfluences} skin indices on ${indices.changedVertices} vertices so wing and tail weights address their authored bones.`,
      `Added ${addedChannels} missing reset channels so every take defines every property used by the other takes.`,
      `Smoothed ${seams.discontinuousEdges} abrupt connected weight seams over ${seams.changedVertices} bird vertices.`,
      ...(death ? ['Replaced the upright turkey death pose with the native studio chicken side fall, folded legs, surface grounding and held terminal pose.'] : []),
    ],
    provenance: {
      skinIndexRepair: indices,
      addedResetChannels: addedChannels,
      weightSeamRepair: seams,
      nativeDeath: death,
      geometry: 'Positions, triangle topology, normals, UVs, materials, texture images, joint rest transforms and inverse binds remain unchanged. Weight values change only around proven connected skin discontinuities.',
      animation: death ? 'Turkey Idle, Walk, Run, Attack and Hit tracks and timings retained; Death derives from the native studio chicken take.'
        : 'Original named bird motion tracks and timings retained. Bustard weights are diffused from its authored anatomy along existing triangle adjacency.',
      sourceBuilders: context.assetId === 'creature_marchfield_turkey'
        ? 'assets/art/tripo/imports/creatures/ryecrest-native-rig/build.mjs'
        : 'assets/art/tripo/imports/creatures/audit-user-bustard/build-candidate.mjs',
    },
  };
}


