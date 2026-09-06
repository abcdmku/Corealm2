import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { KHRMaterialsClearcoat, KHRMaterialsIridescence } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { mapWaspBody } from './wasp-body-surface.mjs';
import { finishWasp } from './wasp-eyes-wings.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const argument = (name, fallback) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const source = argument('--source', path.join(root, 'game/public/assets/models/creature/creature_marsh_wasp.glb'));
const destination = argument('--out', path.join(root, 'test-results/wasp-plumage/creature_marsh_wasp.glb'));
const texturePath = fileURLToPath(new URL('./textures/harpy-plumage.png', import.meta.url));
const io = new NodeIO().registerExtensions([KHRMaterialsClearcoat, KHRMaterialsIridescence]);
const doc = await io.read(source);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const arrayHash = accessor => hash(new Uint8Array(accessor.getArray().buffer, accessor.getArray().byteOffset, accessor.getArray().byteLength));
function motionFingerprint(document = doc) {
  const doc = document;
  return JSON.stringify({
    meshes: doc.getRoot().listMeshes().map(mesh => mesh.listPrimitives().map(primitive => ({
      indices: arrayHash(primitive.getIndices()),
      attributes: Object.fromEntries(['POSITION', 'JOINTS_0', 'WEIGHTS_0'].map(name => [name, arrayHash(primitive.getAttribute(name))])),
    }))),
    animations: doc.getRoot().listAnimations().map(animation => ({ name: animation.getName(),
      samplers: animation.listSamplers().map(sampler => [arrayHash(sampler.getInput()), arrayHash(sampler.getOutput()), sampler.getInterpolation()]),
      channels: animation.listChannels().map(channel => [channel.getTargetNode().getName(), channel.getTargetPath()]),
    })),
    nodes: doc.getRoot().listNodes().map(node => [node.getName(), node.getTranslation(), node.getRotation(), node.getScale()]),
    skins: doc.getRoot().listSkins().map(skin => [skin.listJoints().map(joint => joint.getName()), arrayHash(skin.getInverseBindMatrices())]),
  });
}
const before = motionFingerprint();
const png = await readFile(texturePath);
const texture = doc.createTexture('wasp_harpy_plumage').setImage(new Uint8Array(png)).setMimeType('image/png');
const normalPng = await readFile(fileURLToPath(new URL('./textures/harpy-plumage-normal.png', import.meta.url)));
const normalTexture = doc.createTexture('wasp_scale_relief').setImage(new Uint8Array(normalPng)).setMimeType('image/png');
const coat = doc.createExtension(KHRMaterialsClearcoat).createClearcoat()
  .setClearcoatFactor(0.28).setClearcoatRoughnessFactor(0.38);
const shimmer = doc.createExtension(KHRMaterialsIridescence).createIridescence()
  .setIridescenceFactor(0.24).setIridescenceIOR(1.3)
  .setIridescenceThicknessMinimum(280).setIridescenceThicknessMaximum(340);
const bodies = doc.getRoot().listMeshes().flatMap(mesh => mesh.listPrimitives()).filter(p => /_(Yellow|Black)$/.test(p.getMaterial().getName()));
const bodyPrimitives = bodies.length;
const surface = mapWaspBody(doc, bodies);
for (const body of bodies) {
  body.getMaterial().setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(texture).setRoughnessFactor(0.46).setMetallicFactor(0.08)
    .setNormalTexture(normalTexture).setNormalScale(0.45)
    .setExtension('KHR_materials_clearcoat', coat).setExtension('KHR_materials_iridescence', shimmer);
}
assert.equal(bodyPrimitives, 2, 'Expected the two original body stripe groups');
assert.equal(motionFingerprint(), before, 'Texture work must preserve geometry, rig and every animation');
const wingPng = await readFile(fileURLToPath(new URL('./textures/wasp-wing-pearl.png', import.meta.url)));
const wingTexture = doc.createTexture('wasp_pearl_wing').setImage(new Uint8Array(wingPng)).setMimeType('image/png');
const details = finishWasp(doc, wingTexture);
const finalGeometry = motionFingerprint();
doc.getRoot().setExtras({ ...doc.getRoot().getExtras(), waspAppearance: {
  direction: 'Blue-violet short scales and fine feather filaments with subtle iridescence', textureSha256: hash(png), normalSha256: hash(normalPng),
  sourceGeometryAndMotionPreserved: false, sourceAnimationPreserved: true, eyeShellsResized: true, bodyPrimitives, surface, details, normalsReauthored: true,
} });
await mkdir(path.dirname(destination), { recursive: true });
await doc.transform(prune({ keepLeaves: true, keepAttributes: true, keepIndices: true }));
await io.write(destination, doc);
assert.equal(motionFingerprint(await io.read(destination)), finalGeometry, 'Serialization must preserve authored geometry and source animation');
await writeFile(`${destination}.appearance.json`, JSON.stringify({ source, destination, texturePath,
  textureSha256: hash(png), sourceAnimationPreserved: true, eyeShellsResized: true, bodyPrimitives, surface, details }, null, 2));
console.log(JSON.stringify({ destination, bodyPrimitives, sourceAnimationPreserved: true, details }));
