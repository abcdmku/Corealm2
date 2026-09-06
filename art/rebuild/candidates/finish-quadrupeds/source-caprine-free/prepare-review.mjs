import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';

const root = path.dirname(fileURLToPath(import.meta.url)), io = new NodeIO();
const rawPath = path.join(root, 'p0ss-sheep2-static.glb');
const document = await io.read(rawPath), model = document.getRoot();
assert.equal(model.listMeshes().length, 1);
assert.equal(model.listAnimations().length, 0);
assert.equal(model.listSkins().length, 0);
assert.equal(model.listTextures().length, 1);
let triangles = 0;
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
for (const node of model.listNodes()) if (node.getMesh()) {
  const matrix = node.getWorldMatrix();
  for (const primitive of node.getMesh().listPrimitives()) {
    const positions = primitive.getAttribute('POSITION');
    assert.ok(primitive.getAttribute('TEXCOORD_0'));
    assert.ok(primitive.getMaterial().getBaseColorTexture()?.getImage()?.length);
    triangles += (primitive.getIndices()?.getCount() ?? positions.getCount()) / 3;
    for (let i = 0; i < positions.getCount(); i++) {
      const v = positions.getElement(i, []);
      assert.ok(v.every(Number.isFinite));
      for (let k = 0; k < 3; k++) {
        const world = matrix[k] * v[0] + matrix[4 + k] * v[1] + matrix[8 + k] * v[2] + matrix[12 + k];
        min[k] = Math.min(min[k], world); max[k] = Math.max(max[k], world);
      }
    }
  }
}
const scale = .95 / (max[1] - min[1]);
const wrapper = document.createNode('Sheep2_complete_base_STATIC_0.95m_review').setScale([scale, scale, scale]);
const scene = model.getDefaultScene() ?? model.listScenes()[0];
for (const node of [...scene.listChildren()]) { scene.removeChild(node); wrapper.addChild(node); }
scene.addChild(wrapper);
const relativeFile = 'models/creature/creature_cairn_bighorn.glb';
const output = path.join(root, relativeFile);
await fs.mkdir(path.dirname(output), { recursive: true });
await io.write(output, document);
const bytes = await fs.readFile(output), raw = await fs.readFile(rawPath);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const scaledMin = min.map(v => v * scale), scaledMax = max.map(v => v * scale);
const source = 'https://opengameart.org/content/sheep-rigged-textured-and-animated';
const asset = {
  id: 'creature_cairn_bighorn', file: relativeFile, pack: 'p0ss-sheep2-static-review',
  category: 'character', is: 'Sheep 2 complete body base; possible Bighorn adaptation',
  tags: ['animal', 'sheep', 'complete-source-body', 'static-source-review'],
  bytes: bytes.length, sha256: sha(bytes),
  size: Object.fromEntries(['x', 'y', 'z'].map((axis, k) => [axis, scaledMax[k] - scaledMin[k]])),
  base: Object.fromEntries(['x', 'y', 'z'].map((axis, k) => [axis, scaledMin[k]])),
  bounds: { min: scaledMin, max: scaledMax }, groundY: scaledMin[1],
  animations: [], triangles, static: true, accepted: false,
  sourceProvenance: { source, author: 'p0ss', license: 'CC-BY-SA-3.0',
    attribution: 'Sheep by p0ss; source boar texture photograph by titus tscharntke.',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
    rawStaticFile: 'p0ss-sheep2-static.glb', rawStaticSha256: sha(raw),
    uniformWrapperScale: scale, geometryShapeModified: false,
    changes: ['Rest-pose static bake of original Sheep 2', 'Original packed diffuse relinked', 'Rigid heading/ground alignment', 'Uniform root wrapper to 0.95 m height'],
  },
};
await fs.writeFile(path.join(root, 'review-catalogue.json'), JSON.stringify({ schema: 1,
  scope: 'Static Sheep 2 body selection only. No horns, adaptation, rig or production acceptance claimed.',
  pack: { id: asset.pack, name: 'p0ss Sheep 2 complete static base review', author: 'p0ss', source, license: 'CC-BY-SA-3.0' }, assets: [asset],
}, null, 2) + '\n');
console.log(JSON.stringify({ file: output, sha256: asset.sha256, scale, size: asset.size, triangles }));
