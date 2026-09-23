import { mkdir, readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const base = 'assets/art/tripo/imports/creatures/audit-knights';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const [kind, file] of [
  ['pearl', `${base}/pearl/pearl-patrol-knight-native-rig.glb`],
  ['revenant', `${base}/revenant/waygrave-warden-native-rig.glb`],
]) {
  const doc = await io.readBinary(await readFile(file));
  const material = doc.getRoot().listMeshes()[0].listPrimitives()[0].getMaterial();
  const texture = material.getBaseColorTexture();
  const output = `${base}/${kind}/source-atlas.png`;
  await mkdir(`${base}/${kind}`, { recursive: true });
  await sharp(texture.getImage()).resize(2048, 2048).png().toFile(output);
  console.log(kind, texture.getName(), output);
}
