import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const base = 'assets/art/tripo/imports/creatures/audit-knights';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const mix = (a, b, t) => a + (b - a) * t;
const norm = (q) => { const n = Math.hypot(...q); return q.map((v) => v / n); };
function slerp(a, b, t) {
  let dot = a.reduce((s, v, i) => s + v * b[i], 0);
  if (dot < 0) { b = b.map((v) => -v); dot = -dot; }
  if (dot > 0.9995) return norm(a.map((v, i) => mix(v, b[i], t)));
  const theta = Math.acos(Math.min(1, dot)), sine = Math.sin(theta);
  return a.map((v, i) => (Math.sin((1 - t) * theta) * v + Math.sin(t * theta) * b[i]) / sine);
}
const mul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
function rotate(q, v) {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx];
}
function sample(channel, time) {
  const times = channel.getSampler().getInput().getArray();
  const values = channel.getSampler().getOutput().getArray();
  const stride = channel.getTargetPath() === 'rotation' ? 4 : 3;
  let upper = 1;
  while (upper < times.length - 1 && times[upper] < time) upper++;
  const lower = upper - 1;
  const t = Math.max(0, Math.min(1, (time - times[lower]) / (times[upper] - times[lower] || 1)));
  const a = Array.from(values.slice(lower * stride, (lower + 1) * stride));
  const b = Array.from(values.slice(upper * stride, (upper + 1) * stride));
  return stride === 4 ? slerp(a, b, t) : a.map((v, i) => mix(v, b[i], t));
}
function evaluator(root) {
  const mesh = root.listMeshes()[0], primitive = mesh.listPrimitives()[0];
  const meshNode = root.listNodes().find((node) => node.getMesh() === mesh);
  const scaleY = meshNode.getScale()[1];
  const skin = meshNode.getSkin() ?? root.listSkins()[0];
  const joints = skin.listJoints(), index = new Map(joints.map((node, i) => [node, i]));
  const ibm = skin.getInverseBindMatrices().getArray();
  const positions = primitive.getAttribute('POSITION').getArray();
  const weights = primitive.getAttribute('WEIGHTS_0').getArray();
  const jointIds = primitive.getAttribute('JOINTS_0').getArray();
  const death = root.listAnimations().find((a) => a.getName() === 'Death');
  const channels = death.listChannels();
  const hipChannel = channels.find((c) => c.getTargetNode()?.getName() === 'mixamorigHips' && c.getTargetPath() === 'translation');
  if (!hipChannel) throw new Error('Death hip translation channel missing');
  const duration = Math.max(...channels.map((c) => c.getSampler().getInput().getArray().at(-1)));
  const boundsY = (time) => {
    const localP = joints.map((j) => [...j.getTranslation()]);
    const localQ = joints.map((j) => [...j.getRotation()]);
    for (const channel of channels) {
      const i = index.get(channel.getTargetNode());
      if (i === undefined) continue;
      if (channel.getTargetPath() === 'translation') localP[i] = sample(channel, time);
      if (channel.getTargetPath() === 'rotation') localQ[i] = sample(channel, time);
    }
    const worldP = [], worldQ = [];
    for (let i = 0; i < joints.length; i++) {
      const parent = index.get(joints[i].getParentNode());
      if (parent === undefined) { worldP[i] = localP[i]; worldQ[i] = localQ[i]; }
      else {
        const p = rotate(worldQ[parent], localP[i]);
        worldP[i] = p.map((v, axis) => v + worldP[parent][axis]);
        worldQ[i] = mul(worldQ[parent], localQ[i]);
      }
    }
    let floor = Infinity, ceiling = -Infinity;
    for (let vertex = 0; vertex < positions.length / 3; vertex++) {
      const x = positions[vertex * 3], y = positions[vertex * 3 + 1], z = positions[vertex * 3 + 2];
      let outputY = 0;
      for (let slot = 0; slot < 4; slot++) {
        const offset = vertex * 4 + slot, weight = weights[offset];
        if (weight <= 0) continue;
        const j = jointIds[offset], at = j * 16;
        const p = [ibm[at] * x + ibm[at + 4] * y + ibm[at + 8] * z + ibm[at + 12],
          ibm[at + 1] * x + ibm[at + 5] * y + ibm[at + 9] * z + ibm[at + 13],
          ibm[at + 2] * x + ibm[at + 6] * y + ibm[at + 10] * z + ibm[at + 14]];
        outputY += (rotate(worldQ[j], p)[1] + worldP[j][1]) * weight;
      }
      floor = Math.min(floor, outputY * scaleY);
      ceiling = Math.max(ceiling, outputY * scaleY);
    }
    return { min: floor, max: ceiling, height: ceiling - floor };
  };
  return { hipChannel, duration, scaleY, boundsY };
}

for (const [kind, file] of [
  ['pearl', `${base}/pearl/pearl-patrol-knight-native-rig.glb`],
  ['revenant', `${base}/revenant/waygrave-warden-native-rig.glb`],
]) {
  const doc = await io.readBinary(await readFile(file));
  const root = doc.getRoot();
  const { hipChannel, duration, scaleY, boundsY } = evaluator(root);
  const before = Array.from({ length: 30 }, (_, i) => boundsY(duration * i / 29));
  const original = { input: hipChannel.getSampler().getInput(), output: hipChannel.getSampler().getOutput() };
  const times = Float32Array.from({ length: 97 }, (_, i) => duration * i / 96);
  const values = new Float32Array(times.length * 3);
  const targetFloor = 0.006; // Native floor; Pearl presentation scale leaves ~3 mm clearance.
  for (let i = 0; i < times.length; i++) {
    const time = times[i];
    const p = sample(hipChannel, time);
    const correction = Math.max(0, targetFloor - boundsY(time).min) / scaleY;
    values.set([p[0], p[1] + correction, p[2]], i * 3);
  }
  hipChannel.getSampler().setInput(doc.createAccessor(`${kind}_Death_floor_time`).setArray(times).setType('SCALAR').setBuffer(original.input.getBuffer()));
  hipChannel.getSampler().setOutput(doc.createAccessor(`${kind}_Death_floor_hips`).setArray(values).setType('VEC3').setBuffer(original.output.getBuffer()));
  const after = Array.from({ length: 193 }, (_, i) => boundsY(duration * i / 192));
  const minimumAfter = Math.min(...after.map((entry) => entry.min));
  if (minimumAfter < -0.003) throw new Error(`${kind} still penetrates floor by ${minimumAfter}`);
  const bytes = await io.writeBinary(doc);
  await writeFile(file, bytes);
  const digest = sha(bytes);
  const proof = { method: 'All weighted mesh vertices skinned against each Death pose; hip-Y correction keyed at 97 frames and independently checked at 193 frames.', scaleY, duration, minBefore: Math.min(...before.map((entry) => entry.min)), minAfter: minimumAfter, floorTarget: targetFloor, startHeight: after[0].height, finalHeight: after.at(-1).height, finalHeightRatio: after.at(-1).height / after[0].height };
  for (const path of [`${base}/${kind}/catalog.json`, `${base}/${kind}/lab-catalog.json`]) {
    const data = JSON.parse(await readFile(path, 'utf8'));
    if (data.candidate) { data.candidate.sha256 = digest; data.candidate.bytes = bytes.length; data.candidate.deathFloorProof = proof; }
    for (const asset of data.assets ?? []) {
      asset.sha256 = digest; asset.bytes = bytes.length;
      asset.sourceProvenance.candidateSha256 = digest;
      asset.sourceProvenance.deathFloorProof = proof;
    }
    await writeFile(path, JSON.stringify(data, null, 2) + '\n');
  }
  console.log(JSON.stringify({ kind, bytes: bytes.length, sha256: digest, proof }));
}
