import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const ownerDir = 'assets/art/tripo/imports/creatures/starred-frog';
const sourceFile = 'assets/art/tripo/exports/8a71752f-b4b8-4625-874f-220bbde13412.glb';
const candidateName = 'glasspond-frog-native-rig-candidate.glb';
const candidateFile = `${ownerDir}/${candidateName}`;
const expectedSourceSha = '6fc433ee3a16adec6c1e2b2aad4b1e1e2c8c807161c99b2fc33d04f94187c97d';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sourceBytes = await readFile(sourceFile);
const sourceSha = sha(sourceBytes);
if (sourceSha !== expectedSourceSha) throw new Error(`Starred frog source hash mismatch: ${sourceSha}`);
const doc = await io.readBinary(sourceBytes);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
const rigContainer = meshNode?.getParentNode();
if (!scene || !mesh || !primitive || !meshNode || !rigContainer || root.listMeshes().length !== 1 || mesh.listPrimitives().length !== 1) {
  throw new Error('Expected the approved single-mesh Glasspond Frog export.');
}
if (root.listAnimations().length) throw new Error('The pinned source unexpectedly gained animation channels.');
const positionsAccessor = primitive.getAttribute('POSITION');
const indexAccessor = primitive.getIndices();
const positions = positionsAccessor?.getArray();
const indices = indexAccessor?.getArray();
if (!(positions instanceof Float32Array) || !indices) throw new Error('Expected indexed float-position geometry.');
const vertexCount = positions.length / 3;
const triangleCount = indices.length / 3;
if (vertexCount !== 2414 || triangleCount !== 3811) throw new Error(`Pinned source topology changed: ${vertexCount} vertices / ${triangleCount} triangles.`);
const geometryAttributeNames = ['POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0'];
const sourceAttributes = new Map(geometryAttributeNames.flatMap((name) => {
  const attribute = primitive.getAttribute(name);
  return attribute ? [[name, Array.from(attribute.getArray())]] : [];
}));
const sourceBounds = boundsOf(positions);
const sourceSkin = meshNode.getSkin();
if (!sourceSkin || sourceSkin.listJoints().length !== 7) throw new Error('Expected the broken seven-joint source rig for replacement.');

// The source is a forward-facing +X frog, with Y up and Z across its shoulders.
// These generic bones form a belly-spine chain plus real four-limbed frog anatomy.
const bones = [
  { name: 'GlasspondRoot', parent: null, p: [-0.12, 0.39, 0], group: 'root', sigma: 0.22 },
  { name: 'Pelvis', parent: 'GlasspondRoot', p: [-0.15, 0.40, 0], group: 'body', sigma: 0.22 },
  { name: 'Spine', parent: 'Pelvis', p: [-0.01, 0.47, 0], group: 'body', sigma: 0.23 },
  { name: 'Chest', parent: 'Spine', p: [0.12, 0.53, 0], group: 'body', sigma: 0.20 },
  { name: 'Neck', parent: 'Chest', p: [0.28, 0.66, 0], group: 'head', sigma: 0.15 },
  { name: 'Head', parent: 'Neck', p: [0.39, 0.79, 0], group: 'head', sigma: 0.14 },
  { name: 'Jaw', parent: 'Head', p: [0.435, 0.715, 0], group: 'head', sigma: 0.085 },
  { name: 'ForeHip_L', parent: 'Chest', p: [0.10, 0.38, -0.15], group: 'foreL', sigma: 0.14 },
  { name: 'ForeKnee_L', parent: 'ForeHip_L', p: [0.08, 0.22, -0.24], group: 'foreL', sigma: 0.13 },
  { name: 'ForeAnkle_L', parent: 'ForeKnee_L', p: [0.23, 0.085, -0.34], group: 'foreL', sigma: 0.105 },
  { name: 'ForeFoot_L', parent: 'ForeAnkle_L', p: [0.34, 0.026, -0.405], group: 'foreL', sigma: 0.11 },
  { name: 'ForeHip_R', parent: 'Chest', p: [0.10, 0.38, 0.15], group: 'foreR', sigma: 0.14 },
  { name: 'ForeKnee_R', parent: 'ForeHip_R', p: [0.08, 0.22, 0.24], group: 'foreR', sigma: 0.13 },
  { name: 'ForeAnkle_R', parent: 'ForeKnee_R', p: [0.23, 0.085, 0.34], group: 'foreR', sigma: 0.105 },
  { name: 'ForeFoot_R', parent: 'ForeAnkle_R', p: [0.34, 0.026, 0.405], group: 'foreR', sigma: 0.11 },
  { name: 'HindHip_L', parent: 'Pelvis', p: [-0.29, 0.40, -0.17], group: 'hindL', sigma: 0.17 },
  { name: 'HindKnee_L', parent: 'HindHip_L', p: [-0.43, 0.275, -0.285], group: 'hindL', sigma: 0.16 },
  { name: 'HindHock_L', parent: 'HindKnee_L', p: [-0.265, 0.13, -0.365], group: 'hindL', sigma: 0.125 },
  { name: 'HindFoot_L', parent: 'HindHock_L', p: [-0.105, 0.026, -0.43], group: 'hindL', sigma: 0.12 },
  { name: 'HindHip_R', parent: 'Pelvis', p: [-0.29, 0.40, 0.17], group: 'hindR', sigma: 0.17 },
  { name: 'HindKnee_R', parent: 'HindHip_R', p: [-0.43, 0.275, 0.285], group: 'hindR', sigma: 0.16 },
  { name: 'HindHock_R', parent: 'HindKnee_R', p: [-0.265, 0.13, 0.365], group: 'hindR', sigma: 0.125 },
  { name: 'HindFoot_R', parent: 'HindHock_R', p: [-0.105, 0.026, 0.43], group: 'hindR', sigma: 0.12 },
];
const boneIndex = new Map(bones.map((bone, index) => [bone.name, index]));
for (const bone of bones) {
  const parent = bone.parent ? bones[boneIndex.get(bone.parent)] : null;
  bone.local = parent ? bone.p.map((component, axis) => component - parent.p[axis]) : bone.p;
}

// Replace only skinning data. Mesh topology, positions, source UV layout and source
// image-generated surface detail remain intact.
primitive.setAttribute('JOINTS_0', null);
primitive.setAttribute('WEIGHTS_0', null);
meshNode.setSkin(null);
for (const child of rigContainer.listChildren()) rigContainer.removeChild(child);
sourceSkin.dispose();
meshNode.setName('GlasspondFrogMesh');
rigContainer.setName('GlasspondFrogRigContainer').setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
rigContainer.addChild(meshNode);

const nodes = new Map();
for (const bone of bones) {
  const node = doc.createNode(bone.name).setTranslation(bone.local).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  nodes.set(bone.name, node);
  const parent = bone.parent ? nodes.get(bone.parent) : rigContainer;
  parent.addChild(node);
}
const skin = doc.createSkin('GlasspondFrog_GenericAmphibian').setSkeleton(nodes.get('GlasspondRoot'));
for (const bone of bones) skin.addJoint(nodes.get(bone.name));
const inverseBind = new Float32Array(bones.length * 16);
for (let i = 0; i < bones.length; i++) {
  const [x, y, z] = bones[i].p;
  inverseBind.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
}
const buffer = root.listBuffers()[0];
skin.setInverseBindMatrices(doc.createAccessor('GlasspondFrog_InverseBindMatrices').setArray(inverseBind).setType(Accessor.Type.MAT4).setBuffer(buffer));
meshNode.setSkin(skin);

const segmentDistance = (point, start, end) => {
  const v = end.map((value, axis) => value - start[axis]);
  const length2 = v.reduce((sum, value) => sum + value * value, 0) || 1;
  const t = Math.max(0, Math.min(1, point.reduce((sum, value, axis) => sum + (value - start[axis]) * v[axis], 0) / length2));
  return Math.hypot(...point.map((value, axis) => value - (start[axis] + v[axis] * t)));
};
const bodyGroups = new Set(['body', 'head']);
const limbGroups = new Set(['foreL', 'foreR', 'hindL', 'hindR']);
const jointValues = new Uint16Array(vertexCount * 4);
const weightValues = new Float32Array(vertexCount * 4);
const influenceVertices = new Uint32Array(bones.length);
let multiWeightVertices = 0;
for (let vertex = 0; vertex < vertexCount; vertex++) {
  const point = [positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]];
  const [x, y, z] = point;
  const sideSuffix = z < 0 ? 'L' : 'R';
  const limbSet = x < -0.04 ? `hind${sideSuffix}` : `fore${sideSuffix}`;
  const candidates = [];
  for (let index = 1; index < bones.length; index++) {
    const bone = bones[index];
    if (limbGroups.has(bone.group) && (bone.group !== limbSet || y > 0.48)) continue;
    if (bone.group === 'head' && (x < 0.08 || y < 0.47)) continue;
    if (bone.group === 'body' && x > 0.40) continue;
    const parent = bone.parent ? bones[boneIndex.get(bone.parent)] : null;
    const start = parent?.p ?? bone.p;
    const distance = segmentDistance(point, start, bone.p);
    const sigma = bone.sigma;
    const maximumReach = bone.group === 'body' ? 0.54 : bone.group === 'head' ? 0.38 : 0.26;
    if (distance > maximumReach) continue;
    let score = Math.exp(-0.5 * (distance / sigma) ** 2);
    if (limbGroups.has(bone.group)) score *= 1.35;
    if (bone.group === 'head' && x > 0.26) score *= 1.25;
    if (bodyGroups.has(bone.group) && y > 0.38) score *= 1.15;
    candidates.push({ index, score, distance, group: bone.group });
  }
  if (!candidates.length) {
    // A head-side surface may be outside the conservative reach cutoff; use the closest
    // proper anatomical segment, never the old Tripo root-only fallback.
    for (let index = 1; index < bones.length; index++) {
      const bone = bones[index];
      const parent = bone.parent ? bones[boneIndex.get(bone.parent)] : null;
      candidates.push({ index, score: 1 / (1 + segmentDistance(point, parent?.p ?? bone.p, bone.p)), distance: 0, group: bone.group });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const chosen = candidates.slice(0, 4);
  const total = chosen.reduce((sum, item) => sum + item.score, 0);
  let assigned = 0;
  for (let slot = 0; slot < 4; slot++) {
    const item = chosen[slot];
    if (!item) continue;
    const weight = slot === chosen.length - 1 ? 1 - assigned : item.score / total;
    jointValues[vertex * 4 + slot] = item.index;
    weightValues[vertex * 4 + slot] = weight;
    assigned += weight;
    influenceVertices[item.index]++;
  }
  if (chosen.filter((item, slot) => weightValues[vertex * 4 + slot] > 1e-5).length > 1) multiWeightVertices++;
}
primitive.setAttribute('JOINTS_0', doc.createAccessor('GlasspondFrog_Joints0').setArray(jointValues).setType(Accessor.Type.VEC4).setBuffer(buffer));
primitive.setAttribute('WEIGHTS_0', doc.createAccessor('GlasspondFrog_Weights0').setArray(weightValues).setType(Accessor.Type.VEC4).setBuffer(buffer));

const material = primitive.getMaterial();
if (!material?.getBaseColorTexture() || !material.getNormalTexture() || !material.getMetallicRoughnessTexture()) {
  throw new Error('Approved source is missing one of the layered base-color, normal or metallic-roughness maps.');
}
const baseTexture = material.getBaseColorTexture();
const normalTexture = material.getNormalTexture();
const packedTexture = material.getMetallicRoughnessTexture();
const sourceTextures = await Promise.all(root.listTextures().map(async (texture) => {
  const image = texture.getImage();
  const dimensions = await sharp(image).metadata();
  return { name: texture.getName(), bytes: image.length, dimensions: [dimensions.width, dimensions.height], mime: texture.getMimeType(), sha256: sha(image) };
}));
const runtimeTextures = [];
for (const texture of [baseTexture, packedTexture, normalTexture]) {
  const image = texture.getImage();
  const meta = await sharp(image).metadata();
  if (meta.width === 2048 && meta.height === 2048) continue;
  if (texture === baseTexture) {
    texture.setImage(await sharp(image).resize(2048, 2048, { fit: 'fill', kernel: 'lanczos3' }).jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer());
    runtimeTextures.push({ name: texture.getName(), role: 'image-generated layered base color', method: 'Lanczos 3 downsample', original: [meta.width, meta.height], runtime: [2048, 2048] });
  } else {
    const raw = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (raw.info.channels !== 3 || raw.info.width % 2 || raw.info.height % 2 || raw.info.width / 2 !== 2048 || raw.info.height / 2 !== 2048) {
      throw new Error(`Unexpected data-map dimensions: ${raw.info.width}x${raw.info.height}x${raw.info.channels}.`);
    }
    const down = Buffer.alloc(2048 * 2048 * 3);
    for (let y = 0; y < 2048; y++) for (let x = 0; x < 2048; x++) {
      const out = (y * 2048 + x) * 3;
      const src = ((y * 2) * raw.info.width + x * 2) * 3;
      for (let channel = 0; channel < 3; channel++) {
        let value = (raw.data[src + channel] + raw.data[src + 3 + channel] + raw.data[src + raw.info.width * 3 + channel] + raw.data[src + raw.info.width * 3 + 3 + channel]) / 4;
        if (texture === normalTexture) {
          const vector = channel === 0 ? [value / 127.5 - 1, ((raw.data[src + 1] + raw.data[src + 4] + raw.data[src + raw.info.width * 3 + 1] + raw.data[src + raw.info.width * 3 + 4]) / 4) / 127.5 - 1, ((raw.data[src + 2] + raw.data[src + 5] + raw.data[src + raw.info.width * 3 + 2] + raw.data[src + raw.info.width * 3 + 5]) / 4) / 127.5 - 1] : null;
          if (channel === 0) {
            const length = Math.hypot(...vector) || 1;
            down[out] = Math.round((vector[0] / length + 1) * 127.5);
            down[out + 1] = Math.round((vector[1] / length + 1) * 127.5);
            down[out + 2] = Math.round((vector[2] / length + 1) * 127.5);
          }
        } else down[out + channel] = Math.round(value);
      }
    }
    if (texture === normalTexture) {
      texture.setImage(await sharp(down, { raw: { width: 2048, height: 2048, channels: 3 } }).jpeg({ quality: 96, chromaSubsampling: '4:4:4' }).toBuffer());
      runtimeTextures.push({ name: texture.getName(), role: 'normal map, vector-averaged and renormalized', method: '2x2 average then unit-length renormalize', original: [meta.width, meta.height], runtime: [2048, 2048] });
    } else {
      texture.setImage(await sharp(down, { raw: { width: 2048, height: 2048, channels: 3 } }).png({ compressionLevel: 8 }).toBuffer());
      runtimeTextures.push({ name: texture.getName(), role: 'packed linear metallic-roughness map', method: '2x2 channel average', original: [meta.width, meta.height], runtime: [2048, 2048] });
    }
  }
}
// Living wet skin is a dielectric. The original roughness texture remains active and
// layered, while a zero metallic factor avoids gold/metal response from stray blue-map texels.
material.setMetallicFactor(0).setRoughnessFactor(1);

const q = (axis, angle) => {
  const s = Math.sin(angle / 2), c = Math.cos(angle / 2);
  return axis === 'x' ? [s, 0, 0, c] : axis === 'y' ? [0, s, 0, c] : [0, 0, s, c];
};
const qMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const quatTrack = (node, times, axis, angles) => ({ node, path: 'rotation', type: Accessor.Type.VEC4, times, values: angles.map((angle) => q(axis, angle)) });
const vecTrack = (node, times, values) => ({ node, path: 'translation', type: Accessor.Type.VEC3, times, values });
function addTrack(animation, definition) {
  const input = doc.createAccessor(`${animation.name}_${definition.node}_${definition.path}_time`).setArray(new Float32Array(definition.times)).setType(Accessor.Type.SCALAR).setBuffer(buffer);
  const output = doc.createAccessor(`${animation.name}_${definition.node}_${definition.path}_value`).setArray(new Float32Array(definition.values.flat())).setType(definition.type).setBuffer(buffer);
  const sampler = doc.createAnimationSampler(`${animation.name}_${definition.node}_${definition.path}`).setInput(input).setOutput(output).setInterpolation('LINEAR');
  const channel = doc.createAnimationChannel(`${definition.node}_${definition.path}`).setTargetNode(nodes.get(definition.node)).setTargetPath(definition.path).setSampler(sampler);
  animation.addSampler(sampler).addChannel(channel);
}
const clipRecords = [];
function addClip(name, duration, tracks) {
  const animation = doc.createAnimation(name);
  for (const track of tracks) addTrack(animation, track);
  clipRecords.push({ name, seconds: duration, channels: tracks.length, tracks });
}
const rootBase = bones[0].p;
const rootAt = (xDelta = 0, yDelta = 0, zDelta = 0) => [rootBase[0] + xDelta, rootBase[1] + yDelta, rootBase[2] + zDelta];

// Idle is a quiet living frog: minute throat breathing, a slow head check and a blink-like jaw.
{
  const t = [0, 0.6, 1.2, 1.8, 2.4];
  addClip('Idle', 2.4, [
    vecTrack('GlasspondRoot', t, [rootAt(), rootAt(0, 0.012), rootAt(0, 0.018), rootAt(0, 0.01), rootAt()]),
    quatTrack('Chest', t, 'x', [0, -0.012, 0, 0.012, 0]),
    quatTrack('Neck', t, 'y', [-0.018, 0, 0.02, 0, -0.018]),
    quatTrack('Head', t, 'y', [-0.02, 0.01, 0.025, -0.005, -0.02]),
    quatTrack('Jaw', t, 'z', [0, 0.018, 0, -0.012, 0]),
  ]);
}

// Walk is a low, deliberate alternating crawl; the diagonal pairs take turns and the belly stays near ground.
{
  const t = [0, 0.28, 0.56, 0.84, 1.12];
  const phases = t.map((_, i) => i / 4 * Math.PI * 2);
  const tracks = [
    vecTrack('GlasspondRoot', t, [0, 1, 2, 3, 4].map((i) => rootAt(0, [0, 0.012, 0, 0.012, 0][i]))),
    quatTrack('Pelvis', t, 'x', [0, 0.018, 0, -0.018, 0]),
    quatTrack('Chest', t, 'z', [0, 0.012, 0, -0.012, 0]),
  ];
  for (const side of ['L', 'R']) {
    const sign = side === 'L' ? 1 : -1;
    const phase = phases.map((angle) => angle + (side === 'R' ? Math.PI : 0));
    const oscillation = phase.map(Math.sin);
    const opposite = phase.map((angle) => Math.sin(angle + Math.PI));
    tracks.push(quatTrack(`ForeHip_${side}`, t, 'z', oscillation.map((value) => sign * value * 0.12)));
    tracks.push(quatTrack(`ForeKnee_${side}`, t, 'z', oscillation.map((value) => -Math.max(0, value) * 0.22)));
    tracks.push(quatTrack(`ForeAnkle_${side}`, t, 'z', oscillation.map((value) => -value * 0.07)));
    tracks.push(quatTrack(`HindHip_${side}`, t, 'z', opposite.map((value) => sign * value * 0.20)));
    tracks.push(quatTrack(`HindKnee_${side}`, t, 'z', opposite.map((value) => -Math.max(0, value) * 0.31)));
    tracks.push(quatTrack(`HindHock_${side}`, t, 'z', opposite.map((value) => value * 0.10)));
    tracks.push(quatTrack(`HindFoot_${side}`, t, 'z', opposite.map((value) => -value * 0.05)));
  }
  addClip('Walk', 1.12, tracks);
}

// Run is a frog's loading crouch, synchronous hind-leg push, short flight, and two-front-foot landing.
{
  const t = [0, 0.14, 0.30, 0.46, 0.62, 0.78, 0.84];
  const tracks = [
    vecTrack('GlasspondRoot', t, [0, -0.012, 0.155, 0.205, 0.105, -0.012, 0].map((dy) => rootAt(0, dy))),
    quatTrack('Spine', t, 'x', [0, 0.025, -0.015, -0.01, 0.018, 0.024, 0]),
    quatTrack('Chest', t, 'z', [0, -0.035, 0.035, 0.02, -0.035, 0.01, 0]),
  ];
  for (const side of ['L', 'R']) {
    const mirror = side === 'L' ? 1 : -1;
    tracks.push(quatTrack(`HindHip_${side}`, t, 'z', [0, 0.20, -0.34, -0.20, 0.16, 0.27, 0].map((a) => a * mirror)));
    tracks.push(quatTrack(`HindKnee_${side}`, t, 'z', [0, -0.48, 0.26, 0.36, -0.30, -0.48, 0]));
    tracks.push(quatTrack(`HindHock_${side}`, t, 'z', [0, 0.18, -0.15, -0.10, 0.16, 0.20, 0]));
    tracks.push(quatTrack(`HindFoot_${side}`, t, 'z', [0, -0.12, 0.07, 0.08, -0.1, -0.15, 0]));
    tracks.push(quatTrack(`ForeHip_${side}`, t, 'z', [0, -0.08, 0.20, 0.28, -0.20, 0.12, 0].map((a) => a * mirror)));
    tracks.push(quatTrack(`ForeKnee_${side}`, t, 'z', [0, -0.34, 0.20, 0.16, -0.48, -0.32, 0]));
    tracks.push(quatTrack(`ForeAnkle_${side}`, t, 'z', [0, 0.08, -0.06, -0.05, 0.12, 0.1, 0]));
  }
  addClip('Run', 0.84, tracks);
}

// Quick territorial bite: hind feet push, front feet brace, and the head/jaw snap toward +X.
{
  const t = [0, 0.12, 0.25, 0.38, 0.64];
  const tracks = [
    vecTrack('GlasspondRoot', t, [rootAt(), rootAt(-0.025, -0.02), rootAt(0.085, 0.02), rootAt(0.035, 0.01), rootAt()]),
    quatTrack('Spine', t, 'z', [0, -0.06, 0.05, 0.03, 0]),
    quatTrack('Neck', t, 'z', [0, 0.05, -0.16, 0.06, 0]),
    quatTrack('Head', t, 'z', [0, 0.12, -0.22, 0.08, 0]),
    quatTrack('Jaw', t, 'z', [0, 0.18, 0.38, 0.10, 0]),
  ];
  for (const side of ['L', 'R']) {
    tracks.push(quatTrack(`ForeHip_${side}`, t, 'z', [0, -0.12, 0.12, 0.04, 0]));
    tracks.push(quatTrack(`ForeKnee_${side}`, t, 'z', [0, -0.14, 0.10, 0.04, 0]));
    tracks.push(quatTrack(`HindHip_${side}`, t, 'z', [0, -0.10, 0.24, 0.10, 0]));
    tracks.push(quatTrack(`HindKnee_${side}`, t, 'z', [0, -0.16, 0.26, 0.08, 0]));
  }
  addClip('Attack', 0.64, tracks);
}

// The impact recoils the neck and shifts the frog backward, then returns to the same crouch.
{
  const t = [0, 0.08, 0.20, 0.50];
  addClip('Hit', 0.50, [
    vecTrack('GlasspondRoot', t, [rootAt(), rootAt(-0.03, 0.025), rootAt(-0.045, 0.012), rootAt()]),
    quatTrack('GlasspondRoot', t, 'y', [0, -0.08, -0.04, 0]),
    quatTrack('Spine', t, 'z', [0, 0.11, 0.02, 0]),
    quatTrack('Neck', t, 'z', [0, 0.23, 0.07, 0]),
    quatTrack('Head', t, 'z', [0, 0.17, 0.05, 0]),
    quatTrack('ForeHip_L', t, 'z', [0, -0.20, 0.05, 0]),
    quatTrack('ForeHip_R', t, 'z', [0, 0.12, 0.03, 0]),
  ]);
}

// Death is a deliberate low collapse and partial roll, with limbs settling instead of a humanoid fall.
{
  const t = [0, 0.20, 0.50, 0.90, 1.25, 1.60];
  const rootRot = [0, 0.08, 0.18, 0.24, 0.24, 0.24].map((angle, index) => qMul(q('z', [-0, -0.03, -0.10, -0.16, -0.16, -0.16][index]), q('x', angle)));
  const tracks = [
    vecTrack('GlasspondRoot', t, [rootAt(), rootAt(0, -0.015), rootAt(0, -0.01), rootAt(0, 0.015), rootAt(0, 0.045), rootAt(0, 0.045)]),
    { node: 'GlasspondRoot', path: 'rotation', type: Accessor.Type.VEC4, times: t, values: rootRot },
    quatTrack('Neck', t, 'z', [0, 0.08, 0.22, 0.32, 0.32, 0.32]),
    quatTrack('Head', t, 'z', [0, 0.12, 0.25, 0.38, 0.38, 0.38]),
    quatTrack('Jaw', t, 'z', [0, 0.10, 0.22, 0.28, 0.28, 0.28]),
  ];
  for (const side of ['L', 'R']) {
    const mirror = side === 'L' ? -1 : 1;
    tracks.push(quatTrack(`ForeHip_${side}`, t, 'z', [0, -0.12, 0.18, 0.26, 0.26, 0.26]));
    tracks.push(quatTrack(`ForeKnee_${side}`, t, 'z', [0, -0.12, -0.30, -0.42, -0.42, -0.42]));
    tracks.push(quatTrack(`ForeAnkle_${side}`, t, 'x', [0, 0.08, 0.16, 0.20, 0.20, 0.20].map((angle) => angle * mirror)));
    tracks.push(quatTrack(`HindHip_${side}`, t, 'z', [0, 0.08, 0.22, 0.26, 0.26, 0.26]));
    tracks.push(quatTrack(`HindKnee_${side}`, t, 'z', [0, -0.18, -0.42, -0.50, -0.50, -0.50]));
    tracks.push(quatTrack(`HindHock_${side}`, t, 'z', [0, 0.10, 0.20, 0.25, 0.25, 0.25]));
  }
  addClip('Death', 1.60, tracks);
}

const output = await io.writeBinary(doc);
await writeFile(candidateFile, output);
const candidateSha = sha(output);
const candidateBytes = output.length;
const checkDoc = await io.readBinary(output);
const checkRoot = checkDoc.getRoot();
const checkPrimitive = checkRoot.listMeshes()[0].listPrimitives()[0];
const checkPosition = checkPrimitive.getAttribute('POSITION');
const checkIndices = checkPrimitive.getIndices();
if (checkRoot.listSkins().length !== 1 || checkRoot.listSkins()[0].listJoints().length !== bones.length || checkRoot.listAnimations().length !== 6) {
  throw new Error('Serialized frog candidate is missing its authored rig or one of the six clips.');
}
if (checkPosition.getCount() !== vertexCount || checkIndices.getCount() / 3 !== triangleCount) throw new Error('Serialized geometry count changed.');
let maxPositionDelta = 0, indexMismatches = 0, maxAttributeDelta = 0, weightError = 0, verticesWithBlend = 0;
const checkAttributes = new Map(geometryAttributeNames.flatMap((name) => {
  const attribute = checkPrimitive.getAttribute(name);
  return attribute ? [[name, Array.from(attribute.getArray())]] : [];
}));
for (const [name, original] of sourceAttributes) {
  if (name === 'JOINTS_0' || name === 'WEIGHTS_0') continue;
  const candidate = checkAttributes.get(name);
  if (!candidate || candidate.length !== original.length) throw new Error(`Source ${name} attribute missing or changed in size.`);
  for (let i = 0; i < original.length; i++) maxAttributeDelta = Math.max(maxAttributeDelta, Math.abs(original[i] - candidate[i]));
}
for (let i = 0; i < checkPosition.getArray().length; i++) maxPositionDelta = Math.max(maxPositionDelta, Math.abs(positions[i] - checkPosition.getArray()[i]));
for (let i = 0; i < checkIndices.getArray().length; i++) if (indices[i] !== checkIndices.getArray()[i]) indexMismatches++;
const js = checkPrimitive.getAttribute('JOINTS_0').getArray(), ws = checkPrimitive.getAttribute('WEIGHTS_0').getArray();
for (let vertex = 0; vertex < vertexCount; vertex++) {
  let sum = 0, active = 0;
  for (let slot = 0; slot < 4; slot++) {
    const joint = js[vertex * 4 + slot], weight = ws[vertex * 4 + slot];
    if (!Number.isInteger(joint) || joint < 0 || joint >= bones.length || !Number.isFinite(weight) || weight < 0 || weight > 1) throw new Error(`Invalid frog skin influence ${vertex}/${slot}.`);
    sum += weight;
    if (weight > 1e-5) active++;
  }
  weightError = Math.max(weightError, Math.abs(sum - 1));
  if (active > 1) verticesWithBlend++;
}
if (maxPositionDelta > 1e-7 || maxAttributeDelta > 1e-7 || indexMismatches || weightError > 1e-5 || verticesWithBlend < vertexCount * 0.40) {
  throw new Error(`Source-preservation/skin validation failed: positions=${maxPositionDelta} attributes=${maxAttributeDelta} indices=${indexMismatches} weightError=${weightError} blended=${verticesWithBlend}.`);
}
const animations = checkRoot.listAnimations().map((animation) => ({ name: animation.getName(), channels: animation.listChannels().length, seconds: Math.max(...animation.listSamplers().flatMap((sampler) => Array.from(sampler.getInput().getArray()))) }));
const textureSummary = [];
for (const texture of checkRoot.listTextures()) {
  const meta = await sharp(texture.getImage()).metadata();
  textureSummary.push({ name: texture.getName(), dimensions: [meta.width, meta.height], mime: texture.getMimeType(), bytes: texture.getImage().length, sha256: sha(texture.getImage()) });
  if (meta.width !== 2048 || meta.height !== 2048) throw new Error(`Runtime map is not 2K: ${texture.getName()} ${meta.width}x${meta.height}.`);
}
const sourceMaps = sourceTextures.map((texture) => ({ ...texture }));
const report = {
  schema: 'corealm-creature-native-rig-candidate/1',
  id: 'animal_frog',
  displayName: 'Glasspond Frog',
  status: 'awaiting-root-lab-review',
  accepted: false,
  source: {
    file: sourceFile,
    sha256: sourceSha,
    bytes: sourceBytes.length,
    starredCardUuid: '8a71752f-b4b8-4625-874f-220bbde13412',
    projectUuid: '05481088-98cd-4385-9275-dc4e5bff375d',
    starredDisplayName: 'Green-blue frog model with textured skin and webbed feet',
    sourceImage: 'assets/art/tripo/refs/fairy-glasspond-frog.png',
    sourceImageSha256: '74a10e3368db3cebd5121d568cdea2e771fef6724a313871b9e7587b242b20fb',
    prompt: 'Glasspond Frog. A mature fairy pond amphibian with a proportionate angular head and compact but not squat body, clear athletic limbs, long folded hind legs, webbed feet and small lateral amber eyes. Semitranslucent jade skin reveals a few soft violet vein branches along the flanks. Deep peacock-blue irregular back mottling, pearl underjaw, copper flecks around joints, wet natural sheen. A subtle skin ridge runs from each eye to the hips. Restrained believable frog anatomy, no giant cute eyes, no fat belly, no jewels, crown, magical accessories or glow cloud. Serious medieval fantasy RPG creature concept for Corealm, art direction with the readable grounded shapes of Knight Online and RuneScape. Mature, neutral animal intent, healthy organic life. Balanced medium build, proportionate limbs neither bulky nor skinny. One creature, complete body three-quarter view standing naturally, limbs separated for rigging, plain warm gray background, no base, no scenery, no text. Hand-authored painted surface detail with large clear color masses and smaller mineral veins, growth lines and wear. No cute mascot, baby eyes, toy, chibi, skull, random horns, technological face, armor plating, excessive spikes or ornamental clutter.',
    smartMesh: 'Tripo P2',
    triangles: triangleCount,
    vertices: vertexCount,
    originalRig: { joints: 7, clips: 0, disposition: 'replaced because the source influences are almost entirely bound to the root' },
    sourceTextures: sourceMaps,
    sourceSkinDiscarded: true,
  },
  candidate: {
    file: candidateName,
    sha256: candidateSha,
    bytes: candidateBytes,
    vertices: vertexCount,
    triangles: triangleCount,
    positionsPreserved: maxPositionDelta === 0,
    indicesPreserved: indexMismatches === 0,
    normalsUvTangentsPreserved: maxAttributeDelta === 0,
    maximumSourceAttributeDelta: maxAttributeDelta,
    rig: { type: 'Y-up Unity Generic quadruped', forward: '+X', joints: bones.map((bone, index) => ({ name: bone.name, index, parent: bone.parent, position: bone.p })), weightMethod: 'Four normalized anatomy-gated segment-distance influences per source vertex; source root-only skin removed.' },
    influenceVertices: Object.fromEntries(bones.map((bone, index) => [bone.name, influenceVertices[index]])),
    verticesWithMultipleInfluences: verticesWithBlend,
    maximumWeightSumError: weightError,
    animations,
    runtimeTextures: textureSummary,
    textureReduction: runtimeTextures,
    material: { metallicFactor: 0, roughnessFactor: 1, baseColor: 'original layered image-generated 2K albedo', normal: 'original 2K normal map, averaged and renormalized', roughness: 'original layered 2K metallic-roughness texture', note: 'wet natural sheen comes from source roughness detail; living skin stays dielectric' },
    intendedFairyAssetIds: ['fairy_garden_frog_gloamgarden', 'fairy_garden_frog_faeholme'],
    labOverlayAssetId: 'animal_frog',
  },
  validation: {
    serializedGlbReadBack: true,
    exactVertexCount: vertexCount,
    exactTriangleCount: triangleCount,
    exactPositions: maxPositionDelta === 0,
    exactIndices: indexMismatches === 0,
    exactOriginalGeometryAttributes: maxAttributeDelta === 0,
    normalizedWeights: weightError <= 1e-5,
    allSixClips: animations.map((animation) => animation.name).join(', ') === 'Idle, Walk, Run, Attack, Hit, Death',
    allRuntimeMaps2K: textureSummary.every((texture) => texture.dimensions[0] === 2048 && texture.dimensions[1] === 2048),
    labAccepted: false,
    worldIntegrated: false,
  },
};
await writeFile(`${ownerDir}/catalog.json`, JSON.stringify(report, null, 2) + '\n');
const bounds = sourceBounds;
const labCatalog = {
  schema: 'corealm-lab-asset-candidates/1',
  assets: [{
    id: 'animal_frog',
    file: 'models/animal/animal_frog.glb',
    pack: 'animal-pack-deluxe',
    category: 'character',
    is: 'Glasspond Frog (starred rig candidate)',
    tags: ['creature', 'amphibian', 'frog', 'fairy', 'T30', 'starred', 'tripo', 'skinned', 'candidate'],
    bytes: candidateBytes,
    sha256: candidateSha,
    size: { x: bounds.max[0] - bounds.min[0], y: bounds.max[1] - bounds.min[1], z: bounds.max[2] - bounds.min[2] },
    base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] },
    groundY: bounds.min[1],
    triangles: triangleCount,
    animations: animations.map((animation) => animation.name),
    walkClipSeconds: animations.find((animation) => animation.name === 'Walk').seconds,
    runClipSeconds: animations.find((animation) => animation.name === 'Run').seconds,
    attackSeconds: animations.find((animation) => animation.name === 'Attack').seconds,
    materials: checkRoot.listMaterials().map((entry) => entry.getName()),
    sourceProvenance: { sourceModelId: '05481088-98cd-4385-9275-dc4e5bff375d', sourceCardId: '8a71752f-b4b8-4625-874f-220bbde13412', sourceFile, sourceSha256: sourceSha, candidateFile, candidateSha256: candidateSha, rigMethod: '23-joint frog-specific Unity Generic quadruped; original approved mesh, UVs and layered image-generated albedo/PBR maps preserved; runtime maps downsampled to 2K.' },
    metadata: { source: report.source, candidate: report.candidate, acceptance: report.validation },
    acceptance: { assetAudit: true, rigAccepted: false, motionAccepted: false, texturesAccepted: true, labAccepted: false, worldIntegrated: false },
  }],
  files: { animal_frog: candidateName },
};
await writeFile(`${ownerDir}/lab-catalog.json`, JSON.stringify(labCatalog, null, 2) + '\n');
console.log(JSON.stringify({ candidateFile, candidateBytes, candidateSha, vertices: vertexCount, triangles: triangleCount, bones: bones.length, animations, textures: textureSummary, validation: report.validation }, null, 2));

function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function boundsOf(array) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < array.length; index += 3) for (let axis = 0; axis < 3; axis++) {
    min[axis] = Math.min(min[axis], array[index + axis]);
    max[axis] = Math.max(max[axis], array[index + axis]);
  }
  return { min, max };
}
