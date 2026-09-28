import type { Accessor, Document, Node } from '@gltf-transform/core';
import { Line3, Matrix4, Quaternion, Vector3 } from 'three';
import { addChannel, applyClip, duration, restorePose, storedPose } from '../../../creature-motion/pose.js';
import { deformedBounds } from '../../../creature-motion/validate-deformation.js';
import type { CreatureRepairContext, CreatureRepairResult } from '../../repairProfile.js';
import { retargetCreatureMotion, sampleGroundSupport } from '../../retarget.js';

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

/** The imported bustard faces -Z, but its copied rig and authored masks face +Z. */
function canonicalizeBustardAnatomy(doc: Document) {
  const skin = doc.getRoot().listSkins()[0]!;
  const meshNode = doc.getRoot().listNodes().find(node => node.getSkin() === skin && node.getMesh());
  const primitives = meshNode?.getMesh()?.listPrimitives() ?? [];
  if (!meshNode || primitives.length !== 1) throw new Error('Bustard anatomy repair requires its original single primitive');
  const primitive = primitives[0]!, positions = primitive.getAttribute('POSITION')!;
  const joints = primitive.getAttribute('JOINTS_0')!, weights = primitive.getAttribute('WEIGHTS_0')!;
  if (positions.getCount() !== 7513) throw new Error('Bustard source geometry changed; re-audit its anatomy');
  const meshWorld = new Matrix4().fromArray(meshNode.getWorldMatrix());
  if (meshWorld.elements.some((value, axis) => Math.abs(value - new Matrix4().elements[axis]!) > 1e-6)) {
    throw new Error('Bustard source mesh basis changed; re-audit its canonical rotation');
  }
  const rotatedAttributes: string[] = [];
  const rotated = new Set<Accessor>();
  for (const semantic of ['POSITION', 'NORMAL', 'TANGENT']) {
    const accessor = primitive.getAttribute(semantic);
    if (!accessor || rotated.has(accessor)) continue;
    rotated.add(accessor);
    for (let vertex = 0; vertex < accessor.getCount(); vertex++) {
      const value = accessor.getElement(vertex, [] as number[]);
      value[0] = -value[0]!; value[2] = -value[2]!;
      accessor.setElement(vertex, value); // The tangent's handedness W stays unchanged.
    }
    rotatedAttributes.push(semantic);
  }

  // Source cross-sections put the copied Neck and Beak pivots outside the mesh.
  // Move those pivots inside their anatomy, retaining every other joint world bind.
  const bones = skin.listJoints(), binds = new Map(bones.map(node => [node, new Matrix4().fromArray(node.getWorldMatrix())]));
  const correctedPivots = [
    { joint: 'Neck', position: [0, .69, .376] },
    { joint: 'Beak', position: [0, .865, .425] },
  ];
  const pivotRepair = correctedPivots.map(({ joint, position }) => {
    const node = bones.find(bone => bone.getName() === joint);
    if (!node) throw new Error(`Missing bustard anatomical pivot ${joint}`);
    const world = binds.get(node)!, previous = new Vector3().setFromMatrixPosition(world).toArray();
    world.setPosition(new Vector3().fromArray(position));
    return { joint, previous, position };
  });
  for (const [joint, world] of binds) {
    const parent = joint.getParentNode();
    const parentWorld = parent ? binds.get(parent) ?? new Matrix4().fromArray(parent.getWorldMatrix()) : new Matrix4();
    joint.setMatrix(parentWorld.clone().invert().multiply(world).toArray());
  }
  const inverseBinds = skin.getInverseBindMatrices()!;
  bones.forEach((joint, index) => {
    if (correctedPivots.some(pivot => pivot.joint === joint.getName())) {
      inverseBinds.setElement(index, new Matrix4().fromArray(joint.getWorldMatrix()).invert().multiply(meshWorld).toArray());
    }
  });
  let maximumBindError = 0;
  bones.forEach((joint, index) => {
    const restored = new Matrix4().fromArray(joint.getWorldMatrix()).multiply(new Matrix4().fromArray(inverseBinds.getElement(index, [])));
    restored.elements.forEach((value, axis) => { maximumBindError = Math.max(maximumBindError, Math.abs(value - meshWorld.elements[axis]!)); });
  });
  if (maximumBindError > 1e-6) throw new Error(`Bustard rest geometry moved during pivot repair: ${maximumBindError}`);

  const names = bones.map(node => node.getName());
  const segments = bones.map(node => {
    const end = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(node.getWorldMatrix()));
    const parent = node.getParentNode();
    return new Line3(parent ? new Vector3().setFromMatrixPosition(new Matrix4().fromArray(parent.getWorldMatrix())) : end.clone(), end);
  });
  function region(point: number[]) {
    const x = point[0]!, y = point[1]!, z = point[2]!, side = x < 0 ? 'L' : 'R';
    if (y < .205 || (y < .29 && Math.abs(x) > .065 && z > -.015)) {
      return { names: ['Pelvis', `Thigh_${side}`, `Hock_${side}`, `Foot_${side}`, `Toe_${side}`, `RearToe_${side}`], sigma: .055 };
    }
    if (y > .73 && z > .20) return { names: ['Chest', 'Neck', 'Head', 'Beak'], sigma: .075 };
    if (y > .60 && z > .14) return { names: ['Chest', 'Neck', 'Head'], sigma: .095 };
    if (z < -.31 && y > .27) return { names: ['Pelvis', 'Spine', 'Tail'], sigma: .11 };
    if (Math.abs(x) > .115 && y > .34 && y < .79 && z > -.34 && z < .27) {
      return { names: ['Spine', 'Chest', `Wing_${side}`, `WingTip_${side}`], sigma: .075 };
    }
    return { names: ['Pelvis', 'Spine', 'Chest'], sigma: .12 };
  }
  for (let vertex = 0; vertex < positions.getCount(); vertex++) {
    const point = positions.getElement(vertex, [] as number[]), selection = region(point), vector = new Vector3().fromArray(point);
    const influences = selection.names.map(name => {
      const joint = names.indexOf(name), segment = segments[joint];
      if (!segment) throw new Error(`Missing bustard weight joint ${name}`);
      const distance = segment.closestPointToPoint(vector, true, new Vector3()).distanceTo(vector);
      return { joint, weight: Math.exp(-distance * distance / (2 * selection.sigma * selection.sigma)) };
    }).sort((a, b) => b.weight - a.weight).slice(0, 4);
    const sum = influences.reduce((total, influence) => total + influence.weight, 0);
    if (!(sum > 0)) throw new Error(`Bustard vertex ${vertex} has no anatomical weight`);
    while (influences.length < 4) influences.push({ joint: 0, weight: 0 });
    joints.setElement(vertex, influences.map(influence => influence.joint));
    weights.setElement(vertex, influences.map(influence => influence.weight / sum));
  }
  return { rotation: 'Rigid 180 degrees about Y into the +Z rig convention', rotatedAttributes, pivotRepair, maximumBindError,
    reweightedVertices: positions.getCount(), method: 'Original anatomical region masks and Gaussian distance to incoming bone segments, regenerated against the canonical mesh and actual skin order before surface seam diffusion' };
}

/** The reviewed turkey peck avoids the copied bustard's excessive cumulative neck rotation. */
async function replaceBustardPeck(doc: Document, context: CreatureRepairContext) {
  const donor = await context.readAsset('creature_marchfield_turkey');
  const attack = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Attack');
  const source = donor.getRoot().listAnimations().find(clip => clip.getName() === 'Attack');
  if (!attack || !source) throw new Error('Missing authored groundbird peck');
  const replacedJoints = ['Chest', 'Neck', 'Head'];
  for (const name of replacedJoints) {
    const target = attack.listChannels().find(channel => channel.getTargetNode()?.getName() === name && channel.getTargetPath() === 'rotation')?.getSampler();
    const from = source.listChannels().find(channel => channel.getTargetNode()?.getName() === name && channel.getTargetPath() === 'rotation')?.getSampler();
    if (!target || !from || target.getInterpolation() !== 'LINEAR' || from.getInterpolation() !== 'LINEAR') {
      throw new Error(`Missing linear ${name} peck rotation`);
    }
    const times = target.getInput()!.getArray()!, sourceTimes = from.getInput()!.getArray()!;
    if (times.length !== sourceTimes.length || times.some((value, index) => value !== sourceTimes[index])) {
      throw new Error('Authored bird peck timings changed; re-audit their synchronization');
    }
    target.setOutput(target.getOutput()!.clone().setArray(new Float32Array(from.getOutput()!.getArray()!)));
  }
  return { donorAssetId: 'creature_marchfield_turkey', donorTake: 'Attack', replacedJoints,
    source: 'Reviewed Corealm-authored turkey peck; this is not a native studio take. All other bustard motion channels and timings remain unchanged.' };
}

/** Ground the actual surface extremum; foot percentiles miss isolated toes in the copied gait. */
function supportBustardSurface(doc: Document) {
  const scenes = doc.getRoot().listScenes(), scene = scenes[0];
  const wrapperName = 'corealm_bustard_ground';
  if (!scene || scenes.length !== 1 || doc.getRoot().listNodes().some(node => node.getName() === wrapperName)) {
    throw new Error('Bustard support requires the original single unwrapped scene');
  }
  const ground = doc.createNode(wrapperName);
  for (const child of [...scene.listChildren()]) { scene.removeChild(child); ground.addChild(child); }
  scene.addChild(ground);
  const pose = storedPose(doc), floor = .003;
  const clips: { name: string; samples: number; uncorrectedMinimumY: number; minimumOffset: number; maximumLift: number }[] = [];
  try {
    for (const clip of doc.getRoot().listAnimations()) {
      const seconds = duration(clip), steps = Math.ceil(seconds * 30);
      const times = new Set(Array.from({ length: steps + 1 }, (_, frame) => frame * seconds / steps));
      for (const channel of clip.listChannels()) for (const time of channel.getSampler()!.getInput()!.getArray()!) times.add(time);
      let uncorrectedMinimumY = Infinity;
      // Source Float32 key times can nearly coincide with the regular sampling grid.
      // Avoid sub-microsecond intervals that serialize as duplicate glTF key times.
      const seedTimes = [...times].sort((a, b) => a - b).filter((time, index, sorted) => !index || time - sorted[index - 1]! > 1e-6);
      const support = sampleGroundSupport(seedTimes, time => {
        restorePose(pose); applyClip(clip, time);
        const minimum = deformedBounds(doc).min[1]!;
        uncorrectedMinimumY = Math.min(uncorrectedMinimumY, minimum);
        // Death settles onto its folded body. Retain airborne portions of other takes.
        return clip.getName() === 'Death' ? floor - minimum : Math.max(0, floor - minimum);
      });
      const serialized = new Map<number, number>();
      support.times.forEach((time, index) => {
        const key = Math.fround(time);
        serialized.set(key, Math.max(serialized.get(key) ?? -Infinity, support.required[index]!));
      });
      addChannel(doc, clip, ground, 'translation', [...serialized.keys()], [...serialized.values()].flatMap(lift => [0, lift, 0]));
      clips.push({ name: clip.getName(), samples: serialized.size, uncorrectedMinimumY, minimumOffset: Math.min(...serialized.values()), maximumLift: Math.max(...serialized.values()) });
    }
  } finally { restorePose(pose); }
  return { node: wrapperName, floor, method: 'Shared adaptive ground-support sampling of the lowest deformed vertex throughout each final interpolated clip. Positive lift for live states; signed surface support for the folded Death. Local bone motion is not altered by this pass.', clips };
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

/** Fold the copied straight legs using the studio hen's body-relative terminal anatomy. */
async function foldBustardDeath(doc: Document, context: CreatureRepairContext) {
  const death = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Death');
  if (!death) throw new Error('Bustard has no Death take');
  const donor = await context.readAsset('animal_chicken'), donorBind = restoreStudioDonorBind(donor);
  const sourceDeath = donor.getRoot().listAnimations().find(clip => clip.getName() === 'Death');
  const sourceRoot = donor.getRoot().listNodes().find(node => node.getName() === 'Chicken_ROOTSHJnt');
  const targetRoot = doc.getRoot().listNodes().find(node => node.getName() === 'Pelvis');
  if (!sourceDeath || !sourceRoot || !targetRoot) throw new Error('Missing native bird Death anatomy');
  const pose = storedPose(doc), sourceRestRoot = new Matrix4().fromArray(sourceRoot.getWorldMatrix());
  const targetRestRoot = new Matrix4().fromArray(targetRoot.getWorldMatrix());
  applyClip(sourceDeath, duration(sourceDeath));
  const neutralizeSource = sourceRestRoot.clone().multiply(new Matrix4().fromArray(sourceRoot.getWorldMatrix()).invert());
  const endings = new Map<Node, Quaternion>();
  try {
    const idle = doc.getRoot().listAnimations().find(clip => clip.getName() === 'Idle');
    if (!idle) throw new Error('Bustard has no Idle reference');
    restorePose(pose); applyClip(idle, 0);
    const idleRotations = new Map(doc.getRoot().listNodes().map(node => [node, new Quaternion().fromArray(node.getRotation())]));
    restorePose(pose); applyClip(death, 0);
    const openingOffsets = new Map<Node, Quaternion>();
    for (const channel of death.listChannels()) if (channel.getTargetPath() === 'rotation') {
      const node = channel.getTargetNode()!, initial = new Quaternion().fromArray(node.getRotation()), idleRotation = idleRotations.get(node)!;
      if (initial.angleTo(idleRotation) > 1e-6) openingOffsets.set(node, idleRotation.clone().multiply(initial.invert()).normalize());
    }
    restorePose(pose);
    applyClip(death, duration(death));
    const targetBody = new Matrix4().fromArray(targetRoot.getWorldMatrix()).multiply(targetRestRoot.clone().invert());
    for (const [side, sourceSide] of [['L', 'r'], ['R', 'l']]) {
      for (const [name, child, sourceName, sourceChild] of [
        ['Thigh', 'Hock', 'Leg_Hip', 'Leg_Knee'],
        ['Hock', 'Foot', 'Leg_Knee', 'Leg_Ankle'],
        ['Foot', 'Toe', 'Leg_Ankle', 'Toe_02_01'],
      ]) {
        const joint = doc.getRoot().listNodes().find(node => node.getName() === `${name}_${side}`);
        const targetChild = doc.getRoot().listNodes().find(node => node.getName() === `${child}_${side}`);
        const from = donor.getRoot().listNodes().find(node => node.getName() === `Chicken_${sourceSide}_${sourceName}SHJnt`);
        const to = donor.getRoot().listNodes().find(node => node.getName() === `Chicken_${sourceSide}_${sourceChild}SHJnt`);
        if (!joint || !targetChild || !from || !to || !joint.getParentNode()) throw new Error('Missing folded bird leg segment');
        const direction = new Vector3().setFromMatrixPosition(new Matrix4().fromArray(to.getWorldMatrix()))
          .sub(new Vector3().setFromMatrixPosition(new Matrix4().fromArray(from.getWorldMatrix())))
          .transformDirection(neutralizeSource).transformDirection(targetBody)
          .transformDirection(new Matrix4().fromArray(joint.getParentNode()!.getWorldMatrix()).invert());
        const previous = new Quaternion().fromArray(joint.getRotation());
        const existing = new Vector3().fromArray(targetChild.getTranslation()).applyQuaternion(previous).normalize();
        const folded = new Quaternion().setFromUnitVectors(existing, direction).multiply(previous).normalize();
        joint.setRotation(folded.toArray()); endings.set(joint, folded);
      }
    }
    const startsNormalized = .28, completeNormalized = .83;
    for (const [joint, ending] of endings) {
      const sampler = death.listChannels().find(channel => channel.getTargetNode() === joint && channel.getTargetPath() === 'rotation')?.getSampler();
      if (!sampler || sampler.getInterpolation() !== 'LINEAR') throw new Error(`Missing bustard Death leg rotation ${joint.getName()}`);
      const times = sampler.getInput()!.getArray()!, output = sampler.getOutput()!.clone();
      for (let frame = 0; frame < times.length; frame++) {
        const phase = times[frame]! / duration(death), t = Math.min(1, Math.max(0, (phase - startsNormalized) / (completeNormalized - startsNormalized)));
        const blend = t * t * (3 - 2 * t);
        const rotation = new Quaternion().fromArray(output.getElement(frame, []));
        output.setElement(frame, rotation.slerp(ending, blend).normalize().toArray());
      }
      sampler.setOutput(output);
    }
    for (const [node, offset] of openingOffsets) {
      const sampler = death.listChannels().find(channel => channel.getTargetNode() === node && channel.getTargetPath() === 'rotation')!.getSampler()!;
      const times = sampler.getInput()!.getArray()!, output = sampler.getOutput()!.clone();
      for (let frame = 0; frame < times.length; frame++) {
        const t = Math.min(1, times[frame]! / duration(death) / .12), blend = 1 - t * t * (3 - 2 * t);
        if (!blend) continue;
        const delta = new Quaternion().slerp(offset, blend);
        output.setElement(frame, delta.multiply(new Quaternion().fromArray(output.getElement(frame, []))).normalize().toArray());
      }
      sampler.setOutput(output);
    }
    return { donorAssetId: 'animal_chicken', donorTake: 'Death', donorBind, startsNormalized, completeNormalized,
      changedJoints: [...endings.keys()].map(node => node.getName()),
      openingBlend: { joints: [...openingOffsets.keys()].map(node => node.getName()), completeNormalized: .12 },
      method: 'Match native held hip-to-knee, knee-to-ankle and ankle-to-toe directions in the torso rest basis. Smoothly blend the six Death leg rotations during the existing fall. The opening pose matches Idle and fades its small chest/head offsets before the fold begins.' };
  } finally { restorePose(pose); }
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
  const anatomy = context.assetId === 'creature_scree_bustard' ? canonicalizeBustardAnatomy(doc) : undefined;
  const seams = smoothNativeBirdWeightSeams(doc, context.assetId);
  const peck = anatomy ? await replaceBustardPeck(doc, context) : undefined;
  const foldedDeath = anatomy ? await foldBustardDeath(doc, context) : undefined;
  const support = anatomy ? supportBustardSurface(doc) : undefined;
  const death = context.assetId === 'creature_marchfield_turkey' ? await replaceTurkeyDeath(doc, context) : undefined;
  const addedChannels = completeAnimatedProperties(doc);
  return {
    changes: [
      `Corrected ${indices.changedInfluences} skin indices on ${indices.changedVertices} vertices so wing and tail weights address their authored bones.`,
      `Added ${addedChannels} missing reset channels so every take defines every property used by the other takes.`,
      `Smoothed ${seams.discontinuousEdges} abrupt connected weight seams over ${seams.changedVertices} bird vertices.`,
      ...(anatomy ? ['Rotated the bustard mesh 180 degrees about Y to match its +Z rig, aligned Neck and Beak pivots with the source anatomy, and regenerated anatomical skin weights.', 'Adapted the reviewed turkey peck on Chest, Neck and Head so the bustard strikes with its beak.'] : []),
      ...(support ? ['Added whole-scene ground support for every bustard take, using actual deformed toe and body extrema while preserving local motion.'] : []),
      ...(foldedDeath ? ['Folded the bustard Death legs using native studio chicken segment directions so the held corpse settles onto its body.'] : []),
      ...(death ? ['Replaced the upright turkey death pose with the native studio chicken side fall, folded legs, surface grounding and held terminal pose.'] : []),
    ],
    provenance: {
      skinIndexRepair: indices,
      addedResetChannels: addedChannels,
      weightSeamRepair: seams,
      nativeDeath: death,
      anatomicalCorrection: anatomy,
      authoredPeck: peck,
      foldedDeath,
      surfaceSupport: support,
      geometry: anatomy ? 'Positions, normals and any tangent XYZ undergo a rigid 180-degree Y rotation; tangent W, triangle topology, UVs, materials and texture images remain unchanged. Neck and Beak world pivots and their inverse binds change together, preserving the canonical rest geometry. All other world joint binds remain unchanged.'
        : 'Positions, triangle topology, normals, UVs, materials, texture images, joint rest transforms and inverse binds remain unchanged. Weight values change only around proven connected skin discontinuities.',
      animation: death ? 'Turkey Idle, Walk, Run, Attack and Hit tracks and timings retained; Death derives from the native studio chicken take.'
        : 'Bustard local Idle, Walk, Run and Hit tracks retained. Attack changes only three reviewed turkey peck rotations. Death folds six leg rotations into native studio directions and matches the opening chest/head pose to Idle. Each take adds whole-scene support; Death settles downward onto its actual support surface. Timings remain unchanged.',
      sourceBuilders: context.assetId === 'creature_marchfield_turkey'
        ? 'assets/art/tripo/imports/creatures/ryecrest-native-rig/build.mjs'
        : 'assets/art/tripo/imports/creatures/audit-user-bustard/build-candidate.mjs',
    },
  };
}
