/** CPU geometry and paired extraction checks; these do not replace lab imagery. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { Vector3 } from 'three';

const directory = 'test-results/wilderness-resources', catalog = JSON.parse(await readFile(`${directory}/catalog.json`, 'utf8'));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS), result: any[] = [];
for (const asset of catalog.assets) {
  const bytes = await readFile(path.join(directory, asset.file));
  assert.equal(bytes.length, asset.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  const doc = await io.readBinary(bytes); let triangles = 0, area = 0, woodArea = 0, emissionArea = 0, minArea = Infinity, maxNormalError = 0;
  const barkTextures = new Set<string>();
  const ground = new Set<string>();
  for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const positions = primitive.getAttribute('POSITION')!, normals = primitive.getAttribute('NORMAL')!;
    if (primitive.getMaterial()!.getName().startsWith('Bark')) {
      const material = primitive.getMaterial()!, texture = material.getBaseColorTexture();
      if (texture?.getImage()) barkTextures.add(createHash('sha256').update(texture.getImage()!).digest('hex'));
      if (asset.id.startsWith('corealm_stump')) {
        assert(texture?.getImage(), `${asset.id}: stump must retain the living bark bitmap`);
        assert.equal(material.getExtras().corealmBarkRelief, true, `${asset.id}: stump must retain production bark relief`);
      }
    }
    for (const accessor of primitive.listAttributes()) assert(Array.from(accessor.getArray()!).every(Number.isFinite), `${asset.id}: finite attributes`);
    for (let i = 0; i < positions.getCount(); i++) {
      const p = positions.getElement(i, [0, 0, 0]), n = normals.getElement(i, [0, 0, 0]); maxNormalError = Math.max(maxNormalError, Math.abs(Math.hypot(...n) - 1));
      if (Math.abs(p[1]!) < 1e-6) ground.add(p.map(v => v.toFixed(5)).join(','));
    }
    const indices = primitive.getIndices()?.getArray() ?? Array.from({ length: positions.getCount() }, (_, i) => i);
    const emissive = primitive.getMaterial()!.getEmissiveFactor().some(v => v > 0);
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = [0, 1, 2].map(j => new Vector3(...positions.getElement(indices[i + j]!, [0, 0, 0])));
      const faceArea = b!.sub(a!).cross(c!.sub(a!)).length() / 2;
      area += faceArea; if (emissive) emissionArea += faceArea;
      if (!primitive.getMaterial()!.getName().startsWith('Leaves')) woodArea += faceArea;
      minArea = Math.min(minArea, faceArea); triangles++;
    }
  }
  assert.equal(triangles, asset.triangles); assert(minArea > 1e-12, `${asset.id}: no collapsed faces (${minArea})`);
  assert(maxNormalError < .0002, `${asset.id}: unit normals (${maxNormalError})`); assert(ground.size > 8, `${asset.id}: rooted ground contacts`);
  if (asset.id.startsWith('corealm_magic')) assert(emissionArea / woodArea > .003 && emissionArea / woodArea < .15, `${asset.id}: sap emission stays a small exposed wood fraction (${emissionArea / woodArea})`);
  if (asset.id.endsWith('_spent')) assert.equal(emissionArea, 0, 'Depleted hosts must stop glowing');
  result.push({ id: asset.id, triangles, minArea, maxNormalError, emissionFraction: emissionArea / area, emissionWoodFraction: emissionArea / woodArea, barkTextures: [...barkTextures].sort(), ground: [...ground].sort() });
}
for (const [species, source] of [['teak', 'corealm_teak_lastroot'], ['magic', 'corealm_magic_starwood']]) {
  const living = result.find(r => r.id === source)!, stump = result.find(r => r.id === `corealm_stump_wilderness_${species}`)!;
  assert.deepEqual(stump.ground, living.ground, `${species}: depletion preserves the actual living root contacts`);
  assert.deepEqual(stump.barkTextures, living.barkTextures, `${species}: depletion preserves the living bark scan`);
}
for (const family of ['cindervein', 'nightglass']) {
  const live = result.find(r => r.id === `corealm_ore_${family}`)!, spent = result.find(r => r.id === `corealm_ore_${family}_spent`)!;
  assert.deepEqual(live.ground, spent.ground, `${family}: extraction keeps its footprint`);
}
await writeFile(`${directory}/geometry-check.json`, JSON.stringify({ passed: true, assets: result.map(({ ground, ...row }) => ({ ...row, groundContacts: ground.length })) }, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, assets: result.map(({ ground, ...row }) => ({ ...row, groundContacts: ground.length })) }, null, 2));
