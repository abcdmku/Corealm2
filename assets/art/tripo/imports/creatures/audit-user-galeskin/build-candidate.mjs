import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Accessor, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Matrix4, Quaternion, Vector3 } from 'three';

const dir = 'assets/art/tripo/imports/creatures/audit-user-galeskin';
const id = 'creature_boss_galeskin';
const source = `${dir}/sources/fantasy-creature.glb`;
const candidate = `${dir}/galeskin-candidate.glb`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = await readFile(source);
if (hash(sourceBytes) !== '0574a1e4d13b784d945b9b9fb9bf4f3549a193572e4cde74aa2a1cd612fdf10d') throw Error('Original user source changed');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(sourceBytes), root = doc.getRoot();
const mesh = root.listMeshes()[0], prim = mesh?.listPrimitives()[0], meshNode = root.listNodes().find(n => n.getMesh() === mesh), buffer = root.listBuffers()[0];
if (!prim || !meshNode || root.listSkins().length || root.listAnimations().length || prim.getAttribute('POSITION')?.getCount() !== 4533 || prim.getIndices()?.getCount() !== 15468) throw Error('Unexpected unrigged source');
const mat = prim.getMaterial();
if (!mat?.getBaseColorTexture() || !mat.getNormalTexture() || !mat.getMetallicRoughnessTexture()) throw Error('Source PBR maps missing');
const original = Object.fromEntries(['POSITION', 'NORMAL', 'TEXCOORD_0', 'indices'].map(k => [k, hash(Buffer.from((k === 'indices' ? prim.getIndices() : prim.getAttribute(k)).getArray().buffer))]));
const textures = root.listTextures().map(t => ({ name: t.getName(), mimeType: t.getMimeType(), bytes: t.getImage().length, sha256: hash(t.getImage()) }));
// The source is already Y-up, +Z muzzle, planted at Y=0. Grow the compact
// native body to a low-tier boss, about 1.65 m to the horn tips.
const scale = 1.85;
for (const key of ['POSITION', 'NORMAL']) {
  if (key === 'POSITION') {
    const array = prim.getAttribute(key).getArray();
    for (let i = 0; i < array.length; i++) array[i] *= scale;
  }
}
const positions = prim.getAttribute('POSITION').getArray(), count = positions.length / 3;
const bones = [
  ['Root', null, [0, 0, 0]], ['Torso', 'Root', [0, .75, 0]],
  ['Neck', 'Torso', [0, 1.02, .38]], ['Head', 'Neck', [0, 1.18, .61]],
  ['Tail', 'Torso', [0, .67, -.49]],
  ['ForeLUpper', 'Torso', [-.27, .73, .41]], ['ForeLLower', 'ForeLUpper', [-.31, .35, .48]], ['ForeLFoot', 'ForeLLower', [-.34, .085, .52]],
  ['ForeRUpper', 'Torso', [.27, .73, .41]], ['ForeRLower', 'ForeRUpper', [.31, .35, .48]], ['ForeRFoot', 'ForeRLower', [.34, .085, .52]],
  ['HindLUpper', 'Torso', [-.22, .56, -.31]], ['HindLLower', 'HindLUpper', [-.27, .28, -.28]], ['HindLFoot', 'HindLLower', [-.30, .09, -.25]],
  ['HindRUpper', 'Torso', [.22, .56, -.31]], ['HindRLower', 'HindRUpper', [.27, .28, -.28]], ['HindRFoot', 'HindRLower', [.30, .09, -.25]],
];
const byName = new Map(), absolute = new Map(bones.map(([name, , p]) => [name, p]));
for (const [name, parent, p] of bones) {
  const q = parent ? absolute.get(parent) : [0, 0, 0];
  const node = doc.createNode(name).setTranslation(p.map((v, i) => v - q[i]));
  byName.set(name, node);
  if (parent) byName.get(parent).addChild(node); else root.listScenes()[0].addChild(node);
}
const skin = doc.createSkin('Galeskin anatomical quadruped').setSkeleton(byName.get('Root'));
const ibm = new Float32Array(bones.length * 16);
bones.forEach(([name, , p], i) => {
  skin.addJoint(byName.get(name));
  ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -p[0], -p[1], -p[2], 1], i * 16);
});
skin.setInverseBindMatrices(doc.createAccessor('Galeskin inverse binds').setType(Accessor.Type.MAT4).setArray(ibm).setBuffer(buffer));
meshNode.setName('GaleskinMesh').setSkin(skin);
const ji = new Uint16Array(count * 4), we = new Float32Array(count * 4), influences = new Uint32Array(bones.length);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const x = clamp((v - a) / (b - a)); return x * x * (3 - 2 * x); };
let blended = 0, maxWeightError = 0;
for (let v = 0; v < count; v++) {
  const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
  const s = new Float64Array(bones.length);
  s[1] = 1;
  s[2] = smooth(.30, .67, z) * smooth(.65, .98, y) * 3;
  s[3] = smooth(.54, .92, z) * smooth(.83, 1.15, y) * 5;
  s[4] = smooth(.48, .75, -z) * (1 - smooth(.65, .95, y)) * 2;
  for (const [side, fore, upper, lower, foot] of [[-1, true, 5, 6, 7], [1, true, 8, 9, 10], [-1, false, 11, 12, 13], [1, false, 14, 15, 16]]) {
    const lateral = smooth(.10, .24, x * side);
    const longitudinal = fore ? smooth(-.03, .25, z) : 1 - smooth(-.30, -.02, z);
    const gate = lateral * longitudinal * (1 - smooth(.58, .82, y));
    s[upper] += gate * 2.5 * smooth(.27, .55, y);
    s[lower] += gate * 4 * smooth(.09, .24, y) * (1 - smooth(.37, .55, y));
    s[foot] += gate * 7 * (1 - smooth(.08, .22, y));
  }
  if (y < .16 && Math.abs(x) > .20) s[1] *= .03;
  const best = Array.from(s, (score, i) => ({ score, i })).sort((a, b) => b.score - a.score).slice(0, 4);
  const total = best.reduce((n, item) => n + item.score, 0);
  let sum = 0, active = 0;
  best.forEach((item, slot) => {
    const weight = slot === 3 ? 1 - sum : item.score / total;
    ji[v * 4 + slot] = item.i; we[v * 4 + slot] = weight; sum += weight;
    if (weight > .001) { active++; influences[item.i]++; }
  });
  if (active > 1) blended++;
  maxWeightError = Math.max(maxWeightError, Math.abs(1 - we[v * 4] - we[v * 4 + 1] - we[v * 4 + 2] - we[v * 4 + 3]));
}
prim.setAttribute('JOINTS_0', doc.createAccessor('Galeskin joints').setType(Accessor.Type.VEC4).setArray(ji).setBuffer(buffer));
prim.setAttribute('WEIGHTS_0', doc.createAccessor('Galeskin weights').setType(Accessor.Type.VEC4).setArray(we).setBuffer(buffer));
const quat = (axis, radians) => new Quaternion().setFromAxisAngle(new Vector3(...axis), radians).toArray();
const X = a => quat([1, 0, 0], a), Y = a => quat([0, 1, 0], a), Z = a => quat([0, 0, 1], a);
function track(anim, name, path, times, values) {
  const input = doc.createAccessor().setType(Accessor.Type.SCALAR).setArray(Float32Array.from(times)).setBuffer(buffer);
  const output = doc.createAccessor().setType(path === 'rotation' ? Accessor.Type.VEC4 : Accessor.Type.VEC3).setArray(Float32Array.from(values.flat())).setBuffer(buffer);
  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
  anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(byName.get(name)).setTargetPath(path).setSampler(sampler));
}
function add(name, seconds, definitions) {
  const anim = doc.createAnimation(name);
  for (const [bone, path, keys] of definitions) track(anim, bone, path, keys.map((_, i) => seconds * i / (keys.length - 1)), keys);
  return anim;
}
add('Idle', 2.4, [
  ['Torso', 'rotation', [X(0), X(.012), X(0), X(-.012), X(0)]],
  ['Neck', 'rotation', [X(0), X(-.025), X(0), X(.02), X(0)]],
  ['Head', 'rotation', [Y(-.035), Y(0), Y(.035), Y(0), Y(-.035)]],
  ['Tail', 'rotation', [Y(-.08), Y(0), Y(.08), Y(0), Y(-.08)]],
]);
for (const [name, seconds, amplitude] of [['Walk', 1.0, .26], ['Run', .62, .42]]) {
  const definitions = [];
  for (const [prefix, phase] of [['ForeL', 0], ['ForeR', 2], ['HindL', 2], ['HindR', 0]]) {
    const wave = [0, 1, 0, -1, 0].map((_, i) => [0, 1, 0, -1][(i + phase) % 4]);
    definitions.push([prefix + 'Upper', 'rotation', wave.map(w => X(w * amplitude))]);
    definitions.push([prefix + 'Lower', 'rotation', wave.map(w => X(-Math.max(0, w) * amplitude * .55))]);
    definitions.push([prefix + 'Foot', 'rotation', wave.map(w => X(Math.max(0, w) * amplitude * .28))]);
  }
  definitions.push(['Torso', 'rotation', [X(0), X(.015), X(0), X(-.015), X(0)]]);
  definitions.push(['Head', 'rotation', [X(0), X(-.02), X(0), X(.02), X(0)]]);
  add(name, seconds, definitions);
}
add('Attack', 1.05, [
  ['Root', 'translation', [[0, 0, 0], [0, 0, -.045], [0, 0, -.08], [0, 0, .16], [0, 0, .22], [0, 0, 0]]],
  ['Torso', 'rotation', [X(0), X(-.05), X(-.09), X(.10), X(.06), X(0)]],
  ['Neck', 'rotation', [X(0), X(-.11), X(-.18), X(.25), X(.16), X(0)]],
  ['Head', 'rotation', [X(0), X(-.06), X(-.10), X(.24), X(.12), X(0)]],
  ['ForeLUpper', 'rotation', [X(0), X(-.10), X(-.14), X(.18), X(.08), X(0)]],
  ['ForeRUpper', 'rotation', [X(0), X(-.10), X(-.14), X(.18), X(.08), X(0)]],
]);
add('Hit', .52, [
  ['Torso', 'rotation', [X(0), X(-.08), X(.04), X(0)]],
  ['Neck', 'rotation', [X(0), X(-.15), X(.07), X(0)]],
  ['Head', 'rotation', [X(0), X(-.13), X(.06), X(0)]],
]);
add('Death', 1.5, [
  ['Root', 'translation', [[0, 0, 0], [0, -.02, 0], [0, -.09, 0], [0, -.18, 0], [0, -.18, 0]]],
  ['Torso', 'rotation', [Z(0), Z(-.24), Z(-.88), Z(-1.57), Z(-1.57)]],
  ['Neck', 'rotation', [X(0), X(.12), X(.29), X(.42), X(.42)]],
  ['Head', 'rotation', [X(0), X(.13), X(.28), X(.38), X(.38)]],
  ['ForeLUpper', 'rotation', [X(0), X(-.10), X(-.34), X(-.50), X(-.50)]],
  ['ForeRUpper', 'rotation', [X(0), X(-.08), X(-.28), X(-.43), X(-.43)]],
  ['HindLUpper', 'rotation', [X(0), X(.07), X(.19), X(.28), X(.28)]],
  ['HindRUpper', 'rotation', [X(0), X(.06), X(.17), X(.25), X(.25)]],
]);
// Keep the lowest deformed vertex at a three-millimeter clearance throughout
// every clip. Only the root translates; no clip scales the skeleton or mesh.
const inverse = Array.from({ length: bones.length }, (_, i) => new Matrix4().fromArray(ibm.slice(i * 16, i * 16 + 16)));
const rest = root.listNodes().map(n => [n, n.getTranslation(), n.getRotation()]);
function apply(anim, time) {
  for (const [n, t, r] of rest) n.setTranslation(t).setRotation(r);
  for (const channel of anim.listChannels()) {
    const sampler = channel.getSampler(), times = sampler.getInput().getArray(), values = sampler.getOutput().getArray();
    const path = channel.getTargetPath(), width = path === 'rotation' ? 4 : 3;
    let i = 0; while (i < times.length - 2 && times[i + 1] < time) i++;
    const f = clamp((time - times[i]) / (times[i + 1] - times[i] || 1));
    const value = path === 'rotation' ? new Quaternion().fromArray(values, i * 4).slerp(new Quaternion().fromArray(values, (i + 1) * 4), f).toArray() : Array.from({ length: width }, (_, j) => values[i * width + j] * (1 - f) + values[(i + 1) * width + j] * f);
    if (path === 'rotation') channel.getTargetNode().setRotation(value); else channel.getTargetNode().setTranslation(value);
  }
}
function bounds() {
  const matrices = skin.listJoints().map((joint, i) => new Matrix4().fromArray(joint.getWorldMatrix()).multiply(inverse[i]));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const point = new Vector3(), deformed = new Vector3(), result = new Vector3();
  for (let v = 0; v < count; v++) {
    point.fromArray(positions, v * 3); result.set(0, 0, 0);
    for (let slot = 0; slot < 4; slot++) {
      const w = we[v * 4 + slot]; if (w) result.add(deformed.copy(point).applyMatrix4(matrices[ji[v * 4 + slot]]).multiplyScalar(w));
    }
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], result.getComponent(a)); max[a] = Math.max(max[a], result.getComponent(a)); }
  }
  return { min, max };
}
const motion = [];
for (const anim of root.listAnimations()) {
  const seconds = Math.max(...anim.listSamplers().map(s => s.getInput().getArray().at(-1)));
  const samples = Math.ceil(seconds * 60), times = new Float32Array(samples + 1), translations = new Float32Array((samples + 1) * 3);
  for (let i = 0; i <= samples; i++) {
    const t = seconds * i / samples; apply(anim, t);
    const current = byName.get('Root').getTranslation();
    translations.set([current[0], current[1] + .003 - bounds().min[1], current[2]], i * 3);
    times[i] = t;
  }
  const existing = anim.listChannels().find(c => c.getTargetNode() === byName.get('Root') && c.getTargetPath() === 'translation');
  if (existing) { existing.getSampler().getInput().setArray(times); existing.getSampler().getOutput().setArray(translations); }
  else track(anim, 'Root', 'translation', times, Array.from({ length: samples + 1 }, (_, i) => Array.from(translations.slice(i * 3, i * 3 + 3))));
  const checks = [];
  for (let i = 0; i <= 8; i++) { apply(anim, seconds * i / 8); checks.push({ seconds: seconds * i / 8, ...bounds() }); }
  motion.push({ name: anim.getName(), seconds, bounds: checks });
}
for (const [n, t, r] of rest) n.setTranslation(t).setRotation(r);
const output = await io.writeBinary(doc); await writeFile(candidate, output);
const verify = await io.readBinary(output), vr = verify.getRoot(), vp = vr.listMeshes()[0].listPrimitives()[0];
if (vr.listSkins()[0].listJoints().length !== bones.length || vr.listAnimations().length !== 6) throw Error('Serialized rig or clips missing');
for (const key of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'indices']) {
  if (key === 'POSITION') continue; // intentionally uniformly scaled
  const data = key === 'indices' ? vp.getIndices() : vp.getAttribute(key);
  if (hash(Buffer.from(data.getArray().buffer)) !== original[key]) throw Error(`${key} changed`);
}
for (const t of textures) if (!vr.listTextures().some(v => v.getName() === t.name && hash(v.getImage()) === t.sha256)) throw Error('Source texture changed');
const idle = motion.find(m => m.name === 'Idle').bounds[0];
const size = { x: idle.max[0] - idle.min[0], y: idle.max[1] - idle.min[1], z: idle.max[2] - idle.min[2] };
const acceptance = { sourceIdentityVerified: true, rigAccepted: false, motionAccepted: false, texturesAccepted: false, labAccepted: false, worldIntegrated: false };
const sourceInfo = { file: source, originalDownload: 'C:/Users/Borg/Downloads/fantasy+creature+3d+model.glb', sha256: hash(sourceBytes), bytes: sourceBytes.length, vertices: count, triangles: prim.getIndices().getCount() / 3, geometryHashes: original, textures };
const entry = { id, file: `models/creature/${id}.glb`, pack: 'corealm-audit-user-galeskin', category: 'character', is: 'Galeskin', tags: ['creature', 'boss', 'galeskin', 'quadruped', 'storm', 'user-supplied', 'candidate'], bytes: output.length, sha256: hash(output), triangles: prim.getIndices().getCount() / 3, size, base: { x: idle.min[0], y: idle.min[1], z: idle.min[2] }, groundY: idle.min[1], animations: motion.map(m => m.name), materials: vr.listMaterials().map(m => m.getName()), walkClipSeconds: 1.0, runClipSeconds: .62, attackSeconds: 1.05, attackContactNormalized: .63, sourceProvenance: sourceInfo, candidateFile: 'galeskin-candidate.glb', acceptance };
const catalog = { schema: 'corealm-lab-asset-candidates/1', assets: [entry], files: { [id]: 'galeskin-candidate.glb' } };
await writeFile(`${dir}/lab-catalog.json`, JSON.stringify(catalog, null, 2) + '\n');
const promotion = { schema: 'corealm-creature-replacement-promotion/1', id, status: 'awaiting-root-lab-review', accepted: false, candidateFile: candidate, sha256: hash(output), bytes: output.length, bounds: idle, joints: bones.map(([name, parent, p], index) => ({ index, name, parent, restPosition: p })), clips: motion.map(m => ({ name: m.name, seconds: m.seconds })), timing: { walkClipSeconds: 1.0, runClipSeconds: .62, attackSeconds: 1.05, contactSeconds: .66, contactNormalized: .63, contactBasis: 'Horn thrust and forward lunge peak around 0.66 seconds.' }, source: sourceInfo, builder: { file: `${dir}/build-candidate.mjs`, sha256: hash(await readFile(`${dir}/build-candidate.mjs`)) }, rig: { basis: 'Y up, +Z muzzle; anatomical four-leg, head, neck and tail weights', vertexCount: count, multiInfluenceVertices: blended, maxWeightSumError: maxWeightError, jointInfluenceCounts: Array.from(influences) }, textureNote: 'Three detailed native PBR maps retained byte-for-byte.', acceptance };
await writeFile(`${dir}/promotion.json`, JSON.stringify(promotion, null, 2) + '\n');
await writeFile('test-results/creature-audit/user-galeskin/motion-audit.json', JSON.stringify({ sourceSha256: hash(sourceBytes), candidateSha256: hash(output), motion, maxWeightSumError: maxWeightError }, null, 2) + '\n');
console.log(JSON.stringify({ candidate, sha256: hash(output), size, joints: bones.length, clips: motion.map(m => m.name), maxWeightSumError: maxWeightError }, null, 2));
