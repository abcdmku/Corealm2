import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';

const dir = 'assets/art/tripo/imports/creatures/audit-user-beetle-golem';
const file = `${dir}/beetle-golem-user-candidate.glb`;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const bytes = await readFile(file);
const doc = await io.readBinary(bytes), root = doc.getRoot();
const mesh = root.listMeshes()[0], primitive = mesh.listPrimitives()[0];
const meshNode = root.listNodes().find((n) => n.getMesh() === mesh);
const skin = meshNode.getSkin(), joints = skin.listJoints();
const positions = primitive.getAttribute('POSITION').getArray();
const weights = primitive.getAttribute('WEIGHTS_0').getArray();
const jointIds = primitive.getAttribute('JOINTS_0').getArray();
const ibm = skin.getInverseBindMatrices().getArray();
const allNodes = root.listNodes();
const identity = new THREE.Matrix4();
function sample(channel, time) {
  const sampler = channel.getSampler(), times = sampler.getInput().getArray(), values = sampler.getOutput().getArray();
  const stride = channel.getTargetPath() === 'rotation' ? 4 : 3;
  let hi = 1; while (hi < times.length - 1 && times[hi] < time) hi++;
  const lo = hi - 1, t = Math.max(0, Math.min(1, (time - times[lo]) / (times[hi] - times[lo] || 1)));
  const a = Array.from(values.slice(lo * stride, (lo + 1) * stride)), b = Array.from(values.slice(hi * stride, (hi + 1) * stride));
  if (stride === 4) return new THREE.Quaternion(...a).slerp(new THREE.Quaternion(...b), t).toArray();
  return a.map((x, i) => x + (b[i] - x) * t);
}
const inverseBinds = joints.map((_, i) => new THREE.Matrix4().fromArray(Array.from(ibm.slice(i * 16, i * 16 + 16))));
const limbGroup = new Map(joints.map((joint) => {
  let node=joint;
  while (node && !/^(Left|Right)_(Hand|Foot)$/.test(node.getName())) node=node.getParentNode();
  return [joint.getName(),node?.getName() ?? null];
}));
function evaluate(animation, time) {
  const override = new Map();
  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode(); let entry = override.get(node);
    if (!entry) { entry = {}; override.set(node, entry); }
    entry[channel.getTargetPath()] = sample(channel, time);
  }
  const world = new Map();
  const getWorld = (node) => {
    if (!node) return identity;
    if (world.has(node)) return world.get(node);
    const o = override.get(node) ?? {};
    const p = new THREE.Vector3(...(o.translation ?? node.getTranslation()));
    const q = new THREE.Quaternion(...(o.rotation ?? node.getRotation()));
    const s = new THREE.Vector3(...node.getScale());
    const matrix = getWorld(node.getParentNode()).clone().multiply(new THREE.Matrix4().compose(p, q, s));
    world.set(node, matrix); return matrix;
  };
  const jointPositions=Object.fromEntries(['Hips','Left_Shoulder','Right_Shoulder','Left_Hand','Right_Hand','Left_Foot','Right_Foot'].map((name)=>{
    const joint=joints.find((entry)=>entry.getName()===name), v=new THREE.Vector3().setFromMatrixPosition(getWorld(joint));
    return [name,v.toArray()];
  }));
  const transforms = joints.map((joint, i) => getWorld(joint).clone().multiply(inverseBinds[i]));
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], floorVertex=null,ceilingVertex=null;
  const contactY = { Left_Hand:Infinity, Right_Hand:Infinity, Left_Foot:Infinity, Right_Foot:Infinity };
  const out = new Float32Array(positions.length);
  const p = new THREE.Vector3();
  for (let v = 0; v < positions.length / 3; v++) {
    p.set(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const idx = v * 4 + k, w = weights[idx];
      if (w <= 0) continue;
      const q = p.clone().applyMatrix4(transforms[jointIds[idx]]);
      x += w * q.x; y += w * q.y; z += w * q.z;
    }
    out[v * 3] = x; out[v * 3 + 1] = y; out[v * 3 + 2] = z;
    let best=0;
    for (let k=1;k<4;k++) if (weights[v*4+k]>weights[v*4+best]) best=k;
    const dominant=joints[jointIds[v*4+best]].getName();
    for (const group of Object.keys(contactY)) if (limbGroup.get(dominant)===group) contactY[group]=Math.min(contactY[group],y);
    if (y>max[1]) ceilingVertex={index:v,joint:dominant,position:[x,y,z]};
    if (y<min[1]) floorVertex={index:v,joint:dominant,position:[x,y,z]};
    min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z);
  }
  return { min, max, height: max[1] - min[1], contactY, jointPositions, floorVertex, ceilingVertex, out };
}
if (process.argv.includes('--correct-floor')) {
  const corrected = {};
  for (const animation of root.listAnimations()) {
    const name = animation.getName();
    const hip = animation.listChannels().find((c) => c.getTargetNode()?.getName() === 'Hips' && c.getTargetPath() === 'translation');
    if (!hip) continue;
    const duration = Math.max(...animation.listSamplers().map((s) => s.getInput().getArray().at(-1)));
    const times = Float32Array.from({ length: 97 }, (_, i) => duration * i / 96);
    const values = new Float32Array(times.length * 3);
    let peakCorrection = 0;
    for (let i = 0; i < times.length; i++) {
      const y = evaluate(animation, times[i]).min[1];
      const correction = (.006 - y) / 2.25;
      const p = sample(hip, times[i]);
      values.set([p[0], p[1] + correction, p[2]], i * 3);
      peakCorrection = Math.max(peakCorrection, correction * 2.25);
    }
    const buffer = root.listBuffers()[0];
    hip.getSampler().setInput(doc.createAccessor(`${name}_ground_time`).setArray(times).setType('SCALAR').setBuffer(buffer));
    hip.getSampler().setOutput(doc.createAccessor(`${name}_ground_hips`).setArray(values).setType('VEC3').setBuffer(buffer));
    corrected[name] = peakCorrection;
  }
  const output = await io.writeBinary(doc);
  await writeFile(file, output);
  const validation = JSON.parse(await readFile(`${dir}/validation.json`, 'utf8'));
  validation.candidateSha256 = createHash('sha256').update(output).digest('hex');
  validation.candidateBytes = output.length;
  validation.floorCorrectionWorldMeters = corrected;
  await writeFile(`${dir}/validation.json`, JSON.stringify(validation, null, 2) + '\n');
}
const results = {};
const idle = root.listAnimations().find((a) => a.getName() === 'Idle');
const idlePose = evaluate(idle, 0).out;
const sampleCount = process.argv.includes('--dense') ? 192 : 20;
for (const animation of root.listAnimations()) {
  const name = animation.getName();
  const duration = Math.max(...animation.listSamplers().map((s) => s.getInput().getArray().at(-1)));
  const samples = [];
  for (let i = 0; i <= sampleCount; i++) {
    const time = duration * i / sampleCount, pose = evaluate(animation, time);
    let sum = 0, maxMove = 0;
    for (let v = 0; v < pose.out.length; v += 3) {
      const d = Math.hypot(pose.out[v] - idlePose[v], pose.out[v + 1] - idlePose[v + 1], pose.out[v + 2] - idlePose[v + 2]);
      sum += d; maxMove = Math.max(maxMove, d);
    }
    samples.push({ time, minY: pose.min[1], maxY: pose.max[1], height: pose.height, bounds:{min:pose.min,max:pose.max}, contactY:pose.contactY, jointPositions:pose.jointPositions, floorVertex:pose.floorVertex, ceilingVertex:pose.ceilingVertex, meanMove: sum / (pose.out.length / 3), maxMove });
  }
  results[name] = { duration, minY: Math.min(...samples.map((s) => s.minY)), final: samples.at(-1), peak: samples.reduce((a, b) => a.meanMove > b.meanMove ? a : b), samples };
}
await writeFile(`${dir}/motion-audit.json`, JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([name, x]) => [name, { duration: x.duration, minY: x.minY, final: x.final, peak: x.peak }])), null, 2));
