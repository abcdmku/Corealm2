import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const file of [
  'assets/art/tripo/imports/creatures/audit-knights/pearl/pearl-patrol-knight-native-rig.glb',
  'assets/art/tripo/imports/creatures/audit-knights/revenant/waygrave-warden-native-rig.glb',
]) {
  const bytes = await readFile(file);
  const doc = await io.readBinary(bytes);
  const root = doc.getRoot();
  const p = root.listMeshes()[0].listPrimitives()[0];
  const pos = p.getAttribute('POSITION').getArray();
  const idx = p.getIndices().getArray();
  const weights = p.getAttribute('WEIGHTS_0').getArray();
  const joints = p.getAttribute('JOINTS_0').getArray();
  const skin = root.listSkins()[0];
  let maxWeightSumError = 0, minY = Infinity, maxY = -Infinity, maxJoint = 0;
  for (let i = 0; i < pos.length / 3; i++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      sum += weights[i * 4 + k];
      maxJoint = Math.max(maxJoint, joints[i * 4 + k]);
    }
    maxWeightSumError = Math.max(maxWeightSumError, Math.abs(sum - 1));
    minY = Math.min(minY, pos[i * 3 + 1]);
    maxY = Math.max(maxY, pos[i * 3 + 1]);
  }
  if (maxWeightSumError > 1e-5 || maxJoint >= skin.listJoints().length) throw new Error(`Invalid skin weights in ${file}`);
  const clips = root.listAnimations().map(a => ({
    name: a.getName(),
    seconds: Math.max(...a.listChannels().map(c => c.getSampler().getInput().getArray().at(-1))),
  }));
  if (['Idle', 'Walk', 'Run', 'Attack', 'Hit', 'Death'].some(name => !clips.some(c => c.name === name))) throw new Error(`Missing clip in ${file}`);
  console.log(JSON.stringify({ file, sha256: createHash('sha256').update(bytes).digest('hex'), vertices: pos.length / 3, triangles: idx.length / 3, joints: skin.listJoints().length, maxWeightSumError, minY, maxY, clips }));
}
