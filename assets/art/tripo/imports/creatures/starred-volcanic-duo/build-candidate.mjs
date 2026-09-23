import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const baseDir = 'assets/art/tripo/imports/creatures/starred-volcanic-duo';
const packId = 'corealm-starred-creatures';
const sourceRows = [
  {
    id: 'creature_volcanic_titan',
    displayName: 'Volcanic Titan',
    sourcePath: 'assets/art/tripo/exports/31b1d1f3-ebd9-4c67-b3f8-846da3211c81.glb',
    sourceHash: 'e4d44b405ac8bee621b8f3cc833b1ce4ba85461bedbaf5109e02116d72fe26db',
    sourceModelId: '31b1d1f3-ebd9-4c67-b3f8-846da3211c81',
    sourceCardId: 'a02869b7-f9ba-456a-80b0-1d9b6d6770f1',
    sourceTitle: 'volcanic titan 3d model_Clone1',
    prompt: 'P3 — Volcanic Titan: a volcanic titan of cosmic magma, obsidian and starlight cracks, an erupting radiant core, a storm of embers and cosmic heat.',
    candidateFile: 'volcanic-titan-native-rig-candidate.glb',
    targetFile: 'models/creature/creature_volcanic_titan.glb',
    tier: 'T80',
    worldRole: 'high-tier volcanic-region titan; tallest and most dangerous of this pair',
    modelScale: 2.55,
    emissiveFactor: [1, 1, 1],
    blueStarlight: true,
    profile: { shoulder: 0.27, upperArm: 0.53, forearm: 0.78, hand: 0.97, leg: 0.20, armSigma: 0.12, legSigma: 0.075 },
    sourceRigReview: '56 source joints with identity local transforms; 5,890 of 5,897 vertices were fully assigned to Hips, and no animation clips were present. The original skin and weights are rebuilt.',
  },
  {
    id: 'creature_cooling_crust_golem',
    displayName: 'Cooling Crust Golem',
    sourcePath: 'assets/art/tripo/exports/dd3fdc88-4fd6-49ff-955f-ed85c4085d41.glb',
    sourceHash: 'eb7a399f93838a1fb40caaf87c35bdd64946c2510f9e582d4639689c03534eb1',
    sourceModelId: 'dd3fdc88-4fd6-49ff-955f-ed85c4085d41',
    sourceCardId: '7bc8f67b-072b-48d0-b11b-05325bf66bc2',
    sourceTitle: 'lava golem 3d model_Clone1',
    prompt: 'P1 — Cooling Crust: hulking golem of cracked black obsidian with molten orange-red magma in deep seams, a glowing core, heavy fists.',
    candidateFile: 'cooling-crust-golem-native-rig-candidate.glb',
    targetFile: 'models/creature/creature_cooling_crust_golem.glb',
    tier: 'T50',
    worldRole: 'volcanic-region heavy golem; smaller and less dangerous than the Volcanic Titan',
    modelScale: 1.72,
    emissiveFactor: [1, 1, 1],
    blueStarlight: false,
    profile: { shoulder: 0.30, upperArm: 0.56, forearm: 0.80, hand: 0.98, leg: 0.21, armSigma: 0.14, legSigma: 0.08 },
    sourceRigReview: 'Static source mesh with no skin or clips; add a source-specific humanoid rig and six game lifecycle clips.',
  },
];

await mkdir(baseDir, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const requiredClips = ['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function boundsOf(positions) {
  const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      bounds.min[axis] = Math.min(bounds.min[axis], positions[i + axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], positions[i + axis]);
    }
  }
  return bounds;
}

function scaledBounds(bounds, scale) {
  return {
    min: bounds.min.map((value) => value * scale),
    max: bounds.max.map((value) => value * scale),
  };
}

function segmentDistance(point, start, end) {
  const vector = end.map((value, axis) => value - start[axis]);
  const lengthSquared = vector.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1, point.reduce((sum, value, axis) => sum + (value - start[axis]) * vector[axis], 0) / lengthSquared));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + vector[axis] * t)));
}

function smoothstep(edge0, edge1, value) {
  const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

function rigFor(bounds, profile) {
  const min = bounds.min;
  const max = bounds.max;
  const height = max[1] - min[1];
  const halfWidth = (max[0] - min[0]) * 0.5;
  const centerX = (max[0] + min[0]) * 0.5;
  const centerZ = (max[2] + min[2]) * 0.5;
  const y = (fraction) => min[1] + height * fraction;
  const x = (side, fraction) => centerX + halfWidth * fraction * side;
  const z = (fraction = 0) => centerZ + height * fraction;
  const bones = [
    { name: 'mixamorigHips', parent: null, p: [centerX, y(0.37), z(0.005)], sigma: height * 0.135, group: 'torso' },
    { name: 'mixamorigSpine', parent: 'mixamorigHips', p: [centerX, y(0.47), z(0.005)], sigma: height * 0.12, group: 'torso' },
    { name: 'mixamorigSpine1', parent: 'mixamorigSpine', p: [centerX, y(0.58), z(0.006)], sigma: height * 0.12, group: 'torso' },
    { name: 'mixamorigSpine2', parent: 'mixamorigSpine1', p: [centerX, y(0.69), z(0.006)], sigma: height * 0.12, group: 'torso' },
    { name: 'mixamorigNeck', parent: 'mixamorigSpine2', p: [centerX, y(0.82), z(0.008)], sigma: height * 0.085, group: 'neck' },
    { name: 'mixamorigHead', parent: 'mixamorigNeck', p: [centerX, y(0.92), z(0.01)], sigma: height * 0.105, group: 'head' },
    { name: 'mixamorigLeftShoulder', parent: 'mixamorigSpine2', p: [x(-1, profile.shoulder), y(0.70), z(0.004)], sigma: height * 0.07, group: 'leftArm', side: -1 },
    { name: 'mixamorigLeftArm', parent: 'mixamorigLeftShoulder', p: [x(-1, profile.upperArm), y(0.70), z(0.005)], sigma: height * profile.armSigma, group: 'leftArm', side: -1 },
    { name: 'mixamorigLeftForeArm', parent: 'mixamorigLeftArm', p: [x(-1, profile.forearm), y(0.70), z(0.008)], sigma: height * profile.armSigma * 0.82, group: 'leftArm', side: -1 },
    { name: 'mixamorigLeftHand', parent: 'mixamorigLeftForeArm', p: [x(-1, profile.hand), y(0.70), z(0.012)], sigma: height * profile.armSigma * 0.9, group: 'leftArm', side: -1 },
    { name: 'mixamorigRightShoulder', parent: 'mixamorigSpine2', p: [x(1, profile.shoulder), y(0.70), z(0.004)], sigma: height * 0.07, group: 'rightArm', side: 1 },
    { name: 'mixamorigRightArm', parent: 'mixamorigRightShoulder', p: [x(1, profile.upperArm), y(0.70), z(0.005)], sigma: height * profile.armSigma, group: 'rightArm', side: 1 },
    { name: 'mixamorigRightForeArm', parent: 'mixamorigRightArm', p: [x(1, profile.forearm), y(0.70), z(0.008)], sigma: height * profile.armSigma * 0.82, group: 'rightArm', side: 1 },
    { name: 'mixamorigRightHand', parent: 'mixamorigRightForeArm', p: [x(1, profile.hand), y(0.70), z(0.012)], sigma: height * profile.armSigma * 0.9, group: 'rightArm', side: 1 },
    { name: 'mixamorigLeftUpLeg', parent: 'mixamorigHips', p: [x(-1, profile.leg), y(0.33), z(0)], sigma: height * profile.legSigma, group: 'leftLeg', side: -1 },
    { name: 'mixamorigLeftLeg', parent: 'mixamorigLeftUpLeg', p: [x(-1, profile.leg), y(0.17), z(0.002)], sigma: height * profile.legSigma * 0.84, group: 'leftLeg', side: -1 },
    { name: 'mixamorigLeftFoot', parent: 'mixamorigLeftLeg', p: [x(-1, profile.leg), y(0.055), z(0.018)], sigma: height * 0.052, group: 'leftLeg', side: -1 },
    { name: 'mixamorigLeftToeBase', parent: 'mixamorigLeftFoot', p: [x(-1, profile.leg), y(0.03), z(0.07)], sigma: height * 0.055, group: 'leftLeg', side: -1 },
    { name: 'mixamorigRightUpLeg', parent: 'mixamorigHips', p: [x(1, profile.leg), y(0.33), z(0)], sigma: height * profile.legSigma, group: 'rightLeg', side: 1 },
    { name: 'mixamorigRightLeg', parent: 'mixamorigRightUpLeg', p: [x(1, profile.leg), y(0.17), z(0.002)], sigma: height * profile.legSigma * 0.84, group: 'rightLeg', side: 1 },
    { name: 'mixamorigRightFoot', parent: 'mixamorigRightLeg', p: [x(1, profile.leg), y(0.055), z(0.018)], sigma: height * 0.052, group: 'rightLeg', side: 1 },
    { name: 'mixamorigRightToeBase', parent: 'mixamorigRightFoot', p: [x(1, profile.leg), y(0.03), z(0.07)], sigma: height * 0.055, group: 'rightLeg', side: 1 },
  ];
  const byName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }]));
  for (const bone of bones) {
    const parent = bone.parent ? byName.get(bone.parent) : null;
    bone.local = parent ? bone.p.map((value, axis) => value - parent.p[axis]) : bone.p;
  }
  return { bones, byName, height, halfWidth, centerX, centerZ, y };
}

function assignWeights(primitive, positions, rig, profile, doc, buffer) {
  const { bones, byName, height, halfWidth } = rig;
  const jointValues = new Uint16Array(positions.length / 3 * 4);
  const weightValues = new Float32Array(positions.length / 3 * 4);
  const influenceCounts = new Uint32Array(bones.length);
  const dominantCounts = new Uint32Array(bones.length);
  let maximumWeightSumError = 0;
  let distributedVertices = 0;
  const sigmoid = (value, threshold, softness) => 1 / (1 + Math.exp(-(value - threshold) / softness));
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
    const relativeY = (point[1] - (rig.y(0))) / height;
    const candidates = [];
    for (const bone of bones) {
      let gate = 1;
      if (bone.group === 'head' || bone.group === 'neck') gate = smoothstep(0.70, 0.90, relativeY) * (bone.group === 'neck' ? 0.9 : 1);
      if (bone.group === 'leftArm' || bone.group === 'rightArm') {
        const lateral = bone.side * (point[0] - rig.centerX);
        gate = smoothstep(0.46, 0.56, relativeY) * (1 - smoothstep(0.88, 0.96, relativeY));
        gate *= 0.008 + 0.992 * sigmoid(lateral / Math.max(halfWidth, 1e-5), 0.10, 0.055);
      }
      if (bone.group === 'leftLeg' || bone.group === 'rightLeg') {
        const lateral = bone.side * (point[0] - rig.centerX);
        gate = 1 - smoothstep(0.35, 0.47, relativeY);
        gate *= 0.008 + 0.992 * sigmoid(lateral / Math.max(halfWidth, 1e-5), 0.12, 0.052);
      }
      const parent = bone.parent ? byName.get(bone.parent) : null;
      const distance = segmentDistance(point, parent?.p ?? bone.p, bone.p);
      const score = gate * Math.exp(-0.5 * (distance / bone.sigma) ** 2);
      if (score > 1e-10) candidates.push({ index: byName.get(bone.name).index, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    const chosen = candidates.slice(0, 4);
    if (!chosen.length) throw new Error('No anatomical weights could be assigned at vertex ' + vertex + '.');
    if (chosen.filter((entry) => entry.score / chosen.reduce((sum, item) => sum + item.score, 0) > 0.02).length > 1) distributedVertices += 1;
    dominantCounts[chosen[0].index] += 1;
    const total = chosen.reduce((sum, entry) => sum + entry.score, 0);
    let assigned = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const entry = chosen[slot] ?? chosen[0];
      const weight = slot >= chosen.length ? 0 : slot === chosen.length - 1 ? 1 - assigned : entry.score / total;
      jointValues[vertex * 4 + slot] = entry.index;
      weightValues[vertex * 4 + slot] = weight;
      assigned += weight;
      if (weight > 1e-6) influenceCounts[entry.index] += 1;
    }
    const sum = weightValues[vertex * 4] + weightValues[vertex * 4 + 1] + weightValues[vertex * 4 + 2] + weightValues[vertex * 4 + 3];
    maximumWeightSumError = Math.max(maximumWeightSumError, Math.abs(sum - 1));
  }
  primitive.setAttribute('JOINTS_0', doc.createAccessor('VolcanicCreature_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
  primitive.setAttribute('WEIGHTS_0', doc.createAccessor('VolcanicCreature_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
  return {
    influencesPerVertex: 4,
    distributedVertices,
    maximumWeightSumError,
    bones: bones.map((bone, index) => ({ name: bone.name, parent: bone.parent, position: bone.p, verticesInfluenced: influenceCounts[index], dominantVertices: dominantCounts[index] })),
  };
}

const quat = (axis, angle) => {
  const sine = Math.sin(angle / 2);
  const cosine = Math.cos(angle / 2);
  if (axis === 'x') return [sine, 0, 0, cosine];
  if (axis === 'y') return [0, sine, 0, cosine];
  return [0, 0, sine, cosine];
};

function addClip(doc, buffer, boneNodes, name, seconds, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) {
    const path = track.path ?? 'rotation';
    const times = track.times ?? track.values.map((_, index) => index * seconds / (track.values.length - 1));
    const input = doc.createAccessor(name + '_' + track.node + '_' + path + '_time').setArray(Float32Array.from(times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
    const output = doc.createAccessor(name + '_' + track.node + '_' + path + '_value').setArray(Float32Array.from(track.values.flat())).setType(path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setBuffer(buffer);
    const sampler = doc.createAnimationSampler(name + '_' + track.node + '_' + path).setInput(input).setOutput(output).setInterpolation('LINEAR');
    animation.addSampler(sampler).addChannel(doc.createAnimationChannel(track.node + '_' + path).setTargetNode(boneNodes.get(track.node)).setTargetPath(path).setSampler(sampler));
  }
  return { name, seconds, channels: tracks.length };
}

function authorClips(doc, buffer, boneNodes, rig, model) {
  const clips = [];
  const phase = [0, 0.25, 0.5, 0.75, 1];
  const h = rig.height;
  const hip = (height, z = rig.centerZ) => [rig.centerX, height, z];
  const mirroredZ = (name, angle) => quat('z', angle * (name.includes('Left') ? -1 : 1));
  const locomotion = (name, duration, stride) => {
    const times = phase.map((point) => point * duration);
    const bounce = name === 'Walk' ? 0.007 : 0.013;
    const rootY = phase.map((point, index) => hip(rig.y(0.37) + (index % 2 === 1 ? h * bounce : 0)));
    const tracks = [
      { node: 'mixamorigHips', path: 'translation', times, values: rootY },
      { node: 'mixamorigSpine1', times, values: phase.map((point) => quat('x', Math.sin(point * Math.PI * 2) * stride * 0.035)) },
      { node: 'mixamorigLeftUpLeg', times, values: phase.map((point) => quat('x', Math.sin(point * Math.PI * 2) * stride * 0.36)) },
      { node: 'mixamorigRightUpLeg', times, values: phase.map((point) => quat('x', Math.sin((point + 0.5) * Math.PI * 2) * stride * 0.36)) },
      { node: 'mixamorigLeftLeg', times, values: phase.map((point) => quat('x', -Math.max(0, Math.sin(point * Math.PI * 2)) * stride * 0.23)) },
      { node: 'mixamorigRightLeg', times, values: phase.map((point) => quat('x', -Math.max(0, Math.sin((point + 0.5) * Math.PI * 2)) * stride * 0.23)) },
      { node: 'mixamorigLeftArm', times, values: phase.map((point) => quat('y', Math.sin((point + 0.5) * Math.PI * 2) * stride * 0.19)) },
      { node: 'mixamorigRightArm', times, values: phase.map((point) => quat('y', Math.sin(point * Math.PI * 2) * stride * 0.19)) },
      { node: 'mixamorigLeftForeArm', times, values: phase.map((point) => mirroredZ('mixamorigLeftForeArm', 0.08 + Math.max(0, Math.sin(point * Math.PI * 2)) * 0.12)) },
      { node: 'mixamorigRightForeArm', times, values: phase.map((point) => mirroredZ('mixamorigRightForeArm', 0.08 + Math.max(0, Math.sin((point + 0.5) * Math.PI * 2)) * 0.12)) },
    ];
    return addClip(doc, buffer, boneNodes, name, duration, tracks);
  };

  clips.push(addClip(doc, buffer, boneNodes, 'Idle', 3.0, [
    { node: 'mixamorigSpine1', times: [0, 0.75, 1.5, 2.25, 3], values: [quat('x', 0), quat('x', -0.018), quat('x', 0), quat('x', 0.018), quat('x', 0)] },
    { node: 'mixamorigSpine2', times: [0, 0.75, 1.5, 2.25, 3], values: [quat('z', 0), quat('z', 0.012), quat('z', 0), quat('z', -0.012), quat('z', 0)] },
    { node: 'mixamorigHead', times: [0, 0.75, 1.5, 2.25, 3], values: [quat('y', -0.035), quat('y', 0.02), quat('y', 0.045), quat('y', -0.015), quat('y', -0.035)] },
  ]));
  clips.push(locomotion('Walk', model.id === 'creature_volcanic_titan' ? 1.32 : 1.14, 1));
  clips.push(locomotion('Run', model.id === 'creature_volcanic_titan' ? 1.04 : 0.88, 1.58));

  const attackTimes = [0, 0.28, 0.62, 0.92, 1.24];
  clips.push(addClip(doc, buffer, boneNodes, 'Attack', 1.24, [
    { node: 'mixamorigHips', path: 'translation', times: attackTimes, values: [hip(rig.y(0.37)), hip(rig.y(0.355), rig.centerZ - h * 0.018), hip(rig.y(0.345), rig.centerZ + h * 0.045), hip(rig.y(0.355)), hip(rig.y(0.37))] },
    { node: 'mixamorigSpine1', times: attackTimes, values: [quat('x', 0), quat('x', -0.13), quat('x', 0.15), quat('x', 0.06), quat('x', 0)] },
    { node: 'mixamorigSpine2', times: attackTimes, values: [quat('x', 0), quat('x', -0.06), quat('x', 0.14), quat('x', 0.04), quat('x', 0)] },
    { node: 'mixamorigLeftShoulder', times: attackTimes, values: [quat('z', 0), quat('z', -0.22), quat('z', 0.18), quat('z', 0.08), quat('z', 0)] },
    { node: 'mixamorigRightShoulder', times: attackTimes, values: [quat('z', 0), quat('z', 0.22), quat('z', -0.18), quat('z', -0.08), quat('z', 0)] },
    { node: 'mixamorigLeftArm', times: attackTimes, values: [quat('z', 0), quat('z', -0.88), quat('z', 0.94), quat('z', 0.34), quat('z', 0)] },
    { node: 'mixamorigRightArm', times: attackTimes, values: [quat('z', 0), quat('z', 0.88), quat('z', -0.94), quat('z', -0.34), quat('z', 0)] },
    { node: 'mixamorigLeftForeArm', times: attackTimes, values: [quat('y', 0), quat('y', -0.16), quat('y', 0.42), quat('y', 0.15), quat('y', 0)] },
    { node: 'mixamorigRightForeArm', times: attackTimes, values: [quat('y', 0), quat('y', 0.16), quat('y', -0.42), quat('y', -0.15), quat('y', 0)] },
  ]));
  clips.push(addClip(doc, buffer, boneNodes, 'Hit', 0.52, [
    { node: 'mixamorigHips', path: 'translation', times: [0, 0.08, 0.22, 0.52], values: [hip(rig.y(0.37)), hip(rig.y(0.36), rig.centerZ - h * 0.035), hip(rig.y(0.365), rig.centerZ - h * 0.018), hip(rig.y(0.37))] },
    { node: 'mixamorigSpine1', times: [0, 0.08, 0.22, 0.52], values: [quat('x', 0), quat('x', -0.18), quat('x', 0.05), quat('x', 0)] },
    { node: 'mixamorigSpine2', times: [0, 0.08, 0.22, 0.52], values: [quat('z', 0), quat('z', 0.15), quat('z', -0.04), quat('z', 0)] },
    { node: 'mixamorigHead', times: [0, 0.08, 0.22, 0.52], values: [quat('x', 0), quat('x', 0.12), quat('x', -0.035), quat('x', 0)] },
    { node: 'mixamorigRightArm', times: [0, 0.08, 0.22, 0.52], values: [quat('z', 0), quat('z', -0.24), quat('z', 0.05), quat('z', 0)] },
  ]));
  const deathTimes = [0, 0.24, 0.72, 1.28, 1.82];
  clips.push(addClip(doc, buffer, boneNodes, 'Death', 1.82, [
    { node: 'mixamorigHips', path: 'translation', times: deathTimes, values: [hip(rig.y(0.37)), hip(rig.y(0.34), rig.centerZ - h * 0.025), hip(rig.y(0.24), rig.centerZ - h * 0.05), hip(rig.y(0.17), rig.centerZ - h * 0.08), hip(rig.y(0.17), rig.centerZ - h * 0.08)] },
    { node: 'mixamorigHips', times: deathTimes, values: [quat('z', 0), quat('z', -0.08), quat('z', -0.45), quat('z', -0.86), quat('z', -0.86)] },
    { node: 'mixamorigSpine1', times: deathTimes, values: [quat('x', 0), quat('x', 0.08), quat('x', 0.18), quat('x', 0.20), quat('x', 0.20)] },
    { node: 'mixamorigSpine2', times: deathTimes, values: [quat('x', 0), quat('x', 0.08), quat('x', 0.16), quat('x', 0.18), quat('x', 0.18)] },
    { node: 'mixamorigHead', times: deathTimes, values: [quat('z', 0), quat('z', 0.08), quat('z', 0.22), quat('z', 0.30), quat('z', 0.30)] },
    { node: 'mixamorigLeftArm', times: deathTimes, values: [quat('z', 0), quat('z', -0.20), quat('z', -0.52), quat('z', -0.60), quat('z', -0.60)] },
    { node: 'mixamorigRightArm', times: deathTimes, values: [quat('z', 0), quat('z', 0.14), quat('z', 0.42), quat('z', 0.50), quat('z', 0.50)] },
    { node: 'mixamorigLeftUpLeg', times: deathTimes, values: [quat('x', 0), quat('x', -0.08), quat('x', -0.24), quat('x', -0.28), quat('x', -0.28)] },
    { node: 'mixamorigRightUpLeg', times: deathTimes, values: [quat('x', 0), quat('x', 0.08), quat('x', 0.24), quat('x', 0.28), quat('x', 0.28)] },
  ]));
  return clips;
}

async function textureRecord(texture, role) {
  const image = texture.getImage();
  const meta = await sharp(image).metadata();
  return { name: texture.getName(), role, width: meta.width, height: meta.height, mime: texture.getMimeType(), bytes: image.length, sha256: sha256(image) };
}

async function downsampleMap(texture, role, sourceTextures, runtimeTextures) {
  const source = texture.getImage();
  const meta = await sharp(source).metadata();
  sourceTextures.push(await textureRecord(texture, role));
  if (meta.width !== 4096 || meta.height !== 4096) throw new Error('Expected the verified 4K source map for ' + texture.getName() + '; found ' + meta.width + 'x' + meta.height + '.');
  if (role === 'base-color') {
    texture.setMimeType('image/jpeg').setImage(await sharp(source).resize(2048, 2048, { fit: 'fill', kernel: 'lanczos3' }).jpeg({ quality: 94, chromaSubsampling: '4:4:4' }).toBuffer());
  } else if (role === 'normal') {
    const { data, info } = await sharp(source).resize(2048, 2048, { fit: 'fill', kernel: 'linear' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) throw new Error('Expected an RGB normal map, got ' + info.channels + ' channels.');
    for (let i = 0; i < data.length; i += 3) {
      let nx = data[i] / 127.5 - 1;
      let ny = data[i + 1] / 127.5 - 1;
      let nz = data[i + 2] / 127.5 - 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      data[i] = Math.round((nx + 1) * 127.5);
      data[i + 1] = Math.round((ny + 1) * 127.5);
      data[i + 2] = Math.round((nz + 1) * 127.5);
    }
    texture.setMimeType('image/png').setImage(await sharp(data, { raw: { width: 2048, height: 2048, channels: 3 } }).png({ compressionLevel: 8 }).toBuffer());
  } else {
    texture.setMimeType('image/png').setImage(await sharp(source).resize(2048, 2048, { fit: 'fill', kernel: 'linear' }).png({ compressionLevel: 8 }).toBuffer());
  }
  const record = await textureRecord(texture, role + (role === 'normal' ? ', vector averaged and renormalized' : ', 2K runtime derivative'));
  if (record.width !== 2048 || record.height !== 2048) throw new Error('Expected a 2K runtime map for ' + texture.getName() + '.');
  runtimeTextures.push(record);
}

async function makeEmissiveMap(baseTexture, model, doc) {
  const { data, info } = await sharp(baseTexture.getImage()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 2048 || info.height !== 2048 || info.channels !== 3) throw new Error('Expected a 2K RGB base-color map before deriving emission.');
  const output = Buffer.alloc(info.width * info.height * 3);
  let activePixels = 0;
  let strongPixels = 0;
  let coolPixels = 0;
  for (let i = 0; i < data.length; i += 3) {
    const red = data[i];
    const green = data[i + 1];
    const blue = data[i + 2];
    const warm = smoothstep(42, 104, red) * smoothstep(9, 57, red - green) * smoothstep(18, 76, red - blue);
    const cool = model.blueStarlight
      ? smoothstep(45, 94, blue) * smoothstep(4, 48, blue - red) * smoothstep(2, 32, blue - green)
      : 0;
    const intensity = Math.max(warm, cool);
    if (intensity > 0.04) activePixels += 1;
    if (intensity > 0.55) strongPixels += 1;
    if (cool > 0.08) coolPixels += 1;
    output[i] = Math.round(red * intensity);
    output[i + 1] = Math.round(green * intensity);
    output[i + 2] = Math.round(blue * intensity);
  }
  const png = await sharp(output, { raw: { width: info.width, height: info.height, channels: 3 } }).png({ compressionLevel: 8 }).toBuffer();
  const texture = doc.createTexture(model.id + '_source-derived-emissive.png').setMimeType('image/png').setImage(png);
  const total = info.width * info.height;
  return {
    texture,
    metrics: {
      width: info.width,
      height: info.height,
      bytes: png.length,
      sha256: sha256(png),
      method: '2K emission mask derived from the source Tripo base-color map; warm magma pixels are isolated by red/orange hue and brightness, with cool blue starlight pixels included for the Titan.',
      activePixelFraction: activePixels / total,
      strongPixelFraction: strongPixels / total,
      coolStarlightPixelFraction: coolPixels / total,
      reviewStatus: 'pending neutral and angled light review in the production creature lab',
    },
  };
}

function pbrChannelRanges(image) {
  return sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => {
    if (info.channels < 3) throw new Error('Packed metallic-roughness map has fewer than 3 channels.');
    const roughness = [1, 0];
    const metallic = [1, 0];
    for (let i = 0; i < data.length; i += info.channels) {
      const rough = data[i + 1] / 255;
      const metal = data[i + 2] / 255;
      roughness[0] = Math.min(roughness[0], rough);
      roughness[1] = Math.max(roughness[1], rough);
      metallic[0] = Math.min(metallic[0], metal);
      metallic[1] = Math.max(metallic[1], metal);
    }
    return { roughness, metallic };
  });
}

async function buildCandidate(model) {
  const sourceBytes = await readFile(model.sourcePath);
  const actualSourceHash = sha256(sourceBytes);
  if (actualSourceHash !== model.sourceHash) throw new Error(model.displayName + ' source hash changed: ' + actualSourceHash);
  const doc = await io.readBinary(sourceBytes);
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const mesh = root.listMeshes()[0];
  const primitive = mesh?.listPrimitives()[0];
  const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
  const sourceSkin = root.listSkins()[0];
  if (!scene || !primitive || !meshNode || root.listSkins().length > 1 || root.listAnimations().length) {
    throw new Error('Expected the exact starred static/no-clip export for ' + model.displayName + '.');
  }
  const positions = Float32Array.from(primitive.getAttribute('POSITION')?.getArray() ?? []);
  const normals = Float32Array.from(primitive.getAttribute('NORMAL')?.getArray() ?? []);
  const uvs = Float32Array.from(primitive.getAttribute('TEXCOORD_0')?.getArray() ?? []);
  const indices = Uint32Array.from(primitive.getIndices()?.getArray() ?? []);
  const expected = model.id === 'creature_volcanic_titan' ? { vertices: 5897, triangles: 8502 } : { vertices: 5643, triangles: 8467 };
  if (positions.length / 3 !== expected.vertices || indices.length / 3 !== expected.triangles || normals.length !== positions.length || uvs.length / 2 !== positions.length / 3) {
    throw new Error('Source mesh contract changed for ' + model.displayName + ': ' + positions.length / 3 + ' vertices, ' + indices.length / 3 + ' triangles.');
  }
  const sourceBounds = boundsOf(positions);
  if (sourceBounds.min[1] !== 0 || sourceBounds.max[1] < 0.9 || sourceBounds.max[1] > 1.05) throw new Error('Unexpected Y-up source bounds for ' + model.displayName + '.');
  const originalSourceSkin = sourceSkin ? {
    joints: sourceSkin.listJoints().length,
    inverseBindMatrices: sourceSkin.getInverseBindMatrices()?.getCount() ?? 0,
  } : null;
  let sourceWeightAudit = null;
  if (sourceSkin) {
    const sourceJoints = primitive.getAttribute('JOINTS_0')?.getArray();
    const sourceWeights = primitive.getAttribute('WEIGHTS_0')?.getArray();
    if (!sourceJoints || !sourceWeights) throw new Error('Titan source skin is missing its weight accessors.');
    const jointNames = sourceSkin.listJoints();
    let rootWeightedVertices = 0;
    let maximumSumError = 0;
    for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
      let sum = 0;
      for (let slot = 0; slot < 4; slot += 1) {
        const index = sourceJoints[vertex * 4 + slot];
        const weight = sourceWeights[vertex * 4 + slot];
        sum += weight;
        if (index === 0 && weight > 0.999) rootWeightedVertices += 1;
      }
      maximumSumError = Math.max(maximumSumError, Math.abs(1 - sum));
    }
    sourceWeightAudit = { joints: jointNames.length, rootWeightedVertices, maximumSumError, identityLocalTransforms: jointNames.every((joint) => joint.getTranslation().every((value) => value === 0)) };
    if (sourceWeightAudit.rootWeightedVertices < positions.length / 3 * 0.99 || !sourceWeightAudit.identityLocalTransforms) throw new Error('Titan source rig profile no longer matches the documented unusable bind/weight data.');
  }

  const sourceMaterial = root.listMaterials()[0];
  const baseTexture = sourceMaterial?.getBaseColorTexture();
  const mrTexture = sourceMaterial?.getMetallicRoughnessTexture();
  const normalTexture = sourceMaterial?.getNormalTexture();
  if (!sourceMaterial || root.listMaterials().length !== 1 || !baseTexture || !mrTexture || !normalTexture) throw new Error(model.displayName + ' is missing its base-color, packed PBR, or normal map.');
  const sourceTextures = [];
  const runtimeTextures = [];
  await downsampleMap(baseTexture, 'base-color', sourceTextures, runtimeTextures);
  await downsampleMap(mrTexture, 'metallic-roughness', sourceTextures, runtimeTextures);
  await downsampleMap(normalTexture, 'normal', sourceTextures, runtimeTextures);
  const pbrRanges = await pbrChannelRanges(mrTexture.getImage());
  if (pbrRanges.roughness[1] - pbrRanges.roughness[0] < 0.25 || pbrRanges.metallic[1] - pbrRanges.metallic[0] < 0.05) {
    throw new Error(model.displayName + ' source packed PBR map lost channel variation.');
  }
  const emission = await makeEmissiveMap(baseTexture, model, doc);
  sourceMaterial.setEmissiveTexture(emission.texture).setEmissiveFactor(model.emissiveFactor);
  runtimeTextures.push({ name: emission.texture.getName(), role: 'source-derived emissive', width: emission.metrics.width, height: emission.metrics.height, mime: 'image/png', bytes: emission.metrics.bytes, sha256: emission.metrics.sha256 });

  const rig = rigFor(sourceBounds, model.profile);
  const originalNodes = [...root.listNodes()];
  const originalParent = meshNode.getParentNode();
  if (originalParent) originalParent.removeChild(meshNode);
  else if (scene.listChildren().includes(meshNode)) scene.removeChild(meshNode);
  else throw new Error(model.displayName + ' source mesh node is detached from its scene.');
  for (const semantic of ['JOINTS_0', 'WEIGHTS_0', 'JOINTS_1', 'WEIGHTS_1']) primitive.setAttribute(semantic, null);
  meshNode.setSkin(null).setName(model.id + '_Mesh').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  for (const sourceSkinEntry of [...root.listSkins()]) sourceSkinEntry.dispose();
  for (const node of originalNodes) if (node !== meshNode) node.dispose();

  const presentationRoot = doc.createNode(model.id + '_Presentation').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([model.modelScale, model.modelScale, model.modelScale]);
  const rigContainer = doc.createNode(model.id + '_Armature').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  scene.addChild(presentationRoot);
  presentationRoot.addChild(rigContainer);
  rigContainer.addChild(meshNode);
  const boneNodes = new Map();
  for (const bone of rig.bones) {
    const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    boneNodes.set(bone.name, node);
    const parent = bone.parent ? boneNodes.get(bone.parent) : rigContainer;
    parent.addChild(node);
  }
  const skin = doc.createSkin(model.id + '_Humanoid').setSkeleton(boneNodes.get('mixamorigHips'));
  for (const bone of rig.bones) skin.addJoint(boneNodes.get(bone.name));
  const inverseBinds = new Float32Array(rig.bones.length * 16);
  for (let i = 0; i < rig.bones.length; i += 1) {
    const [x, y, z] = rig.bones[i].p;
    inverseBinds.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
  }
  const buffer = root.listBuffers()[0];
  skin.setInverseBindMatrices(doc.createAccessor(model.id + '_InverseBind').setArray(inverseBinds).setType(Accessor.Type.MAT4).setBuffer(buffer));
  meshNode.setSkin(skin);
  const rigMetrics = assignWeights(primitive, positions, rig, model.profile, doc, buffer);
  const clips = authorClips(doc, buffer, boneNodes, rig, model);

  const outputBytes = await io.writeBinary(doc);
  await writeFile(baseDir + '/' + model.candidateFile, outputBytes);
  const candidateHash = sha256(outputBytes);
  const check = await io.readBinary(outputBytes);
  const checkRoot = check.getRoot();
  const checkPrimitive = checkRoot.listMeshes()[0]?.listPrimitives()[0];
  const checkSkin = checkRoot.listSkins()[0];
  const outPositions = checkPrimitive?.getAttribute('POSITION')?.getArray();
  const outNormals = checkPrimitive?.getAttribute('NORMAL')?.getArray();
  const outUvs = checkPrimitive?.getAttribute('TEXCOORD_0')?.getArray();
  const outIndices = checkPrimitive?.getIndices()?.getArray();
  const outJoints = checkPrimitive?.getAttribute('JOINTS_0')?.getArray();
  const outWeights = checkPrimitive?.getAttribute('WEIGHTS_0')?.getArray();
  if (!outPositions || !outNormals || !outUvs || !outIndices || !outJoints || !outWeights || !checkSkin) throw new Error(model.displayName + ' GLB lacks output render, UV, or rig attributes.');
  if (outPositions.length !== positions.length || outNormals.length !== normals.length || outUvs.length !== uvs.length || outIndices.length !== indices.length) throw new Error(model.displayName + ' output mesh buffer lengths changed.');
  for (let i = 0; i < positions.length; i += 1) {
    if (outPositions[i] !== positions[i] || outNormals[i] !== normals[i] || outUvs[i] !== uvs[i]) throw new Error(model.displayName + ' changed a position, normal, or UV value at scalar ' + i + '.');
  }
  for (let i = 0; i < indices.length; i += 1) if (outIndices[i] !== indices[i]) throw new Error(model.displayName + ' changed its triangle index at ' + i + '.');
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    let sum = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      const joint = outJoints[vertex * 4 + slot];
      const weight = outWeights[vertex * 4 + slot];
      if (!Number.isInteger(joint) || joint < 0 || joint >= checkSkin.listJoints().length || !Number.isFinite(weight) || weight < 0) throw new Error(model.displayName + ' has an invalid skin influence at vertex ' + vertex + '.');
      sum += weight;
    }
    if (Math.abs(sum - 1) > 1e-5) throw new Error(model.displayName + ' has an unnormalized weight at vertex ' + vertex + ': ' + sum + '.');
  }
  const outputClipNames = checkRoot.listAnimations().map((animation) => animation.getName());
  if (requiredClips.some((name) => !outputClipNames.includes(name))) throw new Error(model.displayName + ' output is missing a required lifecycle clip.');
  for (const animation of checkRoot.listAnimations()) for (const channel of animation.listChannels()) {
    if (!checkSkin.listJoints().includes(channel.getTargetNode())) throw new Error(model.displayName + ' animation ' + animation.getName() + ' targets a node outside its skin.');
  }
  for (const texture of checkRoot.listTextures()) {
    const meta = await sharp(texture.getImage()).metadata();
    if (meta.width !== 2048 || meta.height !== 2048) throw new Error(model.displayName + ' output texture is not 2K: ' + texture.getName());
  }

  const targetBounds = scaledBounds(sourceBounds, model.modelScale);
  const candidatePath = baseDir + '/' + model.candidateFile;
  const candidate = {
    schema: 'corealm-creature-native-rig-candidate/1',
    id: model.id,
    displayName: model.displayName,
    status: 'awaiting-root-lab-review',
    accepted: false,
    recommendedTier: model.tier,
    recommendedWorldRole: model.worldRole,
    source: {
      file: model.sourcePath,
      sha256: actualSourceHash,
      bytes: sourceBytes.length,
      starredModelId: model.sourceModelId,
      starredCardId: model.sourceCardId,
      starredTitle: model.sourceTitle,
      exactPrompt: model.prompt,
      geometry: { vertices: positions.length / 3, triangles: indices.length / 3, bounds: sourceBounds, positionsPreserved: true, indicesPreserved: true, normalsPreserved: true, uvsPreserved: true, retopology: false },
      rigReview: model.sourceRigReview,
      sourceSkin: originalSourceSkin,
      sourceWeightAudit,
      sourceAnimations: [],
      textures: sourceTextures,
      sourceMaterialFactors: { metallic: sourceMaterial.getMetallicFactor(), roughness: sourceMaterial.getRoughnessFactor(), emissive: [0, 0, 0] },
      sourcePbrMapRanges: pbrRanges,
    },
    candidate: {
      file: candidatePath,
      sha256: candidateHash,
      bytes: outputBytes.length,
      productionTarget: 'game/public/assets/' + model.targetFile,
      recommendedPresentationScale: model.modelScale,
      geometry: { vertices: positions.length / 3, triangles: indices.length / 3, positionsPreserved: true, indicesPreserved: true, normalsPreserved: true, uvsPreserved: true },
      rig: { type: 'Mixamo-named Unity Humanoid glTF skin', jointCount: rig.bones.length, ...rigMetrics, method: 'Source-fitted 22-joint humanoid rig with four-weight anatomical distance fields; source skin is replaced when absent or unusable, with original vertex data and UVs unchanged.' },
      textures: runtimeTextures,
      pbr: 'Original Tripo base-color, packed metallic-roughness and tangent-space normal maps, all downsampled to 2K. The derived 2K emissive mask isolates molten colors already present in the source base-color map.',
      emissive: emission.metrics,
      pbrMapRanges: pbrRanges,
      animations: clips,
    },
    acceptance: { sourceDesignAudit: false, geometry: true, rig: false, animation: false, textures: false, labAccepted: false, worldIntegrated: false },
  };
  return { model, candidate, candidateHash, candidatePath, outputBytes, clips, sourceBounds, targetBounds, rigMetrics, runtimeTextures, pbrRanges, materialName: sourceMaterial.getName() };
}

const results = [];
for (const model of sourceRows) results.push(await buildCandidate(model));
const candidates = results.map((result) => result.candidate);
await writeFile(baseDir + '/catalog.json', JSON.stringify({ schema: 'corealm-starred-creature-candidates/1', candidates }, null, 2) + '\n');

const labAssets = results.map((result) => {
  const model = result.model;
  const bounds = result.targetBounds;
  const size = bounds.max.map((value, axis) => value - bounds.min[axis]);
  return {
    id: model.id,
    file: model.targetFile,
    candidateFile: result.candidatePath,
    pack: packId,
    category: 'character',
    is: model.displayName + ' starred creature candidate',
    tags: ['creature', 'volcanic', 'obsidian', 'magma', model.tier.toLowerCase(), 'starred', 'tripo', 'candidate', 'skinned', 'articulated'],
    bytes: result.outputBytes.length,
    sha256: result.candidateHash,
    size: { x: size[0], y: size[1], z: size[2] },
    base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
    bounds,
    groundY: bounds.min[1],
    triangles: result.candidate.source.geometry.triangles,
    vertices: result.candidate.source.geometry.vertices,
    animations: result.clips.map((clip) => clip.name),
    materials: [result.materialName],
    sourceProvenance: {
      author: 'Starred Tripo export; Corealm source-specific rig, motion and material adaptation',
      sourceModelId: model.sourceModelId,
      sourceCardId: model.sourceCardId,
      exactPrompt: model.prompt,
      sourceFile: model.sourcePath,
      sourceSha256: model.sourceHash,
      candidateFile: result.candidatePath,
      candidateSha256: result.candidateHash,
      rigMethod: '22-joint Mixamo-named Unity Humanoid rig; four-weight spatial influence fields; source mesh data retained.',
      texturePolicy: 'Preserve original image-generated source art and all Tripo PBR maps; resize to 2K and derive emissive only from colored molten seams already in the base map.',
      candidateStatus: 'awaiting-root-lab-review',
      recommendedTier: model.tier,
      recommendedPresentationScale: model.modelScale,
    },
    acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false },
  };
});
const labCatalog = {
  schema: 'corealm-lab-asset-candidates/1',
  pack: { id: packId, name: 'Corealm starred creatures', author: 'Corealm', source: 'Tripo Studio source exports and Corealm candidate rig/material adaptation', license: 'LicenseRef-Tripo-Generated' },
  assets: labAssets,
  files: Object.fromEntries(results.map((result) => [result.model.id, result.model.candidateFile])),
};
await writeFile(baseDir + '/lab-catalog.json', JSON.stringify(labCatalog, null, 2) + '\n');
console.log(JSON.stringify(results.map((result) => ({
  id: result.model.id,
  candidatePath: result.candidatePath,
  candidateBytes: result.outputBytes.length,
  candidateSha256: result.candidateHash,
  sourceHash: result.model.sourceHash,
  vertices: result.candidate.source.geometry.vertices,
  triangles: result.candidate.source.geometry.triangles,
  joints: result.rigMetrics.bones.length,
  distributedVertices: result.rigMetrics.distributedVertices,
  textureDimensions: result.runtimeTextures.map((texture) => [texture.name, texture.width, texture.height]),
  pbrMapRanges: result.pbrRanges,
  emissive: result.candidate.candidate.emissive,
  animations: result.clips,
})), null, 2));
