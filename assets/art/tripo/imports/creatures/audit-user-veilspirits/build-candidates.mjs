import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';
import { deformedBounds } from '../../../../../../tools/creature-motion/validate-deformation.ts';
import { duration, storedPose, restorePose, applyClip } from '../../../../../../tools/creature-motion/pose.ts';

const dir = 'assets/art/tripo/imports/creatures/audit-user-veilspirits';
const source = `${dir}/sources/fantasy-elf-user-original.glb`;
const sourceBytes = await readFile(source);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
if (sha(sourceBytes) !== '07cf4fc63601c9323bfbf266f14393cbca698975c4dcf63feb7f6efc3ca077ae') throw Error('Original source changed');
const specs = [
  { id: 'fairy_garden_veilspirit_gloamgarden', name: 'Thistledown Veilspirit', atlas: 'thistledown-atlas-imagegen.png', file: 'thistledown-veilspirit-candidate.glb', height: 1.38 },
  { id: 'fairy_garden_veilspirit_faeholme', name: 'Orchid Veilspirit', atlas: 'orchid-atlas-imagegen.png', file: 'orchid-veilspirit-candidate.glb', height: 1.65 },
];
const manifest = JSON.parse(await readFile('game/public/assets/manifest.json', 'utf8'));
const B = (name, parent, p, sigma, group) => ({ name, parent, p, sigma, group });
const bones = [
  B('SpiritRoot', null, [0, .34, 0], .5, 'root'),
  B('Pelvis', 'SpiritRoot', [0, .39, 0], .17, 'body'),
  B('Spine', 'Pelvis', [0, .53, 0], .17, 'body'),
  B('Chest', 'Spine', [0, .66, 0], .18, 'body'),
  B('Neck', 'Chest', [0, .77, 0], .11, 'head'),
  B('Head', 'Neck', [0, .84, 0], .12, 'head'),
  B('Crown', 'Head', [0, .94, 0], .13, 'crown'),
  B('LeftShoulder', 'Chest', [0, .67, .12], .1, 'armL'),
  B('LeftElbow', 'LeftShoulder', [0, .64, .25], .12, 'armL'),
  B('LeftHand', 'LeftElbow', [0, .62, .38], .11, 'armL'),
  B('RightShoulder', 'Chest', [0, .67, -.12], .1, 'armR'),
  B('RightElbow', 'RightShoulder', [0, .64, -.25], .12, 'armR'),
  B('RightHand', 'RightElbow', [0, .62, -.38], .11, 'armR'),
  B('LeftMantle', 'Chest', [0, .51, .19], .19, 'mantleL'),
  B('LeftMantleTip', 'LeftMantle', [0, .19, .24], .19, 'mantleL'),
  B('RightMantle', 'Chest', [0, .51, -.19], .19, 'mantleR'),
  B('RightMantleTip', 'RightMantle', [0, .19, -.24], .19, 'mantleR'),
  B('LeftHip', 'Pelvis', [0, .34, .085], .09, 'legL'),
  B('LeftKnee', 'LeftHip', [0, .19, .09], .09, 'legL'),
  B('LeftFoot', 'LeftKnee', [0, .055, .105], .1, 'legL'),
  B('RightHip', 'Pelvis', [0, .34, -.085], .09, 'legR'),
  B('RightKnee', 'RightHip', [0, .19, -.09], .09, 'legR'),
  B('RightFoot', 'RightKnee', [0, .055, -.105], .1, 'legR'),
];
const smooth = x => 1 / (1 + Math.exp(-x));
function segmentDistance(p, a, b) {
  const ab = b.map((v, i) => v - a[i]);
  const t = Math.max(0, Math.min(1, p.reduce((sum, v, i) => sum + (v - a[i]) * ab[i], 0) / (ab.reduce((sum, v) => sum + v * v, 0) || 1)));
  return Math.hypot(...p.map((v, i) => v - a[i] - t * ab[i]));
}
const quat = (axis, angle) => {
  const s = Math.sin(angle / 2), c = Math.cos(angle / 2);
  return axis === 'x' ? [s, 0, 0, c] : axis === 'y' ? [0, s, 0, c] : [0, 0, s, c];
};
const times = [0, .25, .5, .75, 1];

async function build(spec) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(sourceBytes), root = doc.getRoot(), scene = root.listScenes()[0];
  const mesh = root.listMeshes()[0], primitive = mesh.listPrimitives()[0], meshNode = root.listNodes().find(n => n.getMesh() === mesh);
  const positions = primitive.getAttribute('POSITION').getArray(), count = primitive.getAttribute('POSITION').getCount();
  if (count !== 6297 || primitive.getIndices().getCount() / 3 !== 3944 || root.listSkins().length || root.listAnimations().length) throw Error('Unexpected source topology');
  const material = primitive.getMaterial(), sourceNormal = sha(material.getNormalTexture().getImage()), sourceMR = sha(material.getMetallicRoughnessTexture().getImage());
  const atlasBytes = await sharp(await readFile(`${dir}/${spec.atlas}`)).resize(2048, 2048).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  material.getBaseColorTexture().setImage(atlasBytes).setMimeType('image/jpeg').setName(`${spec.name} generated color atlas`);
  material.setName(`${spec.name} PBR`).setMetallicFactor(.12).setRoughnessFactor(.88).setDoubleSided(true);

  // The delivered elf faces +X. The game's creature forward axis is +Z.
  // Rotate the shared mesh/joint parent so attack reach and root motion face +Z.
  const rig = doc.createNode(`${spec.name} Rig`)
    .setRotation([0, -Math.SQRT1_2, 0, Math.SQRT1_2])
    .setScale([spec.height, spec.height, spec.height]);
  scene.removeChild(meshNode); scene.addChild(rig); rig.addChild(meshNode); meshNode.setName(`${spec.name} Mesh`);
  const byName = new Map(bones.map((bone, index) => [bone.name, { ...bone, index }])), nodes = new Map();
  for (const bone of bones) {
    const parent = bone.parent ? byName.get(bone.parent) : null;
    const local = parent ? bone.p.map((v, i) => v - parent.p[i]) : bone.p;
    const node = doc.createNode(bone.name).setTranslation(local);
    (bone.parent ? nodes.get(bone.parent) : rig).addChild(node); nodes.set(bone.name, node);
  }
  const buffer = root.listBuffers()[0], skin = doc.createSkin(`${spec.name} Skin`).setSkeleton(nodes.get('SpiritRoot'));
  for (const bone of bones) skin.addJoint(nodes.get(bone.name));
  const inverse = new Float32Array(bones.length * 16);
  for (let i = 0; i < bones.length; i++) {
    const [x, y, z] = bones[i].p;
    inverse.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1], i * 16);
  }
  skin.setInverseBindMatrices(doc.createAccessor('InverseBindMatrices').setType(Accessor.Type.MAT4).setArray(inverse).setBuffer(buffer));
  meshNode.setSkin(skin);
  const jointIds = new Uint16Array(count * 4), weights = new Float32Array(count * 4), influenceCounts = new Uint32Array(bones.length);
  for (let v = 0; v < count; v++) {
    const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]], [x, y, z] = p;
    const candidates = bones.slice(1).map(bone => {
      let gate = 1;
      if (bone.group === 'head') gate = smooth((y - .72) / .045) * smooth((.17 - Math.abs(z)) / .04);
      else if (bone.group === 'crown') gate = smooth((y - .84) / .04);
      else if (bone.group.startsWith('arm')) gate = smooth((y - .53) / .035) * smooth((Math.abs(z) - .105) / .03) * smooth(((bone.group.endsWith('L') ? 1 : -1) * z - .03) / .02);
      else if (bone.group.startsWith('mantle')) gate = smooth((.62 - y) / .035) * smooth((Math.abs(z) - .1) / .04) * smooth(((bone.group.endsWith('L') ? 1 : -1) * z - .03) / .02);
      else if (bone.group.startsWith('leg')) gate = smooth((.43 - y) / .04) * smooth(((bone.group.endsWith('L') ? 1 : -1) * z - .02) / .02);
      else gate = smooth((.20 - Math.abs(z)) / .05);
      const parent = byName.get(bone.parent), distance = segmentDistance(p, parent?.p ?? bone.p, bone.p);
      return { index: byName.get(bone.name).index, score: (.00001 + gate) * Math.exp(-.5 * (distance / bone.sigma) ** 2) };
    }).sort((a, b) => b.score - a.score).slice(0, 4);
    const total = candidates.reduce((sum, candidate) => sum + candidate.score, 0);
    let assigned = 0;
    for (let k = 0; k < 4; k++) {
      const weight = k === 3 ? 1 - assigned : candidates[k].score / total;
      jointIds[v * 4 + k] = candidates[k].index; weights[v * 4 + k] = weight; assigned += weight;
      if (weight > .001) influenceCounts[candidates[k].index]++;
    }
  }
  primitive.setAttribute('JOINTS_0', doc.createAccessor('JointIndices').setType(Accessor.Type.VEC4).setArray(jointIds).setBuffer(buffer));
  primitive.setAttribute('WEIGHTS_0', doc.createAccessor('JointWeights').setType(Accessor.Type.VEC4).setArray(weights).setBuffer(buffer));
  function clip(name, seconds, tracks) {
    const animation = doc.createAnimation(name);
    for (const track of tracks) {
      const input = doc.createAccessor(`${name} ${track.name} times`).setType(Accessor.Type.SCALAR).setArray(Float32Array.from(track.t)).setBuffer(buffer);
      const output = doc.createAccessor(`${name} ${track.name} values`).setType(track.path === 'translation' ? Accessor.Type.VEC3 : Accessor.Type.VEC4).setArray(Float32Array.from(track.v.flat())).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
      animation.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(nodes.get(track.name)).setTargetPath(track.path ?? 'rotation').setSampler(sampler));
    }
    return animation;
  }
  const rot = (name, axis, t, angles) => ({ name, t, v: angles.map(a => quat(axis, a)) });
  const move = (name, t, xyz) => ({ name, path: 'translation', t, v: xyz });
  const rootMove = (t, heights) => move('SpiritRoot', t, heights.map(y => [0, .34 + y, 0]));
  const flourish = (t, amplitude) => [
    rot('Crown', 'x', t, [0, amplitude, 0, -amplitude, 0]),
    rot('LeftMantle', 'x', t, [0, .7 * amplitude, 0, -.7 * amplitude, 0]),
    rot('RightMantle', 'x', t, [0, -.7 * amplitude, 0, .7 * amplitude, 0]),
    rot('LeftMantleTip', 'x', t, [0, amplitude, 0, -amplitude, 0]),
    rot('RightMantleTip', 'x', t, [0, -amplitude, 0, amplitude, 0]),
  ];
  clip('Idle', 2.6, [rootMove(times.map(x => x * 2.6), [0, .012, 0, .008, 0]), rot('Chest', 'z', times.map(x => x * 2.6), [0, .025, 0, -.025, 0]), ...flourish(times.map(x => x * 2.6), .07)]);
  function gait(name, seconds, swing, rise) {
    const t = times.map(x => x * seconds), phases = [0, 1, 0, -1, 0];
    clip(name, seconds, [rootMove(t, [0, rise, 0, rise, 0]),
      rot('Pelvis', 'z', t, phases.map(n => n * swing * .11)),
      rot('LeftHip', 'z', t, phases.map(n => n * swing)),
      rot('RightHip', 'z', t, phases.map(n => -n * swing)),
      rot('LeftKnee', 'z', t, [0, -.13, 0, .08, 0]),
      rot('RightKnee', 'z', t, [0, .08, 0, -.13, 0]),
      rot('LeftShoulder', 'x', t, phases.map(n => -n * swing * .55)),
      rot('RightShoulder', 'x', t, phases.map(n => n * swing * .55)),
      ...flourish(t, swing * .23)]);
  }
  gait('Walk', 1.35, .3, .017);
  gait('Run', .82, .48, .035);
  const action = [0, .16, .38, .61, .95];
  clip('Attack', .95, [rootMove(action, [0, -.02, .05, .015, 0]),
    rot('Chest', 'z', action, [0, -.14, .2, .08, 0]),
    rot('LeftShoulder', 'y', action, [0, -.25, .66, .16, 0]),
    rot('RightShoulder', 'y', action, [0, .25, -.66, -.16, 0]),
    rot('LeftElbow', 'y', action, [0, -.16, .32, .08, 0]),
    rot('RightElbow', 'y', action, [0, .16, -.32, -.08, 0]),
    ...flourish(action, .18)]);
  const hitTimes = [0, .11, .24, .5];
  clip('Hit', .5, [rootMove(hitTimes, [0, -.025, .012, 0]),
    rot('Chest', 'z', hitTimes, [0, -.18, .08, 0]),
    rot('Head', 'x', hitTimes, [0, .14, -.05, 0]),
    rot('LeftMantle', 'x', hitTimes, [0, .19, -.06, 0]),
    rot('RightMantle', 'x', hitTimes, [0, -.19, .06, 0])]);
  const deathTimes = [0, .22, .52, .9, 1.65];
  clip('Death', 1.65, [rootMove(deathTimes, [0, .015, .025, .025, .025]),
    rot('SpiritRoot', 'z', deathTimes, [0, -.16, -.9, -1.48, -1.48]),
    rot('LeftShoulder', 'x', deathTimes, [0, .05, .23, .31, .31]),
    rot('RightShoulder', 'x', deathTimes, [0, -.05, -.23, -.31, -.31]),
    rot('LeftHip', 'z', deathTimes, [0, 0, .19, .29, .29]),
    rot('RightHip', 'z', deathTimes, [0, 0, -.18, -.28, -.28]),
    rot('Crown', 'x', deathTimes, [0, .08, .22, .32, .32])]);
  // Bake vertical correction against the deformed mesh, including mantle tips.
  // The actor's complete body remains visible through the held death pose.
  const uncorrectedPose = storedPose(doc);
  for (const animation of root.listAnimations()) {
    const rootChannel = animation.listChannels().find(channel => channel.getTargetNode() === nodes.get('SpiritRoot') && channel.getTargetPath() === 'translation');
    const seconds = duration(animation), frames = Math.ceil(seconds * 60), sampleTimes = [], corrected = [];
    for (let i = 0; i <= frames; i++) {
      const time = seconds * i / frames;
      restorePose(uncorrectedPose); applyClip(animation, time);
      const floor = deformedBounds(doc).min[1], [x, y, z] = nodes.get('SpiritRoot').getTranslation();
      sampleTimes.push(time); corrected.push(x, y + (.003 - floor) / spec.height, z);
    }
    rootChannel.getSampler().getInput().setArray(Float32Array.from(sampleTimes));
    rootChannel.getSampler().getOutput().setArray(Float32Array.from(corrected));
  }
  restorePose(uncorrectedPose);
  const pose = storedPose(doc), motion = [];
  for (const animation of root.listAnimations()) {
    const samples = [];
    for (let i = 0; i <= Math.ceil(duration(animation) * 30); i++) {
      const time = duration(animation) * i / Math.ceil(duration(animation) * 30);
      restorePose(pose); applyClip(animation, time);
      const bounds = deformedBounds(doc);
      samples.push({ time, minY: bounds.min[1], maxY: bounds.max[1], width: bounds.max[2] - bounds.min[2] });
    }
    motion.push({ name: animation.getName(), seconds: duration(animation), channels: animation.listChannels().length,
      minY: Math.min(...samples.map(s => s.minY)), maxY: Math.max(...samples.map(s => s.maxY)),
      final: samples.at(-1), first: samples[0] });
  }
  restorePose(pose);
  const bounds = deformedBounds(doc), output = `${dir}/${spec.file}`;
  const bytes = Buffer.from(await io.writeBinary(doc)); await writeFile(output, bytes);
  const verify = await io.readBinary(bytes), vr = verify.getRoot(), vp = vr.listMeshes()[0].listPrimitives()[0], vm = vp.getMaterial();
  if (vr.listSkins()[0].listJoints().length !== bones.length || vr.listAnimations().length !== 6 || vp.getAttribute('POSITION').getCount() !== count) throw Error('Roundtrip failed');
  if (sha(vm.getNormalTexture().getImage()) !== sourceNormal || sha(vm.getMetallicRoughnessTexture().getImage()) !== sourceMR) throw Error('Source PBR support maps changed');
  const sourceGeometry = Object.fromEntries(['POSITION', 'NORMAL', 'TEXCOORD_0'].map(key => [key, sha(Buffer.from(primitive.getAttribute(key).getArray().buffer))]));
  const production = manifest.assets.find(asset => asset.id === spec.id);
  if (!production) throw Error(`No production slot for ${spec.id}`);
  const entry = { id: spec.id, file: production.file, pack: 'corealm-user-veilspirits-candidate', category: 'character',
    is: 'botanical veilspirit', tags: ['creature', 'fairy', 'fantastical', 'botanical', 'veilspirit', 'image-generated-texture'],
    name: spec.name, candidateFile: output, bytes: bytes.length, sha256: sha(bytes), triangles: 3944,
    size: { x: bounds.max[0] - bounds.min[0], y: bounds.max[1] - bounds.min[1], z: bounds.max[2] - bounds.min[2] },
    base: { x: bounds.min[0], y: bounds.min[1], z: bounds.min[2] }, bounds, groundY: bounds.min[1],
    animations: motion.map(m => m.name), walkClipSeconds: 1.35, runClipSeconds: .82, attackSeconds: .95, contactNormalized: .4,
    materials: [vm.getName()], sourceProvenance: { sourceFile: source, sourceSha256: sha(sourceBytes), sourceVertices: count, sourceTriangles: 3944,
      originalGeometryPreserved: true, originalNormalAndMRPreserved: true, generatedColorAtlas: `${dir}/${spec.atlas}`,
      generatedColorSha256: sha(await readFile(`${dir}/${spec.atlas}`)), originalGeometryHashes: sourceGeometry,
      builderFile: `${dir}/build-candidates.mjs`, builderSha256: sha(await readFile(import.meta.filename)),
      rigMethod: '23-joint region and segment weighted native mesh rig' },
    metadata: { is: spec.name.toLowerCase(), tags: ['fairy', 'fantastical', 'botanical', 'veilspirit', 'image-generated-texture'],
      targetHeight: spec.height, boneNames: bones.map(b => b.name), notes: 'User supplied botanical mesh, preserved topology, UV and supporting PBR maps. Six newly authored clips; root lab review pending.' },
    acceptance: { assetAudit: false, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false } };
  return { entry, motion, influences: bones.map((bone, index) => ({ name: bone.name, vertices: influenceCounts[index] })) };
}
const results = [];
for (const spec of specs) results.push(await build(spec));
const assets = results.map(result => result.entry), files = Object.fromEntries(assets.map(entry => [entry.id, entry.candidateFile.split('/').at(-1)]));
await writeFile(`${dir}/lab-catalog.json`, JSON.stringify({ schema: 'corealm-lab-asset-candidates/1',
  pack: { id: 'corealm-user-veilspirits-candidate', name: 'User botanical veilspirit variants', author: 'Corealm', source, license: 'LicenseRef-Tripo-Generated; user supplied export' },
  assets, files }, null, 2) + '\n');
await writeFile(`${dir}/validation.json`, JSON.stringify({ schema: 'corealm-veilspirit-cpu-validation/1', sourceSha256: sha(sourceBytes),
  results: results.map(result => ({ id: result.entry.id, sha256: result.entry.sha256, bounds: result.entry.bounds,
    influences: result.influences, motion: result.motion })) }, null, 2) + '\n');
await writeFile(`${dir}/promotion.json`, JSON.stringify({ schema: 'corealm-creature-candidate-promotion/1', status: 'awaiting-root-lab-review', accepted: false,
  labCatalog: `${dir}/lab-catalog.json`, cpuValidation: `${dir}/validation.json`, candidates: assets.map(entry => ({ id: entry.id, file: entry.candidateFile, sha256: entry.sha256,
    bytes: entry.bytes, bounds: entry.bounds, joints: bones.map(b => b.name), clips: results.find(result => result.entry.id === entry.id).motion.map(m => ({ name: m.name, seconds: m.seconds, channels: m.channels })) })),
  remainingAcceptance: ['Root normal-camera lab visual and motion review', 'Root semantic combat and corpse verification', 'Root production integration and build'] }, null, 2) + '\n');
console.log(JSON.stringify(results.map(result => ({ id: result.entry.id, sha256: result.entry.sha256, bounds: result.entry.bounds,
  motion: result.motion.map(m => ({ name: m.name, minY: m.minY, final: m.final })) })), null, 2));
