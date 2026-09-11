/** Stage original Wilderness trees. Promotion is a separate root-owned acceptance step. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { generateTree, TREE_DESIGNS } from './geometry.js';

const out = path.resolve('test-results/wilderness-trees'), io = new NodeIO();
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const round = (n: number): number => Number(n.toFixed(5));
await mkdir(path.join(out, 'models/corealm/nature'), { recursive: true });
const assets = [];
const topology = [];
for (const spec of TREE_DESIGNS) {
  const tree = generateTree(spec.id), doc = new Document(), buffer = doc.createBuffer(), mesh = doc.createMesh(spec.id);
  for (const [role, skin] of Object.entries(tree.skins)) {
    if (!skin.indices.length) continue;
    const material = doc.createMaterial(role === 'bark' ? 'Bark_Corealm' : role === 'heartwood' ? spec.id.endsWith('hollow') ? 'Bark_Corealm@exposed-grain' : 'Wilderness exposed heartwood' : 'Bark_Corealm@hollow-interior')
      .setMetallicFactor(0).setRoughnessFactor(.98).setBaseColorFactor(role === 'bark' ? [...spec.colour, 1] : role === 'heartwood' ? [.38, .33, .26, 1] : [.28, .25, .21, 1]);
    const access = (name: string, type: 'VEC2' | 'VEC3', values: number[]) => doc.createAccessor(`${role}-${name}`).setBuffer(buffer).setType(type).setArray(Float32Array.from(values));
    mesh.addPrimitive(doc.createPrimitive().setMaterial(material)
      .setAttribute('POSITION', access('position', 'VEC3', skin.position)).setAttribute('NORMAL', access('normal', 'VEC3', skin.normal))
      .setAttribute('COLOR_0', access('colour', 'VEC3', skin.colour)).setAttribute('TEXCOORD_0', access('uv', 'VEC2', skin.uv))
      .setIndices(doc.createAccessor(`${role}-indices`).setBuffer(buffer).setType('SCALAR').setArray(Uint32Array.from(skin.indices))));
  }
  doc.createScene('Wilderness dead forest').addChild(doc.createNode(spec.id).setMesh(mesh));
  const binary = await io.writeBinary(doc), roundTrip = await io.readBinary(binary), bounds = getBounds(roundTrip.getRoot().listScenes()[0]!);
  const file = `models/corealm/nature/${spec.id}.glb`;
  await writeFile(path.join(out, file), binary);
  assets.push({ id: spec.id, file, pack: 'corealm-original-wilderness-trees', category: 'nature', is: spec.description,
    tags: ['deadwood', 'corealm', 'original', 'wilderness', 'dressing'], bytes: binary.length,
    size: { x: round(bounds.max[0] - bounds.min[0]), y: round(bounds.max[1] - bounds.min[1]), z: round(bounds.max[2] - bounds.min[2]) },
    base: { x: round(bounds.min[0]), y: round(bounds.min[1]), z: round(bounds.min[2]) }, animations: [],
    materials: roundTrip.getRoot().listMaterials().map(m => m.getName()), sha256: digest(binary), triangles: tree.triangles,
    provenance: { geometry: 'Original tools/wilderness-trees/geometry.ts', material: 'Production Corealm bark albedo, tangent normal and roughness through Bark_Corealm; original heartwood and cavity materials', sourceGeometry: 'No imported model or rescaled source tree', wind: 'Dead wood is static in the production foliage path' } });
  topology.push({ id: spec.id, axes: tree.axes, bounds, openingFaces: tree.openingFaces, triangles: tree.triangles });
}
const catalog = { pack: { id: 'corealm-original-wilderness-trees', name: 'Corealm Wilderness dead forest', author: 'Corealm project', source: 'tools/wilderness-trees/build.ts', license: 'LicenseRef-Corealm-Original', generatorSha256: digest(await readFile('tools/wilderness-trees/build.ts')) },
  geometrySource: { file: 'tools/wilderness-trees/geometry.ts', sha256: digest(await readFile('tools/wilderness-trees/geometry.ts')) },
  generator: { command: 'npx tsx tools/wilderness-trees/build.ts', deterministic: true, coordinateSystem: '+Y up, metres, native grounded pivots' }, assets };
await writeFile(path.join(out, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
await writeFile(path.join(out, 'topology.json'), `${JSON.stringify(topology, null, 2)}\n`);
console.log(JSON.stringify({ catalog: 'test-results/wilderness-trees/catalog.json', assets: assets.map(a => ({ id: a.id, size: a.size, triangles: a.triangles, bytes: a.bytes })) }, null, 2));
