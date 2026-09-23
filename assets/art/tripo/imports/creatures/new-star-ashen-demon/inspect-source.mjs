import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import sharp from 'sharp';

const sourcePath = 'assets/art/tripo/exports/e75eed94-f770-4fc3-83f2-d812e898b0ee.glb';
const bytes = await readFile(sourcePath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (sha256 !== '6531b664fc404c5dee25dc21ba6177061af0bbc0a46bf830b20f1ff61cc96f02') throw new Error(`Source SHA mismatch: ${sha256}`);
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes);
const root = doc.getRoot();
const mesh = root.listMeshes()[0];
const primitive = mesh?.listPrimitives()[0];
const skin = root.listSkins()[0];
if (!mesh || !primitive || !skin) throw new Error('Expected the source mesh with a rigged skin.');
const positions = primitive.getAttribute('POSITION').getArray();
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
for (let i = 0; i < positions.length; i += 3) for (let a = 0; a < 3; a++) {
  bounds.min[a] = Math.min(bounds.min[a], positions[i + a]);
  bounds.max[a] = Math.max(bounds.max[a], positions[i + a]);
}
const joints = skin.listJoints();
const inverseBinds = skin.getInverseBindMatrices()?.getArray();
const jointIndex = new Map(joints.map((n, i) => [n, i]));
const weights = primitive.getAttribute('WEIGHTS_0')?.getArray();
const jointAttr = primitive.getAttribute('JOINTS_0')?.getArray();
const counts = joints.map(() => ({ vertices: 0, dominant: 0, total: 0 }));
let maxWeightError = 0;
let missing = 0;
if (weights && jointAttr) {
  for (let v = 0; v < weights.length / 4; v++) {
    let sum = 0, dominantIndex = 0, dominantWeight = 0;
    for (let k = 0; k < 4; k++) {
      const w = weights[v * 4 + k];
      const j = jointAttr[v * 4 + k];
      sum += w;
      if (w > 1e-6) { counts[j].vertices++; counts[j].total += w; }
      if (w > dominantWeight) { dominantWeight = w; dominantIndex = j; }
    }
    if (dominantWeight > 1e-6) counts[dominantIndex].dominant++;
    else missing++;
    maxWeightError = Math.max(maxWeightError, Math.abs(sum - 1));
  }
}
const report = {
  sourcePath, sha256, sourceBytes: bytes.byteLength,
  meshCount: root.listMeshes().length, skins: root.listSkins().length, animationCount: root.listAnimations().length,
  sceneRoots: root.listScenes()[0].listChildren().map(n => ({ name: n.getName(), translation: n.getTranslation(), rotation: n.getRotation(), scale: n.getScale(), children: n.listChildren().map(c => ({ name: c.getName(), translation: c.getTranslation(), rotation: c.getRotation(), scale: c.getScale(), mesh: c.getMesh()?.getName(), skin: c.getSkin()?.getName() })), mesh: n.getMesh()?.getName(), skin: n.getSkin()?.getName() })),
  vertices: positions.length / 3, triangles: primitive.getIndices().getCount() / 3, bounds,
  textureInfo: await Promise.all(root.listTextures().map(async (t) => {
    const m = await sharp(t.getImage()).metadata();
    return { name: t.getName(), width: m.width, height: m.height, mimeType: t.getMimeType(), sha256: createHash('sha256').update(t.getImage()).digest('hex') };
  })),
  material: root.listMaterials().map(m => ({ name: m.getName(), metallic: m.getMetallicFactor(), roughness: m.getRoughnessFactor(), baseColor: m.getBaseColorFactor(), textures: { baseColor: m.getBaseColorTexture()?.getName(), metallicRoughness: m.getMetallicRoughnessTexture()?.getName(), normal: m.getNormalTexture()?.getName(), emissive: m.getEmissiveTexture()?.getName() } })),
  weights: { present: Boolean(weights && jointAttr), maxSumError: maxWeightError, missingVertices: missing },
  bones: joints.map((joint, i) => {
    const bindWorld = inverseBinds ? new THREE.Matrix4().fromArray(inverseBinds.slice(i * 16, i * 16 + 16)).invert() : null;
    return { i, name: joint.getName(), parent: joint.getParentNode()?.getName(), translation: joint.getTranslation(), rotation: joint.getRotation(), scale: joint.getScale(), bindPosition: bindWorld?.elements.slice(12, 15).map(v => +v.toFixed(4)), weightVertices: counts[i].vertices, dominantVertices: counts[i].dominant, totalWeight: +counts[i].total.toFixed(3) };
  }),
  verticalProfile: Array.from({ length: 12 }, (_, bin) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, count = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const y = positions[i + 1];
      if (y < bin / 12 || y >= (bin + 1) / 12) continue;
      minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
      minZ = Math.min(minZ, positions[i + 2]); maxZ = Math.max(maxZ, positions[i + 2]); count++;
    }
    return { y: `${(bin / 12).toFixed(2)}-${((bin + 1) / 12).toFixed(2)}`, count, minX, maxX, minZ, maxZ };
  }),
};
await mkdir('assets/art/tripo/imports/creatures/new-star-ashen-demon', { recursive: true });
await writeFile('assets/art/tripo/imports/creatures/new-star-ashen-demon/source-inspection.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
