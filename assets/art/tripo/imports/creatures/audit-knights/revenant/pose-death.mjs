import { readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const file = 'assets/art/tripo/imports/creatures/audit-knights/revenant/waygrave-warden-native-rig.glb';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.readBinary(await readFile(file));
const death = doc.getRoot().listAnimations().find((clip) => clip.getName() === 'Death');
const hip = death?.listChannels().find((channel) => channel.getTargetNode()?.getName() === 'mixamorigHips' && channel.getTargetPath() === 'rotation');
if (!hip) throw new Error('Revenant Death has no hip rotation');
const times = hip.getSampler().getInput().getArray();
if (times.length !== 5 || Math.abs(times[4] - 1.45) > 1e-5) throw new Error('Death timing changed');
const quatZ = (angle) => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
hip.getSampler().getOutput().setArray(Float32Array.from([0, -0.15, -0.78, -1.48, -1.48].flatMap(quatZ)));
await writeFile(file, await io.writeBinary(doc));
console.log('Revenant Death hip turn now collapses sideways by 1.48 radians.');
